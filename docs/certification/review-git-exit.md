# Lane REVIEWEXIT — native review with no Git filters configured

## Defect

`exitOf` in `src/host/review/reviewCollector.ts` read a failed git call's
exit code from `error.code`. The production runner (`processGitRunner` over
`createGitProcess` in `src/host/git.ts`) rejects with `GitExitError`, which
carries the code in `exitCode` and has no `code` property. `readFilters`
treats exit 1 from `git config --get-regexp` as "no filters configured";
with `exitOf` returning "unknown", exit 1 was rethrown and every native
review ended as `gitFailed` ("Git could not read the changes to review").
Shipped in 0.15.0, 0.16.0, 0.17.0. Hidden because every machine that ran
these tests (hosted runners included) has Git LFS filters in its global Git
configuration, so the command exits 0 there.

## Fix

One exported helper, `gitExitCode` in `src/host/git.ts`: reads
`GitExitError.exitCode` first, then a Node error's numeric `code`,
`undefined` otherwise. Used by `metadataGit` (same file) and by the review
collector (`exitOf` for the log, a numeric `!== 1` check for the filter
read). Sweep verdicts (each other `.code` read in `src/` checked):

- Already correct on `isGitExitError(...exitCode === ...)`: `core/git/status.ts`,
  `host/tab/tabProvider.ts`, `host/importIo.ts`, `host/checkpoints/recordRefs.ts`,
  `host/team/stagingCopy.ts`, `runtime/panel/git/adapter.ts`.
- Right as is (different error domain, never a git exit): `host/git/heldCheckout.ts`
  (Node's string `ERR_CHILD_PROCESS_STDIO_MAXBUFFER`), `host/git/conversationGit.ts`
  (vscode.git's `gitErrorCode`), `host/conversation/conversationController.ts`
  (generic log classifier), `core/backends/musecode/logText.ts` (MSP wire codes),
  `host/team/checkSlots.ts` (`config --list` exits 0 when empty; all non-zero
  exits are fatal there), `core/reporting/sources/git.ts` (result field, not a
  caught error), and every filesystem/account/hook `ENOENT`/`EEXIST`/`ESRCH` read.

## Tests

- New `test/unit/helpers/isolatedGitConfig.ts`: empty global/system config
  files the test owns; `GIT_CONFIG_GLOBAL`/`GIT_CONFIG_SYSTEM` point at them,
  plus `GIT_CONFIG_NOSYSTEM=1`. Wired into `reviewMaterial.test.ts` (direct
  `git()` and every `processGitRunner`), `helpers/reviewRoots.ts` (shared
  setup), and the `conversationController` native-admission suite.
- New cases in `reviewMaterial.test.ts`: production `GitExitError` exit 1 as
  empty inventory (the case that would have caught this); real runner exit 1
  with no filter configured; LFS filter in the test-owned global config;
  repo-local clean/process/required filter carried as scoped overrides;
  exit 128 / signal (-1) / timeout kept closed with their own reasons.
- New `gitExitCode` unit cases in `test/unit/git.test.ts`.

## Proof on rig linuxlt (no LFS filters in global config there)

Before (commit `a83e71e8d`, this rig):

- `reviewMaterial`: 25 failed | 13 passed | 2 skipped (40). Signature:
  `refused gitFailed` with `failure: "git config exited with no exit code"`.
- `conversationController` native-material admission: 4 failing (per brief;
  not re-run on old code here).

After (commits `fd349cc8d`, `caba5dab3`, `45d50ac41`):

- `reviewMaterial`: 47 passed (40 + 7 new), default timeout.
- Same file with a machine-like LFS filter plus a user identity in the outer
  `GIT_CONFIG_GLOBAL`/`GIT_CONFIG_SYSTEM`: 47 passed (isolation holds).
- `conversationController` native-material admission: 4 passed.
- `git.test.ts`: 21 passed.

Red drill: `exitOf` put back (old body), the two production-runner exit-1
cases fail; fix restored byte-exact (`sha256sum` of
`src/host/review/reviewCollector.ts` back at
`e46b9326c755191d53c38f258936b2644fc6a307fba0650ebe6a5f1da59a0d0d`),
both cases green again.

## Dependents

- `vitest related` over `src/host/git.ts` + `src/host/review/reviewCollector.ts`:
  169–170 of 177 files green across runs; the 5–6 failing files
  (`runtimeChatGpt`, `chatGptVsCode`, `subscriptionIntegration`,
  `usageIntegration`, `configuredProviders`, `acpAgent`) fail on live-network
  assertions the rig's proxy answers with 502 (`ChatGptSignInError:
request-failed`, expected 401 got 502). `configuredProviders` fails
  identically on a pristine `a83e71e8d` tree: pre-existing, environmental.
- Typecheck (all five projects): exit 0. Eslint + prettier on changed
  files: clean. Duplication (`npm run duplication`): 0 clones.
  `npm run build`: exit 0, no cap changed — touched bundles in exact bytes:
  `dist/extension.js` 563974 (budget 600 KiB), `dist/review.js` 36911
  (budget 50 KiB).
- No UI sentence changed (`src/shared/l10n/en.ts` untouched), so `check:l10n`
  has nothing new to validate; README/help text describing native review says
  nothing about filters and needed no change.
