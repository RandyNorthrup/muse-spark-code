# M109 L — web logins

Worktree: `/Users/randy/lanes/M109L`, branch `m109/l`, base `8a151dd40`.
Rig: Mac mini. Scope: PLAN D89.9 and M109 acceptance 15, including V14.
Read D89 and M109 in full, the credential-vault research, lane-0 threat
model, the common rules and orchestration gotchas. No model attempts, paid
calls, credential-store reads, network downloads, dependencies or settings
changes. No merge, push or rebase. Shared lane-owned files are untouched.

## First piece: TOTP

`src/core/vault/web/totp.ts` implements RFC 6238 with `node:crypto` HMAC,
SHA-1/256/512, six/eight digits, a 64-bit counter, fixed-width output and
strict base32 decoding. Raw seed bytes remain owned by the broker caller.
Temporary key, counter and digest buffers are unpooled and erased in
`finally`; returned code/seed buffers transfer ownership to the caller.
Published RFC seeds are generated at test runtime, not stored fixtures.

`totp.test.ts`: six tests passed with the default repository timeout.
The suite checks all 18 Appendix B vectors, leading zeroes, step boundaries,
invalid times/periods/seeds and canonical base32. Initial vector failures
exposed a fixture generation error (`:` instead of `0`), corrected before
the passing run. Host typecheck passed. Targeted TOTP eslint passed.

Red drills T01–T04: change the counter; drop time validation; accept nonzero
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
  cap, and moves the fixed default TOTP step to the vault constants region
  if that region is consolidated. Activation imports none of L.

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
Final receipts and the remaining core red drills will be added below.

## Residuals

CDP requires transient JS strings for insertText. Cookie JSON/base64 and CSV
parsing also create JS strings that cannot be reliably zeroed. Owned byte
buffers are erased; this does not claim memory zeroization. A page script
on the approved origin can observe a filled value, so scrub remains a second
line. Cookie isolation requires host-only secure cookies and the confined
browser's exact origin scope; ordinary cookies are not isolated by TCP port.
No passkey is read, created, imported, stored or exported by this lane.
