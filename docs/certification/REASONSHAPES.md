# Lane REASONSHAPES — certification record

Branch `feat/reasoning-controls`, from main `e763f4938` (release 0.18.1).
Capture plan: [REASONSHAPES-capture-plan.json](REASONSHAPES-capture-plan.json)
(26 requests). No lane request touched any provider: every request shape
below comes from the provider's own documentation page, quoted with its
address and the day it was read, and stays **UNVERIFIED** until the lead's
real-request answers land.

One mechanism throughout: a model's capability record says which effort
names it takes, whether thinking can be turned off and how, which request
field carries each, and what the reply's thinking looks like. The codecs
read the record; unknown means the control is not offered and nothing is
sent. No provider name sits in a codec branch: provider knowledge lives in
`src/core/providers/presets.ts` (quirks, dated per-model facts) and flows
through the record.

## Shared mechanism

- `resolveReasoning` (`src/shared/effort.ts`) applies a documented
  requested-to-canonical alias map first (one hop), then the existing
  switch/nearest logic. Refusals keep their code
  (`unsupported_reasoning_effort`) and translated reason.
- `reasoningFacts` (`src/core/providers/presets.ts`): dated,
  doc-cited per-model record patches keyed by exact native model id
  (Z.ai glm-5.2, Together MiniMax M3 and Kimi K3). Applied as
  `preset`-kind evidence in `configured.ts`; `capabilityRecord` PRIORITY
  now ranks dated preset facts above the pinned catalogue snapshot and
  below the live models list, captures and user overrides. Re-check every
  entry on each catalogue sync; prefer the catalogue the moment it carries
  the fact.
- A preset's Thinking-off switch is handed to the codec and the policy
  only where the record affirms reasoning (`supported: yes`): on a model
  that cannot think, Thinking off is already satisfied and the turn goes
  plain instead of refusing.
- `EFFORT_LEVELS` gains Muse Code's client-side `ultra` (highest).
  The Model API backend maps `ultra` to `max` (the API has no `ultra`);
  the CLI maps it per model itself.

## DS-G01 — done, corrected in round 2

DeepSeek's thinking-mode table takes minimal, low, medium, high, xhigh,
max and ultra as requested names and maps server-side
(`https://api-docs.deepseek.com/guides/thinking_mode`, read 2026-10-13).
Round 1 remapped client-side (`ultra` → `max`); DS-ULTRA and DS-XHIGH
(200 both, thinking returned) refute the need, so every name rides as
named and the preset declares no aliases. The dated record carries the
full vocabulary for the four native models (deepseek-flash VERIFIED;
the other three UNVERIFIED until captured).

Person's steps: add a DeepSeek entry, pick a DeepSeek model, set effort to
Max, send a turn. Observe the turn goes with `reasoning_effort: "max"`.

## DS-G02 — done, corrected in round 2

Strict tool schemas are `strict: true` on every function
(`https://api-docs.deepseek.com/guides/tool_calls`, read 2026-10-13;
the page also names the beta base for beta features). Round 1 gated
strict to beta entries and claimed the beta `/models` route exists from
a keyless 401; DS-BETA-MODELS (404 with a real key) refutes the route,
and DS-STRICT plus DS-STRICT-PROD (200 with a correct call on both
addresses) refute the gate. The preset declares strict and it rides on
the address the entry has; whether production enforces strict is
UNVERIFIED.

Person's steps: point a DeepSeek entry at `https://api.deepseek.com/beta`,
attach a tool and send. Observe the turn goes with `strict: true` on
every function.

## GQ-G02 — done

Groq documents `reasoning_effort` (none/default for Qwen, low/medium/high
for GPT-OSS), `reasoning_format` (parsed/raw/hidden, default raw) and
`include_reasoning` (default true, never beside a format), with tool
calling and JSON mode requiring parsed or hidden
(`https://console.groq.com/docs/reasoning`, read 2026-10-12). The preset
sends `reasoning_format: "parsed"` where the record affirms reasoning
(tool calls may ride any turn, so the required presentation is the
default); `reasoning_effort` already rode via the record;
`include_reasoning` keeps its default. GQ-EFFORT, GQ-FORMAT and
GQ-INCLUDE (200 all, thinking in `message.reasoning` for
gpt-oss-120b) VERIFY the send: `reasoning_format` made no visible
difference on this model and is sent because tool calls may ride any
turn; `include_reasoning: false` removes the field while reasoning
tokens are still billed.

