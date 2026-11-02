# Providers, SDKs and open protocols — research delta (RSCH-PROVIDERS, 2026-11-02)

Base: `rv/int9` `72d8d5003` (branch `rec/rsch-providers`), rig `linuxlt`.
Everything below was read or measured on 2026-11-02 unless a different
date is named. Starts from `providers-2026-10-30.md` (catalogue sync,
2026-10-30) and `agents-sdks-2026-10-30.md` (Muse/ACP/MCP/VS Code
currency, 2026-10-30), and from the per-provider files in
`docs/research/providers/` (2026-10-17, against `main` `3d30a73214`).
This file reports only what changed since 2026-10-30 and what those
files recorded as unadopted that is still unadopted on this base.
Registry facts are `npm view` runs on 2026-11-02; tarball diffs are
registry tarballs downloaded the same day under `temp/rsch/`
(SHA-256s in §1.6). No provider call was made; no account was used.
Open branches checked before calling anything missing:
`git for-each-ref refs/heads/lanes` (11 lanes: cc-\*, rlf-m104\*,
rlf-m109 — none touches a provider preset) and `c/m95c-2`
(`aa1efb22e`, reasoning-toggle fixes, no Bedrock preset).

Verdicts: **better** (ours exceeds the alternative), **equal**,
**worse**, **partial**, **missing**, **deliberately not** (decision
named). Our side is always `file:line` on this base.

## 1. What is new or what we had not read

### 1.1 Anthropic — two releases in three days, one of them today

- **Message threads (beta), announced 2026-11-02.**
  `https://platform.claude.com/docs/en/release-notes/overview` and
  `https://platform.claude.com/docs/en/build-with-claude/message-threads`,
  read 2026-11-02. The server holds the conversation; later requests
  send only new messages. Wire: beta header
  `message-threads-2026-08-12`; first request adds
  `"thread": {"type": "create"}` with the full conversation, `system`
  and `tools`; later requests add
  `"thread": {"type": "continue", "previous_message_id": "<id>"}`
  with only the new messages and no `system`/`tools` (the thread keeps
  the create values). A thread expires 5 minutes after its last
  request and is deleted within 1 hour; an expired continue returns
  404 and the client replays the full conversation as a new create.
  The docs state the application stays the source of truth and must
  keep its own copy. ZDR: not eligible (contents held in memory,
  encrypted under a server-managed key). Supported on the Claude API,
  Claude Platform on AWS, Google Cloud (Anthropic managed) and
  Microsoft Foundry; model list includes Opus 5.5/5, Sonnet 5.5/5,
  Haiku 5.5, Fable 5/5.1 and the 4.x line back to Sonnet 4.5. The
  TypeScript SDK shipped the same shape a week earlier
  (`@anthropic-ai/sdk` 1.2.0, 2026-10-23: "add support for message
  threads"; `BetaMessageThreadParam = BetaThreadCreateParams |
BetaThreadContinueParams` in the 1.3.0 tarball, read 2026-11-02).
  We send no `thread` field anywhere
  (`src/core/backends/modelapi/codecs/anthropic.ts`, searched
  2026-11-02).
- **Fast mode deprecated for `claude-opus-4-8`, 2026-10-30, removal
  2026-11-30** (same release-notes page): after removal,
  `speed: "fast"` on Opus 4.8 errors; migrate to Opus 5.5. We send no
  `speed` on any model (searched 2026-11-02), so nothing breaks; fast
  mode itself remains unadopted (§2).
- Already adopted since the 2026-10-17 file: API version `2026-10-21`
  with no sampling fields (`anthropic.ts:99`), the 128 MB request cap
  (`ANTHROPIC_MAX_REQUEST_BYTES = 128_000_000`,
  `src/shared/constants.ts:2547`), lifecycle dates from the models
  list (`src/core/providers/modelMetadata.ts:271`), and the Files API
  dialect (`src/core/backends/modelapi/files.ts:29`).

### 1.2 OpenAI — no new API surface since 2026-10-30; the SDK moved twice

- Changelog (`https://developers.openai.com/api/docs/changelog`, read
  2026-11-02): newest entry is 2026-10-30, `gpt-6-rosalind` (life
  sciences, trusted-access only). It is absent from the live
  models.dev catalogue (0 matches, measured 2026-11-02), so there is
  nothing to price or list. Nothing dated 2026-10-31 to 2026-11-02.
- `openai` (Node) 7.46.0 and 7.47.0, both 2026-10-31 (registry;
  `CHANGELOG.md` in the 7.47.0 tarball, read 2026-11-02): Agents-API
  context-compaction settings, agent session review/tool settings,
  experimental agent time awareness, hosted-tool usage exposed in
  Responses, typed Responses WebSocket warmup. These are hosted
  Agents API surfaces except hosted-tool usage accounting; none
  changes the raw Responses request our codec sends. Server-side
  compaction itself (`POST /responses/compact`,
  `context_management: [{type: "compaction", compact_threshold}]`,
  a final `compaction_trigger` input item, encrypted `compaction`
  output items, `response.compaction.compacting` stream events) is
  present identically in 7.45.1 and 7.47.0 (counted 2026-11-02), so
  it is not new; it was recorded unadopted on 2026-10-17
  (`providers/openai.md:256`) and still is (§2, §3).
- The models list's per-model `shutdown_date` (recorded unread on
  2026-10-30) is still unread: lifecycle parsing runs only for the
  Anthropic preset (`modelMetadata.ts:249`).

### 1.3 Google Gemini — two reroutes dated 2026-12-01, Computer Use GA, storage default flipped

Release notes moved: `https://aistudio.google.com/docs/changelog`
(the old `ai.google.dev` URL redirects), read 2026-11-02.

- **2026-11-02: `gemini-2.5-pro` and `gemini-2.5-flash` deprecated.**
  From 2026-12-01 both ids auto-route — 2.5 Pro to `gemini-3.8-flash`,
  2.5 Flash to `gemini-3.5-flash-lite` — billed at the target's
  rates, with breaking changes: `thought_signature` validation,
  `thinking_level` replacing `thinking_budget`, sampling parameters
  and prefilled model turns removed. Our snapshot still prices
  `gemini-2.5-pro` at \$1.25/\$10 (measured in the live catalogue,
  §1.6) while requests will serve and bill as 3.8 Flash
  (\$0.75/\$3.75) — the same wrong-price fallback class recorded for
  `gemini-3.5-flash` on 2026-10-30, now with two more ids and a date.
  Our codec does replay signatures and does choose budget vs level
  from the capability record
  (`src/core/backends/modelapi/codecs/gemini.ts:732`), so the wire
  risk is a long-lived session pinned to a 2.5 id replaying 2.5-era
  history (including `skip_thought_signature_validator` parts,
  `gemini.ts:62`) into a 3.x model after 2026-12-01.
- **2026-10-30: Computer Use GA** on Interactions and GenerateContent.
  We have no Gemini computer-use tool (§2).
