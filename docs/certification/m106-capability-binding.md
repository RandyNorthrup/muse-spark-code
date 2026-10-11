# M106 production capability binding — C-M106-2 (kubuntu, 2026-10-10)

Lane branch `c/m106-2` from `358bee7aa`; R2 repairs the RVCM1062 findings
(P1/P2/P3, all four). No paid or live model call, no
credential read, no network call beyond `npm` tooling. No cap, gate level,
ignore or timeout was weakened; all tests ran at the repository timeout
(no `--testTimeout`).

R3 (same lane, same day) repairs every finding of review RVCM1062B (two
P1, two P2, one P3 — no residuals) and closes the lead-held external
blocker with the lead's 2026-10-10 20:13 UTC live run (2 GETs + 4
contributor POSTs; receipts scrubbed, gitleaks clean over the receipt
directory before copying). Same probe rules: no paid or live model call
from this lane (the collector was not run here — no key on rigs), no
credential read, repository timeouts throughout.

## Scope

`argumentPreviewCapabilities` was forwarded by
`modelApiBackendManager.ts` but supplied by no caller, and the selected
`output.maxTokens` fell back to the legacy 32,768-token request cap. This
lane binds both from the SELECTED model record in the Model API bundle
entry (`src/host/backend/modelApiEntry.ts`), which every host loads:

- Cap: the entry stashes each resolved selected-record policy in its
  `models.resolve` wrapper (the host resolves the selected model at session
  start and on every switch) and the default `modelOutputMaxTokens`
  supplier reads the stash first. Bare Meta models never reach the
  resolver, so they fall through to `metaOutputMaxTokens`, which now
  delegates to M95's own `modelPolicyFor` (the documented 131,072-token
  maximum for VS Code and interactive ACP, the same record the host's clamp reads). Headless exec binds its own resolved ceiling of at most 32,768 to preserve its worst-case reservation. No lane code names a
  model id; an unresolved model fails closed to the legacy cap.
- Preview: `metaArgumentPreviewCapabilities` stays gated on the U9-captured
  `muse-spark-1.3-contributor` model. Evidence is the counted 2026-10-05
  capture (`test/fixtures/m106/u9-strict-stream.json`): two
  `response.function_call_arguments.delta` frames then `.done`. A grep over
  `src/` proves no other streaming-argument record exists in-tree for any
  model (bare or qualified), so every other model stays preview-free with
  reason "no capture" rather than guessing from M95's preset. Rendering
  undeclared model bytes stays denied by the preview grammar (declared
  fields only), pinned on the captured wire.
- Both production manager callers now supply the M95 registry resolver:
  `src/extension.ts` builds it from the configured provider services over
  the existing `dist/configuredProviders.js` split chunk (lazy import, no
  new block, presence-only key check through the secret store), and
  `src/runtime/backends.ts` reuses the provider run's registry where a
  provider run exists (unchanged errors elsewhere). A caller-supplied
  preview/cap dep still takes precedence (`??` in the entry).
- R3 CORRECTION (RVCM1062B): the paragraph above is superseded — neither
  caller supplies a registry any more. Review found the standalone
  registries bypassed runtime accounting, rejected subscription models and
  lost plan usage, and left interactive ACP's cap unbound, so R3 removed
  both suppliers: the entry binds the selected record through the session
  client's own resolver (accounting-wrapped headless,
  subscription-aware extension/ACP), with the standalone registry kept only
  as a fallback for a client without one. See the R3 record below.

No edit was needed in `src/acp/translate.ts`: the ACP translator already
renders record-emitted previews, covered by the existing
`UpdateTranslator` cases in the preview suite.

## Acceptance (PLAN 31780-31826: items 1, 6, 8)

| Item                       | Verdict                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Off means today's bytes | Unchanged: golden requests with the feature off are byte-identical (existing M91 fixtures green, untouched); the new off/on golden run proves the default-on byte diff is exactly `max_output_tokens` 32768 → 131072, nothing else.                                                                                                                                                                                                                                                 |
| 6. Previews                | Captured U9 argument bytes drive previews through the unmanaged production path (manager → entry → host → real SSE/transport/parser): snapshots accumulate to the captured length; nothing runs, asks or calls a hook before `.done`; no preview bytes reach replay or requests. R3: declared-tool TEXT now renders from the raw 16-frame capture (see R3 record); the R2 stand-in test below stays as the undeclared-tool guard.                                                   |
| 8. Output                  | VS Code and interactive ACP Meta turns request 131,072, clamped by the budget; headless exec requests at most 32,768 (or the record’s smaller maximum) to preserve its worst-case reservation; a qualified selected record with `output.maxTokens = 65536` requests 65536 through the production path; one continuation follows `max_output_tokens`, then a notice (existing L2 mechanics, unchanged). Calls in a cut-short reply are answered with an error, never run (existing). |

Provider × item rows: `muse-spark-1.3-contributor` on/on; other bare
`muse-spark-*` off-preview/on-cap (cap is documented for every Muse Spark
model; streaming deltas were captured only on the contributor model);
qualified models on-cap/off-preview (cap binds from the resolved record;
no in-tree streaming-argument record exists for any qualified model);
all other providers off/off with reason "no capture" (C-M106-1 manifest:
every row waits for its key or local runtime).

## Tests

- `test/unit/modelCapabilitiesBinding.test.ts`: selector values unchanged
  (`metaOutputMaxTokens` now delegates to `modelPolicyFor` with identical
  observable values on captured, bare, qualified and unknown ids).
- `test/unit/modelApiArgumentPreview.test.ts` (`productionRig` with the
  shared production selectors): captured model streams a preview and
  requests 131072; `muse-spark-1.2` withholds previews at 131072;
  `future-model` stays at 32768 with no previews; no `argumentPreview`
  bytes in any request.
- `test/unit/modelApiBackendManager.test.ts` (+2 R2): "binds a qualified
  selected record through the unmanaged production path" (registry
  `team/small` with `output.maxTokens = 65536` requests 65536, preview-free
  for want of a streaming record); "replays the captured U9 argument wire
  through the production path" (fixture byte-exact done arguments as two
  deltas through real SSE/transport/parser/host; snapshots reach the
  captured length with no rendered text per the undeclared-tool rule; cap
  131072; no preview bytes in requests). Caller-supplied precedence by
  reference still holds.
- `test/unit/modelApiGoldenRequests.test.ts` (+1 R2): off/on golden run
  proves the default-on byte diff is exactly the cap, fixtures untouched.
- `test/unit/execClient.test.ts` (+1 R2): a preview-carrying
  `tool_call_update` never reaches the sink; only the completed edit's
  paths reach `onFilesChanged`.

## Red drills (R2; every guard broken on purpose, every file restored byte-exact)

