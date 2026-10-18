# GitHub Copilot models (VS Code Language Model API) and Copilot plan limits — research and product comparison

Research date 2026-10-17. Official sources only (§1). Product: `main` at
`3d30a73214` (read only). Owner's rule (2026-10-17, binding): "the limits we
set on our agents hardcoded are **ONLY** the limit set from the providers" and
"**ALL** every model available through every provider all hooks all features
all limits etc".

Classes: **(a)** matches GitHub / VS Code; **(b)** differs (both values
given); **(c)** missing from the product; **(d)** hard-coded in the product but
not a GitHub limit.

How the product reaches Copilot: the VS Code Language Model API
(`src/host/providers/copilotClient.ts`): `vscode.lm.selectChatModels({vendor:
'copilot'})` (`copilotClient.ts:457-465`), token counting with
`model.countTokens` (`copilotClient.ts:262`), refusal past
`model.maxInputTokens` (`copilotClient.ts:346`), output counted by the client
and cut at the request's `max_output_tokens` (`copilotClient.ts:396-426`),
which for plan models is 32,768 (`ModelApiHost.ts:4452-4455`). Copilot CLI and
VS Code agent hooks are in `agent-hooks.md`.

## 1. Sources

| Key       | URL                                                                     | Read       |
| --------- | ----------------------------------------------------------------------- | ---------- |
| MODELS    | https://docs.github.com/en/copilot/reference/ai-models/supported-models | 2026-10-17 |
| REQUESTS  | https://docs.github.com/en/copilot/concepts/billing/copilot-requests    | 2026-10-17 |
| VSCODE-LM | https://code.visualstudio.com/api/extension-guides/ai/language-model    | 2026-10-17 |

## 2. Summary

- **Models.** MODELS lists **32** models (all GA): 13 OpenAI (GPT-5 mini,
  GPT-5.3-Codex, GPT-5.4 / mini / nano, GPT-5.5, GPT-5.6 Luna / Sol / Terra,
  GPT-6 Astra / Luna / Sol, GPT-6.1 Sol), 11 Anthropic (Claude Fable 5 / 5.1,
  Haiku 4.5 / 5.5, Opus 4.8, Opus 4.8 fast mode (preview), Opus 5 / 5.5,
  Sonnet 4.6 / 5 / 5.5), 3 Google (Gemini 3.7 Flash, 3.8 Flash, 4 Argon), 1
  Microsoft (MAI-Code-1.1-Flash), 1 Moonshot (Kimi K3), 3 xAI (Grok 4.5,
  4.6, 4.7). All 32 are covered in §4. The product lists whatever the
  signed-in Copilot account exposes through `selectChatModels`.
- **Counts** (class tags on the 41 classified rows of §3-§4; a row may carry
  two): **(a) 37, (b) 0, (c) 2, (d) 2** (the one (b), CPB1, is a shared
  plan-model issue itemised in §5). Itemised changes (§5): 1 (b), 3 (c),
  2 (d).
