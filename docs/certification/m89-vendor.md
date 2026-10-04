# M89 vendor lane

This record covers D68/M89 acceptance 4 (the pinned workflow assets,
checksum guard and VSIX inventory) and the local size check in acceptance 7.
Backend discovery, settings and Muse Code installation remain with the
other M89 lanes. No live or paid model calls are part of this lane.

## Readiness review

The M89V brief and common lane rules were reviewed against `AGENTS.md`,
PLAN.md D68/M89, the packaging allow-list, third-party notices generator,
existing unit-test configuration and quality exclusions. The starting
worktree was clean at `ed682035` on `m89/v`. The local `origin/main`
(`11d06066`) was already an ancestor; merging it reported "Already up to
date". The older `integrate/m72-on-24ff` branch was absent locally.

There was no reusable tar extraction helper. The release archive uses ustar
entries and one global PAX comment containing Git's source commit. The sync
script accepts that comment and rejects unsupported entry types and PAX
path/size overrides. All entries pass the path/link guard before selection;
the archive is fully checked before the vendor directory is replaced.

The new script uses only Node built-ins. Its declaration file gives the
TypeScript unit test a checked import contract. `package.json` changes only
the pre-commit file globs so vendor files never reach mutating lint/format
commands; contributes and dependency pins are unchanged. There are no
cspell or Markdown lint gates in this repository, so no new unused
configuration was introduced. Existing ESLint, Prettier, Stylelint, jscpd,
knip and Semgrep exclusions now name vendor content only.

The existing plan and lane brief remain the canonical acceptance contract.
The feature-delivery ledger validator was not used: migrating the
project-wide plan to that skill's JSON ledger would exceed this lane's
scope and the wiring lane's ownership.

## Pinned release and independent audit

Command run successfully on Windows with Node 24.20.0:

```console
node scripts/sync-bundled-skills.mjs --tag v0.7.0
```

- Source: <https://github.com/RandyNorthrup/high-quality-projects-skill>
- Archive SHA-256:
  `04699ee40c94257ebc29f25df2222966d074abe3e8be9767ce932dfc8d7e0604`
- Upstream files: 46; 354,614 bytes.
- With `VENDOR.json`: 47 files; 356,388 bytes.
- An independent Python `tarfile` read selected the brief's allow-list
  directly from the downloaded archive and compared every file's bytes
  with the vendor tree. All 46 matched; the manifest's list matched too.
- `.gitattributes` disables text normalization under `vendor/**` and
  recognizes the upstream PowerShell files' CRLF line endings in Git's
  whitespace check. The initial staged whitespace audit flagged those
  carriage returns; no upstream bytes were changed to address it.
- The five upstream executable helpers retain their executable Git modes.

The committed `VENDOR.json` is the sorted inventory. The package includes
the three complete workflow entries, shared scripts, templates, root
README/rules/licence and top-level Markdown documentation. It excludes
upstream tests, CI/editor configuration, requirements files, release build
script, documentation images and evaluation artifacts.

## Guard sensitivity

All drills ran on this Windows host against the complete
`test/unit/bundledSkillsVendor.test.ts` file using Vitest 5.0.1. The
unmodified baseline discovered and passed all 22 tests (exit 0).

| Mutation                                                             | Expected and observed failure                                                                                                 | Mutated exit | Restored result   |
| -------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ------------ | ----------------- |
| Replace checksum rejection condition with an always-false comparison | `refuses a mismatching archive checksum`: `AssertionError: expected [Function] to throw an error`; four checksum tests failed | 1            | 22 passed, exit 0 |
| Replace the exported path/link guard with an empty body              | `refuses unsafe path ../x` and link assertions: `AssertionError: expected [Function] to throw an error`; eleven tests failed  | 1            | 22 passed, exit 0 |

The harness restored the original script bytes in `finally` after each
mutation and independently compared the before/after SHA-256:
`d748b1dd81d9479831dd53d8429b446d582f1bde72aa263aad567e07b9d9a069`.
No test was filtered, skipped or weakened. Local outputs are in the ignored
`temp/vendor-*-red.log` and `temp/vendor-*-restored.log` files.

## Environment correction

