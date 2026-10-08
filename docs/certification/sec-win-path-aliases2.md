# SECWINPATH2 — Windows identity and ordinary-workspace repair

2026-10-08, Windows 11 Pro 10.0.26200 host (NTFS `C:` with 8.3 names on, Node
24.20.0), branch `fix/win-path-aliases2` from `cb27043ae` (base main
`67099ce1b`). Inputs: the native second review (`RVSECWIN-native.report.md`),
the Grok review (`RVSECWIN.report.md`) and the lead's decisions. Taken over from
a stopped Codex lane; its uncommitted work was applied with `git apply --3way`,
reviewed, and partly rewritten (identity walk, protected-path resolution,
device list, tests). Model attempts: **0**. No paid or live calls, elevation,
share creation, ACL or permission changes, merges or push.

## Decisions, fixes and regressions

| Finding / decision                                               | Fix                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | Regression                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P2-3 / D1: Muse Code's `\\?\X:\` made every write "protected"    | `src/core/windowsPathSpelling.ts:27` `normalWindowsPath` strips only `\\?\` + drive + `\`; `:44-60` apply every segment rule after it; `\\.\`, `\??\`, `\\?\UNC\`, `\\?\GLOBALROOT`, `\\?\Volume{}` and `\\?\X:/` keep the prefix and stay refused; `src/core/protectedPaths.ts:57-79`                                                                                                                                                                                                                                                            | `museCodeProtectedWrites.test.ts`: controls restored to `CAPTURED_WORKSPACE` (`\\?\…\notes.txt`, look-alikes, update); every protected case has an ordinary twin with the same prefix (`ORDINARY_TWINS`), plus DOS mixed-case and `\\?\D:\`, `\\?\Z:\` cases; `secWinIdentity2.test.ts` "accepts the CLI's own `\\?\C:\`/`D:\`/`Z:\`"                                                                                                                                                                                                          |
| P2-1 / D2: 8.3 short names and drive-relative names              | `protectedPaths.ts:74-78` judges `resolvedLongPath` (`src/core/pathIdentity.ts:22-40`: `realpath.native` of the nearest existing ancestor plus missing leaves); an unresolved `~\d` segment, or a relative one, is protected; `windowsPathSpelling.ts:50` refuses `X:name`                                                                                                                                                                                                                                                                        | `secWinIdentity2.test.ts` "protects real 8.3 names … on every letter" (real `dir /x` names of `.claude`, `.git`, `.github\workflows` and an ordinary twin, DOS and `\\?\`, on `C:` and two `subst` letters, missing leaves, unresolved `NOSUCH~1`, the real mapper); "refuses drive-relative C:/D:/Z:"                                                                                                                                                                                                                                         |
| P2-2 / D3: UNC, WSL and other-volume workspaces held and refused | `pathIdentity.ts:73-155`: inside iff an existing ancestor has the folder's identity; a target on another device is outside; a same-device walk must reach the volume's own root (`:148`) or a share root that is one of the folder's resolved ancestors (`:49-57`), compared with `isSameVolume` (`fs/fileIdentity.ts:38`), else unknown; a root without a file index is skipped only as the top; a missing folder is its nearest existing ancestor plus its suffix. `checkpointStore.ts:1981-1984` leaves UNC admission to workspace confinement | `secWinIdentity2.test.ts` "treats a share or WSL workspace by identity" (`\\localhost\C$` and `\\localhost\Users` workspaces with and without the held folder: not held, `resolveWorkspacePath` ok, guarded write forwarded; real storage through `\\localhost\C$` refused; held PR through the share held); "treats WSL (device 0) and another volume as outside"; "judges a missing held folder …"; `secWinPathAliases.test.ts` SMB `dev` (outside) and `ino` (unknown, held) injections; both directions for share workspaces (`fc5e51a90`) |
| P3-1 / D4: device-like names with real extensions                | `windowsPathSpelling.ts:6-14`: only the bare name, or the name plus dots/spaces, for CON, PRN, AUX, NUL, CONIN$, CONOUT$, COM1-9, LPT1-9 and superscripts; `src/core/git/heldTree.ts:104` keeps the conservative list for pull-request trees                                                                                                                                                                                                                                                                                                      | "refuses only real device names"; "writes inside a device-like folder … made by Win32" (`cmd mkdir <scratch>\con.d\ws`, `cmd type` reads the file, guarded write forwarded, `\\?\…\notes.txt` ordinary, `.git\config` protected); `modelApiTools.test.ts` admits `src\con.txt`, refuses `src\con`, `src\con. `                                                                                                                                                                                                                                 |
| P3 (Grok) / D5: refused spellings reported as storage            | `checkpointStore.ts:1978-1993` returns a kind (`spelling`, `storage`, `uncertain`); `checkpointHost.ts:45-57` `storageRefusal` words it: `UI_TEXT.windowsPathRefused`, `MODEL_TEXT.checkpointStorageWrite` (kept), `UI_TEXT.checkpointStorageUncertain`; `checkpointHost.ts:255-262` (no store: spelling only)                                                                                                                                                                                                                                    | "names a refused spelling with its own sentence …" (store and no-store ports, storage, unknown); `secWinPathAliases.test.ts` adapters now expect the spelling sentence                                                                                                                                                                                                                                                                                                                                                                         |
| P3-4 / D6: admin-share tests never skip                          | `test/unit/helpers/secWinShare.ts` probes `\\<host>\X$` and prints `SECWINPATH2: … unavailable (<code>); skipping`                                                                                                                                                                                                                                                                                                                                                                                                                                | `secWinNativeIdentity.test.ts`, `secWinPathAliases.test.ts` (3 cases), `secWinIdentity2.test.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| D7: any drive letter                                             | rules above are letter-generic; `src/core/browser/browserLaunch.ts:182-187` and `src/runtime/tokenFile.ts:71-75` use `SystemRoot`, then `windir`, else `UI_TEXT.windowsSystemRootMissing`                                                                                                                                                                                                                                                                                                                                                         | `browserLaunch.test.ts` "finds Windows on any drive" (`E:\Win`, refusals for none, relative, `SystemDrive` only); `secWinIdentity2.test.ts` tables over `C:`, `D:`, `Z:` and "keeps storage on a non-C: letter refused through both spellings" (two real `subst` letters)                                                                                                                                                                                                                                                                      |
| D8: relocated profile folders                                    | `pathIdentity.ts:118-126` resolves the nearest existing ancestor once, so links above a root are ordinary; `protectedPaths.ts` resolves links to protected folders                                                                                                                                                                                                                                                                                                                                                                                | "judges relocated profile folders by identity through junctions and links": `profile\Documents` junction to the `subst` spelling of another folder, workspace by link, real path and `subst` letter; `profile\AppData` junction with storage below; a `gitlink` junction to `.git`                                                                                                                                                                                                                                                             |
| P3-3: vacuous Windows passes                                     | twins above                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | twins fail if the prefix alone decides                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |

