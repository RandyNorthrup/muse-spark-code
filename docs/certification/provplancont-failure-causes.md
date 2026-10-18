# PROVPLANCONT: every path behind the two ChatGPT plan-route sentences

Live symptom (owner PC, published ACP 0.18.2, plan 94% weekly limit left):
an app lane got no session, `providers status chatgpt` and `providers add
chatgpt` printed one generic sentence each. Nothing listened on local ports
1450-1460; auth.openai.com:443 was reachable.

The two observed sentences map to these paths. "Now" is this worktree
(snapshot 6ccc17497 of the stopped PROVPLAN agent on top of 7f20d37bb).

| #   | Observed sentence                                                                   | Code path                                                                                              | Condition that reaches it                                           | Real cause it hid                                                                                                     | Now                                                                                       |
| --- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| 1   | `ChatGPT is temporarily unavailable. Try again.`                                    | `withChatGptRefreshLock` catch-all (`src/runtime/chatGptRefreshLock.ts:46`)                            | any untyped error from the work under the grant lock                | store read threw, discovery/token fetch threw, callback failed                                                        | names its codes: `request-failed` + `failureCodeNames` (fixed in snapshot)                |
| 2   | same                                                                                | `ChatGptSignIn.guard` / `request` catch-all (`src/core/providers/subscriptions/chatgpt.ts:415,455`)    | any untyped error in sign-in or token HTTP                          | Node network codes, HTTP status                                                                                       | named (`HTTP {status}`, `TypeError: ENOTFOUND`, …; fixed in snapshot)                     |
| 3   | same                                                                                | host preparation catch (`src/runtime/chatGptHost.ts:139`)                                              | untyped failure opening the lock or reading the host id             | local file/lock problem (`EACCES`, …)                                                                                 | `local-failed` + OS code (fixed in snapshot)                                              |
| 4   | same                                                                                | OS-store refusal (`src/runtime/chatGptHost.ts:26`, `src/host/providers/chatgptSignIn.ts:267`)          | SecretStorage / Credential Manager refuses get/store                | store down, locked, or size refusal (F14/F78)                                                                         | `store-unavailable` (fixed in snapshot)                                                   |
| 5   | same                                                                                | `createRuntimeChatGptHost` / VS Code `createChatGptSignIn`                                             | host-id entry corrupt, lock dir unusable, listener bind fails       | `host-id-unreadable`, `lock-unavailable`, `local-failed: listen`                                                      | each its own sentence (fixed in snapshot)                                                 |
| 6   | same                                                                                | plan refusal, empty/unparseable body (`src/core/providers/subscriptions/registry.ts:283`)              | non-503 refusal with no error envelope and no admission detail      | the HTTP status (e.g. 429/500 with empty body)                                                                        | FIXED in this lane (commit below)                                                         |
| 7   | same                                                                                | plan 503 / documented retry codes (`registry.ts:270`) and retryable stream events (`registry.ts:635`)  | OpenAI answers 503 or a documented retry code                       | OpenAI says try again (`subscription_sharing_usage_unavailable`, …); turn retries bounded                             | correct as-is                                                                             |
| 8   | `ChatGPT sign-in could not be completed. Try again or remove it and sign in again.` | old `acpChatGpt.failure` catch-all (0.18.2 app lane / `openBrowser` reject, `src/runtime/backends.ts`) | any session-side sign-in failure                                    | grant unreadable, refresh refused (`invalid_grant`), store down, providers file bad                                   | replaced by per-cause sentences (snapshot); `openBrowser` reject is `browser-unavailable` |
| 9   | `That did not work (the Muse Spark log has the details).`                           | session client file read (`src/runtime/chatGptProviderCommands.ts:64`)                                 | providers file unparseable/invalid when a session builds its client | `unparseable` vs `invalid`                                                                                            | FIXED in this lane (commit below)                                                         |
| 10  | same as 9                                                                           | Models panel `fail()` (`src/host/models/modelsPanel.ts:212`)                                           | a NON-`ChatGptSignInError` escapes the ChatGPT flow                 | n/a: sign-in core and both hosts convert everything to typed errors; the generic is the credential-redacting boundary | keep; unreachable for this flow                                                           |

