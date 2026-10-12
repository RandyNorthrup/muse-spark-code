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

## RVCM109JB review repair — packaging, audit and final verification (2026-10-11)

The VSIX allowlist and report frame vocabulary now include `vaultStore.js`,
`vaultPosix.js`, `vaultRuntime.js` and `vaultBrokerBindings.js`. The pre-stage
package guard derives configured outputs, production esbuild import edges and
installed lazy-loader/worker/handoff references; it checks the reachable
closure against VSCE's actual file list. The current production probe visits
**240** bundles. Removing the four siblings reports **all four**, and each
independent omission fails its owning test. Windows separators are tested in
output keys, sibling imports and packaged file names. Report frame coverage
remains tied to the extension allowlist by the existing flight-recorder test.
The pinned keyring module remains part A's separate VSIX join obligation.

A protected, value-free previous/next audit-head intent precedes physical
append. The portable audit port adds only an optional prepare hook, bound by
POSIX; existing callers retain their sequencing. It rechecks key lifetime and
authorization after the await. Under the audit kernel lock a successor abandons
an intent with no physical append or finishes the exact physical/store/protected
checkpoint transition. Core still verifies the full hash/MAC chain, and an
independent store checkpoint advance remains refused. Four interruption cases
cover prepared-before-append, physical-before-store, store-before-protected,
and protected-before-intent-deletion; repeat reads prove recovery is idempotent.
Neither the core store nor shared lock helpers changed. A handed-off process
exposes no client stop operation, rather than an empty successful stop stub;
its failure preserves the original error while owned starts still stop.

The **30** deliberate review mutations all fail their complete owning files,
then restore the source byte-exact with SHA-256 checked. The appended JSON
manifest records each guard, suite, exit and source hash. The final restored
`channel`, `spawnBoundaries` and `flightRecorder` run passes **128/128**.
The existing Help assertion initially expected the misleading missing-broker
sentence; it now positively checks switched-off/integration wording and rejects
"not installed". The existing VSIX archive tests caught the new translated
key's order differing from English: all 14 tables were aligned, and the full
VSIX suite passes **79/79**, including every byte-exact locale round trip.
No assertion, timeout or gate was relaxed.

| Finding                        | Fix                                                                                                    | Complete regression                                                         | Deliberate red drill                                                                                |
| ------------------------------ | ------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| 1, audit interruption          | Protected intent before append, exact checkpoint recovery, optional client stop authority              | `posixBindings`, `audit`, `channel`                                         | `protected-prepare`, `protected-recovery`, `authorization-after-prepare`, `handoff-no-stop`         |
| 4, omitted siblings            | Derived production closure before VSIX staging and complete frame vocabulary                           | `packagedBundles`, `vsixPackaging`, `flightRecorder`                        | `package-closure`, four `package-allowlist-*`, `package-windows-paths`, `package-framepaths`        |
| 7, misleading disabled wording | Runtime/panel refusal and reference in English/all 14 tables                                           | `vaultRuntimeEntry`, `vaultPanelBundle`, `spawnBoundaries`, `vsixPackaging` | `disabled-runtime-reason`, `disabled-panel-reason`, `disabled-translation`, `help-disabled-honesty` |
| 8, timing claim                | Per-response/retry windows distinguished from total governor admission; full installed launch measured | Isolated Secret Service installed receipt                                   | Measurements below; native timeout/recovery tests retain repository deadlines                       |

Final verification selects **19** complete dependent files from the **11**
changed non-hub sources, using `vitest related --run` in seven CLI shards with
at most three files each. The hub identifier/reference/packaging checks and
three named-review supplements run as complete CLI files, again at most three
per invocation. Latest results across **39 distinct files: 642 passed, zero
failed, 18 skipped**. The skips are the unchanged 17 writer-crash cases plus
one Windows-only audit case on Linux. The native foreign-user peer test passes;
real lifecycle, protocol, editor, CLI/ACP, exec, management and OS-slot files
all ran. Existing named long-operation timeouts in the VSIX fixture were kept;
no CLI `--testTimeout` was used. Six hub source/generated files and the 14
language tables remain marked **HUB: integration run** under the shared rule.
Selection, exact commands, latest per-file counts, source hashes, gate results
and bundle bytes are in `cm109-join-posix-verification.json`.

