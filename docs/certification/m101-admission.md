# M101 C-M101-1 certification — RVCM1011 admission repairs

CM1011R2, branch `c/m101-1`, base `f733a4692`, macmini, 2026-10-10.
All eight RVCM1011 findings are repaired. Production remains inactive behind
`IS_AUTO_COMPACTION_EVALUATED = false`; no live or paid calls were made.

## Admission and ownership

- Automatic compaction has a dormant identity in the existing paid registry, using
  `modelApiAutoCompaction`, the paid gate, popup, workspace grants, badge and
  request tally, and marks the accepted transcript row paid. Before its first charge, the popup names the selected
  model's token rates and the current shared daily budget. Once covers the
  window (ACP: this workspace within this agent process); Always is workspace scoped
  and revocable. A disabled gate or denial admits no extra request.
- ACP's `--auto-compaction` is an explicit paid opt-in through its existing
  flag mechanism and editor permission prompt. Without it, ACP refuses this
  extra. Exec accepts no such opt-in and its paid defaults remain off.
  Existing `--no-auto-compaction` and the unevaluated production latch remain.
- The shared adapter reserves at HTTP preparation, after memory hooks and
  preflight. Every retry, fallback and structured arm gets a fresh claim.
  The final synchronous fence rechecks that claim and the paid gate.
  Near-window/overflow bypass economic heuristics only: daily Stop,
  unreadable storage, missing claims and the hard daily cap refuse spending.
  Unpriced provider cards remain C-M101-4 scope and cannot authorize an extra.
- A started request settles returned usage at exact catalogue cost; 429 is
  a known nonsend and refunds; missing usage retains uncertain liability.
  Cleanup refunds prepared-but-unsent claims. A late reservation after Stop
  refunds before rejecting. Settlement is awaited before retry/fallback or
  ordinary continuation; its failure terminates the owning turn.
- VS Code owns the adapter's daily claims. ACP/exec use their existing
  `withRuntimeAccounting` transport as the sole daily claim/debit owner,
  including its hard exec accounting. Runtime admission now reads the daily
  Stop marker and override, and refunds 429 before the next reserve. Its
  settlement failures reach the host's terminal accounting path.
- `autoCompactionAdmission.ts` is classified in the bundle-split gate's
  activation-allowed inventory: panel and runtime managers bind this shared
  lightweight admission. Backend-only host logic stays lazy. No cap or guard
  was widened and no dependency was added.

## Accounting correction (RVCM1011 finding 8)

Completed manual and automatic summaries already call `noteUsage` through
`collectedText`. That updates session usage and costs and settles the M82
session claim. The prior certification's claim that only ordinary turns
account usage was incorrect; no unrelated host-accounting repair is needed.
The daily extras ledger is a separate budget scope, not a second addition
of summary tokens to session totals. The paid compaction row counts requests
and identifies costs as included in the conversation, avoiding a double sum.

## Regression tests and red drills

Every drill runs complete test files at repository timeouts, with at most
three workers. Sources are restored byte-exact and SHA-256 compared before
continuing. Detailed receipts follow after verification.

| Finding | Fix                                                                          | Regression                                                                                                                                                         |
| ------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1, P2   | Existing paid gate and first-charge consent, ACP explicit opt-in             | `production admission denies paid consent before summary or continuation`; `uses the shared ask-once consent and revokes when disabled`; ACP opt-in/ask-once tests |
| 2, P2   | No absent-claim protection bypass; daily Stop/storage fences also in runtime | `refuses Stop/storage/cap errors for %s protection`; `runtime refuses shared daily %s at reserve and final send`                                                   |
| 3, P2   | Fresh claim in each HTTP prepare; async settlement drained before retry      | `production claims survive a 429 retry and tool-less fallback without reuse`                                                                                       |
| 4, P2   | Runtime transport owns its single daily debit                                | `runtime automatic summaries use exactly one daily claim and one debit`                                                                                            |
| 5, P2   | Reserve after memory hooks; refund prepared nonsends and late cancellation   | `production memory-hook stop owns no unsent daily reservation`; `retains uncertain sends and refunds known nonsends on close`; cancellation-race refund            |
| 6, P2   | Await settlement and propagate rejection before ordinary continuation        | `production settlement failure ends the owning turn before ordinary continuation`; runtime terminal accounting error                                               |
| 7, P2   | Register intended bundle placement                                           | `classifies compaction admission in the actual mandatory bundle-split inventory` executes the real checker's inventory pass without unrelated build artifacts      |
| 8, P3   | Correct the certification's accounting observation                           | `completed summaries already update session usage and M82 totals` verifies both tokens and the durable session debit                                               |

