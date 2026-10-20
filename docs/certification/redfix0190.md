# REDFIX0190 — narrow the legal scan's read guard (GRVFIXB3)

Finding (Grok review of the 0.19.0 join): REDFIX0190's commit 533d61ea
restored M97's read guard in `src/core/legal/scan.ts` with a catch that
swallows every error that is not a `LegalScanError` — broader than D119's
narrow-catch rule and broader than the native snapshot, which already
returns `undefined` for expected IO.

Cause: the restored shape kept M97's guarantee (a throwing read never
escapes as a crash) by mapping every non-cancellation throw to absent.
D119 requires a catch to test a named expected condition and rethrow
everything else.

Fix (`src/core/legal/scan.ts`, `src/core/legal/files.ts`): the guard now
rethrows `LegalScanError` (cancellation keeps its kind), rethrows anything
that is not a named unreadable-file error, and reads absent only for the
named errno codes in `isUnreadableFileError`, matched by `error.code`:
`ENOENT`, `EACCES`, `EPERM`, `EISDIR`, `ENOTDIR`, `ELOOP`,
`ENAMETOOLONG`, `EIO`, `EBUSY`. Process-wide exhaustion (`EMFILE`,
`ENFILE`) and caller bugs (`EBADF`, `EINVAL`) surface. The catch
classifies NARROW under `scripts/lib/catch-inventory.mjs` (probe:
`temp/catch-probe.mjs`, since removed).

Tests (`test/unit/legalScan.test.ts`, 3 new, real `scanLegal` runs over
in-memory snapshots whose `readFile` throws):

- named `ENOENT` throw reads absent with the m113 marker;
- `LegalScanError` throw keeps its kind (rejects);
- plain-`Error` throw surfaces (rejects) instead of reading absent.

Break proof (each shown red, then reverted): removing the
`isUnreadableFileError` rethrow fails the unexpected-error test; swallowing
all (dropping both guards) fails the cancellation test; removing the
try/catch fails the marker test.

Gates on the final tree: `test/unit/legalScan.test.ts` 25/25 green with the
repo default timeout; prettier clean; eslint zero warnings on touched files;
`npm run typecheck` shows only the tree's known unrelated errors;
`check:catches` NARROW confirmed for the site (the full gate stays red on
pre-existing baseline drift in unrelated areas, recorded by the lead).
No settings or user-visible text changed: `check:reference`/`check:l10n`
not applicable.
