# CIFIX14W2 — Windows 8.3 paths in the kept shell directory

Worktree `C:/lanes/CIFIX14W2`, branch `fix/ci-0.14.0-shortpath`, base
`9da5d201`. Windows 11 rig, Node 24.21.0, npm 11.19.0. Hosted CI uses Node 22;
this record certifies the local rig. No network, credential access or model
calls; counted model attempts: **0**. No wire shapes changed.

## Finding and fix

Windows `fs.realpathSync` preserves 8.3 names. The existing asynchronous
`canonicalPath` resolver (`fs.promises.realpath`) already expands them, like
`fs.realpathSync.native`, and the session already resolves both the reported
directory and workspace root before checking containment or deriving its tail.
However, the starting/reset cwd bypassed that resolver and used the raw
workspace path. The original real-shell test also derived its expectation with
ordinary `realpathSync`, allowing its expectation to retain CI's short profile
name while the shell reported the long name.

`ModelApiSession.beginShellDirectory` now resolves the Windows root through
the same `ToolIo.realPath` before starting/resetting a tracked call. The kept
directory, root comparison, containment and displayed relative tail therefore
share the native long form. POSIX retains its existing root handling. Both
VS Code and the ACP/headless runtime use `createToolIo`, so the correction
applies to those hosts without an editor-specific branch or new API.

## Real fixture and regression coverage

8.3 creation is available on this rig's C: volume; no machine setting changed.
An explicit `cmd.exe /d /c for %I in ("<directory>") do @echo %~sI` probe produced:

| Form                  | Path                                                |
| --------------------- | --------------------------------------------------- |
| Long                  | `C:\lanes\CIFIX14W2\temp-short-path-fixture-7DmkLj` |
| Short                 | `C:\lanes\CIFIX1~1\TEMP-S~2`                        |
| Ordinary realpathSync | `C:\lanes\CIFIX1~1\TEMP-S~2`                        |
| Native/async realpath | `C:\lanes\CIFIX14W2\temp-short-path-fixture-7DmkLj` |

The real PowerShell case now opens its workspace through the actual short
alias and explicitly changes into the short spelling of `sub`. It asserts the
long initial/kept/reset cwd, the model and panel's `In sub` tail, silence when
returning to the root, rejection outside the workspace and exit-code retention.
The canonical-path file additionally checks existing and missing tails under
a real short alias. If another Windows volume disables 8.3 creation, the real
case retains its filesystem assertions and the injected cases still exercise
CI's exact `RUNNER~1`/`runneradmin` strings in both input directions. No tests
are skipped for that condition.

## Red drills

Before the product fix, the complete directory/canonical batch exits **1**:
**7 failures / 29 passes**, including the real short-path case and the injected
short workspace root. After the fix, the same complete batch passes **36/36**.

The deliberate removal drill removes the Windows starting-root resolution and
bypasses Windows canonicalization in the existing filesystem resolver. The
same two complete files exit **1**, **10 failures / 26 passes**. The new real
alias canonical-path assertion fails on `MUSE-C~2` versus the long folder;
the real shell loses `sub` through the mismatched containment roots. Both
mutated source files are restored from private byte copies and their SHA-256
values match exactly:

| File                                         | Restored SHA-256                                                   |
| -------------------------------------------- | ------------------------------------------------------------------ |
| `src/core/backends/modelapi/ModelApiHost.ts` | `ce49f8cc879ab1388b3030307329064208f98a4e5aa67090f0c79c664f928ce6` |
| `src/host/canonicalPath.ts`                  | `d78aeae478ae26f0fb7ee595a0e5041f9e71b3f059286ddebd5b1a907f57d42e` |

The filesystem resolver has no final source change: the existing native
behavior is sufficient. The root fix adds no dependency, setting, UI copy,
escape hatch or gate exception.

## Checks

Every Vitest dispatch uses complete files, at most three files per invocation,
`--maxWorkers=3`, and no CLI timeout override. Existing case deadlines and
platform/opt-in skips remain unchanged.

| Files                                                      | Result                        |
| ---------------------------------------------------------- | ----------------------------- |
| `modelApiShellDirectory`, `canonicalPath`                  | 36 passed                     |
| `shellSyntax`, `shellQuote`, `shellJob`                    | 151 passed, 22 existing skips |
| `shellBoundedMonitor`, `toolIo`, `toolIoCommandAdmission`  | 53 passed, 2 existing skips   |
| `toolIoBounded`, `modelApiTools`, `modelApiShellDirectory` | 79 passed                     |

After the fixture launcher is switched to the typed `spawnSync` API and scoped
lint findings are corrected without suppressions, the final complete
directory/canonical batch passes **36/36** again. Across the ten unique files,
**288 tests pass / 24 existing cases are skipped**.

All required scoped/static commands exit **0**: all five TypeScript projects,
ESLint with `--max-warnings=0` on changed TypeScript files, Prettier on all
changed files, plain Knip, jscpd (**0 clones**), localization (**0 problems**),
host-API inventory (**0 problems**), and production build including size,
split, host-global and third-party-notice gates. The build measures:

| Bundle               | Size      | Unchanged cap |
| -------------------- | --------- | ------------- |
| `extension.js`       | 436.7 KiB | 600 KiB       |
| `modelApi.js`        | 446.6 KiB | 475 KiB       |
| `checkpointStore.js` | 76.9 KiB  | 225 KiB       |

The worktree's configured `.husky/_/pre-commit` exists before committing;
the normal hook runs lint-staged and staged Gitleaks. Only the six explicit
source/test/documentation paths are staged.

The first hook-on commit attempt fails before lint-staged because npm's
launcher requires `bash`, while the rig's MinGit exposes GNU Bash only as
`sh.exe`. Its `--version` identifies GNU Bash 5.3.15. A private worktree
`temp/cifix14-shortpath/bin/bash` launcher delegates to that verified executable
with Bash's argv name; only the commit process receives the temporary PATH
prefix. Repository hooks, Git configuration and machine/user settings are
unchanged. The hook-on commit is retried through this launcher.

The shared lane rules prohibit aggregate `npm run quality`; the lead retains
the integrated full quality, full coverage and hosted Node 22 certification.
No merge, rebase or push is performed.
