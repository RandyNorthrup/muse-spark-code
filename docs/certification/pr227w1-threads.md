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
