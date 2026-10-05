# M95b S — shared subscription sign-in core

Worktree `/home/randy/lanes/M95BS`, branch `m95b/s`, base `60bf96aaa`,
Kubuntu rig, 2026-10-05. This record certifies lane S's offline work, not
aggregate M95b or live subscription support. No network or paid model call,
other application's credential read, dependency, cast, suppression, gate
change, push, merge or rebase was made.

## Evidence and implemented contract

Read PLAN D74 and M95b in full, `docs/certification/m95-research.md` §6,
`docs/certification/m95-captures.md`, and the owner's shared
`_ctx/codex/M95B-FINDINGS.md`. That finding records two owner sign-ins on
2026-10-05, runs `acdc0f60…` and `577bc807…`, with **0 + 1 model attempts**,
and both refresh tokens revoked with HTTP 200. The findings confirm dynamic
registration, callback fields (`code`, `scope`, `state`, `client_id`), PKCE
S256, RS256/JWKS verification and granted `chatgpt.tokens.use.direct` scope.
The research documents the fixed endpoints and OAuth/OIDC fields used here.
Tests contain generated RSA keys and synthetic grants only, never owner tokens.

- `subscriptions/chatgpt.ts`: authorize URL and captured callback fields;
  issuer discovery pins; ID-token signature, issuer, audience, authorized
  party, expiry and nonce validation; direct-plan scope; a validated
  origin-bound secret record; code exchange, refresh rotation and revocation.
  Identity claims are discarded. HTTP redirects are refused. Wire and host
  failures leave the core only as technical codes, not their supplied text.
- `ChatGptHostPort` supplies a persistent opaque installation id, browser,
  one-shot callback with the ten-minute deadline, SecretStorage / OS keystore
  reads/writes/deletion, clock, HTTP transport, and an inter-process lock.
  All three grant mutations hold that lock; access re-reads the secret
  inside it, so two processes cannot rotate a stale copy. Hosts translate
  error codes; credentials never cross the UI bridge. The concrete callback,
  lock and storage implementations remain V/X's ownership.
- Access tokens bind to `https://api.openai.com`, refresh tokens to
  `https://auth.openai.com`. The caller supplies the required validity
  margin; there is no background refresh. Lifetime starts when the token
  response is received, before fetching JWKS, so a slow key fetch does not
  extend expiry. Removal attempts revocation and deletes the local record
  even when revocation or parsing fails; such failure is still reported.
- `subscriptions/planUsage.ts`: validated, immutable, per-provider local
  request tallies; reported and estimated tokens counted separately. Every
  dispatched attempt counts, including a 200 stream with a limit error and
  no usage. Missing token usage is represented by the gap between total,
  reported and estimated requests. There is no dollar or quota guess.
- `presets.ts`'s new plan-key region exports the captured Mistral API-key
  preset with `pricing.kind = plan` and its subscription-limits link.
  `PLAN_KEY_PRESETS` is separate from the active pay-as-you-go list: W
  must install plan pricing when registering it, never offer it with API
  pricing first. Descriptions and key hints remain live language getters.

No model slug is hard-coded. Catalogue selection, preview codec rules,
no-Content-Type SSE parsing, rewritten cache keys and the usage-limit error
inside HTTP 200 belong to C/U/W; this core makes no inference request.
Single-model behavior and the existing paid policy are untouched.
No new user text was needed; the plan preset reuses the translated Mistral
text. New failure identifiers are technical host-port codes, to be mapped by
V/X/0 rather than displayed verbatim.

## Capture and integration dependencies still open

The supplied findings are a summary, not the raw discovery/token/refresh
frames. The lead must attach their precise capture workspace and receipts
before claiming rule-13 live certification. In particular the documented
`earliest_refresh_at` field's wire type, unit and refresh response were not
supplied: this lane does not guess or parse it. Refresh tests prove standard
OAuth rotation with an injected cross-process lock, not a live refresh or
OpenAI's earliest-refresh admission policy.

MiniMax and Alibaba plan endpoints, model-list/key-test shapes and their
capture receipts were not supplied. Neither is fabricated or listed;
Mistral reuses its existing 2026-10-04 capture. Hugging Face OAuth remains
conditional on the owner's app registration and capture; no registered app
id or OAuth response was supplied, so no placeholder `huggingface.ts` was
added. The existing token preset remains available. A request for those
missing rig capture paths was sent while independent work continued.