- **Most important mismatches.**
  1. **Output is cut at 32,768 tokens by the client** (`copilotClient.ts:396-426`):
     the LM API exposes only `maxInputTokens` (VSCODE-LM), so the cap is the
     product's own number, not a Copilot limit.
  2. **Premium requests**: Pro 300 and Pro+ 1,500 premium requests per month,
     reset on the 1st at 00:00:00 UTC, $0.04 per extra request, each prompt
     multiplied by the model's multiplier; tool calls do not count separately
     (REQUESTS). The product counts requests locally (`copilotUsage`); the
     multipliers are on a page not read (MODELS' table did not show them).
  3. **No effort control** reaches Copilot models (plan models carry no
     effort list); the LM API page read does not document one.

## 3. Features and limits

| Feature / limit           | GitHub / VS Code                                                                                                                                                                                                                                                                                                                                                | Source    | Product today (file:line)                                                  | Class                     |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- | -------------------------------------------------------------------------- | ------------------------- |
| Model selection           | `vscode.lm.selectChatModels()` by `vendor`, `id`, `family`, `version`; empty array when none matches                                                                                                                                                                                                                                                            | VSCODE-LM | `{vendor: 'copilot'}` (`copilotClient.ts:457-465`)                         | (a)                       |
| Consent                   | "Copilot's language models require consent from the user", from a user-initiated action                                                                                                                                                                                                                                                                         | VSCODE-LM | `justification` passed (`copilotClient.ts:63,352`)                         | (a)                       |
| Input limit               | `maxInputTokens` per model                                                                                                                                                                                                                                                                                                                                      | VSCODE-LM | read live; refuses past it (`copilotClient.ts:346`; `registry.ts:166-171`) | (a)                       |
| Output limit              | not exposed by the API                                                                                                                                                                                                                                                                                                                                          | VSCODE-LM | cut at 32,768 by counting (`copilotClient.ts:396-426`)                     | (d)                       |
| Token counting            | `countTokens` (not covered on the page read)                                                                                                                                                                                                                                                                                                                    | —         | used (`copilotClient.ts:262`)                                              | not documented            |
| Errors                    | `LanguageModelError` (`message`, `code`, `cause`); missing model, missing consent, exceeded quota                                                                                                                                                                                                                                                               | VSCODE-LM | errors surfaced as plan errors (`registry.ts:381-383`)                     | (a)                       |
| Rate limits               | no numbers; "use responsibly"                                                                                                                                                                                                                                                                                                                                   | VSCODE-LM | none                                                                       | (a)                       |
| Premium requests          | Pro 300 / month ($10); Pro+ 1,500 / month ($39); Free, Business, Enterprise not on the page read; each Chat / CLI / Spaces / cloud-agent prompt counts; code review 13 requests (from 2026-06-01); reset 1st of month 00:00:00 UTC; no rollover; $0.04 per extra request; after the allowance, included models stay available (possibly slower or rate limited) | REQUESTS  | local request tallies (`subscriptions/planUsage.ts:1-65`; `copilotUsage`)  | (c) multipliers and reset |
| Effort / tools via LM API | not covered on the page read                                                                                                                                                                                                                                                                                                                                    | —         | no effort; tools passed through the LM API                                 | not documented            |

## 4. Every model (32)

Product today for each row: listed when the signed-in account's
`selectChatModels` returns it; input bound from `maxInputTokens`; output cut
at 32,768 (§3).

| #   | Model (provider)                                  | Status                                                                                       | Product today                | Class |
| --- | ------------------------------------------------- | -------------------------------------------------------------------------------------------- | ---------------------------- | ----- |
| 1   | GPT-5 mini (OpenAI)                               | GA                                                                                           | listed via LM API            | (a)   |
| 2   | GPT-5.3-Codex (OpenAI)                            | GA                                                                                           | listed via LM API            | (a)   |
| 3   | GPT-5.4 (OpenAI)                                  | GA                                                                                           | listed via LM API            | (a)   |
| 4   | GPT-5.4 mini (OpenAI)                             | GA                                                                                           | listed via LM API            | (a)   |
| 5   | GPT-5.4 nano (OpenAI)                             | GA                                                                                           | listed via LM API            | (a)   |
| 6   | GPT-5.5 (OpenAI)                                  | GA                                                                                           | listed via LM API            | (a)   |
| 7   | GPT-5.6 Luna (OpenAI)                             | GA                                                                                           | listed via LM API            | (a)   |
| 8   | GPT-5.6 Sol (OpenAI)                              | GA                                                                                           | listed via LM API            | (a)   |
| 9   | GPT-5.6 Terra (OpenAI)                            | GA                                                                                           | listed via LM API            | (a)   |
| 10  | GPT-6 Astra (OpenAI)                              | GA                                                                                           | listed via LM API            | (a)   |
| 11  | GPT-6 Luna (OpenAI)                               | GA                                                                                           | listed via LM API            | (a)   |
| 12  | GPT-6 Sol (OpenAI)                                | GA                                                                                           | listed via LM API            | (a)   |
| 13  | GPT-6.1 Sol (OpenAI)                              | GA                                                                                           | listed via LM API            | (a)   |
| 14  | Claude Fable 5 (Anthropic)                        | GA                                                                                           | listed via LM API            | (a)   |
| 15  | Claude Fable 5.1 (Anthropic)                      | GA                                                                                           | listed via LM API            | (a)   |
| 16  | Claude Haiku 4.5 (Anthropic)                      | GA; GitHub.com, Copilot CLI, VS Code, Visual Studio, Eclipse, Xcode, JetBrains               | listed via LM API            | (a)   |
| 17  | Claude Haiku 5.5 (Anthropic)                      | GA; all seven clients                                                                        | listed via LM API            | (a)   |
| 18  | Claude Opus 4.8 (Anthropic)                       | GA; all seven clients                                                                        | listed via LM API            | (a)   |
| 19  | Claude Opus 4.8 (fast mode) (preview) (Anthropic) | GA column; not on GitHub.com                                                                 | listed via LM API if exposed | (a)   |
| 20  | Claude Opus 5 (Anthropic)                         | GA                                                                                           | listed via LM API            | (a)   |
| 21  | Claude Opus 5.5 (Anthropic)                       | GA                                                                                           | listed via LM API            | (a)   |
| 22  | Claude Sonnet 4.6 (Anthropic)                     | GA                                                                                           | listed via LM API            | (a)   |
| 23  | Claude Sonnet 5 (Anthropic)                       | GA                                                                                           | listed via LM API            | (a)   |
| 24  | Claude Sonnet 5.5 (Anthropic)                     | GA                                                                                           | listed via LM API            | (a)   |
| 25  | Gemini 3.7 Flash (Google)                         | GA                                                                                           | listed via LM API            | (a)   |
| 26  | Gemini 3.8 Flash (Google)                         | GA                                                                                           | listed via LM API            | (a)   |
| 27  | Gemini 4 Argon (Google)                           | GA                                                                                           | listed via LM API            | (a)   |
| 28  | MAI-Code-1.1-Flash (Microsoft)                    | GA                                                                                           | listed via LM API            | (a)   |
| 29  | Kimi K3 (Moonshot AI)                             | GA                                                                                           | listed via LM API            | (a)   |
| 30  | Grok 4.5 (xAI)                                    | GA                                                                                           | listed via LM API            | (a)   |
| 31  | Grok 4.6 (xAI)                                    | GA                                                                                           | listed via LM API            | (a)   |
| 32  | Grok 4.7 (xAI)                                    | GA                                                                                           | listed via LM API            | (a)   |
| —   | premium multiplier per model                      | on the models-and-pricing page (not read); MODELS shows "Included" / "Not included" per plan | not modelled                 | (c)   |
| —   | output limit per model                            | not exposed                                                                                  | 32,768 cut                   | (d)   |

## 5. Itemised (b), (c) and (d)

| #    | Class | Item                                                                                                                                 | Product (file:line)                             | Exact change                                                                           |
| ---- | ----- | ------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------- | -------------------------------------------------------------------------------------- |
| CPB1 | (b)   | Plan models' context fallback is Meta's 1,048,576 outside the Copilot client (`modelPolicy.ts:216`), while `maxInputTokens` is known | `modelPolicy.ts:202-223`; `registry.ts:166-171` | use `maxInputTokens` as the context everywhere (lead's B13)                            |
| CPC1 | (c)   | Premium-request multipliers and the monthly reset                                                                                    | `planUsage.ts`; `copilotUsage`                  | count premium requests × multiplier from GitHub's table; reset on the 1st at 00:00 UTC |
| CPC2 | (c)   | Free, Business, Enterprise allowances                                                                                                | —                                               | read from GitHub's plan pages                                                          |
| CPC3 | (c)   | Effort and tool-mode options of the LM API                                                                                           | `copilotClient.ts`                              | wire them if the LM API exposes them for the model                                     |
| CPD1 | (d)   | Output cut at 32,768                                                                                                                 | `copilotClient.ts:396-426`; `constants.ts:2219` | no client cut by default (the API exposes none), or a user setting                     |
| CPD2 | (d)   | 16 MiB stream / idle timeouts on the plan path                                                                                       | `registry.ts:279,326`                           | user settings                                                                          |

Not documented / not verified: premium multipliers per model, Free /
Business / Enterprise allowances, `countTokens` behaviour, output limits per
model, effort and tool options in the LM API (pages not read in full).
