# DEFLAKE5 — M95 full-suite determinism (2026-10-05)

Worktree `/home/randy/lanes/DEFLAKE5`, Kubuntu, branch `fix/m95-deflake`,
starting at `ad13e83a`. Follow `DEFLAKE5.rig.md` and `codex/common.md`, with
the rig brief's explicit full-unit authorization and 90-minute timebox.
Run directly here, with hooks on and explicit staging. No merge, push,
rebase, dependency change, live/paid call or credential access.

The historical failed quality run is read from
`/home/randy/lanes/M95INT/temp/m95-int2/quality-final.log` and
`docs/certification/m95-int.md`. Its five failures were already repaired
by parent commit `e9c3d21d`; successful isolated reruns after that repair
were not evidence of a load-dependent failure. The fresh complete runs
below audit both those repairs and genuine cross-file interference.

## Failures, causes and fixes

| File                                    | Observed failure                                                                                                                                                                                    | Root cause                                                                                                                                        | Fix                                                                                                                                                                                                                                              |
| --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `test/e2e/execStdio.e2e.test.ts`        | 22 package assertions fail, initially `dist/validation.js is missing`; dependent rows see exit 1 instead of 0 or the intended refusal.                                                              | The inert package fixture omits the newly shipped parser.                                                                                         | Existing `e9c3d21d` adds `validation` to its required bundles. This lane also builds and packs the real engine under its existing private tree instead of shared worktree `dist/`.                                                               |
| `test/e2e/execTestLauncher.e2e.test.ts` | Setup fails with `ENOENT` for `dist/acp-package/dist/validation.js`; six tests never run.                                                                                                           | The real launcher fixture does not build the newly required adjacent parser.                                                                      | Existing `e9c3d21d` builds `validationEntry.ts` beside the other runtime bundles.                                                                                                                                                                |
| `test/unit/ChatViewProvider.test.ts`    | Two HTML assertions expect `<script nonce=`.                                                                                                                                                        | Shipped webview scripts became ESM; the assertions still require the earlier tag.                                                                 | Existing `e9c3d21d` requires `<script type="module" nonce=`.                                                                                                                                                                                     |
| `test/unit/chatPanel.test.ts`           | Two HTML assertions expect `<script nonce=`.                                                                                                                                                        | The same obsolete tag expectation.                                                                                                                | Existing `e9c3d21d` retains nonce and module checks for restored and new panels.                                                                                                                                                                 |
| `test/unit/handoffDialog.test.tsx`      | `/usage` cannot find the `Account & usage` dialog.                                                                                                                                                  | Account & usage now loads asynchronously; the test reads it before import completion.                                                             | Existing `e9c3d21d` awaits the actual named dialog, preserving focus, exclusivity, draft and close assertions.                                                                                                                                   |
| `test/unit/deferredBundles.test.ts`     | Second full run: the `codeIntelQuery.ts` drill's green check gets `ENOENT` for a browser chunk; the `museVoice.ts` drill gets `Unexpected end of JSON input` instead of its expected guard message. | This suite mutates shared `dist/meta/*.json`; the built exec suite concurrently rebuilds the same tree, deleting chunks and truncating metafiles. | Build/pack exec in a copied private source tree with a dependency link; snapshot the deferred suite's production output into its own temporary tree before any mutation or guard check. The production build and guard scripts remain unchanged. |

The new regression deliberately truncates the worktree activation metafile
while checking the owned snapshot. Its guard must still return 0; the
shared file is restored in `finally` and checked by SHA-256. Existing
membership drills still require their precise error and a proven green
restored fixture, and restore their private metafiles byte-exact. Cleanup removes the
test-owned source/dependency links before removing owned trees.

The first private exec setup failed because the build enumerates
`test/integration` even in production mode. Copy that real source folder
too. No build behavior is mocked, no assertion removed, and neither a test
nor hook deadline changes. The corrected two whole files pass 63/63.

