# RLF-M111BP — M111 lane BP, the bottom panel (D91.13 and its amendment)

Updated 2026-10-31 (lane RLF-M111BP on linuxlt, base rec/rlf-m111wb).

Base: lane WB (the Electron workbench, its D91.13 layout with the terminal
panel and tabbed footer, the desktop bridge). BP builds into WB's layout
slots and bridge; never a second layout.

## What is done

- **Dependencies** (D3 records in PLAN.md §2): `@xterm/addon-webgl`
  0.19.0, `@xterm/addon-search` 0.16.0, `@xterm/addon-web-links` 0.12.0,
  `@xterm/addon-unicode11` 0.9.0 (all MIT, no deps, no peers, published
  2025-12-22) and `node-pty` 1.1.0 (MIT, published 2026-10-23, the version
  `scripts/package-node-image.mjs` already expects). All dev-only: no VSIX
  metafile lists them; the desktop installer's notices travel with M111i's
  build. `node-pty`'s binding compiled from source at install; a probe
  spawn of `/bin/bash -c 'echo pty-ok; exit 3'` streamed `pty-ok` and
  reported exit code 3. Canonical `security:audit` exits 0 with them in
  the tree.
- **Design decisions** (this record is the working note until the lane
  lands; PLAN's M111 section carries the final status):
  - The PTY lives in `desktop/app/terminals.ts` (WB's module) on the same
    bridge channels — no new spawn path. D90's "node-pty lives only in
    the tool host" keeps it out of the node _service_ process; the
    desktop's main process is the local tool host, running as the person
    with `*_API_KEY` stripped from every child's environment.
  - The persisted layout moves v1 → v2 (WB's v1 migrates): per-tab slots
    (dock, floating window, footer), split trees, pin state, the panel
    view and floating bounds join WB's placement and sizes.
  - Problems renders M68's diagnostic shapes (`DiagnosticEntry`), Output
    renders channel logs; both are real stores and surfaces fed over new
    bridge channels. Their suppliers (ED's check runs, WS's dev servers,
    task runners) are later lanes' surfaces; until one publishes, the
    empty states are the honest ones.
  - Agents' tabs carry the agent label, command and run id, are read-only
    in the surface and in the session (H13), and stop through the same
    close channel. The Live-peek deep link is SB2's surface; the tab
    already carries the run id it will key on.

## What is next

Gates.

## Red/green drills (2026-11-01)

1. Served `.mjs` from the app scheme: `appScheme.test.ts` failed 1
   of 4 (unserved extensions). Restored byte-identical: 4 of 4 pass.
2. Dropped the `release()` call from the terminal registry:
   `terminalRegistry.test.ts` failed 1 of 2 (release counting).
   Restored byte-identical: 2 of 2 pass.
3. The panel proof fired for real three times during development:
   the chunk-failure alert on the missing `allowProposedApi` flag,
   the permanent loading state on React `use()` suspension (rebuilt
   as the explicit loader), and the shell-output wait on insertText
   keys the helper textarea never kept (now per-character key
   events). Each fix went in with the assertion that caught it.
4. The bundle-size drill runs with the build gate below (the new
   budgets fail on purpose, then pass).

## Landed: real-Electron proof, look, renderer fixes (2026-11-01)

- `test/desktop/electron-panel.mjs`: the packaged app under Xvfb,
  driven through CDP. PASS (2026-11-01, linuxlt): the window renders
  on `muse-desktop://app/`; startup fetches no engine chunk (read off
  the Network domain — resource timing stays empty in this window);
  New terminal loads `renderer.terminalEngine.js`, its stylesheet
  (link sheet loaded) and the screen-reader tree; the WebGL renderer
  is live (canvas present; `--enable-unsafe-swiftshader` stands in
  for the rig's missing GPU, without it the product honestly falls
  back to canvas); per-character keys reach `bash -i` and
  `bp-proof-7147` streams back through the bridge (printf's format
  keeps the input echo from containing it); `exit` lands the exited
  tab, exit code 0 and the exit sentence; split panes render side by
  side, collapse and expand round-trip the footer (shells remount
  with their transcripts), detach and dock round-trip the floating
  window, pin toggles and restores; Problems and Output show their
  honest empty states; the status snapshot carries the workbench
  items. Every phase has its own bound (60–180 s; a shared rig
  answers slowly) and says which phase failed with the page's state.
  The kept shots show the split panes (the envman read-only noise in
  them is the rig's sandboxed HOME in the shells' own startup).
- The look found and fixed three real defects: (1) xterm's Unicode
  11 addon needs `allowProposedApi` (the pane showed the chunk
  failure until the flag landed); (2) the CSP blocked xterm's
  dynamic inline styles, so style-src allows `'unsafe-inline'`
  (script-src stays `'self'`, the renderer stays sandboxed, no
  remote or model content renders as HTML); (3) xterm.css paints
  the viewport black, so panel.css overrules it with
  `--ms-code-surface` (the fractional row below the last full row).
- The shell loads the engine behind an explicit loading state with
  its own retry (the same loading/failure DOM as before): React
  `use()` suspended the pane flakily (0.5–120 s, sometimes never)
  while a manual import resolved at once, so the suspense boundary
  in BottomPanel is gone with it.
- Local look (real Electron via CDP, no comparison): light and dark
  captures are `rlf-m111bp-panel-light.png` and
  `rlf-m111bp-panel-dark.png` beside this record.
- No WB regression: `test/desktop/electron-smoke.mjs` still PASSes
  on the dev path (status items, single-instance handoff).

## Landed: PTY staging for Electron (2026-11-01)

- `scripts/stage-desktop-pty.mjs` (`npm run stage:desktop-pty`):
  compiles the pinned node-pty sources against the pinned Electron's
  headers into `prebuilds/<platform>-<arch>/`, which node-pty's own
  loader finds after its Node-ABI copy. Into the packaged app by
  default (`npm run package:desktop` runs it; a stamp skips a current
  stage), or `--dev` into the checkout's node-pty for dev runs.
  node-gyp resolves from `--node-gyp`, PATH, or npm's bundled copy;
  `--devdir`/`npm_config_devdir` aims its headers cache (rig lanes
  keep it in `temp/`); one compile, no retries, past ten minutes it
  stops and says so.
- Proved (linuxlt, Xvfb): `require` of the staged module, spawn of
  `/bin/echo`, `DATA:e-pty-ok` streamed, `EXIT:0` reported — under
  real Electron 45 (Node v24.22.0, modules 150). spawn-helper is
  macOS-only in binding.gyp; Linux stages the binding alone.
  Electron's download and node-gyp's headers cache both honour
  worktree-temp overrides (`electron_config_cache`,
  `npm_config_devdir`); Electron runs here with
  `ELECTRON_DISABLE_SANDBOX=1` (the rig note WB recorded) and needs X
  even for `--run-as-node`.

## Landed: lazy engine chunk, app scheme, native loader (2026-11-01)

- The xterm engine is a chunk-pure lazy file
  (`dist/desktop/renderer.terminalEngine.js`, 532.3 KiB): it imports
  nothing the startup chunk shares — bridge calls, sentences, sizes and
  registry entries arrive through acquire hooks from the shell, which
  rides the startup chunk and loads the engine through `use()` (the
  pane keeps its Suspense loading fallback and retry boundary).
  `renderer.js` (1163.4 KiB) carries no xterm; the shared helpers are
  0.6 KiB. New budgets measured +15% to the next 25 KiB (D6): 625 /
  25 / 25; WB's four caps unchanged and green.
- The window serves itself over its own privileged same-origin scheme
  (`muse-desktop://app/`, `desktop/app/scheme.ts` + `main.ts`): module
  chunks cannot load over file://. Only the app host answers, only
  .html/.js/.css from inside the app folder; anything else is denied
  (403) or missing (404); reads past missing-file are fixed words on
  stderr with a 500. `index.html` loads the renderer as a module.
- node-pty stays external to `main.mjs` and loads lazily per window
  through a spawn-shape guard: a dev run answers from the checkout's
  copy, the packaged app from the staged Electron-ABI copy, and a
  machine without either still starts. Terminal-create failures are
  fixed words on both sides (main's stderr, the panel's sentence):
  the native loader's paths reach neither.
- Suites: new `appScheme.test.ts` (4: serve/deny/MIME) and
  `terminalRegistry.test.ts` (2); panel (15), panelSessions (8),
  panelStores (3), panelView (3), shell + workbench neighbours green;
  webview/desktop/unit typechecks clean, eslint/prettier clean.

## Landed: renderer chrome and workbench wiring (2026-10-31)

- `src/webview/desktop/panel/`: `terminalEngine.ts` (persistent
  emulators: the emulator outlives its React shell, so a dragged tab
  keeps its transcript; bridge subscriptions, exit sentence, theme and
  the find listener live with the engine), `TerminalView.tsx` (the shell:
  host attach, find bar on `desktop.terminalSearch`), `ProblemsView.tsx`,
  `OutputView.tsx`, `problemsFormat.ts`, `BottomPanel.tsx` (docked panel,
  floating window, footer strip, exit dialog) and `panel.css`.
- `DesktopApp.tsx` owns the panel state (tabs with exit codes, Problems,
  Output, the exit question, create errors), the subscriptions, all panel
  actions and the pending-focus queue. The global dispatcher now honours
  each binding's `when` from focus-region tracking; runCommand covers the
  new split/detach/dock/collapse/pin/resize/search/focus/kill commands.
- `desktop.terminal` (WB's textarea submit) and
  `referenceDesktopTerminalKeys` are retired; the reference now documents
  `desktop.terminalSearch`, `desktop.problems`, `desktop.panelTabs`
  (arrows + Ctrl+Up/Down slot moves) and `desktop.panelResize`, with
  `referenceDesktopTerminalSearchKeys`, `referenceDesktopProblemsKeys`
  and `referenceDesktopPanelTabsKeys` in all 15 tables.
- New strings since the strings landing, all x15: `panelFindCase`,
  `panelFindWord`, `panelFindRegex`, `panelCloseConfirm`, `panelOnTop`,
  `panelSash`, `panelNoTerminals`.
- Model additions: `resizeSplitSizes`, `applyOutputAppend`,
  `floatingBoundsFromRect` (`panel.ts`), `floatingOnTop` on layout v2,
  generic `tabsInSlot`/`moveTabToSlot`/`nextTerminalAfterClose`; agent
  sessions run their command through the shell (`-c`/`/c`) and carry the
  agent label as their title.
- Splits render in the dock and in the floated full window (never in a
  detached-only window); panes resize by pointer and arrow keys;
  separator and floating window resize by pointer and
  `desktop.panelResize` keys; unpinned blur collapses (skipped while the
  exit dialog asks); the floated window drags, keeps on top, and shares
  one bounds rect with the detached window (they never co-exist).
- Verified: webview/desktop/root typechecks clean, eslint clean on
  touched files, `check:l10n` 0 problems, `check:reference` current;
  panel (15), panelSessions (8), panelStores (3) and panelView (3)
  suites green, including the new resize/append/bounds/agent-spawn
  cases; `vitest related` 43 + 5 files green (389 + 41 tests).

## Landed: strings (2026-10-31)

35 new strings in English and all 14 tables (`check:l10n` 0 problems):
the panel's labels, toolbar, find widget, exit question, Problems and
Output labels, the region/dialog/resize names, terminal loading and
failure sentences, the exited-tab label, the severity group, and
`referenceDesktopResizeKeys`. Three genuine cognates allowed in
`untranslated.json` (de/fr information, es error). WB's
`desktop.terminal` context and `referenceDesktopTerminalKeys` stay until
the renderer rewrite retires the textarea: removing the key regenerates
the reference schema, which needs the new contexts' handlers first.

## Landed: shared model, bridge, PTY sessions, stores (2026-10-31)

- `src/shared/desktop/panel.ts`: tabs with dock/window/footer slots,
  split trees with size renormalization, the read-only rule for agents'
  tabs, the exit-confirm rule, keyboard-resize clamps, Problems badge
  counts, the Output clip both sides apply.
- `src/shared/desktop/bridge.ts`: the persisted layout's version 2 with
  v1 migration, split/floating/tab-slot shapes, agent-tab shapes,
  Problems/Output shapes, and the new channels (list, children, opened,
  problems get/changed, output get/clear/appended/cleared).
- `src/shared/desktop/keybindings.ts`: split (Ctrl+Shift+5, VS Code's),
  detach (Ctrl+Alt+D), collapse, panel taller/shorter, terminal search
  (Ctrl+F, terminal focus only), kill/dock/pin/focus-Problems/focus-Output
  registered for the launcher; the chord reader prefers `code` (Shift+5
  reports `%` in `key`, so VS Code's digit chords only match through
  `code`); the dispatcher honours `when`.
- `desktop/app/terminals.ts`: WB's pipe spawn replaced by node-pty on the
  same interface and bridge channels; resize applies; read-only sessions
  refuse writes (H13); credential stripping kept. Probed: resize after
  exit throws `ioctl(2) failed, EBADF` (NARROW catch), write and kill
  after exit are silent no-ops.
- `desktop/app/processTree.ts`: the exit question's probe — pgrep on
  Unix, CIM on Windows, unknown answers ask.
- `desktop/app/problems.ts`, `desktop/app/output.ts`: main-side stores
  (M68 shapes, 200-entry bound, 1 MiB per channel oldest-first with
  surrogate-safe clip, overlong names/chunks refused by name).
- `desktop/app/main.ts`, `preload.ts`, `layoutStore.ts`, `files.ts`:
  channel wiring, workspace-confined cwd, v1→v2 migration on load.
- Suites: `panel.test.ts` (12), `panelSessions.test.ts` (7, real PTY:
  resize via stty, read-only refusal vs echo, child probe, close kills
  the command, credential stripping end to end, headless render of
  captured bytes), `panelStores.test.ts` (3). WB's `shell`/`workbench`
  suites migrated to the new shapes, same assertions.

## Proof

- `node-pty` probe (2026-10-31, linuxlt): real `/bin/bash` through the
  compiled binding, output and exit code observed (above).
- Canonical `security:audit`: exit 0 (2026-10-31).
