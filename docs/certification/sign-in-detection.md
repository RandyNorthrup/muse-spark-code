# Sign-in detection — the CLI's sign-in is read, not assumed (PLAN.md D26 amendment)

Recorded 2026-09-27, branch `fix/cli-sign-in-detection`.

## The finding

The extension took "Muse Code CLI signed in" to mean "`auth.json` exists".

- **What `muse logout` does.** It never deletes the file. It rewrites it
  as the 44-byte `{"schema_version": 1, "providers": {}}`.
- **Where that was seen.** Muse Code 1.3.0 on Linux, and 1.4.0-R4302.1 on
  Windows and Linux. Each run used an isolated home with a dummy stored
  key and a dead proxy.
- **What it broke.** After any sign-out the auto backend kept choosing
  Muse Code. A panel sign-out stayed on "Sign-out is in progress or
  credentials remain" until a new browser sign-in.
- **Why no test caught it.** The unit test "does not reassert CLI sign-in
  while terminal logout still has the credential file" modelled the logout
  as deleting the file.
- **macOS.** A sign-in is a login Keychain item (`ai.meta.dev.credentials`,
  account `meta`), and `auth.json` is a token-free pointer
  (`schema_version: 2`, `storage: "keychain"`).

The evidence is `scratchpad/muse-1.4.0-credentials.md`, with its probes
under `scratchpad/m140cred/`:

- `probe-logout-iso*.json`: the file after `muse logout`, on three builds;
- `probe-account-logout-iso.json`: MSP `account/logout` returns
  `{state:"loggedOut", credentialRequired:true}` in 10 ms, leaves the same
  file, and fires `account/changed`. A terminal logout fired nothing
  within 6 s;
- `probe-account-{win,mac,linux}.json`: the `account/read` shapes;
- the `account/read` states the code relies on, all captured with
  `credentialRequired: true`: `accountLogin` and `loggedOut`
  (`probe-account-*.json`, `probe-logout-iso*.json`), `apiKey` after
  `muse auth set` (`probe-authset-*.json`), and `envKey` with `META_API_KEY`
  set (`envkey-account-read.txt`). `credentialRequired: false` was never
  seen, so no code gives it a meaning;
- `ptr-stderr.txt` and `ptr1-stderr.txt`: `muse serve` exits 3 on Windows
  with a schema-2 pointer, and with a version-1 provider whose storage is
  the Keychain;
- `probe-v2-serve.mjs` and its redacted output `probe-v2-serve.json` (the
  third review round, below): `muse serve` exits 3 on an empty version-2
  file too, and starts with a version-2 file when `META_API_KEY` is set;
- the same probe, extended in the fourth review round, and its redacted
  outputs `probe-v2-serve-win.json` (Windows 11) and
  `probe-v2-serve-linux.json` (the Kubuntu VM): the three files named
  `unsupportedHere`, each with and without a dummy `META_API_KEY`, on both
  (below);
- the bundled Slack connector, `slack_connector.py` in the `muse-core`
  plugin's cache (1.4.0-R4302.1), reads its own
  `providers.slack_connector.bot_token` from the same `auth.json` (its
  lines 18–20, 60 and 505): a provider in the file is not necessarily a
  Muse sign-in.

Every probe's trace shows 0 model attempts. No real sign-in or sign-out was
made, and no token was read.

## What changed

| Behaviour                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Where                                                                                                                                               | Tests                                                                                                                                                    |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `auth.json` is parsed for its structure only: schema version, which providers are named, each one’s `storage` lane, and whether `meta` has `api_key` or `access_token` (the parse replaces the value with `true`; review round 4). The schema drops every other field. Only `providers.meta` speaks for the sign-in; the bundled Slack connector’s entry does not (review round 3). A file over 64 KiB, a folder or a stat failure is not read.                                                             | `src/core/backends/musecode/credentialFile.ts` (`MUSE_CREDENTIAL_PROVIDER`), `readCredentialFile` in `src/host/auth/cliAccount.ts`                  | `credentialFile.test.ts` (the captured shapes, a Slack-only file, six malformed files); `cliAccount.test.ts`; `cliAccount.e2e.test.ts`                   |
| No file, or the empty version-1 file a sign-out leaves, is signed out without a process, on every OS. Off macOS, a `meta` entry in a captured inline shape (no `storage`; `api_key` or `access_token`) is signed in. A `meta` entry in any other shape, and other providers alone, are asked of the CLI (review round 4).                                                                                                                                                                                   | `CliAccount.signIn`                                                                                                                                 | `cliAccount.test.ts`; `authService.test.ts` "AuthService over the CLI’s real credential file"; `cliAccount.e2e.test.ts`                                  |
| A macOS pointer on macOS, any other file on macOS but the sign-out’s (a version-1 file holding the credential, an empty version-2 file: uncaptured there; review round 4), or a file the structure cannot place, is asked of the CLI (`account/read` on a short-lived `experimentalApi` host). The answer is kept per path, size and mtime.                                                                                                                                                                 | `CliAccount.confirm`, `AccountHosts.probe`                                                                                                          | `cliAccount.test.ts` (cache by mtime and by size, one shared question, a failed answer asked again on a click); `cliAccount.e2e.test.ts` (one probe)     |
| On macOS the CLI is asked only on a user action (Check again, sign-in, sign-out, the Sign Out and Diagnostics commands), never on activation or panel open.                                                                                                                                                                                                                                                                                                                                                 | `CliAccount.confirm`; `AuthService.refresh(isUserAction)`, `checkAgain`                                                                             | `cliAccount.test.ts`; `authService.test.ts` "when the CLI may be asked"; `conversationController.test.ts`                                                |
| Cancel leaves an unanswered probe behind and keeps the remembered answer. A sign-out, a device sign-in and Check again forget the answer too, so a Keychain change that leaves the file as it was is seen (review round 3); a sign-out forgets it right after the Cancel it makes, before it decides on `account/logout`, and presses of Check again while one runs join it (review round 4).                                                                                                               | `CliAccount.abandonProbe`, `forgetAnswers`; `AuthService.cancelSignIn`, `checkAgain`, `signInWithCli`, `logOutCli`; the controller’s `retryBackend` | `cliAccount.test.ts`; `authService.test.ts` (the real-file cases); `conversationController.test.ts`                                                      |
| A macOS file on Windows or Linux (any version 2, the empty one included, or a Keychain lane on `meta`) is a named error that gives the file’s path; `muse serve` exits 3 with each on both (captured, review round 4). The browser sign-in is refused with the same text instead of starting a host that exits 3. With `META_API_KEY` set, `muse serve` starts with each of the three on both, and the key wins. The log names the state without the path.                                                  | `AuthService.selectedSnapshot`, `signInWithCli`, `cliCredential`; `UI_TEXT.cliCredentialUnsupported`                                                | `credentialFile.test.ts`; `authService.test.ts` "a credential file Muse Code cannot start with"                                                          |
| Sign-out goes through MSP `account/logout`, confirmed by `account/read`. When that does not confirm it, the sign-in is read afresh; only a sign-in still there opens `muse logout` in a terminal, which gets `museSpark.environmentVariables`. The logout hold ends once the file or the CLI shows no sign-in, even though the file stays. A sign-out that keeps the hold is published as `error`, so the panel offers the Check again its message asks for.                                                | `logOutAccount`; `AuthService.performSignOut`, `logOutCli`, `refresh`; `terminalEnvironment`, `runCliInTerminal`                                    | `accountHost.test.ts`; `authService.test.ts`; `launch.test.ts`; e2e                                                                                      |
| The device sign-in succeeds on either of two signals: `account/read` turning `accountLogin` while polling; a new file that `account/read` does not contradict. A CLI that cannot answer `account/read` falls back to the file. The captured `granted` comes after both, so it is no signal of its own, except that with no first `account/read` it counts when `account/read` says `accountLogin` (review round 4); `accountLogin` alone then does not. A host that exits after the file changed signed in. | `runDeviceSignIn`, `isSignedIn`                                                                                                                     | `deviceSignIn.test.ts` "how it ends"; `cliAccount.e2e.test.ts` (the granted sequence replayed)                                                           |
| `account/loginCompleted` ends the flow at once on any outcome but `granted`. The captured `expired`, `denied` and `failed` show their own messages; any other word is shown as Muse Code sent it (`signInEnded`). No ending’s message reaches the log: each captured ending is logged in fixed words, and an uncovered word only in the shape of a protocol word (Codex on `886af682`). A malformed ending keeps waiting.                                                                                   | `runDeviceSignIn` (`loggedEnding`); `AuthService` (`signInExpired`, `signInDenied`, `signInSaveFailed`, `signInEnded`)                              | `deviceSignIn.test.ts`; `authService.test.ts` "how Muse Code ends a browser sign-in"; `cliAccount.e2e.test.ts` (the captured frames replayed)            |
| Cancel, the host’s ending and the host’s exit are noticed at once, even while an `account/read` goes unanswered: each poll and each wait races a stop signal, which `connection.closed` also trips. An exit fails the sign-in. `account/loginCancel` is bounded at 2 s, then the host is closed anyway.                                                                                                                                                                                                     | `runDeviceSignIn` (`untilStopped`, `cancelLogin`); `MUSE_LOGIN_CANCEL_TIMEOUT_MS`                                                                   | `deviceSignIn.test.ts` "a CLI that stops answering", "a host that exits"; `cliAccount.e2e.test.ts` (the fake leaves `account/read` unanswered, or exits) |
| The extension waits 11 minutes, past the captured 600 s code lifetime, so Muse Code’s own `expired` ends an unapproved code. Before, it cancelled at 5 minutes a code the browser could still approve.                                                                                                                                                                                                                                                                                                      | `CREDENTIAL_POLL_TIMEOUT_MS`                                                                                                                        | `deviceSignIn.test.ts` "waits past the captured code lifetime"                                                                                           |
| A Cancel pressed while the pre-check reads the file is kept: the controller exists before that read, and an aborted flow never starts. A Cancel pressed after the credential file changed lets the file decide (review round 3). With the hold on or a Model API session, the code leaves the panel before the refresh that follows (review round 4).                                                                                                                                                       | `AuthService.signInWithCli`, `finishCancelledCliSignIn`                                                                                             | `authService.test.ts` "cancels the running device flow", "lets the credential file decide a Cancel pressed just after the browser approved"              |
| Sign-out never waits on a question a finished or failed sign-in asks: the confirming `cliSignIn(true)` and each `refresh(true)` race the flow’s signal or the sign-out’s. A refresh begun before or during a sign-out cannot publish after it: the epoch moves as the sign-out starts and ends (review round 3). Nor can it put back a hold that sign-out released: it holds again only while a sign-out runs (review round 4).                                                                             | `AuthService.confirmCliSignIn`, `refreshUnlessCancelled`, `finishFailedCliSignIn`, `performSignOut`                                                 | `authService.test.ts` "sign-in, sign-out and Cancel racing", "keeps the state a sign-out published …"                                                    |
| The window closing closes every short-lived account host through one `AbortController`, probes Cancel left behind included, then cancels the sign-in and waits for it, then stops the backends (review round 3). A click still in its pre-flight questions then starts nothing, and no later click opens a key prompt (a flag `stopSignIn` sets; review round 4).                                                                                                                                           | `AccountHosts`; `AuthService.stopSignIn`; `lifecycle.shutdown` in `extension.ts`                                                                    | `accountHost.test.ts` "AccountHosts"; `authService.test.ts` "cancels the browser sign-in and waits for it to end"                                        |
| The account’s `label` (an e-mail address) and `avatarUrl` are dropped by the `account/read` parse and never logged.                                                                                                                                                                                                                                                                                                                                                                                         | `accountStateSchema`                                                                                                                                | `accountHost.test.ts` (the captured signed-in answer); `deviceSignIn.test.ts`; `cliAccount.e2e.test.ts` (the fake CLI sends a label)                     |
| Diagnostics names the file’s structure and the CLI’s sign-in. On macOS it adds the Keychain item’s presence (`security find-generic-password -s ai.meta.dev.credentials -a meta`, no `-g`/`-w`: exit 0 or 44). Its `account/read` may make the CLI read the Keychain, which can prompt.                                                                                                                                                                                                                     | `renderSupportReport`, `keychainItemPresence`, the Diagnostics command                                                                              | `supportReport.test.ts`; `credentialFile.test.ts`                                                                                                        |

