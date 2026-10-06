# M112 lane 0 — frozen contracts and integration handoffs

2026-10-05, Kubuntu, branch `m112/l0`, base `81a5ccfa` (0.14.1).
Authority: `git show plan/m105-m107:PLAN.md`, D92 and M112 in full,
including §6's Delivery order; the rig brief and shared `codex/common.md`.
The plan is intentionally not copied into this checkout. Only lane 0 is
implemented here; Q, U and A start against these contracts, then the lead
integrates Q, U, A in that order. No dependency on an unmerged milestone.

## Portable contracts

`src/shared/questions.ts` imports only shared schemas/constants. It exports
`OpenQuestion`, `QUESTION_STATES`, `QuestionState`, `OpenQuestionsSnapshot`,
`QuestionReply`, `OpenQuestionAnswer`, `AttentionDockState`, `QuestionKey`,
`QuestionStore`, `QuestionClock`, `QuestionDelivery`,
`QuestionDeliveryOutcome`, `QuestionDeferralPort` and `QuestionRegistryPort`.
The matching zod schemas validate storage, snapshots and commands. These
are internal harness contracts, not new Muse Code or service wire fields.

- A record carries `userInputId`, `sessionId`, `itemId`, `turnId`,
  `questions`, `key`, `state`, `askedAt`, optional `deferredAt`, `reminders`
  and `backend`. Times are integer milliseconds from the injected clock.
  The two existing backend names are unchanged. Open/later-settled states
  require `deferredAt`; it cannot precede `askedAt`; reminders are 0–2.
- Identity handles have a maximum of 100 characters, without truncation.
  Both id slots in the fixed deferral note then fit M46's 500-character
  limit (465 characters at this maximum; 337 for a UUID). A longer handle
  is rejected explicitly, never silently shortened or sent as a guessed id.
- Snapshots are `{ sessionId, questions }`. Their records must belong to
  that session and have unique card ids. At most 20 are `open`; a snapshot
  can carry an expired oldest record alongside 20 open records so the
  transcript sees that terminal update. Q must retire terminal records
  after publication rather than accumulating terminal history in storage.
- Owner-only storage is `{ version: 1, snapshot }`. `QuestionStore.load`,
  `save`, `remove` are per session. Missing files return `[]`; malformed
  files reject. Atomic replacement, permissions and deletion belong to Q's
  actual store adapters. Text is never logged, exported or reported.
- `QuestionKey` is the signature `(questions: readonly Question[]) =>
string`. Q implements `questionKey`: NFC, trimmed/folded whitespace,
  `toLowerCase()` without a locale, sorted sets of option labels. The fake
  fixture's key is internal test data, not a production normalizer.
- `QuestionClock.now()` and `setTimer(delayMs, callback)` are injected.
  `setTimer` returns an idempotent cancellation function. The registry
  receives a **required** `QuestionDeferralPort.deferQuestions(id)`.
- `deliver({ sessionId, userInputId, text, displayText })` returns `taken`,
  `notTaken` or `uncertain`. Only `notTaken` permits restoring a delivery
  mark. An exception must be treated as uncertain unless the adapter proves
  nothing was taken. Mark before dispatch; no retry on uncertainty.
- The dock state lists `approvalIds`, `waitingQuestionIds`,
  `elicitationIds`, `openQuestionIds`, and optional `fullCard` (question or
  elicitation only). A full card must be listed; waiting/open ids are
  disjoint. Arrays retain the caller's order. U orders approvals first,
  waiting questions oldest first, MCP forms, then the open chip, with one
  full card and the 0.5 viewport limit. Focus and drafts stay on the surface.

## Question messages (frozen field names)

Every message is parsed by the existing shared protocol parser.

| Direction       | Message               | Fields                                                                                                     |
| --------------- | --------------------- | ---------------------------------------------------------------------------------------------------------- |
| Host → surface  | `openQuestions`       | `snapshot: { sessionId, questions }`                                                                       |
| Surface → host  | `answerOpenQuestion`  | `sessionId`, `userInputId`, `reply: { answers: QuestionAnswer[] }` **or** `reply: { explanation: string }` |
| Surface → host  | `dismissOpenQuestion` | `sessionId`, `userInputId`                                                                                 |
| Both directions | `jumpToOpenQuestion`  | `sessionId`, `direction: 'next' \| 'previous'`                                                             |

An answer cannot carry both alternatives or approval/mode/rule fields.
Session identity lets the receiving host refuse a stale surface; schema
validation alone is not authorization. Q must check ownership, current
state and answer values against the stored questions. A host navigation
message is the palette/key path; U must not echo it back as another request.

`questionSettled.outcome` already accepts an open string vocabulary; it now
explicitly documents `QUESTION_OUTCOME_DEFERRED`. Future MSP words remain
intact. An ordinary user clarification still says `clarified`.
`QuestionReply` adds `{ kind: 'deferred', userInputId }` to the existing
answered/cancelled/clarified alternatives. Q binds this to ModelApiHost's
reply union, preserving request goldens before deferral.

