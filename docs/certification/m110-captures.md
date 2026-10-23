# M110 captures and lead handoffs

Lane M110L0, 2026-10-05, Mac mini, worktree
`/Users/randy/lanes/M110L0`, base `48250c33`. Model attempts: **0**.
No credential read, sign-in, OS trust-store change, firewall change, image
pull, external network request or live/paid model call in this lane.

## A0 receipts needed before claiming home-node support

| Capture     | Matrix / required evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | Status and binding owner                                                                                                     |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| A0-TLS      | Windows 11: Chrome, Edge, Firefox; macOS: Chrome, Edge, Firefox, Safari; Linux: Chrome, Edge, Firefox (Safari unavailable). Throwaway self-signed non-CA server certificate, chosen domain SAN, certificate fingerprint, browser/build/OS. Before trust, WebAuthn refuses even after warning click-through; after trust, register/assert with UV; changed certificate refuses. Record per-browser certificate store and cleanup. If leaf trust fails, test the name-constrained intermediate fallback and prove root-key destruction.                                                    | Waiting on lead's authorized throwaway OS/browser profiles; no system/user settings changed here. A1/S0 consume receipts.    |
| A0-NAME     | Each OS: node `.local` resolution from another LAN PC, resolver path, chosen SAN/RP name, DNS answer and successful TLS connection. Repeat after DHCP renumbering. Router DNS/hosts-file fallback needs its own instructions/receipt.                                                                                                                                                                                                                                                                                                                                                    | Local Mac host inventory only below; cross-PC Windows/Linux/macOS resolution waiting. A1/S0/Y2.                              |
| A0-PUBLISH  | Docker Desktop macOS and Windows 11/WSL2; Docker Engine and rootless Podman Linux; amd64 and arm64. Bind/publish chosen LAN address, connection from second PC, no wildcard/public publication, Windows Firewall prompt and selected network profile. Two-user socket and state volume permissions.                                                                                                                                                                                                                                                                                      | Waiting on lane C's image and lead's firewall authorization. C/S0/N.                                                         |
| A0-BWRAP    | Muse Code glibc build in rootless Docker/Podman on Linux amd64 and arm64, and Desktop containers. Exact seccomp/AppArmor/user namespace settings; a sandbox shell command without a model turn, succeeds under approved constraints; blocked state read. No `--yolo`, privileged mode or disabling sandbox to get green.                                                                                                                                                                                                                                                                 | Waiting on C/N tool-host image and Linux/arm64 rigs. Muse Code backend remains unavailable pending receipt.                  |
| A0-PTY      | PTY launched by actual tool host as `muse-tools`, on Desktop Windows/macOS and Linux Docker/Podman, amd64/arm64: UID, tty size/resize, UTF-8 echo, EOF/disconnect/cancel, descendant cleanup, state read and ptrace denial, sanitized environment.                                                                                                                                                                                                                                                                                                                                       | Waiting on N's tool host and C's image. Test fake is not an OS receipt.                                                      |
| A0-WEBAUTHN | Pinned Chrome for Testing/M81 build, throwaway localhost page, injected CDP virtual authenticator. Record CDP version/options, register/assert with UV, wrong challenge/origin/RP, UV absent and replay failure under real A1 verifier.                                                                                                                                                                                                                                                                                                                                                  | CDP fixture contract supplied in L0; actual browser/verifier receipt waiting on A1.                                          |
| A0-LOGIN    | Owner-authorized Muse Code sign-in in empty workspace through forwarded loopback callback or `ssh -L`, no turn; CLI version, structural state only, callback binding and completion word scrubbed. Never record email, avatar or token.                                                                                                                                                                                                                                                                                                                                                  | Waiting on lead's sign-in authorization/session. The rig brief forbids credential access; no sign-in attempted.              |
| A0-GIT      | Native Linux and Docker/Podman (Desktop Windows/macOS included), amd64/arm64: synthetic repository programs in fsmonitor, SSH command, hooks, helpers, clean/smudge/process, diff/textconv/merge, includes, URL/remote/protocol overrides and inherited GIT_*; execute every Git-page read/mutation with a fake deploy socket. No canary runs as service or sees socket. Enable hooks only in a separate tools-UID child. Race config/alias/head/host-key changes after approval; fail before credential dispatch. Verify owned gitdir/exec paths and no symlink/alternate-store escape. | Waiting on N's closed runner, C's permissions and U1's destination binding. L0 schema/policy drills are not this OS receipt. |

