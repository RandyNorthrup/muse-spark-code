# M96d machine coordinator: design spike

2026-10-10 · C-M96d-1 · base `82d50d5e4` · design, not a runtime feature.
This resolves the four P1 counterexamples in `RVM96C2` at the specification
level. C-M96d-2, owned by the Claude host, builds the reviewed design after
the lead ruling. Native qualification and editor integration remain that
lane's work. No production coordinator is supplied by this spike.

## 1. Authority and the safe availability trade-off

Use one user-level native broker per machine/user, shared by every editor
and the ACP/runtime process. Core/runtime owns the portable ledger and
admission policy; editor adapters cannot elect, kill peers or release
resources. Keep the existing M96c window-scoped scheduler as the explicitly
selected fallback before machine enrolment. Single-model conversations
remain byte-identical and do not start a broker or send readiness traffic.

The safety invariant is: **a resource is available only if every previous
grant on it has a durably recorded, complete retirement proof**. Silence,
socket failure, age, a changed generation, an owner exit and user confirmation
are not that proof. A frozen or uncertain holder can block indefinitely.
The recovery surface explains that limit; no override can discharge it.

An exclusive native anchor permits a broker to issue grants, not to declare
old work dead. A successor first loads the same durable ledger and retains
all open grants. It cannot start a second capacity pool. If anchor or ledger
identity cannot be established, it refuses rather than bootstrapping another
pool. Endpoint publication is discoverability only, separate from authority.

Native anchor qualification must prove exclusive acquisition on the exact
same permanent object across concurrent starts, freeze, owner death, path
unlink/replacement and helper failure. Candidate local-file locks are
`flock` on Unix and `LockFileEx` on Windows, behind held native handles and
pinned file/volume identities. These are candidates, not certified election
implementations. No protocol operation removes/replaces the anchor or its
parent while enrolled. An unexpected identity change or disappearance
blocks enrolment and recovery. Failure to prove this on a platform selects
the pre-enrolment fallback; a socket-path claim is never substituted.

The threat boundary is cooperating project processes with owner-only local
state and no administrative/same-user deliberate destruction of all state.
That destruction cannot be made safe by recreating a folder. Missing known
state, malformed records and ambiguous initialisation are blocking states;
they never count as an empty ledger. The durable enrolment identity is kept
outside the ephemeral IPC directory. Remote work and escaped descendants
retain their liabilities until their execution owner proves retirement.

## 2. Durable protocol and resource accounting

The broker serialises grants by resource identity and checks the complete
requested resource vector atomically: workers, process workers, heavy
commands, singleton MCP resources and the landing tree. Reuse M96c's
whole-snapshot/check admission, child-capacity checks and fair workspace
queue. Never allow an acknowledged grant to exist only in a window's memory.

Each durable record binds store identity, schema version, broker epoch,
grant ID, caller/session/attempt identity, canonical resource identities,
configuration/sharing fingerprints, reservations, launch intent, native
container identity and phase. Persist grant IDs, outcomes and settlement
tombstones outside runtime folders. Paid consent remains caller-owned and
the stored Model API key never enters a broker child. No model call is
needed to coordinate resources.

The required launch order is:

1. Acquire the native anchor and validate the store; reconcile open grants.
2. Persist and sync the admission and a unique pending launch intent before
   any spawn, including an MCP server/helper/check. A failed sync refuses
   dispatch while preserving the reservation.
3. Create the child **held before user code or descendants can execute**.
   Establish its qualified complete execution boundary and the broker-held
   process reference. A Job covering ordinary descendants is not sufficient
   when tools can ask a service to create work outside it.
4. Sync registration of that exact launch/container before opening the
   gate. Loss of confirmation leaves the intent uncertain, never absent.
5. Dispatch under the admitted grant. Closing/cancelling a connection
   stops further admission but does not finish existing work.
6. Drain every queued, executing and uncertain effect. Observe native
   retirement of the complete owned scope. Sync the terminal outcome and
   settlement before releasing capacity or acknowledging completion.