The fake CLI (`test/e2e/fake-muse/serve.mjs`) now echoes `experimentalApi`.
For a client that asked for it, it serves `account/read` from the
credential file under `XDG_CONFIG_HOME`, as captured (review round 4): a
`meta` holding `access_token` (a browser sign-in) is `accountLogin`, one
holding `api_key` alone (`muse auth set`) is `apiKey`, anything else
signed out. It serves `account/logout` by rewriting that file as the empty
one the CLI leaves. At startup, before `initialize`, it exits 3 with the
captured stderr on a file 1.4.0-R4302.1 refused: a schema version other
than 1 (1 or 2 on macOS), "unsupported auth schema version …", and off
macOS a version-1 `meta` in the Keychain lane, "keychain item for meta is
unreadable". It does not model `META_API_KEY`, with which the real CLI
starts. `installFakeCredential` writes the granted capture's file
structure (schema 1, `meta` with the captured keys, placeholders for every
value) instead of `{"fake": true}`.

The fake also runs the device sign-in from the live captures below. It
reads `test/fixtures/msp/account-login-*.json` from `MUSE_FAKE_CAPTURES`:

- `account/loginStart` answers as captured;
- `MUSE_FAKE_LOGIN_ENDING` sends, after `MUSE_FAKE_LOGIN_ENDING_MS`, the
  notifications that capture received before its `loginCancel`. For
  `granted` it first writes the file as the browser sign-in left it, then
  sends `account/changed`, the ending and `account/changed` again;
- `account/loginCancel` sends the captured `cancelled` ending, then
  `{cancelled: true}`, in the captured order;
- `MUSE_FAKE_ACCOUNT_READ=silentAfterStart` leaves `account/read`
  unanswered once the flow has started;
- `MUSE_FAKE_LOGIN_EXIT_MS` exits that long after `loginStart`, a host
  that dies mid-flow.

The unit tests read the same files through
`test/unit/helpers/accountLoginCapture.ts`. The file shapes the tests use
are in `test/unit/helpers/credentialShapes.ts`: the `muse auth set` file
(schema 1, `meta` with `api_key` alone, `probe-authset-*.json`), the
device-login file (the granted capture) and the logout shell. Every
shape nobody captured (the third party's macOS pointer, the Slack-only
file, a file cut short) says so in a comment.

Checked in the third review round and left as it was:

- **`markAuthRequired`.** It publishes `signedOut` with the backend's own
  `authRequired` reason, which asks for no Check again. The panel shows the
  sign-in buttons that reason calls for, so C1's mismatch does not arise.
- **`META_API_KEY` before the file.** The W2 capture showed `muse serve`
  starting with a version-2 file when the key is set, so the key still
  wins over the file check. (Round 4 narrowed this claim to what was
  captured, then captured the rest: Windows and Linux, all three files.)
- **`granted`.** Captured now, it still needs no handler: it comes after
  the file and `account/read` already show the sign-in. (Round 4 found the
  one case where it does: no first `account/read`; see below.)

## Live capture of the device sign-in (PR #49 review)

Codex's review of PR #49 raised two findings:

- **P1.** The `loginCompleted` handlers were written from the schema's
  words; only `cancelled` had been captured.
- **P2.** A poll that awaited `account/read` held up Cancel and the host's
  ending for 30 s when the CLI stopped answering.

The owner authorized real device sign-ins with his account for this
capture.

- **How it was driven.** `scratchpad/cred-capture/capture.mjs` drove
  `muse-bin-1.4.0-R4302.1.exe serve` over raw MSP NDJSON, with
  `experimentalApi`, as the extension asks.
  - The machine was Windows 11, `serverInfo` 1.4.0, build `aebe0c18`.
  - It asked `account/read` every second and recorded every frame. Each
    frame was redacted before it was written.
- **The throwaway home.** Each run had a new `mkdtemp` folder under
  `%TEMP%`.
  - It held `HOME`, `USERPROFILE`, every `XDG_*_HOME`, `APPDATA`,
    `LOCALAPPDATA` and an empty workspace. `META_API_KEY` and
    `TBH_CREDENTIAL_BACKEND` were removed.
  - A run went on only when three checks held: the host's `museHome` was
    in that folder, the trace said `config_root source="xdg"`, and
    `account/read` said `loggedOut`.
- **Safety.**
  - The owner's `auth.json` was only `stat`ed: 640 bytes and mtime
    2026-09-22 20:21:02Z, before and after every run.
  - Each throwaway home was deleted and checked gone.
  - No session started, and every trace counted 0 model attempts.
  - No code was approved, so no token was issued or written.

| Capture               | 2026-09-27 (PDT) | Browser                 | Frames                                           | What the wire did                                                                                                                                                                                                                 |
| --------------------- | ---------------- | ----------------------- | ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| expired               | 18:13–18:23      | none: the code was left | `test/fixtures/msp/account-login-expired.json`   | `{outcome: "expired", message: "login failed: the request expired"}` came 600.5 s after `loginStart`'s answer, with no `account/changed`. `account/read` stayed `loggedOut`. A later `loginCancel` answered `{cancelled: false}`. |
| cancelled             | 18:14–18:22      | none (see below)        | `test/fixtures/msp/account-login-cancelled.json` | The run meant to approve the code, and sent `loginCancel` at its 482 s deadline. `{outcome: "cancelled"}`, with no message, arrived before the `{cancelled: true}` answer. The code was still live at 482 s.                      |
| a blocked config path | 18:22            | none                    | not kept                                         | A regular file where the `muse` config folder goes. `serve` started, `account/read` said `loggedOut`, and `loginStart` answered as usual. The save failure this was set up for comes only after an approval.                      |

- **`loginStart`.** It answers exactly `{verificationUrl, userCode}`,
  with no expiry field. The URL is
  `https://auth.meta.com/oauth/device/?code=<the code>`, and the code is
  4+4 letters.
- **`emittedAtMs`.** 1.4.0 adds a frame-level `emittedAtMs` to
  notifications. The SDK's `Notification` type has it.
- **What the fixtures keep.** The first two polls, and the last one before
  the ending. The code is replaced by its shape, `AAAA-AAAA`; no label,
  e-mail or token was in any frame.

In that first round `granted`, `denied` and `failed` could not be
captured: each needs a click on the device page in the owner's signed-in
Chrome, and the Chrome Control extension was disabled in that profile.
They were captured later the same evening (below).

### The success, a denial and a failed save (review round 3)

- **When and how.** 2026-09-27, 21:27–21:30 PDT (2026-09-28T04:27Z–04:30Z).
  `scratchpad/cred-capture/capture2.mjs` drove the same build
  (1.4.0-R4302.1, `serverInfo` 1.4.0, build `aebe0c18`, Windows 11) over
  raw MSP NDJSON with `experimentalApi`, one run per outcome. The raw
  redacted frames and each run's summary are in
  `scratchpad/cred-capture/out/live2/`; the fixtures were made from them.
- **The throwaway home.** As before: a new `mkdtemp` folder per run, with
  `HOME`, `USERPROFILE`, every `XDG_*_HOME`, `APPDATA`, `LOCALAPPDATA` and
  an empty workspace inside it, and `META_API_KEY`, `TBH_CREDENTIAL_BACKEND`
  and `MUSE_AUTH_PATH` removed. The trace confirmed
  `config_root source="xdg"` before `loginStart`. Each home was deleted
  and checked gone.
- **The browser.** The device page (`auth.meta.com/oauth/device/?code=…`)
  in the owner's signed-in Chrome asked only "Approve Muse Code?", with the
  code and two buttons, **Approve** and **Deny**. About 20 s after
  `loginStart`, Approve was clicked for `granted` and `failed`, and Deny
  for `denied`. The page then said "Muse Code was approved" or "… was
  denied".
- **Safety.** Every trace counted 0 model attempts; no session started.
  The owner's own `auth.json` was only `stat`ed (640 bytes, mtime
  2026-09-22T20:21:02.598Z) before, between and after the runs, unchanged
  (`live2/real-auth-stat.txt`). The `granted` run signed out through
  `account/logout` in the same home before the home was deleted; the trace
  logged `credential.revoke` with outcome `revoked`.
- **Redaction.** The user code is its shape, `AAAA-AAAA`; `museHome` and
  paths are under `<throwaway>`; the account's label and avatar address are
  the stand-ins `someone@example.com` and `https://example.com/avatar.png`,
  replaced by key before any frame was written. No token is in any frame.

| Capture | 2026-09-27 (PDT)  | Clicked | Frames                                         | What the wire did                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ------- | ----------------- | ------- | ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| granted | 21:27:45–21:28:15 | Approve | `test/fixtures/msp/account-login-granted.json` | The file first appeared 20.43 s after `loginStart`'s answer (437 B). `account/changed {state: accountLogin, credentialRequired: true}`, with no label, came at 21.25 s, as the next poll's `account/read` also said `accountLogin`. The file was rewritten (1062 B: schema 1, `providers.meta` with `access_token`, `obtained_via: "device_code"`, `mechanism: "oauth"`, `api_key`, `api_base_url` and the account's name, e-mail and avatar address). `{outcome: "granted"}`, with no message, came at 21.46 s; a second `account/changed`, now with `label` and `avatarUrl`, 1 ms later. `account/logout` answered `{state: loggedOut, credentialRequired: true}` in 27 ms, and the file became the 44-byte `{"schema_version":1,"providers":{}}`. |
| denied  | 21:29:03–21:29:28 | Deny    | `test/fixtures/msp/account-login-denied.json`  | `{outcome: "denied", message: "login failed: the request was denied"}` came 20.4 s after `loginStart`'s answer. No `account/changed`; `account/read` stayed `loggedOut`; no file was written.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| failed  | 21:29:35–21:30:00 | Approve | `test/fixtures/msp/account-login-failed.json`  | A regular 49-byte file stood where `cfg\muse` goes. `{outcome: "failed", message: "login succeeded but saving failed: failed to write credential file at <throwaway>\cfg\muse: Cannot create a file when that file already exists. (os error 183)"}` came 20.5 s after `loginStart`'s answer. The message names a local path, which is the user's profile folder in real life. No `account/changed`; `account/read` stayed `loggedOut`; nothing was written; the trace shows no `credential.refresh`, so no key was minted.                                                                                                                                                                                                                          |

- **`avatarUrl`.** `account/read` and `account/changed` carry an
  `avatarUrl` the MSP schema does not list. The schema parse is lenient
  and drops it, with the label.
- **What changed because of it.** `denied` and `failed` have their own
  messages (`signInDenied`, `signInSaveFailed`), and `signInEnded` is left
  for words never seen. The log kept `expired`'s and `denied`'s messages
  only: `failed`'s names a path, so the log said "saving the credential
  failed". (Since Codex's review of `886af682`, no message is logged:
  every captured ending has fixed words.) `granted` kept no handler: it
  comes after the file and `account/read` already show the sign-in.

