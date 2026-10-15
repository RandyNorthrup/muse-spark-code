# No silent drops (lane LIMITSC, 2026-10-15)

Owner, 2026-10-14: "why are there all these arbitrary limits in the actual
app?" The lead's audit (`limits-audit.md`, "App problems" item 4) named six
limits that drop something without telling the person. Each row below names
the file:line that dropped it, when, the fix, the durable test with its red
drill, and the owner's invented-limit rule applied to its number.

Branch: `fix/no-silent-drops` from `origin/main` (`898a26c5e`).
Worktree: this lane's (`/home/randy/lanes/LIMITSC`). No model calls, no
push, no rebase. All commands run in the worktree directly (on rig `wslpc`).

Shared rule for every row: keep what the product can keep, and where
something must still go, tell the person in a translated sentence, at the
moment, naming what was dropped, why, and where it can still be found. The
`backendNotice` event carries panel warnings to the panel, and ACP's
`translate.ts` (`backendNotice` case) forwards them as agent text to the
editor protocol and terminal, so one notice covers all three surfaces.

## B9 — a child task's result was sliced (silent)

- Drop: `src/core/backends/modelapi/ModelApiHost.ts:9022,9057` (base).
  The child's full reply text was sliced to `SUBAGENT_RESULT_TEXT_MAX_CHARS`
  (32,768) when stored on `child.result`, and the automatic push to the
  parent model sliced it again with no marker. `subagent_read_result`
  returned the same slice, so the rest was unreachable. When: every child
  turn that ends with a long final reply.
- Fix (`7098ee4`): the result keeps the full text (`read_result` and
  explicit waits return it whole). The automatic push and the
  transcript/status listings carry the bounded slice; the push appends the
  model sentence `MODEL_API_MODEL_TEXT.subagentResultClipped` (kept/total
  counts, points at `subagent_read_result`), and person-visible summaries
  append `UI_TEXT.subagentResultClipped` (points at the child transcript,
  opened from the agent map / ACP `readSession`). New keys in `en.ts` plus
  all 14 `l10n/ui.*.json`, in English order. Pure clip helper
  `clipChildResultText` in `src/shared/agentReceipt.ts` (numeric const
  only, so no bundle-split block moves).