## Gates and limits

Verification receipts are appended below. `npm run quality` is intentionally
not run: the rig brief reserves full gates for the lead. No merge, push,
rebase, hook alteration, new dependency or credential access occurred.

The inherited production build fails before bundling: the released What's
New payload exceeds its existing decode bound. This same blocker was recorded
on base by CM1011 and the independent review. The cap is unchanged. A scratch
production-option bundle measurement is separate evidence, never a full
build/package pass. Installed-editor, three-OS and paid M75 evaluation receipts
remain activation prerequisites owned by C-M101-2/C-M101-3, as before.

Reference generation initially exposed the unpaid compaction catalogue
identity and then a duplicate auto-compaction row; that new-row approach was
abandoned. The existing auto-compaction row now names its paid identity and
ACP flag. The catalogue and parser share the generated reference.

## Red-drill receipts (all fired)

- 1-consent: broke the production guard in `src/core/backends/modelapi/autoCompactionAdmission.ts`;
  `denied consent sends nothing and never reserves` failed (Vitest exit 1).
  Restored byte-exact to SHA-256 `004343d000f81fb333a321a842913f0130e7fb764ae4fccbff6e3a92505aecc1`.
- 2-refusal: broke the production guard in `src/core/backends/modelapi/autoCompactionAdmission.ts`;
  `refuses Stop/storage/cap errors` failed (Vitest exit 1).
  Restored byte-exact to SHA-256 `004343d000f81fb333a321a842913f0130e7fb764ae4fccbff6e3a92505aecc1`.
- 3-fresh-claim: broke the production guard in `src/core/backends/modelapi/autoCompactionAdmission.ts`;
  `production claims survive a 429 retry and tool-less fallback without reuse` failed (Vitest exit 1).
  Restored byte-exact to SHA-256 `004343d000f81fb333a321a842913f0130e7fb764ae4fccbff6e3a92505aecc1`.
- 4-single-debit: broke the production guard in `src/runtime/runtimeAccountingEntry.ts`;
  `runtime automatic summaries use exactly one daily claim and one debit` failed (Vitest exit 1).
  Restored byte-exact to SHA-256 `3a3dd5e2f6a6962dc12b570c9d4cf79f0a435ce4e4bbc869091e3f08c03a4e58`.
- 5-nonsend: broke the production guard in `src/core/backends/modelapi/autoCompactionAdmission.ts`;
  `retains uncertain sends and refunds known nonsends on close` failed (Vitest exit 1).
  Restored byte-exact to SHA-256 `004343d000f81fb333a321a842913f0130e7fb764ae4fccbff6e3a92505aecc1`.
- 6-settlement: broke the production guard in `src/core/backends/modelapi/autoCompactionAdmission.ts`;
  `production settlement failure ends the owning turn before ordinary continuation` failed (Vitest exit 1).
  Restored byte-exact to SHA-256 `004343d000f81fb333a321a842913f0130e7fb764ae4fccbff6e3a92505aecc1`.
- 7-inventory: broke the production guard in `scripts/check-bundle-split.mjs`;
  `classifies compaction admission in the actual mandatory bundle-split inventory` failed (Vitest exit 1).
  Restored byte-exact to SHA-256 `af09962b84eaa4fea34fc3bf491a64acffd74bbf108fa0c0a8e996d924a73d63`.
- 8-accounting: broke the production guard in `src/core/backends/modelapi/ModelApiHost.ts`;
  `completed summaries already update session usage and M82 totals` failed (Vitest exit 1).
  Restored byte-exact to SHA-256 `a52e0fde7b9d3f34a01ca707a74eccd7a784dad8f78050c2ac4505291dec15bf`.

## Production-option measurements

The repository's actual production build configurations, evaluated without
writing bundles (the full build remains blocked above):

| Bundle             |  Bytes | Existing cap | Admission copies |
| ------------------ | -----: | -----------: | ---------------: |
| extension          | 567170 |       614400 |                1 |
| Model API          | 528911 |       537600 |                0 |
| ACP startup        | 241073 |       870400 |                0 |
| runtime accounting |  36801 |        51200 |                0 |
| runtime engine     | 648216 |       896000 |                1 |

