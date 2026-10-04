# M94 research: inline completions (Tab)

Recorded 2026-10-04 on branch `feature/m94-tab`, from main `1e93c67c`
(0.12.1). PLAN.md D73 and M94. This record holds research only: no code
changed and no model was called. The one process run was the local Muse Code
CLI's help, `model-profile` and `schema` commands, which are offline. Every fact
below names its source and the date it was read. **UNKNOWN** marks what no
source settles; M94's step 1 (the probe) or a later capture settles each one.

Raw copies are in the session scratchpad (`tab/`), not in the repository:
`tab/meta/*.md` (Meta's pages as served at `https://dev.meta.ai/docs/<page>.md`),
`tab/muse/*` (CLI help and the MSP schema export),
`tab/cursor/hooks.md` (Cursor's hooks page), `tab/vscode/*` and
`tab/leaders/*` (excerpts the two research passes relied on).

## Answers in brief

- **No fill-in-the-middle or completion endpoint on the Model API.** The API
  serves `/responses`, `/chat/completions` and `/messages` (plus files, models,
  images, voice and status). Muse Spark is a reasoning model that always
  reasons, so `stop`, `prediction`, `logit_bias` and `logprobs` are refused with
  HTTP 400. Tab therefore asks a chat model, through the Responses API with
  `reasoning.effort: "minimal"`, to fill a marked hole. The only models are
  `muse-spark-1.3` (Standard: $1.25 input, $0.15 cached input, $4.25 output per
  1M tokens) and `muse-spark-1.3-contributor` ($0.10, $0.002, $0.20, and Meta
  trains on the content). Muse Glimmer is open-weight and self-hosted, and is not
  served on the Model API.
- **Muse Code cannot do Tab.** Neither its 1.4.2 binary's MSP schema (stable or
  experimental) nor the SDK's method index has a completion method; the only way
  to generate is `turn/start`, a full agent turn. A measured short side turn cost
  4 model attempts and 33,174 input tokens, and its first token came at 5.4 s
  (M90). Tab is planned on the Model API only.
- **VS Code.**
  - The stable `InlineCompletionItemProvider` is the same at the 1.99 floor
    and at 1.140.
  - Partial accept (Accept Word on Ctrl/Cmd+Right, Accept Line with no key) is
    VS Code's own and works for every provider. Only a full accept signals the
    provider, through the item's `command`.
  - On an Automatic trigger the fastest provider wins and the rest are
    cancelled, and Copilot is built in since 1.116 with a 0 ms delay, so Tab
    yields to it by default.
  - VS Code's own debounce is effectively 0 to 50 ms, so Tab debounces itself.
  - Next edit suggestions are reachable only through proposed APIs, which a
    Marketplace extension cannot use, so they wait (M94b).
- **Leaders.**
  - Continue debounces 350 ms, caches by longest prefix, reuses an open
    stream while the user types through, and filters suffix repeats,
    next-line repeats and blank-line runoff.
  - Zed keeps at most 2 requests in flight and throttles each buffer to one
    request per 300 ms.
  - Copilot puts the cursor block last to reuse the prompt cache.
  - Cursor's Tab model answers at a 260 ms server p50, with 13,000 tokens of
    context, and shows a suggestion only when confident.
  - Every one of them uses VS Code's (or its own) Ctrl/Cmd+Right for word
    accept, and honours its own ignore file and a secret-file list.

  M94 follows them except where a pay-per-token reasoning model without FIM
  needs otherwise (§4, last part).

- **Cursor's Tab hooks:** `beforeTabFileRead` gets `{file_path, content}` and
  answers `{permission: "allow" | "deny"}`. `afterTabFileEdit` gets
  `{file_path, edits[]}` and answers nothing. See §5.
- **Cost:** about $0.80 per hour of active typing on Standard and $0.05 on the
  contributor model, at the planned 350 ms debounce, with a range and the
  assumptions in §7. Two inputs are UNKNOWN until the probe measures them:
  the reasoning tokens at `minimal` and the cache hit rate.

## 1. Meta Model API

| #   | Fact                                                                                                                                                                                                                                                                                                                                                                                                                              | Source (read 2026-10-04)                                                                                                |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| A1  | The HTTP surface is `POST /v1/responses` (and its retrieve, cancel, delete and `input_tokens`), `POST /v1/chat/completions`, `POST /v1/messages` (and `count_tokens`), the files, images, voice (`/asr/*`), models and status resources. **No `/v1/completions`, no FIM or `suffix` parameter, no edit-prediction endpoint is documented.**                                                                                       | https://dev.meta.ai/docs/api-reference, https://dev.meta.ai/llms.txt                                                    |
| A2  | Chat Completions refuses with HTTP 400: `stop` ("not supported on reasoning models"), `n` > 1, `verbosity`, `logit_bias`, `prediction` (predicted outputs), `web_search_options`, `modalities`, `audio`; `logprobs: true` too.                                                                                                                                                                                                    | https://dev.meta.ai/docs/protocols/chat-completions ("OpenAI compatibility notes", "Parameters")                        |
| A3  | Muse Spark always reasons. `reasoning_effort` (Responses: `reasoning.effort`) is `minimal`, `low`, `medium`, `high`, `xhigh`, and `max` on Standard 1.3 only; `none` returns HTTP 400. "Because the model reasons before producing visible output, expect an initial latency before the first visible content chunk in streaming mode." Reasoning tokens count toward the output limit and are billed as output.                  | https://dev.meta.ai/docs/reasoning                                                                                      |
| A4  | `max_output_tokens` (Responses) bounds reasoning plus visible output and has a **minimum of 16**; input plus `max_output_tokens` must fit the context window.                                                                                                                                                                                                                                                                     | https://dev.meta.ai/docs/protocols/responses ("Output-token limit")                                                     |
| A5  | Models: `muse-spark-1.3`, `-1.2`, `-1.1` (Standard) and `muse-spark-1.3-contributor`, `-1.2-contributor` (Contributor), each with a **1,048,576-token** context. No smaller, faster or code-specific variant exists; the models differ only by capability.                                                                                                                                                                        | https://dev.meta.ai/docs/models                                                                                         |
| A6  | Prices per 1M tokens: Standard $1.25 input, **$0.15 cached input**, $4.25 output; Contributor $0.10, **$0.002**, $0.20, in exchange for "permission to use your prompts and completions to train future Meta models". No long-context premium. Caching is automatic prefix caching; `cached_tokens` is a subset of input tokens billed at the reduced rate, and **no cache-write charge or minimum prefix length is documented**. | https://dev.meta.ai/docs/pricing-rate-limits, https://dev.meta.ai/docs/prompt-caching                                   |
| A7  | `prompt_cache_key` routes requests that share a prefix to the same backend ("one stable key per shared prefix … not a per-user or per-request value"). `prompt_cache_retention` (`in_memory`, `24h`) is a hint on Responses. The cache matches from the first token forward, so stable content goes first.                                                                                                                        | https://dev.meta.ai/docs/prompt-caching                                                                                 |
| A8  | Rate limits are per team, not per key: Standard 3,000 RPM and 4,000,000 TPM; Contributor **100 RPM** and 3,000,000 TPM. Successful responses carry `x-ratelimit-limit-tokens`, `-remaining-tokens`, `-limit-requests` and `-remaining-requests`. On 429, back off exponentially from about 500 ms with jitter.                                                                                                                    | https://dev.meta.ai/docs/pricing-rate-limits                                                                            |
| A9  | Meta's injected steering context (a system prompt and scaffolding) is not billed and not counted in `usage`.                                                                                                                                                                                                                                                                                                                      | https://dev.meta.ai/docs/pricing-rate-limits                                                                            |
| A10 | With `store: true` a streamed response keeps running after the client disconnects and is stored. **What `store: false` does on disconnect, and whether the tokens after a disconnect are billed, is not documented (UNKNOWN).** An aborted stream never delivers its usage frame.                                                                                                                                                 | https://dev.meta.ai/docs/protocols/responses ("Persistence guarantees")                                                 |
| A11 | Sampling: temperature 1.0 and top_p 1.0 are the tuned defaults; Meta advises leaving them unset. `seed` is best effort.                                                                                                                                                                                                                                                                                                           | https://dev.meta.ai/docs/protocols/chat-completions                                                                     |
| A12 | **No latency figure for Muse Spark is published** (time to first token, tokens per second). The only figure in the docs is for Muse Glimmer on Together AI (TTFT p50 307 ms, 105 output tokens/s, on long-context agentic traffic), which does not apply to the hosted model.                                                                                                                                                     | grep of every downloaded page; https://dev.meta.ai/docs/muse-glimmer/together-ai                                        |
| A13 | Muse Glimmer: 30B dense, open weights (Apache 2.0), distilled from Muse Spark, a reasoning model (`reasoning_strength` low to xhigh, "routinely produces multi-thousand-token chains of thought"), 128K default context, served by vLLM, SGLang, llama.cpp or ExecuTorch, or by partners (Together AI, Fireworks, OpenRouter). "Self-hosted and isn't served on any Meta Model API endpoint." No FIM template is documented.      | https://dev.meta.ai/docs/muse-glimmer, https://dev.meta.ai/docs/muse-glimmer/prompting, https://dev.meta.ai/docs/models |

What the repository already knew, and still holds: §5.1 of PLAN.md (model
IDs, context, `tool_choice: "auto"` only, `prompt_cache_key` and `24h`
retention). Its prices match A6 today. Measured earlier on this key:
a second request with the same prefix at the same effort was served 3,185 of
3,230 input tokens from cache (`docs/certification/release-0.9.0.md`,
case 01). That proves the cache works across requests; it says nothing about
latency.

**Unknowns the probe must measure (M94 step 1):**

- U1, time to first visible token and total time for a Tab-sized request at `minimal`;
- U2, reasoning tokens per request at `minimal` (they are billed and they eat `max_output_tokens`);
- U3, whether a 2,000-token prefix shared by consecutive requests is served from cache (the hit rate while typing);
- U4, what an aborted `store: false` stream bills (only Meta's invoice can tell; the extension therefore never aborts a sent Tab request; D73).

## 2. Muse Code CLI

| #   | Fact                                                                                                                                                                                                                                                                                                                                                                                                              | Source                                                                                                                                               |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| C1  | Installed: Muse Code 1.4.2 (`1.4.2-R4684.1`). Its commands are `resume`, `exec`, `config`, `export`, `trace`, `model-profile`, `skills`, `voice`, `sandbox`, `schema`, `serve`, `session-message`, `mcp`, `auth`, `login`, `logout`, `init`. **No completion command.** `--provider` takes `echo`, `meta` or `local`; what `local` serves is not documented in the help (UNKNOWN).                                | `muse --help`, `muse --version`, run 2026-10-04 (`tab/muse/help.txt`)                                                                                |
| C2  | `muse serve` serves one MSP host over stdio; its flags are provider, model, sandbox posture and `--no-session-log`. Nothing about completions.                                                                                                                                                                                                                                                                    | `muse serve --help`, 2026-10-04                                                                                                                      |
| C3  | The MSP schema embedded in the 1.4.2 binary, stable and experimental (`muse schema generate-ts`, offline), has these generating methods only: `turn/start`, `turn/steer`, `subagent/*` and `workflow/*`. **No completion, FIM or prediction method.** The SDK's method index (`next`) agrees; it adds only non-generating methods (`log/*`, `projection/*`, `hook/list`, `plugin/list`, `computerUseSettings/*`). | `tab/muse/ts-stable/msp.d.ts`, `tab/muse/ts-exp/msp.d.ts`; https://meta-models.github.io/muse-code-sdk/next/generated/msp/methods/ (read 2026-10-04) |
| C4  | `muse model-profile show muse-spark-1.3 --effort minimal` resolves `base_instructions_variant full`: a Muse Code turn carries the agent's full instructions whatever the effort.                                                                                                                                                                                                                                  | run 2026-10-04 (`tab/muse/model-profile-1.3-minimal.txt`)                                                                                            |
| C5  | The cost of the lightest turn measured (M90's reviewer side session: empty folder, Plan mode): **4 model attempts** (the reply and three reminder children), 33,174 input and 111 output tokens, 9.6 s, first token at **5.4 s**. M2's smoke turn: first token at 5.1 s, 11.2 s in all.                                                                                                                           | `docs/certification/m90.md` ("Cost"); PLAN.md §5.4                                                                                                   |
| C6  | Subscription credentials are "for use with Muse Code only".                                                                                                                                                                                                                                                                                                                                                       | PLAN.md §5.1 (ToS of 2026-09-18)                                                                                                                     |

**Conclusion.** A Tab request through the subscription would be a full agent
turn: about 33,000 input tokens and four model attempts per keystroke pause,
with the first token after five seconds. That is too slow to show while the
user types, and it would spend the subscription's limits on every pause,
unseen. No path short of a turn exists. **Tab is planned on the Model API
only.** It never runs on the subscription, and the Muse Code backend offers it
only when a Model API key is stored, as images and voice are (M44). If Meta
adds a completion method to MSP, D73 is revisited then.

## 3. VS Code: `InlineCompletionItemProvider` on the 1.99 floor

Sources, read 2026-10-04:

- T99 is `node_modules/@types/vscode/index.d.ts`, version 1.99.0 (the repository's pin).
- D99 and D140 are `src/vscode-dts/vscode.d.ts` at the VS Code tags `1.99.0` and
  `1.140.0` (https://raw.githubusercontent.com/microsoft/vscode/<tag>/...).
  1.140.0 is the latest stable, released 2026-09-30, and identical to `main` for
  this file.
- P is `vscode.proposed.inlineCompletionsAdditions.d.ts` on `main`.
- "src" means the engine's source at tag 1.140.0, path as given. The cited
  1.99.0 lines agree.
- Excerpts are in `tab/vscode/` (`INDEX.txt` maps each file to its URL).

**Stable surface (unchanged from 1.99 to 1.140).**

| #   | Fact                                                                                                                                                                                                                                                                                                                                               | Source                               |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| V1  | `InlineCompletionItemProvider.provideInlineCompletionItems(document, position, context, token)` returns `InlineCompletionItem[] \| InlineCompletionList`. It is called "whenever the user stopped typing", and also on an explicit trigger or a request for the next or previous item, when "all available inline completions should be returned". | T99 5182–5198                        |
| V2  | `InlineCompletionContext` has `triggerKind` and `selectedCompletionInfo` (`{range, text}`, set while the suggest widget has a selection). When it is set, a completion must extend the selected text over the same range, and providers are asked again whenever the selection changes.                                                            | T99 5219–5251                        |
| V3  | `InlineCompletionTriggerKind.Invoke = 0`: "triggered explicitly by a user gesture. Return multiple completion items to enable cycling through them." `Automatic = 1`: "triggered automatically while editing. It is sufficient to return a single completion item in this case."                                                                   | T99 5256–5268                        |
| V4  | `InlineCompletionItem` has `insertText: string \| SnippetString`, `filterText?`, `range?` ("Must begin and end on the same line") and `command?` (run after the item is inserted).                                                                                                                                                                 | T99 5275–5311                        |
| V5  | `languages.registerInlineCompletionItemProvider(selector, provider)`: providers "are asked in parallel and the results are merged", and one failing provider does not fail the rest.                                                                                                                                                               | T99 14503–14514                      |
| V6  | **No stable inline-completion API was added from 1.99 to 1.140.** The inline sections of D99 and D140 are identical. D140 has no `isInlineEdit`, `showRange` or `InlineEdit`.                                                                                                                                                                      | D99 5170–5302 against D140 5227–5365 |

**Partial accept and accept signals.**

| #   | Fact                                                                                                                                                                                                                                                                                                                                                                                                   | Source                                                                                                                                                                                               |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| V7  | Partial accept is VS Code's own and works for **any** provider. `editor.action.inlineSuggest.acceptNextWord` is bound to Ctrl+Right (Cmd+Right on macOS) and exists since 1.74. `editor.action.inlineSuggest.acceptNextLine` exists since 1.78 and has **no default key**. Tab accepts; Alt+] and Alt+[ cycle. Since 1.78, accepting a word works across lines and "does not ask the extension again". | src `.../inlineCompletions/browser/controller/commands.ts` 138–186, 207, 244; https://code.visualstudio.com/updates/v1_74, /v1_78; https://code.visualstudio.com/docs/editing/ai-powered-suggestions |
| V8  | **The only stable accept signal is the item's `command`.** It runs after a full accept. A partial accept that reaches the end of the item, or any partial accept of a snippet, becomes a full accept.                                                                                                                                                                                                  | src `.../model/inlineCompletionsModel.ts` 1001–1004, 1071–1083                                                                                                                                       |
| V9  | The show, partial-accept and end-of-life callbacks are **proposed only** (`handleDidShowCompletionItem`, `handleDidPartiallyAcceptCompletionItem`, `handleEndOfLifetime`, `handleListEndOfLifetime`). Defining the first two, or passing `metadata`, makes registration throw without the proposal. The others are silently ignored.                                                                   | P 110–174; src `workbench/api/common/extHost.api.impl.ts` 757–767; `extHostLanguageFeatures.ts` 1355, 1479–1497, 1545–1575                                                                           |

**Several providers on one document; Copilot.**

| #   | Fact                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Source                                                                                                                                                                                                                                           |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| V10 | **On an Automatic trigger the fastest provider wins.** All providers are queried in parallel, and VS Code stops at the first visible ghost text and cancels the rest (`lostRace`). On Invoke, all results are merged. Providers are ordered by selector score, built-ins last and the newest first.                                                                                                                                                     | src `.../model/inlineCompletionsSource.ts` 241–307; `provideInlineCompletions.ts` 134; `editor/common/languageFeatureRegistry.ts` 202–223                                                                                                        |
| V11 | `yieldTo`, `groupId`, `excludes`, `displayName` and `debounceDelayMs` on a provider are proposed only. A user can silence a provider with `editor.inlineSuggest.experimental.suppressInlineSuggestions`, a comma-separated list of extension ids (experimental).                                                                                                                                                                                        | P 92–108; src `editor/common/config/editorOptions.ts` 4656–4664                                                                                                                                                                                  |
| V12 | **Copilot is built in since 1.116** ("GitHub Copilot Chat is now a built-in extension", id `GitHub.copilot-chat`). It registers its completions provider for every file with `debounceDelayMs: 0`, but only when the user has a Copilot token. It also registers a next-edit provider. `github.copilot.enable` defaults to `{"*": true, "plaintext": false, "markdown": false, "scminput": false}`. `chat.disableAIFeatures` turns the built-in AI off. | https://code.visualstudio.com/updates/v1_116; src `extensions/copilot/src/extension/completions/vscode-node/completionsCoreContribution.ts` 41–51; `extensions/copilot/package.json` 3389–3401; https://code.visualstudio.com/docs/setup/copilot |
| V13 | An extension can see whether `GitHub.copilot` or `GitHub.copilot-chat` is installed and active (`extensions.getExtension`, `isActive`). It **cannot** see whether Copilot holds a token or is producing completions: the stable API reads no other extension's context keys. Since 1.116, "installed" no longer means "suggesting".                                                                                                                     | D140 17471, 8357                                                                                                                                                                                                                                 |

**Debounce and cancellation.**

| #   | Fact                                                                                                                                                                                                                                                                                                                                                                                          | Source                                                                                                                                                               |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| V14 | VS Code's own delay before an Automatic request is the largest `debounceDelayMs` any provider declares, else an adaptive value clamped to 50 ms. An undeclared value counts as the smallest. **With Copilot's providers registered (0 ms), the delay is 0.** No user setting changes it; `editor.inlineSuggest.minShowDelay` only delays showing. **The extension must debounce for itself.** | src `.../model/inlineCompletionsSource.ts` 200–211; `controller/inlineCompletionsController.ts` 146–150; `editor/common/services/languageFeatureDebounce.ts` 130–147 |
| V15 | **The cancellation token is cancelled by any document change**, by a newer request and by losing the race.                                                                                                                                                                                                                                                                                    | src `.../model/inlineCompletionsSource.ts` 137–141, 176–177, 235, 307, 619–629                                                                                       |

**Next edit suggestions.**

| #   | Fact                                                                                                                                                                                                                                                                                                                                                                                            | Source                                                                                                                                                                                                                                        |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| V16 | **No stable API offers an edit away from the cursor.** `isInlineEdit`, `showRange`, `jumpToPosition` and `displayLocation` exist only in the `inlineCompletionsAdditions` proposal. The older `inlineEdit` proposal (`registerInlineEditProvider`) was removed in June 2025 (commit `82054fce`). The stable `range` must stay on one line (V4), so a stable item cannot even pretend to be one. | P 35–73; src `extensionsApiProposals.ts` (main) 300                                                                                                                                                                                           |
| V17 | **A Marketplace extension cannot use a proposal.** Proposals "should not be used in published extensions". `vsce publish` refuses `enabledApiProposals` without a bypass flag. Stable VS Code clears an extension's proposals unless product.json allows it or `--enable-proposed-api` is given. The official inline-completions sample depends on the proposal.                                | https://code.visualstudio.com/api/advanced-topics/using-proposed-api; https://raw.githubusercontent.com/microsoft/vscode-vsce/main/src/publish.ts 372–376; src `workbench/services/extensions/common/extensionsProposedApi.ts` 35–37, 104–113 |
| V18 | Copilot's next edit suggestions were in preview in 1.97 and generally available in 1.99. They reach users through the built-in extension's proposal access.                                                                                                                                                                                                                                     | https://code.visualstudio.com/updates/v1_97, /v1_99                                                                                                                                                                                           |

**UNKNOWN:**

- whether `getExtension('GitHub.copilot-chat')` still reports it active when `chat.disableAIFeatures` is true;
- whether the Marketplace server, as well as vsce, rejects `enabledApiProposals`;
- how the race against Copilot plays out at Muse Spark's latency (V10: in theory Copilot's 0 ms provider always wins; not measured);
- where the Alt+\ binding comes from. The description of Copilot's `github.copilot.enable` says "You can still trigger suggestions manually using `Alt + \`" (src `extensions/copilot/package.json` 3401), but core's `commands.ts` gives `editor.action.inlineSuggest.trigger` no default key. That command exists in core at 1.99 and at 1.140, and it can be bound.

**What this means for M94 (D73):**

- **Debounce ourselves.** Wait on the token, and send nothing when typing cancels it (V14, V15).
- **Never abort a sent request.** A cancelled token only stops the answer being shown (A10). The answer goes to the cache.
- **Use the item's `command` for `afterTabFileEdit` on a full accept** (V8). A partial accept has no stable signal (V9), so it is inferred from the document change and recorded as inferred.
- **Stay quiet while the suggest widget has a selection** (V2).
- **Return one item on Invoke** (`n` > 1 is refused, A2).
- **Yield to Copilot by default.** In a race Copilot shows first, and every request Tab sends would be billed for nothing (V10, V12, V13).
- **Next-edit suggestions wait** until VS Code makes `isInlineEdit`/`showRange` stable (V16, V17).

## 4. How the leaders do it

This is design research only; no code was copied. Everything was read
2026-10-04. The pinned commits, the redirects and the excerpts are in
`tab/leaders/` (`INDEX.txt`). Since the brief was written, two things moved:
`microsoft/vscode-copilot-chat` is archived (its code is now
`extensions/copilot` in `microsoft/vscode`), and `docs.windsurf.com` now
redirects to `docs.devin.ai/desktop/*` ("Devin Desktop").

### Continue (open source)

Source: `github.com/continuedev/continue` at `5522c6f4`. Paths are under
`core/autocomplete/` unless they start with `core/`, `docs/` or
`extensions/`.

| #   | Fact                                                                                                                                                                                                                                                                                                                                                                                                                             | Source                                                                                                                                |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| L1  | Defaults: `maxPromptTokens` 1024, `prefixPercentage` 0.3 (about 307 tokens), `maxSuffixPercentage` 0.2 (about 205), **`debounceDelay` 350 ms**, `modelTimeout` 150 ms, `multilineCompletions: "auto"`, and `useCache`, `onlyMyCode`, `useRecentlyEdited`, `useRecentlyOpened`, `useImports` and `transform` all on. The JSON reference also says 350; the deep-dive's example shows 250.                                         | `core/util/parameters.ts`; `docs/reference/json-reference.mdx`; `docs/customize/deep-dives/autocomplete.mdx`                          |
| L2  | **Debounce:** each request gets an id and a fresh timer, and only the newest id reaches the model. A forced trigger skips it. **Cancellation:** one AbortSignal per request; with `transform` on, a hard stop comes after `modelTimeout × 2.5`.                                                                                                                                                                                  | `util/AutocompleteDebouncer.ts`, `CompletionProvider.ts`, `generation/CompletionStreamer.ts`                                          |
| L3  | **Context:** the prefix is pruned by whole lines from the top and the suffix from the bottom. Snippets fill the remaining budget: recently opened files (LRU of 20, 80 ms per read), recently visited ranges, recently edited ranges (3 ranges, 10 documents, stale after 2 minutes), the diff, then imports and definitions. The LSP-definitions path is switched off in code (`IDE_SNIPPETS_ENABLED = false`).                 | `util/HelperVars.ts`, `templating/filtering.ts`, `snippets/getAllSnippets.ts`, `extensions/vscode/src/autocomplete/recentlyEdited.ts` |
| L4  | **Cache:** an in-memory map backed by SQLite (1,000 entries). A lookup takes the longest cached prefix that the current prefix starts with, and returns the rest of the completion if the typed text matches its start. The read key (the pruned file prefix) and the write key (the compiled prompt) appear to differ (the research pass's reading).                                                                            | `util/AutocompleteLruCache.ts`, `CompletionProvider.ts`                                                                               |
| L5  | **Typing through:** an open stream is reused while prefix plus streamed output still starts with the new prefix and the prefix did not shrink. In single-line mode it stops at the first newline.                                                                                                                                                                                                                                | `generation/GeneratorReuseManager.ts`                                                                                                 |
| L6  | **Multi-line ("auto"):** single-line while an IntelliSense item is selected or on a single-line comment; otherwise a per-language hook decides, multi-line by default.                                                                                                                                                                                                                                                           | `classification/shouldCompleteMultiline.ts`                                                                                           |
| L7  | **Filters:** stop at stop tokens and fences; stop when the output reproduces the start of the suffix, or (within 10% edit distance) the next non-blank line; stop after three identical lines; stop at the first blank line after line 1. Drop blank output, output repeating the line above, and extreme repetition (six or more lines). Strip fences. A bracket-matching service exists but its stream filter is not wired in. | `filtering/streamTransforms/*`, `postprocessing/index.ts`                                                                             |
| L8  | **Chat models without FIM** get a "hole filler" prompt: few-shot `{{FILL_HERE}}` examples, the answer inside `<COMPLETION>`, stop at `</COMPLETION>`. The docs say large chat models "won't generate useful completions" and that the best autocomplete models are at most 10B parameters. FIM templates exist for about ten code-model families. Temperature defaults to 0.01.                                                  | `templating/AutocompleteTemplate.ts`; `docs/customize/deep-dives/autocomplete.mdx`                                                    |
| L9  | **Privacy:** a built-in security ignore list (`*.env`, `.env*`, `*.key`, `*.pem`, `*.keystore`, `keys/` and more), `disableInFiles` globs and `.continueignore` block autocomplete. Development data stays local (`.continue/dev_data`). Partial accept is VS Code's own.                                                                                                                                                        | `core/indexing/ignore.ts`, `prefiltering/index.ts`; `docs/customize/deep-dives/development-data.mdx`                                  |

### GitHub Copilot

| #   | Fact                                                                                                                                                                                                                                                                                                                                                                                                        | Source                                                                                                                                                                                                                             |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| L10 | Tab accepts. Ctrl/Cmd+Right accepts a word, Alt+]/Alt+[ cycle and Alt+\ triggers. No new automatic requests are started on a metered connection. The context is "current and open files".                                                                                                                                                                                                                   | https://code.visualstudio.com/docs/editing/ai-powered-suggestions; https://docs.github.com/en/copilot/reference/keyboard-shortcuts                                                                                                 |
| L11 | **NES** predicts where the next edit is and what it is. Tab jumps, Tab accepts. Its original input was recently viewed snippets, the current file with line numbers, recent edits as a diff, and a rewrite window of 2 lines above and 5 below the cursor. The unified model puts the cursor block **last, to reuse the KV-cache prefix**, and reports 10% faster time-to-show and 61% fewer output tokens. | https://code.visualstudio.com/blogs/2026/09/16/building-the-github-copilot-inline-suggestions-model-part-one                                                                                                                       |
| L12 | Client findings: speculative decoding of the current line, progressive reveal, and a slight delay before showing a cached suggestion. "Immediate model invocation while the user was still typing did not result in a worse experience." Not re-showing ignored ghost text as an NES moved the dismissal rate from +15.9% to −10.1%.                                                                        | https://code.visualstudio.com/blogs/2026/09/23/building-the-github-copilot-inline-suggestions-model-part-two                                                                                                                       |
| L13 | Code defaults: NES debounce 100 ms, cache delay 200 ms, an NES LRU of 50 with edits rebased onto the changed document. Ghost-text debounce is undefined or an experiment value, else 0. NES prompt budgets: current file 1,500 tokens; recently viewed 5 documents / 2,000; diff history 25 entries / 1,000.                                                                                                | archived `microsoft/vscode-copilot-chat@5863f5a7` (`configurationService.ts`, `nextEditCache.ts`, `ghostText.ts`); `microsoft/vscode@24a41178` `extensions/copilot/src/platform/inlineEdits/common/dataTypes/xtabPromptOptions.ts` |
| L14 | **Content exclusion** (Business and Enterprise only): excluded files get no suggestions and inform none elsewhere; a change can take 30 minutes to reach IDEs. **Retention:** Business/Enterprise IDE completions, prompts and suggestions "Not retained" (engagement data two years). Individual plans may be used for training, with an opt-out. Individual-plan retention for completions is UNKNOWN.    | https://docs.github.com/en/copilot/concepts/security-governance-and-network-settings/content-exclusion; https://github.com/features/copilot (FAQ)                                                                                  |

### Cursor Tab

| #   | Fact                                                                                                                                                                                                                                                                                                                  | Source                                                                           |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| L15 | Context: recent edits, the surrounding code and linter errors. Edits can span lines and add imports. After an accept, it jumps to the next predicted place, opening a portal for a jump to another file. Esc or typing on rejects; Ctrl/Cmd+Right accepts a word.                                                     | https://cursor.com/docs/tab/overview; https://cursor.com/help/ai-features/tab.md |
| L16 | The "Fusion" model's server p50 latency fell from 475 ms to **260 ms**, and its context grew from 5,500 to **13,000 tokens**.                                                                                                                                                                                         | https://cursor.com/blog/tab-update (2025-01-13)                                  |
| L17 | Tab runs on every keystroke or cursor move (over 400M requests a day) and shows a suggestion only when confident. Its online-RL reward implies "show only if p(accept) > 25%". The result: 21% fewer suggestions, 28% more accepted.                                                                                  | https://cursor.com/blog/tab-rl (2025-09-12)                                      |
| L18 | `.cursorignore` blocks Tab; `.gitignore` is respected; the defaults include `.env*`, and the page says protection "isn't guaranteed". Privacy Mode means no training and zero retention at providers (on by default for teams); file contents are cached on Cursor's servers temporarily, encrypted with client keys. | https://cursor.com/docs/reference/ignore-file.md; https://cursor.com/data-use    |

Cursor's debounce, cancellation, client cache and prefix/suffix split are not
documented (UNKNOWN).

### Windsurf / Devin Desktop

| #   | Fact                                                                                                                                                                                                                                                                                                                                                                                                    | Source                                                                                                                                                             |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| L19 | Tab is an in-house model. Its context is the code, the terminal, agent chat history, prior editor actions and the clipboard (opt in), plus a RAG index of the local codebase. Its edits can land before and after the cursor. It has "Tab to Jump" and "Tab to Import", modes Supercomplete / Autocomplete / Off, and an aggression level. Keys: word accept Cmd/Ctrl+→, ⌥]/⌥[ to cycle, ⌥\ to trigger. | https://docs.devin.ai/desktop/tab/overview; https://docs.devin.ai/desktop/autocomplete/overview; https://docs.devin.ai/desktop/context-awareness/windsurf-overview |
| L20 | **Ignore:** `.gitignore`, `node_modules` and hidden paths by default; `.devinignore` (and still `.codeiumignore` and `.windsurfignore`). Whether these suppress autocomplete itself is not documented (UNKNOWN). **Data:** snippet telemetry can be opted out of. Data may be used for training by default; paid plans can opt out (zero retention at providers); Enterprise is never trained on.       | https://docs.devin.ai/desktop/context-awareness/devin-ignore.md; https://docs.devin.ai/admin/security                                                              |

Windsurf's debounce, latency, caching, filters and token budgets are not
documented (UNKNOWN).

### Zed edit prediction (open source)

Source: `zed-industries/zed` at `a8468907`.

| #   | Fact                                                                                                                                                                                                                                                                                                                   | Source                                                                         |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| L21 | Providers: Zeta (default, open source), Copilot, Mercury, Codestral, Ollama, and any OpenAI-compatible `/v1/completions` server, with FIM formats for several code-model families. **Debounce defaults:** Copilot 75 ms, Codestral 150 ms, the rest 0. A manual trigger bypasses it.                                   | https://zed.dev/docs/ai/edit-prediction (`docs/src/ai/edit-prediction.md`)     |
| L22 | **Throttle:** at most one request per buffer every 300 ms, and **at most 2 in flight** (1 for Ollama). Older pending requests are cancelled when one completes. For providers that do not track acceptance, the HTTP request is dropped on cancel.                                                                     | `crates/edit_prediction/src/edit_prediction.rs`                                |
| L23 | **Context:** a symmetric excerpt around the cursor of up to 8,192 tokens (about 3 bytes per token); the FIM path takes 512. Also 10 edit events, 20 recent paths, about 2,048 tokens of edit-history diff, and diagnostics within 20 lines.                                                                            | `crates/edit_prediction/src/edit_prediction.rs`, `cursor_excerpt.rs`, `fim.rs` |
| L24 | **Typing through:** the shown prediction is re-applied to the new buffer. A new one replaces it only when it covers the same range and extends its text, which avoids flicker.                                                                                                                                         | `crates/edit_prediction/src/prediction.rs`                                     |
| L25 | **Privacy:** training data is collected only with opt-in, in a project with a detected open-source licence, and outside `disabled_globs`. The default `disabled_globs` are `**/.env*`, `*.pem`, `*.key`, `*.cert`, `*.crt`, `.dev.vars`, `secrets.yml` and Zed's own settings files. Normal requests are not retained. | https://zed.dev/docs/ai/ai-improvement; `assets/settings/default.json`         |

### What M94 takes from them, and where it departs

- **Taken:**
  - Continue's 350 ms debounce (L1). Zed's two-in-flight cap (L22).
  - Continue's longest-prefix cache, with one key for reads and writes
    (L4, L5).
  - Continue's filters: suffix, next line, repeats, the first blank line
    (L7).
  - A tagged hole-filler answer for a chat model (L8).
  - The cursor block last, for prefix caching (L11).
  - VS Code's own word and line accept, which all of them use (L9, L10, L15,
    L19, L24).
  - The union of the leaders' secret-file lists (L9, L18, L25).
  - `.cursorignore` and `.continueignore`, since both are documented to
    block autocomplete (L9, L18).
- **Departures, each for a reason:**
  - **A sent request is never aborted.** Continue and Zed cancel the HTTP
    call (L2, L22), but Meta does not say what an abandoned stream bills
    (A10), and the ledger must count every request.
  - **A larger window than Continue's 307 + 205 tokens** (about 1,500 + 400).
    Continue sizes for small local FIM models (L8). The cached prefix costs
    $0.15 per 1M on Standard (A6), and Copilot's NES (L13), Cursor (L16)
    and Zed (L23) all send more.
  - **Meta's default sampling**, not Continue's 0.01 temperature (A11).
  - **No confidence gate** like Cursor's (L17). Muse Spark returns no
    log-probabilities (A3), so the filters stand in for one.
- **What to expect:** Continue's own docs warn that large chat models make
  poor autocomplete models (L8). Muse Spark is a reasoning chat model with
  no FIM training (A3, A5). M94's probe and live check measure the quality
  and the latency, and the latency gate in M94 step 1 can make Invoke the
  default trigger.

## 5. Cursor's Tab hooks

Source: https://cursor.com/docs/hooks (served as `/docs/hooks.md`), read
2026-10-04. The M91 lane's copy of 11:00 and this lane's refetch are
byte-identical in the Tab sections (`tab/cursor/hooks.md`).

- **Two hooks, Tab only.** "Tab hooks (inline completions) fire for autonomous
  Tab operations: `beforeTabFileRead` - Control file access for Tab
  completions; `afterTabFileEdit` - Post-process Tab edits." The Agent hooks do
  not fire for Tab, and the Tab hooks do not fire for Agent or Cmd+K. They never
  run in cloud agents.
- **`beforeTabFileRead`**: "Called before Tab (inline completions) reads a
  file. Enable redaction or access control before Tab accesses file
  contents." Unlike `beforeReadFile` it has no `attachments`.
  - Input: `{ "file_path": "<absolute path>", "content": "<file contents>" }`,
    where `content` is the file's full contents.
  - Output: `{ "permission": "allow" | "deny" }`. The page does not document
    `user_message` for this hook; `beforeReadFile` has it.
  - It is a permission hook. Exit 0 with invalid JSON, or a response that does
    not match the schema, blocks the read. Exit 2 blocks it (same as
    `deny`). Any other exit code, a crash or a timeout is logged and the read
    goes ahead, unless the hook sets `failClosed: true`.
  - Its matcher is tested against the value `TabRead`.
- **`afterTabFileEdit`**: "Called after Tab (inline completions) edits a file.
  Useful for formatters or auditing of Tab-written code."
  - Input, as the page gives it:

    ```json
    {
      "file_path": "<absolute path>",
      "edits": [
        {
          "old_string": "<search>",
          "new_string": "<replace>",
          "range": {
            "start_line_number": 10,
            "start_column": 5,
            "end_line_number": 10,
            "end_column": 20
          },
          "old_line": "<line before edit>",
          "new_line": "<line after edit>"
        }
      ]
    }
    ```

  - Output: "No output fields currently supported."
  - Its matcher value is `TabWrite`.
  - **Whether lines and columns count from 0 or 1 is not stated (UNKNOWN).**
    The example (`start_line_number: 10, start_column: 5`) reads as 1-based.
- **Common fields.** The page's common schema (`conversation_id`,
  `generation_id`, `model`, `hook_event_name`, `cursor_version`,
  `workspace_roots`, `user_email`, `transcript_path`) is written for agent
  hooks. Which of these a Tab hook receives is not stated (UNKNOWN).
- **Per-script options.** `command`, `type` (`command` or `prompt`), `timeout`
  in seconds (default: "platform default", value UNKNOWN), `failClosed`
  (default `false`) and `matcher`. Config lives in `<project>/.cursor/hooks.json`
  and `~/.cursor/hooks.json` (plus team and enterprise sources).

How this lands here (D73, coordinated with M91/D70): M91 owns the hook runner,
`spark-hooks.json` and the Cursor format adapter. M94 owns the two Tab hook
points and their payloads. They keep Cursor's names and contract, since
Cursor is the only agent with Tab hooks. Every hook failure fails closed for
Tab, which is stricter than Cursor's default and allowed by D70's "never
weaker" rule: a refused read only means no suggestion.

## 6. What the repository already gives Tab

- **The key client** (`src/core/backends/modelapi/client.ts`): validated SSE
  streaming of `POST /responses`, the documented retry policy, the per-attempt
  admission hook (`ResponseAttemptGuard`) called right before `fetch`, and the
  key read per request from SecretStorage. It is in the activation bundle
  (D6, M57), so the Tab bundle can take it from activation instead of
  carrying a second copy.
- **The cache key** (`promptCache.ts`): `PROMPT_CACHE_KEY_PREFIX` plus a digest
  of model, instructions and tools. Tab gets its own prefix and digest, so it
  never shares a key, a prefix or a request with a conversation (the SoL-Pi
  rule, M68/M73–M75).
- **Spend arithmetic** (`sessionBudget.ts`, M82): estimate input at one token
  per UTF-8 byte (an upper bound) and reserve input plus `max_output_tokens` at
  list price before sending. A sent request without usage keeps its whole
  reservation. Prices come from `MODEL_API_PRICES_PER_MILLION`, costs from
  `estimateCostUsd` (`src/core/usage/insights.ts`).
- **The paid gate** (`src/core/paid/paidFeatures.ts`): `PaidFeatureGate` (a
  machine-scoped setting, off by default, plus the price accepted in a modal)
  and `PaidUsage` (the window's tally that Account & usage shows). The D48
  popup is `PaidUseConsent` (`paidConsent.ts`).
- **Secrets** (`src/core/redact.ts`): `redactSecrets` and `countSecretMatches`
  over `SECRET_RULES`, with the `MAY_HOLD_SECRET` fast path.
- **Files Tab must never read:**
  - `isPrivateFileName` (`src/shared/privateFiles.ts`): `.env*`,
    `credentials.json`, `auth.json`, `id_rsa`, `id_ed25519`, `*.key`, `*.pem`,
    `*.p12`, `*.pfx`;
  - `isProtectedPath` (`src/core/protectedPaths.ts`): `.git`, `.husky`,
    `.vscode`, `.idea`, `.devcontainer`, `.github/workflows`, `.agents`,
    `.muse`, `AGENTS.md`, `CLAUDE.md`, `.envrc` and `.gitmodules` (M91 adds other
    agents' configuration folders);
  - `.gitignore` as git applies it (`git ls-files --exclude-standard`, already
    used by mentions in `src/host/mention/workspaceFiles.ts`, only in a trusted
    workspace), and VS Code's `files.exclude`. Today the editor context shares
    only the path of an excluded file (`src/core/editorContext.ts`).
- **Hooks** (`src/core/backends/modelapi/hooks.ts`, M51): trust-gated and
  opt-in (`museSpark.modelApiHooks`), with `HOOK_STDIN_MAX_BYTES` 256 KiB,
  `HOOK_OUTPUT_MAX_BYTES` 16 KiB and `HOOK_MAX_RUNNING_COMMANDS` 4.
- **Code intelligence** (`src/core/codeIntel/definitions.ts`, `dist/codeIntel.js`):
  definitions through VS Code's language services. Tab's multi-line context can
  use it.
- **Constraints:**
  - The activation bundle is 580.4 of 600 KiB (`docs/certification/m90.md`).
    Tab must load lazily, leaving only a small registration shim in activation.
  - `activationEvents` lists only `onWebviewPanel:museSpark.chatPanel`, so the
    extension starts only with its views, panel and commands. A completion
    provider needs the extension running in a window where no panel was ever
    opened (D73).
  - `activate()` reads SecretStorage at once (`refreshKeyPresence`,
    `src/extension.ts`). M62 declined `onStartupFinished` for that reason
    (D73).

## 7. Cost estimate

The model behind the numbers in D73 has these inputs, each an assumption
until the probe measures it:

- **Fast request:** about 2,300 input tokens, of which about 1,800 are cached
  (the instructions and the prefix window up to the previous cursor), and about
  70 output tokens (about 40 reasoning at `minimal`, U2, plus about 30 of
  completion).
- **Multi-line request:** about 6,200 input tokens, about 5,000 of them
  cached, and about 200 output tokens.
- **Billed requests:** a pause of at least the 350 ms debounce triggers a
  request. 25% of triggers are served from the typing-through cache, and 15%
  of billed requests are multi-line.

| Typing rate (triggers per minute) | Billed requests per hour | Standard (`muse-spark-1.3`) | Contributor | Standard, no cache and no reuse |
| --------------------------------- | ------------------------ | --------------------------- | ----------- | ------------------------------- |
| 6 (light)                         | 270                      | $0.40                       | $0.02       | $1.44                           |
| 12 (typical)                      | 540                      | **$0.80**                   | **$0.05**   | $2.87                           |
| 30 (heavy)                        | 1,350                    | $2.00                       | $0.11       | $7.18                           |

Per request, Standard costs $0.0012 for a fast request and $0.0031 for a
multi-line one ($0.0032 and $0.0086 with nothing cached). The contributor
model costs $0.00007 and $0.00017. Whatever the real numbers, the daily budget
(D73) is the hard ceiling, and `TAB_MAX_REQUESTS_PER_MINUTE` bounds the rate
below the contributor tier's 100 RPM team limit.
