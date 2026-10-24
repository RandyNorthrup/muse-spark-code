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
