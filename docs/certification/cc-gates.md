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
