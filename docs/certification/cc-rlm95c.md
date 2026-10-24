# cc/rlm95c — M95c parts 3, 6 and 7 ported onto int/recovery (2026-10-23)

Worktree `mx-cc-rlm95c`, branch `cc/rlm95c`, from int/recovery `9fc689af83`.
Lane RLM95C (`rec/rlm95c`, head `083118f92e`) could not merge (80 files
conflicted: it re-did RLM95B's editor chat, the Moonshot and Ollama Cloud
presets and RLPROVSYNC's re-sync). Only what int lacked was ported, read
from RLM95C's code and rebuilt on int's provider code; that branch was
never merged. Model attempts: **0**. Provider calls: **0** (no keys on
this lane). Every request below is captured at the socket of the real
configured request builder (`test/unit/helpers/providerWire.ts`: a real
providers file, the vendored models.dev snapshot as the catalogue, the
real record resolution, codec, credential and header reads and the real
pinned transport; the injected send records the request and fails, so
nothing leaves the machine and no answer is invented; DNS answers with a
public literal that is never dialled).

Commits: `153841f0a2` (part 3), `11fc78e6b6` (part 6), `0319e29137`
(part 7), `1021deee2f` (bundle-budget follow-up), `7e18514f91` (this
record), `949d115449` (the integration suite's resolver), `68b94ff06d`
(clones back to base), and the commit adding the Gates section.

## Part 3 — OpenAI explicit cache breakpoints (built)

Source: [prompt caching guide](https://developers.openai.com/api/docs/guides/prompt-caching)
and the [Responses create reference](https://developers.openai.com/api/reference/resources/responses/methods/create),
read 2026-10-23. The marker is `prompt_cache_breakpoint: {"mode": "explicit"}`
on a message's `input_text` / `input_image` / `input_file` part or a
`function_call_output` part; top-level `instructions` cannot carry one;
GPT-5.6 and later only; implicit mode (the default) keeps its implicit
breakpoint and leaves three explicit slots.

RLM95C's version predates the guide's current text (it forced
`mode: explicit`, refused `12h`, and had no production caller). The port:
the Responses codec marks the stable prefix (first markable item) and the
rolling end (last markable item, never the trailing developer goal
suffix), the Anthropic codec's rule; at most two markers; no mode switch,
so the `prompt_cache_options.ttl` RLPROVSYNC sends stays as it was. The
person's machine-scoped `museSpark.modelApiPromptCacheBreakpoints` turns
it on; off by default until the paired run PLAN.md requires.

Proof `test/unit/responsesCacheBreakpoints.test.ts` (6 tests): the golden
request for `gpt-6.1-sol` at `https://api.openai.com/v1/responses`; off,
and on `gpt-5.5`, nothing is marked; every byte before the rolling marker
stays stable as the turn grows; a lone item is marked once and history is
never touched; the plan profile never carries one.

Drills: trailing-suffix exclusion disabled → 1 failed, exit 1; model gate
removed → 1 failed, exit 1; restored → 6 passed, exit 0. Manifest: with
the setting's row taken out of package.json the two settings rows of
`manifest.test.ts` fail (5 failed vs 3 on base), restored → 3 failed, the
three base failures listed under Gates.

## Part 6 — custom request headers per provider (built)

Source: [OpenAI authentication](https://developers.openai.com/api/reference/overview),
read 2026-10-23: `OpenAI-Organization` and `OpenAI-Project` beside
`Authorization: Bearer`. PLAN.md part 6 says values live in SecretStorage
bound to the origin; RLM95C kept them in `providers.json`. The port keeps
names and values together in the credential store
(`museSpark.providerHeaders.<id>`), origin-bound like the key, read per
attempt by a `CustomHeadersAuthSource` wrapping the credential (turns,
counts, lists, key tests). The credential's own fields are written last;
auth, content, transport and protocol names (and `x-amz-*`) are refused;
values are scrubbed from errors, logs and streamed text by the redactor
and from streamed tool arguments by the codec client. A request to
another origin, or a damaged record, refuses before the socket. Removing
the provider (editor or `providers remove`) removes them.

Set in the editor from the provider row's Request Headers button: the
editor's own quick pick and password box (no value crosses
postMessage), loaded with the providers seam. Or
`providers headers <id> [set|unset <name>]`, the value read from standard
input only (a value after the name is a usage error).

Proof `test/unit/providerRequestHeaders.test.ts` (10 tests): the headers
on the documented OpenAI shape through the real builder; none when none
stored; another origin and a damaged record refuse with zero sends; the
reserved/invalid names; the scrub; the CLI set/list/unset round trip over
a real providers file (map-backed secret port: the OS store cannot open
on a test machine); a reserved name refused before stdin is read; removal
deletes them; a value is never an argument.

Drills: origin bind removed → 1 failed, exit 1; the wrapper unplugged from
the transport → 3 failed, exit 1; `providers remove` cleanup removed → 1
failed, exit 1; each restored → green, exit 0.

Local look (`npm run ui:look -- models-providers`), light and dark:
[light](cc-rlm95c/models-providers.light.png),
[dark](cc-rlm95c/models-providers.dark.png).

## Part 7 — Tab on bring-your-own models (built: chat-shaped hole)

Source: [Mistral chat completions](https://docs.mistral.ai/api/endpoint/chat),
read 2026-10-23 (`model`, `messages`, `max_tokens`, `stream`).
`museSpark.tabModel` takes a `provider/model` reference beside the two
Meta tiers (the manifest keeps the tiers' descriptions in an `anyOf`).
The provider resolves it per request with the agent turn's tool-calling
gate opted out (`resolve(ref, { requireTools: false })`; a completion
sends no tools), and the real Tab engine sends M94's chat-shaped hole
through that provider's client, key and codec. The daily ledger reserves
and settles at the provider's card; consent is keyed by the card and
D48's question quotes it (a plan or local model names its own billing;
no Meta training note). Unknown, unpriced, or no known output maximum
without the person's cap: quiet with its reason. Meta's no-key state
applies to Meta tiers only. Account & usage tallies a BYO request at its
card.

Proof `test/unit/tabByo.test.ts` (5 tests): Codestral (catalogue card,
4,096 output maximum) through `https://api.mistral.ai/v1/chat/completions`
with the system and user messages Tab builds, `max_tokens: 256`, stream on
and no `tools`, the Meta key client never called; an LM Studio model
without confirmed tool calling refuses an agent turn but resolves for Tab
(quoted local); an unpriced model resolves to nothing; the ledger
reserves 1,000/256 tokens at $0.30/$0.90 per million and settles 400
uncached + 500 cached + 10 output at the card; the question quotes $0.300
and $0.900 per million without the training note.

Drills: ledger forced back to Meta's estimate → 1 failed, exit 1; engine
forced to the Meta stream → 1 failed, exit 1; tool-gate opt-out removed →
1 failed, exit 1; each restored → 5 passed, exit 0.

Not built: fill-in-the-middle routes (Codestral FIM, DeepSeek FIM,
Ollama `/api/generate` with `suffix`). RLM95C did not build them either;
each is a new route per provider and needs its capture.

## Parts 1 and 4 — not built here

- **Part 1, Amazon Bedrock.** RLM95C's part 1 is a 4,000-line change (a
  1,460-line Converse/event-stream/SigV4 codec, a `BedrockAuthSource`, a
  new `aws-region` origin kind through panel, CLI and exec, a signing
  hook in the shared transport, a Bedrock retry table). On this base it
  does not fit where RLM95C put it: `dist/providers.js` is at 198.6 of
  200 KiB, and the transport and retry table ride `dist/modelApi.js`
  (575.1 KiB on base against 525). It needs its own lazily loaded chunk
  and signing outside the shared transport, and the vendored catalogue
  has no `amazon-bedrock` rows (the static model table needs a models.dev
  re-sync). Dispatch also waits for the owner's AWS capture
  (`wireCapture: false`).
- **Part 4, providers' hosted search.** The plan names OpenAI's web
  search, Anthropic's server-side search, Gemini's Google Search
  grounding and OpenRouter's web plugin, each a paid feature priced from
  the provider's own page; its capture spends search fees and waits for
  the owner's go (PLAN.md M95c owner steps), and wire shapes come from a
  live capture (AGENTS rule 14). The search admission and settlement it
  extends live in `ModelApiHost`, `ModelApiClient` and `modelPolicy`
  (`dist/modelApi.js`, over budget on base). RLM95C's hosted-tools work
  covered other providers (Z.ai, OpenRouter's plugin without a tariff,
  Meta `tool_search` on the Meta request path, record-only Gemini and
  Groq leaves).

## Gates (final tree, Windows 11)

prettier --check (every touched file) 0 · eslint --max-warnings 0
(touched) 0 · typecheck (all projects) 0 · check:plan 0 (240 milestones,
0 drift) · check:l10n 0 (0 problems) · check:reference 0 · deadcode 0 ·
check:roadmap 0. Not green on base either, with the same results here:
check:catches 1 (the same per-area counts as base `9fc689af83`),
duplication 1 (41 clones, base 41), `manifest.test.ts` 3 failures
(walkthrough, notices, RELFAST), and `npm run build` 1: the base already
runs 12 bundles over budget. Against base, this lane adds to four of them,
each for a person-set setting or the new button: `modelApi.js` +34 B and
`reportingPanel.js` +224 B (the new setting's default, scope and reader,
and the widened Tab model), `modelsPanel.js` +552 B (the button's message,
port and removal cleanup; the manager itself loads with
`modelsSubscriptions.js`), `uiText.js` +27 B (two accessor keys; the
strings ride `uiTextSurfaces.js`). Within budget: `providers.js` 198.6
of 200 KiB (+1,092 B, the codec's marker), `configuredProviders.js` 71.7
of 75 (+2,108 B), `tab.js` 63.6 of 75 (+1,528 B), `modelsSubscriptions.js`
35.9 of 50, `foreignHooks.js` 87.8 of 100, `uiTextSurfaces.js` 12.8 of 25,
`extension.js` 516.8 of 600. No budget was raised.

## Not claimed

No README, CHANGELOG or Help claim: none of these was used for real
through the packed product (AGENTS standing rule). The packed-product run,
the paired cost run for part 3 and the provider captures are the lead's.
