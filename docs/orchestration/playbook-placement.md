# Playbook chapter: placement, load balancing and moving work

> Note: the shipped orchestrator playbook skill (M116) will adopt this
> chapter in M116's follow-up. Until then it lives here as the recorded
> source of truth.

Recorded 2026-10-06 from running up to 37 agent lanes on six machines with several agent engines. Owner directives:

- "all of the knowing when to move stuff around and load balancing what leg of a project is on which device ... including load balancing based on an agents speed" goes into the playbook in a meaningful way;
- "the playbook should be orchestration details and things and should be model agnostic".

**Model-agnostic by rule.** This chapter never names a model, vendor or engine, and never says which engine codes or reviews. Role assignment belongs to the user's role definitions. The playbook places work only among the engines a role allows. It uses each engine's _measured profile_, never a built-in opinion of it.

Each rule below is written so the orchestrator can apply it, and the scheduler (M96c), the estimator (M117), the governor (M107) and the playbook policy (M116) can check it.

## 1. Every leg has a profile before it is placed

For each lane (a "leg" of the project), record:

- **Needs.** The capabilities it cannot run without:
  - an OS (Windows-native, macOS, Linux);
  - hardware (a biometric sensor or secure enclave, a GPU encoder, a TPM);
  - installed tools (a platform SDK, an IDE, a browser for browser and accessibility suites);
  - signed-in services (an agent CLI, a provider account);
  - the user physically present (a biometric prompt).
- **Kind.** Build, fix, review, integration, release prep, capture or live check.
- **Weight.** Expected CPU, memory, disk and temp use. A full test suite, an accessibility harness and image builds are heavy; a read-only review is light.
- **Inputs.** The base commit, the brief, and every file the brief names. A worker refuses to start with any of them missing (gotcha G1/G2).
- **Criticality.** On the critical path to a promised release, or not.

## 2. Each device has a live capability and capacity record

- **Capabilities.** Measured, not assumed:
  - which tools exist and their versions;
  - which agent CLIs are signed in;
  - a working smoke call per engine;
  - hardware such as a browser or biometric sensor.
- **Slot cap from measured headroom.**
  - Start conservatively. Raise the cap only while load, swap, disk, temp and transport health stay green.
  - Lower it at once on pressure:
    - load well above the core count;
    - swap nearly full;
    - free disk under its floor;
    - temp space over 70%;
    - an OS indexer ballooning;
    - remote sessions resetting.
  - Seen on 2026-10-06:
    - a Windows SSH server reset above about 7 sessions → cap 5;
    - a 16 GB Mac starved at 11 heavy lanes;
    - a Linux VM's tmpfs reached 81% and the browser crashed.
- **First-run cost.** A fresh device pays a one-time setup cost (toolchain, dependency install, the first push of the repository: about 10 minutes). Amortize it: give a new device several lanes, not one.

## 3. Place by capability first, then by fit, then by speed

1. Filter devices by the leg's needs. Never place a browser suite on a device without a browser, or a Windows-native leg off Windows. A leg whose need no device meets is reported as blocked; it is never run degraded and reported as passing.
2. Keep a leg next to its data. A fix round runs where its worktree lives; moving it means moving the branch first.
3. Spread heavy legs across devices. Never two full test suites on one small machine at once. One full gate per device at a time.
4. Balance by speed and cost (section 4) among the devices that fit.

## 4. Balance by agent speed, quality and budget

Each engine the user has connected gets a measured profile that the estimator keeps current. Fields:

| Field               | Meaning                                                                            |
| ------------------- | ---------------------------------------------------------------------------------- |
| Time per lane       | median and spread, per lane kind and machine class                                 |
| Fix rounds          | how often its work needs another round after independent review, per lane kind     |
| Parallel safety     | how many run at once per machine before throughput drops                           |
| Verdict reliability | how often a review run ends without the required verdict                           |
| Cost and budget     | the price per lane and the budget left (credits, weekly limit), with the burn rate |

On 2026-10-06 the spread was wide: about 20 minutes per lane for the fastest engine, 1–3 hours for the slowest. Placement that ignores the profile wastes hours.

Rules:

- **Roles come from the user's role definitions.** The playbook places work among the engines a role allows. It never adds or removes an engine from a role.
- **The author's engine never reviews its own lane.** Every lane's output gets an independent review before acceptance.
- **Plan with expected total, not first-pass speed.** Expected lane time = time per lane × (1 + expected fix rounds). The critical path goes to the engine with the best expected total.
- **Choose by remaining budget, not just speed.** When an engine's budget would run out before the deadline at the current burn rate:
  - move non-critical new work to engines with budget;
  - keep the scarce engine for critical-path work;
  - never stop in-flight work just to switch.
- **Re-measure.** Each finished lane updates its engine's profile. The estimator uses these numbers, so placement improves as the run goes on.
- **Saturate available capacity.** When an engine has free slots on a machine with headroom, and independent work its role allows exists, start that work. Idle capacity is lost time.

## 5. When to move work, and when never to

**Move new work freely; never move running work out of fear:**

- **Never duplicate or abandon a worker's running jobs because it is unreachable.** Wait, diagnose and recover it. Re-dispatch only after its lease expires, under a new epoch, and quarantine late results (G6).
- **Move a leg when:**
  - its device can no longer meet its needs (tool lost, disk full and cannot be cleared);
  - its engine's budget is exhausted;
  - the device is persistently pressured and the leg has not started yet.
- **To move a leg that has started:**
  1. stop it at a checkpoint, with its commits on its branch;
  2. carry the branch, the brief and its inputs to the new device;
  3. continue from the commits. Never restart from scratch.
- **Pause, don't kill, out-of-scope work.** When priorities change, let near-finished legs finish their current run and start no follow-ups. Restart is cheap because the state lives in commits.

## 6. Critical path and ordering

- Order legs by the release they block. A release's integration legs start the moment their inputs are accepted.
- **Start legs from a fresh base.** Lanes built on an old base hide startup-size and behaviour conflicts until integration (G4). Integrations always re-run the full suite and the accessibility harness after merging current main.
- **One integration review per milestone** verifies every lane's fix commits, instead of a separate re-review per lane when time is short. Record the choice and the evidence.
- **Releases slice by readiness, not by the original grouping.** Ship what is integrated and green, in order.
- **One writer per release branch.** Other agents send findings, not commits. Several agents fixing one failing release make conflicting edits.
- **CI is the final gate.** Budget about 30 minutes per release run. Re-run the whole workflow, never only failed jobs (G21).

## 7. Watching the fleet

- Watch continuously and event-driven. Report every finished lane in each pass; a failed status check means "unknown since …", never "running" (G5, G7).
- **Alarms:** unreachable, low disk, memory or swap pressure, temp space, and a budget running out early.
- **Status shown to the user:** a few lines. Owner-blocked items first, then shipped, fixing, next. Plus a chart with time estimates per release and a per-milestone breakdown: lanes done, running and remaining, engine, device, ETA.

## 8. Lessons learned (kept current during every run)

Each lesson here cost real time on 2026-10-06. The playbook skill carries them as rules, and the orchestrator enforces the ones marked with a control.

1. **A launch is not a start.**
   - _What happened:_ a launcher printed nothing and exited 1. Under `set -e -o pipefail`, `ls a b | head` failed because one candidate path was missing. Two lanes never ran, and nothing said so until a status pass.
   - _Rule:_ every launch is confirmed by a liveness probe (process alive and log growing within 30 seconds), or it is reported as **failed to start**. Silence is never success.
   - _Control:_ M96c dispatch acknowledgement plus a first-heartbeat deadline (G35).
2. **A review queue on one machine is a bottleneck.**
   - _What happened:_ reviews queued serially on one machine while four others idled.
   - _Rule:_ reviews dispatch to the least-busy machine that has an allowed engine and run in parallel up to the per-machine cap. Claims are atomic (a lock directory, never a check-then-write).
   - _Control:_ M96c needs-based placement covers reviews as well as builds.
3. **No verdict is not a pass.**
   - _What happened:_ some review runs ended without the required verdict line.
   - _Rule:_ a review lacking its verdict marker is **incomplete**. It is re-dispatched once, then escalated to another engine the role allows. It is never read as clean.
   - _Control:_ M116 reviewer charter plus a parser test.
4. **Fixed waits break on lazy UI.**
   - _What happened:_ release CI failed several rounds on harness scenes that waited a fixed time for UI that now loads lazily.
   - _Rule:_ tests and capture scripts wait on a condition (element present, event fired, process drained), never on a timer.
   - _Control:_ condition waits in the harness plus a lint against bare timers.