Other `C:` hits in `src` (sweep of `C:\`, `C:/`, `'C:'`, `\Windows`, `Program
Files`, `ProgramData`, `\Users\`): the two fallbacks above (fixed);
`src/shared/l10n/en.ts` `sandboxProfileNotice` "outside C:\Users" (now
`%USERPROFILE%`, all 14 tables); comments only in `flightRecorder.ts:42`,
`sandbox.ts:133`, `sessionTransfer.ts`, `memoryLocation.ts`, `shellQuote.ts`,
`workspacePath.ts:61`, `worktreeCommands.ts:276`, `editReview.ts:134`,
`constants.ts:4919` (examples, no logic). `isProfileWorkspace`
(`sandbox.ts:141`) compares with the real `USERPROFILE`, not a letter; it is
textual by design (it predicts the CLI's own sandbox behaviour) and stays.

## Native spellings (this host)

Measured with Node `statSync({ bigint: true })` and `realpath.native`, `cmd`
for Win32 creation, in `%TEMP%\l-SECWINPATH2` (removed afterwards).

| Spelling                                                                                                              | Native identity / result                                      | Guard verdict now                                           |
| --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- | ----------------------------------------------------------- |
| `\\?\<ws>\notes.txt` (CLI)                                                                                            | same file as `<ws>\notes.txt`                                 | ordinary: Edit automatically, Auto reviewer, "Always allow" |
| `\\?\<ws>\.claude\settings.json`                                                                                      | protected file                                                | protected (name), twin `\claude\` ordinary                  |
| `<ws>\CLAUDE~1\settings.json`, `GIT~1\config`, `GITHUB~1\WORKFL~1\ci.yml`                                             | `realpath` = long names                                       | protected (resolved); `ORDINA~1\notes.txt` ordinary         |
| `<ws>\CLAUDE~1\new.json` (missing leaf)                                                                               | ancestor resolves to `.claude`                                | protected                                                   |
| `<ws>\NOSUCH~1\x.txt`, relative `CLAUDE~1\…`                                                                          | unresolvable                                                  | protected                                                   |
| `M:\ws\…`, `Z:\ws\…` (`subst`)                                                                                        | `realpath` = `C:\…`                                           | judged as the `C:` file                                     |
| `C:.claude\settings.json`, `D:AGENTS.md`, `Z:`                                                                        | drive-relative                                                | refused (own sentence), protected                           |
| `\\localhost\C$\<ws>`                                                                                                 | same `dev:ino`; `realpath` keeps UNC; share root = `C:\` ino  | workspace not held, writes allowed                          |
| `\\localhost\Users\…\ws`                                                                                              | same `dev:ino`; share root = `C:\Users` ino (above storage)   | not held, writes allowed                                    |
| `\\localhost\C$\…\storage\…\journal.jsonl`                                                                            | storage identity                                              | refused as storage                                          |
| `\\localhost\M$` (`subst` letter)                                                                                     | `UNKNOWN`                                                     | no admin share for `subst` letters                          |
| `\\wsl.localhost\archlinux\tmp`                                                                                       | `dev 0`, root `0:2`                                           | outside storage, not held, admitted                         |
| `E:\` (NTFS), `Y:\` (APFS driver)                                                                                     | other volume serials                                          | outside storage                                             |
| `D:\` (exFAT)                                                                                                         | `2564099042:0`; missing names return `EIO`                    | not used (cannot prove "missing")                           |
| `S:` (mapped `\\WIN-11-VM\Shared`)                                                                                    | `UNKNOWN`                                                     | not used                                                    |
| `con.d`, `aux.js`, `nul.txt`, `COM1.txt`, `LPT1.log`, `aux .md`, `NUL .txt`, `COM0`, `LPT0` (Win32 `mkdir`, relative) | created and written as ordinary folders                       | ordinary (pull-request trees still refuse them)             |
| `COM1`, `CONIN$`, `con..` (Win32 `mkdir`, relative)                                                                   | refused by Win32                                              | refused                                                     |
| `C:\…\CON`, `C:\…\COM1`, `C:\…\aux` (Win32 `mkdir`, full path)                                                        | created as ordinary folders on this build; `C:\…\NUL` is not  | refused (conservative across builds)                        |
| directory symbolic link (`mklink /D`, `symlink(…, 'dir')`)                                                            | `EPERM`: no privilege here (Developer Mode off, not elevated) | junction cases cover links                                  |

Hosted Windows CI: `build.yml` runs every unit file on `windows-latest` in
full (non-fast) runs. The admin-share, `subst` and WSL probes have not run
there yet (the branch is not pushed); its log will show either the assertions
or the printed `SECWINPATH2: … skipping` line.

## Base replay

The new and changed regression files (`secWinIdentity2`, restored
`museCodeProtectedWrites`, `modelApiTools`, `browserLaunch`) copied onto an
owned detached worktree at `cb27043ae` (dependencies junctioned, removed with
`rmdir`): **36 failed, 88 passed** (exit 1) and **1 failed, 9 passed** (exit
1). The passes are POSIX/ordinary controls and the coverage cases that already
held there (missing held folder, storage on a `subst` letter, the stream twin).

## Red drills

`drill.cjs` (scratch) replaced one site, ran the named files at repository
deadlines with `--maxWorkers=3`, then restored the bytes and compared SHA-256.

| Drill (decision)                  | Files                               | Result                                        | Restored |
| --------------------------------- | ----------------------------------- | --------------------------------------------- | -------- |
| D1 keep the `\\?\` prefix         | museCodeProtectedWrites             | 22 failed, 9 passed                           | yes      |
| D2a no long-name resolution       | secWinIdentity2                     | 2 failed, 14 passed                           | yes      |
| D2b admit drive-relative          | secWinIdentity2                     | 4 failed, 12 passed                           | yes      |
| D3a other volume "unknown"        | secWinIdentity2 + secWinPathAliases | 2 failed, 38 passed                           | yes      |
| D3b trust an incomplete walk      | secWinPathAliases                   | 1 failed, 23 passed (rerun after `89c789c18`) | yes      |
| D3c volume root not complete      | secWinIdentity2                     | 1 failed, 15 passed                           | yes      |
| D4 conservative device list       | secWinIdentity2 + modelApiTools     | 3 failed, 90 passed                           | yes      |
| D5 storage sentence for spellings | secWinIdentity2 + secWinPathAliases | 4 failed, 36 passed                           | yes      |
| D6 admin share unavailable        | secWinNativeIdentity                | 1 passed, 1 skipped, exit 0, reason printed   | yes      |
| D7 guessed `C:\Windows`           | browserLaunch                       | 1 failed, 9 passed                            | yes      |
| D8 links above roots unresolved   | secWinIdentity2 + secWinPathAliases | 1 failed, 39 passed                           | yes      |

D3b first passed under the mutation on `fc5e51a90`: the SMB `ino + 1`
injection landed on the storage folder's own (adjacent) NTFS file ID. The
test now flips a high bit and asserts the relation; the drill then fires.
The first D4 attempt corrupted the file (a `$` replacement pattern) and was
rerun with a literal replacement.

## Verification

Owning suites, repository deadlines, at most three files and `--maxWorkers=3`:

| Where                       | Files                                                       | Result                                                                                                                                                     |
| --------------------------- | ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| host                        | secWinIdentity2, secWinPathAliases, museCodeProtectedWrites | 71 passed                                                                                                                                                  |
| host                        | secWinPathAliases, secWinNativeIdentity, secWinWorkerPaths  | 34 passed                                                                                                                                                  |
| host                        | museCodeProtectedWrites, secWinPathAliases, modelApiTools   | 132 passed (after the device-list test update)                                                                                                             |
| host                        | browserLaunch, heldTree, checkpointHost                     | 109 passed                                                                                                                                                 |
| host                        | secWinIdentity2, secWinPathAliases, worktreeConversations   | 56 passed                                                                                                                                                  |
| host, after the lint commit | secWinIdentity2, secWinPathAliases, checkpointHost          | 84 passed                                                                                                                                                  |
| Win11 VM                    | checkpointStoreWindows + checkpointStoreGuards, five rounds | 48 passed, 3 skipped, each (rounds 1-2 on `d3abe7d26`, 3-5 on `89c789c18`; 284-338 s)                                                                      |
| Win11 VM                    | checkpointFiles, checkpointLocation, toolIo                 | 64 passed, 5 skipped                                                                                                                                       |
| Win11 VM                    | conversationController, modelApiHost, deferredBundles       | 1413 passed, 1 failed: modelApiHost "sends no reviewer while host close awaits SessionEnd after a held consent" (a shell-call reviewer race, no path code) |
| Win11 VM                    | modelApiHost alone                                          | 669 passed                                                                                                                                                 |

The 8 real-git cases the native reviewer could not rerun (7 in
`checkpointStoreWindows`, 1 in `checkpointStoreGuards`) pass in every round.

Fresh clone (`git clone` of the branch, `npm ci` exit 0, `CI=true`) at
`fc5e51a90`: typecheck host 0, webview 0, unit 0, e2e 0, integration 0;
`check:l10n` 0 (14 UI tables, 0 problems); `check:host-api` 0;
`check:reference` 0. It failed, and the next commit fixes: prettier
(`browserLaunch.test.ts`), eslint (27 errors, 5 warnings: identity
comparisons outside `fileIdentity.ts`, `String.raw` style, early returns,
`console.info`), knip (unlisted binaries `subst`, `wsl.exe`: now run through
`cmd.exe`), jscpd (one 7-line clone of a mock between the two path suites)
and the build's bundle split (`MODEL_TEXT.checkpointStorageWrite` no longer
read by the activation bundle: the store now returns a refusal kind and
`checkpointHost` words it). The re-run results are recorded below.

Hooks: this worktree had no `.husky/_`, so `d3abe7d26`, `fc5e51a90` and
`89c789c18` were committed without running the hooks. The repository's own
`npm run prepare` (husky) installed them; `gitleaks git` over the three
commits found no leaks; later commits ran the hooks.

Final head `3775c0661` (the lint commit ran the installed hooks: eslint
`--fix`, prettier, gitleaks; no further changes):

| Gate (fresh clone, `CI=true`)                                      | Exit                                                                                                                                                                        |
| ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| typecheck host, webview, unit, e2e, integration                    | 0, 0, 0, 0, 0                                                                                                                                                               |
| prettier `--check`, every file changed since `cb27043ae`           | 0                                                                                                                                                                           |
| eslint `--max-warnings=0`, every TS file changed since `cb27043ae` | 0                                                                                                                                                                           |
| knip (plain)                                                       | 0                                                                                                                                                                           |
| jscpd                                                              | 0 (0 clones)                                                                                                                                                                |
| `check:l10n`, `check:host-api`, `check:reference`                  | 0, 0, 0                                                                                                                                                                     |
| `npm run build`                                                    | 0: extension 511.2/600 KiB, conversation 240.6/250, sharingRuntime 173.5/175, hookRuntime 48.8/50, modelApi 489.8/525, modelApiBoundaries 28.1/50, checkpointStore 89.9/225 |

| Win11 VM, final head                                     | Result                                                                                                                                                       |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| checkpointStoreWindows + checkpointStoreGuards (round 6) | 48 passed, 3 skipped                                                                                                                                         |
| checkpointFiles, checkpointLocation, toolIo              | 64 passed, 5 skipped                                                                                                                                         |
| conversationController, deferredBundles                  | 745 passed                                                                                                                                                   |
| modelApiHost                                             | 669 passed                                                                                                                                                   |
| secWinIdentity2, secWinPathAliases, checkpointHost       | 83 passed, 1 skipped: "no other volume or WSL distribution is reachable" (printed); admin shares and `subst` ran; directory symbolic links `EPERM` there too |

Host, final head: secWinIdentity2, checkpointHost, museCodeProtectedWrites
91 passed.
