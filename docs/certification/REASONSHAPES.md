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

## DS-G01 — done

DeepSeek's thinking-mode table maps minimal/low, medium/high, xhigh/high,
ultra/max (`https://api-docs.deepseek.com/guides/thinking_mode`, read
2026-10-12). The preset carries that table as `effortAliases`; `ultra`
rides as `reasoning_effort: "max"` instead of refusing. UNVERIFIED until
DS-ULTRA and DS-XHIGH answer.

Person's steps: add a DeepSeek entry, pick a DeepSeek model, set effort to
Max, send a turn. Observe the turn goes with `reasoning_effort: "max"`.

## DS-G02 — not started (capture requested)

Strict tool schemas need the beta base (`https://api.deepseek.com/beta`)
plus `strict: true` on every function
(`https://api-docs.deepseek.com/guides/tool_calls`, read 2026-10-12).
Wiring a beta base needs the beta `/models` shape and the production
base's answer to `strict: true`; both are capture requests now
(DS-BETA-MODELS, DS-STRICT-PROD, DS-STRICT). No preset offers strict until
those land, so nothing is sent.

## GQ-G02 — done

Groq documents `reasoning_effort` (none/default for Qwen, low/medium/high
for GPT-OSS), `reasoning_format` (parsed/raw/hidden, default raw) and
`include_reasoning` (default true, never beside a format), with tool
calling and JSON mode requiring parsed or hidden
(`https://console.groq.com/docs/reasoning`, read 2026-10-12). The preset
sends `reasoning_format: "parsed"` where the record affirms reasoning
(tool calls may ride any turn, so the required presentation is the
default); `reasoning_effort` already rode via the record;
`include_reasoning` keeps its default. UNVERIFIED until GQ-EFFORT,
GQ-FORMAT and GQ-INCLUDE answer.

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
answer text. UNVERIFIED until MI-CHUNKS and MI-REPLAY answer; the exact
fragment shapes rest on the docs prose, not a capture.

Person's steps: add a Mistral entry, pick `mistral-small-latest`, set
effort to High, send a turn, then send a follow-up. Observe the first
reply shows its thinking and the follow-up stays coherent.

## OR-G02 — done

OpenRouter documents per-model `supported_parameters`
(`https://openrouter.ai/docs/api/reference/list-models`, read
2026-10-12); the record already parsed them into `tools.calling`. A model
the record refuses tools now keeps its turn but never its tools, tool
choice or parallelism flag. Reasoning was already gated by declared
levels. UNVERIFIED until OR-PARAMS and OR-UNSUP answer.

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
UNVERIFIED until TO-EFFORT and TO-TOGGLE answer.

Person's steps: add a Together entry, pick a hybrid model, send one turn
with Thinking off and one at High. Observe a direct answer first and
thinking second.

## ZAI-G01 / ZAI-G02 — done

Z.ai documents `thinking: {type: "enabled"/"disabled"}` and, for GLM-5.2,
`reasoning_effort` max/xhigh/high/medium/low/minimal/none
(`https://docs.z.ai/guides/capabilities/thinking`, read 2026-10-12), with
only GLM-5.3 refusing `disabled`. The preset declares the switch; GLM-5.2
is a record fact (full names plus the toggle), so values ride as named
and the provider maps server-side; off sends the switch. UNVERIFIED until
ZAI-OFF52, ZAI-XHIGH, ZAI-MINIMAL and ZAI-MEDIUM answer.

Person's steps: add a Z.ai entry, pick `glm-5.2`, send one turn with
Thinking off and one at Medium. Observe a direct answer first and a
reasoned answer second.

## ZAI-G04 — done

Z.ai documents preserved thinking via `"clear_thinking": false` (kept
verbatim with the returned `reasoning_content` on the next call),
defaulting on for Coding Plan and off for the standard endpoint
(`https://docs.z.ai/guides/capabilities/thinking-mode`, read 2026-10-12).
The preset opts in: turns that replay reasoning send `thinking: {type:
"enabled", clear_thinking: false}` beside the effort. UNVERIFIED until
ZAI-CLEAR answers.

Person's steps: on a Z.ai model, send two turns in a row. Observe the
second turn stays coherent with the first turn's thinking.

## ZAI-G07 — done

Z.ai documents main-turn JSON mode as `response_format: {type:
"json_object"}` (`https://docs.z.ai/guides/capabilities/struct-output`,
read 2026-10-12). The chat codec sends it where the body asks for a JSON
schema and the record affirms `json_object`. UNVERIFIED until ZAI-JSON
answers.

Person's steps: on a Z.ai model, ask for a JSON-shaped answer through the
structured-answer flow. Observe a bare JSON object.

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

## Left red on purpose (owning lanes, named)

- `test/unit/copilotClient.test.ts` › refuses unsupported search-history
  instead of dropping it — pins CP-G04's old throw.
- `test/unit/museCodeSdk142.test.ts` › carries the effort reader's
  complete ordered variants — pins the old `listModels` shape without
  `effortLevels`/`defaultEffort`.
- `test/unit/configuredProviders.test.ts` loopback/stream cases fail here
  with `listen EPERM` (this rig's sandbox blocks loopback sockets); the
  lead runs them outside the sandbox.

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
