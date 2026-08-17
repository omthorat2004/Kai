'use strict';

// The only bridge between main and renderer. The renderer never sees
// ipcRenderer, require, or any node primitive: it gets this frozen surface.

const { contextBridge, ipcRenderer } = require('electron');

/** Wrap a push channel so the renderer gets an unsubscribe function back. */
function subscribe(channel, callback) {
  const handler = (_event, payload) => callback(payload);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
}

const api = {
  // Which view this window should render: main list, or one app's log pane.
  windowTarget() {
    const hash = window.location.hash || '';
    const match = hash.match(/logs=([^&]+)/);
    return match ? { view: 'logs', appId: decodeURIComponent(match[1]) } : { view: 'main' };
  },

  meta: () => ipcRenderer.invoke('kai:meta'),

  apps: {
    list: () => ipcRenderer.invoke('kai:apps:list'),
    save: (app) => ipcRenderer.invoke('kai:apps:save', app),
    remove: (id) => ipcRenderer.invoke('kai:apps:remove', id),
    reorder: (ids) => ipcRenderer.invoke('kai:apps:reorder', ids),
  },

  pickDirectory: (current) => ipcRenderer.invoke('kai:pickDirectory', current),
  revealFolder: (dir) => ipcRenderer.invoke('kai:revealFolder', dir),

  start: (id) => ipcRenderer.invoke('kai:start', id),
  stop: (id) => ipcRenderer.invoke('kai:stop', id),
  startAll: () => ipcRenderer.invoke('kai:startAll'),
  stopAll: () => ipcRenderer.invoke('kai:stopAll'),
  startGroup: (group) => ipcRenderer.invoke('kai:startGroup', group),
  stopGroup: (group) => ipcRenderer.invoke('kai:stopGroup', group),
  statuses: () => ipcRenderer.invoke('kai:statuses'),

  settings: {
    get: () => ipcRenderer.invoke('kai:settings:get'),
    set: (patch) => ipcRenderer.invoke('kai:settings:set', patch),
  },

  logs: {
    get: (id) => ipcRenderer.invoke('kai:logs:get', id),
    clear: (id) => ipcRenderer.invoke('kai:logs:clear', id),
  },

  copy: (text) => ipcRenderer.invoke('kai:clipboard:write', text),
  openLogWindow: (id) => ipcRenderer.invoke('kai:openLogWindow', id),

  ui: {
    get: () => ipcRenderer.invoke('kai:ui:get'),
    set: (patch) => ipcRenderer.invoke('kai:ui:set', patch),
  },

  onLines: (cb) => subscribe('kai:lines', cb),
  onStatus: (cb) => subscribe('kai:status', cb),
  onCleared: (cb) => subscribe('kai:cleared', cb),
  onApps: (cb) => subscribe('kai:apps', cb),
  onSettings: (cb) => subscribe('kai:settings', cb),
};

contextBridge.exposeInMainWorld('kai', api);
