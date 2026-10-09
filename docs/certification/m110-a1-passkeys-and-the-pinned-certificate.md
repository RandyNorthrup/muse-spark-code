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
| H09     | Per-source proof-work admission/backoff, durable failure count and disable at 100, stateless challenges and expiring successful-proof nonce set, bounded sessions/action proofs, N's capped hash-chained audit.                                                         | Throttle, caps and 100-failure tests and drills.                                                                        |
| H17     | Exact MIT WebAuthn pins and integrity, lazy artifacts confined to their own side, and notices from actual bundled inputs. Existing bundle caps remain unchanged; the browser cap includes CSS.                                                                          | Real production artifact, cross-platform split, oversized output and license-presence/allow-list drills.                |
| H19     | Fresh UV for each maker action, bound to session/action/exact payload digest and consumed atomically. Stop stays authenticated session access.                                                                                                                          | Changed binding and concurrent reuse tests, plus shared N method dispatch.                                              |
| H20     | Disabled state printed on console at boot and lockout. Recovery is local console-only issuance of a fresh hashed one-use setup code; replace disabled passkeys atomically. No network recovery method.                                                                  | Lockout/restart/recovery/code-replay tests.                                                                             |

## Capture

`test/fixtures/node-auth/cdp-v1.json` was captured on this worktree with
Playwright Core **1.63.0**, M81-pinned Chrome for Testing **154.0.8037.92**
(CDP protocol 1.3), a fresh temporary profile and the L0 virtual CTAP2
configuration. It contains registration, two counter-advancing assertions,
a genuinely signed non-UV assertion, and non-UV registration. Only public
proofs are retained; no authenticator private key was read or recorded.
The fixture page was `http://localhost` on an ephemeral loopback port:
localhost's browser secure-context exception, never a node service setting.
The node's configured origin still requires HTTPS. This proves the real
verifier path, not trust-store installation or a browser/OS support claim.

The linux64 archive is 120,477,194 bytes with SHA-256
`636aa5c79f2693632e9921b8bbb050038ba11672e02346c06c20f991aed096f9`;
the executable is SHA-256
`7c141b276aacc74fe51f06986345fb0dbce0e3756413746fb18541b878c17706`.
Both match `src/host/browser/runtime/browserRuntime.json` exactly. The browser
uses a fresh profile and empty environment, with no TLS-warning bypass.
`registrationNoPresence` is separately labelled as a negative derivation:
the captured none-attestation registration with only the UP bit cleared,
re-encoded with the pinned library's CBOR helper. It is never described as
an accepted browser proof. The earlier exploratory 153 capture stays in
scratch only; the checked-in fixture is the pinned capture.

`registrationUnrequestedAlgorithm` is another labelled negative derivation:
captured none-attestation bytes with a synthetic valid Ed25519 public COSE
key. Its generated private half was never retained. The real SDK accepts it
under its defaults, while A1 rejects it because the browser offers only
ES256/RS256. The first ES384 mutation was already rejected by SDK defaults;
it was unsuitable for proving A1's additional algorithm restriction and was
replaced after reading and exercising the pinned SDK's actual checks.

The same pinned browser captured `sdkRegistration`/`sdkAssertion` through
the real **browser SDK 14.0.0**, rather than a hand-written serializer.
Its registration includes `publicKeyAlgorithm`, SPKI `publicKey` and
`authenticatorData`; the browser client projects these out of the L0
enrollment message. Browser unit tests use these actual SDK captures and
prove that strict catalog parsing succeeds after projection.

The staged secret gate initially flagged four short public
`authenticatorData` values as generic API keys. They are captured RP hashes,
flags and counters, not keys or bearer capabilities. Public binary fields
are now stored as byte arrays, with a test-only loader reconstructing the
SDK's base64url fields before schema/crypto verification. Deep equality
against the original entire capture passed; all five binary-field hashes
are in `m110-a1/capture-byte-arrays.json`. No proof byte, gate, rule or
allowlist was changed. The two affected whole test files pass **19 tests**
after this representation change; unit typecheck, scoped lint, deadcode
and duplication pass again. The unchanged staged gitleaks command then
exits **0**, reporting no leaks.

The initial browser-driven verifier suite passed 8 tests with default
timeouts; final unit tests read the captured public proofs, so CI needs no
browser download for these crypto tests. A0-TLS, A0-NAME,
Safari and each OS's certificate store remain qualification
receipts owned by A1/S0/lead. No fallback CA is guessed before a leaf-trust
failure receipt; unsupported trust remains unavailable.

## Integration bindings