The installed private-Secret-Service receipt is **not green**. Both runs finish
setup, private read, encrypted-store check, Lock and reopen, but exit **1** on
warnings from the existing registered-tree sampler's refusal catch. Diagnostics
retain only a fixed kind and a package frame (`resourceGovernor.js:3:51102`),
never the underlying error, path, key or item value. The cause is not attributed;
PLAN sections 3 and 7 defer it to the resource owner/lead. No warning is
suppressed and no resource code outside this lane is changed. Full governed
launch under two additional CPU workers measures **1,042 ms**, then **570 ms**,
both below the 5,000 ms comparison window. This measures observed full launch,
not a hard total-launch bound: identity/lock responses and readiness retries
have their own five-second windows; governor admission has its own deadline,
and an in-flight probe can finish after the retry window.

The session handoff removes ordinary window/CLI closure as a source of abrupt
broker termination. SIGKILL writer recovery remains owned by CM109LEASE/join;
the 17 cases stay skipped here. macOS must rerun the native compile/sign checks,
peer UID/PID/birth/image refusals, kernel lock contention/recovery, real client
lifetime/start-race/early-death/closed-pipe cases, login Keychain/installed receipt,
launch measurement and the scoped dependent/gate checks. Availability, resource
limits, existing bundle caps and paid defaults stay unchanged.

All five type projects, changed-source lint, plain knip, zero duplication,
localization, reference, host API, plan, roadmap and final production build
pass; every existing cap is unchanged. The seven vault bundle byte counts are
recorded in the verification JSON. The fixture's esbuild admission replacement
is a real dynamic knip entry (not an ignored export); its bootstrap alias is a
wrapper, so duplicate-export checking stays enabled.

Cleanup after the suites: a scoped `/proc` scan found **zero** owned brokers,
native guardians, private keyring/bus daemons or CPU workers. A no-symlink walk
of the lane's private `TMPDIR` found **zero** sockets, broker/launch/startup/writer/
audit locks or boot tokens. Retained kernel lock files inside test roots are
removed with those owned roots; no other lane is inspected or changed.

### Modified file manifest

- `.vscodeignore`
- `CHANGELOG.md`
- `PLAN.md`
- `README.md`
- `ROADMAP.md`
- `docs/certification/cm109-join-posix-review-drills.json`
- `docs/certification/cm109-join-posix-verification.json`
- `docs/certification/cm109-join-posix.md`
- `docs/design/vault-broker-process.md`
- `docs/ide-compatibility/host-api.md`
- `docs/reference.md`
- `docs/roadmap/entries.json`
- `knip.jsonc`
- `l10n/ui.cs.json`
- `l10n/ui.de.json`
- `l10n/ui.es.json`
- `l10n/ui.fr.json`
- `l10n/ui.hu.json`
- `l10n/ui.it.json`
- `l10n/ui.ja.json`
- `l10n/ui.ko.json`
- `l10n/ui.pl.json`
- `l10n/ui.pt-br.json`
- `l10n/ui.ru.json`
- `l10n/ui.tr.json`
- `l10n/ui.zh-cn.json`
- `l10n/ui.zh-tw.json`
- `native/posix/vaultPeer.c`
- `scripts/check-packaged-bundles.mjs`
- `scripts/package-vsix.mjs`
- `src/core/vault/broker/audit.ts`
- `src/host/vault/brokerProcess.ts`
- `src/host/vault/vaultPanelBundle.ts`
- `src/host/vault/vaultPanelEntry.ts`
- `src/runtime/reference.node.generated.ts`
- `src/runtime/vault/brokerBindings.ts`
- `src/runtime/vault/clientPlatform.ts`
- `src/runtime/vault/posixClientPlatform.ts`
- `src/runtime/vault/posixHost.ts`
- `src/runtime/vault/posixNative.ts`
- `src/runtime/vault/vaultBrokerEntry.ts`
- `src/runtime/vault/vaultRuntime.ts`
- `src/shared/constants.ts`
- `src/shared/featureCatalog.ts`
- `src/shared/l10n/en.ts`
- `src/shared/reference/reference.generated.json`
- `src/shared/reference/reference.generated.ts`
- `test/hosts/vault-posix-broker.mjs`
- `test/unit/helpers/vault/sessionAdmission.ts`
- `test/unit/helpers/vault/sessionBrokerChild.ts`
- `test/unit/helpers/vault/sessionClientChild.ts`
- `test/unit/packagedBundles.test.mjs`
- `test/unit/spawnBoundaries.test.ts`
- `test/unit/vault/audit.test.ts`
- `test/unit/vault/brokerProcess.test.ts`
- `test/unit/vault/brokerSession.test.ts`
- `test/unit/vault/channel.test.ts`
- `test/unit/vault/posixBindings.test.ts`
- `test/unit/vault/vaultPanelBundle.test.ts`
- `test/unit/vault/vaultRuntimeEntry.test.ts`

