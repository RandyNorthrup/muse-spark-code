# Model API diet (lane MODELAPIDIET)

Worktree `/Users/randy/lanes/MODELAPIDIET`, branch `fix/modelapi-diet`,
base `af67368a22` (release train). No cap, budget-table or gate change
beyond the new chunk's own size row and the pin moving down. No behaviour
change: static imports become `await import()` on paths that already
await, with fail-closed refusals.

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
refusal the user sees, never a silent fallback, never a default):

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
measured 516,264 exactly. `npm run check-bundle-split` exits 0 (69 ok
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

## 6. Review repair (MODELAPIDIETR2, 2026-10-11, macmini)

The missing VSIX allowlist entry is repaired in `691e09966`, which also
replaces both English-only turn-ending errors with `UI_TEXT` values in all
14 translated tables. The Model API bundle tests assert the installed words
for both missing helpers and a throwing preview constructor; missing helpers
still send zero HTTP requests. URL-check failure keeps its existing typed
unavailable result. The packaging native export probe now exercises the
helpers' passing HTTPS and refused loopback URL checks.

`packagedBundles.test.mjs` runs the real production builder, reads every
metafile in `dist/meta/` and `dist/meta-acp/`, normalizes Windows separators,
and follows imports transitively. VS Code roots are the production entries
VSCE actually lists; ACP roots include its production entries and its own
shared package list. No test keeps chunk names. The packager and regression
share `scripts/lib/acpBundles.mjs`; test-owned package fixtures copy that
module, and the usage fixture takes its bundle inputs from the same list.
VSCE inventories actual production outputs in an owned publication tree,
without scanning copied source and test fixtures.

The deliberate missing-line drill fails the assertion naming
`dist/modelApiTools.js`. Checking the original ACP list in that same run
also finds **`dist/pluginHooks.js` and `dist/webFetch.js`**, both repaired by
one membership line each. Restoration is byte-exact, verified with SHA-256:

- `.vscodeignore`: `36cd1e25c49abe3edceb06af5ba6c154436c3d3eb68456f2dbdc844ecd15968f`.
- `scripts/lib/acpBundles.mjs`: `b3ab047e53b16dbb5eeb392015e33448e834c2c7caef3a9527e2a3e744dba3c5`.

The restored packaging guard, deferred-bundle suite and Model API bundle
suite pass together: 139 tests, repository deadlines, three workers. The
first scratch production build lacked the repository's formatter config and
refused stale generated team schemas; copying that real config fixes the
owned fixture. No generator or freshness gate is bypassed.

D6 receipt: 23,433 × 1.15 = 26,947.95 B; rounding to the next 25 KiB
multiple gives 51,200 B (50 KiB), so the new row keeps its correct initial
cap. The 516,267 documentation typo is corrected to 516,264. Localization
removes 108 B of fixed English from `modelApi.js` (516,156 B); the helpers
remain 23,433 B. This additional reduction is recorded separately from the
original 14,419 B diet measurement; no padding or cap change is introduced.

## 7. Continuation re-verification (MODELAPIDIETR2, 2026-10-11 evening, macmini, this engine)

Independent re-run of the uncommitted work on the same worktree, repository
timeouts, `--maxWorkers=3`, one command at a time: `packagedBundles` 1/1;
red drill (line removed) fails naming exactly `dist/modelApiTools.js`;
`.vscodeignore` restored to SHA-256
`36cd1e25c49abe3edceb06af5ba6c154436c3d3eb68456f2dbdc844ecd15968f`
(zero diff). Production `npm run build` exits 0: `dist/modelApi.js`
516,156 B, `dist/modelApiTools.js` 23,433 B. Packager lister: 375 files
with `dist/modelApiTools.js` IN — the same total as the review's 375
without it because the two trees differ by exactly one file each way: the
Kubuntu tree had its locally built `native/linux/x64/muse-created` (the
production build compiles the current arch's helper), while this Mac tree
has none of the four allowlisted binaries (`native/linux` is empty, no
compiled `muse-dictate`) and adds the helpers chunk. Every other expected
chunk (`modelApi.js`, `hookRuntime.js`, `pluginHooks.js`,
`modelApiHooks.js`, `modelApiCodeIntel.js`) is present.
`moduleExports` 88/88 including the new `modelApiTools.js` case.
`deferredBundles` + `modelApiBundle` 138/138; `modelApiHost` 670/670;
`vsixPackaging` 95/95; ACP suites `acpPackageFixtures`,
`resourceAcpPackaging`, `teamRuntimePackage`, `integrationPackaging`,
`modelApiHooks`, `modelCallHooks` all green; `usagePackaging` 12/12 with a
clean `HOME` (the shared `~/.npm` cache has root-owned files, so `npm pack`
fails EPERM under the normal `HOME`; two further 5 s timeouts under load
12–15 pass alone). `npm run typecheck` exits 0; ESLint 0 warnings on all
changed files; Prettier clean; `check:l10n` 0 problems. Full
`package-vsix.mjs` and `package-acp.mjs` cannot run on this rig: the Linux
`muse-created` helpers and the compiled Darwin `muse-dictate` binary are
absent (built in CI), a pre-existing limit unrelated to this change.

## 8. Round-3 fixes (MODELAPIDIETR3, 2026-10-11 night, macmini, this engine)

Review RVMODELAPIDIETB left one P2 and one P3. Both are fixed and shipped
here; golden and M75 files untouched (byte-identical per the review, and no
R3 commit touches them). No hub file changed (constants, l10n tables,
featureCatalog, protocol untouched), so no HUB integration run falls on
this lane. Branch `fix/modelapi-diet`, six R3 commits on top of 90e8338c1.

### P2 — one registry for every filename-loaded chunk

`src/shared/lazyBundleFiles.ts` (new) exports the single table
`LAZY_BUNDLE_FILES`: 92 dist paths (90 basenames; `whatsNew.js` and
`reportingDestinations.js` exist both at top level and under
`dist/webview/`), each with its `vsix` (.vscodeignore) and `acp`
(scripts/lib/acpBundles.mjs) flags. Every basename occurs in `src`
outside the registry itself (cross-checked); seven entries are ACP-only
(`acp.js`, `acpPlaybook.js`, `acpQuestions.js`, `runtimeAccounts.js`,
`runtimeQuestions.js`, `sharingRuntime.js`, `fontsInstall.js`, the last
excluded from the VSIX by design); 51 ship in both packages, 34 VSIX
only. No src loader was re-pointed: the registry is the authority by
test enforcement, which keeps the hub files untouched.

- `test/unit/lazyBundleFiles.test.ts` (new, 2 tests, no build): the table
  is well-formed, and a comment-aware sweep of `src/**/*.ts` fails any
  string or template that names a dist file outside the table — `dist/`
  path literals anywhere, bare `x.js` literals on loader-context lines
  (`dist`, `distDir`, `bundlePath`, `bundleFile`, `BUNDLE_FILE`,
  `__dirname`, `Worker`, `loadBundle`, `requireFile`, `joinPath`,
  `asWebviewUri`, `loadModule`, `path.join/dirname/resolve`,
  `require('`, …), and dynamic `dist/${name}.js` templates. Node-module
  paths (`@muse-code/sdk/dist/…`) are excluded. The one computed adapter,
  `configured.ts` (`catalogFile.replace(/\.json$/, '.js')` for
  `providerCatalog.js`), loads a registry member, verified by the
  packaging half.
- `test/unit/packagedBundles.test.mjs` (+2 tests): every registry entry
  is now a traversal root independent of either package inventory, and
  two direct assertions check each entry against the VSIX allowlist, the
  agent package list, and the production build outputs (metafiles united
  with the files on disk, because `dist/providerCatalog.js` is written by
  `scripts/build.mjs` itself and has no metafile entry — found while
  proving the new assertion, a test artifact only, the file ships).

Drills (all restored byte-exact, SHA-256 verified):

- Allowlist removal: `!dist/tab.js` renamed in `.vscodeignore` (SHA
  `36cd1e25…ecd15968f` before and after). Both the old traversal and the
  new registry assertion fail naming exactly `dist/tab.js` — the review's
  `VSIX: []` hole is closed.
- Rogue loader: `src/zzDrillRogue.ts` with
  `path.join(dir, 'rogueBundle.js')` fails the scan test naming exactly
  `src/zzDrillRogue.ts:3 names rogueBundle.js`; file deleted after. (The
  first drill shape, a bare literal with no loader context, correctly did
  not fire; widening the hints to `path.join`/`require('` caught the
  realistic adapter shape with zero false positives on the tree.)
- Unbuilt entry: `neverBuiltDrill.js` added to the registry fails all
  three packaging assertions naming `dist/neverBuiltDrill.js`; registry
  restored to SHA `e2ce5e60…0beb9d8b5a463a`.

### P3 — the promised log details exist, scrubbed

`src/core/backends/modelapi/ModelApiHost.ts`: `hookCallFields`,
`argumentPreviewAssist` and the same-class sibling `checkedPageUrl`
(which funnels into `MODEL_TEXT.webFetchUnavailable`, "(its log says
why)") log through one shared `helpersFailure` line —
`modelApiTools.js failed: <class>` — before throwing the installed
sentence (both throws chain `{ cause: error }`, required by
`preserve-caught-error`) or refusing closed. Only the failure's class is
logged, never the message text: the missing-module error carries the
absolute chunk path and a constructor error can carry the call's own
fields, and the sabotage tests prove both stay out. Sibling sweep: the
other eleven "The log has the details" sentences belong to other lanes'
host/runtime loaders, which log fixed words through `lazyBundleLoader` /
`fixedMessageLog` with their bundle loggers; none is this lane's to
change.

- `test/unit/modelApiBundle.test.ts`: the missing-chunk test asserts the
  warn line names `modelApiTools.js` and never the scratch folder's
  absolute path; the sabotaged-constructor test throws
  `sabotaged preview canary-PROMPT-TEXT /tmp/canary-path` and asserts the
  canary never reaches the log; the closed-fetch test asserts the same
  for `sabotaged check`.
- Drill: removing the three `helpersFailure` calls fails exactly the
  three log-asserting tests; `ModelApiHost.ts` restored to SHA
  `6dc25102…cf048030edd8b1400`.
- Diet pin: the shared line costs measured bytes (one site each, no
  triplication, no new strings beyond the chunk name). The `modelApi`
  test-bundle pin moves 516,264 → 516,373 (+109 B) to the measured value
  exactly, with the R3 reason recorded beside it in
  `test/unit/deferredBundles.test.ts`. D6's 537,600 B production cap is
  untouched (21,264 B headroom). **Lead: this pin move is the one
  guard-adjacent decision to ratify or revert — shrinking further would
  need dropping a lead-ordered log site.**

### Byte rows (production `npm run build`, exit 0, this rig)

- `dist/modelApi.js`: **516,336 B** (R2: 516,156; +180 B P3 diagnostics).
- Lane saving vs the original diet base af67368a22 (530,683 B):
  **14,347 B** (14,419 diet + 108 R2 localization − 180 R3 diagnostics).
- Against the release-train pin 532,537 B: 532,537 − 516,336 =
  **16,201 B** arithmetic under — not a measured saving (different source
  revision; `declaredPreviewFields` is absent here, as the review notes;
  integration must remeasure before setting the train pin).
- Unchanged, byte for byte with the review's R2 table: `extension.js`
  563,929, `headless.js` 98,360, `runtimeEngine.js` 642,596, `uiText.js`
  96,916, `modelApiTools.js` 23,433. Budgets: modelApi.js 504.2 KiB of
  525 KiB; every other size row, split guard, host global and notice
  green in the same build.

### Verification (repository timeouts, `--maxWorkers=3`, one at a time)

- `npm run typecheck`: exit 0, all projects. Changed-file ESLint: 0
  errors. Prettier: clean. `npm run check:l10n`: 0 problems (1,545
  source files; no UI string added or changed).
- Green: `lazyBundleFiles` 2/2, `packagedBundles` 3/3, `modelApiBundle`
  20/20, `modelApiHost` 670/670, `deferredBundles` + `modelApiHooks` +
  `modelCallHooks` 140/140, `usagePackaging` 12/12 (clean HOME; the
  shared `~/.npm` cache has root-owned files, as in R2),
  `vsixPackaging` + `acpPackageFixtures` + `resourceAcpPackaging` +
  `teamRuntimePackage` + `integrationPackaging` green,
  `modelApiGoldenRequests` + `metaGolden` + `modelApiHostedSearch`
  199/199, `lazyBundle` + `configuredProviders` except below.
- Pre-existing, base-identical, not this lane: `acpAgent` 1 failure and
  `runtimeChatGpt` 29 failures reproduce exactly on the untouched base
  files (checked out 90e8338c1 versions, ran, restored) — this headless
  rig has no unlocked credential store, so the ChatGPT status path maps
  to `planUi.retry` instead of the store-unavailable message.
  `configuredProviders` loopback test cannot run here at all: loopback
  bind fails EPERM in this sandbox (probed directly), the other 39 pass.
  The review's four rig-limited files (`judgeFences`, `usageIntegration`,
  `runtimeChatGptPackage`, `execStdio.e2e`) were not re-run here.
- Real release VSIX/ACP not built here (same pre-existing limit as the
  review: no Linux `muse-created` helpers, no compiled Darwin
  `muse-dictate`). **Lead, on a rig that has them:** `npm run package`
  (builds production then `node scripts/package-vsix.mjs`) and
  `npm run package:acp`, install the VSIX, run a Model API turn through
  first Tab use, then repeat the missing-chunk probe (remove
  `dist/modelApiTools.js` from the staged tree) and confirm the turn
  fails with the installed sentence plus the `modelApiTools.js failed`
  log line.
