# CMPRESETS — plan keys, two cloud presets, Azure deployment (C-M95b-4, C-M95c-5, C-M95-5)

Worktree `/home/randy/lanes/CMPRESETS`, branch `c/m95-presets`, base
`aa1efb22e`, kubuntu rig, 2026-10-11. One lane for the three preset scopes
because they share `presets.ts`. No live or paid model call was made; the
only network use was reading four public documentation pages (below). No
push, merge or rebase. Commit `8954df269` holds the code; this file is
committed separately.

All four new presets are defined but **unlisted** (`wireCapture: false`)
until the lead records their captures (rule 13). Nothing user-visible
changes today, so there is deliberately no CHANGELOG entry and no README or
Help-row change (owner order 2026-10-10: incomplete work stays hidden, no
"preview" wording). The catalogue (`vendor/models-dev/snapshot.json`)
lists only the 13 already-built providers, so C-M95c-5's "catalogue
providers" part adds nothing today.

## C-M95b-4: MiniMax M Plan and Alibaba Coding Plan keys

- `MINIMAX_PLAN_PRESET` / `ALIBABA_PLAN_PRESET` in `PLAN_KEY_PRESETS`:
  `chat` format, Bearer, `pricing: { kind: 'plan' }`, limits links
  `https://platform.minimax.io/console/usage` and
  `https://www.alibabacloud.com/help/en/model-studio/coding-plan-faq`.
  Origins `https://api.minimax.io` and
  `https://coding-intl.dashscope.aliyuncs.com/v1`, key pages and shapes as
  documented below. Quirks stay at the `chat` defaults until a capture says
  otherwise; nothing is guessed into them.
- `listedPlanKeyPresets()` (mirrors `listedPresets()`); `panelSeam.ts`
  builds the panel catalog from it, so uncaptured plan keys never surface.
  Pricing, tally and zero-dollar settlement already flow through
  `configured.ts` (`planKeyPresetById` → `'plan'`, `recordPlanUsage`,
  zero-dollar reserve/settle per the M95R3 model-policy test).
- Acceptance 9 status: the label/limits-link/tally/no-dollar-charge path is
  implemented and unit-tested; the visible "plan" mark needs the lead's
  capture to list the preset.

## C-M95c-5: Moonshot and Ollama Cloud presets

- `MOONSHOT_PRESET`: `https://api.moonshot.ai`, Bearer, key page
  `https://platform.kimi.ai/console/api-keys`, `/v1/models` list.
- `OLLAMA_CLOUD_PRESET`: `https://ollama.com`, Bearer, key page
  `https://ollama.com/settings/keys`, `/v1/models` list (provisional until
  capture). Key shapes are `any`/16 where the docs state no prefix.
- Both `chat`, both uncaptured and unlisted. PRESETS grows 18 → 20.

## C-M95-5: Azure deployment turn and invalid-deployment refusal

- `AZURE_PRESET.modelsList.path` is now `/models`: the address already ends
  in `/openai/v1`, so the old `/openai/v1/models` composed a doubled path.
- `responsesTurnPath(preset)`: `/responses` for `azure-resource`,
  `/v1/responses` otherwise; `configured.ts` encodes through it, so a
  deployment turn posts to `{resource}.openai.azure.com/openai/v1/responses`
  with the deployment as the request's model (research §1.2).
- `azureDeploymentRefusal(status)`: an Azure 404 refuses with the new
  `azureDeploymentInvalid` string; anything else stays generic. A 404 is in
  no retry table, so the refusal is never retried.
- Azure stays unlisted (`wireCapture: false`); `docs/certification/m95-captures.md`
  already notes it needs the owner's resource and deployment.

## Endpoint evidence (public docs read 2026-10-11, no key, no call)

- Ollama Cloud: `https://docs.ollama.com/api/authentication` — direct cloud
  inference at `https://ollama.com/api` and `https://ollama.com/v1`,
  `Authorization: Bearer`, keys at `https://ollama.com/settings/keys`.
- Moonshot: `https://platform.kimi.ai/docs/api` (redirected from
  `platform.moonshot.ai`) — OpenAI Chat Completions base
  `https://api.moonshot.ai/v1`, Bearer `$MOONSHOT_API_KEY`, keys in the
  Kimi Open Platform console, `/v1/models` list.
- Alibaba Coding Plan: `https://www.alibabacloud.com/help/en/model-studio/more-tools`
  — OpenAI base `https://coding-intl.dashscope.aliyuncs.com/v1`, dedicated
  key at `https://modelstudio.console.alibabacloud.com/ap-southeast-1/subscription/coding-plan`,
  6,000 requests per 5 hours, no token view.
- MiniMax M Plan: `https://platform.minimax.io/docs/m-plan/faq` — the
  Subscription Key works in third-party tools, 5-hour and weekly windows,
  usage at `https://platform.minimax.io/console/usage`; OpenAI base
  `https://api.minimax.io/v1` corroborated by several independent
  third-party provider tables (capture must confirm before listing).

## Tests (all at the repository timeout, kubuntu)

- `test/unit/providersPresets.test.ts` (20): count 20, Moonshot/Ollama
  Cloud data, Azure turn path + 404 refusal, unlisted set.
- `test/unit/planKeyPresets.test.ts` (4): MiniMax/Alibaba data, limits
  links, plan pricing shape, `listedPlanKeyPresets() === ['mistral-plan']`,
  prohibited sign-ins still absent.
- `test/unit/providerPanelSeam.test.ts` (9): the seam catalog hides
  `azure`, `moonshot`, `ollama-cloud`, `minimax-plan`, `alibaba-plan` and
  keeps `mistral-plan` as `subscription`.
- `node scripts/check-l10n.mjs`: 0 problems (5 new keys × 14 tables).

## Red drills (each broke the guard, saw red, restored byte-exact)

Base `src/core/providers/presets.ts`
`5f1df0049c4715112ecbc24909753715dfb8988e011e02b86e4add23980c8531`:

- Drop `MOONSHOT_PRESET` from `PRESETS` → providersPresets 2 failed,
  restored to the SHA above.
- Flip Azure `wireCapture` to true → providerPanelSeam catalog test
  failed, restored to the SHA above.
- Flip `minimax-plan` `wireCapture` to true → planKeyPresets 2 failed,
  restored to the SHA above.
- Return `/v1/responses` for Azure in `responsesTurnPath` → providersPresets
  Azure path test failed, restored to the SHA above.

`l10n/ui.de.json`
`a334311acb5a3203caac8727a7f548ce3ff65d4f089c995d3f7254d58a8d40d1`:
delete `azureDeploymentInvalid` → `check-l10n` reports 1 problem,
restored to the SHA above (green run: 0 problems).

## Blocked: the lead's live checks (owner keys, a few cents at most)

Each preset lists only after its own capture (rule 13). For each of
MiniMax M Plan, Alibaba Coding Plan, Moonshot, Ollama Cloud and Azure
(a resource + deployment the owner provides): one short tool-call turn on
its cheapest tool-capable model, the models list, a streamed tool call and
follow-up, usage, an invalid-model error, and the cache pair where the
provider caches — recorded under `docs/certification/m95-captures/<id>/`
with counted attempts, then flip that preset's `wireCapture` to true.
Azure's turn also re-verifies the `/openai/v1/responses` composition and
the 404 refusal against a real `DeploymentNotFound`.
