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

## Next slice

Complete wrap-up request building, then replace the default with 200 and bind
remaining caller allowances. Release-train integration follows lane completion.
