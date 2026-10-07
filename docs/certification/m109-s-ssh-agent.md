# M109 S — SSH agent

Worktree: `/Users/randy/lanes/M109S`, branch `m109/s`, base `8a151dd40`.
The rig brief and shared Codex rules govern this lane. Only new SSH core
files, its tests and this lane's certification are changed. Shared wiring,
PLAN/CHANGELOG/README and the feature reference belong to integration W.
No credential store was read. Model attempts and paid calls: **zero**.

## First piece: keys, framing and known_hosts

`wire.ts` implements bounded RFC 9987 framing and validates parsed requests
with Zod. `keys.ts` generates Ed25519, imports PEM (including encrypted
PKCS#8) and unencrypted OpenSSH Ed25519, exports public keys/fingerprints,
and signs/verifies Ed25519, ECDSA P-256 and RSA SHA2. Private exports are
copied to unpooled owned Buffers and erased on failed ownership transfer.
OpenSSL's internal KeyObjects and immutable JS parsing strings cannot be
guaranteed zeroized; this retains D89's V7 residual.

`knownHosts.ts` checks literal, hashed, wildcard and negated names; it rejects
revoked keys, unknown keys and ambiguous aliases. Hashed/wildcard names need
a trusted launch destination. Certificates/CA entries are refused rather
than treated as ordinary host keys.

Primary protocols checked on 2026-10-06:
[RFC 9987](https://www.rfc-editor.org/rfc/rfc9987.html),
[OpenSSH PROTOCOL.agent v1.26](https://raw.githubusercontent.com/openssh/openssh-portable/master/PROTOCOL.agent),
[PROTOCOL.sshsig v1.4](https://raw.githubusercontent.com/openssh/openssh-portable/master/PROTOCOL.sshsig)
and [PROTOCOL.key v1.4](https://raw.githubusercontent.com/openssh/openssh-portable/master/PROTOCOL.key).
These public protocol reads used the documentation tool; no service/model
wire shapes or credentials were fetched. Lane 0's research corrections and
threat model were read, as was the accepted Q-M109 Secure Enclave receipt.

Verification on macmini, repository default test timeout:
`npx vitest run test/unit/vault/sshKeys.test.ts --maxWorkers=3` — 5 passed.
Scoped ESLint and Prettier passed. Hooks are present in `.husky/_/pre-commit`.
No dependency, hook, gate, budget or timeout was changed.

Eleven deliberate mutations failed the named owned tests; every source was
restored with its SHA-256 checked. Exact assertions and hashes are in
[m109-s-key-drills.json](m109-s-key-drills.json). The initial exploratory
mutations exposed three insufficient probes (a redundant host check, a
SHA1 method change without digest change, and a throwing test callback).
The probes were corrected and all eleven were rerun successfully; the
committed record contains only observed failures. No raised timeout was used.

## Integration boundaries

S runs within the separate broker process. B owns grants, approvals, taint,
presence, audit, tickets and revocation; C owns persistence. P supplies
hardware P-256 generation/signing and reference destruction through an
explicit injected port. The SE wrap capture proves wrapping/presence, not
SSH signing; no hardware signing support is inferred from it.

W binds the SSH endpoint into `dist/vaultBroker.js` and X/R install only the
requester's `SSH_AUTH_SOCK`. Activation gains no eager SSH import or process.
All editors use the same core through their existing broker/host bridge.
H/U/M bind generated/imported material to C and expose only public export.
The absent featureCatalog/reference and shared documentation additions must
be registered by W; this lane adds no shipped command or setting itself.

Windows' protected named-pipe listener and peer verifier are P/W-owned
injected ports. The broker never connects to the system OpenSSH pipe.
Windows and Git-for-Windows pipe/session-bind capture receipts remain a
named integration requirement; this Mac lane cannot claim those captures.

`docs/orchestration-gotchas.md` is absent on both this base and this rig's
`main` ref. Process identity checks, cancellation, private temp ownership
and cleanup are tested here; W must recheck G10/G11/G14/G16 against its
current register during integration.

The rig brief prohibits aggregate quality and integration merges: W/lead
owns joined-tree `npm run quality` and platform checks. S runs targeted
tests and scoped checks directly, with hooks enabled on every local commit.
