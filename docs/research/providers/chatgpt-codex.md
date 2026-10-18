# ChatGPT plan sign-in (Sign in with ChatGPT, plan usage for third-party apps) and Codex plan limits — research and product comparison

Research date 2026-10-17. Official sources only (§1); every value read on
2026-10-17. Product: `main` at `3d30a73214` (read only). Owner's rule
(2026-10-17, binding): "the limits we set on our agents hardcoded are **ONLY**
the limit set from the providers" and "**ALL** every model available through
every provider all hooks all features all limits etc".

Classes: **(a)** matches OpenAI; **(b)** differs (both values given); **(c)**
missing from the product; **(d)** hard-coded in the product but not an OpenAI
limit. "not documented" rows name the capture that would settle them (§7).

**What a ChatGPT plan allows a third-party client.** OpenAI documents a
program for exactly this: **Sign in with ChatGPT**, with "ChatGPT plan usage"
for "open-source and locally hosted apps" ("Let eligible users use their
ChatGPT plan for AI requests in your app"; paid or remotely hosted apps use a
separate interest form) (SIWC, SIWC-TS). The app registers its own client
through `dynamic_agent_client` with an `ext_agent_host_id` and
`agent_name_hint`, asks for `chatgpt.tokens.use.direct`, and calls
`POST https://api.openai.com/v1/responses` with the plan token (SIWC-SIGNIN,
SIWC-MODELS). The product implements this flow
(`src/core/providers/subscriptions/chatgpt.ts`, `registry.ts`), not a reuse of
the Codex CLI's login. Codex's own clients (CLI, IDE, app, cloud) sign in with
ChatGPT under the plan limits in §4.

## 1. Sources

| Key         | URL                                                                                          | Read       |
| ----------- | -------------------------------------------------------------------------------------------- | ---------- |
| SIWC        | https://developers.openai.com/siwc (redirect from learn.chatgpt.com/siwc)                    | 2026-10-17 |
| SIWC-TS     | https://developers.openai.com/siwc/token-sharing-open-source                                 | 2026-10-17 |
| SIWC-SIGNIN | https://developers.openai.com/siwc/token-sharing-open-source/sign-in                         | 2026-10-17 |
| SIWC-MODELS | https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference            | 2026-10-17 |
| SIWC-TOKEN  | https://developers.openai.com/siwc/token-sharing-open-source/token-reference                 | 2026-10-17 |
| SIWC-ERR    | https://developers.openai.com/siwc/token-sharing-open-source/errors-and-recovery             | 2026-10-17 |
| SIWC-LIMITS | https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations             | 2026-10-17 |
| CX-PRICING  | https://learn.chatgpt.com/docs/pricing (redirect from developers.openai.com/codex/pricing)   | 2026-10-17 |
| CX-AUTH     | https://learn.chatgpt.com/docs/auth                                                          | 2026-10-17 |
| CX-MODELS   | https://learn.chatgpt.com/docs/models                                                        | 2026-10-17 |
| M           | https://developers.openai.com/api/docs/models/&lt;id&gt;.md (API model pages, see openai.md) | 2026-10-17 |

## 2. Summary

- **Models.** Codex's models page names **7** models for ChatGPT sign-in:
  `gpt-6-astra`, `gpt-6.1-sol`, `gpt-6-sol`, `gpt-6-luna`, and GPT-5.6 Sol,
  Terra and Luna ("remain available during the rollout"); it records
  retirements from ChatGPT sign-in for `gpt-5.5` (2026-10-14),
  `gpt-5.4`/`gpt-5.4-mini` (2026-08-31), `gpt-5.3-codex-spark` (2026-09-14)
  and deprecations of `gpt-5.2`, `gpt-5.3-codex` (CX-MODELS). The SIWC flow
  lists models per account from `GET /v1/models` (SIWC-MODELS). All 7 plus
  the 5 retired/deprecated ids are covered in §5. **Plans**: Free, Go, Plus,
  Pro ($100/$200/$500), Business, Enterprise/Edu (CX-PRICING) — §4.2.