Person's steps: add a Groq entry, pick `openai/gpt-oss-120b`, send a turn
with tools. Observe reasoning arrives in its dedicated field and the turn
completes.

## LO-G03 — done

Ollama's `think` takes a switch or a level, levels low/medium/high/max
(`https://github.com/ollama/ollama/blob/main/docs/api.md`, read
2026-10-12). Effort `max` now sends `think: "max"` instead of `"high"`.
UNVERIFIED until LO-OLLAMA-MAX answers.

Person's steps: point an Ollama entry at a served thinking model, set
effort to Max, send a turn. Observe full-depth thinking in the reply.

## LO-G04 / LO-G05 — done

llama.cpp's server documents `reasoning_effort` for every model, routed to
the chat template, with `none` disabling
(`https://github.com/ggml-org/llama.cpp/blob/master/tools/server/README.md`,
read 2026-10-12). The preset sends the body's effort as named
(`reasoning_effort: "none"` disables); `reasoning_format` stays unset
because its value names the loaded model, which the record does not know
— the server auto-detects it from the template. Decoding already read
`reasoning_content` deltas and `<think>` tags. UNVERIFIED until
LO-LLAMA-EFFORT, LO-LLAMA-NONE and LO-LLAMA-FORMAT answer.

Person's steps: point a llama.cpp entry at a served reasoning model, send
one turn at High and one with Thinking off. Observe thinking on the first
and a direct answer on the second.

## MI-G03 — done

Mistral returns `message.content` as a chunk list (thinking plus text)
where `reasoning_effort` is high, and asks for the full message back
including the thinking chunk
(`https://docs.mistral.ai/capabilities/reasoning`, read 2026-10-12). The
chat decoder routes streamed thinking chunks to reasoning and text chunks
to the answer, and replays the trace as a thinking chunk beside the
answer text. MI-CHUNKS VERIFIES the thinking-chunk decode (36 of 40
events with `closed: true`, one without — the loose chunk schema
reads both; top-level `p` padding is stripped, never read);
MI-REPLAY-CHUNKS and MI-REPLAY-PLAIN VERIFY both replay
shapes. The answer-text chunk and the final event are not in the
recording and are not claimed.

Person's steps: add a Mistral entry, pick `mistral-small-latest`, set
effort to High, send a turn, then send a follow-up. Observe the first
reply shows its thinking and the follow-up stays coherent.

## OR-G02 — done

OpenRouter documents per-model `supported_parameters`
(`https://openrouter.ai/docs/api/reference/list-models`, read
2026-10-12); the record already parsed them into `tools.calling`. A model
the record refuses tools now keeps its turn but never its tools, tool
choice or parallelism flag. Reasoning was already gated by declared
levels. OR-PARAMS records the list as counted (459 models, 331 with
`reasoning` in `supported_parameters`); OR-UNSUP shows OpenRouter
answers 200 to the setting on an unlisted model rather than refusing.
The product still sends only what the record declares, and reads the
answer's own `cost` into usage.

Person's steps: add an OpenRouter entry, pick a model the catalogue marks
tool-less, attach a tool and send. Observe a plain answer and no error.

## TO-G01 — done

Together documents hybrid models toggling with `reasoning: {enabled:
false}`, GPT-OSS `reasoning_effort` low/medium/high, and DeepSeek V4 Pro
high/max with server-side normalization
(`https://docs.together.ai/docs/inference/chat/reasoning`, read
2026-10-12). The preset declares the hybrid toggle; effort rides via the
record; MiniMax M3 and Kimi K3 (documented hybrid, catalogue silent) are
record facts. Models the catalogue leaves silent stay silent.
TO-EFFORT (200, thinking in `message.reasoning`) VERIFIES the effort
send for gpt-oss-120b. TO-TOGGLE (403, the account refuses the model)
does NOT verify the hybrid toggle: it stays UNVERIFIED, offered as a
documented switch, never as a fact.

