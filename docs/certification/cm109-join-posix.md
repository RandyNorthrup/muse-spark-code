# CM109JOINB — POSIX join preparation

2026-10-11, Kubuntu, `c/m109-join-posix`, workspace `/home/randy/lanes/CM109JOINB`. No live or paid model calls.
Aggregate quality and Windows/macOS replay remain lead-owned under the rig brief.

## Core round 5 adoption

Merge `52a37ad49` with `--no-ff`; regenerate the only conflict, the host API
record. All files under `src/core/vault/` equal that commit byte-for-byte.
The native POSIX helper adds identity and startup-lock modes while including
core's original peer implementation. Linux and Darwin builds and the three
socket fixtures compile this installed helper. Cold startup supplies the current
epoch through core's existing subscription and waits for its status; it never
bumps a live broker's epoch. Core's anchored loss, Reset authorization, import
receipt reload and typed errors are adopted without alternate implementations.

Before adoption and after adoption: `brokerProcess.test.ts`,
`brokerComposition.test.ts`, `channel.test.ts`: **73/73 passed**, repository
timeouts, `--maxWorkers=3`. These are real sockets and compiled POSIX helper
calls, including the formerly sandbox-blocked cases. No sandbox workaround.

The availability switch stays off until the lead joins and reviews all parts.

## Installed POSIX bindings

The shared VS Code panel and CLI/ACP runtime call `vaultClientPlatform` with
the same host/session facts used by their channel. Its availability flag is
**false**. When enabled by the reviewed join it loads only `vaultPosix.js`,
registers native PID/UID/birth/image facts in private files, discovers or starts
the installed broker, and checks the actual socket peer before hello. The
child loads `vaultRuntime.js`'s installed `createVaultBrokerBindings` export;
its child-only implementation is `vaultBrokerBindings.js`. Native launch uses
real resource admission, shared machine policy and a separate broker creation
registry. No credentials are inherited. `vaultStore.js` shares immutable core
store/crypto/typed-error identity across these siblings; existing caps are
unchanged.

The factory supplies actual OS-store slots/anchors, authenticated audit history
and its protected rotation checkpoint, native host checks, and material-backed
scrubbing with unconditional byte erasure. Management and first-party reads
work. T/X/S/O must supply trusted launch/provenance/execution ownership before
agent transports can run: their default ceiling is none, and missing taint or
perform bindings refuse explicitly. The granted-use composition exercises the
real broker with known in-process provenance; it does not certify an installed
agent execution transport.

`posixBindings.test.ts` uses real sockets and the compiled installed helper,
the actual management/repository and OS-slot implementation with generated-only
in-memory protected storage. It covers one-time setup, unlock, encrypted write,
private read and scrub, persisted bounded granted material use, Lock, Keep/Delete,
anchored loss/RESET, replacement setup, denied wrong host/session/birth, and an
independently advanced store audit checkpoint. Native launcher admission is
covered by the installed receipt instead of this fixture's direct child launcher.

## Linux native receipt

Kubuntu, Node 24.18.0, system C compiler, existing `dbus-run-session`,
`gnome-keyring-daemon` and pinned `@napi-rs/keyring`; no installation, policy
change, desktop keyring read or model attempt. All values are generated in
memory. A private bus and empty test keyring are destroyed afterward.

`test/hosts/vault-os-store.mjs`: **PASS**, native create/read/delete and absence
of plaintext in the public slot record. The copied installed-bundle receipt:
**PASS**, actual governed broker launch, native peer verification, v2 setup,
protected slot/anchor, encrypted write, private read, Lock and reopen. The
initial installed attempt exposed missing child admission; the real governor
binding fixed it. Sharing an editor creation registry caused a publish refusal;
the broker's separate registry fixed it. Fixture removal originally raced
asynchronous resource retirement; removal now happens on natural process exit.
Reusable runner: `sh test/hosts/run-vault-posix.sh`.

macOS compilation/login Keychain and Windows replay were not run on this Linux
machine and remain lead-owned. Availability stays off.

## Deliberate guard failures

The complete owning composition file was run for each source mutation, with
repository deadlines and no test-name filter. Removing session matching,
process-birth matching, the off availability check, the store/protected audit
checkpoint agreement check, and the audit factory's per-vault cache identity
all fail their regression. Reset now proves a separate physical audit directory
for its replacement vault; the earlier smoke-only assertion was insufficient.
Deleting each new sibling's carried entry from the output graph separately
fires the binding/store/POSIX split guards. Every file is restored byte-exact,
with matching SHA-256 in `cm109-join-posix-drills.json`. Initial metadata probes
edited esbuild's raw input list, which the gate does not consume; the recorded
successful probes edit the actual output graph consumed by the gate.