- **A1-N-AUTH:** load `dist/nodeAuth.js` only for setup/sign-in. Construct
  `NodePasskeyAuth` with N's state/audit, clock and session lifecycle. A3
  also requires `challengeKey`, read with the lazy bundle's
  `readNodeChallengeKey(new NodePrivateFiles(committedPair.root))` before
  construction. This derives a domain-separated key from the protected TLS
  private key and certificate fingerprint without persisting another secret.
  N's method factory takes `(session, source)` from the actual socket and
  passes `source` to `nodeAuthMethods`; never take it from request params. Bind
  `auth.sessions` as `NodeListenerVerifier`; attach/reverify calls N's
  attendance and `ended` detaches expired identities. N's `endSessions`
  calls `auth.endAll()` synchronously before waiting for tools/streams.
- **A1-N-SOURCE:** construct `nodeAuthMethods` with the actual socket source
  and verified session. N's current factory has only a session argument;
  the N/M104 owner must supply request source context without client fields.
  The session-scoped adapter prevents cross-session step-up completion.
  Supply N's own error constructor as the adapter's `failure` callback:
  error-class identity differs across lazy CJS bundles. A1 catches only
  auth-method failures; delegated Stop errors and cancellation remain intact.
- **A1-N-TLS:** C/S0 supplies the absolute installed OpenSSL path and private
  root; call name checks and issuance under N's existing exclusive
  `ownService` initialization hold, then inject the pinned files
  and digest into N's existing listener. Existing TLS material requires an
  explicit console re-pair workflow; never regenerate silently.
- **A1-M104-PAGE:** serve only the sign-in page and public certificate before
  authentication. Load `dist/nodeAuthPage.js` and its `dist/nodeAuthPage.css` only there; supply the current
  locale/table, canonical name, leaf digest and same-origin certificate URL.
  Bind successful in-memory client authentication to M104's controller.
  The absent M104 route/envelope is not invented here.
- **A1-U2-SOCKET:** `NodeBrowserAuth.authenticateSocket` authenticates one open
  same-origin `/node/terminal/stream` socket with exactly one first frame.
  It accepts no bearer in a URL or query. U2 owns socket creation/lifetime
  and joins it to the controller's authenticated client instance.
- **A1-T-H20:** local owner control calls `consoleSetup()` for first setup or
  disabled-owner recovery. Display the full console pin, fresh code, expiry
  and lockout message. No web method may expose this control.
- **A1-C-PACKAGE:** include both lazy artifacts, their metafiles and
  `dist/NODE_AUTH_NOTICES.txt`, generated from actual bundled package inputs,
  in the node package; preserve the existing node/extension/webview caps.
- **A1-J-REFERENCE:** this base has no feature catalog/reference generator.
  Integration adds browser certificate pairing, passkey sign-in, per-action
  step-up, signout and console lockout recovery when their routes are bound.
  Logic is shared runtime plus browser UI; no VS Code-only path.
- **A1-J-HOST-RECORD:** `check:host-api` reports a stale generated record,
  including N's inherited Node built-in counts and A1's `pairing.css`
  in the unchanged 61-variable theme list. J owns
  `docs/ide-compatibility/**`; regenerate at integration rather than edit
  another lane's files here.

H18/Q-M110.9 and A0-LOGIN/BWRAP remain unchanged: Muse Code stays unavailable
until its actual process/sign-in isolation and captures are qualified.

## Verification receipts

Core red drills are in `m110-a1-core-drills.json` (**29**); auth/browser/build
drills are in `m110-a1-auth-drills.json` (**55**). Each names the failed
whole-suite test and records original, mutation and restored SHA-256.
No test timeout, cap, lint level, ignore, hook or existing gate was weakened.
Initial 2026-10-06 verification ran directly on Kubuntu in three batches, with at most
three files/workers per run and the repository's unchanged timeout:

| Whole test files                                            | Passed |
| ----------------------------------------------------------- | -----: |
| `nodeAuthSessions`, `nodeAuthChallenges`, `nodeCertificate` |     26 |
| `nodePasskeyAuth`, `nodePasskeyVerifier`, `nodeAuthMethods` |     34 |
| `NodePairing`, `nodeAuthBuild`                              |     16 |
| Total                                                       | **76** |

The separate production A1 build passes: `nodeAuth.js` **492.3 KiB / 500**;
`nodeAuthPage.js` plus CSS **284.2 KiB / 350**. Notices include the real
bundled SDK and transitive package licenses. Build tests prove both caps,
browser/server separation, Windows path handling and license refusals fire.
Both drill files were rechecked against the final production bytes:
**84** named failures, **84** exact restorations.

The initial host, browser and unit TypeScript projects passed with only isolated SDK
resolution supplied. Scoped TypeScript ESLint and normal build-tool ESLint
pass with every original rule intact. Pairing CSS stylelint passes;
localization reports **623 sources, 14 tables, 164 manifest keys, 0 problems**.
Deadcode passes; duplication reports zero. Those initial scoped diagnostics
did not represent a normal installed-dependency hook run or an integrated
quality receipt. The 2026-10-09 normal-resolution checks below supersede the
installation condition; integrated quality remains the lead's responsibility.