Local inventory (read-only): Darwin x86_64, macOS 15.7.4 build 24G517,
Node v24.21.0; host reports `Randys-Mac-Mini.local`; Docker CLI present;
Podman CLI absent. A hostname ending in `.local` does not prove another PC
can resolve it, nor that any browser trusts a certificate.

Later-phase receipts remain in research §7: TPM/OpenSSL provider, Podman
exec PTY per architecture, Linux Chrome for Testing policy/CDP, systemd
extension `/opt`, and dropped Muse/ACP model-connection error frames. The
last needs an explicitly authorized, counted model turn and is outside L0.
Licensing/source re-checks and owner rulings in research §4.10 also remain
release prerequisites; nothing in the authored node protocol is a guessed
Muse Code or Model API wire capture.

A0-BWRAP/A0-LOGIN must additionally prove Q-M110.9: a repository tool,
terminal or check cannot read the CLI's sign-in home or attach to its
process even when the planned tools UID is shared. Use synthetic canaries,
never real sign-in files. Same-UID directory permissions are insufficient;
the lead/N/A1 review must settle the actual process/sandbox boundary before
Muse Code becomes available.

## Named integration bindings

| Binding                    | Interface supplied / required follow-up                                                                                                                                                                                                                                                                                                                                               |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M110-MHP-v1                | This base has no `src/shared/hostApi` or frozen M104 envelope. L0 supplies a method/params/result catalog and `NodeMethodPort` under `hostApi/nodeMethods.ts`, independently versioned; M104 lane 0 must register it in frozen MHP v1 and its conformance suite. Do not invent or replace M104's envelope.                                                                            |
| M110-N-tools               | `NodeToolHostPort` + `NodeClock`; N binds the owner-only socket, OS peer identity and real tools UID. Only argv, workspace ID and bounded terminal operations cross; no environment or credential field.                                                                                                                                                                              |
| M110-A1-auth               | `NodeAuthPort`, challenge/credential/session/step-up schemas; A1 binds SimpleWebAuthn cryptographic verification, atomic code/challenge consumption, monotonic session expiry, Host/Origin/Fetch-Metadata and WebSocket first-frame enforcement.                                                                                                                                      |
| M110-N-store               | L0 config/state/audit/event schemas; N binds atomic durable state, restart-sealed keys, hash-chain verification, retention anchors and append-only writes. M109 owns the passphrase-slot record; do not mint a competing interim encryption format.                                                                                                                                   |
| M110-U1-files-git          | Workspace-relative normalized paths and content-digest preconditions; U1 binds realpath/identity containment, uploads/downloads, exact argv/ref grants and owner's isolated deploy-key socket.                                                                                                                                                                                        |
| M110-U2-terminal-dashboard | Bounded frame/event schemas and raw readings; U2 binds timeout/rate counters, first-frame auth, step-up, PTY cleanup and authorized event routing. Keystrokes/output are excluded from audit schema.                                                                                                                                                                                  |
| M110-help-reference        | No `featureCatalog.ts` or reference generator exists on this base. Integration lists node init/serve/status/stop/lock/unlock/wipe, local tui/screen-reader mode, files/editor/git/terminal/dashboard/audit/settings/help/What's New, certificate pairing, passkeys and interim key-store UI only after their lanes wire them. L0 adds no executable command or manifest contribution. |

Unattended and paid policy binds to the existing controller/gates, preserving
single-model behavior and the owner's once-before-first-charge ruling; no
separate node consent policy or autonomous approval is introduced.