- **Counts** (class tags on the 63 classified rows of §3-§5; a row may
  carry two): **(a) 42, (b) 12, (c) 9, (d) 3**. Itemised changes (§6):
  4 (b), 6 (c), 2 (d).
- **Most important mismatches.**
  1. **Every plan request sends `reasoning.effort: "none"`.** Plan models get
     no effort list (`modelPolicy.ts:79-130` with `evidence.effortLevels`
     undefined), so `effortForPolicy` returns `none` (`modelPolicy.ts:157-172`).
     The API model pages say GPT-6 Astra does not take `none` (400) and
     GPT-6.1 Sol does not take `none` or `minimal` (M); whether the plan route
     enforces the same is not documented (capture: one plan turn per model).
  2. **Plan models get Meta's limits**: context 1,048,576 and output 32,768
     (`modelPolicy.ts:202-223`, `ModelApiHost.ts:4452-4455`); the output cap
     is enforced client-side by counting bytes (`registry.ts:99-123,340-347`).
     The plan flow documents no window or output cap and tells apps to
     **omit** `max_output_tokens` (SIWC-LIMITS); the API pages give
     1,050,000 / 128,000 for the GPT-6 and GPT-5.6 models (M).
  3. **HTTP-level plan errors are not classified.** `subscription_sharing_usage_limit_exceeded`
     (429) is caught only mid-stream (`codecs/responses.ts:513,535`); a non-OK
     HTTP answer becomes a generic failure (`registry.ts:315`).
     `subscription_sharing_usage_unavailable` and `subscription_sharing_user_unavailable`
     (503) call for "retry later with bounded backoff" (SIWC-ERR); the plan
     path never retries.
  4. **Every sign-in re-registers.** OpenAI: after the first registration
     "save the issued `client_id` (for example, `oaiapp_...`) for later
     sign-ins" (SIWC-SIGNIN); the product always starts with
     `dynamic_agent_client` (`chatgpt.ts:138`).
  5. **Usage windows**: the plan flow documents no usage headers or reset
     times ("Do not ... infer a reset time from this code alone"; point users
     to ChatGPT settings → Usage, SIWC-ERR). The product journals undocumented
     `x-codex-*` headers (`usageJournal.ts:85-90`) and keeps local tallies
     (`planUsage.ts:1-65`): reading those headers needs a capture (AGENTS.md
     rule 14), not a guess.

## 3. Sign-in and token flow

