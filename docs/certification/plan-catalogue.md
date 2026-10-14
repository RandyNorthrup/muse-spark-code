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
