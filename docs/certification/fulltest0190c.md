# Full unit suite on the JOINC tree (features + dependencies) — fulltest0190c

Lane FULLTEST3, rig macmini, worktree `/Users/randy/lanes/FULLTEST3`.
Tree: JOINC head `da685b341` (release/0.19.0 + features group + dependency
group) plus lane commit `27d2f8b5d` below. Date: 2026-10-18.

Method (per brief, RIG NOTE timeouts rule): `npm ci`, `npm run build`, then
the whole suite the way CI runs it — repository default timeout (5 s, never
`--testTimeout`), sharded, at most 3 files per vitest run with
`--maxWorkers=3`. 461 test files (`test/unit`, `test/e2e`) in 154 groups of
3; every group ran to completion with the repo timeout. No FULLTEST sibling
record existed in `docs/certification/` at sweep time, so nothing was skipped
on that basis — every failure below was reproduced and diagnosed directly.

## Outcome

- 16 of 154 groups had failures: 55 failing tests plus 2 suite/setup-level
  failures (G80 afterAll, G83 globalSetup), all listed below and reconciled
  by file (17+11+4+3+3+3+2+2+2+2+1+1+1+1+1+1).
- Real defects fixed at cause: scheduleLeaseLifecycle speed assertions
  (`27d2f8b5d`, 42/42), report-history writer lock without birth
  (`14c44a7f0`; G1/G108/G123 green), activation budget by deferral not
  raise (`e687d9a0d`, growth -67030), nativeGitCore teardown timeout
  (`afad2959d`), and the build gate — dropped production tasks, the
  conversation overrun via previews deferral, the stale split reader
  (`861eab554`, full `npm run build` exit 0 on the scratch-trimmed tree;
  eslint zero `8733a12e7`, proven by the passing pre-commit hook over all
  staged files).
- 33 ps-denied failures hardened per rule 3: the lock path fixed in
  product; sampler/trees/ledger/fileLease tests branch on the real table
  probe and assert the documented degraded contract each way (commits
  `71f4f94e6`, `7b0d05f6d`). The denial itself stays sandbox-only (proven
  `/bin/ps` EPERM; see proof).
- 5 failing tests plus the packagedBundles setup failure are untrimmed-join
  state owned by the main join (CHANGELOG 0.19.0 notes over the What's New
  bound; JOINC brief reserves the trim).
- 4 remaining failures are rig-overload timing (G34's estimator suites,
  green solo with the repo timeout; hosted macOS runs files serially,
  giving more headroom).

## Fixed: scheduleLeaseLifecycle disk cases assumed a fast disk (G115, 11 fails)

`expectReleasedForNextWriter` and the first case's final lock required a disk
acquisition within 100 ms. A bare disk acquisition here takes 147–153 ms
(measured with a throwaway probe, since removed): one acquisition does ~35
syscalls plus two fsyncs by durability design, and this rig measured ~10 ms
per file op and 60–70 ms per fsync at load 12 on 12 CPUs with the disk 90%
full and ~3200 tps. The product behaves correctly throughout (returns busy
past the caller's deadline); the 100 ms was a test-only hang guard with no
product contract behind it. Per the brief's rule 3 the speed assertion was
the defect: both call sites now assert entry (`toBe('next')`) with no
wall-clock budget. The busy path stays covered by the already-past deadlines
elsewhere in the file (unaffected by machine speed), and a store that never
frees still fails — proven with a throwaway probe (never-freed store hangs
until the harness timeout instead of resolving). Fix commit `27d2f8b5d`
also converts two asterisk-prefix doc comments to line comments (one mine,
one pre-existing on HEAD) so the touched file passes the unicorn-77 rule.
Suite: 11 failed → 42/42, re-verified on the final tree.

## Sandbox denial: `/bin/ps` execution is policy-denied here (33 fails)

Proof (two lines plus one): `/bin/ps -p $$` answers `/bin/sh:
/bin/ps: Operation not permitted`; from Node, `spawnSync /bin/ps EPERM`.
But the binary EXISTS: `-rwsr-xr-x 1 root wheel ... /bin/ps`, a setuid
Mach-O system binary that Apple ships on every macOS. EPERM on an existing
system binary is sandbox policy, not a missing OS facility (missing would
be ENOENT). Hosted CI runs these suites on macos-latest standard runners
(`.github/workflows/build.yml` unit matrix), where no such policy exists.
Per the follow-up orders every ps-denied path below was hardened anyway
(rule 3): locks work without birth, and where no table means no proof the
product refuses rather than invents. No skip, no timeout change; each test
branches on the real table probe
(`test/unit/helpers/processBirth.ts`, shared) and asserts the documented
contract of the branch it runs.

- G1 `test/e2e/reports.e2e.test.ts` (17), G108
  `test/unit/reportProductionTransport.test.ts` (3), G123
  `test/unit/storeProject.test.ts` (3): FIXED IN PRODUCT
  (`14c44a7f0`). Report-history save threw "could not be saved", stack
  `ownStart ← startOf ← ReportStorage.transaction ← ReportHistory.save`:
  `ownStart` probed this process's birth through `/bin/ps -o lstart=`
  and the throw escaped. Now an unreadable birth records
  `BIRTH_UNAVAILABLE` and `isDead` checks kill(2) first, using birth only
  to refine a live process — an unreadable birth never authorizes removal.
  Verified 27/27, 6/6, 20/20, plus the new
  `test/unit/reportStorageWriterLock.test.ts` (2/2) proving locks hold
  without a process table either way the probe answers.
- G38 `test/unit/fileLease.test.ts` (4): BRANCHED (`71f4f94e6`, 29
  passed 1 skipped). `processStartTime` is undefined here
  (`src/core/locks/processOwner.ts`); the table branch keeps every
  original assertion, the silent branch asserts the uptime-estimate owner
  (within 2 s) and lease-expiry takeover instead of at-once reuse. The
  same-pid reuse line stays unconditional: our own birth needs no table.
- G68 `test/unit/macRss.test.ts` (3): BRANCHED (`7b0d05f6d`, 27/27). The
  sampler's refusal contract already covers a denied table (no reading is
  ever invented); the silent branch asserts `EMEDIA_RSS_UNAVAILABLE` for
  the live child. No product change.