Causes with their own sentence already (each names its cause):
grant lock held by another process (`lock-busy`); lock cannot open
(`lock-unavailable` + OS code); wait cancelled (`cancelled`); no stored
grant (`not-signed-in` / `signed-out`); stored grant unparseable
(`grant-unreadable`); registration unparseable (`registration-unreadable`);
refresh token refused (`sign-in-required` + OpenAI code, e.g.
`invalid_grant`); saved client refused (`client-refused`); wrong account
(`account-mismatch`); plan scope missing (`missing-plan-scope`);
authorize denied (`authorize-refused` + OpenAI code, e.g.
`access_denied`); browser/callback/timeout/state/token/id-token faults;
catalogue refused/unreadable/empty (`catalogue-*` + `HTTP {status} {code}`);
plan limit (`limitDetail`); plan ineligible (`notEligible`);
providers file unreadable/unwritable (+ reason); short-lived refresh
(`expired`); request build refusal (`requestNotBuilt` + reason);
network/HTTP (`request-failed` + status or Node codes).

Notes: the named grant lock replaced the old fixed TCP port (af0968e06),
so "nothing on 1450-1460" is expected, not a fault. The `fix/chatgpt-grant-lock`
branch is not present in this clone; its content is the named-lock work above.
With the plan 94% unspent, quota is excluded; the remaining suspects for the
owner's PC are rows 4/5 (store/lock/listener), `sign-in-required invalid_grant`
(token refresh refused), and `grant-unreadable` — the new sentences tell them apart.

## What the lead runs on the owner's PC (no stored grant on this rig)

1. Install the build with rows 6 and 9 fixed.
2. `muse-spark-code-acp providers status chatgpt` — read the sentence:
   `store-unavailable` = unlock/start the OS credential store (Linux: Secret Service);
   `lock-busy` = another window/process holds the grant lock, wait and retry;
   `lock-unavailable (E…)` / `local-failed (E…)` = local file/lock fault with the OS code;
   `grant-unreadable` = stored grant corrupt, remove and sign in again;
   `sign-in-required (invalid_grant)` = OpenAI refused the refresh, sign in again.
3. `muse-spark-code-acp providers add chatgpt` — a sentence before any
   browser step now names discovery/store/listener faults instead of retry;
   `callback-timeout` = no browser answer in time; `authorize-refused
(access_denied)` = denied in the browser; `account-mismatch` = wrong account.
4. Never dump the stored grant or a key: the sentence already says which of
   the above it is. If the sentence is still the retry one, copy it with the
   command and the journal around it — that is the remaining bug.

## Fixes in this lane (commit below)

1. Empty plan refusal names its HTTP status
   (`src/core/providers/subscriptions/registry.ts`, `planRequestError`,
   now exported for the test). Proof: `test/unit/chatgptPlanErrors.test.ts`
   drives the real function with real `Response` objects — HTTP 500 with an
   empty body reads "The ChatGPT plan request failed: HTTP 500"
   (failed before the fix with the retry sentence); empty 503 keeps the
   retry sentence; the captured 400 keeps OpenAI's message.
2. A session names its unreadable providers file
   (`src/runtime/chatGptProviderCommands.ts`). Proof:
   `test/unit/chatGptLocalFailures.test.ts` drives the real command layer
   with a real corrupt temp file — `unparseable` and `invalid` each read
   "The providers file could not be read ({reason})" (failed before with
   "That did not work"). The wrapped Meta client is a tripwire, never
   consulted; secrets are the real product memory store; PLAN.md §8 holds
   the cast row.