## Writer-lease handoff: executable, intentionally skipped

`writerCrashPosix.test.ts` has exactly **17** skipped cases with its one-line
CM109JOINA reason. A once-per-suite built real child uses production
`NodeVaultFiles`, `VaultStore.resetLost` and `restoreEncryptedBackup`, a
file-backed generated-only protected-anchor fake outside the vault, and a key
sent only over private stdin. It pauses immediately after each physical stage,
then is killed with SIGKILL; a different process must recover and another must
open the result. Holder/contender processes are killed/awaited in finally.

Exact case names are `SIGKILL during reset at <stage> recovers in a new process`
and `SIGKILL during restore at <stage> recovers in a new process`:

| Reset (7)           | Restore (7)         |
| ------------------- | ------------------- |
| writer-acquired     | writer-acquired     |
| reset.v1-written    | quarantine-retained |
| quarantine-retained | pending.v1-written  |
| vault.v1-removed    | vault.v1-written    |
| slots.v1-removed    | slots.v1-written    |
| pending.v1-removed  | anchor-advanced     |
| anchor-retired      | pending.v1-removed  |

The three remaining names are `a live writer is never taken over by open`,
`a live writer is never taken over by reset`, and
`a live writer is never taken over by restore`.

The complete suite was deliberately unskipped once at repository deadlines:
**17/17 failed** with stale `writer.lock` refusing recovery as `busy` after
SIGKILL. All stages were reached; live contenders were refused while their
holder remained alive. The skipped file was restored byte-exact. This proves
an executable lease requirement, not a passing crash-recovery claim. JOINA
must integrate its lease and unskip/replay the suite; no writer implementation
is changed here.

## Join-gate repairs

The scoped duplicate gate found five clones exposed by joining the two
pre-existing fixtures: service-aware keyring maps, generated OS-slot/channel
ports and the repeated absent-socket check. Reuse the helpers with unchanged
behavior; **5 → 0 clones**, no ignore or threshold change. The native slot
fixture is typed to its actual constructor context, not the schema's full
post-parse record. The plain knip gate registers the real installed runtime
and sibling entries plus the compiled SIGKILL child; no dead export remains.

The host harness initially inlined the new POSIX/resource dependencies and
failed its unchanged 50 KiB cap at **213.8 KiB**. It now uses the exact production
external sibling mappings shared from the existing build library. The complete
owning `vaultPanelBuild`, `brokerAdoption`, `vaultManagement` files pass
**21/21**, retaining their original caps and assertions. The pre-repair
composition and process-inventory files also passed; after the repair the
complete vault list is replayed below.

## Scoped verification before the binding commit

All five typecheck projects pass; the unit project passes again after fixture
consolidation. Changed-file ESLint exits 0 with zero warnings; plain knip exits
0 and jscpd reports zero clones. Localization: 14 UI/usage tables, zero problems.
Reference, roadmap, plan format and regenerated host API gates pass. The final
production build passes sizes, split/global checks and 92 dependency notices;
activation 550.1/600 KiB, Model API 515.8/525 KiB, vault host 32.8/50 KiB,
broker 109.1/116.49 KiB, runtime 19.6/25 KiB, bindings 25.8/32 KiB,
store 33.0/50 KiB and POSIX 16.9/25 KiB. Existing caps are unchanged.
`sh test/hosts/run-vault-posix.sh` exits 0: both native OS-slot and installed
broker receipts pass, and the private bus/keyring and helper processes close.
No live/paid call. The complete vault replay follows this committed piece.

## Final replay and local commits

Core adoption merge: `bb4a9b2d5`. Installed binding commit: `72e0cd62e`.
The latter's staged and committed patches compare identically after the installed
hooks run. Final core comparison against `52a37ad49` remains empty.

All **86 files** (the complete `test/unit/vault/*.test.*` list plus OS-store slots
and process inventory) ran in **29 sequential batches**, at most three files and
`--maxWorkers=3`, with repository deadlines and no name filters or timeout
override. **1,290 passed, zero failed, 18 skipped**. The skips are the 17 named
CM109JOINA lease cases above and the existing Windows-only audit-files refusal
case. The complete per-batch command inputs, results and durations are recorded
in `cm109-join-posix-tests.json`. All real socket cases ran. The original core
`peer.c` foreign-UID test passed, including OS rejection after deliberately
relaxing only its generated test socket permissions.

The Linux native runner passed again after moving its generated keyring daemon
into a separate process group and terminating/waiting that whole group. Both
OS-store and copied installed-broker receipts exited successfully. A final
process listing scoped to the worktree/private scratch showed only the lane's
Codex launcher and inspection shell, no test server, broker, native helper,
keyring daemon or private bus. Scratch fixtures were removed. No live/paid call.

