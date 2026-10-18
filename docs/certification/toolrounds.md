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

| Codec family                                                    | Toolless wire shape                                                                                                                          |
| --------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Meta/direct Responses                                           | Empty tools, `tool_choice: auto` (the side-call shape)                                                                                       |
| OpenAI/xAI Responses                                            | Empty tools, `tool_choice: auto` (kept deliberately; see above)                                                                              |
| ChatGPT Responses                                               | Empty namespace, `tool_choice: auto` (kept deliberately)                                                                                     |
| Chat completions (OpenRouter, OpenAI-compatible vendors/custom) | No tools declared and no `tool_choice` field at all — UNVERIFIED (no live capture; shape from the codec, mirrors the long-standing omission) |
| Anthropic Messages                                              | Omit tools and tool choice                                                                                                                   |
| Gemini generateContent                                          | Omit tools and toolConfig — UNVERIFIED (no live capture; shape from the codec, mirrors the long-standing omission)                           |
| Ollama chat                                                     | Omit tools and unsupported tool choice                                                                                                       |

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
worktree attempts bind their own remaining task ceiling (the engine worker
carries the same binding in code, with no production caller yet).
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
The 200-call default is proved in the memory engine. Production ACP binds
no caller allowance: the ACP runtime test binds a three-call allowance by
hand and proves answer delivery and `max_turn_requests` under a caller cap.
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
site to bind and no production ceiling claim: the binding lives in code
only. `runEngineWorker` (`engineWorker.ts:340`) builds a
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

## Round 4 — the typed limit reaches every consumer (TOOLROUNDSR4)

The one exit's typed outcome (completed + `max_turn_requests`, stop reason
`limit`) is the only ceiling signal, and every consumer below reads it. The
two `bestOfNAttempts` contract tests stand unchanged and pass: a capped
attempt is `failed` with `ceilingReached: true`, the exact paid count and
the wrap-up text, and an HTTP retry counts before it runs while the next
paid request is blocked.

| Consumer                                                              | What it read before round 2                                                                                                                                                       | What it reads now                                                                                                                                                                                                                                                            | The test (really ends by the limit)                                                                                                                                                                                                                                                                   |
| --------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Best-of-N manager + attempt record (`bestOfNRunner`, `AttemptDriver`) | The synchronous admission-guard count, plus the worktree host's `session.cancel()` at the ceiling; the completion path ignored the typed outcome and recorded an ordinary success | A `completed` event carrying `ceilingReached` settles the attempt as `failed` with the typed reason, the exact paid count and the wrap-up text; `take()` only takes `completed`, so a capped attempt can never win; the admission guard stays as the pre-dispatch block only | `bestOfNAttempts`: both contract tests (5 requests against a ceiling of 5, 4 HTTP retries + 1 success); `bestOfNManager`: `fails a turn that ends at the limit and never takes it as the winner`; `bestOfNExtensionHooks`: capped settles failed with no keep-working (contract updated, intent kept) |
| Worktree conversation host                                            | Counted `modelRequestCompleted` against the ceiling, then `session.cancel()`                                                                                                      | Binds the ceiling through the required `setModelCallAllowance` port and reads `errorKind === 'max_turn_requests'` on `turnCompleted`; the count path stays for progress/admission tallies only                                                                               | `worktreeConversationHost`: `binds the ceiling through the allowance port and marks a limit stop` (5 requests at a ceiling of 5, then the typed outcome; asserts no cancel)                                                                                                                           |
| Unattended / headless runs (exec)                                     | `errorKind` on `turnCompleted` → `limit`/`requests` event and `request_cap` exit 5                                                                                                | Same, plus the wrap-up answer is kept as the final message                                                                                                                                                                                                                   | `execRun`: D7 (2 requests at `--max-requests 2`), the single-call pair (answer exit 0 / tool-call cap exit 5), the 60-request wrap-up run (all 60 admitted, last body tools-disabled)                                                                                                                 |
| Terminal agent                                                        | Round-2 contract: `--max-requests 1` answer exits 0, tool-call exits 5 at the cap, plainly                                                                                        | Verified unchanged (same rows as exec above)                                                                                                                                                                                                                                 | Same single-call pair                                                                                                                                                                                                                                                                                 |
| Scheduled runs                                                        | The background target tracked idle only; the delivery contract forbids inferring success from `turnCompleted`; settlement comes from the injected `runs.run`                      | Unchanged; pinned that a completed turn carrying the typed outcome settles the slot without any success/failure judgment                                                                                                                                                     | New `scheduleBackgroundTarget`: `releases the target when the scheduled turn ends at the model-call limit`; `delivery`/`scheduleInterrupt` suites unchanged                                                                                                                                           |
| Sub-agents                                                            | The parent read the child's typed `outcomeStopReason` (`limit`) and the forwarded `errorKind`                                                                                     | Same                                                                                                                                                                                                                                                                         | `modelApiHost`: `records a child call-limit stop with its own stop reason, not a money stop` (child really ends by the limit on the shared allowance of 2; evidence `stopReason: 'limit'`, never `budget`)                                                                                            |
| Team tasks (ACP / Muse Code workers)                                  | The wire/peer `stopReason` through `reportForStop` → `capped`                                                                                                                     | Same                                                                                                                                                                                                                                                                         | `teamAcpProcess` RVM96W2C-N6 (`max_turn_requests` → `capped`) and the `teamMuseCodeWorker` stop mapping                                                                                                                                                                                               |
| Team tasks (engine worker)                                            | Nothing: `runEngineWorker` ignored `outcome.ceilingReached` when resolving the report (no production caller on this branch)                                                       | A `ceilingReached` outcome resolves through `reportForStop(text, 'max_turn_requests')` → `capped`, keeping the wrap-up text                                                                                                                                                  | New `teamEngineWorker`: `reports a worker that ends at its ceiling as capped with the wrap-up text` (5 requests at a ceiling of 5)                                                                                                                                                                    |
| Reviewer (Auto reviewer + hook models)                                | The terminal only: a completed turn carrying the typed outcome would decide with a truncated reply                                                                                | Completed turns carrying `max_turn_requests` are recorded and their replies treated as unusable: the review fails to the user (side session survives) and the hook gets no answer                                                                                            | New `museCodeReviewer` wire-true test (captured reply streams, `turn/completed` carries `error: { kind: 'max_turn_requests' }` through the real host mapping; next review reuses the session) and new `museCodeHookModels` discard test                                                               |
| ACP                                                                   | `settle` resolves the typed outcome to the `max_turn_requests` stop for the client                                                                                                | Same; the client sees `stopReason: 'max_turn_requests'` with the wrap-up text delivered as the final agent message                                                                                                                                                           | `acpModelApi`: `delivers the real Model API wrap-up over ACP under a hand-bound caller cap` (allowance 3 bound by hand — production ACP binds none; 3 requests, last body tools-disabled)                                                                                                             |

### Round-4 drills ledger

| Drill | Break                                                                                     | Named test fails                                                      | Restore                                           |
| ----- | ----------------------------------------------------------------------------------------- | --------------------------------------------------------------------- | ------------------------------------------------- |
| D11   | Runner capped branch `event.ceilingReached` → `&& requestsMade > 9000`                    | `bestOfNManager`: `fails a turn that ends at the limit…`              | Byte-exact (SHA-256 `e89b1eae…` before and after) |
| D12   | Reviewer `limited` check removed from the `until` clause                                  | `museCodeReviewer`: `…ends at the model-call limit`                   | Byte-exact (`6ba8e82c…`)                          |
| D13   | Hook-model `!isLimited` removed from `look`                                               | `museCodeHookModels`: `discards a reply cut at the model-call limit…` | Byte-exact (`5d8b8d57…`)                          |
| D14   | Engine-worker capped branch `outcome.ceilingReached` → `&& lastMessage === 'unreachable'` | `teamEngineWorker`: `reports a worker that ends at its ceiling…`      | Byte-exact (`3d5413f3…`)                          |