The shared adapter appears once in each manager bundle, stays out of ACP
startup and is not duplicated inside the lazy Model API bundle.

## Final verification (macmini, repository timeouts)

- `npx vitest run test/unit/autoCompactionAdmission.test.ts test/unit/modelApiAutoCompact.test.ts test/unit/modelApiBackendManager.test.ts --maxWorkers=3`: Tests 86 passed (86).
- `npx vitest run test/unit/runtimeAccounting.test.ts test/unit/acpRuntime.test.ts test/unit/execArgs.test.ts --maxWorkers=3`: Tests 112 passed (112).
- `npx vitest run test/unit/acpPaid.test.ts test/unit/paidConsent.test.ts test/unit/paidHost.test.ts --maxWorkers=3`: Tests 109 passed (109).
- `npx vitest run test/unit/paidFeatures.test.ts test/unit/autoCompact.test.ts test/unit/modelApiGoldenRequests.test.ts --maxWorkers=3`: Tests 197 passed (197).
- `npx vitest run test/unit/acpModelApi.test.ts test/unit/autoCompactionBundle.test.mjs test/unit/cliUsage.test.ts --maxWorkers=3`: Tests 24 passed (24).

Total: **528 tests passed in 15 complete files**, no filters or raised
timeouts. Full `npm run typecheck` passed (host, webview, unit, e2e and
integration). Localization: 14 UI + 14 usage tables, 0 problems. Reference
and host API gates passed.

After consolidating repeated test fixtures, the complete
`modelApiAutoCompact.test.ts` file passed again: **45/45**, default timeout,
three workers. Changed-file ESLint passed with `--max-warnings=0`.
`npm run deadcode` passed (only the existing vendor/axe-core configuration
hints). Reference and roadmap generation/checks passed; roadmap has 207
entries. `git diff --check` passed. Formatting and hook receipts follow below.

`npx jscpd` reports only the inherited six-line clone in
`test/unit/windowsTrustedPath.test.ts` (206–211 and 279–284), exiting 1.
That file is byte-identical to base, SHA-256
`4064b9255e70105861f66ce1ee381c6065613193912be21c84bd3855882594df`.
The three repeated fixtures introduced by these tests were consolidated;
no duplication threshold or ignore changed.

`npm run build` and `npm run check:visual` both stop before bundle/visual
certification at `encodeWhatsNewContent`'s unchanged 75 KiB decoded-content
bound, with `Error: That did not work (the Muse Spark log has the details)`.
The independent base review measured the released payload at 79,510 bytes.
The scratch measurements above do not claim these gates passed.

## Additional guard-fire receipts

- 9-runtime-fences: deliberately bypassed `src/runtime/runtimeAccountingEntry.ts`;
  `runtime refuses shared daily` failed (Vitest exit 1).
  Restored byte-exact to SHA-256 `3a3dd5e2f6a6962dc12b570c9d4cf79f0a435ce4e4bbc869091e3f08c03a4e58`.
- 10-acp-once: deliberately bypassed `src/acp/paid.ts`;
  `ACP automatic compaction asks once` failed (Vitest exit 1).
  Restored byte-exact to SHA-256 `8af32cb5f879277b908bc2782af4ff103c12b294ab61f6599756e00734948518`.
- 11-paid-gate: deliberately bypassed `src/core/backends/modelapi/autoCompactionAdmission.ts`;
  `an off paid gate declines before consent` failed (Vitest exit 1).
  Restored byte-exact to SHA-256 `004343d000f81fb333a321a842913f0130e7fb764ae4fccbff6e3a92505aecc1`.

These supplement the eight finding drills with direct coverage of the new
runtime storage fences and ACP/paid-gate bindings.

After those mutations were restored, complete admission/runtime-accounting/ACP-paid
files passed again: **60/60**, repository timeouts, three workers.
`npm run check:plan` also passed: 207 milestones, zero drift.

Changed-file `npx prettier --check` passed. The consolidated retry fixture
initially failed the follow-up unit typecheck because its inferred
`Parameters` type resolved to `never`; it now uses the exported
`ScriptedReply` shape from the fake API, without a cast. Its complete file
passed again: **45/45** at the repository timeout.

The corrected fixture also passed `npm run typecheck:unit`. Final format
checks passed for the changed files; hooks are the installed fail-closed
`.husky/_` stubs, with lint-staged and staged gitleaks, unchanged.

---