- **2026-10-26: GenerateContent storage on by default** for new paid
  projects (`store=true`); opt out per request with `store=false` or
  in the Logs and Datasets settings. Our Gemini codec drops `store`
  as a Meta-only field (`gemini.ts:628`) and never sends an opt-out,
  so a person with a new paid Gemini project stores every request by
  default without the product saying so. Not recorded in the
  2026-10-17 Gemini file (it predates the change).
- **2026-10-27: Gemini API CLI (`gemini-api`) beta** on the
  Interactions API. Noted for the harness lanes; no provider action.

### 1.4 ACP — 2.3.0 and 2.4.0 published today; five new unstable methods

Registry, read 2026-11-02: `@agentclientprotocol/sdk` 2.3.0
(2026-11-02T11:14Z) and 2.4.0 (2026-11-02T11:29Z). Tarball diffs
(2.2.0 → 2.3.0 → 2.4.0, run 2026-11-02):

- **v1 stable schema: wording only.** Every hunk in
  `dist/v1/schema/types.gen.d.ts` is a comment rewording; no field or
  method changed. A 2.0.1 agent stays wire-compatible.
- **v1 unstable gains session housekeeping and auth status:**
  `session/archive`, `session/unarchive`, `session/status`,
  `session/set_title`, `auth/status`, plus the `auth/status_update`
  client notification, `SessionInfo.archived`, the `archived` filter
  on `session/list`, and capabilities
  `sessionCapabilities.archive|status|title` and
  `authCapabilities.status` (each `{}` to advertise, omitted/null for
  unsupported). Semantics from the generated types: archiving a
  loaded session cancels its work as `session/close` would; archive
  requires `sessionCapabilities.list`; unknown sessions get `-32002`;
  an invalid title gets `-32602`; `auth/status` must not fail with
  `auth_required` and returns `state`
  (`authenticated|unauthenticated|not_required|unknown`) with
  optional display-only `accounts[]` (`label`, `active`, `name`,
  `email`, `organization`) that clients must not log or send to
  telemetry. Our agent advertises `list/resume/close/delete`
  (`src/acp/agent.ts:4291`) and registers no archive/status/title or
  auth-status handler (`src/acp/agent.ts:5158`).
- **2.4.0 is one transport fix:** `stopWaitingOnCancel` on JSON-RPC
  requests — aborting sends `$/cancel_request` and rejects at once
  with `-32800` instead of waiting for the peer's answer (for v2
  permission requests on cancel/close). No v1 schema change.
- Pin state: we are on 2.0.1 (`package.json:2128`). Against the
  repository's 7-day `min-release-age` (`.npmrc`): 2.0.2 (the CRLF
  stdio-framing fix, 2026-10-30 report) cleared the window on
  2026-10-31; 2.1.0 (MCP-over-ACP) clears 2026-11-04; 2.2.0 clears
  2026-11-06; 2.3.0/2.4.0 clear 2026-11-09. Licence Apache-2.0
  (tarball `package.json`).

### 1.5 Muse, MCP, xAI, local servers — verified quiet

- `@muse-code/sdk`: latest 1.4.14 (2026-10-27, registry); the
  official changelog (`https://dev.meta.ai/docs/muse-code/changelog`,
  read 2026-11-02) still ends at 1.4.13, so 1.4.14 remains
  undocumented there. We pin 1.4.12 (`package.json:2143`); 1.4.14
  clears the 7-day window on 2026-11-03. The 1.4.13/1.4.14 MSP fields
  recorded on 2026-10-30 (`cuaCardFacts`, `backgroundTerminalCompletion`,
  `held`, `earlierHistory`) are still stripped by our wire schema —
  that is the Muse lane's brief, repeated here only as the SDK pin.
- MCP: spec revision is still 2026-07-28
  (`https://modelcontextprotocol.io/specification/2026-07-28/changelog`,
  re-read 2026-11-02; independent secondary sources agree it is the
  latest stable revision as of November 2026). TypeScript v2 split
  packages `@modelcontextprotocol/client|server` are at 2.4.0
  (2026-10-23, registry); the v1 monolith we pin is 1.32.1 against
  latest 1.32.2 (2026-10-23). Nothing since 2026-10-30. The gaps
  recorded then stand: no client registration (CIMD/DCR), no Tasks,
  Skills or MCP Apps extensions.
- xAI (`https://docs.x.ai/developers/release-notes`, read
  2026-11-02): nothing dated after October. `grok-imagine-image-quality`
  retires today (2026-11-02, reroutes to `grok-imagine-image-2.0`);
  our tree names no imagine slug (searched 2026-11-02). October's
  `guidelines` moderation array (Chat/Responses) is not sent by us
  (minor, §2). September's `safety_identifier` is adopted
  (`src/core/backends/modelapi/codecs/responses.ts:713`). Grok
  subscription sign-in: no third-party OAuth registration exists;
  unchanged from 2026-10-30, still correctly waiting.
- Ollama: latest v0.40.13 (2026-10-28, GitHub releases API read
  2026-11-02; release body is model support only). The 2026-10-30
  report said v0.40.5 — stale by eight patch releases, but the native
  API surface our codec speaks (`/api/tags`, `/api/chat`, `think`)
  is unchanged in every body checked. Our Ollama preset remains
  uncaptured (`wireCapture: false`, `presets.ts:1271`).
- vLLM v0.33.0rc3 (2026-11-02, GitHub releases API): serving
  performance and new-model support, including Muse Spark Open; the
  OpenAI-compatible surface our `vllm` preset speaks is unchanged.
  LM Studio's JS SDK is 2.1.0 (2026-10-14, registry); our captured
  LM Studio preset is unaffected. (LM Studio app releases are not on
  GitHub; app-version currency could not be verified from here.)
- A2A: v1.0.1 remains current (v1.0.0 2026-03-12, v1.0.1 2026-05-28;
  Linux Foundation / Agentic AI Foundation, Apache-2.0; secondary
  sources read 2026-11-02, no newer release found). We implement no
  A2A surface (searched `src/` 2026-11-02); our agent-to-agent paths
  are ACP and MCP. AGENTS.md files and SKILL.md skills are already
  first-class here (`src/core/context/skills.ts`,
  `src/core/skills/bundledSkillsInstall.ts`); no new skills-standard
  revision was found since 2026-10-30 (the MCP Skills extension
  SEP-2640 remains the open item, §2).

### 1.6 Catalogue (models.dev) — measured drift, 2026-10-30 → 2026-11-02

Live `https://models.dev/api.json` fetched 2026-11-02: 5,959,285
bytes, SHA-256
`8f7807ffd591644272fd2c16cc2dc71b81030738355d21f0d97ec0928e5540c4`.
Diffed against the vendored snapshot (`fetchedAt` 2026-10-30) over
the fields the sync keeps (tool-capable models; `cost`, `limit`,
`reasoning_options`, `structured_output`), with the sync table's id
aliases applied (`scripts/sync-provider-catalog.mjs:52`):

- **Zero drift** for openai, azure, xai, groq, deepseek, mistral,
  togetherai, fireworks-ai, huggingface, zai, anthropic, google,
  moonshotai. (Non-tool additions upstream — image, embedding,
  realtime, audio rows — are filtered out by design.)
