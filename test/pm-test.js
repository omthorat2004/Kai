'use strict';
// Headless verification of electron/process-manager.js.
//   node test/pm-test.js
const path = require('path');
const { ProcessManager } = require('../electron/process-manager');

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const alive = (pid) => {
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
};

(async () => {
  const pm = new ProcessManager();
  const seen = [];
  const statuses = [];
  pm.on('lines', ({ lines }) => seen.push(...lines));
  pm.on('status', (s) => statuses.push(s.status));

  const root = path.join(__dirname, '..');

  // ---- 1. spawn + streaming -------------------------------------------
  pm.start({
    id: 'fake',
    cwd: root,
    command: `node ${JSON.stringify(path.join(root, 'test', 'fake-server.js'))}`,
    env: { KAI_TEST_VAR: 'hello-from-config' },
  });
  await sleep(1200);

  const text = (s) => seen.filter((l) => l.stream === s).map((l) => l.text);
  const out = text('stdout');
  const err = text('stderr');

  check('status went running', pm.statusOf('fake').status === 'running');
  check('stdout streamed', out.length > 5, `${out.length} lines`);
  check('custom env var reached child', out.includes('ENV_CHECK=hello-from-config'));
  check('FORCE_COLOR=1 set in child env', out.includes('FORCE_COLOR=1'));
  check('cwd honoured', out.includes(`CWD=${root}`));

  // ---- 2. chunk splitting ---------------------------------------------
  check('mid-line chunk rejoined (A)', out.includes('PARTIAL_A_CONTINUED'));
  check('mid-line chunk rejoined across ticks (B)', out.includes('PARTIAL_B_CONTINUED'));
  check('multi-line chunk split', out.includes('MULTI_1') && out.includes('MULTI_2'));
  check('no line contains a newline', !seen.some((l) => l.text.includes('\n')));
  check('carriage-return progress collapsed', out.includes('prog 100%') && !out.includes('prog 10%'));

  // ---- 3. stderr separation + ANSI preserved for the renderer ---------
  check('stderr tagged separately', err.some((l) => l.includes('ERR boom')));
  check('ANSI escapes preserved in payload', out.some((l) => l.includes('[32m')));

  // ---- 4. seq monotonic (ring-buffer / dedupe contract) ---------------
  let mono = true;
  for (let i = 1; i < seen.length; i++) if (seen[i].seq <= seen[i - 1].seq) mono = false;
  check('seq strictly increasing', mono);

  // ---- 5. tree kill ----------------------------------------------------
  const gcLine = out.find((l) => l.startsWith('GRANDCHILD_PID='));
  const gcPid = gcLine && Number(gcLine.split('=')[1]);
  check('grandchild pid captured', !!gcPid, String(gcPid));
  check('grandchild alive before stop', alive(gcPid));

  const shellPid = pm.statusOf('fake').pid;
  await pm.stop('fake');
  await sleep(400);

  check('shell dead after stop', !alive(shellPid));
  check('grandchild reaped with the tree (no orphan)', !alive(gcPid));
  check('status became exited', pm.statusOf('fake').status === 'exited');
  check('exit line logged', pm.getLog('fake').some((l) => l.text.includes('exited')));

  // ---- 6. spawn failure is surfaced, not fatal -------------------------
  pm.start({ id: 'bad', cwd: '/definitely/not/a/real/path', command: 'echo hi' });
  await sleep(600);
  const badLog = pm.getLog('bad').map((l) => l.text).join('\n');
  check(
    'bad cwd surfaced in that app log, process survived',
    ['error', 'exited'].includes(pm.statusOf('bad').status),
    pm.statusOf('bad').status
  );
  check('failure detail present in log', /error|exited|ENOENT|no such/i.test(badLog));

  // ---- 7. ring buffer cap ---------------------------------------------
  const small = new ProcessManager({ maxLines: 50 });
  small.start({ id: 'flood', cwd: root, command: 'seq 1 500' });
  await sleep(1500);
  const ring = small.getLog('flood');
  check('ring buffer capped', ring.length <= 50, `${ring.length} lines`);
  check('oldest dropped, newest kept', ring.some((l) => l.text === '500'));
  await small.stopAll();

  // ---- 8. clear --------------------------------------------------------
  pm.clearLog('fake');
  check('clearLog empties the buffer', pm.getLog('fake').length === 0);

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  process.exit(failed.length ? 1 : 0);
})();
