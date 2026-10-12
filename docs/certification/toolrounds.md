# TOOLROUNDS — model-call limits

Frozen base: `874b04372`. Rig: macbook. No live/paid calls, browser or GUI.

## Existing stop types and request limits

`SessionBudgetExceededError` carries a translated money refusal;
`ChildTaskRefusedError` carries a typed child refusal and separate model/UI text;
exec's `StopCause.requests` maps to `request_cap` (exit 5). A turn limit needs
its actual count, so `ModelCallLimitError` extends the budget stop and carries
`limit`. It emits `max_turn_requests` with a completed terminal and a warning;
ACP resolves that protocol stop rather than rejecting an internal error.

| Limit                                           | Where set                                             | Where enforced                                                                    | At the limit                                                                                    |
| ----------------------------------------------- | ----------------------------------------------------- | --------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Model API turn, formerly 50; target default 200 | `MODEL_API_MAX_TOOL_ROUNDS`, shared constants         | `ModelApiSession.loop`                                                            | Translated resumable notice; ACP `max_turn_requests`; exec `request_cap`, exit 5                |
| Headless requests, default 30, range 1–500      | `exec --max-requests`, `parseExec`                    | `runLedger.admit`; Meta `execFetch`, configured providers `withRuntimeAccounting` | `request_cap`, exit 5; existing admission refusal can have null `stopReason`/`incompleteReason` |
| Paid child task, 4 attempts per grant           | `SUBAGENT_TASK_MAX_REQUESTS`, `newChildGrant`         | `childGrantRefusal`, `requestGuard.onRequestStarted`                              | Typed `ChildTaskRefusedError.requestLimit`, translated child notice                             |
| Best-of-N attempt, maximum 50                   | `BEST_OF_N_MAX_REQUESTS_PER_ATTEMPT`, attempt ceiling | `ModelApiBackendManager` attempt guard; `WorktreeConversationHost`                | Attempt ceiling and translated attempt result                                                   |
| Team task, default 20; writer roles 40          | `TEAM_TASK_MAX_REQUESTS_*`, role policy               | Worker budget admission                                                           | Typed worker ceiling; task receipt capped                                                       |

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

## Next slice

Replace the default with 200 and bind
remaining caller allowances. Release-train integration follows lane completion.
