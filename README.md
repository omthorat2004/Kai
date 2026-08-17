# Kai

A personal dev-server launcher for macOS and Windows. Save your projects once,
then start them with one click instead of opening a terminal and typing the same
command again.

Built with Electron, React and Vite. No component library, plain CSS.

## What it does

- Save a list of apps: name, project folder, command, optional env vars, optional autostart
- Start and stop each app from a single button, with live status: stopped, running, exited(code)
- Live stdout and stderr in a log pane, with ANSI colour rendered rather than printed raw
- Logs keep accumulating for every running app in the background, not only the visible one
- Detach any app's logs into their own window, for a second monitor
- Start all and Stop all
- Native folder picker for the project folder
- Config persists across restarts via electron-store

## Setup

Requires Node 18 or newer.

```bash
git clone https://github.com/omthorat2004/Kai.git
cd Kai
npm install
npm run dev
```

`npm run dev` starts Vite on port 5173 and opens Electron pointed at it, with
hot reload for the renderer.

To run the production renderer build inside Electron without packaging:

```bash
npm start
```

## Packaging

```bash
npm run build:mac   # dmg
npm run build:win   # nsis installer
npm run build       # current platform
```

Output lands in `release/`. Windows installers must be built on Windows, or in a
Windows CI runner. Add your own icons at `build/icon.icns` and `build/icon.ico`
to replace the Electron defaults.

## Tests

```bash
npm test
```

Runs a headless suite against the process manager: chunk splitting, env
handling, ring-buffer cap, spawn-failure handling, and process-tree kill
(it spawns a grandchild process and asserts it does not survive a stop).

## Adding an app

1. Press **Add app**
2. Name it, **Browse** to the project folder, type the command, for example `npm run dev`
3. Optionally add env vars as key/value rows, applied on top of the inherited environment
4. Optionally tick autostart
5. Save, then press **Start**

## Notes on how the process handling works

These are the parts that are easy to get wrong, and what Kai does about them.

**PATH on macOS.** A double-clicked `.app` inherits launchd's environment, not
your login shell's, so `npm` and `node` are simply missing. Kai spawns every
command through a login shell (`zsh -lc` or `bash -lc`, `cmd /d /s /c` on
Windows) so your `.zprofile`, nvm, Homebrew paths and so on all apply.

**Process trees.** `child.kill()` kills the shell and orphans the dev server,
leaving the port bound. On Unix, Kai spawns with `detached: true` so the child
leads its own process group, then signals the whole group with
`process.kill(-pid, 'SIGTERM')`, escalating to `SIGKILL` after 5 seconds. On
Windows it uses `taskkill /PID <pid> /T /F`.

**Chunked output.** `data` events give you Buffers on arbitrary boundaries: one
chunk can hold several lines or half a line. Kai buffers per stream, splits on
newline, and keeps the incomplete tail for the next chunk. Carriage-return
progress bars collapse to their final state.

**Quit.** `before-quit` stops every running child before the app exits, with a
forced kill as backstop, so nothing survives closing Kai.

**Spawn failures.** An unhandled `error` event on a child process takes the main
process down. Kai handles it and prints the message into that app's log pane.

**Colour.** Children run with `FORCE_COLOR=1`, and the log view parses ANSI SGR
codes into styled spans. Non-colour escape sequences are stripped, never printed.

**Log volume.** Ring buffer of 5000 lines per app in the main process, mirrored
in the renderer. The log list is virtualised, so a full buffer still scrolls
smoothly. Auto-scroll engages only when you are already at the bottom, so
scrolling up to read never yanks you back down.

## Security posture

`contextIsolation: true`, `nodeIntegration: false`. The renderer has no
`ipcRenderer` and no node access. Everything goes through a narrow API exposed
on `window.kai` by the preload script, and a strict CSP is injected into the
packaged build.

Kai runs the commands you save, with your privileges. Treat it like your
terminal: only save commands you would run yourself.

## Layout

```
electron/
  main.js             windows, IPC, app lifecycle, quit cleanup
  preload.js          the contextBridge surface, the only main/renderer link
  process-manager.js  spawn, line splitting, ring buffers, tree kill (no electron import)
  store.js            electron-store persistence
src/
  App.jsx             main window: app list, controls
  LogWindow.jsx       detached log window
  logStore.js         renderer log mirror, shared by both window types
  ansi.js             ANSI SGR parser
  components/         LogPane, AppForm
test/
  pm-test.js          headless process-manager suite
  fake-server.js      test fixture that misbehaves on purpose
docs/
  index.html          GitHub Pages landing page
```

## License

MIT