## Reproduction

Commands retain the quality unit entry's V8 coverage and default timeouts:

```sh
npm run test:unit -- --maxWorkers=3 --reporter=default --reporter=json --outputFile.json=temp/deflake5/baseline-1.json
npm run test:unit -- --maxWorkers=3 --reporter=default --reporter=json --outputFile.json=temp/deflake5/baseline-2.json
```

| Run          | UTC start | Workers | Vitest duration | Result                                                                                                                                      |
| ------------ | --------- | ------: | --------------: | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `baseline-1` | 19:02:00  |       3 |        266.69 s | Exit 0; 404 files / 8,092 tests pass; four files / 57 tests skip. Coverage passes.                                                          |
| `baseline-2` | 19:06:36  |       3 |        260.50 s | Exit 1; 403 files / 8,090 tests pass, one file / two tests fail; four files / 57 tests skip. Both failures are the shared build race above. |

No extra load is needed to reproduce the actual race. The five historical
files pass in the first complete coverage run. The second run establishes
why an isolated green run alone cannot certify the bundle drills.

Focused repair verification runs both complete owning files together:

```sh
npx vitest run test/unit/deferredBundles.test.ts test/e2e/execStdio.e2e.test.ts --maxWorkers=3
```

`fix-focused-2`: exit 0, 63/63, 61.47 s, default deadlines. The first
fixture attempt's missing-integration-directory failure is preserved in
`fix-focused.log`; its 12 unrun built-engine tests are not counted as passes.

## CPU-load failure and shared setup

The ten-worker `stress-core` run passes all 8,093 tests and the unchanged
coverage gates. `stress-load` adds four owned Node processes continuously
SHA-256 hashing one-MiB buffers; they change no files and are terminated
and waited for in `finally`. Existing unrelated rig activity is left alone.
The loaded run fails 15 cases in the same deferred-bundle file, all with
`Test timed out in 5000ms`, at 5,120.00–6,635.38 ms:

| Bundle        | Source cases                                                                                                                                                                                                                                  |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `extension`   | `src/core/codeIntel/codeIntelQuery.ts`, `src/core/voice/museVoice.ts`, `src/core/backends/modelapi/codecs/anthropic.ts`, `src/core/backends/modelapi/codecs/gemini.ts`, `src/host/review/museCodeReviewer.ts`                                 |
| `modelApi`    | `src/core/backends/modelapi/codecs/anthropic.ts`, `src/core/backends/modelapi/codecs/responses.ts`                                                                                                                                            |
| `acp`         | `src/core/backends/modelapi/codecs/anthropic.ts`                                                                                                                                                                                              |
| `pageWorker`  | `src/core/backends/modelapi/codecs/future.ts`                                                                                                                                                                                                 |
| `modelsPanel` | `src/core/providers/providersFile.ts`                                                                                                                                                                                                         |
| `providers`   | `src/core/backends/modelapi/codecs/anthropic.ts`, `src/core/backends/modelapi/codecs/gemini.ts`, `src/core/backends/modelapi/codecs/responses.ts`, `src/core/backends/modelapi/codecs/chat.ts`, `src/core/backends/modelapi/codecs/ollama.ts` |

Each case unnecessarily launches the complete source-parsing checker twice.
Perform the real green check once after taking the owned snapshot, as shared
setup. Every negative case still launches the unchanged checker, requires
the exact failure, restores its original metafile and proves SHA-256 equality
before asserting that initial green result. All other fixture artifacts stay
immutable. The independent peer-rewrite regression still launches a fresh
checker while the shared worktree metafile is truncated. No timeout, hook
budget, assertion, membership case, rule or retry changes. This reduces
complete checker invocations from 41 to 22 per file.

