# Approval decisions, Muse Code's approval faults and quiet output reads (PLAN.md D26)

Recorded 2026-10-02 and 2026-10-03. The fix is on branch `fix/approval-decisions` from main
`0e9546e0`, code commit `e24d5d8e`. It covers three bugs the owner hit on
2026-10-02 with 0.10.0 on Windows, on Muse Code 1.4.0-R4302.1 and then
1.4.2-R4684.1:

- duplicate approval answers, then a wedged session;
- the startup deadline;
- tool outputs that waited 60 s and stacked errors.

## Evidence

- **The extension log** (the window's `Muse Spark.log`, read whole).
- **The session's durable log and view journal**
  (`sessions/2026/10/02/01a0fcee…/session.jsonl`, `.msp-view-v1/…/journal`).
  These were read from copies, and no credential file was opened. Their
  `runtime.approval_command_intake.*` records give every decision's
  requirement and outcome. The `approval/*` frames in the journal give
  what the card was shown.
- **A live reproduction at no cost.** It used
  `muse serve --disable-sandbox --provider meta` with a dummy bearer string
  that is not a credential and never left 127.0.0.1:
  - The Meta provider was pointed at a loopback fake of the Responses API
    (`settings.endpoint_transport.base_url`).
  - It ran in an isolated home with only a copied model-catalog cache, and
    an empty temporary workspace.
  - The fake answers a turn's first main-agent request with one
    `powershell` call (`bash` on Linux), later ones with a message, and
    reminder children with `none`.
  - Every model attempt went to the fake and was counted by it (2 to 18
    per run). None reached Meta, and no paid model was used.
  - The scripts and outputs are in the session scratchpad,
    `approval-fix/` (`repro2.mjs`, `repro3.mjs`, `r2-*.txt`, `r3-*.txt`,
    `kubuntu-repro-1.4.2.txt`).

## Root causes

| Bug                                                                                                              | Cause                                                                                                                                                                                                                                                                                                                                        | Whose                                                              | Evidence                                                                                                                                                                                                                                                                                                                                                                                                  |
| ---------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Approvals "answered" 2–3 times                                                                                   | Mostly separate stages of one multi-command line (the log did not name the stage). The real duplicates came from the card reopening (`approvalReopened`) after every decide error: the ledger fault for decisions that applied, and the 60 s deadline on a busy host.                                                                        | Ours (the reopen), with Muse Code's #29                            | The intake records: 20:40:13/14/15 are stages 0, 1, 2. At 22:49:53 the decision applied, the fault was reported, and the card reopened; at 22:49:56 the second answer came back `approvalAlreadyResolved`. At 23:49:40 a decision got no answer for 60 s and was sent again at 23:50:43 and 23:51:46. Muse Code took all three in at 23:52:33–40, accepted the first and refused the two others as stale. |
| "Moved on … choose again on the updated card" with no updated card (20:42:56)                                    | After the stage-0 "Always allow" (`git show`), 1.4.x presents stage 4 (`git show …`, `unresolved`) although its rule allows it. It refuses the decision with `approvalRequirementStale`, naming stage 5, and never sends `approval/updated` for 5; `approval/listPending` keeps saying 4.                                                    | Muse Code                                                          | Journal frames seq 974–986 (owner, 1.4.0). Live on 1.4.2: the stale refusal names stage 5, there is no event in 8 s, and `listPending` says 4 (`r2-race-cancel-1.4.2.txt`).                                                                                                                                                                                                                               |
| Every message refused: "approval replay failed: decision stage evidence contains an unrecorded human resolution" | A turn cancelled while a multi-stage approval has a decided stage and a waiting one. Every later `turn/start` fails (-32603, `internal`, `retryable: false`) until `muse serve` restarts. The owner pressed Stop at 20:44:07 because the card above never moved.                                                                             | Muse Code                                                          | Live on 1.4.2 on Windows and Linux, minimal case: Allow once on stage 0 of 2, then cancel (`r2-two-once-cancel-1.4.2.txt`, `kubuntu-repro-1.4.2.txt`). It needs neither a stale decide nor a rule. Control: Reject the waiting stage through `approval/decide`, then cancel, and the session stays usable (`r2-two-reject-cancel-1.4.2.txt`, both OSes).                                                  |
| After the restart, every decision: "approval ledger durability fence … (failed=0, pending=N)"                    | The wedged session's ledger on Windows. The decision applies (intake `accepted`, `terminal: true`, the turn completes). This is #29 with a deterministic trigger.                                                                                                                                                                            | Muse Code                                                          | Live: after the replay fault and a restart, every decide reports it on Windows, and none does on Linux. A healthy session after a restart reports none (`r2-plain-1.4.2.txt`). In the owner's log, 55 decisions from 21:00 on.                                                                                                                                                                            |
| `item/readOutput`: "not found", then 60 s timeouts, stacked                                                      | (a) An edit row reads its patch as soon as `patchRef` appears, which 1.4.2 sends on `item/updated` while the edit is `inProgress`. (b) A busy Muse Code answers reads one after another, so several open edit rows waited past the 60 s deadline, and each failure posted its own error notice. The host was working, not stuck (the owner). | Ours (when to read, the stacking); Muse Code (an early `patchRef`) | Live: 2 of 4 reads at `item/updated` answered `notFound` in the wedged session (`r3-wedged-1.4.2.txt`). Five concurrent reads came back together after 3–5 s (`r3-*`). The owner's log: five identical notices at 22:30:58, six at 23:49:21.                                                                                                                                                              |
| "Did not finish starting within 30 s" (06:57, 20:53)                                                             | 0.10.0's 30 s handshake on a loaded machine.                                                                                                                                                                                                                                                                                                 | Ours, fixed in 0.10.1                                              | 0.10.1 (`800120df`) waits up to 120 s while the process runs. The log's successful connects took 10.8 s and 18.7 s, so 120 s is six times the slowest. No change here.                                                                                                                                                                                                                                    |

The replay fault was not reproduced on 1.4.0-R4302.1. That build has no
`--provider` switch, and in an isolated home it serves the subscription
provider, which needs a sign-in. The owner's own session log is the 1.4.0
evidence.

### Why carrying a choice to the next stage was not taken

The stage the host waits on after a stale refusal is a different command:
`Measure-Object -Line` after `git show …`. An Allow carried over would
approve a command the user never saw, and an "Always allow" would add a
different rule. The card instead locks at the first click and moves to the
stage Muse Code waits on. It then says on itself that the request moved
on, and the live region reads that once.

## What changed

- **One decision per stage.**
  - **The card** (`ApprovalCard.tsx`): a ref set in the click handler, so
    two clicks in one frame send one decision. It is released only when the
    host reopens the stage.
  - **The reducer** (`uiState.ts`): a decided stage stays locked when the
    same request is announced again. An update to another stage is a new
    decision.
  - **The session** (`MuseSession.decideApproval`, `PromptLedger`): it never
    sends a second decision for a stage, or one for a stage the approval
    has left. A decision with no answer, or one with the ledger fault, keeps
    its stage decided. The card reopens (`DecisionNotAppliedError`) only
    after a refusal that `approval/listPending` confirms by still naming
    that stage.
  - **The log** names the stage of each answer.
- **The stale stage.** `PromptLedger.advanceTo` moves the card to the
  refusal's `currentRequirementId`. The rule choice takes that stage's
  `suggestedPrefix.label`, or is dropped when the stage has none.
  `approvalMovedOn` marks the card, and its note replaces the transcript
  notice.
- **Stop.** `MuseSession.cancel` and `interrupt` first reject the waiting
  stage of a part-decided approval through `approval/decide`. Each try
  waits at most `min(10 s, the command deadline)`, and a stale reply gets
  one more try at the stage it names. The Stop goes on whatever happens.
- **The faults.** `MuseCodeFaultError` (`approvalReplay`, `approvalLedger`)
  is matched on the captured `internal` kind and words. The controller says
  each once per session (`approvalReplayRefused`, `approvalLedgerFault`):
  - The replay fault offers **Restart now**, a new `restartMuseCode` host
    action, after which the next message resumes (D25), and **New
    conversation**.
  - The ledger fault offers **New conversation**.
  - The lint rule against `instanceof` on host error classes now names
    both new classes.
- **Output reads.**
  - An edit row reads its patch once the edit has finished.
  - Collapsing a row forgets a page that did not come, so expanding it asks
    again.
  - The controller joins a read already in flight for the same page.
  - The first failure in a conversation is a warning with how to retry
    (`outputLoadRetry`); later ones only log, until a read succeeds.
- **Text.** Four new keys in all fifteen tables: `approvalReplayRefused`,
  `approvalLedgerFault`, `museCodeRestartAsked`, `outputLoadRetry`. The two
  buttons reuse `restartNow` and `newConversationTitle`.

Every new test uses the captured shapes
(`test/unit/helpers/stageRaceCapture.ts`):

- the eight-stage approval with its `suggestedPrefix` labels;
- the stale refusal's `currentRequirementId`;
- the replay and ledger faults' codes, kinds and words.

## Tests

All runs were on the Kubuntu rig (`rig-test.sh` / `rig-npm.sh`); nothing
ran on the shared host.

| Run                                                                                                            | Result                                                                                                                                   |
| -------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| The seven touched files (promptLedger, MuseCodeHost, cards, uiState, Transcript, conversationController, App)  | 718 passed                                                                                                                               |
| `npm run test:unit` (with coverage, e2e included)                                                              | 275 files passed, 3 skipped; 4605 tests passed, 52 skipped                                                                               |
| `format:check`, `lint`, `typecheck`, `check:l10n`, `deadcode`, `cycles`, `duplication`, `build` (with budgets) | all exit 0 (`dist/extension.js` 559.8 KiB of 600)                                                                                        |
| Full `npm run quality` on HEAD `88e4e99d`                                                                      | exit 0: 276 files, 4619 tests passed (52 skipped); a11y 400 pages (100 scenarios × 4 themes), 0 violations; no leaks; semgrep 0 findings |

On `2aabdde1` the same gate had failed once, in `checkpointStoreGuards.test.ts`
(M72, untouched here): "names the restored files a turn with no recorded end
may not have changed itself". It passed three runs out of three alone and
in the full run on `88e4e99d`. It is load-sensitive, and recorded here.

## Red drills

Each guard was broken on purpose in the committed tree. Its tests ran on the Kubuntu
rig, the file was restored from HEAD, and the tree was checked clean
(scratchpad `approval-fix/drills.mjs`, `drills-extra.mjs`, `drills*.jsonl`).
Drill 7 was run again with a narrower match, after its first text matched
twice.

| #   | Guard broken                                                           | File                                                    | Exit | Tests                                              |
| --- | ---------------------------------------------------------------------- | ------------------------------------------------------- | ---- | -------------------------------------------------- |
| 1   | host: a second decision for a decided stage is not sent                | `core/backends/musecode/MuseCodeHost.ts`                | 1    | 4 failed, 70 passed (74)                           |
| 2   | host: no decision for a stage the approval has left                    | `core/backends/musecode/MuseCodeHost.ts`                | 1    | 1 failed, 73 passed (74)                           |
| 3   | host: a stale refusal moves the card to the stage it names             | `core/backends/musecode/MuseCodeHost.ts`                | 1    | 2 failed, 72 passed (74)                           |
| 4   | ledger: the moved card takes its stage's own rule label                | `core/backends/musecode/promptLedger.ts`                | 1    | 2 failed, 7 passed (9)                             |
| 5   | host: the replay fault on turn/start is named                          | `core/backends/musecode/MuseCodeHost.ts`                | 1    | 2 failed, 418 passed (420)                         |
| 6   | host: the ledger fault is named and keeps its stage decided            | `core/backends/musecode/MuseCodeHost.ts`                | 1    | 1 failed, 73 passed (74)                           |
| 7   | host: a decision without an answer is never offered again              | `core/backends/musecode/MuseCodeHost.ts`                | 1    | 1 failed, 73 passed (74)                           |
| 8   | host: a failed listPending check keeps the stage decided               | `core/backends/musecode/MuseCodeHost.ts`                | 1    | 1 failed, 345 passed (346)                         |
| 9   | host: a Stop rejects a part-decided approval first                     | `core/backends/musecode/MuseCodeHost.ts`                | 1    | 3 failed, 71 passed (74)                           |
| 10  | host: a Stop goes on when its reject fails                             | `core/backends/musecode/MuseCodeHost.ts`                | 1    | 1 failed, 73 passed (74)                           |
| 11  | controller: a Muse Code fault is said once per conversation            | `host/conversation/conversationController.ts`           | 1    | 2 failed, 344 passed (346)                         |
| 12  | controller: the card reopens only when the decision did not apply      | `host/conversation/conversationController.ts`           | 1    | 1 failed, 345 passed (346)                         |
| 13  | controller: the ledger fault is said as Muse Code's, without reopening | `host/conversation/conversationController.ts`           | 1    | 1 failed, 345 passed (346)                         |
| 14  | controller: the replay fault on a message gets its notice and way on   | `host/conversation/conversationController.ts`           | 1    | 1 failed, 345 passed (346)                         |
| 15  | controller: a read in flight is joined                                 | `host/conversation/conversationController.ts`           | 1    | 1 failed, 345 passed (346)                         |
| 16  | controller: a failed read is said once until one succeeds              | `host/conversation/conversationController.ts`           | 1    | 1 failed, 345 passed (346)                         |
| 17  | controller: a stale refusal is said on the card                        | `host/conversation/conversationController.ts`           | 1    | 1 failed, 345 passed (346)                         |
| 18  | card: one decision per click burst (the ref)                           | `webview/components/ApprovalCard.tsx`                   | 1    | 2 failed, 122 passed (124)                         |
| 19  | webview: the same request announced again keeps the lock               | `webview/state/uiState.ts`                              | 1    | 2 failed, 241 passed (243)                         |
| 20  | webview: a moved-on step is marked on its card                         | `webview/state/uiState.ts`                              | 1    | 1 failed, 115 passed (116)                         |
| 21  | row: the patch is read once the edit has finished                      | `webview/components/ToolRow.tsx`                        | 1    | 1 failed, 37 passed (38)                           |
| 22  | row: a page that never came is asked again on re-expand                | `webview/components/ToolRow.tsx`                        | 1    | 1 failed, 37 passed (38)                           |
| 23  | transcript: a fault notice offers its way on                           | `webview/components/Transcript.tsx`                     | 1    | 1 failed, 37 passed (38)                           |
| 24  | webview: an update of the decided step keeps its buttons disabled      | `webview/state/uiState.ts`                              | 1    | 3 failed, 240 passed (243)                         |
| 25  | lint: `instanceof MuseCodeFaultError` in src is refused                | `eslint.config.mjs` (a line added to `MuseCodeHost.ts`) | 1    | `no-restricted-syntax` at the added line           |
| 26  | dock: the oldest waiting approval comes first                          | `webview/state/uiState.ts`                              | 1    | 1 failed, 127 passed (128)                         |
| 27  | dock: an arriving card takes focus                                     | `webview/components/ApprovalDock.tsx`                   | 1    | 3 failed, 122 passed (125)                         |
| 28  | dock: typing keeps focus                                               | `webview/components/ApprovalDock.tsx`                   | 1    | 1 failed, 124 passed (125)                         |
| 29  | dock: no focus behind a modal                                          | `webview/components/ApprovalDock.tsx`                   | 1    | 1 failed, 124 passed (125)                         |
| 30  | row: the waiting row keeps its compact record                          | `webview/components/ToolRow.tsx`                        | 1    | 2 failed, 153 passed (155)                         |
| 31  | a11y: the dock's count at a low contrast (`#d8d8d8`)                   | `webview/styles.css`                                    | 1    | `color-contrast` on 2 elements, `approval-several` |

## Docked approvals (the owner's request, 2026-10-03)

A waiting approval's card is docked between the panels and the composer
(`ApprovalDock`), outside the scrolled transcript, and before the composer
in Tab order. The tool's row says "Waiting for your approval, in the card
above the message box", and shows the decision once settled.

- **Several waiting.** The oldest is docked, with "Approvals waiting: N".
  That is the order Muse asked, and the composer stays on screen at 320 px.
- **Focus.** An arriving card takes focus on the card itself (`tabIndex=-1`
  on its group). It does not while the user types (a field holding text,
  or a key within 1.5 s) or behind a modal. The reducer's announcement in
  the live region covers those cases.
- **Size.** The dock scrolls on its own at 45% of the panel's height, and
  a long command wraps.
- **The lock.** The single-decision lock above is the card's own, so it
  holds in the dock.

Tests: `ApprovalDock.test.tsx` (new), App, Transcript, uiState and cards;
299 passed on the rig. The axe gate ran the scenarios `approval`,
`approval-several`, `approval-narrow` (320 px), `approval-moved`,
`approval-tool`, `cancelled` and `question` in the four themes: 28 pages,
0 violations. Screenshots (harness renders):

- `approval-dock-several.png`: three waiting, the oldest docked.
- `approval-dock-narrow.png`: the same at 320 px.
- `approval-dock-moved.png`: a step that moved on, said on the card.

The README's `media/readme/approval.png` is the docked card.

## Upstream

A draft issue for meta-models/muse-code-sdk was written and not filed. It
covers the replay wedge, the ledger fault's trigger (extending #29), the
unannounced stage, and the early `patchRef`. It is in the session
scratchpad: `approval-fix/upstream-issue-draft.md`.
