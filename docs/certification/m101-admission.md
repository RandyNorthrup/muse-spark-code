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
  manual compaction is untouched. The native Settings editor retains the
  dormant preference; R4 corrects the README and makes that distinction explicit.

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
R4 uses the review's permitted alternative: describe exactly what the
preference does today and document its native visibility, rather than claim
an unsupported hiding mechanism works.

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

---

# CM1011R4 certification — RVCM1011C review repairs

CM1011R4, branch `c/m101-1`, base `9aaef8c99`, macmini, 2026-10-10.
All three assigned findings are repaired; the evaluation latch remains false.
No new dependency, live/paid model call, credential access, guard widening,
merge, push, rebase or hook change occurred. The shared lane brief reserves
aggregate `npm run quality` for the lead; checks here run directly on the rig.

## Findings and class sweeps

| Finding                                                                     | Fix                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Regression                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| --------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P1 — help removed by text matching; bad-argument help exposes dormant flags | `cliOptions.ts` renders both compaction flags as structured option entries and filters their identities; the fixed ACP manual contains no embedded conditional flag. `referenceEntry.ts` filters the structured CLI text keys, including conditioned entries, rather than display-name suffixes. All 14 UI tables move the embedded flag out. `main.ts` uses the same formatter for help and invalid arguments.                                                                                 | `hidden automatic compaction preserves the complete ACP and CLI usage manuals` checks every fixed manual line, other option entries and command rows, plus visible prose mentioning a hidden flag. The real-process `prints its version and help, and refuses an argument it does not know` verifies identical complete manuals and absence of dormant flags on both output routes.                                                                                                                                                                                                                |
| P2 — revocation reported as broken storage and aborts the ordinary turn     | The shared paid-consent module defines a distinct authorization-refusal error and a guard that survives separately loaded bundles. Admission uses it before/after reserve and at synchronous dispatch; host switch/evaluation rechecks use it too. The host skips that compaction, clears its economic debt and keeps the ordinary turn running. Structured repair/fallback treats refusal as terminal for that summary. Unsent claims refund; actual ledger errors stay terminal for the turn. | Sixteen production cases cover consent/switch/trust/evaluation withdrawal during memory flush, reservation, final send and retry, with structured output enabled: no unauthorized summary, completed ordinary turn, no repair/failure notices, exactly one zero settlement per claim. Existing real `PaidUseConsent.forget` coverage now requires the original context-overflow result instead of a ledger failure. Admission tests require the refusal class; `recognizes compaction authorization refusal across independently loaded bundles` builds and loads a genuinely separate class copy. |
| P3 — native setting and README disagree                                     | Use the review's permitted description alternative: the native machine setting remains visible and stores a preference only, defaults true, and sends no automatic requests today. Its English and all 14 translated manifest descriptions say so; README's prose and settings row match. The feature catalogue includes the setting's description, and reference/roadmap artifacts are regenerated.                                                                                            | `describes the visible automatic compaction setting as a dormant preference` verifies the live false latch, manifest default/scope, installed English description and README visibility claim.                                                                                                                                                                                                                                                                                                                                                                                                     |

**P1 reproduction correction:** the report's expression
`'--no-auto-compaction'.includes('--auto-compaction')` evaluates to **false**.
The initial baseline manual-preservation test passed. The class of text-filter
failure is real when unrelated prose mentions the hidden spelling; the
adversarial regression and restored legacy-filter drill demonstrate it. The
bad-argument route genuinely used the unfiltered raw manual. No claim is made
that the report's specific substring example reproduced.

**P2 boundaries:** revocation declines only automatic work. A real context
overflow that cannot be recovered still reports that original overflow; it is
not relabelled as storage failure. Stop, changed model/goal ownership and
actual reservation/settlement failures keep their existing semantics. The
refusal class stays beside paid consent so activation never imports the
backend-only compaction engine. Its classifier checks the error's stable name
because the admission and lazy backend bundles own different class copies.

## R4 red drills — all restored byte-exact

Every drill runs complete files with `--maxWorkers=3`, at most three files per
run, repository timeouts and no test filters. Each exits 1 for the named
regression; the changed source is restored from its saved bytes and SHA-256
compared before proceeding.