The `bestOfNExtensionHooks` keep-working test pinned the pre-ruling
contract (a `ceilingReached` completion recorded as `completed`); it now
asserts the ruling contract (failed with the ceiling flag, hook never
asked). Its intent — no continuation past the ceiling — is unchanged.

### Round-4 verification

Ran on macbook at repo default timeouts, `--maxWorkers=3`, one command at
a time: `bestOfNAttempts` (3), `bestOfNManager` (6), `bestOfNRunner` (46),
`bestOfNExtensionHooks` (7), `worktreeConversationHost` (9),
`toolRounds` (19), `modelApiLoopGuarantees` (45), `teamEngineWorker`
(23), `teamWorkerFence` (54), `museCodeReviewer` (44),
`museCodeHookModels` (4), `scheduleBackgroundTarget` (38), `execRun`
(98), `acpModelApi` (13), plus the cited `modelApiHost` child-limit test
(1 selected) and two `vitest related` sweeps over the five changed source
files (770 + 1003 passed; the only failure, `teamMcpBridge`, is
environmental — see below). Five typechecks pass; ESLint and prettier
clean on every changed file; knip shows only its two pre-existing config
hints. `npm run build` exits 0; no cap or pin moves.

Bundle rows in exact bytes (frozen base `9d2d49893` built in temp space
against the shared modules, vs this lane): `dist/sessionBoard.js` 48443
→ 48636 (+193: the runner's capped-attempt branch);
`dist/museCodeReviewer.js` 23159 → 23406 (+247: the reviewer's
limited-turn set and the hook-model limit flag). Everything else is
byte-identical, including `dist/extension.js` (564075 of 614400),
`dist/modelApi.js` (536119 of 537600), `dist/modelApiHooks.js` (28520)
and `dist/modelApiSessions.js` (37318): the engine-worker capped-report
branch ships no bytes today because `runEngineWorker` still has no
production caller (the tests pin it for the teams wiring lane), and the
worktree-host edit is a comment.

- NOT RUN HERE: `test/unit/teamMcpBridge.test.ts` (43 tests). The file
  binds `127.0.0.1` listeners and this sandbox denies it (`EPERM`,
  `syscall: 'listen'`, observed directly), so every test fails before any
  lane logic runs. Untouched by this lane (no MCP, socket or worker-shell
  code in the diff). The lead runs it outside the sandbox.
- Browser suites were never selected (MacBook rule).

## Round 5 — the agent packs again: locale key order matches English (TOOLROUNDSR5)

`scripts/package-acp.mjs` exits 1 on this branch because
`scripts/check-l10n.mjs --packaged-acp` reports
`packaged l10n/ui.<locale>.json: differs from source` for all 14 locales, so
`npm pack` of the agent fails. The values are all correct; only the key
order differs. The UI archive stores values in the English layout
(`tableLayout(EN)` in `scripts/lib/packedL10n.mjs`) and the reader restores
the English order (`reorder(EN, …)` in `src/shared/l10n/tableArchive.ts`),
so the decoded table is always in English order while the locale files kept
this lane's added keys where rounds 2–4 appended them. The packaged gate
compares `JSON.stringify(shipped)` with `JSON.stringify(source)`, which is
order-sensitive, so a misordered locale file can never match.

Why source mode missed it: there was no order rule to fire. `tableProblems`
(`src/shared/l10n/check.ts`) checked keys, slots, plural forms, markup and
untranslated text, but never key order — the packaged stringify comparison
was the only order-sensitive check, and a sandbox cannot run `npm pack`.
That is the class defect, not a broken rule beside which a second one was
added.

### The fix

`tableProblems` now requires the English key order at every group level
when `isStrict` is set, reporting the first misordered key per level as
`<path>: out of order; it must follow "<predecessor>" in the English
table`. Both gate modes already call `tableProblems` strictly
(`checkTables` for source, `checkPackaged` for the archive), so the one
comparison governs both and they cannot drift again. All runtime callers
(`src/host/l10n.ts`, `src/webview/installTable.ts`,
`src/runtime/reporting/reportsEntry.ts`, `src/shared/l10n/usageTable.ts`,
`src/shared/l10n/vaultEnglish.ts`) use `isStrict: false` and are
unchanged; plural-form internals are one packed value and keep the file's
own order, exactly as the pack pipeline treats them. Usage tables and
`package.nls.<locale>.json` go through the same strict function, but their
package-time comparison stores them verbatim (JSON round-trip preserves
order), so order never broke their packaging; they are covered by the same
rule for uniformity, and all 14 `package.nls` files were already in order.

All 28 locale files were reordered by a script (kept outside the repo: it
derives the order from `EN`/`USAGE_EN` through `scripts/lib/l10nSource.mjs`,
the same source `packRuntimeArchive` uses; values untouched, plural leaves
verbatim, canonical 2-space JSON asserted per file before writing). Pair
counts (dotted path → value), identical before and after:

| Family | zh-cn | zh-tw | ja   | ko   | de   | fr   | es   | pt-br | ru   | it   | tr   | pl   | cs   | hu   |
| ------ | ----- | ----- | ---- | ---- | ---- | ---- | ---- | ----- | ---- | ---- | ---- | ---- | ---- | ---- |
| ui     | 4630  | 4630  | 4630 | 4630 | 4786 | 4942 | 4942 | 4942  | 5098 | 4942 | 4786 | 5098 | 5098 | 4786 |
| usage  | 190   | 190   | 190  | 190  | 202  | 214  | 214  | 214   | 226  | 214  | 202  | 226  | 226  | 202  |

(Counts differ per locale because plural categories expand per language.)

Older keys out of order too: yes — every `l10n/usage.<locale>.json` had
`deleteHistory` before `readOnlyActions` (predates this lane), fixed the
same way in the same pass. Every `l10n/ui.<locale>.json` had exactly the
two diffs from this lane (top-level `execRequestCapReached` block after
`modelApiWrapUpHookBlocked`; `agentStopReasons.error` after `limit`) and no
older disorder. `node ~/lanes/_ctx/codex/l10n-pack-diag.mjs` prints
`equal=true`, 2966/2966 keys, 0 value diffs for all 14 locales.

### Tests

- `test/unit/l10n.test.ts`: order-rule cases (top level, nested, each with
  its sentence; non-strict ignores order; missing keys compare over the
  intersection). Red before the rule (2 failed, 27 passed), green after
  (29 passed).
- New `test/unit/l10nPackParity.test.mjs`: packs the real tables with
  `packRuntimeArchive` into a temp folder (regions generated from the
  canonical `EN`, as `vsixPackaging` does for CI, which has no `dist/`) and
  proves every decoded table equals its source, one line per locale on
  failure. Red on the unordered tree (14 failed), green after the reorder
  (14 passed). The temp write works in this sandbox
  (`os.tmpdir()`); no part was left for the lead on those grounds. Setup
  carries `PACK_SETUP_TIMEOUT_MS` (30 s; 7.1 s measured packing at
  production brotli quality on macbook) with a `PLAN.md` §8 row; the
  assertions stay on the default deadline, and the final run uses the
  repository's own timeout.
- `test/unit/vsixPackaging.test.mjs` 95/95, including the order-sensitive
  `round-trips %s byte-exact` cases.

### Round-5 drill ledger

| Drill | Break                                                          | Named test fails                                                                                                                                                              | Restore                                           |
| ----- | -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| D15   | `agentStopReasons.limit` moved to the end in `l10n/ui.de.json` | `npm run check:l10n`: `l10n/ui.de.json: agentStopReasons.error: out of order; it must follow "limit" in the English table` (1 problem); `l10nPackParity`: 1 failed, 13 passed | Byte-exact (SHA-256 `9076a5b0…` before and after) |

### Round-5 verification

Ran on macbook at repo default timeouts, `--maxWorkers=3`, one command at
a time: `check:l10n` 0 problems; `l10n` (29), `l10nPackParity` (14),
`l10nPacked`, `usageL10nTables`, `mediaLocalization`,
`usageL10nGate`, `hostL10n`, `installTable`, `questionStrings`,
`teamSchedulerText`, `teamConstants`, `teamTables`, `providersL10n`,
`usageTable`, `browserUiText`, `uiTextRegions`, `reportStrings`,
`reportsEntry`, `providersXFix`, `vsixPackaging` (95) — all green.
Typechecks `unit`, `host`, `webview` pass; ESLint and prettier clean on
every changed file. `npm run build` exits 0 with all size/split gates
green.

Bundle rows in exact bytes (production build of `df7b7a44b` in temp space
vs this lane): `dist/extension.js` 564075 → 564496 (+421),
`dist/reporting.js` 149573 → 149994 (+421), `dist/acp.js` 241039 →
241460 (+421), `dist/usageCompanion.js` 42914 → 43335 (+421),
`dist/usageService.js` 92470 → 92891 (+421), `dist/usagePanel.js` 73747 →
74168 (+421), the webview `installTable` chunk `ET252KUF.js` 2296 →
`E66EXWA4.js` 2715 (+419; the name is the content hash). Everything else is
byte-identical, including `dist/modelApi.js` (536119, SHA-256 `6f4308db…`
both sides) and `dist/uiText.js` (97368): the locale reorder is data only.

- NOT RUN HERE: `test/e2e/execStdio.e2e.test.ts` (the lead reruns it
  outside the sandbox); `test/unit/usagePackaging.test.mjs`'s
  `ships the service … in the actual tarball` (its nested `npm pack`
  dies writing `/Users/user/.npm/_logs`, denied by this sandbox before
  any lane code runs; the other 11 pass); browser suites were never
  selected (MacBook rule).

## Round 6 — the wrap-up the packed product never lost, and the sentence it never translated (TOOLROUNDSR6)

Round 5 left two red rows in `test/e2e/execStdio.e2e.test.ts`
(`retains the 60-call wrap-up`, en+de, line 931): `finalMessage: ""`
where the wrap-up was expected, and the `-de` stop sentence in English.
Both reproduced on macbook with
`NPM_CONFIG_CACHE="$TMPDIR/npm-cache" npx vitest run
test/e2e/execStdio.e2e.test.ts -t 'retains the 60-call wrap-up'`.

Cause 1 (empty wrap-up): the e2e fake answered only a wrap-up shaped
`tool_choice: 'none'`, which the product never sends — the golden
capture `10-turn-limit-wrap-up.json` pins empty tools with the choice as
ever (`auto`), instructions byte-identical and the limit note as the
trailing input item — so all 60 scripted replies were tool calls, the
wrap-up phase skipped them, and no answer text existed to keep. A probe
driving worktree `dist/` directly confirmed the product sends the
golden shape (5-request cap: last body `auto`/0 tools with the
developer note `This turn has reached its limit of 5 model calls…`)
and retains `finalMessage` once the fake answers that shape.

Cause 2 (English stop sentence): `src/runtime/exec/execEntry.ts`
installed the run table into its own `dist/exec.js` copy of
`src/shared/l10n/text.ts`, while `runExec` reads the
`dist/headless.js` copy, which stayed English — and the engine
(`engine.setUiText(UI_TEXT, uiLocale())` in `runExec`) inherited
English from it. Only `en.ts` is externalized (`sharedUiText`
plugin); the mutable table state was never shared.

### Fixes

- `execEntry.runHeadless` installs the table into both copies: its
  own (which the split gate requires on the shared English table) and
  the headless bundle's own `setUiText` (re-exported from `runExec`;
  the static import is externalized to `./headless.js` by
  `deferredCohort`), so the engine inherits the run language too. No
  new bundle, no new key.
