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
  maximum, the same record the host's clamp reads). No lane code names a
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

| Item                       | Verdict                                                                                                                                                                                                                                                                                                                                                                                                                           |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Off means today's bytes | Unchanged: golden requests with the feature off are byte-identical (existing M91 fixtures green, untouched); the new off/on golden run proves the default-on byte diff is exactly `max_output_tokens` 32768 → 131072, nothing else.                                                                                                                                                                                               |
| 6. Previews                | Captured U9 argument bytes drive previews through the unmanaged production path (manager → entry → host → real SSE/transport/parser): snapshots accumulate to the captured length; nothing runs, asks or calls a hook before `.done`; no preview bytes reach replay or requests. R3: declared-tool TEXT now renders from the raw 16-frame capture (see R3 record); the R2 stand-in test below stays as the undeclared-tool guard. |
| 8. Output                  | Meta turns request 131,072, clamped by the budget; a qualified selected record with `output.maxTokens = 65536` requests 65536 through the production path; one continuation follows `max_output_tokens`, then a notice (existing L2 mechanics, unchanged). Calls in a cut-short reply are answered with an error, never run (existing).                                                                                           |

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
test). The output cap binds in all three hosts: it is a request path they
share. The suites above run on kubuntu; Windows/macOS receipts, the
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
