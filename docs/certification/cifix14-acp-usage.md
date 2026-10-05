# CIFIX14C — Packaged ACP usage (2026-10-05)

Rig: Kubuntu; worktree `/home/randy/lanes/CIFIX14C`; branch
`fix/ci-0.14.0-acp-usage`; starting commit `9da5d2014d691df91c7fbcb4d39b96f752d2e6ab`.
Node 24.18.0, npm 12.0.1. CI requests Node 22; these are local rig receipts.
No live model calls, credential-store access, paid requests, push, merge or rebase.

## Root cause

1. M91 kept the Setup command in `acpUsageSetup`; `main.ts` appended it after
   printing `acpUsage`, while the release check compared help with `acpUsage` alone.
2. Both keys were current in `uiTextRuntime.js`. The enumerable getter in
   `uiText.js` exposed the same value, and packaging copied the correct regions.
3. Put the existing Setup text inside `acpUsage` in English and every translation,
   remove the extra key/write, and keep the strict release equality check unchanged.

The complete help output is byte-identical before and after in English and all
14 translated locales. Argument errors now include that complete usage too.
This fixes the shared ACP runtime for every editor; no editor adapter changes.
No new dependency, command, setting, wire shape, cast or suppression.

## Reproduction and release steps

Before changing production code:

- `npm run build` passed all production bundle, split, host-global and notice gates.
- `node scripts/package-acp.mjs` produced the production 0.14.0 tarball.
- Installed it with `npm install --offline --prefix temp/acp-install --ignore-scripts
--audit=false --fund=false ./dist/muse-spark-code-acp-0.14.0.tgz`.
- `node scripts/check-ui-text.mjs temp/acp-install/node_modules/muse-spark-code-acp`
  exited 1 at its unchanged complete-help equality assertion: the actual output
  contained the appended Setup line that `EN.acpUsage` lacked.
- The new English and German process assertions both failed against that package:
  2 failed, 8 passed in the complete `acpStdio.e2e.test.ts` file.

After the fix:

| Release job step                                                                         | Result                                                                                        |
| ---------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `npm run package` (including `npm run build`)                                            | Passed all build gates, staged localization, VSIX creation and size gate                      |
| `node scripts/check-vsix-size.mjs muse-spark-code-0.14.0.vsix`                           | Passed: 2,168,076 bytes, cap 2,252,800                                                        |
| Exact workflow VSIX required-entry shell loop                                            | Exit 1: only `extension/native/darwin/muse-dictate` is absent; 47/48 required entries present |
| `npm run package:acp`                                                                    | Passed production build, committed exec-schema check and `node scripts/package-acp.mjs`       |
| Exact workflow ACP required-entry shell loops                                            | Passed: all 37 entries, including every table, schema and English region                      |
| Fresh offline install at `temp/acp-fixed-install`                                        | Passed with scripts, audit and funding disabled as in CI                                      |
| `node scripts/check-ui-text.mjs temp/acp-fixed-install/node_modules/muse-spark-code-acp` | Passed unchanged strict equality and actual extension/Model API/review bundle loading         |
| Installed-package `execStdio.e2e.test.ts` and `acpStdio.e2e.test.ts`                     | 46 passed; fake transports only                                                               |
| `node scripts/release-sbom.mjs`                                                          | Passed: 82 extension and 20 ACP shipped dependency versions                                   |
| `GITHUB_OUTPUT=<scratch-file> node scripts/release-reuse.mjs record`                     | Passed local receipt generation; regenerate against the final committed tree                  |

The rig has no compiled macOS helper; that download/upload depends on CI's macOS
job. It was neither fabricated nor fetched. The existing `node_modules` is
protected by the shared lane rules, so root `npm ci` was not run; the preinstalled
dependency tree and fresh offline tarball installs were used. GitHub artifact
upload/download and a green universal VSIX listing remain hosted checks. These
limitations do not affect the reproduced ACP failure or its passing strict check.
The aggregate `npm run quality` is prohibited by the shared lane brief and stays
with the lead. No gate, threshold, ignore, skip or timeout policy was changed.