- Owner's rule: no surveyed harness publishes a subagent-result cap, so the
  stored slice is removed; the push/listing slice stays as the parent's
  context bound (the audit's stated protects rationale), now announced.
- Test: `test/unit/subagentResultClip.test.ts` (6 tests, real modules,
  data in). Red drill: `clipped: true` → `false` in the helper fails 1
  test (`npx vitest run test/unit/subagentResultClip.test.ts`, 5 passed /
  1 failed); restored byte-exact (sha256 `f2e0c5d1…c875c4b` before and
  after). Final: 6 passed.
- Person steps: run a child task whose final reply exceeds ~32k chars; the
  parent's context carries the slice plus the clipped sentence with both
  counts; `subagent_read_result` returns the whole text; the panel's child
  row points at the child transcript. (Lead-run: needs a provider.)

## C7 — an elicitation form settled as cancel (silent)

- Drop: `src/core/backends/modelapi/mcp/connection.ts:274` (base) and
  `src/core/backends/modelapi/ModelApiHost.ts:7271-7273` (base). The 300 s
  deadline aborted the wait bare, indistinguishable from a Stop, and the
  form settled as cancel with no word anywhere. When: any MCP
  `elicitation/create` form left unanswered for 300 s (the connection
  timer fires first; the host timer covers a shorter configured timeout).
- Fix (`e43012c`): the deadline aborts with `McpElicitationTimeoutError`,
  detected by `isElicitationTimeout(signal)`; both the connection (log
  names server and seconds) and the host form wait (translated
  `backendNotice` warning `UI_TEXT.mcpElicitationTimedOut`: server,
  seconds, settled-as-cancel, tool continued without its answer) tell.
  Bare-stop aborts stay silent. New key in `en.ts` plus all 14 locales.
- Owner's rule: 300 s is kept — it bounds a hung tool call, and the fix
  keeps the wire outcome (cancel, never accept). The number no longer
  drops information silently, which was the complaint.
- Test: `test/unit/elicitationTimeout.test.ts` (5 tests: real
  `AbortController` reasons, real template fill). Red drill: detection as
  `signal.aborted` alone fails 2 tests (bare stop and other-error
  misread as timeout); restored byte-exact (sha256 `b122ac0b…fd020078`
  at drill time; a later type fix moved the abort into
  `elicitationSignal`'s `timeout`, same detection). Final: 5 passed.
- Person steps: leave an MCP form unanswered for 300 s; the panel shows
  the warning naming the server and the cancelled settlement; the tool
  call continues without the answer. (Lead-run: needs a live server.)

## B22 — the oldest open questions expired (silent)

- Drop: `src/core/questions/registry.ts:165-169` (base). Past
  `OPEN_QUESTIONS_MAX` (20) open cards, the oldest were marked `expired`,
  and `publish()` then deleted them from memory and the store. When: the
  21st concurrent open question (defer/settle/turn-end/load paths).
- Fix (`158ffc5`): expired cards are retained in memory, the store, and
  across reload (load filter), so their text stays readable on the card.
  The registry reports each newly expired card through optional
  `onExpired`; VS Code posts one panel warning
  (`UI_TEXT.questionsExpiredNotice`, plural count + the 20-open bound +
  where the text lives, all 14 locales with the gate's per-locale plural
  categories); ACP's deferral layer drains `takeExpired()` and posts the
  same sentence through its notice channel. Expiry during turn-end/settle
  is retained and announced on the next deferral notice.
- Owner's rule: no surveyed harness publishes a question cap; the 20-open
  bound stays as the attention-dock presentation bound (the dock schema
  caps `openQuestionIds` at 20) but no longer forgets anything.
- Test: `test/unit/questionExpiry.test.ts` (4 tests: real registry over a
  real temporary-folder store, 21 questions, no fakes). Retains the
  crowded-out card with text, reports it once, publishes it to the panel
  snapshot, keeps it across reload. Red drill: without `expired` in the
  retained set, 2 tests fail (memory + reload); restored byte-exact
  (sha256 `17608d77…be30898db`). Final: 4 passed.
- Person steps: open 21 questions in one session; one warning names the
  count; the oldest card shows Expired with its text; it survives reload.
  (Lead-run: needs a provider or the ACP form path.)
- Note: `check:l10n` enforces per-locale plural categories (es/it/pt-br
  need `many`; fr/ru `one` must carry `{count}`); the first version of
  these keys failed the gate and was corrected (see gate log).

## B23 — damaged sessions forgotten past 50 (silent)

- Drop: `src/host/conversation/conversationController.ts:1690` (base).
  `setDamagedIds([...damaged, sessionId].slice(-DAMAGED_SESSIONS_KEPT))`
  forgot markers past 50; marking itself only logged. When: the 51st
  distinct session whose Muse Code event log failed in one workspace.
- Fix (`374cf13`): every marker is kept (`markedDamagedIds` in the new
  `src/host/conversation/damagedSessions.ts`, newest last, no cap — a
  marker is a short id), and `markDamaged` posts the existing
  `UI_TEXT.sessionLogDamaged` warning at that moment (History stays, new
  conversation is the way on). `DAMAGED_SESSIONS_KEPT` is removed. The
  refusal path for messages to damaged sessions is unchanged.
- Owner's rule: the 50 is removed — no peer comparison exists and the
  protects rationale (state-file growth) does not survive contact with
  ~40-byte ids.
- Test: `test/unit/damagedSessions.test.ts` (3 tests, real module).
  Red drill: a `.slice(-50)` in the helper fails 1 test; restored
  byte-exact (sha256 `3f4ab39a…16c79d4f5`, prettier reflow after).
  Final: 3 passed.
- Left red, named per the owner's 2026-10-12 testing rules (fake-based
  file, not repaired or extended):
  `test/unit/conversationController.test.ts` —
  "keeps the newest damaged sessions only, at most DAMAGED_SESSIONS_KEPT"
  (1 of 688 fails; 687 pass). It encodes the removed drop. The file
  imports `test/unit/helpers/fake*`, `fakeGit`, `fakeModelApi`.
- Person steps: break a session's Muse Code log twice across 50+
  damaged sessions; the panel warns once per newly damaged session; every
  marker stays; History keeps them all. (Lead-run: needs the CLI fault.)

## B17 — a late judge result dropped (silent)

- Drop: `src/core/judge/same/batches.ts` + `scheduler.ts` (base): a
  batch that times out (60 s) or fails settles `failed` or nothing, and
  the approval shows no advisory with no word the check never ran.
- Fix (`40d5c33`): `JudgeFence.dropped()` in `src/core/judge/use.ts`
  reports no usable outcome at the fence (failed, or still pending — a
  late result is dropped, never attached afterwards), true even after
  read/discard. The Auto reviewer (`src/host/review/reviewedApprovals.ts`)
  names it with `UI_TEXT.judgeAdvisoryMissing` (all 14 locales): on the
  card when the person decides, and as a warning when an approval is
  auto-allowed without its advisory. Judged-clean (`none`) and caution
  paths are unchanged. The judge never runs on ACP, so the panel tells
  the person; the Model API `card()`-only flow never distinguished
  judged-clean from dropped, so it is out of scope (recorded, not
  changed).
- Owner's rule: the 60 s bound stays (user-path latency is the stated
  rationale, and the fence owns staleness by design); the drop is now
  announced instead of silent.
