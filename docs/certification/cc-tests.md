# cc-tests: the unit suite on Windows after the int/recovery merges

Branch `cc/tests`, from int/recovery `d81327d360`. Windows 11 Pro 26200,
Node 24.20.0, Git for Windows 2 (GNU tar 1.35 and gpg first on the Git Bash
PATH), 20 cores. Every run: `TMP`/`TEMP` in the worktree's `temp/tmp`,
`GIT_CEILING_DIRECTORIES` at its `temp/`, and the vault, `keyringParts`,
`keystoreOwner` and `credentialLease` suites excluded (they reach the owner's
real Credential Manager).

A full unit run on this PC after four merge rounds failed 159 tests in 43
files. 125 of them fail the same way on the lane branches that brought them
(RLM110A0, RLM125, RLF-M110OS, RLM110B, RLF-M100K), which ran on Linux or
macOS. Each fix below names the cause, the change, and the red/green
evidence. No test was skipped, weakened or deleted to pass. A test is skipped
on Windows only where the product never runs that code on Windows, the skip
says why, and a test proves the Windows refusal in words.

## Fixes

### acpServeHandshake: the editor is told why a session cannot open

Cause: the earlier fix (RLINTFIX item 4, `5550115416`) was written on a branch
without RLACP's outbound error boundary. RLACP merged first (`82291c2a07`) and
its allow-list (`outboundSentences`, `src/acp/agent.ts`) passes only listed
sentences. The readiness check's refusals were not listed, so on every OS a
signed-out session list reached the editor as "That did not work (the Muse
Spark log has the details)" and the CLI-missing refusal did too. On this PC
the scrubbed PATH does hide the CLI (its default folder is read from
`LOCALAPPDATA`, which the test does not pass), so nothing in the failure was
Windows-specific.

Fix: the readiness check's fixed sentences (signed out, no stored key, store
down, the ChatGPT and Copilot plan refusals, the Muse Code subscription
refusals) join the allow-list, and the CLI refusal keeps exactly its fixed
sentence (`cliNotFound`, `cliPathNotAbsolute`), dropping the searched folders
(no path leaves, R1).

Red (before): both cases failed with
`expected 'That did not work (the Muse Spark log…' to match /Authentication required/`
and `… to match /Muse Code is not installed/`.
Green: 2 passed. Real use, the agent bundled from source and spoken to over
stdio with an empty config and data folder:

```
{"code":-32000,"message":"Authentication required: Muse Code is not signed in; sign in and try again.","data":{"kind":"authRequired"}}
{"code":-32600,"message":"Invalid request: Muse Code is not installed in any known location.","data":{"kind":"invalid_request"}}
```

### estimatorPricePackaging: the packaging walk skips webview resources

Cause: RLM117's walk follows every string an emitted call can be handed and
maps it to a Node bundle by basename. RLM125 added `dist/judgeSetup.js` (the
agent-only `judge setup` command, not in the VSIX), and the judge setup
wizard's page is `dist/webview/judgeSetup.js`, handed to the webview by
`asWebviewUri(joinPath(dir, "judgeSetup.js"))`. The walk read that name as
the Node bundle and reported it missing from the VSIX.

Fix: nothing under an `asWebviewUri(…)` call is followed (the browser loads
it from the webview bundle root; Node never requires it). The suite also
copies the run's shared production build (global setup) instead of building
its own inside the 60 s hook, which on this PC ran past the deadline with
other work running (`Hook timed out in 60000ms`).

Red drill: `isWebviewResource` forced to `false` →
`expected [ 'dist/judgeSetup.js' ] to deeply equal []`; restored → 1 passed.

### teamModelsFirstPaint: the Grok sign-in's English leaves the shared surface chunk

