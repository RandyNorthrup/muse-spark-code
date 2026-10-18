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
| 6   | same                                                                                | plan refusal, empty/unparseable body (`src/core/providers/subscriptions/registry.ts:277`)              | non-503 refusal with no error envelope and no admission detail      | the HTTP status (e.g. 429/500 with empty body)                                                                        | FIXED in this lane (commit below)                                                         |
| 7   | same                                                                                | plan 503 / documented retry codes (`registry.ts:263`) and retryable stream events (`registry.ts:619`)  | OpenAI answers 503 or a documented retry code                       | OpenAI says try again (`subscription_sharing_usage_unavailable`, …); turn retries bounded                             | correct as-is                                                                             |
| 8   | `ChatGPT sign-in could not be completed. Try again or remove it and sign in again.` | old `acpChatGpt.failure` catch-all (0.18.2 app lane / `openBrowser` reject, `src/runtime/backends.ts`) | any session-side sign-in failure                                    | grant unreadable, refresh refused (`invalid_grant`), store down, providers file bad                                   | replaced by per-cause sentences (snapshot); `openBrowser` reject is `browser-unavailable` |
| 9   | `That did not work (the Muse Spark log has the details).`                           | session client file read (`src/runtime/chatGptProviderCommands.ts:62`)                                 | providers file unparseable/invalid when a session builds its client | `unparseable` vs `invalid`                                                                                            | FIXED in this lane (commit below)                                                         |
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