- **OpenRouter:** added `z-ai/glm-5.3-flashx-legal`; removed the four
  `poolside/laguna-*` ids; 21 rows changed price, limits or reasoning
  options (largest: `deepseek/deepseek-v4-pro-0813`
  \$0.66/\$1.98 → \$0.115/\$4 with output 393,216 → 943,718;
  `minimax/minimax-m2.5` output 131,072 → 32,768;
  `particle-ai/particle-1` halved; `mistralai/mistral-large-4-0`
  effort values `none,high` → `low,medium,high`). OpenRouter is
  live-list priced in our presets (`presets.ts:780`), so this drift
  reaches only the offline fallback and the picker before a scan.
- **Ollama Cloud:** added `mimo-v2.6-flash`, `mimo-v2.6-pro` (both
  tool-capable). Ollama Cloud is catalogue-priced (`presets.ts:1248`)
  and uncaptured, so the rows matter only when its capture lands.
- **Fields the sync discards that now carry product meaning:** every
  OpenAI/Azure row in the live file carries
  `experimental.modes` — `fast` (`service_tier: "priority"` at 2×
  price), `pro` (`reasoning: {mode: "pro"}`), `ultrafast`
  (`service_tier: "ultrafast"` at 6×, on Astra/Sol rows), `flex` on
  o-series — plus `status` (`deprecated`/`beta`) and `type`
  (`image`/`embedding`/`realtime`). `filterModel`
  (`scripts/sync-provider-catalog.mjs:173`) keeps none of them, so
  the product cannot offer a fast mode, badge a deprecated model
  from the catalogue, or price a mode, even where the provider
  documents one. This is the catalogue half of the fast-mode gap
  (§2).
- **Sections with no preset and no sync row:** `cerebras` (2 tool
  models: `qwen-3.8-27b`, `gpt-oss-120b`), `minimax` (8) and
  `alibaba` (47) exist upstream. We have plan-key presets for
  MiniMax and Alibaba (`presets.ts:939`, `presets.ts:970`, both
  uncaptured, both `priceSource: 'catalogue'` with no catalogue
  section to price from) and no Cerebras preset at all (searched
  `src/` and `PLAN.md` 2026-11-02: no occurrence). Cerebras speaks
  OpenAI-compatible Chat Completions at `https://api.cerebras.ai`
  with Bearer auth and its own `service_tier` values including
  `flex`/`auto` queue thresholds
  (`https://inference-docs.cerebras.ai/api-reference/chat-completions`,
  read 2026-11-02).
- Tarball SHA-256s for §1.2/§1.4 (registry, 2026-11-02):
  ACP 2.2.0 `82ae88c0…b07e`, 2.3.0 `d6ef675a…8ff7`, 2.4.0
  `87acc66d…a8d`; OpenAI 7.45.1 `1aced95c…08c2`, 7.47.0
  `4d1e3460…3448`. Licences: models.dev MIT (vendored `LICENSE`);
  ACP SDK Apache-2.0; OpenAI Node SDK Apache-2.0; Anthropic
  TypeScript SDK MIT (tarball `LICENSE-MIT`). Nothing here copies
  code; wire shapes are facts, and every adoption below still needs
  its own live capture under AGENTS.md rule 14.

### 1.7 Research read for this delta (papers, not marketing)

- **Compaction Laundering** (Dabirsiaghi, arXiv:2610.29869,
  2026-10-21, cs.CR; abstract and method summary read 2026-11-02):
  harnesses that flatten a typed conversation into one string with
  `[User]:`-style labels before summarizing let attacker-controlled
  text forge a user turn that survives compaction (87–100% across
  five flattening harnesses; 0% across four role-typed harnesses;
  executed `curl | sh` in a sandbox from a laundered approval). Our
  compaction sends the canonical typed `input` items plus one
  appended user prompt — never a flattened transcript
  (`src/core/backends/modelapi/ModelApiHost.ts:18390`) — and keeps
  the accepted request as the summary's provenance
  (`ModelApiHost.ts:18412`). We are in the paper's safe class by
  construction. Consequence for §3: any server-side compaction
  adoption moves serialization to code we cannot audit, so it must
  be opt-in, never the default path.
- **The Physical Cost of Context** (Yu et al., arXiv:2610.34763,
  2026-10-26, NeurIPS 2026 RAAAI workshop; abstract read
  2026-11-02): on 450 SWE-rebench localization cases, anchored
  history compaction passed a quality gate but saved nothing further
  once prefix caching was accounted; deleting reusable history
  raised uncached prefill by 608% in their Mask-5 arm. Consequence:
  compaction policy should be judged on uncached prefill and call
  count, not prompt tokens — which is what our economics already do
  (`src/core/backends/modelapi/autoCompact.ts:146`, write/read
  pricing with carried debt). It also weakens the case for adopting
  opaque server compaction for cost reasons alone.
- Noted, not read in full (abstract-level only, no claim below rests
  on them): TurnCost (arXiv:2610.15093, ASE 2026 POVC workshop) on
  cache-aware loop scoring; CMV (arXiv:2602.22402v2, 2026-10-22) on
  structurally lossless trimming; the Copilot trace study
  (arXiv:2608.00101) reporting compaction in 7.8% of production
  sessions with cache cold-starts.

## 2. Comparison table (feature by feature)

"Upstream" is the provider/protocol fact with its source in §1 (or
the 2026-10-17/2026-10-30 files it repeats). "Ours" is this base.

