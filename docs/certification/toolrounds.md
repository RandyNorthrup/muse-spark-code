# TOOLROUNDS — model-call limits

Frozen base: `874b04372`. Rig: macbook. No live/paid calls, browser or GUI.

## Existing stop types and request limits

`SessionBudgetExceededError` carries a translated money refusal;
`ChildTaskRefusedError` carries a typed child refusal and separate model/UI text;
exec's `StopCause.requests` maps to `request_cap` (exit 5). A turn limit needs
its actual count, so `ModelCallLimitError` extends the budget stop and carries
`limit`. It emits `max_turn_requests` with a completed terminal and a warning;
ACP resolves that protocol stop rather than rejecting an internal error.

| Limit                                      | Where set                                             | Where enforced                                                                        | At the limit                                                                                                                                                                          |
| ------------------------------------------ | ----------------------------------------------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Model API turn, default 200                | `MODEL_API_MAX_TOOL_ROUNDS`, shared constants         | `ModelApiSession.loop`                                                                | Translated resumable notice; ACP `max_turn_requests`; exec `request_cap`, exit 5                                                                                                      |
| Headless requests, default 30, range 1–500 | `exec --max-requests`, `parseExec`                    | `runLedger.admit`; Meta `execFetch`, configured providers `withRuntimeAccounting`     | `request_cap`, exit 5; existing admission refusal can have null `stopReason`/`incompleteReason`                                                                                       |
| Paid child task, 4 attempts per grant      | `SUBAGENT_TASK_MAX_REQUESTS`, `newChildGrant`         | `childGrantRefusal` via `admitChildAttempt` in `responseAttemptGuard`                 | Typed `ChildTaskRefusedError.requestLimit`, `subagent_requestLimit` receipt; the turn-call allowance excludes the grant, so no wrap-up is reserved and all 4 attempts stay tool calls |
| Best-of-N attempt, default 20, range 5–50  | `BEST_OF_N_MAX_REQUESTS_PER_ATTEMPT`, attempt ceiling | `WorktreeConversationHost` allowance port; original attempt guard                     | Attempt ceiling and translated attempt result                                                                                                                                         |
| Team task, default 20; writer roles 40     | `TEAM_TASK_MAX_REQUESTS_*`, role policy               | `WorktreeConversationHost` allowance port and completion counter; scheduler stall cap | Worktree session allowance port; typed Model API stop and capped task receipt                                                                                                         |

Money caps are separate: session, goal, paid daily, account, headless and
scheduled admission stay unchanged. HTTP retries spend attempts; compaction's
own accounting and stop stay authoritative. Hosted search bounds, Tab pacing,
verify strikes and stop-hook continuations are not model-call turn caps.

## Piece 1 — typed translated stop

- Added all fourteen translations and Help relationship.
- Red drill: replace the typed loop stop with the original bare Error.
  `toolRounds.test.ts` fails its typed completed-terminal/notice assertion.
  Restored host byte for byte (`cmp` and SHA-256 in lane temp logs).
- Green: `toolRounds`, `acpAgent`, `execRun`: 240 tests pass at repository
  default timeouts. All five typechecks pass. Changed TypeScript passes ESLint;
  changed files formatted. Localization (0 problems), reference, plan and
  roadmap gates pass. Full `quality` belongs to the lead's integration run,
  per this rig brief; no browser is permitted here.

## Piece 2 — wrap-up request (round-2 shape)

The wrap-up sends the shape the production side calls already send
(compaction and git-draft side calls, `ModelApiHost.ts`): no tools declared
and the choice field exactly as those calls carry it. Per-codec wire truth,
decided round 3 (R3): Meta's own wire carries empty tools with
`tool_choice: auto` (the golden below is the raw fetch body); the Responses
codec for configured OpenAI/xAI providers and the ChatGPT route keeps that
same shape deliberately, because no live capture of an omitted choice
succeeding exists on that family — so the git-draft side call and
compaction without reused tools on those routes send what they always sent
(P3-5: listed, kept, locked by test). The chat, Anthropic, Gemini and
Ollama codecs omit what their long-standing production shapes omit.
`instructions` stay byte-identical to the ordinary body and the limit note
travels as a trailing developer input item, so the instruction prefix stays
cacheable. An unsolicited tool call in that reply is answered for valid
replay and never executed. Held steers, scheduled steers and goal wakes are
never consumed by the wrap-up: the one exit re-queues them, so each keeps
its own turn with tools.

