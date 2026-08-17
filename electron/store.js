'use strict';

// Persistence layer. electron-store writes keyed JSON to userData, so the
// config survives restarts and app upgrades.

const Store = require('electron-store');
const crypto = require('crypto');
const os = require('os');

const store = new Store({
  name: 'kai',
  defaults: {
    apps: [],
    // globalCwd is the working folder for entries that are not tied to a
    // project, so "global" commands need no folder of their own.
    settings: { globalCwd: os.homedir() },
    ui: { selectedId: null, windowBounds: { width: 1120, height: 720 } },
  },
});

/** Normalise whatever the renderer sent into a storable record. */
function normalise(input, existing = {}) {
  const env = {};
  // env may arrive as {k: v} or as [{key, value}] rows from the form.
  const raw = input.env ?? existing.env ?? {};
  if (Array.isArray(raw)) {
    for (const row of raw) {
      if (row && row.key && String(row.key).trim()) env[String(row.key).trim()] = String(row.value ?? '');
    }
  } else if (raw && typeof raw === 'object') {
    for (const [k, v] of Object.entries(raw)) if (k.trim()) env[k.trim()] = String(v ?? '');
  }

  return {
    id: input.id || existing.id || crypto.randomUUID(),
    name: String(input.name ?? existing.name ?? '').trim() || 'Untitled',
    // Optional parent application. Several sub-applications (web, api,
    // worker) can share one group and be started or stopped together.
    group: String(input.group ?? existing.group ?? '').trim(),
    cwd: String(input.cwd ?? existing.cwd ?? '').trim(),
    command: String(input.command ?? existing.command ?? '').trim(),
    env,
    autostart: !!(input.autostart ?? existing.autostart),
    createdAt: existing.createdAt || Date.now(),
    updatedAt: Date.now(),
  };
}

const api = {
  list() {
    const apps = store.get('apps', []);
    return Array.isArray(apps) ? apps : [];
  },

  get(id) {
    return api.list().find((a) => a.id === id) || null;
  },

  /** Insert or update; returns the saved record. */
  save(input) {
    const apps = api.list();
    const idx = apps.findIndex((a) => a.id === input.id);
    const record = normalise(input, idx >= 0 ? apps[idx] : {});
    if (idx >= 0) apps[idx] = record;
    else apps.push(record);
    store.set('apps', apps);
    return record;
  },

  remove(id) {
    store.set('apps', api.list().filter((a) => a.id !== id));
    return true;
  },

  reorder(ids) {
    const byId = new Map(api.list().map((a) => [a.id, a]));
    const next = ids.map((id) => byId.get(id)).filter(Boolean);
    for (const a of byId.values()) if (!ids.includes(a.id)) next.push(a);
    store.set('apps', next);
    return next;
  },

  getSettings() {
    const s = store.get('settings', {});
    return { globalCwd: s.globalCwd || os.homedir() };
  },

  setSettings(patch) {
    store.set('settings', { ...api.getSettings(), ...patch });
    return api.getSettings();
  },

  /** Where a given app should run: its own folder, else the global one. */
  resolveCwd(app) {
    return (app && app.cwd && app.cwd.trim()) || api.getSettings().globalCwd;
  },

  getUi() {
    return store.get('ui', {});
  },

  setUi(patch) {
    store.set('ui', { ...api.getUi(), ...patch });
  },

  path: store.path,
};

module.exports = api;
