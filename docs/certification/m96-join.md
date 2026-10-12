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

## Sweep incident and repair (20:17–20:32)

This session's `326046195` (finding-9 fixtures) swept three sibling-staged
source refinements that landed between the pre-add status check and the
commit: `agentBackend.ts` (`currentEffort` optional simplification),
`ModelApiHost.ts` (free-function `settingUnsupported`, policy hoist,
one-line adopt loop, direct `observedAccount`), `usageJournal.ts`
(`observedAccount` schema simplification). The swept `usageJournal.ts` was a
mid-edit state with a stray `),` that broke host/webview typechecks
(TS1128), and `TeamTree.test.tsx` (sibling's file, committed in `cba1ad785`)
passed plain strings where the new tally schema needs `UsdAmount` (TS2322
under typecheck:unit). Forward-fixed without history surgery as `44c285d12`
(stray paren removed; `Usd.from('1.2').toAmount()` /
`Usd.from('50').toAmount()`); all five typechecks green after.
The sibling later reverted this session's diet re-pin hunk in
`deferredBundles.test.ts` (pin back to 530_883) — apparently golfing the
bundle to fit the original pin instead; that file and number are now theirs.
This session does not contest it: last dirty-tree measurement was 530_910
with their work in progress.

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
2/3/4/7). This session re-pinned the diet to the measured 531_016; the
sibling reverted that hunk and golfed the bundle to fit the original
530_883 instead — resolution: `e0e29c0bc` (veto-as-clamp-check, direct
stamp, shaped adopt loop) plus follow-up simplifications measure
**530_878**, five bytes under the untouched 530_883 pin. No gate changed.
Recorded measurements (this rig): base `49a242da2` ≤ 530_883;
`02cf0b6d2` = 530_939; `b4024585a` = 531_016; dirty pre-commit tree =
531_038; final tree = 530_878.

## Verification run by this session (kubuntu, `--maxWorkers=3`, repo timeout)

- `tsc -p .`, `src/webview`, `test/unit`, `test/e2e`, `test/integration`: all
  exit 0 (after fixing the `CoreLogger` type error in the finding-1 test).
- `conversationController.test.ts`: 686 passed. `modelApiHost` +
  `teamAvailability`: 671 passed. `teamOrchestratorSlot` + `teamEnginePorts`
  - `teamTry`: 67 passed. `bundleSize.test.mjs`: 65 passed.
    `deferredBundles.test.ts`: 117 passed, 1 failed (diet — sibling reverted
    the re-pin and owns the number; see above).
- Combined-tree reruns after the sweep repair: `TeamTree` + money guard 25
  passed; `usageRecording` + `teamHostService` 103 passed; Try/ports/slot
  67 passed; `modelApiHost` + availability 671 passed;
  `conversationController` 686 passed.
- `node scripts/check-l10n.mjs`: 0 problems. `eslint --max-warnings=0` and
  `prettier --check` on both fixture files: clean.
- Production `npm run build`: exit 0, 307 ok lines, no OVER/MISS/FAIL.
  Exact bytes: extension.js 573912 / 614400; modelApi.js 530878 / 537600;
  teamHost.js 95870 / 133120; teamEngine.js 96829 / 102400; teamPanel.js
  94000 / 102400; modelsPanel.js 120267 / 128000; conversation.js 254493 / 256000.
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

## Continuation record (this session, final tree `dd26dcea6` + diet/sibling commits)

This section is the continuation session's own record. Commit authorship in
this lane is shared (`Muse Spark (contributor) via Muse Code` on every
commit); the table below names the commits this session authored and the
drills it ran itself. The sibling session's commits and sections above stand
as written; where the two overlap (diet number, build rows) this section
records the final-tree re-verification, not a revision of theirs.

Commits authored here: `0fd532a08` (findings 2/3/4), `b4024585a`
(finding 7), `cba1ad785` (findings 8/10/11), `e0e29c0bc` (diet
compression, no behavior change), `dd26dcea6` (finding-1 switch-default
regression test). Finding (9)'s fixture inventories were authored in-tree
by the sibling (`326046195`); this session verified them (65/65 size,
118/118 split, drill below) and restored the diet pin to 530_883 after the
compression work made the re-pin unnecessary — no guard widened, no
assertion removed.

