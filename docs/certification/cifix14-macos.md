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
are recorded in the follow-up certification commit.
CI integration runs only on Linux/Windows, so it is not a macOS requirement.
The rig provides Node 24.21.0; hosted CI pins Node 22. Commands use the rig's
available runtime without downloads or machine changes.

The rig note limits Vitest to three files and three workers per process and
sets `--testTimeout=120000`. CI's four shard memberships are generated with
Vitest's own `BaseSequencer.shard` (the `list --filesOnly` command ignores the
shard selection). Every member is executed once per complete run, in batches
of at most three, with coverage and default/blob/JSON reporters. Each batch
uses `--shard=1/1` to preserve CI's partial-map threshold deferral; merging all
blob reports applies the unchanged whole-suite thresholds. Existing opt-in
live suites remain disabled as in CI.

An initial collection was stopped after detecting that Vitest's file-only
listing returns all files for every shard; it is not counted as a full run.
The runner now uses Vitest's actual sequencer and records the complete file
partition and per-batch/per-file results under `temp/cifix14/`.