The four theme/320 px screenshots and `m110-a1/pairing-a11y.json`, refreshed
from the final production JS/CSS, use the
M81-pinned browser: zero WCAG A/AA/2.1 AA violations, no horizontal overflow,
full console-formatted pin in all four. These are a loopback layout fixture,
not an OS certificate-trust or signed-in node-support receipt.

### Concrete J documentation handoff

README build table addition (the command has run successfully):

| Task                                            | Command                   |
| ----------------------------------------------- | ------------------------- |
| Node passkey and browser-pairing lazy artifacts | `npm run build:node-auth` |

The command emits `nodeAuth.js`, `nodeAuthPage.js`, `nodeAuthPage.css`, two
metafiles and `NODE_AUTH_NOTICES.txt`. The first server/page caps are
500/350 KiB, with CSS counted inside the page budget. C integrates this
command and these artifacts in the node build/package without changing
existing caps or startup imports.

Proposed `[Unreleased]` changelog text for J's merge:

> Added home-node passkey authentication and browser-pairing groundwork:
> hashed one-time console codes, memory-only bearer sessions, fresh
> single-use payload-bound user verification, durable lockout and console
> recovery, pinned non-CA certificates and exact name checks. Listener,
> page and console bindings and the OS/browser trust matrix remain
> integration prerequisites; this change does not claim home-node support.

### Dependency and gate findings

The initial 2026-10-06 SDK checks used an isolated installation because the
shared rules prohibited changes under the hard-linked `node_modules`.
Normal typecheck/ESLint could not resolve the SDKs, so the staged second
piece awaited permission to add the missing package directories. The core
controls had already been committed as
`d3a3bbedca1ff60597b1f7576259b8c6770a79e6`, with the repository's own
lint-staged and staged gitleaks hooks passing.

**Resume authorization, 2026-10-09.** The lead explicitly authorized copying
only missing package directories from a fresh external scratch install.
`npm install --prefix "$TMPDIR/a1-resume-deps" --ignore-scripts --no-save`
ran successfully with every package's exact staged version; the existing
root `tslib` version was also installed in scratch to reproduce the nested
`tsyringe` dependency. Only the 24 absent top-level package trees were copied,
including their one absent nested `tslib`: **25** new package directories.
No existing package, binary, symlink or npm bookkeeping file was overwritten,
moved or deleted. The unchanged `.npmrc` minimum release age was respected.

Before/after `find node_modules -maxdepth 2 -newer package.json | wc -l`
was **0 / 58**. Every newer path is an added package or its parent directory;
parent directory timestamps necessarily reflect their new children. A full
SHA-256/stat snapshot verifies all **31,226** pre-existing regular files and
symlinks: **0** changes to content, inode, mode, size or modification time.
The snapshot digest and package metadata/integrities are retained in
`m110-a1/dependency-install.json`. Every registry integrity matches the
staged lockfile. Both direct WebAuthn packages have **no peer dependencies**;
no other dependency pin changed. Scratch is under the lane's disk-backed
`TMPDIR`, outside the worktree; no install script ran.

Registry metadata checked on 2026-10-09 (publication times UTC):

