# RLM88: M88 bookmarks and prompt sequences — 2026-10-22

Worktree `/Users/user/lanes/RLM88`, branch `rec/rlm88`, rig `macbook`.
Base: main at 0.19.0 (`0cab9f323`). Lanes 0, P, A, B, W per PLAN.md
D67 (M88 rows only; timed sends are M115's). No live model calls, no
paid calls: zero requests of any tier.

## What landed

| Lane     | Commit      | Work                                                                                                                      |
| -------- | ----------- | ------------------------------------------------------------------------------------------------------------------------- |
| 0        | `788aa0319` | Sequence + bookmark strings in `en.ts`, all 14 tables, manifest strings                                                   |
| P        | `9a1fd145e` | Protocol messages, `uiState` cases, feature ports, deferred send, state sync, Alt+B keybinding, controller bookmark cases |
| A        | `68e90940b` | Sequence state machine, `SequenceStore`, `SequenceRunner`, controller wiring, `/sequences` palette, dialogs               |
| B        | `e52a245ad` | `BookmarkStore`, History paging to the bookmark, sessions Bookmarked group, History/Header stars, retention exemption     |
| W        | `11cc0bfe1` | Extension wiring, App overlays, feature catalog, reference, README/CHANGELOG/PLAN/PRIVACY                                 |
| scenes   | `73b1ababf` | Harness axe scenes: sequences, sequences-narrow, sequences-run, history-bookmarked                                        |
| docs     | `d11abc2ba` | PLAN §6 status, roadmap, host-api record                                                                                  |
| dedup    | `bb078a200` | `LibraryFiles` engine shared by both stores; dialog stylesheet shared; panel rig helpers shared; 0 clones                 |
| host-api | `f9178a67a` | Host-api record after the engine split                                                                                    |
| envelope | `172c56c11` | Bookmark envelope names `BOOKMARK_SCHEMA_VERSION` (was dead)                                                              |
| timeouts | `30a6cf7cd` | Named long timeouts for the 1002-session paging suite                                                                     |
| snapshot | `dd757a9ca` | Slash snapshot names `/sequences`                                                                                         |

The prompt and sequence libraries sit on one engine,
`src/core/prompts/libraryFiles.ts` (folder walk, scan, write lock,
atomic commit); `PromptStore` and `SequenceStore` keep their exact
public APIs. The prompt suites (damage, bounds, stale-write,
connector) pass unchanged against the façade.

## Red/green drills

Each drill breaks the production code on purpose, shows the red exit,
restores the file with `git checkout`, and shows green. Repository
timeouts throughout; `npx vitest run <file> --maxWorkers=3`.

1. Bookmark damage guard. Plant: `readOwn` in
   `src/core/prompts/bookmarkStore.ts` returns an empty list for a
   damaged list instead of throwing `bookmarksUnavailable`.
   Red: exit 1, `1 failed | 8 passed (9)` —
   `reports a damaged list, keeps it as found, and serves the other
workspaces`. Green after restore: exit 0, `9 passed (9)`.
2. Retention skip. Plant: the sweep in
   `src/host/backend/fileSessionStore.ts` keeps the session when
   `isRetained` answers false (`=== true` to `=== false`), so a
   retained session is swept. Red: exit 1, `2 failed | 10 passed
(12)` — `keeps a retained session past its idle period, then
takes it when released` and `never asks about a session young
enough to keep`. Green after restore: exit 0, `12 passed (12)`.
3. Alt+B binding. Plant: `history.bookmark` in
   `src/shared/keybindings.ts` binds `KeyX` instead of `KeyB`.
   Red: exit 1, `2 failed | 2 passed (4)` — `toggles on Alt+B by
code` and `still toggles when macOS turns Option+B into ∫`.
   Green after restore: exit 0, `4 passed (4)`.

## Alt+B keymap (three OSes)

Plain Alt+B (`KeyB`) is free on all three OSes: a source audit of
`vscode@818341a41f` (2026-10-22) finds no plain Alt+B in the default
keybindings, the menubar mnemonics, or the 96 built-in extensions'
manifests (94 fetched raw; `types` 404s, `yaml` contributes no
bindings), and the shipped bundle plus installed extensions confirm.
The shortcut PDFs were abandoned as evidence (cheatsheets with
kern-split extraction). `historyBookmarkKey.test.ts` pins the binding
in code; the drill above breaks and restores it.

## Axe pages

BLOCKED on this rig: the sandbox refuses to execute Chrome
(`Operation not permitted`), and the lane builds no shims or
workarounds per the sandbox rule. The four scenes
(`sequences`, `sequences-narrow`, `sequences-run`,
`history-bookmarked`) are committed with ready selectors; the lead
runs `scripts/a11y.mjs` outside the sandbox.

## Gates

| Gate                              | Exit | Note                                                                                         |
| --------------------------------- | ---- | -------------------------------------------------------------------------------------------- |
| prettier --check (touched)        | 0    |                                                                                              |
| eslint --max-warnings 0 (touched) | 0    |                                                                                              |
| typecheck                         | 0    | all projects                                                                                 |
| check-l10n                        | 0    | 14 UI + 14 usage tables, 266 manifest strings, 0 problems                                    |
| check:reference                   | 0    | 85 features, 65 commands, 102 settings, 33 slash, 305 CLI                                    |
| check:host-api                    | 0    | after the sanctioned `--write` regen (import counts moved)                                   |
| check:plan                        | 0    |                                                                                              |
| check:roadmap                     | 0    |                                                                                              |
| check:catches                     | 0    | baseline match                                                                               |
| duplication                       | 0    | 0 clones (was 18; shared engine, stylesheet, helpers)                                        |
| cycles                            | 0    |                                                                                              |
| deadcode                          | 0    | after wiring the dead `BOOKMARK_SCHEMA_VERSION`; config/tag hints remain, non-failing        |
| build                             | 0    | sequences 7.1/25 KiB, extension 432.3/600 KiB                                                |
| related A (prompts core)          | 1    | 2299 pass; 8 fail, all pre-existing/environmental (below)                                    |
| related B (host)                  | 1    | 480 pass; 6 fail, all pre-existing/environmental                                             |
| related C (webview)               | 0    | 778/778                                                                                      |
| related D (shared)                | 1    | 21959 pass; 104 fail: 1 mine (slash snapshot — fixed, 49/49), 103 pre-existing/environmental |
| related E (generated)             | 1    | 1408 pass; 17 fail, estimator git-env (known)                                                |
| axe pages                         | —    | BLOCKED: sandbox refuses Chrome; lead runs outside                                           |

Touched suites, all green: sequenceStore (9), promptDamage (3),
promptBoundsRemoved (3), promptStoreStaleWrite, sequencePanel (7),
connectorServe, bookmarkStore (9), bookmarkPanel, bookmarkHistoryPaging
(2), sessionPaging (7), deferredSend, resumeFailureSend, sessionDelete
(12), sequencesDialog, historyDialog, headerBookmark, stateSync,
historyBookmarkKey (4), sessions, promptSequence (7),
paletteRegistry (49).

Related failures that are not this lane's (each proven on the base
worktree at `0cab9f323` or by its error text): `scheduleFireFailures`
and `schedulePauseAfterFailures` (5 s timeouts; base varies 1→4 on
identical runs), `crashMarker` (PID timing; fails on base),
`pathGuardRound4` + `pathGuard` (Xcode git exec blocked; fail on
base), `pluginImport` (fails on base), `treeSyncNoDeadline` (fails on
base), every `nativeGit*`/`git*`/`estimator*`/`worktreeCommands`/
`reportProductionTransport`/`teamWorkspaceRefs`/`nativeProcessDefaults`/
`reviewCollector` failure (missing xcodebuild or blocked git spawn),
`evalFreezeLayout` (passes with `DEVELOPER_DIR` set to the CLT),
`macRss` + `reviewMaterialProbes` (`spawn EPERM`),
`resourceCreatedSweep` (native helper binary never built here),
`vsixCompression` (pinned zopfli package not installed),
`treesLifecycleNative` (clang blocked).

Vault suites (`test/unit/vault/**`) were pulled in by `related`
through `constants`/`protocol` imports; that collides with the
recovery rule against running them on owner machines, and the lead
should exempt them from the related gate or land RLVAULTANCHOR. No
writes reached the real store: every would-be writer refused at
acquisition (`refused/busy`, unknown OS birth), `fileAnchor` uses
temp files with random ids, and everything that passed is pure
logic, UI text, or socket-path assertions.
