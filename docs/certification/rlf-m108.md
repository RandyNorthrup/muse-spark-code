# RLF-M108 — M108 lanes D (placement) and X (developer options)

2026-10-30, macbook rig, worktree `/Users/user/lanes/RLF-M108`,
branch `rec/rlf-m108`, base `d4761ac59` (int/recovery plus the RLM108
merge). Recovery lane: build lanes D and X from PLAN.md D88/D88.10, the
placement amendment (a) and the developer amendments (b, b2), over the
merged RLM108 code. No model calls; no credentials printed, copied or
stored; no push or rebase; every commit with hooks on and explicit
paths. No browser, GUI apps or keychain on this machine (the brief):
`ui:look`, the packed-product real-life run and editor-matrix rows are
named un-runnable below.

## What this lane built

### Lane D — account placement on devices (D88.10, amendment a)

- Pins live on the account rows (`device` in `providers.json`); a row
  without one reads as this machine. `AccountStore.pin` runs through
  the mutation queue and enforces `onePerDevicePerProvider` with the
  refusal naming the two ways forward; the routing layer's
  `AccountPlacements` backstops it (`0752501ad`).
- Terminal: `providers accounts add --device` with rollback of row and
  credential on an unplaceable pin, and `providers accounts place`
  naming a mistyped account before the routing layer is asked. The
  sender-local `FileRemoteLimitStore` backs `RemoteAccountPool`
  persistence (per-owner file, `wx` + `rename`, no prune sweep).
  Usage text and CLI routes name `place` (`cee4fdb81`).
- Routing and swaps by the pinned device's headroom; per-provider
  headroom bucket (`ample`/`some`/`none`) in offers; **Send to
  {device}**; the receiver's own record and confirmations, recomputed
  every call (`88d91bb91`, which also fixes the receiver's cached
  bucket refusing its own reservation across the `ample`/`some` cut —
  found by the drill, red run `child exited 1 before SERVED-2`).

### Lane X — developer options and local profiles (amendment b, b2)

- Setting undeprecated: `museSpark.accounts.severalOnThisDevice`
  (machine-scoped, off by default) is visible again with its original
  description in all 15 manifest tables (`8eb602f7c`); its reader
  (`readSetting`) restored in `src/host/settings.ts`.
- The Accounts page shows the switch beside each provider, backed by
  the setting. Turning it on runs decision 6's vendor-terms
  confirmation for that provider through the recorded per-machine
  grant (native modal, record, re-ask on row change all reused);
  denial restores the switch, turning off never asks. A raw Settings
  flip without the confirmation mark is reverted with a redirect to
  the Accounts page. Disabled where the policy record never offers
  accounts (`9681d6413`).
- The window's developer owner opens the shared machine folder, so it
  honours the terminal host's unlock, expiry and audit. Palette entry
  `museSpark.developerOptions` unlocks with confirmation and opens the
  page; the status bar carries the persistent **Developer Mode** badge;
  snapshots broadcast to every panel; the expiry notice fires on the
  refresh that expires the grant. `developerRequest`/`developerReply`/
  `openDeveloper` bridge the page, with the install's version riding
  replies for the seven-click unlock. A mistyped profile account reads
  invalid-request instead of unavailable (`e4e0491d7`).
- The Developer options page opens as its own lazy chunk (3.3 KiB JS +
  0.8 KiB CSS against the 25 KiB `DEVELOPER_UI_BUDGET_BYTES` cap) with
  state, expiry, **Reset**, profiles and the clicking version line;
  the panel header badges while unlocked (`da53e5c54`).
- Profiles keep the X core: slot registry (`developer-slots.json`,
  name→id only, no credential material), state folders, owner-only
  store, corrupt-file guard, audit file (`b47cdf3a7`). The runtime
  process start and pool registration stay open on M109's broker
  (`X-M109/K-CREDENTIALS`, `X-P/M-ADMISSION`): `runtime.start`
  rejects and `pool.register` throws `developer.unavailable`
  honestly, so no profile runs or registers silently.
- `/help` publishes the `museSpark.developerOptions` command
  (runnable), the `museSpark.accounts.severalOnThisDevice` setting
  and the developer details on the accounts feature. `exec` has no
  developer/placement flags and never opens the owner (structural
  refusal). The audit display on the page and in `/report security`
  (D93) stays a follow-up; the audit file itself exists and is
  proven.

## Proof

### D with M100 and M107: two real processes

`test/e2e/deviceAccountTwoProcess.e2e.test.ts` (+ driver): two real
processes, six phases green — ROUTED-1/2, MISSING-DEVICE-OK,
OVERLAP-STOP-OK, RESTORE-STOP-OK, WITHDRAWN-STOP-OK (~0.6 s test, repo
default timeout). Live M100 transport (pair epoch, permission,
governor) and M107 atomic reservation/relocation bind in RLF-DEVICES.

