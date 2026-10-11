# M95b lane C — ChatGPT Responses profile

Worktree `/home/randy/lanes/M95BC`, branch `m95b/c`, base `60bf96aa`,
verified directly on **kubuntu**, 2026-10-05. This lane owns only
`src/core/backends/modelapi/codecs/responses.ts`, its tests and request
goldens. Shared documentation, authentication, transport and UI belong to
the other M95b lanes.

## Request and error handling

- The injected `profile: 'chatgpt'` selects namespace-wrapped function
  tools, full canonical history, `store: false`, `stream: true`, and omits
  `max_output_tokens` and `prompt_cache_retention`. The caller supplies a
  stable namespace name; neither tokens nor account identity enter it.
- Function schemas and their `strict` setting remain unchanged, including
  optional arguments. Unsupported hosted tools fail explicitly.
- The existing SSE parser reads bytes without consulting HTTP headers.
  Successful streams and usage-limit streams are tested with no
  Content-Type, `application/json`, and `text/event-stream` under HTTP 200.
- Nested SSE error envelopes are validated with zod and translated to
  canonical errors. `subscription_sharing_usage_limit_exceeded` throws
  `ChatgptPlanLimitError` with its code and server message immediately;
  the same error on a standalone `response.failed` does too. Other errors
  keep their actual code and message. Invalid nested errors fail without
  retaining their body in diagnostics.
- The cache-routing key is sent but never used as response identity. Its
  server rewrite cannot alter later encoded requests. Encoding stays pure;
  existing OpenAI/xAI byte goldens remain unchanged.

No fake transport,
credential reader, model slug fallback, user text, dependency, escape hatch,
command, setting or script is added.

## Client-side output cap

`ResponsesDecodeSink.outputCap` is required for every ChatGPT decode and
ignored by API-key profiles. Its explicit `ResponsesOutputCap` interface
injects the host's `maxOutputTokens`, cumulative `countOutputTokens(event)`
and per-request `abort()` callback. Encoding never stores a request's cap
in the codec or sends it over the wire. Missing/invalid caps and invalid
counter results fail explicitly; counts and caps must be safe integers,
counts nonnegative, caps positive.

Every canonical event is fully validated before the counter sees it, once,
and the same event reaches the consumer. The host counter must include
text, tool arguments and whole final items without counting deltas twice.
Crossing the cap aborts that request, throws `ResponsesOutputCapError`
with the cap/count, and closes the upstream iterator before the excess
event reaches the host. Exactly the cap is allowed. Concurrent decodes of
one codec keep independent host counters and cancellation.

Reported `usage.output_tokens` also bounds the reply, including encrypted
reasoning that was invisible in deltas. That hidden work cannot be stopped
until usage is reported; this is a client cancellation limit, not a claim
that the server generates no more than the cap. No production tokenizer or
character-to-token ratio is invented. Tests inject synthetic counters only
under `test/unit/`.

Integration must supply the chosen model's real/conservative counter and
the active transport's abort callback, setting `maxOutputTokens` from that
request's canonical `max_output_tokens`. The codec deliberately refuses a
ChatGPT stream when those dependencies are absent. Lane S's subscription
record remains an auth/transport concern: the codec consumes no record,
credential or account id. The same shared-core interface serves VS Code,
other editors, ACP and headless consumers without importing `vscode`.

## Capture provenance and limits

Source: `/home/randy/lanes/_ctx/codex/M95B-FINDINGS.md`, the owner's
2026-10-05 captures at 12:49 and 12:52 PDT, runs `acdc0f60…` and
`577bc807…`. Run 1 counted **0** model attempts; run 2 counted **1**.
Both refresh tokens were revoked (HTTP 200); no API-key billing.
The capture ran from the owner's capture scratchpad with an empty context,
not from this worktree. This lane makes **zero network or model calls**.