| Feature                                                                    | Upstream                                                                                                                                                                                                                              | Ours (file:line)                                                                                                                                                                                                                                                                                                                                                           | Verdict                                                                                                             |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Anthropic message threads (server-held history, delta requests)            | Beta 2026-11-02, `thread` create/continue (§1.1)                                                                                                                                                                                      | Full history resent every request; no `thread` field (`codecs/anthropic.ts:863`)                                                                                                                                                                                                                                                                                           | **missing**                                                                                                         |
| Anthropic/OpenAI server compaction + context editing                       | Anthropic `context_management` edits (`compact_20260112`, clear-thinking/tool-uses); OpenAI `/responses/compact`, `compaction_trigger`, encrypted items (§1.2)                                                                        | Client-side M101 compaction: typed input, structured summary, recorded provenance, economic admission (`ModelApiHost.ts:18390`, `autoCompact.ts:146`)                                                                                                                                                                                                                      | **better** on auditability and provenance (arXiv:2610.29869 safe class); **missing** as an opt-in for price/latency |
| Anthropic structured outputs                                               | `output_config.format {type: json_schema, schema}`, GA (§1.7 refs; 2026-10-17 `anthropic.md:250`)                                                                                                                                     | Record claims `json_schema` from the live list (`modelMetadata.ts:311`) but the codec sends only `output_config.effort` (`anthropic.ts:880`); side calls fall back to prompt + repair (`structuredOutput.ts:110`)                                                                                                                                                          | **partial — silent degradation**: the record promises constrained decoding the wire never requests                  |
| Gemini structured outputs                                                  | `generationConfig.responseMimeType/responseSchema`                                                                                                                                                                                    | Same pattern: no schema field is emitted (`gemini.ts:728`); prompt + repair carries side calls                                                                                                                                                                                                                                                                             | **partial**                                                                                                         |
| Responses/Chat structured outputs, strict tools                            | `text.format` json_schema strict; strict function schemas                                                                                                                                                                             | Sent where the record affirms (`structuredOutput.ts:69`, `codecs/chat.ts:659`, `codecs/responses.ts:264`)                                                                                                                                                                                                                                                                  | **equal**                                                                                                           |
| Prompt-cache controls                                                      | Anthropic breakpoints 5m/1h; OpenAI explicit breakpoints + 12 h retention (writes 2.5×, 2026-10-20); Gemini implicit + explicit CachedContent; Chat `prompt_cache_key`                                                                | Anthropic rolling breakpoints with caller TTL (`anthropic.ts:810`); Responses breakpoints + `prompt_cache_options.ttl` (`responses.ts:719`, M95c part 3 behind a setting, PLAN M95c status 2026-10-23); stable digest key (`promptCache.ts:24`); Chat key + isolation key (`chat.ts:692`). Gemini explicit caching not used (implicit only; usage read at `gemini.ts:831`) | **equal** except Gemini explicit caching **missing**                                                                |
| Fast / priority modes                                                      | OpenAI `service_tier: priority\|ultrafast\|flex` (catalogue `experimental.modes`, §1.6); Anthropic `speed: "fast"` (Opus 4.8 deprecated 2026-10-30); Gemini `serviceTier` Flex/Priority; xAI Fast (plan-only); Cerebras `flex`/`auto` | `service_tier` sent only on the ChatGPT-plan route (`responses.ts:703`, `ModelApiHost.ts:5876`); no API-key fast mode on any provider; catalogue modes stripped at sync (`sync-provider-catalog.mjs:173`)                                                                                                                                                                  | **missing** (and the price data to offer it honestly is discarded)                                                  |
| Thinking / effort controls                                                 | Per-model effort lists, budgets, adaptive, `between_tools` off-switch, Gemini level vs budget by generation                                                                                                                           | All read from the capability record per model: Anthropic modes/off-switch (`modelMetadata.ts:249`), Gemini budget/level + signature replay (`gemini.ts:732`, `gemini.ts:580`), xAI default effort (`capabilityRecord.ts:84`), Z.ai preserved thinking (`chat.ts:844`)                                                                                                      | **equal**                                                                                                           |
| Tool search / deferred tools                                               | Anthropic tool-search tools + `defer_loading`; Meta tool search; MCP tool lists                                                                                                                                                       | No provider tool-search wire anywhere (searched 2026-11-02); every tool is declared up front. Our own `tool_search` string is a UI label (`src/shared/l10n/en.ts:5110`)                                                                                                                                                                                                    | **missing**                                                                                                         |
| Memory tools                                                               | Anthropic `memory_20250818` client tool; Muse Code memory tools                                                                                                                                                                       | Our own `read/add/edit_memory` with Muse Code's shapes on every backend (`memoryTools.ts:64`), one store. Anthropic's hosted memory-tool contract (`/memories` paths, its six commands) is not implemented for Anthropic models that expect it                                                                                                                             | **better** for cross-provider consistency; **partial** for Anthropic-native expectations                            |
| Files APIs                                                                 | OpenAI/Anthropic/Meta upload-once file ids; Gemini Files (2 GB, 48 h)                                                                                                                                                                 | Three dialects implemented, gated on the record (`files.ts:29`, `capabilityRecord.ts:137`); Gemini files not implemented (inline only)                                                                                                                                                                                                                                     | **equal** except Gemini **missing**                                                                                 |
| Citations                                                                  | Anthropic citations on documents; OpenAI/Gemini grounding attributions                                                                                                                                                                | Not requested and not decoded (no citation handling in any codec, searched 2026-11-02); API version 2026-10-21 also removed citations on user text, which we never sent                                                                                                                                                                                                    | **missing** (low value for coding; see §3)                                                                          |
| Batch APIs                                                                 | OpenAI/Anthropic/Gemini batch at ~50%                                                                                                                                                                                                 | No batch path anywhere (searched 2026-11-02)                                                                                                                                                                                                                                                                                                                               | **missing** (no interactive use; §3 says not now)                                                                   |
| Hosted search / grounding / code execution / computer use (provider tools) | OpenAI web search, Anthropic web search/fetch + code execution, Gemini Search grounding + Computer Use GA 2026-10-30, OpenRouter web plugin                                                                                           | Planned as M95c part 4, open (PLAN M95c status 2026-10-23); Meta's hosted search exists on the Meta route only. No provider computer-use tool on the Model API backend                                                                                                                                                                                                     | **missing**, already planned (D74/M95c)                                                                             |
| Model lifecycle → picker honesty                                           | Anthropic `lifecycle` + dates in the list; OpenAI `shutdown_date`; Gemini dated reroutes (§1.3); catalogue `status`                                                                                                                   | Anthropic dates read into the record (`modelMetadata.ts:271`); OpenAI `shutdown_date` unread; catalogue `status` stripped; Gemini rerouted ids keep old prices in the snapshot (3.5-flash since 2026-10-30; 2.5-pro/flash from 2026-12-01)                                                                                                                                 | **partial**                                                                                                         |
| Data retention / storage defaults                                          | OpenAI `store` (we send `store: false` on Responses replays); Gemini `store=true` default for new paid projects since 2026-10-26 (§1.3); Anthropic threads ZDR-ineligible (§1.1)                                                      | Gemini `store` dropped as Meta-only, never opted out (`gemini.ts:628`); no retention note reaches the person                                                                                                                                                                                                                                                               | **worse** on Gemini (silent storage), **equal** elsewhere                                                           |
| Spend/usage APIs                                                           | Anthropic Usage and Cost Analytics API beta 2026-10-29 (old API legacy, still supported); OpenAI admin usage                                                                                                                          | Our spend readers use the pre-analytics Anthropic API and per-preset capabilities (`presets.ts:371`); still supported upstream                                                                                                                                                                                                                                             | **equal** today; migration owed before any removal date (none announced)                                            |
| ACP session housekeeping                                                   | SDK 2.3.0 unstable: archive/unarchive/status/set_title, `auth/status` (§1.4)                                                                                                                                                          | `list/resume/close/delete` only (`agent.ts:4291`, handlers `agent.ts:5158`)                                                                                                                                                                                                                                                                                                | **missing** (unstable; no client requires it yet)                                                                   |
| ACP transport correctness                                                  | SDK 2.0.2 CRLF/CR stdio framing fix                                                                                                                                                                                                   | Pinned 2.0.1 on the SDK's `ndJsonStream` (`runtimeEngineEntry.ts:5`); 2.0.2 is past the 7-day window since 2026-10-31                                                                                                                                                                                                                                                      | **worse** until the pin moves (a CRLF-framing client can stall)                                                     |
| MCP-over-ACP                                                               | SDK 2.1.0 binding, MCP 2026-07-28                                                                                                                                                                                                     | ACP-transport servers parsed, reported skipped (`src/acp/translate.ts:929`)                                                                                                                                                                                                                                                                                                | **missing** (recorded 2026-10-30, unchanged)                                                                        |
| MCP client registration                                                    | 2026-07-28: CIMD preferred, DCR deprecated                                                                                                                                                                                            | Person-supplied `clientId` only; no registration (2026-10-30, unchanged)                                                                                                                                                                                                                                                                                                   | **missing**                                                                                                         |
| MCP Tasks / Skills / Apps extensions                                       | SEP-2663, SEP-2640, `io.modelcontextprotocol/ui`                                                                                                                                                                                      | None advertised, client or connector                                                                                                                                                                                                                                                                                                                                       | **missing**, take per named host only                                                                               |
| Bedrock / Vertex                                                           | Bedrock: Anthropic Messages + OpenAI-compatible GPT, now split `bedrock-runtime` vs `bedrock-mantle` (2026-10-30); Vertex: Gemini + Anthropic on GCP auth                                                                             | No preset for either; M95c part 1 open since 2026-10-04 (PLAN M95c). models.dev carries no Bedrock/Vertex section either (measured §1.6), so pricing needs AWS/GCP pages, not the catalogue                                                                                                                                                                                | **missing**, already planned (D74/M95c part 1, design needs the mantle refresh)                                     |
| Cerebras                                                                   | OpenAI-compatible Chat at `api.cerebras.ai`, 2 catalogue tool models (§1.6)                                                                                                                                                           | No preset, no mention in `src/` or `PLAN.md`                                                                                                                                                                                                                                                                                                                               | **missing**, unplanned                                                                                              |
| MiniMax / Alibaba pay-as-you-go                                            | Full API catalogues upstream (8 / 47 tool models, §1.6)                                                                                                                                                                               | Plan-key presets only, both uncaptured and unpriceable from the catalogue (`presets.ts:939`, `presets.ts:970`)                                                                                                                                                                                                                                                             | **partial**                                                                                                         |
| Azure OpenAI                                                               | v1 surface (`/openai/v1`) current                                                                                                                                                                                                     | Preset on the v1 surface but uncaptured, so refused in the panel (`presets.ts:551`)                                                                                                                                                                                                                                                                                        | **partial** (capture owed since M95)                                                                                |
| Local servers                                                              | Ollama v0.40.13, LM Studio, vLLM v0.33, llama.cpp                                                                                                                                                                                     | LM Studio and llama.cpp captured (`presets.ts:1299`, `presets.ts:1358`); Ollama native and vLLM uncaptured (`presets.ts:1271`, `presets.ts:1325`)                                                                                                                                                                                                                          | **partial**                                                                                                         |
| A2A                                                                        | v1.0.1 stable (§1.5)                                                                                                                                                                                                                  | No A2A surface; teams speak ACP/MCP                                                                                                                                                                                                                                                                                                                                        | **missing** — no editor or user path asks for it (§3)                                                               |
| Muse SDK currency                                                          | 1.4.14 latest, undocumented in the changelog (§1.5)                                                                                                                                                                                   | Pinned 1.4.12; 1.4.13/1.4.14 MSP payloads stripped generically                                                                                                                                                                                                                                                                                                             | **partial** (Muse lane owns the rendering brief)                                                                    |
| Provider limits discipline                                                 | Each provider's documented caps                                                                                                                                                                                                       | Caps come only from the capability record or the person's settings (D121); safety retry limits kept at documented values (e.g. `presets.ts:514`)                                                                                                                                                                                                                           | **equal** (by design)                                                                                               |

