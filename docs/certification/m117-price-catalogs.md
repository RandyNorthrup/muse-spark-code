# M117 C-M117-4R2 certification — estimator price catalog review repairs (2026-10-11, macmini)

Lane: CM1174, branch `c/m117-4`, worktree `/Users/randy/lanes/CM1174`, base `7d0410526`.
Scope: fix every finding of RVCM1174 (one P1, three P2, three P3) inside this
lane's files; no new dependency; no guard widened.
Acceptance 4 (unchanged): a price shows its catalog and date; none shows
without a public catalog; the network setting is honoured.

## What changed for each finding

- **P1 — a successful fetch refused as a redirect**
  (`priceCatalogSource.ts`). The exact-string guard is gone. The catalog GET
  goes through the report network reader's `publicReportTransport`
  (`redirect: 'error'`, `credentials: 'omit'`), wrapped in a guard that
  compares **parsed** URLs in normalised (WHATWG) form, so the
  percent-encoded URL a real fetch returns (`%27` where the pinned URL has
  `'`) is accepted and only a genuinely different URL refuses. Regression
  test: `accepts the percent-encoded URL a real fetch returns` (asserts the
  normalised form differs from the pinned string, then fetches through it)
  and `refuses a redirect to another host before parsing`.
- **P2a — transport outside the report reader's checks**
  (`priceCatalogSource.ts`, `cache.ts`). No second network transport: the GET
  goes through `ReportNetworkReader` (host allowlist checked before the
  socket, empty-port check, `redirect: 'error'`, `credentials: 'omit`) and
  persistence is the shared `reportingResponseCache` over
  `reports/v1/cache/index.json` (the cross-process writer lock, exclusive
  no-follow staging writes, the in-process pending queue shared across
  estimates through the per-root singleton). `prices.azure.com` is added to
  the reader's `PUBLIC_HOSTS` for this purpose; anything but the pinned
  `ESTIMATE_PRICE_CATALOG_URLS` still refuses before dispatch. The copied
  merge arithmetic and the predictable `${pid}.tmp` write are deleted. The
  secret check rides the shared registry-backed `redactSecrets` (the same
  primitive the export scrub is built on); the report scrubber's
  workspace-path folding stays out because its module carries model text the
  lazy bundle must not (PLAN.md D6) — catalog answers are vendor-fixed JSON
  with no local paths (zero replacements across all three captures).
- **P2b — every row stamped with the page maximum** (`priceCatalogs.ts`,
  `prices.ts`). Each priced row carries its own meter's `effectiveStartDate`;
  the answer's catalog date is the latest of the **priced** rows only, and an
  answer with none of the pinned meters refuses. `isConsistent` now requires
  every row date to be a real date no later than retrieval and the document
  date to equal the latest priced row date (old uniform-date caches still
  pass). The pinned capture now yields D8plds v6 at `2024-10-01` beside three
  rows at `2025-10-01` (document `2025-10-01`); the lead's one-SKU capture
  yields two rows at `2025-10-01` with its `2026-07-01` Spot rows ignored.
  Shared row ordering is one comparator (`compareCatalogRows`, also removing
  a pre-existing jscpd clone with `prices.ts`).
- **P2c — copied cache without lock or safe staging** (done under P2a; the
  lazy split below is part of it). The port, the reader and the cache live in
  `dist/estimatePrices.js` (58.0 KiB, budget 75 KiB by the measured+15%
  convention), built from `priceCatalogEntry.ts` and required through
  `priceCatalogBundle.ts` on the first price lookup. Activation
  (`dist/extension.js`) shrinks 560.7 → 553.0 KiB (budget 600). A bundle that
  cannot load hands back a refusing port, so the estimate prices nothing
  instead of failing. New bundle-file constant `ESTIMATE_PRICES_BUNDLE_FILE`;
  `knip.jsonc` registers the entry; `check-bundle-size.mjs` budgets it; the
  split gate passes (the first cut carried the report scrubber's model text
  and the whole resource governor: scrub narrowed to `redactSecrets`,
  `sharedResourceAdmission` added like the reporting bundles).