Person's steps: add a Together entry, pick a hybrid model, send one turn
with Thinking off and one at High. Observe a direct answer first and
thinking second. The toggle itself is documented but unverified live
(TO-TOGGLE answered 403): if the off turn still thinks, the account
or the model refused the switch, not the product.

## ZAI-G01 / ZAI-G02 — done

Z.ai documents `thinking: {type: "enabled"/"disabled"}` and, for GLM-5.2,
`reasoning_effort` max/xhigh/high/medium/low/minimal/none
(`https://docs.z.ai/guides/capabilities/thinking`, read 2026-10-12), with
only GLM-5.3 refusing `disabled`. The preset declares the switch; GLM-5.2
is a record fact (full names plus the toggle), so values ride as named
and the provider maps server-side; off sends the switch. ZAI-OFF52
(200, 0 reasoning tokens) VERIFIES the switch; ZAI-XHIGH and
ZAI-MEDIUM (200 both) are accepted as named, their effect UNVERIFIED
under the 200-token cap; ZAI-MINIMAL (200, 196 reasoning tokens)
REFUTES "minimal stops thinking" — Thinking off is the switch, never
an effort name, and the product offers `minimal` as a level that
thinks.

Person's steps: add a Z.ai entry, pick `glm-5.2`, send one turn with
Thinking off and one at Medium. Observe a direct answer first and a
reasoned answer second.

## ZAI-G04 — done

Z.ai documents preserved thinking via `"clear_thinking": false` (kept
verbatim with the returned `reasoning_content` on the next call),
defaulting on for Coding Plan and off for the standard endpoint
(`https://docs.z.ai/guides/capabilities/thinking-mode`, read 2026-10-12).
The preset opts in: turns that replay reasoning send `thinking: {type:
"enabled", clear_thinking: false}` beside the effort. ZAI-CLEAR (200
with the flags) accepts the send; what it changes in a following turn
was not asked and stays UNVERIFIED.

Person's steps: on a Z.ai model, send two turns in a row. Observe the
second turn stays coherent with the first turn's thinking.

## ZAI-G07 — done

Z.ai documents main-turn JSON mode as `response_format: {type:
"json_object"}` (`https://docs.z.ai/guides/capabilities/struct-output`,
read 2026-10-12). The chat codec sends it where the body asks for a JSON
schema and the record affirms `json_object`. ZAI-JSON-NOTHINK (200,
the bare object) VERIFIES JSON mode with thinking off; ZAI-JSON (200,
thinking ate 198 of 200 tokens, content empty) shows thinking on can
starve the answer — the product sends the run's cap unchanged, so the
steps turn Thinking off for JSON answers.

Person's steps: on a Z.ai model, turn Thinking off and ask for a
JSON-shaped answer through the structured-answer flow. Observe a bare
JSON object (ZAI-JSON-NOTHINK). With thinking on the thinking can eat
the whole output cap and the content comes back empty (ZAI-JSON): the
product sends both as asked with the run's cap unchanged, so turn
Thinking off for a JSON-shaped answer.

## META-G05 — done (row shape UNVERIFIED)

Since 1.4.0/1.4.1 each `model/list` row carries the tiers it serves, a
described subset and the default. `MuseCodeHost` reads them through the
supplied `modelEfforts` port (both construction sites supply it now); the
controller posts each model's tiers and default to the panel; the slider
offers the model's own steps and falls back to its default on a switch.
The row shape is UNVERIFIED until META-LIST answers: unknown fields stay
absent and unknown tier names are filtered, never sent.

Person's steps: with Muse Code 1.4.1 or newer, open the model picker and
pick Wonder, then Wonder Full. Observe the effort slider offers each
model's own tiers (including Ultra where served) instead of one fixed
ladder.