- The e2e fake matches the golden shape (empty tools plus the trailing
  input note) and its report pins `toolChoice: auto`, per-request note
  presence, and byte-identical instructions (one hash over all 60).
- New packed rows pin the budget-minimum and unknown-model sentences in
  en+de; new `execRun` unit rows pin the request-cap, budget-minimum,
  unknown-model and withheld sentences in en+de (the single-call cap
  keeps `finalMessage: ''` — no answer exists before the first call).

### Per-consumer proof (round-4 table, this round's class)

BUILT = through the packed product; UNIT = in-source unit test over
the same function the product calls (named), with no bundle-local
mutable state and no fake-modelled wire shape on that path (measured:
the ceiling files below carry no `UI_TEXT`, except the noted notice
off the ceiling path).

| Consumer                               | Kind                | Proof                                                                                                                                                                                                                                                                                                                                  |
| -------------------------------------- | ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unattended / headless runs (exec)      | BUILT               | Fixed e2e toolrounds rows: 60 real requests through packaged `dist/acp.js` + `headless.js` + `runtimeEngine.js`, en+de                                                                                                                                                                                                                 |
| Terminal agent                         | BUILT               | Same rows (round-4: terminal runs are the same packed exec binary)                                                                                                                                                                                                                                                                     |
| Scheduled runs                         | UNIT same-path      | `scheduleBackgroundTarget` releases the target on the typed limit outcome; settlement reads the injected `runs.run`, plain data only                                                                                                                                                                                                   |
| Sub-agents                             | UNIT same-path      | `modelApiHost` child-limit stop (`outcomeStopReason: 'limit'`); same `ModelApiHost.finishWrapUp` the packed engine runs                                                                                                                                                                                                                |
| Team tasks (ACP / Muse Code workers)   | UNIT same-path      | `teamAcpProcess` RVM96W2C-N6 and the `teamMuseCodeWorker` stop mapping through `reportForStop` (pure `max_turn_requests` → `capped`; `report.ts` has no `UI_TEXT`)                                                                                                                                                                     |
| Team tasks (engine worker)             | UNIT same-path      | `teamEngineWorker` capped report with the wrap-up text, same `reportForStop`                                                                                                                                                                                                                                                           |
| Reviewer (Auto reviewer + hook models) | UNIT same-path      | `museCodeReviewer` wire-true limit test and `museCodeHookModels` discard test read the typed `errorKind` on `turn/completed`; `museCodeReviewer.ts` has no `UI_TEXT`, and the hook file's only use (`hookModelMuseCodeNotice`) is a notice off the ceiling path                                                                        |
| Best-of-N manager + attempt record     | UNIT same-path      | `bestOfNAttempts` / `bestOfNManager` / `bestOfNRunner` / `bestOfNExtensionHooks` settle the `ceilingReached` event flag; `bestOfNRunner.ts` has no `UI_TEXT`                                                                                                                                                                           |
| Worktree conversation host             | UNIT same-path      | Allowance-port test (`setModelCallAllowance`, `errorKind === 'max_turn_requests'`); `worktreeConversationHost.ts` has no `UI_TEXT`                                                                                                                                                                                                     |
| ACP                                    | UNIT + BUILT-engine | `acpModelApi` delivers the wrap-up through the real `createAcpAgent` + `ModelApiHost` (allowance 3, last body tools `[]` / choice `auto`); the settle mapping (`src/acp/agent.ts`, `errorKind` → `stopReason`) is a pure function of the event, and wrap-up retention inside the packed engine bundle is proven by the exec rows above |