| Drill          | Deliberate break and observed failure                                                                                                                                                                                                 | Restored file SHA-256                                                                            |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| F1-manual      | Restore substring filtering on formatted chunks; `hidden automatic compaction preserves the complete ACP and CLI usage manuals` fails, 1 failed / 33 passed.                                                                          | `cliOptions.ts`: `e3c2e7416dbd1c82ba70f18306dbfc89d296ec61ba473a4b3ec3b83083a3aa39`              |
| F1-errors      | Restore raw invalid-argument usage; `prints its version and help, and refuses an argument it does not know` fails in the real ACP process. 5 failed / 8 passed, versus the four unchanged baseline session failures documented below. | `main.ts`: `37dee2c2bdd644d52323db2cc7b976d009aa697ff371902df4f35ab24d77aea7`                    |
| F2-class       | Restore the ledger-error throw for withdrawn authorization; admission classification and production consent/trust/reservation/retry cases fail, 16 failed / 70 passed.                                                                | `autoCompactionAdmission.ts`: `83a971a22a1ca39af44fa59c4c30698dd13fdc11b64d7a97bd7b6e875cf1acdf` |
| F2-host        | Restore the host's abort classification for switch/evaluation withdrawal; the six memory/final-send/retry ordinary-turn cases fail, 6 failed / 58 passed.                                                                             | `ModelApiHost.ts`: `4e576248e60bf52f39488ba8bc2a562f42e1518c714745f3c37766f73b082aef`            |
| F2-repair      | Remove refusal from structured-output terminal errors; fourteen production cases fail on unwanted repair/fallback notices, 14 failed / 50 passed.                                                                                     | `ModelApiHost.ts`: same hash as F2-host.                                                         |
| F2-bundles     | Change the refusal guard to `instanceof` its local class; `recognizes compaction authorization refusal across independently loaded bundles` fails, 1 failed / 1 passed.                                                               | `paidConsent.ts`: `fd497774473c98ac6e1e55f4a51bd6a84ce7d4c56641f6994de6be86eb1ce7b7`             |
| F3-description | Restore the old manifest description; `describes the visible automatic compaction setting as a dormant preference` fails, 1 failed / 39 passed.                                                                                       | `package.nls.json`: `e0b8ea27f4acb359974e3983a7cb05ec64a7dbdf561b844f831bb9ad734e543c`           |
| F3-README      | Reintroduce a hidden-preference claim in README; the same manifest/README test fails, 1 failed / 39 passed.                                                                                                                           | `README.md`: `2f56037fed1b82a5d43c448b4a02c384d18c71b6f6503b55d5a40c50d474817e`                  |

The first exploratory production-test fixtures passed UI mode names
(`acceptEdits`, then `auto`) to the MSP session constructor; those fail at
setup before exercising a guard. The corrected fixtures use the suite's
existing `onRequest` default. Neither setup failure is counted as a red drill,
and no timeout or assertion was weakened.

## ACP process baseline comparison

The complete `test/e2e/acpStdio.e2e.test.ts` file passes both English and
translated help cases, including the new invalid-argument assertions:
**9 passed, 4 failed**. The same four failures reproduce on the exact
unmodified base `9aaef8c99` (all 51 then-changed working files temporarily
replaced with their base bytes and restored byte-exact):

- loads the real question bundles, defers without forms, and drains an idle answer once;
- binds saved prompts and sharing help over real ACP stdio without a model send (M118);
- streams a reply, runs an allowed tool call and skips a denied one, on Muse Code;
- cancels a running turn and lists the session afterwards.

Each fails with ACP `RequestError: Internal error` while setting up a Muse Code
session. Both baseline and repaired runs exit 1; no full E2E pass is claimed.
The F1-errors drill adds exactly the named help regression to those four.
No browser, GUI, server daemon or sandbox workaround was started.

## R4 final verification and committed output

Source commit: `eebf84c32e0a4fd49054084d33aef43a926afbab`.
The installed `.husky/_` hooks ran staged ESLint with fixes, Prettier and
staged gitleaks (170,003 bytes scanned; no leaks). All 54 working-file hashes
match their pre-hook values. The saved staged diff and re-read committed diff
are byte-identical, SHA-256
`04bea58be8cbe0481db3ffd31b12ea1f0af45cde81bc25a814d96b35ede40d63`.

Complete-file final runs, default repository timeouts, three workers, macmini:

| Files (`test/unit/` unless stated)                                                                | Result                                                            |
| ------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `autoCompactionAdmission.test.ts`, `modelApiAutoCompact.test.ts`, `autoCompactionBundle.test.mjs` | 88 passed                                                         |
| `acpPaid.test.ts`, `manifest.test.ts`, `referenceEntry.test.ts`                                   | 89 passed                                                         |
| `paidConsent.test.ts`, `paidFeatures.test.ts`, `paidHost.test.ts`                                 | 111 passed                                                        |
| `runtimeAccounting.test.ts`, `acpRuntime.test.ts`, `modelApiBackendManager.test.ts`               | 82 passed                                                         |
| `referenceGenerator.test.mjs`, `cliUsage.test.ts`, `autoCompact.test.ts`                          | 153 passed                                                        |
| `test/e2e/acpStdio.e2e.test.ts`                                                                   | 9 passed; the same 4 baseline session-setup failures listed above |