3. The packed agent no longer crashes where the account check fails
   (`src/host/backend/subscriptionsEntry.ts` re-exports `chatGptFailureOf`;
   the snapshot's `src/runtime/backends.ts` already called it). Proof: the
   bundle-split gate fired before
   ("runtimeEngine.js reads chatGptFailureOf from subscriptions.js, which
   does not export it") and passes after; `dist/subscriptions.js` carries
   the export.
4. A garbage host-identifier file in the editor reads as that
   (`src/host/providers/chatgptHostId.ts`: `invalid-token` →
   `host-id-unreadable` with the file name). Proof: the snapshot's own
   `test/unit/chatGptHostId.test.ts` case was red before and passes after;
   it finishes the half of the snapshot the stopped agent left undone.

## PR180TRUTH (2026-10-17): what real use and hosted CI found on 183ac75674

Branch `fix/plan-review-truth`, from `origin/fix/plan-review` at
`183ac75674`. `origin/main` (`81dacaf5a7`) is already this branch's merge
base, so `git merge origin/main` has nothing to take yet; it is repeated
before the last commit.

### Hosted CI causes (CI run 39086390519, Hosts run 39086390489)

Read with `gh run view --job <id> --log-failed` (read-only), each failed job:

| Job                                                   | Measured cause                                                                                                                                                                                                                                     |
| ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| tests (ubuntu-latest, shard 4)                        | `test/unit/runtimeChatGptLock.test.ts`: 4 failed. `serializes callers`, `releases after a thrown operation`, `recovers after the owner crashes` time out at 5000 ms; `takes the lock past a dead socket entry` rejects `chatgpt.lock-busy`.        |
| tests (windows, macos) in the capacity repository     | Its run 39086430315 failed on macOS only: shard 8 is the same lock file (4 failed, incl. `old fixed TCP port` → `lock-busy`, `recovers` → 0 entries), shard 5 is `test/unit/namedLockRace.test.ts` timing out at 180000 ms. Windows shards passed. |
| universal release artifacts; Hosts `packages`         | `scripts/check-vsix-size.mjs`: "VSIX is 3800805 bytes; budget is 3788800 bytes (3700 KiB)", 12,005 bytes over. PRs on the same main pass this job (e.g. `chore/no-standins`, run 39090625665), so the growth is this branch's.                     |
| package (.vsix); dictation helper (macos); quality ×3 | No failure of their own: each is the gate step `test "$UNIT" = success` etc., failing on `UNIT: failure`, `ORG: failure`, `PACKAGES: failure` from the rows above.                                                                                 |

Lock cause, from the logs: every failing case binds a Unix socket under
`<repo>/temp/m95b-x-lock-XXXXXX/<case>-XXXXXX/grant.lock.<pid>.<6 hex>`
(or `<repo>/temp/named-lock-race-XXXXXX/work/…`). The failures split by that
path's length against `sockaddr_un` (108 usable bytes on Linux, 103 on
macOS): on Linux (repo root 49 bytes, a 4-digit pid) the `live-` and
`port-` cases are 108 bytes and pass, `crash-` and `stale-` are 109 and
`serial-` and `thrown-` 110, and those fail; on macOS (repo root 56 bytes,
5 fewer usable) every binding case fails. The CI symptom is `lock-busy`, not
`EINVAL`: Node 22 bound the over-long path truncated, so the contender's own
entry showed up in `readdir` under a name that is not its own, live (its
own listener), and it gave way to itself forever: timeouts without a
deadline, `lock-busy` with one. That is exactly the failure set. The
product's lock root is `/tmp/<folder>` (`src/runtime/namedLock.ts:231`),
short, so only the tests' long folders reach it.

Measured on this Windows PC's WSL (Arch, Node 26.9.0), `temp/sockprobe.mjs`
binding one socket at each total path length: 100-108 bytes reach the file
system (`ENOTSUP`, sockets are refused on the Windows-mounted drive), 109,
110 and 112 bytes are refused with `EINVAL` before it. So Linux's limit is
108 bytes, matching the split above. Node 26 refuses where CI's Node 22
truncated; the truncating bind itself is UNMEASURED here (no Node 22 in
WSL), read from the CI symptom. The POSIX suites cannot run on this PC (no
socket on the mounted drive): hosted CI is their gate.

### Plan for findings 1-3 (real use of the packed agent)

1. Broken providers file → "credential store cannot be used". The
   providers-file reader in `createConfiguredProviderServices`
   (`src/core/providers/configured.ts:375-381`) throws `RangeError(zod
detail)` for `invalid` and `ModelApiError(actionFailed)` for
   `unparseable`; `isInvalidProvidersFileError` (`src/acp/accountText.ts:37`)
   looks for the `AccountStoreError` brand, so the account check in
   `src/runtime/backends.ts:683-690` falls back to `acpStoreUnavailable`.
   Fix: the reader throws the providers-file error type
   (`AccountStoreError('invalidProvidersFile')`) whose message is
   `acpChatGpt.providersFileUnreadable` filled with the reason
   (`unparseable` / `invalid`), and the account check returns that message.
2. The sentence must be the error message an editor shows, not
   `data.details` under "Internal error": trace where an `unavailable`
   readiness becomes an ACP error and give that error the sentence as its
   message.
3. `providers list` prints "Test failed: {detail}": the call sites
   (`src/runtime/providersCommands.ts:155`,
   `src/runtime/exec/providerExec.ts:447`) fill `{ reason }` while the key's
   template says `{detail}`. Fix the placeholder in one place so every
   table and every call site agree, and check every translated table carries
   the same name.

Each fix is proven by driving the packed agent (`node dist/acp.js`) with a
real broken providers file in an empty workspace, plus a unit test over the
real modules where one adds meaning; each new test is broken once on
purpose and recorded here.

### What changed

1. The providers-file refusal, carrying its sentence:
   `src/core/accountStoreError.ts:31` (`providersFileUnreadable`; the
   `AccountStoreError` class moved there unchanged but for an optional
   message, re-exported from `accountCredentialRecord.ts`, so the shipped
   configured and subscriptions bundles carry the class and not the account
   schemas; under `src/core/providers/` the bundle-split gate refused it,
   and it was moved rather than given an exception). Thrown by the
   configured reader (`src/core/providers/configured.ts:382`) and the ChatGPT
   session client (`src/runtime/chatGptProviderCommands.ts:65`). The account
   check returns its message (`src/runtime/backends.ts:685`);
   `isInvalidProvidersFileError` is a type guard (`src/acp/accountText.ts:37`).
2. Session new, load, resume and list answer a providers-file refusal with
   its sentence as the error's message (`src/acp/agent.ts:2406`, in
   `openHost`), as the readiness check already did.
