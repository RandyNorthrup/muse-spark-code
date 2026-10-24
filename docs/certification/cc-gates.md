# CC-GATES — int/recovery's red gates after four merge rounds, fixed in the code

Windows PC, worktree `C:\Users\Randy\Coding\mx-cc-gates`, branch
`cc/gates`, base int/recovery `d81327d360`. No paid or live model calls.
No push, rebase or touch of another branch. No gate loosened, no budget
raised, no baseline regenerated over new debt. The vault and
credential-store suites (`**/vault/**`, keyringParts, keystoreOwner,
credentialLease) were never run on this PC. Temporary files stayed in
the worktree's ignored `temp/` (TMP/TEMP and GIT_CEILING_DIRECTORIES
pointed there for every vitest run).

## Item 1 — `npm run -s check:catches`: RLM108's 24 catch sites

Measured on `d81327d360`: 24 sites the baseline never accepted, all
from RLM108 (several accounts per provider): core SWALLOW 71→72,
GENERIC 249→253, CLEANUP 238→240; host SWALLOW 18→19, GENERIC 95→98;
runtime SWALLOW 32→34, GENERIC 185→192, CLEANUP 131→133; webview
SWALLOW 9→11. Exit 1.

Each site now handles its named condition (NARROW) or keeps its cause
(REPORTED); `scripts/catch-baseline.json` is unchanged and matches
exactly, so no accepted debt moved.