Language sweep: every `error.message` / `finalMessage` sentence the
exec result carries on the fast paths (`request_cap` limit sentence,
`budget_exceeded` minimum, unknown-model refusal, withheld answer) is
pinned in en+de in the unit table and, for the packed product, in the
toolrounds, budget-minimum and unknown-model rows. The remaining
`stopMessage` branches read the same now-installed headless copy; no
second install exists.

### Round-6 drill ledger

| Drill | Break                                                              | Named test fails                                                           | Restore                                           |
| ----- | ------------------------------------------------------------------ | -------------------------------------------------------------------------- | ------------------------------------------------- |
| D16   | `execEntry` installs the entry's own table copy again (revert fix) | Packed `store-de` budget + unknown-model rows fail (English sentences)     | Byte-exact (SHA-256 `e7270626…` before and after) |
| D17   | E2e fake wrap condition back to `tool_choice === 'none'`           | Both toolrounds rows fail with the original signature (`finalMessage: ""`) | Byte-exact (`65a40c63…`)                          |
| D18   | `ModelCallLimitError` default message prefixed                     | Unit stop-sentence rows fail in en+de                                      | Byte-exact (`571c5302…`)                          |

### Round-6 verification

Ran on macbook at repo default timeouts, `--maxWorkers=3`, one command at
a time: `test/e2e/execStdio.e2e.test.ts` full file (50 tests);
`test/unit/execRun.test.ts` full file; typechecks `unit` (test project)
and main; ESLint and prettier clean on every changed file;
`npm run check:l10n` 0 problems; `npm run build` exits 0 with all
size/split gates green.

