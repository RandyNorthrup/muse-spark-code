# M100 threat model (phase 1 baseline plus phase-2 update, lane 0)

Lane M100P2L0, 2026-10-07. Phase 1 is integrated (`m100/int`, accepted) and
unshipped: no installed Devices command, physical adapter or unattended
receiver is registered by this change. This file is the contract every later
phase-2 lane codes against; lane W carries it into SECURITY on joining.

## Phase-1 baseline (unchanged)

- Explicit, mutual, revocable pairing (D80.1): per-pair keys generated
  locally, public invitations only, fingerprint confirmed on both screens,
  no trust on first contact. The invitation is not a Bearer [REDACTED]
- Pinned mutual TLS 1.3 on a chosen loopback or private address, exact
  per-pair pins, verification always on, revocation checked on every
  request (D80.3).
- Least-privilege offers over M96 policy: scoped repositories, roles,
  caps; workers use isolated copies or read-only snapshots (D80.4).
- Durable ownership: dispatch/admission/launch intents journaled first;
  identity is the pair key plus incarnation, board, task and attempt, never
  the address; reconnect reconciles before resume; late results quarantine
  (D80.7).
- Permissions and paid consent stay on the executing device; pairing grants
  no authority (D80.8). Per-device privacy and cost ownership (D80.9).
- Same-machine boundary `M100-LOCAL-ACCOUNT`: the OS, logged-in account,
  extension host and installed extensions are trusted. Per-user 0700
  directories and 0600 files, ownership/permission and symlink checks, exact
  mutual-TLS peer checks on loopback. No pair keys or provider secrets on
  argv or environment. A same-user process or administrator can still
  replace a syntactically valid journal outcome; zod, atomic writes and
  permissions do not prove provenance against it. Runtime red drills
  P-local-store-isolation, E-local-journal-isolation and
  T-local-peer-credentials run before any listener ships
  (`docs/certification/m100-0.md`).

## Phase-2 additions (this lane)

### Owner binding (lane K reads)

Pairs and grants bind to their owner (the owner binding rule lane K
implements): a device serves two orchestrators only with separate grants
and quotas per owner (`ownersPerDevice`, `grantsPerOwner`). Every security-relevant action is authorized per message
by role under a least-privilege, time-bounded, revocable grant
(`deviceGrantSchema`, at most `grantValidityMs`) and audited. A valid pair
key for the wrong owner fails with `owner-mismatch`, never admission. No
grant shape carries a credential field: a planted secret refuses to parse,
and secrets never cross the channel in the clear — brokered uses go through
M109's vault. Windows pair keys rest under OS store protection (the DPAPI
lane of M109's platform slots); raising a desktop-heap registry value or
touching any registry key needs explicit user consent first.

### QR and mDNS discovery (lane D reads)

Discovery supplies addresses, never trust (D80.2). A QR invite decodes to
the identical text invite: public certificate, fingerprint, address,
protocol version and bounded validity — never a Bearer [REDACTED] Copying a
public invite without its private key must fail pairing. mDNS is off by
default and advertises only an opaque service id, port and protocol
version; a spoofed record never replaces the saved peer pin. Manual entry
connects with discovery fully blocked. No global discovery, relay, UPnP,
port scan or automatic firewall change is added.

### Windows store and worker context (lane H reads)

Windows workers run in their own scheduled-task or service context, never
under the transport session (G51). A desktop-heap failure surfaces the
`STATUS_DLL_INIT_FAILED` diagnostic with recovery steps, never a silent
retry or a registry change. Remote commands run with an explicit recorded
environment, stdin closed explicitly, results on a structured
exit-code-plus-JSON channel (G14, G15).

On macOS, an unprivileged per-attempt launchd helper uses the resource
coalition inherited across fork/exec, setsid and double-fork reparenting.
It samples whole-coalition counts every `POSIX_TREE_EXIT_POLL_MS` (**20 ms**)
and SIGKILLs every enumerated member when the admitted process limit is
exceeded, settling typed `capacity` only after observed whole-membership
exit. The helper and final retirement observer use the same coalition ID;
process groups and parent walks cannot replace this proof. Windows job
objects and Linux cgroup `TasksMax` enforce caps in the kernel at fork;
macOS enforces by supervised termination on the next sample, subject to
scheduler delay and scan cost. Short-lived excess processes may execute
between samples. The unchanged UID-wide `RLIMIT_NPROC` is only the outer
bound. The native HM3 probe measured a UID membership scan at **0.037930 ms**
mean over 100 scans (about **0.19%** of the interval, excluding I/O/accounting).
The full native sample (counts, enumeration, memory/power accounting and
atomic query-file write) averaged **1.221855 ms**, median **1.210392 ms**,
maximum **2.027655 ms** over 100 samples with three coalition tasks: **6.11%**
of the 20 ms interval in wall time. The loop subtracts that work from its
sleep; an overrun samples again immediately. These are measured costs on
this Mac, not a guarantee against scheduler stalls or transient overflow.
H's `deviceWorkerDarwin.test.ts` proves cap-2 overflow termination including
a setsid/double-fork escapee, cap-3 completion and no retirement while an
escapee lives. Unsupported private ABI or GUI-manager observations fail
closed; lost observations retain uncertainty and occupancy.

### Per-action control (lane A reads)