The first production build passed every bundle size cap, then failed the
bundle split check with five missing-package diagnostics. Its emitted
metafiles showed the dependencies under `../mx-cli-live/node_modules/`:
this worktree's `node_modules` was a junction to a shared install. The gate
correctly requires paths beginning with `node_modules/`.

Only that junction was unlinked (no recursive delete); the shared target
was untouched. A local `npm ci` restores canonical metafile paths without
changing any build code, gate, threshold or dependency pin. The final
build and notices are regenerated from the local install.

`npm ci` exited 0 with the lockfile unchanged; its advisory summary was
2 low and 9 high. This is not a `security:audit` gate result. Full security
and aggregate quality verification remain with the lead under common.md.

The corrected `npm run build` exited 0. The extension was 573.1 KiB
(600 KiB cap), Model API 370.5 KiB (400), plan reader 139.0 KiB (150),
checkpoint store 137.3 KiB (225), importer 117.4 KiB (125), English text
84.7 KiB (100), search worker 15.2 KiB (50), page worker 203.2 KiB (300),
webview JavaScript 804.7 KiB (900) and ACP 738.1 KiB (850). Split,
host-global and third-party-notice checks all passed; the notice file
contains 83 packages including the vendor's full MIT licence and Randy
Northrup's copyright.

`npx vsce ls --no-dependencies` exited 0. Its vendor paths were compared
as a complete set with the manifest plus `VENDOR.json`: exactly 47 files,
including the hidden template files, with no extra or missing vendor path.

## Package and index proof

`npx vsce package --no-dependencies -o temp/m89-vendor.vsix` exited 0,
including its normal prepublish production build. The unchanged
`scripts/check-vsix-size.mjs` accepted **1,778,848 bytes** against
**1,894,400 bytes (1,850 KiB)**: 115,552 bytes of headroom.

An independent Python `zipfile` read of the actual VSIX checked exactly
47 vendor entries against the manifest plus `VENDOR.json`, then compared
every entry's bytes with the worktree. All matched; the packaged notices
include the full vendored MIT licence. This Windows-built package does
not include the macOS native helper; the universal package remains a lead
verification obligation.

After explicit staging, an independent `git cat-file blob :<path>` audit
compared all 46 upstream files with the release archive. Every blob was
byte-exact; the staged manifest matched the worktree too, and the Git index
contained exactly those 47 vendor files. The five executable upstream
helpers were independently checked as mode `100755`.

## Local gates

All checks below ran on this Windows host. Heavy jobs ran serially; the
full quality suite and full test suite were deliberately left to the lead
as required by common.md.

| Check                                                                                                     | Result                                                                                                                       |
| --------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `npx tsc -p test/unit --noEmit`                                                                           | Exit 0                                                                                                                       |
| `npm run typecheck` (host, webview, unit, e2e, integration)                                               | Exit 0                                                                                                                       |
| ESLint `--max-warnings=0` on the new script/declaration/test and changed JavaScript configuration/scripts | Exit 0; no suppressions                                                                                                      |
| Prettier `--check` on changed owned code/configuration/documentation                                      | Exit 0                                                                                                                       |
| `npx vitest run test/unit/bundledSkillsVendor.test.ts`                                                    | 22 passed; both red drills restored to 22 passed                                                                             |
| `npm run notices`                                                                                         | Exit 0; 83 packages                                                                                                          |
| `npm run build` and the package's prepublish build                                                        | Exit 0; all size/split/global/notices gates passed                                                                           |
| `npx vsce ls --no-dependencies`                                                                           | Exit 0; exactly 47 vendor entries                                                                                            |
| VSIX package and size gate                                                                                | Exit 0; 1,778,848 / 1,894,400 bytes                                                                                          |
| `npm run duplication`                                                                                     | Exit 0; 694 files analyzed, zero clones                                                                                      |
| `npx knip` (`npm run deadcode`)                                                                           | Exit 0; one configuration hint for the explicitly required vendor ignore, since current project roots already exclude vendor |
| `npm run check:l10n`                                                                                      | Exit 0; 14 tables, 107 manifest strings, 355 source files, zero problems                                                     |
| `npm run check:host-api`                                                                                  | Exit 0; 271 VS Code APIs, 18 importing files, 23 Node built-ins, 58 theme variables, zero problems                           |

