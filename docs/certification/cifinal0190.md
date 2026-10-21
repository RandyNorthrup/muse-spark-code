# CIFINAL0190 — hosted CI on the final 0.19.0 tree (bc71fc506b)

Hosted run 39474751738 (scnetsolutions/muse-spark-code-ci, `ci/pr-237`)
on bc71fc506b: Forks, Hosts and Browser check green; nine unit shards red.
Each red has its own row below; product defects went to their own lanes
(WINPSMOD, SKILLROOT, BROKERMAC) with their own records.

## 1. `webviewBundleRoot.test.ts` read the checkout's dist (all three OSes)

Cause: the suite (VSIXWEB) read real webview build output from
`dist/webview` of the checkout at module load. A unit job builds nothing,
so the file failed to collect: `ENOENT: no such file or directory, scandir
'dist/webview/chunks'` (ubuntu shard 1, windows shard 2, macos shard 2).
It passed on rigs only because a developer build had left `dist/` behind.

Fix: the suite joins `PRODUCTION_BUILD_SUITES`
(`test/unit/helpers/productionPackage.ts`), so the once-per-run shared
production build (`test/unit/globalSetup.mjs`) is made for it, and it reads
`main.js`, `main.css` and the first content-hashed chunk from that build
through `inject(PRODUCTION_BUILD_KEY)`, never from the checkout.

Red/green (linuxlt, fresh worktree at bc71fc506b, no `dist/`): base suite
red with the same ENOENT; with the fix 7/7 green. This PC with the
checkout's `dist` moved aside: 7/7 green from the shared build.

## 2. `elicitationHookSeam.test.ts` used a hand-written process runner (ubuntu shard 4)

Cause: the suite ran hook scripts through its own `spawn('/bin/sh')`
runner, standing in for the product's hook process entry. Its stdin write
had no `error` listener, so a hook that exits before reading its payload
raised an uncaught `write EPIPE` (Vitest "1 unhandled error", the run
red). The product's runner (`runCommand` in `src/host/backend/toolIo.ts`)
already listens for that error ("A hook may exit before consuming stdin.
EPIPE must not crash the host.").

Fix: the stand-in is gone; the suite runs every hook through the product's
`runCommand` with the product's `hookEnvironment`, the payload on stdin and
`HOOK_OUTPUT_MAX_BYTES`, as `runHook` in toolIo does (only resource
admission and the Windows job object, which the host adds around it, are
absent on these POSIX cases).

Green: linuxlt 18/18. The red is the hosted run's uncaught EPIPE above
(timing-dependent: the hook must exit before the write lands).

## 3. macOS session-broker cases timed out (macos shard 7)

Cause: the suite forks its client with only `HOME` (the fixture root) and
`XDG_RUNTIME_DIR`. The product forwards `TMPDIR` too
(`posixClientPlatform`), but the fixture's client had none, so the broker's
temporary root fell to `/tmp` (world-writable, refused as a socket base)
and then to the fixture HOME, whose socket path under `/var/folders/...`
exceeds the bind limit: `assertVaultSocketLength` refused ("The broker
cannot start") and three cases waited out the test clock. Found with a
diagnostic run on the mirror (client and broker failures printed) and
reproduced on the macmini with its default `TMPDIR`; the earlier lane ran
with `TMPDIR=/tmp/bmt`, where the fallback fits.

Fix: the fixture passes the worker's `TMPDIR` to the client as the editor
host has it. macmini, default `TMPDIR`: 3 red without the change, 4/4
green with it.

## 4. Windows integration teardown (VS Code 1.142)

`unsaved buffers refuse memory writes (D27)` failed in its after-all hook:
`EBUSY: resource busy or locked, rmdir …\.agents\memory\notes` right after
closing the editors. The teardown now uses `removeFolder`, the retrying
removal the unit suites use for the same Windows behaviour.

## 5. check:catches after the Windows real-use fixes

Passing the error to `onError` from four governor catch sites moved them
from SWALLOW to GENERIC, and `clearMarker` copied two catch sites. The
governor sites went back to their accepted form and the journal's marker
removals share one method; no count rose, so the baseline was regenerated
(615a0ae396).

## 6. Two Windows timing failures on 6d580d2cdf

- `questionDeferLongWait.test.ts` (lane NOLIMITSQ) waited a fixed 50 ms for
  the registry's file-store work after each timer piece; a loaded Windows
  runner finished later, and the deferral read as missing. The test now
  waits on the registry's own events (a timer armed, a deferral delivered,
  a change published), never on a clock of ours. 3/3 green locally.
- Integration `schedule background entry in the real host`: its teardown
  hit `ENOTEMPTY` removing the governor folder right after disposal. Every
  recursive removal in `test/integration` now uses `removeFolder`, the
  retrying removal the unit suites use, instead of fixing them one flake at
  a time.

## 7. The bad-value answer pointed at a help command no one can run

Real use of the packed agent (win32-x64, 5646155a6b + VAULTTARGET +
LEASEFIX): `muse-spark-code-acp --questions-defer-after abc` answered
"Invalid value for --questions-defer-after; run serve --help for the
accepted values and bounds." with exit 2. `serve --help` is not a command
a person can type; the unknown-option answer beside it already names
`muse-spark-code-acp serve --help`. Every topic's bad value now names the
full command, and exec's separate copy of the sentence is gone (its 15
table entries removed).

