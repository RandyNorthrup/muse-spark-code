# RLF-GOVFORK — the governor's per-job fork limit against supervised agents

Lane H (`supervise`, M104) launched supervised runs outside the resource
governor, because the governor's per-job fork protection (M107, D100 G13)
would have stopped a supervised agent under ordinary tool use. This lane
decides what that limit is under D121/D208 as the owner clarified it on
2026-10-23, then registers supervised runs with the governor.

## 1. The per-job fork limit under D121/D208

The guard lives in the tree sampler (`ResourceLaunchHost.sampleTree`) and
the attested Windows job (`ATTESTED_JOB` in `process.ts`, enforced by
`native/windows/MuseSparkMcpJob.cs`): past N alive processes in one job's
tree, or past M births in 15 s, the offending job alone is stopped.

Classification: a bound that only guards a runaway failure, not an
arbitrary cap on the person's work. Evidence: G13, the incident that
created it — a helper spawned about 1,200 command wrappers and froze the
orchestrating PC. A fork bomb and an unbounded respawn loop are exactly the
failures the owner's clarification keeps bounds for.

Values, kept at industry-standard numbers with the sources:

- 512 alive processes per job tree (`RESOURCE_TREE_PROCESS_CAP`, was 128).
  systemd shipped `DefaultTasksMax=512` per service (v228–v230; Fedora
  devel, September 2016), and 512 sits below this project's own measured
  freeze (~1,200, G13) with better than 2× margin. Current per-service and
  per-pod defaults run higher — Podman 2048 (`--pids-limit`,
  man.archlinux.org), OpenShift `podPidsLimit` 4096 (docs.okd.io), GKE
  ≥ 1024 (docs.cloud.google.com), systemd 15% of pid_max — but those cover
  whole services and pods, 10–100× our scope of one command tree, and none
  of them would have stopped the 1,200-process freeze. The mechanism is the
  industry's: Linux counts with the pids cgroup ("stop any new tasks from
  being fork()'d or clone()'d after a certain limit is reached",
  docs.kernel.org), Windows refuses with the job object's
  `ActiveProcessLimit` (learn.microsoft.com: past the limit the child
  "is terminated").
- 16,384 births per 15 s per job tree (`RESOURCE_TREE_SPAWN_CAP`, was 64;
  the window is unchanged). OpenShift's `podPidsLimit` maximum is 16,384
  (docs.okd.io): the highest per-workload process count the industry
  ships. A single job churning that many births within 15 s — over a
  thousand spawns a second, sustained — is a flood, not work. The old 64
  stopped legitimate bursts: the Windows helper counts every birth
  exactly, so any 15 s window with 65 spawns ended the whole job.

Burst measurements (Mac mini rig, 2026-10-30, `time` over real runs):

- sequential shell loop (`for …; do /usr/bin/true; done`, 2,000): ~300/s;
- `find src -name '*.ts' -exec /usr/bin/true {} \;` (2,223): ~278/s;
- parallel `xargs -P16 -n1 /usr/bin/true` (2,000): ~2,160/s in a sub-second
  burst — invisible to the 15 s POSIX sampler, which only sees processes
  alive at its sample; the exact Windows counter sees Windows-native
  bursts, whose per-spawn cost bounds them far lower.

The new rate (16,384/15 s ≈ 1,092/s sustained) clears sequential legitimate
bursts several times over on the exact-counting platform, while a real
flood crosses it in seconds. The count (512) covers even `-j128` parallel
builds (~400 alive) with margin, and the commit's tests prove both sides:
a 200-spawn/100-alive burst and a 200-quick Windows burst pass, while
521 alive (count), 101 alive against a narrowed rate (mechanism), 513
concurrent Windows children (kernel refusal) and a 25,000-spawn Windows
flood (helper termination) are all stopped.

Not person-settable. This is an internal resilience default in the sense
of lane RLF-SAFELIMITS (accepted onto this base, cited in PLAN.md D121):
no person tunes a fork-bomb backstop their legitimate work provably never
reaches, and the person's tuning surface for machine pressure — the
cpu/memory/disk caps — already exists. A C# change was not needed: the new
values flow to the helper through the existing attestation.

Says why, at last. The POSIX sampler's stop used to be silent (its
`limited` flag was set and never read). Now the sampler records its cause
on the lease, the outcome carries it (`forkStop`, including Windows
`spawnRate` endings), and the exec boundary throws the typed
`ResourceForkStopError`, which the pull-request checkout maps to its own
sentence. A stop that lands after the caller already read the outcome is
not seen there; the lease contract says so.

## 2. Supervised runs are governed launches

`superviseRuntime` admits, registers, tree-owns and completes its child:

- POSIX keeps its own spawn (own group) and stop (SIGTERM grace, then
  SIGKILL, proved gone), and adds a governor lease around them: admitted
  as foreground `other`, registered by pid and group with the run's own
  stop for dispose, completed with what the close proved about the group
  (gone or not — never assumed). No temp root: the child is a full
  runtime that governs its own launches' temp. Linux binds the group, so
  fork protection and usage cover it; macOS registers occupancy only, as
  do all other macOS launches (no production `bindNativeTree` exists).
