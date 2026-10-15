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
and the strengthened Focus Input mirror (the panel comes forward, then the
toggle hands the keyboard back to the file — the composer's landing effect
is what makes the second half pass). Nothing else needs an editor.

## Looked at in light and dark (2026-10-14, this lane)

D108 changes the interface's focus behavior, so the changed surfaces were
inspected on the built product in both themes with the repository's own
local screenshot tool (`node scripts/harness-shots.mjs`, headless Chrome,
`dist/webview/main.js` from `npm run build`): the chat transcript with its
composer, and an arriving approval card docked above the composer. Both
themes show the composer, the docked card with its Allow once / Always
allow / Reject controls, and the transcript unchanged — no pixels moved,
only who may take the keyboard. Files (690 px):

- `docs/certification/panel-focus-transcript-light-690.png`
- `docs/certification/panel-focus-transcript-dark-690.png`
- `docs/certification/panel-focus-approval-light-690.png`
- `docs/certification/panel-focus-approval-dark-690.png`

## Follow-up: a request that cannot land at once is dropped, not held (F3, 2026-10-14)

The review's open point on the change above: the brief asked for a
host-owned token and a request dropped at delivery when its panel is no
longer active, but what shipped held the request pending without a bound —
an hour later, clicking the panel's transcript to select text threw the
caret into the composer. The rule above still stands; this closes the
bound.

**Senders of a focus request (every one passes the same host gate, the
`focusInput` branch of `surface.post` in
`src/host/views/webviewSetup.ts`, decided by `shouldDeliverFocusInput` in
`src/host/views/focusGate.ts`):**

| Sender                                             | File:line                                                          | Reveal with the ask?         | Gate outcome                                                                     |
| -------------------------------------------------- | ------------------------------------------------------------------ | ---------------------------- | -------------------------------------------------------------------------------- |
| Focus Input command                                | `src/host/commands/focusInput.ts:29`                               | Yes (`reveal()` just before) | Delivers; the token is minted                                                    |
| Deferred mention flush                             | `src/host/prompts/promptInsertion.ts:18`                           | No                           | Delivers only while its surface is active, else dropped at post                  |
| Mention insert (Alt+K)                             | `src/host/commands/insertMention.ts:29`                            | Yes                          | Text posts as `insertText`; its focus side expires with every other recorded ask |
| Report attach                                      | `src/host/conversation/conversationController.ts:11061`            | Yes (`surface.reveal()`)     | Same as the mention insert                                                       |
| Composer @-mention, file attach, dictation inserts | `src/host/conversation/conversationController.ts:8570, 9046, 9727` | In-surface acts              | Same as the mention insert                                                       |
| Draft restore after a fork                         | `src/host/conversation/conversationController.ts:5037`             | Person's own rewind gesture  | Same as the mention insert                                                       |
| Load-time `init`                                   | `src/host/views/webviewSetup.ts:195`                               | The surface just opened      | Recorded fresh at delivery; lands only while owned                               |

**Mechanism (two layers, one window,
`FOCUS_REQUEST_WINDOW_MS = 1000` in `src/shared/constants.ts` —
the probe measured the panel becoming active 415–766 ms after the file
took over, so 1000 ms covers the slowest measured arrival with margin):**