**What the wire showed that the code had wrong.**

- **The code's lifetime.** A code lives 600 s. The extension gave up at
  5 minutes and cancelled a code the browser could still approve, so its
  `expired` handler could never be reached.
  - The backstop is now 11 minutes (`CREDENTIAL_POLL_TIMEOUT_MS`), checked
    against the lifetime measured in the fixture.
  - The panel now shows Muse Code's own `expired`.
- **The message.** `expired` carries one, as the schema says; `cancelled`
  carries none.
- **`account/changed`.** It did not fire for an expired code either, so it
  stays unused.
- **The order.** The ending precedes the `loginCancel` answer.

## An empty version-2 file off macOS (review round 3, W2)

The second review round read `{"schema_version":2,"providers":{}}` as
signed out on every OS. The nearest capture, `ptr-stderr.txt`, showed
Windows refusing a pointer on its version alone. So the file was given
to `muse serve` itself.

- **How.** `scratchpad/m140cred/probe-v2-serve.mjs`, 2026-09-27 21:38 PDT
  (2026-09-28T04:38Z), Windows 11, the installed
  `muse-bin-1.4.0-R4302.1.exe serve`. Each case had a new `mkdtemp` home
  (`HOME`, `USERPROFILE`, every `XDG_*_HOME`, `APPDATA`, `LOCALAPPDATA`),
  holding exactly the file named; `META_API_KEY`, `TBH_CREDENTIAL_BACKEND`
  and `MUSE_AUTH_PATH` were removed, and the network went to a dead proxy
  (`127.0.0.1:9`). The probe sent `initialize` with `experimentalApi` and,
  if the host started, one `account/read`, then closed it. No session, no
  sign-in, 0 model attempts in every trace. The owner's `auth.json` was
  only `stat`ed, unchanged; every home was removed.
- **The output.** `scratchpad/m140cred/probe-v2-serve.json`, redacted
  (paths under `<throwaway>`, the dummy key as `<dummy key>`, the label
  replaced).

| Case                                      | `META_API_KEY`         | What `serve` did                                                                                                         |
| ----------------------------------------- | ---------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `{"schema_version":2,"providers":{}}`     | unset                  | exit 3 after 425 ms, before `initialize`: `compose serve model client: unsupported auth schema version 2 at …\auth.json` |
| a version-2 pointer (`storage: keychain`) | unset                  | the same exit 3 and message (the control case)                                                                           |
| a version-2 pointer                       | a dummy value (no key) | started; `account/read` answered `{state: envKey, credentialRequired: true}`                                             |
| `{"schema_version":2,"providers":{}}`     | a dummy value          | started; `account/read` answered `envKey`                                                                                |

- **The verdict.** Muse Code refuses any version-2 file off macOS on its
  version, the empty one included. The structural read now names every
  version-2 file off macOS as one Muse Code cannot start with. The verdict
  was `keychainElsewhere`; it is `unsupportedHere` now, because an empty
  file points to no Keychain. Its message, `cliCredentialUnsupported`,
  says the file is in the macOS format, in every table. Linux was treated
  like Windows without a probe; round 4 probed it (below).
- **The environment key.** With `META_API_KEY` set, `serve` starts with a
  version-2 file and uses the key, so the key still bypasses the file
  check (`AuthService.cliCredential`), as before.

## The fourth review round (re-review of `990ee91e`)

### Linux and `META_API_KEY` captured (W3)

`unsupportedHere` on Linux, and `META_API_KEY` with a version-1 Keychain
lane, had never been run. `scratchpad/m140cred/probe-v2-serve.mjs` (SHA-256
`5223F87A…FD26068`) was extended to six cases: the empty version-2 file, a
version-2 pointer and `{"schema_version":1,"providers":{"meta":{"storage":"keychain"}}}`,
each without and with a dummy `META_API_KEY` (`LLM_dummy-not-a-real-key`,
no real key anywhere).

- **How.** `serve` only: `initialize` with `experimentalApi` and, if the
  host started, one `account/read`. Each case had a new `mkdtemp` home
  (`HOME`, `USERPROFILE`, every `XDG_*_HOME`, `APPDATA`, `LOCALAPPDATA`)
  holding exactly the file named; `META_API_KEY`, `TBH_CREDENTIAL_BACKEND`
  and `MUSE_AUTH_PATH` were removed and every proxy variable pointed at the
  dead `127.0.0.1:9`. Every trace said `config_root source="xdg"`, and
  every host that started reported its `museHome` inside the throwaway
  home. No session, no sign-in, **0 model attempts** in every trace.
- **Windows.** Windows 11 (10.0.26200), Node 24.20.0, the installed
  `muse-bin-1.4.0-R4302.1.exe`, 2026-09-28T05:55:27Z–05:55:43Z. The owner's
  `auth.json` was only `stat`ed (640 bytes, unchanged). Output
  `probe-v2-serve-win.json` (SHA-256 `0F2B543C…A3428D5E`).
- **Linux.** The Kubuntu VM (`10.10.11.212`, kernel 7.0.0-31-generic,
  Node 24.18.0, `~/.local/bin/muse-bin-1.4.0-R4302.1`), reached with
  `ssh -i ~/.ssh/muse_ext_ed25519`, 2026-09-28T05:55:53Z–05:55:54Z. The
  probe ran from a `mktemp -d` folder that was removed afterwards; no
  `/tmp/muse-w3-probe-*` or `/tmp/muse-v2-probe-*` was left, and the VM
  has no `~/.config/muse` (checked before and after). Output
  `probe-v2-serve-linux.json` (SHA-256 `5A3F1D84…3C5ADE63`).
- **Redaction.** Paths under `<throwaway>`, the home as `~`, the dummy key
  as `<dummy key>`, the `envKey` label replaced.

| Case                              | `META_API_KEY` | Windows 11                                                                                | Kubuntu                                 |
| --------------------------------- | -------------- | ----------------------------------------------------------------------------------------- | --------------------------------------- |
| empty version 2                   | unset          | exit 3 (3128 ms), before `initialize`: "unsupported auth schema version 2 at …\auth.json" | exit 3 (138 ms), the same message       |
| empty version 2                   | dummy          | started; `account/read` → `envKey`                                                        | started (`platformOs: linux`); `envKey` |
| version-2 pointer                 | unset          | exit 3 (556 ms), the same message                                                         | exit 3 (134 ms), the same message       |
| version-2 pointer                 | dummy          | started; `envKey`                                                                         | started; `envKey`                       |
| version 1, `meta` in the Keychain | unset          | exit 3 (465 ms): "keychain item for meta is unreadable (internal error -2147483648)"      | exit 3 (134 ms), the same message       |
| version 1, `meta` in the Keychain | dummy          | started; `envKey`                                                                         | started; `envKey`                       |

- **The Linux verdicts.** Linux does what Windows does, so every
  version-2 file and a version-1 Keychain lane stay `unsupportedHere` there,
  now from a capture (`credentialFile.test.ts` cites both outputs; drill BW
  breaks the Linux side).
- **The environment key.** It wins over all three files on Windows and on
  Linux, so `AuthService.cliCredential` keeps looking at no file while the
  key is set. The docs' "the key still wins" now names both systems and
  the three files; macOS was not probed with the key.

### What changed in round 4