- Windows goes through the one governed launch, `spawnResourceProcess`
  `contained`: the run is attested, its drain is proved, and fork
  protection is enforced by the helper. The stop asks the helper and
  proves retirement from the settlement.

A supervised run never runs ungoverned: without admission it refuses with
`admissionUnavailable` (uniform on both platforms, matching
`spawnResourceProcess`). A stop that lands during admission ends the run
as stopped (exit 0). After the run, fork protection speaks on stderr:
which bound fired with its number, and how many children the cap refused
while the run continued.

Deliberately unchanged: the endpoint, the records, the stop words, the
exit-code contract, lane H's seven cases. Containment is now uniform in
one corner: stragglers after a normal exit are ended at dispose on POSIX
instead of surviving it (Windows kill-on-close always did).

## Proof

Changed sources: `src/shared/constants.ts` (caps with sources),
`src/core/resources/launch.ts` (typed stop, outcome), `launchHost.ts`
(cause, lease, caps override), `process.ts` (attested mapping, POSIX
outcome), `commands.ts` (exec boundary), `src/runtime/panel/pullRequests/checkout.ts`
(checkout sentence), `src/shared/l10n/en.ts` plus all 14 tables (words),
`src/runtime/supervise/supervisor.ts` (governed launches).

Committed tests, real processes only, repo's own timeouts (Mac mini rig,
2026-10-30):

- `test/unit/superviseGoverned.test.ts`: 1 passed (180 ms) — a normal
  supervised run registers, runs, completes, retires; never stopped.
- `test/unit/resourceForkProtection.test.ts`: 7 skipped here by their own
  gates (4 POSIX need ps/`/proc` binding, denied on this rig; 3 Windows
  need the job object). They run on Linux and Windows CI: count flood
  521, ordinary burst 200/100, narrowed rate 60, supervised runaway,
  Windows count 513 / burst 200 / flood 25,000.

Related runs, every failure chased to its cause:

- `npx vitest related src/core/resources/launchHost.ts --run`:
  318 passed / 27 failed / 26 skipped files, 4021 / 72 / 218 tests.
  All 27 files were re-run against a clean worktree of the base
  (int/recovery 94b15b376, same rig, same flags): every one of the 72
  failures reproduces there test-for-test — helper binaries not built
  (`muse-dictate` ENOENT), sandbox-denied `ps`/spawn (EPERM), no macOS
  keychain, load timeouts (5 s, 120 s, 240 s), bundle-shape drift the
  base already carries. Two apparent lane/base differences were each
  re-run in isolation and fail on the base too (scheduleFireFailures'
  absent-run rejection is a 5 s load flake either way). The lane adds
  zero regressions to the related set.
- `npx vitest related` over the other seven changed sources (one union
  run: `constants.ts`, `launch.ts`, `process.ts`, `commands.ts`,
  `supervisor.ts`, `checkout.ts`, `en.ts`): 1086 passed / 42 failed /
  38 skipped files, 27432 / 104 / 290 tests. The 27 launchHost-set
  files fail the same way; the 15 further files were each re-run on
  the clean base: 12 fail there test-for-test (packaging/schema drift,
  ps-denied samplers, macOS folder guards), and 3 files' failures are
  union-load flakes, green in isolation on the lane — and on the base
  where re-run (estimatorSnapshotStrict F11/F12: 5 s timeouts;
  legalCancel mid-walk abort: 10.8 s in union; team advisories and
  engine ports: 21/21 and 15/15 green alone on both sides).

Red/green drills, each a temporary test (since removed), real
processes, repo's own 5 s timeout:

- D1 (sampler cause): narrowed `processCap: 1`, three scripted members
  (the OS's member answer; the rig's `ps` is denied), a real `/bin/sleep`
  root. Green: the governor SIGKILLs the root, the lease reads
  `activeProcess`, no errors. Break (stopCause never assigned): exit 1,
  `expected undefined to be 'activeProcess'`. Restored: green.
- D2 (straggler honesty): a supervised entry exits leaving a `/bin/sleep`
  straggler in its group. Green: close completes unretired, dispose ends
  the straggler (271 ms). Break (`complete(true)` always): exit 1, the
  5 s timeout — the straggler survives dispose, abandoned. Restored:
  green.
- D3 (stop during admission): admission held pending at the H-C1 seam,
  stop sent through the real endpoint. Green: reply `STOPPED`, run
  resolves 0. Break (rethrow): exit 1, the run rejects with AbortError.
  Restored: green.

Gates (Mac mini rig, 2026-10-30, true exit codes): prettier on touched
files 0; eslint `--max-warnings 0` on touched files 0; typecheck 0;
check-l10n 0 (0 problems); check:reference 0; check:host-api 0;
check:plan 0; check:roadmap 0; check:catches 0 (the new supervisor
catch reads NARROW after RLF-GOVFORK 3 inlined its condition);
duplication 0 (0 clones); cycles 0; deadcode 0; build 0 (every budget
holds). Touched suites plus `related` on each changed source, repo's
own timeouts, as above.
