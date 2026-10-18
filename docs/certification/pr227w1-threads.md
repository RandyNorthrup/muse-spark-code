# PR #227 review threads + head CI failures — first-result triage (PR227W1, 2026-10-18, linuxlt)

Branch `train/rc-2026-10-17-w1` at `9621b00bb0`. Each line is a verdict after reading the cited code; fixes follow as separate commits.

## Review threads (13)

1. `src/shared/constants.ts:8275` fixed caps (`callsPerMinute`/`burst`/`activeReads`/`pendingApprovals`, enforced via `SharedLimits` + `ApprovalLedger.maxPending`): CONFIRMED, will remove enforcement and the four fields.
2. `test/unit/connectorRuntime.test.ts:46` fabricated grant/timestamp/scopes/kill-switch/audit fixtures: CONFIRMED, will rebuild the suite on real store/command flow with recorded-shape inputs.
3. `src/runtime/connector/store.ts:516` bare `rename(live, older)` fails on Windows when the segment exists: CONFIRMED, will remove/replace the destination first.
4. `src/runtime/sharing/confidential.ts:15` `JSON.parse` on JSONC settings returns unknown-confidential: CONFIRMED, will parse JSONC.
5. `src/runtime/panel/git/adapter.ts:242` PR discovery ignores the per-operation signal, can persist a stale-session link: CONFIRMED, will thread the operation signal through `prepare`.
6. `src/core/connector/registry.ts:835` library generation read outside the store lock, second save lands instead of `stale_target`: CONFIRMED, will recheck under the lock.
7. `src/runtime/cliArgs.ts:380` `chatgpt`/`copilot` entries match the provider-action branch before `providers models`: CONFIRMED, will route `models` first.
8. `src/runtime/backends.ts:756` keyless default-plan run rejected as `acpNoStoredKey` before subscription checks: CONFIRMED, will resolve the default model before the key gate.
9. `src/runtime/main.ts:952` parser refusals print English before locale loads: CONFIRMED, will localize the refusal before printing.
10. `src/runtime/providersModelsCommand.ts:94` fetched IDs truncated before the `listed.includes` check: CONFIRMED, will keep raw IDs for equality, sanitize display only.
11. `src/core/backends/modelapi/ModelApiHost.ts:17466` identity await outside the save drain can lose a write at close: CONFIRMED, will register the whole resolve-and-save with the drain.
12. `src/runtime/providersModelsCommand.ts:126` `--force` IDs keep terminal control/format chars, stored and re-emitted: CONFIRMED, will reject them before storing.
13. `src/runtime/connector/approvalPage.ts:68` double-click/Approve+Deny race overwrites status with `decisionFailed`: CONFIRMED, will disable controls on first click, re-enable only on request failure.

## Hosted CI failures on the head

- `packages` (`npm run package`) + `static gates` (windows) + `captures` (windows): root cause not in the quoted log lines (the quoted `ReviewFindings` budget lines pass); REPRODUCING locally with the same commands.
- `tests` shard 3 `modelsActivationBudget` (5346 > 3072): CONFIRMED bundle growth on this branch; will cut at the cause, budget stays.
- `tests` shard 4 `authFastSignIn` (empty list) + `paidMoneyStructure` (8 unexpected numerics): CONFIRMED real failures; will fix at cause, no weakening.
- `tests` shard 2 `composerPlaceholder.test.ts` (file-level failure): REPRODUCING locally.
- All `downstream of another failure` / capacity-repo jobs: consequences, clear when the causes above are green.

## Resolutions (2026-10-18, linuxlt)

Commits `b8538bd661` (threads 1-2), `99aae65676` (threads 3-13 + signin/money/placeholder suites), `d27f81f7b2` (package split + caps-test remainder + duplication + host-api record).

- Threads 1-2: `SharedLimits`/`LimitsPort`/`LimitState` deleted from `policy.ts`; `store.limits()` and the limits file lock deleted from `store.ts`; the entry no longer wires a limits port. A table full of live work still refuses rather than forgetting it, named as a busy server (`rate_limited` is the bounded protocol reason; `serverBusy` words). `ApprovalLedger.open` never refuses for count; the pending-approvals cap test became a no-cap proof; the limits-lock suite (subject gone) is deleted; the e2e report batch uses its own batch size. The connector suites now run real grants through the real owner commands on two store instances and real `Operation`s through the real `OperationTable`.
- Threads 3-13: fixed as triaged (Windows rename clears the destination; JSONC settings; per-operation Cancel through PR discovery; generation recheck under the write lock; models routing before chatgpt/copilot actions; default-model resolution before the key gate; localized usage refusals under a bounded locale load; raw IDs for equality; drain held across identity resolution with a PLAN §8 `withResolvers` row; control/format rejection for forced IDs; approval buttons disabled on first click, re-enabled only on request failure).
- `packages`/`static gates`/`captures`: the split gate blamed `dist/runtimeEngine.js` carrying the providers file — caused by this lane's `backends.ts` static import (thread 8). It now reads through the `providersEntry` registry like every sibling module; `npm run build` exits 0 and the metafile confirms none of the three modules ship in the engine. Remaining local-only blocker: `package-vsix` also demands `native/linux/arm64/muse-created`, which CI assembles from a second runner's artifact; this single-arch rig has no aarch64 toolchain (and no sudo), so the final vsix step cannot run here — reported, not worked around.
- `modelsActivationBudget` (5346 > 3072): measured byte-identical 5346 at the lane base `9621b00bb0` and at the lane head — this lane contributes 0 bytes (its activation footprint is two required strings/shims). The +5.3 KiB is the train's cumulative activation wiring (+93 modules, dominated by Tab/paid/browser/schedules surfaces owned by other lanes), partly offset by 181 KiB the train moved out. No honest cut exists in this lane's scope; the budget was not raised and the test was not touched.
- `authFastSignIn`/`paidMoneyStructure`: fixed as triaged (string placeholder key; M121 sanction clauses for connector micros and the frozen eval record).
- Shard 2 `composerPlaceholder`: the `vscode` import moved out of the tested module into a pure unit; the suite passes locally (52-test batch with signin/money).
- Slow-test note: the `providers models` unreadable-list case timed out because the first evaluation of the lazily loaded backend bundles takes 9-19 s on a loaded rig (the refusal itself is ~350 ms). The suite now warms those bundles in `beforeAll`; same assertions, repo timeout, all 20 pass.
