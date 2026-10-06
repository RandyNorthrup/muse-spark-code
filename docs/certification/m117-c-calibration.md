# M117 C: calibration

Mac mini, 2026-10-06, branch `m117/c`, base `7f43e600`. Scope is D97.4
only, against the repaired lane-zero contracts. No new dependency, live or
paid call, credential access, network request, UI surface or startup import.
No push, merge or rebase. Hooks remain enabled from this worktree's existing
`.husky/_/pre-commit`.

## Implementation and evidence

- `src/core/estimator/calibration/journal.ts`: a durable private metadata
  journal implementing `EstimateHistoryPort`. Whole fsynced files publish
  through exclusive hard links; replays are idempotent, conflicts preserve
  existing bytes. Reads validate strict UTF-8, schema, file identity and
  bounded size; corrupt records are retained and reported. Ordinary source
  and filesystem failures never expose their raw messages or storage paths.
- `builders.ts`: board active time, git elapsed time, M116 review state and
  CI job-hours through validated injected application projections. Missing
  estimates/durations and unfinished/future lanes have explicit exclusion
  reasons. Missing review/CI data stays unknown. A damaged board is never
  treated as an absent board. No wire shape or missing service is fabricated.
- `records.ts`: canonical ordering and UTC precision; duplicate lane/basis
  measurements count once; conflicting observations/identities fail.
- `prior.ts` and `docs/estimator/prior.md`: a documented assumption-based
  lognormal prior, the cautious review continuation prior derived from three
  distinct repository narratives, and an explicitly assumed redesign risk
  where the historical eligible-family denominator is unavailable.
- `fit.ts`: exact lane-kind/machine-class fits with the independent 20-lane
  thresholds, positive finite lognormal parameters, independent review and
  redesign sample sizes, metadata counted once across duration bases, and
  uncertainty explicitly unknown when no interval has been measured. Git
  elapsed time requires an explicit request. Runtime labels reuse lane 0's
  translated strings, read at call time.
- `laneRedesignRisk`: only current unresolved module families with at least
  two strikes trigger the conditional risk. Unknown review state stays
  unknown. The independence assumption between families is documented.

The M103/M104 fixture's 25 lanes have no evidenced estimates, so all remain
excluded from fitting, despite its 11 measured git intervals. Their review
and CI measurements are also unavailable. The three legacy review narratives
are lower bounds selected for repairs; their 0.75 continuation prior is an
assumption, not a measured population failure rate. The uniform 0.5 redesign
prior is an assumption with zero samples. Parameter uncertainty is unknown.
The journal keeps no conversation, file body, account identity or credential.

The observed duration covers build and fix effort; S must avoid adding that
effort twice. Git elapsed duration also includes waits and CI. Final module
counters cannot recover unrecorded patch-only exposures cleared earlier.
These limitations are documented, rather than replaced with invented numbers.

## Ownership and integration handoffs

No file owned by G/S/R/P/U/W or another milestone was edited. The following
bindings remain with their owners, as authorized by the lane brief:

| Handoff                    | Concrete binding                                                                                                                                                                                                  |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `M117-C-S/G/U/W`           | Consume `fitCalibration`'s frozen `calibration` row and its `evidence`, `durationBasis`, `reviewSamples` and `redesignSamples`; use `calibrationLabel` at render time and preserve unknown current review state.  |
| `M117-M96-history-board`   | Supply evidenced merged lane estimates from M113 and complete active-agent accounting from the board.                                                                                                             |
| `M117-M113-history-git/CI` | Supply first implementation commit to integration merge UTC intervals and summed CI job-hours after the sources' captured-response parsers.                                                                       |
| `M117-M116-history`        | Supply complete lane rounds, current module/class strikes and named redesign outcomes through the review port; finish enrichment before immutable append.                                                         |
| `M117-W-storage/docs`      | Instantiate the journal in private storage only from the lazy estimator bundle; define retention/export/deletion policy; update PRIVACY, README, CHANGELOG, featureCatalog/reference and PLAN integration status. |

Portable core code is shared equally by every editor, ACP/headless and TUI.
There is no VS Code-only entry. W owns surface bindings, the lazy chunk,
measured integrated budgets and feature registration. C adds no command,
setting or independently shipped feature, so does not register an unfinished
surface or edit shared translations/manifest tables. All user text uses the
already translated lane-zero keys; no language table or escape hatch was added.

