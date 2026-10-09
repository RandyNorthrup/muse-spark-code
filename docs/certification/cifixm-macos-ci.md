# CIFIXM — macOS CI repair, 2026-10-09

Scope: hosted run `37897298018`, base `bd2d617c8`, branch `rel017/cifixm`,
macbook rig. No paid/live calls, merges, pushes, gate reductions or raised
Vitest timeouts. Each test batch contains at most three files.

## Reporting process-probe fixtures

`checkRuns.test.ts` (all nine cases), `reportEngine.test.ts` (one of four)
and `reportNetworkBinding.test.ts` (one of two) fail before the repair:
`ReportStorage` cannot obtain its writer PID's birth identity because the
fixtures never install resource admission. Linux reads `/proc` directly;
macOS and Windows invoke a bounded OS probe. Product admission is unchanged.

The existing reporting runtime fixture now provides a launcher factory that
executes real, bounded OS probes directly and delegates other profiles to the
original governed launcher. Each owning file registers it before loading
storage. Disk persistence, confinement, malformed evidence, scrubbing,
serialization, cancellation and history assertions remain unchanged.

A first exploratory `beforeAll` spy did not work: history captures the
launcher at module load. A hoisted fixture mock corrects that boundary.
Final default-timeout run: **3 files, 15 tests passed**.

Red drill: route `contained` instead of `probe` to the fixture runner. All
three files fail again (11 failures). Restore the helper byte-for-byte and
compare SHA-256, then rerun the three files with repository deadlines.
Restored helper hash: `3a0c0e4a92279a17263a52fafb53897ff3fa7494397be1beb50c6d00d872c466`;
rerun: **15/15 passed**. Changed-file ESLint passed.

## Native helper diagnosis

The brief's `113717543639` job is the aggregate **dictation helper (macos)**,
which fails in `require every selected-tier job`; it is not compilation.
Readable GitHub job metadata confirms actual compiler job `113711458248`
passed build, disclaim, permission-free recorder/resource checks and vault
verification. Local `bash native/darwin/build.sh` also passes: universal
Intel/ARM64 dictation/screen helper and vault, signatures and fourteen
localized permission resources. Native source needs no compiler repair.

Both job-log and run-log downloads return HTTP 403, “Must have admin rights
to Repository.” Readable job/annotation metadata contains no detailed static
gate error. Further scoped static checks and browser verification follow.

## Planning and next slice

`PLAN.md` §7 records this repair scope; 0.17.0 remains preparation, unpublished.
M114 retains its existing planned status and integrated-pixel certification
requirements. No feature, setting, command or release label changes.
Next lane slice: explicit schedule-platform coverage, repeated M114 browser
reproductions, then scoped static/build verification. The lead owns integrated
quality, Linux build/deferred-bundle/cycle fixes and CIFIXV's pixel baselines.
