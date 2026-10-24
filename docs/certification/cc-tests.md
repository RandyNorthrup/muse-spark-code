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