Total: **523 unit tests passed in 15 complete files**. The first final help
rerun hit the unchanged five-second timeout because it reconstructed the
large generated reference inside every option lookup. Reading the inventory
once fixes the slow test; the complete three-file group then passed 89/89 at
the repository timeout. No timeout flag, per-test extension or test filter
was introduced.

- Final `npm run typecheck`: exit 0 for host, webview, unit, e2e and integration.
- Changed-file `npx eslint --max-warnings=0`: exit 0, 16 source/test files.
- Changed-file `npx prettier --check`: exit 0, all 54 files; no hook rewrites.
- `node scripts/check-l10n.mjs`: 14 UI + 14 usage tables, 252 manifest strings, 1513 sources, 0 problems.
- `npm run reference:generate` and `npm run check:reference`: current, 77 features / 71 commands / 100 settings / 29 slash / 263 CLI.
- `npm run roadmap:generate` and `npm run check:roadmap`: current, 207 entries.
- `npm run check:plan`: 207 milestones, zero drift.
- `npm run check:host-api`: 375 APIs, zero problems.
- `npm run deadcode`: exit 0, only the inherited vendor/axe-core hints.
- `git diff --check`: exit 0.

**Inherited gate blockers, unchanged:** `npx jscpd` exits 1 for only the
six-line `windowsTrustedPath.test.ts` clone at 206–211 / 279–284. That file is
byte-identical to base, SHA-256
`4064b9255e70105861f66ce1ee381c6065613193912be21c84bd3855882594df`.
`npm run build` exits 1 before bundling at `encodeWhatsNewContent`'s 75 KiB
decoded-content bound. Its released content is 79,510 decoded bytes on both
base `9aaef8c99` and R4. Tokens pass before that stop; no bound, threshold,
ignore or guard was changed. The ACP E2E baseline failures above also remain
outside these help/admission/description repairs. No assigned finding remains
open; aggregate quality and those existing blockers are reported to the lead.

Production-option measurements evaluate the repository's real production
esbuild configurations with `write: false`; they do not claim the blocked full
build, bundle gates or package passed:

| Bundle             |  Bytes | Existing cap | Admission copies |
| ------------------ | -----: | -----------: | ---------------: |
| extension          | 569213 |       614400 |                1 |
| Model API          | 529438 |       537600 |                0 |
| ACP startup        | 241241 |       870400 |                0 |
| runtime accounting |  36801 |        51200 |                0 |
| runtime engine     | 650312 |       896000 |                1 |

All measured bundles fit their unchanged caps. The backend-only
`autoCompact.ts` engine stays absent from activation, ACP startup and runtime
accounting; it remains in the lazy Model API bundle. No copies of admission
were added to the Model API bundle.

## After 0.17.1's truth pass (release train merge, 2026-10-11)

The release train merged `rel0171/final` at `dbdb55a0e` after this lane. Its
truth pass (CX1R3 to CX1R5, `docs/certification/cx1.md`) settled finding P3's
class in another way, for every dormant feature at once, and its tests pin
the result in all 15 manifest tables, so the train keeps the release's text
wherever the two disagreed:

- `config.modelApiAutoCompaction.description` says what the setting does
  today: it shows the first-turn awaiting-evaluation notice, and turning it
  off hides the notice. This lane's "stores a preference only" wording is
  gone in all 15 tables.
- The README section on automatic compaction, its settings-table row and
  `docs/acp.md`'s paragraph and option rows for the inactive feature are
  removed. The README names the setting once, as controlling that notice.
- The roadmap entry reads "automatic compaction is in progress".
- This lane's manifest test for the setting (`test/unit/manifest.test.ts`,
  now "describes the visible automatic compaction setting by what it does
  while inactive") checks the latch, default, scope and description key as
  before; the wording it pins is the release's.

Unchanged from this lane: the latch, the admission code, the structured
option filter in `cliOptions.ts` (the release removed the account and
schedule lines beside it), the `auto-compaction` catalogue entry (now also
in the release's in-progress list, which withholds it from published Help)
and the manual-compaction description of the `compaction` entry.