The supplied findings settle the namespace request shape, preview fields,
SSE without Content-Type, rewritten cache key, and nested error plus failed
response. The limit code was redacted by the capture scrubber and is taken
from PLAN.md D74 as the brief explicitly instructs.

The initial lane had only the capture findings and used a deterministic
contract projection with canonical test values. FIXM95BC now also checks
the supplied scrubbed request/SSE frame, preserved in
`test/fixtures/responses-codec/chatgpt-responses-capture.json` with only
Prettier whitespace normalization. The original contract golden remains
byte-identical. The captured request's strict function stays `strict: true`;
the harness's existing declarations stay `strict: false`, preserving their
optional arguments. A live plan tool-call event, its namespace field,
encrypted reasoning and cached-token usage remain uncaptured in the owner's
findings. No speculative parser for those fields is added.

## Verification

Commands run serially, directly in this worktree:

- Before implementation,
  `npx vitest run test/unit/chatgptResponsesCodec.test.ts --maxWorkers=3 --testTimeout=120000`:
  **8 failed, 1 passed**, proving the request/error acceptance tests fire.
- After implementation,
  `npx vitest run test/unit/chatgptResponsesCodec.test.ts test/unit/responsesCodec.test.ts --maxWorkers=3 --testTimeout=120000`:
  **54 passed** before the four additional error-only/header cases.
- Before the cap implementation, the complete
  `test/unit/chatgptResponsesCap.test.ts` file: **17 failed, 2 passed**.
- Final focused suite (all three codec files, `--maxWorkers=3 --testTimeout=120000`):
  **77 passed** (45 existing Responses, 13 ChatGPT request/error, 19 cap).
- `npm run typecheck`: all five projects passed again after the cap piece.
- `npx eslint --max-warnings=0 src/core/backends/modelapi/codecs/responses.ts test/unit/chatgptResponsesCodec.test.ts test/unit/chatgptResponsesCap.test.ts`:
  passed.
- `npx prettier --check` on all five changed files: passed.
- `npm run deadcode`: passed (the existing `vendor/**` configuration hint).
- `npx jscpd`: passed, 0 clones.
- `node scripts/check-l10n.mjs`: 14 tables, 127 manifest strings,
  **0 problems**. This lane adds no localization key or manifest text.
- `npm run check:host-api`: passed, 283 APIs, **0 problems**.
- `npm run build`: **exit 0**. Production compilation, every size cap,
  bundle split, host globals and third-party notices all passed. The
  codec/profile loads exclusively from `dist/providers.js`.
- `.husky/_/pre-commit` exists, `core.hooksPath` is `.husky/_`, and
  `gitleaks` is available; commits run the normal lint-staged and staged
  secret scan hooks.

The rig/common rules explicitly forbid a full `npm run quality` on a lane;
the lead owns that gate. No gate is weakened. The rig note's prohibition
on merge/rebase overrides common.md's old integration instruction.

Measured production bundles (all existing caps unchanged):

| Bundle                              |      Size |     Cap |
| ----------------------------------- | --------: | ------: |
| `dist/providers.js`                 |  97.3 KiB | 125 KiB |
| `dist/extension.js`                 | 553.1 KiB | 600 KiB |
| `dist/modelApi.js`                  | 413.3 KiB | 475 KiB |
| `dist/modelsPanel.js`               |  51.0 KiB |  75 KiB |
| `dist/webview/models.js`            | 411.4 KiB | 475 KiB |
| `dist/checkpointStore.js`           |  88.4 KiB | 225 KiB |
| `dist/webview/main.js` (startup JS) | 896.4 KiB | 900 KiB |
| `dist/acp.js`                       | 798.8 KiB | 850 KiB |

## Request/error red drills

Each mutation ran the complete owning test file, without filtering tests.
All eight mutations exited 1 at the named test, then the source buffer was
restored byte-exact in `finally`. Before/after SHA-256 for every mutation:

`95dd73b0b3bf30b00d8f2e735a45da2086a8590b03ba79e95069be2f6a726fee`