- Break on purpose: `test/unit/cliArgs.test.ts` now requires
  `run muse-spark-code-acp <topic> --help for`; on the old helper it failed
  (1 failed | 10 passed, exit 1), green after the fix (11/11; with
  cliHelp, cliHelpConsistency and execArgs 151/151).

## 8. The vault logged a failure each time its panel opened

Real use on Windows (separate VS Code, packed win32-x64 build): every first
open of Models & Agents → Vault wrote `Vault operation failed: Error` to the
extension log, with no toast and a correct panel. Traced through the
extension host's inspector: the panel's first load is overtaken by the
broker's own events, so its generation check throws "The use changed after
approval"; the failure path already kept that retirement off the screen
(the newer operation owns the view), but the queue logged it as a failure
first. One predicate (`isRetiredByBarrier`) now decides it for the
screen and the log alike.

- `test/unit/vault/windowsVaultPanelFlow.test.ts` gains a reload
  overtaken by Lock and requires a log with no failure: red on the old host
  (5 × `Vault operation failed: Error`, exit 1), green after (exit 0).
- The same suite still typed `[]` into the Target step that VAULTTARGET
  made a picker (the suite runs on Windows only, so the Linux lane did not
  see it); its scripted answers now pick "Nowhere yet".
- This PC's `%TEMP%` grants Modify to `CodexSandboxUsers` and an unknown
  SID (added by other software), so the vault guard rightly refuses to
  build helpers under it, and every Windows vault suite stops at its
  fixture with `code=23` here. Local runs use `TEMP`/`TMP` pointed at an
  owner-only folder; hosted CI is unaffected.

## 9. The vault's Expires box took any date the engine could guess

Real use of the packed product on Windows (Models & Agents → Vault → Add
to Vault → Named Secret): the box said only "Expires", and a wrong answer
was asked again with "That date is not valid. Leave it empty for no
expiry, or type a date.", which never said what a date looks like.
`readExpiry` stored whatever `new Date(answer)` parsed: "1" as 2001-01-01,
"12/1" as 2001-12-01, 2026-02-30 as 2026-03-02, a date alone as UTC
midnight and a date and time without a zone as local time, so an item
could be stored already expired, or off by the person's time zone. The
OAuth and session login expiry and the grant form's Expires parsed the same
way.

