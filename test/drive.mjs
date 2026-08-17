// End-to-end drive of the real Kai window via Playwright's Electron support.
//   npm run build:renderer && node test/drive.mjs
//
// It adds an app through the UI, starts it, reads the log pane, detaches the
// log window, stops the app, then relaunches to prove persistence and that
// nothing survived the quit.
import { _electron as electron } from 'playwright-core';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const APP_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SHOTS = process.env.SCREENSHOT_DIR || path.join(APP_DIR, 'shots');
fs.mkdirSync(SHOTS, { recursive: true });

const ELECTRON_BIN =
  process.platform === 'darwin'
    ? path.join(APP_DIR, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron')
    : path.join(APP_DIR, 'node_modules/electron/dist/electron');

// Use a throwaway userData dir so the run never touches a real config,
// but keep it stable across the two launches to test persistence.
const USER_DATA = path.join(APP_DIR, '.e2e-userdata');

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const alive = (pid) => {
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
};

async function launch() {
  const app = await electron.launch({
    executablePath: ELECTRON_BIN,
    args: [APP_DIR, `--user-data-dir=${USER_DATA}`],
    timeout: 30_000,
  });
  const page = await app.firstWindow();
  await page.waitForSelector('.app', { timeout: 15_000 });
  return { app, page };
}

const fill = (page, label, value) =>
  page.evaluate(
    ([lbl, val]) => {
      const field = [...document.querySelectorAll('.modal label')].find((l) =>
        l.querySelector('span')?.textContent.startsWith(lbl)
      );
      const input = field?.querySelector('input');
      if (!input) return 'NOT_FOUND';
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(input, val);
      input.dispatchEvent(new Event('input', { bubbles: true }));
      return 'OK';
    },
    [label, value]
  );

const clickText = (page, text) =>
  page.evaluate((t) => {
    const el = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === t);
    if (!el) return 'NOT_FOUND';
    el.click();
    return 'OK';
  }, text);

