# CLI recovery: a slow, wedged or damaged Muse Code (PLAN.md D25, D26)

Recorded 2026-10-03, on branch `fix/cli-recovery` from main `d182b180`, code
commit `0caa276f`. It covers what the owner hit on 2026-10-02/03 with Muse
Code 1.4.2-R4684.1 on Windows (session `01a0fcee-f38b-71c1-b108-f8de2a2ac65b`):

- a steer that missed its deadline, sent again as a second turn;
- a session whose event log failed every message after;
- a `muse serve` that stopped answering anything, with no way out but a
  window reload;
- eight effort changes and 26 stored-output reads sent at once to it.

## Evidence

No `muse` command was run, no model was called and no credential file was
opened by this lane.

- **The investigator's report** (session scratchpad
  `harness-wedge-report.md`): the timeline from the CLI trace and the
  session's durable log, and the extension's part, by file and line.
- **The extension log** (window1 exthost `Muse Spark.log`), read for the
  wire text the extension saw:
  - line 362, 00:23:08: "turn/steer failed (Muse Code did not answer
    turn/steer within 60 s); submitting as a new turn";
  - line 544, 10:02:30: the turn failed with "event log failed: Origin read
    requires valid checkpoint-suffix or origin-preserved full-replay
    authority";
  - lines 545-546, 10:02:53 and 10:04:47: "turn/start runtime submit
    failed: event log failed: event id 5e12efd9-… conflicts with an existing
    event".

  These are the fixtures of `test/unit/helpers/cliRecoveryCapture.ts`.
  Their MSP kind was not logged; the fixture uses `internal` (-32603), as
  Muse Code answers its replay fault in the same "turn/start runtime submit
  failed: …" words.

- **The 1.4.2 binary's strings**, read with `grep -a` (not run):
  - `turn/steer`'s own schema text: "an id that is not the running turn is
    refused";
  - the CLI's `CommandRejectionReason` vocabulary: `already_terminal`,
    `command_id_conflict`, `invalid_target`, `missing_run`, `run_active`,
    `runtime_busy`, … `missing_goal`, `invalid_goal_state`;
  - `event log failed: ` and `retained event log failed: `.

  Which of those reasons a steer refusal carries was not captured (no model
  call was authorized). The extension takes `invalid_target`, `missing_run`
  and `already_terminal` as "no turn took it"; the question is in PLAN.md §3.

## What changed

| Item                          | Where                                                                                                                                                                                                      | What                                                                                                                                                                                                                                                                                                                                                                                             |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1. Steer never sent twice     | `MuseCodeHost.ts` `steer` / `steerFailure`; `conversationController.ts` `submit`; `agentBackend.ts` `SteerRefusedError`; `ModelApiHost.ts` `steer`                                                         | Only a `commandRejected` with a reason in `MSP_STEER_NO_TURN_REASONS` is a `SteerRefusedError`, and only that sends the message as a new turn. A deadline or a closed connection fails the send with `steerUnconfirmed` (the existing `sendFailed` path, draft kept); any other refusal keeps its own words. The Model API's refusals are all `SteerRefusedError`, so its fallback is unchanged. |
| 2. Unresponsive-host watchdog | `MuseCodeHost.ts` `HostLiveness`, `answered`, `requestWithin`, `onUnresponsive`; `museCodeBackendManager.ts` `hostUnresponsive`; `extension.ts` `unresponsive` deps; controller `museCodeStoppedAnswering` | Every answer, event and server request is heard. Three missed deadlines in a row with 90 s heard of nothing: one warning, one event, new commands fail at once with `museCodeNotAnswering`. No turn running in the window: Muse Code alone restarts and each panel on it says `museCodeRestartedUnresponsive`. A turn running: its panel's notice offers Restart now (D26's action).             |
| 3. Restart command            | `package.json`, `package.nls*.json`, `COMMAND_IDS.restartMuseCode`, `extension.ts` `restartMuseCode`                                                                                                       | **Muse Spark: Restart Muse Code**, the same restart as a notice's Restart now: Muse Code alone stops, a fresh host starts (`warmUp`), each conversation resumes with its next message. The palette's VS Code message `museCodeRestarted` is the one native message: the command may run with no panel open.                                                                                      |
| 4. Damaged session log        | controller `markDamaged`, `damagedTarget`, `refuseDamaged`, `sessionForAction`, `resumeAfterRestart`, `restoreRecentSession`, `restoreSession`, `attach`; `MuseCodeHost.ts` `noteLogFault`, `onLogDamaged` | A failed turn whose reason, or a session command whose MSP error, holds `MUSE_EVENT_LOG_FAULT` marks the session (workspace state `museSpark.damagedSessions`, the newest 50). It is never resumed by itself; a message or action for it is refused before any command, its card saying `sessionLogDamaged`, and a notice offering New conversation. `turn/unqueue` is not used.                 |
| 5. Effort coalesced           | controller `applyEffort`, `syncEffort`, `updateEffort`                                                                                                                                                     | One `session/setReasoningEffort` in flight per session; the newest value waits and goes when the first settles if it differs; one warning per burst; on failure the composer shows what the session kept.                                                                                                                                                                                        |
| 6. Bounded reads              | `src/core/fifoLimiter.ts`; controller `readOutputSlot` (used by `readOutputPage` and `fetchPatch`)                                                                                                         | At most `MSP_READ_OUTPUT_CONCURRENCY` (4) `item/readOutput` per conversation, in order; a read whose conversation is no longer shown when its turn comes is never sent and fails as a stale read (nothing shown).                                                                                                                                                                                |

