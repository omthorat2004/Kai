'use strict';

/**
 * Fires scheduled start/stop actions at their appointed time.
 *
 * Deliberately free of any `electron` import, like process-manager.js, so it
 * can be driven by plain node with a fake store in tests.
 *
 * setTimeout only fires reliably up to ~24.8 days and does not survive the
 * machine sleeping through the target time, so a periodic sweep is the
 * source of truth; the per-schedule timer just makes the common case (an
 * awake machine, a schedule minutes or hours out) fire promptly.
 */

const MAX_TIMEOUT_MS = 2_147_000_000; // under the signed 32-bit ms cap
const SWEEP_MS = 30_000;

class Scheduler {
  /**
   * @param {object} store - the electron-store wrapper from store.js
   * @param {(schedule: object) => Promise<void>} onFire - run the action
   */
  constructor({ store, onFire }) {
    this.store = store;
    this.onFire = onFire;
    /** @type {Map<string, NodeJS.Timeout>} */
    this.timers = new Map();
    this.sweepTimer = null;
    this.firing = new Set();
  }

  start() {
    for (const s of this.store.listSchedules()) {
      if (s.status === 'pending') this._arm(s);
    }
    if (!this.sweepTimer) this.sweepTimer = setInterval(() => this._sweep(), SWEEP_MS);
  }

  stop() {
    for (const t of this.timers.values()) clearTimeout(t);
    this.timers.clear();
    if (this.sweepTimer) clearInterval(this.sweepTimer);
    this.sweepTimer = null;
  }

  add(schedule) {
    this._arm(schedule);
  }

  cancel(id) {
    this._disarm(id);
    if (this.store.getSchedule(id)?.status === 'pending') {
      this.store.updateSchedule(id, { status: 'cancelled' });
    }
  }

  // ------------------------------------------------------------- internals

  _arm(schedule) {
    this._disarm(schedule.id);
    const delay = Math.min(Math.max(0, schedule.at - Date.now()), MAX_TIMEOUT_MS);
    const timer = setTimeout(() => this._maybeFire(schedule.id), delay);
    // A setTimeout keeps node alive; that is fine here, main.js already
    // holds the process open. In tests, callers unref() is not needed
    // because the process exits on its own once the assertions finish.
    this.timers.set(schedule.id, timer);
  }

  _disarm(id) {
    const t = this.timers.get(id);
    if (t) clearTimeout(t);
    this.timers.delete(id);
  }

  _sweep() {
    const now = Date.now();
    for (const s of this.store.listSchedules()) {
      if (s.status !== 'pending') continue;
      if (s.at <= now) this._maybeFire(s.id);
      else if (!this.timers.has(s.id)) this._arm(s); // re-arm after a >24.8-day wait
    }
  }

  async _maybeFire(id) {
    this._disarm(id);
    if (this.firing.has(id)) return;
    const s = this.store.getSchedule(id);
    if (!s || s.status !== 'pending') return;
    if (s.at > Date.now()) return this._arm(s); // sweep fired early, re-check

    this.firing.add(id);
    try {
      await this.onFire(s);
      this.store.updateSchedule(id, { status: 'done', firedAt: Date.now() });
    } catch (err) {
      this.store.updateSchedule(id, { status: 'failed', firedAt: Date.now(), error: err.message });
    } finally {
      this.firing.delete(id);
    }
  }
}

module.exports = { Scheduler };
