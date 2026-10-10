# M101 C-M101-1 certification — production D78 admission and model readers

Lane CM1011 (branch `c/m101-1`, base `cd6a05dd4`), work on the macmini rig.
Scope: provide `admitAutoCompaction`/`autoCompactModel`
(`ModelApiHost.ts:623-625` had no production provider) from
`modelApiBackendManager.ts` and `runtime/backends.ts` for VS Code, ACP, exec
and panel, through one shared D78 gate and ledger. No host changes; the
feature stays dormant behind `IS_AUTO_COMPACTION_EVALUATED = false`.

## What was built

- `src/core/backends/modelapi/autoCompactionAdmission.ts` (new): the one
  shared adapter plus the catalogue reader, imported by both managers.
  - `createAutoCompactionAdmission({ ledger, log, storeUnavailable })`
    implements the host's `admitAutoCompaction` contract
    (`{ guard, settle } | undefined`):
    - Gate, fail closed: one daily-ledger reserve for the decision's
      projected debt before dispatch; abort refunds its claim and
      declines; a refused/missing ledger declines the cost path, so the
      host sends zero extra requests; the returned guard rechecks the
      claim synchronously at send and refuses after a settlement failure
      with the ledger-unavailable error. The M82 account/key/budget/
      final-send fences still run on each extra POST inside the host's
      own composed guard.
    - Ledger (D78 semantics, M121 exact money): settle known returned
      usage at its exact catalogue cost (`estimateCostUsd`), refund
      rate-limited attempts as known nonsends (`0`, known), retain the
      reservation with an unknown-cost mark when no usage came back.
      Settlement runs once per dispatched attempt, from the host's
      existing per-attempt hook.
    - Protection is never blocked: near-window/overflow decisions admit
      even when the ledger refuses (no journal row then; the M82 per-send
      fences still run), exactly like a manual `/compact`.
  - `resolveAutoCompactModel(modelId)`: Meta tiers to priced per-token
    catalogue cards; BYO/local/unknown models return `undefined`, which
    the host maps to unpriced (near-window protection only). Per-provider
    price cards belong to C-M101-4 (BYO residuals), which owns `priceCard`
    per the completion program.
- Panel: `modelApiBackendManager.ts` binds `autoCompactModel` always and
  `admitAutoCompaction` when `reserveAutoCompaction` is present; new
  optional dep `reserveAutoCompaction`. `extension.ts` provides it from
  `dailyPaid.reserveExact` (exact-USD, the same branch shape as the
  existing `reservationUsd` path). No raise dialog on the automatic path:
  over-cap declines with the host's existing `autoCompactionFailed`
  notice.
- Runtime (ACP/exec): `runtime/backends.ts` binds the same reader and
  provides `reserveAutoCompaction` from the runtime daily budget
  (`createRuntimeDailyBudget().reserve`), which refuses over-cap/stopped/
  unreadable storage. Same adapter, same behaviour in every editor.
- No new user strings (log lines are fixed inline words; errors reuse
  `sessionBudgetStoreUnavailable`), no new setting/command/feature: l10n,
  reference and feature-catalog gates are untouched by design.

## Tests (repository timeouts, never `--testTimeout`)

- `test/unit/autoCompactionAdmission.test.ts` (14 tests): one reserve for
  the projected debt; ledger refusal/missing/abort (with refund) decline;
  final-send recheck; exact-cost settlement (expected cost computed inline
  from `MODEL_API_PRICES_PER_MILLION`, not via the implementation's own
  estimator); uncertain retention; 429 refund; settlement failure ends the
  turn on the next guard; protection admitted past a refused ledger;
  corrupt projection declined; Meta priced / BYO-local-unknown unpriced.
- `test/unit/modelApiBackendManager.test.ts` (+2 tests): production host
  construction carries the reader and the admission when the ledger dep is
  present; admission absent (reader still bound) when it is not.
- Regression evidence, same runs: `modelApiAutoCompact.test.ts` +
  `autoCompact.test.ts` 66 passed; `acpRuntime` + `acpModelApi` +
  `execArgs` 110 passed — off-mode goldens and runtime option plumbing
  unchanged.

## Red drills (break, see the named test fail, restore byte-exact)

1. Removed `claim?.check()` from the admission guard in
   `autoCompactionAdmission.ts`: exactly
   `rechecks the claim synchronously at send: final-send` failed (13
   passed). Restored to SHA-256
   `5b8d423b18c9dcc0457e19fed534c92cbfcb1508ebcf97156880cc1a263b8956`.
2. Removed the `admitAutoCompaction` binding in
   `modelApiBackendManager.ts`: exactly
   `binds the shared automatic-compaction admission and model reader to
production host construction` failed (24 passed). Restored to SHA-256
   `206498ca8c1ae37df84879c676106368fafedae80026355d443e98a7980cbd73`.

## Gates

- `tsc` host + unit clean; eslint `--max-warnings=0` on all six touched
  files clean; prettier clean; `check:l10n` 0 problems.
- jscpd: my two clones eliminated by refactor (reader via `perTokenUsd`
  helper; binding tests via shared `windowHostDeps`); one remaining clone
  is pre-existing in untouched `test/unit/windowsTrustedPath.test.ts`.
- Build: `npm run build` does not reach esbuild on this base — its
  `writeWhatsNewContent` step throws because the encoded release notes
  exceed `WHATS_NEW_CONTENT_DECODE_MAX_BYTES` (75 KiB) while CHANGELOG.md
  is 364,941 bytes. Both inputs (CHANGELOG.md, package.json) are
  byte-identical to base `cd6a05dd4` (no lane file touches them), so the
  failure is pre-existing and independent of this lane. Bundle impact was
  instead verified by scratch-bundling both affected entries with the
  repo's esbuild: `src/extension.ts` and `src/runtime/main.ts` each bundle
  cleanly with the adapter included exactly once (scratch files removed).
  Exact production caps and the whatsnew repair belong to the lead.

## Editor × OS matrix (this run: macmini only)

The adapter and reader are platform-free core (Windows separators need no
handling: no paths compared). Both managers bind them unconditionally
where a ledger exists. Installed-editor/platform proofs, the 3-OS hosted
matrix, and Codex/Grok review remain with the lead.

## Observations for the lead (not changed this lane)

1. First-charge popup: routing automatic-compaction consent through
   `allowsPaidUse` needs a real paid-feature entry (closed `PaidFeature`
   union, registry/tally/settings rows, per-editor consent copy, ACP/exec
   flags) — a feature lane of its own. Until then the evaluated latch
   keeps production dormant, which is exactly PLAN's sequencing (the latch
   flips in C-M101-3 only after all receipts pass). Recommend the popup
   ride with the latch flip.
2. Compaction usage (manual and automatic) never reaches the host's
   session-budget totals: `collectText` creates/persists the M82
   reservation but only the turn path settles it via `noteUsage`. The
   adapter's journal settle is currently the only compaction accounting.
   Pre-existing host behaviour; flagging for C2/lead.
3. `npm run build` is red on base (whatsnew cap, above); no lane can ship
   build receipts until that is repaired.
4. jscpd is red on base via `windowsTrustedPath.test.ts` (above).
5. When the latch flips, exec's default (`options.autoCompaction ??
SETTING_DEFAULTS.modelApiAutoCompaction`) auto-compacts headless runs
   by default; D65 says CI paid defaults off — the latch-flip lane should
   set the exec default off or require explicit opt-in.