| Guard                      | Deliberate break                    | Named failing test                                                                 |
| -------------------------- | ----------------------------------- | ---------------------------------------------------------------------------------- |
| Output parameter omitted   | Always emit `max_output_tokens`     | matches the preview-rule namespace golden without changing the canonical body      |
| Retention omitted          | Always emit retention               | matches the preview-rule namespace golden without changing the canonical body      |
| Namespace wrapper          | Send top-level function tools       | matches the preview-rule namespace golden without changing the canonical body      |
| Full history               | Replay only the last item           | keeps full earlier history and tool schemas byte-exact as a conversation grows     |
| Hosted tools refused       | Disable the hosted-tool guard       | does not offer unsupported hosted tools through a function namespace               |
| Nested error validation    | Skip an invalid nested error        | rejects malformed nested errors without exposing their contents                    |
| First-event plan limit     | Disable the error-event limit match | surfaces the first nested plan-limit event before response.failed is available     |
| Failed-response plan limit | Disable the terminal limit match    | also recognises a response.failed plan limit when no preceding error event arrives |

The first first-event mutation exposed a test gap: a subsequent
`response.failed` still produced the expected error, hiding the broken first
handler. An error-only case was added and the complete drills rerun; the
new case fails when that handler is broken.

## Cap red drills

All thirteen mutations ran the complete cap test file and exited 1 at the
named test. Each restored the original source buffer in `finally` and
compared SHA-256 before/after:

`8019ce397d7a075d506a69bcb07b197d80eb9338c6b57ea8c666ee76dacac60b`

| Guard                       | Deliberate break                      | Named failing test                                                                  |
| --------------------------- | ------------------------------------- | ----------------------------------------------------------------------------------- |
| Mandatory host cap          | Disable missing-cap refusal           | requires a host cap rather than silently allowing an unbounded reply                |
| Safe integer cap            | Remove safe-integer check             | refuses an invalid host cap (NaN / Infinity / 1.5)                                  |
| Positive cap                | Remove positive check                 | refuses an invalid host cap (0 / -1)                                                |
| Safe integer counter        | Remove safe-integer check             | refuses an invalid counter result (NaN / Infinity / 1.5)                            |
| Nonnegative counter         | Remove nonnegative check              | refuses an invalid counter result (-1)                                              |
| Crossing the cap            | Disable crossing refusal              | aborts before yielding an over-cap response.output_text.delta and closes the source |
| Exact cap allowed           | Change `>` to `>=`                    | allows exactly the cap without aborting                                             |
| Active request cancellation | Remove `abort()`                      | aborts before yielding an over-cap response.output_text.delta and closes the source |
| Hidden reasoning usage      | Ignore reported output tokens         | uses reported output usage to bound invisible reasoning before yielding completion  |
| Response boundary           | Bypass response-event cap             | uses reported output usage to bound invisible reasoning before yielding completion  |
| Item boundary               | Bypass item-event cap                 | checks a final item without deltas through the host counter                         |
| Delta boundary              | Bypass delta-event cap                | aborts before yielding an over-cap response.output_text.delta and closes the source |
| API-key compatibility       | Apply the ChatGPT cap to API profiles | does not enforce the ChatGPT cap on an API-key profile                              |

## Handoff

Implementation commits: `10b8acfe` (request and typed limits), `1cec83e4`
(mandatory host output-cap interface and guards). Both normal commit hooks
passed ESLint, Prettier and staged gitleaks. The worktree stayed within lane
C's five files; no other lane's production, shared strings or documentation
was edited. No push, merge, rebase, live call, paid call, credential read or
dependency change occurred.

The lead's integration supplies the namespace, host counter/cancellation,
auth/transport subscription record, UI mapping for typed errors, and lane
W's PLAN/CHANGELOG/README/PRIVACY updates. Full quality remains the lead's
gate. The capture-backed request comparison is closed by FIXM95BC below;
the success/tool-call observations listed above remain open. This record
does not certify a live plan turn.
The owner's automatic enhancements/paid-consent rulings do not change this
pure codec; plan usage remains separate from API-key paid-use policy.

