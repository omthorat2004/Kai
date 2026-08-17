// Renderer-side mirror of the main-process ring buffers.
//
// Every window subscribes to the log stream for *all* apps, not just the
// visible one, so switching tabs never loses output that arrived while you
// were looking elsewhere.

const MAX_LINES = 5000;

/** @type {Map<string, Array>} */
const buffers = new Map();
/** @type {Map<string, number>} */
const lastSeq = new Map();
const loaded = new Set();
const listeners = new Set();

const emptyList = Object.freeze([]);

function notify() {
  for (const fn of listeners) fn();
}

function append(id, incoming) {
  if (!incoming || !incoming.length) return;
  const current = buffers.get(id) || emptyList;
  const seen = lastSeq.get(id) ?? 0;
  const fresh = incoming.filter((l) => l.seq > seen);
  if (!fresh.length) return;
  let next = current.concat(fresh);
  if (next.length > MAX_LINES) next = next.slice(next.length - MAX_LINES);
  buffers.set(id, next);
  lastSeq.set(id, fresh[fresh.length - 1].seq);
  notify();
}

// Wire the push channels once, at module load.
if (typeof window !== 'undefined' && window.kai) {
  window.kai.onLines(({ id, lines }) => append(id, lines));
  window.kai.onCleared(({ id }) => {
    buffers.set(id, emptyList);
    notify();
  });
}

export const logStore = {
  subscribe(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },

  /** Stable reference between changes, as useSyncExternalStore requires. */
  get(id) {
    return buffers.get(id) || emptyList;
  },

  /** Pull the authoritative snapshot from main the first time we show an app. */
  async ensureLoaded(id) {
    if (!id || loaded.has(id)) return;
    loaded.add(id);
    const snapshot = await window.kai.logs.get(id);
    const live = buffers.get(id) || emptyList;
    const lastSnapshotSeq = snapshot.length ? snapshot[snapshot.length - 1].seq : 0;
    // Anything that streamed in while the snapshot was in flight is kept.
    let merged = snapshot.concat(live.filter((l) => l.seq > lastSnapshotSeq));
    if (merged.length > MAX_LINES) merged = merged.slice(merged.length - MAX_LINES);
    buffers.set(id, merged);
    if (merged.length) lastSeq.set(id, merged[merged.length - 1].seq);
    notify();
  },

  async clear(id) {
    await window.kai.logs.clear(id);
    buffers.set(id, emptyList);
    notify();
  },

  forget(id) {
    buffers.delete(id);
    lastSeq.delete(id);
    loaded.delete(id);
    notify();
  },
};

export { MAX_LINES };
