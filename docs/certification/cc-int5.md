# CC-INT5 — merge round 5 on int/recovery: the team cluster, then M104 lane B (2026-10-30)

Claude Code lane `CC-INT5`, worktree `/Users/user/lanes/CC-INT5`, branch
`cc/int5`, on the test rig `MacBookPro.ivettnet` (macOS, Darwin 24.6.0, Intel
x86_64, Node 24.21.0, npm 11.19.0). Base: int/recovery `dfcb45936` (CC-INT4's
round, `docs/certification/cc-int4.md`, whose known failures and CC-INT3's,
CC-INT2's and CC-INT1's are not counted against a merge here). Model attempts:
**0**. Provider calls: **0**. Muse requests: **0** (the brief names no real
use; no real conversation, no nested ACP or CLI session). Nothing was pushed,
rebased, stashed or tagged. The vault and real credential-store suites
(`keyringParts`, `keystoreOwner`, `credentialLease`, `providerHeadersStore`,
`test/unit/vault/**`, `deviceOwnerVaultUses`, `deviceOwnerBind`,
`devicePairKeyDpapi`) were never run on this MacBook, no browser or GUI app was
started, and no command that reads the login Keychain was run (`exec --team` and
a live `panel --stdio` were left to their suites, §6). Scratch files lived in the
worktree's ignored `temp/` (a copy of the base, two Python venvs, a scratch
`HOME`, logs, drill backups).

## 1. The merges

Fetched with `git fetch ~/gates/muse.git "refs/heads/lanes/<name>:refs/remotes/<name>"`
and merged with `git merge --no-ff`, in the brief's order, each lane's
certification record read first (`rlf-teamcore.md`, `rlf-teamwire.md`,
`rlf-teamgate.md`, `rlf-autoretry.md`, `cc-m104b.md`, `rvm104b.md`).

