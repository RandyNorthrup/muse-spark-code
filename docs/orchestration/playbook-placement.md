# Playbook chapter: placement, load balancing and moving work

Source: the lead's experience on 2026-10-06, running up to 37 agent lanes on six machines with several agent engines. Owner directives:

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

Each lesson here cost real time during the runs of 2026-10-06 and 2026-10-07. The playbook skill carries them as rules, and the orchestrator enforces the ones marked with a control.

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

11. **Urgency does not shorten the checklist.**
    - _What happened:_ a hotfix skipped the release-prep checklist to ship faster. CI failed on two items the checklist covers: a stale contents anchor and a duplicated test helper. Then four automated review threads blocked the merge. The shortcut cost two extra CI rounds, about an hour.
    - _Rule:_ a hotfix runs the same release-prep checks as any release. Only the scope is smaller. Automated review threads are read and fixed in the same pass, before the CI run that is meant to ship.
    - _Control:_ M116 release charter; the release leg refuses to open the PR until the prep checks pass (G45).

12. **Certify the way the gate runs.**
    - _What happened:_ a release integration reported the full suite green on a worker that still had build outputs from earlier runs and fast hardware. Hosted CI ran clean checkouts on slower runners: 23 jobs failed. Tests read missing build outputs, depended on a commit that existed only on a worker, timed out at the default deadline, or hit a platform path rule.
    - _Rule:_ a release leg verifies from a clean tree (untracked outputs removed, dependencies freshly installed), with CI's environment and default deadlines. At least one run happens on the slowest supported platform. A worker's green result is labelled "worker-certified", never "CI-equivalent", unless it ran this way.
    - _Control:_ M96c verification step template (clean, CI env, default deadlines); M116 release charter; gotchas G28, G43.

13. **Open the release candidate early.**
    - _What happened:_ the release's hosted checks and automated reviewer saw the integrated train only when its PR opened, at the end. The reviewer found two P1s there, including the headline feature unusable (every provider add refused), after every lane had passed its own review.
    - _Rule:_ the moment an integration branch exists, open it as a draft PR, so hosted CI and the automated reviewer run on every integration step. Lane reviews check lanes; only a whole-train review catches cross-lane breakage.
    - _Control:_ M116 release charter (draft PR at integration start); M96c merge queue (G44).

14. **Stopped runs leave orphans.**
    - _What happened:_ lanes stopped mid-test left test fixtures running for up to a day. These were processes built to ignore SIGTERM, one of them in a busy loop at half a core. Nothing noticed until a machine's load alarm, which first looked like the active lane's fault.
    - _Rule:_ stopping a run kills its whole process tree (process group or job object), not just the top process. The device watcher sweeps orphans whose start time matches no live run, then reports and kills them. Test fixtures that spawn detached processes register their own teardown.
    - _Control:_ M107 governor orphan sweep; M100/M110 job objects or process groups per run; gotcha register row G38.

15. **Finished work must never wait on the orchestrator.**
    - _What happened:_ ten finished integration lanes sat unprocessed for 5–9 hours, one of them blocked by a single lint error, while the orchestrator focused on one release's CI. The completion watcher reported events once. Busy turns missed them, and nothing re-surfaced them. Three releases stalled behind them.
    - _Rule:_ the orchestrator keeps a completion ledger: every lane is running, done-unprocessed (with its age) or processed. Any done-unprocessed lane older than 15 minutes is an alarm at the top of every status. Each status pass reconciles the ledger against every machine directly, never only against event notifications.
    - _Control:_ M96c board "waiting on me" column with ages; M117 bottleneck card; G39.
16. **Pull committed work from long critical-path lanes on a cadence.**
    - _What happened:_ a release's last CI-repair lane ran 3.5 hours. Its fixes were committed early, but the release waited for its final report.
    - _Rule:_ for a lane on the critical path, the orchestrator integrates its committed commits at least hourly and starts the gate on them. The lane keeps working and its later commits integrate the same way.
    - _Control:_ M96c merge queue takes committed lane heads on a timer for critical-path lanes; G40.
17. **Concurrent lanes own disjoint files, including tests.**
    - _What happened:_ three parallel CI-repair lanes, split by platform, each rewrote the same two test files differently. Every merge needed a manual choice.
    - _Rule:_ when work is split by symptom or platform, the orchestrator assigns each FILE to exactly one lane before launch. A lane that needs another lane's file sends a request instead of editing. Ownership is checked at merge.
    - _Control:_ M96c file-ownership map with a merge-time check; G41.
18. **Releases are pipelined, not serialized.**
    - _What happened:_ four planned releases ran strictly one after another, so a slow first release blocked the other three entirely.
    - _Rule:_ as soon as release N has a candidate branch, release N+1's integration starts on top of that candidate, and N+2's milestones pre-integrate in parallel. Each later merge then picks up only N's last fixes.
    - _Control:_ M116 release charter; M96c stacked integration branches with draft PRs; G42.