Crash before spawn still leaves the intent reserved: only uninterrupted
custody of a revoked launch gate could prove "never started". This spike
deliberately chooses retention, not a new gate-revocation recovery protocol.
Crash after spawn, registration or resume therefore has the same conservative
recovery rule. A detached child is not covered by a leader-exit observation.
Do not implement a process scan as proof of completeness.

Storage writes need a native, tested crash-consistency contract: bounded
strict records, atomic publication, required file/directory durability,
checksummed identities, and terminal state committed before the reply.
Disk exhaustion, failed sync, torn records and incompatible schemas stop
admissions. Restore/backup/import must not roll an active ledger backward.
A lost terminal acknowledgement retries the same grant and returns its
recorded outcome; it neither refunds twice nor opens a second attempt.
Garbage collection cannot erase unresolved grants or tombstones whose
identities may still be retried. Reboot does not reset reservations by itself.

## 3. The four P1 findings and their release proofs

| Finding                | Counterexample                                                                                                                  | Required rule                                                                                                                                  | Proof or fallback                                                                                                                                                            |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F1: endpoint failure   | Full macOS backlog/allocation failure refuses a live listener; an unlinked Unix endpoint or closed Windows pipe loses discovery | Mark unreachable only. Do not unlink another owner's socket, elect from its error, release its grants or signal its PID                        | Exclusive qualified native anchor admits a successor; the durable ledger retains old work. No qualified anchor means window-scoped fallback before enrolment                 |
| F2: spawn gap          | Owner dies after OS creation but before registration; an unrecorded/detached child survives                                     | Sync intent before spawn; hold child before execution; sync the captured container before resume. Keep unconfirmed intent occupied             | Exact child reference plus a qualified complete execution boundary and effects drain, including service-mediated work; otherwise keep uncertain and exclude the resource     |
| F3: frozen rename      | A freezes before an admitted rename; user confirms stopped; B writes; A resumes over B                                          | No manual handoff/release. Every landing writer/helper belongs to the admitted effect scope. No successor receives that tree while A is frozen | Complete scope retirement plus durable terminal outcome. Generation checks and git's index lock alone do not fence an already submitted write                                |
| F4: incarnation/signal | Same-second macOS start times collide; PID is reused after query but before signal                                              | Preserve native precision/boot identity, validate through the held reference and signal through that reference only                            | Linux pidfd or Windows process handle. macOS foreign-process numeric signalling is refused; owned-child wait status is observation only, with uncertain descendants retained |

For a release, all of these obligations are conjunctive:

- Exact store, grant, attempt and epoch; a peer cannot manufacture a native
  reference by sending a token, PID or a boolean "stopped".
- Registration exists, native reference is valid, and the complete owned
  scope is stopped. Leader exit and an empty Job are insufficient. Complete
  scope coverage is an independent, registered proof obligation: unknown
  coverage cannot become complete through a later empty-container or drain
  assertion. Its retirement state remains `unknown`, including on restart;
  every previous resource stays excluded and no finished outcome is emitted.
- No remaining callback, tool call, queued I/O, detached/remote writer or
  pending rename can mutate the resource.
- The terminal transition was synced and wins one idempotent compare/update.
  Failure retains every resource. A stale or duplicate proof cannot release
  another attempt.

Open native handles are never serialised as reusable handle numbers. Restart
invalidates the old process's observation authority. Persisted identities
are evidence for reconciliation, not recovered handles. C-M96d-2 may add
validated reattachment only with its own native proof and drills; this design
does not release unresolved attempts automatically after broker restart.
Start-time/boot fields are secondary checks: even a high-precision timestamp
does not grant authority or prove universal uniqueness. The reference captured
under launch custody is the authority; a later numeric-PID lookup is not.

For landing, the original scope retains exclusion while frozen, including
after its last generation check. If it resumes, its original rename may
finish; B still has no grant, so no newer landing can be overwritten. A
failed/uncertain rollback also retains exclusion. Clients cannot bypass
the broker's landing admission on coordinator loss.

