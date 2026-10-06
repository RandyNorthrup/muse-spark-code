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
  `questions`, `key`, `state`, `askedAt`, optional `deadlineAt` and `deferredAt`, `reminders`
  and `backend`. Times are integer milliseconds from the injected clock.
  The two existing backend names are unchanged. Open/later-settled states
  require `deferredAt`; neither time can precede `askedAt`; reminders are 0–2.
  `deadlineAt` freezes the arrival-time setting for U's countdown. It is
  absent when questions never defer, and does not change if the setting
  changes while the user is answering.
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

`AgentSession.deferQuestions(userInputId): Promise<void>` is **required**,
as D92 specifies. Q implements it on both actual sessions and updates old
full-session fakes as part of that binding change. The new scripted fake
implements it already.
No production no-op, optional-method fallback or cancellation fallback has
been installed here. The first contracts commit exposed it as optional to
keep the host compiling alone; the final contract makes it required, so Q
and the lead do not need to revise this frozen shared-file signature later.
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

## Keymap review — 2026-10-05

These are a review of the published default maps and upstream declarations,
not a claim about a user's installed keymap, extensions, keyboard layout or
OS shortcuts. Lane 0 installs no shortcut. U must prove the VS Code focus
condition on the real panel; M104b–d must check their bridges' effective
maps at integration and keep host commands available outside the chat.

| Default map             | Proposed Next                      | Proposed Previous                              | Finding                                                                                                                                                                                       |
| ----------------------- | ---------------------------------- | ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| VS Code Windows         | Ctrl+Alt+J                         | Ctrl+Alt+Shift+J                               | Neither listed in the published default reference/card.                                                                                                                                       |
| VS Code Linux           | Ctrl+Alt+J                         | Ctrl+Alt+Shift+J                               | Neither listed in the published default reference/card.                                                                                                                                       |
| VS Code macOS           | Cmd+Option+J                       | Cmd+Option+Shift+J                             | Neither listed in the published default reference/card.                                                                                                                                       |
| JetBrains Windows/Linux | Ctrl+Alt+J                         | Ctrl+Alt+Shift+J                               | Conflicts: Surround With Live Template; Select All Occurrences.                                                                                                                               |
| JetBrains macOS         | Cmd+Option+J                       | Cmd+Option+Shift+J                             | Next conflicts with Surround With Live Template. Previous is not explicitly assigned in the reviewed macOS map; Select All Occurrences uses Ctrl+Cmd+G.                                       |
| Visual Studio General   | Ctrl+Alt+J                         | Ctrl+Alt+Shift+J                               | Next conflicts with View.ObjectBrowser, a global shortcut. Previous is not listed in that profile.                                                                                            |
| Eclipse default/JDT     | Ctrl+Alt+J (Cmd+Option+J on macOS) | Ctrl+Alt+Shift+J (Cmd+Option+Shift+J on macOS) | No proposed chord in the reviewed JDT bindings; nearby Ctrl+J/Ctrl+Shift+J are incremental find and Alt+Shift+J adds Javadoc. Full installed platform map remains an M104d integration check. |

Sources checked: Microsoft's
[default reference](https://code.visualstudio.com/docs/reference/default-keybindings)
and [Windows](https://code.visualstudio.com/shortcuts/keyboard-shortcuts-windows.pdf),
[Linux](https://code.visualstudio.com/shortcuts/keyboard-shortcuts-linux.pdf),
[macOS](https://code.visualstudio.com/shortcuts/keyboard-shortcuts-macos.pdf)
reference cards; JetBrains'
[default keymap XML](https://github.com/JetBrains/intellij-community/blob/master/platform/platform-resources/src/keymaps/%24default.xml),
[macOS keymap XML](https://github.com/JetBrains/intellij-community/blob/master/platform/platform-resources/src/keymaps/Mac%20OS%20X%2010.5%2B.xml),
[Windows reference](https://www.jetbrains.com/help/idea/reference-keymap-win-default.html)
and [Surround Live Templates](https://blog.jetbrains.com/idea/2020/05/write-code-faster-using-live-templates/);
Microsoft's [Visual Studio General profile](https://learn.microsoft.com/en-us/visualstudio/ide/default-keyboard-shortcuts-in-visual-studio);
Eclipse's [JDT declarations](https://github.com/eclipse-jdt/eclipse.jdt.ui/blob/master/org.eclipse.jdt.ui/plugin.xml)
and [Edit actions](https://help.eclipse.org/latest/topic/org.eclipse.jdt.doc.user/reference/ref-menu-edit.htm).

Consequently the proposed pair is **not** a collision-free common native
keymap. Keep the VS Code proposal scoped to actual chat focus, retain the
dock buttons and palette actions, and make the native-host mappings
configurable or choose host-specific bindings in M104. Do not register
these chords globally in JetBrains or Visual Studio. Installed-map testing
on three operating systems is U/M104's certification, not claimed here.

## Strings and manifest artifact

The 33 new UI entries (including two count-form groups) are in `en.ts` and
all 14 shipped tables with real translations. Existing M16/M46 labels,
arrival announcements and MCP expiry text remain available. Use
`plural(UI_TEXT.openQuestionsCount, count)` for the chip, badge and History
marker, and `plural(UI_TEXT.openQuestionsTabCount, count)` for the title's
count. Countdown and late-answer prose are single `fill` templates. Read
`UI_TEXT` inside functions; format countdown/count/index numbers through
the existing Intl helpers. `questionAnswerUncertain` prevents a false
"try again" message when delivery is already marked uncertain.

The fully translated manifest keys are also available in
`test/unit/helpers/questions/manifestStrings.json`; they are checked against
English with the same strict table checker. The ready-to-apply
[m112-manifest.patch](m112-manifest.patch) adds all 15 `package.nls*.json`
entries and **only** the setting and two command declarations in
`package.json`. It intentionally adds no bindings, handler or activation
read. `git apply --check` passes on this base. The complete patch was
applied and localization-checked in `temp/m112-manifest-stage` with copies
of those manifests; no U-owned file in the worktree was changed. U must
apply these declarations with its real handlers and focus-scoped bindings.
This keeps the lane's actual localization gate at zero unused keys while
respecting file ownership.