| Item                   | OpenAI                                                                                                                                                                                                                                                              | Source               | Product today (file:line)                                                                                                                                                                                                  | Class                                |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| Program                | Sign in with ChatGPT; plan usage "for open-source and locally hosted apps"; paid or remotely hosted apps: separate interest form                                                                                                                                    | SIWC, SIWC-TS        | open-source, local VS Code extension using the flow                                                                                                                                                                        | (a)                                  |
| Authorization endpoint | `https://auth.openai.com/api/accounts/authorize`, system browser                                                                                                                                                                                                    | SIWC-SIGNIN          | issuer and endpoints pinned (`chatgpt.ts:21,31-35`); URL built (`chatgpt.ts:120-150`)                                                                                                                                      | (a)                                  |
| Token endpoint         | `POST https://auth.openai.com/api/accounts/oauth/token` (form-encoded `authorization_code`)                                                                                                                                                                         | SIWC-SIGNIN          | `chatgpt.ts:31-35,410-420`                                                                                                                                                                                                 | (a)                                  |
| Registration           | first time `client_id=dynamic_agent_client` ("not the client ID to save or use for token exchange"); `ext_agent_host_id` required, opaque, distinct per host; `agent_name_hint` = the app's actual name, consistent; save the issued `client_id` for later sign-ins | SIWC-SIGNIN, SIWC-TS | `dynamic_agent_client` on every sign-in (`chatgpt.ts:26,138`); refuses it as the final id (`chatgpt.ts:184`); `ext_agent_host_id` (`chatgpt.ts:148`); `agent_name_hint: 'Muse Spark Code (Unofficial)'` (`chatgpt.ts:147`) | registration (a); later sign-ins (b) |
| Scopes                 | `offline_access resource.invoke chatgpt.tokens.use.direct`; "A valid ID token alone does not authorize ChatGPT plan usage" — check granted scopes                                                                                                                   | SIWC-SIGNIN          | `openid profile email offline_access resource.invoke chatgpt.tokens.use.direct` (`chatgpt.ts:24-25`); granted scope checked (`chatgpt.ts:95-99,435-436`)                                                                   | (a)                                  |
| `resource`             | `https://api.openai.com/v1`                                                                                                                                                                                                                                         | SIWC-SIGNIN          | `chatgpt.ts:23,142`                                                                                                                                                                                                        | (a)                                  |
| PKCE                   | `S256`, base64url SHA-256 without padding                                                                                                                                                                                                                           | SIWC-SIGNIN          | `chatgpt.ts:145-146`                                                                                                                                                                                                       | (a)                                  |
| Redirect URI           | HTTP loopback on `127.0.0.1` (not `localhost`); only the port may vary; same URI in authorize and exchange                                                                                                                                                          | SIWC-SIGNIN          | `127.0.0.1`, `/auth/callback`, any port (`chatgpt.ts:101-118`; `host/providers/chatgptSignIn.ts:78`)                                                                                                                       | (a)                                  |
| Tokens                 | access 1 hour (`expires_in: 3600`); refresh 30 days, replaced on each refresh; `earliest_refresh_at`; issuer `https://auth.openai.com`; audience `https://api.openai.com/v1`                                                                                        | SIWC-TOKEN           | access/refresh/`expires_in` parsed (`chatgpt.ts:38-45`); refresh grant (`chatgpt.ts:486-510`); `earliest_refresh_at` not read                                                                                              | (a); (c)                             |
| Refresh failures       | `invalid_grant`, `invalid_refresh_token`, `token_expired`, `refresh_token_expired`, `refresh_token_invalidated`, `refresh_token_reused` → clear tokens, repeat OAuth "with the saved issued client ID"; keep credentials on temporary failures                      | SIWC-ERR             | sign-in errors surfaced (`registry.ts:390-397`); repeat uses `dynamic_agent_client`                                                                                                                                        | (b)                                  |
| Storage                | save `refresh_token`; treat auth metadata as opaque                                                                                                                                                                                                                 | SIWC-TOKEN           | secret storage record (`chatgpt.ts` `chatGptRecordSchema`; `registry.ts:74-97`)                                                                                                                                            | (a)                                  |
| Codex CLI login        | `~/.codex/auth.json` or OS store; "Access tokens are intended for trusted scripts, schedulers, and private CI runners"; "For general OpenAI API calls, continue to use Platform API keys"                                                                           | CX-AUTH              | the product never reads Codex's `auth.json` (separate flow)                                                                                                                                                                | (a)                                  |

## 4. Plan inference and limits

### 4.1 The plan-token request