For singleton MCP calls, idle means no queued, executing or uncertain call,
with age starting after terminal completion. Trust/configuration changes
deny new calls but cannot discharge an existing one. Cancellation, including
a cancellation acknowledgement, is not retirement. Any later idle cleanup
closes only a proved idle server; no timer releases active exclusivity.

## 4. OS proof matrix and qualification boundary

Sources establish the mechanism constraints below. They do not certify an
unwritten adapter. All three native adapters start **unqualified**; machine
mode stays off until native receipts and the lead's ruling exist.

| Obligation                        | Linux                                                                                                                                                                             | macOS                                                                                                                               | Windows                                                                                                                                                |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Endpoint error cannot prove death | Unix socket/path is discovery only; actual unlink/old-connection drill in this lane                                                                                               | Apple's `sonewconn` rejection maps to refusal; run native backlog/allocation/unlink drills in C-M96d-2                              | Busy-pipe/live-owner drill passed on Win11; pipe errors remain discovery only, never election or retirement proof                                      |
| Exact incarnation                 | Native boot identity plus `/proc` start ticks, UID and executable; never wall-clock render                                                                                        | Native boot identity plus `proc_pidinfo` seconds **and microseconds**; never `ps` or localised text                                 | Native boot identity plus complete process creation `FILETIME`, owner and executable                                                                   |
| Signal/stop observation           | Retain a validated pidfd before final identity sample; check it is still live across sampling; signal/wait that fd                                                                | Unreaped child in the same uninterrupted parent custody can provide wait status; no generic foreign-PID kill or group-based release | Retain the `CreateProcess` handle; query creation/owner on that handle, terminate/wait on that same handle                                             |
| Complete execution scope          | Only a qualified cgroup v2 subtree with migration/launch rights sealed before resume, service-mediated effects separately closed, and populated-zero after all launch gates close | No no-escape proof for arbitrary tools supplied here; process groups, `ps` scans and precise timestamps do not provide one          | No no-escape proof for arbitrary tools: `Win32_Process.Create` bypasses even a no-breakaway Job. A process handle and Job emptiness cover members only |
| Unsupported native capability     | Refuse machine enrolment, select window-scoped mode; enrolled uncertainties remain blocked                                                                                        | Same fallback for arbitrary process workers/heavy commands without full-scope proof; no partial machine-cap claim                   | Select the full window-scoped fallback before arbitrary-tool enrolment, even when Job/handle APIs work; enrolled scope uncertainty remains blocked     |

The macOS row is an explicit availability limit, not a proposed fake native
container. To ship one complete machine-wide feature on that OS, the host
lane must either prove a complete execution boundary or obtain the lead's
approval of the stated window-scoped fallback. It must not advertise a
machine-wide heavy-command limit while only model workers are coordinated.
Likewise, a writable cgroup is not inherently a sealed container: a command
able to migrate itself out invalidates populated-zero as a complete proof.
Any OS boundary must also prevent or account for service-mediated, queued
and remote effects; sealing direct descendant creation alone does not do so.

### Windows service-mediated launch evaluation (RVCM96D1)

The Win11 VM reproduced the documented exception using suspended
`CreateProcess`, assignment before resume to an unnamed kill-on-close Job
with neither breakaway flag, and held root/Job handles. The admitted
PowerShell called `Win32_Process.Create` for a writer waiting on a private
gate. After the root exited, Job accounting reported zero active processes;
`IsProcessInJob` reported false for the still-live writer. Opening the gate
then produced the late write. Exact commands and receipts are in the
certification record; the native regression repeats both token cases.

