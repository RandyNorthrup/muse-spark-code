# RLF-M104D — M104 lane D, the portable webview, ported onto int

Base: int/recovery `94b15b376`. Sources: `lanes/m104b-reviewed` (merged
first, `--no-ff`) and RLM104's lane D at `4ecbbd9cc5`, ported area by area
per `docs/certification/cc-rlm104.md` Remaining item 3, with its two
required changes. Environment: macmini (macOS), Node 24; tests run
directly in the worktree. No push, rebase, paid call, live model call or
credential-store suite.

## The lane B merge (`cbbebff514`, `889591a855`)

The brief said lane B merges cleanly; on this base five files conflicted.
Resolved minimally: README command-list union (`watchdog` + `panel`),
`build.mjs` metafile-write union, generated reference and host-API
records regenerated. Reconciled for int: `runtimeFeatures`'
`usageInsights` returns the honest unavailable `TraceInsights`;
`reportFallback.js` joins the ACP package (the panel runs the controller
in the agent) with the lazy registry regenerated; the panel's and two
runtime-only English groups move to the runtime uiText region so
`dist/uiText.js` holds its 125 KiB budget (base 124.9 KiB, merged first
measured 125.3 KiB over). The v1.1 panel lock was re-frozen at
`mhp/1.5.0` (`80d04e5d…`): the snapshot diff is int's newer webview
messages only, as at earlier joins.

## Area 1 — bridges, fallbacks, presentation pages (`18e24891dc`)

Ported: `src/webview/bridges/{companion,companionUi,failure,moduleLoader,
native,select,state,types,uiResponder,vscode}.ts`, `src/webview/fallbacks/**`
(Confirm, Dialog, DiffPage, Input, ManagerPage, OpenExternal, Picker,
SettingsPage, StatusStrip, TerminalOutput, Toasts, Walkthrough, services),
`src/webview/presentation/**` (PlanPage, RoleTrafficPage, presentationUi,
presentationEntry), `src/shared/hostApi/{fallbackUi,portableAssets}.ts`.

Changed on the way in:

- Presentation record types live in `src/shared/presentationRecords.ts`;
  RLM104 put them in `src/core/presentation/`, which the webview project
  must never import.
- The presentation entry lives in the webview, not `src/shared/browser/`
  (it imports CSS and JSX; int's host and integration projects include
  `src/shared/**`).
- `PRESENTATION_REQUEST_TIMEOUT_MS` (30 s, a failure-wait limit) replaces
  RLM104's `RUNTIME_PANEL` object, which int's lane B split apart.
  `PresentationState`/`PresentationRequest` aliases are restored for
  their first reader (cc/rlm104 removed them as unread).
- RLM104's `portablePaid.ts` is **not ported**: it refuses a quote above
  a budget the person never set (pre-D208) and has no reader in lane D;
  int's paid path is `PaidUseConsent` (cc-rlm104's direction).
- 13 new strings (`presentationRolesTitle`, `presentationTrafficTitle`,
  `fallback*`) in English and all 14 tables, translations from RLM104's
  tables.

## Area 2 — entries, theme through M114, the portable build (`caac3c838`)

- `chat.tsx` extracts the chat mount from `main.tsx` over any
  `HostBridge`, on int's current body (the `reportOpening` dispatch
  included); `main.tsx` passes VS Code's bridge. `selectionQuote.ts`
  extracts App's transcript-quote rule. `portable.tsx` mounts chat and
  Tasks on `selectBridge` with the companion UI; the estimator is refused
  off-wire with an immediate answer. `whatsNew/portable.ts` rides
  `selectWhatsNewBridge`.
- **Brief change 1 (theme through M114):** a new MHP panel `theme` frame
  (`panelThemePayloadSchema`) feeds `panelThemePort`
  (`src/webview/bridges/theme/panelThemePort.ts`), which maps each
  `--muse-*` token onto the `consumers.json` host role with the same
  suffix and mounts through `loadThemeBridge` before the chat paints.
  RLM104's `portableTokens.css` is not ported; raw paint stays only in
  generated token files. `parseMhpPanelEnvelope` admits the frame
  `toPanel` on every surface kind that takes host messages (What's New
  takes none) — `14aab693f`.
- **Brief change 2 (startup measurement):** RLM104's
  `portableStartup.mjs`/`portableBridgeSetup.mjs` (headless Chrome over
  hand-written transports) are not ported. Startup is accounted by the
  static closure int uses for VS Code: the portable entry's static
  imports ∪ the bridge's ∪ the theme entry's ∪ the classic loader.
  Measured on the first ported build (2026-10-30): startup **844,604
  bytes (824.8 KiB)**, total portable JS **1,437,313 bytes (1403.6
  KiB)**; budgets **950** and **1625 KiB** (measured +15%, next 25 KiB,
  D6), enforced in `npm run build`. A browser timing through the real
  carrier waits for lane C's page server; this rig also cannot start
  Chrome (macOS lane limit), so no `ui:look` pictures exist for this
  lane — the lead runs the look outside the sandbox.
