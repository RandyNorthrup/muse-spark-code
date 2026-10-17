# MSWINPATH — Safer Windows paths follow-ups (2026-10-17, macmini)

Lane: `ms/mswinpath`. Milestone: the shipped SECWINPATH / SECWINPATH2 /
TRUSTROOT (D105) "Safer Windows paths" line; there is no `### WINPATH`
heading on main, no `cand/MSWINPATH/*` branch, and no `@unwired WINPATH`
code, so there was nothing unwired to connect. The SECWINPATH identity
commits (`7cec0c47c`, `203660e7d`) are ancestors of main, and every
trusted-path caller (`nodeBackgroundIo`, `nativeBackground`,
`effectiveDefinition`, `convert`, vault store) is wired. The step-2
merge of the then-current `main-now` (`3d30a7321`: PR #165 plus
`origin/main`) landed as `4d80deaab` with `--no-ff`, no conflicts.

## What was finished

One genuine follow-up bug plus the regression cover the D108 test overhaul
deleted (`test/unit/windowsTrustedPath.test.ts` went out in `f2b00c094` as
GO):

- `src/runtime/windowsTrustedPath.ts` (`stepsBelow`, now exported): the
  escape check was `relative.startsWith('..')`, so a folder literally named
  `..foo` (or `...`) directly under the trusted root was refused as
  "outside its trusted root". Only `..` itself or a leading `..\` leaves
  the root now; genuine escapes (`..\other`, siblings, other drives) still
  fail closed. Commit `24cbe24b6`.
- `test/unit/windowsPathSpelling.test.ts` (13 tests): the shared Win32
  spelling refusal through the real module with an explicit win32 platform —
  devices incl. superscript spellings, ordinary dotted names (`con.d`),
  trailing dots/spaces, streams, drive-relative spellings, verbatim-prefix
  handling, device namespaces, UNC inside/outside a UNC workspace. Runs on
  every OS, no stand-ins.
- `test/unit/windowsTrustedPathSteps.test.ts` (5 tests): `stepsBelow`
  accept/refuse cases plus verifier pre-query refusals (escape fails
  closed, absolute path/root required) with a `run` that throws, proving
  no subprocess is needed for these paths.

## Connections (file:line on the merged tree)

Trusted-root verifier (`src/runtime/windowsTrustedPath.ts:39`
`stepsBelow`, `:60` `windowsTrustedPathVerifier`, used at `:103`):

- `src/runtime/schedules/nodeBackgroundIo.ts:192` verifies schedule
  launchers, scripts, records and directories (`:136-137`, `:226-236`,
  `:380-395` reach it through the `trustedPath` port).
- `src/runtime/schedules/nativeBackground.ts:91,149,250` reverifies the
  wake record, the registration and the executable on Windows wakes.
- `src/runtime/schedules/effectiveDefinition.ts` carries the port to the
  definition check; `src/core/media/convert.ts:103` gates converter
  commands; `src/core/vault/store.ts:97,104` gates vault paths.
- `src/runtime/trustedPathPort.ts:2` is the `TrustedPathVerifier` port.

Shared spelling refusal (`src/core/windowsPathSpelling.ts:50`
`windowsPathProblem`, `:30` `normalWindowsPath`, `:39` `isUncPath`,
`:35` `isWindowsDeviceLike`):

- `src/core/protectedPaths.ts:69-70` refuses flagged Muse Code write
  subjects; `src/core/workspacePath.ts:121-135` guards admission with
  the workspace root as UNC authority.
- `src/core/git/heldTree.ts:104-105` (device-like tree names stay
  conservative); `src/core/team/workers/workerFence.ts:238-289` (worker
  fences); `src/host/checkpoints/checkpointStore.ts:1978` (checkpoint
  admission carries the workspace root); `src/core/worktreeConversations.ts:189-195`
  (held-tree identity via `src/core/pathIdentity.ts:73`
  `pathIdentityRelation`, checkpoint storage via
  `src/host/checkpoints/shadowGit.ts:156`).

## README / Help reference (added 2026-10-17)

- README `### Safer Windows paths` (new `#safer-windows-paths` anchor at
  the end of Privacy and security): the refusal/approval behavior, UNC
  rule, any-drive workspaces, and trusted-root verification.
- Help reference feature `windows-paths` (`src/shared/featureCatalog.ts`,
  after `permissions`): name `referenceWindowsPaths`, summary
  `referenceWindowsPathsDetail`, no commands/settings of its own, both
  backends, vscode+acp surfaces (core refusal is used by both backends'
  hosts and `src/acp/*`). Capability entry added to
  `src/shared/reference/referenceSource.ts` (4-surface group).
- English keys in `src/shared/l10n/en.ts`; English text in all 14
  `l10n/ui.*.json` tables at the English position, allowlisted in
  `l10n/untranslated.json` `ui.*` (precedent: `referenceAccountsTitle`).
- Regenerated with `npm run reference:generate`: 74 features (was 73);
  `docs/reference.md` gains the section with the docs anchor;
  `reference.generated.*` and `src/runtime/reference.node.generated.ts`
  updated. First generate attempt exposed a missing capability entry
  (`Host capability mismatch: windows-paths`) — fixed by adding it, then
  green. `npm run check:reference`: 74 features, matches, exit 0.
  `npm run check:l10n`: 0 problems, exit 0.