Stale-record findings (the plan/docs, not the code): the 2026-10-30
provider report's Ollama version (v0.40.5) was eight patch releases
behind on the day it was written; its Gemini deprecations URL now
redirects to `aistudio.google.com`. PLAN M95c's status (2026-10-23)
predates message threads, the Gemini reroutes and ACP 2.3, so
"parts 1, 4 open" understates the open set in §2 above.

## 3. Ranked list — what to do, and what not to do

Ranked by value to a person, then effort, then strength of evidence.
Effort: S (one lane, days), M (one lane, weeks), L (several lanes).
Every wire adoption needs its own live capture first (AGENTS.md
rule 14); captures spend real money on the owner's keys, so each
brief states its calls before it runs.

1. **Send structured outputs on Anthropic and Gemini (P1, S–M,
   evidence: our own code).** Today the record promises
   `json_schema` and the wire never asks (§2), so every structured
   side call (compaction summaries, reviewers, judges) on those two
   providers pays prompt-and-repair rounds instead of one
   constrained decode, and can still return prose. A person notices
   faster, cheaper, never-malformed side answers. Brief P1.
2. **Opt Gemini requests out of storage, and say so (P1, S,
   evidence: provider changelog 2026-10-26).** New paid projects
   store every request by default; we never send `store=false` and
   never mention it. Privacy-relevant, one field plus one honest
   sentence in the provider UI. Brief P2 (with lifecycle honesty,
   same files).
3. **Move the ACP pin and answer the new housekeeping methods
   (P1–P2, S–M, evidence: tarball diffs).** 2.0.2 fixes CRLF stdio
   framing that can stall a Windows-pipeline editor today; 2.3.0's
   `auth/status` lets Zed/JetBrains show "signed in" without a
   trial session, and archive/status/title make our sessions
   first-class in their lists. Brief P3. (MCP-over-ACP stays the
   2026-10-30 brief B3; do not duplicate it.)
4. **Lifecycle and reroute honesty (P2, S, evidence: measured
   catalogue + provider pages).** Read OpenAI `shutdown_date`, keep
   catalogue `status`, and price a rerouted Gemini id at the model
   that actually serves it (3.5-flash today; 2.5-pro/flash from
   2026-12-01). A person sees "retires <date>" and a true price
   before they pick, not after the bill. Brief P2.
5. **Anthropic message threads, opt-in (P2, M, evidence: provider
   docs + SDK types, no independent measurement yet).** Long agent
   loops resend the whole history every turn; threads cut upload
   and time-to-first-token by sending deltas. Risks are real:
   5-minute expiry mid-task (replay path required), `system`/`tools`
   frozen at create (our tools change when paid features toggle),
   ZDR-ineligible, beta header churn. Ship behind a per-provider
   setting, default off, with the full-replay fallback proven.
   Brief P4. Needs a decision (below).
6. **Fast/priority modes with honest prices (P2, M, evidence:
   catalogue modes on every OpenAI/Azure row).** Keep
   `experimental.modes` and `status` through the sync, carry modes
   on the capability record, offer Standard/Fast(/Ultrafast/Flex
   where documented) per role, send `service_tier`/`speed`/
   `serviceTier` per provider, and settle at the mode's price.
   A person trades money for latency explicitly instead of
   switching models. Brief P5. Needs a decision (below).
7. **Tool search / deferred loading on Anthropic (P2–P3, M,
   evidence: provider docs; value grows with MCP tool count).**
   With several MCP servers connected, up-front schemas eat the
   cache prefix every turn; deferred tools load on demand. Worth
   doing after P1/P3; measure with a real multi-server session
   before claiming savings (arXiv:2610.34763: judge on uncached
   prefill, not prompt tokens). Brief P6.