Bundle rows in exact bytes (worktree `dist/` built from `b61272dbd`
vs this lane, `npm run build` exit 0, size and split gates green):
`dist/exec.js` 1407 → 1428 (+21: the headless copy's installer beside
the entry's own). Everything else byte-identical, including
`dist/modelApi.js` (536119, SHA-256 `6f4308db…` both sides),
`dist/headless.js` (100345), `dist/runtimeEngine.js` (643688),
`dist/acp.js` (241460) and `dist/uiText.js` (97368).

- NOT RUN HERE: browser suites were never selected (MacBook rule).

## Round 7 — one place per rule: the last call is always the wrap-up; a capped turn is never finished (RVAPP-TOOLROUNDS6)

Review verdict: 0 P1, 2 P2, 4 P3, "safe to ship: no". Both P2 were the
same failure of method as in earlier rounds: a rule enforced site by
site, the review finding the next site. This round moves each rule to
one place. Commits: Part A `4aab82629`, Part B `1bd2ccd25`, Part C
`8d06136cd` (all on `fix/tool-rounds`; this section's commit follows
the Prove receipts).

### Part A — the last permitted call is always the wrap-up (P2-1)

Current design: `enterWrapUpPhase(turn)` is the single writer of
`turn.wrapUpLimit`, called at the top of `streamAttempt` — the one
builder every send path uses. `body()` (and every retry/recovery
rebuild) only reads the phase. The latch needs a call already out
(`turn.modelCalls >= 1`) with one call left: the turn's first request
is always ordinary, even when it is also the last one allowed (an
answer completes the turn; a tool request ends it at the plain
request cap — pinned by `runs the only permitted call with tools` and
`ends the only permitted call that asks for tools at the request cap,
plainly`). `lastRetryRateLimited` on `ActiveTurn` is reset per build
and set in `onRetry` (pacing vs HTTP 429), so `beforeRetry` with no
calls left on a wrap-up throws `wrapUpFailedLimit(rateLimited |
modelError)`. The loop catch converts wrap-up-request failures via the
pure `wrapUpFailedKindFor` (`rateLimited | modelError | budget |
stopped`) to `wrapUpFailedLimit`; `ModelCallLimitError` carries the
optional `wrapUpFailed: WrapUpFailedKind`. New l10n keys
`modelApiWrapUpFailed` (plural) + `modelApiWrapUpFailedReason` in
`en.ts` + all 14 translated tables (key order = English, order diag
green). Guard `scripts/check-wrap-up-request.mjs`
(+ `scripts/lib/wrapUpSingleBuilder.mjs`) fails any second
`wrapUpLimit` writer and any `streamAttempt` that never enters the
phase; wired as `check:wrap-up-request` in `quality:gates`.

Table (`sends the last permitted call as the wrap-up after a $path`,
plus the media-recovery row): last recorded request tools-less with
the note, turn ends with the wrap-up text — yes per cell:

| Send path          | Cap | Last request: no tools + note | Wrap-up text kept |
| ------------------ | --- | ----------------------------- | ----------------- |
| First attempt      | 4   | yes                           | yes               |
| First attempt      | 2   | yes                           | yes               |
| HTTP 429 retry     | 4   | yes                           | yes               |
| HTTP 429 retry     | 3   | yes                           | yes               |
| HTTP 5xx retry     | 4   | yes                           | yes               |
| HTTP 5xx retry     | 3   | yes                           | yes               |
| Whole-stream retry | 4   | yes                           | yes               |
| Whole-stream retry | 3   | yes                           | yes               |
| Media recovery     | 3   | yes                           | yes               |

Overflow recovery has no dedicated success row: the recovery rebuild
goes through the same guard-pinned `streamAttempt` (loop comment says
so; the guard fails a second builder), and the no-room case is pinned
by `leaves a first-call overflow standing on a single-call allowance`
(`failed` / `context_overflow`). When the wrap-up request itself
cannot be completed, the turn ends with the typed limit saying in one
translated sentence that the summary could not be produced and why
(`ends a wrap-up lost to a $kind …`: 429 → `rateLimited`, 400 and 500
→ `modelError`; the 400 cell is P3-3's honest degrade, below).

### Part B — a capped turn is never read as a finished one (P2-2)

One accessor answers "may this turn's reply be used as the answer to
what was asked?": `usableReply(outcome, reply)` in
`src/core/turns/usableReply.ts` yields `{usable: true, reply}` only
for a turn that completed WITHOUT a limit, else `{usable: false,
capped}` (capped vs any other ending distinguished). The two Git
drafts share `replyIfUsable` (same rule, one line). Shape choice: the
wire keeps `terminal: 'completed'` + `errorKind: 'max_turn_requests'`
— the ACP `stopReason` (`src/acp/agent.ts`) and the exec JSON result
(`terminal` / `stopReason` / exit codes) are wire contracts that must
keep today's values — and in-process the reply of a capped turn sits
under the union's differently named branch, so a consumer written
tomorrow that reads the old shape does not compile or does not match.
Guard `scripts/check-usable-reply.mjs`
(+ `scripts/lib/usableReplyGuard.mjs`) fails any `terminal ===
'completed'` comparison outside the accessor and a 10-entry
allow-list with a reason per entry (pure display, exec/ACP wire
accounting, the engine's own event, and attempt-level outcomes with
their own capped flag — e.g. `bestOfNRunner`'s `ceilingReached`, which
fails a capped attempt so it can never be taken as winner); wired as
`check:usable-reply` in `quality:gates`.

Consumers converted (every one takes its reply through the accessor;
each has a capped-turn test):

| Consumer                                                       | No longer reads as a result | Capped-turn test                                                                    |
| -------------------------------------------------------------- | --------------------------- | ----------------------------------------------------------------------------------- |
| Same-model judge (`museCodeSameJudge.ts`)                      | capped reply as verdict     | `never returns a capped turn reply as a verdict`                                    |
| Playbook review (`panelPlaybook.ts`)                           | wrap-up text as review      | `never consumes a capped turn wrap-up text as a review`                             |
| Git draft, host (`conversationGit.ts`)                         | summary as commit/PR draft  | `never posts a capped turn summary as a commit-message or pull-request draft`       |
| Git draft, runtime panel (`adapter.ts`)                        | summary as draft            | `never settles a capped turn summary as a draft`                                    |
| Auto reviewer (`museCodeReviewer.ts`)                          | truncated reply as verdict  | `leaves the approval to the user when the review turn ends at the model-call limit` |
| Hook models (`museCodeHookModels.ts`)                          | truncated reply as answer   | `discards a reply cut at the model-call limit instead of answering with it`         |
| Handoff brief (`conversationController.ts`, via `cappedTurns`) | summary as brief            | `drops a capped distillation summary instead of briefing it`                        |

Earlier rounds' consumers keep their boundaries: best-of-N attempts
fail on `ceilingReached` (allow-listed), team workers resolve through
`reportForStop` → `capped`, scheduled turns and side sessions read
their own outcome types — none takes reply text as a result through a
raw completed-terminal read (guard-green proves it).

### Part C — the P3 findings, each closed (commit `8d06136cd`)

- P3-1 (image gate, test `refuses an image on a caller allowance the
old gate could not see`): `makeImage` takes the same synchronous
  take-or-refuse slot (`takeSideSlot` / `giveSideSlot` in `finally`)
  as the reviewer, hook models and every other caller-ledger side
  call. The drill bypassing the take fails the test (exit 1).
- P3-2 (wake requeue, test `re-queues a goal wake held across a
failed wrap-up for its own turn`): `wrapUpRequestFailed` runs the
  same `requeueHeldInput` exit as the wrap-up's success path, so a
  held goal wake keeps its own turn with tools after a model-error
  wrap-up (typed `max_turn_requests` saying the summary failed, then
  a clean second turn). The drill dropping the requeue fails the test
  (exit 1); the CHANGELOG goal-wake claim is true.
- P3-3 (captures + honest degrade): a 400 on the wrap-up request is in
  no retry table (`src/shared/retryPolicy.ts`: tables list 408/409/
  429/500/502/503/504 plus per-format kinds — `classifyRetry` says
  `not-retryable`), surfaces as `ModelApiError`, and converts to the
  typed `wrapUpFailedLimit(modelError)` — never a retry with tools.
  Pinned by the 400 cell of `ends a wrap-up lost to a $kind …`. The
  OpenAI-chat-compatible and Gemini tools-less wrap-up shapes stay
  UNVERIFIED in the wire table above: codec unit tests assert them,
  but no live vendor capture backs them. Capture procedure for the
  lead (who holds the keys) is below.
- P3-4 (docs agree with code): production ACP binds no caller
  allowance — CHANGELOG, README `## Limits` and this record say so;
  the ACP test binds its 3-call cap by hand and is renamed to what it
  proves (`delivers the real Model API wrap-up over ACP under a
hand-bound caller cap`, with the comment in the test). The
  engine-worker ceiling claim is removed: `runEngineWorker` has no
  production caller, so there is no production ceiling claim — the
  binding lives in code only (`WorktreeConversationHost.run` through
  the required allowance port).
- Not-checked (i) concurrency (test `refuses a racing second side
slot with two calls left`): synchronous take-or-refuse, no async
  lock — JS run-to-completion makes the take and the refusal one
  atomic block. The off-by-one drill (`<= 1` → `< 1`) fails the test
  (exit 1).
- Not-checked (ii) compaction with allowance 1 (test `leaves a
first-call overflow standing on a single-call allowance`): the loop
  skips compaction outright and recovery refuses the reserved slot,
  so the first-call overflow stands as `failed` / `context_overflow`
  with zero admissions. Removing the refusal fails the test (exit 1).
- Not-checked (iii) `dist/exec.js`'s table (measured on the built
  `dist/`): `dist/exec.js` (1,428 bytes) is only the installer shim —
  it requires `./uiText.js`, installs the run table into its own copy
  and the headless copy, then delegates to `headless.js`. It carries
  no English strings (`modelApiWrapUpFailed` ×0). The strings live
  compressed in `dist/uiText.js` (2,968-key EN table, both new keys
  present); `dist/modelApi.js` references `modelApiWrapUpFailed` ×2.

### P3-3 capture commands for the lead (UNVERIFIED rows)

No model call from this lane: run these with the provider keys, one
short turn each, and file the frames under
`docs/certification/toolrounds-captures/<vendor>/` (request URL,
scrubbed headers, body; response status, headers, parsed body) after
the m95 scrubbing pass (keys → `<redacted>`, no key in an argument,
environment variable or file — keys travel on the script's stdin only,
then `gitleaks detect --no-git` before committing). Flip the
UNVERIFIED rows once the frames land.

Chat completions (OpenAI-compatible vendor). Save as scratch
`wrapup-chat-capture.mjs` (NOT committed), run
`decrypt-helper | node wrapup-chat-capture.mjs <base-url> <model>
<outdir>`:

```js
// Reads the vendor key from stdin; posts the exact tools-less wrap-up
// shape the chat codec builds (chat.ts: developer items go out as
// system messages, tool calls as assistant tool_calls, outputs as tool
// messages, the wrap-up note as the trailing system message; no tools,
// no tool_choice, no parallel_tool_calls unless the preset sets it;
// the product streams — stream:false here only to read one JSON body).
import { writeFileSync, mkdirSync } from 'node:fs'
let key = ''
for await (const chunk of process.stdin) key += chunk
key = key.trim()
const [baseUrl, model, outdir] = process.argv.slice(2)
const body = {
  model,
  messages: [
    { role: 'system', content: '<instructions>' },
    { role: 'user', content: 'What time is it?' },
    {
      role: 'assistant',
      content: null,
      tool_calls: [
        {
          id: 'call_1',
          type: 'function',
          function: { name: 'get_time', arguments: '{"timezone":"UTC"}' },
        },
      ],
    },
    { role: 'tool', tool_call_id: 'call_1', content: '12:00 UTC' },
    { role: 'system', content: '<wrap-up note>' },
  ],
  max_completion_tokens: 64,
  stream: false,
}
const res = await fetch(`${baseUrl}/chat/completions`, {
  method: 'POST',
  redirect: 'manual',
  headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
  body: JSON.stringify(body),
})
const text = await res.text()
mkdirSync(outdir, { recursive: true })
writeFileSync(
  `${outdir}/wrapup-chat.json`,
  JSON.stringify(
    {
      request: { url: `${baseUrl}/chat/completions`, headers: '<redacted>', body },
      response: { status: res.status, text },
    },
    null,
    2,
  ),
)
console.log(`status=${res.status}`)
```

Expected accept: HTTP 200 with a text answer (`choices[0].message`
has `content`, no `tool_calls`). Expected reject: HTTP 400 with the
vendor's error JSON — record it verbatim; the product already degrades
honestly (typed summary-failed stop, never a retry with tools).

Gemini. Save as scratch `wrapup-gemini-capture.mjs`, run
`decrypt-helper | node wrapup-gemini-capture.mjs <model> <outdir>`
(the key travels in the request URL query on the wire as the API
requires; it is scrubbed to `<redacted>` before anything is written):

```js
// Reads the Gemini API key from stdin; posts the exact tools-less
// wrap-up shape the Gemini codec builds (gemini.ts: instructions as
// systemInstruction, history as user/model contents with functionCall
// + functionResponse parts, the wrap-up note as trailing user text;
// no tools, no toolConfig; the product also sends the thinking
// signature part it received — a synthetic capture omits it, record
// whether that matters).
import { writeFileSync, mkdirSync } from 'node:fs'
let key = ''
for await (const chunk of process.stdin) key += chunk
key = key.trim()
const [model, outdir] = process.argv.slice(2)
const body = {
  systemInstruction: { parts: [{ text: '<instructions>' }] },
  contents: [
    { role: 'user', parts: [{ text: 'What time is it?' }] },
    { role: 'model', parts: [{ functionCall: { name: 'get_time', args: { timezone: 'UTC' } } }] },
    {
      role: 'user',
      parts: [{ functionResponse: { name: 'get_time', response: { result: '12:00 UTC' } } }],
    },
    { role: 'user', parts: [{ text: '<wrap-up note>' }] },
  ],
  generationConfig: { maxOutputTokens: 64 },
}
const res = await fetch(
  `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,
  {
    method: 'POST',
    redirect: 'manual',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  },
)
const text = await res.text()
mkdirSync(outdir, { recursive: true })
writeFileSync(
  `${outdir}/wrapup-gemini.json`,
  JSON.stringify(
    {
      request: {
        url: `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=<redacted>`,
        body,
      },
      response: { status: res.status, text },
    },
    null,
    2,
  ),
)
console.log(`status=${res.status}`)
```

Expected accept: HTTP 200 with `candidates[0].content.parts` text
and no functionCall. Expected reject: HTTP 400 with the API's error
JSON — record it verbatim; same honest degrade as above.

### Round-7 drill ledger

Every drill restores its file byte-exact (SHA-256 before/after; all
nine drilled files verified `OK`). Vitest drills run at repo default
timeouts with `-t` filters; guard drills run the `.mjs` as a process.

| Drill | Break                                                           | Bite                                                                                                                                                                                                                                                                                                                                                | Exit              |
| ----- | --------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- |
| D-A1  | `enterWrapUpPhase` call removed from `streamAttempt`            | Guard: `streamAttempt never calls enterWrapUpPhase`; table cells `whole-stream retry` (cap 3) + `media recovery` fail with tools on the last request (`expected [12 tools] to deeply equal []`) — the review's defect reproduced; first-attempt/HTTP cells still pass via the loop-top/`beforeRetry` entries, which is why the decision had to move | guard 1, vitest 1 |
| D-A2  | `budget` → `modelError` in `wrapUpFailedKindFor`                | `names the fixed kind of every wrap-up-request failure` fails                                                                                                                                                                                                                                                                                       | 1                 |
| D-A3  | `requeueHeldInput` dropped from `wrapUpRequestFailed`           | `re-queues a goal wake held across a failed wrap-up` fails                                                                                                                                                                                                                                                                                          | 1                 |
| D-A4  | `canReserveSideSlot` `<= 1` → `< 1`                             | `refuses a racing second side slot` fails                                                                                                                                                                                                                                                                                                           | 1                 |
| D-A5  | `isWrapUpSlotReserved` refusal removed from overflow recovery   | `leaves a first-call overflow standing` fails (admission runs)                                                                                                                                                                                                                                                                                      | 1                 |
| D-A6  | `takeSideSlot` refusal bypassed in `makeImage`                  | `refuses an image on a caller allowance the old gate could not see` fails                                                                                                                                                                                                                                                                           | 1                 |
| D-B1  | `usableReply` capped branch returns usable                      | `withholds a capped turn reply as capped` fails (the terminal early-return still guards the other endings — one break, one failure)                                                                                                                                                                                                                 | 1                 |
| D-B2  | judge finishes `tracked.reply` directly                         | `never returns a capped turn reply as a verdict` fails (`'caution'` instead of `'failed'`)                                                                                                                                                                                                                                                          | 1                 |
| D-B3  | playbook `!usable.usable` early return removed                  | `never consumes a capped turn wrap-up text as a review` fails (capped text reaches `afterReview`)                                                                                                                                                                                                                                                   | 1                 |
| D-B4  | host Git draft uses `seen.text` directly                        | `never posts a capped turn summary …` fails                                                                                                                                                                                                                                                                                                         | 1                 |
| D-B5  | panel Git draft uses `seen.text` directly                       | `never settles a capped turn summary as a draft` fails                                                                                                                                                                                                                                                                                              | 1                 |
| D-B6  | reviewer returns the side reply directly                        | `leaves the approval to the user when the review turn ends at the model-call limit` fails                                                                                                                                                                                                                                                           | 1                 |
| D-B7  | hook model finishes the raw reply directly                      | `discards a reply cut at the model-call limit` fails                                                                                                                                                                                                                                                                                                | 1                 |
| D-B8  | handoff `cappedTurns` check replaced with `undefined`           | `drops a capped distillation summary instead of briefing it` fails                                                                                                                                                                                                                                                                                  | 1                 |
| D-G1  | wrap-up guard, no args                                          | `pass the ModelApiHost.ts path to check`                                                                                                                                                                                                                                                                                                            | 1                 |
| D-G2  | wrap-up guard, green host                                       | `single builder ok`                                                                                                                                                                                                                                                                                                                                 | 0                 |
| D-G3  | usable-reply guard, no args                                     | `pass the source root to check`                                                                                                                                                                                                                                                                                                                     | 1                 |
| D-G4  | usable-reply guard, green `src`                                 | `no raw completed-terminal reads`                                                                                                                                                                                                                                                                                                                   | 0                 |
| D-G5  | usable-reply guard, planted `terminal === "completed"` consumer | names `consumer.ts:2`                                                                                                                                                                                                                                                                                                                               | 1                 |

### Round-7 verification (macbook, repo default timeouts, `--maxWorkers=3`)

- `npm run typecheck` exit 0; ESLint `--max-warnings=0` clean on every
  changed file; Prettier clean; `npm run check:l10n` 0 problems;
  14-locale order diag all `sameOrder=true` (2,968/2,968 keys);
  `npm run deadcode` exit 0; `npm run cycles` exit 0 (no circular
  dependencies); `npm run build` exit 0 (`dist/modelApi.js` 537,448 B
  vs the 525 KiB budget).
- `duplication` exits 1 — pre-existing: the round-6 head `04e82a18c`
  already fails it (26 pairs, measured on a scratch worktree). This
  lane fixed the 5 pairs it introduced that had an honest shared home
  (guard-drill harness → `test/unit/helpers/guardProcess.ts`; Git
  drafts → `replyIfUsable`); the 12 remaining new pairs are the
  mandated table-test proof skeleton plus one test-rig stub. Recorded
  as a justified deferral in PLAN.md §7; no gate file touched.
- Suites (whole files, ≤3 per run): `toolRounds` 36,
  `toolRoundsCodecs` + `modelApiGoldenRequests` + `bestOfNAttempts`
  154, `judgeSameMuseCode` + `panelPlaybook` + `acpModelApi` 31,
  `modelApiLoopGuarantees` + `museCodeReviewer` +
  `museCodeHookModels` 93, `modelApiHost` 672,
  `conversationController` 690, `conversationGit` +
  `nativeGitAdapter` 124, `usableReply` + both guard suites 13.
- Packed product:
  `NPM_CONFIG_CACHE="$TMPDIR/npm-cache" npx vitest run