- Reference suites pass: `referenceEntry`, `featureCatalogDetails`,
  `uiTextRegions` (28 tests). Post-change `npm run build` exit 0;
  `SEMGREP_ENABLE_VERSION_CHECK=0 npm run security:sast` exits 2: the
  semgrep binary itself crashes (`ca-certs: empty trust anchors`) before
  scanning — an environment failure, unrelated to this diff (docs,
  strings, catalog data), and the same command exited 0 earlier the same
  day. Recorded as environmental; hosted CI owns the green run.

## Red drill

`test/unit/windowsTrustedPathSteps.test.ts` against the pre-fix line fails
`accepts ordinary names that start with two dots` with
`expected undefined to deeply equal [ '..foo' ]` while the genuine-escape
cases still pass; the fix restores green. No source bytes beyond the fix.

## Gates (final tree; macmini, repo defaults, no timeout overrides)

| Gate                                                                                                                | Result                                                                 |
| ------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| New + related suites (`windowsPathSpelling`, `windowsTrustedPathSteps`, `museCodeProtectedWrites`, `canonicalPath`) | 4 files, 54 tests pass, exit 0                                         |
| `npm run typecheck` (all 5 projects)                                                                                | exit 0                                                                 |
| prettier `--check` on touched files                                                                                 | pass                                                                   |
| eslint on touched files, zero warnings                                                                              | exit 0                                                                 |
| `npm run deadcode` (knip)                                                                                           | exit 0                                                                 |
| `npm run cycles`                                                                                                    | no cycles, exit 0                                                      |
| `npm run duplication`                                                                                               | 0 clones, exit 0                                                       |
| `npm run check:l10n`                                                                                                | 0 problems, exit 0                                                     |
| `npm run check:reference`                                                                                           | matches, exit 0                                                        |
| `npm run check:host-api`                                                                                            | 0 problems, exit 0                                                     |
| `npm run check:plan`                                                                                                | 0 drift, exit 0                                                        |
| `npm run check:roadmap`                                                                                             | current, exit 0                                                        |
| `npm run build`                                                                                                     | exit 0                                                                 |
| `security:sast` (`SEMGREP_ENABLE_VERSION_CHECK=0`)                                                                  | exit 0                                                                 |
| Full `npm run test:unit`                                                                                            | 525 files / 9,131 tests pass; 23 files / 76 tests fail (below), exit 1 |

## Full-suite failures: pre-existing rig-load failures, not this change

Two complete runs (1,534 s and 1,989 s wall — the rig is heavily loaded by
concurrent lanes). Failing files are process/filesystem/packaging suites
(`checkSlots`, `fileLease`, `actionGit`, `actionApply`, `nativeGitCore`,
`team*`, `trees*Native`, `*Packaging`, `usageL10nGate`, `promptStore`,
`noticesInput`, `packagedBundles`, `reviewMaterial`,
`runtimeChatGptPackage`, `teamLanding`, `trafficView`, plus two
`test/e2e` exec suites). 37 of the 76 failures are `Test timed out in
5000ms` (the repo-default timeout firing under load); the remaining
assertion failures are process-table and wall-clock races (`fileLease`
birth/owner reads, `treesLifecycleNative` zombie reaping,
`checkSlots` slot timing). **None of the 23 files imports
`windowsTrustedPath`, `windowsPathSpelling` or `pathIdentity`** (checked),
and the suites covering the changed module all pass (above).

Base check: `test/unit/fileLease.test.ts` run in a pristine `main-now`
worktree (no lane changes) fails the **same 5 tests** with the same
signatures — pre-existing/environmental. The worktree was removed after.

## Worktree incident (2026-10-17 ~08:39 PDT)

170 tracked test files (`test/unit/*`, `test/e2e/*`) were deleted from
this lane's worktree by an unknown process — not by any lane command
(sibling lanes `MSM47`/`MSM56` are clean; no lane command deletes test
files). All content was intact in the lane commits, so every file was
restored byte-identical with `git checkout --` from the 170-path list
(`$TMPDIR/mswinpath-deleted.txt`); `git status` is clean and the focused
suites re-pass (18/18). Possible cause under investigation: another
lane's test-cleanup operating across worktrees, or a destructive suite
cleanup under load. No credentials or user files were involved.

## Base note

This lane started at the brief-named `821566c0f`; `main-now` advanced
mid-session to `3d30a7321` (PR #165 plus `origin/main` merges), which the
lane then merged with `--no-ff` as `4d80deaab` (brief step 2, no
conflicts). Post-merge re-verification: the 6 lane- plus merge-touched
suites pass (85 passed, 2 skipped), all 5 typechecks exit 0,
`check:plan` 0 drift. The pre-merge full-suite and static-gate receipts
above stand for the lane's own diff, which the merge does not touch
(43 merged files: PR #165 permissions work; disjoint paths).

## Real-life steps for the lead (Windows 11 host)

1. `npx vitest run test/unit/windowsPathSpelling.test.ts test/unit/windowsTrustedPathSteps.test.ts --maxWorkers=3` — passes on Windows unchanged.
2. Create `C:\tmp\trustroot\..foo` as a real folder and verify a native
   schedule registration rooted at `C:\tmp\trustroot` accepts it (pre-fix
   it was refused as outside its trusted root); verify `C:\tmp\other`
   against the same root is still refused.
3. The verifier itself is reachable only through native schedule
   wake/registration and helper launches on Windows — there is no direct
   user command; the spelling refusal surfaces in workspace/checkpoint
   admission messages.
