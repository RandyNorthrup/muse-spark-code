# RLF-HARVEST: real-use defects from ten days of lanes through our own app

Base `int/recovery` b781451b94. Evidence: `~/lanes/_harvest/<machine>/<LANE>.app*/`
(read-only), 172 lane directories: linuxlt 60, macmini 71, macbook 25, thispc 16.
Of these, 139 carry `summary.json`, 141 `turns.jsonl`, 139 `final.md`; every
directory carries `agent.stderr.log`, `driver.out` and `permissions.jsonl`
(92,998 permission rows in total). Lane agent versions:
`muse-spark-code-acp` 0.18.2 in 30 lanes (all 2026-10-20), 0.19.0 in 142.
Muse Code served 1.4.7 (linux/macOS, pinned `1.4.7-R6101.1`) and 1.4.11
(Windows, `1.4.11-R6667.1`). Every claim below names the machine, lane, file and
count it came from, and whether int b781451b94 still has it, read from the code.

Healthy at scale, first: 104 of 139 summarised lanes end `done`; effort asked
equals effort set in 139 of 139 (`effortSet`); every one of the 136 summaries with
`providerModels` names only `muse-spark-1.3-contributor`, the model the lane was
allowed (0 tier violations). `session/new` succeeded at the first step in all 139
summaries (no `ok: false` step anywhere). No stack trace, unhandled rejection,
`EPIPE`/`ECONNRESET` or registry error appears in any `agent.stderr.log` (4,803
stderr lines, 57 distinct shapes). Muse connect time is a median 478 ms
(worst 4,455 ms, thispc RLF-A11Y). No usage-recording warning appears in any
stderr or driver output.

## Our app's defects (H)

