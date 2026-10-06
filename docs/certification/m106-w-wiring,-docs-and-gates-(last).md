# M106 W — wiring, docs and gates (macmini, 2026-10-06)

The [integration record](m106.md) names merges, bindings and open evidence.
The inherited `node_modules` was immutable and still had SDK 1.3.0, with missing
main raster dependencies. An ignored isolated source snapshot at
`temp/m106-w/install` received `npm ci` from the exact merged lock: SDK 1.4.2,
902 packages, 11 existing advisories (2 low, 9 high). No dependency was added.
Tests without dependency-sensitive builds ran directly in the worktree; exact-lock
build/type checks and production-bundle suites used that private snapshot.
It has no hook override, dependency alias or preload shim. All final vitest runs
use the repository timeout and `--maxWorkers=3`, at most three files per run.

## Scoped evidence

Initial restored groups: wiring/client/notify **76 passed**;
exec run/arguments/schema **163 passed**; real build/reference/size/split
**75 passed**. History and controller behavior passed in the UI group; six App
assertions exposed newly asynchronous loading and now await the actual control.
The first compression round-trip failed because the generated text-key enum had
been omitted; retaining that enum fixed the real Node artifact.

Final verification and deliberate guard-fire receipts are appended below as
completed. Aggregate `npm run quality` / full tests are expressly delegated;
no whole-milestone green claim is made here.