1. Execute on a delta (existing L1 guard, re-fired by this lane's wiring):
   `modelApiArgumentPreview.test.ts` →
   "never executes, asks or calls a tool hook on a delta, then reuses the
   row after done". Passed with the binding in place.
2. Entry guard removal (covers F1, F2 and F3): the entry's default cap
   supplier and both `?? meta…` defaults were replaced with plain
   pass-through of caller deps. "binds a qualified selected record…"
   failed (`expected 32768 to be 65536`); "replays the captured U9
   argument wire…" failed (zero previews); "changes only
   max_output_tokens…" failed (the on arm carried no 131072 cap). The
   entry was restored byte-exact (`sha256sum -c` OK against the pre-drill
   hash recorded below).
3. Exec drop removal (covers F4): the `tool_call`/`tool_call_update` drop
   branch in `execClient.ts` was neutralised, so completed-edit paths were
   never reported. "drops preview-carrying tool updates…" failed on the
   `onFilesChanged` assertion (the sink still stayed marker-free behind the
   second tool-prefix filter). The file was restored byte-exact
   (`sha256sum -c` OK).

| File                                              | SHA-256                                                            |
| ------------------------------------------------- | ------------------------------------------------------------------ |
| `src/host/backend/modelApiEntry.ts`               | `9ab34634936eb1f7ae06a181fe5e017c0c78222d40c6bfccacf2d3a722cb8ff5` |
| `src/core/backends/modelapi/modelCapabilities.ts` | `a38746798e33c410027775bae82f67dd1f30a974f514c2808cd2049c1fd99657` |
| `src/runtime/exec/execClient.ts`                  | `abfda2b6f44aaeb899789e48ffb167baa393bc2fab7a1875b5d7a347dd7704fd` |

## Gates (kubuntu rig, R2 final pass)

- `npx vitest run` (repository timeouts, `--maxWorkers=3`): batch one
  (`modelApiBackendManager`, `modelCapabilitiesBinding`,
  `modelApiArgumentPreview`) 88 passed; batch two
  (`modelApiGoldenRequests` 141, `execClient` 11) 152 passed. Total 240.
- `npm run typecheck` (all five projects) clean; `eslint
--max-warnings=0` and `prettier --check` on every changed file clean;
  `node scripts/check-l10n.mjs` 0 problems (no new strings); `npx jscpd`
  0 clones; `npm run deadcode` clean (two pre-existing config hints);
  `npm run check:reference` current; `npm run check:host-api` 0 problems.
- `npm run build` (tokens, production esbuild, size, split, globals,
  notices) clean: `dist/extension.js` 550.5 KiB (cap 600),
  `dist/modelApi.js` 516.1 KiB (cap 525); `configuredProviders.js` stays
  its own chunk, so the new lazy import adds no block.

## Editor and OS scope

One binding in the shared bundle entry serves VS Code, ACP and headless
`exec` by construction (all three load `dist/modelApi.js` through the same
manager), but the hosts do NOT render alike: streamed argument previews
render in VS Code and ACP only. Headless `exec` drops every
`tool_call`/`tool_call_update` before its sink (`execClient.ts`) and its
engine observer emits completed-tool metadata only, so it records
completed tools and never shows live previews (pinned by the new exec
test). VS Code and interactive ACP request the documented record maximum;
headless exec binds at most 32,768 output tokens (or the record’s smaller
maximum) to preserve its worst-case reservation. All use the shared request
path, with the headless run supplying its own single cap. The suites above run on kubuntu; Windows/macOS receipts, the
`~4-turn` live check, Codex + Grok review and the M106 release checklist
stay with the lead. The entry and selectors use no path, shell or
platform-dependent code.

## Open (lead decisions)

1. ~~Run the Meta collector with the key and install raw U9 delta/done,
   status and output-cap receipts~~ — CLOSED in R3 by the lead's 2026-10-10
   20:13 UTC live run (see R3 record below): the raw 16-frame U9 strict
   stream is installed as `test/fixtures/m106/u9-raw-strict-stream.json`
   and declared-tool preview TEXT renders from its captured bytes; the
   output-incomplete refusal receipt documents the 16-token minimum and the
   collector probes it on the next live run.
2. Capture U9 streaming rows for other Meta models to widen previews beyond
   the contributor model; attest a qualified model's streaming arguments
   before any qualified preview turns on.
3. The lead's full gate matrix, hosted CI on three OSes, and Codex/Grok review.

## R3 — RVCM1062B repairs and the closed external blocker (kubuntu, 2026-10-10)

Every finding is fixed, each with a regression test that fails without it
(drills below, every file restored byte-exact, `sha256sum -c` OK). The
class of each finding was swept: the preview construction has one site
(`ModelApiHost.ts:5586`), no other session path resolves through a raw
registry (remaining `createProviders` mentions are the pass-through type,
the manager and the panel UI), and the request's unoffered tools stay
textless.

| Finding                                                                                                                                                                                             | Fix                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Regression test                                                                                                                                                                                   |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P1 validation/security (`backends.ts:450`): the headless registry bypassed runtime budget admission and accounting                                                                                  | `src/host/backend/modelApiEntry.ts` binds the selected record through the session client's own resolver (the accounting-wrapped headless client) and never consults a standalone registry while one exists; `src/runtime/backends.ts` no longer supplies the raw registry                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | `modelApiBackendManager.test.ts` → "resolves qualified records through the session client, never a standalone registry" (registry factory never called, cap 65536)                                |
| P1 failure paths/lifecycle (`extension.ts:2562`): the standalone registry rejected `chatgpt/…` and `copilot/…`                                                                                      | `src/extension.ts` no longer builds a separate service; a plan ref the fallback registry cannot name resolves against the session client via `metaResolvedModel`, as before any registry existed                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | "keeps subscription models selectable beside a subscription-blind registry"                                                                                                                       |
| P2 capability binding (`modelApiEntry.ts:148`): interactive ACP ignored a qualified record's larger output maximum                                                                                  | the stash is populated from the authoritative `client.models.resolve` in every production path, so interactive ACP (which supplies no `createProviders`) binds 65536                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | "binds the selected record cap through the session client resolver alone"                                                                                                                         |
| P2 failure paths/usage (`extension.ts:2553`): the separate service lost plan-key usage and plan state                                                                                               | same removal as the P1 extension fix: the session's own subscription-aware service remains the sole plan-identity and usage owner; no second cache or tally exists                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | covered structurally by the never-a-standalone-registry test above                                                                                                                                |
| List-optionality catch (found by this lane, not the review): the first R3 wrapper always defined `models.list`, which turned a list-less client into a failure and broke all 12 `acpModelApi` tests | `list` is only defined when the client lists or a fallback registry exists                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | "keeps the client-only catalogue when the session resolver lists nothing"; the ACP suite (12/12) guards it end to end                                                                             |
| P3 docs/reference (`featureCatalog.ts:491`): the preview reference advertised VS Code only                                                                                                          | `argument-preview` names `['vscode', 'acp']` in `featureCatalog.ts` and `referenceSource.ts`; `docs/reference.md` regenerated (`Surfaces: vscode:modelApi, acp:modelApi`); README's preview section states production behaviour in both hosts                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | `featureCatalogDetails.test.ts` → "certifies argument previews on both the panel and ACP surfaces"; `npm run check:reference` current                                                             |
| External blocker: raw U9 strict stream                                                                                                                                                              | lead's 2026-10-10 20:13 UTC run installed byte-exact as `test/fixtures/m106/u9-raw-strict-stream.json` (SHA-256 `b56095c9…45584c42`, matching the live manifest; gitleaks clean before copying). The host renders preview TEXT for offered IDE/MCP tools from their declared string fields (`declaredPreviewFields` in `argumentPreview.ts`, consulted at `ModelApiHost.ts:5586` after the host tools; unoffered tools stay textless). The new test declares the captured `get_weather` schema through the MCP catalogue, streams the 13 codec-visible raw frames (the codec passes the 3 additive `content_part.*` frames untranslated — asserted as the exact skip-set), and proves TEXT renders `Oslo`/`celsius`, bytes reach the captured length, the cap is 131072 and no preview bytes enter requests | `modelApiArgumentPreview.test.ts` → "renders declared-tool preview TEXT from the raw captured U9 frames"; `m106CaptureFixtures.test.ts` → "keeps the raw U9 strict stream as 16 scrubbed frames"  |
| External blocker: output-incomplete minimum                                                                                                                                                         | the refusal receipt (`max_output_tokens: 1` → HTTP 400, "must be `>= 16`") is installed as `test/fixtures/m106/output-incomplete.json` (SHA-256 `8b8baeb1…846f93a621`) as captured evidence of the server minimum. `sessionBudget.ts` untouched (MINOUT lane owns the product minimum). The collector's probe now runs at 16 tokens with the 1-through-100 prompt, so the next live run observes a genuine incomplete stop                                                                                                                                                                                                                                                                                                                                                                                  | `m106CaptureFixtures.test.ts` → "records the 16-token output minimum as captured refusal evidence"; `m106CaptureCollector.test.ts` → "probes the output limit at the documented 16-token minimum" |

The R2 stand-in U9 test ("replays the captured U9 argument wire…", empty
text for the undeclared tool) stays unchanged as the declared-fields-only
guard. Byte-exact live receipts are exempt from prettier by name in
`.prettierignore` (the file's M91-G precedent: the collector's
`JSON.stringify` shape would otherwise be collapsed and the SHA pins
broken); `npx jscpd` over `src`+`test` reports 0 clones.

## R3 red drills (every guard broken on purpose, every file restored byte-exact)

Pre-drill hashes: `modelApiEntry.ts` `c87e2932…6b60a`,
`ModelApiHost.ts` `a1d0fa70…4885986`, `featureCatalog.ts`
`55bb952b…75100814cd2`, `capture-m106-meta.mjs` `2b5cf542…92bbabc6b65f`.

1. Entry preference neutralised (`clientModels` branch forced false):
   "resolves qualified records…" and "binds the selected record cap…"
   failed (2 expected failures); the subscription test still passed via
   its own fallback, which drill 2 covers.
2. Subscription fallback neutralised (`isPlanModel` branch forced false):
   "keeps subscription models selectable…" failed (1 expected failure).
3. Entry list forced always-defined (the R3 catch reintroduced): "keeps
   the client-only catalogue…" failed (1 expected failure). The same
   break had failed all 12 `acpModelApi` tests organically before the
   no-list test existed.
4. Host preview fallback neutralised (MCP/IDE lookup removed): "renders
   declared-tool preview TEXT…" failed with empty text (1 expected
   failure). A first attempt at this drill (`?? undefined ??`, which still
   falls through) did NOT fail and was discarded — recorded so the next
   lane checks its breaks apply.