The scoped brief prohibits aggregate `npm run quality` and assigns it to
the lead. This lane runs owned tests at the repository's default timeout,
all five typechecks, scoped lint/format, deadcode, duplication, localization,
reference, host API and production build checks directly on Mac mini. No
gate, ignore, threshold, cap or timeout changes. Native Windows name durability
and its link-swap limitation retain their documented platform distinctions;
cross-rig/integrated editor certification is the lead's task.

## Verification

The first complete core suites passed 40 tests and the unit typecheck. The
expanded suites pass 46 tests, including a shared `beforeAll` build for the
two-process determinism test, at default timeout with no skipped tests and
no `--testTimeout`. Both processes use different `TZ`/`LANG` and a minimal
credential-free environment. Temporary test directories are removed.

The first focused run exposed constant-sample CI averaging drift and cleanup
masking a directory-creation failure. The CI mean now uses a stable online
mean; cleanup runs only after this writer creates its staging file and
preserves an earlier failure. Both regressions pass.

The final suites also create their scratch parent in setup. After deleting
the session's scratch directory, both files pass all 46 tests on fresh
storage at default timeout; unit typecheck, scoped lint and duplication pass
again. This removes an accidental dependency on a manually created folder
that would be absent on a clean CI checkout.

Red-drill receipts and final gates follow below. Every mutation runs the
entire owning test file, requires a named assertion failure with nonzero
exit, and restores the original bytes with SHA-256 verification. No skipped
or filtered tests, raised timeouts, shared install edits or hook changes.

## Byte-exact guard-fire record

62 deliberate mutations each exited 1 with a named test failure; all source
restores matched their pre-mutation SHA-256. The entire owning file ran at
the repository default timeout each time. No fixture or shared file changed.

| Source                                       | SHA-256 after every restore                                        |
| -------------------------------------------- | ------------------------------------------------------------------ |
| `src/core/estimator/calibration/records.ts`  | `330313db207cc3206289436f0805ba8682d5e4ce207c0a5ca96fa3bd54c5ae59` |
| `src/core/estimator/calibration/fit.ts`      | `2519fc36742845cfddd31d4312063d8b9d26f38c7a0eaf02002186e8eac2c867` |
| `src/core/estimator/calibration/builders.ts` | `69165b156fe02b550942cd965868aeeacbbf3ec02d708af4ac9a427d92266fe5` |
| `src/core/estimator/calibration/journal.ts`  | `3ac736899ee26ec88be7ab36912494e46ca328652719719725b57257acf9b226` |
| `src/core/estimator/calibration/prior.ts`    | `8baa483851e46f030bca3257f43a23d147e7a242a30dbe7ffd00814ebdc27be9` |

