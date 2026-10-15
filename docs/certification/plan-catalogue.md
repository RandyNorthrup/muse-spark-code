# ChatGPT plan models end to end from the plan's own catalogue (PLANCATALOG)

Worktree `/home/randy/lanes/PLANCATALOG`, branch `fix/plan-catalogue`,
base `152294092` (the grant lock without a port, the OpenAI-accepted host
id, the Windows record-size fix).

## The measured case

On the lead's Windows host, 2026-10-14, through our own app with the
owner's ChatGPT Pro sign-in: sign-in worked ("Added provider chatgpt."),
then every model turn on the plan route failed. `POST
https://api.openai.com/v1/responses` answered HTTP 400, four times per
turn: `{"error":{"message":"Missing required parameter:
'tools[0].description'.",...}}`. The same request sent
`"reasoning":{"effort":"none","summary":"auto"}` for `gpt-6.1-sol`; the
editor protocol offered no effort level (`{"id":"effort",
"currentValue":"high","options":[]}`, setting `xhigh` answered "Invalid
params: xhigh"); there was no Fast switch; and the turn failed as
"ChatGPT is temporarily unavailable. Try again.", retrying the 400.

PLANROUTE (`10abcb49c`) was not available on this rig (no remote, no
object: `unknown revision`), so its refusal sentences and limit headers
were not merged; its fixed model table is replaced by the catalogue
below. The lead should confirm the refused/limited wording still wanted.

## What the catalogue carries (value-blind capture, 2026-10-14)

`GET /v1/models` with the plan token: `{models: [...10 entries...]}`.
Entry fields include `slug`, `visibility`, `supported_in_api`,
`context_window`, `supported_reasoning_levels[].effort`,
`default_reasoning_level`, `supports_reasoning_summary_parameter`,
`service_tiers[].{id,name,description}`, `default_service_tier`,
`multi_agent_reasoning_effort`. gpt-6.1-sol verbatim: default `low`;
levels `low, medium, high, xhigh, max` plus `ultra` ("Maximum reasoning
with automatic task delegation"); `service_tiers: [{id: 'priority', name:
'Fast', description: '2x speed, increased usage'}]`;
`default_reasoning_summary: 'none'`.

## What changed (one commit per item)

- Item 1, `d928f3b4c`: the namespace tool carries a description on the
  ChatGPT profile; the type requires it for that profile
  (`ResponsesCodecQuirks.toolNamespaceDescription`), so omitting it
  fails typecheck (red drill: `TS2345 ... required in type ...`,
  restored byte-exact). Sentence (plain constant, not a MODEL_TEXT key,
  so the split gate stays green): "Tools of the Muse Spark Code agent in
  this workspace."
- Item 2, `98096f46d`: `chatGptPlanFacts.ts` parses the entry (zod
  looseObject, unknown fields ignored) into the capability record and
  policy (`planFacts` evidence). `effortForPolicy` resolves from the
  facts: a listed level rides as named (`xhigh` stays `xhigh`), never
  `none` to an unlisted model; `ultra` maps the Codex way
  (`multi_agent_reasoning_effort` where listed, else `max`, else highest
  listed) but is never offered in pickers — the app cannot represent
  delegation honestly, so pickers list the catalogue order filtered to
  the app's own effort vocabulary.
- Item 3, `d79212f75`: `ModelSummary`/`protocol` carry
  `effortLevels/defaultEffort/fastTier`; the ACP effort option, the
  panel slider and `exec --effort` offer the model's levels; the
  selected default is the catalogue's (`low` for gpt-6.1-sol).
- Item 4, `1fdca23d2`: Fast switch (`service_tier: 'priority'`) where
  listed: ACP `fast` option, panel switch, `AgentSession.setServiceTier`
  (plan only), `exec --fast`. OFF by default with the cost in the
  description ("Off by default: it uses more of your plan allowance");
  reset on model change, never persisted across resume.
- Item 5, `42f937f4e` + `c67e1d0bf`: a non-OK plan answer reports
  OpenAI's `error.message` (`planUi.requestFailed`, all 15 languages);
  the client sends once and a 4xx other than 429 is never retried
  (shared tables already exclude 400; asserted). `c67e1d0bf` is the
  packed proof's catch: `planRequestError` built the sentence but the
  stream's catch remapped every plain Error to the retry text — a
  `ChatgptPlanRequestError` now carries it through (see Proof).
- Bundle split, `a7bbc7c72`: the send-path facts type and resolution
  moved to `src/core/backends/modelapi/planFacts.ts` (LAZY_ONLY); the
  entry parse stays with the subscription client (SUBSCRIPTION_ONLY).
  Both classifications are the checker's designed "new file needs a
  decision" step, not an ignore. Build exits 0 with no split problems.
- Reference (committed with this record): `reference:generate` adds
  the `exec --fast` CLI row (245 CLI, was 244) with its one-line reason
  here.

## Codex CLI references (public source, read-only, $TMPDIR clone, removed)

- `codex-rs/protocol/src/openai_models/reasoning_effort.rs`: effort
  rides verbatim from the model list.
- `codex-rs/.../client.rs` (`cx-openai-models.rs`, `cx-reasoning-effort.rs`
  in the clone): raw function tools, `service_tier: "priority"` for
  Fast, summary omitted where unsupported. Ours keeps the namespace
  tool (plus its new description) and existing shapes otherwise.

## Proof: packed agent against a local replay server

`npm run build` (exit 0), then `dist/acp.js` over the editor protocol
with the outside world as a loopback replay of the two captures
(catalogue entry, 400 body). Harness (scratch, `$TMPDIR/planproof/`:
`replay.mjs`, `preload.cjs`, `drive.cjs`, `run.sh`, staged providers
file + homes): a fetch preload routes `api.openai.com` to the replay
and a hooked `@napi-rs/keyring` answers test-owned secrets — no product
module stubbed. The agent needed `TMPDIR=/dev/shm/pp`: this lane's
$TMPDIR exceeds the 108-byte Unix-socket path limit and the grant lock
bind failed `EINVAL` there (probed; not a sandbox denial).

Recorded outputs (final run, after `c67e1d0bf`):

- `model-options: ["chatgpt/gpt-6.1-sol"]`
- `effort-options: ["low","medium","high","xhigh","max"]` (ultra excluded)
- `effort-default: "low"` (the catalogue's)
- `fast-option: {"currentValue":false,"description":"2x speed, increased
usage. Off by default: it uses more of your plan allowance."}`
- `set-effort-xhigh: ok` (was "Invalid params: xhigh")
- `set-fast-true: ok`
- Saved POST body: `"reasoning":{"effort":"xhigh"}`,
  `"service_tier":"priority"`, `tools[0]` =
  `{"type":"namespace","name":"functions","description":"Tools of the
Muse Spark Code agent in this workspace.",...}`
- Replay log: `GET /v1/models` once, `POST /v1/responses` exactly once
  (no retry)
- Turn error: "The ChatGPT plan request failed: Missing required
  parameter: 'tools[0].description'." — OpenAI's message, once.

The first packed run instead printed the standing retry sentence: the
item-5 catch bug above, found by this proof and now covered by a
real-client replay test (`chatgptPlanErrors`: one error event, one
POST). Red drill for item 1 in its commit; every other new gate or test
was seen to fail (split problems 12→0, deadcode `ChatGptCatalogEntry`
removed, duplication clone reworded, stale reference regenerated).

## Gates on the final tree (exit codes)

- Changed suites, repo default timeout, ≤3 files/run: plan
  (16 passed), codec+policy (52), UI (212), `execStdio.e2e` (46) — exit 0.
- `npm run typecheck` — exit 0. ESLint on lane files — exit 0.
  Prettier on lane files — clean.
- `npm run check:l10n` — 0 problems, exit 0. `npm run check:reference`
  — current (245 CLI), exit 0. `npm run check:host-api` — 0 problems,
  exit 0. `npm run deadcode` — exit 0. `npm run cycles` — exit 0.
- `npm run duplication` — 0 clones, exit 0. `npm run build` — exit 0,
  `tokens: 0 problems`, no split problems. `npm run security:audit` —
  exit 0 (2 advisories, 1 exception file).

## Live on Windows (the real sign-in is there)

`providers add chatgpt`, pick `chatgpt/gpt-6.1-sol`, confirm the effort
slider lists low..max with low selected and the Fast switch off; run a
turn at xhigh with Fast on (billing: plan allowance); force a refusal
(expire the grant / revoke) and confirm OpenAI's sentence. Two pictures
(one light, one dark theme) go here per the token rule; none taken on
this rig.

## APP PROBLEMS

None: every tool behaved as documented. (Two self-inflicted detours,
not app faults: the `muse.search` tool returned empty for present
patterns mid-lane, so scoped `grep` covered it; and the ACP
`session/set_config_option` for a boolean needs `type: "boolean"` on
the wire, which the SDK schema requires and the driver first omitted.)

## Lead, Windows, 2026-10-14 3:0x PM: the facts did not reach the pickers on a real computer

Live on Windows (this branch built here, the owner's real ChatGPT sign-in, no Meta key stored), the editor protocol still answered `{"id":"effort","currentValue":"high","options":[]}` for `chatgpt/gpt-6.1-sol` and refused `xhigh`, and the same for `anthropic-s2/claude-sonnet-5-5` (finding F79). Three causes, read in the code and fixed:

1. `createConfiguredProviderClient` (src/core/providers/configured.ts) wraps the plan client but did not forward `planModelFacts`, so `ModelApiHost.listModels` never received a plan model's facts. It now forwards it and the new `listPlanModels`.
2. `ModelApiHost.listModels` listed nothing from the plan client when no Meta key is stored. It now lists the signed-in plans' models (`ProviderClient.listPlanModels`, no Meta request) and lists a plan model once (its summary with the facts wins over its configured entry).
3. `createProviderRegistry().list()` (src/core/providers/providerRegistry.ts) dropped the effort levels its own policy holds, so every configured provider's model offered none. It now lists them (levels the app represents).

Proof on the packed agent (`dist/acp.js`, built on Windows), through our app's editor protocol, one short turn each: `chatgpt/gpt-6.1-sol` offers low, medium, high, xhigh, max; `xhigh` set and read back; the turn completed. `anthropic-s2/claude-sonnet-5-5` offers the same five; `xhigh` set and read back; the turn completed. New `test/unit/providerRegistryEffort.test.ts` 3/3 (2 of 3 fail with the registry change reverted). Gates: `typecheck:host` 0, `typecheck:unit` 0, ESLint 0 and Prettier on the changed files, `build` 0, `deadcode` 0, `cycles` 0, `duplication` 0, `check:host-api` 0, `check:reference` 0.

## PLANFIX R3: Fast is never sent while the panel shows it off (2026-10-14, Windows)

The review's finding: `updateFast(false)` returned before clearing the
backend's tier when the new model listed none, and `setModel` never cleared it,
so A (Fast on), B, A sent `priority` with the switch off; `attach` also
re-applied a `true` flag left from an earlier conversation.

Fix, three places:

- `ModelApiHost.setModel` (`src/core/backends/modelapi/ModelApiHost.ts`): the
  session drops its tier at the accepted model-change boundary, whoever set it.
- `updateFast` (`conversationController.ts`): off is always sent to the session,
  whatever the model lists; on only where the model lists a tier. The panel is
  told only when the switch changed, so no extra `composerState` is posted.
- `setModel` and `attach` (the one place new, resumed, forked and imported
  sessions all pass): both send Fast off.

Test, `test/unit/chatgptFastTier.test.ts` (3 cases): the REAL
`ConversationController`, `ModelApiHost`, subscription client and Responses codec
over a real temporary workspace and the real tool and context I/O. Only the
outside world is replaced: the provider's two endpoints (the captured
`gpt-6.1-sol` catalogue entry, and a copy of it without a Fast tier, as data;
a streamed text reply) and the editor-side ports the panel is built on, which
refuse when reached. The grant is a throwaway in-memory record; no sign-in, no
stored grant, no provider call. Cases: A (Fast on) then B then A carries no
`service_tier` while the same harness sees `priority` while Fast is on; a new
conversation after Fast on carries none; the session alone, with no panel,
drops a tier set before two model changes.

Red drills (each reverted byte-exact; SHA-256 of the fixed files compared):

- host reset removed: the host-level case fails (`not to have property
"service_tier"`), exit 1;
- controller `updateFast` returning early for a model without a tier, and the
  `setModel` call guarded by `this.fast`: the A-B-A case fails on request 3,
  exit 1;
- `attach` re-applying `if (this.fast) updateFast(true)`: the new-conversation
  case fails (`expected true to be false`), exit 1.
  Fixed-file hashes: `ModelApiHost.ts` `2D2FAC8C…1599` and
  `conversationController.ts` (final) restored equal after each drill.

Surfaces checked: the VS Code panel (fixed, tested above); the ACP agent
(`src/acp/agent.ts` 1575-1616) already sends off at its own model option, and
the host now drops the tier at every model change, so a model switch through
it is covered; `exec --fast` (`runExec.ts` 952-970) sets the model first and
Fast after it, once, and never switches models afterwards. NOT CHANGED, NOT
PROVEN EITHER WAY: `matchAdvertised` (`src/acp/agent.ts` 1539-1553) for a loaded
or resumed ACP session does not send "off" to the host. I did not show that a
live host session can reach it with a tier already set (the tier is set only by
that agent's own `fast` option and by exec), and a test of it would need a
stand-in for the agent's session, which the owner's rules forbid; the lead
decides whether the one-line `setServiceTier(undefined)` there is wanted.

Controller suite, measured on the untouched HEAD sources and on this tree in the
same conditions: `conversationController.test.ts` fails 15 of 688 on both, the
same 15 names; no case differs. A first version of this change posted an extra
`composerState` and failed three more cases; that was removed, not the cases.

## PLANFIX R8: exec reads effort and Fast from the selected model's options (2026-10-14, Windows)

`runExec` (`src/runtime/exec/runExec.ts`) took the `effort` and `fast` options
from the `session/new` answer even after `--model` changed the model, so `--effort`
was checked against the START model's levels. The agent's `session/set_config_option`
answer already carries the options for the new model (`agent.ts` 2635-2639); `runExec`
now keeps it (`configOptions`) and reads `effort` and `fast` from it.

Measured on the real `runExec` (the exec suite's own harness, scratch probe, deleted),
start model `muse-spark-1.3` (serves `max`), selected `muse-spark-1.2` (does not):
HEAD `--model muse-spark-1.2 --effort max` ended as an incomplete turn, exit 8,
no usage error; with the fix exit 2 and "This effort is not available for this
model.", before any request. `--effort xhigh` on 1.2 and `--effort max` on 1.3
are unchanged (exit 5 in that harness, both before and after). The opposite
direction (a Fast option only the selected model lists) shares the same read.

Test `test/unit/execModelOptions.test.ts` (2 cases): the real `runExec` over the
real Model API bundle, ACP agent and command-line parser; the stand-ins are the
provider's model list (a fetch answering `GET /models`, failing any other path)
and a map holding a throwaway key. Red: against the untouched `runExec.ts` the
first case fails (`expected 8 to be 2`); restored byte-exact (SHA-256
`5AFADE00…DBB`), 2/2. Dependents: `execRun` 94/94, `execProvider` 17/17,
`execResources` 6/6, `execVault` 25/25.

Not run: `exec --fast` against a model that lists Fast needs a plan model and a
sign-in; a person's steps are in the lead's list at the end of this lane.

## PLANFIX R9: a fresh plan model or session starts on the catalogue default (2026-10-14, Windows)

The panel started every conversation on the standing default (`high`) and kept it
across a switch to a model that also serves `high`, so `gpt-6.1-sol` (catalogue
default `low`) ran at `high` unless the person moved the slider. The controller now
remembers whether the person moved the slider (`isEffortChosen`, set by `setEffort`
only). While it is not set, the panel starts on the model's catalogue default where
the model lists one and serves it: when the model list arrives with no session
(`listModels`, the panel's warm-up), at `attach` (new, resumed, forked and
imported sessions), and at a model switch. A level the person chose is kept across
a new conversation and a model switch, as before (`setModel` still drops one the
new model does not serve).

Test, `test/unit/chatgptFastTier.test.ts` (3 more cases, the same real
controller/host/client/codec harness; the panel is opened through
`surfaceReady`): a fresh conversation shows `low` and the first request carries
`reasoning.effort: low`; a chosen `xhigh` survives a new conversation and a switch
to the second model, on the wire and in the panel; an unchosen switch moves to the
new model's default. Red drills, each restored byte-exact (SHA-256
`90F8E1A8…FC7E`): no catalogue default offered, 2 of 6 fail; a choice not
remembered, 1 of 6 fails. `conversationController.test.ts`: 15 of 688 fail on the
untouched sources and on this tree, the same 15 names.

Surfaces checked:

- VS Code panel: fixed and tested above.
- ACP new session (`agent.ts` 2472-2475): already `defaultEffortFor`, the
  catalogue default, then `applyEffort`. Unchanged.
- `exec` (`runExec.ts`): reads the ACP session's option; with no `--effort` it
  runs at what the new session shows, which is the catalogue default. After R8 it
  reads the selected model's options. Unchanged.
- ACP model switch (`agent.ts` 1605-1617): `applyEffort(this.effort)` keeps the
  shown level when the new model serves it, so a switch from a model at `high` to
  a plan model keeps `high`. NOT CHANGED: it needs the same chosen/unchosen
  memory in `AcpSession`, a class that is not exported, and a test of it needs a
  plan model behind the real agent (a signed-in grant or a stand-in for the agent's
  session). Left to the lead; the change is a copy of the panel's rule.
- Muse Code (CLI) models: no catalogue default exists (`defaultEffort` is set by
  plan facts only), so `unchosenEffort` answers undefined and today's rule
  (`high`, or the highest tier served) is unchanged.

## RVHOSTID: output-index boundary review (2026-10-14, Windows)

The F87 accumulator accepted duplicate, negative, fractional and unsafe indices;
its missing-index fallback could collide with an explicit index. Repeating the
same indexed `function_call` retained it twice for terminal adoption and replay.
The ChatGPT profile now requires a nonnegative safe integer and refuses a repeated
index before keeping the item. Repeated item IDs or function-call IDs at distinct indices are refused too:
that additional regression failed on the indexed fix, then passed with identity
validation. Removing that identity guard deliberately makes both cases fail
(exit 1); restored codec 25/25 (exit 0), byte-exact SHA-256
`7BABA2C334292A46B1462DBFFA6FAAB453B1E5A7D3316EE6AE18D11B4F183EA8`.
Receipts: `.lane/identity-drill.log`, `.lane/identity-restored.log`.
The API-key profile is unchanged. The directly affected codec + host-id + pure
plan-error selection passed 41/41 before the additional distinct-item-ID case.

Removed four stand-in cases under the owner's rule: one from
`chatgptPlanErrors.test.ts` replaced our grant host, store and Meta client; three
parameterized cases from `chatgptResponsesCap.test.ts` replaced the client's
stream and tool I/O. Pure capture/retry and codec-cap assertions remain. This
does not claim the removed product behavior has been re-proven by a stand-in.

Real codec tests: baseline 40/40 across codec, host-id and facts; five added
boundary cases fail on the reviewed codec (exit 1), then codec + cap + API codec
pass 97/97 (exit 0). Deliberately removing duplicate rejection then fails its
named assertion (exit 1); restored codec 23/23 (exit 0), SHA-256
`682A550077A1D72A491612B25323C718956AC08BBC4D941C68930E7407E6F4C2`
identical before/after. Logs: `.lane/f87-red.log`, `.lane/f87-green.log`,
`.lane/f87-drill.log`, `.lane/f87-restored.log`. The new boundary cases use no
provider, store, CLI or editor stand-in and make no provider request. Earlier
aggregate runs included the four subsequently removed stand-in cases and are
not product proof. Final codec/API/cap selection after removal: 96/96 (exit 0),
`.lane/final-codecs-no-fakes.log`. Generic error/failed frames
already stop the main host; incomplete frames pair refused tool results rather
than executing tools (`ModelApiHost.ts` applyStreamEvent/adoptOutput). This review
does not claim that accepting a later frame in the codec alone executes it.

## Lead, Windows, 2026-10-14 4:2x PM (committed 4:29 PM): plan models used no tool (finding F87)

A Codex review through our app on `chatgpt/gpt-6.1-sol` (xhigh) ran 11 turns of 3-13 s with 0 tool calls: each reply only said what it would check. Measured with a value-blind preload on one tool-needing turn ("What is the secret word in probe-note.txt?"): the request offered the `functions` namespace with 11 tools; the stream carried `response.output_item.done` with a `function_call` named `read_file`, and the terminal `response.completed` frame carried `output: []` (0 items). `ModelApiHost.adoptOutput` takes calls and replay from the terminal frame's output, so the call was dropped and the turn ended.

Fix, one place: the Responses codec's ChatGPT profile (`src/core/backends/modelapi/codecs/responses.ts`) keeps each streamed `output_item.done` item by its output index, and a terminal frame's output is those items in order (Codex reads its items from the same frames). A terminal frame that lists items itself must list the same number, or the stream is refused rather than one of the two trusted. The output cap still judges the frame as it arrived, before the output is rebuilt, so an over-cap reply keeps nothing.

Proof: `test/unit/chatgptResponsesCodec.test.ts` gains the measured frame shapes (a streamed call and message with `output: []`, and a count mismatch); red drill with the codec change reverted: 2 of 18 fail; restored: 18/18, and the codec suites together 92/92 (`chatgptResponsesCap` included). Live on the packed agent through our app's editor protocol: the same turn now called `read_file`, sent a second request, and answered "lantern" (end_turn, 2 plan requests). Gates: `typecheck` 0, ESLint 0 and Prettier on the changed files, `build` 0.
