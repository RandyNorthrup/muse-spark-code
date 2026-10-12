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

## Piece 2 — wrap-up request

The ordinary request builder adds the short model-facing limit note to the
last request's instructions. It sets canonical `tools: []` and
`tool_choice: none`. No other request changes. An unsolicited tool call in
that reply is answered for valid replay and never executed. Steering and
active goal wake reach the original post-loop promotion block.

| Codec family                                                    | Tools disabled in built wire request                                                  |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Meta/direct Responses                                           | `tool_choice: none`, empty tools                                                      |
| OpenAI/xAI Responses and ChatGPT Responses                      | `tool_choice: none`, empty tools; no empty namespace                                  |
| Chat completions (OpenRouter, OpenAI-compatible vendors/custom) | `tool_choice: none` when the profile supports choice; otherwise omit tools and choice |
| Anthropic Messages                                              | Omit tools and tool choice                                                            |
| Gemini generateContent                                          | Omit tools and toolConfig                                                             |
| Ollama chat                                                     | Omit tools and unsupported tool choice                                                |

Codec-family assertions use real encoders with tool-result history retained.
Red drills: remove the final-call wrap-up marker: the engine's no-tools
assertion and new golden case fail; change Chat's supported `none` to `auto`:
the codec assertion fails. Both source files restored byte for byte with
`cmp` and SHA-256. Green: 151 tests in `toolRounds`, `toolRoundsCodecs` and
`modelApiGoldenRequests` pass at repository default timeouts.

The golden request suite adds only `10-turn-limit-wrap-up.json`; all existing
fixtures stay byte-exact. No provider response shape has been added.

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

## Next slice

Release-train integration and cross-platform/browser certification follow the
completed lane. No live or paid provider call is authorized here.