8. **Finish the preset map: Cerebras, catalogue sections for
   MiniMax/Alibaba, captures for Azure/Ollama/vLLM/Moonshot/Ollama
   Cloud (P3, M, evidence: §1.6).** Each is a preset + capture +
   price rows over the existing Chat codec; Cerebras is the only
   named provider in this lane's brief with no preset at all.
   Brief P7.
9. **Bedrock (M95c part 1) after a design refresh (P3, L,
   evidence: 2026-10-30 mantle split).** The 2026-10-04 design
   predates `bedrock-mantle`; building it as written would bake in
   the wrong endpoint split. Refresh the design against current
   AWS docs, then build. Needs an AWS account with Bedrock access
   (owner step, already in PLAN M95c). Brief P8 is the refresh;
   the build brief follows it.

Already planned elsewhere, not re-briefed here: hosted search as
paid features (M95c part 4, waits for the owner's go on a new kind
of spend); MCP-over-ACP, ACP registry listing, MCP client
registration (2026-10-30 briefs B3/B4/B5); Muse 1.4.13/1.4.14
field rendering (Muse lane); Gemini explicit caching and Gemini
Files (fold into P6's measurement pass or a later Gemini lane —
value is unproven for our request shapes).

**What NOT to do, and why.**

- **Do not make provider server-side compaction the default**
  (OpenAI `/responses/compact`, Anthropic `compact_20260112`).
  The summary is produced by serializer code we cannot audit,
  returned partly as encrypted opaque items, and replaces a local
  history we can inspect, fork and prove. arXiv:2610.29869 shows
  compaction is a trust boundary; ours is in the safe class
  precisely because it stays typed and local (§1.7).
  arXiv:2610.34763 further shows compaction's savings vanish once
  prefix reuse is counted. An opt-in experiment behind a setting,
  measured on uncached prefill, is the most the evidence supports.
- **Do not adopt hosted agent runtimes as a backend** (OpenAI
  Agents API incl. its new compaction/time-awareness settings,
  Anthropic Managed Agents, Gemini managed agents). They move
  approvals, budgets, records and tool execution into vendor state
  our harness cannot see or stop; that contradicts the product's
  approval and accounting design. Revisit only as an explicitly
  separate, clearly-labelled surface, with a decision.
- **Do not build Batch APIs for interactive work.** No person
  waits hours for a chat turn; the only honest consumer would be
  evaluations, which already run as live calls. Revisit if a
  scheduled/eval feature names it.
- **Do not implement A2A.** No editor we ship in speaks it; our
  team paths (ACP workers, MCP) already cover agent-to-agent work
  a person can reach. Watch it; build on a named host's request.
- **Do not chase citations now.** Coding turns ground in files the
  person can open, not in provider citation objects; the decode and
  UI cost buys nothing a diff does not show better.
- **Do not borrow another app's OAuth client for Grok** (unchanged
  owner's rule; xAI still offers no third-party registration,
  §1.5).
- **Do not rewrite the Gemini codec onto the Interactions API.**
  GenerateContent remains the documented stable surface our
  captures prove; Interactions buys managed agents (see above),
  not better turns.

**Decisions needed (for PLAN §2/§3, not code comments).**

- D-THREADS: may a provider hold conversation state server-side for
  up to an hour (Anthropic threads; OpenAI `previous_response_id`
  is the same question) when a person opts in per provider, with
  the ZDR consequence named in the setting? Recommendation: yes,
  opt-in, default off, replay-proven (P4).
- D-FAST: are paid latency tiers a per-role model setting (like
  effort) settled at the mode's catalogue price, with no product
  cap beyond the person's own limits (D121)? Recommendation: yes
  (P5).
- D-SERVERCOMPACT: record the deliberate-not above so a future lane
  does not re-propose opaque server compaction as the default.
  Recommendation: record it with the two arXiv citations.

## 4. Lane briefs (launch unchanged)

Each brief assumes the rig note and recovery rules in force:
real-code tests only, hooks on, explicit `git add`, no `--no-verify`,
no push. "Capture" means a recorded real exchange with date and
command (AGENTS.md rule 14), on the cheapest model that proves the
shape, with the expected call count stated first and the real count
reported after. No limit of ours is added anywhere (D121); failure
retries keep the provider/SDK-documented counts already in
`presets.ts`.

### P1 — Structured outputs on the Anthropic and Gemini wires

```text
LANE PROV-STRUCT: send constrained decoding on Anthropic and Gemini.

Goal: a structured side call on Anthropic or Gemini gets one
constrained decode instead of prompt-and-repair. Today the capability
record claims json_schema (src/core/providers/modelMetadata.ts:311)
but neither codec emits a schema: Anthropic sends only
output_config.effort (src/core/backends/modelapi/codecs/anthropic.ts:880)
and Gemini emits no responseMimeType/responseSchema
(src/core/backends/modelapi/codecs/gemini.ts:728). Fix the wire, not
the claim.

Base: current int (lead sets; research base rv/int9 72d8d5003).
Machine: linuxlt. Read first: docs/research/providers-2026-11-02.md
§1-§3, docs/research/providers/anthropic.md §SO (2026-10-17),
src/core/backends/modelapi/structuredOutput.ts,
src/core/backends/modelapi/codecs/{anthropic,gemini,chat,responses}.ts.

Wire shapes to prove by capture before coding against them:
- Anthropic: output_config: {format: {type: "json_schema", schema}}
  beside effort; respect the documented schema limits (20/24/16 per
  the 2026-10-17 research) by refusing in words before send when a
  side-call schema exceeds them, falling back to the existing repair
  path only by the record's formats, never silently.
- Gemini: generationConfig.responseMimeType: "application/json" plus
  responseSchema (Gemini's schema dialect; reuse the codec's existing
  schema cleaning at gemini.ts:179). Strict where the model takes it.
Only where the selected model's record affirms the format; unknown
stays text+repair. Strict tool schemas on Anthropic (strict: true)
ride the same lane if the capture proves them, else split out.

Proof (real code only): golden request tests per codec built from the
captures; a red drill that removes the format field and shows the
golden failing; one real side call per provider through the packed
product on its cheapest structured-output model (state calls first:
expect <=4 per provider incl. capture; report the real count). No
stand-in servers, no invented frames.

Limits: none of ours (D121). The repair loop keeps its current
behaviour (person-stoppable, no round cap of ours); provider 400s on
unsupported schemas surface in words. Certification record with
drills; CHANGELOG in the person's words; PLAN M95/M106 status line.
Decision needed: none (the record already promises this).
```

### P2 — Gemini storage opt-out and lifecycle honesty