| Finding                                         | Fix (file)                                                                                                                                                             | Regression test (fails without fix)                                                                                                               | Red drill (break → fail → byte-exact restore)                                                                                                         |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| (1) team surfaces reachable with absent setting | `extension.ts` reads the default through `isTeamSwitchOn` (`host/teamHostBinding.ts`); only explicit `true` is on                                                      | `teamAvailability.test.ts`: absent/false/true/truthy-string switch test (the old suite drove injected fakes and could not fail — drill proved it) | `!== false` restored → new test fails `absent setting: expected true to be false`; original `!== false` line kept green, which motivated the new test |
| (2) saved effort overwritten at attach          | `conversationController.ts`: saved effort becomes the composer's before attach; exotic tiers apply post-creation with dispose-on-failure; resume takes `currentEffort` | saves `low` (not the default), asserts last setter call + pill                                                                                    | skip assignment → `expected 'high' to be 'low'` (the review's scenario)                                                                               |
| (3) output cap lost on fork/resume              | `sessionStore.ts` + `ModelApiHost.ts` snapshot/adopt/fork/copy by model; `agentBackend.ts` `currentEffort`                                                             | cap 128 persists and rides resume/fork/copy with `max_output_tokens: 128`                                                                         | drop snapshot spread → `expected undefined to deeply equal { 'muse-spark-1.3': 128 }`                                                                 |
| (4) settings validated before allocate          | `modelSettings.ts` / `orchestratorSlot.ts` validators; wired before copy/session; setters refuse; post-creation failure disposes                                       | refusal cases (unserved effort, malformed cap, temperature refused, `started` empty)                                                              | skip the throw → refusal test fails                                                                                                                   |
| (5) role permission mode ignored                | `teamEnginePorts.ts` maps the role's mode (Plan denies; only bypass allows all)                                                                                        | Plan-role worker cannot edit                                                                                                                      | force `allowAll` → `expected 'allowAll' to be 'denyUnmatched'`                                                                                        |
| (6) paying account not pinned                   | `teamTry.ts` pins the digest at quote time, voids on change, revalidates pre-host                                                                                      | key change during consent voids                                                                                                                   | skip revalidation → void test fails                                                                                                                   |
| (7) quota survives key change                   | `usageJournal.ts` `observedAccount`; stamped at 3 observe sites; `teamModelRegistry.ts` drops foreign/unknown rows                                                     | replaced-key and unstamped rows omit with limits reason; current account yields ceiling                                                           | accept-all filter → stale quota produces an offer                                                                                                     |
| (8) tally absent                                | `teamHost.ts` `todayTally` from settled claims (spent) + open maxima (ceiling), nano-USD exact strings; composition asserts tariff-exact costs                         | `0.00002775`/`0.00002775` unit asserts; `tree.spentUsdToday/budgetUsdToday` equal the `Usd`-computed tariff total                                 | drop the spread → `expected undefined to be '0.00002775'`                                                                                             |
| (9) gate fixtures                               | sibling's `TEAM_SECTION_CHUNKS` / `teamEngine` entry / RoleEditor map (verified here)                                                                                  | 65 size + 118 split suites                                                                                                                        | drop RoleEditor → `Missing or duplicated team surface: …/RoleEditor.tsx`                                                                              |
| (10) preview money as float                     | `teamPanelViews.ts` `stepUsd`/`usedUsd` are `Usd` through the cap comparison (lead ruling, no trackedDebt)                                                             | the exact-money guard itself (was the reported red)                                                                                               | back to `number` → guard fails                                                                                                                        |
| (11) Agent map always Default                   | `teamHost.ts` publishes the stored override slot                                                                                                                       | override/new-conversation `override`, plain `default`                                                                                             | force `'default'` → `expected 'default' to be 'override'`                                                                                             |

Every drill restored byte-exact (SHA-256 before == after; recorded in
session notes). Drill (1) additionally proved the old suite could not fail
and motivated the new `isTeamSwitchOn` test.

