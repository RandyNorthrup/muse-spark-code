# REL0143F — Release PR #129 CI repairs (2026-10-06)

Kubuntu worktree `/home/randy/lanes/REL0143M`, branch `release/0.14.3`,
starting HEAD `4122e1155`. The rig brief requests every Vitest file in batches
of at most three with the repository default timeout. Shared rules prohibit
aggregate quality and public network; hosted cross-platform certification
remains lead-owned. No merge, push, rebase, dependency, gate relaxation,
credential read or paid/live call.

## Reported failures

| Failure                              | Reproduction and cause                                                                                                                                                                                                                                                                                                          | Fix                                                                                                                                                                                                                                                                                |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Flight recorder R2 package inventory | Fails on Kubuntu: `.vscodeignore` ships `questionNotes.js`, absent from the report's exact frame allowlist.                                                                                                                                                                                                                     | Register that real shipped bundle in `REPORT_PACKAGE_FRAME_PATHS`; the equality assertion against the package manifest stays unchanged.                                                                                                                                            |
| M25 crash recovery                   | Fails on Kubuntu: restored question controls are now lazy; the synchronous radio assertion sees the arrival card.                                                                                                                                                                                                               | Exercise the production `installSurfaceRetry`/`retrySurface` path and await the transcript's controls. The existing flush uses `store.hasRendered()` and preserves the session-only save when the restored state crashes its first render. Prove host reload happens after saving. |
| M112 question Dismiss                | Full file and isolated cold Dismiss both pass on Kubuntu before changes. The merged App already wires `QuestionSurface.onDismiss` through `onDismissQuestion` and the lazy action's session/attachment-generation guard. The test assumed that another import had settled that callback and read a deferred menu synchronously. | Await the observable session-scoped command and the deferred dock menu. Keep the waiting/open distinction, disabled duplicate action, exactly-one post and settled outcome assertions. No working App command code is replaced.                                                    |
| Cline R2-3 shell quoting             | Passes on Kubuntu before changes; the Windows-only branch synchronously starts a real cold PowerShell process without a bound. That startup is unrelated to the converter under test and caused the reported 5 s CI timeout.                                                                                                    | Replace the child process with exact POSIX/PowerShell quoting goldens for both platform-shaped hostile paths, run through the real converter and hook parser on Linux, macOS and Windows. Keep the source path and timeout checks. No test timeout change.                         |

Initial complete-file checks: 2 failures and 77 passes in the three DOM/report
files; importer 72 passes. Fixed focused checks: report/store/importer 138
passes; question/store/importer 92 passes, all at default timeouts.

## Deliberate failures and restoration

Each mutation ran its complete owning file with `npx vitest run <file>
--maxWorkers=3`, exited 1, and was restored in `finally` to the exact original
SHA-256 below. The files pass again after restoration.

| Deliberate break                                  | Observed control                             | Restored SHA-256                                                   |
| ------------------------------------------------- | -------------------------------------------- | ------------------------------------------------------------------ |
| `src/shared/constants.ts`: frame-inventory        | `test/unit/flightRecorder.test.ts` exit 1    | `f826713acdcc239ee40675462ff449b94778a0ec9adaa8e1d86928b03b5455a8` |
| `src/webview/state/store.ts`: crash-loop          | `test/unit/store.test.tsx` exit 1            | `f4b11e37ef07e87691a758bba1eed5eca0b4dfa91a29acdb63a0cd211bd9e8ef` |
| `src/webview/App.tsx`: dismiss-command            | `test/unit/questionApp.test.tsx` exit 1      | `4c781064942146e2db28d2c8f03492aedf7c62016dff4af95f0bf688ac691c1d` |
| `src/core/import/importConvert.ts`: shell-quoting | `test/unit/importHookSources.test.ts` exit 1 | `be17fede2599126c2cb65c9db379ed56aff7e2f1f6bf5e21adff1297aab4de81` |

The crash-loop mutation forces transcript retention on an unrendered state;
the dismissal mutation routes Dismiss as Cancel; the quoting mutation removes
PowerShell's doubled apostrophe; the inventory mutation removes the new row.
These prove the retained assertions reject each broken behavior.

## Full suite and gates

The complete file inventory, per-batch JSON and logs are retained locally under
`temp/full-suite-*`, `temp/full-*.json` and `temp/full-*.log`. The runner clears
only live opt-in flags and uses the existing named badge network skip. It never
sets `--testTimeout`. Existing opt-in live/platform skips are retained.

