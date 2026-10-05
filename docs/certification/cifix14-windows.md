# CIFIX14W — Windows hosted-CI repair for 0.14.0

Worktree `C:/lanes/CIFIX14W`, branch `fix/ci-0.14.0-windows`, base
`fc8adc4c`. All commands run on the Windows 11 rig. No external downloads, live or paid
model calls, pushes, merges, dependency changes, retries, skipped cases,
timeout increases or gate changes are part of these repairs.

## Reproductions and repairs

| Failure                                                                 | Root cause                                                                                                                                                                                     | Repair                                                                                                                                                                                                                                      |
| ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `clineDiscover.test.ts`: three Unix discovery cases                     | Injecting `platform: 'linux'` changes accepted filenames, while discovery still joins its fake filesystem paths through the host's `node:path`. POSIX fixture keys cannot match Windows joins. | Test-only: spy on `path.join` with the real POSIX implementation for Unix fixtures and the real Windows implementation for the Windows case. Assert the Windows script path as well as its event; restore the spy after every case.         |
| `hookFormats.test.ts`: R3-10                                            | The generic entry inherits Windows while the comparison entry explicitly uses Linux for a POSIX capture.                                                                                       | Test-only: pass the capture's Linux platform to the generic entry too. Existing explicit Windows cases remain.                                                                                                                              |
| `hookFormatsGemini.test.ts`: verbatim filter-tools whitelist            | The saved POSIX capture is passed through the Windows adapter and is correctly refused as an ambiguous Windows path.                                                                           | Test-only: give that capture its explicit Linux platform, then still run and check the verbatim Node source script.                                                                                                                         |
| `deferredBundles.test.ts`: English fallback and activation loading      | The fixture builds in memory but requires a production fallback and shared wire module from an existing `dist`. Both reported macOS failures reproduce on this Windows rig.                    | Test-only: build the actual production fallback before checking every English value; route activation's shared wire and its parser/text dependencies through the existing in-memory support loader. Keep the lazy action-bundle assertions. |
| `modelApiShellDirectory.test.ts`: real directory tracking               | Not reproduced: all 29 cases, including the real PowerShell round trip, pass before any repair.                                                                                                | Kept unchanged; the complete scan also passes it.                                                                                                                                                                                           |
| `importHookSources.test.ts`: R2-3                                       | A POSIX command is sent to an absent `bash` on Windows; the child never starts.                                                                                                                | Test-only: run the native generated PowerShell command on Windows and `/bin/sh` on Unix. Assert child entry, the complete literal path, and no metacharacter evaluation.                                                                    |
| `execStdio.e2e.test.ts` and `releaseMajorTag.test.mjs`: shell discovery | The rig's Git distribution ships GNU Bash as `usr/bin/sh.exe`, without a `bash.exe` alias.                                                                                                     | Test-only: accept the adjacent executable only after its successful `--version` identifies GNU Bash. Run the existing fake headless and release-workflow fixtures through it.                                                               |
| `webviewBundle.test.mjs`: missing static chunk                          | The filesystem error contains an absolute Windows path, while the assertion requires an exact relative POSIX path.                                                                             | Test-only: normalize separators and still require exit 1, `ENOENT`, the stat operation and the missing chunk's path.                                                                                                                        |
| `pluginDispatch.test.ts`: four fake-child cases                         | POSIX paths are not in the Windows normal form required by the parser.                                                                                                                         | Test-only: use a drive-qualified Windows root and native `path.join`; retain the native platform, concurrency cap, grant stripping and containment assertions.                                                                              |

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
downloads are absent, and the shared rules prohibit downloading them. The
additional offline integration check uses the installed editor, preserving
the actual integration files and Mocha options; it does not certify the
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

## Complete collection and subsequent repairs

The completed four-shard collection dispatches all **501 unique files** in
168 bounded batches. Its unchanged CLI blob merge exits **1**: **10,789
passes, 6 assertion failures, 118 existing skipped/opt-in cases**, plus the
headless suite's collection failure. The four failing files are
`importHookSources.test.ts`, `execStdio.e2e.test.ts`,
`webviewBundle.test.mjs`, and `pluginDispatch.test.ts`. No unhandled errors
are recorded. The private directory is named `green-1`; this run is red.

Real V8 coverage clears every original threshold: statements **93.55%**
(44,519/47,584), branches **89.05%** (30,127/33,830), functions **95.23%**
(8,998/9,448), and lines **93.82%** (43,234/46,079). Passing coverage does
not certify a passing test suite. The committed CSV records all 501 files,
including existing pending cases from the merged JSON reporter.