Cause: RLGROKAUTH (`0ee7808ef9`) made the models page's provider sections read
`UI_TEXT.acpGrok` (4,394 bytes of JSON). The browser English plugin put it in
the shared surface chunk, which grew to 25,840 B against its 25,600 B budget
(the same 25 KiB as `npm run build`'s surface English cap).

Fix: the Grok sign-in's English rides the deferred plan sign-in chunk with
ChatGPT's (`scripts/lib/uiTextRegions.mjs`); its one reader,
`ProvidersSection.tsx`, already installs that chunk before its body runs.
Budget unchanged.

Red (before): `expected 25840 to be less than or equal to 25600`.
Green: 9 passed; the browser English build measures the surface chunk at
24,240 B and the plan sign-in chunk at 2,559 B (it holds `acpGrok`).

### nodeBrowserWorkspace: the narrow picture goes to temp/

Cause: the 320 px case wrote its full-page picture over the committed record
picture `docs/certification/m110-u1-shots/editor-dark-320.png` on every run.

Fix: it writes `temp/m110-u1-shots/editor-dark-320.png` (gitignored); the
M110-U1 record says so. No comparison is made of either picture.

### nodeBrowserWorkspace: redo on Windows is Ctrl+Y

Cause: the first case redoes with `ControlOrMeta+Shift+Z`. CodeMirror's
history keymap binds redo as `Mod-y` (`Mod-Shift-z` on macOS) plus
`Ctrl-Shift-z` on Linux only (`@codemirror/commands`), so on Windows the key
did nothing: the undo left the original text, Save stayed disabled, and the
case ran into the 15 s test deadline.

Fix: the case presses Ctrl+Y on Windows and keeps `ControlOrMeta+Shift+Z`
elsewhere (Chrome runs on the test's own machine).

Red (before): the step log showed `after undo export const greeting = "hello"`,
`after redo export const greeting = "hello"`, then
`locator resolved to <button disabled type="button">Save file</button>` until
`Test timed out in 15000ms`. Green: 5 passed.

### nodeDashboardPage, nodeTerminalPage: the store's Windows refusal

Cause: both suites run the node's page methods over the real state store
(`initializedPageStore`), whose private-files layer refuses on Windows by
design (`src/runtime/node/privateFiles.ts`: "A0 runs natively on Linux or
WSL; a DACL adapter is not qualified"), with "This operation is not supported
on this node." The node service never runs on Windows, so the 11 cases failed
on the product's own refusal.

Fix: the cases run through `nodeNativeTest`, the node suites' existing
harness: the real case on Linux and macOS, and on Windows the proof that the
store refuses in those words.

Red (before): 11 failed with `This operation is not supported on this node.`
Green: 11 passed. Red drill: the store's Windows refusal disabled
(`privateFiles.ts`) → 5 of 5 dashboard cases failed,
`expected [Function] to throw error including 'not supported' but got 'process.getuid is not a function'`;
restored.

### nodeFilesPage, nodeOps: links a Windows test account can make

Cause: `symlink()` without the symbolic-link privilege fails on Windows with
`EPERM: operation not permitted, symlink …`. This PC's test account holds no
such privilege (no Developer Mode, not elevated); hosted Windows runners are
elevated, which hid it. Four cases made links: three in the node files runtime
(H10), one in the node backup.

Fix:

- A directory link is a junction on Windows (no privilege; Node's `lstat`
  reads it as a symbolic link, as the repository's other link tests already
  use). The files runtime's root-alias case and the backup case now run for
  real on Windows; the backup case keeps its file link on Linux and macOS
  and adds the directory link everywhere.
- Two files-runtime cases need a symlinked file leaf, which only the
  privilege can make. The node serves files natively on Linux or WSL only,
  so they run through `nodeNativeTest` (on Windows: the store's refusal in
  words).

Red (before): 4 failed with `EPERM: operation not permitted, symlink`.
Green: nodeFilesPage 30 passed, nodeOps 7 passed. Red drills: the files
runtime's root realpath check deleted → the root-alias case failed
(`promise resolved "{ path: 'example.txt', …(2) }" instead of rejecting`)
with the junction; the backup's link refusal disabled → the backup case
failed (`promise resolved "{ version: 1, entries: [ { …(3) } ] }" instead of rejecting`);
both restored.

### nodeOsBoot, nodeOsRepro, nodeInstallVerify, nodeOsBrowser, nodeImagePackaging: directory links as junctions

Cause: the same `EPERM … symlink` as above, in five suites over Node tooling
that does run on Windows (the OS boot and reproducibility checks, the install
verifier, the Chrome add-on's key check, the node image packager): each made a
directory symlink, and the packager case also a file symlink.

Fix: each directory link is a junction on Windows (`'dir'` elsewhere). The
packager case keeps its file link on Linux and macOS and adds a directory
link inside the runtime everywhere.

Red (before): 5 failed with `EPERM: operation not permitted, symlink`.
Green: nodeOsBoot 7 passed (2 skipped as before: no QEMU), nodeOsRepro 5,
nodeInstallVerify 3, nodeImagePackaging 16; nodeOsBrowser's link case passes
(its two gpg cases are below). Red drill: the packager's link refusal removed
(`scripts/package-node-image.mjs`) → the junction case failed
(`expected [Function] to throw error including 'symlink' but got 'Runtime package contains a special fi…'`);
restored.

### nodeOsBrowser, nodeOsAddons: the add-on key check hands gpg relative names

Cause: `os/addons/chrome/lib/checkKey.mjs` gave gpg absolute paths for its
throwaway home and the keyring. The gpg first on Git for Windows' PATH is the
MSYS build (`C:\Program Files\Git\usr\bin\gpg.exe`), which reads
`C:\Users\…` as a relative path and failed:
`keyring listing failed: gpg: keyblock resource '/c/Users/Randy/Coding/mx-cc-tests/C:\Users\…\pubring.kbx': No such file or directory`.
Gpg4win's native gpg read the same paths correctly, so the result depended
on which gpg the PATH found first.

Fix: the keyring is copied into the throwaway home and gpg runs there with
`--homedir .` and the copy's relative name, which every build reads alike.

Red (before): 3 failed (`expected 2 to be +0`, `expected 2 to be 1`).
Green: 23 passed; the check run by hand with `--gpg` naming each build
answers `the keyring carries all 1 pinned fingerprints` for both.

### nodeWorkspaceDevcontainer: the node's path rules, not the reader's

Cause: `src/runtime/node/workspaces/devcontainer.ts` takes the node's
`platform` for case folding but resolved, normalized and compared paths with
the host's `node:path`, and `mergeDevcontainerConfig` gated mounts with
`process.platform`. Read on Windows, the recorded Linux configurations came
out drive-qualified (`C:\home\randy\lanes\…`), `/ws/data` normalized to
`\ws\data` (so an inside bind was "absolutized"), and `path.win32.relative`
case-folded a Linux root.

Fix: every function uses the path rules of the platform it is given
(`path.win32` for Windows, `path.posix` otherwise); `mergeDevcontainerConfig`
takes the node's platform like the gates do (the live drill passes
`process.platform`). The suite reads the Linux captures with `path.posix`.

Red (before): 4 failed (`expected true to be false`,
`expected { ok: true, …(1) } to deeply equal { ok: true }`,
`expected 'C:\home\randy\lanes\RLM110B.app\home\…' to be '\home\randy\…'`).
Green: 28 passed. Red drill: `pathsOf` forced to the host's `path` → the same
4 failed; restored.

### nodeImageArchive: tar beside its files, Windows' Python by name

Cause: three things, all of the same kind.

1. GNU tar reads `C:\…` as `host:path` on a remote machine
   (`tar (child): Cannot connect to C: resolve failed`). Git for Windows puts
   its GNU tar first on the PATH; the suite and `scripts/check-node-image.mjs`
   handed tar absolute paths.
2. `python3` on Windows is the Microsoft Store alias, which prints "Python was
   not found" and fails; the interpreter is `python` (the OS image suites
   already choose it this way).
3. One case packs a symlink member from a real symlink, which a Windows test
   account cannot create (`EPERM … symlink`).

Fix: the image check lists layer members with tar run beside the archive and
handed its bare name, splits on CRLF too (Windows' own tar ends lines with
it), and picks `python` on Windows. The suite runs tar in its fixture root
with relative paths and picks the same interpreter. On Windows the symlink
member is written by Python's `tarfile` without a filesystem symlink, and a
new assertion checks on every OS that the archive carries the member
(`tar -tvf`: `link -> ../outside/LICENSE`).

Red (before): 57 of 57 failed. Green: 57 passed. Red drill: the image check's
`tar -tf` handed the absolute path again → the CLI case failed
(`tar: Cannot connect to C: resolve failed`); restored.

### judgeB2Baseline: Git for Windows' null device is NUL

Cause: the suite pointed `GIT_CONFIG_GLOBAL` and `GIT_CONFIG_SYSTEM` at
`os.devNull`, which on Windows is the device-namespace spelling of NUL. Git
for Windows 2.52 refuses it: `fatal: unable to access '//./nul': Invalid argument`
on the first `git init`. The product already writes `NUL` there
(`src/host/runners/sshRunner.ts`, `src/core/team/workers/workerEnv.ts`).

Fix: the suite uses `NUL` on Windows and `os.devNull` elsewhere.

Red (before): 6 of 7 failed with the message above. Green: 7 passed.

### judgeB2Snapshot: B2 is off on Windows

Cause: every case builds its workspace with a relative file symlink
(`current -> src/a.ts`), which Windows grants only with the symbolic-link
privilege (`EPERM … symlink`); 5 cases failed in the fixture.

Why a skip is correct here: PLAN.md M125 puts B2 "on Linux only … off on
Windows" (the frozen snapshot feeds `contain/linux.ts`), and no product path
reaches `copyB2Snapshot` or its reader on any platform yet, so there is no
Windows path to refuse. The two suites run where B2 does (`runIf`, with the
reason beside it), as the suite's FIFO case already skipped Windows.

Red (before): 5 failed with `EPERM: operation not permitted, symlink 'src\a.ts'`.
After: 6 skipped on Windows (5 plus the FIFO case), unchanged on Linux and
macOS.

### judgeHardware: Windows has no execute bit; C:\Windows is a real root there

Cause, two cases:

- `findOnPath` judged a file runnable by `access(X_OK)`, which on Windows
  only proves the file exists, so the 0644 "ghost" was found
  (`expected 'C:\Users\…' to be undefined`). Windows starts a file by its
  extension.
- "useless roots" passed `undefined`, which takes `probeGpu`'s default (this
  machine's `SystemRoot`) and so read this PC's real display adapter
  (`{ vendor: 'unknown', model: 'Virtual Display Driver', … }`), and
  `C:\Windows`, which is a real root on Windows.

Fix: the hardware probe counts a file runnable on Windows only when its
extension is a program's (`WINDOWS_PROGRAM_EXTENSIONS`), so an extensionless
`ollama` on a Windows PATH no longer counts. The PATH case names its target
`.cmd` on Windows (the ghost stays extensionless); the roots case uses an
empty root and a missing folder, useless on every machine.

Red (before): 2 failed as above. Green: 18 passed, 2 skipped (Linux-only DRM
and cpuinfo readings, as before). Red drill: the Windows extension check
disabled → the PATH case failed (`expected 'C:\Users\Randy\Coding\mx-cc-tests\tem…' to be undefined`);
restored.

### judgeApprovalFloor: B1 runs on Linux and macOS

Cause: two cases leaned on the host's platform. The `--force` case's
innocent line (`grep -e forceful allowed.txt`) took `b1Floor`'s default
platform, and on Windows the floor refuses every line as `grammar` by design
(the suite's own "refuses Windows at the floor" case), so `pass` was false.
The realpath case resolved B1's fixed POSIX path for `cat`, which does not
exist on Windows.

Fix: the innocent line is judged for Linux, as the suite's other passing
lines are; the realpath case expects the resolved `/cat` where B1 runs and
the audited absence on Windows, where B1 is off.

Red (before): `expected false to be true`, `expected undefined to be true`.
Green: 15 passed.

### nodeImageTools: --import takes a module URL

Cause: the suite preloaded its port module with `node --import <absolute path>`.
On Windows the drive letter reads as a URL scheme:
`ERR_UNSUPPORTED_ESM_URL_SCHEME … On Windows, absolute paths must be valid file:// URLs. Received protocol 'c:'`,
so the installer never ran (its Windows-host refusal included).

Fix: the suite passes `pathToFileURL(file).href`, which every OS reads alike.

Red (before): 2 failed (`expected 'node:internal/modules/esm/load:193…' to contain 'Linux amd64/arm64 tool host required'`).
Green: 4 passed, the installer's refusal of a Windows tool host among them.

### nodeInstall: tar beside its files; the Linux layout runs on Linux

Cause: the suite built its release tarball with `tar -czf C:\… -C C:\…`,
which GNU tar (first on Git for Windows' PATH) reads as `host:path`, so all
7 cases failed in the fixture (`expected 2 to be +0`). With that fixed, the
three layout cases still failed: `deploy/install/layout.sh` runs its own
`tar -tzf "$TARBALL"` (`tarball unreadable: C:\…`), and its subject is the
POSIX modes of a systemd layout, which NTFS does not keep. Its refusal case
passed on Windows only because of that tar error, i.e. for the wrong reason.

Fix: the release tarball is made with tar run in the release folder on
relative names. The layout suite is the native Linux installer's, which
the product never runs on Windows; it is skipped there with that reason.
The verification suite (`install.sh`) runs on Windows and asserts its exact
refusals (`checksum mismatch`, `not listed`, `checksum checker missing`,
`gh not found`).

Red (before): 7 failed. Green on Windows: 3 passed, 5 skipped (the layout
suite).

### osImageBuildUpdateSlots: the ESP is 260M

Cause: not Windows. OS1's fix `88911bdef7` (2026-10-08 20:20) moved the ESP
to 260M in `os/repart/00-esp.conf`, and `os/check.py` locks it there (the
OS1 suite refuses a 256M weakening). OS2's slot-map suite (`bcc68f19b8`,
20:29, another branch) still expected the old 256M: `expected '260M' to be '256M'`.

Fix: the slot-map suite expects 260M for `muse-efi`, with that reason.
Green: 15 passed.

### osImageBuild: two cases need the Linux build host

Cause: the OS image is built with mkosi on a Linux host, never on Windows.
Of the suite's 130 cases, 128 run its pure Python on any OS; two touch the
host:

- the real-gpgv case found Git's MSYS `gpgv`, which reads the `C:\…` keyring
  path as a relative one, so the good signature failed as `OS1 Pi index
signature mismatch` (and the wrong-keyring refusal passed for that reason);
- the link-refusal case calls Python's `os.symlink`, which needs the
  symbolic-link privilege on Windows.

Fix: both are skipped on Windows, each with its reason beside the gate (the
gpgv case keeps its existing gate where gpgv is absent).

Red (before): 2 failed (`expected 1 to be +0`; the captured stderr shows the
mismatch above). After on Windows: 127 passed, 3 skipped (these two and the
apt-cache case, as before).

### judgeB1HoldDrill: on Windows the drill proves the hold does not race

Cause: the drill's `beforeAll` built the B1 confinement helper on every OS.
`scripts/build-confine.mjs` refuses on Windows by design ("B1 is confined on
Linux (Landlock) and macOS (Seatbelt) only"), so the hook failed and all 4
cases were skipped, which counted as a failed file. The cases already handle
a missing session; on Windows the hold refuses at the floor (`grammar`)
before it reads any condition.

Fix: on Windows the hook asserts the helper build's refusal in those words
and opens no session; each case then expects `notApplicable` with `grammar`
there (its own reason elsewhere).

Red (before): the file failed in its hook, 4 skipped. Green: 4 passed.

### evalJudgeWiring: the summary check is written in the host's shell

Cause: the paired run's scripted model asks the shell tool for a repeated
vitest summary written in bash (`printf … {1..300}`). The shell tool runs the
host's shell, which on Windows is Windows PowerShell, where that line prints
no summary; the triage then had nothing to pack and the armed turn saved no
input tokens (`expected 0 to be greater than 0`).

Fix: on Windows the same summary is printed by
`1..300 | ForEach-Object { 'Test Files  1 passed (1)'; 'Tests  3 passed (3)' }`;
bash keeps its line. The triage's pass-summary patterns read either.

Red (before): 1 failed as above. Green: 3 passed.

### extensionHookPlanProvider: the rig's hooks get the Windows variables a host has

Cause: the Model API rig ran hooks with an empty environment on Windows
(`SHELL=/bin/sh` only on POSIX). The product starts a Windows hook as
Windows PowerShell → `& cmd.exe /D /S /C <command>`, and PowerShell starts
cmd.exe by PATHEXT: without it, it hands the file to the shell's file
association, which starts it detached and without the hook's standard input.
The recorder hook therefore wrote nothing (`expected [] to have a length of 3`),
and its detached processes still held the folder when `usingTempDir`
removed it, so `EBUSY: resource busy or locked, rmdir` replaced that
message. Measured by hand: PowerShell → cmd → node with only `SystemRoot`
delivered nothing; with `SystemRoot` and `PATHEXT` it delivered the payload.
The product passes the real environment (`hookEnvironment` keeps COMSPEC,
PATHEXT, SystemRoot, WINDIR), so it is not affected.

Fix: the rig's hook environment on Windows carries `SystemRoot`, `WINDIR`,
`COMSPEC` and `PATHEXT` from the test's own environment (no credential), as
a real host does; POSIX keeps `SHELL=/bin/sh`.

Red (before): `EBUSY … rmdir` (with the folder removal taken out:
`expected [] to have a length of 3 but got +0`). Green: 1 passed; the rig's
other 8 suites, 51 tests, still pass.

### tuiSocket: wait for the pipe server's accept

Cause: the Windows-only named-pipe case connected a client and read the
server's accepted socket as soon as the client's `connect` fired. On a
Windows pipe that event can land before the server's `connection` callback
has run, so the peer was still undefined (`expected undefined to be defined`,
2 of 2 runs before the fix). The suite's own `open` helper already waits for
the accept.

Fix: the case waits for the server's accept (`waitForTui('peer accepted')`)
before it writes.

Green: 3 of 3 runs passed (3 passed, 14 POSIX cases skipped on Windows).

### scheduleFsRetryStop: deny a file that exists

Cause: the stop case read `probe/missing.json` under a folder denied to the
current user (`icacls /deny *<SID>:(OI)(CI)F` on Windows, `chmod 0` on
POSIX). Windows grants every user traverse past a denied folder, so a
missing name under it is looked up and reported missing (ENOENT), which the
schedule store reads as "no file": the read resolved at once
(`promise resolved "undefined" instead of rejecting`) instead of waiting on a
transient denial. On POSIX the same read is EACCES.

Fix: the case publishes `probe/file.json` before the denial and reads it, as
the suite's retry case does; the read is a transient denial on every OS, and
the stop ends it with its reason.

Red (before): 1 failed as above. Green: 2 passed.

### m96dCoordinatorEndpoint: the close settles after the last connection

Cause: the Windows-only F1 case awaited `endpoint.close()` while its own
owner connection was still open. The endpoint's close is Node's
`server.close`, which stops listening at once but calls back only when every
connection has ended, so the await could never settle and the case ran into
the 15 s deadline (`Test timed out in 15000ms`). The case only ever ran on
Windows, which the lane's rig was not.

Fix: the case starts the close, checks that a new open is refused (`EBUSY`)
and that the owner's connection still echoes, ends that connection, and then
awaits the close. The endpoint is unchanged.

Red (before): timed out at 15 s. Green: 6 passed, 2 skipped, twice.

### deviceOwnerBind (e2e): the peer's folder by the platform's separator

Cause: the two-process driver found the peer's confirmation file by cutting
the peer's invitation path at its last `/`. On Windows the path is built with
`\`, so `lastIndexOf('/')` was -1 and the cut dropped one character of the
file name: both sides waited on a path that never appears
(`[error] peer confirmation not found`, then `child exited 1 before LISTENING`
and six unhandled rejections from the other signal waits).

Fix: the driver takes the folder with `path.dirname`.

Red (before): 1 failed, 6 unhandled errors. Green: deviceOwnerBind 1 passed;
deviceTwoProcess (same driver, other scenario) 1 passed.

### faultRig: the rig resolves its own folder as a path

Cause: `scripts/fault-rig.mjs` found the repository with
`path.dirname(new URL(import.meta.url).pathname)`. On Windows that pathname
is `/C:/Users/…`, and `path.resolve` made it `C:\C:\Users\…`, so the first
scenario failed creating its output folder
(`ENOENT: no such file or directory, mkdir 'C:\C:\Users\…\temp\fault-rig'`)
and printed nothing the case could read (`expected '' to contain 's1-stream-cut: PASS'`).
The suite's symlinked-checkout case returned early on Windows.

Fix: the rig resolves from `import.meta.dirname`. The symlinked-checkout case
runs on Windows through a junction instead of returning early.

Red (before): 1 failed as above (and the link case passed vacuously).
Green: 5 passed; by hand, `node scripts/fault-rig.mjs run s1-stream-cut`
prints `s1-stream-cut: PASS` and exits 0.

### devicePairKeyDpapi: the suite seals with the slot helper

Cause: the Windows-only DPAPI case handed `WindowsVaultSlots` the vault's
**pipe** helper (`windowsPipeExecutable`: the broker's relay), not the
**slot** helper that seals keys. The product hands the slots the slot helper,
compiled from `MuseSparkVault.cs` with its Cng, Hello and Lock parts
(`src/runtime/vault/windowsClientPlatform.ts`). The pipe helper answered the
slot request by exiting 1 with no reply frame (measured by running it
directly with a `probe` and a `wrap` request: `exit 1`, no bytes), and the
slot protocol turned that into `No access`. The case only runs on Windows,
which the lane's rig was not.

Fix: the client platform's slot source list is exported
(`WINDOWS_VAULT_SLOT_SOURCES`) and the shared test helper gains
`buildWindowsVaultSlotHelper`, which compiles exactly those sources as the
client platform does; the DPAPI case uses it. The pipe-start suite keeps the
pipe helper (same code, now behind one shared builder). DPAPI is per-user
crypto with no named store entry: nothing of the owner's Credential Manager
is read or written.

Red (before): `Error: No access` from `invokeWindowsVault`. Green: 1 passed.
The pipe-start suite (under `vault/`) is not run on this PC by instruction;
its builder is unchanged apart from the shared setup, and the unit typecheck
covers it.

### companionFontPack: linked version folders stay out; the file-link case needs the privilege

Cause: the escape case plants a file symlink (`fonts.css` → outside), which
Windows grants only with the symbolic-link privilege (`EPERM … symlink`).
Looking for a link Windows grants without it (a junction) showed a gap on
every OS: `findCompanionFontPack` checked each file against its version
folder's real path but never checked that the version folder itself is in
the fonts root, so a version folder linked elsewhere was served from there.

Fix: the version folder's real path must sit directly in the fonts root's
real path (`src/runtime/usage/usageCompanionEntry.ts`). A new case links a
complete pack folder from outside into the root (a junction on Windows, a
directory symlink elsewhere) and expects no pack; it runs on every OS. The
file-link case runs where the account may make a file link (Linux, macOS,
elevated or Developer Mode Windows), probed once by making one, with that
reason in its name.

Red (before): `EPERM: operation not permitted, symlink`. Green on Windows:
6 passed, 1 skipped (the file-link case). Red drill: the new root check
disabled → the linked-folder case failed (`expected { …(2) } to be undefined`);
restored.

### windowsPowerShellModules: the device worker host applies the 5.1 module-path rule

Cause: not Windows-run, but about Windows. RLM100's device worker host
(`src/host/devices/deviceWorkerHost.ts`) starts a worker command that may be
`powershell.exe` (Windows PowerShell 5.1) without `windowsPowerShellEnvironment`,
the rule that gives every 5.1 child its own `PSModulePath` (WINPSMOD: a
PowerShell 7 parent's module path breaks 5.1's core modules). The gate that
enumerates every file naming 5.1 flagged it:
`src/host/devices/deviceWorkerHost.ts: line 423`.

Fix: when the resolved worker executable is `powershell.exe`, the launch and
the recorded environment are the worker environment with the rule applied
(from that environment's `SystemRoot`; a missing or relative one refuses as
`preflight`). `pwsh.exe` (PowerShell 7) is unchanged.

Red (before): the gate failed with the line above. Green: the gate passes;
the Windows worker suite (`deviceWorkerHostNative`, 7 real Windows cases)
still passes. Its workers are node processes, so no case here drives a 5.1
worker through the host; the rule itself is the one the gate's real-process
case proves.

### billingRouteInventory, reportProblem, manifest (walkthrough): pins follow the merged lanes

Cause: not Windows. Three pinned inventories missed deliberate changes the
merges brought, each made on a branch that did not carry the pinning test:

- `billingRouteInventory`: the int/recovery merge fix `bf7fcb66a1` moved the
  provider probe's and the providers commands' reads into one
  `runtime/providerReads.ts` request; the pin still named the two old sites
  (`expected [ …(11) ] to deeply equal [ …(12) ]`). The case still requires
  `billingRoute: await resolveAttemptBillingRoute(…)` at every site, the new
  one included.
- `reportProblem`: M125 added the `judgeFastSkip` journal kind, which
  `src/host/support/reportRecorder.ts` records for the fast path's skip
  audit; the pin listed seven kinds.
- `manifest` (D15 walkthrough): M125 lane W (`01bb890bc5`) added the
  `judgeSetup` step, completed by `onCommand:museSpark.setUpLocalJudge`; the
  pin listed five steps.

Fix: each pin names the merged state, and the walkthrough case also requires
the new step's completion event.

Red (before): the three messages above. Green: billingRouteInventory 2,
reportProblem 55 passed; manifest's walkthrough case passes (two other
manifest cases are left, below).

### judgeP2Delivery: real-gate controls run at collection

Cause: 31 cases ran their real gates inside the case: five
`check-bundle-split` runs per child source, two gates and a real `vsce ls`
per size case, one `vsce ls` per allowlist case. The cases' 60 s deadlines
were measured where one bundle-split run takes 2.2 s; on this Windows PC one
takes 11 to 18 s (profiled: CPU in TypeScript parsing and file reads, no
single Windows-only cost), so every such case passed its deadline
(`Test timed out in 60000ms`).

Fix: the suite's own pattern for its leak controls (RVM98P2R3 10): the child
split, size/globals/allowlist and English-fallback controls run once while
the file is collected (no deadline there), and each case asserts exactly
what it asserted before: every control's exit, message and byte-exact
restoration, and the VSIX list before, without and after each allowlist
entry. No deadline was changed.

Red (before, the full run): 33 failed, 31 by the 60 s deadline. Green: 101
passed; the file took 3,792 s here. The 2 cases left fail on the
integration's bundle budgets (below).

## Full runs on this PC

Same command both times: `vitest run` over the whole unit and e2e include,
excluding `**/vault/**`, `keyringParts`, `keystoreOwner` and
`credentialLease`.

| Run                                     | Failed tests | Failed files | Passed | Skipped |
| --------------------------------------- | -----------: | -----------: | -----: | ------: |
| Lead's run before this branch           |          159 |           43 |      — |       — |
| This branch's first run (at d81327d360) |          144 |           43 | 28,189 |     351 |
| After the fixes (full run)              |           54 |            8 | 28,395 |     360 |

The first run picked up edits made while it ran (it started at d81327d360 and
took 4,234 s): `acpServeHandshake` and `estimatorPricePackaging` ran after
their fixes, and three production-build suites refused their build as stale
once sources changed. The full run after the fixes took 6,445 s and failed in
judgeP2Delivery (33), packagedBundles (5), estimatorPlanSnapshotRealPlan (8),
manifest (3), pathGuardSpawns (2), billingRouteInventory, cx1r2Truth and
reportProblem (1 each). Two later commits then fixed 34 of those
(judgeP2Delivery's 31 timeouts, billingRouteInventory, reportProblem and
manifest's walkthrough), each verified by running its suite; 20 remain in 6
files, listed below.

## Left failing, with the exact reason

None of these is Windows-specific; each is a merge interaction in
int/recovery whose fix is a review or a decision outside a test's reach.

- **judgeP2Delivery** (2): `fires the new size and host-global guards without changing caps`
  and `leaves every restored artifact green` run the real `check-bundle-size`
  on the restored build, which is over twelve budgets the merges produced,
  among them `dist/modelApi.js` 575.0 KiB (budget 525), `dist/uiText.js`
  128.6 (125), `dist/modelsPanel.js` 159.5 (150), `dist/wire.js` 79.2 (75)
  and `dist/reportingPanel.js` 51.4 (50). Bundle diet or a measured budget
  move is the gates' work.
- **manifest** (2): the notices case wants every runtime dependency in
  `THIRD_PARTY_NOTICES.txt`; RLM110A0 added `@codemirror/merge`,
  `codemirror` and the `@xterm/*` packages to `dependencies`, but the node
  workspace that carries them is built apart (`test/harness/build-node.mjs`),
  so no shipped bundle's metafile lists them and `npm run notices` cannot add
  them. RELFAST counts 8 `actions: read` grants in `release.yml` against the
  pinned 7; which job's grant is new is a CI permission review.
- **packagedBundles** (5): the lazy registry check reads
  `NODE_WORKSPACE_ASSET = './node/files/main.js'` by its basename as
  `webview/main.js` (the same basename confusion the estimator walk had), and
  `src/shared/lazyBundles.generated.ts` still has rows for `nodeAuth.js`,
  `nodeAuthPage.js` and `webview/node/files/main.js`, which the build no
  longer gives: the registry generator and its committed output need the
  RLM110A0 merge's decision on what ships.
- **pathGuardSpawns** (2): eight process starts and one governed launch that
  the merges added are neither guarded nor reviewed into the record
  (`src/core/judge/setup/runtime.ts`, `src/runtime/node/gitRunner.ts`,
  `src/runtime/node/tls/certificate.ts`, `src/runtime/node/toolHost.ts`,
  `src/runtime/node/workspaces/devcontainer.ts`, `…/git.ts`,
  `…/snapshots.ts`, `src/runtime/tui/design/capabilities.ts`, and
  `ModelApiHost.ts`'s `spawnResourceProcess`): a security review per site.
- **cx1r2Truth** (1): the roadmap lists M96d under Planned while the case
  expects it in progress (PLAN.md status and `docs/roadmap/entries.json`).
- **estimatorPlanSnapshotRealPlan** (8): PLAN.md's lane tables after the
  merges: duplicate lanes `M100:0` and `M100:U`, malformed Starts cells
  (`M100:A` line 25734 and six more) and unknown rigs (`M100:A:linux-core-macos` …).