Initial static checks: all five typecheck projects pass; changed-file ESLint
passes with zero warnings; localization passes with 14 tables, 169 manifest
strings and 629 source files (zero problems). Restored report/question/importer
controls pass all 144 tests. The complete store file also passed in the final full run after restoration.

### Complete default-timeout run

All **532 distinct configured Vitest files** ran exactly once in **178 batches**,
three files per invocation at most, each with `--maxWorkers=3`. Every batch
exited 0. Total: **11,430 passed, 0 failed, 72 skipped, 0 todo** (11,502 tests).
Elapsed summed batch time: 873.84 seconds. No additional merge failure appeared.
All 29 live-model opt-in tests stayed off; the other 43 skips are existing
platform/environment conditions. No test was newly skipped, filtered out,
relaxed or given a larger timeout. Existing named process-operation timeouts
remain as defined by the repository.

| Reported regression in the full run                  | Result | Duration |
| ---------------------------------------------------- | ------ | -------- |
| Flight recorder R2 shipped package inventory         | Pass   | 0.7 ms   |
| M25 transcript, turn and question after crash/reload | Pass   | 765 ms   |
| M112 session-scoped Dismiss exactly once             | Pass   | 558 ms   |
| Cline R2-3 literal path quoting on all platforms     | Pass   | 2.6 ms   |

The runner's file inventory equals the 532 unique paths in Vitest's JSON
results. Complete owning files ran after every deliberate mutation was
restored. This certifies the repository's complete Vitest matrix on Kubuntu;
hosted Windows/macOS and the live/editor release receipts remain with the lead.

### Final static and package gates

| Command                   | Result                                                                                                                                                         |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run typecheck`       | Host, webview, unit, e2e and integration projects all pass.                                                                                                    |
| `npm run lint`            | ESLint with zero warnings and Stylelint pass; repository's Linux PSScriptAnalyzer skip.                                                                        |
| `npm run format:check`    | All matched files pass. Final documentation edits also pass scoped Prettier.                                                                                   |
| `npm run check:reference` | Current: 53 features, 46 commands, 60 settings, 26 slash and 122 CLI.                                                                                          |
| `npm run check:l10n`      | 14 tables, 169 manifest strings, 629 source files; zero problems.                                                                                              |
| `npm run check:host-api`  | 332 VS Code APIs, 32 adapter files, 25 Node built-ins, 61 theme variables; zero problems.                                                                      |
| `npm run deadcode`        | Plain Knip passes.                                                                                                                                             |
| `npx jscpd`               | Zero clones across 1,232 analyzed files.                                                                                                                       |
| `npm run build`           | Production, unchanged physical/closure size caps, split, host globals and 83 dependency notices all pass.                                                      |
| `npm run package`         | Production build and exact staged localization pass; 34 HTTPS badges checked structurally with the existing named offline option; VSIX fits its unchanged cap. |

| Artifact                         | Measured        | Existing cap    |
| -------------------------------- | --------------- | --------------- |
| Activation extension             | 441.6 KiB       | 600 KiB         |
| Model API bundle                 | 447.3 KiB       | 475 KiB         |
| Chat startup with static imports | 733.1 KiB       | 900 KiB         |
| Original deferred aggregate      | 32.1 KiB        | 50 KiB          |
| Question UI closure              | 19.7 KiB        | 25 KiB          |
| Workflow details closure         | 2.6 KiB         | 25 KiB          |
| VSIX                             | 2,289,534 bytes | 2,457,600 bytes |

The stricter DIET1 startup/deferred baseline assertions pass in the complete
Vitest matrix as well. All other existing size caps pass.

The actual ZIP inventory contains exactly **39 fixed JavaScript files**, equal
to both `.vscodeignore` and `REPORT_PACKAGE_FRAME_PATHS`, including the built
`dist/questionNotes.js`; hashed browser chunks are handled by the existing
package rules. Artifact: `muse-spark-code-0.14.3.vsix`, SHA-256
`d047fda3c7e376ffd5f28c6c1125d2a67f2ae4310f3dd398722b3ceeb5c55b2c`.
This is a Linux rig artifact, without the macOS-built native helper; universal
release packaging and hosted cross-platform checks remain lead-owned.

Repair commit: `e9e0e055e`, with Husky, lint-staged and staged gitleaks passing.
Final receipt commit uses the same enabled hooks. No push, extra merge, rebase,
paid/live request, credential read, dependency installation, gate relaxation,
timeout override or hook change. The brief's explicit complete batched suite
supersedes common.md's focused-file restriction; its continuation-only rule
supersedes the stale generic M72 merge instruction. Aggregate quality and public
network remain prohibited by the shared rig rules.
