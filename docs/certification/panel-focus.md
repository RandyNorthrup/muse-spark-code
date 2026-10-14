# Panel focus: the chat no longer takes the keyboard from a just-opened file

Released defect, measured by the lead's release agent (2026-10-12, hosted
VSCodium 1.135, probe branch `probe/vscodium-focus`, never merged): a person
opens a chat panel beside the editor, then opens or creates a file within
about half a second. In 14 of 20 runs the chat panel became the active
editor 0.4–0.8 s after `showTextDocument` resolved (webview "ready" at
+2–+17 ms, "composer focused" at +310–+696 ms, panel view-state active at
+415–+766 ms, `activeTextEditor` gone). In 5 the file kept the keyboard; in
1 the takeover came before the first look (the red Hosts job on 0.18.2).
The code is unchanged since 2026-09-21 (commit `fb1166ec6f`).

## The rule (PLAN.md D108)

Focus is taken only as the direct effect of something the person just did
on that surface, and only if that surface still holds the keyboard when the
focus would land. A webview never focuses its composer merely because it
finished loading. The host owns the ask; the webview confirms ownership at
delivery with `document.hasFocus()` and never overrides the host.

## Every path that moves the keyboard (read 2026-10-12, this worktree)

`reveal` below always takes the keyboard: panel
`panel.reveal(undefined, false)` (`src/host/views/chatPanel.ts:43`) and
sidebar `view.show(false)` (`src/host/views/ChatViewProvider.ts:38`) both
pass "do not preserve focus". `showTextDocument` paths are the file side.

| #   | Trigger                                                                                                                                                    | Who asks                                                 | When it lands                                                                                                                      | What it can take the focus from                                                                                                                                                                                                    |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Sidebar first load / resolve: `init` records a focus request (`src/webview/state/uiState.ts`, `init` case)                                                 | Person opening the sidebar, or any command that opens it | 0.3–0.7 s later, whenever the webview finishes loading                                                                             | A file opened meanwhile — **the measured steal**. Now lands only on this surface's own focus, never from the file                                                                                                                  |
| 2   | Panel first load (`openChatPanel`, focused by default)                                                                                                     | Person (Open in New Tab)                                 | Same late landing as 1                                                                                                             | Same as 1. Now gated the same way                                                                                                                                                                                                  |
| 3   | Panel rebuilt after window reload (`restoreChatPanel`, D15)                                                                                                | VS Code restoring the layout                             | Same late landing as 1                                                                                                             | Same as 1. Now gated the same way                                                                                                                                                                                                  |
| 4   | `Focus Input` command with a surface (`src/host/commands/focusInput.ts`): `reveal` + `focusInput`                                                          | Person running Focus Input                               | At once                                                                                                                            | The file — intended: the person acted on the chat                                                                                                                                                                                  |
| 5   | `Focus Input` with no surface: `${CHAT_VIEW_ID}.focus`, load-time request lands through the rule                                                           | Person running Focus Input                               | On load, view just focused                                                                                                         | Nothing stolen: the view was just focused by the same gesture                                                                                                                                                                      |
| 6   | Mention insert Alt+K (`src/host/commands/insertMention.ts`): `reveal` + `insertText` (records a request)                                                   | Person inserting a reference                             | At once                                                                                                                            | The file — intended                                                                                                                                                                                                                |
| 7   | Deferred mention flush (`src/host/prompts/promptInsertion.ts` `surfaceReady`): `insertText` + `focusInput` with no `reveal`                                | The person's earlier mention gesture, delivered late     | Whenever the webview becomes ready                                                                                                 | A file opened meanwhile — now lands only on this surface's own focus                                                                                                                                                               |
| 8   | New Conversation command: `reveal` + clear                                                                                                                 | Person                                                   | At once                                                                                                                            | Intended                                                                                                                                                                                                                           |
| 9   | Board session reveal (`revealBoardSession`)                                                                                                                | Person clicking the board row                            | At once                                                                                                                            | Intended                                                                                                                                                                                                                           |
| 10  | Report markdown attach: `insertText` + `reveal`                                                                                                            | Person running the report command                        | At once                                                                                                                            | Intended                                                                                                                                                                                                                           |
| 11  | Account & usage / Help / Estimator / Report / schedules openers: `reveal` or fresh surface + `open*` post                                                  | Person running the command                               | At once (or on load, surface just focused)                                                                                         | Intended                                                                                                                                                                                                                           |
| 12  | Turn-end / permission question while hidden: `markUnread` / badge only, never `reveal`; inside the webview the dock tried to focus the arriving card       | The turn, not the person                                 | On arrival                                                                                                                         | A file being typed in — `isTyping` sees only webview-internal typing. Review fix: the dock (`QuestionSurface.tsx`, `QuestionUi.tsx`) and the legal report's arriving headings move focus only while the surface holds the keyboard |
| 13  | Attention notice (window unfocused): `reveal` only from the notice button                                                                                  | Person clicking the button                               | At once                                                                                                                            | Intended                                                                                                                                                                                                                           |
| 14  | Overlay / share / handoff close, reply, quote, slash action (`focusRequested`, six dispatches in `src/webview/App.tsx`)                                    | Person acting inside the surface                         | At once                                                                                                                            | Same-surface; still lands (surface holds the keyboard)                                                                                                                                                                             |
| 15  | Failed send returns text to the composer; draft restore after a fork (`restoreDraft`, `conversationController.ts:5037`); handoff clear; legal report close | Person's own send / rewind / dialog                      | At once or gated                                                                                                                   | Same-surface, or held pending until the surface itself gains focus                                                                                                                                                                 |
| 16  | Composer-internal moves: slash-dismiss and prompt-menu close refocus the box; history checkbox refocuses search; palette `autoFocus`                       | Person acting inside the surface                         | At once                                                                                                                            | Same-surface; unchanged                                                                                                                                                                                                            |
| 17  | `focusView` setting                                                                                                                                        | —                                                        | Never: verified by reading — the setting is referenced in none of the focus-path files above; it only changes transcript rendering | Nothing                                                                                                                                                                                                                            |

