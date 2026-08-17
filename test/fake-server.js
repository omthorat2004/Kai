'use strict';
// A stand-in dev server used by test/pm-test.js.
// It exercises the awkward parts: ANSI colour, chunk boundaries that fall in
// the middle of a line, stderr, env vars, and a grandchild process that must
// die with the tree.

const { spawn } = require('child_process');
const ESC = String.fromCharCode(27);

// Grandchild: survives a naive child.kill(), must not survive a group kill.
const grandchild = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
  stdio: 'ignore',
});
process.stdout.write(`GRANDCHILD_PID=${grandchild.pid}\n`);

process.stdout.write(`ENV_CHECK=${process.env.KAI_TEST_VAR || 'unset'}\n`);
process.stdout.write(`FORCE_COLOR=${process.env.FORCE_COLOR || 'unset'}\n`);
process.stdout.write(`CWD=${process.cwd()}\n`);

// Two writes that form one line: split mid-line on purpose.
process.stdout.write('PARTIAL_A');
process.stdout.write('_CONTINUED\n');

process.stdout.write(`${ESC}[32mgreen ready${ESC}[0m\n`);
process.stderr.write(`${ESC}[31mERR boom${ESC}[0m\n`);

// Two lines in one chunk.
process.stdout.write('MULTI_1\nMULTI_2\n');

// Progress-bar style carriage returns collapse to the final state.
process.stdout.write('prog 10%\rprog 50%\rprog 100%\n');

// A fragment left dangling across event-loop ticks, completed later.
process.stdout.write('PARTIAL_B');
setTimeout(() => process.stdout.write('_CONTINUED\n'), 120);

setInterval(() => process.stdout.write(`tick ${Date.now()}\n`), 250);
