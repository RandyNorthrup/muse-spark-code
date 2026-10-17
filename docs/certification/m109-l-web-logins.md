# M109 L — web logins

Worktree: `/Users/randy/lanes/M109L`, branch `m109/l`, base `8a151dd40`.
Rig: Mac mini. Scope: PLAN D89.9 and M109 acceptance 15, including V14.
Read D89 and M109 in full, the credential-vault research, lane-0 threat
model, the common rules and orchestration gotchas. No model attempts, paid
calls, credential-store reads, network downloads, dependencies or settings
changes. No merge, push or rebase. Shared lane-owned files are untouched.

## Implemented core

- `webFill.ts`, `origin.ts` and `ticket.ts`: broker-ticketed username,
  password and current-code fill through `Input.insertText`. The resolved
  use binds the registered browser, exact top/frame origin and frame,
  valid certificate and actual input kind. Checks repeat after awaits;
  the M81 lease must pin navigation and focus through dispatch. Denial,
  replay, cancellation, revocation, stale facts, material substitution,
  malformed responses and failed audit settlement refuse with fixed words.
  Settlement failure also terminates the owned browser.
- `pageRead.ts`: isolated-world text-node read excludes all input controls,
  scripts and hidden fields. It never reads a password value. T's scrub
  dependency is mandatory, runs before clipping, and is checked again
  against the lease after its await. Errors expose only fixed words.
- `sessions.ts` and `cookies.ts`: trusted Sign in yourself uses an injected
  headed full-Chrome owner verified against version, manifest and executable
  digests, with no virtual authenticator. Capture on user close keeps only
  secure host-only cookies on the exact origin. Native expiries are retained
  or shortened to 30 days; expired cookies disappear. Restore is brokered,
  checks item/metadata/cookie expiry coherence, and erases decoded buffers.
  The private envelope rejects additional properties, including passkey
  material. Cancellation and failure always tear down the headed owner.
- `csvImport.ts` and `items.ts`: explicit reviewed Chrome/Bitwarden CSV
  import, with RFC 4180 quoting, CRLF, BOM and strict UTF-8. All rows validate
  before any write. File/field/row bounds, duplicate identities/headers,
  unknown/passkey columns, non-login types, unsafe origins and unsupported
  TOTP URIs refuse. Names are generated, labels contain only the origin,
  and every new item asks every time. Results contain metadata only; partial
  write failures report the writes already acknowledged by the store. All owned import
  buffers are erased on success, decline and failure.

B must run fill and restore in its broker-owned browser adapter; their
host-facing contract carries uses, tickets and metadata, never raw values.
Models, hooks and third-party browser MCPs cannot reach the trusted import
or Sign in yourself actions. These process/UI bindings remain with their
owners below; injected core ports alone are not a process isolation claim.
The production modules contain no fake browser, store, broker or scrubber.
The core imports no `vscode` and has no model/provider condition, so every
editor uses the same logic through the named bindings below.

## TOTP

`src/core/vault/web/totp.ts` implements RFC 6238 with `node:crypto` HMAC,
SHA-1/256/512, six/eight digits, a 64-bit counter, fixed-width output and
strict base32 decoding. Raw seed bytes remain owned by the broker caller.
Temporary key and counter buffers are unpooled; they and the digest are
erased in `finally`. Returned code/seed buffers transfer ownership to the caller.
Published RFC seeds are generated at test runtime, not stored fixtures.

`totp.test.ts`: seven tests passed with the default repository timeout.
The suite checks all 18 Appendix B vectors, leading zeroes, step boundaries,
invalid times/periods/seeds and canonical base32. Initial vector failures
exposed a fixture generation error (`:` instead of `0`), corrected before
the passing run. Host typecheck passed. Targeted TOTP eslint passed.

Initial red drills T01–T04: change the counter; drop time validation; accept nonzero
base32 trailing bits; accept incorrect padding. Every mutation failed its
named test(s), with the source restored byte-exact and its SHA-256 compared.
Full receipts: [m109-l-totp-drills.json](m109-l-totp-drills.json).

## Integration bindings reserved for their owners