**M110-N-tools / M110-U2-terminal-dashboard / T stream binding (RVM110L0-2).**
`openTerminal` takes an observer and an abort signal before the PTY starts.
`nodeTerminalHostEventSchema` parses output and spontaneous exit payloads;
N adds the node event envelope and routes only to the authorized session.
Each callback acknowledgement precedes the next delivery, with at most
`NODE_TERMINAL_OUTPUT_BYTES` queued; the real host pauses reads, never drops
output. Exit is delivered exactly once after queued output, then descendants,
PTY, signal listener and observer are disposed. Disconnect aborts as `lost`;
lock/stop use `stopAll('locked'/'stopped')`. A rejecting observer terminates
the PTY; consumers must settle callbacks promptly on abort so teardown cannot
hang. Close/stop await disposal and close is idempotent. The scripted fake
supplies output/exit and bounded buffering; it is not the A0-PTY receipt.

**M110-N-git / M110-U1-files-git / C closed runner binding (RVM110L0-1).**
Bind `NODE_GIT_OPTIONS`, `NODE_GIT_ENVIRONMENT`, the inert configuration parser
and `nodeGitDestinationSchema` to the closed runner described in the threat
model. N owns a service-only, immutable gitdir, safe object/ref/index import,
absolute installed Git/exec-path/SSH wrapper, environment allow-list and
verified known-hosts registration. U1 consumes status `remotes`, shows the
resolved host/port/user/repository/key and includes them with remote/ref/head
in the step-up action digest. N atomically rechecks that tuple before using
the socket, never dispatching a mutable alias or repository-selected program.
Read/local Git and separate user-enabled hooks run without credentials;
credentialed Git never enables repository hooks. C/N/U1 take A0-GIT and
M110L0-Git-runtime-qualification in PLAN §9 before claiming support. The
existing Action's closed-config boundary is a design reference, not a node
implementation or a substitute for the snapshot race protection.

## RLM110A0: S0 A0 attempt log

Lane RLM110A0, 2026-10-23, rig `macmini`
(`/Users/randy/lanes/RLM110A0`). Model attempts: **0**. No credential read,
sign-in, OS trust-store change, firewall change, image pull, external
network request or live/paid model call in this lane.

Local inventory (read-only): Darwin x86_64, macOS 15.7.4,
Node v24.21.0; Docker CLI present, Podman CLI absent; no UTM, VirtualBox,
Parallels, lima or QEMU on the rig.

| Capture     | Attempt and outcome                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| A0-PUBLISH  | Attempted the macOS Desktop beat: Docker Desktop's backend runs (pid 34393) but its socket never appeared — `/var/run/docker.sock` points at `/Users/randy/.docker/run/docker.sock`, which does not exist (ENOENT), and `docker version` hangs. No shim or wrapper was built (sandbox rule), so no container ran and no publish/firewall/volume receipt exists. Retry when Docker is healthy. All other A0-PUBLISH hosts still await their rigs. |
| A0-TLS      | Not attempted: still waiting on the lead's authorized throwaway OS/browser profiles. No browser or trust store was touched.                                                                                                                                                                                                                                                                                                                      |
| A0-NAME     | Not attempted: still waiting on a second LAN PC and cross-OS resolution.                                                                                                                                                                                                                                                                                                                                                                         |
| A0-BWRAP    | Not attempted: still waiting on C/N's tool-host image and Linux/arm64 rigs.                                                                                                                                                                                                                                                                                                                                                                      |
| A0-PTY      | Not attempted: still waiting on N's tool host and C's image.                                                                                                                                                                                                                                                                                                                                                                                     |
| A0-WEBAUTHN | Not attempted: still waiting on A1's verifier.                                                                                                                                                                                                                                                                                                                                                                                                   |
| A0-LOGIN    | Not attempted: the rig brief forbids credential access; no sign-in attempted.                                                                                                                                                                                                                                                                                                                                                                    |
| A0-GIT      | Not attempted: still waiting on N's closed runner, C's permissions and U1's destination binding.                                                                                                                                                                                                                                                                                                                                                 |

S0's installer evidence (`test/unit/nodeInstall.test.mjs`, 8/8, real
POSIX tools; the `deploy/install/` profile) is committed-test evidence for
the LAN profile's checks, not an OS receipt: it changes none of the rows
above.