Late-capable paths: 5 of 17 (rows 1, 2, 3, 7, and the `restoreDraft` half of
row 15). All five funnel into the one landing effect. Row 12 does not go
through that effect; the review gated its own focus calls the same way.

## The mechanism (one fact)

Recording is not landing. Every request above only increments
`focusRequests`. The composer's effect is the single place a request lands
(`src/webview/components/Composer.tsx:594`), through `landFocusRequest`
(`src/webview/state/uiState.ts:3692`): the landed count advances to the
requested count only while `document.hasFocus()` says this surface holds
the keyboard. An unowned check spends nothing — the request stays pending
and the effect retries on this surface's own `window` focus event (review
fix: `Focus Input` and the report attach post their ask together with a
`reveal()`, and nothing ordered the message after the reveal's focus, so
a spend-at-first-check rule could leave the forwarded panel with the
caret nowhere). A load finishing behind a just-opened file gets no focus
event, so it still never takes the keyboard. No per-sender check was
added. What the person sees when they act on the chat (click into the
panel, Focus Input while the panel is active, send a message) is
unchanged: the surface holds the keyboard then, so the request lands
exactly as before. The async arrivals that never recorded a request — an
approval or question card, the legal report's preview and result — check
the same ownership at their own focus calls and otherwise leave the
keyboard where it is (the badge and unread mark already say they wait).

All editors equal: every path above goes through the shared host and the
shared webview with no per-editor branch read in any focus-path file
(Cursor, Windsurf, VSCodium and code-server run this same extension code
against the same `vscode` API; Theia's webview focus timing was not read
here and stays with the lead's Hosts run).

## Proof

- Watching real-editor case (lead runs on hosted editors; cannot run on
  this rig): `test/integration/extension.test.ts`, `creates AGENTS.md in
the workspace root and opens it (D15)`, now polls `activeTextEditor` and
  the active tab group for 3 s after `showTextDocument` resolved. On the
  base it must go red about seven times in ten — that red rate is its proof
  it can fail. Mirror case in the same file: Focus Input from a file brings
  the chat panel forward (the owned path still works).
- Pure-logic tests through the real modules (run here, repo default
  timeouts): `test/unit/composerFocusOwnership.test.ts`, 5 tests —
  owned lands and is spent, unowned stays pending until the surface
  itself gains focus, load-time request recorded but not landed, host
  asks recorded, mention insert recorded. Red drills: the lane's
  (rule broken to `return true`, restored byte-exact, SHA-256
  `2eeab066…f950`) and the review's (ownership conjunct removed:
  `expected 1 to be +0` in the pending test; restored byte-exact,
  SHA-256 `b6c3fe35…2f08` before and after). The lane's first test
  asserted an identity function; the review replaced it with the
  landing transitions above.
- Dependents run unmodified here: `test/unit/uiState.test.ts` 182/182,
  `test/unit/focusInput.test.ts` 3/3 (recording semantics unchanged).
  `test/unit/Composer.test.tsx` churns 97–99/100 on this tree across runs
  (20 MiB PDF paste/drop, microphone paid-engine price — nothing this
  change touches); the untouched base at `898a26c5e` in a worktree on the
  same rig fails the same tests (1 then 3 of 100: the same microphone and
  PDF cases; rig load averages 29–46). Every focus-related case in that
  suite passes on both trees.
- Real-life scenario (becomes the lead's run): open a chat panel beside the
  editor, open a file at once, type — the characters land in the file. With
  the panel active, Focus Input — the input has the keyboard.

## What the lead must run on the hosted editors

`test/integration/extension.test.ts` on the branch (Hosts workflow):
the D15 case (expect green ten times in ten here; red ~7/10 on the base)
and the new Focus Input mirror. Nothing else needs an editor.
No picture changes: not a visual change.