Every admission binds the sender's role/mode ceiling to the receiver's
repository grant, role/tools, workspace trust, protected paths and current
approval policy under an explicit receiver-side grant
(`DeviceActionGrantPort.admit`, with typed `deviceGrantRefusalSchema`
refusals). Physical or maker actions need a fresh per-action step-up
(`deviceStepUpSchema`, at most `stepUpValidityMs`) confirmed on the device.
User-presence prompts (Touch ID, Windows Hello) are relayed to the device
and answered there; the closed presence set has no unattested kind, so a
faked answer has no value that parses. A waiting prompt shows
**Waiting for approval on {device}**.

### Channel pacing and the result channel (lanes C and R read)

One long-lived authenticated channel per pair with control over
status/events over logs over bulk. At most `pendingHandshakes` pending
handshakes per host with jittered exponential backoff from
`handshakeBackoffBaseMs` capped at `handshakeBackoffMaxMs`; refusal reads
throttled or **Unknown since {time}**, never down (G50). No port probes:
health is the authenticated ready call. One failed authentication stops and
asks; retries never loop (G52). Every new envelope carries the protocol
version and refuses unknown fields rather than dropping them; the receiver
surfaces the refused shape for display (D36). Results return
content-addressed through the result channel and are acknowledged once
(`accepted`, `quarantined` or `duplicate`); resume resends only
unacknowledged messages under a new epoch and never launches twice.

### D101 reconcile

D101 is not in `PLAN.md` yet, so no lane waits on it. If D101 lands and
touches pairing or transport, lane 0 reconciles its scope: the versioned
envelopes above carry the protocol version precisely so a D101 wire change
fails closed at parse time, and the `owner-mismatch` / `grant-revoked`
refusals give D101's reconcile a typed vocabulary for re-binding pairs and
grants without inventing a new channel. The threat table below names its
mitigation, owning lane and planned test.

## Threat table (each row names its mitigation, owning lane and planned test)

Later lanes code against these rows; the owning contract test parses this
table and requires every threat to carry a lane and a test name.

| Threat                  | Mitigation                                                                                                                                                                                                                 | Owning lane | Planned test                                                                                |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- | ------------------------------------------------------------------------------------------- |
| Stolen pair key         | Revocation checked on every request; a valid key for the wrong owner fails owner-mismatch, never admission; Windows keys rest under OS store protection                                                                    | lane K      | test/unit/ownerBind.test.ts › refuses a revoked pair key on every envelope                  |
| Malicious paired device | Least-privilege time-bounded revocable grants with per-message authorization under an explicit receiver-side grant; no secrets in the clear, brokered uses go through the vault                                            | lane A      | test/unit/actionGrants.test.ts › refuses admission past the receiver intersection           |
| Replay                  | Bounded invitation, grant and step-up windows; results acknowledged once per epoch with late results quarantined, never applied; a replayed grant past its bound refuses to parse                                          | lane K      | test/unit/ownerBind.test.ts › refuses a replayed grant past its validity bound              |
| Downgrade               | Protocol version literal on every envelope fails closed at parse; no offline throttle state; unknown fields refused, never dropped                                                                                         | lane 0      | test/unit/devicePhase2Contracts.test.ts › refuses a wrong version on every channel envelope |
| Resource exhaustion     | Byte cap on every envelope enforced by a schema parse before use; queue caps on handshakes, owners, grants and result acks; jittered backoff capped at ten minutes; journal and artifact caps stop work instead of growing | lane C      | test/unit/channel.test.ts › queues a handshake burst past pendingHandshakes under backoff   |
| D101 reconcile          | Versioned envelopes fail closed at parse on a D101 wire change; owner-mismatch and grant-revoked give the reconcile a typed vocabulary for re-binding pairs and grants without a new channel                               | lane 0      | test/unit/devicePhase2Contracts.test.ts › keeps the D101 reconcile vocabulary typed         |

## Phase-2 dependency choices (lane D installs, lane W notices)

QR render and mDNS responder are lane D's runtime dependencies. No new
dependency is installed by this contracts lane: under the rig network rule
the registry cannot be reached from here, so exact pins, peer ranges,
`npm audit` and third-party notices are verified by lane D at install time
per AGENTS.md rule 9 (record the reason in `PLAN.md`), and lane W wires the
notices gate. Selection criteria, already fixed by this lane:

- QR render: a dependency-free encoder with no network or native code,
  usable from the lazy Devices bundle without widening the activation
  closure. It renders the exact text invite; it never sees a private key.
- mDNS responder: a dependency-free pure-JS responder (no Avahi/Bonjour
  SDK, no native build), advertising only opaque service id, port and
  protocol version while a paired receiver is enabled, off by default.
- Both: exact pins, compatible peer ranges, a clean `npm audit`, and an
  entry in the third-party notices before lane D's code lands.

## Red drills (this lane)

Each drill breaks one guard on purpose, watches the owning contract test
fail, and restores the file byte-exact (SHA-256 checked before and after):

- Drop the `version` literal on `deviceReadySchema`: the channel version
  test fails.
- Raise `pendingHandshakes` past the burst the pacing test asserts: the G50
  pacing test fails.
- Loosen `deviceGrantRequestSchema` to a non-strict object: the planted
  secret parses and the no-credential test fails.

## Residual risk

Unshipped slice: no installed listener, receiver or physical executor is
added, so no concrete physical-action descriptor, receiver-local approval
UI or unattended-operation claim follows. Windows DPAPI binding, real lazy
Devices readers beyond the declared entry, and installed four-device
qualification stay with lanes K, W and I. The D101 reconcile above is a
note, not an implementation.