V/X must adapt the new record directly to their secret stores: M95's
API-key `{secret}` schema is not a subscription record. They must implement
and drill a real inter-process lock and the exact `/auth/callback` one-shot
loopback, close/cancellation/deadline behavior, and the remote-window route.
W owns providers-file/registry/bundle wiring, README, PRIVACY, CHANGELOG,
PLAN and aggregate certification; no other lane's files were edited.

## Regression and deliberate red evidence

All commands run directly on Kubuntu, at most three files per Vitest run,
`--maxWorkers=3 --testTimeout=120000`, no test-name filter or skipped test.
Every mutation ran its **whole file** and restored the source's original
bytes in `finally`, with SHA-256 equality checked. The ledger and complete
logs remain in ignored `temp/m95b-s/`.

Three ordinary regressions were also observed before fixing them:
module-load translation capture (one failed test); secret-bearing browser
and secret-store errors (five failed tests); expiry moved by a delayed JWKS
read (both sign-in and refresh tests failed). All pass after the fixes.

One initial drill did **not** fire: removing the single-audience authorized-
party check was still covered for the old multiple-audience test by the
separate multiple-audience guard. Added the missing single-audience wrong-
`azp` case; the corrected drill then failed as intended. The initial
non-firing run is retained in `drills-first-pass.json` and is not counted.

The first 51 drills preceded the final host-error/lifetime fixes; those
fixes added drills 52–53. None of the original guards was removed. Final
restoration and whole-file tests cover the combined implementation.

| #   | Guard broken                 | Named failed test (substring)                                                     | Result               |
| --- | ---------------------------- | --------------------------------------------------------------------------------- | -------------------- |
| 1   | PKCE S256                    | `requests the dynamic client`                                                     | exit 1; SHA restored |
| 2   | Loopback host                | `refuses an unsafe redirect`                                                      | exit 1; SHA restored |
| 3   | Loopback scheme              | `refuses an unsafe redirect`                                                      | exit 1; SHA restored |
| 4   | Callback path                | `refuses an unsafe redirect`                                                      | exit 1; SHA restored |
| 5   | Authorize query              | `refuses an unsafe redirect`                                                      | exit 1; SHA restored |
| 6   | Opaque installation id       | `refuses a non-opaque hostId`                                                     | exit 1; SHA restored |
| 7   | Callback state               | `refuses a wrong state`                                                           | exit 1; SHA restored |
| 8   | Duplicate callback fields    | `refuses duplicate`                                                               | exit 1; SHA restored |
| 9   | Callback origin              | `refuses another callback origin`                                                 | exit 1; SHA restored |
| 10  | Issued client                | `refuses another callback origin`                                                 | exit 1; SHA restored |
| 11  | ID-token signature           | `refuses a signature from another key`                                            | exit 1; SHA restored |
| 12  | ID-token issuer              | `refuses invalid issuer claims`                                                   | exit 1; SHA restored |
| 13  | ID-token audience            | `refuses invalid audience claims`                                                 | exit 1; SHA restored |
| 14  | ID-token expiry              | `refuses invalid expiry claims`                                                   | exit 1; SHA restored |
| 15  | ID-token nonce               | `refuses invalid nonce claims`                                                    | exit 1; SHA restored |
| 16  | ID-token algorithm           | `refuses an untrusted header`                                                     | exit 1; SHA restored |
| 17  | ID-token key id              | `refuses an untrusted header`                                                     | exit 1; SHA restored |
| 18  | Multiple audiences           | `refuses invalid multiple audiences without azp claims`                           | exit 1; SHA restored |
| 19  | Authorized party             | `refuses invalid single audience wrong azp claims`                                | exit 1; SHA restored |
| 20  | Unique JWKS key              | `refuses duplicate key ids`                                                       | exit 1; SHA restored |
| 21  | JWKS algorithm               | `refuses an unsuitable JWKS key`                                                  | exit 1; SHA restored |
| 22  | JWKS signing use             | `refuses an unsuitable JWKS key`                                                  | exit 1; SHA restored |
| 23  | Plan scope                   | `refuses missing plan scope`                                                      | exit 1; SHA restored |
| 24  | Initial ID token required    | `refuses malformed initial token response`                                        | exit 1; SHA restored |
| 25  | Access-token origin          | `refuses access-token origin escape`                                              | exit 1; SHA restored |
| 26  | Stored access origin         | `refuses an altered stored origin`                                                | exit 1; SHA restored |
| 27  | Stored refresh issuer        | `refuses an altered stored issuer`                                                | exit 1; SHA restored |
| 28  | Discovery token pin          | `refuses an altered discovery token_endpoint`                                     | exit 1; SHA restored |
| 29  | JWKS origin pin              | `refuses an altered discovery jwks_uri`                                           | exit 1; SHA restored |
| 30  | HTTP refusal                 | `asks to sign in again for a revoked grant`                                       | exit 1; SHA restored |
| 31  | Delete on revoke refusal     | `deletes the record even when revocation is refused`                              | exit 1; SHA restored |
| 32  | Redirect refusal             | `stores the issued client`                                                        | exit 1; SHA restored |
| 33  | Callback cleanup             | `closes the callback when the browser cannot open`                                | exit 1; SHA restored |
| 34  | No other credential store    | `has no dependency on another application credential path`                        | exit 1; SHA restored |
| 35  | Positive token lifetime      | `refuses malformed initial token response`                                        | exit 1; SHA restored |
| 36  | Freshness check              | `serializes rotation across two windows`                                          | exit 1; SHA restored |
| 37  | Refresh lock                 | `serializes rotation across two windows`                                          | exit 1; SHA restored |
| 38  | Always count attempts        | `counts a dispatch even when the 200 SSE stream fails`                            | exit 1; SHA restored |
| 39  | Separate token estimates     | `keeps reported tokens separate from estimates`                                   | exit 1; SHA restored |
| 40  | Integer token counts         | `refuses invalid token count 0.5`                                                 | exit 1; SHA restored |
| 41  | Consistent request counts    | `refuses invalid provider ids, duplicate rows and inconsistent reported requests` | exit 1; SHA restored |
| 42  | Unique provider tally        | `refuses invalid provider ids, duplicate rows and inconsistent reported requests` | exit 1; SHA restored |
| 43  | Counter overflow             | `refuses overflow`                                                                | exit 1; SHA restored |
| 44  | Caller data untouched        | `does not mutate caller-owned rows`                                               | exit 1; SHA restored |
| 45  | Plan billing marker          | `reuses Mistral keys, endpoint and wire`                                          | exit 1; SHA restored |
| 46  | Runtime language lookup      | `reads the plan description and key hint`                                         | exit 1; SHA restored |
| 47  | Discovery authorize pin      | `refuses an altered discovery authorization_endpoint`                             | exit 1; SHA restored |
| 48  | Discovery revocation pin     | `refuses an altered discovery revocation_endpoint`                                | exit 1; SHA restored |
| 49  | PKCE verifier shape          | `refuses a non-opaque verifier`                                                   | exit 1; SHA restored |
| 50  | Runtime key hint lookup      | `reads the plan description and key hint`                                         | exit 1; SHA restored |
| 51  | Provider id validation       | `refuses invalid provider ids`                                                    | exit 1; SHA restored |
| 52  | Secret-bearing host failures | `does not expose a secret-bearing host`                                           | exit 1; SHA restored |
| 53  | Lifetime anchored at receipt | `anchors sign-in expiry to token receipt`                                         | exit 1; SHA restored |