| Finding | Where                                                                            | What                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Tests                                                                                                                                                                                                                                                                                  |
| ------- | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1      | `AuthService.performSignOut`                                                     | `forgetCliAnswers()` right after the `cancelSignIn()` it makes: the logout decision asks the CLI afresh, so a stale remembered `signedOut` no longer skips `account/logout`.                                                                                                                                                                                                                                                                                                                                                                           | `authService.test.ts` "asks the CLI afresh at sign-out, so a sign-in made since is signed out"                                                                                                                                                                                         |
| R2      | `runDeviceSignIn`, `isSignedIn`                                                  | The notification handler records `granted`. With no first `account/read`, `granted` together with `account/read` saying `accountLogin` is the sign-in; `granted` alone is not (neither with no answer nor with `envKey`).                                                                                                                                                                                                                                                                                                                              | `deviceSignIn.test.ts` "signs in on the captured granted and account/read when the first account/read went unanswered", "takes no sign-in from granted alone when …"                                                                                                                   |
| R3      | `AuthService.stopSignIn`, `signIn`, `joinDeviceSignIn`                           | A flag `stopSignIn` sets; `signIn` and the join return at once when it is set. Chosen over joining the window's signal to the flow's connect: a stopped click then never publishes `signingIn`, asks its pre-check, or opens a key prompt, where a signal would reach it only at the connect.                                                                                                                                                                                                                                                          | `authService.test.ts` "starts no sign-in once the window is closing, not even from a click in its pre-flight", "opens no key prompt and starts no device flow once the window is closing"                                                                                              |
| R4      | `AuthService.refresh`                                                            | A refresh that finds the epoch moved holds again only while a sign-out runs (`isSignOutRunning()`, read afresh after the awaits); otherwise it returns the snapshot and leaves the hold alone.                                                                                                                                                                                                                                                                                                                                                         | `authService.test.ts` "leaves the hold as a finished sign-out left it when a refresh answers late"                                                                                                                                                                                     |
| R5      | `AuthService.checkAgain`                                                         | Concurrent presses share one in-flight promise: one forget, one question, one host.                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | `authService.test.ts` "asks the CLI once however often Check again is pressed while it answers"                                                                                                                                                                                        |
| R6      | `AuthService.finishFailedCliSignIn`                                              | Publishes `{status, detail, verificationUrl: undefined, userCode: undefined}` first, then, with the hold on or a Model API session, refreshes (and still sends the notice).                                                                                                                                                                                                                                                                                                                                                                            | `authService.test.ts` "clears the code at once after Cancel with the logout hold on", "… with a Model API session"                                                                                                                                                                     |
| R7      | `runDeviceSignIn` (`endedAs`)                                                    | A host that is gone while the credential file changed since the flow began has signed in (logged as such); with no change it still fails at once.                                                                                                                                                                                                                                                                                                                                                                                                      | `deviceSignIn.test.ts` "signs in when the host exits after the credential file changed"                                                                                                                                                                                                |
| W1      | `credentialFileVerdict`                                                          | `inline` only for a `meta` with no `storage` and `api_key` or `access_token` (the parse keeps the key's presence as `true`, never its value). `meta: {}`, another `storage`, or no captured key: `unrecognized`.                                                                                                                                                                                                                                                                                                                                       | `credentialFile.test.ts` "leaves a meta entry in any other shape to the CLI on %s", "takes either captured credential key alone …"                                                                                                                                                     |
| W2      | `credentialFileVerdict`; `constants.ts`                                          | On macOS a version-1 file holding the credential and an empty version-2 file are `unrecognized` (asked on a user action; the passive estimate is `unknown`). The captured version-1 empty file stays signed out on every OS. The constants comment no longer says macOS writes version 1 with `TBH_CREDENTIAL_BACKEND=file` (the Mac wrote no file).                                                                                                                                                                                                   | `credentialFile.test.ts` (the lines round 4 named, now "leaves a file holding the credential to the CLI on macOS" and the pointer case); `cliAccount.test.ts` "asks the CLI about %s on macOS, only on a user action", "still reads the file a sign-out leaves as signed out on macOS" |
| W3      | captures; `credentialFile.test.ts`                                               | Above.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | `credentialFile.test.ts` "names a macOS file Muse Code cannot start with on %s"; `authService.test.ts` "leaves the file to the CLI while META_API_KEY signs it in"                                                                                                                     |
| W4      | `AuthService.set`, `signInLine`                                                  | The unsupported-file state is logged as "the Muse Code credential file is in a format Muse Code cannot start with on this system"; the panel keeps the path.                                                                                                                                                                                                                                                                                                                                                                                           | `authService.test.ts` "logs no credential path for that state"                                                                                                                                                                                                                         |
| W5      | `test/e2e/fake-muse/serve.mjs`; `cliAccount.e2e.test.ts`; `deviceSignIn.test.ts` | The fake exits 3 with the captured stderr as above and answers `apiKey` / `accountLogin` by shape. The e2e's schema-9 file, which expected `signedIn`, became a synthetic `meta` in an uncaptured `storage` lane (asked of the CLI); the schema-9 file now proves a host that exits answers `unknown`. The unit test that sent `granted` before `accountLogin` is renamed "waits for account/read after a granted that comes before it"; "signs in on the poll that sees the account, before the captured granted follows" replays the captured order. | `cliAccount.e2e.test.ts` "answers unknown when the host exits at startup", "answers account/read about %s as captured", "reads a stored sign-in from the file alone off macOS"                                                                                                         |

Also in the working tree when this round began, and part of it: the e2e
Slack-only test asks with `signIn(true)`, so it holds on macOS too, and the
15 `package.nls*.json` tables describe `museSpark.environmentVariables` as
reaching the terminals that run the CLI (C6).

## Drills

Each drill broke one guard in the working tree and ran the named suites.
The original bytes were then written back from memory, never through git.
Every target's SHA-256 matched its pre-drill value, before and after all
seventeen (`scratchpad/cred-fix/drills.mjs`, `drills-result.json`).

| Drill | What was broken                                                     | Suites                                  | Result                                                                                                         |
| ----- | ------------------------------------------------------------------- | --------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| A     | The empty file a sign-out leaves read as a sign-in                  | credentialFile, cliAccount, authService | exit 1, 8 failed; first "reads the empty file a sign-out leaves as signed out, without starting the CLI"       |
| B     | A macOS Keychain pointer accepted off macOS                         | credentialFile, cliAccount              | exit 1, 3 failed; first "names a macOS pointer on Windows without starting a host that would exit"             |
| C     | macOS asks the CLI without a user action                            | cliAccount                              | exit 1, 1 failed: "asks about a macOS Keychain pointer only on a user action"                                  |
| D     | The answer cached without the file's size and mtime                 | cliAccount, cliAccount.e2e              | exit 1, 2 failed; first "asks about a malformed file off macOS at once, and keeps the answer until it changes" |
| E     | A failed answer never asked again on a user action                  | cliAccount                              | exit 1, 1 failed: "keeps a failed answer for passive looks, and asks again on a user action"                   |
| F     | Sign-out skips `account/logout` (terminal only)                     | authService                             | exit 1, 4 failed; first "clears the key, signs the CLI out through account/logout, and restarts"               |
| G     | The hold counts any credential file as a sign-in (the original bug) | authService                             | exit 1, 8 failed; first "keeps an environment-authenticated CLI gated until its key is removed"                |
| H     | A Keychain pointer off macOS not named in the gate                  | authService                             | exit 1, 1 failed: "names a macOS Keychain pointer on Windows or Linux instead of offering a dead sign-in"      |
| I     | Browser sign-in starts a host that would exit on that pointer       | authService                             | exit 1, 1 failed: the same case                                                                                |
| J     | A Cancel during the pre-check is lost                               | authService                             | exit 1, 1 failed: "cancels the running device flow without changing credentials"                               |
| K     | `denied`, `expired`, `failed` ignored (only `cancelled` ends)       | deviceSignIn                            | exit 1, 3 failed; first "ends at once on denied, logs the host’s reason, and needs no loginCancel"             |
| L     | `granted` or a new file taken while `account/read` says signed out  | deviceSignIn                            | exit 1, 2 failed; first "waits while the store does not show a granted sign-in yet"                            |
| M     | `account/read` polling not a sign-in signal                         | deviceSignIn                            | exit 1, 1 failed: "notices a sign-in by polling account/read when no outcome arrives"                          |
| N     | `account/logout` trusted without `account/read`                     | accountHost                             | exit 1, 4 failed; first "is false when account/logout is refused"                                              |
| O     | The account label kept by the `account/read` parse                  | accountHost                             | exit 1, 1 failed: "keeps the state and drops the label"                                                        |
| P     | Check again not a user action                                       | conversationController                  | exit 1, 1 failed: "delegates sign-in, sign-out, retry and external links"                                      |
| Q     | The Diagnostics Keychain line dropped                               | supportReport                           | exit 1, 1 failed: "describes the CLI’s sign-in by the file’s structure and the Keychain item"                  |

Drills R to AA cover the PR #49 review fixes. They ran the same way, on
the final tree, from `scratchpad/cred-capture/drills.mjs`
(`drills-result.json`). After all ten, each target's SHA-256 matched its
pre-drill value.
"e2e" is `test/e2e/cliAccount.e2e.test.ts`, whose fake CLI replays the
captured frames.

| Drill | What was broken                                                                                                | Suites                   | Result                                                                                                                                   |
| ----- | -------------------------------------------------------------------------------------------------------------- | ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| R     | A poll waits for an unanswered `account/read` (the P2 race removed)                                            | deviceSignIn, e2e        | exit 1, 6 failed (4 unit, 2 e2e, each at its test timeout); first "ends at once on the host’s ending while account/read goes unanswered" |
| S     | The wait between polls does not notice Cancel                                                                  | deviceSignIn             | exit 1, 1 failed: "notices Cancel during the wait between polls"                                                                         |
| T     | `loginCancel` waits the 30 s MSP deadline instead of 2 s                                                       | deviceSignIn             | exit 1, 2 failed; first "closes the host after Cancel even when loginCancel is never answered"                                           |
| U     | The captured `expired` loses its own meaning                                                                   | deviceSignIn, e2e        | exit 1, 6 failed; first (e2e) "ends on the captured expired ending, shown the code as captured"                                          |
| V     | The captured `cancelled` loses its own meaning                                                                 | deviceSignIn             | exit 1, 1 failed: "treats the captured cancellation ending as terminal"                                                                  |
| W     | An ending no capture covers keeps the flow waiting (the old rule)                                              | deviceSignIn             | exit 1, 5 failed; first "ends at once on denied, which no capture covers, as the CLI named it"                                           |
| X     | The uncaptured `granted` ends the flow like any other word                                                     | deviceSignIn             | exit 1, 2 failed; first "takes an uncaptured granted for nothing: account/read decides"                                                  |
| Y     | Every ending shown with the `expired` text                                                                     | authService              | exit 1, 3 failed; first "ends an uncaptured denied sign-in at once, signed out with its reason"                                          |
| Z     | The extension gives up at 5 minutes, before the captured code lifetime                                         | deviceSignIn             | exit 1, 1 failed: "waits past the captured code lifetime, so Muse Code ends an unapproved code itself"                                   |
| AA    | An ending that arrives before `loginStart` answers is taken for Cancel                                         | deviceSignIn             | exit 1, 1 failed: "ends on the host’s ending while loginStart is unanswered, with no code shown"                                         |
| AB    | The pre-flight account probe awaited without the flow's signal (the review of PR #49)                          | `authService.test.ts`    | exit 1, 1 failed: Cancel waited on a probe the CLI never answered                                                                        |
| AC    | Sign-out and the next sign-in rejoin a probe Cancel abandoned (the review of PR #49)                           | `cliAccount.test.ts`     | exit 1, 1 failed: the second question waited on the unanswered probe                                                                     |
| AD    | A file change counted as a sign-in after a stop, while a poll went unanswered (the review of PR #49)           | `deviceSignIn.test.ts`   | exit 1, 1 failed: the expired code was reported as a sign-in                                                                             |
| AE    | `account/read`'s uncaptured `credentialRequired: false` read as a keyless sign-in (the review of PR #49)       | `cliAccount.test.ts`     | exit 1, 1 failed: a signed-out answer with the flag false became `signedIn`                                                              |
| AF    | The device flow's signed-out guard gated on `credentialRequired` again (the review of PR #49)                  | `deviceSignIn.test.ts`   | exit 1, 1 failed: a rewritten file counted as a sign-in under the uncaptured value                                                       |
| AG    | An empty version-2 file read as a Keychain pointer off macOS (the review of PR #49)                            | `credentialFile.test.ts` | exit 1, 2 failed: a signed-out macOS file copied to Windows or Linux blocked browser sign-in                                             |
| AH    | `account/logout` confirmed on any answer but a stored sign-in (the review of PR #49)                           | `accountHost.test.ts`    | exit 1, 2 failed: `envKey` and the uncaptured `credentialRequired: false` confirmed a logout                                             |
| AI    | A refresh begun before sign-out publishes its late answer (the review of PR #49)                               | `authService.test.ts`    | exit 1, 1 failed: the signed-out state was overwritten with "Sign-out is in progress"                                                    |
| AJ    | A sign-in cancelled by sign-out still announces its own cancellation                                           | `authService.test.ts`    | exit 1, 1 failed: "Sign-in cancelled" was shown during the sign-out                                                                      |
| AK    | The CLI's answer returned although the credential file was rewritten while it was asked (the review of PR #49) | `cliAccount.test.ts`     | exit 1, 1 failed: a sign-out rewrite during the probe still read as signed in                                                            |
| AL    | The CLI's remembered answer kept after a confirmed logout that left the file unchanged (the review of PR #49)  | `authService.test.ts`    | exit 1, 1 failed: a Keychain-style logout stayed signed in and kept the hold                                                             |

Drills AM to BJ cover the third round of the PR #49 review (the races R1–R6,
the wire evidence W1–W2, the failure paths C1–C9). They ran the same way, on
the final tree, from `scratchpad/cred-capture/drills2.mjs`
(`drills2-result.json`): each target's SHA-256 matched its pre-drill value
after every drill and after all twenty-four. The fixes with no product guard
have no drill: W3 and C10 change test data and test timing only, C7 and C8
docs and a comment, and W2's environment-key finding confirmed the code as it
was.

| Drill | What was broken                                                                              | Suites                                         | Result                                                                                                                  |
| ----- | -------------------------------------------------------------------------------------------- | ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| AM    | R1: a finished sign-in confirms the new sign-in (after a sign-out) without the flow’s signal | `authService.test.ts`                          | exit 1, 1 failed: "signs out without waiting on a finished sign-in confirming the sign-in after a sign-out"             |
| AN    | R1: a finished sign-in’s last `refresh(true)` without the flow’s signal                      | `authService.test.ts`                          | exit 1, 1 failed: "signs out without waiting on a finished sign-in refreshing after the sign-in"                        |
| AO    | R2: Cancel forgets the remembered answer too (the old single hook)                           | `authService.test.ts`                          | exit 1, 2 failed; first "signs out without waiting on a pre-flight probe the CLI never answered (the review of PR #49)" |
| AP    | R2: a failed sign-in’s refresh does not yield to a sign-out                                  | `authService.test.ts`                          | exit 1, 1 failed: "signs out without waiting on the refresh a failed sign-in began"                                     |
| AQ    | R2: abandoning a probe drops the remembered answer too                                       | `cliAccount.test.ts`                           | exit 1, 1 failed: "keeps a remembered answer when a probe is abandoned, and asks afresh once forgotten"                 |
| AR    | R3: the sign-out epoch does not move as the sign-out ends                                    | `authService.test.ts`                          | exit 1, 1 failed: "keeps the state a sign-out published when a refresh begun during it answers late"                    |
| AS    | R4: Check again keeps the CLI’s remembered answers                                           | `authService.test.ts`                          | exit 1, 1 failed: "asks the CLI afresh on Check again, even about a sign-in it confirmed"                               |
| AT    | R4: the panel’s Check again is a plain `refresh(true)` again                                 | `conversationController.test.ts`               | exit 1, 1 failed: "delegates sign-in, sign-out, retry and external links"                                               |
| AU    | R5: with no first `account/read`, an existing `accountLogin` counts as a new sign-in         | `deviceSignIn.test.ts`                         | exit 1, 1 failed: "when the first account/read goes unanswered, takes no sign-in from before the flow for a new one"    |
| AV    | R6: Cancel publishes signed out although the file changed since the flow began               | `authService.test.ts`                          | exit 1, 1 failed: "lets the credential file decide a Cancel pressed just after the browser approved"                    |
| AW    | W1: any provider in `auth.json` counts as the Muse sign-in                                   | `credentialFile.test.ts`, `cliAccount.test.ts` | exit 1, 5 failed; first "asks the CLI about a file naming another provider alone"                                       |
| AX    | W1: the fake CLI counts any provider as a login                                              | e2e                                            | exit 1, 1 failed: "asks the CLI about a file naming another provider alone"                                             |
| AY    | W2: an empty version-2 file off macOS read as signed out                                     | `credentialFile.test.ts`                       | exit 1, 2 failed; first "names a macOS file Muse Code cannot start with on win32"                                       |
| AZ    | C1: a sign-out that keeps the hold publishes `signedOut`, with no Check again                | `authService.test.ts`                          | exit 1, 3 failed; first "ends the host and clears the key when the CLI logout terminal cannot open"                     |
| BA    | C2: the device flow does not notice its host exiting                                         | `deviceSignIn.test.ts`, e2e                    | exit 1, 3 failed; first "fails at once when the host exits during the flow"                                             |
| BB    | C3: an account host is not closed when the window closes                                     | `accountHost.test.ts`                          | exit 1, 1 failed: "closes a probe still waiting when the window closes, and starts none afterwards"                     |
| BC    | C3: closing the window does not wait for the cancelled sign-in                               | `authService.test.ts`                          | exit 1, 1 failed: "cancels the browser sign-in and waits for it to end"                                                 |
| BD    | C4: every `loginCompleted` message logged as sent, the failed path included                  | `deviceSignIn.test.ts`, e2e                    | exit 1, 3 failed; first "ends on the captured failed, and logs no path"                                                 |
| BE    | C4: the captured `denied` and `failed` lose their own meanings                               | `deviceSignIn.test.ts`, e2e                    | exit 1, 5 failed; first "ends on the captured denied, and logs no path"                                                 |
| BF    | C4: the captured `denied` shown with the generic text                                        | `authService.test.ts`                          | exit 1, 2 failed; first "ends the captured denied sign-in at once, signed out with its reason"                          |
| BG    | C4: the generic ending promises a log line that is not written                               | `authService.test.ts`                          | exit 1, 1 failed: "ends an unknown sign-in at once, signed out with its reason"                                         |
| BH    | C5: an unconfirmed logout always opens `muse logout` in a terminal                           | `authService.test.ts`                          | exit 1, 1 failed: "opens no muse logout terminal once the file shows no sign-in after an unconfirmed logout"            |
| BI    | C6: a CLI terminal gets none of `museSpark.environmentVariables`                             | `launch.test.ts`                               | exit 1, 1 failed: "gives a CLI terminal the configured variables, one spelling each on Windows"                         |
| BJ    | C9: a successful device sign-in keeps the CLI’s earlier answers                              | `authService.test.ts`                          | exit 1, 1 failed: "asks the CLI afresh after a browser sign-in, the file unchanged"                                     |

Drills BK to BZ cover the fourth round (the races R1–R7, the wire evidence
W1–W5). They ran the same way, on the final tree, from
`scratchpad/cred-capture/drills3.mjs` (SHA-256 `65B3AD09…1F90A53E`;
`drills3-result.json`, `drills3.log`): each drill replaced one exact
string, found exactly once, ran its suites, and wrote the original bytes
back from memory. Each target's SHA-256 matched its pre-drill value after
every drill and after all sixteen (`authService.ts` `6527bb5f…`,
`deviceSignIn.ts` `32c25770…`, `credentialFile.ts` `758947ea…`,
`serve.mjs` `d7c7c535…`). R3 has two drills because `signIn` and the
device flow's join each check the flag. The findings with no product guard
have no drill: the renamed unit test and the e2e test data (W5), and the
constants comment (W2).

| Drill | What was broken                                                                                        | Suites                                         | Result                                                                                                                                                       |
| ----- | ------------------------------------------------------------------------------------------------------ | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| BK    | R1: a sign-out decides on the answer the CLI gave before it (the one Cancel keeps)                     | `authService.test.ts`                          | exit 1, 1 failed: "asks the CLI afresh at sign-out, so a sign-in made since is signed out"                                                                   |
| BL    | R2: with no first `account/read`, `granted` and `accountLogin` do not count (only a new file)          | `deviceSignIn.test.ts`                         | exit 1, 1 failed: "signs in on the captured granted and account/read when the first account/read went unanswered"                                            |
| BM    | R2: `granted` alone counts when there is no first `account/read`                                       | `deviceSignIn.test.ts`                         | exit 1, 1 failed: "takes no sign-in from granted alone when account/read says envKey"                                                                        |
| BN    | R3: a click in its pre-flight starts a device flow after the window closed (the join ignores the flag) | `authService.test.ts`                          | exit 1, 1 failed: "starts no sign-in once the window is closing, not even from a click in its pre-flight"                                                    |
| BO    | R3: a sign-in click after the window closed still runs (`signIn` ignores the flag)                     | `authService.test.ts`                          | exit 1, 1 failed: "opens no key prompt and starts no device flow once the window is closing"                                                                 |
| BP    | R4: a late refresh puts the hold back after a finished sign-out released it                            | `authService.test.ts`                          | exit 1, 1 failed: "leaves the hold as a finished sign-out left it when a refresh answers late"                                                               |
| BQ    | R5: a second Check again forgets the first one’s probe and asks again                                  | `authService.test.ts`                          | exit 1, 1 failed: "asks the CLI once however often Check again is pressed while it answers"                                                                  |
| BR    | R6: with the hold on or a Model API session, the code-less state is published only after the refresh   | `authService.test.ts`                          | exit 1, 2 failed: "clears the code at once after Cancel with the logout hold on", "… with a Model API session"                                               |
| BS    | R7: a host that exits after writing the credential file fails the sign-in                              | `deviceSignIn.test.ts`                         | exit 1, 1 failed: "signs in when the host exits after the credential file changed"                                                                           |
| BT    | W1: any `meta` entry without the Keychain lane reads as holding the credential                         | `credentialFile.test.ts`                       | exit 1, 2 failed: "leaves a meta entry in any other shape to the CLI on win32", "… on linux"                                                                 |
| BU    | W2: a version-1 file holding the credential is settled as signed in on macOS                           | `credentialFile.test.ts`, `cliAccount.test.ts` | exit 1, 2 failed: "asks the CLI about a browser sign-in file on macOS, only on a user action", "leaves a file holding the credential to the CLI on macOS"    |
| BV    | W2: an empty version-2 file on macOS is settled as signed out                                          | `credentialFile.test.ts`, `cliAccount.test.ts` | exit 1, 2 failed: "asks the CLI about an empty version-2 file on macOS, only on a user action", "reads a macOS Keychain pointer as needing the CLI on macOS" |
| BW    | W3: Linux read as starting with a version-2 file (the verdict untied from the Linux capture)           | `credentialFile.test.ts`                       | exit 1, 1 failed: "names a macOS file Muse Code cannot start with on linux"                                                                                  |
| BX    | W4: the log line carries the unsupported-file message, credential path and all                         | `authService.test.ts`                          | exit 1, 1 failed: "logs no credential path for that state"                                                                                                   |
| BY    | W5: the fake CLI starts with a schema Muse Code exits 3 on                                             | e2e                                            | exit 1, 1 failed: "answers unknown when the host exits at startup"                                                                                           |
| BZ    | W5: the fake CLI answers `accountLogin` for the `muse auth set` file                                   | e2e                                            | exit 1, 1 failed: "answers account/read about the muse auth set file as captured"                                                                            |

Drills CA to CR cover Codex's review of `886af682` and the sibling sweep
(below). They ran the same way, on the final tree, from
`scratchpad/cred-capture/drills4.mjs` (SHA-256 `35BBAB1F…C661667B`;
`drills4-result.json`, `drills4.log`). Each target's SHA-256 matched its
pre-drill value after every drill and after all eighteen:

| File                        | SHA-256 (start) |
| --------------------------- | --------------- |
| `cliAccount.ts`             | `139b3b77…`     |
| `authService.ts`            | `103e3310…`     |
| `deviceSignIn.ts`           | `76408a95…`     |
| `logging.ts`                | `7e475991…`     |
| `accountHost.ts`            | `b99cd09b…`     |
| `logText.ts`                | `ac2b096a…`     |
| `museCodeBackendManager.ts` | `dc91fb30…`     |
| `skillsCommands.ts`         | `4b5096bf…`     |
| `MuseCodeHost.ts`           | `b0dc0c3b…`     |

"e2e (chat)" is `test/e2e/museCode.e2e.test.ts`.

| Drill | What was broken                                                                          | Suites                                                                      | Result                                                                                                                                            |
| ----- | ---------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| CA    | P2-1: an abandoned probe gives its late answer to the caller that started it             | `cliAccount.test.ts`                                                        | exit 1, 2 failed; first "asks afresh after an unanswered probe is abandoned, and gives its late answer to no one"                                 |
| CB    | P2-1 sibling: a caller that joined an abandoned probe gets its late answer               | `cliAccount.test.ts`                                                        | exit 1, 1 failed: "gives the callers of a forgotten probe the newer answer, the one that joined it too"                                           |
| CC    | P2-1 sibling: an older refresh publishes over a newer one (no ticket)                    | `authService.test.ts`                                                       | exit 1, 1 failed: "never publishes an older refresh over a newer one"                                                                             |
| CD    | P2-1 sibling: a refresh while the device flow waits publishes over its code              | `authService.test.ts`                                                       | exit 1, 1 failed: "keeps the device code on screen through a refresh while the flow waits"                                                        |
| CE    | P2-2: a signed-out answer about a write is not remembered                                | `deviceSignIn.test.ts`                                                      | exit 1, 2 failed: "keeps the signed-out answer about a write when the host then exits", "… when account/read then cannot say"                     |
| CF    | P2-2: a host exit counts any file change as a sign-in, the refuted write included        | `deviceSignIn.test.ts`                                                      | exit 1, 1 failed: "keeps the signed-out answer about a write when the host then exits"                                                            |
| CG    | P2-2 sibling: an unanswered `account/read` falls back to a file change an answer refuted | `deviceSignIn.test.ts`                                                      | exit 1, 1 failed: "keeps the signed-out answer about a write when account/read then cannot say"                                                   |
| CH    | P2-3: the ending is logged with what the CLI sent, its message included                  | `deviceSignIn.test.ts`                                                      | exit 1, 7 failed; first "ends at once on the captured expired ending, logs it in fixed words, and sends no loginCancel"                           |
| CI    | P2-3 sibling: an uncovered ending word is logged whatever its shape                      | `deviceSignIn.test.ts`                                                      | exit 1, 1 failed: "logs an uncovered ending word only in the shape of one"                                                                        |
| CJ    | P2-3 sibling: any text passes as a protocol word                                         | `logText`, `cliAccount`, `accountHost`, `authService`, `deviceSignIn` tests | exit 1, 6 failed; first "logs an uncovered ending word only in the shape of one"                                                                  |
| CK    | P2-3 sibling: `CliAccount` logs the `account/read` state as sent                         | `cliAccount.test.ts`                                                        | exit 1, 1 failed: "logs the CLI’s state only in the shape of a protocol word"                                                                     |
| CL    | P2-3 sibling: an unconfirmed `account/logout` logs the state as sent                     | `accountHost.test.ts`                                                       | exit 1, 1 failed: "logs an unconfirming state only in the shape of a protocol word"                                                               |
| CM    | P2-3 sibling: `markAuthRequired` logs the backend’s reason as sent                       | `authService.test.ts`                                                       | exit 1, 1 failed: "logs an authRequired reason only in the shape of a protocol word"                                                              |
| CN    | P2-3 sibling: an MSP failure is logged by its message                                    | `logText.test.ts`, `MuseCodeHost.test.ts`                                   | exit 1, 2 failed: "names an MSP error by its kind and code, never its message", "logs a retried refusal and traces how long each command took"    |
| CO    | P2-3 sibling: a stderr line no capture covers is logged as written                       | `logText.test.ts`, `skillsCommands.test.ts`, e2e (chat)                     | exit 1, 4 failed; first "logs any other line by its length alone, one entry per line"                                                             |
| CP    | P2-3 sibling: the backend manager logs `muse serve` stderr as written                    | e2e (chat)                                                                  | exit 1, 2 failed: "reports a host that dies mid-turn and spawns a fresh one afterwards (drill)", "rejects when the binary will not start (drill)" |
| CQ    | P2-3 sibling: a failed `muse skills` command logs its stderr as written                  | `skillsCommands.test.ts`                                                    | exit 1, 1 failed: "says so when the CLI is missing, the list fails or cannot be read"                                                             |
| CR    | P2-3 sibling: a retried MSP refusal logs the CLI’s message                               | `MuseCodeHost.test.ts`                                                      | exit 1, 1 failed: "logs a retried refusal and traces how long each command took"                                                                  |

Drills CS to CY cover Codex's review of `1ae3604f` (below). They ran the
same way, on the final tree, from `scratchpad/cred-capture/drills5.mjs`
(`drills5-result.json`, `drills5.log`), all in `authService.test.ts`;
`authService.ts` matched its pre-drill SHA-256 after every drill.

| Drill | What was broken                                                                      | Result                                                                                                     |
| ----- | ------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| CS    | The one helper publishes a switch without ending the running backend first           | exit 1, 8 failed; first "ends the Model API conversation when a Cancel still lands a CLI sign-in"          |
| CT    | A refresh (Cancel, a failed sign-in, Check again, install) publishes past the helper | exit 1, 6 failed; first the same                                                                           |
| CU    | Key activation publishes past the helper                                             | exit 1, 1 failed: "ends the Muse Code conversation when a pasted key moves conversations to the Model API" |
| CV    | A failed install publishes past the helper                                           | exit 1, 1 failed: "ends the Model API conversation when a failed install finds the CLI signed in"          |
| CW    | A restart that ended every conversation leaves the old backend recorded as running   | exit 1, 1 failed: "ends conversations once: a sign-out leaves none for the next sign-in to end"            |
| CX    | A switch opens no new admission generation                                           | exit 1, 1 failed: "ends the Model API conversation when a Cancel still lands a CLI sign-in"                |
| CY    | The backend conversations run on is not recorded as states publish                   | exit 1, 8 failed; first "ends the Model API conversation when a Cancel still lands a CLI sign-in"          |

Drills CZ to DB cover the macOS-only CI failure on `1ae3604f` (below).
They ran the same way on this Windows machine, from
`scratchpad/cred-capture/drills6.mjs` (`drills6-result.json`,
`drills6.log`), and each target matched its pre-drill SHA-256 afterwards.

| Drill | What was broken                                                                      | Suites                                              | Result                                                                                                                                             |
| ----- | ------------------------------------------------------------------------------------ | --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| CZ    | The granted e2e expects `inline` from every OS's reading, as before (the CI failure) | e2e                                                 | exit 1, 1 failed: "signs in on the captured granted sequence", `AssertionError: expected 'unrecognized' to be 'inline'` (`repro-ci.mjs`), as in CI |
| DA    | The per-OS table drifts: macOS expected to read the file as holding the credential   | `credentialFile.test.ts`, `cliAccount.test.ts`, e2e | exit 1, 3 failed; first "signs in on the captured granted sequence"                                                                                |
| DB    | The macOS branch regresses: a version-1 file holding the credential settled on macOS | `credentialFile.test.ts`, `cliAccount.test.ts`, e2e | exit 1, 5 failed; first "signs in on the captured granted sequence"                                                                                |

Drills DC to DE cover Codex's review of `19e74b07` (below), from
`scratchpad/cred-capture/drills7.mjs` (`drills7-result.json`,
`drills7.log`); each target matched its pre-drill SHA-256 afterwards.

| Drill | What was broken                                                                               | Suites                | Result                                                                                        |
| ----- | --------------------------------------------------------------------------------------------- | --------------------- | --------------------------------------------------------------------------------------------- |
| DC    | A restart that ends conversations clears the running backend whatever was published meanwhile | `authService.test.ts` | exit 1, 1 failed: "keeps the backend a newer refresh signed in on when an older restart ends" |
| DD    | An older logout-hold write that fails late marks the hold unsaved                             | `authService.test.ts` | exit 1, 1 failed: "keeps the latest logout-hold write’s outcome when an older one fails late" |
| DE    | A probe about an older file version stays current when a newer one starts                     | `cliAccount.test.ts`  | exit 1, 1 failed: "keeps the newer file version’s answer when an older probe answers late"    |

Drills DF to DH cover Codex's review of `86d63652` (below), from
`scratchpad/cred-capture/drills8.mjs` (`drills8-result.json`,
`drills8.log`), all in `authService.test.ts`; `authService.ts` matched its
pre-drill SHA-256 afterwards.

| Drill | What was broken                                                                      | Result                                                                                                              |
| ----- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| DF    | A switch whose restart fails late publishes its failure over a newer state           | exit 1, 2 failed: "lets a newer refresh stand when an older switch’s restart fails late", "lets a sign-out stand …" |
| DG    | A finished sign-in whose restart fails late publishes its failure over a newer state | exit 1, 1 failed: "lets a newer refresh stand when a finished sign-in’s restart fails late"                         |
| DH    | A failed install publishes what it asked over a newer state                          | exit 1, 1 failed: "lets a newer state stand when a failed install’s question answers late"                          |

Drills DI to DK cover Codex's review of `55b9e24c` (below), from
`scratchpad/cred-capture/drills9.mjs` (`drills9-result.json`,
`drills9.log`), all in `authService.test.ts`; `authService.ts` matched its
pre-drill SHA-256 afterwards.

| Drill | What was broken                                                                               | Result                                                                                                                                                                    |
| ----- | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| DI    | A Cancel after the code, the file unchanged, is taken as nothing having happened (no refresh) | exit 1, 2 failed: "asks the CLI afresh on a Cancel after the code, when the Keychain alone changed", "reports the Cancel when the CLI, asked afresh, is still signed out" |
| DJ    | A Cancel after the code refreshes on the CLI’s answer from before the flow                    | exit 1, 2 failed: the same two                                                                                                                                            |
| DK    | A Cancel as the file changed reads it passively (estimated on macOS, not asked)               | exit 1, 1 failed: "asks the CLI about a file rewritten as Cancel was pressed, on macOS too"                                                                               |

## Codex on `328efb52`: forced Model API, and a same-account re-sign-in

- **P2, forced Model API.** With `museSpark.backend` set to `modelApi`,
  both the gate's refresh and host admission still asked the CLI for its
  sign-in. On an ambiguous file that can mean a probe and `account/read`,
  keeping a user with a stored key in `checking` until the MSP deadline.
  - Now `isCliSignInConsulted(setting)` in `src/core/backendSelection.ts`
    says the choice needs no CLI answer. `AuthService.choose` and
    `readBackendChoice`, which host admission in `extension.ts` now uses,
    ask nothing; the snapshot reports `hasCliSession: false`.
  - The logout hold's checks after a sign-out still look at the CLI, as a
    sign-out ends every credential.
  - Drills DN (the gate) and DO (host admission).
- **P2, same-account re-sign-in.** With the logout hold keeping an
  `accountLogin`, a macOS re-sign-in may replace only the Keychain item,
  the pointer's mtime unchanged. The first and the later `account/read`
  both said `accountLogin`, so after `granted` the flow waited until its
  backstop and never lifted the hold.
  - The captured success, `granted` borne out by `accountLogin`, now
    counts whatever came before; `granted` alone still never does.
  - Drill DP.
- **Drills** from `scratchpad/cred-capture/drills11.mjs` (each target
  matched its SHA-256 afterwards):
  - DN: exit 1, 1 failed: "selects from the stored key without asking the
    CLI".
  - DO: exit 1, 1 failed: "never asks for the CLI’s sign-in when the
    backend is forced to the Model API".
  - DP: exit 1, 1 failed: "signs in on granted and accountLogin when the
    account was already signed in".
- **Checks.** `backendSelection`, `authService`, `deviceSignIn`,
  `cliAccount` and the `cliAccount` e2e (207 tests), typecheck, lint,
  l10n, jscpd and format; not the full gate (the machine was loaded).

## Codex on `2a324d48`: a user action on macOS asks afresh

**P2.** On macOS a sign-in or sign-out made elsewhere may change only the
Keychain, leaving the file's path, size and mtime as they were.
`CliAccount.confirm` reused a remembered definitive answer even for a
user action, so Diagnostics (and any other click) could report a stale
sign-in.

- **Fixed in the class, not the call site.** On macOS a user action now
  reuses a remembered answer only if it came from the same click:
  younger than `MUSE_USER_ACTION_ANSWER_REUSE_MS`, 5 s. Otherwise it asks
  `account/read` afresh, bounded as before. "Never reuse" was taken
  literally at first and then bounded this way: a sign-out asks up to
  three times and a refresh with the hold on four, and each question may
  bring a Keychain prompt. Off macOS the file speaks for the sign-in, as
  before. The answer's age is read on an injectable clock (`now`).
- **Every user action takes that path.** Diagnostics
  (`cliAccount.signIn(true)`), Check again, Cancel, the sign-in button
  (with the hold on, and after the code), sign-out and the Sign Out
  command all ask with `isUserAction`. The browser sign-in's pre-check
  stays passive on purpose: it only looks for a file the host cannot
  start with, and must not prompt before the code is shown.
- **Drills.** From `scratchpad/cred-capture/drills10.mjs`, and each
  target matched its SHA-256 afterwards:
  - DL: macOS reuses any remembered answer. Exit 1, 1 failed: "on darwin,
    asks a later user action afresh only on macOS, the file unchanged".
  - DM: every question of one click asks again. Exit 1, 2 failed: the
    same, and "asks about a macOS Keychain pointer only on a user action".
- **Checks.** `cliAccount`, `authService`, `supportReport` and the
  `cliAccount` e2e (153 tests), typecheck, lint, l10n, jscpd and format;
  not the full gate (the machine was loaded).

## Codex on `55b9e24c`: a Cancel after a Keychain-only approval

**P2.** On macOS an approval may update only the Keychain, the pointer
file's mtime unchanged. If Cancel won before the device host's next
`account/read`, `finishCancelledCliSignIn` reported `signedOut` and kept
the CLI's answer from before the flow, although the login had landed.

- **Fixed.** A Cancel after the code was shown (`flow.isCodeShown`, set as
  the code is published), with the file unchanged, forgets the CLI's
  answers. `finishFailedCliSignIn` then shows the cancellation at once and
  refreshes as a user action. On macOS that asks `account/read` afresh, a
  question bounded by the account host's deadline and by the sign-out
  signal. The refresh publishes through `publishSelection`'s guards, with
  "Sign-in cancelled." as a notice (DI, DJ). A Cancel before any code
  still ends as it did, with no question.
- **Sibling.** When the file had changed as Cancel was pressed, the
  refresh was passive, so on macOS the new file was estimated (`unknown`),
  not asked. A Cancel is a click, so it asks now (DK).
- **Swept, left as they were.** Other places where an unchanged file may
  hide a Keychain change:
  - the device flow's polls ask `account/read` on the same host (with no
    first answer, `granted` counts);
  - a sign-out, a completed sign-in and Check again forget the CLI's
    answers;
  - a passive refresh keeps the cached answer by design: on macOS the CLI
    is asked only on a user action.
- **Checks run, and not the full gate** (the machine was still loaded):
  `authService`, `cliAccount`, `conversationController` and the
  `cliAccount` e2e (389 tests), typecheck, lint, l10n (0 problems), jscpd
  (0 clones) and format all passed. The full gate is CI's three-OS run on
  the pushed commit.

## Codex on `86d63652`: error paths after an await

**P2.** When `publishSelection`'s restart rejected late, its catch branch
published `signOutStopFailed` with a new ticket. That skipped the
`ticket < publishedTicket` and `isCurrent()` guards the success path uses,
so a stale attempt overwrote a newer state (a newer refresh, or a
sign-out) and closed admission. The previous sweep had covered success
paths only.

- **Fixed.** The failure is published under the same guards, with the
  refresh's own ticket (DF: a newer refresh and a sign-out).
- **Re-sweep: every catch, finally and error path after an await in
  `AuthService`, `CliAccount`, `runDeviceSignIn` and `accountHost`.**
  - **`confirmCliSignIn`.** A finished sign-in's restart that rejected
    reached `finishFailedCliSignIn` and published `signInFailed` with a
    fresh ticket, over a refresh published meanwhile. The restart is now
    guarded: if anything was published after the flow's last own
    publication, the newer state stands (DG).
  - **`installFailed`**, the install's error path. It published the
    selection it awaited even when a newer state was published while it
    asked. It now takes a ticket before asking (DH).
- **Checked, left as they were.**
  - `setLogoutHold`'s catch is guarded (DD).
  - `stopBackendForSignOut`, `performSignOut`'s key-clear catch and
    `logOutCli`'s terminal catch publish nothing; the one sign-out that
    owns them publishes its own result.
  - The `finally` blocks (`joinDeviceSignIn`, `awaitDeviceRunner`,
    `signInWithCli`, `checkAgain`, `installMuseCode`, `signOut`,
    `performSignOut`) reset single-writer or identity-guarded fields.
  - `signInWithCli`'s catch for a failure before `confirmCliSignIn` runs
    while the flow owns the panel, where no refresh publishes; a sign-out
    is guarded by `isSigningOut`.
  - `CliAccount.confirm`'s `finally` is identity-guarded, and a rejected
    probe writes nothing.
  - `runDeviceSignIn`'s error paths (`connect`, `cancelLogin`, `hostGone`,
    `finally` closing its own session) touch only its own locals.
  - `accountHost`'s catches (`onAccountHost`, `requestAccount`,
    `connectAccountSession`) log and return a fallback, and share no
    state.
- **Checks run, and not the full gate.** The machine was still loaded by
  other worktrees' gates, so, as the coordinator asked, only the touched
  suite (`authService.test.ts`, 103 tests), `npm run typecheck`,
  `npm run lint`, `npm run check:l10n` (0 problems),
  `npm run duplication` (0 clones) and `npm run format:check` ran. All
  passed. The full gate is CI's three-OS run on the pushed commit.

## Codex on `19e74b07`: shared state written after an await

**P2.** `restartHosts(true)` cleared `liveBackend` after awaiting the
restart. A newer refresh could publish a signed-in state during that await
and record its backend; the late clear erased it, so a later switch
bypassed `isBackendSwitch` and left that backend's conversations running.

- **Fixed with a guard.** Clearing before the await would leave
  `liveBackend` empty after a failed restart, while conversations still
  run. Instead, `set()` moves `liveVersion` each time it records a
  backend; `restartHosts` captures it before the await and clears only if
  it is unchanged (DC).
- **Siblings: every field in `AuthService`, `CliAccount` and
  `runDeviceSignIn` written after an await.**
  - `isLogoutPersistenceFailed`, set when a logout-hold write settles. An
    older write that failed late marked the hold unsaved after newer
    writes were saved, which shut admission. Only the latest write's
    outcome is kept now (`holdWrites`; DD).
  - `CliAccount.answered`. A probe about an older version of the file was
    not abandoned when a probe for the newer version started (round 5's
    abandon flag replaced the identity check), so its late answer could
    overwrite the newer one. Starting a probe now abandons the one it
    replaces (DE).
- **Checked, left as they were.** These are single-writer by construction:
  - `deviceSignIn`, `installPromise` and `checkingAgain` are cleared after
    their await, but every other caller joins the running promise, so none
    writes meanwhile;
  - `deviceAbort` and `isDeviceFlowWaiting` belong to the one device flow
    `joinDeviceSignIn` allows;
  - `isSigningOut` and the epoch's move at the end belong to the one
    sign-out `signOut` joins;
  - `signOutPromise` and `CliAccount.asking` are cleared only if still
    theirs.

  `admissionGenerationValue` and `signOutEpoch` only increase, so no write
  is lost. `snapshot` goes through the tickets and epochs, and
  `runDeviceSignIn`'s `refutedWrite` is written by its one polling loop.

- **The gate did not pass locally.** `npm run quality` ran four times on
  the working tree (Windows 11, 2026-09-28, after drills DC to DE), and
  each run **exited 1**. No failure was in a suite this pass touched. The
  machine was loaded by other worktrees' gates (m67, m68 and m69, running
  since about 03:00 with accessibility runs that looked hung, and m79's):
  about 90 Chrome and 38 Node processes. Nobody could stop them.
  - Run 1: `test:a11y`, two pages (`dark/tools`, `dark/approval`) without
    a result after Chrome's network service crashed; 0 rules violated.
    The unit tests passed (2,717).
  - Run 2: `toolIo.test.ts` "kills a hook that exceeds its per-stream
    output limit" (`isTimedOut` true). Run alone, it also failed once in
    four.
  - Run 3: that test again, and `mcpProcess.test.ts` "receives a real
    server’s final response before its immediate exit closes stdio".
  - Run 4 (after waiting 40 minutes for the other gates): 12 tests in
    `processTree`, `mcpPool`, `mcpProcess`, `toolIo`, `shellQuote` and
    `worktreeCommands`; 2,705 passed.

  What passed: the touched suites (`authService`, `cliAccount` and the
  `cliAccount` e2e, 139 tests), `npm run typecheck`, `npm run lint`,
  `npm run check:l10n` (0 problems), `npm run duplication` (0 clones) and
  `npm run format:check`. The full gate for this commit is CI's three-OS
  run on the pushed commit.

## macOS CI on `1ae3604f`: expectations per OS

CI failed on `macos-latest` only. Two e2e tests read a real credential file
on the host OS and expected `inline`:

- `cliAccount.e2e.test.ts` "signs in on the captured granted sequence";
- `museCode.e2e.test.ts` "spawns the configured binary … and sees the
  credential file".

On macOS that file is `unrecognized` since W2: no version-1 file holding
the credential was captured there, so the CLI is asked. The code was
right; the tests hard-coded the Windows and Linux reading.

- **The table.** `capturedInlineVerdict(platform)` in
  `test/unit/helpers/credentialShapes.ts` gives the verdict the captured
  inline shapes get on each OS. `credentialFile.test.ts` pins it for all
  three OSes against the read, so a wrong macOS expectation fails on any
  runner.
- **The tests.**
  - The granted e2e now reads the file the sign-in left as each OS reads
    it (`SHIPPED_PLATFORMS`), so every runner checks macOS's branch.
  - The chat e2e expects the host OS's entry.
  - `cliAccount.test.ts` reads a real file as each OS does.
- **Reproduced here.** Drill CZ puts the old expectation back and fails on
  Windows with CI's message (`repro-ci.mjs`). The Mac mini was not needed:
  the branch is keyed on the platform argument, which the tests pass.
- **The gate.** `npm run quality` on the working tree (Windows 11,
  2026-09-28, after drills CZ to DB) exited 0 on its first run:
  - 180 files passed and 2 skipped; 2,714 tests passed and 23 skipped;
    statements 94.56 %;
  - `check:l10n` 0 problems; jscpd 0 clones;
  - `dist/extension.js` 442.6 KiB of 600;
  - a11y 0 rules violated; audit 0 advisories;
  - gitleaks no leaks; Semgrep 0 findings.

  macOS itself runs in CI after the push.

## Codex on `1ae3604f`: one way to switch backends

**P2.** With the Model API signed in, a Cancel pressed just after the
browser approved let the file decide: its refresh published Muse Code
signed in without a new admission generation or a restart, so the Model
API conversation kept running after the panel switched.

- **Fixed.** One helper publishes every state that could sign in on
  another backend than conversations run on:
  `AuthService.publishSelection`. It opens a new admission generation,
  shows `checking`, ends the running backend's conversations
  (`restartBackend(true)`) and then publishes, if nothing newer has. A
  stop that fails is `error` (`signOutStopFailed`).
- **Where it runs.** Every refresh goes through it (via `publishRefresh`),
  and so do the paths that publish through a refresh:
  - Check again;
  - a Cancel that still landed a sign-in;
  - a failed or timed-out sign-in with the hold on or a Model API session;
  - a device sign-in's confirmation;
  - CLI discovery after an install. Its own copy of this logic is gone;
  - a changed `museSpark.backend`, whose refresh (after the extension's
    own restart that keeps conversations) now ends the old backend's
    conversations when the backend changes.

  So do the two paths that published a selection directly: key activation
  and a failed install.

- **Which backend is running.** `liveBackend` is the backend of the last
  signed-in state published, and any restart that ends conversations
  clears it (`restartHosts`). That covers a sign-out and a device
  sign-in's own restart, so no conversation is ended twice.
- **Checked, left as they were.** These never publish a signed-in state,
  so they cannot switch backends: the sign-out and a refresh during it
  (`error`), Cancel's own state, the window closing, `markAuthRequired`,
  `markBackendError`, and the device flow's code. The installer's
  "keep the Model API signed in" state keeps the same backend.
- **Tests.** `authService.test.ts` "a switch of backends ends the running
  one’s conversations first" (six cases), and the installer auto-switch
  tests that already existed.

## Codex on `886af682`, and the sibling sweep

Codex reviewed `886af682` on PR #49 and raised three P2s. Each was fixed,
and every sibling of its class across `src/host/auth` and
`src/core/backends/musecode` (and the two places that log Muse Code's
stderr, `museCodeBackendManager.ts` and `skillsCommands.ts`) was fixed in
the same pass.

**P2-1, stale answers.** `forgetAnswers()` and `abandonProbe()` cleared
`this.asking`, but the abandoned promise still returned its answer to
whoever awaited it, so a passive refresh could publish an older answer
after Check again's newer one.

- **Fixed.** A probe carries `isAbandoned`; its starter and everyone who
  joined it get `OBSOLETE` instead of the answer and look again, which
  finds the newer remembered answer or joins the newer probe (bounded by
  `MUSE_CREDENTIAL_READ_ATTEMPTS`). Test: `authService.test.ts` "publishes
  no answer from a probe Check again left behind" (the finding's own
  sequence over a real file), `cliAccount.test.ts`.
- **Siblings.**
  - The joiners of an abandoned probe got its answer too (CB).
  - Any two refreshes could publish out of order, for example a refresh
    that read SecretStorage before a key was pasted. Every refresh now
    takes a ticket as it starts and publishes only if nothing newer has
    (CC).
  - A refresh while the browser sign-in waited (a setting change) wiped
    its code off the panel. The flow now owns the panel until the device
    runner returns (CD).
- **Checked, left as they were.** `activateApiKey`, the install path and
  `signIn` check the sign-out epoch after each await. `confirmCliSignIn`
  races the flow's signal, and concurrent sign-outs join one. The device
  flow reads the file before each `account/read`, so an answer is never
  matched to a later write.
- **A cost of the fix.** A probe Cancel abandoned while the sign-in's
  pre-check waited on it makes that orphaned caller look again, which can
  start one more short-lived account host. None starts once the window
  has closed, and the three read attempts bound it.

**P2-2, a host exit read as success.** If a poll saw `loggedOut` for a
write another Muse process made and the host then exited, R7's exit
branch turned that same write into `signedIn`.

- **Fixed.** A signed-out answer records the file's modification time as
  a refuted write (read before the question, so an answer refutes only a
  write it saw). Only a write no answer refuted counts.
- **Sibling.** A later `account/read` that could not answer (the host
  going away rejects it) fell back to the same refuted write. It now uses
  the same rule (CG).
- **Checked, left as they were.** `probeAccount` and `logOutAccount` read
  a closed host as `unknown` or `unconfirmed`, never success. A Cancel
  after a file change lets the file's structure decide. `stoppedEarly`
  (an exit before the code) fails. `connectAccountSession` throws.

**P2-3, free text in the log.** For `expired` and `denied` the outcome was
allowlisted, but the CLI's message was logged as sent: `clipForLog` only
shortens, and the redactor catches only key-shaped strings.

- **Fixed.** Each captured ending is logged in fixed words, and the
  schema no longer keeps the message.
- **Siblings,** with helpers `wireWordForLog` (`src/core/logging.ts`) and
  `failureForLog` and `stderrForLog`
  (`src/core/backends/musecode/logText.ts`):
  - an uncovered ending word (CI);
  - the `account/read` state in `CliAccount` (CK) and in `logOutAccount`
    (CL);
  - `markAuthRequired`'s reason (CM);
  - the MSP error messages in three `MuseCodeHost` logs (a retried
    refusal, `task/stopAll`, `approval/listPending`; CN, CR);
  - `muse serve` stderr and its two close errors in the backend manager
    (CO, CP);
  - `muse skills` stderr (CQ).

  Stderr lines 1.4.0-R4302.1 was captured writing (an unsupported schema
  version, an unreadable Keychain item, a failed model-catalog fetch) are
  named in fixed words. Any other line is named by its length alone, so
  the log no longer shows an unrecognized CLI error; the panel still shows
  what it showed.

- **Checked, left as they were.**
  - `describeExit` is fixed words and an exit code.
  - `MuseCodeHost`'s own dispatch exceptions (`String(error)`) come from
    the extension's own code.
  - The SDK's protocol-error text is its own, and logged by kind.
  - `accountHost` logs an error's name only.
  - The backend manager's spawn line (the CLI path the extension resolved)
    and its `museHome` (a structured path the CLI reports) are M39's
    deliberate facts, not free text. Both name the user's profile folder,
    which is the owner's call.

This pass added no UI string.

## Not proved here

A real sign-in is the owner's to give, and each of these needs one:

- **A 1.4.0 macOS device login.** It should write the Keychain item and a
  schema-2 pointer. The pointer's mtime should change on a same-account
  re-login, which is the device flow's third signal.
- **Keychain prompts.** Whether one appears after a CLI update (a new
  binary path), and what `account/read` says with the item present but the
  Keychain locked (Remote-SSH into a Mac).
- **Linux R4302.1.** Whether a device-code login persists to the file as
  it does on Windows.
- **macOS 1.4.0 and a version-1 or empty version-2 file.** Whether it
  reads or migrates a version-1 file holding the credential, and what it
  does with an empty version-2 file. The extension asks the CLI about both
  there.
- **macOS and `META_API_KEY`.** The files the key was seen to rescue were
  probed on Windows and Linux only.

Captured since the first version of this list, on Windows R4302.1: the
success sequence (`granted` against `account/read`, `account/changed` and
the file), a declined code, a failed save, and the logout of an OAuth
login slot, which left the same empty file and logged
`credential.revoke` with outcome `revoked` (above). On Linux R4302.1
(review round 4): `muse serve` refuses a version-2 file there as it does
on Windows, and a version-1 Keychain lane too, and starts with each while
`META_API_KEY` is set.

## The gate

Run on the working tree (Windows 11, 2026-09-27), before the commit:

- `npm run test:unit` (after the size trims below): 177 files passed and 2
  skipped; 2,583 tests passed and 23 skipped; coverage thresholds met.
- `npm run typecheck`, `npm run lint`, `npm run format:check`,
  `npm run check:l10n` (14 tables, 0 problems), `knip`, `npm run cycles`
  and `npm run duplication` (0 clones): all exit 0.
- `npm run build`: **fails the D6 host budget**. `dist/extension.js` is
  602.7 KiB against 600 KiB; `main` was 596.8 KiB. The fix adds about
  6.0 KB minified:
  - the account host helpers, about 2.1 KB;
  - the CLI account check, about 1.6 KB;
  - the AuthService changes, about 0.9 KB;
  - the structural read, about 0.5 KB;
  - four strings, about 0.5 KB;
  - the constants, about 0.4 KB.

  Sharing one host lifecycle between the probe and the logout, a lookup
  in place of a switch, one verdict accessor and plain words in
  Diagnostics already took 0.85 KB off. The budget was not raised (AGENTS.md
  rule 2): raising it, or a size cut elsewhere in the host bundle, is the
  owner's decision.

After the fix was joined with M57 (the Model API backend in its own bundle,
`dist/extension.js` down to about 425 KiB) and M58, `npm run quality` on
`2a4f0db` exited 0:

- `check:l10n` 14 tables, 0 problems; jscpd 0 clones;
- vitest: 179 files passed and 2 skipped; 2,605 tests passed and 23
  skipped; statements 94.47 %;
- build: `dist/extension.js` 434.9 KiB of 600, `dist/modelApi.js` 297.2 KiB
  of 400, the bundle-split check passed;
- a11y: 336 pages, 0 rules violated;
- gitleaks: no leaks; Semgrep: 287 rules on 416 files, 0 findings.

The budget question above is settled by M57; no budget was raised.

With the PR #49 review fixes, `npm run quality` on the working tree
(Windows 11, 2026-09-27, before the commit) exited 0:

- `check:l10n` 14 tables, 0 problems; knip and dpdm clean; jscpd 0 clones;
  PSScriptAnalyzer 0 findings;
- vitest: 179 files passed and 2 skipped; 2,619 tests passed and 23
  skipped; statements 94.47 %;
- build: `dist/extension.js` 434.8 KiB of 600, `dist/modelApi.js`
  297.1 KiB of 400;
- a11y: 336 pages, 0 rules violated; audit 0 advisories;
- gitleaks: no leaks; Semgrep: 287 rules on 416 files, 0 findings.

gitleaks and Semgrep read tracked files only. The two new fixtures and
their helper were scanned on their own first (`gitleaks dir`: no leaks),
and again after the commit.

With the third review round's fixes, `npm run quality` on the working tree
(Windows 11, 2026-09-27, after the drills, before the commit) exited 0:

- `check:l10n` 14 tables, 93 manifest strings, 0 problems; knip and dpdm
  clean; jscpd 0 clones; PSScriptAnalyzer 0 findings;
- vitest: 179 files passed and 2 skipped; 2,659 tests passed and 23
  skipped; statements 94.48 %;
- build: `dist/extension.js` 438.2 KiB of 600, `dist/modelApi.js`
  297.2 KiB of 400, the bundle-split check passed;
- a11y: 336 pages, 0 rules violated; audit 0 advisories;
- gitleaks: no leaks; Semgrep: 287 rules on 416 files, 0 findings.

The three new fixtures (`account-login-granted.json`, `-denied.json`,
`-failed.json`) and `test/unit/helpers/credentialShapes.ts` were untracked
during that run, so they were scanned on their own (`gitleaks dir`: no
leaks). The label and avatar address in the granted fixture are the
stand-ins `someone@example.com` and `https://example.com/avatar.png`.

With the fourth round's fixes, `npm run quality` on the working tree
(Windows 11, 2026-09-27, after drills BK to BZ, before the commit) exited
0:

- format, lint (PSScriptAnalyzer 0 findings), all five typechecks;
  `check:l10n` 14 tables, 93 manifest strings, 0 problems; knip and dpdm
  clean; jscpd 0 clones;
- vitest: 179 files passed and 2 skipped; 2,685 tests passed and 23
  skipped; statements 94.53 %;
- build: `dist/extension.js` 440.3 KiB of 600, `dist/modelApi.js`
  297.2 KiB of 400, the bundle-split check passed;
- a11y: 336 pages, 0 rules violated; audit 0 advisories;
- gitleaks: no leaks; Semgrep: 287 rules on 416 files, 0 findings.

`test/e2e/` on its own: 2 files passed (the 14 `cliAccount.e2e.test.ts`
tests among them) and the 2 opt-in live files skipped. This round added no
fixture; the probe outputs stay in the scratchpad.

With Codex's review of `886af682` settled, `npm run quality` on the working
tree (Windows 11, 2026-09-28, after drills CA to CR, before the commit):

- **First run: exit 1.** One test in a suite this pass did not touch,
  `dictationHost.test.ts` "gives the helper its environment on top of the
  host’s (M26)", hit vitest's 5 s timeout under the full parallel load.
  Run alone three times, the suite passed each time (12 of 12, about
  3.5 s).
- **Second run: exit 0.**
  - format, lint (PSScriptAnalyzer 0 findings), all five typechecks;
    `check:l10n` 14 tables, 93 manifest strings, 0 problems; knip and dpdm
    clean; jscpd 0 clones;
  - vitest: 180 files passed and 2 skipped; 2,704 tests passed and 23
    skipped; statements 94.54 %;
  - build: `dist/extension.js` 442.0 KiB of 600, `dist/modelApi.js`
    297.2 KiB of 400, the bundle-split check passed;
  - a11y: 336 pages, 0 rules violated; audit 0 advisories;
  - gitleaks: no leaks; Semgrep: 287 rules on 417 files, 0 findings.

`logText.ts` and `logText.test.ts` were untracked during that run; they
hold no secret (synthetic paths and addresses only).

With the backend switch settled (Codex on `1ae3604f`), `npm run quality`
on the working tree (Windows 11, 2026-09-28, after drills CS to CY, before
the commit) exited 0 on its first run:

- format, lint (PSScriptAnalyzer 0 findings), all five typechecks;
  `check:l10n` 14 tables, 0 problems; knip and dpdm clean; jscpd 0 clones;
- vitest: 180 files passed and 2 skipped; 2,710 tests passed and 23
  skipped; statements 94.56 %;
- build: `dist/extension.js` 442.6 KiB of 600, `dist/modelApi.js`
  297.2 KiB of 400, the bundle-split check passed;
- a11y: 336 pages, 0 rules violated; audit 0 advisories;
- gitleaks: no leaks; Semgrep: 287 rules on 417 files, 0 findings.
