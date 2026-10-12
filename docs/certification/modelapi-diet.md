# Model API diet (lane MODELAPIDIET)

Worktree `/Users/randy/lanes/MODELAPIDIET`, branch `fix/modelapi-diet`,
base `af67368a22` (release train). No cap, budget-table or gate change
beyond the new chunk's own size row and the pin moving down. No behaviour
change: static imports become `await import()` on paths that already
await, with fail-closed typed refusals.

Production `npm run build` on this rig: `dist/modelApi.js` is **530,683 B**
(cap 537,600 B). The pin in `test/unit/deferredBundles.test.ts` reads
530,883 B.

## 1. The 25 largest inputs of `dist/modelApi.js` (esbuild metafile)

Bytes are `bytesInOutput` from `dist/meta/modelApi.json`. "First request"
means the first request of a plain text turn: building the body, the
reservation, the send, and the hook payloads around it.

| #   | Bytes   | Input                                            | Needed for the first request?                                                                                                                               |
| --- | ------- | ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | 256,203 | `src/core/backends/modelapi/ModelApiHost.ts`     | Yes: the host itself (slices carve helpers out of it)                                                                                                       |
| 2   | 45,041  | `src/shared/constants.ts`                        | Yes: model text, prices, limits                                                                                                                             |
| 3   | 24,202  | `src/core/backends/modelapi/tools.ts`            | Yes: the request's tool list (`toolDefinitions` is sync)                                                                                                    |
| 4   | 12,859  | `src/core/backends/modelapi/transport.ts`        | Yes: the HTTP send                                                                                                                                          |
| 5   | 9,321   | `src/core/backends/modelapi/client.ts`           | Yes: the request loop                                                                                                                                       |
| 6   | 7,539   | `src/core/paid/paidAuthority.ts`                 | Yes: the paid gate and reservation (money: stays sync)                                                                                                      |
| 7   | 6,439   | `src/core/backends/modelapi/instructions.ts`     | Yes: the system prompt                                                                                                                                      |
| 8   | 6,269   | `src/core/browser/browserTool.ts`                | Yes in part: tool definitions ride the sync list; runner split out of box                                                                                   |
| 9   | 6,248   | `src/core/backends/modelapi/goals.ts`            | Yes in part: `GOAL_TOOL_DEFINITIONS` rides the sync list; split out of box                                                                                  |
| 10  | 5,485   | `src/core/backends/modelapi/shellSyntax.ts`      | Yes: sync permission checks                                                                                                                                 |
| 11  | 5,477   | `src/core/backends/modelapi/observationPack.ts`  | Yes in part: `RECALL_TOOL_DEFINITION` rides the sync list; split out of box                                                                                 |
| 12  | 5,036   | `src/core/backends/modelapi/sessionStore.ts`     | No, but sync-adjacent: `headerOf` runs in `queueSave`'s sync prefix and `persistBudgetReservation` sits by the reservation; slice 2 after the turn analysis |
| 13  | 4,786   | `src/core/context/workspaceContext.ts`           | Yes: context for the system prompt                                                                                                                          |
| 14  | 4,308   | `src/core/schedules/sessionOwner.ts`             | Constructed in the host constructor (`new SessionOwner`, sync); lazy init too invasive for this box                                                         |
| 15  | 4,207   | `src/core/backends/modelapi/mcp/functions.ts`    | Yes in part: MCP definitions ride the sync list                                                                                                             |
| 16  | 3,938   | `src/core/backends/modelapi/subagentTools.ts`    | Yes in part: `SUBAGENT_TOOL_DEFINITIONS` rides the sync list; split out of box                                                                              |
| 17  | 3,876   | `src/host/backend/modelApiEntry.ts`              | Yes: the bundle's entry                                                                                                                                     |
| 18  | 3,661   | `src/core/backends/modelapi/argumentPreview.ts`  | **No**: display-only streaming previews → slice 1                                                                                                           |
| 19  | 3,566   | `src/core/backends/modelapi/imageGeneration.ts`  | No, but shared: `dist/extension.js` carries it for the IDE server (ACTIVATION_ALLOWED), so it cannot join an exclusive deferred chunk                       |
| 20  | 3,443   | `src/core/backends/modelapi/permissionPolicy.ts` | Yes: sync consent checks                                                                                                                                    |
| 21  | 3,421   | `src/core/codeIntel/definitions.ts`              | Yes in part: definitions ride the sync list                                                                                                                 |
| 22  | 3,410   | `src/core/backends/modelapi/sessionBudget.ts`    | Yes: the budget gate (money: stays sync)                                                                                                                    |
| 23  | 3,252   | `src/core/context/recordingReader.ts`            | Yes in part: `instructions.ts` reads it for the system prompt (sync)                                                                                        |
| 24  | 3,214   | `src/core/web/fetchFailure.ts`                   | **No**: web-fetch tool execution only → slice 1                                                                                                             |
| 25  | 3,171   | `src/core/backends/modelapi/memoryTools.ts`      | Yes in part: `MEMORY_TOOL_DEFINITIONS` rides the sync list; split out of box                                                                                |

Just below the top 25, also moved in slice 1 (all modelApi-exclusive,
all async-only): `src/core/backends/modelapi/modelCallHooks.ts` (1,845;
Pre/PostLLMCall field builders, called from async `beforeModelCall`,
response handling and compaction) and `src/core/web/pageUrl.ts` (660)
with #24 (the fetch URL checks, called from async web-fetch tool
execution). `src/core/web/publicAddress.ts` (1,734) was measured
modelApi-exclusive but stays: `src/host/web/pinnedRequest.ts` reads
`addressFamily` for every request's SNI, so it is genuinely first-request
(the split gate caught this: `dist/modelApi.js carries publicAddress.ts`).
Slice-1 gross: 3,661 + 3,214 + 1,845 + 660 = 9,380 B of inputs, plus the
`WEB_FETCH_MODEL_TEXT` block the fetch failures owned, for 14,416 B total.