The lead moved the watchdog's and the damaged session's messages from VS
Code warnings to the panel's D26 notices with actions, so they sit in the
chat; the idle restart's message and the steer's are plain.

The ACP agent shares the manager but has no window: it passes no
`unresponsive` answer, so there commands fail at once while Muse Code
answers nothing, and the log says why.

## Tests

Focused runs on the rigs (`rig-test.sh <rig> … clilive`, which snapshots
the worktree); nothing ran the full suite. Static gates ran on the host.

| Run                                                                                                                                                                           | Result                                                        |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| Win11: `MuseCodeHost`, `conversationController`, `museCodeBackendManager`, `modelApiHost`, `manifest`, `hostL10n`, `accountHost` (snapshot `9b81870a`, before the lint fixes) | 7 files, 924 passed                                           |
| Win11: the same seven files on the tree committed as `0caa276f`                                                                                                               | 7 files, 924 passed                                           |
| Win11: `MuseCodeHost.test.ts` with the server-request test added (snapshot `5e612b53`), the drills' baseline                                                                  | 87 passed                                                     |
| Win11, final tree: the seven files and `test/e2e/museCode.e2e.test.ts` (the fake CLI; snapshot `63a652b7`)                                                                    | 8 files, 940 passed                                           |
| Mac mini, final tree: `test/e2e/museCode.e2e.test.ts`, `MuseCodeHost`, `museCodeBackendManager` (snapshot `e5071c49`)                                                         | 3 files, 118 passed                                           |
| `tsc -p .`, `tsc -p test/unit`, `tsc -p test/e2e`                                                                                                                             | exit 0                                                        |
| ESLint `--max-warnings=0` on the 17 changed TS/MJS files; Prettier `--check` on every changed file                                                                            | exit 0                                                        |
| `check-l10n`                                                                                                                                                                  | 14 tables, 107 manifest strings, 350 source files, 0 problems |
| `check-host-api` (`--write` once: 28 commands)                                                                                                                                | 0 problems                                                    |
| `knip`, `dpdm` cycles, `jscpd`                                                                                                                                                | exit 0, no cycle, 0 clones                                    |

New tests, by item:

- **1:** host: the three no-turn reasons are a `SteerRefusedError`; no
  answer says it may still arrive; another reason keeps its words.
  Controller: a timed-out steer sends no `turn/start`, fails `l2` with
  `steerUnconfirmed`, draft kept; each no-turn reason sends a new turn; any
  other refusal sends nothing more. Model API: a steer for no running turn
  and one over the text allowance are `SteerRefusedError`. The existing
  fallback tests now refuse with a real reason (`invalid_target`).
