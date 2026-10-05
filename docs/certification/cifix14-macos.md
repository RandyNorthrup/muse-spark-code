# CIFIX14M — macOS 0.14.0 CI repair

Worktree: `/Users/randy/lanes/CIFIX14M`; base `fc8adc4c`;
branch `fix/ci-0.14.0-macos`. All commands run directly on the Mac mini.
No paid/live call, push, merge, rebase, dependency or gate change.

The clean-worktree reproduction of `deferredBundles.test.ts` fails exactly
the two reported tests: the English comparison requires `dist/uiText.js`,
and activation requires `./wire.js` from disk. The CI unit job runs after
`npm ci`, independently of the build job, so neither file is available.
This is a test-fixture defect across platforms, exposed on macOS.

The tests now build every English region with the actual production Brotli
plugin and resolve support bundles from their own in-memory output map.
The existing plugin moved to `scripts/lib/uiTextRegions.mjs` so both the
production build and private fixtures use it. Its disk output behavior is
preserved; in-memory builds replace their output bytes instead. Exact English
values, shared-parser checks and deferred-action assertions stay enforced.

Initial focused run: **32 tests passed**, across `deferredBundles.test.ts`
and `uiTextRegions.test.mjs`. Clean reproduction and focused logs are in
`temp/cifix14/deferred-before.log` and `deferred-after.log`.

Guard drills (each ran the complete deferred-bundle file and exited 1):

| Drill                                    | Expected failure                 | Byte-exact restoration                                                             |
| ---------------------------------------- | -------------------------------- | ---------------------------------------------------------------------------------- |
| Corrupt the codec's `actionFailed` value | Exact English comparison differs | SHA-256 `c7c1d7df6366b64ba1aa4f9efa1a7291b3f1beb9007fa2df97b874193a69d43d` matched |
| Restore the old activation resolver      | `Cannot find module ./wire.js`   | SHA-256 `81984eb3a08a547d3fbe1b4f43bb8c95e7e1181462447fb71bc5cf7ec3f26efd` matched |

The first wire drill passed unexpectedly because the process-e2e fixtures had
built `dist/` meanwhile. The corrected fixture filenames live in an empty,
private temporary directory, so stale production output cannot mask an omitted
support bundle. The repeated drill then failed at exactly the expected test.
No retry or timeout was added.

Pre-commit checks: `npm run typecheck` passed all five projects; scoped
ESLint and Prettier passed. The final focused run after fixture isolation passed
all **32 tests in two files**. The full-suite and remaining static/build receipts
are recorded below.
CI integration runs only on Linux/Windows, so it is not a macOS requirement.
The rig provides Node 24.21.0; hosted CI pins Node 22. Commands use the rig's
available runtime without downloads or machine changes.

The rig note limits Vitest to three files and three workers per process and
sets `--testTimeout=120000`. CI's four shard memberships are generated with
Vitest's own `BaseSequencer.shard` (the `list --filesOnly` command ignores the
shard selection). Every member is executed once per complete run, in batches
of at most three with default/blob/JSON reporters. Run 1 collects coverage;
`--shard=1/1` preserves CI's partial-map threshold deferral. The unchanged
whole-suite thresholds apply at the final CLI merge. Run 2 repeats the entire
test corpus without collecting coverage again, to honor the 90-minute time box.
No source, threshold, test skip, retry or deadline changes between runs. Existing opt-in
live suites remain disabled as in CI.

An initial collection was stopped after detecting that Vitest's file-only
listing returns all files for every shard; it is not counted as a full run.
The runner now uses Vitest's actual sequencer and records the complete file
partition and per-batch/per-file results under `temp/cifix14/`.

## First complete run and static gates

Source commit: `66e4e2f4`. All **501 files**, every member of all four shards,
completed successfully: **10,867 passed tests, 82 existing skipped/disabled
cases, zero failures**. Per-file results are in `cifix14-macos-files.csv`;
the second-run columns will be added after the repeat finishes. Existing
opt-in live suites stayed disabled; model attempts: zero.

The final `vitest run --merge-reports=<four-shard-reports> --coverage` exits 0:

| Metric     | Result                   | Unchanged threshold |
| ---------- | ------------------------ | ------------------- |
| Statements | 93.59% (44,535 / 47,584) | 90%                 |
| Branches   | 89.16% (30,164 / 33,830) | 85%                 |
| Functions  | 95.21% (8,996 / 9,448)   | 90%                 |
| Lines      | 93.85% (43,246 / 46,079) | 90%                 |

Vitest prohibits emitting a blob reporter while merging reports. The first
aggregation command exposed that restriction and failed; it is not green
proof. The corrected scratch aggregator folds each shard sequentially with
`istanbul-lib-coverage.createCoverageMap().merge`, the same operation Vitest's
`BaseCoverageProvider.mergeReports` uses, retaining every test/error and all
serialized module-graph entries with remapped indices. Original batch blobs
remain untouched. The resulting four valid blobs go through Vitest's actual
CLI replay and unchanged coverage gate. The successful aggregation took
342.659 seconds; no counter or source file was omitted.

The coordinator's first file-only shard listing and progress storage were
corrected before counting a full run. Completed batch reports were retained
when the coordinator resumed; duplicate coverage maps were removed only from
progress/JSON summaries, never the original blob evidence.

Static gates passed: all five typecheck projects, scoped ESLint/Prettier,
plain `knip`, `jscpd`, localization, host-API inventory and the production build
(including size, split, host-global and notices gates).

| Selected production artifact              | Size      | Existing cap |
| ----------------------------------------- | --------- | ------------ |
| Activation                                | 436.7 KiB | 600 KiB      |
| Model API                                 | 446.5 KiB | 475 KiB      |
| Shared English                            | 48.0 KiB  | 125 KiB      |
| Checkpoint store                          | 76.9 KiB  | 225 KiB      |
| Browser startup, including static imports | 893.2 KiB | 900 KiB      |

The four generated production English files match the pre-refactor outputs
**byte for byte**, including SHA-256: core `a59b9982c019549dd09b05f62836033b2cd5e227c0d0af305230ae80fd20e506`,
runtime `7f0bd93cbe74db1362d889df9a78d0ca650db9ebade3e4393c27d9f2ee9dafca`,
hooks `ffca4813c8958d878805ed33b0d062dc1126bb73f86c944ad1853d1ecab662c7`,
surfaces `bb5e221aa512b7fb886ba5cc914ee56f6922ee4dd4d3b1e1bc78380d29d973ab`.
Exact receipts remain under `temp/cifix14/` in this worktree.
