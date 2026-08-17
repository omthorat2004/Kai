'use strict';

/**
 * Process manager for Kai.
 *
 * Deliberately free of any `electron` import so it can be exercised by plain
 * node in test/pm-test.js.
 *
 * Responsibilities:
 *  - spawn a command through a login shell so GUI-launched apps get the user's PATH
 *  - split chunked stdout/stderr into whole lines
 *  - keep a capped ring buffer of lines per app
 *  - kill the whole process tree, not just the shell
 */

const { spawn, EventEmitter } = (() => ({
  spawn: require('child_process').spawn,
  EventEmitter: require('events').EventEmitter,
}))();

const MAX_LINES = 5000;
const FLUSH_MS = 40;
const FLUSH_MAX_PENDING = 250;
const SIGKILL_DELAY_MS = 5000;

/** Shell invocation for the current platform. */
function shellFor(command) {
  if (process.platform === 'win32') {
    // /d skip AutoRun, /s quoting rules, /c run then exit.
    return { file: process.env.COMSPEC || 'cmd.exe', args: ['/d', '/s', '/c', command] };
  }
  // A *login* shell: a double-clicked .app inherits launchd's environment, not
  // the one from .zprofile/.zshrc, so npm/node/nvm would otherwise be missing.
  const sh = process.env.SHELL && process.env.SHELL.includes('bash') ? 'bash' : 'zsh';
  return { file: sh, args: ['-lc', command] };
}

class ProcessManager extends EventEmitter {
  constructor({ maxLines = MAX_LINES } = {}) {
    super();
    this.maxLines = maxLines;
    /** @type {Map<string, object>} */
    this.entries = new Map();
  }

  entry(id) {
    let e = this.entries.get(id);
    if (!e) {
      e = {
        id,
        child: null,
        pid: null,
        status: 'stopped', // stopped | starting | running | exited | error
        exitCode: null,
        signal: null,
        startedAt: null,
        ring: [],
        seq: 0,
        pending: [],
        flushTimer: null,
        partial: { stdout: '', stderr: '' },
        killTimer: null,
      };
      this.entries.set(id, e);
    }
    return e;
  }

  // ---------------------------------------------------------------- logging

  _push(e, stream, text) {
    const line = { seq: ++e.seq, stream, text, ts: Date.now() };
    e.ring.push(line);
    if (e.ring.length > this.maxLines) {
      e.ring.splice(0, e.ring.length - this.maxLines);
    }
    e.pending.push(line);
    if (e.pending.length >= FLUSH_MAX_PENDING) this._flush(e);
    else if (!e.flushTimer) {
      e.flushTimer = setTimeout(() => this._flush(e), FLUSH_MS);
    }
  }

  _flush(e) {
    if (e.flushTimer) {
      clearTimeout(e.flushTimer);
      e.flushTimer = null;
    }
    if (!e.pending.length) return;
    const lines = e.pending;
    e.pending = [];
    this.emit('lines', { id: e.id, lines });
  }

  /**
   * Feed a raw chunk. `data` events hand us Buffers on arbitrary boundaries:
   * one chunk can hold many lines, or half of one. Keep the incomplete tail.
   */
  _ingest(e, stream, chunk) {
    const buf = e.partial[stream] + chunk.toString('utf8');
    const parts = buf.split('\n');
    e.partial[stream] = parts.pop(); // trailing fragment, possibly ''
    for (const part of parts) {
      // Progress bars rewrite a line with \r; keep only the final state.
      const cleaned = part.includes('\r') ? part.split('\r').pop() : part;
      this._push(e, stream, cleaned);
    }
  }

  _flushPartials(e) {
    for (const stream of ['stdout', 'stderr']) {
      const tail = e.partial[stream];
      if (tail) {
        e.partial[stream] = '';
        this._push(e, stream, tail);
      }
    }
  }

  // ------------------------------------------------------------- lifecycle

  _setStatus(e, patch) {
    Object.assign(e, patch);
    this.emit('status', this.statusOf(e.id));
  }

  statusOf(id) {
    const e = this.entries.get(id);
    if (!e) return { id, status: 'stopped', exitCode: null, signal: null, pid: null };
    return {
      id,
      status: e.status,
      exitCode: e.exitCode,
      signal: e.signal,
      pid: e.pid,
      startedAt: e.startedAt,
    };
  }

  statuses() {
    return [...this.entries.keys()].map((id) => this.statusOf(id));
  }

  isRunning(id) {
    const e = this.entries.get(id);
    return !!(e && e.child && (e.status === 'running' || e.status === 'starting'));
  }

  runningIds() {
    return [...this.entries.keys()].filter((id) => this.isRunning(id));
  }