| Item              | OpenAI                                                                                                                                                                                                                                 | Source                   | Product today (file:line)                                                                                                                  | Class                                                                 |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------- |
| Endpoint          | `POST https://api.openai.com/v1/responses`; "do not point it at ChatGPT's `backend-api` endpoints"                                                                                                                                     | SIWC-MODELS              | `https://api.openai.com/v1/responses` (`registry.ts:51,305-313`)                                                                           | (a)                                                                   |
| Headers           | `Authorization: Bearer <ACCESS_TOKEN>`, `Content-Type`                                                                                                                                                                                 | SIWC-MODELS              | the same two (`registry.ts:310`)                                                                                                           | (a)                                                                   |
| `store`, `stream` | "Set `store` to `false` and `stream` to `true` on each HTTP inference request"                                                                                                                                                         | SIWC-MODELS, SIWC-LIMITS | `store: false`, `stream: true` (`ModelApiHost.ts:4516-4517`)                                                                               | (a)                                                                   |
| Omitted fields    | "Omit `background`, `conversation`, `max_output_tokens`, `max_tool_calls`, `metadata`, `moderation`"; omit `previous_response_id` over HTTP                                                                                            | SIWC-LIMITS              | `max_output_tokens` omitted for the ChatGPT profile (`codecs/responses.ts:449`); the others never sent                                     | (a)                                                                   |
| System role       | explicit `{type: "message", role: "system"}` items rejected                                                                                                                                                                            | SIWC-LIMITS              | instructions ride as `instructions`; goal progress as `developer` (`ModelApiHost.ts:4496-4503`)                                            | (a)                                                                   |
| Tools             | not supported: image generation, file search, Code Interpreter, native computer use, hosted MCP/connectors, Responses `tool_search`, top-level `programmatic_tool_calling`; web search "subject to model and account/workspace policy" | SIWC-LIMITS              | non-function tools refused before send (`codecs/responses.ts:402-404`); functions under a `namespace` tool (`codecs/responses.ts:428-438`) | (a); namespace wrapping not documented on SIWC (product capture)      |
| Media             | "Text, images, and files are supported when the selected model accepts them"; audio/video input, Files upload API and transcription not supported                                                                                      | SIWC-LIMITS              | plan models get no capability record beyond tool calling (`modelPolicy.ts:202-207`), so the composer treats media as unknown               | (c) images/files                                                      |
| Success           | inference counts as successful only after `response.completed`                                                                                                                                                                         | SIWC-MODELS              | stream decoded to completion (`registry.ts:339-353`)                                                                                       | (a)                                                                   |
| Reasoning         | not documented for the plan flow                                                                                                                                                                                                       | —                        | `reasoning: {effort: "none", summary: "auto"}` on every request (`ModelApiHost.ts:4512-4515`, `modelPolicy.ts:157-172`)                    | not documented; (b) against the API pages for GPT-6 Astra / 6.1 Sol   |
| Output cap        | not documented (the flow omits `max_output_tokens`)                                                                                                                                                                                    | SIWC-LIMITS              | client-side cut at 32,768 tokens counted as UTF-8 bytes (`registry.ts:99-123,340-347`; `constants.ts:2219`)                                | (d)                                                                   |
| Context           | not documented for the plan flow                                                                                                                                                                                                       | —                        | 1,048,576 (Meta's, `modelPolicy.ts:216`)                                                                                                   | (b) against the API pages (1,050,000) / not documented on the route   |
| Stream time       | not documented                                                                                                                                                                                                                         | —                        | idle 300 s, no total (`registry.ts:279`; `constants.ts:2326`)                                                                              | (d) user setting                                                      |
| Stream size       | not documented                                                                                                                                                                                                                         | —                        | 16 MiB (`registry.ts:326`; `SUBSCRIPTION_STREAM_MAX_BYTES`)                                                                                | (d)                                                                   |
| Models list       | `GET https://api.openai.com/v1/models` with the bearer token; response has a `models` array; filter `visibility: "list"`; use `slug`, `display_name`; refresh on account switch                                                        | SIWC-MODELS              | the same, plus a `supported_in_api` filter (`registry.ts:40-72`)                                                                           | (a); the extra filter rests on the owner's capture (`registry.ts:39`) |
| Token counting    | not documented for the plan flow                                                                                                                                                                                                       | —                        | JSON byte length (`registry.ts:217`)                                                                                                       | (a) (no provider count exists)                                        |

### 4.2 Plans and usage (Codex clients; the plan flow says "An app-specific limit can also apply")

| Plan                                       | Codex usage (CX-PRICING)                                                                                                             | Product today                                                          | Class                                           |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------- | ----------------------------------------------- |
| Free ($0)                                  | GPT-6 Luna at Standard speed in the desktop app, subject to rollout; no counts given                                                 | plan models listed from `/v1/models` per account (`registry.ts:53-72`) | (a)                                             |
| Go ($8/mo)                                 | same as Free                                                                                                                         | same                                                                   | (a)                                             |
| Plus ($20/mo)                              | web, CLI, IDE, iOS; GPT-6.1 Sol and GPT-6 Luna; local messages per 5 hours: Astra 5-45, 6.1 Sol 15-160, 6 Sol 15-150, Luna 350-3,000 | local tallies only (`planUsage.ts:1-65`)                               | (a) (no documented live source)                 |
| Pro (from $100; $100/$200/$500)            | "Pro plans currently have no five-hour limit"; Ultrafast on the $500 tier                                                            | same                                                                   | (a)                                             |
| Business ($20/user/mo annual, $25 monthly) | estimates as Plus; credits extend usage                                                                                              | same                                                                   | (a)                                             |
| Enterprise / Edu                           | flexible pricing: "no fixed rate limits"; otherwise about Plus; GPT-6.1 Sol off until an admin enables it                            | same                                                                   | (a)                                             |
| Weekly limits                              | "Weekly limits may also apply" (no detail)                                                                                           | none                                                                   | not documented                                  |
| Cloud tasks                                | share the local allowance and "may use more"                                                                                         | n/a (no cloud tasks)                                                   | n/a                                             |
| Fast / Ultrafast                           | Fast 2.5x included usage, 2x credits; Ultrafast 8x / 6x (Astra, 6.1 Sol)                                                             | not offered                                                            | (c)                                             |
| At the limit                               | "may finish the active turn, subject to fair use"; Plus/Pro can buy credits                                                          | the plan-limit event names the limit (`registry.ts:355-356`)           | (a)                                             |
| Where shown                                | chatgpt.com/codex/settings/usage; `/status` in the CLI                                                                               | the product links nothing                                              | (c) link to ChatGPT settings → Usage (SIWC-ERR) |
| API-key vs plan                            | API-key Codex use bills at API prices, separate from plan limits                                                                     | the product's OpenAI preset is the API-key path (openai.md)            | (a)                                             |

### 4.3 Errors

| Code                                                                                          | OpenAI guidance                                                                                                                            | Source   | Product today (file:line)                                                                                                                                                           | Class                    |
| --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ |
| `subscription_sharing_usage_limit_exceeded` (429)                                             | pause plan requests, link to ChatGPT settings → Usage; "Do not assume the entire plan is empty or infer a reset time from this code alone" | SIWC-ERR | mid-stream `response.failed`/`error` detected (`codecs/responses.ts:79,513,535`) → plan-limit message (`registry.ts:355-356`); as an HTTP 429 → generic failure (`registry.ts:315`) | mid-stream (a); HTTP (b) |
| `subscription_sharing_usage_unavailable` (503), `subscription_sharing_user_unavailable` (503) | keep credentials; retry later with bounded backoff                                                                                         | SIWC-ERR | no retry (`registry.ts:315`)                                                                                                                                                        | (c)                      |
| `subscription_sharing_invalid_user` (401)                                                     | diagnose, keep the request id; re-sign-in only after confirmed revocation                                                                  | SIWC-ERR | sign-in error codes (`registry.ts:390-397`)                                                                                                                                         | (a)                      |
| `subscription_sharing_user_not_eligible` (403)                                                | explain; don't repeat or loop through OAuth                                                                                                | SIWC-ERR | generic failure                                                                                                                                                                     | (c)                      |
| 403 (region/policy), 503 (direct routing unavailable)                                         | surface the restriction; bounded backoff                                                                                                   | SIWC-ERR | generic failure, no retry                                                                                                                                                           | (c)                      |
| `invalid_client`                                                                              | fix the client configuration                                                                                                               | SIWC-ERR | generic failure                                                                                                                                                                     | (c)                      |

## 5. Per-model tables

Plan availability from CX-PRICING and CX-MODELS; API values from M (shown
because the plan route documents none). Product for every plan model: no
effort list (→ `none` sent), context 1,048,576, output 32,768 enforced
client-side (§4.1).

### 5.1 `gpt-6-astra`

| Item              | OpenAI                                                                                                         | Source       | Product today                       | Class                              |
| ----------------- | -------------------------------------------------------------------------------------------------------------- | ------------ | ----------------------------------- | ---------------------------------- |
| Plan availability | estimates for Plus (5-45 local messages / 5 h); Pro; Business                                                  | CX-PRICING   | listed when `/v1/models` returns it | (a)                                |
| Reasoning         | Codex UI levels Light, Medium, Extra High ("some paid plans omit Extra High"); API: `low`..`max`, `none` → 400 | CX-MODELS, M | `none` sent                         | (b) not verified on the plan route |
| Context / output  | API: 1,050,000 / 128,000; plan route not documented                                                            | M            | 1,048,576 / 32,768 client cap       | (b) / not documented               |
| Fast / Ultrafast  | Ultrafast 8x usage, 6x credits                                                                                 | CX-PRICING   | not offered                         | (c)                                |

### 5.2 `gpt-6.1-sol`

| Item              | OpenAI                                                                                                                      | Source                | Product today        | Class                              |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------- | --------------------- | -------------------- | ---------------------------------- |
| Plan availability | Plus, Pro, Business, Enterprise, Edu (admin-enabled on Enterprise/Edu); not Free or Go; 15-160 local messages / 5 h on Plus | CX-MODELS, CX-PRICING | listed when returned | (a)                                |
| Reasoning         | Codex: Light to Ultra (Max and Ultra by settings); API: `low`..`max`, no `none` or `minimal`, default `medium`              | CX-MODELS, M          | `none` sent          | (b) not verified on the plan route |
| Context / output  | API 1,050,000 / 128,000                                                                                                     | M                     | 1,048,576 / 32,768   | (b) / not documented               |
| Credits           | 50 input / 2.5 cached / 250 output credits per million tokens                                                               | CX-PRICING            | n/a (no credits)     | n/a                                |

### 5.3 `gpt-6-sol`

| Item              | OpenAI                                                                                  | Source                | Product today        | Class                |
| ----------------- | --------------------------------------------------------------------------------------- | --------------------- | -------------------- | -------------------- |
| Plan availability | named in Power presets ("Sol Light", "Sol Medium"); 15-150 local messages / 5 h on Plus | CX-MODELS, CX-PRICING | listed when returned | (a)                  |
| Reasoning         | API: `none`..`max`, default `medium`                                                    | M                     | `none` sent          | (a) on the API list  |
| Context / output  | API 1,050,000 / 128,000                                                                 | M                     | 1,048,576 / 32,768   | (b) / not documented |

### 5.4 `gpt-6-luna`

| Item              | OpenAI                                                                                          | Source                | Product today        | Class                |
| ----------------- | ----------------------------------------------------------------------------------------------- | --------------------- | -------------------- | -------------------- |
| Plan availability | Free and Go (desktop app, rollout), Plus, Pro, Business; 350-3,000 local messages / 5 h on Plus | CX-PRICING, CX-MODELS | listed when returned | (a)                  |
| Reasoning         | Codex: up to Max, not Ultra; API `none`..`max`, default `medium`                                | CX-MODELS, M          | `none` sent          | (a) on the API list  |
| Context / output  | API 1,050,000 / 128,000                                                                         | M                     | 1,048,576 / 32,768   | (b) / not documented |

### 5.5 `gpt-5.6-sol`, `gpt-5.6-terra`, `gpt-5.6-luna`

| Item              | OpenAI                                                                                                               | Source                | Product today        | Class                |
| ----------------- | -------------------------------------------------------------------------------------------------------------------- | --------------------- | -------------------- | -------------------- |
| Plan availability | "remain available during the rollout" (no ids or details on CX-MODELS); a typical GPT-5.6 Sol task uses 2-15 credits | CX-MODELS, CX-PRICING | listed when returned | (a)                  |
| Reasoning         | API: `none`..`max`, default `medium`                                                                                 | M                     | `none` sent          | (a) on the API list  |
| Context / output  | API 1,050,000 / 128,000                                                                                              | M                     | 1,048,576 / 32,768   | (b) / not documented |

### 5.6 Retired or deprecated on ChatGPT sign-in

| Model                      | Status                                           | Source    | Product today                                 | Class |
| -------------------------- | ------------------------------------------------ | --------- | --------------------------------------------- | ----- |
| `gpt-5.5`                  | retires from ChatGPT sign-in 2026-10-14 (passed) | CX-MODELS | disappears when `/v1/models` stops listing it | (a)   |
| `gpt-5.4`, `gpt-5.4-mini`  | retired 2026-08-31                               | CX-MODELS | same                                          | (a)   |
| `gpt-5.3-codex-spark`      | retired 2026-09-14                               | CX-MODELS | same                                          | (a)   |
| `gpt-5.2`, `gpt-5.3-codex` | deprecated                                       | CX-MODELS | same                                          | (a)   |

## 6. Every (b), (c) and (d) item with the exact product change

### 6.1 Class (b)

| #   | Item                                                       | Product (file:line)                                                          | OpenAI                                                                                    | Exact change                                                                                                                           |
| --- | ---------------------------------------------------------- | ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| CB1 | `reasoning.effort: "none"` on every plan request           | `modelPolicy.ts:79-130,157-172`; `ModelApiHost.ts:4512-4515`                 | API: Astra rejects `none`; 6.1 Sol has no `none`/`minimal` (M); plan route not documented | give plan models the documented per-model effort lists (or omit `reasoning` until a capture proves what the route takes)               |
| CB2 | Meta's 1,048,576 context and 32,768 output for plan models | `modelPolicy.ts:202-223`; `ModelApiHost.ts:4452-4455`; `registry.ts:340-347` | no plan-route figures; API pages 1,050,000 / 128,000                                      | per-model plan record with source; no client-side output cut (the route takes no `max_output_tokens`) — or make the cut a user setting |
| CB3 | Re-registration on every sign-in                           | `chatgpt.ts:138`                                                             | reuse the saved issued `client_id` (SIWC-SIGNIN, SIWC-ERR)                                | store the issued `oaiapp_…` id and use it for later authorizations                                                                     |
| CB4 | HTTP-level 429 usage limit not classified                  | `registry.ts:315`                                                            | `subscription_sharing_usage_limit_exceeded` (SIWC-ERR)                                    | parse the error body on non-OK answers and route to the plan-limit message                                                             |

### 6.2 Class (c)

| #   | Missing                                                                                              | Where it belongs         | Exact change                      |
| --- | ---------------------------------------------------------------------------------------------------- | ------------------------ | --------------------------------- |
| CC1 | Bounded retry for 503 `subscription_sharing_usage_unavailable` / `user_unavailable` / direct routing | `registry.ts:305-315`    | bounded backoff, credentials kept |
| CC2 | `subscription_sharing_user_not_eligible`, region 403, `invalid_client` messages                      | `registry.ts:371-398`    | name each cause; no OAuth loop    |
| CC3 | `earliest_refresh_at`                                                                                | `chatgpt.ts:38-45`       | do not refresh before it          |
| CC4 | Link to ChatGPT settings → Usage at the limit                                                        | plan UI                  | add the link (SIWC-ERR)           |
| CC5 | Images and files for plan models that accept them                                                    | `modelPolicy.ts:202-207` | capability record per plan model  |
| CC6 | Fast / Ultrafast for plan models                                                                     | —                        | owner decision                    |

### 6.3 Class (d)

| #   | Hard-coded item                                     | File:line                                                 | Exact change                                                            |
| --- | --------------------------------------------------- | --------------------------------------------------------- | ----------------------------------------------------------------------- |
| CD1 | Client-side output cap 32,768 (byte-counted)        | `registry.ts:99-123,340-347`; `constants.ts:2219`         | none by default (the route has no cap parameter); optional user setting |
| CD2 | 300 s idle, 16 MiB stream, 30 s token/list timeouts | `registry.ts:57-60,271,279,326`; `constants.ts:2320-2326` | user settings                                                           |

## 7. Not documented / not verified

- Whether the plan route accepts `reasoning.effort: "none"` and
  `reasoning.summary: "auto"` for each model, and its context and output
  limits (capture: one plan turn per model with the wire recorded; the owner's
  captures `acdc0f60`/`577bc807` cover the list and one turn, `registry.ts:39`).
- Usage windows, reset times and usage headers for third-party plan usage:
  none documented (SIWC-ERR says not to infer a reset). The `x-codex-*`
  headers the product journals (`usageJournal.ts:85-90`) appear in no
  official page read; reading them needs a recorded capture first.
- Which plans and workspaces are eligible for plan usage in third-party
  apps (SIWC-SIGNIN: not specified; "ChatGPT plan use isn't enabled" errors
  exist); the size of the "app-specific limit" (SIWC-ERR).
- The `namespace` tool wrapper and the `supported_in_api` list field are not
  on the SIWC pages (product capture only).
- Weekly limits per plan ("may also apply", CX-PRICING); dollar price per
  credit ("depend on your plan or agreement").
