# Playbook chapter: placement, load balancing and moving work

> Note: the shipped orchestrator playbook skill (M116) will adopt this
> chapter in M116's follow-up. Until then it lives here as the recorded
> source of truth.

Source: the lead's experience on 2026-10-06, running up to 37 agent lanes on six machines (Kubuntu VM, Mac mini, Windows 11 VM, MacBook Pro, Linux laptop, the owner's PC as orchestrator only), with three agent engines (Codex at high reasoning, Muse 1.3 contributor, Grok for reviews). Owner directive: "all of the knowing when to move stuff around and load balancing what leg of a project is on which device ... including load balancing based on an agents speed" goes into the playbook in a meaningful way.

Each rule below is written so the orchestrator can apply it, and the scheduler (M96c), the estimator (M117), the governor (M107) and the playbook policy (M116) can check it.

## 1. Every leg has a profile before it is placed

For each lane (a "leg" of the project), record:

- **Needs.** The capabilities it cannot run without:
  - an OS (Windows-native, macOS, Linux);
  - hardware (Touch ID or Secure Enclave, a GPU encoder, a TPM);
  - installed tools (Xcode, Visual Studio, a JetBrains IDE, Chrome for browser and accessibility suites);
  - signed-in services (Codex, the Muse CLI, a provider account);
  - the user physically present (a biometric prompt).
- **Kind.** Build, fix, review, integration, release prep, capture or live check.
- **Weight.** Expected CPU, memory, disk and temp use. A full test suite, the accessibility harness and image builds are heavy; a read-only review is light.
- **Inputs.** The base commit, the brief, and every file the brief names. A worker refuses to start with any of them missing (gotcha G1/G2).
- **Criticality.** On the critical path to a promised release, or not.

## 2. Each device has a live capability and capacity record

- **Capabilities.** Measured, not assumed. Examples: Chrome present or not; codex/muse signed in; Xcode version; Touch ID.
- **Slot cap from measured headroom.**
  - Start conservatively. Raise the cap only while load, swap, disk, temp and transport health stay green.
  - Lower it at once on pressure:
    - load well above the core count;
    - swap nearly full;
    - free disk under its floor;
    - temp space over 70%;
    - an OS indexer ballooning;
    - SSH sessions resetting.
  - Seen on 2026-10-06:
    - Windows sshd reset above about 7 sessions → cap 5;
    - the Mac mini starved at 11 heavy lanes;
    - Kubuntu's tmpfs reached 81% and Chrome crashed.
- **First-run cost.** A fresh device pays a one-time setup cost (toolchain, dependency install, the first push of the repository: about 10 minutes). Amortize it: give a new device several lanes, not one.

## 3. Place by capability first, then by fit, then by speed

1. Filter devices by the leg's needs. Never place a browser suite on a device without a browser, or a Windows-native leg off Windows. A leg whose need no device meets is reported as blocked; it is never run degraded and reported as passing.
2. Keep a leg next to its data. A fix round runs where its worktree lives; moving it means moving the branch first.
3. Spread heavy legs across devices. Never two full test suites on one small machine at once. One full gate per device at a time.
4. Balance by speed and cost (section 4) among the devices that fit.

## 4. Balance by agent speed, quality and budget

Each engine gets a measured profile that the estimator keeps current:

| Engine                 | Observed 2026-10-06                                                      | Best use                                                                                                                          |
| ---------------------- | ------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| Muse 1.3 contributor   | about 20 minutes for a well-scoped lane; cheap (the user's subscription) | well-scoped builds and integrations with clear acceptance; many in parallel                                                       |
| Codex (high reasoning) | 1–3 hours per lane; most thorough; credit-limited                        | reviews, release-critical fixes and integrations, anything with subtle concurrency or security                                    |
| Grok                   | slow and sometimes needs continuation; limited usage                     | the fallback reviewer when the primary reviewer is blocked by a safety classifier (user-approved), and independent second reviews |

Rules:

- **The author's engine never reviews its own lane.** A fast engine's output always gets an independent review before acceptance. Muse codes, and Codex or Grok reviews.
- **Choose by remaining budget, not just speed.** When an engine's budget (credits, weekly limit) would run out before the deadline at the current burn rate:
  - move non-critical new work to engines with budget;
  - keep the scarce engine for critical-path work;
  - never stop in-flight work just to switch.
- **Re-measure.** Each finished lane updates its engine's duration and its first-pass review-finding rate per lane kind. The estimator uses these numbers, so placement improves as the run goes on.
- **Saturate cheap capacity.** When a fast, cheap engine has free slots and independent work exists, start it. Idle capacity is lost time.

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
- **Pause, don't kill, out-of-scope work.** When priorities change (for example "everything except M110/M111 by midnight"), let near-finished legs finish their current run and start no follow-ups. Restart is cheap because the state lives in commits.

## 6. Critical path and ordering

- Order legs by the release they block. A release's integration legs start the moment their inputs are accepted.
- **Start legs from a fresh base.** Lanes built on an old base hide startup-size and behaviour conflicts until integration (G4). Integrations always re-run the full suite and the accessibility harness after merging current main.
- **One integration review per milestone** verifies every lane's fix commits, instead of a separate re-review per lane when time is short. Record the choice and the evidence.
- **Releases slice by readiness, not by the original grouping.** Ship what is integrated and green, in order.
- **CI is the final gate.** Budget about 30 minutes per release run. Re-run the whole workflow, never only failed jobs (G21).

## 7. Watching the fleet

- Watch continuously and event-driven. Report every finished lane in each pass; a failed status check means "unknown since …", never "running" (G5, G7).
- **Alarms:** unreachable, low disk, memory or swap pressure, temp space, and a budget running out early.
- **Status shown to the user:** a few lines. Owner-blocked items first, then shipped, fixing, next. Plus a chart with time estimates per release and a per-milestone breakdown: lanes done, running and remaining, engine, device, ETA.

## What each component implements

| Rule                                              | Component                                                                                                                |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Leg profiles, needs-based placement               | M96c scheduler, with a test that a leg needing a browser never lands on a browserless device                             |
| Device capability and capacity record             | M100 (paired devices) and M110 (nodes) report capabilities; M107 sets slot caps from measured pressure                   |
| Engine speed, quality, budget profiles            | M117 calibration: per engine × lane kind × machine class durations and finding rates, re-fitted after each finished lane |
| Budget-aware engine choice                        | M117 recommendations plus M108 account thresholds; a test that a nearly exhausted engine gets no new non-critical legs   |
| Never duplicate on unreachability                 | D90.25 leases (M110), M100 lanes, M96c; already in the gotcha register (G6)                                              |
| Moving a started leg from its commits             | M96c relocation, with M107's relocation policy                                                                           |
| Integration review covers fixes; slicing releases | M116 playbook skill and reviewer charter                                                                                 |
| Status and ETA chart                              | M117 surfaces (Gantt, bottleneck, setup cards)                                                                           |
