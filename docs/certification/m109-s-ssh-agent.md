# M109 S — SSH agent

Worktree: `/Users/randy/lanes/M109S`, branch `m109/s`, base `8a151dd40`.
The rig brief and shared Codex rules govern this lane. Only new SSH core
files, its tests and this lane's certification are changed. Shared wiring,
PLAN/CHANGELOG/README and the feature reference belong to integration W.
No credential store was read. Model attempts and paid calls: **zero**.

## Implementation and boundaries

`wire.ts` implements bounded RFC 9987 framing and validates parsed requests
with Zod; response frames from a fronted agent are also validated. The
incremental framer copies each byte once, bounds queued and incomplete
frames, and erases its borrowed frame after dispatch. `keys.ts` generates
Ed25519, imports PEM (including encrypted PKCS#8) and unencrypted OpenSSH
Ed25519/P-256/RSA, exports public keys/fingerprints,
and signs/verifies Ed25519, ECDSA P-256 and RSA SHA2. Private exports are
copied to unpooled owned Buffers and erased on failed ownership transfer.
OpenSSL's internal KeyObjects and immutable JS parsing strings cannot be
guaranteed zeroized; RSA parsing BigInts also retain this D89 V7 residual.
Encrypted OpenSSH's bcrypt format is explicitly refused. Implementing its
KDF would require an unplanned dependency or a substantial crypto implementation;
encrypted PEM is the supported encrypted import route. No helper receives a
private key or a passphrase. Certificates/CA authentication and other curves
are explicitly refused.

`knownHosts.ts` checks literal, hashed, wildcard and negated names; it rejects
revoked keys, unknown keys and ambiguous aliases. Hashed/wildcard names need
a trusted launch destination. Certificates/CA entries are refused rather
than treated as ordinary host keys. It is read again at each authentication
signature, so an edited/revoked entry invalidates an earlier binding.

`session.ts` owns one serialized queue and a generation per connection. It
verifies the host's session-bind signature, rejects duplicate session IDs
and rebinding after an authentication hop, parses the SSH user-auth packet,
and binds the remote user, service, method, client key, algorithm, session
and optional hostbound key. Arbitrary raw signatures are refused. The git
SSHSIG namespace has its own digest-bound use and cannot share an
authentication binding. A forwarding-only hop cannot sign; a complete
forwarding chain or a missing binding needs B's explicit grant authority.
Close/revocation aborts effects and wipes queued frames synchronously;
late identities, approvals and valid signatures cannot be sent.

`brokerAccess.ts` consumes B's actual registration token, request, authenticated
UI approval, ticket redemption, material callback, presence gate, invalidation
and audit/finish APIs. Every ticket is checked against the requester, item and
resolved-use digest. The signing callback runs in the broker; its signature
is checked and erased in finally. An external agent goes through the same
authorization and single-use redemption, with only reviewed public metadata
listed and a fresh upstream connection per signature. Verified binding frames
are replayed upstream; malformed, failed or invalid replies are erased and
refused. Upstream connections authenticate their server, serialize replies,
refuse unsolicited responses, and cancel on close, abort or the existing
approval lifetime.

`endpoint.ts` creates a random address per requester. The Unix implementation
checks B's owner-only directory, never replaces an existing path and sets
socket mode 0600. It pauses reads until OS peer verification and trusted
launched-process/requester lookup finish. Late lookups and listener failures
destroy their sockets. Windows requires a protected-listener port explicitly
tagged `windowsOwnerOnly`; ordinary Node pipe ACLs are never accepted. Windows
environment construction rejects the system pipe, restricts the private pipe
namespace and pins a quoted absolute Windows OpenSSH path when the captured
Git compatibility choice requires it.

Primary protocols checked on 2026-10-06:
[RFC 9987](https://www.rfc-editor.org/rfc/rfc9987.html),
[OpenSSH PROTOCOL.agent v1.26](https://raw.githubusercontent.com/openssh/openssh-portable/master/PROTOCOL.agent),
[PROTOCOL.sshsig v1.4](https://raw.githubusercontent.com/openssh/openssh-portable/master/PROTOCOL.sshsig)
and [PROTOCOL.key v1.4](https://raw.githubusercontent.com/openssh/openssh-portable/master/PROTOCOL.key).
These public protocol reads used the documentation tool; no service/model
wire shapes or credentials were fetched. Lane 0's research corrections and
threat model were read, as was the accepted Q-M109 Secure Enclave receipt.

The first piece was committed as `5676ef132` after its five tests, scoped
ESLint, Prettier and hooks passed. Hooks are present in `.husky/_/pre-commit`.
No dependency, hook, gate, budget or timeout was changed.

Eleven deliberate mutations failed the named owned tests; every source was
restored with its SHA-256 checked. Exact assertions and hashes are in
[m109-s-key-drills.json](m109-s-key-drills.json). The initial exploratory
mutations exposed three insufficient probes (a redundant host check, a
SHA1 method change without digest change, and a throwing test callback).
The probes were corrected and all eleven were rerun successfully; the
committed record contains only observed failures. That record describes the
first commit's sources; the final runtime record uses the current source
hashes. No raised timeout was used.

## Native macOS receipt

[m109-s-native-capture.json](m109-s-native-capture.json) records the offline
macmini capture with generated throwaway material: system `ssh-keygen -Y sign -U`
used the owned Unix endpoint, and an independent `-Y verify` succeeded.
The endpoint checked the real OS uid/pid through B's compiled peer helper
(`getpeereid`, `LOCAL_PEERPID` on the inherited fd), with process identity
restricted to the capture's own spawned client. Mode was 0600. A second
operation fronted the same owned test agent through fresh authenticated Unix
connections, validating identities and an SSHSIG signature. Four request
frames are recorded as public/generated payload hex, byte length and SHA-256;
no private material, account,
home path or upstream comment appears in the receipt.

The generated-key Ed25519 primitive measured p95 **0.289 ms** over 1,000
samples, below D89's 20 ms limit. This excludes full C persistence, broker
audit and presence latency; joined-system signing p95 remains W's measurement.
The native capture used a test-only policy port. Actual B approval, redemption,
presence, audit and lock behavior are tested separately in `sshBroker.test.ts`.
No live authentication/session-bind capture, Windows client capture, foreign-uid
OS capture or hardware signing capture is claimed. No installation was needed;
all generated temporary directories and private bytes were cleaned up.

## Runtime threats and failure drills

The final record is [m109-s-runtime-drills.json](m109-s-runtime-drills.json).
All **83** final mutations fired. Each mutation runs entire owned test files
(at most three workers), records
the named failing test, and restores the original bytes with SHA-256 verified.
The first runtime pass found two insufficient negative probes: an unsupported
hash still failed its length check, and a failed upstream bind still failed
signature verification. The probes now use an otherwise admissible hash length
and an agent that would return a valid signature. Both guards are rerun in
the final record. No production bypass or test filtering remains.

| Threat row              | S control and observed drill groups                                                                              | Boundary / residual                                                                                  |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| V1 injection            | `broker-taint-cancellation`, digest and destination mutations; taint goes through B for every use                | T supplies provenance and B owns forced ask; S never resolves model-supplied host names              |
| V2 command exfiltration | Only public keys and verified signatures are returned; private/public matching and signature-verification drills | X owns value feeders and egress; signatures remain usable capabilities                               |
| V3 malicious MCP        | Fronted-agent metadata, bind, reply and signature mutations refuse untrusted upstream data                       | O owns MCP/OAuth; S fronts only the explicitly chosen local agent                                    |
| V4 compromised host     | Approval-ticket requester/item/digest mutations, real B single-use/presence tests                                | B authenticates UI authority and registration; host compromise remains D89's stated residual         |
| V5 other user           | Unix socket mode, Windows listener-kind and peer/late-lookup drills; native uid/pid helper                       | P/W supply Windows DACL and foreign-user captures; root/admin remain outside isolation               |
| V6 same-user malware    | Hardware curve/active-generation/reference-destruction mutations                                                 | P owns OS key isolation and actual hardware signing/presence proof                                   |
| V7 memory reads         | Unpooled export, borrowed-frame, queued-close and signature-erasure mutations                                    | JS strings, BigInts, OpenSSL copies, swap and debuggers retain the stated residual                   |
| V8 clipboard            | Export is only the SSH public line/fingerprint, with generated-key tests                                         | U owns the clipboard affordance and its public-only test                                             |
| V9 logs/exports         | Real B audit excludes generated private material; upstream comments are ignored                                  | T/W own joined scrub and SAST gates; S emits no logs or transcript value                             |
| V10 devices             | Per-requester endpoint and cancellation tests apply to R's injected requester mapping                            | R owns authenticated device transport and per-use owner approval                                     |
| V11 replay              | Bind replay/rebind/session/key mutations, substituted approval tickets; real B rejects redeemed-ticket replay    | B owns counters/expiry; C owns rollback state                                                        |
| V12 unattended          | B presence is redeemed afresh for each use; failed presence releases nothing                                     | B/H/R own unattended admission; S introduces no unattended bypass                                    |
| V13 impersonation       | Isolated endpoint addresses, OS peer before access, late-peer/lookup and requester-ticket drills                 | X/R must bind access to the process they launched, using pid/start/image, never a frame's claimed ID |
| V14 fill spoofing       | Untouched                                                                                                        | L owns browser origin/frame/certificate controls                                                     |
| V15 sudo swap           | Untouched                                                                                                        | X owns sudo path/argv/cache controls                                                                 |
| V16 vault concentration | Session generation/close wipes, requester invalidation and real B late-hardware-lock tests                       | B/C/P own idle/screen-lock, store/cache lifecycle and process termination                            |

## Final checks

Final check results and current source hashes are recorded in
[m109-s-checks.json](m109-s-checks.json). Tests use the repository default
timeout, in two runs of three files. Aggregate quality, coverage across the
joined tree and editor/platform checks remain lead-owned under the rig brief.

On macmini: all five typecheck projects passed, followed by a unit-project
recheck after test cleanup; scoped ESLint and Prettier passed; knip and jscpd
passed; localization reported **14 tables / 0 problems**; **48 tests passed**
(23 core/import/session, 25 broker/transport/connection). Lint found a Boolean
name, duplicated branch tail and Buffer/string concatenation in tests; those
were corrected. jscpd found two repeated test constructions; shared file and
presence helpers removed both, and the unchanged zero-duplication threshold
passed. Production build, all size/split/global checks and notices passed:
extension **436.9 / 600 KiB**, Model API **446.8 / 475 KiB**, checkpoint store
**77.1 / 225 KiB**. These are the existing shipped bundles; W must budget the
joined lazy vault broker when it wires S.

`check:host-api` reports one stale shared-record problem. The source now counts
`node:child_process` 14, `node:crypto` 58, `node:fs` 37, `node:fs/promises` 50,
`node:net` 12 and `node:path` 90 imports. VS Code APIs remain 332, files importing
VS Code remain 31 and theme variables remain 61. The W-owned generated record
was left untouched under the lane ownership rule; **W-SSH-BUNDLE** must run
`npm run check:host-api -- --write` and review it. No gate or ignore was weakened.

The final commit hook initially flagged four file SHA-256s as generic API keys
because their JSON property names were source filenames containing `key`.
The checks receipt now uses explicit `{ file, sha256 }` rows. No hash or source
was changed, and no secret-scanner exception was added.

## Integration boundaries

S must be constructed within the separate broker process. B owns grants, approvals, taint,
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
The entries are SSH key generation (Ed25519 / P-256 hardware), selected-file
import with the supported formats above, public-key export, external-agent
review/fronting, git signing grants and the Windows OpenSSH choice.

Named handoffs:

- **W-SSH-BUNDLE:** bind these core factories into the lazy broker chunk,
  keep activation budgets unchanged, regenerate host-API/reference records,
  update PLAN/README/CHANGELOG, and run joined-tree quality before release.
- **B-SSH-APPROVAL:** wire `SshApprovalPort.wait` to the authenticated host UI;
  on abort consume a pending request with authenticated Deny. A bare user/mode
  approval never substitutes for an any-host/forwarding grant. The current B
  result reports one authority: in Ask modes even a matching standing grant
  becomes `user` authority. S conservatively refuses unproven/forwarded uses
  in that case. B must carry verified grant coverage if those Ask modes should
  permit them; S does not grow a second grant-policy owner.
- **B-C-M-SSH-EXTERNAL:** supply a reviewed, persistent external-key metadata
  registry and its B-authorizable item. Lane 0 has only software/hardware SSH
  material variants; external material representation belongs to the joined
  contract/store work. The external-agent port has no fake storage substitute.
- **P-SSH-HARDWARE:** bind nonexportable P-256 generation/signing/destruction;
  prove actual SSH signatures and fresh presence on capable hardware. C adopts
  successful references; failed/late acquisition is destroyed by S.
- **X-R-SSH-REQUESTER:** install the endpoint environment only in the launched
  requester, map verified OS pid/start/image to its B token, and terminate that
  pinned process tree on revocation. Supply selected known_hosts through a
  bounded read port; destination comes from trusted launch context.
- **P-W-SSH-WINDOWS:** implement the owner-only DACL/remote-client-rejecting
  listener and OS peer/server verifier; capture Windows OpenSSH and Git for
  Windows separately to supply the compatibility choice. Linux/macOS live
  authentication/session-bind and foreign-user captures also remain required.
- **H-U-M-SSH-MATERIAL:** persist generated/imported keys through C, own/erase
  selected file/passphrase buffers, and expose public export through the shared
  host bridge in every editor.

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