5. **Budgets track measured size.**
   - _What happened:_ a package ended up 6 bytes over its cap.
   - _Rule:_ a size budget is the measured artifact + 5%, rounded up. It is re-measured in the release-prep leg, not discovered in CI.
6. **Capabilities are probed, not assumed.**
   - _What happened:_ several things looked present but failed only at first use:
     - a CLI version too old for its service (HTTP 426);
     - an account tier the CLI rejects;
     - a sandbox that cannot take a lock on one OS.
   - _Rule:_ the capability record holds tool versions and a working smoke call per engine. A failed probe removes that engine from the machine's offer list until it is fixed.
7. **Cleanup must not follow links.**
   - _What happened:_ removing a worktree with force followed a directory junction and emptied the main checkout's dependencies. A temp cleanup pattern also matched system folders.
   - _What happened, again:_ a temp sweep checked each directory's contents with `ls "$d"` before deleting. For names starting with `-`, `ls` read the name as an option and failed. The empty output counted as "nothing unexpected inside", so those directories were removed unchecked.
   - _Rule:_ cleanup removes only what the orchestrator created, unlinks junctions and symlinks first, and never recurses through a link. Every safety check before a delete fails closed: an error or empty answer from the check means **keep**. Paths are passed after `--` or as `./name`.
   - _Control:_ M110/M100 workspace teardown tests with a planted junction and a dash-prefixed name (G37).
   - _Related:_ test tooling can leak per-run caches into temp. Here, one transform-cache directory per test run, 10–56 MB each, filled a 32 GB tmpfs to 75%. Each run gets its own cache path inside its workspace, and teardown removes it. The device record watches temp space (section 2).
8. **The transport has per-source limits.**
   - _What happened:_ the machines' SSH servers throttle a source that opens many short sessions (`PerSourcePenalties`, `MaxStartups`).
   - _Rule:_ one batched call per machine per watch pass, with backoff on refusal. The orchestrator's address is exempted only by the user's own server config.
   - _Control:_ D101 orchestrator link (one long-lived authenticated channel per node).
9. **Speed is not throughput.**
   - _What happened:_ the fastest engine's milestone lanes mostly drew P1/P2 findings and a fix round. A slower engine's lanes took longer but needed fewer rounds.
   - _Rule:_ the expected total from section 4 decides, never the first-pass time.
10. **Exit 0 is not done.**
    - _What happened:_ two integration lanes exited cleanly at their step budget. They had files edited after their last commit, and their own final messages said "incomplete". A watcher that read only the exit code reported them finished.
    - _Rule:_ a lane is done only when its worktree is clean, its final status lists every brief step as done, and its branch head moved. Otherwise it is **stopped, incomplete**. It is continued in place from its commits and uncommitted work, with the original brief plus a continuation header, never restarted.
    - _Control:_ M96c completion check (clean tree + status parse + head moved) before a lane can be marked done or handed to review (G36).

## What each component implements

| Rule                                                                             | Component                                                                                                                          |
| -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Leg profiles, needs-based placement                                              | M96c scheduler, with a test that a leg needing a browser never lands on a browserless device                                       |
| Device capability and capacity record                                            | M100 (paired devices) and M110 (nodes) report capabilities; M107 sets slot caps from measured pressure                             |
| Engine profiles (time, fix rounds, parallel safety, verdict reliability, budget) | M117 calibration per engine × lane kind × machine class, re-fitted after each finished lane; no engine named in code or skill text |
| Role-respecting placement                                                        | M96c scheduler reads the user's role definitions; a test that placement never assigns work outside a role's allowed engines        |
| Budget-aware engine choice                                                       | M117 recommendations plus M108 account thresholds; a test that a nearly exhausted engine gets no new non-critical legs             |
| Never duplicate on unreachability                                                | D90.25 leases (M110), M100 lanes, M96c; already in the gotcha register (G6)                                                        |
| Moving a started leg from its commits                                            | M96c relocation, with M107's relocation policy                                                                                     |
| Launch liveness, verdict parsing, one writer per release                         | M96c dispatch acknowledgement; M116 reviewer charter; M116 playbook skill                                                          |
| Integration review covers fixes; slicing releases                                | M116 playbook skill and reviewer charter                                                                                           |
| Status and ETA chart                                                             | M117 surfaces (Gantt, bottleneck, setup cards)                                                                                     |