Each source version restored during the drills:

- `src/core/providers/presets.ts`: `0571e1c6d1c0e5b427d610790898530d0691db0c28cce2a4ba28b24803112ad4`
- `src/core/providers/subscriptions/chatgpt.ts`: `57308d61a9f673ffb2d4893d64f00eac1a6b680e7056617025df70b6e3ab1648`
- `src/core/providers/subscriptions/chatgpt.ts`: `849ab12ca58c117780b46d7234391943ad1501b54357bcc849d5597f0968bd96`
- `src/core/providers/subscriptions/planUsage.ts`: `1b70d72001833faeffb1735e0ec31473b8032ac9145826ff1a3645f605e75949`

## Checks

Focused final suites: **95/95** before the final drill restores (83 sign-in,
9 plan-usage, 3 plan-key tests). Five-project typecheck passed before the
last error/lifetime regressions were added; final checks are recorded below.
Full `npm run quality` is expressly reserved for the lead by the lane's
`common.md`; it is not claimed here. No gate was weakened.

### Final Kubuntu checks and integration deferral

| Check                                            | Result                                                                            |
| ------------------------------------------------ | --------------------------------------------------------------------------------- |
| `npm run typecheck`                              | Exit 0, all five projects; final test-helper cleanup also passed `typecheck:unit` |
| ESLint on the six changed TypeScript files       | Exit 0, zero warnings after the fixture dispatch cleanup                          |
| Prettier on changed code/tests/certification     | Exit 0                                                                            |
| `npm run deadcode`                               | Exit 0; inherited `vendor/**` configuration hint only                             |
| `npx jscpd`                                      | Exit 0; 967 files, zero clones                                                    |
| `node scripts/check-l10n.mjs`                    | Exit 0; 14 tables, 127 manifest strings, 493 source files, zero problems          |
| `npm run check:host-api`                         | Exit 1; the sole generated difference is `node:crypto` import count 35 → 36       |
| `npm run build`                                  | Exit 0; size, split, host-global and 84-package notice checks pass                |
| Three new complete unit files                    | 95/95 pass after final restoration and fixture cleanup                            |
| Existing presets and provider-localization files | 19/19 pass in a separate two-file run                                             |