| Drill | Broken guard/model                                                                                                                                                                                                | Named test observed failing                                                                                                                  | Failures |
| ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | -------: |
| C01   | if (!parsed.success) throw calibrationFailure('invalidHistory') → removed                                                                                                                                         | M117 calibration and its honest prior rejects malformed records and queries without echoing source content                                   |        2 |
| C02   | previousIdentity !== undefined && previousIdentity !== identity → false                                                                                                                                           | M117 calibration and its honest prior counts replayed records once and rejects conflicting observations or lane identities                   |        1 |
| C03   | previous && JSON.stringify(previous) !== JSON.stringify(record) → false                                                                                                                                           | M117 calibration and its honest prior counts replayed records once and rejects conflicting observations or lane identities                   |        1 |
| C04   | record.review.modules.sort((left, right) => compareIds(left.familyId, right.familyId)) → removed                                                                                                                  | M117 durable metadata-only history journal canonicalizes dates and module/class order before comparing replays                               |        1 |
| C05   | !z.iso.datetime().safeParse(asOf).success \|\| → false \|\|                                                                                                                                                       | M117 calibration and its honest prior rejects malformed records and queries without echoing source content                                   |        1 |
| C06   | record.kind === kind && → true &&                                                                                                                                                                                 | M117 calibration and its honest prior does not pool kinds, machine classes, git elapsed time, zero hours or future observations              |        1 |
| C07   | record.machineClassId === machineClassId && → true &&                                                                                                                                                             | M117 calibration and its honest prior does not pool kinds, machine classes, git elapsed time, zero hours or future observations              |        1 |
| C08   | Date.parse(record.finishedAt) <= Date.parse(asOf) → true                                                                                                                                                          | M117 calibration and its honest prior does not pool kinds, machine classes, git elapsed time, zero hours or future observations              |        1 |
| C09   | record.durationBasis === durationBasis && record.actualHours > 0 → record.actualHours > 0                                                                                                                         | M117 calibration and its honest prior does not pool kinds, machine classes, git elapsed time, zero hours or future observations              |        2 |
| C10   | record.durationBasis === durationBasis && record.actualHours > 0 → record.durationBasis === durationBasis                                                                                                         | M117 calibration and its honest prior does not pool kinds, machine classes, git elapsed time, zero hours or future observations              |        1 |
| C11   | const isFitted = durations.length >= ESTIMATE_CALIBRATION_MIN_SAMPLES → const isFitted = durations.length > ESTIMATE_CALIBRATION_MIN_SAMPLES                                                                      | M117 calibration and its honest prior replaces the prior at exactly twenty lanes with the lognormal ratio fit                                |        4 |
| C12   | squaredDeviations += delta * (logRatio - mean) → squaredDeviations += delta * delta                                                                                                                               | M117 calibration and its honest prior replaces the prior at exactly twenty lanes with the lognormal ratio fit                                |        1 |
| C13   | Math.max(Number.EPSILON, Math.sqrt(squaredDeviations / durations.length)) → Math.sqrt(squaredDeviations / durations.length)                                                                                       | M117 calibration and its honest prior keeps constant samples positive and extreme ratios finite                                              |        1 |
| C14   | Math.log(record.actualHours) - Math.log(record.estimatedHours) → Math.log(record.actualHours / record.estimatedHours)                                                                                             | M117 calibration and its honest prior keeps constant samples positive and extreme ratios finite                                              |        1 |
| C15   | return Array.from(lanes, ([, record]) => record) → return [...records]                                                                                                                                            | M117 calibration and its honest prior does not double-count review or CI metadata when both duration bases exist                             |        1 |
| C16   | throw calibrationFailure('conflictingReviewHistory') → void 0                                                                                                                                                     | M117 calibration and its honest prior does not double-count review or CI metadata when both duration bases exist                             |        1 |
| C17   | throw calibrationFailure('conflictingCiHistory') → void 0                                                                                                                                                         | M117 calibration and its honest prior does not double-count review or CI metadata when both duration bases exist                             |        1 |
| C18   | record.review.status === 'known' && record.review.rounds > 0 ? [record.review] : [] → record.review.status === 'known' ? [record.review] : []                                                                     | M117 calibration and its honest prior keeps unknown and zero-round review histories out of rate fitting independently of durations           |        1 |
| C19   | const roundCount = reviews.reduce((total, review) => total + review.rounds, 0) → const roundCount = reviews.reduce((total, review) => total + review.modules.reduce((sum, module) => sum + module.strikes, 0), 0) | M117 calibration and its honest prior fits complete review rounds once per lane rather than summing module strikes                           |        1 |
| C20   | module.strikes >= 2 \|\| review.redesigns.some((event) => event.moduleFamilyId === module.familyId) → module.strikes >= 2                                                                                         | M117 calibration and its honest prior fits conditional redesign risk using eligible families and counts each family event once               |        1 |
| C21   | redesigns: exposed.filter((module) => review.redesigns.some((event) => event.moduleFamilyId === module.familyId), ).length → redesigns: review.redesigns.length                                                   | M117 calibration and its honest prior fits conditional redesign risk using eligible families and counts each family event once               |        1 |
| C22   | const isRiskFitted = risks.length >= ESTIMATE_CALIBRATION_MIN_SAMPLES → const isRiskFitted = risks.length > ESTIMATE_CALIBRATION_MIN_SAMPLES                                                                      | M117 calibration and its honest prior fits conditional redesign risk using eligible families and counts each family event once               |        1 |
| C23   | ci.length === 0 ? → false ?                                                                                                                                                                                       | M117 calibration and its honest prior enriches missing review and CI measurements from the other duration basis                              |        1 |
| C24   | if (!parsed.success) throw calibrationFailure('invalidReviewState') → removed                                                                                                                                     | M117 calibration and its honest prior applies redesign risk only at two current module strikes and preserves unknown state                   |        1 |
| C25   | const families = parsed.data.modules.filter((module) => module.strikes >= 2).length → const families = parsed.data.modules.filter((module) => module.strikes >= 1).length                                         | M117 calibration and its honest prior applies redesign risk only at two current module strikes and preserves unknown state                   |        1 |
| C26   | if (parsed.data.status === 'unknown') return { status: 'unknown', value: null, → if (parsed.data.status === 'unknown') return { status: 'known', value: 0,                                                        | M117 calibration and its honest prior applies redesign risk only at two current module strikes and preserves unknown state                   |        1 |
| C27   | import { UI_TEXT } from '../../../shared/l10n/text' → import { UI_TEXT } from '../../../shared/l10n/text' const CACHED_PRIOR_LABEL = UI_TEXT.estimatePrior                                                        | M117 calibration and its honest prior reads the translated calibration label at call time                                                    |        1 |
| C28   | const records = canonicalHistory(values).filter( → Date.now(); const records = canonicalHistory(values).filter(                                                                                                   | M117 calibration determinism is byte-identical with reordered records and review families, without reading the clock                         |        1 |
| B01   | if (!z.iso.datetime().safeParse(asOf).success) throw calibrationFailure('invalidSnapshot') → removed                                                                                                              | M117 board, git, M116 and CI history builders rejects invalid targets, duplicate lanes and invalid snapshot dates                            |        1 |
| B02   | if (!parsed.success) throw calibrationFailure('invalidHistoryLane') → removed                                                                                                                                     | M117 board, git, M116 and CI history builders rejects invalid targets, duplicate lanes and invalid snapshot dates                            |        1 |
| B03   | if (new Set(lanes.map((lane) => lane.laneId)).size !== lanes.length) → if (false)                                                                                                                                 | M117 board, git, M116 and CI history builders rejects invalid targets, duplicate lanes and invalid snapshot dates                            |        1 |
| B04   | lane.state !== 'merged' \|\| lane.estimatedHours === null → lane.estimatedHours === null                                                                                                                          | M117 board, git, M116 and CI history builders excludes unmerged lanes and missing estimates without calling any source                       |        1 |
| B05   | lane.state !== 'merged' \|\| lane.estimatedHours === null → lane.state !== 'merged'                                                                                                                               | M117 board, git, M116 and CI history builders does not fabricate calibration observations for M103/M104 fixture rows without estimates       |        2 |
| B06   | board = await ports.board?.duration(lane.laneId, asOf) → board = undefined                                                                                                                                        | M117 board, git, M116 and CI history builders builds active time with complete review state and CI job-hours, preferring board over git      |        3 |
| B07   | throw calibrationFailure('invalidHistorySource') → void 0                                                                                                                                                         | M117 board, git, M116 and CI history builders fails loudly on malformed projections and does not fall back from a damaged board to git       |        1 |
| B08   | review === undefined ? { status: 'unknown' } : review → review ?? { status: 'unknown' }                                                                                                                           | M117 board, git, M116 and CI history builders fails loudly on malformed projections and does not fall back from a damaged board to git       |        1 |
| B09   | Date.parse(duration.data.finishedAt) > Date.parse(asOf) → false                                                                                                                                                   | M117 board, git, M116 and CI history builders reports missing durations and after-snapshot results explicitly                                |        1 |
| B10   | throw calibrationFailure('historySourceUnavailable') → throw new Error('PRIVATE-SOURCE-CONTENT')                                                                                                                  | M117 board, git, M116 and CI history builders sanitizes failing sources and propagates journal refusal                                       |        1 |
| B11   | (MILLISECONDS_PER_SECOND * SECONDS_PER_HOUR) → MILLISECONDS_PER_SECOND                                                                                                                                            | M117 board, git, M116 and CI history builders derives git elapsed hours only without a board measurement and keeps missing review/CI unknown |        1 |
| J01   | const record = canonicalRecord(value) → const record = value                                                                                                                                                      | M117 durable metadata-only history journal refuses extra fields before writing and never stores conversation content                         |        2 |
| J02   | if (fileStat.isSymbolicLink()) throw calibrationFailure('invalidHistoryFile') → removed                                                                                                                           | M117 durable metadata-only history journal never reads a symlink as a published record                                                       |        1 |
| J03   | const handle = await open(file, constants.O_RDONLY \| constants.O_NOFOLLOW) → const handle = await open(file, constants.O_RDONLY)                                                                                 | M117 durable metadata-only history journal uses native nofollow where available when a link replaces an observed regular file                |        2 |
| J04   | !stat.isFile() \|\| stat.size > RECORD_MAX_BYTES → !stat.isFile()                                                                                                                                                 | M117 durable metadata-only history journal rejects an oversized file or a directory before attempting to read its bytes                      |        1 |
| J05   | !stat.isFile() \|\| stat.size > RECORD_MAX_BYTES → stat.size > RECORD_MAX_BYTES                                                                                                                                   | M117 durable metadata-only history journal rejects an oversized file or a directory before attempting to read its bytes                      |        1 |
| J06   | if (bytesRead > RECORD_MAX_BYTES) throw calibrationFailure('historyRecordTooLarge') → removed                                                                                                                     | M117 durable metadata-only history journal bounds reads when the file grows after its stat                                                   |        1 |
| J07   | { fatal: true } → { fatal: false }                                                                                                                                                                                | M117 durable metadata-only history journal decodes published metadata with fatal UTF-8                                                       |        1 |
| J08   | if (path.basename(file) !== fileOf(record)) → if (false)                                                                                                                                                          | M117 durable metadata-only history journal refuses metadata filed under a different lane identity                                            |        2 |
| J09   | if (hasCode(error, 'ENOENT')) return [] → return []                                                                                                                                                               | M117 durable metadata-only history journal returns an empty history only for storage that does not exist                                     |        1 |
| J10   | if (!file.endsWith('.json')) continue → removed                                                                                                                                                                   | M117 durable metadata-only history journal ignores interrupted staging bytes but rejects unexpected published JSON                           |        2 |
| J11   | if (bytes.length > RECORD_MAX_BYTES) throw calibrationFailure('historyRecordTooLarge') → removed                                                                                                                  | M117 durable metadata-only history journal refuses oversized observations before creating storage                                            |        1 |
| J12   | await handle.sync() → removed                                                                                                                                                                                     | M117 durable metadata-only history journal does not publish when a file flush fails, cleans staging bytes, and allows a safe retry           |        1 |
| J13   | await link(temporary, target) → await import('node:fs/promises').then((fs) => fs.rename(temporary, target))                                                                                                       | M117 durable metadata-only history journal makes a concurrent replay idempotent and refuses a conflicting completed observation              |        3 |
| J14   | if (!hasCode(error, 'EEXIST')) throw error → throw error                                                                                                                                                          | M117 durable metadata-only history journal makes a concurrent replay idempotent and refuses a conflicting completed observation              |        3 |
| J15   | if (JSON.stringify(await this.read(target)) !== JSON.stringify(record)) → if (false)                                                                                                                              | M117 durable metadata-only history journal makes a concurrent replay idempotent and refuses a conflicting completed observation              |        1 |
| J16   | await folder.sync() → removed                                                                                                                                                                                     | M117 durable metadata-only history journal reports a failed directory flush after publication and keeps a complete retryable record          |        1 |
| J17   | await rm(temporary, { force: true }) → removed                                                                                                                                                                    | M117 durable metadata-only history journal persists metadata across journal instances with private permissions and no staging files          |        6 |
| J18   | hasCode(error, 'conflictingHistory') ? 'conflictingHistory' : 'historyWriteFailed' → 'PRIVATE-STORAGE-ERROR'                                                                                                      | M117 durable metadata-only history journal refuses filesystem failures without echoing storage paths or low-level messages                   |        6 |
| J19   | failure ??= calibrationFailure('historyCleanupFailed') → failure = calibrationFailure('historyCleanupFailed')                                                                                                     | M117 durable metadata-only history journal sanitizes cleanup failure and retains an earlier publication failure                              |        1 |
| J20   | const PRIVATE_FILE_MODE = constants.S_IRUSR \| constants.S_IWUSR → const PRIVATE_FILE_MODE = constants.S_IRUSR \| constants.S_IWUSR \| constants.S_IRGRP                                                          | M117 durable metadata-only history journal persists metadata across journal instances with private permissions and no staging files          |        1 |
| C29   | reviewRoundRate: continuations / rounds → reviewRoundRate: rounds / continuations                                                                                                                                 | M117 calibration and its honest prior derives its cautious review prior from three distinct repository narratives                            |        2 |
| C30   | const isReviewFitted = reviews.length >= ESTIMATE_CALIBRATION_MIN_SAMPLES → const isReviewFitted = reviews.length > ESTIMATE_CALIBRATION_MIN_SAMPLES                                                              | M117 calibration and its honest prior fits complete review rounds once per lane rather than summing module strikes                           |        1 |
| B12   | review === undefined ? { status: 'unknown' } : review → review === undefined ? { status: 'known', rounds: 0, modules: [], redesigns: [] } : review                                                                | M117 board, git, M116 and CI history builders derives git elapsed hours only without a board measurement and keeps missing review/CI unknown |        1 |

## Final scoped verification and W's generated-record handoff

All checks below ran directly on Mac mini. The implementation commit is
`e21cad76`; lint-staged and staged gitleaks passed with hooks on. All five
production source files still match the certified hashes after the hook.

| Check                                                                                                    | Result                                                                                                                                                                                                                                      |
| -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Owned Vitest files (`estimatorCalibration.test.ts`, `estimatorHistoryJournal.test.ts`, `--maxWorkers=3`) | 46 passed, no skips, repository default timeout; includes cross-process TZ/LANG determinism.                                                                                                                                                |
| Red drills                                                                                               | 62 distinct deliberate mutations, 89 named assertion failures, all exits 1, all restores SHA-256 identical. C04 was repeated successfully after the test-fixture reuse below (63 total drill executions).                                   |
| `npm run typecheck`                                                                                      | All five projects pass; unit typecheck repeated after the final test-fixture change.                                                                                                                                                        |
| Scoped ESLint / Prettier / `git diff --check`                                                            | Pass, zero lint warnings.                                                                                                                                                                                                                   |
| `npm run deadcode`                                                                                       | Pass; existing vendor/axe-core configuration hints only.                                                                                                                                                                                    |
| `npx jscpd`                                                                                              | Pass: zero clones over 1,194 files. The first run found one duplicated review fixture in the two new test files; the journal test now extends the existing fake record rather than duplicating the literal. No ignore or threshold changed. |
| `node scripts/check-l10n.mjs`                                                                            | 14 tables, 166 manifest strings, 612 source files; zero problems.                                                                                                                                                                           |
| `npm run check:reference`                                                                                | Current: 53 features, 44 commands, 59 settings, 26 slash commands, 116 CLI entries.                                                                                                                                                         |
| `npm run check:host-api`                                                                                 | **One generated-file freshness failure**, detailed below; no VS Code API or capability change.                                                                                                                                              |
| `npm run build`                                                                                          | Pass: unchanged caps, bundle splits, host globals and third-party notices (83 bundled packages).                                                                                                                                            |

Measured production budgets: activation **439.5/600 KiB**, Model API
**446.9/475 KiB**, ACP **821.4/850 KiB**, shared English **55.0/125 KiB**,
webview startup **797.1/900 KiB**, deferred webview code **50.0/50 KiB**.
No estimator runtime entry ships on this branch yet: W owns its lazy entry
and measured estimator/panel budgets. No cap increased.

**`M117-W-host-api-record`: required integration action.** W owns
`docs/ide-compatibility/**`, so C does not edit the generated record outside
its assigned files. `check:host-api` scans all source imports and reports
exactly these five count changes from `journal.ts`:

| Existing Node built-in | Recorded imports | Actual imports |
| ---------------------- | ---------------: | -------------: |
| `node:buffer`          |               39 |             40 |
| `node:crypto`          |               46 |             47 |
| `node:fs`              |               33 |             34 |
| `node:fs/promises`     |               47 |             48 |
| `node:path`            |               84 |             85 |

W must run `npm run check:host-api -- --write`, review these counts alongside
its integrated source changes, and commit the refreshed record before its
full gate. The actual API set remains **332 VS Code APIs**, **31 files
importing VS Code**, **25 Node built-ins**, and **61 theme variables**. This
failure is recorded openly; the freshness guard was not ignored or weakened.
Aggregate quality and real milestone/editor bindings remain lead-owned under
the brief. No other lane's file was modified, and no installation was needed.

Scratch drill reports and test directories were removed after preserving the
named failures and source hashes here. No credential or model/provider data
was printed, copied or stored.