## Ordered final-join handoff

1. Join CM109JOINA's shared writer lease and Windows platform with this POSIX
   dispatch/factory, preserving core's reviewed contracts and packaging the
   pinned native keyring dependency for each installed product.
2. Unskip and pass all 17 real SIGKILL/new-process recovery cases. Replay native
   launch, peer identity, OS-store and writer recovery on Linux, macOS and Windows.
3. Bind T/X/S/O's trusted provenance, taint and execution ownership before
   allowing agent transports; settle the documented store/protected-audit
   checkpoint interruption handoff. Same-user registration files are not
   attestation against hostile same-user code.
4. Finish the Models & Agents/settings mount and the remaining migration/panel
   bindings. Certify installed editor, CLI and ACP use, join reviews and aggregate
   quality on the lead's rigs.
5. Only then flip the availability switch. Screen-lock/Linux hardware work stays
   with C-M109-2; macOS biometric protection is not offered by this composition.

## RVCM109JB review repair — session lifetime (2026-10-11)

The governed `handoffResourceFile(..., until: 'spawn')` creates the broker in
its own POSIX session/group with null stdio and retires the launching client's
lease at spawn. Client shutdown never signals it. Native `launch.lock` queues
clients before discovery is rechecked; `startup.lock` remains the broker's
lifetime stale-recovery guard. Both inode-stable owner-only lock files are kept
by design. Socket connection, rather than a launcher pipe, proves readiness.
The last connected client starts the existing empty-idle timer; expiry and
SIGTERM/SIGINT use Lock, channel close, disposal, discovery release and native
lock release. Every entry standard stream and startup guardian pipe handles
errors. A startup timeout ends the client's wait without killing the broker.

`brokerSession.test.ts` builds generated-only real clients and a broker once.
The launch profile, detached group and null stdio are production code; a
fake-only admission owner exercises client resource disposal. Its four cases
prove launcher shutdown with another client connected, four simultaneous
clients on one broker, launcher SIGKILL before readiness, and actual closed
stdout/stderr reading ends. Native peer/host identity and authenticated v2
status calls are real. Final restored run with `posixBindings` and
`brokerProcess`: **24 passed, zero failed**, repository timeout, three workers.
The existing signal entry suite also passed **2/2**. No value is emitted.
Registration files are removed on normal client exit/window disposal, and a
later client prunes the killed client's kernel-proven-dead registration.
The ordinary window-close path to a stale writer is removed; the **17**
CM109JOINA writer crash cases remain skipped for CM109LEASE and the join.

Each mutation ran the complete owning file. All **18** review drills fired,
then the source was restored byte-exact with its SHA-256 verified; commands,
exits and original hashes are in `cm109-join-posix-review-drills.json`.

| Finding                             | Fix                                                                  | Regression                                                    | Red drill                                                                                                                       |
| ----------------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| 1: launcher owns broker             | Session handoff and idle Lock                                        | `brokerSession`, `brokerProcess`                              | `session-handoff`, `idle-exit`, `lock-before-close`, `signal-shutdown`                                                          |
| 2: simultaneous start fails         | Blocking kernel launch lock and winner recheck                       | `brokerSession` real four-client start                        | `kernel-wait`                                                                                                                   |
| 3: dead launcher pipes crash broker | Null streams, socket readiness, stream error handlers                | `brokerSession` early death and closed pipes                  | `stdout-error`, `stderr-error`                                                                                                  |
| 5: five guards unproved             | Exact identity assertions and live-owner discovery/recovery fixtures | `posixBindings`, `brokerProcess`                              | `executable-match`, `record-user-match`, `binding-own-user`, `registration-own-user`, `dead-only-launch`, `spare-live-recovery` |
| 6: registrations accumulate         | Exit/window removal and kernel-dead startup pruning                  | `brokerSession` asserts empty host registry and stale removal | `registration-exit`, `registration-prune`                                                                                       |

Finding 7 now distinguishes the installed but disabled broker from a missing
or failed installation, in all 14 translated tables, the command refusal,
runtime loader, catalogue/reference and README. The three extra drills remove
runtime propagation, restore the misleading panel failure, and delete a new
translation key; all fail. The restored entry/panel/session files pass **21/21**.
All five type projects passed before the next audit/packaging piece; changed
lifecycle lint passes without weakened rules. Aggregate quality remains
lead-owned under the explicit scoped rig instruction.

Packaging, protected audit interruption recovery, installed load measurement
and final dependent/gate receipts follow in the next piece.