- Test: `test/unit/judgeFenceDropped.test.ts` (5 tests: real `JudgeUse`,
  runner settles through the real entry store). Red drill: an inverted
  `dropped()` fails 2 tests; restored byte-exact (sha256
  `e597efbb…b1b029864`). Final: 5 passed. Neighbours
  `judgeUse`/`judgeFences`/`judgeEntries` (fake-based, untouched): 55
  passed.
- Person steps: with the Auto reviewer on, stall or fail the judge past
  the fence; an auto-allowed approval posts the missing-advisory
  warning, a card carries it as a note. (Lead-run: needs a provider.)

## B10 — an oversize transcript forgotten (silent, partly)

- Drop: `src/webview/state/snapshot.ts:119` (base). Past
  `WEBVIEW_STATE_MAX_CHARS` (8 MiB) the whole snapshot was dropped —
  transcript, composer draft and pending send together. The restore path
  already told the person (`UI_TEXT.snapshotTooLong`: too long, open
  from History), which this lane verified; the forgotten part was the
  unsent text, which History cannot restore.
- Fix (`344b396`): the draft and pending send (small, the person's own,
  redacted) ride along outside the snapshot and come back on restore;
  the transcript stays with the host. No new strings (existing notice
  reused). The crash-guard path (`isTranscriptKept` false) is unchanged
  deliberately.
- Owner's rule: 8 MiB stays (renderer memory is the rationale, and the
  transcript itself was never lost — the host keeps it); the number no
  longer costs the person their typing.
- Test: `test/unit/omittedTranscript.test.ts` (3 tests, real snapshot
  functions). Red drill: without the ride-along, 2 tests fail;
  restored byte-exact (sha256 `1dcb85ca…25efc5ce9`). Final: 3 passed.
- Two assertions in `test/unit/snapshot.test.ts` (real, no fakes)
  encoded the old contract ("keeps only the session id"); they now
  assert the lane-required contract (draft rides along, restored back),
  flagged here and in the commit for the lead's review. Final: 15/15
  across both files.
- Person steps: grow a conversation past 8 MiB of panel state, reload;
  the notice names History, and the composer still holds the unsent
  text. (Lead-run: reload a heavy panel.)

## RVDROPS review — B10 pending-send recovery

- P1: the omitted-transcript envelope kept `pendingSendDraft.revision` but
  lost `draftRevision`. A real `submitted` action at revision 2, saved with
  a 100-character cap, restored revision 0. The real `sendFailed` reducer
  then refused to restore the pending text and deleted the last copy.
- `omittedTranscript.test.ts` now runs that sequence through the real snapshot
  and reducer: before the fix, 1 failed / 3 passed (exit 1,
  `temp/rv-b10-red.log`); after retaining the revision, snapshot + omitted
  transcript: 16 passed (exit 0, `temp/rv-b10-green.log`, Windows).
- This is logic evidence, not a panel look. Lead: send while handoff is busy,
  reload an oversize panel before the refusal arrives, and confirm the exact
  pending text returns to the composer without overwriting a newer draft.

## RVDROPS review — C7 bundle-safe timeout detection

- P1: `modelApiMcp.js`/`mcpPool.js` create the timeout error, while
  `modelApi.js` checks it. Each bundles its own class, so `instanceof
McpElicitationTimeoutError` was false at the real boundary: the connection
  timer cancelled the form and the host cleared its own timer without warning.
- The detector now checks the Error's stable name instead of local class
  identity. A data-only Error from another copy's contract failed before
  (1 failed / 5 passed, exit 1, `temp/rv-c7-red.log`) and passes after
  (6 passed, exit 0, `temp/rv-c7-green.log`, Windows).
- This proves the detector, not a 300-second live MCP run. The lane's
  original same-class tests did not prove the split-bundle boundary. Lead:
  leave a real MCP form unanswered and observe the warning in the panel,
  terminal and ACP client before trying a new form.

## Limits raised or removed (owner's rule)