5. Catalogue editors reverted to `['vscode']`: "certifies argument
   previews…" failed (1 expected failure).
6. Collector probe reverted to `max_output_tokens: 1`: "probes the output
   limit…" failed (1 expected failure).
7. One process note: a mid-drill restore used a stale backup (taken before
   the `in`-narrowing and list-conditional fixes) and `sha256sum -c`
   correctly reported FAILED; the two fixes were re-applied by hand and the
   hash matched the pre-drill value byte-exact before continuing. The
   backup is refreshed before every drill since.

## R3 gates (kubuntu rig, final pass)

- `npx vitest run` (repository timeouts, `--maxWorkers=3`):
  `modelApiBackendManager` 31, `modelApiArgumentPreview` 48,
  `modelApiGoldenRequests` + `execClient` + `modelCapabilitiesBinding`
  166, `argumentPreview` + `m106Wiring` + `subscriptionIntegration`
  79 passed / 2 failed (both pre-existing on the base commit
  `2c52eb9f6`: live ChatGPT sign-in needs network), `toolArgumentPreview`
  - `runtimeAccounting` + `configuredProviders` 53 passed / 1 failed
    (pre-existing loopback block in this sandbox, same on base),
    `acpModelApi` 12, `m106CaptureFixtures` + `featureCatalogDetails` 13,
    `m106CaptureCollector` 21 — all passed.
- `npm run typecheck` (all five projects) clean; `eslint
--max-warnings=0` on every changed file clean; `prettier --check` on
  every changed file clean (live receipts exempt by name, see above);
  `node scripts/check-l10n.mjs` 0 problems (no new strings);
  `npx jscpd` 0 clones; `npm run deadcode` clean (two pre-existing config
  hints); `npm run check:reference` current; `npm run check:host-api`
  0 problems.
- `npm run build` clean: `dist/extension.js` 550.1 KiB (cap 600, was
  550.5 — the removed lazy registry import outweighs the entry growth),
  `dist/modelApi.js` 516.8 KiB (cap 525, was 516.1). No new chunk, no new
  dependency, no guard widened.

## R4 — RVCM1062C repairs (kubuntu, 2026-10-10)

Both P2 findings are fixed, each with a regression test that fails
without it (drills below, the host file restored byte-exact after each:
`cmp` against the pre-drill backup OK). The class of each finding was
swept, not just the cited line. No paid or live model call, no
credential read; repository timeouts throughout (no `--testTimeout`).

| Finding                                                                                                          | Fix (`src/core/backends/modelapi/ModelApiHost.ts`)                                                                                                                                                                                                                                                                                                                                                           | Regression test                                                                                                                                                                                                                                                                                                                                                                  |
| ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P2 cap ordering (`collectText` built the body before `resolveModel`, and `outputCaps` never dropped)             | `collectText` resolves the selected model before building any request body (hooks, reservation, send), so the cap, the policy-derived tools/effort and the budget builders all read the resolved record; a side-voice-owned request rebuilds after its own resolve. `resolveModel` drops the cached maximum for the ref (record change) and `setModel` drops it for the newly selected id (selection change) | `modelCapabilitiesBinding.test.ts` → "compacts a forked qualified model before any switch at its resolved cap": a fork copies history but resolves nothing, so its compaction is the first request on a 65,536 record with an empty stash. It asserts the fork compacts `accepted`, the compaction POST carries the record's reasoning effort, and the next turn requests 65,536 |
| P2 preview honesty (preview fields came from the full host/IDE/MCP catalogues, ignoring trust and the allowlist) | `sending()` — the one choke point every sent request passes before streaming (turns and `collectText`) — snapshots the preview fields of exactly the tools in that request's body (`previewFieldsOfOfferedTool`: host tools' curated fields, IDE/MCP tools' declared schema fields). The single preview construction site reads only that snapshot; any other name stays textless with a byte count          | `modelApiArgumentPreview.test.ts` → "renders no text for a catalogued MCP tool the request never offered": `get_weather` is declared in the MCP catalogue but the untrusted workspace keeps MCP out of the request; the streamed call's text is `''` at the full argument byte count and neither `Oslo` nor `celsius` renders                                                    |

Class sweep. Capability caches: `outputCaps` is the only per-model
computed-capability cache in the host (audited every `Map`/`Set`: the
rest are operational state — listeners, approvals, shells, children —
or resolve-time writes with fallbacks, `resolvedModels` /
`modelKeyDigests`). The `collectText` rebuild covers every other
policy-derived request field at once (tools calling gate, effort,
provider fallback), and the normal turn path already resolves before
building. Preview construction has one site (the `new ArgumentPreview`
in `applyStreamEvent`); reviewer, side-chat and `exec` requests pass
through the same `sending()` snapshot, and execution-time refusal of
unoffered calls is unchanged. No new dependency, no guard widened, no
user-visible string (no l10n change).

## R4 red drills (every guard broken on purpose, host restored byte-exact)

Host hashes: pre-drill (fixed) `363198e6…5b561`, verified byte-exact
by `cmp` against the backup after each drill; final `6d476ab2…42c88abbe7`
(the same content after `prettier --write`). Test files final:
`modelCapabilitiesBinding.test.ts` `13440e66…03001d90`,
`modelApiArgumentPreview.test.ts` `e8d77c4c…fa11` (unchanged by drills).

1. Pre-resolve neutralised (the `resolveModel()` call before the hooks
   removed, invalidations kept): only "compacts a forked qualified
   model…" failed — `expected { effort: 'none', summary: 'auto' } to