## 2. The move (slice 1)

New deferred chunk `dist/modelApiTools.js` from
`src/core/backends/modelapi/modelApiToolsEntry.ts`, following the
`dist/reviewer.js` / `dist/modelApiCodeIntel.js` pattern: the entry
re-exports the values, re-exports `setUiText`, and every call site
installs `UI_TEXT` with `uiLocale()` before use
(`foreignHooksEntry.ts:478`, `codeIntelEntry.ts:15` precedent).

Failure handling (the brief's rule: a chunk that fails to load is a
typed refusal the user sees, never a silent fallback, never a default):

- URL checks: fail-closed. An unchecked URL is never fetched: the call
  returns `webFetchRefusal` with the existing `kind: 'unavailable'` +
  `MODEL_TEXT`/`UI_TEXT.webFetchUnavailable` pair (the
  `lazyWebFetcher` `unavailable()` precedent, no new strings).
- Hook call fields / previews: the turn fails with an error naming the
  chunk (`the modelApiTools.js bundle could not be loaded`, the
  `reviewerEntry.js` `throw` precedent at `ModelApiHost.ts:8595`).

Money/order notes: `budgeted()` (the pure `reserveRequest` computation)
and the consent/permission modules are untouched. `beforeModelCall`
already awaits before and after the moved call (`selectToolsForTurn`,
`runHooks`), runs before `this.sending(body)` takes the reservation on
a rebuilt body, and carries no price input (prices stay sync via
`requestImageCount`/`selected.price`). The fetch check sits before an
already-awaited `judge()`, so no gate/action pair newly shares an
await.

## 3. Before / after (bytes, production `npm run build`)

Base `af67368a22` (pristine worktree, same rig) vs lane, `npm run build`
exit 0 both sides:

| Bundle                  | Before  | After   | Delta   | Budget  |
| ----------------------- | ------- | ------- | ------- | ------- |
| `dist/modelApi.js`      | 530,683 | 516,264 | −14,419 | 537,600 |
| `dist/modelApiTools.js` | — (new) | 23,433  | +23,433 | 51,200  |
| `dist/extension.js`     | 563,929 | 563,929 | 0       | 614,400 |
| `dist/headless.js`      | 98,360  | 98,360  | 0       | 102,400 |
| `dist/runtimeEngine.js` | 642,596 | 642,596 | 0       | 896,000 |

The `modelApi.js` pin in `test/unit/deferredBundles.test.ts` moves to the
measured 516,267 exactly. `npm run check-bundle-split` exits 0 (69 ok
lines); `npm run check-bundle-size` passes with the new 50 KiB row.

## 4. Left alone, and why

- Tool _definitions_ (`GOAL_`, `MEMORY_`, `SUBAGENT_TOOL_DEFINITIONS`,
  `runChecksDefinition`, `LEGAL_SCAN_*`, `RECALL_TOOL_DEFINITION`, MCP and
  browser definitions): `toolDefinitions()` is sync per request.
- `sessionBudget.ts`, `paidAuthority.ts`: the budget gate and reservation
  stay in one sync turn (money).
- `permissions.ts`, `permissionPolicy.ts`, `commandRules.ts`,
  `shellSyntax.ts`: sync consent checks.
- `transport.ts`, `client.ts`, `sse.ts`, `ndjson.ts`, `schemas.ts`,
  `instructions.ts`, `modelPolicy.ts`: the send path and system prompt.
- `sessionStore.ts` (`headerOf` in `queueSave`'s sync prefix,
  `persistBudgetReservation` beside the reservation): needs the
  reservation-turn analysis; candidate for a follow-up slice.
- `SessionOwner`, `MediaBudget`, `AutoCompact`, `VerifyLedger`,
  `DiagnosticsHistory`: constructed in the host constructor / as field
  initialisers (sync); lazy init is a bigger refactor.
- `overflow.ts` (`classifyContextOverflow`): runs on the first response;
  a missing chunk would break plain turns.
- `imageGeneration.ts`: shared with `dist/extension.js` (IDE server), so
  it cannot join an exclusive deferred chunk.
- `pacing.ts`: values imported by `transport.ts` (send path).
- `recordingReader.ts`: read by `instructions.ts` for the system prompt.
- `workspaceContext.ts`, `customAgents.ts`, `skills.ts`, `rules.ts`:
  first-request context.
- `modelCallHooks.ts` is on the first-request path as data (hook
  payloads), but its path is already async (`beforeModelCall` awaits
  before and after; the reservation is taken later on a rebuilt body, and
  it carries no price input), so deferring it changes no ordering.

## 5. Red drills (all restored byte-exact, SHA-256 verified)

- A: `hookCallFields` catch returns `undefined as never` instead of
  throwing → `refuses the turn naming the helpers chunk when it is
missing` fails (turn fails without the named refusal). Restored.
- B: `argumentPreviewAssist` catch returns `undefined as never` →
  `fails the turn naming the chunk when previews cannot start` fails.
  (First attempt as "construction outside try" broke the transform;
  redone as the fallback return.) Restored.
- C: `checkedPageUrl` catch returns a fabricated `{ ok: false }` failure
  → `refuses the fetch closed when the URL check cannot load` fails (it
  expects the `unavailable` refusal). Restored.
- Final `sha256sum` of `src/core/backends/modelapi/ModelApiHost.ts`
  (`8b403f10…`) matches the baseline taken after the last intended edit
  and before any drill.