# CM1011R3 certification — all six RVCM1011B findings repaired

CM1011R3, branch `c/m101-1`, base `06411071c`, macmini, 2026-10-10
(Muse continuation of the Codex lane after its usage limit).
No live or paid calls were made.

## One admission authority

Automatic-compaction admission is redesigned as ONE authority,
`createAutoCompactionAdmission`
(`src/core/backends/modelapi/autoCompactionAdmission.ts`), bound once per
manager in `src/host/backend/modelApiBackendManager.ts` (VS Code) and used
through the same module by ACP/headless. That one authority:

- reserves a hard bound on the actual HTTP request — the body's estimated
  input at list price plus the request's full `max_output_tokens` at list
  price plus every other priced part (`card.request`, image count) — never
  an estimate of economic debt; settles on reported usage and refunds the
  difference;
- checks consent (a live `PaidUseConsent.fence`), the paid switch, workspace
  trust and the evaluation latch at preparation AND immediately before final
  dispatch (the synchronous guard) AND again after every reservation before
  it is published, covering retries and fallbacks; revocation in between
  stops the send;
- stays absent while the evaluation latch is false: `usablePaidFeatures`,
  `listedPaidFeatures`, the paid gate's availability, consent cards, the
  reference/help (runtime-filtered `referenceEntry`), ACP/CLI usage and the
  `compaction` reference row (now the manual `/compact` row) never name it;
  manual compaction is untouched.

## Findings fixed (all P1/P2/P3, no residuals)

| Finding                                                                   | Fix                                                                                                                                                                                                                                                                   | Regression test (fails without it)                                                                                                                                                                                                             |
| ------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1, P2 — reservation priced economic debt, overshooting the hard daily cap | `prepareRequest(body, inputTokens)` reserves `reserveRequestAmount` over the actual body's input estimate and full output allowance; settlement refunds the difference                                                                                                | `reserves the actual input and full output allowance independently of economic debt`; `a short previous summary cannot overspend the real hard daily journal` (real `createPaidDailyBudget`)                                                   |
| 2, P2 — revoked consent stayed usable after admission                     | `checkAuthorization` (consent fence + switch + trust + evaluation) runs in `prepareRequest` before reserve, again after reserve before publication, and in the synchronous final-send guard; the Model API host rebinds the reservation for every retry/fallback body | `one authority checks %s before preparation, after reserve, at final send and before retry` (consent/switch/trust/evaluation); `production consent revoked during reservation sends no summary or continuation` (real `PaidUseConsent.forget`) |
| 3, P2 — dormant feature shown as active paid UI                           | Evaluation latch gates the paid gate (`paidHost`), `usablePaidFeatures`, `listedPaidFeatures`, gate review/turn-on, ACP `isOn`, reference/CLI help (runtime filters), and is threaded explicitly from `extension.ts` and `runtime/backends.ts`                        | `unevaluated compaction is absent from paid state, usage choices and consent cards`; `unevaluated compaction is absent from compact and full ACP/CLI help` (now also asserts the display name is absent)                                       |
| 4, P3 — turn-on confirmation named no price                               | `confirmationDetail(autoCompaction)` reads the priced `paidConfirmAutoCompaction` template through the shared `{price}` fill                                                                                                                                          | `evaluated compaction turn-on confirmation names the price being accepted`                                                                                                                                                                     |
| 5, P3 — manual summary forks labelled automatic                           | The accepted transcript row takes the `autoCompaction` paid identity only for non-fork extra admission                                                                                                                                                                | `manual summary forks never acquire the automatic paid identity`                                                                                                                                                                               |
| 6, P3 — ACP Allow-once scope overstated                                   | README, `docs/acp.md` and this record say "this workspace within this agent process"                                                                                                                                                                                  | `documents ACP Once as workspace-scoped within the agent process` (all three files)                                                                                                                                                            |

Scope decision, recorded: the native VS Code Settings editor still
declares `museSpark.modelApiAutoCompaction` (the README tells users to set
it `false` to turn the mechanism off, and `manifest.test.ts` requires every
runtime default to stay declared). Its description discloses dormancy
("remains inactive until a paired evaluation passes"). A draft
`"included": false` manifest flag was tried and reverted: VS Code defines
no such property, so it hid nothing and its test guarded a decoration.

## R3 red-drill receipts (all fired, all restored byte-exact)