## FIXM95BC — RVM95BC review repairs (2026-10-05)

Repair worktree `/home/randy/lanes/FIXM95BC`, branch `m95b/cfix`, base
`b1fecc7c`; all commands run directly on **Kubuntu**. The rig brief overrides
the common rules' old merge instruction and delegates full quality to the
lead. No merge, rebase, push, new dependency, gate change, credential read,
network request or model call is made.

### P2 — cap-crossing usage settlement

`ResponsesOutputCapError.usage` now carries the validated report separately
from output. The codec still aborts once and throws before yielding the
excess event. A delta-only cut has no usage report; no usage is invented.
The normal count callback retains its counting-only contract.

The regression drives the actual codec and `ModelApiHost` with a test-only
client adapter that translates this error into an empty-output canonical
`response.failed`. The host's existing `noteUsage` path emits exactly one
`tokenUsage` with input **5**, cached **2**, output **3** and reasoning **1**,
and calls the normal response-usage observer once. Completed, incomplete
and failed terminal frames all settle this way. The turn fails, only the
admitted `ab` delta is shown, the replay contains only its user message,
and the excess `write_file` call never executes. The production adapter
belongs to lane T/I/W and must perform this same translation before exposing
the failure to the host; this codec-only repair does not certify dispatch.

- Correctly configured pre-fix owning suite: **3 failed, 19 passed** at the
  missing `tokenUsage` assertion. Two earlier setup-only runs refused the
  test's invalid approval-mode values; they are not regression evidence.
- After the fix, the three codec suites: **80 passed**.
- Red drill: replace the error's usage argument with `undefined`; the full
  cap suite exits **1**, **3 failed, 19 passed**, at
  `settles reported usage from an over-cap response.completed through ModelApiHost without excess replay`
  and its incomplete/failed cases. Restore the source buffer in `finally`
  and verify identical before/after SHA-256:
  `8833b3c3948308da5f8590b452d513a6ecdf664f379686de852f38c1c02474fc`.
- `npm run typecheck`: all five projects pass after correcting the new
  test's `memoryToolIo` argument list. Scoped ESLint exits **0**.

### P3 — capture-backed request comparison

The fixture is the complete scrubbed frame supplied at
`/home/randy/lanes/_ctx/codex/M95B-CAPTURE-responses.md`, run
`577bc807-780d-4d99-9c09-e4d43a9d8538`, seq **5**, step
`responses-namespace`, at `2026-10-05T19:52:23.180Z`. It records the owner's
one counted plan attempt from the empty capture scratchpad, not a model
attempt by this lane. Its failure SSE does not establish a successful plan
turn. Source SHA-256:
`82657fc8b58ab3776410ff0c5633982fb095f14202ddda7653c918ff402483b1`;
fixture SHA-256 after Prettier only folds the `include` array:
`0f484bb6a8883227396061f1b7b95bcb4ed46c37a2ec70198b2cfb1c5071b807`.