### X drills (all real code, repo default timeouts)

| Drill        | Break                               | Failing test                                                                                                                        | Result                                             |
| ------------ | ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| A-confirm    | skip `confirmSeveral`, always write | `leaves the setting off when the vendor-terms confirmation denies` + section `stays off with no write when the confirmation denies` | 2 failed, restored green (9/9)                     |
| B2-version   | version line posts `developer/read` | `reads a locked snapshot with the unlock hint and a clicking version line`                                                          | 1 failed / 5 passed, restored green (6/6)          |
| X-page-guard | page surface unlocks directly       | `unlocks the page surface through seven version clicks, never directly`                                                             | 1 failed / 4 passed, restored green (5/5)          |
| D-receiver   | cached bucket (pre-fix code)        | two-process drill phase 2                                                                                                           | `child exited 1 before SERVED-2`, fixed in product |
| X-golden     | divergent second-profile input      | `developerWireGolden`                                                                                                               | fails; flipped assertion fails too                 |

Core X drills D0–D11 stand in
`docs/certification/m108-x-developer-options-and-local-profiles.md`.

### Cross-profile wire golden (`94daf0efb`)

The same `/responses` token-count request sent from two profiles
through the real billing route and transport is byte-identical except
`Authorization` and the record's per-request ids. Keys
`test-only-golden-key-a/b` never leave the test file.

### Suites (this rig, repo default timeouts, ≤3 files/run)

- `accountPlacement` (10), `accountsHandlerErrors` (6),
  `modelsAccountsSeveral` (3), `editorDeveloper` (5),
  `developerOptionsPage` (6), `developerOptions` (12+),
  `developerProfiles` (6), `developerContracts`,
  `developerMachineId`, `developerWireGolden`, `accountErrorTruth`
  (16), `accountsCommand`, `providerKeyConfirm`,
  `runtimeCatchHandlers`, `featureCatalogDetails`, `cliHelpConsistency`:
  all green. `commandHelp` has 1 pre-existing failure (`judge` help
  two lines) failing identically at the merge base `d4761ac59`.
- `tsc` (host, webview, unit, e2e), `eslint --max-warnings=0`
  (touched files), `prettier`, `check:l10n` (0 problems),
  `check:reference`, `check:host-api` (0, record regenerated),
  `check:roadmap` (after §10/record updates): green.
- `npm run build`: this lane's chunk 3.3 KiB JS + 0.8 KiB CSS
  (budget 25 each, holding). The recovery rule forbids raising a
  budget, so the lane reports instead of re-baselining: 12 budgets
  flip on this branch from its shared growth (connectorStoreGuard
  18.0/18, estimator 80.1/80, reviewer 75.1/75, runtimeQuestions
  25.4/25, teamEngine 101.7/100, teamFileIo 11.5/10, teamMerge
  12.1/12, teamWorkerOps 19.6/17, usageService 102.7/100,
  vaultBrokerBindings 39.6/37.24, vaultPosix 26.6/25, vaultRuntime
  25.9/25 KiB), and 9 were already over at the merge base
  (`modelApi` 546.5/525, `modelsPanel` 154.8/150, `reportInputs`
  104.2/101, `reportingPanel` 53.3/50, `resourceGovernor`
  126.9/125, `resourceAdmission` 28.1/25, `estimateContracts`
  28.0/25, `vaultActions` 28.0/25, `wire` 79.0/75 KiB). Only the
  two entries the lane's own chunk requires were added; every
  other budget file line is untouched. The lead re-baselines once
  at integration. `check:catches` is likewise red at the base
  across core/host/runtime (baseline predates the RLM108 merge);
  this lane adds no new SWALLOW/GENERIC site of its own (its
  catches classify NARROW/REPORTED) and does not touch the
  baseline.

### Could not run here (brief §Proof)

- `npm run ui:look -- <scene>` for the badge (no browser).
- The packed-product real-life run and editor-matrix rows (no
  GUI/keychain; real-provider spend is the owner's call).
- Hosted CI (Windows separators handled by normalising to `/`).

## Open handoffs (unchanged owners)

- `X-M109/K-CREDENTIALS`, `X-P/M-ADMISSION`: profile process start
  and pool registration wait for M109's broker (lane M).
- `RLF-DEVICES`: live M100 transport + M107 reservation/relocation
  for routing.
- Q-M108 captures (owner): Muse Code accounts, replay/cache.
- D93: audit display in `/report security`; the page's audit section
  rides the same reader.