- G142 `test/unit/treesLifecycleNative.test.ts` (2): BRANCHED
  (`7b0d05f6d`, 3/3). Identity and signal go through the native helper
  and work without ps; only listing needs the table. The silent branch
  proves the zombie natively (kill(2)-present plus helper-exited, signal
  still answers `gone`) and asserts the degraded listing contract:
  members empty, scope kill `refused` (a ticket alone confers no
  membership; signalling unlisted pids blind could hit setsid-escaped
  processes), the enrolled root still signalled. No product change.
- G143 `test/unit/uploadLedgerTwoProcess.test.ts` (1): BRANCHED
  (`7b0d05f6d`, 3/3). The silent branch asserts doubt-keeps (delete
  refused while the holder lives) then the delete proceeding once the id
  is provably gone without any birth read. No product change.

## Join state: untrimmed 0.19.0 CHANGELOG owns the What's New bound (5 tests + setup)

One root cause: the joined `[0.19.0]` notes decode to ~148 KB against the
76,800-byte What's New bound, with 9 Highlights against the 5 the gate
allows. Trimming is reserved to the main join (JOINC brief: "Do not trim
notes ... the main join does that once"; JOINC rig note: the bound "may
stay red here"). No fix from this lane; each failure below quotes the same
numbers from its own assertion.

- G18 `changelogVersion` (1): "the 0.19.0 section of CHANGELOG.md has 9
  Highlights; keep at most 5".
- G28 `cx1r2Truth`, `cx1r4Truth` (2): "The two newest releases are 149735
  bytes of What's New content; the budget is 76800".
- G83 `packagedBundles` (exit 1, 0 test fails): its globalSetup builds the
  production package, and `scripts/build.mjs --production` throws
  "CHANGELOG.md 0.19.0: its release notes decode to 147798 bytes, over
  the What's New bound". Same for `npm run build` on this tree.
- G149 `whatsNewContent` (2): same bound error, plus the derived
  'over-budget' vs 'encoded' assertion.

## Rig overload: parallel-load timeouts, green solo with the repo timeout (4 fails)

This rig ran load ~12 on 12 CPUs with ~3200 disk tps during the sweep, and
the sweep runs 3 files in parallel per the rig rule (hosted macOS CI runs
files one at a time). These fail only under that load; each passes alone
with the repository's own timeout, so no timeout was raised and no product
or test change was made.

- G34 `estimatorPlanSnapshotSource` (2: "resolves the workspace plan with
  git evidence", "refuses without reading when the root is empty") and
  `estimatorSnapshotStrict` (2: F1 sign-in trust, F3 merged branches):
  5 s timeouts in-group; solo 13/13 (slowest case ~1.6 s) and 17/17.
  Real git/gh subprocess work, no hang (durations scale with load).
- G80 `nativeGitCore` (1 suite): all fixture cases passed in-group, then
  the `afterAll` recursive removal of the created fixture repositories
  exceeded the 10 s default hook timeout; solo 28/28. FIXED IN TEST
  (`afad2959d`): the teardown carries the file's own named
  `FIXTURE_BUILD_TIMEOUT_MS` — removing the tree is the same long
  operation the build hook's timeout covers (the brief's allowed named
  timeout with a one-line reason). (Group mates
  museConfigView/museSettings pass.)

## Real join growth: activation budget fixed without moving it (G76, 1 fail)

`modelsActivationBudget`: growth 17132 bytes vs the 3072 allowance.
Decisive comparison: the same test on a scratch checkout of the base
`c72aef8cd3` (symlinked node_modules, since removed) reports
baseline=561352 current=563561 growth=2209 — green. The join adds ~15 KB
of minified reachable bytes. Traced (esbuild metafiles, base vs JOINC):
the msm105 media production service enters activation only through
first-use dynamic `import('./host/backend/productionMediaEntry.js')`
(extension.ts:2776,2788) — correctly lazy with its own production
chunk — but the deferred-cohort filter matched the entry while
`DEFERRED_OUTFILES` had no row for it, so the no-split budget build
inlined the whole media closure into activation. FIXED (`e687d9a0d`):
one map row; growth falls to -67030 (allowance 3072), no budget moved.
An attempted `EstimateDiagnosticError` extraction measured zero effect
and was reverted; the tree carries no churn for it.

## Build gate on JOINC: dropped tasks, conversation overrun, stale reader

`npm run build` on the joined tree failed three independent gates behind
the What's New block (join state above), all fixed in this lane without
moving any budget (`861eab554`):

- Two MISS chunks: the join dropped the `reportInputs` and
  `playbookSchedulesInputs` production tasks during conflict resolution
  (their feature commits added them; absent at JOINC head `da685b341`)
  while loaders, size budgets and checks still demand both. Restored in
  the map's own style; both build under budget (98.2/100, 56.2/59 KiB).
- `dist/conversation.js` 254.8 KiB over its 250 KiB budget on cumulative
  join growth (CI runs the same gates per PR, so no single culprit).
  `LegalFixPreviews` moves `src/host/legalFix.ts` →
  `src/core/legal/fixPreviews.ts` and rides `dist/legalScan.js` (which
  already carries its dependencies); the controller builds it from the
  scanner's bundle on the first legal command through a structural
  bundle-contract surface (`LegalFixPreviewStore`, signatures on trust),
  and every legal-fix command refuses as unavailable without it.
  conversation.js 254.8 → 246.6 KiB; legalScan.js 112.4 → 118.0 of 150.
  No deferred file is inlined anywhere it should not be (metafile ×
  `DEFERRED_OUTFILES` intersection: 0). Proven through the real chunks:
  a throwaway probe required `dist/legalScan.js`, constructed the
  exported previews, and drove `preview`/`confirm` to their documented
  refusals (`nothingSelected`, `staleEvidence`, `previewExpired`).
- Stale split reader: `dist/runtimeMedia.js` formats ACP text attaches
  locally (`acp/media.ts` → `AttachmentStore.add` → `textFileInput`),
  but `TEXT_ATTACHMENT_MODEL_TEXT` readers predated the media bundle.
  The list now names runtimeMedia with the reason; the rule still bites
  (it is what fired).

Proof of the whole gate: `npm run build` exit 0 on a scratch-trimmed
tree (the 0.19.0 notes stubbed to fit, then `git checkout` restored —
worktree diff confirms byte-identical restore): tokens, esbuild,
check-bundle-size, check-bundle-split, lazy-registry, host-globals and
notices all green. The real tree's build still stops at the What's New
bound, which is the main join's trim to make.

## Green, contrary to the anticipated list

- Vault suites (G145–147: kdf, loginCsv, policy, scrub, sshImport,
  useDigest, vaultPanelBuild): 28+53+11 passed — the broker-socket-path
  failure did not reproduce on this tree.
- `inspectNative` (G49) passed. No `chatGptLocalFailures`/`shellNoDeadline`
  tests exist in this tree (brief names do not match any suite here).

## Gates on the final tree (8733a12e7)

- `npm ci`: exit 0.
- `npm run build`: green through every gate on the scratch-trimmed tree
  (exit 0; see build-gate section), red on the real tree only at the
  What's New bound the main join owns. No budget or timeout moved.
- `npm run typecheck` (all five projects): exit 0.
- eslint zero (`lint:js:main`, `lint:js:unit`, `lint:js:tests`, each with
  the repo's 6 GB heap; a single `npx eslint .` OOMs on this rig). True
  total at JOINC head was 269 errors (`run-s` stops at the first red
  partition, so `npm run lint:js` reported only main's 234): 251×
  `unicorn/no-asterisk-prefix-in-documentation-comments` (the dependency
  group's unicorn-77 rule lighting up old `/** */` comments),
  `prefer-type-error` ×6, `prefer-default-parameters` ×2,
  `no-unnecessary-parameters` ×5, `no-unnecessary-array-flat-map` ×4.
  Fixed mechanically: the asterisk autofix only strips inner `*`
  prefixes (proven with a throwaway tsc probe that `/** */` association
  and `@param` parsing survive, so hover docs are intact);
  `Error`→`TypeError` only in `instanceof`/`typeof` narrowing guards
  (messages unchanged); flatMap shapes rewritten as filter+map and
  loops; same-value/default params inlined. One escape hatch instead of
  a fix: `filePin`'s 5-argument shape is
  `scripts/build-linux-helper-pins.mjs`'s regex contract (removing the
  params breaks the release generator), with the inline reason and the
  PLAN.md §8 row. Verified: typecheck all green, format clean,
  `check-linux-helper-pins` accepts, and every suite covering a
  behavior-touched file passes (estimator, keybindings, privateRootLease,
  transcribeBatchHttp, voiceBatchSeams, acpMediaPort,
  playbookSchedulesInputs, all vault unit files, linuxHelperPins 3/3).
- `node scripts/check-plan.mjs`: red — PLAN.md is 3,590,304 bytes
  against the 3,565,158 bound (85% of the reader), already 24.6 KB over
  at JOINC head (HEAD file is 3,589,817 bytes). Needs the archive
  procedure (`npm run plan:archive`), which is main-join scope; this
  lane's one §8 row is required by the escape-hatch rule. Not in this
  lane's gate list; recorded.
- `npm run format:check`: exit 0. `node scripts/check-l10n.mjs`: 0 problems.
- Suites touched, all re-verified on the final tree: scheduleLeaseLifecycle
  42/42, reports.e2e 27/27, storeProject 20/20, reportProductionTransport
  6/6, reportStorageWriterLock 2/2, fileLease 29 passed 1 skipped,
  macRss 27/27, treesLifecycleNative 3/3, uploadLedgerTwoProcess 3/3,
  nativeGitCore 28/28, estimatorPlanSnapshotSource +
  estimatorSnapshotStrict 30/30, legalFixProduction + legalScan +
  legalCommand 21/21.
- Per-group logs: `temp/groups/group-0.log` … `group-153.log` (gitignored,
  kept in the worktree); sweep runner `temp/run-groups.sh`.

## Carried onto the features tree (FULLTEST3REPLAY, 2026-10-18)

This record was written against JOINC (`da685b341`, features + dependency groups); the features-only tree (`1d967f741`) carries what belongs to it, one cherry-pick (`-x`) each: `27d2f8b5d` (schedule entry, not speed — 42/42 here), `14c44a7f0` with `71f4f94e6` and `7b0d05f6d` (writer locks hold without a process table and the ps-bound suites branch on the real probe — this rig denies `/bin/ps` with EPERM, so the uncarried tests fail 3/6 on the base here while the carried ones pass; one unidentified single-test transient in the first carried run, green on the next three runs, stands UNMEASURED), `861eab554` (restored `reportInputs`/`playbookSchedulesInputs` production tasks, `LegalFixPreviews` riding `dist/legalScan.js` with the controller conflict resolved by intent toward the lazy store and the stale `src/core/legalFix.ts` path comment pointed at the new location, plus the `runtimeMedia` split reader — legalFixProduction + legalScan + legalCommand 21/21 here), and `afad2959d` (teardown carries the fixture's own named `FIXTURE_BUILD_TIMEOUT_MS`, 28/28 — it raises nothing above what the repository already uses for that fixture, so no teardown-speed investigation was owed). Left out: `e687d9a0d` (a single `DEFERRED_OUTFILES` row, a strict subset of REVPAIR `4c7b29ff3c` on `cand/JOIN0190/126`, which restores both rows plus the regression test — it covers nothing 126 does not, so the final tree takes 126) and the whole of `8733a12e7` (eslint is zero on all three partitions on this tree, so none of its fixes is a lint error here: the 251 comment changes and the code rewrites serve the dependency group's unicorn-77 rule, and its `filePin` disable would be an unjustified escape hatch here with no PLAN.md §8 row needed). The per-group logs and the scratch-trimmed build proof stay in the FULLTEST3 worktree; this tree's own final gates are recorded on the carrying lane.
