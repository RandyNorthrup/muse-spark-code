# Lane TURNLIMIT certification — no fixed cap on a turn's tool rounds (F88)

Worktree: `/home/randy/lanes/TURNLIMIT`, branch `fix/turn-limit`, rig `wslpc`,
base `898a26c5e` (0.18.2). No credentials were read, copied or stored. No
live or paid model call was made; counted model attempts: **0**. There is no
model key in this sandbox. All verification runs below use the repository's
own test timeout (no `--testTimeout`); at most 3 files per run.

Commits: `01232154e` (implementation), `8a88010c6` (tests + reference).

## What changed

- The fixed 50-round default (`MODEL_API_MAX_TOOL_ROUNDS`) is gone. A turn
  runs until the model stops, the person cancels, the loop guard fires, a
  spend cap is reached, or an error happens. Goal wake-ups, steered and
  queued messages, `verifyRound`'s checks and output continuations are kept:
  with no last round the checks run after every tool batch (the old
  final-round skip existed only because no request would read those
  results; now the summary request reads them).
- One optional per-turn limit, off by default (no limit): the
  machine-scoped `museSpark.modelApiMaxTurnRequests` setting (0 is no
  limit, 1–1000), the editor protocol's Tool-round limit session option
  (`turn-limit`, off/25/50/100/200/500), and `--max-turn-requests` for exec
  and serve. The serve/exec vocabulary is the preset list so the select's
  current value is always one of its options; the VS Code setting stays a
  free number. The flag is refused on the Muse Code backend.
- When the person's limit is reached, one last request with no tools asks
  the model to summarise what it did and what is left; the turn ends
  completed with the translated notice (panel row via `backendNotice`,
  editor message chunk via the same event), and the editor protocol answers
  `max_turn_requests`. Never an internal error for a planned stop. Steered
  input and goal wakes still become their own turns, so the next message in
  the same conversation works.
- F88: a failed send to a configured provider says its real cause. A send
  that never got a response names the network error's fixed-vocabulary code
  (`wireWordForLog`; free text is never echoed) and says in words that it
  was not retried because a pinned send may have reached the provider. An
  OpenAI-format provider's HTTP error carries its status with the
  envelope's message/type/code (new `parseResponsesError`, as the sibling
  codecs do; the transport's redaction still applies).

## Proof

Repo suites (direct runs, repo-default timeouts):

| Suite                                                                       | Result                                      |
| --------------------------------------------------------------------------- | ------------------------------------------- |
| `test/unit/modelApiHost.test.ts`                                            | 670 passed                                  |
| `test/unit/verifyLoop.test.ts`                                              | 77 passed                                   |
| `test/unit/responsesCodec.test.ts`                                          | 55 passed                                   |
| `test/unit/configuredSendFailure.test.ts` (new)                             | 3 passed                                    |
| `test/unit/serveTurnLimit.test.ts` (new)                                    | 4 passed                                    |
| `test/unit/turnLimitSettings.test.ts` (new)                                 | 6 passed                                    |
| `test/unit/execArgs.test.ts`                                                | 59 passed                                   |
| `modelsActivationBudget`, `teamWorkerCertification`, `modelApiEntryExports` | 5 passed                                    |
| `acpAgent`, `acpModelApi`, `execProvider`                                   | 171 passed, 1 failed (named below, left)    |
| `acpAccounts`, `teamAcpProcess`, `teamAcpWorker`                            | 115 passed                                  |
| `execRun`, `settings`, `museSettings`                                       | 122 passed                                  |
| `turnNotifications`, `conversationCheckpoints`, `acpSchedules`              | 45 passed                                   |
| `teamMuseCodeWorker`, `agentSchedules`                                      | 117 passed                                  |
| `evalDriver`, `acpRuntime`                                                  | 52 passed                                   |
| `chatgptResponsesCap`, `modelApiAttemptBudget`, `modelApiOverflow`          | 55 passed                                   |
| `configuredProviders`, `chatgptResponsesCodec`, `modelApiHostedSearch`      | 108 passed, 3 failed (sandbox, named below) |

The brief-mandated swap holds: the goal/steer promotion suites set the
limit through the new option (limit 50), prove the summary request carries
no tools, the steered text is not consumed by the summary, and the queued
goal/steer runs as its own turn. The verify-loop suite proves the checks
run after every batch with the warning notice and a completed turn.

Red drills (break once, non-zero exit, restore byte-exact):

| Drill                 | Break                          | Result                      |
| --------------------- | ------------------------------ | --------------------------- |
| `parseResponsesError` | always fall back to the status | 2 failed, 53 passed         |
| `providerSendFailure` | always say unknown             | 2 failed, 1 passed          |
| exec parse            | off-by-one limit               | 1 failed, 58 passed         |
| serve parse           | off-by-one limit               | 1 failed, 3 passed          |
| setting schema        | ceiling 1000 to 10             | 1 failed, 5 passed          |
| loop bound            | `>=` to `>`                    | both promotion tests failed |