1. Host: the gate delivers a `focusInput` only while its panel is the
   active one (`panel.active`; the sidebar's `view.visible`) or while the
   reveal the person just asked for still propagates; otherwise the ask is
   dropped at post, never held. A delivered ask carries the minted
   `token`/`issuedAt` (`focusInput` in `src/shared/protocol.ts`).
2. Webview: the reducer records only a tokened ask delivered within the
   window (`isHostOwnedFocusInput` in `src/webview/state/uiState.ts`) and
   the composer's effect lands a request only while the surface holds the
   keyboard and only within the window after it was asked
   (`landFocusRequest`, same file; the effect in
   `src/webview/components/Composer.tsx`). Afterwards it is gone.

What the person sees is unchanged when they act on the chat: Focus Input
reveals then delivers within the window; clicks, sends and in-surface
gestures land at once. What changes is the stale case: the deferred flush
to a hidden panel is dropped at post, and an ask recorded behind a file
expires — the hour-later transcript click selects text and the caret stays
out of the composer.

**Proof (repo default timeouts, `--maxWorkers=3`, this rig):**
`test/unit/focusGate.test.ts` 5/5 (deliver while active, deliver on a
fresh reveal, drop when inactive, drop on an old reveal, token shape);
`test/unit/composerFocusOwnership.test.ts` 8/8 (fresh lands only while
owned, fresh lands on the in-window focus, the hour-later scenario drops
and stays gone, load-time recording, tokened recording, tokenless and
stale ignored, mention insert). Red drills, restored byte-exact
(`sha256sum` identical before and after): the window conjunct removed —
`drops a stale request…` fails with the request landing; the gate forced
to `return true` — both drop tests fail. Dependents unmodified:
`test/unit/uiState.test.ts` (one line: its bare `focusInput` now carries
the host's token), `focusInput`, `protocol`, `teamProtocolLoading`,
`teamStartup`, `promptMenus`, `promptWorkspaceIntegration`,
`surfaceRegistry`, `store`, `Composer.test.tsx` 100/100. Left as the
owner's rules require (stand-in tests, named not repaired):
`test/unit/webviewSetup.test.ts` — `posts host messages through the
surface handle` asserts the exact pre-token shape and fails on the minted
token, 14/15 pass. Real-editor proof stays with the lead's Hosts workflow
(the D15 watching case and the Focus Input mirror); the new real-life
scenario is the stale one: Focus Input to a hidden panel is dropped, and
an hour-later transcript click never moves the caret.

## Round 2: the merge, the toggle fix, F74 (2026-10-14, lane PRFIX160)

Branch `fix/panel-focus-steal` head `748b949c9` (PR 160) merged PR 172's
head `06847350f` (`git merge --no-ff`, committed as `54adeef18`, hooks on).
Conflicts, resolved by meaning: `CHANGELOG.md` and
`docs/certification/plan-archive.md` keep both sides' additions;
`test/unit/questionApp.test.tsx`, `test/unit/uiState.test.ts` and
`test/unit/webviewSetup.test.ts` stay deleted (the overhaul deleted them);
`test/unit/helpers/questions/fixtures.ts` keeps PR 160's additions with
their imports (the merge had dropped the two import lines; still consumed
by `attentionDock`, `questionAttentionOwnership`, `questionContracts`,
`questionUiState`, `questionKey` and the integration questions suite).
The `test/unit/m114Audit.test.mjs` hash pin on the deleted `Composer.tsx`
is gone with the overhaul, as expected.

### The Focus Input failure: cause and fix

Hosted `build / integration`: `Focus Input did not hand the keyboard back
to the file` — reproduced on this rig (VS Code stable 1.142.0 under
`xvfb-run`, same assertion, `40 passing, 1 failing`).

Root cause (product, not test): the toggle's editor leg ran
`workbench.action.focusActiveEditorGroup`, which is a no-op while a chat
tab is the group's active tab. A temporary trace through the real editor
(removed afterwards) showed it: after the first Focus Input the chat tab is
active with no text editor; the raw group-focus command leaves exactly
that state (`activeTab=webview:…chatPanel activeEditor=none`). So once the
composer reported focus, every later toggle took the editor branch and
stayed in the chat forever — the loop could never succeed, deterministically.
For a person the same: a second Focus Input with the composer focused kept
the keyboard in the chat.

Fix (`src/extension.ts`, commit `3fa83c0f5`): the host remembers the last
active text document (`onDidChangeActiveTextEditor` only moves the target
on a real text editor, never on the webview clearing it) and the toggle's
`focusEditor` reopens that file, falling back to the group focus when there
is none or it closed. The trace with the fix ends
`activeTab=text:…/AGENTS.md activeEditor=…/AGENTS.md`. One CHANGELOG line
extends the panel-focus entry.

### F74: what takes the keyboard from AGENTS.md

The lead's probe (quoted at the top of this file) measured the thief: the
loading panel's composer focused itself 310–696 ms after `showTextDocument`
and the panel went active 415–766 ms after. That is rows 1–2 of the path
table above, now gated twice: the host drops `focusInput` for an inactive
panel (`shouldDeliverFocusInput`) and the composer lands a request only
while its own surface holds the keyboard (`landFocusRequest`).

On the fixed tree a 6 s poll-trace (temporary test, removed) around
`createRulesFile` shows no steal: tabs stay
`[Untitled(webview:…chatPanel), AGENTS.md(text:…)]` with AGENTS.md active
throughout. Code census for the Windows-only second `Untitled`: every chat
tab is labelled `Untitled` (`src/host/views/chatPanel.ts:101`), but no
product path opens or reveals a tab during that test — all 17 focus paths
in the table above are person-command or person-gesture driven, the
schedule openers included (`src/host/schedules/schedulesBridge.ts`
commands only), and the fixture workspace holds no schedule store. The
second `Untitled` did not reproduce on this rig, so it stays UNRESOLVED
here; to name it on the next red, `waitForTab` now reports each open tab's
kind (chat webview `viewType` vs text `fsPath`) and the active editor
(commit `9425cce38`).

10-run proof (full stable suite, `xvfb-run -a npx vscode-test --label
stable`, exit code per run): all 10 exit 0 with 41 passing, the
`creates AGENTS.md (D15)` case green 10/10 and the Focus Input mirror
green 10/10. (Per-run table sits in the lane report; logs
`temp/integ-10x-*.log` are gitignored scratch, not committed.)

### Gates on the final tree

| Gate                                                            | Exit             | Note                                                                                                                                                                                               |
| --------------------------------------------------------------- | ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `format:check`                                                  | 0                | whole repo                                                                                                                                                                                         |
| `lint` (js main+unit+tests, css; ps skipped on Linux by design) | 0                | zero warnings                                                                                                                                                                                      |
| `typecheck` (host, webview, unit, e2e, integration)             | 0                |                                                                                                                                                                                                    |
| `deadcode` (knip)                                               | 0                | was 1: `expectedQuestionCommandsUpdate` orphaned by the overhaul's deletions (orphaned already on PR 160's head — one reason its quality run failed); removed with its imports, commit `893861927` |
| `cycles`                                                        | 0                | no circular dependencies                                                                                                                                                                           |
| `duplication` (jscpd)                                           | 0                | 0 clones                                                                                                                                                                                           |
| `check:plan`                                                    | 0                | 218 milestones, 0 drift                                                                                                                                                                            |
| `check:host-api`                                                | 1 then 0         | stale record (`Uri.toJSON`/`Uri.with` newly attributed to `src/extension.ts`); regenerated with `--write`, diff reviewed (additive only), commit `893861927`                                       |
| `check:l10n`                                                    | 0                | 0 problems                                                                                                                                                                                         |
| `check:roadmap` / `check:reference` (extra)                     | 0 / 0            | current                                                                                                                                                                                            |
| `build` (production)                                            | 1 then 0         | the 1 was local `dist/` pollution (`dist/test`, `dist/traffic-harness`, both gitignored) tripping the lazy-registry check; removed, rebuilt green                                                  |
| `package`                                                       | 1, environmental | `Required Linux created-path helper excluded from VSIX: arm64` — built helpers are untracked, CI compiles them per-arch first (`native-build`/`linux-native-build`); this rig holds only x64       |
| unit (touched, repo timeout, `--maxWorkers=3`)                  | 0                | `focusGate` 5/5, `composerFocusOwnership` 8/8, `questionAttentionOwnership` 8/8, `attentionDock` 3/3, `toggleFocusView` 2/2, `questionContracts` 16/16, `questionUiState` 10/10, `questionKey` 1/1 |
| integration stable (`xvfb-run`, final tree)                     | 0                | 41 passing, incl. both focus cases                                                                                                                                                                 |

Real-life scenario for the lead's run: open a chat tab, open a file, Focus
Input (the panel comes forward, caret in the composer), Focus Input again
(the file has the keyboard); create AGENTS.md while a panel loads behind
it (the file keeps the keyboard).
