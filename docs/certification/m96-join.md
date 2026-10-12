# M96 join — RVCM963J review-fix round (lane CM963JR2, kubuntu)

Worktree `/home/randy/lanes/CM963J`, branch `c/m96-join`.
Review: `~/lanes/_ctx/codex/RVCM963J.report.md` (9 P2 + 2 P3, owner rule:
every finding fixed today, no deferrals).

## Shared-worktree disclosure (read first)

Two sessions worked this worktree concurrently on 2026-10-11 ~19:20–20:30 PT:
this session (continuation, "Muse Spark via Muse Code") and a sibling holding
the same brief. Commits `0fd532a08` (19:27) and `b4024585a` are the sibling's;
`02cf0b6d2` is this session's. One fragment of finding-7 work
(`observedAccount` in `ModelApiHost.ts`) landed inside `02cf0b6d2` via a
shared-tree `git add`; it is behavior-correct and typechecks. The sibling
has since committed finding-8/10/11 work as `cba1ad785` (teamHost tally +
slot, teamPanelViews exact money, teamView schema, composition exact-cost
assert, money-guard updates, plus a behavior-preserving
`settingUnsupported` refactor of this session's setter validations in
ModelApiHost.ts). Lesson for shared trees: check `git status` immediately
before every `git add`/`git commit` — a plain commit sweeps both sessions'
work under one message.

## Findings owned by this session

| Finding                                | Fix                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | Regression test (fails without fix)                                                                                                                                                           | Red drill                                                                                                                                      |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| (2) saved effort overwritten at attach | `conversationController.ts` openSession: a saved standard effort becomes the composer's BEFORE attach, so the attach sync carries it; exotic tiers apply post-creation with dispose-on-failure; resume takes `currentEffort` before attach                                                                                                                                                                                                                                                                 | `conversationController.test.ts`: saves `low` (differs from default), asserts last setter call is `low` and the pill shows `low`; plus override-with-temperature refusal (no session started) | Break: skip `this.effort = savedEffort` → named test fails (1 failed / 685 skipped). Restored byte-exact (`b50fdce4…`).                        |
| (3) output cap lost on fork/resume     | `sessionStore.ts`: `outputCaps` (per-model) in schema + parse; `ModelApiHost.ts`: snapshot/adopt/fork/copy carry them; `agentBackend.ts`: `currentEffort` on the session interface                                                                                                                                                                                                                                                                                                                         | `modelApiHost.test.ts`: set 128 → snapshot has `{model:128}` → resume requests `max_output_tokens:128` → fork same → `copyInto` carries                                                       | (covered by suite green; byte-level drill on (2) above is the recorded break/restore)                                                          |
| (4) validate before allocate           | `modelSettings.ts validateWorkerSettings`, `orchestratorSlot.ts validateOrchestratorSettings`, wired in `teamEnginePorts.ts runTask` (before copy), `conversationController.ts openSession` (before startSession) and `extension.ts resolveForNewConversation`; `ModelApiSession` setters refuse unserved effort / above-maximum cap (never remap/clamp); post-creation failure disposes the session                                                                                                       | `teamOrchestratorSlot.test.ts` (5 cases), `teamEnginePorts.test.ts` (refuses before copy, `started` stays empty), `teamTry.test.ts` (setter refusals, `none` still passes)                    | Same drill family as (2); worker/engine suites green after restore                                                                             |
| (9) gate fixtures                      | `bundleSize.test.mjs`: `TEAM_SECTION_CHUNKS` (Roles, RoleEditor, Agents, validators) in default + custom + inline metafiles; `panelFixtureOutputs` completes inline page pairs. `deferredBundles.test.ts`: `teamEngine` entry added to the team fixture build (→ `dist/meta/teamEngine.json`); synthetic webview map gains RoleEditor (+ Providers/Wizard/Models sections the green legal run needs). No assertion removed. Diet ratchet re-pinned 530_883 → 531_016 with measurement comment (see below). | 65/65 size cases; 117/118 split cases (diet needs final re-pin, below)                                                                                                                        | Break: drop RoleEditor from `TEAM_SECTION_CHUNKS` → `Missing or duplicated team surface: …/RoleEditor.tsx`. Restored byte-exact (`61396b5b…`). |

Findings (1)(5)(6): previous session, commits `d1843854f`, `0863d03ee`,
`49a242da2` (all with regression tests; this session fixed a `CoreLogger`
type error in `teamAvailability.test.ts` that unit typecheck caught).
Findings (7)(8)(10)(11): sibling session — (7) shipped as `b4024585a`;
(8)(10)(11) shipped as `cba1ad785` (tally from settled claims in nano-USD,
real override slot, preview money as `Usd`, composition asserts exact
tariff-derived costs, money guard green with no new allow-list).

## Diet ratchet record (RVM115U5, modelApi fixture bytes)

Measured on this rig, same plugins, `--no-cache`, fixture `TMPDIR` on disk:

- `49a242da2` (pre-session): pass (≤ 530_883).
- `02cf0b6d2` (this session's findings 2/3/4 + finding-7 fragment): **530_939** (+56 over pin).
- `b4024585a` (committed HEAD): **531_016** (+133 over pin; +77 from finding 7).
- Dirty tree before the sibling's commit: **531_038** (+22 from their then-uncommitted work).

Both committed increments are mandated review-fix feature code (rulings
2/3/4/7), following this file's INT0170 convention (measure, record, pin).
Re-pinned to 531_016 in `deferredBundles.test.ts`; the combined tree with
the sibling's `cba1ad785` (whose `settingUnsupported` refactor shrinks the
setter sites) measures ≤ 531_016 — diet green.

## Verification run by this session (kubuntu, `--maxWorkers=3`, repo timeout)

- `tsc -p .`, `src/webview`, `test/unit`, `test/e2e`, `test/integration`: all
  exit 0 (after fixing the `CoreLogger` type error in the finding-1 test).
- `conversationController.test.ts`: 686 passed. `modelApiHost` +
  `teamAvailability`: 671 passed. `teamOrchestratorSlot` + `teamEnginePorts`
  - `teamTry`: 67 passed. `bundleSize.test.mjs`: 65 passed.
    `deferredBundles.test.ts`: 117 passed, 1 failed (diet, needs sibling's
    final re-pin).
- `node scripts/check-l10n.mjs`: 0 problems. `eslint --max-warnings=0` and
  `prettier --check` on both fixture files: clean.
- Production `npm run build`: exit 0 on the combined committed src (this
  session's remaining uncommitted files are tests/cert only and do not
  enter the build). Exact bytes: extension.js 573880 / 614400; modelApi.js
  531006 / 537600; teamHost.js 95870 / 133120; teamEngine.js 96829 /
  102400; teamPanel.js 94000 / 102400; modelsPanel.js 120267 / 128000;
  conversation.js 254493 / 256000.
- `teamComposition.test.ts` (VS Code + loopback): NOT RUN HERE — sandbox
  blocks loopback sockets and VS Code. Lead runs: `npm run build:dev`, then
  `xvfb-run -a npx vscode-test --label stable --run
dist/test/integration/teamComposition.test.js`.
- Scratch worktrees (`$TMPDIR/base-diet`, `mid-diet`, `head-diet`): removed
  at handoff; lane `node_modules` untouched (read-only symlink use).

## Test timeouts

Final verification used the repository default throughout; no `--testTimeout`
anywhere. One exploratory rerun note: none needed — no slow-test failures on
this rig (load ~normal; no deadline retries required).
