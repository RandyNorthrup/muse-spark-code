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