3. `providers` commands and `exec --provider` fill `{detail}`, the name all
   15 tables use (`src/runtime/providersCommands.ts:155`,
   `src/runtime/exec/providerExec.ts:447`); the tables were already
   consistent, so the two call sites were the fault.
4. CI lock suites: lock folders and the race's work folder are named
   relative to the working folder every worker inherits
   (`test/unit/runtimeChatGptLock.test.ts:45`,
   `test/unit/namedLockRace.test.ts:70`, `test/hosts/named-lock-race.mjs:118`).

### Test and drills

`test/unit/chatGptLocalFailures.test.ts:69`: a real corrupt and a real
invalid providers file; the real `runtimeSubscriptionClient`, its
`accountId()` (the call the account check makes) and `createClient()` with a
real `ModelApiClient` (the Proxy stand-in and its PLAN.md §8 row are gone).
Each must be the providers-file refusal with exactly the filled sentence.

- Drill 1: the configured reader put back to `RangeError` /
  `ModelApiError(actionFailed)`: 2 failed (`expected false to be true` at the
  account-check assertion), exit 1. Reverted: 20 passed, exit 0.
- Drill 2: the session reader put back to `new Error(...)`: 2 failed at the
  session assertion, exit 1. Reverted: 20 passed, exit 0.

### Real use: the packed agent, 2026-10-17, this Windows PC

