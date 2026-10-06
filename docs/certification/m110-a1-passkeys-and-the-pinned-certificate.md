# M110 A1 — passkeys and the pinned certificate

Kubuntu rig, worktree `/home/randy/lanes/M110A1`, branch `m110/a1`, base
`989077534`, 2026-10-06. Model attempts **0**; no paid call, credential read,
user-profile browser, OS trust-store or firewall change. Only throwaway
loopback browser fixtures listen. The accepted A0 threat model, including
H19/H20, governs this lane.

The implementation is confined to A1's auth/TLS/browser directories and its
constants, strings, dependency, build and certification records. Other lanes'
listener, controller, routes, terminal, packaging and TUI files are untouched.
The full quality run belongs to the lead under the rig/common brief; this
lane runs scoped checks directly, with repository-default test timeouts.

## Controls and proof

| Control | Implementation                                                                                                                                                                                                                                                          | Proof / red drill                                                                                                       |
| ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| H02     | Non-CA self-signed EC leaf, exact SAN set, key match, self-signature, validity and full SHA-256 pin. Never silently reissue over an existing key/cert. Absolute installed OpenSSL path and empty child environment. DNS names must resolve to the selected LAN address. | `nodeCertificate.test.ts`; pin, CA, key, signature, dates, SAN, reissue, executable and DNS drills in the core receipt. |
| H03     | Domain RP and exact HTTPS origin; browser secure-context check and certificate-installation instructions. No TLS warning bypass.                                                                                                                                        | Auth constructor/client tests. OS/browser trust receipts remain A0-TLS, pending.                                        |
| H04     | Console code hashed in N's state; one-use enrollment writes code consumption and exactly one public passkey in one serialized state update. Monotonic window and one-use challenges.                                                                                    | Setup replay, expiry, code rotation and competing enrollments in `nodePasskeyAuth.test.ts`.                             |
| H05     | Real pinned SimpleWebAuthn, exact challenge/origin/RP/type, presence/UV, signature, ID and counter verification, cross-origin client data refused. One-use purpose-bound challenges.                                                                                    | `nodePasskeyVerifier.test.ts` uses actual captured public CDP proofs; challenge/purpose/expiry drills.                  |
| H06     | Random page-memory bearers; memory stores only their hashes. HTTP headers only, cookies omitted, redirects refused, API cache disabled, reload starts signed out. State/audit contain no bearer, setup code or proof bytes.                                             | Session and browser storage/header/reload tests.                                                                        |
| H07     | N retains Host/Origin/Fetch-Metadata and first-frame socket guards. Browser requests use same-origin mode.                                                                                                                                                              | N's existing accepted transport suites; A1 adds no competing listener.                                                  |
| H08     | Idle/absolute monotonic deadlines; timers abort streams without another request; detach always runs. Action proofs expire and are consumed once. Signout/lock invalidate sessions/challenges/proofs.                                                                    | `nodeAuthSessions.test.ts`, `nodeAuthChallenges.test.ts`, epoch/signout tests; byte-exact core drills.                  |
| H09     | Per-source/account admission/backoff before verifier work, durable failure count and disable at 100, bounded sessions/challenges/proofs, N's capped hash-chained audit.                                                                                                 | Throttle, caps and 100-failure tests and drills.                                                                        |
| H19     | Fresh UV for each maker action, bound to session/action/exact payload digest and consumed atomically. Stop stays authenticated session access.                                                                                                                          | Changed binding and concurrent reuse tests, plus shared N method dispatch.                                              |
| H20     | Disabled state printed on console at boot and lockout. Recovery is local console-only issuance of a fresh hashed one-use setup code; replace disabled passkeys atomically. No network recovery method.                                                                  | Lockout/restart/recovery/code-replay tests.                                                                             |

## Capture

`test/fixtures/node-auth/cdp-v1.json` was captured on this worktree with
Playwright Core **1.63.0**, downloaded Chrome for Testing **153.0.8010.12**
(CDP protocol 1.3), a fresh temporary profile and the L0 virtual CTAP2
configuration. It contains registration, two counter-advancing assertions,
a genuinely signed non-UV assertion, and non-UV registration. Only public
proofs are retained; no authenticator private key was read or recorded.
The fixture page was `http://localhost` on an ephemeral loopback port:
localhost's browser secure-context exception, never a node service setting.
The node's configured origin still requires HTTPS. This proves the real
verifier path, not trust-store installation or a browser/OS support claim.

The initial browser-driven verifier suite passed 8 tests with default
timeouts; final unit tests read the captured public proofs, so CI needs no
browser download for these crypto tests. A0-TLS, A0-NAME, the M81-pinned build
cross-check, Safari and each OS's certificate store remain qualification
receipts owned by A1/S0/lead. No fallback CA is guessed before a leaf-trust
failure receipt; unsupported trust remains unavailable.

## Integration bindings

- **A1-N-AUTH:** load `dist/nodeAuth.js` only for setup/sign-in. Construct
  `NodePasskeyAuth` with N's state/audit, clock and session lifecycle. Bind
  `auth.sessions` as `NodeListenerVerifier`; attach/reverify calls N's
  attendance and `ended` detaches expired identities. N's `endSessions`
  calls `auth.endAll()` synchronously before waiting for tools/streams.
- **A1-N-SOURCE:** construct `nodeAuthMethods` with the actual socket source
  and verified session. N's current factory has only a session argument;
  the N/M104 owner must supply request source context without client fields.
  The session-scoped adapter prevents cross-session step-up completion.
- **A1-N-TLS:** C/S0 supplies the absolute installed OpenSSL path and private
  root; call name checks and issuance at init, then inject the pinned files
  and digest into N's existing listener. Existing TLS material requires an
  explicit console re-pair workflow; never regenerate silently.
- **A1-M104-PAGE:** serve only the sign-in page and public certificate before
  authentication. Load `dist/nodeAuthPage.js` only there; supply the current
  locale/table, canonical name, leaf digest and same-origin certificate URL.
  Bind successful in-memory client authentication to M104's controller.
  The absent M104 route/envelope is not invented here.
- **A1-T-H20:** local owner control calls `consoleSetup()` for first setup or
  disabled-owner recovery. Display the full console pin, fresh code, expiry
  and lockout message. No web method may expose this control.
- **A1-C-PACKAGE:** include both lazy artifacts, their metafiles and notices
  in the node package; preserve the existing node/extension/webview caps.
- **A1-J-REFERENCE:** this base has no feature catalog/reference generator.
  Integration adds browser certificate pairing, passkey sign-in, per-action
  step-up, signout and console lockout recovery when their routes are bound.
  Logic is shared runtime plus browser UI; no VS Code-only path.

H18/Q-M110.9 and A0-LOGIN/BWRAP remain unchanged: Muse Code stays unavailable
until its actual process/sign-in isolation and captures are qualified.

## Verification receipts

Core red drills are in `m110-a1-core-drills.json`: each names the failed
whole-suite test and records original, mutation and restored SHA-256.
No test timeout, cap, lint level, ignore, hook or existing gate was weakened.
Final scoped counts, bundle sizes and remaining gate results are recorded
as work completes below.