```text
LANE PROV-HONEST: true prices and dates before a person picks a model.

Goal: (a) Gemini requests opt out of provider storage by default
(store=false; new paid projects store by default since 2026-10-26,
aistudio.google.com/docs/changelog, read 2026-11-02) with one honest
sentence where the Gemini key is entered; (b) OpenAI shutdown_date
from the models list reaches the record like Anthropic's dates do
(src/core/providers/modelMetadata.ts:271 is Anthropic-only today);
(c) the catalogue sync keeps status (deprecated/beta) and the picker
badges it; (d) a Gemini id Google reroutes (gemini-3.5-flash today;
gemini-2.5-pro and gemini-2.5-flash from 2026-12-01, same changelog)
is priced and labelled as the model that serves it, with the reroute
named in the picker. Reroute facts come from a dated, cited table in
code (provider page + read date), re-checked on each catalogue sync;
never guessed from ids.

Base: current int (lead sets). Machine: linuxlt. Read first:
docs/research/providers-2026-11-02.md §1.3, §1.6, §2;
scripts/sync-provider-catalog.mjs (filterModel, snapshot cap 512 KiB
must still hold); src/core/providers/{modelMetadata,capturedCapabilities,priceCard}.ts;
src/core/backends/modelapi/codecs/gemini.ts:628.

Proof: catalogue sync drill (status kept, cap holds, --check green);
unit tests over real list-parsing code with recorded list fixtures
only; golden Gemini request showing store=false; picker look
(npm run ui:look) in light and dark. No paid call needed unless the
store field's acceptance needs a capture (then <=2 calls on the
cheapest Gemini model, stated first).

Limits: none of ours (D121). A deprecated model stays selectable
until the provider refuses it; we warn, we never block. All 14 l10n
tables for new strings; featureCatalog + reference regenerated.
Decision needed: none.
```

### P3 — ACP pin to 2.4.x with session housekeeping and auth status

```text
LANE PROV-ACP24: move @agentclientprotocol/sdk 2.0.1 -> the newest
2.x past the 7-day min-release-age window at launch (2.4.0 clears
2026-11-09), and answer the unstable housekeeping methods.

Goal: (a) the pin move, which alone brings the 2.0.2 CRLF/CR stdio
framing fix (a CRLF-framing editor pipeline can stall 2.0.1 today);
(b) session/archive, session/unarchive, session/status,
session/set_title and auth/status (+auth/status_update after
authenticate/logout) on /unstable, advertised only where the backend
can honour them. Wire (SDK 2.3.0 generated types, tarball diffed
2026-11-02): capabilities sessionCapabilities.archive|status|title
and authCapabilities.status, each {} to advertise; SessionInfo.archived
on every listed session when archive is advertised; archived filter
on session/list; archiving a loaded session cancels work as
session/close does; unknown session -32002; invalid title -32602;
auth/status never fails auth_required and returns state +
display-only accounts (never logged, never telemetried; account
labels only, no e-mail unless the existing account surface already
shows it to the person). Archive state persists in our own session
store; Muse Code-hosted sessions advertise only what the CLI proves.

Base: current int (lead sets). Machine: linuxlt. Read first:
docs/research/providers-2026-11-02.md §1.4; docs/research/agents-sdks-2026-10-30.md
§2 (B1/B3/B4 stay separate); src/acp/agent.ts:4291,5158;
src/runtime/runtimeEngineEntry.ts. Check peer ranges and npm audit
before the pin (AGENTS.md rule 9); record the reason in PLAN.

Proof: test/hosts ACP scripts plus new real-code suites driving the
packed agent over stdio with CRLF framing (red on 2.0.1, green on the
new pin) and each new method end to end (archive hides from default
list, status does not load, set_title round-trips, auth/status flips
after auth set). No model call needed. Bundle budgets must hold.

Limits: none of ours (D121). Retry/backoff unchanged. Decision
needed: none (unstable surface, capability-gated, spec-shaped).
```

### P4 — Anthropic message threads (opt-in)

```text
LANE PROV-THREADS: delta requests on Anthropic, off by default.
Needs decision D-THREADS first (providers-2026-11-02.md §3): opt-in
per provider, ZDR consequence named in the setting text.

Goal: on Anthropic models whose record affirms threads, a session
creates a thread once and sends only new messages after, cutting
upload and time-to-first-token in long loops. Wire (platform.claude.com
message-threads, 2026-11-02; SDK 1.2.0 types): beta header
message-threads-2026-08-12; thread:{type:"create"} with full
conversation+system+tools; thread:{type:"continue",
previous_message_id} with only new messages and no system/tools.
Hard parts, all required: (1) any change to system, tools, model,
effort or history (edit, fork, compaction, packing swap, paid-feature
toggle) invalidates the thread and replays full as a new create;
(2) a 404 on continue (5-minute expiry) replays full once, counted
and shown, never a silent loop (one replay per turn, then the turn
proceeds unthreaded and says so); (3) our local history stays the
source of truth - thread ids are an optimisation cache, discarded on
any doubt; (4) cache breakpoints and thinking replay keep their
current rules on the create request.

Base: current int (lead sets), after PROV-STRUCT if both run (same
codec). Machine: linuxlt. Read first: providers-2026-11-02.md §1.1;
src/core/backends/modelapi/codecs/anthropic.ts (breakpoints, replay);
ModelApiHost body/keyed/budget path.

Proof: capture first (cheapest supporting model; expect <=6 calls:
create, continue, expired-continue 404, tool-change re-create; state
and report counts). Goldens from captures; a drill that expires the
thread and shows exactly one full replay; a paired real-life
measurement (same long task threaded vs not: requests bytes, TTFT
from our own logs, cost) in the certification record - ship the
setting only if it wins, else report and stop.

Limits: none of ours (D121); the 5-minute lifetime is the provider's.
Default off; per-provider setting with the ZDR sentence in all 14
tables. Decision: D-THREADS (above).
```

### P5 — Fast/priority modes with honest prices

```text
LANE PROV-FAST: latency tiers a person can choose and see priced.
Needs decision D-FAST first (providers-2026-11-02.md §3): per-role
setting like effort, settled at the mode price, D121.

Goal: (1) catalogue sync keeps experimental.modes and status (today
stripped at scripts/sync-provider-catalog.mjs:173; the 512 KiB
snapshot cap must still hold - measure and report the delta);
(2) the capability record carries per-model modes with their wire
body and price (catalogue evidence; live-list evidence wins where a
list names tiers); (3) Roles UI offers the tiers the record affirms
(Standard default); (4) codecs send them: OpenAI/Azure/xAI Responses
service_tier (priority|ultrafast|flex per record; today only the
ChatGPT-plan route sends it, codecs/responses.ts:703), Anthropic
speed:"fast" only on models the provider still supports (Opus 4.8
fast is removed 2026-11-30 - never offer it there), Gemini
serviceTier, Chat-format service_tier where captured (incl. Cerebras
flex/auto if P7 lands first); (5) usage settles at the mode price and
the mode shows beside the model everywhere effort does.

Base: current int (lead sets), after PROV-HONEST (same sync script).
Machine: linuxlt. Read first: providers-2026-11-02.md §1.6, §2;
src/core/providers/{capabilityRecord,priceCard,presets}.ts;
src/core/backends/modelapi/{planFacts.ts,ModelApiHost.ts serviceTier}.

Proof: sync drill (modes kept, cap holds); goldens per codec from
captures (cheapest mode-bearing model per provider; expect <=3 calls
each, stated first); a drill proving an unrecorded tier is never
sent; settlement test over real price-card code at 2x/6x mode prices;
ui:look light+dark for the tier picker.

Limits: none of ours (D121) - no product cap on tier choice; the
person's own spend limits still apply and price the mode honestly.
Decision: D-FAST (above).
```