The base has M81 A1's pinned **headless shell**, but no headed full-Chrome
pin, no installed runtime in this worktree, and no captured certificate and
focus lease for credential fills. No guessed CDP shapes or production fakes
are substituted. L's required dependencies are explicit in `web/ports.ts`.

- **M109-L-M81**: M81 binds `WebBrowserOwnerPort.withTarget` to its single
  browser owner, the CDP pipe, isolated-world focus inspection without any
  input-value read, exact top/frame origin and certificate observations,
  and a navigation/focus barrier through insertion. Add the item's origin
  host to that check's explicit frozen scope before preparation. Bind cookie
  read/restore to captured, validated CDP shapes in that private context.
  Third-party browser MCP servers never receive this port.
- **M109-L-HEADED**: M81's runtime store provides a separately verified
  full Chrome-for-Testing pin, the existing download consent, a fresh
  profile, projected environment, owned process tree, confinement and
  cleanup. `HeadedWebBrowserPort.captureOnUserClose` keeps the private
  context alive for cookie capture before final process teardown. It must
  never add a virtual authenticator. No system browser fallback.
- **M109-L-BROKER**: B binds `WebUseBrokerPort` to its authenticated requester
  and fresh registration incarnation, in the broker-owned process. The
  host receives only the use, ticket and metadata, never login material.
- **M109-L-SCRUB**: T binds `readWebPage` to the broker scrub service. M81
  uses this read path after fills and scrubs every other textual report
  boundary; no identity fallback. Password values are never read.
- **M109-L-IMPORT/UI**: M/U/H bind the trusted CSV pick/review and the trusted
  Sign in yourself action to the same core in every editor. Existing lane-0
  strings (`signInYourself`, `passkeys`, `importFile`, `deleteWarning`,
  `fillUse`, `useChanged`) already have all translations. No featureCatalog
  exists on this base; W lists web fill, TOTP, session restore, Sign in
  yourself and Chrome/Bitwarden CSV import in the help reference and docs.
- **M109-L-BUNDLES**: W includes L only in the lazy vault/browser bundles,
  assigns the new chunk's budget and split guard without increasing any
  cap, and applies the existing shared English/validation bundle plugins.
  Move the fixed default TOTP step to the vault constants region if that
  region is consolidated. Activation imports none of L. README, CHANGELOG,
  the feature help reference and UI reachability remain W/M/U/H-owned.
- **M109-L-HOST-RECORD**: W regenerates `docs/ide-compatibility/host-api.md`
  on the joined tree. The read-only gate on this lane exits 1 for stale Node
  import counts: buffer 39→43, child_process 13→14, crypto 46→54, fs 33→36,
  fs/promises 47→49, net 7→10 and path 84→89. L adds four buffer imports and
  one crypto import; the remaining delta is inherited from the broker base.
  No generated document or gate is modified by L.

## Capture and joined-tree checks

Local HTTPS fill and headed WebAuthn/authenticator captures require the
verified runtime(s). They are pending; there is no support claim for an
uncaptured headed browser or certificate/focus binding. The user was asked
for an installed runtime path while core work continued. A capture must
name the workspace, runtime digest, local generated TLS fixture, frame
hashes, authenticator availability and zero model attempts.