**M95BS-R-host-api-count:** `docs/ide-compatibility/host-api.md` belongs to
integration/documentation, outside this lane. W/lead must regenerate it
with `npm run check:host-api -- --write`, review the one count change and
rerun the check. API membership is unchanged; this is generated-document
maintenance, not a weakened check. No aggregate all-gates claim is made.

Build sizes: activation **553.1/600 KiB**, Model API **413.3/475 KiB**,
providers **96.2/125 KiB**, Models panel **51.0/75 KiB**, Models webview
**411.4/475 KiB**, conversation webview including its shared chunk
**896.4/900 KiB**, ACP **798.8/850 KiB**, checkpoint store **88.4/225 KiB**.
V/X have not yet imported the new sign-in core into their entries; integrated
bundle budgets must be rechecked when they wire it. No budget changed.

Implementation commit `d69c05aed5430278519d9c95bfa6d046c8fc6dea` ran the
worktree's real hooks: serial lint-staged and a staged gitleaks scan
(**64,472 bytes**, no leaks). Post-commit ESLint exposed a formatting conflict
in the fake fetcher's nested conditional: lint-staged's ESLint fix inserted
parentheses that Prettier removed. The final test-only helper uses one early
return and one non-nested conditional; scoped ESLint and final whole-file
tests now pass. The production implementation is unchanged by that cleanup.
The follow-up commit records this correction and final checks with hooks on.

Final source checksum (SHA-256), after the synchronous declaration relocation:
`91085f0a546b362f0b7ccd348d4caad6cef2f57c6ee1d7cb8509eed02b4bf9ca`.
No network wait moved ahead of the timestamp; both slow-JWKS regressions pass.

The follow-up hook initially flagged that published source digest under
`generic-api-key` because its preceding description contained an OAuth
keyword. Renamed the descriptive label to “source checksum”; no credential,
scanner configuration, suppression or ignore was added. The digest and
its byte-exact proof are unchanged.

## FIXM95BS — RVM95BS review repairs (2026-10-05)

Windows 11 rig, worktree `C:/lanes/FIXM95BS`, branch `m95b/sfix`, base
`180c85b2`. Read the complete rig brief, shared `common.md`, review report,
repository rules, PLAN D74/M95b and the owner's existing capture findings.
The rig brief forbids merging/rebasing/pushing and the shared rules reserve
full quality for the lead. All verification here runs directly on this rig,
one resource-heavy check at a time. No dependency, gate change, suppression,
credential-file read or live/paid/network call was made.

| Finding                                                         | Resolution                                                                                                                                                                                                                                   | Regression                                                                                                                                                                                                                                                                                                                          |
| --------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| RVM95BS-1 P2: discarded rotation after JWKS/persistence failure | Fixed: persist the full replacement as pending before key fetch or scope/identity validation; retain a refused write in the host's memory; recovery and Remove use that replacement. Final-write failure leaves the persisted pending grant. | `persists a pending rotation before JWKS failure and resumes it in another window`; `retains a replacement after persistence failure for the next access/remove operation`; `keeps the pending grant when the final verified-record write fails`; `never returns an unverified pending token after invalid refresh identity claims` |
| RVM95BS-2 P2: insufficient/expired refreshed access returned    | Fixed: compare remaining lifetime with the requested margin before finalizing and again after persistence. Raise typed `expired`; a pending short grant is not rotated again by concurrent windows.                                          | `rejects insufficient refreshed lifetime 1/2 across concurrent windows without rotating twice`; `rejects a token that expires during JWKS/persistence without returning expired access`                                                                                                                                             |
| RVM95BS-3 P2: outages presented as sign-in required             | Fixed: HTTP/network/throttling failures use safe `request-failed`. Only token-endpoint HTTP 400/401 with schema-validated `invalid_grant` requires sign-in. Error response text never escapes.                                               | `reports discovery/token/JWKS/revocation outages and throttling as retryable request failures`; `requires sign-in only for token HTTP 400/401 invalid_grant`; malformed JSON, outage `invalid_grant`, and endpoint network regressions                                                                                              |
| RVM95BS-4 P3: named endpoint tests fail discovery               | Fixed: fake HTTP status is keyed by URL. Revoked-grant and refused-revocation tests assert their actual endpoint request, form and storage outcome. Revocation refusal now correctly reports a request failure.                              | `asks to sign in again for a revoked grant and leaves the record unrotated`; `deletes the record even when revocation is refused`                                                                                                                                                                                                   |