test/e2e/execStdio.e2e.test.ts --maxWorkers=3` — 50 passed.
- NOT RUN HERE: browser suites (MacBook rule); aggregate
  `npm run quality` (lead-owned); live vendor captures (lead holds
  the keys — procedure above).

### What the lead must run

1. The two P3-3 captures above; file frames under
   `docs/certification/toolrounds-captures/<vendor>/`; flip the two
   UNVERIFIED wire-table rows.
2. Aggregate `npm run quality` (incl. the duplication accept/reject)
   on the integrated tree.
3. Nothing else is outstanding: every other Prove item ran here with
   the receipts above.

## Round 8 — the tool-less request xAI rejects (released defect), and RVAPP-TOOLROUNDS7

Released 0.18.1 ends a job at 50 tool rounds on xAI: `/compact`,
automatic compaction, the Git drafts and the wrap-up send a tool choice
with no tools on Responses-format providers, and xAI answers 400 "A
tool_choice was set on the request but no tools were specified." A real
xAI job was ended 13 times by it on 2026-10-12. The lead ran the live
sweep below on 2026-10-12 12:55 to 12:58 PM (real APIs; one real tool
call, then the wrap-up; the files, without any key, are committed under
`docs/certification/toolrounds-captures/` as recorded).

### The captures: one shape every vendor accepts

Each vendor got the wrap-up three ways after one real tool call. Tools
and tool choice both OMITTED is the only shape all twelve accept.

| Vendor, model                                               | tools + choice OMITTED                                | tools `[]`, choice `auto`                                                     | tools kept, choice `none`                                                                                                                                         |
| ----------------------------------------------------------- | ----------------------------------------------------- | ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Meta Responses, muse-spark-1.3-contributor                  | 200 (`meta/2-wrap-up-tools-omitted.json`)             | 200 (`meta/1-wrap-up-tools-empty-choice-auto.json`)                           | 400: only "auto" is supported (`meta/3-wrap-up-tools-kept-choice-none.json`)                                                                                      |
| xAI Responses, grok-4.3                                     | 200 (`xai/2-wrap-up-tools-omitted.json`)              | 400: tool_choice with no tools (`xai/1-wrap-up-tools-empty-choice-auto.json`) | 200 (`xai/3-wrap-up-tools-kept-choice-none.json`)                                                                                                                 |
| OpenAI Responses, gpt-5.6-luna                              | 200 (`openai/2-wrap-up-tools-omitted.json`)           | 200 (`openai/1-wrap-up-tools-empty-choice-auto.json`)                         | 200 (`openai/3-wrap-up-tools-kept-choice-none.json`)                                                                                                              |
| Anthropic, claude-haiku-5-5                                 | 200 (`anthropic/1-wrap-up-tools-omitted.json`)        | 200 (`anthropic/2-wrap-up-tools-empty-list.json`)                             | 200 (`anthropic/3-wrap-up-tools-kept-choice-none.json`)                                                                                                           |
| Anthropic, claude-sonnet-5-5                                | 200 (`anthropic-sonnet/1-wrap-up-tools-omitted.json`) | 200 (`anthropic-sonnet/2-wrap-up-tools-empty-list.json`)                      | 200 (`anthropic-sonnet/3-wrap-up-tools-kept-choice-none.json`)                                                                                                    |
| Gemini, gemini-3.8-flash                                    | 200 (`gemini/1-wrap-up-tools-omitted.json`)           | not sent                                                                      | 200, mode NONE (`gemini/2-wrap-up-tools-kept-mode-none.json`); 200 with the thought signature stripped (`gemini/3-wrap-up-tools-omitted-signature-stripped.json`) |
| Groq, DeepSeek, Mistral, Fireworks, Z.ai, OpenRouter (chat) | 200 each (`<vendor>/1-wrap-up-tools-omitted.json`)    | not sent                                                                      | 200 each (`<vendor>/2-wrap-up-tools-kept-choice-none.json`)                                                                                                       |

First calls with tools (`<vendor>/0-first-call-with-tools.json`, plus
`0b-first-call-choice-auto.json` where sent) anchor each row. No row
says UNVERIFIED: every omitted wrap-up above carried the real tool
history (xAI: `function_call`/`function_call_output`; Anthropic:
`tool_use`/`tool_result`; Gemini: `functionCall`/`functionResponse`
with no declarations), which answers RVAPP-TOOLROUNDS7 P2-1 by
measurement — the reviewer's feared 400 never came.

Also measured for the tables: Claude Sonnet 5.5 refuses a FORCED tool
choice (`any` or `tool`, 400); DeepSeek in thinking mode refuses
`tool_choice: required`; Meta accepts only `"auto"`;
`gemini-2.5-flash` answers 404 "no longer available to new users … use
models/gemini-3.8-flash". With tools declared, xAI accepts `required`
(`xai/0-first-call-with-tools.json` sends it, 200): the refusal is only
a choice with NO tools.

### The one builder (Part 1 item 2)

`hasDeclaredTools` / `omitToolShape`
(`src/core/backends/modelapi/schemas.ts`, commit `08e989508`) decide
every tool-less request in the product — the wrap-up, compaction
without reused tools, the Git drafts, the reviewer and hook-model calls
with no tools, any side call. No tools declared means `tools` and
`tool_choice` are both omitted on every wire format: the Meta-direct
client strips both (`client.ts`), the Responses codec omits both
(`codecs/responses.ts`), the chat codec sends no choice, the Anthropic
codec sends no `tool_choice`, the Gemini codec sends no `tools` and no
`toolConfig`, Ollama has no choice to send. Meta golden
`10-turn-limit-wrap-up` is re-recorded for the omitted shape; the
instructions are byte-identical and the note stays the trailing input
item. No new guard test pins the shape: the owner's 2026-10-12 testing
rules forbid reflex guard tests, so the builder stands on the captures
above and the golden.

### Forced tool choice inventory (Part 1 item 3)

Every canonical body in the product sets `tool_choice: 'auto'`
(`ModelApiHost.ts:4643`, `hookModelEntry.ts:277`,
`reviewerEntry.ts:233`, `tabRequest.ts:93`,
`legalExplanation.ts:112`, `modelApiSameJudge.ts:98`); the type allows
`'none'` but nothing assigns it. The Responses codec sends only a
choice the model's capability record lists, unknown meaning `auto`
only; the Meta record now lists `['auto']` (commit `364046d32`). The
Anthropic codec sends only `{ type: 'auto' }`, the chat codec `'auto'`
or nothing, Gemini `AUTO` only with declarations. Against the three
measured refusals: Sonnet 5.5 forced-choice refusal is unreachable (the
product never forces on the Anthropic wire); DeepSeek thinking
`required` is unreachable (the product never sends `required`); Meta
non-`auto` is now ungeneratable (record + codec gate). The
`forced_tool` structured-output mode has no wire codec and falls back
to text (`structuredOutput.ts:64-66`; no `forceSideCallTool`
implementation exists in `src/`), so it never reaches a wire. One test
per provider answer: `test/unit/capabilityRecord.test.ts` (Meta record
is `auto`-only) and `test/unit/responsesCodec.test.ts` (unlisted choice
sends `auto`). No other place in `src/` sends `required`, `any`, a
named tool or `none` to a provider.

### What the person sees when a side call is refused (Part 1 item 4)

Our paths do not reword provider errors: `/compact` shows
`compactionFailed` with `describe(error)`
(`conversationController.ts`), and every side-call failure surfaces the
provider's message the same way. The typed refusal sentence itself
belongs to the provider-refusals lane (branch
`fix/provider-refusals`); our paths pass the error through unchanged
to it. Reservation accounting already distinguishes refusals on this
branch: the single request path marks 400/429 via `noteRequestRefusal`
(`ModelApiHost.ts:4290`) and the settlement excludes refused
reservations from "counts as spent" (`:4247`). Any remaining change to
refusal wording or reservation release belongs to that lane and the
ledger lane; this lane restructures neither.

### RVAPP-TOOLROUNDS7 findings, each closed

- P2-1 (capture table): answered above; every row names its file.
- P2-2 (held goal wake dropped on 429/5xx): one exit —
  `wrapUpRequestFailed` re-queues every kind of held input first for
  whatever ended the wrap-up, and the overflow throws route through it
  too (commit `2f7332830`). The loss table holds a goal wake in every
  cell (rate limit, model error, repeated model error, context
  overflow, hook stop; `test/unit/toolRounds.test.ts`). Money has no
  cell: it needs a durable journal the unit harness has no knob for —
  kind-mapped and named for the ledger lane.
- P2-3 (hook agent spends the wrap-up slot): a hook agent reserves
  `HOOK_AGENT_MAX_STEPS` up front, so the caller's last call can only
  be spent by the wrap-up builder; a 3-step agent on an exec ledger of
  3 never starts and the wrap-up still runs (commit `54d08fe19`,
  `test/unit/toolRounds.test.ts`).
- P2-4 (duplication gate): measured, not parametrised. Main
  `38ef148f19` scans 0 pairs; this branch scans 42 (`npx jscpd
