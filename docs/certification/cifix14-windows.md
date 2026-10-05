# CIFIX14W — Windows hosted-CI repair for 0.14.0

Worktree `C:/lanes/CIFIX14W`, branch `fix/ci-0.14.0-windows`, base
`fc8adc4c`. All commands run on the Windows 11 rig. No network, live or paid
model calls, pushes, merges, dependency changes, retries, skipped cases,
timeout increases or gate changes are part of these repairs.

## Reproductions and repairs

| Failure                                                            | Root cause                                                                                                                                                                                     | Repair                                                                                                                                                                                                                                      |
| ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `clineDiscover.test.ts`: three Unix discovery cases                | Injecting `platform: 'linux'` changes accepted filenames, while discovery still joins its fake filesystem paths through the host's `node:path`. POSIX fixture keys cannot match Windows joins. | Test-only: spy on `path.join` with the real POSIX implementation for Unix fixtures and the real Windows implementation for the Windows case. Assert the Windows script path as well as its event; restore the spy after every case.         |
| `hookFormats.test.ts`: R3-10                                       | The generic entry inherits Windows while the comparison entry explicitly uses Linux for a POSIX capture.                                                                                       | Test-only: pass the capture's Linux platform to the generic entry too. Existing explicit Windows cases remain.                                                                                                                              |
| `hookFormatsGemini.test.ts`: verbatim filter-tools whitelist       | The saved POSIX capture is passed through the Windows adapter and is correctly refused as an ambiguous Windows path.                                                                           | Test-only: give that capture its explicit Linux platform, then still run and check the verbatim Node source script.                                                                                                                         |
| `deferredBundles.test.ts`: English fallback and activation loading | The fixture builds in memory but requires a production fallback and shared wire module from an existing `dist`. Both reported macOS failures reproduce on this Windows rig.                    | Test-only: build the actual production fallback before checking every English value; route activation's shared wire and its parser/text dependencies through the existing in-memory support loader. Keep the lazy action-bundle assertions. |
| `modelApiShellDirectory.test.ts`: real directory tracking          | Not reproduced: all 29 cases, including the real PowerShell round trip, pass before any repair.                                                                                                | Keep the real-shell test unchanged and include it in both complete runs.                                                                                                                                                                    |

The initial three-file hook run reports **5 failures / 112 passes**. The
initial bundle/shell/ACP run reports **2 failures / 62 passes**, with both
bundle failures above and the real-shell case passing. The repaired hook
files pass **117/117**. The initial repaired bundle/shell run passes **55/55**;
the subsequent complete run also exercises the final production-fallback
fixture.

## Complete-suite method

The workflow's full tier runs V8 coverage with four shards and default/blob
reporters. The rig note takes precedence and requires at most three files per
dispatch, `--maxWorkers=3 --testTimeout=120000`, with serial heavy commands.
Windows retains the repository's `fileParallelism: false`, isolation, every
test and existing per-case timeout. No repository configuration is changed.

The private runner uses Vitest 5.0.2's own `BaseSequencer.shard` to obtain the
four CI memberships, then dispatches each shard in three-file batches through
the same Vitest engine. It retains real V8 coverage from every isolated file
and performs the complete coverage remap/report at the end. The unchanged CLI
coverage merge applies the repository thresholds. Each dispatch writes file
counts and failures to the private per-file receipts in
`temp/cifix14/<run>/results.json`. The runner validates complete, unique file
membership. Scratch runner and reports are not shipped.

This rig has Node **24.21.0**, npm **11.19.0**, and installed VS Code
**1.139.1**. Hosted CI selects Node 22. The exact CI stable/minimum VS Code
downloads are absent, and the shared rules prohibit downloading them. Run an
additional offline integration check against the installed editor, preserving
the actual integration files and Mocha options; do not claim it certifies the
missing CI versions.

## Final receipts

All five TypeScript projects pass. Changed-file ESLint passes after replacing
the three-way shared-bundle comparison with `includes`. The repaired complete
files pass after the drills: bundle/Cline/generic-hook batch **97/97** and
Gemini **46/46**. Final complete-suite and integration receipts follow in the
completion record.

Scoped gates pass: the final unit TypeScript project, plain Knip, jscpd,
localization, host-API inventory, and production build including size, split,
host-global and notices checks. Production sizes: activation **436.7 KiB**,
Model API **446.5 KiB**, checkpoint store **76.9 KiB**; all existing caps pass.

The first full scan reaches 63 files before an additional failure in
`checkpointRestore.test.ts`: its already-reverted-file case aborts `git mktree`
at the product's unchanged five-second lease deadline. Its complete isolated
file then passes **12 tests / 1 existing platform skip**, in 87.79 seconds.
No test or product deadline is increased and no fix is guessed. The failed
scan is not certified green. Vitest's cleanup on a failed run also removes
the private runner's accumulated coverage directory; subsequent collection
enables reporting on failures to retain those receipts, without changing
the repository's gates.

Each deliberate mutation runs the complete owning file, exits 1, and restores
the original file bytes. Restored SHA-256 values:

| Drill                                                  | Restored file                         | SHA-256                                                            |
| ------------------------------------------------------ | ------------------------------------- | ------------------------------------------------------------------ |
| Join Unix fixtures with Windows paths                  | `test/unit/clineDiscover.test.ts`     | `a232e623449c36672321e73db8ff84cc2aebb25d567e3ce63c896cb24924133e` |
| Remove generic entry's captured platform               | `test/unit/hookFormats.test.ts`       | `2d4a8ede134db5acba4a853b81706d7f61294e6c9cc4d42bcc18e8095330a184` |
| Remove Gemini capture's platform                       | `test/unit/hookFormatsGemini.test.ts` | `fa30a0874e4ccb2dd23a71562c22da3d6f58124d74a9c4bb1eda218802473992` |
| Make activation eagerly record its conversation bundle | `test/unit/deferredBundles.test.ts`   | `77a194f94dc12df3df299060137ecdabebc2bb50c10e300b1ca5a52a726ed3b3` |