Static gates (exit 0 unless named): host typecheck, unit typecheck,
eslint on every changed file, prettier (repo `format:check` clean),
`check:l10n` (0 problems; order verified identical across all 14 tables at
the English positions), `check:reference`, `check:host-api`,
`check:plan`, `check:roadmap`, `check:badges`, `deadcode` (knip; 2
pre-existing config hints), `cycles`, `duplication`, full `npm run build`
(tokens, production build, bundle-size, bundle-split incl. the new
`MODEL_API_MODEL_TEXT.turnLimitSummary` key, lazy-registry, host-globals,
notices), `security:audit` (2 advisories, 1 exception file entry —
pre-existing).

Packed product (`node scripts/build.mjs --production`, then `dist/acp.js`):

- `exec --help` / serve reference list `--max-turn-requests` with the new
  help text on both routes.
- `exec --backend modelApi --max-budget-usd 1 --max-turn-requests 75 'hi'`
  refuses (`Invalid number or limit…`), exit 2.
- `exec --backend museCode --max-turn-requests 50 'hi'` refuses (`These
options require the Model API backend.`), exit 2.
- `serve --backend museCode --max-turn-requests 50` refuses
  (`--max-turn-requests needs --backend modelApi.`), exit 1.
- `serve --backend modelApi --max-turn-requests 75` refuses
  (`Unknown argument: --max-turn-requests`), exit 1.
- `session/new` over the editor protocol is sandbox-blocked here (below);
  the lead re-runs it live: with a limit set, a 60-round workload must
  complete unset, and with limit 3 the turn must end `max_turn_requests`
  with a tool-free summary request and a working next prompt.

## NOT REPRODUCED (item 5: the four failures after the cap)

The brief's stand-in-server proof is not available to a lane (owner's
testing rules of 2026-10-12: no local server answering as a provider).
Verdict from code inspection: the conversation a cap stop leaves behind
carries no invalid shape.

Checked:

- The cap throw sits after every round's tools settle: `scheduleTools`
  settles/finishes every call, `skipCalls` answers incomplete, required,
  budget-limited and aborted calls, and `settleCutShort` settles failed
  attempts — no path records a `function_call` without its
  `function_call_output` on the cap path. `hasUnansweredSessionCall`
  guards the same invariant at session save.
- After the throw only queue operations run (goal-wake requeue,
  `promoteSteered`); neither mutates replay. The next turn appends the
  user message and sends normally.
- The Anthropic encoder does not repair orphans (a dangling `tool_use`
  would 400), but none exists on this path per the above.
- `assertContextFits` + `maybeAutoCompact` run before every send; overflow
  surfaces as the translated context message after a compaction attempt,
  not a silent 400. `empty_turn` only fires when every input item is
  blank, which a cap stop does not produce.
- `outcomeStopReason = 'budget'` on the old path mislabeled turn
  evidence; the new limit stop leaves it unset (normal). No between-turn
  reader (`child.session.outcomeStopReason`, evidence) touches the send.

The lead re-runs the measured workspace live; the decisive evidence (the
four sends' actual status/body) lives in that run's logs.

## Left for the lead (sandbox blocks)

- `test/unit/acpModelApi.test.ts` — `writes a file the client allowed…`
  expects exactly `['model', 'effort']` session options; the new
  `turn-limit` option is the intended behavior. Fake-harness suite: named
  and left per the owner's testing rules.
- `test/unit/configuredProviders.test.ts` — 3 loopback-stream tests time
  out (repo 5 s default): this sandbox never completes a loopback TCP
  connect (probed: node http server on 127.0.0.1 + client → 8 s timeout).
  Environmental, pre-existing; needs a real loopback outside the sandbox.
- Full `npm run test:unit` — its global setup starts a review browser and
  fails with `Chrome is required for visual review tests`. Same sandbox
  block; the suites above ran directly instead.
- Packed `session/new` — refused here: `This computer's credential store
cannot be used (store-unavailable); on Linux the agent needs a running,
unlocked Secret Service`. Live session proof (60-round run, limit-3
  stop, next prompt, HTTP-400 wording, closed-port refusal wording) needs
  the lead's host with a key and a keyring.

## UPSTREAM

None: no third-party package, API or protocol changed.

## APP PROBLEMS (found while working, not caused by this lane)

None new. The pre-existing items above (exact option-list assertion,
loopback/Chrome/Secret-Service sandbox blocks) are recorded where they
belong.