Each drill broke one guard, saw the named test fail (Vitest exit 1,
repository timeouts), restored the file and verified SHA-256:

- F1-bound: zeroed the reservation inputs in `autoCompactionAdmission.ts`;
  `reserves the actual input and full output allowance independently of
economic debt` failed. Restored OK
  (`2f28e3fbaa3b120a8e5a801e6f1e9e94f1a71e76f479e6f660bc401c8dae8542`).
- F2-fence: dropped the consent check from `checkAuthorization`;
  `one authority checks consent before preparation, after reserve, at final
send and before retry` failed. Restored OK (same SHA).
- F3-hidden: dropped the evaluation clause from the paid-gate availability;
  `unevaluated compaction is absent from paid state, usage choices and
consent cards` failed. Restored OK
  (`571aaa916def3fb9a365df4f28be8218419aa6c02b4807265d8d4d82558eb9ff`).
- F4-price: pointed the confirmation back at the priceless name;
  `evaluated compaction turn-on confirmation names the price being
accepted` failed. Restored OK (same SHA).
- F5-identity: removed the `!isSummaryFork` condition in
  `ModelApiHost.ts`; `manual summary forks never acquire the automatic paid
identity` failed. Restored OK
  (`1e034a9b433ebdac66eeea0fffcb70e9a7ade972465c194737517767e7dab90b`).
- F6-scope: restored the old process-wide Allow-once sentence in
  `README.md`; `documents ACP Once as workspace-scoped within the agent
process` failed. Restored OK
  (`477070aa47a0a157234c881d55f5726d988e43fc256dbbd428f546598e1b2290`).

`src/shared/paid.ts` was hash-pinned through the drills (no drill touched
it) at `dd41086f318579d6da00b37174a46a6912259cda9d7b05f21959a8ea53b41574`.
Full-file reruns after the restores are recorded under Final verification
below.

## R3 final verification (macmini, repository timeouts)

- `npx vitest run test/unit/autoCompactionAdmission.test.ts test/unit/modelApiAutoCompact.test.ts test/unit/acpPaid.test.ts --maxWorkers=3`: **103 passed**.
- `npx vitest run test/unit/paidHost.test.ts test/unit/runtimeAccounting.test.ts test/unit/autoCompactionBundle.test.mjs --maxWorkers=3`: **57 passed**.
- `npx vitest run test/unit/manifest.test.ts test/unit/autoCompact.test.ts test/unit/referenceEntry.test.ts --maxWorkers=3`: **80 passed**.
- `npx vitest run test/unit/paidConsent.test.ts test/unit/paidFeatures.test.ts test/unit/referenceGenerator.test.mjs --maxWorkers=3`: **184 passed**.
- `npx vitest run test/unit/ReferencePage.test.tsx test/unit/cliUsage.test.ts` (plus `runtimeChatGptPackage.test.ts`, see below): **36 passed, 2 skipped**.
- Full `npm run typecheck` exit 0 (host, webview, unit, e2e, integration).
- Changed-file `npx eslint --max-warnings=0` (21 files): clean, no disables. `npx prettier --check` on all changed files: clean. `git diff --check`: clean.
- `node scripts/check-l10n.mjs`: 14 UI + 14 usage tables, 252 manifest strings, 1513 sources, 0 problems.
- `npm run reference:generate` + `npm run check:reference`: current (77 features, 71 commands, 100 settings, 29 slash, 263 CLI).
- `npm run roadmap:generate` + `npm run check:roadmap`: current, 207 entries (the lane's 269-character M101 summary was shortened to fit the 260-character bound).
- `npm run check:host-api`: 375 APIs, 0 problems. `npm run deadcode`: only the existing vendor/axe-core hints. `npx jscpd`: back to the single inherited `windowsTrustedPath.test.ts` clone (a new 11-line body-literal clone my fixture introduced was removed by key reorder).
- `npm run build` fails before bundling at `encodeWhatsNewContent`'s decode bound — the inherited blocker the review measured identically (79,510 bytes) on base and head; no cap or guard changed, no size claimed.
- `test/unit/runtimeChatGptPackage.test.ts` fails with `spawnSync node ENOBUFS`: it shells out to the production build, whose throw at the inherited bound above carries a ~1.2 MB `data:`-URL stack frame, overflowing the spawn buffer. Same throw, same output on base (nothing in this lane touches the payload, bound or scripts); the lead runs it after the blocker is lifted. No browser/GUI/server test in scope was started here.
