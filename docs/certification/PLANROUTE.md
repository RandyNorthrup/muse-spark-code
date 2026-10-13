# Lane PLANROUTE: ChatGPT plan route gaps (OPENAI-G26, G27, G28)

Branch `fix/chatgpt-plan-route` from main `898a26c5e3` (release 0.18.2).
No model call of any kind was sent; no provider was contacted except to
read public documentation pages. The scan records
(`~/lanes/_ctx/gaps/*.json`) are not on this rig, so each gap below was
re-verified against the provider's current pages and this repo's code.

## Provider documentation (read 2026-10-13, quoted)

- Model facts:
  `https://developers.openai.com/api/docs/models/gpt-5.3-codex.md` —
  "GPT-5.3-Codex supports `low`, `medium`, `high`, and `xhigh` reasoning
  effort settings", "400,000 context window", "Maximum input tokens:
  272,000", "128,000 max output tokens".
  `.../models/gpt-5.2-codex.md` — the same four figures.
  `.../models/codex-mini-latest.md` — "200,000 context window",
  "100,000 max output tokens"; reasoning support but no effort list and no
  maximum input.
- Effort values: `https://developers.openai.com/api/docs/guides/reasoning.md` —
  "Supported values are model-dependent and can include `none`, `minimal`,
  `low`, `medium`, `high`, `xhigh`, and `max`."
- Catalogue and inference:
  `https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference.md` —
  catalogue keeps `slug`/`display_name` with `visibility: "list"`; inference
  is `POST https://api.openai.com/v1/responses` with `store: false` and
  `stream: true`.
- Refusals:
  `https://developers.openai.com/siwc/token-sharing-open-source/errors-and-recovery` —
  the structured-error table (`subscription_sharing_user_not_eligible` 403,
  `subscription_sharing_usage_limit_exceeded` 429,
  `subscription_sharing_usage_unavailable` 503,
  `subscription_sharing_unsupported_capability` 400 with `error.param`,
  `subscription_sharing_route_not_supported` 403,
  `subscription_sharing_invalid_user` 401,
  `chatpass_v2_scope_not_authorized` /
  `chatpass_v2_invalid_authorization_context` 403,
  `subscription_sharing_user_unavailable` 503) and direct-route admission
  bodies such as `{"detail":"..."}` ("Treat the message as diagnostic text,
  not a stable machine-readable code").

## OPENAI-G26 — plan models use their own numbers (done)

- What was built: `src/core/providers/subscriptions/chatgptPlanFacts.ts`
  (per-slug record from the pages above); `metaResolvedModel`
  (`src/core/backends/modelapi/modelPolicy.ts`) resolves a `chatgpt/*`
  model from that record — context window, output cap and effort levels —
  and an unknown slug stays unknown (never Meta's 1,048,576 window);
  `modelContextLimit` in `src/core/providers/subscriptions/registry.ts`
  returns the record's maximum input tokens. A requested level the record
  lists rides as named, so `reasoning.effort` is sent as a level again.
- Other Meta-constant uses reviewed (same class search): transport
  timeouts and the 16 MiB stream cap in `registry.ts` (not model numbers,
  unchanged); the `origin` fallback to Meta's base URL in
  `metaResolvedModel` (endpoint attribution, not a model number,
  unchanged); Copilot rows keep their adapter's numbers on their own path.
- UNVERIFIED until the capture: which slugs a plan catalogue lists (C1);
  whether the plan route honors `reasoning.effort` levels (C3, C4), the
  `none` value the product used to send for every level (C5), and
  `max_output_tokens` (C6). A requested level outside the record still
  resolves to `none` through the shared resolver (pinned by
  `test/unit/modelPolicy.test.ts`, deliberately unchanged).
- Person's steps: sign in with ChatGPT, pick a plan codex model, send a
  turn. Long context past 400,000 tokens is refused before sending instead
  of failing at the provider; the effort chosen in the composer reaches the
  request for a documented level.

## OPENAI-G27 — one true sentence per plan refusal (done)

- What was built: `src/core/providers/subscriptions/planRefusals.ts`
  (pure mapper over the documented shapes); the Responses codec throws
  `ChatgptPlanRefusalError` for the documented families
  (`subscription_sharing_*`, `chatpass_v2_*`; the limit code keeps its
  `ChatgptPlanLimitError` name/shape); the registry maps non-2xx plan
  responses and stream refusals to per-code sentences and yields unknown
  codes and `{"detail":...}` bodies with the provider's own text. A
  429 limit still opens the existing usage-limit screen.
- The scan was right about the code: only the limit code was understood
  (`registry.ts` catch, codec throw sites).
- UNVERIFIED until the capture: nothing in the mapping needs a live call
  (every code and shape above is provider-documented), but no refused
  response has been observed end to end; the capture plan asks the lead to
  save any non-2xx answer verbatim (PLANROUTE-C1..C6 note).
- Person's steps: with an ineligible account, sending on a plan model now
  says the plan cannot be used for this account and names signing in with
  an eligible account or choosing an API-key model — instead of "try
  again". Each other refusal likewise names its action (keep the sign-in
  and retry later on 503s; sign in again on 401; change the request for an
  unsupported capability).

## OPENAI-G28 — limit headers shown in Plan Usage (done)

- What was built: `parsePlanLimitHeaders` + `limits` on the tally row
  (`src/core/providers/subscriptions/planUsage.ts`, shape shared with
  `src/shared/usage.ts`); the registry keeps only allow-listed response
  header names and parses the `x-codex-primary/second
  ...[truncated 1943 chars]
