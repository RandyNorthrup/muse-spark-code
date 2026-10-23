# Lane RLM95 — M95 recovery: land four lanes, close the msm95 gaps (2026-10-22, macmini)

Recovery lane on `rec/rlm95` from 0.19.0 (`c7bdd3e94`). Landed the four
source branches in order with `git merge --no-ff`, resolved every conflict
for current main, then closed the gaps named in `docs/certification/msm95.md`.

## Landed

- `src/RLM95/01-c-m95-subkey-r3` (commit `0e9413b89`): subscription key
  source and frozen billing route.
- `src/RLM95/02-feat-provider-spend` (commit `6bd70000c`): provider spend
  reports, usage terminal command, admin credential flows.
- `src/RLM95/03-feat-provider-usage-fields` (commit `bfb78a890`): cached
  and reasoning token prices, tier boundaries, routed upstreams, credit
  balance flow, Fireworks isolation key, Hugging Face `model:upstream`.
- `src/RLM95/04-feat-provider-files` (commit `093cbe74e`): three-dialect
  Files wire (meta/openai/anthropic), verified upload receipts, file-id
  references in the Anthropic codec, xAI documented image bounds,
  expiry-absent file refs.

Conflict resolutions reworked branch content for current main where the
branches predated it: our attachment/expiry/character limits stayed removed
(PLAN.md D121), HEAD's wire-captured part types kept over the branches'
duplicates, the MediaBudget character budget dropped, image-policy tests
assert documented bounds only, and the README's no-limits tables kept.

## Repairs found while landing

- `ownedSnapshot` never recorded the resolved owner in `sessionOwners`, so
  01's listing filter dropped every freshly started session
  (`test/unit/sessionDelete.test.ts`: "was never listed"). Fixed at the
  ownership-establishing site: the first owned save records the owner.
  sessionDelete proves it (10/10).
- Merge type repairs: PayerCredential digest, attempt billing route,
  key-use confirm stub, retention value, spend-terminal bundle warm-up
  (the first report read exceeded the 5 s timeout loading lazy bundles;
  now warmed at collection).
- Lint repairs on branch code: repo comment style, flatMap shapes, nested
  ternary restructure, removed unused helper, unused-parameter removal.

## Gaps closed (commit `fe8de44cd`, `5aac0025e`)

- xAI per-second scope: xAI documents per-model requests-per-second and
  tokens-per-minute budgets (docs.x.ai/developers/rate-limits, read
  2026-10-22). The request bucket refills per second, tokens per minute
  (`test/unit/providerPacing.test.ts`).
- Anthropic per-request image count: 100 for 200k-context models, 600 for
  all other models (platform.claude.com vision "Request limits", read
  2026-10-22). The record carries the count for the model's own window;
  existing maxCount enforcement applies it
  (`test/unit/providerImagePolicy.test.ts`).
- Session-level refresh: proven, not built — every resolve already
  re-reads the providers file, and the turn resolves through the registry
  on each request. `test/unit/providerSessionRefresh.test.ts` proves a
  file edit between resolves changes the next resolution (red-drilled
  with a stale cache).
- Azure preset: built and shape-proven (origin, api-key auth, deployment
  model wiring, api-version, keyTest, strict tools), dispatch refused
  before send until Azure's own capture lands (rule 13) with zero
  dispatches (`test/unit/providerAzureWaiting.test.ts`, red-drilled with
  a flipped capture flag). The live send waits for the owner's Azure
  resource, which also produces the listing capture.

## Gaps named, not closed

- Per-attempt pool admission: headless still pins one account per run by
  design (D88.5); `--account-pool` refuses loudly. Multi-account dispatch
  waits for the profile broker.
- DeepSeek concurrency: now documented (2500 account-level for
  deepseek-flash, 500 for deepseek-v4-pro; 429 when exceeded;
  api-docs.deepseek.com rate limit, read 2026-10-22), but it is
  concurrency, not a rate window — the pacer has no admission
  machinery for it. Live 429 behavior stands.
- Azure 1/10 s: documented as burst-evaluation sub-windows ("requests
  should be spread evenly"; enforcement evaluates over small windows,
  typically 1 or 10 seconds; learn.microsoft.com quota, read
  2026-10-22), not bucket scopes — the header limits stay per-minute.
  Burst pacing is future machinery; live 429 + retry-after-ms stand.
- Anthropic above-20-images dimension tightening (2000px guidance) and
  the 32 MB request cap: documented, not encoded; maxCount is the
  enforced control.

## Live turns

None on this lane. No credential for any provider was found on this rig
(no credential environment, no CLI credential file; the keychain check
needed approval and was refused, so it was not pursued). msm95's live
proof stands (8 dispatches, $0.000030, 2026-10-17). The lane's new
behavior is proven by unit tests over real code plus the documented
sources above.

## Gate deferral

`npm run check:plan` fails on this tree: PLAN.md is 3,575,730 bytes, 10,572
over the 85% early-warning tripwire (reader bound 4 MiB, 11% headroom
left). The lane's merges added the overage; the archive move stays with
the lead at integration (recorded in PLAN.md §7 with cause: the open-branch
proofs are infeasible from a rig holding 1,171 branches with no open/stale
record). No threshold or rule changed.

## Drills

- `providerAzureWaiting`: flipped `AZURE_PRESET.wireCapture` to true →
  red ("promise resolved"); reverted → green.
- `providerSessionRefresh`: memoized the file read in `models()` → red
  (expected 8192 to be 16384); reverted → green.
- `sessionDelete`: failed before the `ownedSnapshot` fix (3 tests),
  green after (10/10). Measured at 0.19.0 (13/13 over the two files),
  at the 01 merge (4 failed), at the 03 merge (4 failed).

## Suites and gates

- Touched suites green at repo timeouts: providerUsageFields (new),
  providerFiles (new), providerImagePolicy (+anthropic counts),
  providerPacing (xAI windows), providerRetryLimits, providerSpendTerminal,
  providerAzureWaiting (new), providerSessionRefresh (new),
  sessionStore, sessionDelete, bestOfNWorktreeFailed.
- `vitest related` over the lane's 99 changed sources on the final tree
  (739 files): 22,148 passed, 63 failed across 22 files, zero in lane
  areas. Every failure is rig-environmental: 27 load timeouts (schedule /
  estimator / native-git families), EPERM on /bin/ps (macRss; the sandbox
  denies ps outright), missing `muse-dictate` native helper
  (resourceCreatedSweep), missing pinned zopfli (vsixCompression),
  keychain/birth/socket-length vault refusals, and pid-reuse timing
  (crashMarker). Identical-tree rerun shifted 59 → 63 failures (load).
  Three oracles on a pristine base checkout (c7bdd3e94 + lane
  node_modules): estimatorSnapshotStrict, legalCancel and
  vault/credentialMigrationStore fail there identically. `skillArchive`
  and `credentialLease` pass alone; `uploadLedgerTwoProcess` birth-reap
  fails then passes on the identical tree (two-process timing; the lane's
  only ledger change is the optional-expiry sweep condition, disjoint
  from birth logic). Hosted CI is the arbiter for all of them.
- Full gates on the final tree: format, lint, typecheck ×5, badges,
  tokens, l10n, reference, host-api, roadmap, catches (baseline regen:
  runtime GENERIC 198 → 197, a deduped providersCommands site), deadcode,
  cycles, duplication (0 clones), build (all budgets met) and
  security:audit green; `check:plan` red only (the deferred tripwire
  above). `security:sast` is not part of `quality:gates`; a direct run
  was sandbox-blocked when tried on this rig (empty trust anchors).