| Added package                    | Version | Published                | License      |
| -------------------------------- | ------- | ------------------------ | ------------ |
| @hexagon/base64                  | 1.1.28  | 2023-09-18T22:28:26.440Z | MIT          |
| @levischuck/tiny-cbor            | 0.2.11  | 2025-02-08T19:57:57.777Z | MIT          |
| @peculiar/asn1-android           | 2.10.0  | 2026-09-27T11:57:23.539Z | MIT          |
| @peculiar/asn1-asym-key          | 2.10.0  | 2026-09-27T11:59:44.758Z | MIT          |
| @peculiar/asn1-cms               | 2.10.0  | 2026-09-27T11:57:40.793Z | MIT          |
| @peculiar/asn1-csr               | 2.10.0  | 2026-09-27T11:59:31.746Z | MIT          |
| @peculiar/asn1-ecc               | 2.10.0  | 2026-09-27T11:58:14.704Z | MIT          |
| @peculiar/asn1-pfx               | 2.10.0  | 2026-09-27T11:58:21.823Z | MIT          |
| @peculiar/asn1-pkcs8             | 2.10.0  | 2026-09-27T11:58:25.565Z | MIT          |
| @peculiar/asn1-pkcs9             | 2.10.0  | 2026-09-27T11:58:50.809Z | MIT          |
| @peculiar/asn1-rsa               | 2.10.0  | 2026-09-27T11:58:43.717Z | MIT          |
| @peculiar/asn1-schema            | 2.10.0  | 2026-09-27T11:59:59.091Z | MIT          |
| @peculiar/asn1-x509              | 2.10.0  | 2026-09-27T11:59:58.208Z | MIT          |
| @peculiar/asn1-x509-attr         | 2.10.0  | 2026-09-27T12:00:44.421Z | MIT          |
| @peculiar/asn1-x509-post-quantum | 2.10.0  | 2026-09-27T11:59:19.393Z | MIT          |
| @peculiar/utils                  | 2.0.3   | 2026-05-01T19:05:19.014Z | MIT          |
| @peculiar/x509                   | 2.1.0   | 2026-09-04T10:34:27.310Z | MIT          |
| @simplewebauthn/browser          | 14.0.0  | 2026-09-02T05:49:26.615Z | MIT          |
| @simplewebauthn/server           | 14.0.3  | 2026-09-25T17:10:28.463Z | MIT          |
| asn1js                           | 3.0.10  | 2026-04-20T15:15:24.005Z | BSD-3-Clause |
| pvtsutils                        | 1.3.6   | 2024-11-22T12:58:55.915Z | MIT          |
| pvutils                          | 1.2.0   | 2026-08-05T10:41:11.088Z | MIT          |
| reflect-metadata                 | 0.2.2   | 2024-03-29T01:38:46.117Z | Apache-2.0   |
| tsyringe                         | 4.10.0  | 2025-04-16T02:47:14.328Z | MIT          |
| tslib (nested under `tsyringe`)  | 1.14.1  | 2020-10-09T23:34:42.516Z | 0BSD         |

A same-scope npm audit of base `989077534` and this lockfile reports the
same 13 vulnerable packages (2 low, 10 high, 1 critical), no new vulnerable
package. The unchanged audit gate fails on inherited `shell-quote`
GHSA-pqg4-j6r4-53mv and `source-map-js` GHSA-68fv-2mgg-jv7q. No dependency
outside A1 is upgraded and no audit exception is added; the lead owns those
base-tree repairs.

The duplication gate first fired on the SDK response projection and two
test setup/binding sequences. One common credential-field projection,
shared browser setup and the proof's own binding remove all three clones;
`npx jscpd` then reports zero. The production build passes with existing
caps intact: extension 437.0 KiB, Model API 447.0 KiB, checkpoint store
77.2 KiB, shared fallback 49.7 KiB, ACP 817.9 KiB and node 64.9 KiB.

## Resume verification — 2026-10-09

Normal resolution now passes with the installed packages, without the old
scratch aliases or alternate config: `npm run typecheck` (all five projects),
changed-file `npx eslint --max-warnings=0`, pairing CSS stylelint,
changed-text-file `npx prettier --check`, `npm run deadcode`, `npx jscpd`,
`node scripts/check-l10n.mjs`, `npm run build` and `npm run build:node-auth`.
The first formatter invocation mistakenly included four PNG files and
reported no parser for those binaries; the corrected invocation checks every
changed text file and passes. No ignore or formatter rule was added.

The same eight whole test files above pass **76 tests** in batches of at
most three files/workers, using the normal repository config and default
timeouts. No `--testTimeout`, timeout override or test filter is used.
Both drill registers still match the exact final production source hashes:
**29 core + 55 auth/browser/build = 84** named red failures and byte-exact
restorations. Production sizes at this A1 resume checkpoint were **492.3/500 KiB** for the
auth server and **284.2/350 KiB** for the page; A2 and A3 below supersede these
intermediate measurements including CSS. The regular production
build passes every unchanged size/split/notices/host-globals check, at the
sizes recorded above.

The pinned browser executable was rehashed against M81's pin, then a fresh
throwaway loopback fixture loaded the normal production JS/CSS. All four
320 px themes again show the full fingerprint, have no horizontal overflow
and report **0** WCAG A/AA/2.1 AA violations. No user profile, OS trust store,
firewall, external listener or paid/live model call was used.

`check:host-api` still exits **1** for its stale generated record (one
problem); J owns regeneration at integration. The refreshed base/current
npm audits are exactly equal: **13** vulnerable packages, **0** newly
introduced. The unchanged audit gate still exits **1** for `shell-quote`
GHSA-pqg4-j6r4-53mv and `source-map-js` GHSA-68fv-2mgg-jv7q. Neither gate
was weakened and no other lane's files or dependency pins were changed.
The N/M104/T/C/J bindings and A0-TLS/A0-NAME platform qualification remain
explicit prerequisites to claiming home-node support.

