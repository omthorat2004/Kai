import React, { useCallback, useEffect, useMemo, useState } from 'react';
import AppForm from './components/AppForm.jsx';
import LogPane from './components/LogPane.jsx';
import { logStore } from './logStore.js';
import { applyTheme } from './theme.js';

/** 'YYYY-MM-DDTHH:mm' in local time, what <input type="datetime-local"> wants. */
function toLocalInputValue(d) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function statusLabel(s) {
  if (!s) return 'stopped';
  switch (s.status) {
    case 'running': return 'running';
    case 'starting': return 'starting';
    case 'stopping': return 'stopping';
    case 'error': return 'failed';
    case 'exited':
      if (s.signal) return `exited (${s.signal})`;
      return `exited (${s.exitCode ?? '?'})`;
    default: return 'stopped';
  }
}

export default function App() {
  const [apps, setApps] = useState([]);
  const [statuses, setStatuses] = useState({});
  const [selectedId, setSelectedId] = useState(null);
  const [editing, setEditing] = useState(null); // null | {} | app
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [meta, setMeta] = useState(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState('');
  const [settings, setSettings] = useState({ globalCwd: '', theme: 'system' });
  const [showSettings, setShowSettings] = useState(false);
  const [update, setUpdate] = useState(null);
  const [checking, setChecking] = useState(false);
  const [schedules, setSchedules] = useState([]);
  const [scheduling, setScheduling] = useState(null); // null | app
  const [scheduleAction, setScheduleAction] = useState('start');
  const [scheduleAt, setScheduleAt] = useState('');

  const flash = useCallback((msg) => {
    setToast(msg);
    setTimeout(() => setToast(''), 2600);
  }, []);

  const refreshStatuses = useCallback(async () => {
    const list = await window.kai.statuses();
    setStatuses(Object.fromEntries(list.map((s) => [s.id, s])));
  }, []);

  // Initial load and persisted selection.
  useEffect(() => {
    (async () => {
      const [list, ui, m, s, sch] = await Promise.all([
        window.kai.apps.list(),
        window.kai.ui.get(),
        window.kai.meta(),
        window.kai.settings.get(),
        window.kai.schedules.list(),
      ]);
      setApps(list);
      setMeta(m);
      setSettings(s);
      setSchedules(sch);
      const wanted = list.find((a) => a.id === ui.selectedId) || list[0];
      setSelectedId(wanted ? wanted.id : null);
      await refreshStatuses();
    })();
  }, [refreshStatuses]);

  // Push updates from main.
  useEffect(() => {
    const offStatus = window.kai.onStatus((s) =>
      setStatuses((prev) => ({ ...prev, [s.id]: s }))
    );
    const offApps = window.kai.onApps((list) => setApps(list));
    const offSettings = window.kai.onSettings((s) => setSettings(s));
    const offUpdate = window.kai.onUpdate((u) => setUpdate(u));
    const offSchedules = window.kai.onSchedules((list) => setSchedules(list));
    return () => { offStatus(); offApps(); offSettings(); offUpdate(); offSchedules(); };
  }, []);

  useEffect(() => {
    if (selectedId) window.kai.ui.set({ selectedId });
  }, [selectedId]);

  useEffect(() => {
    applyTheme(settings.theme);
  }, [settings.theme]);

  const selected = useMemo(
    () => apps.find((a) => a.id === selectedId) || null,
    [apps, selectedId]
  );

  const runningCount = useMemo(
    () => Object.values(statuses).filter((s) => s.status === 'running' || s.status === 'starting').length,
    [statuses]
  );

  const isRunning = (id) => ['running', 'starting', 'stopping'].includes(statuses[id]?.status);

  // One application can hold several sub-applications. Entries with no group
  // land in a trailing bucket of their own.
  const grouped = useMemo(() => {
    const map = new Map();
    for (const app of apps) {
      const key = app.group || '';
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(app);
    }
    const named = [...map.entries()].filter(([k]) => k).sort((a, b) => a[0].localeCompare(b[0]));
    const loose = map.get('') || [];
    return loose.length ? [...named, ['', loose]] : named;
  }, [apps]);

  const groupNames = useMemo(
    () => [...new Set(apps.map((a) => a.group).filter(Boolean))].sort(),
    [apps]
  );

  const toggle = async (app) => {
    if (isRunning(app.id)) {
      await window.kai.stop(app.id);
    } else {
      const res = await window.kai.start(app.id);
      if (res && res.ok === false) flash(res.error);
    }
    refreshStatuses();
  };

  const restart = async (app) => {
    const res = await window.kai.restart(app.id);
    if (res && res.ok === false) flash(res.error);
    refreshStatuses();
  };

  const startAll = async () => {
    setBusy(true);
    const results = await window.kai.startAll();
    const failed = (results || []).filter((r) => r.ok === false);
    if (failed.length) flash(`${failed.length} app(s) could not start`);
    await refreshStatuses();
    setBusy(false);
  };

  const stopAll = async () => {
    setBusy(true);
    await window.kai.stopAll();
    await refreshStatuses();
    setBusy(false);
  };

  const restartAll = async () => {
    setBusy(true);
    const results = await window.kai.restartAll();
    const failed = (results || []).filter((r) => r.ok === false);
    if (failed.length) flash(`${failed.length} app(s) could not restart`);
    await refreshStatuses();
    setBusy(false);
  };

  const pendingScheduleCount = useMemo(() => {
    const map = {};
    for (const s of schedules) {
      if (s.status === 'pending') map[s.appId] = (map[s.appId] || 0) + 1;
    }
    return map;
  }, [schedules]);

  const appSchedules = useMemo(
    () => schedules
      .filter((s) => s.appId === scheduling?.id && s.status === 'pending')
      .sort((a, b) => a.at - b.at),
    [schedules, scheduling]
  );

  // Defaults to whichever action the app isn't doing right now, same idea as
  // the Start/Stop toggle button.
  const openSchedule = (app) => {
    setScheduleAction(isRunning(app.id) ? 'stop' : 'start');
    const dt = new Date(Date.now() + 5 * 60 * 1000);
    dt.setSeconds(0, 0);
    setScheduleAt(toLocalInputValue(dt));
    setScheduling(app);
  };

  const createSchedule = async () => {
    if (!scheduling || !scheduleAt) return;
    const at = new Date(scheduleAt).getTime();
    if (!Number.isFinite(at)) return;
    const res = await window.kai.schedules.create({ appId: scheduling.id, action: scheduleAction, at });
    if (res && res.ok === false) flash(res.error);
    else flash(`${scheduleAction === 'start' ? 'Start' : 'Stop'} scheduled for ${new Date(at).toLocaleString()}`);
  };

  const cancelSchedule = async (id) => {
    await window.kai.schedules.cancel(id);
  };

  const save = async (form) => {
    const saved = await window.kai.apps.save({ ...(editing?.id ? { id: editing.id } : {}), ...form });
    setEditing(null);
    setSelectedId(saved.id);
    refreshStatuses();
  };

  const remove = async (app) => {
    await window.kai.apps.remove(app.id);
    logStore.forget(app.id);
    setConfirmDelete(null);
    setSelectedId((cur) => (cur === app.id ? null : cur));
    refreshStatuses();
  };

  return (
    <div className="app">
      <header className="titlebar">
        <div className="brand">
          <span className="mark">K</span>
          <div>
            <h1>Kai</h1>
            <p>{apps.length} app{apps.length === 1 ? '' : 's'}, {runningCount} running</p>
          </div>
        </div>
        <div className="titlebar-actions">
          <button className="btn" onClick={startAll} disabled={busy || !apps.length}>Start all</button>
          <button className="btn" onClick={stopAll} disabled={busy || !runningCount}>Stop all</button>
          <button className="btn" onClick={restartAll} disabled={busy || !runningCount}>Restart all</button>
          <button className="btn" onClick={() => setShowSettings(true)}>Settings</button>
          <button className="btn primary" onClick={() => setEditing({})}>Add app</button>
        </div>
      </header>

      {update && update.available && (
        <div className="update-bar">
          <span>
            Kai {update.version} is available. You are on {update.current}.
          </span>
          <button className="btn tiny primary" onClick={() => window.kai.openExternal(update.url)}>
            Download
          </button>
          <button className="btn tiny ghost" onClick={() => setUpdate(null)}>Later</button>
        </div>
      )}

      <div className="body">
        <aside className="sidebar">
          {apps.length === 0 && (
            <div className="sidebar-empty">
              <p>No apps saved yet.</p>
              <button className="btn primary" onClick={() => setEditing({})}>Add your first app</button>
            </div>
          )}

          {grouped.map(([groupName, members]) => {
            const runningHere = members.filter((m) => isRunning(m.id)).length;
            return (
              <div className="group" key={groupName || '__loose__'}>
                <div className="group-head">
                  <span className="group-name">{groupName || 'Standalone'}</span>
                  <span className="group-count">{runningHere}/{members.length}</span>
                  <button
                    className="btn ghost tiny"
                    title={`Start every sub-application in ${groupName || 'Standalone'}`}
                    onClick={() => window.kai.startGroup(groupName).then(refreshStatuses)}
                  >
                    Start
                  </button>
                  <button
                    className="btn ghost tiny"
                    disabled={!runningHere}
                    title={`Stop every sub-application in ${groupName || 'Standalone'}`}
                    onClick={() => window.kai.stopGroup(groupName).then(refreshStatuses)}
                  >
                    Stop
                  </button>
                  <button
                    className="btn ghost tiny"
                    disabled={!runningHere}
                    title={`Restart every sub-application in ${groupName || 'Standalone'}`}
                    onClick={() => window.kai.restartGroup(groupName).then(refreshStatuses)}
                  >
                    Restart
                  </button>
                </div>

          {members.map((app) => {
            const st = statuses[app.id];
            const running = isRunning(app.id);
            return (
              <div
                key={app.id}
                className={`app-card ${app.id === selectedId ? 'selected' : ''}`}
                onClick={() => setSelectedId(app.id)}
              >
                <div className="app-card-head">
                  <span className={`dot dot-${st?.status || 'stopped'}`} />
                  <span className="app-name">{app.name}</span>
                  {app.autostart && <span className="tag" title="Starts with Kai">auto</span>}
                  {pendingScheduleCount[app.id] > 0 && (
                    <span className="tag" title="Has a scheduled start/stop">
                      {pendingScheduleCount[app.id]} scheduled
                    </span>
                  )}
                </div>
                <div className="app-cmd" title={app.command}>{app.command}</div>
                <div className="app-cwd" title={app.cwd || settings.globalCwd}>
                  {app.cwd || `${settings.globalCwd} · global`}
                </div>
                <div className="app-status">{statusLabel(st)}{st?.pid ? ` · pid ${st.pid}` : ''}</div>
                <div className="app-card-actions" onClick={(e) => e.stopPropagation()}>
                  <button
                    className={`btn ${running ? 'danger' : 'primary'}`}
                    onClick={() => toggle(app)}
                  >
                    {running ? 'Stop' : 'Start'}
                  </button>
                  <button className="btn ghost" onClick={() => restart(app)}>Restart</button>
                  <button className="btn ghost" onClick={() => openSchedule(app)}>Schedule</button>
                </div>
                <div className="app-card-actions secondary" onClick={(e) => e.stopPropagation()}>
                  <button className="btn ghost tiny" onClick={() => setEditing(app)}>Edit</button>
                  <button className="btn ghost tiny" onClick={() => setConfirmDelete(app)}>Delete</button>
                </div>
              </div>
            );
          })}
              </div>
            );
          })}
        </aside>

        <main className="content">
          {selected ? (
            <LogPane
              appId={selected.id}
              appName={selected.name}
              status={statuses[selected.id]}
              onDetach={() => window.kai.openLogWindow(selected.id)}
            />
          ) : (
            <div className="placeholder">
              <h2>Nothing selected</h2>
              <p>Pick an app on the left, or add one to get started.</p>
            </div>
          )}
        </main>
      </div>

      <footer className="statusbar">
        <span>
          {meta ? `Kai ${meta.appVersion} · Electron ${meta.versions.electron} · Node ${meta.versions.node}` : ''}
          <button
            className="btn ghost tiny"
            style={{ marginLeft: 8 }}
            disabled={checking}
            onClick={async () => {
              setChecking(true);
              const res = await window.kai.checkUpdate();
              setChecking(false);
              if (res.available) setUpdate(res);
              else flash(res.error ? `Update check failed: ${res.error}` : 'You are on the latest version');
            }}
          >
            {checking ? 'Checking' : 'Check for updates'}
          </button>
        </span>
        <span className="muted" title={meta?.configPath}>{meta?.configPath}</span>
      </footer>

      {editing && (
        <AppForm
          initial={editing}
          groups={groupNames}
          globalCwd={settings.globalCwd}
          onSave={save}
          onCancel={() => setEditing(null)}
        />
      )}

      {showSettings && (
        <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && setShowSettings(false)}>
          <div className="modal small">
            <h2>Settings</h2>

            <label>
              <span>Theme</span>
              <select
                value={settings.theme || 'system'}
                onChange={async (e) => {
                  const next = await window.kai.settings.set({ theme: e.target.value });
                  setSettings(next);
                }}
              >
                <option value="system">Match system</option>
                <option value="light">Light</option>
                <option value="dark">Dark</option>
              </select>
            </label>

            <p className="muted">
              Global folder: where an app runs when it has no folder of its own. Use it
              for commands that are not tied to a project.
            </p>
            <div className="row">
              <input
                value={settings.globalCwd || ''}
                onChange={(e) => setSettings((s) => ({ ...s, globalCwd: e.target.value }))}
              />
              <button
                className="btn"
                onClick={async () => {
                  const dir = await window.kai.pickDirectory(settings.globalCwd);
                  if (dir) setSettings((s) => ({ ...s, globalCwd: dir }));
                }}
              >
                Browse
              </button>
            </div>
            <div className="modal-actions">
              <button className="btn ghost" onClick={() => setShowSettings(false)}>Cancel</button>
              <button
                className="btn primary"
                onClick={async () => {
                  const next = await window.kai.settings.set({ globalCwd: settings.globalCwd });
                  setSettings(next);
                  setShowSettings(false);
                }}
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}

      {scheduling && (
        <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && setScheduling(null)}>
          <div className="modal small">
            <h2>Schedule {scheduling.name}</h2>
            <p className="muted">
              Currently {isRunning(scheduling.id) ? 'running' : 'stopped'}.
            </p>
            <div className="row">
              <select value={scheduleAction} onChange={(e) => setScheduleAction(e.target.value)}>
                <option value="start">Start</option>
                <option value="stop">Stop</option>
              </select>
              <input
                type="datetime-local"
                value={scheduleAt}
                onChange={(e) => setScheduleAt(e.target.value)}
              />
            </div>

            {appSchedules.length > 0 && (
              <ul className="schedule-list">
                {appSchedules.map((s) => (
                  <li key={s.id}>
                    <span>{s.action === 'start' ? 'Start' : 'Stop'} · {new Date(s.at).toLocaleString()}</span>
                    <button className="btn ghost tiny" onClick={() => cancelSchedule(s.id)}>Cancel</button>
                  </li>
                ))}
              </ul>
            )}

            <div className="modal-actions">
              <button className="btn ghost" onClick={() => setScheduling(null)}>Close</button>
              <button className="btn primary" onClick={createSchedule} disabled={!scheduleAt}>
                Schedule
              </button>
            </div>
          </div>
        </div>
      )}

      {confirmDelete && (
        <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && setConfirmDelete(null)}>
          <div className="modal small">
            <h2>Delete {confirmDelete.name}?</h2>
            <p className="muted">
              It will be stopped if running. This only removes it from Kai, your project files are untouched.
            </p>
            <div className="modal-actions">
              <button className="btn ghost" onClick={() => setConfirmDelete(null)}>Cancel</button>
              <button className="btn danger" onClick={() => remove(confirmDelete)}>Delete</button>
            </div>
          </div>
        </div>
      )}

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