- Build: the independent portable graph `dist/webview/portable/`
  (main, whatsNew, presentation, fallbacks, bridge, loader +
  `modules.json` manifest). Split guards keep portable-only sources out
  of VS Code's graph and fallback/presentation surfaces out of portable
  startup. The lazy registry excludes the browser graph (never loaded by
  file name from Node). English fit by weight: `referenceCliOptions` and
  `cliHelp` move to the runtime uiText region and the fallback and
  presentation titles to surfaces; no budget was raised.
- The ACP package ships `dist/webview/portable/` (`c5f5b2830`); the VSIX
  allowlist does not name it (VS Code never serves the portable graph).

## Area 3 — host actions (`c72be28b8`)

`HOST_ACTIONS` gains `showWalkthrough`, `showRoles`, `showPlans`. VS Code
handlers: the existing walkthrough command, Models & Agents, and the
conversation controller's own saved-plans list (the runtime panel runs
the same controller; its other unlisted actions keep the said
not-available refusal). The v1.1 lock was re-frozen again (`85f8fd4e…`):
the snapshot diff is exactly the three actions and the theme frame.

## Catch classification (`88f8bb82e`)

Every new catch is NARROW or REPORTED (rule 18): carrier rejections are
tested by `isCarrierFailure` (fixed MHP code words only), bridge
failures record through `onError` ports, clipboard and popup refusals
test their named DOMExceptions, the loader rethrows after showing.
`showBridgeFailure` joins the inventory's fixed-vocabulary record calls
(verified by reading its body). Webview counts match the baseline
(SWALLOW 9, GENERIC 33, CLEANUP 14); no baseline was regenerated.

## Drills (break, non-zero exit, restore byte-exact, green)

| Gate / suite | Break                                           | Result                                                                                    |
| ------------ | ----------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `check:mhp`  | one hex digit of the v1.1 lock digest           | `MHP_VERSION_LOCK: v1.1`, exit 1; restored, exit 0                                        |
| bundle size  | `PORTABLE_STARTUP_BUDGET_KIB` 950 → 100         | `OVER portable startup resources: 824.8 KiB (budget 100 KiB)`, exit 1; restored, exit 0   |
| bundle split | static `import './fallbacks'` in `portable.tsx` | 16 problems, `Portable startup carries deferred surface …`, build exit 1; restored, green |

## Suites

- `bridgeState` + `bridgeFailure` (ported, real code): 4/4.
- `panelThemePort` (new): frame→role mapping, system-mode start, invalid
  frames ignored — 3/3.
- `selectionQuote` (new): one live row, cross-row and empty refusals — 3/3.
- `mhpContract` + `mhpPanelContract` (theme admission cases added):
  61/61; with `wireEntry` 62/62 earlier in the lane.
- `packagedBundles` + `packageStage`: 14/14.
- RLM104's `fallbackAccessibility` and `portablePageSecurity` suites are
  not ported: the first drives the excluded hand-written bridge setup,
  the second tests `runtime/panel/portablePage`, which is lane C's page
  server. Both belong with lane C's carrier.

## Gates (final tree; exit codes)

Recorded in the lane's final message; every gate below was run on the
final tree: format, lint, typecheck, check:l10n, check:reference,
check:host-api, check:mhp, check:plan, check:roadmap, check:catches,
check:tokens, deadcode, cycles, duplication, build.

## Not done here (by the brief's own boundaries)

- Lane C's companion MHP routes and page server (the carrier that serves
  the portable page and relays theme frames to a browser); the runtime
  presentation serving (`presentationViews`/`sharedPages` equivalents)
  belongs with lanes B/C remainder in cc-rlm104 items 1 and 4.
- Browser startup timing and `ui:look` pictures (Chrome cannot start on
  this rig; static closure accounting stands in, per the brief).
- No CHANGELOG entry: nothing a person sees changes yet (no native host
  or companion carrier ships the portable page), as cc/rlm104 recorded
  for its areas.

## Commits

| Commit       | Area                                                                 |
| ------------ | -------------------------------------------------------------------- |
| `cbbebff514` | merge of `lanes/m104b-reviewed` (`--no-ff`) with minimal resolutions |
| `889591a855` | v1.1 lock re-freeze on the merged tree                               |
| `18e24891dc` | bridges, React fallbacks, presentation pages                         |
| `caac3c838`  | portable entries, M114 theme, portable build and budgets             |
| `c72be28b8`  | the three host actions and VS Code handlers; lock re-freeze          |
| `2bcbe9e5f`  | one fallback-ui method type, validated replies, knip entries         |
| `14aab693f`  | theme frames admitted `toPanel`                                      |
| `c5f5b2830`  | portable graph in the ACP package                                    |
| `88f8bb82e`  | catch classification; host-API record; PLAN status                   |