| Site                                                             | Was               | Now                                                                                                                                                                                                          |
| ---------------------------------------------------------------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `core/accounts/pool.ts` admission chain                          | CLEANUP           | no catch: `await Promise.allSettled([operation])` waits for the prior admission (the repo's serial-chain form, `windowPresence.ts`); its caller receives the refusal from `operation`                        |
| `core/paid/accountPaidConsent.ts` `quoteGrantEpoch`              | SWALLOW           | NARROW: only `SyntaxError` (not JSON) is no epoch; anything else rethrows                                                                                                                                    |
| `core/paid/accountPaidConsent.ts` write chain                    | CLEANUP           | no catch: `Promise.allSettled([previous])`                                                                                                                                                                   |
| `core/backends/modelapi/ModelApiHost.ts` stream retry (2 sites)  | GENERIC ×2        | the decision moved to `isStreamRetried`; the handler retries or rethrows unchanged (REPORTED); a retry-limit read failure logs its kind with `failureForLog` and the attempt's own failure stands (REPORTED) |
| `ModelApiHost.ts` image egress fence                             | GENERIC           | NARROW: only the fence's own `AbortedError` returns the refusal                                                                                                                                              |
| `ModelApiHost.ts` turn end                                       | GENERIC           | NARROW: a hook cancel, the person's Stop and a failure are three branches; the hook-stop log no longer reads the error inside its argument                                                                   |
| `host/models/modelsPanel.ts` accounts request                    | SWALLOW           | REPORTED: `failureForLog` before the typed `unavailable` reply                                                                                                                                               |
| `host/paid/accountPaidFiles.ts` (3 sites)                        | GENERIC ×3        | NARROW through `isStoreErrorCode` (ENOENT / EEXIST)                                                                                                                                                          |
| `runtime/dailyBudgetSetting.ts`                                  | GENERIC           | NARROW through `isStoreErrorCode(error, 'ENOENT')`                                                                                                                                                           |
| `runtime/providers/accountRequestJournal.ts` files/load          | GENERIC ×2        | REPORTED: the fixed refusal carries `cause`                                                                                                                                                                  |
| `accountRequestJournal.ts` `isAlive`                             | GENERIC           | NARROW: ESRCH → gone, EPERM → alive, anything else refuses with its cause                                                                                                                                    |
| `accountRequestJournal.ts` write                                 | SWALLOW + GENERIC | REPORTED/NARROW: a failed write removes its temporary (`removePending`, ENOENT is already gone) and refuses with its cause                                                                                   |
| `runtime/providers/accountsCommand.ts` (2 sites)                 | GENERIC ×2        | REPORTED: `return accountsFailed(deps, …, error)`, the authCommands form                                                                                                                                     |
| `runtime/providers/runtimeServices.ts` observers (2 sites)       | CLEANUP ×2        | REPORTED: the services take the caller's logger (`log`, required) and log the kind with `errorNameForLog`; the editor passes its channel, the CLI and agent their stderr logger                              |
| `runtimeServices.ts` owner start                                 | SWALLOW           | REPORTED: evicts and logs the kind                                                                                                                                                                           |
| `webview/models/sections/accounts/AccountsSurface.tsx` (2 sites) | SWALLOW ×2        | REPORTED/NARROW: failures go to the host's log through `webviewErrorReport`; a request withdrawn as the surface closes is its own `AccountsRequestWithdrawn`, not a failure                                  |

Drill (2026-10-23): `accountRequestJournal.ts` `files()` put back to
`catch { throw new Error(UI_TEXT.sessionBudgetStoreUnavailable) }`:
`node scripts/catch-inventory.mjs --check` →
`src/runtime/providers/accountRequestJournal.ts:135: new GENERIC catch site; handle or report the failure`,
`runtime: GENERIC rose from 185 to 186`, exit 1. Restored: `All catch
sites and counts match the baseline`, exit 0.

Checks on the change: host, webview and unit typecheck exit 0; eslint
and prettier on the 15 changed files exit 0; vitest (accountErrorTruth,
accountPool, accountsCommand, runtimeCatchHandlers,
modelApiRetryNoCount, providerRetryLimits, turnRetryCeiling,
turnRetryResubmit, providerSpend, paidMoneyStructure,
providerKeyConfirm, providerOutputCap, grokPlan, subscriptionCopilot,
runtimeDailyBudget, modelsPanelVaultSection) 16 files, 287 passed,
4 skipped, exit 0.

## Item 3 — the `pathGuardSpawns` suite: RLM125's two process starts

Measured on `d81327d360`: `every governed launch is guarded or
reviewed` failed on `src/core/backends/modelapi/ModelApiHost.ts:
spawnResourceProcess:8976` (M125 F1b's B1 inspect helper as a raw
governed launch), and `every direct process start is guarded or
reviewed` listed `src/core/judge/setup/runtime.ts: spawn:141` (M125
lane H's private Ollama server, a direct `node:child_process` spawn)
beside seven RLM110A0/RLM110B sites.

Both now go through the governed command boundary in
`src/core/resources/commands.ts`, the one place a command resolves
(`resolveCommand`: refused inside the folder the child runs in, refused
unless it exists) and gets the guarded child environment for it:

- `spawnResourceFile(profile, command, args, options)` is that
  boundary's piped launch, exported through the lazy launcher
  (`launcher.ts`, `resourceProcessEntry.ts`); the bounded
  `execResourceFile`/`execResourceFileBytes` share it, so nothing is
  duplicated.
- The B1 helper keeps its bootstrap admission:
  `spawnResourceFile('bootstrap', file, args, options)`.
- The Ollama server starts with `spawnResourceFile('contained', …)`:
  admitted and contained like every process we start, its pipes
  drained, one stop for its whole tree. `startRuntime` is async, the
  setup flow awaits it, and the hand-rolled SIGTERM/SIGKILL `stopProcess`
  (now unused) and its test are gone. A missing binary is refused at the
  boundary (`Governed command unavailable`).
- The suite's wrapper list now tracks `spawnResourceFile` too (stricter:
  each caller is inventoried), with its three guarded callers recorded
  and anchored (`commands.ts`, `ModelApiHost.ts`,
  `judge/setup/runtime.ts`).

Drills (2026-10-23):

- `ModelApiHost.ts` back to `spawnResourceProcess('bootstrap', …)`:
  `every governed launch is guarded or reviewed` fails with
  `src/core/backends/modelapi/ModelApiHost.ts: spawnResourceProcess:9012`;
  restored, it passes.
- A direct `spawn(binary, ['serve'], …)` put back in
  `judge/setup/runtime.ts`: the direct-start test lists
  `src/core/judge/setup/runtime.ts: spawn:142`; restored, the line is
  gone.

Not in this item: the direct-start test still lists seven sites from
RLM110A0/RLM110B (the home node and the TUI), not RLM125:
`src/runtime/node/gitRunner.ts` (execFile:106),
`src/runtime/node/tls/certificate.ts` (execFile:177),
`src/runtime/node/toolHost.ts` (spawn:264),
`src/runtime/node/workspaces/devcontainer.ts` (execFile:347, 483),
`src/runtime/node/workspaces/git.ts` (execFile:372),
`src/runtime/node/workspaces/snapshots.ts` (execFile:191),
`src/runtime/tui/design/capabilities.ts` (execFile:97).

Checks: host and unit typecheck exit 0; eslint and prettier on the 11
changed files exit 0; `check:catches` exit 0; vitest judgeSetupRuntime,
judgeSetupFlow, judgeSetupCli, judgeSetupController, pathGuard,
pathGuardRound4/6/7, resourceHandoffDeadline all pass; pathGuardSpawns
6 of 7 pass (the seventh is the RLM110A0/RLM110B list above).

## Item 2 — `npm run -s duplication`: RLM125's 41 clones

Measured on `d81327d360`: 41 clones (jscpd, 50 tokens / 5 lines,
threshold 0), every one in RLM125's fast judge and setup wizard code or
its tests. Now 0, with `.jscpd.json` unchanged. Every block exists once:

- Both hosts' fast-turn boundary (turn start, turn end, the done and
  failure verdicts, the loop episode, the event) is one
  `FastTurnBoundary` (`src/core/judge/fast/turnEnd.ts`); ModelApiHost
  and MuseCodeHost supply only what differs (their backend name, pin,
  switch, the finished turn's texts, the emit).
- `cascade.ts`: the engine's answer and throw outcomes are two helpers
  both deadline paths call.
- `controller.ts`: the install step reuses `plan()`.
- `setupCli.ts`: the three steps parse and refuse flags through
  `stepFlags`.
- `judgeFastTurn.ts`/`judgePanelSchema.ts`: one `fastCountSchema`.
- The Models & Agents panel and the setup wizard share the panel
  document, failure page and link opener
  (`src/host/views/panelDocument.ts`), the page failure record
  (`src/webview/pageReport.ts`), the crash boundary and its view
  (`src/webview/components/PageBoundary.tsx`) and one control stylesheet
  (`src/webview/models/controls.css`); the wizard's buttons take the
  identical models classes, so nothing renders differently.
- The integration suites share `waitForTab` (`test/integration/tabs.ts`).
- The unit suites share six helpers under `test/unit/helpers/`
  (`judgeSetupWorld`, `userCapabilities`, `evalTaskShape`,
  `judgeFastFixtures`, `calibrationDataset`, `liveTurn`) and in-file
  helpers for the self-clones; every assertion checks what it checked.
  `judgeAccuracyChecks`'s channel-routing test now states which checks
  reach each §7 channel instead of mirroring the table literal.

Drills (2026-10-23):

- The link opener inlined back into `modelsPanel.ts`: `npx jscpd` exit
  1, `host\models\modelsPanel.ts [1042:40 - 1050:66] (9 lines, 57
tokens)` against `host\views\panelDocument.ts`; restored, `Found 0
clones.`, exit 0.
- `judgeSetupWorld.ts`'s table row `downloadBytes` changed from
  4_500_000_000 to 4_400_000_000: vitest exit 1 ("judge setup CLI >
  prints the setup plan and installs nothing without --yes", "setup
  controller > opens on an idle scan and scans onto the
  recommendation", "setup recommender > picks the most accurate
  verified row that fits, faster on ties"); restored, the four setup
  suites 45/45, exit 0.

Local look (production build, `npm run ui:look`):
`judge-setup-recommend-advanced` in light and dark
(`cc-gates-judge-setup-light.png`, `cc-gates-judge-setup-dark.png`) and
`models-configure`: the buttons, link and select render as before; the
built `dist/webview/judgeSetup.css` carries the shared rules.

Checks: host, webview, unit and integration typecheck exit 0; eslint and
prettier on every changed file exit 0; stylelint on the three sheets
exit 0; `check:tokens` 0 problems; `check:catches` exit 0; vitest over
the 40 judge, setup, panel and eval suites: 499 passed, 1 skipped, 7
failed in two suites this change does not touch and that fail the same
way on this PC without it (`judgeB2Snapshot`: Windows `symlink` EPERM
without the privilege; `judgeApprovalFloor`: two POSIX-path floor
cases). `judgeB2Baseline` (Windows git refuses its
`GIT_CONFIG_GLOBAL=//./nul`) and `judgeB1HoldDrill` (Linux/macOS helper)
fail or skip on this PC before and after; their edited helpers
typecheck and lint and run on Linux CI.

## Item 4 — `npm run -s build`, lazy-registry step: 7 problems

Measured on `d81327d360` after `node scripts/build.mjs --production`:
`gen-lazy-registry --check` exit 1, 7 problems. Two causes:

- `NODE_WORKSPACE_ASSET = './node/files/main.js'` (M110-U1) named the
  node workspace page's script, which only the separate harness build
  (`test/harness/build-node.mjs`, "C/M104 adds this to the release
  build") emits. The chat page never loads that script by name — the
  node's binding supplies it (`loadWorkspace`); it only links the
  stylesheet beside it. On a production build the name fell back to its
  basename and resolved to the chat bundle `webview/main.js`, attributed
  to `src/shared/constants.ts` (in every chunk, the agent's too): "loads
  webview/main.js in the agent, and its package does not carry it", and
  `webview/main.js`, `webview/referencePage.js` and
  `webview/resourceSurface.js` turned `both`. The constant now names what
  the chat page loads, `NODE_WORKSPACE_STYLESHEET =
'./node/files/main.css'` (same URL as before, still pinned by
  `nodeSurface.test.ts`).
- The committed registry kept rows for `nodeAuth.js`, `nodeAuthPage.js`
  (`npm run build:node-auth`, a separate command) and
  `webview/node/files/main.js` (the harness): leftovers of other builds
  in the lane's `dist/`, which the registry, written from the production
  build, never lists (RLF-HYGIENE). Regenerated from a clean production
  build: those three rows go, `packsVerify.js` returns to its sorted
  place, and `resourceProcess.js` gains the new `spawnResourceFile` load
  (item 3).

The shared panel document (item 2) first hid the two panel script loads
from the registry's scan; each panel now builds its webview URIs where
it resolves its bundle (`asWebviewUri(… JUDGE_SETUP_WEBVIEW_SCRIPT_FILE)`
on one line), so `webview/judgeSetup.js` stays told apart from the
runtime's `judgeSetup.js` and both rows keep their requesters.

Drill (2026-10-23): the constant back to `'./node/files/main.js'`:
`gen-lazy-registry --check` exit 1, "src/shared/constants.ts:367
(NODE_WORKSPACE_STYLESHEET) loads webview/main.js in the agent, and its
package does not carry it" plus the three side rows; restored, "ok lazy
registry: 169 bundles, 272 loads by file name resolved … is current",
exit 0.

After a fresh production build every step after the size check passes:
bundle split 0, lazy registry 0, host globals 0, third-party notices 0,
legal build records 0 (156 bundles, 0 problems). `nodeSurface.test.ts`
4/4.

## Item 5 — `npm run -s build`, size step: 12 bundles over budget, and reportInputs

Measured on `d81327d360`: 12 bundles over their unchanged budgets, and
`dist/reportInputs.js` inside only because RLM95 had raised its budget
from 100 KiB (its value on `f3941b8548`) to 116 KiB. That budget is back
to 100 KiB. No other budget was raised, changed or removed, no gate was
loosened; three new lazy bundles got budgets of their own by D6 (part 2).

| Bundle                        | Before (budget)  | After (budget)           |
| ----------------------------- | ---------------- | ------------------------ |
| dist/modelApi.js              | 575.0 KiB (525)  | 521.8 KiB (525)          |
| dist/uiText.js                | 128.6 KiB (125)  | 122.6 KiB (125)          |
| dist/modelsPanel.js           | 159.5 KiB (150)  | 133.0 KiB (150)          |
| dist/wire.js                  | 79.2 KiB (75)    | 74.2 KiB (75)            |
| dist/modelApiBoundaries.js    | 55.3 KiB (50)    | 46.5 KiB (50)            |
| dist/reportingPanel.js        | 51.4 KiB (50)    | 46.9 KiB (50)            |
| dist/usageService.js          | 101.4 KiB (100)  | 97.0 KiB (100)           |
| dist/teamScheduler.js         | 76.0 KiB (75)    | 72.0 KiB (75)            |
| dist/estimateContracts.js     | 25.6 KiB (25)    | 20.9 KiB (25)            |
| dist/teamWorkerOps.js         | 17.3 KiB (17)    | 12.8 KiB (17)            |
| dist/vaultBrokerBindings.js   | 37.3 KiB (37.24) | 32.9 KiB (37.24)         |
| dist/webview resource history | 50.3 KiB (50)    | 49.3 KiB (50)            |
| dist/reportInputs.js          | 102.6 KiB (116)  | 98.4 KiB (100, restored) |

### Part 1 — dead constants out of every bundle, English and shared modules in their lazy places

- **Folded constants** (`scripts/lib/foldedConstants.mjs`, production
  builds only, beside `compressedModelText.mjs`). esbuild 0.28 keeps any
  top-level constant written as arithmetic (`5 * 60_000`) or as a
  template over other constants in every bundle that imports anything
  from `src/shared/constants.ts`, used or not; plain literals, objects and
  arrays it drops. A bundle reading one constant carried 4,597 B of the
  file; folded, 9 B. Every merged lane's new tunables had grown every
  bundle, which is why so many sat a few hundred bytes over. The fold
  writes each such initializer (and object property / array element) as
  the literal it evaluates to with the same JavaScript operators in the
  same order; strings fold only from literals and constants folded above;
  imports, calls other than `Math`'s rounding and bounds, member reads
  other than the file's own literal objects and `Number`'s safe-integer
  bounds, and non-finite or negative-zero values stay as written. The
  source keeps its readable derivations; `compressedModelText` folds
  before it compresses; every production bundle gets the plugin appended
  after its own. This fitted reportInputs, reportingPanel,
  usageService, teamWorkerOps, teamScheduler, vaultBrokerBindings,
  estimateContracts and wire.
- **uiText.js**: the English of first-use surfaces moved into the
  `surfaces` region (`dist/uiTextSurfaces.js`, read on first use by the
  shared fallback's accessors): the setup wizard and its CLI steps, the
  Judge section, the judge's paid asks, the device and desktop surfaces.
  uiTextSurfaces.js 12.6 → 19.1 KiB (budget 25).
- **modelsPanel.js** reads the redaction, vault-schema and money modules
  from the shared boundary chunks like every other Node consumer
  (`sharedModelApiBoundaries` in its build options) instead of a copy.
- **Resource history**: each resource root now installs only the English
  it reads (`browser-resource-history-english` beside
  `browser-resource-english`). The closure is mostly zod core; with
  today's zod even main's sources measure 51,297 B there.

Tests: `test/unit/foldedConstants.test.mjs` builds the real constants.ts
as written and folded and requires every export identical (functions by
source, collections by entries), shows the folded build carries less of
the file for a one-constant entry, and pins exactness and the cases left
as written. 4/4.

Drills (2026-10-24):

- Multiplication folded wrongly (`a * b + 1`): the test exits 1, "exports
  every constant with the value the source gives it" lists the drifted
  constants (ACP_MAX_MESSAGE_BYTES, ACP_MESSAGE_HEADROOM_BYTES, …);
  restored, 4/4.
- The fold switched off (`foldConstantSource` returning its input) and a
  production build: `check-bundle-size` exit 1 with 10 OVER lines
  (reportInputs 102.6/100, reportingPanel 51.4/50, modelApi 525.7/525,
  modelApiBoundaries 50.5/50, usageService 101.4/100, teamWorkerOps
  17.3/17, teamScheduler 75.9/75, vaultBrokerBindings 37.3/37.24,
  estimateContracts 25.6/25, wire 78.7/75); restored and rebuilt, exit 0,
  no OVER line.

### Part 2 — dist/modelApi.js and dist/modelApiBoundaries.js, fitted by weight

Measured with the folded-constants build: `dist/modelApi.js` 585,670 B
against 537,600 B (525 KiB), `dist/modelApiBoundaries.js` 52,511 B
against 51,200 B (50 KiB); exit 1. 0.19.0 built the backend at
533,481 B: the growth was RLM125's fast judge (the B1 hold, the reflex
decisions and their host methods) and RLM108's billing, and the boundary
grew by the file-tool edit helpers RLINTFIX moved into it. No budget was
raised or changed and no gate loosened; code not needed at load moved
into chunks loaded on first use through the existing cohort, and one
duplicate became shared. Each step measured with the production
plugins and folding (the same byte count the build gives):

| Move                                                                                                                                                                                                                                                                          | dist/modelApi.js                         |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| The B1 hold to the new `dist/modelApiB1.js` (`b1Hold.ts`: the runner's opening, the race, the audit; with approval, inspectExec, inspectGrammar, fastPathAudit); loaded on the first shell ask that reaches the hold with a packaged helper, never without one                | −16,176 B                                |
| What a tool call or goal command runs to the new `dist/modelApiToolRun.js` (executeTool's file and shell execution, the memory tool's placing and running, the browser check's placement and report, the goal rules), loaded on the first of them                             | −22,196 B                                |
| The fast judge to the new `dist/modelApiFast.js` (`fastJudge.ts`: the loop and triage observation, the effort and keep-list verdicts, the turn boundary and tail; with apply, engines, turnEnd, turnRecord and the reflex checks), loaded when each turn or compaction starts | −9,660 B                                 |
| `workspacePath.ts` shared from `dist/modelApiBoundaries.js` (it was inlined in about thirty Node bundles); the edit helpers out of the boundary (the backend keeps the three small ones it reads)                                                                             | −1,554 B                                 |
| An attached image's resize (`imageResize.ts`) into the existing `dist/modelApiImage.js`                                                                                                                                                                                       | −1,711 B                                 |
| **Now**                                                                                                                                                                                                                                                                       | **534,373 B** (521.8 KiB, 3,227 B under) |

`dist/modelApiBoundaries.js` is 47,590 B (46.5 KiB): the edit helpers
(`toolEdit.ts` 3,714 B, `codeText.ts` 622 B, and the 2,048 B partial copy
of `workspacePath.ts` only they needed) now ride `dist/modelApiToolRun.js`,
the chunk that runs the file tools; the byte-range execution, loaded only
from it, reads them there (`TOOL_EDIT_*` in deferredBundles.mjs), and
`workspacePath.ts` is a boundary source in full, so activation drops its
copy too (`dist/extension.js` 523,928 → 521,904 B).

New budgets (D6: measured × 1.15, rounded up to the next 25 KiB):
`dist/modelApiB1.js` 18,761 B → 21,575 B → 25 KiB;
`dist/modelApiToolRun.js` 70,934 B → 81,575 B → 100 KiB;
`dist/modelApiFast.js` 13,019 B → 14,972 B → 25 KiB. `dist/modelApiImage.js`
is 16,080 B under its existing 25 KiB.

Wiring, as for `dist/modelApiImage.js`: entries `modelApiB1Entry.ts`,
`modelApiToolRunEntry.ts`, `modelApiFastEntry.ts`; build options, watch
contexts and shipped specs; the cohort filter and `DEFERRED_OUTFILES`;
`ON_FIRST_USE` records with the backend as parent (the split gate fails
the backend carrying any of their files); the split gate's file lists
and text-block readers (`MODEL_API_MODEL_TEXT` and
`TOOLCHAINS_MODEL_TEXT` add the tool-run chunk, `FAST_PATH_MODEL_TEXT`
moves from the backend to the fast chunk); the host-globals, notices
and agent package lists; the VSIX allowlist; knip's entries; the
regenerated lazy registry and notices. The split gate gained one guard:
the tool-run chunk carries `toolEdit.ts`, the byte-range execution reads
it there with no copy, and the boundary carries none. The spawn
inventory's B1 entry follows the helper's start into `b1Hold.ts`.

Drills (2026-10-23), each a production build and both gates, then
restored:

- B1: the host imports `modelApiB1Entry` statically. Size exit 1, `OVER
dist/modelApi.js: 538.2 KiB (budget 525 KiB)`; split exit 1, "dist/modelApi.js
  carries src/core/backends/modelapi/b1Hold.ts, which loads only on the
  first shell ask through the B1 hold" (and the entry, approval,
  inspectExec, inspectGrammar, fastPathAudit).
- Tool run: the entry imported statically. Size exit 1, `548.3 KiB`;
  split exit 1, "dist/modelApi.js carries
  src/core/backends/modelapi/modelApiToolRunEntry.ts, which loads only on
  the first tool call or goal command it runs".
- Fast judge: the entry imported statically. Size exit 1, `532.0 KiB`;
  split exit 1, 13 problems: the entry, `fastJudge.ts`, apply, engines,
  turnEnd, turnRecord and the five reflex checks, and "dist/modelApi.js
  carries FAST_PATH_MODEL_TEXT … which only dist/modelApiFast.js,
  dist/museCode.js, dist/runtimeEngine.js read".
- The edit-helper guard: the byte-range build no longer pointed at the
  tool-run chunk. Size exit 0; split exit 1, "dist/modelApiFileRange.js no
  longer reads src/core/toolEdit.ts from dist/modelApiToolRun.js" and
  "… carries its own copy of src/core/toolEdit.ts".

Restored and rebuilt: size, split, lazy registry `--check`, host
globals, third-party notices and legal build records all exit 0.