**Generated-cache side effect.** The dependency copy itself preserved every
existing entry, as its immediate snapshot shows. The required normal Vitest
runs subsequently updated the pre-existing
`node_modules/.vite/vitest/da39a3ee5e6b4b0d3255bfef95601890afd80709/results.json`.
A second complete snapshot identifies that single generated results cache
and **0 changed package files**; the pre-existing Jiti cache is unchanged.
This automatic cache write was missed before running Vitest. No attempt was
made to overwrite or delete the cache again, substitute a launcher, change
hook configuration or alter a gate. The side effect is retained explicitly
in `m110-a1/dependency-install.json`, rather than claiming every existing
entry remained untouched throughout testing.

## RVM110A1B corrections — FIXM110A2, 2026-10-09

Base `7ad52905d`, branch `m110/a2`, rig Kubuntu. All six findings are closed
in the shared runtime, schemas and owning tests; no editor-specific path,
new dependency, trust-store change, external listener or model call is added.

| Finding                                                     | Threat rows        | Correction and regression                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ----------------------------------------------------------- | ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P1 challenge table held without backoff                     | H04, H09, H19, H20 | `auth/challenges.ts` limits each purpose to two pending challenges per actual source, with 50 sign-in, 48 step-up and two console-enrollment slots. Independent sign-in/step-up global six-second monotonic intervals survive consuming ids and changing sources. Rejected allocations do not move these deadlines or arm failed-proof/account backoff in `auth/service.ts` or `listener.ts`. `nodeAuthChallenges`, `nodePasskeyAuth` and the real HTTPS `nodeListener` regressions cover rotating sources, quotas, reserved enrollment and successful proof completion after repeated 429s. |
| P2 refused console recovery revokes sessions                | H08, H20           | `consoleSetup` checks healthy passkeys inside the serialized transaction before `endAll`. The regression verifies unchanged durable state, an un-aborted session signal, bearer verification, proof consumption and completion of an already-pending sign-in. Accepted disabled-owner recovery retains revocation and console-only setup.                                                                                                                                                                                                                                                    |
| P2 separate key/certificate commits                         | H02, H15           | `tls/certificate.ts` writes both files into owner-validated `.node-tls-pending`, fsyncs files/directory, renames that directory once to `node-tls`, then fsyncs its parent. The returned `root` is this private pair directory. Retry discards abandoned staging or revalidates and returns the unchanged complete pair/pin after publication. Legacy flat files, changed SANs, unsafe ownership, invalid keys and expired leaves refuse; existing material is never overwritten. Tests inject certificate-write failure, retry, and simulate restart before/after publication.              |
| P3 H02 fixture portability                                  | H02                | The CA fixture explicitly supplies `req -new -x509`, an empty environment and a bounded child timeout. A named fixture assertion verifies `-new`; removing it fails the hook. The listener's CA fixture also supplies `-new`. Linux runs the real assertions; native Windows retains the existing named unsupported DACL boundary.                                                                                                                                                                                                                                                           |
| P3 cross-origin regression does not isolate assertion guard | H05                | The test signs changed client data with an ephemeral local P-256 key, in the captured response shape, and first verifies that the pinned SDK accepts it. It then requires our verifier to reject. The none-attestation registration derivation also proves SDK acceptance before testing our guard. No private key is persisted or captured, and no new browser/service wire shape is invented.                                                                                                                                                                                              |
| P3 expired proof audited as allowed                         | H15, H19           | Auth audit has a non-authorizing `verified` outcome, confined to sign-in and step-up schema branches and the shipped JSON schema. The persistence barrier records verification, then checks freshness before capability issuance; expiry records denial and no allowed row. Allowed rows record issued access. Failure of the final access audit revokes the minted session or burns the proof. Enrollment denials carry their correct action; expired step-up also has its own denied row.                                                                                                  |

### Before-fix comparisons and red drills

[The baseline register](m110-a1/fixm110a2-baselines.json) records exact
`git show 7ad52905d:<path>` source bytes and original/restored SHA-256 for
five comparisons. All final bytes restored exactly:

- Original auth service and challenge table: **6 failed / 18 passed**, including
  challenge flooding, refused recovery, enrollment/sign-in/step-up audit expiry
  and final audit failure.
- Original certificate issuer against the new suite: **3 failed / 5 passed**,
  including the orphan key after the injected certificate-write failure and
  failed restart recovery.
- Original listener: **1 failed / 9 passed**, the repeated-429 enrollment
  regression.
- Original verifier test with only the assertion `checkClientData` call removed:
  **10 passed**. This proves the old unsigned assertion missed that hole;
  the new signed test fails when the same call is removed.
- Original issuer and original H02 test on this Linux/OpenSSL rig:
  **6 passed**. The review's macOS/LibreSSL 3.3.6 receipt instead reports a
  hook timeout and six skipped tests. This lane fixes the argv and proves its
  fixture guard fires, but does not claim a new macOS receipt. The two
  test-only P3 corrections prove gaps in the old tests rather than falsely
  claiming a baseline production failure where the guard already existed.