All four findings are fixed; none is a residual. The updated regression file
was run against the original production implementation first: **83 passed,
14 failed, exit 1**, proving the original paths failed. The final focused
sign-in, plan-usage and plan-key suites pass **115/115**, including equality
at the requested margin, expired ID-token/access pairs, a separate host port
resuming a persisted transaction, and memory cleanup after removal.

### Port and storage contract for V/X/0/W

`ChatGptHostPort` method signatures and existing required record fields are
unchanged. The record gains optional `pendingRefresh: { idToken?: string }`;
the technical error union gains `expired`. `writeRecord` must atomically
replace the entire secret-store record, preserving the prior value on a
rejected write. A pending ID token is retained only inside that secret record
for deferred verification; decoded identity claims never leave the verifier.
The marker and ID token are removed after verification. A pending record
never reaches the cached-access fast path, even when its access expiry is
still in the future. Reduced scope and invalid identity still refuse access
while retaining the replacement for revocation.

Hosts translate `request-failed` as service unavailable / retry, `expired`
as insufficient remaining lifetime, and `sign-in-required` as a fresh sign-in.
No user-visible strings or other lanes' implementation files were changed.
W's CHANGELOG entry should record the transaction recovery, lifetime checks,
safe issuer-outage classification and endpoint-test correction.

**M95BS-R-store-outage-lifetime:** after a refused first write, the recovery
slot belongs to the live host port (shared by core instances using that port).
It cannot survive process death or be read by another process during total
keystore failure. Access fails closed; a later access retries persistence,
and Remove revokes the retained replacement. V/X must retain/reuse the port,
certify atomic stores and the inter-process lock, and verify outage/shutdown
behavior. The injected port cannot promise durable storage after storage
itself has refused it. This limit is also named in PLAN §9.

**M95BS-R-integration-evidence:** existing exact raw capture and
`earliest_refresh_at` dependencies, concrete editor/runtime wiring, translated
error mapping, CHANGELOG and composed platform/bundle gates remain the lead's
integration work. The new `invalid_grant` refusal is a synthetic regression
for the OAuth category explicitly required by the repair brief, not a new live
capture claim. No model call or undocumented provider response is fabricated.

### Red drills 54–64

Each drill ran the entire sign-in test file with
`npx.cmd vitest run test/unit/chatGptSignIn.test.ts --maxWorkers=3 --testTimeout=120000`.
Every run exited 1 with the named failure; the mutated file was restored in
`finally` and SHA-256 compared before continuing. Logs, JSON reports and the
ledger are in ignored `temp/fixm95bs-drills/`. No test-name filter, skipped test
or relaxed guard remains in the final tree.

| Drill | Guard broken                            | Named failed regression                                                         |
| ----- | --------------------------------------- | ------------------------------------------------------------------------------- |
| 54    | Pending-record persistence before JWKS  | `persists a pending rotation before JWKS failure`                               |
| 55    | Failed-write recovery slot              | `retains a replacement after persistence failure for the next access operation` |
| 56    | Pending-access verification             | `never returns an unverified pending token`                                     |
| 57    | Margin before finalization              | `rejects insufficient refreshed lifetime`                                       |
| 58    | Margin after persistence                | `rejects a token that expires during persistence`                               |
| 59    | Retryable HTTP classification           | `reports discovery outages and throttling`                                      |
| 60    | HTTP 400/401 restriction                | `does not treat invalid_grant on an outage`                                     |
| 61    | `invalid_grant` body validation         | `reports token outages and throttling`                                          |
| 62    | Endpoint-specific fake status           | `asks to sign in again for a revoked grant`                                     |
| 63    | Local deletion after refused revocation | `deletes the record even when revocation is refused`                            |
| 64    | Recovery cleanup on Remove              | `retains a replacement after persistence failure for the next remove operation` |

Restored source checksum:
`8cce6bc7742b52f095d3a762a1559e85dbc73596fcce9b94e479d29b9dd6a45e`.

Restored test checksum:
`29fef7f3b7b949c46cc953eb821b9d1061d1a431ce82697e3884f9867cb6d124`.

### Repair checks

The five-project `npm.cmd run typecheck` passed (exit 0). Final scoped lint,
formatting, restored suites and remaining required gate results are recorded
in the closing validation update. The inherited host API record difference
remains owned by W/lead; this repair adds no Node or VS Code import.