(async () => {
  fs.rmSync(USER_DATA, { recursive: true, force: true });

  // ------------------------------------------------ first launch, add an app
  let { app, page } = await launch();
  check('window opened', true, (await page.title()) || 'Kai');
  await page.screenshot({ path: path.join(SHOTS, '01-empty.png') });

  check('starts with no saved apps', (await page.locator('.app-card').count()) === 0);

  await clickText(page, 'Add your first app');
  await page.waitForSelector('.modal', { timeout: 5000 });

  await fill(page, 'Name', 'Fake dev server');
  await fill(page, 'Project folder', APP_DIR);
  await fill(page, 'Command', 'node test/fake-server.js');
  // env row: first key/value pair in the env block
  await page.evaluate(() => {
    const rows = document.querySelectorAll('.env-row input');
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(rows[0], 'KAI_TEST_VAR');
    rows[0].dispatchEvent(new Event('input', { bubbles: true }));
    setter.call(rows[1], 'from-the-ui');
    rows[1].dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.screenshot({ path: path.join(SHOTS, '02-form.png') });
  await clickText(page, 'Save');
  await page.waitForSelector('.app-card', { timeout: 5000 });
  check('app saved and listed', (await page.locator('.app-card').count()) === 1);

  // ---------------------------------------------------------------- start it
  await clickText(page, 'Start');
  await page.waitForFunction(() => document.querySelectorAll('.log-row').length > 4, null, {
    timeout: 15_000,
  });
  await sleep(1200);
  await page.screenshot({ path: path.join(SHOTS, '03-running.png') });

  const status = await page.locator('.app-status').innerText();
  check('status shows running with a pid', /running/.test(status) && /pid \d+/.test(status), status);

  const paneText = await page.locator('.log-scroll').innerText();
  check('stdout rendered in the pane', paneText.includes('green ready'));
  check('env var from the UI reached the child', paneText.includes('ENV_CHECK=from-the-ui'));
  check('no raw escape sequences on screen', !paneText.includes('[32m') && !paneText.includes(''));

  const stderrRows = await page.locator('.log-row.log-stderr').count();
  check('stderr rows styled separately', stderrRows > 0, `${stderrRows} rows`);

  const colouredGreen = await page.evaluate(() => {
    const row = [...document.querySelectorAll('.log-row')].find((r) => r.innerText.includes('green ready'));
    if (!row) return null;
    const span = [...row.querySelectorAll('span')].find((s) => s.innerText.includes('green ready'));
    return span ? getComputedStyle(span).color : null;
  });
  check('ANSI colour applied to the span', colouredGreen === 'rgb(152, 195, 121)', String(colouredGreen));

  // ------------------------------------------------------------ auto scroll
  // Wait until output actually overflows the pane, otherwise there is nothing
  // to scroll and the probes below are vacuous.
  await page.waitForFunction(
    () => {
      const el = document.querySelector('.log-scroll');
      return el && el.scrollHeight > el.clientHeight + 40;
    },
    null,
    { timeout: 40_000 }
  );
  check('log pane becomes a real scroll container once output overflows', true);

  const scrollProbe = await page.evaluate(async () => {
    const el = document.querySelector('.log-scroll');
    el.scrollTop = 0;                                     // scroll up to read
    el.dispatchEvent(new Event('scroll', { bubbles: true }));
    const before = el.scrollTop;
    await new Promise((r) => setTimeout(r, 1500));        // new output arrives
    return { before, after: el.scrollTop, height: el.scrollHeight };
  });
  check(
    'scrolled up: new output does not yank the view down',
    scrollProbe.after === scrollProbe.before,
    `top ${scrollProbe.before} -> ${scrollProbe.after}`
  );

  const stuck = await page.evaluate(async () => {
    const el = document.querySelector('.log-scroll');
    el.scrollTop = el.scrollHeight;                        // back to the bottom
    el.dispatchEvent(new Event('scroll', { bubbles: true }));
    const first = el.scrollTop;
    await new Promise((r) => setTimeout(r, 1500));
    return { first, then: el.scrollTop };
  });
  check('at the bottom: auto-scroll follows new output', stuck.then > stuck.first,
    `${stuck.first} -> ${stuck.then}`);

  // ------------------------------------------------------- detached window
  await clickText(page, 'Detach');
  await sleep(1500);
  const windows = app.windows().filter((w) => !w.url().startsWith('devtools://'));
  check('detached log window opened', windows.length === 2, `${windows.length} windows`);
  const logWin = windows.find((w) => w.url().includes('logs='));
  if (logWin) {
    await logWin.waitForSelector('.log-row', { timeout: 8000 });
    const detachedRows = await logWin.locator('.log-row').count();
    check('detached window shows the same log stream', detachedRows > 4, `${detachedRows} rows`);
    await logWin.screenshot({ path: path.join(SHOTS, '04-detached.png') });
    await logWin.evaluate(() => window.close());
  } else {
    check('detached window shows the same log stream', false, 'window not found');
  }

  // ------------------------------------------------- background accumulation
  // Read through the log API rather than the DOM: the list is virtualised, so
  // only the visible slice of rows exists on the page.
  const readGrandchildPid = () =>
    page.evaluate(async () => {
      const [app] = await window.kai.apps.list();
      const lines = await window.kai.logs.get(app.id);
      const hit = [...lines].reverse().find((l) => l.text.includes('GRANDCHILD_PID='));
      return hit ? Number(hit.text.split('=')[1]) : null;
    });

  const grandchildPid = await readGrandchildPid();
  check('grandchild pid visible in the pane', !!grandchildPid, String(grandchildPid));

  // ------------------------------------------------------------------ stop
  await clickText(page, 'Stop');
  await page.waitForFunction(() => /exited/.test(document.querySelector('.app-status')?.innerText || ''), null, {
    timeout: 10_000,
  });
  const stoppedStatus = await page.locator('.app-status').innerText();
  check('status shows exited with a code or signal', /exited \(/.test(stoppedStatus), stoppedStatus);
  check('tree killed: grandchild gone after Stop', !alive(grandchildPid));
  await page.screenshot({ path: path.join(SHOTS, '05-stopped.png') });

  // --------------------------------------------- restart, then quit the app
  await clickText(page, 'Start');
  await page.waitForFunction(
    () => /running/.test(document.querySelector('.app-status')?.innerText || ''),
    null,
    { timeout: 10_000 }
  );
  await sleep(600);
  const secondRunPid = await readGrandchildPid();
  check(
    'restarts cleanly after exit',
    !!secondRunPid && secondRunPid !== grandchildPid && alive(secondRunPid),
    `pid ${secondRunPid}`
  );

  await app.close();
  await sleep(2500);
  check('quit killed the running child tree', !alive(secondRunPid), `pid ${secondRunPid}`);

  // -------------------------------------------------- relaunch: persistence
  ({ app, page } = await launch());
  await page.waitForSelector('.app-card', { timeout: 8000 });
  const persisted = await page.evaluate(() => {
    const card = document.querySelector('.app-card');
    return {
      name: card.querySelector('.app-name').innerText,
      cmd: card.querySelector('.app-cmd').innerText,
      status: card.querySelector('.app-status').innerText,
    };
  });
  check('app survived a restart', persisted.name === 'Fake dev server', JSON.stringify(persisted));
  check('command persisted', persisted.cmd === 'node test/fake-server.js');
  check('fresh session starts stopped', /stopped/.test(persisted.status), persisted.status);

  const envPersisted = await page.evaluate(async () => {
    const list = await window.kai.apps.list();
    return list[0].env;
  });
  check('env vars persisted', envPersisted.KAI_TEST_VAR === 'from-the-ui', JSON.stringify(envPersisted));

  // ------------------------- groups of sub-applications + the global folder
  const testDir = path.join(APP_DIR, 'test');
  await page.evaluate(async (dir) => {
    await window.kai.settings.set({ globalCwd: dir });
    const [first] = await window.kai.apps.list();
    // Put the existing app into a group, then add a second sub-application
    // with no folder of its own: it must run in the global folder.
    await window.kai.apps.save({ ...first, group: 'Acme monorepo' });
    await window.kai.apps.save({
      name: 'Global command',
      group: 'Acme monorepo',
      cwd: '',
      command: 'node fake-server.js',
    });
  }, testDir);

  await page.waitForFunction(() => document.querySelectorAll('.app-card').length === 2, null, { timeout: 5000 });
  const groupHeads = await page.locator('.group-head').count();
  check('sub-applications collapse into one group', groupHeads === 1, `${groupHeads} group heading(s)`);
  const groupName = await page.locator('.group-name').innerText();
  check('group is named', groupName === 'ACME MONOREPO', groupName);

  const globalShown = await page.evaluate(() =>
    [...document.querySelectorAll('.app-cwd')].map((e) => e.innerText).find((t) => t.includes('global'))
  );
  check('app with no folder shows the global folder', !!globalShown, globalShown);

  // Start the whole application (every sub-application at once).
  await page.evaluate(() => {
    const head = document.querySelector('.group-head');
    [...head.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Start').click();
  });
  await page.waitForFunction(
    () => [...document.querySelectorAll('.app-status')].filter((e) => /running/.test(e.innerText)).length === 2,
    null,
    { timeout: 15_000 }
  );
  check('group start ran every sub-application', true, '2 running');
  await page.screenshot({ path: path.join(SHOTS, '07-group-running.png') });

  await sleep(900);
  const globalCwdLine = await page.evaluate(async () => {
    const apps = await window.kai.apps.list();
    const global = apps.find((a) => !a.cwd);
    const lines = await window.kai.logs.get(global.id);
    return (lines.find((l) => l.text.startsWith('CWD=')) || {}).text;
  });
  check('global command ran in the global folder', globalCwdLine === `CWD=${testDir}`, String(globalCwdLine));

  // Stopping one sub-application must not touch its siblings.
  await page.evaluate(() => {
    const card = [...document.querySelectorAll('.app-card')].find((c) =>
      c.querySelector('.app-name').innerText === 'Global command'
    );
    [...card.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Stop').click();
  });
  await sleep(2000);
  const mixed = await page.evaluate(() =>
    [...document.querySelectorAll('.app-card')].map((c) => ({
      name: c.querySelector('.app-name').innerText,
      status: c.querySelector('.app-status').innerText,
    }))
  );
  const sibling = mixed.find((m) => m.name === 'Fake dev server');
  const stopped = mixed.find((m) => m.name === 'Global command');
  check(
    'stopping one sub-application leaves its siblings running',
    /running/.test(sibling.status) && /exited/.test(stopped.status),
    JSON.stringify(mixed)
  );

  await page.evaluate(() => {
    const head = document.querySelector('.group-head');
    [...head.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Stop').click();
  });
  await page.waitForFunction(
    () => [...document.querySelectorAll('.app-status')].every((e) => !/running/.test(e.innerText)),
    null,
    { timeout: 15_000 }
  );
  check('group stop stopped everything', true);

  // Renderer isolation: the sandbox must not leak node into the page.
  const isolation = await page.evaluate(() => ({
    require: typeof window.require,
    process: typeof window.process,
    ipcRenderer: typeof window.ipcRenderer,
    kai: typeof window.kai,
  }));
  check(
    'renderer has no node access, only window.kai',
    isolation.require === 'undefined' &&
      isolation.process === 'undefined' &&
      isolation.ipcRenderer === 'undefined' &&
      isolation.kai === 'object',
    JSON.stringify(isolation)
  );

  await page.screenshot({ path: path.join(SHOTS, '06-persisted.png') });
  await app.close();

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  console.log(`screenshots: ${SHOTS}`);
  process.exit(failed.length ? 1 : 0);
})().catch((err) => {
  console.error('DRIVER ERROR:', err);
  process.exit(1);
});
