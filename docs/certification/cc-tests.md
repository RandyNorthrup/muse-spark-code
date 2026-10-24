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