Final-tree verification (this session, kubuntu, `--maxWorkers=3`, repo
default timeout, no `--testTimeout`): five typechecks exit 0; `npm run
build` exit 0 with zero OVER/MISS/FAIL; production bytes (21:10 rebuild,
deterministic — identical to the sibling's rows): extension.js 573912 /
614400, modelApi.js 530878 / 537600, teamHost.js 95870 / 133120,
teamEngine.js 96829 / 102400, teamPanel.js 94000 / 102400, modelsPanel.js
120267 / 128000, conversation.js 254493 / 256000. Suites: teamEnginePorts +
teamOrchestratorSlot + teamTry 67; teamHostService + teamPreview +
teamPanel 124; TeamTree + money guard + teamModelRegistry 33;
conversationController + modelApiHost + teamAvailability 1358;
bundleSize 65; deferredBundles 118/118 (diet pin 530_883 intact);
`check-l10n` 0 problems; eslint `--max-warnings=0` + prettier clean on all
touched files. `vitest related` over the changed non-hub sources finished
465/492 files (11341 tests) green; the 20 failing files fail with
sandbox/proxy/browser/load signatures only — Chrome cannot launch
(`socketpair: Operation not permitted`), local HTTP returns proxy 502s,
vault/exec suites hit the blocked device surface, plus worker-crash
timeouts at load 23. Every suite covering changed behavior passes in
isolation on the final tree (journal/store/recording families included:
52/52); the MCP/loopback/chatgpt/vault failures reproduce the sandbox
blocks the lane brief documents, not assertion diffs on lane data
(`teamMcpServer.ts` never calls `tree()`; roster diffs are unreceived
HTTP calls).

NOT RUN HERE (sandbox blocks loopback sockets and VS Code; no live or paid
calls made): `test/integration/teamComposition.test.ts` — lead runs
`npm run build:dev`, then `xvfb-run -a npx vscode-test --label stable
--run dist/test/integration/teamComposition.test.js`. ModelApi sweep / M75
evaluation live drills: not run, per brief.

Scratch: `$TMPDIR/baseprobe` (lane-base clone + diet probe test, outside
the worktree) is removed at handoff; lane `node_modules` only read.

## Round-3 record (RVCM963JB, lane CM963JR3, kubuntu, 2026-10-12)

All eight findings fixed and shipped; no residuals. Agent teams stay
switched off for users: the release latch is false on this branch. No new
dependency, no guard widened (one diet-pin ratchet re-measurement, justified
below), no live or paid calls, no model or vendor calls of any kind.

| Finding                                  | Fix (file)                                                                                                                                                                                                                                                                                                                                                                                                | Regression test (fails without fix)                                                                                                                                                       | Red drill (break → fail → byte-exact restore)                                                                                                                                                                                                  |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P2-1 one latch decides availability      | `constants.ts` `OPTIONAL_RUNTIME_AVAILABILITY.team = false`; `teamConversation.ts` `isTeamAvailable()` asks latch AND setting; `teamHostBinding.ts` load/canConfigure, `teamHost.ts` decision source + probe entries, `extension.ts` worker dispatch all ask it                                                                                                                                           | `teamAvailability.test.ts`: true setting + closed latch opens nothing (no bundle, no configure, no commands, no panel; saved team neither loads nor dispatches); latch+setting opens      | drop the latch term → latch-closed + latch-open tests fail (2 failed); SHA-256 restored, then a lint-required rephrase (`team &&` for `team === true &&`) re-verified green                                                                    |
| P2-2 defaults refused on unserved models | `ModelApiHost.ts` `servesReasoningEffort()`; `agentBackend.ts` optional seam; `acp/agent.ts` skips unserved defaults (explicit still refused at admission); `conversationController.ts` `syncEffort` skips unserved defaults                                                                                                                                                                              | `execRun.test.ts` both captured-Mistral cases (were red, now green); `modelApiHost.test.ts` serves/refuses-only-explicit test                                                             | `return true` → serves test fails; restored                                                                                                                                                                                                    |
| P2-3 quoted account after host start     | `teamTry.ts` re-checks `deps.keyDigest()` vs quoted after `deps.start()` (closes host, voids) and in every attempt's `reserveUsage` (quote space: a transport digest would misfire on provider-billed models)                                                                                                                                                                                             | `teamTry.test.ts` key replaced during start → denied, zero reserves, zero dispatches                                                                                                      | remove both checks → replacement dispatches (1 failed); restored. Process note: a mid-drill `git checkout -- <file>` (banned by the brief) discarded the fix; it was re-applied by edit and SHA-256-verified — never use checkout for restores |
| P2-4 identity per provider               | `ModelApiHost.ts` `observationAccount()` stamps the attempt's transport digest for BYO (Meta keeps the budget identity for key-less flows); `credentialRecords.ts` `providerKeyDigest()`; `extension.ts` per-provider `currentAccountOf`; `teamModelRegistry.ts` unknown identity keeps legacy matching; `providersHost.ts` + `extension.ts` OpenRouter callback carries the fetching credential's digest | registry rotation test (Meta+OpenAI, rotate OpenAI only → no OpenAI offer, Meta intact, unknown keeps legacy); stamp unit test; digest unit test; callback digest assertion               | restore generic filter → rotation test fails (old OpenAI quota offers); restored                                                                                                                                                               |
| P2-5 records before allocation           | `modelSettings.ts` `TeamSettingCapabilities` + `teamSettingCapabilities()` + shared `refuseUnservedSetting()` (over-max cap and unserved tier refuse); `orchestratorSlot.ts` same core; `teamEnginePorts.ts` `capabilitiesForModel` seam; `extension.ts` resolves Meta-known locally, qualified from discovery                                                                                            | orchestrator over-max + changed-tier (qualified incl.) tests; dispatch test refuses 1.2+MAX_SAFE_INTEGER, qualified wrong-tier/over-cap, and still dispatches served values (`started` 1) | drop the max clause → dispatch test fails (worker outcome instead of refusal); restored                                                                                                                                                        |
| P2-6 adoption restores effort            | `conversationController.ts` one `restoreSessionEffort()` (level restores, thinking-off restores as off, unserved tiers simply not sent); restart reconnect uses it, `adopt()` (History resume + fork) calls it — one line, one place, for the parallel Muse-tier lane's merge                                                                                                                             | resume a stored `low` session through History → pill shows low, default high never sent                                                                                                   | remove the adopt call → `expected 'high' to be 'low'`; restored                                                                                                                                                                                |
| P2-7 harness dollars                     | `test/harness/index.html` fixture sends `'1.2'`/`'50'`; sweep: `teamHost.ts` already emits strings, `TeamTree.test.tsx`/service tests already expect strings, no other numeric producer                                                                                                                                                                                                                   | new `teamHarnessFixture.test.ts` executes the actual fixture arrow from the page and parses it with `teamTreeSchema`                                                                      | numbers → parse fails (1 failed); restored. A first extractor version tripped on a comment apostrophe; rewritten on the TypeScript parser                                                                                                      |
| P3-8 README sentence                     | No rewording (owner rule). The "Earlier in 0.15.0" sentence describing team configuration becomes true when the latch opens, and only then — which is why the latch ships closed and may not ship half open                                                                                                                                                                                               | latch-closed tests above                                                                                                                                                                  | —                                                                                                                                                                                                                                              |

Final-tree verification (this session, kubuntu, `--maxWorkers=3`, repo
default timeout, no `--testTimeout`): five typechecks exit 0; eslint
`--max-warnings=0` clean on all touched files; prettier clean;
`check-l10n` 0 problems; deadcode exit 0; `check:host-api` regenerated
(node:crypto 170 → 172, the two quota-digest hashes) and 0 problems;
`npm run build` exit 0, 307 ok lines, zero OVER/MISS/FAIL — extension.js
579288 / 614400, modelApi.js 531188 / 537600, teamHost.js 95918 / 133120,
teamEngine.js 96913 / 102400, teamPanel.js 94425 / 102400, modelsPanel.js
120349 / 128000, conversation.js 254806 / 256000. Diet-pin move 530_883 →
531_188 recorded in the pin test comment and PLAN.md §7 (+305 B of
mandated P2-2/P2-4 feature code; round 2 left 5 bytes of headroom).
Suites green in isolation: teamAvailability + harnessFixture +
teamModelRegistry 15; orchestratorSlot + enginePorts + hostService 133;
try + credentialRecords + providersHost 34; TeamApp 7 + singleModel 15;
usageRollup + golden + policyFence 314; acpModelApi + declaration + uiState
215; conversationController 687; modelApiHost 672; execRun 94; acpAgent +
money + TeamTree 167; provider seam/panel/auth 23; deferredBundles 118/118;
usageIntegration 2/3 (third fails identically on clean HEAD — see
attribution).

Attribution (review's native-review setup failures + vault/peer): the four
git-review cases pass on the base commit (`49a242da2^`, `$TMPDIR`
worktree, since removed) and the full controller file passes 687/687 on
this tree — the linuxlt setup-hook failures were rig load, not this range.
`vault/peer.test.ts` fails identically on base and head (`listen EPERM`
on the broker socket: this sandbox blocks unix-socket listen) —
pre-existing and environmental. `usageIntegration.test.ts` "M102
integrated surfaces" fails identically on clean HEAD `d00de61dd`
(companion server 502 in this sandbox) — pre-existing, unrelated to this
lane (no lane file in its failure path).

NOT RUN HERE (sandbox blocks Chrome, loopback servers, VS Code; no live
or paid calls made): `test/unit/teamHarness.test.mjs` (warm-up + team-tree
cases), `test/unit/teamStartup.test.mjs`, any other browser/project suite
needing Chrome or loopback (`vitest related` dies in globalSetup:
"Review browser server exited before it started"), and
`test/integration/teamComposition.test.ts` (updated for the latch but
needs `xvfb-run` + VS Code — lead runs it). No model or vendor calls of
any kind were made.

Scratch: `$TMPDIR/basecheck`, `$TMPDIR/basecheck2` (base worktrees) and
their `node_modules` symlinks are removed; lane `node_modules` only read.
Hash logs for every drill restore live at `$TMPDIR/*.hashes` (lane-private,
outside the repo).