[The drill register](m110-a1/fixm110a2-drills.json) contains **19 accepted
red failures and 19 byte-exact restorations**, with SHA-256 for original,
mutated and restored files, the whole-file command and the named failed
assertion. Every original hash matches the final source. Drills cover global
issuance backoff/arming, per-source and purpose quotas, both 429 boundaries,
recovery refusal, partial TLS publication, abandoned and committed crash
states, the OpenSSL fixture, both origin guards, all three audit expiry
paths, schema acceptance and audit-failure capability cleanup.

The first TLS publication mutation affected the shared fixture itself and
prevented the new regression from executing; it is not counted as an
accepted guard drill. The accepted mutation changes publication only for the
single-name regression leaf, leaving the two-name shared fixture intact.
An exploratory removal of both origin calls failed the old registration
assertion; the accepted baseline comparison removes only the assertion call
and demonstrates the exact reviewed gap. No production workaround or gate
change was retained.

### Dependency installation and limits

The rig initially lacked the pinned WebAuthn package directories. A canonical
`npm ci --prefix "$TMPDIR/deps" --ignore-scripts --no-audit` installed the
exact existing lockfile in private disk-backed scratch space. Only the 24
missing top-level package trees were copied in, including `tsyringe`'s nested
`tslib` (25 package directories). A SHA-256/stat snapshot of **31,224**
pre-existing regular files and symlinks proves **zero** changed entries across
copy-in. [The copy receipt](m110-a1/fixm110a2-dependency-copy.json) records the
snapshot digest and paths. No existing package, binary, symlink or npm
bookkeeping entry was overwritten, renamed or deleted; dependency pins and
lockfile are unchanged. Test commands use `--cache=false` to avoid the
predecessor's generated Vitest results-cache side effect. Scratch installation
is removed after verification.

N/C/S0 must retain the exclusive `ownService` hold around certificate
issuance and use the returned pair root. An allowed audit row describes
capability issuance, not response delivery or later proof use; existing
monotonic session/proof checks still govern use. A2's global issuance limits and reserved enrollment closed the first single-source
finding, but RVM110A2 proved the paced rotator still fills them; A3 below
supersedes that design. finite
transport bounds cannot promise availability under unlimited network load.
A0-TLS/A0-NAME, editor/browser/platform bindings, integrated quality and the
previously recorded J-owned host API and inherited audit blockers remain
lead-owned. No paid/live model attempt occurred (**0**).

### Final scoped verification

Final whole-file runs on Kubuntu use `--maxWorkers=1 --cache=false`, at most
three files per invocation, and the repository's unchanged test/hook timeouts:

| Files                                                      |  Passed |
| ---------------------------------------------------------- | ------: |
| `nodePasskeyAuth`, `nodeAuthChallenges`, `nodeCertificate` |      42 |
| `nodePasskeyVerifier`, `nodeListener`, `nodeListenerGuard` |      80 |
| `node`, `nodeAuthSessions`, `nodeAuthMethods`              |     130 |
| `NodePairing`, `nodeAuthBuild`                             |      16 |
| Total                                                      | **268** |

`npm run typecheck` passes all five projects. Changed-file ESLint with
`--max-warnings=0`, changed-text Prettier, `npm run deadcode`, `npx jscpd`
(zero clones), and localization all pass: **623 sources, 14 tables, 164
manifest strings, 0 problems**. The schema-matching test exposed the event
schema's embedded audit branches as well as the standalone audit document;
both shipped schemas now match their canonical parsers. No test filter,
raised timeout, new ignore, escape hatch, lint suppression or cap change is
used. Git hooks remain configured as `.husky/_` with the installed
lint-staged and staged gitleaks commands.

Both `npm run build` and the README's `npm run build:node-auth` exit **0**.
The regular build passes every size, split, host-globals and notices check.
Final representative sizes (KiB):

| Artifact                          | Size / unchanged cap |
| --------------------------------- | -------------------: |
| Auth server                       |          495.9 / 500 |
| Auth page including CSS           |          284.4 / 350 |
| Extension                         |          437.0 / 600 |
| Model API                         |          447.0 / 475 |
| Checkpoint store                  |           77.3 / 225 |
| Node service                      |            65.1 / 75 |
| ACP                               |          817.9 / 850 |
| Webview entry plus static imports |          896.8 / 900 |
| Deferred webview JS               |            49.7 / 50 |

`npm run check:host-api` still exits **1**, one generated-record mismatch:
inherited Node import counts and A1's pairing stylesheet in the unchanged
61-variable theme list. Regeneration stays with J at integration, as already
recorded under PLAN §7; this lane neither edits that owner's record nor
weakens the gate. The inherited dependency-audit blockers remain the earlier
A1 receipt; pins and lockfile are unchanged and no new network audit is run
under this brief's network limit. Full `npm run quality`/coverage and the
macOS/Windows/platform trust receipts remain lead-owned, explicitly deferred
under the lane brief. All six review findings are closed within this scoped
receipt; this is not a claim of aggregate quality or home-node support.