The rig brief explicitly forbids the aggregate quality run and keeps
joined-tree/platform gates with the lead. L runs targeted suites, typechecks,
eslint, prettier, localization, deadcode, duplication, host API and build
directly, one heavyweight command at a time, with default test timeouts.
The existing generic empty CDP acknowledgement and Runtime.evaluate
envelope follow `src/core/browser/pageCheck.ts` and
[M81's pin/capture record](m81.md#captures-rigs-no-model-attempts), for
154.0.8037.92 on the rigs, zero model attempts. Focus/certificate facts and
CDP cookie shapes are explicitly normalized adapter inputs, rather than
new guessed vendor parsers. Their new local HTTPS captures remain pending.

## Verification and red drills

All verification runs directly on the Mac mini, one heavyweight command
at a time. Final suites use the default timeout, no filters or raised
timeout, at most three files per run and `--maxWorkers=3`.

| Suite                  | Passing tests |
| ---------------------- | ------------: |
| `webFill.test.ts`      |            29 |
| `webSessions.test.ts`  |            23 |
| `webCsvImport.test.ts` |            10 |
| `webPageRead.test.ts`  |             4 |
| `totp.test.ts`         |             7 |
| Total                  |            73 |

The fill suite also runs against B's actual broker: explicit approval,
single-use replay refusal, audit without the actual plaintext canary, and
taint overriding a standing grant. The DOM test copies the actual password
canary into page text and proves it is scrubbed; its password value getter
throws if touched. Buffer-owner observations prove cleanup, rather than
checking copies that the implementation never owned.

83 distinct drills are red, across 84 recorded attempts. The first C09
attempt survived because its empty cookie list was rejected by another
guard. The test was corrected to use otherwise valid unexpired cookies;
C09b then failed at the strict-envelope guard. The original survivor stays
in the receipt. No guard, gate, threshold or timeout was weakened.

| IDs          | Proven boundary                                                                                                                                                                                                            |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T01–T08      | RFC counter, time/algorithm/digits/seed bounds, canonical base32, key/counter/digest erasure                                                                                                                               |
| F01–F21      | HTTPS, URL credentials, certificate, exact origins/frame/browser, input kinds, digest/redemption identity, live/cancel/revoke barriers, material origin, lossless UTF-8, erasure, fixed errors, failed settlement teardown |
| P01–P06      | No password reads, copied values scrubbed, CDP exception/size refusal, post-scrub invalidation, fixed invalid-URL errors                                                                                                   |
| C01–C09/C09b | Secure host-only exact-origin cookies, no private-key extras, expiry/cap, unique identity, capture erasure, strict envelope                                                                                                |
| S01–S14      | Headed verified Chrome, all three pin comparisons, no virtual authenticator, owned teardown, restore origin/expiry coherence, safe deadline                                                                                |
| I01–I25      | Explicit review, known login-only columns, safe metadata, identity, buffer erasure, lossless UTF-8, file/field/row bounds, partial receipts, strict/default TOTP URI, exact row/header/quote syntax, no empty success      |

Each mutation ran its complete owning test file and failed a named test;
all mutated source was restored byte-exact and checked by SHA-256.
Receipts: [TOTP drills](m109-l-totp-drills.json) and
[web drills](m109-l-web-drills.json). Compound drills bypass both independent
layers where necessary to prove the complete boundary.

Lane gates: all five typecheck projects, targeted eslint with zero warnings,
targeted prettier, knip, duplication (zero clones), localization (14 tables,
zero problems), L's four entrypoints under dpdm (no cycles), and production
build pass. The host API gate's single stale-record failure is documented
above. Aggregate quality, coverage, joined-tree gates and platform/live
receipts remain with the lead under the rig rules; no commit is represented
as aggregate-quality certified.

Production build size/split/globals/notices gates pass without cap changes:
activation 436.9/600 KiB, Model API 446.8/475 KiB, ACP 817.0/850 KiB,
webview with static imports 897.9/900 KiB and deferred webview 49.7/50 KiB.
L is not yet imported by a shipped bundle on this base. An ephemeral
minified Node20 core entry using the existing shared English/validation/wire
plugins measures about 33.2 KiB; it is an integration estimate, not a new
shipped chunk or budget. W supplies the actual entry and split/size guards.

Commits use the repository's unchanged hooks (lint-staged and gitleaks) and
the required co-author footer. Scratch scripts, logs and estimate artifacts
are removed from this worktree after the receipts are committed.

## Residuals

CDP requires transient JS strings for insertText. Cookie JSON/base64 and CSV
parsing also create JS strings that cannot be reliably zeroed. Owned byte
buffers are erased; this does not claim memory zeroization. A page script
on the approved origin can observe a filled value, so scrub remains a second
line. Cookie isolation requires host-only secure cookies and the confined
browser's exact origin scope; ordinary cookies are not isolated by TCP port.
No passkey is read, created, imported, stored or exported by this lane.
Host-only cookie restriction deliberately refuses wider Domain cookies.
The lane-0 web-login schema requires nonempty username and password bytes;
CSV rows missing either refuse rather than silently changing the contract.
Import does not delete the user's CSV: the trusted host's delete-warning
flow is part of M/U/H's integration binding.