| ID  | Sev | Defect                                                                                                                                 | Evidence                                                                                                                                                                                                                                                                  | On int b781451b94                                                                                                                                                                                                                                        |
| --- | --- | -------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| H1  | P2  | Approval decisions fail `internal (MSP error -32603)`; 442 end as `DecisionNotAppliedError` in the ACP session.                        | 1,180 `stage N decision failed` + 1,017 internal warns in 13 lanes. Worst: thispc RLM95C stage-fail 698/DNA 363 (241 distinct approvals, stages 0–7), macbook RLM96D.app 301/31, thispc RLINTFIX 131/17, linuxlt RLM125.app 27/25. Every affected lane still ends `done`. | Still present: no post-2026-10-20 commit touches `isStillWaiting`/`DecisionNotAppliedError` (`git log -S`, this lane). Split with U1; brief B1.                                                                                                          |
| H2  | P2  | "The session's version-control branch changed. (branch)" repeats while the branch never moves.                                         | 56 finals carry it 1–4 times (linuxlt RLM125.app ×4, same branch consecutively); captured fixture `note-session-branchChanged-1.4.9.json` itself holds the same branch at sequences 4 and 12.                                                                             | **Fixed here** (aeb09c603): once per branch per session.                                                                                                                                                                                                 |
| H3  | P3  | "The turn finished its visible work; background checks are still running." calls every blocker a check and lands after the final text. | 99 occurrences in 83 finals, several literally after `LANE DONE` (thispc RLWINFIX, linuxlt RLM125.app). The recorded 1.4.9 frame's only blocker is `goal-reminder`, no check at all.                                                                                      | **Naming fixed here** (aeb09c603): the notice names `blockingAgents`. Its position after the last words in notice-less ACP clients was already softened on int by its own message id (5d2fed48b); the event itself fires once per foreground completion. |
| H4  | P3  | Every start warns `MSP schema fingerprint mismatch`.                                                                                   | 171 of 172 stderr logs (the exception is the one Model API lane, thispc RLPLAN). Served `6de32db0…` on muse 1.4.7 (156 lanes) and `f282ad16…` on 1.4.11 (15), neither the 0.19.0 pin.                                                                                     | Partly on int: SDK 1.4.11's pin now matches 1.4.11 hosts; a 1.4.7 host still warned. **Fixed here** (aeb09c603): `1.4.7-R6101.1` added to `MSP_KNOWN_SCHEMA_FINGERPRINTS` from a live capture (below).                                                   |
| H5  | P2  | (0.18.2) The ACP agent re-asked the editor about the same command, stage after stage.                                                  | 0.18.2 lanes: median 3.13 permission requests per tool call, 80.9% consecutive-duplicate titles (28,584 of 35,352).                                                                                                                                                       | **Fixed before int, proven by this harvest**: 0.19.0 lanes measure median 0.68 per tool call and 0.3% duplicates (150 of 57,646) — the F16 commits dd0231fa0/c71b7d378, still in int (`src/acp/permissionAsk.ts`).                                       |
| H6  | P3  | ACP warns "Muse Code now runs approval mode promptUnmatched" once per session and never tells the editor the running mode.             | 141 lanes. `promptUnmatched` is exactly what `acceptEdits`/`manual` select (`src/shared/permissionModes.ts:97` map), so the warning fires on the expected echo of the driver's own `set_mode`.                                                                            | Still present: `src/acp/agent.ts` `approvalModeChanged` case logs `warn` and sends no `current_mode_update`; the VS Code webview does update its mode (`src/webview/state/uiState.ts:2439`). Brief B2.                                                   |
| H7  | P3  | `task/stopAll before releasing session … failed: Error` at session release; the cause is logged in a shape that says nothing.          | 70 lanes (47 of them 0.19.0), always the last stderr lines. `causeForLog` reduces it to the bare word `Error`.                                                                                                                                                            | Still present by construction: `MuseSession.dispose` (MuseCodeHost.ts:2908) fires `stopAllTasks` unawaited beside `finishDispose`. Whether a person's background tasks survive closing one conversation is UNMEASURED. Brief B3.                         |
| H8  | P3  | "This reading is unavailable on this machine." warns without naming the reading or the cause.                                          | 19 lines in 14 lanes (linuxlt 6, thispc 6, macmini 2), all 0.19.0.                                                                                                                                                                                                        | Not found on int: the ACP-reachable reporter (`src/runtime/resources/text.ts:255`) prefixes `${reading}:`; which 0.19.0 site printed the bare sentence was not identified. Cover in B3's log audit.                                                      |
| H9  | P3  | macOS credential file always reads `unrecognized`, so sign-in state falls back to asking the CLI on every start.                       | All 96 macOS lanes log `credential file unrecognized`; all 75 linux/Windows lanes log `inline`. Lanes ran fine (contributor requests flowed).                                                                                                                             | Still present by design, pending capture: `credentialFileVerdict` (credentialFile.ts:155–157) refuses the macOS v1-inline shape as never captured. Brief B4.                                                                                             |
| H10 | P3  | `session/started` is "not shown by this extension" on every surface; permanent session delete is unsupported.                          | 171 stderr logs carry the once-per-host info line. A recorded frame exists (`note-session-started-1.4.9.json`).                                                                                                                                                           | Still present: no `MuseCodeLifecycleReader` implementation exists in `src/` (grep `parseDeleteAdmission`: only the interface and its call), so `deleteSession` throws `sessionDeleteUnsupported`. Brief B5.                                              |
| H11 | P2  | Bleeding-edge gap: the SDK pin is behind the latest release.                                                                           | `npm view @muse-code/sdk version` reads **1.4.14** (2026-10-30, this lane); the repo pins 1.4.11 (`package.json:2059`).                                                                                                                                                   | Still present. Brief B6 (owner's standing bleeding-edge rule).                                                                                                                                                                                           |

Answers to the brief's named probes where nothing was wrong:

- **Store faults**: zero. `storeFaults` equals the resumed-error count in
  `turns.jsonl` for 138 of 139 summaries (the exception is a `running` lane
  snapshotted mid-flight, macmini RLF-TEAMCORE.app.round1, 7 vs 11). No
  `store-unavailable` text occurs in any stderr; every `session/new` step is
  `ok`. What the counter counted is D1 below.
- **Windows no-session registry race (RLWINFIX2)**: no `no-session` outcome in
  any summary; RLWINFIX2 itself is merged in int (9580e1f11, "concurrent
  registry sharing, honest usage records"). Its harvest logs show a normal
  `session/new`.
- **Usage recording**: no warning anywhere; the ACP runtime installs
  `MuseCodeHost.usageRecording` (`src/runtime/runtimeEngineEntry.ts:25`), and
  RLUSAGE/RLWINFIX2's honest-record fixes are in int.
- **Turn failure words**: on 0.19.0 the ACP error was Muse's raw
  `Internal error: …`. On int a CLI-judged-retryable failure is our sentence
  with `retryable: true` ([src/shared/turnFailure.ts](../../src/shared/turnFailure.ts),
  `src/acp/agent.ts:413`), and the panel offers Retry (fed23ec3f, 8dd92e44f).
- **Hung turns**: the longest turn is 75,023 s ending `end_turn` (linuxlt
  RLM125.app, a working lane). No turn was cut by a cap of ours; the 70,062 s
  macmini RLM103.app.round2 turn ended in U2's transport timeout.

## Fixed here (aeb09c603) and drills

Three small fixes, each with a real-code test in
[test/unit/museCodeLatest.test.ts](../../test/unit/museCodeLatest.test.ts):

1. H2 — `BranchObservationFilter` + `branchObservationOf`
   ([mapNotification.ts](../../src/core/backends/musecode/mapNotification.ts)),
   wired into `MuseCodeHost.deliver` with `forget` beside `sessions.delete`.
   The test drives both recorded 1.4.9 frames through the filter (one shows),
   then a different branch, detached `null`, a second session, and `forget`.
2. H3 — the foreground-completed notice appends the wire's blocking agents;
   the recorded frame now reads `…background checks are still running. (goal-reminder)`.
3. H4 — `MSP_KNOWN_SCHEMA_FINGERPRINTS` gains `6de32db0…` → `1.4.7-R6101.1`.
   Captured live 2026-10-30, no model call: the pinned binary's
   `schema generate-json-schema` manifest and an echo-provider `initialize`
   (`temp/capture147/capture.mjs`) both serve it;
   [initialize-1.4.7.json](../../test/fixtures/m127/initialize-1.4.7.json)
   is that result, recorded under `harvest147` in
   [provenance.json](../../test/fixtures/m127/provenance.json).

Drills (repository timeouts throughout):

- Before the fixes: `npx vitest run test/unit/museCodeLatest.test.ts --maxWorkers=3`
  → exit 1, 2 failed (branch-once, blockers-named), 53 passed; earlier the
  fingerprint test alone → 1 failed, 53 passed.
- After: the same file plus `test/unit/mapNotification.test.ts` → exit 0,
  103 passed.
- Break-on-purpose: the map entry commented out (`drill-removed`) and
  `shouldShow`'s repeat branch disabled (`false &&`) → exit 1, exactly the
  fingerprint and branch-once tests fail; both edits reverted before commit.

A person reaches the fixes by: running a Muse Code conversation and
switching git branches (one notice per move), letting a turn finish while a
background agent still runs (the notice names it), and starting the app
against Muse Code 1.4.7 (an info line naming its known schema instead of a
mismatch warning).

## Lane briefs for the larger defects

### B1 — Approval decisions that fail `internal` while the approval advances (H1/U1)

- **Platform**: linuxlt + macbook + thispc (evidence on all three; muse 1.4.7
  and 1.4.11 both).
- **Base**: `int/recovery` as the lead sets it.
- **Build**: capture the failing exchange live (counted model attempts,
  cheapest contributor model by explicit name, empty workspace): one
  multi-stage approval (compound shell command) whose `approval/decide` answers
  `-32603`, with `approval/listPending` before and after. Then fix our side to
  what the capture proves: if the stage has advanced despite the error, treat
  that worded condition as applied (extend the named `MuseCodeFaultError`
  path in `MuseCodeHost.decisionFailed`, never blanket-swallow `-32603`); if
  `listPending` races the apply, re-check on the host's own stage event before
  unmarking a decision. File the upstream report (U1) with the capture either
  way.
- **Proof**: the capture fixture under `test/fixtures/` with provenance; a
  real-code suite over it; a packed-product conversation whose log shows the
  same multi-stage command with zero `DecisionNotAppliedError`; the harvest
  counts above re-measured on one fresh lane.

### B2 — ACP editors never hear the mode Muse Code actually runs (H6)

- **Platform**: linuxlt (ACP), any editor.
- **Base**: `int/recovery` as the lead sets it.
- **Build**: when `approvalModeChanged` arrives, map the wire word through
  `composerModeForApprovalMode` (`src/shared/permissionModes.ts:153`): if it
  is the mode the client set (the `promptUnmatched` echo), log once at info;
  if the CLI moved (ceiling, managed policy), send `current_mode_update` (and
  refresh config options) so the editor shows the truth, and keep the warn.
  VS Code behaviour is the reference (`uiState.ts:2439`).
- **Proof**: packed ACP agent against a scripted editor transcript is not
  enough — run the real agent in Zed or the driver with notice capture:
  `set_mode acceptEdits` produces no warning; a managed-policy ceiling (or a
  mode the CLI refuses) produces one `current_mode_update` naming the running
  mode. Real-code suites for the mapping branches.

### B3 — Shutdown honesty: what `stopAll` and a lost update actually did (H7/H8)

- **Platform**: linuxlt (ACP) and a VS Code window.
- **Base**: `int/recovery` as the lead sets it.
- **Build**: first measure, in the packed product, whether closing one Muse
  Code conversation stops its background tasks while the host stays up for
  another. Then make release orderly: `stopAllTasks` settles (or is
  knowingly abandoned because the host itself is closing, said in one info
  line) before `finishDispose`; the failure log carries the failure kind
  (`failureForLog`), never bare `Error`; the ACP `an update was not sent`
  warn (5 lanes) names its cause kind the same way. In the same pass, find
  which site printed the bare resource sentence (H8) and make it name the
  reading and the cause.
- **Proof**: the packed-product drill recorded both ways (task stopped / task
  survived) before the change; after, a session end with a running background
  task shows the task stopped and no bare-`Error` warn; `npm run check:catches`
  shows no count rise.

### B4 — macOS credential-file captures (H9)

- **Platform**: macmini (never the owner's MacBook stores).
- **Base**: `int/recovery` as the lead sets it.
- **Build**: in isolated homes on the pinned CLI builds, capture the three
  macOS shapes the parser cannot place — v1 inline (`muse auth set`), browser
  sign-in, and an empty v2 file — recording `muse serve`'s start verdict and
  `account/read` per shape, structure only (D26: never a value). Teach
  `credentialFileVerdict` exactly what the captures prove, nothing more.
- **Proof**: fixtures of file structure with capture date, CLI build and
  command; parser suites over them on darwin/linux/windows verdicts; a macOS
  start whose log line names the real lane instead of `unrecognized`.

### B5 — The session lifecycle reader: `session/started`, delete (H10)

- **Platform**: linuxlt (echo captures) + one Windows confirmation.
- **Base**: `int/recovery` as the lead sets it.
- **Build**: implement `MuseCodeLifecycleReader` from the recorded frames
  (`note-session-started-1.4.9.json` exists; capture `session/deleteCompleted`
  and the delete admission receipt from the echo host), supply it from both
  the VS Code manager and the ACP runtime, and surface externally started
  sessions in the session list. Delete stays behind the caller's existing
  permanent-deletion confirmation.
- **Proof**: suites over the captures; packed product: start a second client
  on the same host and watch the session appear without a reload; delete a
  scratch session end to end.

### B6 — Muse SDK 1.4.14 and the current CLI, incorporated and tested (H11)

- **Platform**: linuxlt, then host lanes.
- **Base**: `int/recovery` as the lead sets it.
- **Build**: diff the SDK/CLI surface 1.4.11 → latest (schema fingerprint,
  `msp.d.ts`, release notes per intermediate version), re-pin deliberately
  (peer ranges, `npm audit`, reason in PLAN.md), capture the changed wire
  shapes from the new build over the echo provider, and admit its fingerprint
  from that capture. Anything the new schema adds is shown as served (D36),
  never dropped.
- **Proof**: new captures with provenance; the full local gate set; one real
  conversation through the packed VSIX and the ACP agent on the new build.

## Upstream reports (Muse Code CLI / service) (U)

| ID  | Report                                                                                                                                                                                                                                                       | Evidence                                                                                                                                 |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| U1  | `approval/decide` answers `-32603 internal` for stages that then advance; clients cannot tell applied from refused.                                                                                                                                          | 1,180 stage failures in 13 lanes on muse 1.4.7 and 1.4.11 (H1 table); stages 0–7 per approval, all lanes completed anyway.               |
| U2  | Transport drops mid-turn: `net-timeout … (meta stream)` 62 resumed events (6 lanes end `turn-failed` on it, incl. a 70,062 s turn), "network connection could not be opened within 15 seconds" 25, 503 ×3.                                                   | `turns.jsonl` resumed events across all four machines, clustered 2026-10-22 04:29–05:xx on macmini (RLM95/96C/103/110A0 round-1 lanes).  |
| U3  | Subscription quota window exhausted 2026-10-24 00:xx–reset 2026-10-26T00:00:00Z: 325 resumed events, 20 lanes end `turn-failed` after 16 driver waits. Not a defect; the biggest single cause of lost lane time, kept here so nobody reads it as an app bug. | `summary.json` stopReasons + `turns.jsonl`, all four machines, request ids in the raw lines.                                             |
| U4  | Some attempts go out as `muse-spark-1.3` (no contributor suffix) under `--contributor-mode on` and are refused "does not exist or you lack access".                                                                                                          | 10 resumed events in 8 lanes (RLF-JUDGEFIX, RLM110B, RLM125, RLF-HOSTS2, RLM109, RLM110A0, RLF-HYGIENE, RLINTFIX); every lane recovered. |
| U5  | `session/branchChanged` re-observes the unchanged branch (event name says "changed").                                                                                                                                                                        | `note-session-branchChanged-1.4.9.json`, same branch at sequences 4 and 12. Our side filters repeats now (H2); the wording is the CLI's. |

## Driver and sandbox list, for the lead (D)

| ID  | Item                                                                                                                                                                                                                                                                                                                                                                                                               |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| D1  | `summary.storeFaults` does not count store faults: `app-lane-driver.mjs:305` increments it on **every** turn-error resume (its `session/new` store loop at :222 is the only true store count, never observed above 0 in isolation: the two are indistinguishable in 49 "fault" lanes). Split the counter into `storeFaults` (session/new only) and `turnResumes`, and record the resumed error kind once per lane. |
| D2  | 33 lane directories have no `summary.json`/`final.md`/`turns.jsonl` although their agents were mid-work (up to 524 permission rows): the driver writes the summary only at finish or after a completed turn, so a lane stopped from outside leaves nothing harvestable. Write the `running` summary at session start. (macmini RLF-MACLIVE.app was simply live at harvest time, started 2026-10-30.)               |
| D3  | The driver's `finish` ends stdin, waits 1,500 ms and `child.kill()`s: 47 lanes log `Muse Code was stopped by SIGKILL` and 70 `The museCode backend stopped`, and shutdown races (H7) are drowned in them. Wait for the agent's exit (bounded, industry grace) before the kill so clean exits read clean.                                                                                                           |
| D4  | The driver declares no ACP notice support, so backend notices fall back into agent-message text and pollute `final.md` (that is how H2/H3 presented). Support `notice` updates in the driver, or record them under their own kind, so `final.md` stays the model's words.                                                                                                                                          |
| D5  | Driver permission policy denied 28 of 92,998 requests, all by its written rules; the `credential store` ones (13) also refuse read-only probes such as `command -v dbus-run-session` in vault lanes, which the lanes then route around. Decide whether probing for a tool's presence should pass.                                                                                                                  |
| D6  | 2 summaries are `running` and 7 lanes end `blocked` on their own work (INTEGFIX, PLANFIX0190, MACVAULTFLOW, RLF-M104G, RLM109, VAULTKILL, RLPLAN): nothing in their stderr blames the app; they are lane outcomes, not app defects.                                                                                                                                                                                |

## Method and limits

Counts were computed by script over the whole harvest (verbatim patterns and
per-lane joins of `summary.json`, `turns.jsonl`, `permissions.jsonl`,
`agent.stderr.log`, `final.md`; scratch output under this lane's ignored
`temp/harvest/`, not committed). "Still on int" was decided by reading the
code at b781451b94 and the commits since 2026-10-20, not from lane prose. The
1.4.7 capture made no model call and no sign-in (`--provider echo`,
`--no-session-log`, scratch homes). Nothing here claims a behaviour no line,
test or capture above shows: H7's person-facing half and H8's emitter are
marked UNMEASURED/not identified rather than guessed.
