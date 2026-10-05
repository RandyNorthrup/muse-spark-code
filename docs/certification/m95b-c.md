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

The output-cap piece follows in this lane's next commit. No fake transport,
credential reader, model slug fallback, user text, dependency, escape hatch,
command, setting or script is added.

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

Raw scrubbed request/SSE files and the attempt ledger are absent from this
worktree and `_ctx`; their path has been requested. The golden is a
deterministic contract projection of the supplied capture findings, with
canonical test values, **not a byte-for-byte copy of an available raw
request**. In particular, the owner's probe used a strict function; this
codec preserves the harness's existing `strict: false` schemas rather than
changing optional arguments. A live plan tool-call event, its namespace
field, encrypted reasoning and cached-token usage remain uncaptured in the
owner's findings. No speculative parser for those fields is added.

## Verification

Commands run serially, directly in this worktree:

- Before implementation,
  `npx vitest run test/unit/chatgptResponsesCodec.test.ts --maxWorkers=3 --testTimeout=120000`:
  **8 failed, 1 passed**, proving the request/error acceptance tests fire.
- After implementation,
  `npx vitest run test/unit/chatgptResponsesCodec.test.ts test/unit/responsesCodec.test.ts --maxWorkers=3 --testTimeout=120000`:
  **54 passed** before the four additional error-only/header cases.
- `npm run typecheck`: all five projects passed.
- `npx eslint --max-warnings=0 src/core/backends/modelapi/codecs/responses.ts test/unit/chatgptResponsesCodec.test.ts`:
  passed.
- Prettier applied to the changed source, tests and golden.
- `.husky/_/pre-commit` exists, `core.hooksPath` is `.husky/_`, and
  `gitleaks` is available; commits run the normal lint-staged and staged
  secret scan hooks.

The rig/common rules explicitly forbid a full `npm run quality` on a lane;
the lead owns that gate. No gate is weakened. The rig note's prohibition
on merge/rebase overrides common.md's old integration instruction.

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