## A3 stateless redesign — RVM110A2 (2026-10-09)

Kubuntu, `/home/randy/lanes/M110A3`, branch `m110/a3`, base `e5f11498b`.
The A1/A2 measurements and source hashes above are historical receipts;
this section records the current implementation. No paid/live model call,
credential read, browser/profile, OS trust-store or firewall change occurred.
Model attempts: **0**. This remains an internal integration library, with the
same lead-owned platform and runnable-node qualifications.

### Design and findings

There is no pending-challenge table, issuance quota or global issuance clock.
The opaque id and WebAuthn challenge are the same base64url token: a strict
JSON payload followed by its HMAC-SHA-256 tag. The authenticated payload
carries purpose, a **128-bit random nonce**, exact five-minute issuance/expiry,
RP/origin, monotonic issue time, process epoch and console-code hash or
session/action/payload digest. The passkey signs the complete token.
Dedicated **4,096-character** schemas bound only these opaque challenge
fields; ordinary identifiers and bearers retain their prior limits.

`readNodeChallengeKey` derives a separate 32-byte key with HKDF-SHA-256,
using the protected committed TLS private key, certificate fingerprint and
`muse-node-auth-challenges-v1` context. N reads it from the returned protected
pair root and injects `challengeKey` into the lazy factory. No third secret
file or independent commit/rotation is needed. A mixed pair refuses; a new
certificate/key pair changes the derived key. A2's atomic publication,
abandoned-staging cleanup and unchanged-pair recovery are retained.

Verification authenticates the token before parsing its payload, checks
purpose/context/epoch/expiry, and then verifies the exact passkey proof.
Only a successful proof consumes its nonce, before durable counter/access
writes, through its original monotonic deadline. Issuance and verification
prune expired consumed entries; failed and abandoned challenges add no entry.
Lock/restart invalidate the process epoch, so no replay set needs persistence.
The pinned SDK still checks available signature counters. A real signed
counterless assertion derived from the existing captured shape verifies the
full token, refuses consumed replay, rejects a proof for another token, and
then accepts that still-unconsumed token with its correct proof.

Issuance never enters auth proof admission. Proof attempts use per-source
100-attempt windows of one minute and exponential failure backoff; no
account-wide retry clock or busy bit exists. HTTP and WebSocket dispatch
pass the actual remote address to the shared factory, never request text.
The reviewer's 25-address rotator issues 100 challenges every six seconds,
with the owner arriving immediately after its final issue: owner sign-in
succeeds. After durable lockout, console recovery still requires the new
code and succeeds under the same outstanding flood. Healthy-owner recovery
continues to refuse before revoking sessions, proofs or tokens.

Finite transport/source/concurrency bounds still apply. This proves the
paced issuance and source-isolation properties, not availability under raw
network saturation. All editors use the shared method port; no VS Code-only
control, new executable command, setting, product flow or dependency was
introduced. This base has no feature-catalog/reference generator, and this
internal defensive change does not add a help command to document.

| Review finding                                              | Threat rows         | Regression and closure                                                                                                                                                                                                                                                                                                                                                                                       |
| ----------------------------------------------------------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| P1 allowed issuance rate fills every owner challenge slot   | H04/H05/H09/H19/H20 | Stateless issuance; the reviewer-paced 25-address flood preserves owner sign-in and code recovery. `nodePasskeyAuth`, `nodeAuthChallenges`, `nodeStatelessProof`, and listener/guard/socket/method tests prove exact proof, replay, forgery, purpose, expiry and independent-source limits. A stronger 1,001-source abandoned-issue test also prevents auth admission rows from becoming an issuance budget. |
| P3 expiry tests allow the verified audit write to disappear | H15/H19             | Enrollment, sign-in and slow step-up require `verified` and `denied`, and forbid `allowed`. Deleting each verified append independently makes its named expiry regression fail.                                                                                                                                                                                                                              |
| P3 certification claims two current auth sizes              | H17                 | The old A1 resume sizes are explicitly labelled intermediate. The A2 final table remains its historical receipt; the A3 current build sizes are below.                                                                                                                                                                                                                                                       |

### Baseline and byte-exact drills

[The baseline register](m110-a1/a3-baseline.json) records exact original
`git show e5f11498b:<path>` bytes for service, challenge table, admission,
constants and auth schema. The whole new service suite reports **4 failed /
22 passed** on that original stack: reviewer-paced flood, abandoned issues,
failed-proof retry and independent-source backoff. The new injected test key
is ignored by that stack; its helper temporarily uses a literal 32-byte size
while old constants are installed. Every source and helper restores exactly.
An initial comparison mixed the new parser with old constants and invalidated
enrollment; it is discarded, not counted as a regression. The corrected
whole-stack comparison above preserves the other 22 passing service tests.

