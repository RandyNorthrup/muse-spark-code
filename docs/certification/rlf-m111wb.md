# RLF-M111WB — M111 lane WB, the workbench shell (D91.12 and 13)

Updated 2026-10-30 (lane RLF-M111WB on linuxlt, base int/recovery dfcb45936).

## What is done

- **Bridge contracts** (`src/shared/desktop/bridge.ts`): every desktop IPC
  frame as a zod schema — workspace, layout get/set, file list/read/write,
  status publish, terminal create/write/resize/close/data/exit, window and
  external opens — plus the `MuseDesktopBridge` surface the preload exposes.
- **Workbench logic** (`src/shared/desktop/workbench.ts`): workspace keys
  (one window per workspace, `/`-normalised, case-folded on Windows/macOS),
  layout storage keys per workspace and per compositor workspace, the
  terminal placement moves (detached is floating, D91.13), status ordering
  for SH1's bar, quick-open ranking, the deny-all-but-sanitised-clipboard
  permission policy and the http/https/mailto external rule.
- **Keybinding registry** (`src/shared/desktop/keybindings.ts`): VS Code's
  keymap for the workbench commands, chord normalisation and event
  conversion, conflict refusal by name, and the labels the rail reads. The
  two text-input handlers dispatch through the panel registry's new
  `desktop.quickOpen` / `desktop.terminal` contexts
  (`src/shared/keybindings.ts`), so no handler owns a key literal.
- **Electron app** (`desktop/app/`): single-instance main process with one
  window per workspace, sandboxed renderer (context isolation, no Node
  integration, no `<webview>`), permission handler, navigation and
  window-open guards, confined workspace files, credential-stripped
  terminal sessions, atomic layout and status-snapshot stores, and the
  frozen schema-checking preload. Setup mode opens the folder picker when
  no workspace is named (first boot). Electron 45.0.0 and
  `@electron/fuses` 2.1.3 are pinned exactly (45.2.0 is newer upstream but
  inside `.npmrc`'s 7-day `min-release-age` window on 2026-10-30).
- **Workbench layout** (`src/webview/desktop/`): chat region on the left,
  editor group in the centre with the terminal panel below it and the
  tabbed footer (Terminal / Problems / Output) at the same width, the rail
  (with always-visible key labels) and sidebar on the right, quick open
  (Ctrl+P), layout persistence per workspace, status items published to
  SH1's bar over the bridge (written as the ordered snapshot SH1 reads),
  and system-scheme following through `data-ms-theme`. Only `--ms-*`
  tokens paint it. ED mounts CodeMirror into the editor region, SB1 the
  sidebar sections and BP xterm.js into the panel; WB's regions and state
  machine are theirs to fill.
- **Build**: `npm run build:desktop` (also in `npm run build`), budgets in
  `scripts/check-bundle-size.mjs` (new bundles at measured +15% rounded to
  25 KiB, D6), and `npm run package:desktop`, which assembles a runnable
  app folder from the pinned Electron download and flips the fuses (RunAsNode
  off, cookie encryption on, NodeOptions and CLI inspect off, no extra
  file-protocol privileges). Signing, asar and the installer stay with
  M111i/IM.

## Proof

- Unit suites (repository timeouts, real code only):
  `test/unit/desktop/workbench.test.ts` (9 tests: workspace keys incl.
  Windows separators, layout refusal, placement moves, status ordering,
  quick-open ranking, permission and external rules, registry conflicts)
  and `test/unit/desktop/shell.test.ts` (5 tests: real files confined to
  the root, real layout persistence across store instances, the status
  snapshot file, credential stripping, a real shell streaming output and
  exit 0), beside lane 0's `contracts.test.ts`.
- Real Electron smoke (`test/desktop/electron-smoke.mjs`, Xvfb on linuxlt):
  the built app opened the smoke workspace, the renderer published
  `workbench.workspace` and `workbench.terminals` through the bridge, and
  a second launch for the same workspace handed off to the single
  instance and exited. Result: PASS (2026-10-30).
- Local look (real Electron via CDP, no comparison): light and dark
  captures are `rlf-m111wb-workbench-light.png` and
  `rlf-m111wb-workbench-dark.png` beside this record. The look found and
  fixed a body margin frame, an unthemed terminal input and clipped rail
  key labels.
- Fuses read back from the packaged binary: RunAsNode off, cookie
  encryption on, NodeOptions off, CLI inspect off.

## Red/green drills (2026-10-30)

1. Removed the Windows/macOS case fold from `workspaceKey` and added
   `media` to the allowed permissions: `workbench.test.ts` failed 2 of 9
   (window-per-workspace keys, permission policy). Restored byte-identical:
   9 of 9 passed.
2. The checks fired again on purpose during development: `check:l10n`
   refused the first string pass (missing keys, wrong plural forms, English
   cognates) and `check:reference` refused direct `event.key` dispatch in
   DesktopApp until both inputs went through the keyboard registry.

## Gates (2026-10-30, linuxlt; exit 0 unless named)

- `npm run typecheck` (all seven projects incl. new `typecheck:desktop`): 0.
- eslint `--max-warnings 0` and prettier `--check` on every touched file: 0.
- `node scripts/check-l10n.mjs`: 0 problems. `npm run check:reference`
  (after `reference:generate`): current. `npm run check:host-api`: 0
  problems. `npm run check:plan`: 0 drift. `npm run check:roadmap`:
  current. `npm run check:catches`: baseline matched (new catches are
  NARROW). `npm run duplication`: 0 clones. `npm run cycles`: none.
  `npm run deadcode` (knip): no errors (pre-existing hints only).
- `npm run build`: green end to end (tokens, production bundles incl.
  desktop, bundle size/split, lazy registry, host globals, notices,
  legal records).
- Suites: desktop (19 tests), keybindings/reference neighbours
  (keybindingsReportSource, nodeKeybindings, historyBookmarkKey,
  browserKeybindings, reportForwardAdmission, chatReference,
  ciReference, cliReference) all pass standalone.
- `npx vitest related` over the five shared sources (the constants graph,
  1160 files): 70 tests failed in 22 files, **exit 1, reported as such**.
  Every failing file was re-run on the untouched base (dfcb45936) in a
  detached worktree: identical failure counts on both trees
  (connector/devices/storage/kernel-boundary suites fail in this rig
  sandbox — loopback, storage and supervisor limits — plus the
  date-pinned catalogue test; `runtimeLsp`'s three are 240 s supervisor
  timeouts and its base-worktree run cannot collect). No WB regression:
  the failing set does not intersect WB's files, and two harness files
  failing only under mega-run load skip cleanly standalone on both trees.
  Hosted CI remains the judge for those suites.

## What is next (not WB)

- SH1 consumes the status snapshot on its layer-shell bar; ED, SB1 and BP
  fill the editor, sidebar and terminal surfaces; ST1 owns the appearance
  override that replaces system-scheme following.
- Desktop bundles carry the full English table through `constants.ts`'s
  `UI_TEXT` re-export (main 892.9 KiB, renderer 1112.0 KiB measured).
  Regionalising desktop text like the Node bundles' uiText regions is
  TH/J follow-up work; the budgets record the measured sizes honestly.
- The terminal engine behind the bridge is pipe-backed; BP's xterm.js
  surface and a PTY are BP's lane, on the same bridge channels.