The pre-commit glob scope was also checked with the installed micromatch:
root files, source/test files, CSS and hidden repository workflow files
remain included; ordinary and hidden vendor files remain excluded. No
repository gate threshold, rule level, timeout or coverage setting changed.

The vendor lane has no remaining implementation blocker. The lead's next
step is to integrate this commit with the source/install/wiring lanes,
complete the M89 user-facing documentation and milestone record, and run
the full quality and universal VSIX gates. No push, release, live model
call or paid operation was performed by this lane.

## 2026-10-03 — M89VT vendor review follow-up

### Readiness and implementation

The M89VT brief, common lane rules and `rv-m89v.report.md` were read against
the clean `feature/m89-bundled-skills` tree at
`94467c6b17f3174e73178c987e0e3fb8f312da25`. The named integration branch is
absent locally; `git merge --no-edit origin/main` reported "Already up to
date" (`origin/main` was `bbe43eaa`). This bounded follow-up extends the
existing D68/M89 plan, sync script and tests without adding dependencies or
a second tracker. The feature-delivery JSON ledger migration remains outside
this brief, as in the original vendor readiness review.

- P2-1: export the existing predicate as `isSelected` and the `archiveFiles` implementation and
  their checked declarations. Minimal gzip/ustar fixtures exercise actual
  extraction, byte/mode preservation, directory handling, selection,
  required-file checks, rejected PAX/GNU/link entry types, traversal,
  duplicate names and the top-folder guard. The copy predicate has a
  separate inclusion/exclusion table.
- P3-2: compare every regular entry's name before selection, lowercasing and
  trimming trailing dots/spaces in each path segment. Fixtures cover both
  archive orders, root filenames and parent-directory aliases.
- P3-1: `VENDOR.json.files` now contains sorted `{ path, sha256 }` records;
  every one of the 46 file digests is checked by a test. The brief's explicit
  v0.7.0 re-sync succeeded on Windows with Node 24.20.0 and npm 11.19.0,
  retaining archive digest
  `04699ee40c94257ebc29f25df2222966d074abe3e8be9767ce932dfc8d7e0604`.
  `git diff --stat vendor/` showed exactly one changed file: `VENDOR.json`.
- The installer was an affected manifest consumer: its string-array schema
  rejected the new records. Updated realistic fixtures first reproduced
  17 failing tests (14 passed, exit 1), including the actual built bundle,
  with `is not a vendor record` / `Invalid input` diagnostics. Reading each
  record's validated `path` restored all 31 installer tests (exit 0).
  Digests remain enforced by the vendor suite; install permissions and
  filesystem behavior are unchanged.

The vendor suite grew from 22 to 110 tests: 46 per-file digests, 22 copy
allow-list cases and 20 archive-reader cases. Both scoped test files ran
on this Windows host. Installer regression logs are
`temp/m89vt-installer-before.log` and `temp/m89vt-installer-after.log`.

### Five guard-family drills

Each drill ran the entire vendor test file through the installed Vitest
CLI (`node node_modules/vitest/vitest.mjs run
test/unit/bundledSkillsVendor.test.ts`), using the normal configuration.
The baseline passed 110 tests (exit 0). The ignored harness
`temp/m89vt-drills.mjs` applies one uniquely matched mutation, captures the
actual failing output, restores the original bytes in `finally`, compares
SHA-256 and reruns the same command. No test was skipped or filtered.

| Family              | Deliberate break                           | Observed assertion                                                                                              | Red result       | Restored result    |
| ------------------- | ------------------------------------------ | --------------------------------------------------------------------------------------------------------------- | ---------------- | ------------------ |
| Copy allow-list     | Accept `tests/` in `selected`              | `selects tests/guard.test.ts: false`; extracted inventory also includes the excluded test                       | 2 failed, exit 1 | 110 passed, exit 0 |
| Required files      | Remove the missing-file rejection          | `refuses a release missing LICENSE` and each of the three `SKILL.md` cases no longer throw                      | 4 failed, exit 1 | 110 passed, exit 0 |
| Entry types         | Remove unsupported-type rejection          | PAX `x`, GNU `K` and GNU `L` assertions no longer throw                                                         | 3 failed, exit 1 | 110 passed, exit 0 |
| Filename collisions | Remove normalized-name duplicate rejection | `refuses filesystem alias license in either archive order`; exact duplicate and all alias cases no longer throw | 8 failed, exit 1 | 110 passed, exit 0 |
| File byte pins      | Flip one byte in the vendored `README.md`  | `pins the SHA-256 of README.md` reports a digest mismatch                                                       | 1 failed, exit 1 | 110 passed, exit 0 |