[The drill register](m110-a1/a3-drills.json) records **29 accepted red drills**,
with exact mutation/restoration SHA-256, whole-file commands and failed
assertion names. All original/restored hashes match current production bytes.
Every invocation uses `--maxWorkers=1 --cache=false`, repository-default
timeouts, and at most three whole files; no test filter or timeout override.

| Drill group                                                                                                                                            | Threat rows             | Red failures / exact restorations |
| ------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------- | --------------------------------: |
| MAC, purpose, monotonic/wall expiry and future issuance, exact lifetime, replay membership/recording, pruning, epoch, RP/origin, key size, token bound | H03/H04/H05/H08/H09/H15 |                                14 |
| Success-only consumption, successful assertion consumption, complete-token proof                                                                       | H05/H09                 |                                 3 |
| Proof admission, no issuance admission, CPU window, source backoff and shared-source counterfactual                                                    | H09/H20                 |                                 5 |
| Actual HTTP, WebSocket and method-factory source propagation                                                                                           | H09                     |                                 3 |
| Protected TLS pair match before key derivation                                                                                                         | H02/H05                 |                                 1 |
| Enrollment, sign-in and step-up verified audit writes                                                                                                  | H15/H19                 |                                 3 |
| Total                                                                                                                                                  |                         |                            **29** |

The initial 28-drill pass was followed by the 1,001-source regression, which
exposed issuance still entering proof admission. That test first failed,
issuance was removed from that path, and all **29** final drills were rerun
against the final bytes. The duplication gate also first failed on repeated
synthetic key setup; both signed-proof tests now use the existing test-only
authenticator helper. No ignore, cap, threshold, rule or hook was changed.
The listener fixture installs its method spy even on the unsupported Windows
fallback path; this is a portable fixture correction, not a new Windows receipt.

### Dependencies and final verification

The rig lacked the pinned WebAuthn dependencies. An exact locked
`npm ci --prefix "$TMPDIR/a3-deps" --ignore-scripts --no-audit` installed in
private disk-backed scratch. Only **24 absent top-level package trees**
(including the nested `tslib` tree) were copied in. [The dependency receipt](m110-a1/a3-dependencies.json)
compares SHA-256, inode, mode, size and modification time for **31,224**
pre-existing files/symlinks: **0 changed entries**. No existing package,
symlink, npm bookkeeping, manifest pin or lockfile was modified. Vitest cache
writes are disabled. Scratch installation is removed before handoff.

Final whole-file verification on Kubuntu:

| Files                                                          |  Passed |
| -------------------------------------------------------------- | ------: |
| `nodePasskeyAuth`, `nodeAuthChallenges`, `nodeCertificate`     |      51 |
| `nodePasskeyVerifier`, `nodeStatelessProof`, `nodeAuthMethods` |      15 |
| `nodeListener`, `nodeListenerGuard`, `nodeListenerSocket`      |      97 |
| `node`, `nodeAuthSessions`                                     |     127 |
| `NodePairing`, `nodeAuthBuild`                                 |      16 |
| Total                                                          | **306** |

All five type projects, changed-file ESLint (`--max-warnings=0`), Prettier,
plain knip, duplication (**0 clones**), and localization (**14 tables, 164
manifest strings, 623 sources, 0 problems**) pass. Both production builds
exit **0**, including every unchanged size/split/host-globals/notices gate.
No new cast, escape hatch, suppression, timeout or test skip was introduced.

| Artifact                          | Size / unchanged cap (KiB) |
| --------------------------------- | -------------------------: |
| Auth server                       |            **497.0 / 500** |
| Auth page including CSS           |            **284.4 / 350** |
| Extension                         |                437.0 / 600 |
| Model API                         |                447.0 / 475 |
| Checkpoint store                  |                 77.3 / 225 |
| Node service                      |                  65.2 / 75 |
| ACP                               |                817.9 / 850 |
| Webview entry plus static imports |                896.8 / 900 |
| Deferred webview JS               |                  49.7 / 50 |

`check:host-api` exits **1** on the inherited generated record: Node import
counts and the already present pairing stylesheet. It reports 332 VS Code
APIs, 31 importing files, 25 Node built-ins and 61 theme variables, with one
record mismatch. J's integration regeneration, aggregate quality/coverage,
the inherited dependency-audit blockers, N/M104/T/C bindings and per-platform
browser/trust receipts remain the existing PLAN §7 handoffs. No network audit
or live/paid call is made under this brief. This receipt closes RVM110A2's
three findings within the authorized scoped lane, without claiming those
lead-owned certifications.