Fix: one reading, `readVaultExpiry` (`src/shared/vaultExpiry.ts`), for the
item's own expiry, the required login expiry and the grant form. Two shapes
only: YYYY-MM-DD, the start of that day in the person's time
(`new Date(y, m - 1, d)`, refused unless the day round-trips), or
YYYY-MM-DDTHH:MM with optional `:SS`, `.fff` and `Z` or `±HH:MM` (local
without a zone; the edit pre-fill's `toISOString()` form unchanged).
Anything else asks again with the typed text kept; a moment at or before
now asks again with "That date has already passed.", except an edit that
keeps the item's stored date. The prompts name both shapes, the item's own
adds "Leave it empty for no expiry."; English and all 14 tables.

Tests: the real `editVaultItem` through `VaultNativeInput`
(`vaultNativeEditor.test.ts`: "1", "12/1", "next tuesday" and 2026-02-30
asked again with the shape sentence and the text kept; a past date and the
seam clock's own moment asked again with the passed sentence; local
midnight, local time, a `Z` and a `+05:30` instant stored; an expired
item's pre-filled date kept on edit while another passed date is refused;
OAuth and session refuse empty); the helper in UTC, America/New_York,
Asia/Kolkata, Pacific/Kiritimati and Pacific/Pago_Pago with `TZ` set for
the suite as `l10n.test.ts` does (`vaultExpiry.test.ts`); the real grant
form in jsdom (`vaultGrantExpiry.test.tsx`).

Break on purpose, one exact replacement each, suites `vaultNativeEditor`,
`vaultExpiry` and `vaultGrantExpiry` (43 cases), the file restored byte for
byte (sha256 checked) after each:

| Break                                                          | Exit | Failed |
| -------------------------------------------------------------- | ---- | ------ |
| The engine's guess back in `expiryInstant` (`new Date(typed)`) | 1    | 21     |
| The kept-date exception removed                                | 1    | 6      |
| The passed check removed                                       | 1    | 8      |
| The zone dropped before `Date.parse`                           | 1    | 10     |
| The OAuth/session expiry accepts empty                         | 1    | 2      |
| The grant form skips the refusal                               | 1    | 1      |
| The grant form reads the picker's value as UTC                 | 1    | 1      |
| The grant form sends an empty box to the reading               | 1    | 1      |

Every new case failed in at least one row. Restored: 43/43, exit 0; with
`vaultGrantHints` 45/45.

`windowsVaultPanelFlow.test.ts` still scripted the Add dialog in its order
from before VAULTTARGET's Target picker: its second pick
(`askEveryTime`) went to the picker and `keep` to the mode, so the flow
ended in "The vault operation failed. Try again." and `service-key` was
never added. Its script now follows the current order (Target: nowhere
yet, then no expiry); the old and new scripts were run against the real
`editVaultItem` (old: that failure; new: the `apiKey` item with every
answer used). The suite itself, the other Windows broker and pipe suites
and `writerCrashPosix` cannot build their helper on this PC: its Temp and
profile folders grant Modify to `CodexSandboxUsers` and another SID, so the
guard refuses both (`Bootstrap command failed (code=23)`) before any case
runs. `brokerSocketDirectory`'s two symlink cases need Developer Mode
(`EPERM … symlink`). Hosted Windows CI decides all of them.

Gates on this tree (Windows): `prettier --check` and
`eslint --max-warnings 0` on the touched files 0 and 0; `npm run typecheck`
0; `npm run check:catches` 0 (no count moved); `npm run duplication` 0 (0
clones); `npm run cycles` 0; `npm run deadcode` 0;
`node scripts/check-l10n.mjs` 0; `node scripts/gen-reference.mjs --check`
0; `npm run check:roadmap` 0. `npx vitest run test/unit/vault` 1: 268
passed, 59 skipped, and the six files above refused in their setup.
`npx vitest related src/host/vault/vaultNativeEditor.ts --run` 1:
`vaultNativeEditor` 15/15, `windowsVaultPanelFlow` refused at its helper
build. `npm run build` 1, at `check-bundle-split` only: its eight "no
longer carries node_modules/…" lines come from `node_modules` being a
junction (the metafiles read `../mx-final/node_modules/…`); the build and
all 199 budgets passed, `dist/vaultActions.js` at 25,504 of its 25,600
bytes.

## 10. A conversation that could not be opened took messages silently

Real use on Linux (`release-0.19.0-final-L.md`, "Findings and
observations" 1; `release-0.19.0-restart.md`): Restart Muse Code, reload
the window, open a conversation from History, send. The turn was not sent
and nothing said so; only opening it from History again showed "Could not
resume the conversation: …". The restart lane removed that one rejection
(the IDE MCP secret); any other failed opening stayed silent.

Cause (base 611b9be1e5, `src/host/conversation/conversationController.ts`):

- `adopt` lets go of the conversation shown so far with `dropSession()`
  (5196), which moves `sendInvalidationEpoch`. Any failure after that
  (`setModel` and the model read-back in `enforceResumedModel`, the
  listing, attaching) reached `resumeSession`'s catch, whose
  `if (generation !== this.sendInvalidationEpoch) return` (5347) took the
  opening's own epoch move for "the panel moved on": logged, never said. A
  backend restart or exit during the opening was hushed the same way. The
  second open failed earlier, at `session/resume`, before `adopt`, so only
  it was shown.
- Nothing recorded the failure. With no session and nothing to resume,
  the next message went through `openSession` (4400) to a brand-new
  conversation the panel did not show, where it ran or failed on that
  conversation's own terms, never with the resume's cause.

Fix: a failed opening (History, a restore, the session board, and fork,
import and rewind, which share `adopt`) is said unless the panel was asked
for another conversation since (`conversationChoice`: New Conversation,
a later opening, an account boundary), so its own drop, a restart or an
exit no longer hush it. When it leaves the panel with neither a session
nor one to resume, `openSession` refuses every message and action with
the same sentence (the message's `sendFailed` card keeps the typed text;
the notice offers New Conversation), until another conversation is open
here or New Conversation is chosen. Nothing retries. A conversation still
live in the panel is untouched, and a restart's resume target (D25) keeps
its own path. `adopt` also drops a stale resume target once the panel
shows the new conversation. No new sentence: `resumeFailed`, `forkFailed`,
`importSessionFailed`, `rewindConversationFailed` and
`turnStoppedByRestart` say it.

Test: `test/unit/resumeFailureSend.test.ts` (4 cases) drives the real
controller through `handle` on the product's Model API host, built and
loaded as `modelApiEntry.ts` builds it, over the real file store; the
panel harness moved out of `sessionDelete.test.ts` into
`test/unit/helpers/conversationPanel.ts`, shared by both. Failures are the
host's own: a conversation it does not hold ("session … is not held by
this window", before `adopt`), and a saved conversation opened while the
picker holds a provider model the host cannot resolve ("This model is not
available for this run.", refused by `setModel` inside `adopt`, after the
drop). The real webview reducer shows the refused card with the typed
text. On the base tree the second case posted no notice at all, and both
cases sent the message to a new conversation ("The message was not sent:
this window could not tell other windows on this folder that a turn is
starting.").

- Break A, the swallow put back in `resumeSession`'s catch:
  `npx vitest run test/unit/resumeFailureSend.test.ts` 1 failed | 3 passed,
  exit 1 (no notice: `expected [] to deeply equal [ { level: 'error', … } ]`).
- Break B, the refusal removed from `openSession`: same command, 3 failed |
  1 passed, exit 1 (the message reached a new conversation instead of the
  resume's cause).
- Restored: `npx vitest run test/unit/resumeFailureSend.test.ts
test/unit/sessionDelete.test.ts` 14/14, exit 0.

### The race: Send while a History open is still loading

Cause: a message sent while an opening ran went on at once. With no live
session it started a conversation of its own, which the opening's `adopt`
then dropped; `sessionForAction` returned `undefined` with nothing posted
when the epoch or session had moved under it (its barrier check, and the
check after `ensureSession`), and `send` gave up without a word. The
webview's `historyLoaded` for another session keeps none of the old
transcript, so the message's pending card vanished with it.

Fix:

- Openings (History, a restore, the session board, a fork, an import, a
  rewind) are counted while they run. A message sent meanwhile waits for
  them to settle, with no clock of ours, then goes to the conversation
  that opened, or is refused with the opening's own cause through the
  refusal above. A New Conversation or account boundary during the wait
  refuses it in fixed words (`requestStaleTurn`). No opening awaits a
  send, so the wait cannot close on itself.
- `sessionForAction` no longer drops a message silently: a message the
  conversation changed under is refused with `requestStaleTurn` ("The
  model or conversation changed while sending. Send your message again.")
  or, signed out, `notSignedInReason`. Other actions stay quiet as before.
- The webview carries the cards the host has not answered yet (status
  `pending`) after another conversation's history, numbered on from it,
  with their pending drafts. A message answered before the history arrives
  stays with the conversation it was answered in, as before.

The rig now resolves the shell sandbox posture with the product's
`resolveShellSandbox` over the setting's default instead of failing
closed, since every opened conversation reads it, and it records the
controller's log, the test operator's view of the output channel, so a
test can name the session a message went to (`Session <id> resumed on
the … backend`).

Test: three cases in `test/unit/resumeFailureSend.test.ts`, each posting
the History row and Send as the webview does, the second before the host
answered the first:

- open first, the conversation opens: only that session is ever attached
  (no `started` line), and the message's one answer is the turn mark
  refusal (`sendMarkFailed`: the rig's window has no checkpoint folder),
  the last step before the session takes a turn, reached only by a message
  bound for the conversation now open; the answer lands on the card, which
  came through the opened conversation's history;
- open first, the opening fails (the removed provider model): the message
  is refused with the opening's cause, the card keeps the text, and no
  conversation was started for it;
- Send first, the opening right behind it: exactly one answer, and it
  lands on a card on screen, in the old transcript or carried into the
  opened one, whichever came first.

Five repeated runs of the suite: 7/7 each.

- Break C, the hold removed from `send` (its condition made never true):
  `npx vitest run test/unit/resumeFailureSend.test.ts` 2 failed | 5 passed,
  exit 1 (the message started a conversation of its own,
  `test-session-1 started`).
- Break D, the webview carrying no unanswered card: same command, 1 failed
  | 6 passed, exit 1 (`expected undefined to match object`: the answer
  found no card on screen).
- Restored: `npx vitest run test/unit/resumeFailureSend.test.ts
test/unit/sessionDelete.test.ts` 17/17, exit 0.

## 11. Session titles showed the extension's notes, quoted passages and files

Real use of the packed product on Windows: Session History listed a
conversation whose first message was "In one short sentence, say hello and
include the word WRESTONE." as that sentence followed by the choice-steering
note and the verify note, tags and all. The transcript was right (the turn
carries MSP `displayText`); every list was not.

Cause: Muse Code derives a session's `title` and `firstUserPrompt` from the
first turn's whole model-visible text, and `sessionRecordSchema` took both as
sent. `sessionTitle` dropped `<ide_selection>` and `<ide_opened_file>` blocks
only, with a lazy match that a selection holding `</ide_selection>` cut
short; the ACP agent's `session/list` used the raw fields. So the History
list, the session board, the restore notices and every ACP client's session
list could show the extension's notes, a quoted chat passage, a Git draft
prompt with its diff, selected code or an attached file's contents.

Muse Code's rule, captured live (`temp/titles-capture/capture.ts`, bundled
with esbuild and run with node; the committed projection is
`test/fixtures/session-titles/msp-1.4.11-echo-titles.json`): Muse Code
1.4.11-R6667.1 on Windows, `serve --provider echo --trust-workspace`, its
home, `APPDATA`, `LOCALAPPDATA` and the four `XDG_*_HOME` under the run folder
in this worktree's `temp/`, only SystemRoot, SystemDrive, windir, ComSpec,
PATHEXT, NUMBER_OF_PROCESSORS, PROCESSOR_ARCHITECTURE, OS and a
System32-only PATH passed to the child, and `museHome` checked to be inside
the run folder before any session started. Ten first turns went through the
product's own `MuseCodeHost.sendTurn` with parts from the product's own
builders. Expected model calls 0; counted from the run's trace log: 50
admissions, all `provider="echo"` (Muse Code's own reminder agents included),
0 model attempts, 32 requests. What it showed:

- the parts are joined with nothing between them and every run of
  whitespace becomes one space; nothing is shortened (a 1,145-character
  message with its two notes came back whole, a 1,497-character title);
- a title appears once Muse Code's index has it: in `session/list` rows, in
  `session/listChanged` once the session is no longer loaded, and in the
  `session/read` and `session/resume` envelopes; `session/start` and
  `session/started` carry none.

Every model-only part, its form, and how it is now recognised:

| Part                   | Added by                                                           | Form                                                                                  | Recognised by                                    |
| ---------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------- | ------------------------------------------------ |
| Attached text file     | panel `buildParts`, MSP via `textFileInput`                        | `Attached text file "<name>":\n\n<text>`, no tag                                      | opening, a JSON-quoted name, a colon; title ends |
| Plan brief's note      | `planBrief().modelNote`                                            | `The user approved the plan in the attached file …` / `The user asked to implement …` | its sentence up to `{name}`; title ends          |
| Handoff brief's note   | `handoffBrief().modelNote`                                         | `Items the brief marks [untrusted] come from …` (+ goal, todos), no tag               | its first sentence; title ends                   |
| Quoted chat passage    | `chatReferenceText`                                                | `<chat_reference intent="…" from="…">…</chat_reference>`                              | tag and ` intent="`; title ends                  |
| Git draft prompt       | `promptFor` (VS Code Git and the native route) via `gitText`       | `The user asked for a commit message …` / `… a pull request title …`, then the diff   | its instruction up to `{max}`; title ends        |
| Editor context         | `editorContextText`                                                | `<ide_selection>The user selected …</ide_selection>`, `<ide_opened_file>The user …`   | tag and its lead words; title ends               |
| Choice-steering note   | panel                                                              | `<harness_note>When you offer the user a choice …</harness_note>`                     | tag and the note's words; block removed          |
| Verify note            | `verifyGuidance`                                                   | `<harness_note>After you edit files, …[ The user's check commands are: …]</…>`        | tag and either sentence's opening; block removed |
| Sandbox note           | panel and ACP agent                                                | `<harness_note>Muse Code’s Linux shell sandbox cannot start …</harness_note>`         | tag and the note's words; block removed          |
| Editor's attached file | ACP `attachedContext` (headless `exec` files too)                  | `<ide_attached_context uri="…">\n…\n</ide_attached_context>`, between typed blocks    | tag and ` uri="`; block removed, words kept      |
| Unattended note        | `UnattendedRun.parts` (scheduled runs)                             | `This prompt was sent on a schedule. …`, no tag                                       | the sentence; title ends                         |
| Schema request         | headless `exec` (local validation)                                 | `Return your final answer as one JSON value …Schema:\n<schema>`, no tag               | its words up to `{schema}`; title ends           |
| Question notes         | `takeDismissals` (leading), ACP answer lease (leading late answer) | a dismissal `<harness_note>`, `Answer to your earlier question …`                     | not read: they ride only a turn after a question |

No untagged part needed a new tag, so the model receives exactly what it did
before: each opens with a fixed sentence of the extension's own. Those
sentences became standalone constants (`VERIFY_GUIDANCE_DIAGNOSTICS`,
`VERIFY_GUIDANCE_CHECKS`, `HANDOFF_NOTE`, `PLAN_BRIEF_APPROVED`,
`PLAN_BRIEF_FROM_FILE`, `GIT_COMMIT_INSTRUCTIONS`,
`GIT_PULL_REQUEST_INSTRUCTIONS`, `SCHEDULE_UNATTENDED_NOTE`,
`EXEC_OUTPUT_SCHEMA`) that their blocks reference, so `dist/museCode.js`
reads them without carrying `MODEL_TEXT`, `CONVERSATION_MODEL_TEXT`,
`GIT_MODEL_TEXT`, `SCHEDULE_MODEL_TEXT` or `EXEC_MODEL_TEXT`. The two verify
sentences left `MODEL_TEXT` (the build compresses it and takes literals
only); `checkCommands.ts` reads them directly. `handoffNoteWithGoal` stays a
literal that opens with `HANDOFF_NOTE`: a `.join` there kept the whole block
in every bundle (about 3 KiB, eleven budgets over) and was reverted.
`editorContextText`'s two lead words moved into `IDE_CONTEXT_LEADS`.

Fix: one function, `promptWords` (`src/core/backends/musecode/promptWords.ts`),
applied once where the record is parsed: `sessionRecordSchema`'s `title` and
`firstUserPrompt` pipe through it, so `session/list`, `session/listChanged`
and the read, resume and fork envelopes all arrive as the person's words; a
field with nothing of theirs left is absent. It folds whitespace as Muse Code
does, takes the earliest part of the extension's, and either removes that
block (a note, an editor's attached file: words may follow them) or ends the
title there (every other part is followed only by more of the extension's
parts and may hold anything, a closing tag included). A tag counts only with
the words the extension writes after it, so "Rename <harness_note> to
<muse_note> where a < b > c" stays as typed; someone who types a tag together
with its first words, or one of the opening sentences, loses what follows it
from the title. A tag left without its close, followed by the start of the
extension's words, ends the title (a shortened title). `sessionTitle` keeps
only the one-line folding and the "Untitled" fallback; the ACP agent's
`session/list` now uses it, so a first message that was only an attachment
is "Untitled" there too. `session_info_update` carries only names
(`session/nameChanged`), never a derived title, and is unchanged.

Tests:

- `test/unit/promptWords.test.ts` (11 cases): every part built by its own
  builder (`CHOICE_STEERING_NOTE`, `verifyGuidance`, `editorContextText`,
  `chatReferenceText`, `textFileInput`, `planBrief`/`handoffBrief` (now
  exported), `commitMessagePrompt`, `pullRequestPrompt`, the schedule and
  schema notes, ACP `promptParts`), joined as Muse Code joins them; the
  first case checks that rule against all ten captured titles byte for
  byte. Complete blocks alone and in the panel's order, titles cut inside a
  tag, a lead and a note, only-attachment messages, typed tags and angle
  brackets, selected code holding `</ide_selection>`, unfolded input.
- `test/unit/sessionTitles.test.ts` (4 cases): the real `MuseCodeHost` over
  the SDK's real `Connection` on the replay transport, answering only with
  the captured frames: `listSessions`, `toSessionRow` and
  `buildSessionBoard`; the ten captured `session/listChanged` frames
  released through the host; the captured `session/read` envelope through
  `sessionEnvelopeSchema` and `resumeSession`'s record; and the real
  `createAcpAgent` (its paid use the real `AcpPaidUse` over a real grant
  file) answering `session/list` to a real `@agentclientprotocol/sdk`
  client over `connectWith`. No in-repo harness ran the ACP agent's session
  list before; this one binds only the backend's readiness and `hostFor`.
- `sessions.test.ts` loses the hand-typed IDE-block cases (the stripping
  moved), `sessionRecords.test.ts`'s record no longer carries an
  `<ide_opened_file>` in wording the product never sent, and
  `checkCommands.test.ts` reads `VERIFY_GUIDANCE_DIAGNOSTICS`.

Break on purpose, one exact replacement each, the file restored byte for
byte (sha256 checked), `npx vitest run test/unit/promptWords.test.ts
test/unit/sessionTitles.test.ts` (15 cases):

| Break                                                                | Exit | Failed |
| -------------------------------------------------------------------- | ---- | ------ |
| A: the record schema takes `title`/`firstUserPrompt` as sent         | 1    | 4      |
| B: any tag counts as the extension's (the lead check dropped)        | 1    | 4      |
| C: an editor's attached file ends the title instead of being removed | 1    | 4      |
| D: a title cut inside a part is left as it is                        | 1    | 1      |
| E: the commit prompt's opening is not known                          | 1    | 5      |
| F: an attached text file is not known                                | 1    | 7      |
| G: the ACP list maps `name ?? title ?? firstUserPrompt ?? null`      | 1    | 1      |

Restored: 15/15, exit 0.

Gates on this tree (Windows): `prettier --check` and
`eslint --max-warnings 0` on the touched files 0 and 0; `npm run typecheck`
0; `npm run check:catches` 0 (no count moved); `npm run duplication` 0 (0
clones); `npm run cycles` 0; `npm run deadcode` 0;
`node scripts/check-l10n.mjs` 0; `node scripts/gen-reference.mjs --check`
0; `npm run check:host-api` 0 (the record unchanged); `npm run check:roadmap` 0. The touched suites (`promptWords`, `sessionTitles`, `sessions`,
`sessionRecords`, `checkCommands`, `editorContext`, `sessionDelete`) 67
passed, 1 skipped, exit 0. `npx vitest related --run` on `promptWords.ts`,
`sessionRecords.ts`, `editorContext.ts` and `sessions.ts` 0 (111 files, 2,548
passed, 52 skipped); on `agent.ts`, `conversationController.ts`,
`constants.ts` and `checkCommands.ts` (`constants.ts` reaches nearly every
suite) 1: 21,903 passed, 204 skipped, 7 failed, and five Windows vault files
refused in their setup, all from this PC: six cases cannot create a symlink
without Developer Mode (`reports.e2e`, `importIo`, `reportSourceReasons` ×2,
`brokerSocketDirectory` ×2), `mediaConvert` meets "The private media root is
not owned…" and the vault files `Bootstrap command failed (code=23)`, both
from this PC's Temp ACLs (section 9). `npm run build` 1, at
`check-bundle-split` only: its eight "no longer carries node_modules/…" lines
come from `node_modules` being a junction; the build and all 199 budgets
passed (`dist/museCode.js` 108,959 bytes, `dist/extension.js` 434,675,
`dist/vaultActions.js` 25,504 of 25,600), with no model-text block carried
where it is not read.

Not done here: the packed product's real use (Session History, the board
and an ACP client's list on the person's own stored conversations), which
this lane's no-model rule leaves to the lead; Linux and macOS are hosted CI's.

Found beside this, not changed: a turn the extension writes whole, with no
words of the person's in it (a review on Muse Code, `/playback`), titles its
conversation when it is the first message; a review's title is its prompt
with the reviewed material.

## 12. PR #237's hosted runs before the release

The capacity mirror runs only the unit shards and a subset of jobs; the
release pull request's own CI also runs jobs the mirror never does. Its
runs on the final tree, each a first attempt:

- `5bab951798` (run 39551158884): red. The capacity relay brought back one
  darwin slot helper named `muse-vault` after VSIXDARWIN made one per
  architecture, and never relayed the darwin peer helpers; the Linux native
  helpers job ran the dictation build (pins read through esbuild) without
  `npm ci`; semgrep's community Telegram-token rule matched the vault
  Target help's example fingerprint (`SHA256:AAAA…`) in all 15 tables. All
  three fixed in `a5464af20a` (actionlint and zizmor clean; semgrep's exact
  command 0 findings; the rule itself finds 2 in the old table, 0 now).
- `a5464af20a` (run 39554120250): red. The release SBOM found no
  `dist/acp-stage-files.json`: `package-acp.mjs` wrote it only for a
  targeted pack, and CI packs the universal agent. Fixed in `4ec0618c14`;
  the SBOM step exits 1 without the receipt and 0 after a pack.
- `4ec0618c14` (run 39558051964): green, with Hosts, Forks and Browser
  check, all first attempts.
- `09459516de` (run 39562044632, the release date moved to 2026-10-21
  after midnight Pacific): red at `security:audit`, where the npm
  registry's audit endpoint answered `400 Bad Request` (07:32 UTC); the
  lockfile is byte-identical to `4ec0618c14`'s, and the same gate exits 0
  locally minutes later. A rerun on the same commit is refused (AGENTS.md
  rule 2), so this record is the new commit.

## 13. 0.19.0's tag refused; 0.19.1's first run met a GitHub incident

- `v0.19.0` on `e48e8c6bce` (release run 39569020330): the tag checks
  stopped the release before any build or publication: the browser check's
  runtime pin (154.0.8037.92) was 21.060 days behind Stable 156.0.8078.47
  (at most 14). The version is spent; the pin renewal ships as 0.19.1
  (PR #255, `scripts/pin-browser-runtime.mjs`, validated byte for byte
  against the 154 pin on all four platforms, the 156 runtime downloaded,
  verified, extracted and launched by the real store on Windows).
- PR #255 head `23f15583ca` (runs 39622440581, 39622440331, 39622440364):
  red in every capacity hand-off only. The route pushed the merge commit
  `bf3029fbd8` to the capacity repository, which created no run within ten
  minutes, during GitHub's incident "Delays for Pull Requests and Webhook
  deliveries" (Actions and Webhooks degraded, 2026-10-21 15:15 UTC); the
  same pull request's Forks run was never created either. No job of ours
  failed. A rerun on the same commit is refused (AGENTS.md rule 2), so this
  record is the new commit, pushed once GitHub reported the incident
  resolved.

## 14. PR #255's second run: two Windows-only reds on a slow runner

PR #255 head `6cc8f2a34d` (CI run 39653536793, capacity run 39653641953),
hosted Windows only:

- `reportProductionTransport.test.ts` (shard 1): the store read came back
  `unavailable` for Marketplace, Open VSX and npm. The same 53-file shard
  passes here (`npx vitest run --shard=1/16`: 5,672 passed), and nothing in
  0.19.1 touches the reporting network; the test said only the status. It
  now names the read's reason when it fails, so a repeat shows its cause.
- Integration `schedule background entry in the real host: reconcile
retires a stale entry…` on VS Code 1.99: over its 20 s timeout, where the
  last green runs took 6.9 s and 10.9 s; the same case passed on current
  VS Code in the same job. Both reds fell in the hour after GitHub's
  Actions incident. No timeout was raised and nothing was re-run on the
  same commit (AGENTS.md rule 2): this record and the test's reason are the
  new commit.
