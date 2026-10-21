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

## 8. A conversation that could not be opened took messages silently

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