--reporters json`; main measured on a `$TMPDIR` scratch worktree,
  since removed). Every pair sits inside fake-harness suites — 29
  self-pairs in `toolRounds.test.ts`, 3 with `toolRoundsCodecs.test.ts`,
  1 with `modelApiAutoCompact.test.ts`, 1 with
  `toolRoundsXaiRefusal.test.ts`, 2 in `modelApiHost.test.ts`, 2 in
  `scheduleBackgroundTarget.test.ts`, 1 each in
  `bestOfNManager`/`museCodeHookModels`/`museCodeReviewer`, 1 self-pair
  in `toolRoundsCodecs.test.ts` — and every one of those files imports
  fake helpers or mocks. No pair touches `src/` or `scripts/`. The
  review's parametrisation (one table, shared stub, inherited pairs) is
  not done here on purpose: the owner's 2026-10-12 rules forbid
  touching those suites, and the TESTCUT lane owns their deletion; the
  PLAN.md §7 record is rewritten with these numbers instead of removed.
  The gate turns green when TESTCUT lands; the lead owns merge until
  then.
- P3-1 (guard parses, allow-list names functions): the guard blanks
  comments and non-`completed` strings, then matches a completed value
  on either side of a comparison (any operand name, `'completed'` or a
  `*COMPLETED*` constant), a `switch` on a terminal, and comparisons
  split over lines; attribution walks brace depth to the nearest named
  function, skipping keywords, signature noise, return annotations and
  stale call parkings (`scripts/lib/usableReplyGuard.mjs`). The
  allow-list names `file:function` with the reason read at the site; a
  new reader in an allow-listed file still fails. Corrected claim: a
  future consumer compiles fine — `turnCompleted` still exposes
  `terminal` and `errorKind` publicly; the union exists only as the
  accessor's return type, so the guard (not the compiler) is the
  enforcement.
- P3-2 (slot release): `takeSideSlotToken` returns a token;
  `giveSideSlot`/`releaseSideSlotToken` releases exactly it; a
  ledger-free take returns a zero token that releases nothing (commit
  `54d08fe19`).
- P3-3 (unretried 429): `wrapUpFailedKindFor` names a 429 that reaches
  the loop `rateLimited` (commit `2f7332830`). Grounded in
  `src/shared/retryPolicy.ts`, whose per-format tables refuse retries
  with `quota`, `retry-after-cap` and `not-retryable` — a non-retryable
  429 exists.
- P3-4 (overflow wrap-up): README and CHANGELOG say what the person
  gets — the turn ends failed with "Context window full: /compact or
  /handoff" (`UI_TEXT.contextWindowFull`), and held input is re-queued
  through the one exit first (`wrapUpRequestFailed` runs before the
  `?? error` re-throw; finalization maps it to
  failed/`context_overflow`).
- P3-5 (race wiring; recovery row): the race pins the exported pure
  decision — `takeSideSlotToken`/`releaseSideSlotToken` with two
  parallel racers, token release and the zero-token case
  (`test/unit/toolRounds.test.ts`); the private methods add only the
  ledger-free branch. Overflow recovery success has its row in
  `test/unit/modelApiAutoCompact.test.ts` (`recovers one classified