  /**
   * @param {{id:string,name?:string,cwd:string,command:string,env?:Record<string,string>}} cfg
   */
  start(cfg) {
    const e = this.entry(cfg.id);
    if (this.isRunning(cfg.id)) return this.statusOf(cfg.id);

    e.partial.stdout = '';
    e.partial.stderr = '';
    e.exitCode = null;
    e.signal = null;

    const { file, args } = shellFor(cfg.command);
    const env = {
      ...process.env,
      ...(cfg.env || {}),
      FORCE_COLOR: '1',
      // Many CLIs check these before emitting colour.
      CLICOLOR_FORCE: '1',
      TERM: process.env.TERM || 'xterm-256color',
    };

    this._push(e, 'system', `$ ${cfg.command}`);
    this._push(e, 'system', `  cwd: ${cfg.cwd}`);

    let child;
    try {
      child = spawn(file, args, {
        cwd: cfg.cwd,
        env,
        // Unix: own process group, so we can signal the whole tree by -pid.
        detached: process.platform !== 'win32',
        windowsHide: true, // no flashing console window on Windows
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (err) {
      this._push(e, 'system', `spawn failed: ${err.message}`);
      this._setStatus(e, { status: 'error', child: null, pid: null });
      this._flush(e);
      return this.statusOf(cfg.id);
    }

    e.child = child;
    e.pid = child.pid;
    e.startedAt = Date.now();
    this._setStatus(e, { status: 'running' });

    child.stdout.on('data', (c) => this._ingest(e, 'stdout', c));
    child.stderr.on('data', (c) => this._ingest(e, 'stderr', c));

    // An unhandled 'error' event on a ChildProcess throws and takes the main
    // process down with it. Surface it in the app's own log instead.
    child.on('error', (err) => {
      this._push(e, 'system', `process error: ${err.message}`);
      this._flushPartials(e);
      if (e.killTimer) clearTimeout(e.killTimer);
      e.killTimer = null;
      this._setStatus(e, { status: 'error', child: null, pid: null });
      this._flush(e);
    });

    child.on('exit', (code, signal) => {
      this._flushPartials(e);
      this._push(
        e,
        'system',
        signal ? `— exited on ${signal} —` : `— exited with code ${code} —`
      );
      if (e.killTimer) clearTimeout(e.killTimer);
      e.killTimer = null;
      this._setStatus(e, {
        status: 'exited',
        exitCode: code,
        signal: signal || null,
        child: null,
        pid: null,
      });
      this._flush(e);
    });

    this._flush(e);
    return this.statusOf(cfg.id);
  }

  /**
   * Kill the process tree. `child.kill()` alone only reaps the shell and
   * orphans the dev server, leaving the port bound.
   * @returns {Promise<void>} resolves when the child has actually exited
   */
  stop(id) {
    const e = this.entries.get(id);
    if (!e || !e.child) return Promise.resolve();
    const child = e.child;
    const pid = e.pid;

    const done = new Promise((resolve) => {
      if (child.exitCode !== null || child.signalCode !== null) return resolve();
      child.once('exit', () => resolve());
      child.once('error', () => resolve());
    });

    this._setStatus(e, { status: 'stopping' });

    if (process.platform === 'win32') {
      // /T whole tree, /F force.
      const tk = spawn('taskkill', ['/PID', String(pid), '/T', '/F'], {
        windowsHide: true,
        stdio: 'ignore',
      });
      tk.on('error', (err) => this._push(e, 'system', `taskkill failed: ${err.message}`));
    } else {
      try {
        process.kill(-pid, 'SIGTERM'); // negative pid = the whole group
      } catch (err) {
        if (err.code !== 'ESRCH') this._push(e, 'system', `SIGTERM failed: ${err.message}`);
      }
      e.killTimer = setTimeout(() => {
        try {
          process.kill(-pid, 'SIGKILL');
          this._push(e, 'system', '— escalated to SIGKILL —');
          this._flush(e);
        } catch (_) {
          /* already gone */
        }
      }, SIGKILL_DELAY_MS);
    }

    return done;
  }

  stopAll() {
    return Promise.all(this.runningIds().map((id) => this.stop(id))).then(() => undefined);
  }

  /** Best-effort synchronous teardown for app quit. */
  killAllNow() {
    for (const id of this.runningIds()) {
      const e = this.entries.get(id);
      if (!e || !e.pid) continue;
      try {
        if (process.platform === 'win32') {
          require('child_process').execFileSync('taskkill', [
            '/PID', String(e.pid), '/T', '/F',
          ], { windowsHide: true, stdio: 'ignore' });
        } else {
          process.kill(-e.pid, 'SIGKILL');
        }
      } catch (_) {
        /* ignore */
      }
    }
  }

  // ------------------------------------------------------------------ logs

  getLog(id) {
    const e = this.entries.get(id);
    return e ? e.ring.slice() : [];
  }

  clearLog(id) {
    const e = this.entry(id);
    e.ring = [];
    this.emit('cleared', { id });
  }

  forget(id) {
    const e = this.entries.get(id);
    if (!e) return;
    if (e.flushTimer) clearTimeout(e.flushTimer);
    if (e.killTimer) clearTimeout(e.killTimer);
    this.entries.delete(id);
  }
}

module.exports = { ProcessManager, shellFor, MAX_LINES };