All mutated failures were `AssertionError` diagnostics, not startup,
syntax, timeout or unrelated errors. Exact before/after restoration hashes:

- Sync script (all four code drills):
  `e9f1e7ceee4857748922550ccca7e8aad1270d22f573d572c7cfe066cda16b8f`.
- Vendored README:
  `ab43e68d7407b9bd3a4bed5abaa7b0edc2dae97fe99187d874a8927b62eda40f`.

Per-mutation hashes, exits and assertion names are in
`temp/m89vt-drills.json`; complete output is in
`temp/m89vt-<family>-red.log` and `temp/m89vt-<family>-restored.log`.
The final vendor diff again contained only `VENDOR.json`.

ESLint's first run rejected the declaration's boolean function name and
the fixture's spread of `Map.keys()`. The existing internal predicate keeps
its name; its exported alias is `isSelected`. All five drills above were
refreshed after that correction. `Iterator.toArray()` then exposed that the
unit project's library profile does not declare that method; the fixture
now projects paths from the Map's entries using supported array operations.
No suppression or gate configuration change was needed.

### Final local checks and build deferral

All checks ran on this Windows host, with the final common checks serialized.

| Check                                                                                         | Observed result                                                                                                                        |
| --------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `npx tsc -p test/unit --noEmit`                                                               | Exit 0; the final `npm run typecheck` also passed host, webview, unit, e2e and integration projects after the last fixture correction. |
| ESLint `--max-warnings=0` on both scripts, the installer and both tests                       | Exit 0, zero warnings; no suppressions.                                                                                                |
| `npm run deadcode`                                                                            | Exit 0; the existing vendor-ignore configuration hint remains.                                                                         |
| `npx jscpd`                                                                                   | Exit 0; 755 files, zero clones.                                                                                                        |
| `npm run check:l10n`                                                                          | Exit 0; 14 tables, 119 manifest strings, 387 source files, zero problems.                                                              |
| `npm run check:host-api`                                                                      | Exit 0; 271 APIs, 18 importing files, 23 built-ins, 59 theme variables, zero problems.                                                 |
| `npx vitest run test/unit/bundledSkillsVendor.test.ts test/unit/bundledSkillsInstall.test.ts` | Exit 0; 141 passed (110 vendor, 31 installer), two files.                                                                              |
| `git diff --stat vendor/`                                                                     | Only `vendor/high-quality-projects-skill/VENDOR.json` changed; workflow files remain byte-exact.                                       |
| `npm run build`                                                                               | Exit 1 at the split gate; all bundle size caps passed. Deferred in PLAN.md §7.                                                         |

Build sizes were extension 581.6/600 KiB, Model API 421.1/475,
bundled skills 22.6/50, checkpoint store 139.7/225, importer 119.6/125,
plan reader 139.0/150, English text 96.1/100, webview 831.7/900 and
ACP 753.5/850. The split failure repeats the original environment issue
above: this worktree's `node_modules` is a junction to the shared install,
so five worker/import dependency paths do not have the required prefix.
Automatic approval review rejected removing only the local junction with
`blocked by policy`. The command was not executed, the junction remains,
and neither the shared target nor the lockfile changed. Running `npm ci`
through that junction would risk the shared install, so it was not run.

Actual outputs are `temp/m89vt-gate-*.log`, `temp/m89vt-gates.json` and
`temp/m89vt-final-tests.log`. The lead must replace only this worktree's
dependency junction with a local locked install and rerun build; aggregate
quality and cross-platform certification remain open. No build gate,
budget or dependency pin was changed.

### Scope remaining with the lead

The final scoped Prettier `--check` passed on all changed code and documents
(exit 0); the generated vendor manifest retains the existing vendor formatting
exclusion. The final whitespace audit also passed.

The lane does not run the full quality or full test suite, push, publish,
make a model call or certify other platforms. P3-3's non-atomic sync
replacement remains outside M89VT: a write failure exits nonzero, and the
maintainer must rerun the sync to restore the package. No gate threshold,
ignore, rule level or timeout was changed.
