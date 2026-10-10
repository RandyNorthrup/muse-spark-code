# M101 C-M101-1 certification — RVCM1011 admission repairs

CM1011R2, branch `c/m101-1`, base `f733a4692`, macmini, 2026-10-10.
All eight RVCM1011 findings are repaired. Production remains inactive behind
`IS_AUTO_COMPACTION_EVALUATED = false`; no live or paid calls were made.

## Admission and ownership

- Automatic compaction is an entry in the existing paid registry, using
  `modelApiAutoCompaction`, the paid gate, popup, workspace grants, badge and
  request tally, and marks the accepted transcript row paid. Before its first charge, the popup names the selected
  model's token rates and the current shared daily budget. Once covers the
  window (ACP: this agent process); Always is workspace scoped
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
