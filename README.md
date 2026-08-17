# Kai

A personal dev-server launcher for macOS and Windows. Save your projects once,
then start them with one click instead of opening a terminal and typing the same
command again.

Built with Electron, React and Vite. No component library, plain CSS.

## What it does

- Save a list of apps: name, project folder, command, optional env vars, optional autostart
- Group sub-applications under one application, and start or stop the whole group
- Global folder for commands not tied to a project: leave the folder empty and the
  command runs there
- Start and stop each app from a single button, with live status: stopped, running, exited(code)
- Live stdout and stderr in a log pane, with ANSI colour rendered rather than printed raw
- Logs keep accumulating for every running app in the background, not only the visible one
- Detach any app's logs into their own window, for a second monitor
- Start all and Stop all
- Native folder picker for the project folder
- Config persists across restarts via electron-store

## Download

Grab the latest build from the
[releases page](https://github.com/omthorat2004/Kai/releases/latest).

- Apple Silicon: `Kai-<version>-arm64.dmg`
- Intel Mac: `Kai-<version>-x64.dmg`

Open the dmg and drag Kai to Applications.

**First launch on macOS.** These builds are not signed with an Apple Developer
ID, so Gatekeeper will refuse the first open with a warning that the app cannot
be checked for malicious software. Right-click the app and choose **Open**, then
confirm. You only do this once. If macOS insists the app is damaged, clear the
quarantine flag:

```bash
xattr -dr com.apple.quarantine /Applications/Kai.app
```

## Updating

Kai checks the GitHub releases feed a few seconds after launch and shows a bar
at the top when a newer version exists. There is also a **Check for updates**
button in the status bar. Both open the release page so you can download the new
dmg and replace the app.

Updates are notify-only on purpose. Silent in-place updates on macOS require the
app to be signed and notarised with an Apple Developer ID, and Squirrel refuses
to update an unsigned build. Once this app has a signing certificate, swap
`electron/updater.js` for `electron-updater` and the same release feed keeps
working unchanged.

Your saved apps live in `~/Library/Application Support/Kai/kai.json`, outside the
app bundle, so replacing the app never loses your configuration.

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

Output lands in `release/`. The mac target builds both arm64 and x64 dmgs.
Windows installers must be built on Windows, or in a Windows CI runner. Add your
own icons at `build/icon.icns` and `build/icon.ico` to replace the Electron
defaults.

To cut a new release: bump `version` in `package.json`, build, then upload the
artifacts and the installed copies will see the update on their next launch.

```bash
npm version patch
npm run build:mac
gh release create "v$(node -p "require('./package.json').version")" \
  release/*.dmg --title "Kai $(node -p "require('./package.json').version")" \
  --notes "What changed"
```

## Adding an app

1. Press **Add app**
2. Name it, **Browse** to the project folder, type the command, for example `npm run dev`
3. Optionally put it under an **Application**, so several sub-applications
   (web, api, worker) group together and can be started as one
4. Optionally add env vars as key/value rows, applied on top of the inherited environment
5. Optionally tick autostart
6. Save, then press **Start**

Leave the project folder empty for a global command. It then runs in the global
folder, which you set from the **Global folder** button in the title bar. It
defaults to your home directory.

Each group heading has its own Start and Stop, and each entry keeps its own
Start and Stop, so you can run the whole application or just one piece of it.

## Tests

Two suites, both headless:

```bash
npm test          # process manager: spawning, line splitting, tree kill
npm run test:e2e  # drives the real window with Playwright
```

`npm run test:e2e` builds the renderer, launches the actual app against a
throwaway config directory, adds an app through the form, starts it, reads the
log pane, detaches the log window, stops it, quits, and relaunches to confirm
persistence. Screenshots land in `shots/`.

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