## Q — registry, actual backends and delivery

`AgentSession.deferQuestions` is an **optional capability during this
contracts-only commit**. It references the required shared port. Q must
implement it on both actual sessions and then make it required on
`AgentSession`; update full session fakes in that same binding change.
No production no-op or cancellation fallback has been installed here.
The registry cannot be constructed with a session lacking its required
injected deferral dependency.

Model API resolves its wait with the shared deferred reply, then fills
`QUESTION_MODEL_TEXT.deferred`. Muse Code uses M46's captured
`userInput/clarify` request, tracks ids before dispatch, and maps only those
ids' `clarified` settlements to `deferred`. See
[m46.md](m46.md), capture 2026-09-25, workspaces `C:\muse-live-m46` and
`C:\muse-live-m46b`, 27 counted model attempts in the original capture;
`test/unit/helpers/m46Capture.ts` holds the actual settled frame. Lane 0
made no model attempt and invented no MSP parser or field.

Q must drive 60/0/5→10 from the machine setting, keep approvals outside
this path, expire the 21st open card, coalesce waiting/reasked cards by key,
retain drafts under deferral, deliver late answers through existing
`submit`, queue idle dismissals before the next user message, and implement
bounded reminders and session removal. The fixed late-answer template
expects `{ id, question, answer }`; truncate the question text to 2,000
characters and format `answer` exactly as today's `questionResultText`
(`Answers:\n` plus JSON, or the existing clarification lead plus text).

`QUESTION_MODEL_TEXT`'s split guard declares activation, `conversation.js`,
`modelApi.js` and `acp.js`. The controller was moved into a lazy conversation
bundle after D92's three-reader list was written; its late-answer and
reminder code must remain lazy. Until Q/A bind real readers the build
correctly rejects missing readers. Do not add artificial reads to make it
pass or remove the guard. If Q's final dependency graph needs fewer readers,
the lead must reconcile the plan and exact declared readers from evidence.

## U — dock, transcript and manifest

U consumes the snapshots in the reducer and handles navigation messages.
Adding these variants exposes the existing exhaustive `uiState.reduce`
switch until U supplies its real cases. Lane 0 does not edit surface code.
U binds all nine state labels, countdown announcement on arrival only,
arrival/deferral/reminder/late-answer live texts, badges, tab/document titles
and History markers. Approval focus, paid consent and MCP's 300-second
expiry are unchanged. MCP has no late-answer delivery.

U owns `package.json`'s commands, keys and the planned machine setting.
Manifest additions must reference the translated keys in the same change;
the localization gate refuses unused nls keys. Lane 0 provides their exact
translations and declarations as an integration handoff unless the owner
authorizes this narrow shared-file region here.

## A, HELPREF, M104 and other editors

A implements the runtime clock, `--questions-defer-after`, `/answer` and
`/questions`; cooperative form cancellation; late responses; and the
no-form client's immediate deferral. The fake ACP client mirrors pinned SDK
1.5.0 `SendRequestOptions.cancellationSignal`: an abort sends
`$/cancel_request` but the response promise can still resolve normally.
Its forms/cancellation capabilities can be disabled independently.
Headless, best-of-N, worktrees and the evaluation keep immediate
cancellation/clarification. Scheduled interactive prompts do defer.
A owns README, ACP/CI docs, CONTRIBUTING, layout, editor matrix and
CHANGELOG. No claim that lane 0 ships those behaviours.

`featureCatalog.ts`, `check:reference` and MHP are absent on this base.
HELPREF's owner must add entries for the dock/open questions, the setting,
next/previous commands, `/answer`, `/questions` and the runtime flag,
regenerate the reference and run its gate with A. No fake catalog is added.

M104 integration must add these **methods**, reusing the strict schemas
above and its request-id/error envelopes:

- `questions/open` notification: the per-session snapshot.
- `questions/list` request: authenticated session id; reply is its snapshot.
- `questions/answer` request: session, card id and the alternative reply;
  route through exactly-once registry delivery, never an approval handler.
- `questions/dismiss` request: session/card id; lazy model notice.
- `questions/defer` request: session/card id; route to the holding process's
  required port; a native UI never owns the clock or invents a settlement.
- Status item: open count only, with the localized tooltip; no question
  text in status, journal, report, export or log.

`questions/defer` and `questions/list` satisfy the brief's additional
open/defer/answer/list handoff; D92 names open/answer/dismiss and counts.
The host must validate session ownership for every request and refuse
headless/unattended deferral. These methods are not implemented by lane 0.
JetBrains/JCEF, Visual Studio/WebView2 and Eclipse/SWT bridges, companion
page, M110a0 lane T's TUI and M111b's desktop bind this same contract when
those lanes land. They do not block Q/U/A on main. Native key mappings need
host-focus guards and the keymap review below; they are not installed here.