## CP-G02 — closed as API-limited, with evidence

The `vscode.lm` API (`@types/vscode` in this tree) offers no reasoning
level, window, or thinking control: `LanguageModelChat` exposes only
identity plus `maxInputTokens`, requests take messages plus tools plus
`modelOptions` (whose Copilot keys are undocumented — sending any would be
a guess), and no thinking part exists. The IDE owns the 1M choice and the
reasoning level in its own picker; this client adapts through
`maxInputTokens`. Credit impact stays estimated under `pricing: "plan"`
with the existing quota/rate-limit/consent notices. UNVERIFIED until
CP-OPTIONS answers; if it names documented keys, the follow-up wires them.

Person's steps: connect Copilot, pick a Copilot model, send a turn.
Observe it completes and usage records an estimated plan row.

## CP-G04 — done in code, test left for its lane

Completed `web_search_call` items no longer fail the turn: like every
other codec (M95 acceptance 11), the Copilot path drops the call and keeps
the turn. Reasoning replay stays off: the API has no thinking part to
replay into. The existing `copilotClient.test.ts` case pinning the throw
(`refuses unsupported search-history instead of dropping it`) still
asserts the old behavior and is left red for its owning lane, named below.

Person's steps: with hosted search in history, switch to a Copilot model
and send. Observe the turn completes instead of failing.

## Round-2 test resolutions (lead review findings 1–3)

- CP-G04's old throw is gone: `copilotClient.test.ts` now pins the drop
  through the real client (a completed `web_search_call` in history
  leaves the turn completing), and `search-history` is out of the
  refusal table.
- META-G05's old `listModels` shape is gone: the stand-in-server case is
  deleted from `museCodeSdk142.test.ts`; the new shape is read through
  the real module in `museCodeEfforts.test.ts` (pure data in, data
  out), with the row shape UNVERIFIED until META-LIST answers.
- The six loopback cases in `configuredProviders.test.ts` were reviewed,
  not deleted: none answers for a provider with hand-written text —
  five replay the recorded m95 Mistral capture (whole, sliced, framed,
  first-frame) and one sends nothing at all (transport timing only).
  They cannot run on this rig (the sandbox refuses loopback `listen`
  with EPERM): NOT RUN HERE, the lead runs them outside the sandbox.
  The DeepSeek request-builder cases beside them assert exact bytes
  through the real modules with recorded answers.

## Round 2 answers (lead's real requests, 2026-10-12 6:38–6:41 PM PT)

Recorded verbatim under `test/fixtures/provider-reasoning/<provider>/<ID>.json`
(byte-identical copies of `~/lanes/_captures/reasonshapes-2026-10-12/`).
Each file carries `status`, `responseHeaders` and `response`; no key.
Verdicts are read from the file itself.

- DS-ULTRA — 200, `reasoning_effort: "ultra"` accepted as named, thinking
  in `message.reasoning_content`. REFUTES the round-1 alias
  (`ultra` → `max`): the name rides as named; the mapping is deleted.
- DS-XHIGH — 200, `reasoning_effort: "xhigh"` accepted as named, thinking
  in `message.reasoning_content`. REFUTES the round-1 alias
  (`xhigh` → `high`): deleted with `ultra`'s.
- DS-STRICT — 200 on the beta address with `strict: true`, one correct
  tool call. DS-STRICT-PROD — 200 on the production address with
  `strict: true`, one correct tool call. REFUTES "production never sees
  strict". Whether production ENFORCES strict cannot be read from these
  two answers (both answered 200 with a correct call either way): the
  product sends `strict` where the record says the model takes it, on
  the address the entry has.
- DS-BETA-MODELS — 404 with a real key. REFUTES "the beta /models route
  exists, verified keyless by its 401": a keyless 401 proves nothing
  about a route. Every claim and code path resting on it is removed.
- GQ-EFFORT — 200, thinking in `message.reasoning` for gpt-oss-120b.
  VERIFIED.