19. **Fix a failure class in one pass, never one instance per gate run.**
    - _What happened:_ a release's hosted CI failed overnight, round after round, each time on the next slow test past the same 5 s deadline. Each repair fixed only the files named in that run and paid a full 40-minute gate run to find the next one. A badge check's API quota failure was fixed in one workflow, then failed in a second workflow that ran the same check.
    - _Rule:_ when a gate fails, the orchestrator names the failure's class (deadline, quota, platform path, memory), then sweeps the whole evidence (the complete log, every caller of the failing check, every workflow that runs it) for every instance before the next run. One repair covers the class.
    - _Control:_ M96c repair legs take a class plus the full evidence, not a single failure; M116 reviewer charter asks "where else does this run?"; G47.
20. **Sweep results are candidates; check each before a bulk edit.**
    - _What happened:_ a scanner flagged 29 slow tests as lacking deadlines. 21 already had one that the scanner could not see (a suite option held in a variable). A bulk edit applied before checking would have tightened two suites from 60 s to 20 s, which then failed.
    - _Rule:_ any automated sweep that feeds a bulk change has its hits checked against the effective state (here, the effective deadline after suite options) before editing. The checked count and the false positives go in the receipt.
    - _Control:_ M96c bulk-edit legs carry a verification step and report false positives; G48.
21. **Completion comes from the runner, never from what a lane prints.**
    - _What happened:_ a lane's build tool printed its own status line ending in `exit=1`. The fleet watcher took that line for the runner's exit marker and reported a running lane as done.
    - _Rule:_ completion comes only from an out-of-band record that the runner alone writes (a whole-line marker or an exit file). Text a lane can print never decides its state.
    - _Control:_ M96c dispatch writes the record; the M107 device watcher reads only that record; G53.
22. **A report nobody routed is not "no report".**
    - _What happened:_ an integration lane certified "no reports" for two lanes. Their reviews (2 P1, 5 P2) sat in a separate findings file that nobody routed to the integration.
    - _Rule:_ every review report is attached to its lane's ledger record when it lands. An integration brief lists each lane's report path explicitly. "No report" is checked against the ledger, never taken from the integrating lane's own search.
    - _Control:_ M96c board (reports on the ledger record); M116 integration charter; G54.
23. **Cleanup stays inside its own root and never changes permissions.**
    - _What happened:_ a macOS temp sweep selected folders by the shape of their names. It matched three operating-system daemon folders (21-letter names that looked like random ids, and a word-dash-six-letter name) and ran a recursive permission change on them before the deletion was refused. Nothing inside changed.
    - _Rule:_ test temp lives under one harness-owned root, and cleanup deletes only there. Cleanup never changes permissions. A name's shape alone never selects anything for deletion.
    - _Control:_ M107 governor cleanup; M100/M110 worker teardown; extends lesson 7 and G11; G55.
24. **Measure what a delete frees, not what `du` adds up.**
    - _What happened:_ on macOS, `du` reported 49 GB in a browser's code-sign clone folders. Deleting all of them freed nothing, because APFS clones share blocks.
    - _Rule:_ measure reclaimable space as the volume's free space (`df`) before and after, or with a clone-aware tool, before choosing what to delete.
    - _Control:_ M107 governor disk floors; G56.
25. **Heavy gates take a machine slot, whoever starts them.**
    - _What happened:_ an integration lane's own verification script ran the accessibility harness (six headless browsers) and full lint in parallel on a 12-thread laptop while another lane was linting. Load reached 317.
    - _Rule:_ heavy gates (the browser harness, full lint, the full suite) each take a per-machine slot sized from measured cores and memory, whether the orchestrator or a lane starts them. Lanes never run heavy gates in parallel themselves. Section 3's "one full gate per device at a time" binds lane scripts too.
    - _Control:_ M107 governor slots; M96c dispatch routes lane-started gates through them; G57.
26. **Re-read what the hook left behind.**
    - _What happened:_ a pre-commit hook's lint auto-fix silently rewrote a correctness fix, twice. An auto-fixable type-aware rule reverted `!== true` on a value of unknown type.
    - _Rule:_ after every hook run, the lane re-reads its own staged diff. Hook auto-fix is limited to formatting; for anything else the hook fails instead of rewriting logic.
    - _Control:_ M96c lane runner (staged diff re-read after hooks); the repository's hook configuration; G58.
27. **Lanes never stash.**
    - _What happened:_ a lane ran `git stash` and `git stash pop` in its worktree. Stashes are shared by every worktree of a repository, so the pop applied another lane's lint-staged backup into it.
    - _Rule:_ lanes never stash. Lint-staged backups are dropped or namespaced per worktree, and the lane runner refuses a stash command.
    - _Control:_ M96c lane runner stash refusal; G59.

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
