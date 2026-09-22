import React, { useEffect, useState } from 'react';
import LogPane from './components/LogPane.jsx';
import { applyTheme, applyAccent } from './theme.js';

/**
 * The detached view: a second BrowserWindow showing exactly one app's logs,
 * meant to live on another monitor. It stays subscribed to the same push
 * channels as the main window.
 */
export default function LogWindow({ appId }) {
  const [app, setApp] = useState(null);
  const [status, setStatus] = useState(null);

  useEffect(() => {
    (async () => {
      const list = await window.kai.apps.list();
      setApp(list.find((a) => a.id === appId) || null);
      const statuses = await window.kai.statuses();
      setStatus(statuses.find((s) => s.id === appId) || null);
    })();

    const offStatus = window.kai.onStatus((s) => {
      if (s.id === appId) setStatus(s);
    });
    const offApps = window.kai.onApps((list) => {
      setApp(list.find((a) => a.id === appId) || null);
    });
    return () => { offStatus(); offApps(); };
  }, [appId]);

  // The detached window is a separate renderer, so it needs its own copy of
  // the theme setting rather than inheriting App's state.
  useEffect(() => {
    (async () => {
      const s = await window.kai.settings.get();
      applyTheme(s.theme);
      applyAccent(s.accent);
    })();
    return window.kai.onSettings((s) => {
      applyTheme(s.theme);
      applyAccent(s.accent);
    });
  }, []);

  useEffect(() => {
    if (app) document.title = `${app.name} logs`;
  }, [app]);

  if (!app) {
    return <div className="placeholder"><h2>App not found</h2><p>It may have been deleted.</p></div>;
  }

  return (
    <div className="app detached">
      <LogPane
        appId={appId}
        appName={app.name}
        status={status}
        detached
      />
    </div>
  );
}