### P6 — Anthropic tool search and deferred tools

```text
LANE PROV-TOOLSEARCH: stop declaring every MCP tool up front on
Anthropic.

Goal: where the record affirms it, mark MCP (and other large) tool
sets defer_loading and offer Anthropic's tool-search tool, so the
cache prefix carries names, not every schema, in many-server
sessions. Wire from Anthropic's tool-search docs + SDK types
(BetaToolSearchToolBm25_20251119 / Regex20251119 in @anthropic-ai/sdk
1.3.0), proven by capture before coding: search tool declaration,
defer_loading on tool definitions, tool_reference expansion in
results, and what replay/history must keep byte-stable for caching
and thinking binding. Core built-in tools stay declared; only
record-affirmed, person-visible tool sets defer. If Meta's tool
search (dev.meta.ai/docs/tool-search) matches the same canonical
seam cheaply, include it; else split it out with evidence.

Base: current int (lead sets), after PROV-STRUCT (same codec).
Machine: linuxlt. Read first: providers-2026-11-02.md §2;
docs/research/providers/anthropic.md §TSEARCH (2026-10-17);
src/core/backends/modelapi/codecs/anthropic.ts; the MCP pool's tool
listing path.

Proof: captures (cheapest supporting model, >=2 real MCP servers
connected; expect <=8 calls, stated first); goldens; a paired
measurement in the cert record (uncached prefill + cached read +
calls, deferred vs declared, same task) - ship only if it wins on
physical cost (arXiv:2610.34763), else report and stop. A drill
proving a deferred tool the model never loads is never callable.

Limits: none of ours (D121); no cap on tool count is introduced.
Decision needed: none (record-gated, default by evidence).
```

### P7 — Preset completion: Cerebras, MiniMax/Alibaba sections, owed captures

```text
LANE PROV-PRESETS: every named provider reachable or honestly absent.

Goal: (1) Cerebras preset (Chat format, https://api.cerebras.ai,
Bearer; inference-docs.cerebras.ai read 2026-11-02) with its
catalogue section synced (2 tool models today) and its service_tier
quirks captured; (2) catalogue sections minimax (8) and alibaba (47)
added to CATALOG_PRESETS so the existing plan-key presets price from
evidence, plus pay-as-you-go presets if the captures prove distinct
origins; (3) wire captures for the uncaptured presets that need only
a key or a local server: Azure OpenAI, Moonshot, Ollama Cloud
(+mimo-v2.6 rows), Ollama native (v0.40.13), vLLM (v0.33). Each
capture flips wireCapture only with its frames recorded
(docs/certification/m95-captures pattern). Local servers capture
against the exact build (capturedBuild stamped).

Base: current int (lead sets). Machine: linuxlt (local servers run
here; keys via auth set from stdin only, never seen). Read first:
providers-2026-11-02.md §1.5-§1.6; src/core/providers/presets.ts
(wireCapture map); scripts/sync-provider-catalog.mjs CATALOG_PRESETS.

Proof: per preset, the M95 capture set (models list, one tool turn,
reasoning replay where claimed, error shape) from real calls on the
cheapest model (state counts per provider first; local servers cost
nothing); goldens; panel refuses exactly the still-uncaptured set.
Snapshot cap must hold with the new sections - measure first; if it
breaks, report by how much, never raise it silently.

Limits: provider-documented only (D121). Owner steps: keys for
Azure/Moonshot/Ollama Cloud/Cerebras captures (cents each), as PLAN
M95c already lists. Decision needed: none (D74/M95c part 5 covers it;
Cerebras joins that part by name in the PLAN status line).
```

### P8 — Bedrock design refresh (M95c part 1, design only)

```text
LANE PROV-BEDROCK-DESIGN: re-derive M95c part 1 against today's AWS.

Goal: a written, cited replacement for the Bedrock paragraph in PLAN
M95c part 1 (2026-10-04), which predates the bedrock-runtime vs
bedrock-mantle split recorded 2026-10-30. Read current AWS docs
first-hand (Bedrock runtime/mantle endpoints per model family,
Anthropic Messages on Bedrock incl. its beta/version schedule vs
first-party, OpenAI-compatible GPT surface, Bedrock API keys vs
SigV4, region/model availability, pricing pages - models.dev has no
Bedrock section, measured 2026-11-02) and the same for Vertex AI
(Gemini + Anthropic on GCP auth) so the lead can sequence both.
Output: the refreshed PLAN text (endpoints, auth, model table
source, pricing source, quota semantics, what our anthropic/responses
codecs reuse unchanged), a capture plan with call counts, and the
build brief. No product code in this lane.

Base: current int (lead sets). Machine: linuxlt. Read first: PLAN
M95c part 1; providers-2026-10-30.md §Bedrock;
providers-2026-11-02.md §2. No AWS account use in this lane (docs
only); the build lane needs the owner's AWS account (existing owner
step). Decision needed: endpoint/auth choices the refresh surfaces,
recorded as a D-entry proposal for the lead.
```

## 5. What a person would notice

Taken together, P1–P5 make the same promise on every provider a
person brings: the model they picked is priced as the model that
actually answers, its retirement date is on the label, its structured
answers come back valid the first time, its fast lane is a priced
choice instead of a different model, and a long conversation stops
re-uploading itself — while compaction, approvals and records stay
local and inspectable instead of moving into a vendor's opaque
state. That combination — every provider's newest wire where it
helps, refused where it hides the work — is the difference the
evidence supports; no single item above carries it alone.

## 6. What could not be verified

- No live provider call was made in this lane (by brief), so every
  new wire shape above is docs/SDK-types evidence, not a capture;
  each brief therefore starts with its capture. Thread behaviour
  under tool changes, Gemini `store=false` acceptance on
  GenerateContent, and Cerebras reasoning replay are the three
  shapes most likely to differ on the wire.
- LM Studio app-version currency (releases are not on GitHub/npm)
  and Bedrock/Vertex current docs were not re-read first-hand here;
  P8 exists for exactly that. Mistral, DeepSeek, Moonshot, Groq,
  Together, Fireworks, OpenRouter, Hugging Face and Z.ai show zero
  consumed-field catalogue drift since 2026-10-30 (§1.6) and no
  changelog was re-fetched for them individually; a pricing-page
  change that models.dev has not yet mirrored would be missed by
  that check and is caught by the next scheduled sync instead.
- Editor-side movement (Zed/JetBrains picking up ACP 2.3 methods,
  VS Code 1.145) was checked only at search level; P3 is written so
  we advertise capabilities clients may ignore safely.
- The two arXiv papers in §1.7 were read at abstract + method-summary
  level, not full-text; the claims resting on them (safe compaction
  class, prefill accounting) are stated no stronger than that.