`CreateRestrictedToken(DISABLE_MAX_PRIVILEGE)` plus `CreateProcessAsUser`
did not contain the WMI writer. The root and WMI child retained the same
user SID, authentication/logon LUID and reduced privilege count (one instead
of the ordinary token's 24). This is privilege reduction, not a distinct
per-scope user or logon identity. A scope defined by this existing SID/LUID
would include unrelated work. A dedicated user SID is a candidate accounting
partition, not qualified here: no local account, credential or machine policy
was created. Even with a unique SID, enumeration alone cannot rule out an
already queued service request, another service's identity, or remote effects;
all creation gates and effects would need enforceable closure before a zero
inventory could prove retirement.

`Win32_ProcessStartTrace` observed both writers, but its parent PID named
`WmiPrvSE`, not the admitted root. WMI's returned PID allowed correlation in
this controlled experiment; arbitrary tools need not reveal it. SID/session
and creation events aid diagnostics and discovery, not universal attribution
or a no-future-effects proof. Trace loss, subscription gaps, provider death,
ambiguous attribution and outstanding broker requests must retain `unknown`.
ETW also exposes lost-event/buffer counters; a quiet trace cannot establish
the absence of pending work. No ETW containment qualification is claimed.

**Selected boundary:** arbitrary Windows tools remain unqualified. Before
enrolment, select M96c's complete window-scoped fallback. After enrolment,
record `unknown`, retain every reservation, refuse overlapping grants and
refuse a finished scope while full execution/effect coverage is unproved.
This corrects the reviewed design gap without claiming a new native sandbox.

The mechanism facts are supported by
[Apple's socket connect](https://raw.githubusercontent.com/apple-oss-distributions/xnu/main/bsd/kern/uipc_usrreq.c)
and [connection allocation](https://raw.githubusercontent.com/apple-oss-distributions/xnu/main/bsd/kern/uipc_socket2.c),
[Apple's process-info structure](https://raw.githubusercontent.com/apple-oss-distributions/xnu/main/bsd/sys/proc_info.h),
[Linux's pidfd signal syscall](https://raw.githubusercontent.com/torvalds/linux/master/kernel/signal.c),
[cgroup v2's population and migration contract](https://www.kernel.org/doc/html/latest/admin-guide/cgroup-v2.html),
and Microsoft's [process handle rights](https://learn.microsoft.com/en-us/windows/win32/procthread/process-security-and-access-rights)
and [Job Objects](https://learn.microsoft.com/en-us/windows/win32/procthread/job-objects).
The Windows evaluation also uses Microsoft's
[Win32_Process.Create](https://learn.microsoft.com/en-us/windows/win32/cimwin32prov/create-method-in-class-win32-process),
[restricted-token contract](https://learn.microsoft.com/en-us/windows/win32/api/securitybaseapi/nf-securitybaseapi-createrestrictedtoken),
[process-start trace fields](https://learn.microsoft.com/en-us/previous-versions/windows/desktop/krnlprov/win32-processstarttrace)
and [ETW loss accounting](https://learn.microsoft.com/en-us/windows/win32/etw/about-event-tracing).
These primary sources were read on 2026-10-10. Native tests remain required.

## 5. Filesystems, durable identity and recovery

The control store must be owner-only, nonsynced and on a qualified local
filesystem. Inspect the actual mount/volume and handle identity, not a path
prefix or stored machine ID. Reject symlinks/reparse points, remote mounts,
unknown locality, missing ACL/ownership enforcement and unsupported atomic
publication/durability. A successful hard-link call is not a locality proof.
No new hard-link election or NFS locking fallback is proposed.

| Control-store location                                                    | Disposition before first enrolment                                              | Disposition with open/unknown grants                        |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| Qualified local NTFS/APFS/ext4 (candidate examples, not an allowlist)     | Machine mode only after native capability, locking and durability qualification | Reconcile the same store; retain all unresolved work        |
| FAT32/exFAT                                                               | Refuse this store; use existing M96c window-scoped mode                         | Block new overlapping work; never reset or move open grants |
| NFS/SMB/network, sync-backed or unknown filesystem                        | Refuse this store; use window-scoped mode                                       | Block; a network outage/link result cannot erase ownership  |
| Invalid/missing known store, wrong owner/identity or incompatible version | Block, even when inventory cannot be read                                       | Preserve state for repair; never assume no open grants      |

This matrix concerns the **control store**, not a ban on reading a project on
FAT/exFAT. Machine landing additionally needs a canonical, proved local
working-tree identity; unsupported/remote landing cannot inherit the local
store's qualification. Windows aliases/separators and case rules must be
handled through existing path-identity code, never raw string comparison.
If any required resource in the requested mode cannot be qualified, select
the complete window-scoped fallback before enrolment.

[Microsoft's filesystem matrix](https://learn.microsoft.com/en-us/windows/win32/fileio/filesystem-functionality-comparison)
documents the missing FAT32/exFAT hard links and access-control support.
The prior review's NFS ambiguous-link counterexample is retained from
`docs/certification/m96-research.md` §8; it is not a new native NFS receipt.

Recovery is available locally before IPC authentication: show diagnostic
store/broker identity, compatibility and the specific blocking reason;
never show secrets, raw CLI stderr, account labels or grant capabilities.
Transient reachability failures offer retry without changing ownership.
Unsupported storage offers a supported local location only before enrolment.
For frozen work, offer Stop through the validated native owner, wait for
proof, or keep blocked; macOS/unproved remote work may stay uncertain.
For damaged/mixed-version state, retain evidence and require a compatible
validated repair. "Delete state", "Hand off anyway" and timeout-based release
are forbidden. Explicitly selecting window mode later requires every prior
machine grant to be durably terminal; changing the setting cannot bypass it.

The host lane implements this through shared accessible, responsive, lazy
surfaces with honest loading/failure/retry and translated text in all 14
tables. There is no new surface, feature-catalog row or localisation key in
this design-only lane.

## 6. Build handoff, review and exit

`test/unit/m96dCoordinatorSpike.test.ts` is the adversarial contract suite;
its helper is a test-only state model, not a durable store or native adapter.
Tests for every platform tag prove portable policy, not that OS's syscall.
The endpoint suite provides real Linux Unix-socket and Windows busy-pipe
receipts, plus the native Windows Job/WMI, restricted-token and WMI tracing
counterexamples; macOS still requires its native run in C-M96d-2. The initial
candidate fails F1–F4; mutation drills prove the restored guards fire.

The lead must rule on retained uncertainty (including pre-spawn crashes),
the macOS/Windows full-execution fallback and the qualified anchor/store strategy.
No P1 remains in the spike's recorded self-review; independent acceptance
and the lead ruling are still outstanding, not asserted by the author.
Before machine mode can be surfaced, C-M96d-2 must add real adapter tests
for anchor replacement, pre/post-spawn crashes, detached descendants,
frozen rename/rollback, PID reuse at syscall dispatch, sync failure, reboot,
lost acknowledgements and unsupported/mixed-version recovery on three OSes.

Every editor row remains; none receives a machine coordinator from this spike:

| Editor row                                               | Later binding/qualification lane                                             |
| -------------------------------------------------------- | ---------------------------------------------------------------------------- |
| VS Code family (including Insiders, VSCodium and Cursor) | C-M96d-2 shared broker/client; team/scheduler bindings from C-M96-3/C-M96c-1 |
| JetBrains, Visual Studio, Eclipse                        | C-M96d-2 client; C-M96-5/C-M104-1 native panel/team bridge                   |
| Companion hosts: Zed, Xcode, Neovim, Emacs, Sublime      | C-M96d-2 client; C-M96-5/C-M104-1 companion bridge                           |
| Standalone ACP                                           | C-M96d-2 client plus C-M96b-1 team runtime                                   |
| Headless/CLI/TUI                                         | C-M96d-2 client; C-M96b-2 headless and C-M96b-5/C-M110-2 terminal binding    |

Detailed results, red-drill hashes and the review are in
[`m96d-spike.md`](../certification/m96d-spike.md).