The subsequent native-shell, missing-chunk and release-workflow batch passes
**91/91**; the repaired headless file passes **33/33**. The first plugin
fixture adjustment uses a drive-qualified root but still appends POSIX
separators, so all four cases remain refused. Native `path.join` supplies
the required normalized form; its complete file then passes **17 tests /
13 existing platform skips**. No product change is necessary.

The additional complete-file drills all exit **1** and restore byte-exact
contents with matching SHA-256:

| Drill                                                               | Restored file                         | SHA-256                                                            |
| ------------------------------------------------------------------- | ------------------------------------- | ------------------------------------------------------------------ |
| Execute a substitution marker instead of the literal quoted command | `test/unit/importHookSources.test.ts` | `d547d8a7aa415cbbe97f9581a67f587cf7501de2fd931ede64195462d04272d3` |
| Remove the verified GNU Bash fallback                               | `test/unit/releaseMajorTag.test.mjs`  | `1c2678575fb79a688dd63fe9a2ce94915e5f39921ae893cf16926e5220a0abba` |
| Remove the verified GNU Bash fallback                               | `test/e2e/execStdio.e2e.test.ts`      | `3d7755d9ee221a8e50fb4ede3c959fff976ea8a5105e6c8ac1360eace85915de` |
| Join a fake plugin path with POSIX separators on Windows            | `test/unit/pluginDispatch.test.ts`    | `ffd4d92910933956db5bebeb856d32249ed56e94810c7098f946b655e0ad4949` |

After restoration, the complete import/release/plugin batch passes **98
tests / 13 existing platform skips**, and the complete headless/browser batch
passes **43 tests / 3 existing opt-in skips**. The 90-minute time box does not permit
two further complete 501-file scans after the newly discovered failures.
**Two consecutive green full runs remain unverified**; focused passing
files and passing coverage do not replace that requirement.

The final serial `run-s typecheck deadcode duplication check:l10n
check:host-api build:dev` exits **0**. All five TypeScript projects pass;
Knip passes, duplication finds **0 clones**, localization reports **0
problems**, and the host-API inventory reports **0 problems**. ESLint with
`--max-warnings=0` passes all nine changed test files, and Prettier checks
pass all changed code/Markdown. ESLint first rejects the new Bash probe's
condition order; the equivalent simple guard is moved first, with no rule
or ignore change. The earlier production build's size/split/globals/notices
gates also pass; production source is unchanged.

Offline integration against installed VS Code **1.139.1** exits **0**:
**36 tests pass in 16 seconds**. It runs all six built integration files
with the repository's Mocha options, a private worktree profile/extensions
directory and private home directories; dependency downloads, updates and
telemetry are disabled. Model API activity uses the suite's local fake
transport, and Git pushes stay inside the suite's local fixture repositories.
The worktree branch is never pushed. Before tests start, the private launcher
is corrected to use the package's declared `out/bin.mjs` entry and a glob
relative to its config directory (absolute glob strings are literal files
to this CLI). Those startup failures are not integration assertion failures.

Local repair commits, all with lint-staged and gitleaks hooks enabled:

| Commit                                     | Repair                                |
| ------------------------------------------ | ------------------------------------- |
| `d8f24ceaae2a1d716e36bbc08e60fd3f6d1973b9` | Cline path fixture platforms          |
| `2dfce17cf7ad605f20d60b5d1520bda859e33cab` | Generic and Gemini captured platforms |
| `f7467400a1a41addbbe52d34f922178b8f0cd94f` | Deferred-bundle fixture independence  |
| `38fb0ad9e03cf29a664405e726c5efa877d501fc` | Native imported-hook quoting          |
| `03a8650f3300786069e656a6283ec8df38093a70` | Verified GNU Bash discovery           |
| `e76511937bb576a1a606fd93093720a01a5c2c1e` | Native missing-chunk error paths      |
| `a5a9965ef53160c348fdbbf5ca938d2d79fc1007` | Normalized plugin fixtures            |

The local hook launcher invokes installed Node/npm directly because this
rig's npm POSIX wrapper names absent `bash`. It is private scratch under
`temp/cifix14/bin`; no hook, Git configuration, installed executable or
machine setting changes. Hooks report no leaks. No dependencies or product
source files change, and no test, timeout, coverage threshold or gate is
removed or weakened.

The final formatted-source complete-file run passes **114 tests / 3
existing opt-in skips** across headless, native quoting and release-workflow
files. Together with the unchanged restored plugin/browser receipts, all
five files repaired after the full scan pass **141 tests / 16 existing
platform or opt-in skips**. The CSV's focused columns use these latest
whole-file results. These are focused results, not a second full-suite run.