- GQ-FORMAT — 200, thinking in `message.reasoning` with
  `reasoning_format: "parsed"`; no visible difference against GQ-EFFORT
  on this model. VERIFIED for the field's acceptance; the format is sent
  because tool calls may ride any turn and parsed is the presentation
  the docs require beside tools.
- GQ-INCLUDE — 200, `include_reasoning: false` removes the field (98
  reasoning tokens still used). VERIFIED.
- MI-CHUNKS — 200 stream; `delta.content` is an array
  (`[{type:"thinking", thinking:[{type:"text", text}], closed?: true}]`;
  36 of 40 events carry `closed: true`, one does not) and every event
  after the first carries top-level padding key `p`. The recording is
  cut at 12,000 characters before the answer's own text and the stream
  end. VERIFIED for the thinking chunks; the answer-text chunk and the
  final event are NOT in the recording and are not claimed.
- MI-REPLAY-CHUNKS — 200: a prior assistant turn is accepted as the
  chunk list. VERIFIED.
- MI-REPLAY-PLAIN — 200: a prior assistant turn is accepted as a plain
  string; a non-streamed reply's `content` is an array
  (`[{type:"thinking", …, closed:true}, {type:"text", text}]`).
  VERIFIED.
- OR-PARAMS — 200: the list has 459 models, 331 with `reasoning` in
  `supported_parameters`, 128 without. Recorded as the count it is.
- OR-UNSUP — 200: `amazon/nova-micro-v1` (without `reasoning` in its
  list) answers 200 to `reasoning: {effort: "high"}`. OpenRouter does
  not refuse the setting on an unlisted model. That answer's usage
  carries OpenRouter's own `cost`.
- TO-EFFORT — 200, thinking in `message.reasoning` (not
  `reasoning_content`) for gpt-oss-120b at Together. VERIFIED.
- TO-TOGGLE — 403
  `{"error":{"message":"This model requires third-party data sharing to
be enabled for your organization.","code":
"third_party_data_sharing_blocked"}}`. NOT VERIFIED: the account
  refuses this model. The hybrid toggle stays UNVERIFIED, not a fact.
- ZAI-OFF52 — 200, `thinking: {type: "disabled"}` gives 0 reasoning
  tokens and a direct answer. VERIFIED.
- ZAI-MINIMAL — 200 with 196 reasoning tokens for
  `reasoning_effort: "minimal"`. REFUTES "minimal stops thinking" on
  glm-5.2. "Thinking off" on Z.ai is the switch, never an effort name.
- ZAI-XHIGH, ZAI-MEDIUM — 200 both, accepted as named; their effect
  cannot be read under a 200-token cap. Accepted as named; what they
  change stays UNVERIFIED.
- ZAI-CLEAR — 200 with
  `thinking: {clear_thinking: false, type: "enabled"}`. Accepted; what
  it changes in a following turn was not asked: UNVERIFIED.
- ZAI-JSON — 200 with thinking on: 198 of 200 tokens went to thinking,
  content empty. ZAI-JSON-NOTHINK — 200 with thinking off: the bare
  object `{"hi":true}`. JSON mode VERIFIED with thinking off; with
  thinking on it is unverified and can starve the answer. The product
  sends the run's output cap unchanged — thinking and answer share it
  — so for a JSON-shaped answer the person turns Thinking off (the
  ZAI-G07 steps say so).

## Static gates on the final tree

- `npm run typecheck` (host, webview, unit, e2e, integration): clean.
- ESLint and Prettier on changed files: clean (hook-enforced per commit).
- `npm run check:l10n`: clean (`ultra` label in all tables; the
  `effortLevels.ultra` key joins `untranslated.json` where it reads as
  English).
- `npm run check:reference`: clean after `npm run reference:generate`
  (the regen carries only the `ultra` tier additions).
- `npm run deadcode`, `npm run cycles`: clean. `npm run duplication`:
  clean after extracting one test helper (initially flagged the
  duplicated JSON-mode body).
- `npm run build`: clean, no cap change (`dist/modelApi.js` 507.5 KiB
  against the 525 KiB budget).