match object { effort: 'high' }` — while its later-turn 65,536
   assertions still passed, proving the invalidation half carries the
   cap and the pre-resolve half carries the record-derived fields.
   A first attempt at this drill passed unnoticed because the test then
   asserted only the cap (the compaction POST is min'd with the 8,192
   summary budget either way); the reasoning-effort pin was added so the
   guard fires, and the drill re-run to this result.
2. Catalogue lookup restored at the preview site (the R3 expression put
   back): only "renders no text for a catalogued MCP tool…" failed —
   `expected '"city": "Oslo"\n"unit": "celsius"' to be ''` — the
   review's exact scenario; the other 48 tests in the file (including
   the U9 declared-tool TEXT test) still passed.

## R4 gates (kubuntu rig, final pass)

- `npx vitest run` (repository timeouts, `--maxWorkers=3`):
  `modelCapabilitiesBinding` 15 + `modelApiArgumentPreview` 49 = 64
  passed; `modelApiBackendManager` + `m106Wiring` + `execClient` = 56
  passed; `modelApiGoldenRequests` + `acpModelApi` + `argumentPreview` =
  214 passed; `modelApiHost` = 669 passed.
- `npm run typecheck` (all five projects) clean; `eslint
--max-warnings=0` on every changed file clean (one
  `@typescript-eslint/require-await` in the new test fixed by returning
  `Promise.resolve` instead of `async`); `prettier --check` on every
  changed file clean; `node scripts/check-l10n.mjs` 0 problems (no new
  strings).
- `npm run build` clean: `dist/extension.js` 550.1 KiB (cap 600),
  `dist/modelApi.js` 517.1 KiB (cap 525, was 516.8 — the fix adds
  ~0.3 KiB). No new chunk, no new dependency, no guard widened.

## R5 — RVCM1062D repairs (Codex, kubuntu, 2026-10-10)

Both P2 findings and their siblings are fixed. R5 supersedes R4's claims
about strict host-field curation and same-ref request binding: the prior
regressions did not cover either transition. No new wire shape, dependency,
string, paid/default/consent change, guard widening or visual styling.
The shared host and entry serve VS Code, ACP and exec; the established
preview surface and headless dropping policy remain covered by their suites.

| Finding                                                                                                                          | Fix                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Regression                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Red drills |
| -------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| P2 validation / preview honesty: strict conversion discarded nonenumerable host preview metadata                                 | `tools.ts` marks every host declaration, including recall and injected vault/schedule tools with no curated fields, with nonenumerable metadata; `schemas.ts` preserves the exact `previewFields` property descriptor when converting a definition, including a present property whose value is undefined. The final offered-tool snapshot therefore preserves host curation and never falls back to external schema fields for a host tool. Metadata stays nonenumerable and absent from request JSON.                                                                                                                                                                                                       | `modelApiArgumentPreview`: “keeps every host tool curated and hidden fields off the wire with strict %s” covers write content, edit find/replace/then_run and uncurated ask_user and recall_output (including its search text), strict on and off. `modelCapabilitiesBinding`: “preserves every host preview descriptor through strict conversion (%s)” sweeps all optional host families and injected vault/schedule declarations. Production preview fixtures now supply `metaModelFacts`, exercising the captured model's strict conversion.                               | 1, 6       |
| P2 concurrency / selected-record binding: a second same-ref resolve replaced the client under a body built from the first record | `ModelApiHost.ts` passes the one resolved record explicitly to body/policy/tool builders, output limits, budget reservation, send bookkeeping and final admission. `collectText` never resolves a same-ref record again after building; a stale record refuses, while a changed selection rebuilds the whole projection. The count request resolves before its body. The cap cache is a WeakMap keyed by record identity; the entry's separate policy stash is removed. Compaction tools are rebuilt from current declarations instead of a prior request's tools. Reviewer admission captures its supplied record too; whole-stream retry backoff reads the already selected client without a fresh resolve. | `modelCapabilitiesBinding`: “binds one record per compaction and resolves before counting after same-ref replacement (hook invalidation %s)” covers a 65,536/high record followed by a same-ref 1,024/none/tool-less record, pins the client and settlement price, verifies exactly one resolve per response/count, and refuses hook-time invalidation without sending or changing replay before a fresh successful compaction. `modelApiLoopGuarantees`: “uses the selected output cap once per resolved request record” pins request identity rather than a model-ID cache. | 2–5        |

Class sweep: all `resolveModel`, `body`, `budgeted`, `sending`,
`responseAttemptGuard` and response/count dispatch sites in the host; both
normal/reviewer tool builders; the single preview constructor and its
request-offered tool snapshot; strict conversion at both `toolDefinitions`
and the host, plus byte-only markers for every host declaration; entry cap
suppliers and their production callers. Resolution
for selection, consent and ownership stays outside request construction.
Every response builder and its admission/accounting now receive the same
record object, and the separate count request gets its own record before
building. No cached tools from a prior capability record enter compaction.

### R5 red drills

Each drill ran whole owning files, with repository timeouts and
`--maxWorkers=3`; every exit was 1. Source restoration used original bytes
in `finally`, equality against the saved backup, and matching SHA-256.
Logs/backups are private scratch under this lane's disk-backed
`$TMPDIR/CM1062R5-drills/`; no source was edited while its test run was active.

1. **Strict metadata:** return the spread strict definition without restoring
   its descriptor. Strict-on hidden-field and every-host-descriptor tests
   fail (2 failures / 68 passes). Strict-off stays green. Restore hash:
   `44bc6a3860c60d076f3a47b5f6e3c52295c4456bf1338b0cc2972d816c517ea9`
   (`schemas.ts`).
2. **Second resolve:** resolve `body.model` again after `makeBody(resolved)`.
   Both same-ref cases fail: the first body is dispatched through the
   replacement client, or an extra resolution is counted (2 failures / 59
   passes).
3. **Count ordering:** build countable from the previous selected record,
   then resolve its client. The non-invalidated case fails on the count's
   old cap/effort/tools (1 failure / 60 passes).
4. **Stale admission:** remove the pre-build current-record check and the
   final admission current-record check. The hook-invalidated case wrongly
   accepts instead of rejecting (1 failure / 60 passes).
5. **Record cap cache:** key the output-cap cache by ref again. Both same-ref
   cases and the per-request supplier test fail: stale cap and one supplier
   call instead of two (3 failures / 58 passes).

6. **Host markers:** remove the final metadata marker for declarations that
   did not pass through `define`. Both strict-on/off preview cases expose
   recall search/id text, and both catalogue descriptor cases fail (4
   failures / 66 passes). Restore `tools.ts` byte-exact:
   `9676c496588f8e02687eb20c36d67ca296fb9fd35af81eebaa6d526d31ed10da`.

Drill 1 was repeated after expanding the catalogue/recall regressions: the
strict-on cases still fail (2 failures / 68 passes), with the same schema
restore hash.

Drills 2–5 each restored `ModelApiHost.ts` to:
`4d2c2c83b482381f057b296181fb4f6d5e33b10c6537d0b377a1eb006d6f7e51`.

One exploratory run was discarded: editing `schemas.ts` while Vite loaded it
invalidated its exported module in the test process and produced unrelated
undefined-export failures. All drills and final verification run with source
held fixed for the entire invocation. No timeout was raised.

### R5 verification (kubuntu, repository timeouts)

Final whole-file runs, at most three files per run and `--maxWorkers=3`:

| Files                                                                           | Result     |
| ------------------------------------------------------------------------------- | ---------- |
| `modelCapabilitiesBinding`, `modelApiArgumentPreview`, `modelApiLoopGuarantees` | 112 passed |
| `modelApiBackendManager`, `modelApiGoldenRequests`, `acpModelApi`               | 184 passed |
| `modelApiHost`, `execClient`, `argumentPreview`                                 | 741 passed |

Total: **1,037 passed**, zero failures. No tests skipped or filtered; no
`--testTimeout`. The final run includes the complete optional-host catalogue
and recall-marker repair. Strict/off goldens, offered/unoffered MCP previews,
raw U9 declared-tool previews, ACP translation, exec dropping, compaction
selection switching and stale key/admission paths remain green.

- `npm run typecheck`: all five projects passed; affected host/unit projects
  rechecked after the expanded catalogue repair. The unit gate caught the
  vault fixture's missing required handler, which now explicitly rejects
  execution; the final owning suites still pass all 112 tests.
- Changed-file ESLint with zero warnings and Prettier checks passed. Knip
  passed (the two existing vendor/axe-core configuration hints remain),
  jscpd found 0 clones, and dpdm found no cycles across 3,137 files.
- Localization: 14 UI tables, 14 usage tables, 0 problems. Reference:
  77 features, current. Host API: 375 APIs, 0 problems. Plan: 207 milestones,
  0 drift. Roadmap: 207 entries, regenerated/current.
- Final `npm run build` passed all token, size, split, model-text,
  host-global and notice gates: extension **550.1 / 600 KiB**; Model API
  **517.2 / 525 KiB**; checkpoint store **87.3 / 225 KiB**. No budget raised.
- The rig/shared brief prohibits aggregate quality, full-suite runs and
  branch integration; PLAN §7 records that boundary. The lead retains those
  checks and the multi-OS release matrix. No browser, live/paid call,
  credential read, dependency install, push, rebase or merge was performed.

No RVCM1062D finding remains open; no external blocker was encountered.

## R6 — RVCM1062E repair: stale-record refusals name the run (kubuntu, 2026-10-11)

The review's one P3 finding (manual compaction refused with scheduled-prompt
confirmation guidance) and every sibling of that class are fixed: no
stale-record refusal borrows the schedule message for an operation the user
never ran. Five new UI strings name the run the user actually started;
scheduled prompts keep the schedule guidance. No new dependency, setting,
chunk, protocol shape, guard widening, paid consent, default change,
escape hatch, or weakened gate.

New strings (`src/shared/l10n/en.ts`, translated in all 14 UI tables):
`requestStaleTurn` (send the message again), `requestStaleCompaction`
(compact again), `requestStaleRetry` (neutral try again where resolution
knows no operation), `requestStaleHookModel` (try the action again) and
`requestStaleRun` (run the command again, headless `exec` only).

| Stale-record refusal site                                                                                                          | Fix: operation named now                                                                                                                                                                                                                                                                                          |
| ---------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ModelApiHost` `collectText` (the cited line)                                                                                      | `staleRecordError(turnId === COMPACTION_TURN_ID)`: compaction while `compacting` is set, the turn while one is active, the schedule for a confirmed scheduled turn, neutral otherwise                                                                                                                             |
| `ModelApiHost` `responseAttemptGuard`                                                                                              | `staleRecordError(isCompaction)`: the guard already carries the operation                                                                                                                                                                                                                                         |
| `ModelApiHost` `resolveModel` key-digest recheck                                                                                   | `staleRecordError()` from host state (compacting / active turn / confirmed schedule / neutral)                                                                                                                                                                                                                    |
| `providerRegistry` `resolve` recency                                                                                               | Neutral `requestStaleRetry`: the registry knows no operation                                                                                                                                                                                                                                                      |
| `runtimeAccountingEntry` dispatch guard (`exec`-only file)                                                                         | `requestStaleRun`                                                                                                                                                                                                                                                                                                 |
| `client`, `providerClient` (`CodecClient`), `transport` (×2) confirmed checks, `subscriptions/registry` plan-model confirmed check | `ConfirmedModelRequest.runKind` (`'scheduled'` set by both schedule builders, `'review'` by the reviewer, `'hookModel'` by the hook runner): `staleConfirmedError` (shared helper, except a matching local ternary in `subscriptions/registry`) keeps the schedule guidance and names the hook call for hook runs |

