# RLF-M109H — M109's next increment: the vault's open hardening items

Date: 2026-11-02. Host: macmini (the Mac mini rig). Worktree:
`/Users/randy/lanes/RLF-M109H`, branch `rec/rlf-m109h`, starting at
`5ec754534` (cc/int9, containing RVM109's two fixes). Provider calls: 0. Muse model requests beyond this session: 0. Nothing was pushed,
rebased, stashed or tagged.

RVM109 (`docs/certification/rvm109.md`) left four measured residuals.
This lane took each one up on POSIX. RVM109H
(`docs/certification/rvm109h.md`) reviewed the result: clearing
dumpable before exec does not hide a normal command's environment,
the parent helper did not yet require the walk's recorded birth, and
the headless workspace-trust flag denied clean runs. Those corrections
are on this branch. The sections below are this lane's own record.
Per item: finding, change, drill, residual risk.

Commits on `rec/rlf-m109h`:

- `65f3cf7aa` fix(vault): start delegated commands with no core dump
  and, on Linux, dumpable off
- `185b458ad` fix(vault): bind the feeder ancestry walk to start times
  at every step
- `19100e53c` fix(vault): authorize headless uses against the taint
  the run actually noted
- `5f9599d2c` feat(vault): say what environment delivery still exposes
  where the person allows it
- (this record, PLAN, roadmap, changelog, unproven)

## 1. Same-uid read of the delegated command's environment

Finding (RVM109 §3): a same-uid sibling read `/proc/<pid>/environ` of
a dumpable delegated command while `ptrace_scope` was 1; the product
never called `PR_SET_DUMPABLE`, and environment delivery puts the
value in the command's environment block for its whole life.

Change: the delegated command now starts through the shipped peer
helper's new `run` mode (`native/posix/vaultPeer.c`): it zeroes the
core limit and, on Linux, calls `prctl(PR_SET_DUMPABLE, 0)` in the
command's own process, then `execv`s the approved absolute executable
— same pid, group and descriptors, so feeder containment (process
group, tree kill, scrub streams) is unchanged. The feeder
(`src/runtime/vault/vaultExecEntry.ts`) wraps every command
invocation, including the sudo timestamp cleanup, on Linux and macOS;
Windows keeps its named job containment (below). A relative command
path refuses in the helper; any helper failure refuses before the
command exists.

Delivery modes after this change, and what remains of each:

- environment: the value is in the command's environment block while
  it runs. RVM109H: on Linux, `PR_SET_DUMPABLE 0` before exec does not
  survive exec of a normal command, so another process of the same
  user can still read `/proc/<pid>/environ` after the command image is
  running. Root can too. On macOS there is no dumpable switch; another
  process of the same user can still read a running program's
  arguments and environment through the kernel's process-args sysctl.
  On Windows a same-user process can read another's environment block
  from its memory. The approval card says this for Linux, macOS and
  Windows, in English and all 14 tables, and that standard input keeps
  the value out of the environment.
- stdin (and totp, which rides it): the value is only in the feeder's
  wiped buffer and the command's input pipe; no environment copy.
  Preferable wherever the program can read it that way — the card
  sentence says so.
- askpass and git: the value never enters the environment or argv; it
  is answered by the feeder-owned helper over its authenticated
  channel, for the approved use only. No run behind these surfaces
  yet (named in `docs/real-life/unproven.md`).
- sudo: the password rides `sudo -S` standard input, not the
  environment; the askpass variant rides the helper. No run behind
  this surface yet (named).
- ssh: no value is handed over; signing happens at the broker socket.
  No feeder run behind it yet (named).

Drill: `test/unit/vault/vaultPeerRun.test.ts` compiles the shipped
helper from source and runs real children. With the base helper
restored (`git show HEAD:native/posix/vaultPeer.c`), 2 of 3 runnable
cases failed (the `run` mode does not exist). With the fix: 3 passed,
1 skipped (the Linux `/proc` case, which this darwin lane did not
run). RVM109H changed that skipped case: it now expects the same user
to be able to read the command's environment after exec, because the
kernel sets dumpable back for a normal command. Manual probe on this
rig: outer `ulimit -c unlimited`, then `ulimit -c` inside `run`
printed `0`; environment and argv passed through byte-exact (length
check); a relative path exited 1. The card sentence:
`vaultEnvironmentWarning.test.tsx` renders the real card — warning
present for an environment use, absent for stdin. No local UI look:
macOS lanes cannot start Chrome on this rig (established machine
fact), so the render proof is the jsdom suite.

Residual risk: same-user environment reading remains on Linux, macOS
and Windows, and is said at the decision point. The feeder process
itself holds leased values in memory (wiped buffers; JS strings that
held JSON/base64 cannot be wiped — unchanged from RVM109). A setuid
or file-capability target follows the kernel's `suid_dumpable` rule
rather than the helper's pre-exec setting. The only setuid route in
this design is sudo, whose password rides stdin, not the environment.

## 2. RLIMIT_CORE not set by the guarded spawn

Finding (RVM109 §3): `spawnGuarded` (Node `spawn`) cannot set
rlimits, so a crashing delegated command under a raised core limit
writes a core holding the secret. This rig's soft limit is 0, so the
exposure needs a person-raised limit — which is exactly what the
test raises.

Change: the same `run` mode sets `RLIMIT_CORE` to {0, 0} with
`setrlimit` before exec, on Linux and macOS (both POSIX paths the
feeder runs). Named where it cannot: Windows has no rlimit and its
feeder containment is still the open job-launcher step, so no core
claim is made there; the feeder, broker and host Node processes
themselves are not wrapped by this mode (they hold values only in
wiped lease buffers on the feeder path, and this item was the
delegated command's spawn).

Drill: the suite above — a caller shell raises `ulimit -c unlimited`,
execs through `run`, and the command's own `ulimit -c` reads `0`.
Red on the base helper, green with the fix (same drill as item 1).

Residual risk: an unprivileged command cannot raise the hard core
limit back above 0. A setuid or file-capability target that is
allowed to raise resource limits can. Core handling of the feeder
and host processes stays the person's shell default, as before.

## 3. The parent-lookup pid-recycle race

Finding (RVM109 §1): no deterministic test existed for pid reuse
inside the helper's two-step `parent` lookup, and the broker's
ancestry walk checked start times only at the two ends. A parent
that died and whose pid was recycled between steps could answer for
the dead ancestor.

Change, two layers. In the helper, `parent` mode now brackets its
reads: child (birth, ppid), parent read twice with the same birth,
child re-read with the same birth and ppid — any mismatch returns 1
(the product probe retries once, then refuses). In the broker, the
walk moved to `hasVaultFeederAncestry`
(`src/core/vault/broker/peer.ts`) and binds every step: before a
process's parent is trusted, that process is re-read and must carry
the start time recorded for its pid by the previous step; the
requester is re-read at the end. `verifyFeeder` in
`brokerBindings.ts` calls it with the same ports, so both platform
bindings inherit the bind.

Drill: `test/unit/vault/feederAncestry.test.ts` on real processes —
test process → a real node child → a real sleep it spawns, every
identity read from the kernel by the compiled shipped helper. Four
cases: accept the true chain; refuse a requester outside the
ancestry; refuse when the intermediate's pid answers with another
real process's kernel start time (a recycled pid cannot be forced
against the real allocator, so the case is composed from two real
kernel readings, exactly what reuse presents); refuse after the
intermediate really dies and the leaf reparents. Removal drill:
deleting the intermediate re-read failed exactly the recycled case
(1 failed, 3 passed); restored, 4 passed.

Residual risk: RVM109H found the walk's re-read and the parent helper
were separate processes, so a recycle between them was outside this
bracket. The helper now requires the birth the walk recorded, on both
of its own reads (`docs/certification/rvm109h.md`). What remains is a
same-tick collision of two Linux start times, and a pid recycled and
re-recycled back to an identical (pid, start-time) pair inside one
bracketed read set. A real pid-space wrap was not run. A container
pid namespace is named, not proven (unproven.md).

## 4. Headless taint never accumulated

Finding (RVM109 §2): the headless service began a taint session with
`beginRequest([], true)` and nothing ever called `observe`, so a
headless run presented a clean session it never proved; the engine's
own per-request provenance notes (`noteVaultTaint`) had no consumer
anywhere.

Change: the notes now land. `createHeadlessVaultTaintSource`
(`vaultExecHost.ts`, shipped in `dist/vaultExecHost.js`) accumulates
every engine note for the run's life and is never cleared by a later
clean snapshot. The exec run creates one source on first note or use
(`runExec.ts`), `ExecRuntimeOptions.noteVaultTaint` carries the sink
through `backends.ts` into `ModelApiBackendManager`, which forwards
it into the host deps `ModelApiHost` already calls. The headless
service's `taint` dep is now required and reads that source at every
authorize — no headless construction can silently present a clean
session. A tainted use is denied by the headless session before any
ticket and said through the run's denial record (`onDenied`), never
silent; only the Model API (engine) backend offers `vault_run`
headless, which is the backend that notes provenance.

Drill here: `vaultHeadlessTaint.test.ts` pins the source (starts
clean, accumulates a noted `search` provenance, a later clean note
does not clear it, per-source isolation): 2 passed. The broker-level
proof is the delegated suite's new case — a counted use succeeds,
then a note, then the same use refuses with `(tainted)` in the
denial record. That suite could not run in this lane's sandbox: with
a short `TMPDIR` its setup fails in the governed identity probe
(`registerPosixVaultHost` → `vaultProcessIdentity`, fixed `No
access`), and the identical failure reproduces at the base commit
`5ec754534` in a scratch worktree, so it is this sandbox's block, not
this change. Per the rig rules that part stops here and belongs to
hosted CI; nothing was shimmed. The suite compiles and typechecks,
and its fixture construction was de-duplicated (`serviceOver`) for
the duplication gate.

Residual risk: taint is sticky for the whole run by design — a run
that touches untrusted content early keeps refusing vault uses until
it ends, said each time; a fresh run starts clean. Muse Code
backend headless offers no `vault_run`, so no unnoted-consumer claim
remains.

## 5. Named, not fixed

Windows policy path, container pid namespace, and the git, askpass,
sudo, SSH and editor surfaces are recorded in
`docs/real-life/unproven.md` (lane RLF-M109H section), each with what
a run has to prove. No claim in this record covers them.

## 6. Gates

Repository timeouts everywhere; no `--testTimeout`. Vault suites ran
on this rig (allowed on the Mac mini); the broker fixture uses the
product's file anchor, and no OS credential store suite ran here.
The darwin helper `.app` was built with `native/darwin/build.sh`
(git-ignored outputs) because the broker fixtures stage it.

| Command                                                                                                   | Exit | Result                                                                                                                                                                                                                                                                                                                                                                                                                 |
| --------------------------------------------------------------------------------------------------------- | ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `prettier --check` on every touched file (sources, tests, tables, PLAN, CHANGELOG, unproven, this record) | 0    | after `--write` on the same set                                                                                                                                                                                                                                                                                                                                                                                        |
| `eslint --max-warnings 0` on every touched source and test                                                | 0    |                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `npm run typecheck`                                                                                       | 0    | host, webview, desktop, unit, e2e, integration, faults. The walk's first draft was exit 2 (`currentLive` possibly null); the recorded-birth read is explicit now                                                                                                                                                                                                                                                       |
| `node scripts/check-l10n.mjs`                                                                             | 0    | 0 problems, after `npm run desktop:l10n` regenerated `tables.rs` and `UiText.qml` for the one new sentence (English + 14 tables)                                                                                                                                                                                                                                                                                       |
| `npm run check:reference`                                                                                 | 0    | 93 features, current                                                                                                                                                                                                                                                                                                                                                                                                   |
| `npm run check:host-api`                                                                                  | 0    | 0 problems, no record change                                                                                                                                                                                                                                                                                                                                                                                           |
| `npm run check:plan`                                                                                      | 0    | 250 milestones, 0 drift                                                                                                                                                                                                                                                                                                                                                                                                |
| `npm run check:roadmap`                                                                                   | 0    | 250 entries, `ROADMAP.md` current after `roadmap:generate`                                                                                                                                                                                                                                                                                                                                                             |
| `npm run check:catches`                                                                                   | 0    | baseline matched; no count rose                                                                                                                                                                                                                                                                                                                                                                                        |
| `npm run duplication`                                                                                     | 0    | 0 clones. The first run found 1 (the delegated suite's two service constructions my taint closure pushed over threshold); one `serviceOver` owner now builds both, 0 again                                                                                                                                                                                                                                             |
| `npm run cycles`                                                                                          | 0    | no circular dependency                                                                                                                                                                                                                                                                                                                                                                                                 |
| `npm run deadcode`                                                                                        | 0    | knip clean; the same 7 `@unwired` tag hints as the base                                                                                                                                                                                                                                                                                                                                                                |
| `npm run build`                                                                                           | 0    | every budget holds. Vault bundles: `dist/vaultExec.js` 97,896 B (95.6 of 110 KiB), `dist/vaultExecHost.js` 34,485 B (33.7 of 40), `dist/vaultPolicy.js` 9,693 B, `dist/vaultRuntime.js` 21,789 B. Bundle split, host globals, notices (134) and legal records inside that command all passed                                                                                                                           |
| `npx vitest run vaultPanelBuild + vaultHeadlessDeny`                                                      | 1    | 6 passed, 1 failed: the test's own migration bundle measures 45.35 KiB against its 45 cap — byte-identical at base `5ec754534`, so pre-existing at cc/int9 and not worsened here; the production `dist/vaultMigration.js` is 42,322 B and within cap. No cap was raised; the lead owns the call                                                                                                                        |
| `npx vitest run vaultPeerRun + feederAncestry + vaultHeadlessTaint` (final run, repository timeouts)      | 0    | 9 passed, 1 skipped (the Linux `/proc` case)                                                                                                                                                                                                                                                                                                                                                                           |
| `npx vitest run vaultEnvironmentWarning`                                                                  | 0    | 2 passed                                                                                                                                                                                                                                                                                                                                                                                                               |
| `npx vitest run test/unit/vault/vaultExecDelegated.test.ts` (short `TMPDIR`, helper built)                | 1    | suite setup fails in the governed identity probe (`No access`), 4 skipped; the identical setup failure reproduces at base `5ec754534` in a scratch worktree on this rig — the sandbox's block, named in section 4, for hosted CI. With the lane's default long `TMPDIR` the suite skips at collection (socket fit) instead                                                                                             |
| `npx vitest related vaultExecEntry + peer + brokerBindings --run`                                         | 0    | 23 files affected: 76 passed, 39 skipped                                                                                                                                                                                                                                                                                                                                                                               |
| `npx vitest related vaultExecHost + vaultExecHostEntry + modelApiBackendManager --run`                    | 0    | 10 files: 54 passed, 4 skipped                                                                                                                                                                                                                                                                                                                                                                                         |
| `npx vitest related backends + runExec + VaultApprovalCard --run`                                         | 0    | 12 files: 129 passed                                                                                                                                                                                                                                                                                                                                                                                                   |
| `npx vitest related src/shared/l10n/en.ts --run`                                                          | —    | not completed on this rig: terminated after 34 minutes with its one remaining worker hung at 0% CPU for 24 of them (the English table's related set is effectively the whole unit suite, and a worker in it waits on something this sandbox does not provide). Covering the table change here: `check-l10n` (0), typecheck (0), the card suite (2 passed) and the related batches above. Hosted CI runs the full suite |
| `SSL_CERT_FILE=/etc/ssl/cert.pem SEMGREP_ENABLE_VERSION_CHECK=0 npm run security:sast`                    | 0    | 699 rules, 6018 files, 0 findings                                                                                                                                                                                                                                                                                                                                                                                      |
| `npm run security:audit`                                                                                  | 0    | 2 advisories noted (moderate `glob`, `minimatch`), 0 exceptions; the lock was not changed by this lane                                                                                                                                                                                                                                                                                                                 |

Red/green drills, one per item, each restored and re-run green:
item 1+2 — base helper restored, `vaultPeerRun` 2 failed; item 3 —
the walk's intermediate re-read removed, `feederAncestry` 1 failed
(the recycled case); item 4 — the delegated case is written for
hosted CI (this sandbox's block above), the source pinned here; the
card sentence — its line removed, 1 of 2 failed. No gate was weakened
and no budget was raised.