| Row | Number              | Outcome                                                  | Reasoning                                                                       |
| --- | ------------------- | -------------------------------------------------------- | ------------------------------------------------------------------------------- |
| B9  | 32,768 stored slice | Removed for storage; kept for pushes/listings, announced | No harness publishes it; parent context still bounded                           |
| B22 | 20 open             | Kept as visible-open bound                               | Attention-dock bound (schema caps at 20); data loss removed instead             |
| B23 | 50 markers          | Removed                                                  | ~40-byte ids; rationale does not survive contact                                |
| C7  | 300 s               | Kept                                                     | Bounds hung tool calls; outcome (cancel, never accept) unchanged, now announced |
| B17 | 60 s                | Kept                                                     | User-path latency; fence owns staleness by design, now announced                |
| B10 | 8 MiB               | Kept                                                     | Renderer memory; transcript was never lost, draft now kept                      |

## APP PROBLEMS disposition (audit §"App problems")

1. Mislabelled spend refusal (F88): not this lane (TURNLIMIT lane's area).
2. Worst-case reservation vs $5 default: not this lane; still open.
3. A1 has no peer: not this lane (TURNLIMIT lane removed it).
4. Silent drops (this lane): B9, B10, B22, B23, C7, B17 fixed above.
5. One-shot continuations (B1): not this lane; still open.
6. Unchangeable majority: narrowed — B23's cap is gone, B9's stored
   slice is gone, B22's expiry no longer deletes; the kept bounds are
   justified in the table above.

## Gates (final tree)

- `npx tsc --noEmit -p tsconfig.json`: exit 0.
- `npx eslint --max-warnings=0` on all changed/new source and test
  files: exit 0 (iterations: `unicorn/prefer-ternary`,
  `no-magic-numbers` (1000 → `MILLISECONDS_PER_SECOND`),
  `prefer-else-if`, `consistent-boolean-name`,
  `restrict-template-expressions`, `import-style`, `no-empty-function`,
  `prefer-structured-clone`, `no-unsafe-*`, `no-duplicate-imports`).
- `npx prettier --check` on changed files: clean (after `--write`).
- `node scripts/check-l10n.mjs`: 0 problems (after correcting plural
  categories/slots for es/it/pt-br/fr/ru).
- `node scripts/gen-reference.mjs --check`: current (73 features, 65
  commands, 89 settings). `node scripts/check-host-api.mjs`: 0
  problems. `npm run cycles` (dpdm): no circular dependency.
  `npm run deadcode` (knip): exit 0.
- Duplication (`jscpd`, threshold 0.0%): failed red on the B22 test's
  repeated registry-deps block (1 clone); extracted a `ports()`
  helper → 0 clones.
- `npm run build`: failed red (exit 1) on the bundle split — the C7
  import pulled `mcp/connection.ts` into the static `dist/modelApi.js`.
  Moved `McpElicitationTimeoutError`/`isElicitationTimeout` into the
  already-static `mcp/elicitation.ts` → exit 0, no split problems.
- `npm run check:plan`: exit 0 (D113 compressed to fit under the 85%
  reader bound; the tree sits just under it, so the next PLAN addition
  needs `npm run plan:archive` first). `npm run check:roadmap`: exit 0
  (218 entries, current; no milestone changed).
- Red drills: one per row, each observed red then restored byte-exact
  (sha256 above), then green.
- Left red, named, not repaired (owner's 2026-10-12 rules, fake-based):
  `conversationController.test.ts` "keeps the newest damaged sessions
  only" (1/688); `questionRegistry.test.ts` "expires the oldest of
  twenty-one open questions and retires terminal records" (1/40, expects
  20 records, gets 21 — the retained expired card). Both encode the
  removed drops.
- Neighbours green: elicitation ×3 (69), deferral/registry ×3 (101),
  question bundles/strings ×3 (39), question UI ×3 (23),
  judgeUse/judgeFences/judgeEntries (55), museCodeReviewer +
  deferredBundles (169, after moving the modelApi exact-size pin
  519,354 → 520,388 with its reason, per the pin rule), open-question
  notices/elicitation card/deferred UI (10), snapshot + omitted (15).
- The ACP `takeExpired` addition first broke 24 fake-based
  `acpQuestionDeferral` tests (their doubles lack the method); the
  method is optional (as `onExpired?` is), so old bindings report none,
  and all 101 pass unmodified.
- `test/unit/snapshot.test.ts`: two assertions encoded the old B10
  contract; updated to the lane-required contract (real file, no
  fakes), flagged in §B10 and the B10 commit for the lead's review.
- Not run here: packed-product run, browser/panel look, live provider
  drills (sandbox + no model calls per the brief); real-life steps per
  row are listed above for the lead. No browser, no loopback server was
  started by this lane.