| Codec family                                                    | Toolless wire shape                                             |
| --------------------------------------------------------------- | --------------------------------------------------------------- |
| Meta/direct Responses                                           | Empty tools, `tool_choice: auto` (the side-call shape)          |
| OpenAI/xAI Responses                                            | Empty tools, `tool_choice: auto` (kept deliberately; see above) |
| ChatGPT Responses                                               | Empty namespace, `tool_choice: auto` (kept deliberately)        |
| Chat completions (OpenRouter, OpenAI-compatible vendors/custom) | No tools declared and no `tool_choice` field at all             |
| Anthropic Messages                                              | Omit tools and tool choice                                      |
| Gemini generateContent                                          | Omit tools and toolConfig                                       |
| Ollama chat                                                     | Omit tools and unsupported tool choice                          |

Codec-family assertions use real encoders with tool-result history retained
(the host-built body is parsed back through each codec's own schema).
Red drill: re-add a `tool_choice: none` to the builder: the codec and golden
assertions fail; restore byte-exact. Green: `toolRounds`,
`toolRoundsCodecs` and `modelApiGoldenRequests` pass at repository default
timeouts.

The golden request suite adds only `10-turn-limit-wrap-up.json`, re-recorded
in the side-call shape (measured: `tools: []`, `tool_choice: auto`,
instructions byte-identical to the ordinary request, trailing developer
note present); all other fixtures stay byte-exact. No provider response
shape has been added.

### Cost of withholding tools (P3-3)

Withholding the tools on the wrap-up saves the whole tool-schema block on
that request: 7,386 bytes of tool definitions on the re-recorded Responses
golden (12 tools on its ordinary sibling), plus whatever each vendor's
choice machinery would have done with them. The price is one extra tool-less
model call, and the instruction prefix stays byte-identical so the cached
prefix survives (the codec test asserts both halves).

## Piece 3 — caller allowance and the 200-call default

Ordinary requests count at actual dispatch, including HTTP and whole-stream
retries. Existing callers replace the default. Headless reads its authoritative ledger's remaining attempts;
worktree attempts and engine workers bind their own remaining task ceiling.
The fallback cancellation path remains for backends without the allowance port.
A retry reaching the last slot rebuilds through the ordinary builder after
existing retry accounting and backoff. Automatic compaction does not consume
the reserved wrap-up slot; its own reservations, accounting and stop remain.

### Timing evidence

A busy-rig exploratory `execRun` run used `--testTimeout=30000` solely to
measure the sixty real admissions/settlements: 11.413 s, load 10.52. Those
journals are real OS operations; the final source names a 30-second timeout
for that one workload (PLAN §8), and the packaged sixty-request rows reuse
their existing 30-second operation bound. Final runs use no timeout flag.
The 200-call default is proved in the memory engine; ACP's real runtime
proves answer delivery and `max_turn_requests` with a three-call task allowance.
Long-turn memory tests are load-sensitive on a shared rig (199 rounds 2.9–3.4 s
at load 25–33 against a 5 s per-test budget); each passed repeatedly at the repo
default with no timeout flag.

A paid child grant never joins the caller allowance. The first piece-3 cut
intersected the grant into `callerModelCallsLeft`, which stole the grant's
fourth tool call for a wrap-up and retyped the stop as `max_turn_requests`
with "send a message to continue" — false for a child, and three existing
`modelApiHost` contract tests failed (`subagent_requestLimit` + "4 requests"
expected). The grant was never in the broken class: it already ends typed,
translated and true through `admitChildAttempt`. The shipped code excludes
the grant, so all 4 attempts stay tool calls and exhaustion stays
`ChildTaskRefusedError.requestLimit`; the "fifth HTTP attempt" test now also
asserts every dispatched child body carries tools.

### Red drills (piece 3)

- Grant intersection restored: the merged "fifth HTTP attempt" test fails
  (receipt `max_turn_requests`, fourth body tools-disabled). Host restored
  byte for byte (SHA-256 `e2038f23…` before and after).
- `MODEL_API_MAX_TOOL_ROUNDS` back to 50: the 51-round test fails.
  Constants restored byte for byte (SHA-256 `25615c05…` before and after).
- jscpd gate: the lane's first cut added 3 clones (base: 0). Removed with a
  `toolCallReplies` helper in `toolRounds.test.ts` and by merging the
  grant-tools assertion into the existing contract test instead of a
  standalone copy. jscpd reports 0 clones.
- Lint repair: the uncommitted cut carried 5 ESLint errors (member order,
  prefer-continue, 2 nested ternaries, 1 unsafe `Function` call); all fixed
  in source, zero gates weakened. Repairing the unsafe call first tried
  `instanceof ModelApiSession` (wrong: the runtime builds the session from
  its lazy bundle) and an unbound extracted port (wrong: `this` lost, ACP
  test went red with "Internal error"); the shipped test uses a session
  type predicate that keeps the method receiver. All changed files pass
  `eslint --max-warnings=0` and prettier.

## Bytes

`npm run build` exits 0. `dist/modelApi.js`: 532,537 bytes before,
534,445 bytes after (cap 537,600; +1,908, headroom 3,155). No cap moves.
`dist/extension.js` builds at 564,024 of 614,400.

## Invariants (checked against the shipped code)

- `then_run`: no tool execution/verification path changed; `modelApiHost`
  (671 tests) and the golden-request suite (all fixtures byte-exact) pass.
- ObservationPack: still counts only dispatched requests and keeps originals;
  `modelApiPacking` and the M75 `evalPacking` suite pass unchanged.
- Reducer: no reducer code or policy in the diff; M75 fixtures untouched.
- Compaction: separate admission/accounting/stop preserved and all three
  compaction suites pass (118 tests); auto-compaction skips the reserved
  wrap-up slot via `continue`, covered by the same suites.
- M75: no task, mechanism, wire fixture or scoring change; `evalPacking`
  and `evalRunner` pass (22 tests).
- Steering / queued promotion / goal wake: the post-loop block is untouched
  and keeps its order; the steering/held-round tests in `modelApiHost` pass.
- Output continuation: `MODEL_API_CONTINUATIONS_MAX` unchanged in source;
  only its round-index bound became the remaining-call allowance.
- Verify: `verifyLoop` and `sessionBudget` suites pass (143 tests with
  packing); the wrap-up request executes no tool, so no verification round.
- AGENTS.md and CONTRIBUTING.md never name the constant: no update owed.

## Verification and what is blocked

Ran on macbook at repo default timeouts, `--maxWorkers=3`, one command at a
time: `toolRounds` (7), `toolRoundsCodecs` + `modelApiGoldenRequests` (150),
`execRun` (96), `acpModelApi` (13), `modelApiHost` (671), `verifyLoop` +
`modelApiPacking` + `sessionBudget` (143), compaction trio (118), best-of-N
trio (53), `evalPacking` + `evalRunner` (22), `worktreeConversationHost` +
`teamEngineWorker` (31). All five typechecks pass; ESLint and prettier clean
on every changed file; knip shows only its two pre-existing config hints;
cycles zero; jscpd zero; `check:l10n` (0 problems), `check:reference`,
`check:host-api`, `check:plan`, `check:roadmap` pass; `npm run build` exits 0.

- NOT RUN HERE: `test/e2e/execStdio.e2e.test.ts` toolrounds rows
  (`--max-requests 60`, English + German). The file's setup runs `npm pack`,
  and this sandbox denies writes to `/Users/user/.npm/_logs` ("Operation
  not permitted" on direct probe), so setup fails before any lane logic
  runs. No shim or redirection attempted, per the sandbox-limits rule. The
  same assertions pass in-process in `execRun`; the lead runs the packaged
  path (including the German sentence) outside the sandbox.
- Pre-existing, unrelated: `acpAgent.test.ts` "exposes all three ChatGPT
  actions" fails identically on the frozen base `874b04372` in this
  environment (auth rejection), so it is not this lane's regression.
- Browser suites were never selected (MacBook rule); full `quality` belongs
  to the lead's integration run.

## Round 2 — review RVAPP-TOOLROUNDS (by reading: 1 P1, 3 P2, 6 P3)

Every finding is fixed with the whole class swept; each fix has a
regression test that fails without it and a red drill below. Drill
restoration is verified byte-exact (`git diff --stat` empty) in every row.

| Finding                          | Fix                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | Regression test                                                                                                                                                                                                                                                                                            | Red drill (break → named test fails → restore)                                                                                                                                                                                                               |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| P1-1 wrap-up vendor shape        | Side-call shape: no tools, choice as ever, instructions byte-identical, note as trailing input; no `tool_choice` without tools in any codec                                                                                                                                                                                                                                                                                                                                        | `toolRoundsCodecs`: `keeps instructions byte-identical and carries the note as trailing input` (+ Anthropic/Gemini/Ollama omission tests); golden `10-turn-limit-wrap-up.json` re-recorded                                                                                                                 | Re-add `tool_choice: none`: codec + golden fail; restored byte-exact                                                                                                                                                                                         |
| P2-1 allowance port              | `setModelCallAllowance` REQUIRED on `WorktreeSession` (compiler lists implementers); `AttemptSession` (best-of-N) forwards it and the errorKind; runner no longer cancels at the ceiling                                                                                                                                                                                                                                                                                           | `bestOfNManager` (forward once / clear with `undefined`); `worktreeConversationHost` (bind + clear); `teamEngineWorker` / `teamWorkerFence` fakes updated                                                                                                                                                  | Drop the forward: allowance tests fail; restored byte-exact                                                                                                                                                                                                  |
| P2-2 first call ordinary         | `wrapUpLimit` only once `modelCalls >= 1` (also in `beforeRetry`); `exec --max-requests 1` unchanged (answer = completed/exit 0, tool request = request cap plainly); 199-rounds asserts errorKind, 198-rounds asserts none                                                                                                                                                                                                                                                        | `runs the only permitted call with tools: an answer completes, plainly`; `ends the only permitted call that asks for tools at the request cap, plainly`; `finishes the 199th tool round … limit typed`; `finishes {51,80,198} tool rounds under the default cap`                                           | Allow wrap-up on the first call: max-1 answer test fails; restored byte-exact                                                                                                                                                                                |
| P2-2 hooks on wrap-up            | Stop/SubagentStop hooks run via extracted `runAnswerStopHooks`; a continuation with no calls left answers `modelApiWrapUpHookBlocked` and keeps the answer                                                                                                                                                                                                                                                                                                                         | `runs Stop hooks on a wrap-up turn but keeps the answer when one asks for more`                                                                                                                                                                                                                            | Skip hooks on wrap-up: hook test fails; restored byte-exact                                                                                                                                                                                                  |
| P2-3 never the compaction prefix | Wrap-up body is never the compaction prefix and never measured as the turn body; compaction after a limit stop reuses the last ordinary body                                                                                                                                                                                                                                                                                                                                       | `compaction after a limit stop reuses the last ordinary body, manually and automatically` (`modelApiAutoCompact`)                                                                                                                                                                                          | Prefix the wrap-up body: auto-compaction half fails; restored byte-exact. The manual half is vacuous under note-as-input (the prefix input is never reused; instructions were already clean), so the guard stands as hygiene with the auto half as its proof |
| P3-1 truncated wrap-up           | A wrap-up cut at the output limit throws `ModelCallLimitError` with the `modelApiWrapUpTruncated` sentence; partial answer kept, never "again"                                                                                                                                                                                                                                                                                                                                     | `stops a wrap-up cut at the output limit with its own sentence, never "again"`                                                                                                                                                                                                                             | Retry instead of limit-stop: truncated test fails; restored byte-exact                                                                                                                                                                                       |
| P3-2 steer/goal-wake held        | Goal-wake queued (`queuedGoalWake`) and steers promoted (`promoteSteered`) before the limit throw; each gets its own turn with tools                                                                                                                                                                                                                                                                                                                                               | `holds steering arriving before the wrap-up for its own turn with tools` (goal wake shares the same pre-throw block, `ModelApiHost.ts` promotion site)                                                                                                                                                     | Consume the steer in the wrap-up: held-turn assertions fail; restored byte-exact                                                                                                                                                                             |
| P3-3 note as input               | Trailing developer input item (see Piece 2 + cost note above)                                                                                                                                                                                                                                                                                                                                                                                                                      | Codec byte-identical test; `counts a shrunk allowance in the wrap-up limit it names`                                                                                                                                                                                                                       | Move the note back into instructions: byte-identical test fails; restored byte-exact                                                                                                                                                                         |
| P3-4 singular                    | `{limit} {calls}` slots with singular rendered in `wrapUpNote()` (no `forms()`/`plural`: the compressed-model-text gate requires literal strings)                                                                                                                                                                                                                                                                                                                                  | `renders the wrap-up note in the singular for a limit of 1`                                                                                                                                                                                                                                                | Pluralize unconditionally: singular test fails; restored byte-exact                                                                                                                                                                                          |
| P3-5 reserved slot               | `isWrapUpSlotReserved()` gates the three in-pipeline side calls — overflow-recovery compaction (rethrow), autoReview (`undefined`, user decides), hook-model (empty suggestion) — in the turn and against the exec ledger. Judge and structured direct-budget calls need no gate: the dispatch path skips turn-call counting for `directBudget` (`ModelApiHost.ts` request-started branch), and the judge runs in its own pool via `deps.judge`, so neither can take the turn slot | `refuses overflow recovery on the last permitted call and keeps the failure` (`modelApiAutoCompact`); `spends no reviewer call on the reserved wrap-up slot: the user decides instead` (`modelApiHost` M78 rig); `skips the hook-model call while the wrap-up slot is reserved` (`modelApiLoopGuarantees`) | Remove each gate in turn: the named test fails (reviewer 448 ms, hook-model 1.4 s, both assertion-fast); restored byte-exact every time                                                                                                                      |
| P3-6 own stop reason             | `outcomeStopReason = 'limit'` on limit paths; `agentStopSchema` + `agentOutcome` + `agentStopReasons.limit`; reference sentence on the Conversation entry                                                                                                                                                                                                                                                                                                                          | `agentOutcome` limit suite; `conversationController`: `handles a completed turn carrying errorKind exactly like a plain completed turn`                                                                                                                                                                    | Break the outcome reason / post an error keyed off errorKind in the turn dispatcher: the named tests fail (panel drill detail below); restored byte-exact                                                                                                    |

### Panel drill detail (P3-6, this rig)

The first drill cut missed the seam twice, and both misses are recorded
honestly. Cutting `observeFailure` (`terminal !== 'completed'`) cannot fail
the test: host `turn/completed` reaches the panel through the shared
forward+track entry, and for a completed terminal that arm is already a
no-op. Posting a notice in `track`'s branch while the test sent top-level
`errorKind` over the fake MSP server also cannot fail it: the MSP
`turn/completed` frame schema (`mapNotification.ts`) carries no top-level
`errorKind` (zod strips it); `errorKind` reaches the panel only off the
frame's `error` object (or, on the Model API backend, on the `AgentEvent`
directly). The shipped test uses the wire-true shape
(`error: { kind: 'max_turn_requests', … }`) and asserts the settled contract:
the turn is surfaced as a completion, `errorKind` is kept on the forwarded
`agentEvent` and appears nowhere else (no failure row, no error notice).
Breaking the dispatcher to post an error keyed off `errorKind` fails exactly
that test (`× handles a completed turn carrying errorKind exactly like a
plain completed turn`); the source is restored byte-exact (empty diff).
No MSP schema was widened: the frame shape is the captured one.

### Not checked by the reviewer, settled here

- **Reservations when `WrapUpRequiredError` interrupts an attempt that got 429.** `WrapUpRequiredError` is internal control flow, never an error that
  settles reservations: `beforeRetry` throws it when a retry would spend the
  last slot after a call went out, and the retry loop catches it (`continue`)
  so the loop rebuilds through the ordinary builder as the wrap-up. A
  429-then-limit run is exactly the covered case
  (`rebuilds an HTTP retry into a wrap-up when one call remains`); the
  `isCompaction || directBudget` early return keeps side calls from ever
  throwing it.
- **Panel handling of a completed turn carrying errorKind.** Settled by the
  test above: the `turn/completed` dispatcher keys off `terminal` only, so a
  limit stop is handled exactly as a completion; the limit itself is
  communicated by the host's warning backend notice, not by a failure row.

### Team-worker binding proof (P2-1)

`runEngineWorker` has no production caller in `src` today (only its prompt
and routing helpers are imported elsewhere), so there is no team production
site to bind. The README sentence ("best-of-N attempts and team-task
ceilings" replace the default) rests on the shared mechanism, which is true
as written: `runEngineWorker` (`engineWorker.ts:340`) builds a
`WorktreeConversationHost`, and `WorktreeConversationHost.run()` binds the
remaining-task ceiling through the now-required
`session.setModelCallAllowance(...)` (bound at `worktreeConversationHost.ts`
170, cleared at 254). Best-of-N exercises the same binding in production
through `bestOfNManager` → `AttemptSession`. When a team production caller
lands, the compiler enforces the binding through the required port.

### Round-2 verification

Ran on macbook at repo default timeouts, `--maxWorkers=3`, ≤3 files per run
(round-2 deltas only; round-1 totals stand above):
`toolRounds` + `toolRoundsCodecs` + `modelApiGoldenRequests`: 166 passed
(the golden suite keeps every fixture byte-exact except the re-recorded
wrap-up). Plus `modelApiAutoCompact`, `modelApiHost` (672),
`modelApiLoopGuarantees` (45), `conversationController` (689), `execRun`,
`agentOutcome`, `bestOfNManager`, `worktreeConversationHost`,
`teamEngineWorker`, `teamWorkerFence`, `acpModelApi`. Typechecks
(`tsconfig.json`, `test/unit/tsconfig.json`), ESLint on changed files,
prettier, `check:l10n` (0 problems, 3 new keys in `en.ts` + 14 translated
tables), `check:reference` pass.
The second review
(`/tmp/claude/c--Users-Randy-Coding-muse-extension/f5e67bec-452c-4384-85e7-efedc257d060/scratchpad/codex/RVTOOLROUNDS.report.md`)
was absent on this machine at final check, so only the by-reading review is
answered here. Suites not run on this rig are listed in the final message.

## Round 3 — review RVAPP-TOOLROUNDSR2B (0 P1, 4 P2, 6 P3)

Redesign, per the lead's round-3 rulings: the wrap-up was special cases at
many points of the loop, and each review found the next missed point. Every
finding below is fixed across its whole class; each fix has a regression
test that fails without it and a red drill recorded here. Drill restoration
is verified byte-exact (`git diff`/`git status` empty) in every row. No new
dependency; no cap or pin moves; the golden request suite stays
byte-identical for every request including the wrap-up (Meta wire unchanged:
`10-turn-limit-wrap-up.json` untouched).

### R1 — the wrap-up is one phase with one exit (P2-A, P3-1, P3-2)

`turn.wrapUpLimit` is the single explicit phase value: `undefined` is
ordinary, set is the wrap-up. It is written only by `enterWrapUpPhase`
(loop top, and the last-slot `beforeRetry`); every other site reads it.
The phase has exactly one exit, `finishWrapUp`, which always produces the
same typed outcome — completed, `errorKind: max_turn_requests`, stop reason
`limit` (terminal agent: `request_cap`, exit 5) — and always re-queues held
input first. Decided interpretation, stated plainly: a user stop racing the
request itself still cancels (no wrap-up answer exists then); a hook
cancelling the turn after the answer streamed converges on the typed exit,
as does every other in-phase ending.

| Site                                             | Ordinary phase                                                                                                    | Wrap-up phase                                                                                                                                | Test                                                                                                                                                                                 |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Request builder (`body()`)                       | Builds with tools; no note                                                                                        | Reads the phase only (the old setter is deleted): appends the note, declares `tools: []`                                                     | Codec byte-identical test; golden `10-turn-limit-wrap-up`                                                                                                                            |
| Phase entry (loop top)                           | Drains steers + goal wake, sends with tools                                                                       | Sets the phase once per round; skips both drains                                                                                             | Drill D3 (no entry → wrap-up tests fail); steer/scheduled/wake tests                                                                                                                 |
| Steer drain, loop top                            | `drainSteered` admits input into the request                                                                      | Skipped: held input is never consumed                                                                                                        | `holds steering arriving before the wrap-up for its own turn with tools`                                                                                                             |
| Steer drain, `streamAttempt` (the sibling, P3-1) | Admits a pending scheduled run into the request                                                                   | Skipped when the phase is set                                                                                                                | `holds a scheduled steer arriving before the wrap-up for its own turn with tools`                                                                                                    |
| Goal wake (`drainGoalWake`)                      | Pushes the cue into the request                                                                                   | Early return: the one exit re-queues it                                                                                                      | `re-queues a goal wake held across the wrap-up for its own turn`                                                                                                                     |
| Compaction prefix + `noteRequest`                | Stored + counted per ordinary request                                                                             | Skipped by the shared phase branch                                                                                                           | Shared-branch analysis (see P3-2 note below); prefix half of `compaction after a limit stop reuses the last ordinary body`                                                           |
| Compaction token count (`noteUsage`)             | Stored onto the ordinary prefix                                                                                   | Skipped via `isSendingWrapUp` (set at the send, cleared after)                                                                               | Same analysis (see P3-2 note below)                                                                                                                                                  |
| Reviewer (`autoReview`)                          | Never runs inside the wrap-up (no tools to review); the slot gate below keeps it off a nearly-spent caller ledger | Same: no tools, no run; gate unchanged in shape                                                                                              | `spends no reviewer call on the reserved wrap-up slot` (fires); reviewer needs no wrap-up-specific test (see gate row)                                                               |
| Hook models                                      | Run on direct budget where the gate allows                                                                        | Same path; the reserved-slot gate (R2) decides before any popup/tally                                                                        | `fails the hook-model call while the wrap-up slot is reserved…`; `still runs the Stop hook model on a wrap-up turn with no caller allowance`                                         |
| The one exit (`finishWrapUp`)                    | N/A (ordinary exhaustion keeps its own post-loop path)                                                            | Plain answer, truncated answer (own sentence via `limitError`), Stop-blocked (notice), Stop `continue:false`, hook-cancel: all converge here | `keeps the typed limit when a Stop hook answers continue:false on the wrap-up`; `stops a wrap-up cut at the output limit with its own sentence, never "again"`; block test (round 2) |

### R2 — a hook model that was not asked did not answer (P2-B, P3-3)

Exact gate condition (`isWrapUpSlotReserved`): a caller allowance
(`modelCallAllowance`, else exec's `remainingModelCalls`) EXISTS, and the
turn's remaining — its own limit folded with that allowance — is one call
(no active turn: the allowance itself is one). Reviewer and hook-model
calls use the direct budget and never touch the turn's own count, so in an
interactive turn with no caller allowance they cannot take the slot and the
gate stays off. A skipped hook-model call is a FAILED hook answer with its
own reason, checked in `runModelHandler` before the paid popup and the
tally (forwarded through the dispatch site, which the first drill caught
missing): nothing is asked, nothing is counted for a call that is not
made, and the hook's own on-failure rule decides. The host-side check
behind it now throws instead of returning empty text, so a bypass fails
closed into the same `failed` path.

| Side                                                              | Test                                                                                                                                                                                                                                                           | Drill                                                                                                           |
| ----------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Gate fires (allowance 1, UserPromptSubmit before any call)        | `fails the hook-model call while the wrap-up slot is reserved, asking and counting nothing` (warn text, no hook-marked request, popup + `hookModels` tally untouched) + `fails a reserved-slot run before the popup and the tally` (`hookModelHandlers`, unit) | D6: drop the dispatch-site forward → reservation test fails (popup asked, host-throw path); restored byte-exact |
| Gate stays off (interactive, no allowance, turn at its own limit) | `still runs the Stop hook model on a wrap-up turn with no caller allowance` (199 rounds + wrap-up; exactly one hook-marked request; stop stays typed)                                                                                                          | D7: drop the no-allowance early return → side-B test fails (no hook request); restored byte-exact               |

### R3 — the wire is what the golden says (P2-C, P3-5)

Per-codec decision (no guessing; kept what was captured as accepted):
Meta's first-party wire carries `tools: []` with `tool_choice: auto` —
the golden IS the raw fetch body, and M105's live captures show the
service echoing exactly that shape on tools-less responses. The Responses
codec reverts the round-2 omission to that same captured shape: no live
capture of an omitted choice succeeding exists on that family. Chat,
Anthropic, Gemini and Ollama keep omitting per their long-standing
production shapes (unchanged since before this lane). P3-5 side effect,
stated and kept deliberately: the git-draft side call and compaction
without reused tools on configured OpenAI/xAI providers and the ChatGPT
route send what they always sent (`tools: []` + `auto`; namespace-wrapped
on the ChatGPT profile). Locked by `Responses %s keeps empty tools with
the choice, the captured wire shape` (api + chatgpt). Drill D8: restore
the omission → both profiles fail (`expected undefined to be 'auto'`);
restored byte-exact. Code, goldens, Piece-2 table and prose (README
Limits, CHANGELOG, reference) agree.

### R4 — team-task ceilings must be true of something that runs (P2-D, P3-6, P3-4)

`runEngineWorker` still has no caller in `src`; teams stay switched off
for another lane. So the ceiling sentence leaves README and CHANGELOG
(the true remainder stands), and returns with the teams wiring lane: that
lane binds team tasks through `AgentSession.setModelCallAllowance`, now a
REQUIRED member so the compiler lists every implementer (`MuseSession`
gains the intentionally-empty member with a reasoned disable + §8 row;
`AttemptSession` forwards directly, no `?.`). Drill D9: delete the member
→ host typecheck fails naming `MuseSession` on three seats; restored
byte-exact. The `?.`-to-`.` forwarding itself has no behavioral red test
(every implementer now carries the member); D9 covers the class.
Contract written where ruled: reference (`referenceTurnLimit` +
regenerated `docs/reference.md`; `check:reference` passes), CHANGELOG
(wrap-up answer exit 5; first-call answer exit 0), README Limits
(unchanged, already said it).

### P3-2 measurement note (why two rows have analysis, not tests)

All three measurement guards are in place and every site reads the phase.
Red-proof exists for the phase mechanism (D1–D5). Two independent
black-box discriminators were attempted and both provably cannot fail,
so no decoration test was added:

- Token count: the stored value is always replaced before any read. The
  prefix object is rewritten on every ordinary send, and a new turn's
  first request is always ordinary (`modelCalls` 0), so the wrap-up's
  tokens never survive to an evaluation. Verified by two no-red drills
  (plain huge usage; huge usage + usage-less follow-up): admissions 0
  with and without the guard. The guard stays as hygiene.
- `noteRequest`: the only counter gate is the cooldown
  (`AUTO_COMPACTION_COOLDOWN_REQUESTS = 2`, inclusive, consumed inside
  `decide`), and a wrap-up needs a prior ordinary call, so a
  discriminating 1-vs-2 count at a transition evaluation is unreachable:
  any evaluation follows a request (inclusive admit in both cases), and
  overflow recovery bypasses the gate. The guard shares its exact branch
  with the prefix row.

### Round-3 drills ledger

| Drill                 | Break                                                           | Named test fails                                                                                                                                 | Restore           |
| --------------------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------- |
| D1                    | Wrap-up branch `finishWrapUp` → bare `return` (the P2-A bug)    | `keeps the typed limit when a Stop hook answers continue:false` (completed, errorKind missing)                                                   | Byte-exact        |
| D2                    | Sibling `streamAttempt` drain drops the phase check             | `holds a scheduled steer arriving before the wrap-up`                                                                                            | Byte-exact        |
| D3                    | Loop-top `enterWrapUpPhase` removed                             | `holds steering arriving before the wrap-up`                                                                                                     | Byte-exact        |
| D4                    | `finishWrapUp` drops the goal-wake requeue (the P2-A loss)      | `re-queues a goal wake held across the wrap-up` (wake never arrives)                                                                             | Byte-exact        |
| D5                    | Shared prefix/`noteRequest` branch removed                      | No test fails: manual-compaction bodies are identical by design (instructions byte-identical, tools from the fresh body) — recorded, not a proof | Byte-exact        |
| D6                    | Dispatch-site `isTurnCallReserved` forward dropped              | `fails the hook-model call … asking and counting nothing` (popup asked, host-throw path)                                                         | Byte-exact        |
| D7                    | Gate's no-allowance early return dropped                        | `still runs the Stop hook model … with no caller allowance` (zero hook requests)                                                                 | Byte-exact        |
| D8                    | Responses omission restored                                     | `Responses %s keeps empty tools with the choice` (api + chatgpt)                                                                                 | Byte-exact        |
| D9                    | `MuseSession.setModelCallAllowance` deleted                     | Host typecheck fails naming the implementer                                                                                                      | Byte-exact        |
| D10                   | `AttemptSession` forward back to `?.`                           | No test fails (every implementer carries the member); D9 covers the class                                                                        | N/A (not applied) |
| Token-count probes ×2 | Guard removed under huge wrap-up usage (± usage-less follow-up) | No test fails: stored value always replaced before any read (see analysis) — recorded, not a proof                                               | Byte-exact        |

Bundle rows in exact bytes (`npm run build` green, budgets untouched, no
cap or pin moves), base 26a1c5537 → lane: `dist/extension.js` 564049 →
564075 (+26: the Muse Code no-op member and direct forwarding),
`dist/modelApi.js` 535629 → 536119 (+490: the phase, the one exit, the
narrowed gate), `dist/modelApiHooks.js` 28520 → 28520,
`dist/modelApiSessions.js` 37318 → 37318.

## Next slice

Release-train integration and cross-platform/browser certification follow the
completed lane. No live or paid provider call is authorized here.