## RVCM109JC round 3 — P2 orderly shutdown (Kubuntu, 2026-10-11)

The first repair commits P2 before fixture/epoch/receipt work. No aggregate
`quality` run is allowed by the rig/common rules; scoped gates and final
dependents run here. No merge is authorized by this fix brief.

`PosixDiscovery` treats a missing record during error recovery as absence,
including a broker still alive after it removed its discovery files. The
shared `VaultBrokerProcess.connect` rechecks discovery after a failed connect,
peer check or hello and retries one successor only if the old broker vanished
or was replaced. The post-launch final discovery also retries once on absence.
The editor, CLI, ACP and headless factories all use this connection. A refused
connection to the same live broker is never retried. Operations run only after
authentication, so the retry repeats no vault operation.

| Transition inventory                                                            | Orderly disappearance / retained descriptor behavior                                                                                                    | Regression                                          |
| ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| Discovery directory mkdir/lstat                                                 | Shutdown retains the owner-only directory; no record means absent                                                                                       | `directory`                                         |
| Record open, descriptor stat/read/overflow/close                                | ENOENT before open means absent; an unlinked descriptor can fail its single-link check or finish its old read, then recovery/readiness observes absence | `record-open`, `record-read`                        |
| Native discovery identity (including helper exit 2)                             | Proven death/birth change is absent; shutdown after a live identity proceeds to missing token/record recovery                                           | `identity`; existing dead-owner lifecycle tests     |
| Token open, descriptor stat/read/overflow/close                                 | Missing token enters recheck; retained bytes never establish readiness alone                                                                            | `token-open`, `token-read`                          |
| Readiness socket connect/error                                                  | Missing/refused socket rechecks ownership; absent record means successor; same live startup uses the existing bounded readiness retry                   | `readiness`                                         |
| Recovery record open/stat/read/close and native identity                        | Missing record is absent; disappearance after a read/native call is observed on the next bounded retry                                                  | `recheck-record`, `recheck-identity`                |
| Client socket connect, native descriptor/peer probe, process identity and hello | Failed pre-operation connection rechecks discovery and retries one successor; same live broker refusal remains an error                                 | `connect`, `peer`, `hello`; live-refusal regression |
| Launch lock open/fstat/lstat, guardian readiness and second lstat               | Orderly shutdown never removes persistent kernel-lock files; contention waits on the kernel and rechecks discovery before spawning                      | Existing kernel-lock/start-race tests               |
| Startup stale-record read/native identity, stale-file lstat/unlink              | Missing files are ignored under the kernel lock; proven-live identity still refuses cleanup                                                             | Existing stale/live-owner recovery tests            |
| Launch readiness followed by final discovery                                    | Absence launches one successor; a second absence reports the named broker-blocked refusal                                                               | Final-discovery retry regression                    |

Real broker handles are closed between each listed discovery/connection
boundary. The complete `posixBindings.test.ts` passes 25/25 at the repository
timeout. Host and unit typechecks and roadmap generation pass. Three removal drills are recorded in `cm109jc-drills.json`; each runs
the complete file and restores identical SHA-256 bytes. The first drill also
hit a separate existing audit-case timeout under shared rig load; isolated
verification is required before classifying it. The reported epoch collision
remains part of the next repair, not an accepted residual. Test injection initially captured an
auto-spy's own wrapper (recursion) and then its absent mock implementation;
that approach was stopped and replaced by the real `vi.importActual` native
function. No production workaround or timeout change was introduced.