| #   | Branch (tip)                         | Built on    | Commits | Merge commit | Conflicts and how they were resolved                                                                                                                                                                                                                                                                                                                                                   |
| --- | ------------------------------------ | ----------- | ------- | ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `lanes/rlf-teamcore` (`ff680ef87`)   | `3198954c9` | 13      | `b0be6d772`  | 9: `knip.jsonc`, `deferredBundles.mjs` (entries, the window and landing bundles' resolve rules and the entry regex: all combined), `teamHost.ts`, `teamPool.ts`, `teamTaskState.ts`, `teamHostEntry.ts` (both sides' fields, members and imports kept), `ROADMAP.md` and `host-api.md` (regenerated), `teamHostService.test.ts` (int deleted this fake-driven suite; it stays deleted) |
| 2   | `lanes/rlf-teamwire` (`127890682`)   | `3198954c9` | 29 (9)  | `7c7ad54ff`  | **83 in a plain merge**, all RLM116's two copies. Recorded with `-s ours`; the lane's own nine commits (`c1cbbceb8..127890682`) applied on top as one three-way patch. 5 files needed hand work (§2.2)                                                                                                                                                                                 |
| 3   | `lanes/rlf-teamgate` (`bf391be3b`)   | `f53ef168f` | 6       | `f7d3741b2`  | 6: `PLAN.md` (D217 → **D227**, both status blocks kept), `README.md` (the lane's text: `--team` parses), `statusPhrases.ts` (both phrases), `coordinator/mode.ts` (int's form), the integration test (the lane's header, int's `src/host/vscode/` path), `teamHostService.test.ts` (deleted)                                                                                           |
| 4   | `lanes/rlf-autoretry` (`bb791fe9c`)  | `f53ef168f` | 6       | `75d80fbd4`  | 34 files, most of them the 14 UI tables and generated files. The lane's retry policy was ported into int's refactored retry loops (§2.4); its D217 → **D228**                                                                                                                                                                                                                          |
| 5   | `lanes/m104b-reviewed` (`bae1f9e9f`) | `acb48b7f3` | 21      | `e90b711d3`  | 6: `README.md` (command list), `scripts/build.mjs` (both metafile writers), `src/extension.ts` (the lane moved the conversation deps into `composeConversationDeps`; int's `museCodeMaxRetries` line went there), `host-api.md`, two reference files (regenerated)                                                                                                                     |

Each merge interaction is its own `fix(int):` commit: `7484fa0b9` (merge 1),
`c4f1b7382` (2), `37345c4a1` (3), `410813305` (4); the cross-merge ones are
`75a91cb5b` (the three caps), `022a2b8ac` (registry and agent package),
`9663a42e1` (knip, duplication) and `d3c0f2ec3` (the golden and a roadmap row).
Two interaction edits of merge 5 are inside its merge commit (`e90b711d3`)
rather than a commit of their own: `museCodeMaxRetries` in
`composeConversationDeps` and the panel's `usageInsights` answer (§2.5).
`ROADMAP.md`, `host-api.md` and the reference files were regenerated, never
hand-merged. Then `docs(plan)` and the commit carrying this record.

## 2. What each merge needed

### 2.1 `lanes/rlf-teamcore` (M96c on the team core)

Read in place, the lane's own record held: the window scheduler port, the host
binding with `finalAdmit` and the ordered merge queue, Traffic, the governor
joins and `landTeamTask` with owner-store recovery. Merge 1 brought two new
bundles (`dist/teamWindow.js`, `dist/teamLanding.js`, both inside their 75 KiB
budgets) and removed three accepted catch sites (`teamHost`, `teamMergeFlow`,
`teamPool`): `check:catches` asked for the lowered baseline (core GENERIC
245 → 243, CLEANUP 237 → 236; nothing rose) in `7484fa0b9`. The lane's `teamHostService.test.ts` edits went with the suite int
deleted in `2537f3e8d` ("every port is a fake"); its merge-queue and
final-admission behaviour keeps its three real-process suites (§4) but has no
unit proof on int (§8, item 2). **Left after the round:** `requestCheckSlot` still
has no production caller (RLF-TEAMWIRE's third open question named TEAMCORE as
its owner; TEAMCORE's record does not claim it).

### 2.2 `lanes/rlf-teamwire` (the planner binding, the team MCP server, the ledger lease)

The lane merged RLM116 itself and renumbered its decisions D212–D215 to
D216–D219; int already has RLM116 through `cc/rlm116` (D218–D221, and D216/D217
are other decisions). A plain `git merge` conflicted in 83 files, every one of
them RLM116's original copy against int's re-land. So the merge is recorded
with `-s ours` (int's tree, int's RLM116, int's numbers) and the lane's own nine
commits are applied on top: the merge planner bound before the merge card
(`teamMergeFlow`, `teamEnginePorts`), the `team` MCP server for Muse Code
orchestrators (`teamMcpServer`, `teamHostBinding`, `extension.ts`), the
cross-process ledger lease and kill-safe artifact journal
(`execLedgerLeaseEntry`, `execTeamRecovery`), "preserve the branch on every
merge failure", and the lane's PLAN, CHANGELOG and record text. The ancestry of
the merge commit carries the lane's RLM116 commits; the tree does not.

Left out of the tree, and why: `test/unit/teamHostService.test.ts`,
`helpers/teamHostHarness.ts` (the fake harness) and `helpers/teamGit.ts` (int
deleted all three; `helpers/realTeamGit.ts` replaced the last, and now takes the
lane's `env` pass-through and its scratch-repository helper with the real path),
and `teamMcpWiring.test.ts`, which ran on that fake harness. The MCP proof is
rewritten in `c4f1b7382` over the real `TeamHostBinding`, the bundle's real
`createTeamHost`, the real engine ports and the real loopback HTTP server: the
five tools, 401 for no token and for a forged token, the roster call reaching the
runner, and no endpoint without a stored, ready team (2 cases, §4). The
CHANGELOG entry and the PLAN status no longer claim "planned before the card"
(its only proof was the deleted suite) or "retried commands answered once"
(only `teamTools.test.ts`'s registry cases cover that, not through the
binding). The lane's record carries a note for int.

### 2.3 `lanes/rlf-teamgate` (D227: teams off until a second model is set up)

The lane's D217 collides with int's D217 (the judge fast path's `stat`); it is
**D227** on int, with the usual numbering note, and every reference the lane
added was renumbered (the lines it added, exactly; int's own D217 untouched).
The shared rule (`src/shared/teamAvailability.ts`) and its seven callers merged
without a conflict. The lane deletes `OPTIONAL_RUNTIME_AVAILABILITY.team`: the
release latch is gone. Consequences handled in `37345c4a1`: two int tests
(`teamMoveTask`, and my rewritten `teamMcpWiring`) that set the latch no longer
do; RLF-TEAMCORE's and RLF-TEAMWIRE's CHANGELOG and PLAN lines said teams "stay
behind the release latch; nothing turns on yet", which is false on the merged
tree, so they now say teams stay off until a second model is set up and that no
real team run has been made on this build; M96b's roadmap row no longer says
"off until certified". **The decision for the lead (§8, item 3):** on int, a
person with two models can now reach teams, and no real team run has been made
through the packed product.

### 2.4 `lanes/rlf-autoretry` (D228: the industry-standard automatic retry)

D217 → **D228** on the lane's own added lines. int refactored the retry loops
the lane edited (`isStreamRetried` in `ModelApiHost`, `isStreamResent` in
`providerClient`, the pacing notice in `transport`), so the lane's policy was
carried into those methods rather than merged textually: `maxRetries()` is a
number everywhere (the person's setting capped by the provider's documented
maximum, else the SDK default of 2), an ambiguous send is resent only within
an explicit bound (`explicitMaxRetries`), and every notice carries
`allowed + 1`. `agent.ts`, `mapNotification.ts` and two suites the lane did not
change keep int's re-landed RLF-ACPTURNS. The lane's test helpers merged with
int's signatures (`modelApiRig`'s `options`, `startLiveHost(answer, features,
wires)`). `check:catches` found one new GENERIC site (the shared
`resubmitRememberedTurn` passed the failure to a callback named
`reportFailure`; it is now `report`, a sink the classifier reads) and one
churned identity in `transport.ts` (counts unchanged) in `410813305`.

### 2.5 `lanes/m104b-reviewed` (M104 lane B and RVM104B's five fixes)

The lane's work is almost all new files; the conflicts were the command list in
`README.md`, `scripts/build.mjs` (both metafile writers kept) and the part of
`extension.ts` the lane moved into `src/host/compose/conversationDeps.ts`. Two
interactions with the other merges: autoretry's `museCodeMaxRetries` now rides
`composeConversationDeps`, so VS Code and the panel both read it; and int's
controller now takes `usageInsights(): Promise<TraceInsights>` (no `undefined`),
so the panel answers `{ report: undefined, notice: 'unavailable', empty: false }`,
which the usage page renders as it rendered `undefined` (it reads no trace
logs). Later, `gen-lazy-registry --check` found that int's controller loads
`reportFallback.js` in the agent and the agent package did not carry it
(`022a2b8ac` adds it to `ACP_BUNDLES`; the registry is regenerated at 184
bundles, 290 loads resolved, current).

### 2.6 The three caps D75's amendments removed (`75a91cb5b`)

`TEAM_MAX_DEPTH = 2`, `TEAM_MAX_CONCURRENT_COMMANDS = 1` and
`TEAM_SHARED_RESOURCE_DEFAULT_LIMIT = 2` survived all five merges and were read.
Applying the owner's 2026-10-23 clarification:

- **Command slots and the shared-server default limit go** (arbitrary caps on the
  person's work): `TEAM_MAX_CONCURRENT_COMMANDS`, `teamShellCommandSlots`, the
  shell slot and its `'shell'` refusal are removed; a shared resource has the
  limit its person set, else none, and a repository's lowering file may put a
  limit on an unlimited resource and never raise one.
- **Depth stays, as a runaway guard with a cited industry value the person's
  setting replaces.** `TEAM_DEFAULT_MAX_DEPTH = 3`: Claude Code's documented
  default, "By default, a subagent can spawn subagents of its own, up to three
  layers below the main conversation", changed with
  `CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH` (code.claude.com/docs/en/sub-agents,
  read 2026-10-30; its separate concurrent-subagent limit of 20 is not a depth
  bound). The hard `Math.min(maxDepth, TEAM_MAX_DEPTH)` that overrode a higher
  setting is gone, and `WORKER_MAX_DEPTH` (the same cap twice) with it. I looked
  for OpenAI Codex's `agents.max_depth` (a third-party page says default 1) and
  found it in neither of its two documentation pages that I could read, so it is
  not cited. **No setting names the depth bound and no code path starts a
  depth-2 task:** `TeamAdmission` and `checkWorkerDepth` have no production
  caller (the latter is tagged `@unwired`), so the bound is the limit a caller
  passes and the constant's default (§8, item 4).

## 3. Proof on the final tree

Every exit code is the command's own. The tree is `d3c0f2ec3` plus this record
and the PLAN statuses.

| Command                                                                                              | Exit             | Result                                                                                                                                                                                                                                                                                                                                                                                                    |
| ---------------------------------------------------------------------------------------------------- | ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm install --package-lock-only --ignore-scripts`                                                   | 0                | lockfile and `package.json` unchanged (`git status`); `package.json` differs from the base only by the `museSpark.museCodeMaxRetries` setting block; `npm ci` was not run (no dependency changed)                                                                                                                                                                                                         |
| `prettier --check --ignore-unknown` on the 231 files changed since `dfcb45936`                       | 0                |                                                                                                                                                                                                                                                                                                                                                                                                           |
| `eslint --max-warnings 0` on the 181 changed JS/TS files                                             | 0                | empty output                                                                                                                                                                                                                                                                                                                                                                                              |
| `npm run typecheck`, as its six projects (host, webview, unit, e2e, integration, faults)             | 0, 0, 0, 0, 0, 0 | no `error TS` line in any log                                                                                                                                                                                                                                                                                                                                                                             |
| `node scripts/check-l10n.mjs`                                                                        | 0                | 14 UI tables, 14 usage tables, 284 manifest strings, 2496 source files; 0 problems                                                                                                                                                                                                                                                                                                                        |
| `npm run check:reference`                                                                            | 0                | 92 features, 68 commands, 111 settings, 33 slash, 364 CLI; current                                                                                                                                                                                                                                                                                                                                        |
| `npm run check:host-api`                                                                             | 0                | 392 VS Code APIs, 57 files importing vscode, 30 Node built-ins, 76 theme variables; 0 problems                                                                                                                                                                                                                                                                                                            |
| `npm run check:plan`                                                                                 | 0                | 244 milestones; 0 drift (no archive needed)                                                                                                                                                                                                                                                                                                                                                               |
| `npm run check:roadmap`                                                                              | 0                | 244 entries; `ROADMAP.md` current                                                                                                                                                                                                                                                                                                                                                                         |
| `npm run check:catches`                                                                              | 0                | all catch sites and counts match the baseline; lowered once (`7484fa0b9`), one identity swapped (`410813305`), nothing rose                                                                                                                                                                                                                                                                               |
| `npm run cycles`                                                                                     | 0                | no circular dependency                                                                                                                                                                                                                                                                                                                                                                                    |
| `npm run deadcode`                                                                                   | 0                | knip clean (configuration and tag hints only: 5 tag hints, the base had 6)                                                                                                                                                                                                                                                                                                                                |
| `npm run duplication`                                                                                | 0                | 0 clones                                                                                                                                                                                                                                                                                                                                                                                                  |
| **`npm run build`**                                                                                  | **1**            | **four size rows OVER, the rest of the chain run by hand (below); no budget raised.** `dist/teamHost.js` 140.2 of 130 KiB (+10.2), `dist/teamRunners.js` 78.4 of 75 (+3.4), `dist/teamScheduler.js` 76.5 of 75 (+1.5), `dist/uiText.js` 125.3 of 125 (+0.3, 341 B). 259 other rows hold; tightest `dist/validation.js` 49.8 of 50, `dist/wire.js` 74.9 of 75, `dist/modelApi.js` 522.1 of 525. §8, item 1 |
| the rest of `npm run build`: `check-tokens`, `check-bundle-split`, `gen-lazy-registry --check`       | 0, 0, 0          | tokens 0 problems; the split gate passes; 184 bundles, 290 loads resolved, current                                                                                                                                                                                                                                                                                                                        |
| `check-host-globals`, `third-party-notices`, `check-legal-build-records`                             | 0, 0, 0          | 93 notices (no regeneration); 165 legal bundles, 2899 files, 0 problems                                                                                                                                                                                                                                                                                                                                   |
| `node scripts/package-vsix.mjs --target win32-x64` (zopfli 0.4.3 in a venv under `temp/`)            | 0                | **`VSIX: 4362815 bytes (budget 4915200)`**: 552,385 under the budget (CC-INT4: 4,323,743)                                                                                                                                                                                                                                                                                                                 |
| `npm run package:acp -- --target win32-x64`                                                          | 0                | **141 of 141** packaged-bundle checks (CC-INT4: 125)                                                                                                                                                                                                                                                                                                                                                      |
| `npm run security:audit`                                                                             | 0                | 7 advisories, 0 exceptions needed (CC-INT4: 7); no dependency changed in this round                                                                                                                                                                                                                                                                                                                       |
| `npm run security:sast` (semgrep 1.180.0 in a venv under `temp/`; `SSL_CERT_FILE=/etc/ssl/cert.pem`) | 1                | 688 rules, 5266 files: the **same 6 blocking findings as CC-INT1 to CC-INT4**, in `os/build.py`, `os/pi/compose.py` (2), `scripts/build-packs.mjs`, `src/core/backends/modelapi/mcp/headers.ts`, `src/runtime/node/keyStore.ts`; none of those five files changed in this round (`git diff --name-only dfcb45936 HEAD` is empty for each), and no changed source has a finding                            |

## 4. Each merged lane's own suites, final tree, repository timeouts

`TMPDIR` at its real path, `--maxWorkers=3`, three files at a time, no raised
timeout anywhere in this lane.

| Suites                                                                                      | Exit  | Result                                                                                                                                                          |
| ------------------------------------------------------------------------------------------- | ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `teamLandingPause`, `teamLandingKilled`, `teamSchedulerRecovery` (real processes, real git) | 0     | 5 passed (rlf-teamcore)                                                                                                                                         |
| `catchInventory`, `lazyBundleFiles`, `teamChunkPackaging`                                   | 0     | 37 passed                                                                                                                                                       |
| `metaRequestGoldens`, `invariants`, `cx1r2Truth`                                            | 0     | 68 passed after the fixes (§5); `invariants` and `cx1r2Truth` were red on the merged tree before `d3c0f2ec3`; `teamSchedulerSchemas` passed in an earlier batch |
| `teamMergePlan`, `teamMcpWiring`, `teamWorkspaceRefs`, `teamEnginePorts`, `acpTeamPackage`  | 0     | 22 passed (rlf-teamwire; `teamMcpWiring` is 2 cases over real HTTP)                                                                                             |
| `execTeamSweep`                                                                             | **1** | 6 of 7: the "removes the dead run with its owned ref" case fails identically on the untouched base (§5 row 2)                                                   |
| `teamAvailability`, `teamSingleModel`, `execTeamFlags`                                      | 0     | 47 passed (rlf-teamgate)                                                                                                                                        |
| `teamPanel`, `teamRolesSection`, `acpTeamContracts`                                         | 0     | 146 passed                                                                                                                                                      |
| `museCodeAutoResend`, `providerRetryLimits`, `modelApiRetryNoCount`                         | 0     | 31 passed (rlf-autoretry: a recorded exchange, real refused loopback sends)                                                                                     |
| `turnRetryCeiling`, `turnRetryButton`, `acpTranslate`                                       | 0     | 58 passed                                                                                                                                                       |
| `turnRetryResubmit`, `acpBackendNotice`, `providersPresets`                                 | 0     | 40 passed                                                                                                                                                       |
| `mapNotification`, `acpTurnFailure`, `teamMoveTask`                                         | 0     | 56 passed                                                                                                                                                       |
| `teamAdmission`, `teamConstants`, `teamResources`                                           | 0     | 90 passed (the caps)                                                                                                                                            |
| `runtimePanel`, `runtimePanelSessions`, `runtimePanelConversation`                          | 0     | 28 passed (m104b-reviewed, on the production build)                                                                                                             |
| `runtimePanelGit`, `runtimePlans`, `runtimePortableBundles`                                 | 0     | 11 passed                                                                                                                                                       |
| `runtimeReview`, `runtimeSettingsStore`, `runtimeTransfer`                                  | 0     | 23 passed                                                                                                                                                       |
| `wireEntry`, `acpPaidGrants`, `acpSessionRegistry`                                          | 0     | 8 passed                                                                                                                                                        |
| `pathGuardSpawns`, `sessionTitles`, `commandHelp`                                           | 0     | 65 passed                                                                                                                                                       |
| `packagedBundles` (alone, 116 s)                                                            | 0     | 9 passed                                                                                                                                                        |

## 5. `npx vitest related` over the round's changed sources, and the base

The 123 `src/` and `scripts/` files changed since `dfcb45936`, without
`src/shared/constants.ts`, `src/shared/l10n/en.ts` and `src/extension.ts`
(their `related` closure is the whole battery; the l10n, reference, catch and
build gates stand for them). Excluded by the MacBook rule: `keyringParts`,
`keystoreOwner`, `credentialLease`, `providerHeadersStore`, `test/unit/vault/**`,
`deviceOwnerVaultUses`, `deviceOwnerBind*`, `devicePairKeyDpapi`; also
`runtimeLsp` (CC-INT1 §5 row 11) and the browser suite `devicesPhase2Harness`.

`npx vitest related … --run --maxWorkers=3`, the repository's own timeouts: exit
**1**, 587 files (19 failed, 551 passed, 17 skipped), 8778 tests (**24
failed**, 8552 passed, 202 skipped), 529 s. Each failing file was then run
alone here and on an extracted copy of the untouched base (`git archive
dfcb45936` under `temp/base`, `node_modules` linked, built with `node
scripts/build.mjs --production`, same `TMPDIR`):

| #   | Files (tests in the related run)                                                                                                                               | Merged tree alone                                       | Untouched base alone   | Class                                                                                                                                                                                                                                                                                                                                                  |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | `invariants` (1: `08-team-on.json`), `cx1r2Truth` (1: M96c's roadmap row)                                                                                      | the same 2                                              | **pass**               | **From the merges**, fixed in `d3c0f2ec3`: RLF-TEAMCORE re-baselined the golden on a base without `stacked` and `alt_roles` (M96d, int); the merged builders offer both. The golden's `tools` and `prompt_cache_key` are regenerated from the real builders (every other field byte-identical). The M96c row now says "…certification is in progress." |
| 2   | `execTeamSweep` (1), `teamPlaybookIntegration` (1), `playbookGovernor` (1)                                                                                     | the same 3                                              | the same 3             | Base. `execTeamSweep`: the governed contained `git --version` exits 1 with empty stderr, so the dead run lands in `failed[]`; `sandbox-exec` with a permissive profile runs here, so **why is UNMEASURED**. The other two are CC-INT3 §5 rows 3 and 5 (5 s default; APFS case-insensitivity)                                                           |
| 3   | `acpServeHandshake` (1), `resourceStatusCpu` (1), `playbookSchedulesInputs` (1), `scheduleFireFailures` (1)                                                    | the same (`scheduleFireFailures` 1 here, 6 on the base) | the same, 5 s timeouts | Base (CC-INT3 §5 rows 3 to 5)                                                                                                                                                                                                                                                                                                                          |
| 4   | `connectorStorageGuard` (3)                                                                                                                                    | the same 3                                              | the same 3             | Base (CC-INT4 §5 row 1)                                                                                                                                                                                                                                                                                                                                |
| 5   | `resourceCreatedSweep` (4), `resourceHandoffDeadline` (2), `createdRegistryRace` (1), `nodeToolHost` (1), `nodeWorkspaceDevcontainer` (2), `providerSpend` (1) | the same 11                                             | the same 11            | Base. Not in CC-INT1 to CC-INT4's `related` sets (no changed source selected them before); each fails identically on the base here. Causes UNMEASURED beyond that                                                                                                                                                                                      |
| 6   | `teamModelsFirstPaint` (file), `nodeCertificate` (file)                                                                                                        | the files fail to load                                  | the same               | Base. `teamModelsFirstPaint`: "Chrome unavailable" (`browserType.launch`; a browser suite, NOT RUN on the MacBook); `nodeCertificate`: "The node feature is unavailable", cause UNMEASURED                                                                                                                                                             |
| 7   | `estimatorSnapshotStrict` (1)                                                                                                                                  | **passes** alone                                        | passes                 | Load only: a timing case in the loaded 3-worker run                                                                                                                                                                                                                                                                                                    |

After `d3c0f2ec3` the merged tree's red set equals the base's. The 36 test files
the three CC-INT lanes listed as base failures that no changed source selects
were not re-run.

## 6. Real use through the built product

`dist/acp.js` from this tree's build, a scratch `HOME` under `temp/real`, an
empty workspace folder, no network call and no Muse request:

```
panel                 → "panel needs --stdio: the editor’s host speaks to it on standard
                         input and output."                                              exit 2
panel --help          → Usage: muse-spark-code-acp panel --stdio [--workspace <directory>],
                         the purpose and note sentences, Options (--stdio, --workspace,
                         --verbose, --help), two examples                                exit 0
exec --help           → the --team line: "Run engine teams with Model API, acceptEdits and
                         a hard budget shared by every worker; prompts deny, merges enter
                         the run working tree."                                          exit 0
```

Not run through the product, and why: **`exec --team`** (it reads the OS
credential store first, which on this MacBook is the owner's login Keychain; its
refusal without a second runnable model is proven by `teamAvailability`'s `prepare`
cases over real temporary folders and the real state file), **a live
`panel --stdio` handshake** (the sign-in gate reads the same store; the handshake,
chat, paid use, git and plans are proven on the production build by the
`runtimePanel*` suites, whose environment is isolated), the MCP endpoint in an
editor window (Electron cannot start here), the packed Windows package (it does
not run on macOS), and any provider or Muse request.

## 7. Red/green drills

Each: one edit on the merged tree, the owning suite, the non-zero exit, restored
(`cmp` against a copy), the same suite green.

| Break                                                                  | Caught by                                                                                                                              | red | green                                                                      |
| ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | --- | -------------------------------------------------------------------------- |
| `teamHostBinding.ts`: `endpointForConversation` returns `undefined`    | `teamMcpWiring` "serves the five tools…" (`.toMatch() expects… undefined`)                                                             | 1   | 0                                                                          |
| `resources.ts`: a shared resource's default limit put back at 2        | `teamResources` "admits every call at once: no default cap of ours" (`call 2: busy`)                                                   | 1   | 0                                                                          |
| `teamAdmission.ts`: `Math.min(maxDepth, 3)` put back                   | `teamAdmission` "honours the person’s depth bound…"                                                                                    | 1   | 0                                                                          |
| `teamAvailability.ts`: `checkTeamAvailability` never refuses           | `teamAvailability` (the lead alone; the sameModel dedupe)                                                                              | 1   | 0                                                                          |
| `retryPolicy.ts`: the provider-named wait dropped from `retryDelayMs`  | `modelApiRetryNoCount` "honours a provider-named wait whole", `providerRetryLimits` "waits out a provider wait longer than one timer…" | 1   | 0                                                                          |
| `settingsStore.ts`: a resource setting accepted in the workspace scope | `runtimeSettingsStore` "keeps a machine-scoped setting the person’s alone"                                                             | 1   | 0                                                                          |
| `execLedgerLeaseEntry.ts`: the lease replaced by a bare call           | `execTeamSweep` "a ledger write waits for another holder of the folder lease, then lands"                                              | 1   | 0 on its 2 lease cases (the file's exit is 1 from the base case, §5 row 2) |
| `landingJournal.ts`: `prepare` no longer writes the intent             | `teamLandingKilled` "a SIGKILLed lander blocks, then confirmed takeover recovers its record"                                           | 1   | 0                                                                          |
| `knip.jsonc`: the two barrels removed from the entries                 | `npm run deadcode` (8 unused exports)                                                                                                  | 1   | 0                                                                          |
| `acpBundles.mjs`: `reportFallback.js` removed from the agent package   | `gen-lazy-registry --check` ("loads reportFallback.js in the agent, and its package does not carry it")                                | 1   | 0                                                                          |

The lanes' own drills (teamcore's three, teamwire's nine, teamgate's four,
autoretry's five, RVM104B's five) are in their records and ran on their bases.

## 8. Not run, and open decisions

Not run, with the reason:

- The VS Code integration suites (Electron cannot start on a macOS lane), the
  browser suites (`test:a11y`, `teamModelsFirstPaint`, `devicesPhase2Harness`),
  `ui:look`.
- The vault and OS credential-store suites (rule), `runtimeLsp` (cannot pass
  under a macOS temp folder).
- Windows-only code and suites (the CLR ACL paths, `deviceWorkerHostNative`);
  hosted CI's Windows legs must confirm the merged tree.
- Any Muse request, real conversation, paid provider call, real team run, or
  forwarding-proxy retry proof against the real service (autoretry's open item 1).

Open decisions for the lead:

1. **Four bundle budgets are over on the merged tree; `npm run build` is red.**
   The sizes, with the base and where each came from (each merge was built
   alone): `dist/teamHost.js` 107.6 → 129.6 after RLF-TEAMCORE → **140.2** after
   RLF-TEAMWIRE (budget 130: +10.2); `dist/teamRunners.js` 66.7 → **78.4** after
   RLF-TEAMCORE, the three Traffic modules (budget 75: +3.4); `dist/teamScheduler.js`
   72.0 → **76.5** after RLF-TEAMCORE, `board.ts` +1.7 KB and `teamPool.ts` +1.7 KB
   (budget 75: +1.5); `dist/uiText.js` 127,869 B (124.9 KiB) on the base, 127,853 after RLF-TEAMCORE, 128,013 after RLF-TEAMGATE
   (+160 B across RLF-TEAMWIRE and RLF-TEAMGATE) → **128,341** (125.3 KiB) after the last two merges (+328 B; budget
   128,000 B: 341 B over).
   Tried and reverted: moving the Traffic read and dispatch into `dist/teamWindow.js`
   took `teamRunners.js` to 66.8 but `teamWindow.js` from 46.1 to **87.1** KiB (the
   projection pulls the models-panel schemas); moving the panel-only UI keys into
   the runtime English region saved 83 B of the 341. Options: (a) the team MCP
   server (`teamMcpServer.ts` 4,977 B, `mcp.ts` +1,725, `teamToolSchemas.json`
   1,844, `roster.ts` +1,337) into its own lazily loaded bundle `dist/teamMcp.js`
   (about 10 to 12 KB: just enough for `teamHost.js`); (b) Traffic in a lazy bundle
   of its own, and the window-only members out of `TaskBoard` and `TeamScheduler`
   for `teamScheduler.js`; (c) more keys into deferred English regions or shorter
   words for `uiText.js`. Recommendation: one "fit the team bundles" lane before
   int is released, doing (a), (b) and (c) with a measured budget for each new
   bundle; never a raised budget. Until then hosted CI's build step is red.
2. **The deleted `teamHostService` suite leaves three behaviours without a unit
   proof:** `finalAdmit` and the ordered merge queue (RLF-TEAMCORE), and that the
   merge is planned before its card (RLF-TEAMWIRE). Options: (a) accept: the
   real-process suites cover landing, recovery and the planner's own answer;
   (b) a real-code suite over `createTeamHost` with the real engine ports that
   drives a finished task to its merge card (needs a worker that finishes, which
   needs a model or a recorded worker session). Recommendation: (b) once a
   recorded worker session exists; (a) until then, and the CHANGELOG already
   claims neither.
3. **The release latch is gone (D227), so teams are reachable on int with two
   models set up, and no real team run has been made through the packed product.**
   Options: (a) accept: the owner's decision is the rule; (b) hold the next
   release until the real-life run includes a team run (the packed product,
   `muse-spark-1.3-contributor` and a second cheap model, calls counted first).
   Recommendation: (b): the rule on nothing claimed before it works in real use
   already decides it; the CHANGELOG says "no real team run has been made on this
   build".
4. **The depth bound has no reader and no setting yet** (§2.6), and other fixed
   team numbers remain unexamined against the same clarification:
   `TEAM_TASKS_PER_TURN_DEFAULT` (6), `TEAM_TASK_MINUTES_DEFAULT` (30),
   `TEAM_TASK_MAX_REQUESTS_DEFAULT` (20) and `…_WRITER` (40),
   `TEAM_LEASE_WAIT_MS` (300 s). Recommendation: when worker delegation is wired,
   add `museSpark.teamMaxDepth`; the other five need a per-constant read (cap on
   the person's work, or a guard on a failure) as its own small lane.
5. **Two test seams may count as stand-ins.** `museCodeAutoResend` drives the real
   controller over a recorded exchange but injects the resend wait's clock and
   jitter (`resendSleep`, `resendRandom`) so a 1 to 8 s backoff does not run in
   real time; `teamAvailabilityRig` (int's own, used by RLF-TEAMGATE's cases)
   builds the binding over an inert factory and engine. Options: leave them
   (they are test ports of the product's own dependency interfaces), or run the
   resend cases in real time (about 2.5 s a case at the default 0.5 s base). I
   left them; this is the lead's reading of "tests run real code only".
6. **Still open from the lanes, unchanged by this round:** RLF-TEAMWIRE's three
   named questions (the roles-file loaders, the ACP and Muse Code worker entries,
   and `requestCheckSlot`, which still has no caller); RLF-AUTORETRY's items 1 to
   4 (the forwarding-proxy proof, an ACP-agent-internal resend, a panel control
   and a headless flag for the maximum); RVM104B's F4 (the panel's usage history
   and accounts), F6 (a person-set `modelApiSessionBudgetUsd` unenforced in every
   runtime backend), F7 to F9, and the lane's five questions; CC-INT4's items 1 to
   7, including the two dated ones (Marketplace publishing off the personal
   access token **by 2026-12-01**, and ACP SDK 2.0.2 past its 7-day window on
   2026-10-31).

## 9. Commits

`dfcb45936` → this record: the five merges (`b0be6d772`, `7c7ad54ff`,
`f7d3741b2`, `75d80fbd4`, `e90b711d3`), the lanes' own 75 commits beneath them
(13 + 29 + 6 + 6 + 21; of the 29, 20 are RLM116's commits, its merge and the
renumbering, which int keeps through `cc/rlm116`, and the tree takes the other
nine), the eight `fix(int)` commits (`7484fa0b9`, `c4f1b7382`, `37345c4a1`,
`410813305`, `75a91cb5b`, `022a2b8ac`, `9663a42e1`, `d3c0f2ec3`), `docs(plan)` and
the commit carrying this record (231 files changed before the record, +20,401 / −1,583).
