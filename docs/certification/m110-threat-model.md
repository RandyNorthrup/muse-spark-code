# M110a0 home-node threat model

2026-10-05; lane M110L0; base `48250c33`. Scope: one owner's machine,
one container with `muse-node` and `muse-tools` (or two native units),
and browsers on the LAN. This is a design review, not a certification of
the listener, operating system, WebAuthn verifier or image.

Codex reviewed the contracts against this table. **Lead/Claude acceptance
is pending. No listener may be implemented from this record before that
review accepts it** (PLAN M110's ordering rule). Later phases must extend
and review this table before their listeners are written.

The source of the requirements is PLAN D90.3, .11–15, .18, .23 and Q-M110,
and [the research](../research/muse-node-2026-10-05.md), especially §2.5,
§3.6 and §7. No external source was fetched in this lane: the brief prohibits
network access except the named local captures. These sources require a fresh
check before a release; a research statement is not an OS/browser receipt.

## Assets and trust boundaries

The service user owns configuration, encrypted interim keys, TLS private keys,
passkey public keys, challenge/session state, conversations and audit files.
The tools user owns repository code and runs tools, checks, terminals and
agent CLIs. The node supplies no credential through its environment,
arguments or files. The person-facing git route performs SSH operations via
an owner-only agent socket; the tools user receives no such socket.

The LAN, browsers before sign-in, repository code, model output and every
tool result are untrusted. A passkey proves user verification; it does not
make a repository trustworthy. The browser's memory bearer is a capability,
never an identity record to persist. HTTP authentication and WebAuthn proof
verification belong to A1; a zod schema alone proves neither.

| ID  | Attacker / failure                                               | Required control                                                                                                                                                                                                                                                                                                                                     | Proof owner and red drill                                                                                                                                     |
| --- | ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| H01 | Unconfigured service opens a port                                | Config starts with `listener: null`. Bind only the explicitly chosen private or loopback address; reject wildcard, public, multicast and metadata addresses. Docker publication/firewall must enforce the same LAN scope.                                                                                                                            | L0 config schema; N/C/S0 process and off-LAN reach checks. Plant a wildcard/public bind.                                                                      |
| H02 | MITM or poisoned `.local` answer during first connection         | Console/TUI show the full SHA-256 certificate fingerprint. Compare out of band before installing trust. Leaf is non-CA; changed pin requires pairing again. A fallback CA must be name-constrained, with its root key destroyed.                                                                                                                     | A1/S0 and capture A0-TLS. Substitute a certificate or wrong SAN.                                                                                              |
| H03 | Warning click-through used for passkeys                          | Trusted HTTPS and domain RP id, never a bare IP. Fail with pairing instructions on a certificate error; no TLS bypass flag or browser exception qualifies.                                                                                                                                                                                           | L0 domain schema; A1 browser capture on every supported browser/OS. Test the untrusted certificate before enrolling.                                          |
| H04 | First LAN visitor claims the owner                               | Cryptographically random console setup code, stored as a hash, one use, 15-minute expiry. Atomic consumption and enrollment of exactly one first passkey. Setup page exposes no configuration or workspace.                                                                                                                                          | A1: race two enrollments; replay/expire code. L0 challenge lifetime/identity contract.                                                                        |
| H05 | Forged, replayed or cross-RP WebAuthn proof                      | Pinned SimpleWebAuthn verifier checks challenge, RP, exact origin, signature, type, user presence AND verification; consume challenge once, bind purpose/session/action; enforce counters as the library specifies for synced passkeys.                                                                                                              | A1 real verifier against the CDP authenticator. Replay, change challenge/origin, remove UV, reuse a step-up for another action. Test fakes are not verifiers. |
| H06 | Cookie, URL, asset, log or persistent-storage bearer             | Memory bearer only, Authorization header on privileged HTTP requests; no cookies/CORS/cache of API/auth replies. Reload signs in again. Persistent state/audit contain public session IDs only, never bearers, setup codes, proofs or challenge bytes.                                                                                               | L0 strict state/session/audit schemas. A1/U1 browser storage, URL, asset and log spy; plant a bearer.                                                         |
| H07 | Cross-origin form, fetch, EventSource or WebSocket               | Exact Host and Origin, strict Fetch Metadata, no CORS; reject before dispatch. HTTP authentication precedes params parsing/use. WebSocket authenticates in first frame within 5 seconds; same-origin handshake required.                                                                                                                             | A1/U2 guard tests for each transport, missing/multiple headers and forged origins. L0 validates frame order's shapes, not transport authorization.            |
| H08 | Stolen session opens shell or discloses a key                    | 30-minute idle and 12-hour absolute limits, monotonic elapsed time; action-bound fresh UV step-up (5 minutes maximum, consumed once). Lock ends sessions, terminals, turns and streams and seals keys.                                                                                                                                               | L0 session/step-up lifetime checks; A1/N stale/reused step-up and lock propagation drills.                                                                    |
| H09 | Sign-in guessing, resource exhaustion or audit disk fill         | Per-source AND account backoff; at most 100 consecutive failures, disabled authenticator thereafter. Bound challenge/session counts, frame/file sizes, terminal rate, listing/search results, and audit size/retention. Reject before expensive work.                                                                                                | L0 bounds; A1/N/U1/U2/C flood, over-limit and full-disk drills. No limit can grant access or answer an approval.                                              |
| H10 | Path traversal, symlink/race, file overwrite or shell injection  | Only workspace IDs and normalized relative POSIX paths over the method contract; no absolute path or `..`, NUL/control or backslash. Runtime resolves real paths and verifies containment/identity at use. File saves require an expected content digest, uploads their exact bytes/digest. Git uses argv and explicit refs; no shell concatenation. | L0 path/ref/frame schemas; U1/N symlink swap, stale-write and argument-injection drills. Schema validation cannot prevent filesystem races.                   |
| H11 | Repository or model steals service state                         | Drop root before node/tools run; separate UIDs, owner-only state and socket, no shared writable service executable or service config; tools cannot ptrace service. No Docker socket mount. Tool host verifies peer UID; node never trusts UID asserted inside a message.                                                                             | N/C native/container read, ptrace, environment and forged socket-peer drills. Fake tool host records credential-free requests; cannot prove OS isolation.     |
| H12 | Unattended ask auto-allows or bypasses paid policy               | Asks go to attached humans and expire as refusal. Unattended Plan/acceptEdits only, hard USD budget, protected paths and `requiresAsking` denied. Enhancements default on for the selected setup/capabilities; paid extras ask once before first charge with existing three choices, rates and shared `museSpark.paidDailyBudgetUsd`.                | N/controller/paid-gate integration: detach all surfaces, expire ask, attempt Bypass, deny first paid use. No paid calls in L0.                                |
| H13 | Terminal leaks typed secret into audit/model                     | Only start/end/size recorded, with person/model origin labelled. Step-up before PTY creation, caps/rate checks before writes, socket close ends PTY. Output goes to its authorized session only, never audit.                                                                                                                                        | L0 typed terminal audit/event separation; U2 canary keystroke and output spy, timeout/oversized-frame drills.                                                 |
| H14 | Agent pushes using owner's deploy key                            | Credentials usable only in person's git page after auth and bound operation. No key, SSH agent socket or git helper in tool environment. Exact remote/ref; deploy key public half may be shown, private half never in MHP.                                                                                                                           | U1/N fake git sentinel, tool `git push` denied, wrong remote/ref and canary drills.                                                                           |
| H15 | Power loss/restart silently replays work or loses audit ordering | Versioned state; newer version refused. Keys sealed and sessions dropped on boot. Reconcile durable work, leave uncertain attempts blocked. Append-only hash chain, sequence and previous digest checked; cap/rotation retains a verified anchor.                                                                                                    | L0 schemas; N persistence/restart, corrupt state, chain tamper and uncertain-attempt drills. Parsing a digest is not chain verification.                      |
| H16 | Compromised host/root, tool kernel exploit or physical theft     | Two users share a kernel/container. Root and host administrators can read service memory and disk. Sealed encrypted store protects unused provider/deploy keys at rest; boot TLS/session keys remain readable to their owner. Never claim container isolation protects against the host.                                                             | Explicit residual; N/C document actual permissions. M110b adds workspace sandboxes, not protection from root.                                                 |
| H17 | Malicious image/update/CLI or unsupported subscription path      | No credentials or Muse Code in shipped layers. Signed digest, SBOM, provenance and notices. Muse Code remains unavailable until bubblewrap AND headless sign-in captures pass; never `--yolo`.                                                                                                                                                       | C image tamper/layer canary; A0-BWRAP/A0-LOGIN captures. No guessed Muse/MSP frames in L0.                                                                    |

## Deliberate limits and phase exclusions

**H13 stream lifecycle (RVM110L0-2).** The tool-host observer is installed
before spawn. Output is acknowledged in order with bounded buffering and
paused PTY reads; a spontaneous exit follows all output exactly once.
Disconnect, lock, stop and consumer rejection dispose the PTY, descendants
and observer. N/U2/T bind this contract and A0-PTY proves it on real hosts;
L0's scripted output/exit/backpressure/disconnect tests are contract receipts.

**H18 — CLI sign-in versus the tools UID (Q-M110.9).** D90.23 puts agent
CLIs, terminals and repository tools under `muse-tools`; D90.7 also calls
for the CLI's owner-only sign-in home. Permissions alone cannot protect a
CLI's own files or memory from another process with the same UID. N/A1 must
qualify this boundary with synthetic auth-home and memory canaries under
the actual sandbox/process arrangement, without reading real credentials,
passing them to tools or using `--yolo`. Muse Code stays unavailable under
the existing Q-M110.7 default until the boundary and its captures pass.
This is an open design binding, not an implemented isolation claim.

L0 defines validation and injected ports, with test-only fakes. Downstream
lanes must implement the authentication, filesystem, OS, persistence and
network controls named above and prove their red drills. Unknown properties
are refused on this protocol; future incompatible changes get a new version.
Existing Muse Code/API parsers and their forward-compatible display rules
are unchanged.

M110a0 has no node-to-node pairing, relay, public listener, team users,
remote model proxy, governor, account pools or Live peek. A normal editor
or single-model user acquires no listener, changed request or node bundle.
The extension, ACP stdio, future native editor panels and headless runs bind
through the shared method port; no VS Code-only behavior is introduced.

Residuals: authenticated owner terminal access is arbitrary repository code
under the tools UID; terminal output and files can themselves contain user
secrets. Same-origin page compromise can steal the page's bearer. Passkeys
do not encrypt workspaces. Without full disk encryption, workspaces and boot
keys are readable from a stolen disk. A browser trust-store receipt and a
Docker firewall receipt are per platform, never inferred from fakes.