`npm run build` (exit 0), then `temp/realuse/drive.mjs` and `more.mjs`: an
empty workspace, an isolated profile (`USERPROFILE`, `APPDATA`,
`LOCALAPPDATA`, `XDG_CONFIG_HOME`, `XDG_DATA_HOME` in the worktree's
`temp/`), `providers.json` holding `{not json` (unparseable) or
`{"v":0,"providers":[]}` (invalid). No model request was made: every path
stops at the file read. The agent's own commands said `auth status`: "No
Meta Model API key is stored." and `providers status chatgpt`: "ChatGPT
sign-in has expired; …" (this PC holds a ChatGPT grant), so readiness is
`ready` and session/new reaches the provider client, finding 2's path.

| Step (editor or terminal)                                                               | Before (183ac75674 behaviour)                                                                                           | Now                                                                                                                                                   |
| --------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--backend modelApi`, `initialize`, `session/new`                                       | `{"code":-32603,"message":"Internal error","data":{"details":"The providers file could not be read (unparseable). …"}}` | `{"code":-32603,"message":"Internal error: The providers file could not be read (unparseable). Fix or remove it, then try again."}` (and `(invalid)`) |
| `providers list`                                                                        | `Test failed: {detail}` (the owner's run)                                                                               | exit 1, `Test failed: <path of providers.json>` (unparseable), `Test failed: Invalid input` (invalid)                                                 |
| `exec --backend modelApi --max-budget-usd 0.01 --provider acme --model acme/m "say ok"` | `Test failed: {detail}` (same call-site fault)                                                                          | exit 2, `[error] Test failed: <path>` / `[error] Test failed: Invalid input`                                                                          |

The "Before" row for session/new was measured, not recalled: the `openHost`
conversion was taken out, the agent rebuilt and driven again (it answered as
above), then restored and rebuilt (tree clean).

Not reached in real use here: the readiness branch itself
(`src/runtime/backends.ts:685`, a computer with no stored grant or key),
because this PC holds a ChatGPT grant and the agent's store has no override;
the grant was not touched. The unit case drives the same `accountId()` call
over the real modules. On such a computer the editor reads
`Internal error: The providers file could not be read (unparseable|invalid).
Fix or remove it, then try again.` from `requireReady`.

### Local gates on the final tree (this Windows PC)

format 0, eslint on every changed file with `--max-warnings 0` 0,
typecheck (all five projects) 0, check:l10n 0, check:reference 0,
check:plan 0, check:host-api 0, check:roadmap 0, deadcode 0, cycles 0,
duplication 0 (0 clones), build 0, security:audit 0, `vitest related` over
the changed sources 0, the three changed suites 0 (POSIX socket cases skip
on Windows; hosted CI runs them).

security:sast 1: 9 `detect-child-process` findings in 8 files this branch
does not change (byte-identical to `origin/main`). Measured: this PC's
semgrep is 1.177.0, CI pins 1.178.0 (`.github/semgrep/requirements.txt`);
the same `scan --config auto` over `origin/main`'s copies of those 8 files
and over this head's copies reports the same 9 findings on each. CI's
pinned SAST passed on 183ac75674. The pinned version was not installed here.

### VSIX budget: measured, not fixed here

Main (81dacaf5, as packaged by `chore/no-standins`, run 39090625665) is
3,783,387 bytes, 5,413 under the 3700 KiB budget; this branch is 3,800,805
(+17,418). The growth is the branch's product content: `l10n/` +10.7 KB
(about 45 new sentences in 15 languages, already brotli-compressed at the
build's quality, so it passes into the VSIX whole) and code (`dist/subscriptions.js`
29.7 → 40.7 KiB, `modelApi.js` +1.8, `conversation.js` +1.5,
`uiTextRuntime.js` +1.0, smaller others). Every key the branch adds is read
by code; no file was added to the VSIX; Unreleased notes ship only their
Highlights, so the CHANGELOG lines do not count. The fixes above add about
0.4 KiB raw. Room for 12 KB cannot come from a lazily loaded bundle (the
VSIX holds every bundle), and the cap is not raised here (PLAN.md D6):
the owner decides between authorizing a new budget and cutting shipped
content.