The encoder accepts the caller's optional `toolNamespaceDescription` and
keeps it on the namespace. Its local request type permits a function's
declared boolean strictness without changing Meta's canonical `strict:
false` type or any tool schema. No runtime strictness is forced. The existing
contract golden checks false; the captured request comparison checks true.

`matches the scrubbed captured request with only documented harness adaptations`
parses the fixture with zod, retains additional request fields, projects
the captured functions into the encoder and compares every encoded field
against the captured body plus exactly these documented adaptations:

| Path                 | Intentional adaptation and reason                                    |
| -------------------- | -------------------------------------------------------------------- |
| `/input/0/type`      | Canonical replay explicitly names its message item.                  |
| `/input/0/content`   | The harness uses typed `input_text` parts instead of shorthand text. |
| `/instructions`      | The harness supplies its system/tool instructions.                   |
| `/tool_choice`       | Explicit `auto` keeps the harness's tool-loop contract.              |
| `/reasoning/summary` | `auto` requests the visible thought summaries the harness shows.     |

There is no adaptation to the namespace description, strict flag,
parameters, model, cache key, effort, include fields, store or stream. The
canonical cap and retention are omitted just as in the capture. The test
also checks that encoding leaves its input unchanged.

- Pre-fix full request/error suite: **1 failed, 13 passed**, specifically
  the missing namespace description in the captured comparison.
- After the fix, all three codec suites: **81 passed**.
- Red drill 1: replace the encoded namespace description with `undefined`.
  The full request/error suite exits **1**, **1 failed, 13 passed**, at the
  capture-comparison test.
- Red drill 2: coerce every namespace function to `strict: false`.
  The same full suite exits **1**, **1 failed, 13 passed**, at that test's
  captured `strict: true` comparison. The original false golden still passes.
- Each drill restores the original source buffer in `finally` and verifies
  byte-exact SHA-256 before/after:
  `32ca130ac4ce62c94e5f58d0fad93a0800af579faaf1e3e2e082c23444e2cd6f`.

Both RVM95BC findings are fixed in the owned codec/test seam; none is
deferred. Integration still supplies the canonical cap-error translation,
namespace inputs, counter/cancellation and subscription transport. Shared
core logic serves every editor and ACP/headless without an editor API.

### Final repair verification

All checks ran serially, directly in this worktree on Kubuntu, with no
threshold, ignore, rule, dependency or guard relaxation:

| Check                                                                                                                                                               | Result                                                                                              |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `npm run typecheck`                                                                                                                                                 | Exit 0, all five projects.                                                                          |
| `npx eslint --max-warnings=0` on the codec and both changed test files                                                                                              | Exit 0.                                                                                             |
| `npx prettier --check` on all six changed files                                                                                                                     | Exit 0.                                                                                             |
| `npx vitest run test/unit/chatgptResponsesCodec.test.ts test/unit/chatgptResponsesCap.test.ts test/unit/responsesCodec.test.ts --maxWorkers=3 --testTimeout=120000` | Exit 0, **81 passed**: 14 request/error, 22 cap, 45 existing Responses.                             |
| `npm run deadcode`                                                                                                                                                  | Exit 0; only the existing `vendor/**` configuration hint.                                           |
| `npx jscpd`                                                                                                                                                         | Exit 0, zero clones.                                                                                |
| `npm run check:l10n`                                                                                                                                                | Exit 0, 14 tables, 127 manifest strings, 491 source files, zero problems.                           |
| `npm run check:host-api`                                                                                                                                            | Exit 0, 283 APIs, 23 VS Code importing files, 23 Node built-ins, 57 theme variables, zero problems. |
| `npm run build`                                                                                                                                                     | Exit 0: unchanged size/split/host-globals/notices gates; codecs exclusively in `providers.js`.      |
| `git diff --check`                                                                                                                                                  | Exit 0.                                                                                             |

Final production sizes: providers **97.4/125 KiB**, extension
**553.1/600**, Model API **413.3/475**, Models panel **51.0/75**, Models
webview **411.4/475**, checkpoint store **88.4/225**, chat startup
**896.4/900**, ACP **798.8/850**. All existing caps pass.

P2 commit `389481d0` ran the normal `.husky/_` wrapper, ESLint/Prettier
lint-staged tasks and staged gitleaks successfully. The capture repair and
this final record are committed with the same hooks and explicit paths.
The existing contract golden is unchanged; the copied capture is structurally
identical to its supplied source. Full quality and shared README/CHANGELOG
updates remain the lead/lane W's responsibility under the rig brief and
PLAN §7. BC-INTEGRATION is recorded in PLAN §9; no review finding remains
unfixed. No successful live plan turn is claimed.