- **2:** host: three misses with nothing heard stop sending, said once,
  until an event; misses within the silence do not; an answer (a late one
  included) and a server request start the count again. Manager (the real
  handshake against the fake CLI with `MUSE_FAKE_WEDGE=model/list`): no
  turn running restarts at once, then says so; a turn running offers the
  restart once and restarts nothing by itself. Controller: the offer only
  where a turn runs, its Restart reaches the host action, the plain notice
  after a restart.
- **4:** the turn trigger and the command trigger (the captured texts),
  the refusal before any request with its card and notice, New
  conversation taking messages again, the newest-50 bound, no resume after
  a restart (a message, and a `!` command, which opens the session without
  a message's check), no reopen of a damaged last session.
- **5:** eight quick steps send two requests, `low` then `medium`, and the
  composer ends on `medium`; a failed burst warns once and shows `high`.
- **6:** ten reads send four, in order; the fifth goes when one is
  answered; after a new conversation the five still waiting are never sent
  and nothing is said.

## Red drills

Each guard was broken once in the worktree, its owning test file ran on the
Win11 rig, the original bytes were written back and their SHA-256 checked
(scratchpad `cli-recovery/drills.mjs`, `drills.jsonl`). Every mutation
matched exactly once.

| #   | Guard broken                                                           | File                                                                                | Test file                        | Exit | Tests                                    | Restored |
| --- | ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------- | -------------------------------- | ---- | ---------------------------------------- | -------- |
| 1   | controller: only a steer refused with nothing taken goes as a new turn | `host/conversation/conversationController.ts`                                       | `conversationController.test.ts` | 1    | 2 failed / 361 passed (363)              | yes      |
| 2   | host: a no-turn commandRejected reason is a SteerRefusedError          | `core/backends/musecode/MuseCodeHost.ts`                                            | `MuseCodeHost.test.ts`           | 1    | 4 failed / 83 passed (87)                | yes      |
| 3   | host: a steer with no answer says it may still arrive                  | `core/backends/musecode/MuseCodeHost.ts`                                            | `MuseCodeHost.test.ts`           | 1    | 1 failed / 86 passed (87)                | yes      |
| 4   | watchdog: three misses in a row                                        | `core/backends/musecode/MuseCodeHost.ts`                                            | `MuseCodeHost.test.ts`           | 1    | 3 failed / 84 passed (87)                | yes      |
| 5   | watchdog: and the silence                                              | `core/backends/musecode/MuseCodeHost.ts`                                            | `MuseCodeHost.test.ts`           | 1    | 1 failed / 86 passed (87)                | yes      |
| 6   | watchdog: any frame starts the count again                             | `core/backends/musecode/MuseCodeHost.ts`                                            | `MuseCodeHost.test.ts`           | 1    | 1 failed / 86 passed (87)                | yes      |
| 7   | watchdog: new commands fail at once                                    | `core/backends/musecode/MuseCodeHost.ts`                                            | `MuseCodeHost.test.ts`           | 1    | 2 failed / 85 passed (87)                | yes      |
| 8   | watchdog: an answer (a late one included) is heard                     | `core/backends/musecode/MuseCodeHost.ts`                                            | `MuseCodeHost.test.ts`           | 1    | 1 failed / 86 passed (87)                | yes      |
| 9   | watchdog: an event is heard                                            | `core/backends/musecode/MuseCodeHost.ts`                                            | `MuseCodeHost.test.ts`           | 1    | 1 failed / 86 passed (87)                | yes      |
| 10  | watchdog: a server request is heard                                    | `core/backends/musecode/MuseCodeHost.ts`                                            | `MuseCodeHost.test.ts`           | 1    | 1 failed / 86 passed (87)                | yes      |
| 11  | manager: restart at once with no turn, offer while one runs            | `host/backend/museCodeBackendManager.ts`                                            | `museCodeBackendManager.test.ts` | 1    | 2 failed / 14 passed (16)                | yes      |
| 12  | fake CLI: the wedge answers nothing                                    | `test/e2e/fake-muse/serve.mjs`                                                      | `museCodeBackendManager.test.ts` | 1    | 2 failed / 14 passed (16)                | yes      |
| 13  | controller: the restart is offered only where a turn runs              | `host/conversation/conversationController.ts`                                       | `conversationController.test.ts` | 1    | 1 failed / 362 passed (363)              | yes      |
| 14  | controller: a turn failed on its event log marks the session           | `host/conversation/conversationController.ts`                                       | `conversationController.test.ts` | 1    | 6 failed / 357 passed (363)              | yes      |
| 15  | host: a command failed on its event log tells the conversation         | `core/backends/musecode/MuseCodeHost.ts`                                            | `MuseCodeHost.test.ts`           | 1    | 1 failed / 86 passed (87)                | yes      |
| 16  | controller: a damaged session is refused before any command            | `host/conversation/conversationController.ts`                                       | `conversationController.test.ts` | 1    | 2 failed / 361 passed (363)              | yes      |
| 17  | controller: a damaged session is never resumed after a restart         | `host/conversation/conversationController.ts`                                       | `conversationController.test.ts` | 1    | 1 failed / 362 passed (363)              | yes      |
| 18  | controller: a damaged last session is not reopened                     | `host/conversation/conversationController.ts`                                       | `conversationController.test.ts` | 1    | 1 failed / 362 passed (363)              | yes      |
| 19  | controller: the damaged list keeps the newest 50                       | `host/conversation/conversationController.ts`                                       | `conversationController.test.ts` | 1    | 1 failed / 362 passed (363)              | yes      |
| 20  | controller: an effort change joins the one in flight                   | `host/conversation/conversationController.ts`                                       | `conversationController.test.ts` | 1    | 2 failed / 361 passed (363)              | yes      |
| 21  | controller: the newest effort goes when the first settles              | `host/conversation/conversationController.ts`                                       | `conversationController.test.ts` | 1    | 2 failed / 361 passed (363)              | yes      |
| 22  | controller: one effort warning per burst                               | `host/conversation/conversationController.ts`                                       | `conversationController.test.ts` | 1    | 1 failed / 362 passed (363)              | yes      |
| 23  | controller: at most four stored-output reads at once                   | `host/conversation/conversationController.ts`                                       | `conversationController.test.ts` | 1    | 1 failed / 362 passed (363)              | yes      |
| 24  | limiter: a read no longer wanted is never sent                         | `core/fifoLimiter.ts`                                                               | `conversationController.test.ts` | 1    | 1 failed / 362 passed (363)              | yes      |
| 25  | limiter: reads go in arrival order                                     | `core/fifoLimiter.ts`                                                               | `conversationController.test.ts` | 1    | 1 failed / 362 passed (363)              | yes      |
| 26  | Model API: a steer for no running turn is refused with nothing taken   | `core/backends/modelapi/ModelApiHost.ts`                                            | `modelApiHost.test.ts`           | 1    | 1 failed / 412 passed (413)              | yes      |
| 27  | lint: `instanceof SteerRefusedError` in src is refused                 | `eslint.config.mjs` (a line added to `host/conversation/conversationController.ts`) | ESLint on that file              | 1    | `no-restricted-syntax` at the added line | yes      |

Each failed test was read in `drills.jsonl`, with the snapshot each drill
ran on. Drill 14 (any failed turn taken as an event-log fault) failed three
CLI-recovery tests and also three handoff tests, whose turns end failed for
other reasons and were then marked damaged. Drill 26 broke the not-running
refusal only; the text-allowance refusal is another line, pinned by its own
test. Every restored file matched its SHA-256 from before the drill.

## Not done here

- No live check: no model call was authorized for this lane, so the steer
  refusal's reason stays the open question of PLAN.md §3, and the watchdog
  was drilled against the fake CLI's wedge, not a wedged Muse Code.
- **Muse Spark: Restart Muse Code** was not run in VS Code by this lane.
  The integration suite checks that every `COMMAND_IDS` entry is
  registered; it was not run here.
- Full `npm run quality`, the accessibility gate and publication remain the
  lead's work.