- **P3a — paged catalog priced as complete** (`priceCatalogs.ts`). The schema
  reads `NextPageLink` (from the lead's paged capture: `Count: 1000` with
  `$skip=1000`); a set link refuses the whole answer (`catalog-paged`) rather
  than pricing one page as complete. The lead's two Azure captures are
  committed byte-exact with receipts under
  `test/fixtures/estimator/azure-retail-prices-one-sku/` (5,301 bytes,
  sha256 `fc411df7…1293e7f9c7d`) and `azure-retail-prices-paged/` (582,891
  bytes, sha256 `6c5721c4…045515278`), both `.prettierignore`d. No Linode or
  Vultr provider is added: those captures carry no price dates.
- **P3b — cache-retention test never stored a good cache** (test only).
  `retains the stored catalog when the refresh is …` now seeds a validated
  cache first (http error, invalid JSON, drifted shape, paged answer,
  oversize body), then asserts the seeded rows are still served from cache
  with the failure reported and the stored entry byte-identical.
- **P3c — false credential claim** (docs only). The sentence now reads:
  Vultr and Linode plan endpoints answered HTTP 200 with no credentials (the
  lead's receipts say `credentialsSent: "none"`); Hetzner and DigitalOcean
  were not captured in this round so no claim is made about them; the lane
  prices Azure only. (No captures README was on the rig; the receipts were
  used instead.)

## Capture record (rule 13)

- Pinned URL unchanged (`ESTIMATE_PRICE_CATALOG_URLS[0]`); the committed
  `azure-retail-eastus.json` is untouched (5,686 bytes, sha256 `117a700e…`,
  still byte-identical to the live GET per RVCM1174).
- Lead captures used as fixtures (byte-exact, hashes match their receipts):
  `azure-retail-prices-one-sku` (9 items, `NextPageLink: null`, Spot rows
  dated `2026-07-01` beside on-demand `2025-10-01`) and
  `azure-retail-prices-paged` (`Count: 1000`, `NextPageLink:
https://prices.azure.com:443/…&$skip=1000`, no pinned meters). Both fetched
  2026-10-11 with no credentials (`credentialsSent: "none"`),
  `cache-control: no-cache`, the same `x-ms-ratelimit-*` pair as the pinned
  capture. WHATWG normalizes the default HTTPS port (`:443`) to an empty
  `url.port`, so the reader's empty-port check allows it. The adapter's
  non-empty `NextPageLink` refusal rejects the paged answer before a second
  fetch.

## Acceptance evidence

- Dated catalog price: `maps the captured meters to dated hourly rows`
  (D8 row `2024-10-01`, rest `2025-10-01`, document `2025-10-01`);
  `dates each row by its own meter, not the page maximum`;
  `ignores later unpriced rows when dating prices` (one-SKU fixture);
  `fetches a pinned catalog once, then serves the dated cache offline`.
- None without a catalog: `refuses … before any price shows`,
  `refuses an answer with none of the pinned meters`,
  `refuses a paged answer instead of pricing one page as complete`,
  `never fetches an unpinned catalog URL`,
  `retains the stored catalog when the refresh …` (5 cases),
  `refuses a redirect to another host before parsing`.
- Network setting honoured: `prices a rented setup from a fresh cache while
the network stays off` (`fetchPublic` never called); `sends the ETag and
reads the answer within bounds`; `revalidates with the cached ETag and
stores the fresh retrieval` (conditional GET observed, no unbounded read).
- 24 tests in `test/unit/estimatorPriceCatalog.test.ts`.

## Red drills (byte-exact restoration verified by SHA-256)

Pre-drill hash: `priceCatalogs.ts`
`10065a73a102b37013e6f14e3b49c044def14c5c355ff2381bb0cf8930eb9db1`.
After each drill the file was restored and the hash re-verified identical.

1. Per-row date guard break (row date pinned to `'2025-10-01'`):
   `dates each row by its own meter, not the page maximum` failed. Restored.
2. Pagination guard break (removed the `NextPageLink` refusal):
   `refuses a paged answer instead of pricing one page as complete` failed.
   (First attempt did not fail: the byte-exact paged body carries no pinned
   meters, so the zero-rows refusal masked the guard. The test was
   strengthened to refuse a pinned-meter page on the captured link value
   alone, then the drill failed as required.) Restored.
3. Port-level drills (P1 normalised-URL acceptance, P2a unpinned/redirect
   refusal, P3b retention) could not run to green on this rig (see below);
   breaking those guards was verified by reading, not executed.

## Verification

- `test/unit/estimatorPriceCatalog.test.ts`: 15/24 pass on this rig at
  repository timeouts (no `--testTimeout`); all 9 failures are the port tests
  that write through the shared cache, blocked by the sandbox (`spawn EPERM`
  from `ReportStorage`'s writer-lock `/bin/ps` probe — the pre-existing
  `reportNetworkBinding.test.ts` fails identically here, 1 failed / 1
  passed). The reader path itself was verified here with a stub cache (200 +
  normalised URL → `ok` with parsed data, entry written), and the scrub was
  verified to leave the pinned URL alone while redacting a registered
  secret; both scratch suites were removed afterwards. **The lead runs the
  9 port tests outside the sandbox.**
- Neighbours (no spawns): `estimatorPrices`, `estimatorEntry`,
  `estimatorLocalFleet` (45 passed), `estimatorRecommend`,
  `estimatorSnapshotStrict`, `runtimeEstimatorPorts` (54 passed).
- `tsc --noEmit -p tsconfig.json` and `-p test/unit/tsconfig.json`: clean.
- `eslint --max-warnings=0` and `prettier --check` on all changed files: clean.
- `npm run duplication` (jscpd): 0 clones (includes fixing two clones that
  pre-existed at HEAD: the row-sort comparator, now `compareCatalogRows`,
  and the snapshot lane-remap, now `rekeySnapshotLanes` in
  `test/unit/helpers/estimator/fixtures.ts`).
- `npm run deadcode` (knip): clean (new bundle entry registered).
- `node scripts/check-l10n.mjs`: 14 UI tables, 14 usage tables, 0 problems
  (no new user strings).
- `npm run check:host-api`: 0 problems after `-- --write` (one-line record
  update: `node:crypto` 169 → 170 for the newly reached `local.ts`).
- `npm run check:reference`: pass (no new commands/settings).
- `node scripts/check-bundle-split.mjs`: exit 0.
- `npm run build`: `dist/extension.js` 553.0/600 KiB ok,
  `dist/estimatePrices.js` 58.0/75 ok (new budget, measured +15%),
  `dist/estimator.js` 67.4/75 ok, `dist/planSnapshot.js` 67.0/75 ok.
  `dist/webview` estimator panel stays OVER at 25.3/25 KiB — pre-existing,
  not this lane (no lane string in any webview bundle). The size gate's
  non-zero exit is that pre-existing OVER only.

## Open items for the lead

- Run the 9 port tests outside the sandbox (list above); nothing else is
  outstanding — every RVCM1174 finding is fixed in this diff.
- `npm run quality` full gate at integration (this rig ran every gate except
  the spawn-blocked port tests).
- The captures README named in the brief was not on the rig; receipts used.
- Follow-ups outside this scope: more catalogs/providers, macOS/GPU meters,
  M113 N owning the transport, provisioning (Slice 2) consuming the prices.

## CM1174R3 — RVCM1174B repairs (2026-10-11, unsandboxed macmini)

Base: `0729bc9ab`. The R2 verification and open-items paragraphs above are
historical and superseded by this round's observed results below. All runs use
repository test deadlines and at most three files/workers. No live or paid
model calls, network probes, dependencies, merges or pushes.

- Baseline: `estimatorPriceCatalog`, `estimatorPrices`, `estimatorEntry`:
  **5 failed / 59 passed**; all five failures reproduce the review's fresh-cache
  defect. `estimatorRecommend`, `estimatorLocalFleet`, `runtimeEstimatorPorts`:
  **42 passed**.
- P2: all five retention cases refresh at `AS_OF + MAX_AGE + 1 ms`, assert
  one actual transport call, old rows/date, stale cache provenance, recorded
  unavailable reason, and unchanged validated price projection. The additional
  `a failed refresh never overwrites the stale price cache used by the next lookup`
  case verifies the preserved projection's serialized bytes and a subsequent
  offline read without another request. Restored suite: **65 passed** before
  adding the documentation regression.
- P3 docs: the default-port explanation above now matches WHATWG parsing.
  `documents the default HTTPS port normalization and the actual pagination guard`
  ties the capture's literal `:443` to empty parsed `url.port`, checks the
  certification statement, and requires the adapter's `catalog-paged` refusal.

### Executed red drills

- P2: deliberately store an empty replacement in the refresh catch. The new
  stale-cache/next-lookup test and all five retention cases fail on the stored
  projection; the core retention test fails too (**7 failed / 59 passed**).
  Restore `src/core/estimator/prices.ts` byte-exact:
  SHA-256 `7b7862fc205e9e20624ef035793fb8ee5a0fc38ab194ad41488bbe2d429bb8d5`.
- P3 docs: replace the corrected explanation with the old port claim. The named
  documentation test alone fails (**1 failed / 65 passed**). Restore the
  certification byte-exact: SHA-256
  `ff044bbd51f37e3d3ce82b5fd6bc8bc5f9bf4fcca9fd02feb1b856f06de1445e`.

### P1 and live egress fixes

- **P1 packaging:** `.vscodeignore` now allows `dist/estimatePrices.js`.
  `REPORT_PACKAGE_FRAME_PATHS` includes it and the sibling `planSnapshot.js`
  (the existing frame-vocabulary test reproduced that missing frame row).
  One new guard, `ships every built bundle production can require in the VSIX builder file list`,
  derives entries/output names from the production build configuration, builds
  real production bytes in an owned temporary tree, follows emitted lazy
  loader/require/worker call sites with lexical filename resolution, and compares
  the reachable bundle set with the same VSCE `listFiles` API/options used by
  `package-vsix.mjs`. The sweep finds **only estimatePrices.js missing** from
  the real production runtime closure; no other bundle shipping omission.
  Standalone program paths such as `acp.js` do not count as required modules.
  The publication inventory includes all emitted bundles and the real manifest
  and ignore policy; source/test fixture trees stay outside its VSCE walk.
- **P1 failure honesty:** missing and wrong-shape price bundles now throw the
  safe `price-catalog-bundle-unavailable` refusal through the existing lazy
  loader. The estimator propagates it and the host posts its failure/notice;
  it cannot become a successful estimate with an empty catalog. Logs retain
  fixed words rather than the path, account text or arbitrary loader cause.
  Both named `shows a ... price bundle as its own refusal reason` cases failed
  against the prior loader and pass after repair. Existing loader retry/cache
  semantics remain in the shared lazy loader.
- **P3 egress:** the snapshot/report source and the price port receive the
  **same** `estimatorNetworkPolicy` object. Its live mode getter reads trust,
  sandbox network, Reports mode and the signed-in revision at use. The price
  transport invokes that policy's `allowEgress` again after the report reader's
  cache await, then synchronously rereads live mode/sign-in before calling the
  transport. Five cases withdraw trust, sandbox permission, Reports mode,
  sign-in, or change Always to When signed in without a session between the
  price-cache read and request; no request leaves. A sixth test permits initial
  egress and denies the same function at the socket after the reader cache;
  it failed before the second egress call and now passes.
- README, help relationships/generated reference, changelog and roadmap move
  with these fixes. No new translation key, dependency, network endpoint,
  budget, ignore weakening, timeout override or paid/model call is added.

### Additional executed red drills

All drills run complete owning files, never filtered tests. Each file is saved
and restored byte-exact in `finally`, with the before/after SHA-256 compared.

| Drill            | Deliberate break                                  | Observed failure                                        | Restored SHA-256                                                                            |
| ---------------- | ------------------------------------------------- | ------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| P1 package       | Remove the estimatePrices allowlist line          | Named shipping guard, 1 failed / 58 passed              | `.vscodeignore`: `636332ba091757c1bdeee57dd14323afb2e2bfaf39c731fea15dbbf80279f981`         |
| P1 loader        | Convert the load refusal to an empty-success port | Both missing/invalid bundle tests, 2 failed / 72 passed | `priceCatalogBundle.ts`: `823f802d8b7d5e0f9ef65c188e62981336b59e401e72247757fb8d993e09dc36` |
| P1 frame sibling | Remove the planSnapshot frame row                 | Existing frame-vocabulary test, 1 failed / 116 passed   | `constants.ts`: `e5b551cd907784cd51d5bae16e1acfea0e763a62dbd84d70687c54db4052ca7d`          |
| P3 live policy   | Always admit instead of rereading permissions     | All five withdrawal cases, 5 failed / 69 passed         | `priceCatalogBundle.ts`: `823f802d8b7d5e0f9ef65c188e62981336b59e401e72247757fb8d993e09dc36` |
| P3 socket        | Remove the final allowEgress check                | Named second-egress test, 1 failed / 73 passed          | `priceCatalogSource.ts`: `54bc183931955b5d618518ec8ae1e7718ec170f0b70aed004a92fe2e56dfa60c` |

### Preparation and budget evidence

The private build needs the actual formatting config to pass its unchanged
schema-freshness gate. An exploratory whole-build-tree VSCE inventory hit its
60-second setup deadline; profiling measured 25.3 s build, 8.6 s emitted-call
analysis and 23.3 s inventory. The final publication-only inventory keeps all
real emitted bundles and the builder's real policy while removing that unrelated
source/test traversal. The restored shipping/catalog/core run passes all 59
cases. The real production build belongs in `beforeAll` with a named 60-second
preparation bound; every assertion keeps the repository's default test deadline.
No `--testTimeout` is used, and no existing deadline is raised.

`npm run build` exits 1 only on the unchanged estimator-panel closure:
25,858 bytes / 25,600 (258 bytes over), already recorded at the R2 base. Every
other bundle budget passes: activation 552.7/600 KiB, price catalog 58.2/75,
estimator 68.0/75, snapshot 67.0/75. The failing panel's UI/schema/composer
files are outside this lane's ownership and remain untouched. PLAN section 7
records this pre-existing composition deferral for the lead; all four review
findings are repaired without a residual or a cap change. Aggregate quality is
lead-owned under the explicit rig/common brief.

### Final restored regression receipts

Unsandboxed macmini, repository deadlines, `--maxWorkers=3`, three files per
run, no filtered/skipped cases:

| Files                                                                    | Observed result |
| ------------------------------------------------------------------------ | --------------- |
| estimatorPriceCatalog, estimatorPrices, estimatorEntry                   | 74 passed       |
| estimatorPricePackaging, flightRecorder, reportNetworkBinding            | 62 passed       |
| estimatorRecommend, estimatorLocalFleet, runtimeEstimatorPorts           | 42 passed       |
| estimatorSnapshotStrict, estimatorPlanSnapshotSource, reportNetworkCache | 85 passed       |

Total: **263 passed across 12 files**. The snapshot group first exposed one
source-text binding assertion whose slice started after the newly shared policy
declaration (**1 failed / 84 passed**). Its start marker now includes that
declaration; all original trust, Reports-mode and authentication assertions and
behavioral cases remain. The restored complete group passes all 85 cases.

The extra `npm run check:visual` attempt was stopped during local reconstruction
of the 9,792-capture historical baseline after 2,088 captures, before candidate
comparison. It is **incomplete**, not a visual pass; no paint files or baselines
are changed. The owned browser process group was stopped, and the script's
cleanup removed both the reconstructed source and PNG tree. No owned visual
process or temporary directory remains.

Final static receipts: `npm run typecheck` exits 0 for host, webview, unit,
e2e and integration projects. ESLint on every changed TypeScript/MJS file exits
0 with zero warnings; Prettier on changed source/generated files and docs is
clean. `npm run deadcode` exits 0 (only existing configuration hints), and
`npx jscpd` reports **0 clones**. Localization validates all 14 UI/usage tables
with 0 problems; reference, host API and roadmap gates pass. The production
bundle-split and host-globals checks both exit 0 after the size-gate stop noted
above. `git diff --check` is clean. The rig brief forbids aggregate quality;
that gate remains the lead's integration responsibility.