Kept the schedule message on purpose (genuine schedule contexts, covered
by their unchanged suites): `schedulesEntry` ×3, `runSchedule`,
`scheduleRunChanged`, and every confirmed-gated throw on a scheduled fire.
The reviewer path needs no user-visible change: its stale confirmations are
swallowed to the existing reviewer-failed note before any text surfaces.

Class sweep: every `scheduleConfirmationExpired` throw in `src` was read
and classified (12 production sites plus 4 test uses, all genuine
schedule contexts and unchanged); the single English source string has no
other copy. Sibling discovery during the sweep: the configured-providers
dispatch wrapper converts every `CodecClient` error (including a stale
hook confirmation) into its sanitized unavailable error, so the hook
wording there is asserted at the `CodecClient` level instead, and the
subscription client yields a lapsed Copilot confirmation as an error event
rather than rejecting.

| Regression (fails without the fix)                                                                                                   | File                                         |
| ------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------- |
| Hook-invalidated manual compaction rejects with the compaction guidance, names no schedule, still sends nothing and preserves replay | `modelCapabilitiesBinding` (strengthened)    |
| A turn on a record that lapsed after resolution fails with the turn guidance and still sends nothing                                 | `modelCapabilitiesBinding` (new)             |
| A lapsed hook-model confirmation at the client boundary names the hook call                                                          | `modelApiClient` (new)                       |
| A lapsed hook-model confirmation on a codec record names the hook call before any fetch                                              | `providerTransport` (new)                    |
| A lapsed hook-model confirmation on a subscription record surfaces the hook guidance in its error event                              | `modelApiProviders` (new)                    |
| A lapsed registry resolution refuses with neutral retry guidance before dispatch                                                     | `modelApiProviders` (new)                    |
| A stale model in a headless run refuses with the run guidance before dispatch                                                        | `runtimeAccounting` (new)                    |
| The compaction-failure notice shows the compaction guidance and no schedule text                                                     | `conversationController` (new, display path) |

Shared harnesses extracted to keep the duplication gate at zero clones:
`seedAndFork` (binding), `lapsingGateClient` + `collectConfirmed` (client).

### R6 red drills

Each drill restored its file byte-exact (SHA-256 verified against a saved
copy; the subscription file by exact reverse edit with its diff
re-checked). Repository timeouts throughout, `--maxWorkers=3`; every drill
exit was a test failure, never a timeout.

1. **Compaction branch:** `staleRecordError` returns the schedule message
   for compaction. The hook-invalidation compaction case fails (1 failed /
   1 passed in its `-t` slice). `ModelApiHost.ts` restored to
   `77a1e20e2602982c541c76d4404f85bf5a29cb42925c8c6e17ce4c9de4504b66`.
2. **Turn branch:** the active-turn tail returns the schedule message. The
   lapsed-record turn case fails (1 failed / 19 skipped). Same restore hash.
3. **Confirmed helper:** `staleConfirmedError` returns the schedule message
   for hook runs. The client hook case fails (1 failed / 75 skipped) and
   the codec hook case fails (1 failed / 33 skipped). `transport.ts`
   restored to
   `d00988999b9a42c2028265cd93ca7343f05355aa179b22273060314c20123f3c`.
4. **Subscription ternary:** same break in `subscriptions/registry.ts`.
   The plan-confirmation case fails (1 failed / 17 skipped). Reverse-edit
   restore verified by diff (intended hunk only).
5. **Run guard:** `runtimeAccountingEntry` returns the schedule message.
   The stale-model run case fails (1 failed / 8 skipped).
   Restored to
   `d365505b08d828f9195f6dee0f4a0f5532151cef967b21eabb76e10bf89a6633`.
6. **Registry recency:** `providerRegistry` returns the schedule message.
   The neutral-retry case fails (1 failed / 17 skipped). Restored to
   `0fe0868f9a763fedcbff759708ed72f711b80ee78e0298c49b6caf3233aeeee5`.

### R6 verification (kubuntu, repository timeouts, `--maxWorkers=3`)

Final whole-file runs, at most three files per run:

| Files                                                                | Result              |
| -------------------------------------------------------------------- | ------------------- |
| `modelCapabilitiesBinding`, `modelApiProviders`, `runtimeAccounting` | 47 passed           |
| `modelApiClient`, `providerTransport`                                | 110 passed          |
| `modelApiHost`                                                       | 669 passed          |
| `conversationController`                                             | 681 passed          |
| `configuredProviders`                                                | 23 passed, 1 failed |

Total: **1,530 passed**, zero regressions. The single
`configuredProviders` failure is the pre-existing loopback test (`pins a
loopback HTTP request ... parses a real local stream`): this sandbox
listens on 127.0.0.1 but refuses the fetch to it (probed directly with
`node:http` + `fetch`: listen ok, `fetch failed`), so the test exceeds the
repository 5 s timeout here. It touches no changed code path and passed on
macmini at R5; the lead re-runs it outside the sandbox. No test was
skipped, filtered, or given a raised timeout.

- `npm run typecheck`: all projects passed.
- ESLint `--max-warnings=0` on all changed TypeScript files and Prettier
  `--check` on all changed files (including the 13 translation tables)
  passed. Knip passed (only the two pre-existing vendor/axe-core hints).
  jscpd: 0 clones. dpdm: no cycles.