| Probe               | UTC start | Workers / extra CPU processes | Duration | Result                                                                                                                                                  |
| ------------------- | --------- | ----------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `stress-core`       | 19:17:10  | 10 / 0                        | 108.23 s | Exit 0, 404 files / 8,093 tests pass; 57 existing skips; coverage passes.                                                                               |
| `stress-load`       | 19:19:00  | 10 / 4                        | 140.55 s | Exit 1, 15 deadline failures / 8,078 passes / 57 existing skips.                                                                                        |
| `stress-load-fixed` | 19:23:22  | 10 / 4                        | 148.35 s | Exit 0, 404 files / 8,093 tests pass; 57 existing skips; coverage passes. Slowest membership case: 3,405.42 ms, versus 6,635.38 ms before shared setup. |

## Deliberate red drills

Run whole files, at most three per scoped command, with three workers and
default deadlines. Each drill restores its source bytes in `finally` and
compares SHA-256. The fixture drills temporarily use the test versions from
`e9c3d21d^`, without reverting any product code:

| Drill                  | Reintroduced defect                                                                         | Observed red result                                                                                                                       |
| ---------------------- | ------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `red-package-fixtures` | Omit the parser from both package fixtures.                                                 | Exit 1; exactly 22 package assertions fail, launcher setup fails, six launcher tests unrun; 14 other assertions pass.                     |
| `red-panel-dialog`     | Require the old script tag and read the usage modal synchronously.                          | Exit 1; exactly four tag assertions and the named `/usage` handoff assertion fail; 26 others pass.                                        |
| `red-shared-dist`      | Send the peer-rewrite regression's checker back to worktree `ROOT` instead of owned `WORK`. | Exit 1; only `checks its snapshot while a peer rewrites the worktree metafile` fails with `Unexpected end of JSON input`; 26 others pass. |

The loaded pre-optimization run additionally observes all 15 deadline
failures before sharing the immutable green check. The loaded fixed run
passes every one at the unchanged deadline. The new peer-rewrite test was
drilled again after the lint-required state-container correction; the final
source hash is below. Full-suite green receipts after restoration follow.

## Static gates

The final corrected source returns 0 for `npm run typecheck` (all five
projects), `npm run lint`, `npm run format:check`, `npm run deadcode`
(plain knip), and `npm run duplication` (zero clones). The Windows-only
PowerShell linter reports its existing Linux skip; JavaScript/type-aware
and CSS lint pass. The initial full lint's sole diagnostic was
`unicorn/no-top-level-assignment-in-function` on the shared result variable;
use a typed state object instead, with no suppression or rule change.
The corrected full lint and scoped changed-file lint both pass.

The rig brief explicitly limits this lane to full unit/coverage runs and
these five static gates. No full quality wrapper or release/helper
certification is claimed. Detailed logs and JSON results remain in the
ignored `temp/deflake5/` directory; the failed run receipts are retained.

## Restoration hashes

Before/restored SHA-256 values (each pair identical):

| Source                                  | SHA-256                                                            |
| --------------------------------------- | ------------------------------------------------------------------ |
| `test/e2e/execStdio.e2e.test.ts`        | `af0aba580121a29ce37669653437c1916bee4609db3204d7efe825448b88f84d` |
| `test/e2e/execTestLauncher.e2e.test.ts` | `3b919750bff507283679d718caa81483aa11f60a7c9208633d2df89214880d37` |
| `test/unit/ChatViewProvider.test.ts`    | `5ce53eb1dd5770548c136f1d6e76a1408867133dc8717f2644433386fe81d08e` |
| `test/unit/chatPanel.test.ts`           | `0141906260e851c36c67942db46e94a9ef35a2286207d161ab1414ab776f5a93` |
| `test/unit/handoffDialog.test.tsx`      | `0b89497b405aae1db2b0c0c2943e3db5de5d49fc961255d477ab832d6fdf74be` |
| `test/unit/deferredBundles.test.ts`     | `130facac4be5266f2ace40e26432cf462f64e788be01f963f398b045f7840b8b` |
