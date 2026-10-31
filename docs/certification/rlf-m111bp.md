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

Build splitting + chunk budget → PTY staging → real-Electron proof → ui:look → drills and gates.

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