- Localization: 14 UI tables, 14 usage tables, 0 problems. Reference: 77
  features, current. Host API: 375 APIs, 0 problems.
- Final `npm run build` passed all gates: extension **550.1 / 600 KiB**;
  Model API **517.4 / 525 KiB** (+0.2 KiB for the new strings and helper);
  no budget raised.
- No browser, live/paid call, credential read, install, push, rebase or
  merge was performed. Scratch backups stayed under this lane's
  disk-backed `$TMPDIR`.

No RVCM1062E finding remains open; no external blocker was encountered.

## R7 — RVCM1062F repair: confirmed runs work on plan models (kubuntu, 2026-10-11)

Review RVCM1062F raised one P3: `subscriptions/registry.ts:216` refused
EVERY confirmed plan-model request before dispatch, and its message claimed
the model had changed ("try again") when nothing had — retrying failed the
same way. No P1 or P2 was raised.

**Which case applied: implement.** Nothing in PLAN forbids a confirmed run
on a plan model, so the plan-model branch now honours `isStillAllowed()`
exactly like the other branches. Citations:

- M95b (PLAN §6) promises a ChatGPT-Plus/Pro or Copilot-plan user "runs the
  harness on that plan's inference"; it lists no confirmed-run exclusion,
  and neither M106 (D86) nor the decision that introduced
  `ConfirmedModelRequest` (the contract comment at `transport.ts:348-364`:
  "the paid gate and session model must still match before every HTTP try")
  excludes plan models.
- The hook model IS the session model (`ModelApiHost.ts:8629`), so a hook
  run on a plan session necessarily carries a plan `modelId`; the old branch
  broke every hook run on every plan session. Reviews explicitly admit plan
  pricing without a paid consent (`ModelApiHost.ts:6743`), so a review on a
  plan session must also pass the subscription gate.
- The other three branches share one conditional form — Meta
  (`client.ts:452-458`), BYO (`providerClient.ts:197-205`) and the transport
  fence (`transport.ts:837-844`): refuse only on identity mismatch or a
  lapsed gate, otherwise dispatch. The plan-model branch is now the fourth
  instance of that form. No new string, setting, chunk or dependency; no
  surface offered or withdrew a combination.

| Finding → fix → test → drill                                                                                                                      | File                        |
| ------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------- |
| Plan-model confirmed gate refuses only on model mismatch or `!isStillAllowed()`; hook runs name the hook call, other kinds keep schedule text     | `subscriptions/registry.ts` |
| Same unconditional throw in the Copilot adapter now refuses only a lapsed or mismatched confirmation before dispatch                              | `copilotClient.ts`          |
| Still-allowed confirmation dispatches per run kind (`hookModel`, `scheduled`, `review`, unmarked); adapter gets the catalogue model id            | `modelApiProviders` (new)   |
| Lapsed confirmation per run kind refuses before dispatch with the run's guidance (hook text names no schedule)                                    | `modelApiProviders` (new)   |
| Still-allowed confirmation for another model refuses even while allowed                                                                           | `modelApiProviders` (new)   |
| ChatGPT branch: lapsed refuses before sign-in, still-allowed reaches sign-in (branch catch maps both to its retry text, as for every error there) | `modelApiProviders` (new)   |
| Adapter: lapsed/mismatched refuses, still-allowed dispatches through `sendRequest` with schema-valid events                                       | `copilotClient` (rewritten) |
| R6 hook-lapse case now lapses for real (`isStillAllowed: () => false`); shared `streamPlanConfirmed`/`refusalOf` harness keeps jscpd at 0 clones  | `modelApiProviders` (edit)  |

### Sibling sweep (every `confirmed !== undefined` site)

- `client.ts:453`, `providerClient.ts:198`, `transport.ts:838`: already
  conditional — untouched.
- `schedulesEntry.ts:393`, `conversationController.ts:9769/9776`,
  `modelApiBackendManager.ts:563`: pre-dispatch identity/allowance checks —
  already conditional, untouched.
- `copilotClient.ts:286`: unconditional — fixed (its only production caller,
  the registry's Copilot branch, never forwards `confirmed`, so the fix
  changes no live path today; it removes the trap for a direct caller).
- No other unconditional confirmed throw exists in `src/`.

### R7 red drills

Backups under this lane's disk-backed `$TMPDIR`; both files restored
byte-exact (SHA-256 `sha256sum -c` OK:
`registry.ts` `14b576bc…ada880cbfa`,
`copilotClient.ts` `0a3cd703…27d7134f7272a6c60b1e9b61eb`). Repository
timeouts throughout, `--maxWorkers=3`; every drill exit was a test failure,
never a timeout.

1. **Subscription gate:** condition reverted to `if (confirmed !== undefined)`.
   The five still-allowed cases fail (4 Copilot run kinds + ChatGPT
   sign-in); the mismatch case still passes (5 failed / 1 passed /
   23 skipped in the `-t still-allowed` slice).
2. **Adapter gate:** condition reverted to `if (confirmed !== undefined)`.
   The rewritten adapter case fails (1 failed / 49 skipped in its
   `-t still-allowed` slice).

### R7 verification (kubuntu, repository timeouts, `--maxWorkers=3`)

- `modelApiProviders`, `copilotClient`: **79 passed** (whole files).
- `npm run typecheck`: all projects passed.
- ESLint `--max-warnings=0` and Prettier `--check` on all four changed files
  passed. Knip: only the two pre-existing vendor/axe-core hints. jscpd:
  **0 clones** (the first cut added 6; extracted the shared harness).
- Localization: 14 UI tables, 14 usage tables, 0 problems (no string added
  or changed). Reference, host API and feature catalogue untouched: no
  command, setting or surface changed.
- Final `npm run build` passed: extension **550.1 / 600 KiB**; Model API
  **517.4 / 525 KiB** — both unchanged from R6; no budget raised.
- No browser, live/paid call, credential read, install, push, rebase or
  merge was performed.

No RVCM1062F finding remains open; no external blocker was encountered.

## R8 — RVCM1062G repairs: the plan-model success path matches every other branch (kubuntu, 2026-10-11)

Review RVCM1062G raised two P2 (the new plan-model success path skips the
start receipt and never re-checks the paid gate after its awaits) and two
P3 (the ChatGPT branch rewrites a lapsed confirmation as the generic plan
retry sentence; the Copilot adapter refuses the catalogue/session id pair
it otherwise accepts). One class: the plan-model branch must do everything
the other provider branches do around a confirmed dispatch, in the same
order — and through the same helper, not a hand copy.

