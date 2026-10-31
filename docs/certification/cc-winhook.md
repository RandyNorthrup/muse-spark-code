# CC-WINHOOK — Tab hooks on a busy Windows PC, Tab over LSP asks nothing it cannot send (2026-10-30)

Claude Code lane `CC-WINHOOK`, worktree `C:/Users/Randy/Coding/mx-cc-winhook`,
branch `cc/winhook`, on the owner's Windows 11 PC (Intel i9-12900HK, 20 logical
CPUs, Node 24.20.0, npm 11.19.0). Model attempts: **0**. Provider calls: **0**.
Nothing was pushed, rebased, reset, stashed by hand or tagged (the pre-commit hook's own
automatic backup, which lint-staged takes and drops, is the only stash this lane's commits touched). The vault suites and the real
credential-store suites (`keyringParts`, `keystoreOwner`, `credentialLease`,
`providerHeadersStore`, `test/unit/vault/**`) were never run on this PC.

**Base.** The brief named `int/recovery` `b781451b94`. The work it builds on (CC-WINFAIL's
CLR-only owner and ACL calls, CC-WINRUNS's Tab reorder) is in `int/recovery` at
`dfcb45936f` (CC-INT4) and not in `b781451b94`, which `cc/winhook` was cut from, so
the branch was fast-forwarded to `dfcb45936f` before any change (`git merge
--ff-only`, no merge commit; the lead's merge back is a fast-forward too).

Scratch files lived in the worktree's ignored `temp/` (`TMP` and `TEMP` set to
`temp/tmp`, `GIT_CEILING_DIRECTORIES` to `temp`). The busy loops used to make
contention were started by this lane, pinned to two CPUs, and stopped by PID
(the script records the PIDs and stops each in a `finally`; none was left).

## 1. What the "ten PowerShell starts" of a hook launch were

The brief expected owner and ACL probes. None appears in a warm hook launch. A process
counter loaded into the real agent (`node --require` over `child_process`:
every `spawn`, `execFile` and `spawnSync` it makes, with the time) beside a
client that drives `lsp` over stdio like `runtimeLsp.test.ts` does, with a Tab
hook that stamps when it ran, counted the starts inside one hook launch (from
the first registry write of the launch to the hook running). One warm request,
base `dfcb45936f`:

| Starts | What                                          | Where                                                                                                   |
| ------ | --------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| 4      | `MuseSparkCreated` `publish` (registry write) | the created-path registry: temp-root intent, its identity, a launch, the end                            |
| 1      | `MuseSparkCreated` `create`                   | the hook's private temp root                                                                            |
| 1      | `MuseSparkCreated` `remove`                   | the temp root at the end                                                                                |
| 1      | `MuseSparkJob.Hold`                           | the job holder (`resourceJobHolder.ts`)                                                                 |
| 1      | `MuseSparkJob.Join` + `cmd.exe /S /C`         | the hook itself (`toolIo.runHook`)                                                                      |
| 1      | `MuseSparkJob.Identity`                       | the tree reader binding the root                                                                        |
| 1      | `MuseSparkJob.Contains`                       | the membership proof                                                                                    |
| 1      | `MuseSparkJob.Query`                          | the sampler                                                                                             |
| **11** |                                               | 8 to 14 across requests; the whole request, which also runs `git` for Tab's ignore check, made 15 to 18 |

Ten of the eleven were the resource governor's own calls into the compiled job
helper, each a cold Windows PowerShell start (`powershell.exe`: 0.22 s idle, median of
eight; a native .NET program: 0.04 s) that only loaded the helper and called one method.
The eleventh was the hook's own. With them the typical hook launch was about 0.9 s on a
quiet PC, against a 1.5 s bound that also covers the hook's own run.

## 2. The change

- `native/windows/MuseSparkJob.cs` gains `MuseSparkJobHost`, a `Main` that makes
  the same calls PowerShell made (`identity`, `query`, `contains`, `signal`,
  `hold`, `read-priority`, `set-priority`, `read-rate`, `set-rate`, `created`) and
  prints the text the PowerShell call printed; a failing call prints nothing and
  exits 1, as the scripts' `catch { exit 1 }` did. The helper is built as a
  console program (`MuseSparkJob-<digest>.exe`) and is still the type
  PowerShell loads with `LoadFrom` (`[MuseSparkJob]::Join`, unchanged).
- `windowsJobHost` (`core/execGuard.ts`) is the one place that names it as a
  program: absolute path, environment of `SystemRoot` only. The tree reader,
  the actuator (`trees/windows.ts`, `actuators/windows.ts`), the created-path
  registry's Windows commands (`createdPathCommands`) and the job holder
  (`resourceJobHolder.ts`) call it; none starts PowerShell any more.
- A governed Windows hook starts through the native job launcher, as a bounded
  CLI command already did (`toolIo.runHook` with `nativeJob`, the line
  `cmd.exe /D /S /C "<command>"` passed verbatim): no PowerShell, no holder,
  no identity or membership probe. Where no governor is configured, or the
  launcher is unavailable, PowerShell joins the job first and starts `cmd.exe`
  as before.
- **A behaviour change found on the way.** A Windows PowerShell `-Command` that
  ends in a failed native command exits 1, whatever the code: a hook that
  exited 2 (which blocks its event) reached the dispatcher as 1, so it never
  blocked on Windows. The native launcher passes the hook's own code; the
  PowerShell line now ends by exiting with it (`$?`, then `$LASTEXITCODE`,
  anything else 1), so both routes agree.
- Nothing was raised: `TAB_HOOK_TIMEOUT_MS` (1.5 s) and every other timeout are as they were.

## 3. Measurements

Driver: `temp/hook-trace/drive.mjs` (not committed): the production `dist/acp.js` of the
build under test, `lsp --workspace <ws> --trust-workspace --tab --verbose`, a workspace
whose `.muse/spark-hooks.json` has one `beforeTabFileRead` command hook that stamps the
time and exits 0 with no output (so nothing is permitted and the credential store is never
read), one document, one `textDocument/inlineCompletion` after another. "Hook launch" is
the time from the launch's first registry write to the hook running; "request" is the
client's wait for the answer (which also covers the `git check-ignore` launch). The
"before" build is `git archive dfcb45936f` built in `temp/before` with the same script.
Background load from the owner's use of the PC was about 1 to 25 % over the measuring minutes.

### Alone

| Build                                 | Warm request                   | Hook launch                   | PowerShell starts in the hook launch | PowerShell starts in the request |
| ------------------------------------- | ------------------------------ | ----------------------------- | ------------------------------------ | -------------------------------- |
| before (10 requests)                  | 1.51 to 2.18 s (median 1.92 s) | 858 to 973 ms (median 912 ms) | not counted in this run              | 15 to 18                         |
| before (8 more)                       | 1.67 to 3.50 s                 | 847 to 1175 ms                | 8 to 14                              | 15 to 21                         |
| after (10 requests)                   | 0.61 to 0.70 s (median 0.65 s) | 250 to 347 ms (median 275 ms) | **0** (7 native)                     | **0**                            |
| after (8 more)                        | 0.62 to 0.70 s                 | 267 to 305 ms                 | **0** (7 native)                     | **0**                            |
| before (8, PC 25 to 35 % busy)        | 1.95 to 4.2 s                  | 1083 to 1400 ms               | 8 to 11                              | 15 to 18                         |
| after (packed, 8, PC 10 to 46 % busy) | 0.87 to 1.18 s                 | 362 to 513 ms                 | **0** (7 native)                     | **0**                            |

The first request of a process is cold (the job helper's self-test is the one PowerShell
start a process makes): 2.2 s before, 1.1 s after. One request in the first "before" run
(not in the table) missed the hook entirely on a PC about 20 % busy: 9 PowerShell starts,
2.97 s, no hook: the bound.

### Under the CC-WINFAIL contention

The driver and everything it starts (agent, hook, `git`, helpers) confined to two CPUs
(logical CPUs 2 and 4) with six `node -e "for(;;){}"` loops on the same two, stopped by PID.

| Build  | Requests  | Request        | Hook ran | PowerShell starts       |
| ------ | --------- | -------------- | -------- | ----------------------- |
| before | 6 (93 s)  | 11.2 to 18.9 s | 0 of 6   | 6 to 13 in a request    |
| before | 8 (170 s) | 12.6 to 29.4 s | 0 of 8   | 5 to 8 in a hook launch |
| after  | 8         | 3.5 to 13.3 s  | 3 of 8   | 0 in a request          |
| after  | 8         | 3.9 to 10.3 s  | 2 of 8   | 0 in a request          |

At this load every start of any program is slow (a native helper call that takes 40 ms
alone takes 350 to 700 ms here), so what is left is the sequence of the registry's three
writes before the hook (`publish`, `create`, `publish`), which are in order by design
("durable intent precedes mkdir"). The bound is still 1.5 s and still fails closed.

### `runtimeLsp.test.ts`'s hook cases under that contention

The two cases that start a Tab hook (`with --tab in a trusted workspace runs
beforeTabFileRead ...` and `answers a cancelled request with RequestCancelled ...`;
`vitest run test/unit/runtimeLsp.test.ts -t "trusted workspace runs beforeTabFileRead|RequestCancelled"
--maxWorkers=1`). vitest builds `dist/` at full speed; once its test worker exists the
worker (so the agents, hooks and `git` the cases start) is confined to CPUs 2 and 4 and
six busy loops are started on the same two (`temp/hook-trace/contend-vitest.ps1`, not
committed; PIDs recorded and each stopped in a `finally`).

| Build                                               | Result                                                      | Per case                                                             |
| --------------------------------------------------- | ----------------------------------------------------------- | -------------------------------------------------------------------- |
| after (this change)                                 | **2 passed**, 8 skipped by the filter; 207 s with the build | both inside the case's 120 s retry loop                              |
| before (the eight product files at `HEAD`, rebuilt) | **2 failed**, vitest exit 1; 314 s with the build           | 121.8 s and 147.4 s: the loop's budget ran out, "the hook never ran" |

Alone, on a quiet PC, the whole suite is 10 of 10 in 72 s.

## 4. Tab over LSP asks before it can know

`src/runtime/lsp/lspTab.ts` had CC-WINRUNS's old order: eligibility, then the stored
key, then D48's question, and only then the secret under the cursor
(`secret-at-cursor`), so with a key stored a request that could never be sent still asked
the person to approve a spend, and Deny snoozed the connection. The request now decides
the secret from the document right after the policy check, before the key is read and
before the question (`redactedHalves`, as CC-WINRUNS did for VS Code in `56a8686b51`; here
it comes before the key read too, because a request that cannot be sent should not touch
the store either).

The case is in `test/unit/runtimeLsp.test.ts`, through the real server (`dist/acp.js lsp
--tab --trust-workspace`) under `vscode-jsonrpc` as the client, which now records every
`window/showMessageRequest`: a buffer whose cursor sits inside `const password =
"hunter22";`, one inline completion, then the log must say `Tab quiet (secret-at-cursor)`,
not `no-key`, not `consent-denied`, and the client must have been asked nothing. It needs
no stored key and, on the new order, never reaches the credential store.

Red on the old order (the file as it was, rebuilt, the one case): `Tab quiet (no-key)`
where `secret-at-cursor` was expected, exit 1 (the old order read the store, which holds
no Model API key for this agent on this PC, and stopped there; with a key stored it would
have asked). Green on the new order, with the rest of the suite: 10 of 10.

## 5. `test/unit/helpers/shellBash.mjs`

The helper imported `resolveExecutable` from `src/core/executables`, which does not export
it (it is in `execGuard.ts`, and takes a `scope` the helper did not pass), so its Git-Bash
fallback, reached only when `Program Files\Git\bin\bash.exe` is missing, threw
`resolveExecutable is not a function`. It now imports it from `execGuard` with the explicit
no-workspace scope, and tries every `git` on PATH: the `sh.exe` sits under `Git\usr\bin`,
beside `cmd\git.exe` but not beside `mingw64\bin\git.exe`, which a Git Bash PATH lists
first. `test/unit/shellBash.test.mjs` points `ProgramFiles` at an empty folder so the
fallback runs, and starts the shell it names (Git's `sh.exe` under `usr\bin`, which prints
`muse` for `echo muse`); its first case checks the ordinary route runs a script too.

Red on the helper as it was: `TypeError: resolveExecutable is not a function` at
`helpers/shellBash.mjs:15`, exit 1. Green on the repair: 2 of 2.

## 6. Drills

"Drill" is the red/green drill: the fixed code broken on purpose, the non-zero exit seen,
restored, green again. Each ran with `--maxWorkers=2` on the one file.

| #   | Broken on purpose                                                                                                              | Suite                           | Red (exit 1)                                                                                                      | Restored                                                                                                      |
| --- | ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------- | ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| 1   | `MuseSparkJobHost` `signal` prints the word unquoted (`gone`, not `"gone"`)                                                    | `jobHostNative.test.ts`         | `expected 'gone' to be '"gone"'`; the tree reader's JSON parse would have thrown the same word                    | 3 of 3                                                                                                        |
| 2   | the native hook line passed one argument at a time (`isVerbatim: false` in `runHook`)                                          | `hookLaunchWindows.test.ts`     | 2 of 4 red on the governed route: exit code 1 for 3, and no timeout (the quoted line is not the hook's)           | 4 of 4                                                                                                        |
| 3   | the PowerShell hook line without its exit trailer                                                                              | `hookLaunchWindows.test.ts`     | 1 of 4 red on the ungoverned route: `exitCode` 1 for 3 (the old behaviour, first seen before the trailer existed) | 4 of 4                                                                                                        |
| 4   | `lspTab.ts` as it was (key, question, then the secret)                                                                         | `runtimeLsp.test.ts`            | the secret case: `Tab quiet (no-key)` where `secret-at-cursor` was expected                                       | 10 of 10                                                                                                      |
| 5   | `helpers/shellBash.mjs` as it was                                                                                              | `shellBash.test.mjs`            | `TypeError: resolveExecutable is not a function`                                                                  | 2 of 2                                                                                                        |
| 6   | the whole launch change: the eight product files put back to `HEAD` (the old launch), rebuilt, under the CC-WINFAIL contention | `runtimeLsp.test.ts` hook cases | both red, vitest exit 1: `the hook never ran` after the case's 120 s loop (121.8 s and 147.4 s)                   | 2 passed under the same contention (207 s with the build); the files put back byte for byte (SHA-256 checked) |

A first port of the actuator's calls left two PowerShell body strings in a test that
called `callWindowsJobHelper` directly: `actuatorsWindowsNative.test.ts` failed both of its
cases (`Command failed ... [MuseSparkJob]::ReadResourceRate(...)`) until the test used the
typed commands; no other suite called it.

## 7. Use through the packed product

`npm run package:acp -- --target win32-x64` (the production build, `exec-schema --check`,
the package) was run twice, the second time on the final code of the commits: exit 0 both
times (78.7 s, then 138.6 s on a busier PC), `dist/muse-spark-code-acp-0.19.0-win32-x64.tgz`
(3,857,998 and 3,857,790 bytes). The final package was unpacked with `tar -xzf` into
`temp/packed/` (name `muse-spark-code-acp`, version 0.19.0; `node dist/acp.js --version`
printed `0.19.0`) and its `dist/acp.js lsp` was driven by the same client as in section 3,
with no stored key and no credential read (the hook gives no permission; the secret case
ends before the key).

- **A workspace with a Tab hook, alone (8 requests), the PC 10 to 46 % busy with other
  lanes:** the hook ran in every one. Hook launch 362 to 513 ms (median 398 ms), **0**
  PowerShell starts in a hook launch, 7 native starts; **1** PowerShell start in the whole
  process (the job helper's self-test, once); request 0.87 to 1.18 s (the first, cold,
  1.6 s). The log said `beforeTabFileRead: denied` eight times, as the hook gives no
  permission. The base build measured back to back at that load (25 to 35 % busy): hook
  launch 1.08 to 1.40 s, **11** PowerShell starts in each launch but one (8), request 1.95
  to 4.2 s: the hook ran each time, with no margin under the 1.5 s bound.
- **The first package of the same change, on a quiet PC (8 requests):** hook launch 237 to
  308 ms (median 252 ms), 0 PowerShell starts, request 0.57 to 0.65 s (cold 1.03 s); and under
  two CPUs and six busy loops (8 requests) 3.6 to 9.2 s each, the hook ran in 2 of the 8
  windows, 0 PowerShell starts in any hook launch. The loops were stopped by PID; none was left.
- **A secret under the cursor (`const password = "hunter22";`, the cursor inside it):** the
  answer was `{"items":[]}`, the client was asked **0** questions, the log said
  `Tab quiet (secret-at-cursor)`, the process exited 0 (both packages).

No model request was made and nothing was sent to a provider: the Tab requests all ended
before the key (a secret, or a hook without permission).

## 8. Gates

Every command ran from PowerShell 7 with `TMP`/`TEMP` in `temp/tmp` and
`GIT_CEILING_DIRECTORIES` at `temp`. The PC was 100 % busy with other lanes' work during
the later runs (the slower times below are that).

| Gate                                                                                                                                                                                                                                                       | Exit  | Result                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `prettier --check` on the 20 touched files                                                                                                                                                                                                                 | 0     | all use Prettier code style                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `eslint --max-warnings 0` on the 16 touched code files                                                                                                                                                                                                     | 0     | the first run found 11 problems in the first form (unicorn rules on the hook line and the new tests); fixed, not disabled                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `npm run typecheck`                                                                                                                                                                                                                                        | 0     | host, webview, unit, e2e, integration, faults; 280 s                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `node scripts/check-l10n.mjs`                                                                                                                                                                                                                              | 0     | no text a person reads was added                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `npm run check:host-api`                                                                                                                                                                                                                                   | 0     | no `vscode` import added                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `npm run check:plan`                                                                                                                                                                                                                                       | 0     | the first run refused my M94 status line (`status-form`): the date, the bracket and `building.` have to be on one line; they are                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `npm run check:catches`                                                                                                                                                                                                                                    | 0     | three catch sites in `trees/windows.ts` (one SWALLOW, two GENERIC) have a new identity because their `try` bodies changed (a PowerShell script string became a typed command); same classes and counts, `scripts/catch-baseline.json` regenerated with `--write-baseline` and the three-line diff reviewed                                                                                                                                                                                                                                                                                                                              |
| `npm run check:roadmap`                                                                                                                                                                                                                                    | 0     | current                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `npm run duplication`                                                                                                                                                                                                                                      | 0     | 0 clones; the first run found the helper-build setup copied into three tests, now `test/unit/helpers/shellJobBuild.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `npm run deadcode`                                                                                                                                                                                                                                         | 0     | knip                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `npm run build`                                                                                                                                                                                                                                            | 0     | tokens, production build, bundle size and split, lazy registry, host globals, notices, legal records; 314 s                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `npm run check:reference`                                                                                                                                                                                                                                  | 0     | current                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `npm run package:acp -- --target win32-x64`                                                                                                                                                                                                                | 0     | 78.7 s; `muse-spark-code-acp-0.19.0-win32-x64.tgz`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `npx vitest related` over the five changed sources with a narrow reach (`shellJob`, `toolIo`, `resourceJobHolder`, `actuators/windows`, `lspTab`), `--maxWorkers=4`, `test/unit/vault/**`, `devicePairKeyDpapi` and the credential suites excluded by name | **1** | 60 files: 56 passed, 2 skipped, **2 failed**; 694 tests: 652 passed, 40 skipped, 2 failed: `createdRegistrySpaces` (`Test timed out in 15000ms`) and `playbookWindow` (the 60 ms silence timer of a stand-in worker). Both ran while the PC was at 100 % CPU for other lanes; both pass alone (2 files, 31 tests, exit 0), `createdRegistrySpaces` in 9.5 s on this code and 10.5 s on the base, so it sits near its 15 s deadline here on either; neither case starts a hook or reads the registry through the changed code (its fixture launches PowerShell itself). Not re-run into green: read, measured on both builds, left alone |
| `vitest run` of the six suites around the changed modules the narrow `related` does not reach (`governorWindowsBundle`, `resourceTreeFailures`, `executables`, `tabHooks`, `windowsTrustedPath`, `shellBash`)                                              | 0     | 6 files, 32 passed, 2 skipped                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `vitest run` of the touched suites: `runtimeLsp` (all 10), `hookLaunchWindows` (4), `jobHostNative` (3), `windowsTreeReader` (2), `actuatorsWindowsNative` (2), `shellBash` (2)                                                                            | 0     | 6 files, 23 passed (one `vitest run`, `--maxWorkers=4`, the production build rebuilt by its setup; 127 s)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |

`related` over `execGuard.ts` (a new export only), `resourceGovernorEntry.ts` and
`trees/windows.ts` is not run as such: their reverse import closure reaches 686, 646 and
647 of the test files (and the vault suites), close to the whole suite, which the brief
forbids on this PC. The suites that exercise them for real are in the lists above
(`windowsTreeReader`, `actuatorsWindowsNative`, `createdRegistryRace`, `resourceCreatedSweep`,
`resourceHandoffDeadline`, `governedCheckoutGit` and the rest of the narrow set, all green
alone).

## 9. Open questions

Decided here by PLAN.md's decisions (nothing was asked of the owner), named so the lead
can overrule:

1. **A Windows hook that exits 2 now blocks its event.** The launch change makes the
   hook's own exit code reach the dispatcher on Windows, as on every other system; a
   PowerShell `-Command` used to turn every non-zero code into 1. Recommendation: keep
   (it is the documented behaviour). The alternative, normalising the native route to
   0 or 1, would keep a defect to match a defect.
2. **The 1.5 s bound is met on a busy PC, not on a starved one.** With the PC about 10 %
   busy a launch takes 0.27 s; under two CPUs and six busy loops it still often misses
   (the registry's `publish`, `create`, `publish` before a hook are three process starts
   in order, by design: "durable intent precedes mkdir"). Options: (a) leave it,
   recommended: a miss fails closed and the next request tries again; (b) a root
   created ahead of the request, so the three writes leave the critical path (a pool of
   one temp root per kind, an owner id minted before it exists; a change to the
   governor's cleanup guarantees, its own lane); (c) raise the bound: rejected, the
   brief forbids it.
3. **Still on Windows PowerShell, off the hook path:** the team workers' file commands
   (`workerOps.ts`), the playbook's contained job (`containedJob.ts`), the legacy
   `taskkill` fallback (`processTree.ts`) and the shell tool itself. Each loads the same
   helper (now an `.exe`, which `LoadFrom` loads as before). Porting the workers' commands to
   `windowsJobHost` is the same change again; recommended as its own lane.
4. **Old `MuseSparkJob-<digest>.dll` files** an earlier version left in the storage folder
   are not removed (60 KB each, one per helper version); the new build is an `.exe`. A
   sweep is a few lines in `shellJob.ts`; not added, nothing reads them.
5. **No per-call seal of the helper's bytes.** The job type was loaded by path from the
   same folder before; the native calls run that path. The launcher (`MuseSparkMcpJob`)
   keeps its per-launch `verify()`, which the native hook route calls before every hook.