## Regressions and deliberate failures

Every Vitest invocation used `--maxWorkers=3 --testTimeout=120000`, with at most
three complete files per run. No test-name filter, live suite or paid call.

The installed-package pass above contains 36 headless tests and 10 ACP tests.
Six source-fixture batches passed another 346 tests (336 unit tests and the same
10 ACP process tests), for 382 distinct tests across 18 files:

| Batch | Complete files                                                              | Passed |
| ----- | --------------------------------------------------------------------------- | ------ |
| 1     | `uiTextRegions.test.mjs`, `l10n.test.ts`, `hostL10n.test.ts`                | 48     |
| 2     | `acpAgent.test.ts`, `acpElicitation.test.ts`, `acpModelApi.test.ts`         | 107    |
| 3     | `acpNpmReadme.test.ts`, `acpPaid.test.ts`, `acpProxyWarning.test.ts`        | 47     |
| 4     | `acpReportObserver.test.ts`, `acpRuntime.test.ts`, `acpTranslate.test.ts`   | 77     |
| 5     | `runtimeConsent.test.ts`, `runtimeManifest.test.ts`, `runtimeStore.test.ts` | 31     |
| 6     | `deferredBundles.test.ts`, `acpStdio.e2e.test.ts`                           | 36     |

The process assertions check complete English usage, complete German usage,
successful help with empty stderr, Setup visibility, and the same complete usage
in an unknown-argument error. The German usage value is parsed with zod before use.

Two deliberate mutations exercised the new guards using fresh source fixtures:

| Mutation                                          | Observed failure                                                  | Byte-exact restoration (SHA-256)                                   |
| ------------------------------------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------ |
| Duplicate the help write in `src/runtime/main.ts` | English and German equality assertions failed: 2 failed, 8 passed | `63002ecbea4f88234433ea5f2482fb83aeec6234f497b773389d2b8e3617f6e2` |
| Remove Setup from English `acpUsage`              | Setup visibility assertion failed: 1 failed, 9 passed             | `3fdb4f3ea68f3c7d4a0e0be17f8cd8db89ce0d411ef79f90736cc23ca3e20498` |

The final source-fixture run passed after both restorations. A separate comparison
proved that all 14 tables changed only by folding their existing Setup string into
usage and removing the separate key. SHA-256 comparisons verified that installed
`acp.js` and all four English bundles match this production build exactly.

## Localization and sizes

`npm run typecheck` passed all five projects. Scoped `npx eslint --max-warnings=0`
on the three changed TypeScript files, changed-file `npx prettier --check`,
`npm run deadcode`, `npx jscpd`, and `npm run check:host-api` all exited 0.
The worktree's `.husky/_/pre-commit` exists and `core.hooksPath` points to `.husky/_`;
the commit uses the existing lint-staged and staged gitleaks hook unchanged.

Source `node scripts/check-l10n.mjs` and the exact staged-table check
`node scripts/check-l10n.mjs --packaged dist/vsix-package` both passed:
14 tables, 164 manifest strings, 590 source files, 0 problems.

| Artifact                | Bytes     | Unchanged cap  |
| ----------------------- | --------- | -------------- |
| `dist/extension.js`     | 447,145   | 600 KiB        |
| `dist/modelApi.js`      | 457,264   | 475 KiB        |
| `dist/acp.js`           | 836,371   | 850 KiB        |
| `dist/uiText.js`        | 49,138    | 125 KiB        |
| `dist/uiTextRuntime.js` | 3,542     | 25 KiB         |
| ACP tarball             | 1,295,440 | No tarball cap |

Raw execution logs, original/fixed scratch installs and local release artifacts
remain under the worktree's ignored `temp/` and `dist/` paths for lead review.