**Fix.** `transport.ts:384/400/420` extracts the shared
confirmed-dispatch helper the other branches use: `assertConfirmedAllowed`
(model match plus `isStillAllowed()`, throwing the run's own guidance),
`noteConfirmedRequestStarted` (confirmed first, then the admission
observer — the transport order at `transport.ts:1000`), and
`isStaleConfirmedError` (lets a lapsed-confirmation refusal pass branch
catches unchanged). Adopted by every branch: Model API (`client.ts:453`),
configured provider (`providerClient.ts:204`), the registry's Copilot path
(early gate `registry.ts:225`, adapter dispatch through the guard at
`registry.ts:233`) and ChatGPT path (early gate plus the post-sign-in
re-check at `registry.ts:269-270`), and the Copilot adapter (early gate
`copilotClient.ts:176`, post-count re-check and started note at
`copilotClient.ts:357-358`). The registry forwards an inert-start copy of
the confirmation into the adapter (the hook/reviewer pattern), so the
guard counts the paid use exactly once. The ChatGPT catch at
`registry.ts:344` yields a lapsed confirmation with its own hook/schedule
text instead of the retry sentence; the adapter catch at
`copilotClient.ts:433` lets the same refusals through instead of its
failure text; the adapter's model match tolerates session `copilot/<id>`
against catalogue `<id>`. No new string, setting, chunk or dependency; no
guard widened.

| Finding → fix → test → drill                                                                                                                                                      | File                       |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------- |
| Shared gate/started/stale helpers; transport dispatch uses the started helper                                                                                                     | `transport.ts`             |
| Early gate through the helper (same refusal, media finish preserved)                                                                                                              | `client.ts`                |
| Early gate through the helper (provider/origin checks kept inline)                                                                                                                | `providerClient.ts`        |
| Copilot path: gate, inert-start forward, guard folds the real start note                                                                                                          | `registry.ts:225-245`      |
| ChatGPT path: post-sign-in re-check plus the real start note                                                                                                                      | `registry.ts:269-270`      |
| Lapsed confirmations keep hook/schedule text on both plan branches                                                                                                                | `registry.ts:344`          |
| Catalogue/session id tolerance, post-count re-check, started note, stale pass-through                                                                                             | `copilotClient.ts`         |
| Lapsed ChatGPT refusal names the hook call instead of the retry sentence                                                                                                          | `modelApiProviders` (edit) |
| Catalogue request id against a session confirmation id dispatches once                                                                                                            | `copilotClient` (new)      |
| Table test: Model API, configured provider, Copilot, ChatGPT plan × hook/scheduled/review/unmarked × allowed/lapsed/lapsing/mismatched/aborted with the same lifecycle assertions | `modelApiProviders` (new)  |

### Sibling sweep

- Every `confirmed !== undefined` site in `src/` re-checked: the two
  transport fences keep their key/origin halves (a strict superset of the
  helper); hook/reviewer entries already fold the start note into admission
  and pass an inert copy down; `schedulesEntry`/`conversationController`/
  `modelApiBackendManager` checks are pre-dispatch identity checks, already
  conditional.
- Mid-flight lapse honesty swept both plan branches: ChatGPT (registry
  catch) and Copilot (adapter re-check plus catch pass-through), so a lapse
  during sign-in or token counting names the run on either branch.

### R8 red drills (every guard broken on purpose, every file restored byte-exact)

Baseline SHA-256 recorded before drilling; `sha256sum -c` OK after every
restore (`registry.ts` `0e15efe9…46accc66`,
`copilotClient.ts` `6cd5245c…d7134f72`,
`transport.ts` `7efcd3fb…59d05b2ff`). Repository timeouts throughout,
`--maxWorkers=3`; every drill exit was a test failure, never a timeout.

1. **ChatGPT re-check and start note removed** (`registry.ts:269-270` →
   admit-started only): 8 failed — the 4 still-allowed and 4 mid-dispatch
   `chatgpt-plan` table cases; lapsed/mismatch/abort still pass.
2. **Stale pass-through removed** (`registry.ts:344`): 5 failed — the
   updated ChatGPT lapsed test plus the 4 `chatgpt-plan` lapsed table
   cases; Copilot lapsed cases still pass (that branch already kept the
   message).
3. **Copilot id tolerance reverted to strict equality**: the new
   `accepts a catalogue request id` adapter case fails (1 failed /
   50 skipped in its `-t catalogue` slice).
4. **Adapter re-check removed** (`copilotClient.ts:357`): 4 failed — the
   `copilot` mid-dispatch table cases across all four run kinds; every
   other branch still passes.
5. **Shared gate disabled** (`assertConfirmedAllowed` no-op): 22 failed
   across the table's lapsed/mid-dispatch/mismatch cases
   (`modelApiProviders` + `modelApiClient` `-t laps` slice).

### R8 verification (kubuntu, repository timeouts, `--maxWorkers=3`)

- `modelApiProviders`, `copilotClient`: **136 passed** (whole files).
- `modelApiClient`, `configuredProviders`: **99 passed**, 1 failed — the
  `pins a loopback HTTP request` case times out at 5000 ms because this
  sandbox blocks loopback TCP (a bare `node:http` listen + fetch probe
  fails the same way); that test passes no confirmation, so the changed
  lines are no-ops for it. Named for the lead to run outside the sandbox.
- `npm run typecheck`: host, webview and unit projects passed.
- ESLint `--max-warnings=0` and Prettier `--check` on all seven changed
  files passed. Knip: only the two pre-existing vendor/axe-core hints.
  jscpd: **0 clones** (the first cut added 5; extracted the shared guard,
  registry and refusal helpers plus a static cancellation stub).
- Localization: 14 UI tables, 14 usage tables, 0 problems (no string added
  or changed). Reference, host API and feature catalogue untouched: no
  command, setting or surface changed.
- Final `npm run build` passed: extension **550.1 / 600 KiB**; Model API
  **517.5 / 525 KiB** (R7: 517.4) — both within budget; no budget raised.
- No browser, live/paid call, credential read, install, push, rebase or
  merge was performed.

No RVCM1062G finding remains open; no external blocker was encountered.

### R9 (RVCM1062H, kubuntu lane CM1062R3) — the last confirmed-dispatch paths

Both findings are the same class as the last two rounds: a provider path
deciding a confirmed dispatch by itself instead of the shared helper.

- **P2** (`providerClient.ts:200`): a still-allowed schedule or hook
  confirmation on a configured provider leaves `origin` unset
  (`ModelApiHost.scheduleConfirmation`, `schedulesEntry.requestFor`, the
  hook confirmation), and the bound client adds only `providerId`. The
  codec's strict `confirmed.origin !== this.provider.origin` check refused
  it before the helper, and the bound `catch` showed the Models & Agents
  sentence. The codec now routes its provider/origin check through
  `assertConfirmedAllowed` with an unset-means-pass tolerance matching the
  transport fence; the refusal, when one is due, is the helper's.
- **P3** (`configured.ts:707`): the bound `catch` mapped every failure to
  `modelsPanelUnavailable`, discarding the helper's lapse guidance. It now
  rethrows stale-confirmation errors unchanged, and the helper runs before
  the wrong-client fence so a confirmed mismatch refuses with the run's
  own guidance. The lifecycle table's configured branch and the
  `credential rotation` boundary case now expect the helper sentence.
- **Sibling sweep**: every `ConfirmedModelRequest` / confirmed-parameter
  site in `src` re-checked (11 files). Transport's key/origin fences and
  the Copilot `confirmation-expired` mapping stay as RVCM1062H blessed
  them; both are allowlisted with reasons in the new inventory test.
- **Lifecycle table**: new `configured-provider-schedule` branch (14
  cases) drives the production path exactly as the client builds it — the
  confirmation carries no origin and no provider id, the bound client
  under test adds only the provider id — for every run kind. 70 cases.
- **Inventory test** (`test/unit/confirmedDispatchInventory.test.ts`):
  walks `src`, flags any refusal-shaped line near a confirmed reference,
  and fails on any site outside the read-and-reasoned allowlist; a second
  test fails if `staleConfirmedError(` is ever built outside
  `transport.ts`. Paths are normalised to `/` before comparing.

### R9 red drills (guards broken on purpose, files restored byte-exact)

Baseline SHA-256 recorded before drilling; `sha256sum -c` OK after every
restore. Repository timeouts throughout, `--maxWorkers=3`.

1. **Strict origin pre-check restored** (`providerClient.ts`, P2 as
   shipped): 4 failed — the still-allowed `configured-provider-schedule`
   table cases across all four run kinds; the inventory test additionally
   failed its 2 refusal tests on the reintroduced site.
2. **Stale rethrow removed** (`configured.ts`, P3 as shipped): 4 failed —
   the lapsed configured table cases in the `-t lapsed` slice — plus the
   `credential rotation` boundary case (1 failed / 23 skipped).
3. An earlier drill attempt that failed to match the prettier-formatted
   gate text changed nothing and stayed green; it was discarded and
   re-done on the exact current text above.

### R9 verification (kubuntu, repository timeout, `--maxWorkers=3`)

- `modelApiProviders` (99, incl. the 70-case table),
  `confirmedDispatchInventory` (3), `copilotClient`: **153 passed**.
- `modelApiClient`, `configuredProviders`: **99 passed**, 1 failed — the
  `pins a loopback HTTP request` case times out at 5000 ms. It fails
  identically on the clean base worktree (HEAD `e56467e87` plus a
  node_modules symlink, same sandbox): loopback TCP is blocked here, and
  that test passes no confirmation, so the changed lines are no-ops for
  it. Named for the lead to run outside the sandbox, as in R8.
- `npm run typecheck`: clean. ESLint `--max-warnings=0` and Prettier
  `--check` on all changed files: clean (17 lint diagnostics fixed in the
  new/edited code, all `unicorn/*` and `prefer-const`). `check:l10n`:
  14 UI tables, 14 usage tables, 0 problems (no string added or changed).
- Final `npm run build`: extension **550.1 / 600 KiB**; Model API
  **517.5 / 525 KiB** — unchanged from R8, no budget raised.
- No new dependency, no widened guard, no browser, live/paid call,
  credential read, install, push, rebase or merge.

No RVCM1062H finding remains open; no external blocker was encountered.

## R10 — headless output cap and complete dependents (kubuntu, 2026-10-11)

The owner's decision keeps headless exec at **at most 32,768 output tokens**,
or the selected record's smaller maximum. Its ledger reserves the worst case
before every dispatch; raising that reservation changes which existing money
budgets can run. VS Code and interactive ACP retain the documented record
maximum (131,072 for Muse Spark), clamped by their interactive budget.

### Reproduction and repair

At untouched HEAD `c113d3aae`, whole `execRun`, `execFetch` and `execClient`
files returned **51 failed / 89 passed** (48 failures in execRun, three in
execFetch); the separate confirmed-dispatch inventory returned **3 passed**.
Together: **51 failed / 92 passed**. No timeout override or model call.
The refusing check was `execFetch.ts:34`, the schema's
`z.lte(MODEL_API_MAX_OUTPUT_TOKENS)`; its `safeParse` refusal returned
`request_shape` before any dispatch. The shared entry supplied 131,072 while
the schema, ledger shape check (`runLedger.ts:188`) and start reservation
(`runExec.ts:986`) still used 32,768.

`resolveExecOutputCap` in `src/runtime/exec/runLedger.ts` is the single cap
calculation: the smaller of the selected policy maximum and exec's ceiling,
refusing invalid maxima or anything below exec's existing 16-token minimum.
`runExec` caches it once per run. Qualified records bind it during their
accounting-wrapped resolution, before start admission; bare Meta models bind
from that model's policy. The four readers are:

- **Body:** `runtime/backends.ts` supplies the run's callback to
  `ModelApiHost.outputCap`, with the exact resolved record.
- **Schema:** `execFetch` builds its request validator at request time against
  `ledger.outputCap`, after selection has resolved (never at transport setup).
- **Ledger:** `admitResponse` checks `m > outputCap()` against the same getter supplier.
- **Start reservation:** `runExec` calls `previewResponseReservation`, which
  quotes a separate undispatched ledger with the same `ledger.outputCap`.

The documented worst-case quote is unchanged for Meta: 0.108135 USD on the
contributor tier at 32,768 tokens. The actual real-runtime/ACP/manager/client
D1 run is admitted and asserts its request body carries 32,768 even though
that model's record maximum is 131,072. Every one of the **669 catalogue
model fixtures** also passes through the real runtime manager and client:
body cap, schema admission/refusal before ledger access, ledger ticket cap,
and the actual start-reservation helper agree; smaller records use their own
maximum. Six invalid/minimum fixtures exercise refusal, with no live metadata.

The first repaired exec replay revealed two further branch regressions:
D3 and D25 wrote their files but reported empty `filesChanged`. A preview
announces a tool before full arguments exist, with empty locations. ACP now
carries locations when complete arguments promote that preview, and the exec
client refreshes tracked edit locations before completion. No preview payload
reaches its sink. The new client regression and the unchanged real-stack edit
cases prove the complete file metadata reaches the result.

The inventory's diagnostic prints the exact unlisted file/line/text and tells
an integrator to add three narrowly reasoned release-train entries: two
minimum-output refusals validate model output, and a rethrow after a rate-limit
notice preserves an upstream failure. Those sites do not exist on this branch;
no allowlist entry was added for them here.

The argument-preview reference now has its own complete sentence,
`toolArgumentPreviewDescription`, translated in all 14 UI tables, with the
reference regenerated. CHANGELOG, README, PLAN D86/M106 and this record name
the headless ceiling and reservation reason; the 131,072 claim is scoped to
VS Code/interactive ACP (or the explicitly separate developer capture).
The M106 roadmap entry and generated ROADMAP carry the corrected limit.

The complete dependent replay also caught 29 packaged stdio failures: the
new translation key followed the truncation key in the JSON tables, while
English put it before that key. The archive restores English key order and
its boundary compares the complete serialized tables. Aligning all 14 source
tables to English's order restored all 29 stdio cases, without changing their
assertions or translated values. This was a branch defect, not a base red.

### Deliberate red drills

Repository defaults throughout; only the drills select focused tests. Every
mutated source was restored byte-exact and its SHA-256 rechecked.

| Broken reader/guard                                        | Observed failures                              |
| ---------------------------------------------------------- | ---------------------------------------------- |
| Runtime body supplier asks 131,072                         | 2 fixture cases failed                         |
| Schema accepts up to 32,768 despite a smaller bound record | 2 fixture cases failed before-ledger assertion |
| Ledger compares against fixed 32,768                       | 2 fixture cases failed                         |
| Start reservation asks fixed 32,768                        | 2 fixture cases failed                         |
| Minimum/integer refusal removed                            | 6 cases failed                                 |
| ACP promotion locations removed                            | D3 and D25 failed                              |
| Exec edit-location refresh removed                         | 1 client case failed                           |
| Help summary reverted to the pending label                 | 1 reference case failed                        |

Restoration hashes: runtime backends `83d9269e…89902eb`, exec fetch
`a31f236c…5175242`, ledger `a9650ff3…7456f3eb`, ACP translator
`f7bff799…95db78`, exec client `f6a8ac8d…ad286`, feature catalogue
`56de597d…2dd8998`. The first promotion drill did not match Prettier's
indentation and made no change; it was corrected to the exact source text
and produced the two failures above.

### Verification

Final whole exec files: **816 passed**, including all 669 catalogue fixtures,
six minimum cases and the new edit-promotion regression. The inventory, ledger
and reference-detail files add **43 passed**: **859 passed, zero failures**
across the six owning files, using repository timeouts and three workers.
The same four reproduction files now total **819 passed, zero failures**
(the additional 676 cases are the new regressions).

All five typechecks passed (host, webview, unit, e2e and integration). Scoped
ESLint and Prettier passed; localization reports 14 UI/14 usage tables and zero
problems. Reference is current (77 features); roadmap is current (207 entries);
host API reports zero problems. Knip has only its two existing configuration
hints; jscpd finds zero clones. Production build passes every size, split,
host-global and notice gate: extension **563,348 bytes**, Model API **529,946
bytes**, and headless **102,344 bytes** against its unchanged 102,400-byte cap.
The initial build exceeded headless by 29 bytes; simplifying the pure clamp
and default handling preserved the guards and saved 85 bytes. The final
whole owning suites above passed again after that repair.

The complete related selector spans 1,135 suites for the branch's whole source
diff against `82d50d5e4`, including the shared English-table consumers. The first
17 foreground CLI batches ran at most three complete files each. Repeated cold
setup took about 20 seconds per batch, so the continuation keeps Vitest's public
runner open between three-file batches. It parses the same `vitest related
--run <all changed src files> --maxWorkers=3` options, obtains the complete
related specifications and runs each complete batch through the public
`runTestSpecifications` API. Repository setup, worker isolation, assertions,
timeouts and three-worker limits are unchanged. Its first batch initializes
the ordinary production, visual and browser fixtures required by the full
selection. Final dependent receipts are recorded after that replay.
Aggregate quality remains lead-owned under
the explicit rig/common brief; no gate, cap, baseline or repository timeout
was weakened. No paid/live call, credential read, merge, push or rebase.
