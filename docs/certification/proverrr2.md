# PROVERRR2 round 2 — the five error/limit gaps (2026-10-13)

Lane branch `fix/provider-refusals`. No model call and no request to any
provider API from this lane. The exact real requests that settle every
remaining fact are `docs/certification/proverrr2-capture-plan.json`
(9 requests); everything below marked UNVERIFIED stays so until the lead's
answers come back and are saved as fixtures.

## XAI-G10 — xAI error bodies keep their code (closed)

xAI answers flat (`{"code","error"}` with `error` a string). The configured
path used to replace every such body with one fixed sentence, so a quota 429
could not be told from a rate 429. The shared extractor
(`extractRefusalEnvelope` in `src/core/backends/modelapi/providerRefusal.ts`)
now reads the flat shape — message from the `error` string, code from beside
it — and every wire format uses it, never chosen by a vendor's name. The
recorded xAI bad key (400 `invalid-argument`) classifies `authentication`;
the recorded unknown model (404 `not-found`) classifies `notFound`
(`test/unit/providerRefusals.test.ts`, fixtures recorded 2026-10-12).

- Rests on: the two recorded xAI answers (fixtures, 2026-10-12).
- UNVERIFIED: the exact xAI 429 bodies for rate vs quota
  (capture `XAI-G10-429-rate`, `XAI-G10-429-quota`); the unsupported-parameter
  400 (capture `XAI-effort-400`; measured through the product 2026-10-12, no
  fixture saved).
- Person's steps: point any xAI entry at a made-up key and list models — the
  turn ends with "the stored key was rejected" plus xAI's own words, never
  retried. Ask for `no-such-model-real-life` — "it has no such model".

## OPENAI-G20 — the envelope code reaches the retry classifier (closed)

The configured codec replaced every error body with one fixed sentence, so a
429's envelope code never reached the retry decision and a quota 429 was
retried up to 4 times. Now the code rides on the failure
(`src/core/providers/configured.ts` `openAiRefusal`), the transport decides
by the preset's own retry table (`src/core/backends/modelapi/transport.ts`
`retryTable`, defaulting to the Responses table), and the stream client
decides by the same table (`src/core/backends/modelapi/providerClient.ts`
via `presets.quirksOf(preset).retry`, which carries OpenAI's documented
retryable `server_error`). A 429 with no kind or code retries; the same 429
with `insufficient_quota` is `credit` and never retries
(`test/unit/providerRefusals.test.ts`).

- Rests on: OpenAI's documented 429 codes
  (https://developers.openai.com/api/docs/guides/error-codes, read
  2026-10-13: retrying billing, spend or quota errors will not restore
  access); the recorded OpenAI answers (fixtures, 2026-10-12).
- UNVERIFIED: a real OpenAI quota-429 body (capture `OPENAI-G20-429-quota`).
- Person's steps: on a key with no credit, send a turn — the first 429 ends
  the turn with "its account is out of credit", exactly one request, never
  retried. On a rate-limited key, the turn waits and retries within the
  table, then either answers or says "too many requests".

## GAPANTH-G20 — spend cap, request id, priority headers (closed)

Three signals: (1) the spend-cap 429 is read from the documented
`error.details.error_code` (`enforced_spend_limit_reached`) instead of a
prose match that could never fire — it classifies `credit` and is never
retried (`parseAnthropicError` in
`src/core/backends/modelapi/codecs/anthropic.ts`); (2) the `request-id` /
`x-request-id` header was already attached by the transport and is now also
kept on usage records (`src/shared/usageJournal.ts` allow list); (3)
Anthropic's documented `anthropic-priority-*` headers are kept on usage
records, never interpreted as a meter.

- Rests on: https://platform.claude.com/docs/en/api/rate-limits
  (#reaching-your-spend-cap, read 2026-10-13); the recorded Anthropic answers
  (fixtures, 2026-10-12).
- UNVERIFIED: a real spend-cap 429 body and header set
  (captures `GAPANTH-G20-429-spend-cap`, `GAPANTH-G20-429-rate`).
- Person's steps: on a spend-capped key, send a turn — "its account is out
  of credit", one request, never retried; support gets the request id from
  the refusal and the usage record.

## GAPANTH-G11 — a reply cut at max_tokens continues (closed)

The codec passed the provider word `max_tokens` through while the host
continues only on its own output-limit word, so the turn ended and tool
calls were skipped. `stopOutcome`
(`src/core/backends/modelapi/codecs/anthropic.ts`) now maps `max_tokens` to
the host's `max_output_tokens` incomplete reason — the same word the chat
codec (`length`) and the Gemini codec (`MAX_TOKENS`) already map to — so the
host's existing continuation rule (`ModelApiHost.ts`, one rule for every
provider that reports it) replays the continuation prompt and keeps the
turn. `refusal`, `pause_turn` and any other stop keep the provider's word:
the turn must not blindly continue a refused or paused turn.
`model_context_window_exceeded` keeps the provider's word and ends the turn
(it cannot be continued into the same window). Offering a fallback model on
a refused turn is not built: no such mechanism exists in the product, and it
is a product decision for the owner (PLAN.md §3).

- Rests on: the host continuation branch (unchanged); the Anthropic
  `message_delta.stop_reason` shape the codec already parsed.
- UNVERIFIED: a real cut-off reply with partial tool calls
  (capture `GAPANTH-G11-max-tokens`).
- Person's steps: ask an Anthropic model for a long answer with a small
  output limit — the turn says it is continuing and the answer arrives in
  parts instead of ending early with skipped tool calls.

## AZURE-G06 — content-filter block has its own sentence (closed, route excepted)

The shared classifier maps `error.code: "content_filter"` to the new
`contentFilter` kind with its own sentence ("its content filter blocked
it … nothing reached a model and nothing was charged"), never retried
(`src/core/backends/modelapi/providerRefusal.ts`). A streamed filter block
(`finish_reason: content_filter`, which the chat codec already carries as
`response.failed` with that code) stays `streamError`: output was consumed,
so the uncharged-400 sentence would be false, and liability stays
uncertain. The Azure route itself lands in another lane's branch
(`feat/azure`); this lane gives the mapping only.

- Rests on: https://learn.microsoft.com/en-us/azure/ai-services/openai/concepts/content-filter
  (read 2026-10-13: filtered prompts answer HTTP 400; `finish_reason`
  `content_filter` marks filtered completions).
- UNVERIFIED: a real Azure block body (capture `AZURE-G06-content-filter`).
- Person's steps (once the Azure route lands): send a flagged prompt — the
  turn ends with the content-filter sentence and the provider's words, never
  retried, nothing charged.