overflow inside the turn`). No new process test was added: the
  owner's 2026-10-12 rules forbid it.
- P3-6 (allow-list reasons): `turnFailures`
  (`src/core/eval/runner.ts:78`) reads the eval driver's own outcome
  contract — `EvalTurnOutcome` carries no reply and no errorKind
  (`driver.ts:253` carries only terminal and reason), so `usableReply`
  cannot apply; a finished turn counts finished by design of the
  measurement. `endedMessage` (`turnNotifications.ts:34`) renders the
  wire terminal verbatim per D36: a capped turn — typed `completed` on
  the wire — notifies "Muse finished responding"; the limit detail is
  the in-chat notice, and the turn did end.

### Round-8 drill ledger

Red drills for the committed fixes live in the suites the prior session
added (all fake-harness suites, left for the TESTCUT lane; named, not
extended): the omitted-shape wrap-up and the xAI 400 in
`test/unit/toolRoundsXaiRefusal.test.ts`, the loss table and slot
tokens in `test/unit/toolRounds.test.ts`, the Meta record and codec
gate in `test/unit/capabilityRecord.test.ts` and
`test/unit/responsesCodec.test.ts`. The guard drills that run here are
the guard suite's own: the planted `terminal === "completed"` consumer
fails naming `consumer.ts:2`, and missing/empty input fails
(`test/unit/toolRoundsUsableReplyGuard.test.ts` — a real child process
of our own script over a real temporary folder, the allowed kind).
P3-1 red drill (this lane, `$TMPDIR/guard-drill`, real script runs, no
repo file touched): three fixtures for the shapes round 7's guard
missed — `ending === COMPLETED` (any name), `switch (terminal)`, and a
comparison split over lines — plus a control file whose message text
mentions "completed". The committed (old) lib exits 0 on the dir; the
rewritten lib exits 1 naming `any-name.ts:4 (verdict)`,
`split-lines.ts:3 (verdict2)` and `switch-terminal.ts:2 (word)`, with
the control clean.
