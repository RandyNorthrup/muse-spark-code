# DIET1 — Webview startup and deferred headroom

2026-10-06 · macmini · `perf/bundle-diet` · baseline main `e56b795a1`
(0.14.2). The lane brief and shared rules authorize scoped rig checks and
prohibit aggregate quality, public network, live/paid calls, merges and pushes.
No dependency, runtime command, setting, wire shape or provider capability changed.

## Measurement and implementation

A clean production build on main supplied `dist/meta/webview.json`. Count
`main.js` and its entire static JavaScript closure once; dynamic imports do not
count as startup. Count physical emitted bytes, including import/query overhead,
for budgets. Source attribution below uses esbuild's `bytesInOutput`, which
excludes some generated overhead. Paths are normalized to `/` on both platforms.

| Browser group     | Before B (KiB)  | After B (KiB)   | Unchanged cap KiB |
| ----------------- | --------------- | --------------- | ----------------- |
| startup           | 813,180 (794.1) | 751,392 (733.8) | 900               |
| deferred JS       | 51,157 (50.0)   | 32,875 (32.1)   | 50                |
| code highlighting | 95,366 (93.1)   | 95,366 (93.1)   | 125               |
| action dialogs    | 9,448 (9.2)     | 11,641 (11.4)   | 25                |
| tasks tab         | 1,375 (1.3)     | 1,375 (1.3)     | 25                |

Startup reduction: **61,788 B (60.3 KiB)**, meeting 60 KiB. Original deferred reduction: **18,282 B**; the resulting 32.1 KiB meets 35 KiB.

The complete inline English fallback is now DEFLATE/base85 data, decoded with
native `DecompressionStream` before dependent ESM modules execute. Its browser
round-trip test compares every key, value, plural form and serialized order to
canonical English. Installed translations, Node regional fallbacks, development
source and integration bundles retain their existing language behavior. This
removes no text and introduces no language fetch or dependency. The configured
browser target is Chrome 128.

Optional sign-in, goals, schedules, palette, popover and radial menu bodies are
first-use imports. Account & usage and Agent map retain their public wrappers
and defer their bodies separately. Transcript, composer, approval cards and
first-turn tools remain eager. Shared dependencies have one canonical static
module URL; the emitted dynamic imports get fresh nonsecret query values because
Chrome caches failed module fetch URLs. React.lazy caches successful loads.

The common loader announces loading with `role="status"`, keeps controls
unavailable, retains current props, accepts Close/Escape when appropriate, and
cannot reopen after a pending surface closes. Attached menus preserve opener
focus. A local error boundary displays translated honest failure text and a
retry button; it does not expose raw loader errors or reset the conversation.
The composer publishes palette, mention and slash ARIA references only after the list exists. The matrix exposed stale empty-mention controls, now covered by assertions for empty mention/slash matches.

### Largest startup contributors on main

| Source                                                      | Before startup B | After startup B |
| ----------------------------------------------------------- | ---------------- | --------------- |
| `node_modules/react-dom/cjs/react-dom-client.production.js` | 205,551          | 205,440         |
| `src/shared/l10n/en.ts`                                     | 103,912          | 61,471          |
| `src/webview/state/uiState.ts`                              | 44,051           | 44,051          |
| `src/webview/App.tsx`                                       | 34,639           | 35,089          |
| `node_modules/zod/v4/core/schemas.js`                       | 15,220           | 15,220          |
| `src/webview/components/Transcript.tsx`                     | 13,847           | 13,853          |
| `src/webview/components/Composer.tsx`                       | 12,121           | 12,116          |
| `src/shared/protocol.ts`                                    | 11,597           | 11,597          |
| `node_modules/mdast-util-from-markdown/lib/index.js`        | 10,239           | 10,239          |
| `node_modules/property-information/lib/svg.js`              | 10,113           | 10,113          |
| `src/shared/constants.ts`                                   | 9,786            | 9,815           |
| `src/shared/palette.ts`                                     | 8,546            | 8,546           |
| `src/webview/components/ToolRow.tsx`                        | 8,064            | 8,074           |
| `node_modules/react/cjs/react.production.js`                | 7,823            | 7,823           |
| `src/webview/components/icons.tsx`                          | 6,815            | 6,815           |
| `node_modules/hast-util-to-jsx-runtime/lib/index.js`        | 5,854            | 5,854           |
| `src/webview/components/Palette.tsx`                        | 5,127            | 0               |
| `node_modules/micromark-extension-gfm-table/lib/syntax.js`  | 4,635            | 4,635           |
| `src/shared/agentEvents.ts`                                 | 4,609            | 4,609           |
| `src/webview/components/GooeyMenu.tsx`                      | 4,594            | 1,156           |

### Original deferred sources on main

| Source                                     | Before aggregate B | After aggregate B |
| ------------------------------------------ | ------------------ | ----------------- |
| `src/webview/components/UsageDialog.tsx`   | 12,325             | 84                |
| `src/webview/components/GitPanel.tsx`      | 8,838              | 8,838             |
| `src/webview/components/AgentMap.tsx`      | 7,524              | 81                |
| `src/webview/components/BestOfNDialog.tsx` | 6,767              | 6,767             |
| `src/webview/components/ReviewPane.tsx`    | 5,168              | 5,168             |
| `src/webview/components/ReportDialog.tsx`  | 4,528              | 4,528             |
| `src/webview/components/HistoryDialog.tsx` | 3,103              | 3,103             |

### Moved feature surfaces and caps

| Surface            | Previous placement / source B | Emitted chunk                     | Chunk B (KiB) | Closure B (KiB) | Physical / closure cap KiB |
| ------------------ | ----------------------------- | --------------------------------- | ------------- | --------------- | -------------------------- |
| SignIn             | startup / 3,725 B             | `dist/webview/chunks/W7K4XIFW.js` | 3,961 (3.9)   | 3,961 (3.9)     | 25 / 25                    |
| GoalPanel          | startup / 3,002 B             | `dist/webview/chunks/2JW5XWBM.js` | 3,258 (3.2)   | 3,258 (3.2)     | 25 / 25                    |
| SchedulePanel      | startup / 1,500 B             | `dist/webview/chunks/FN7EPUL3.js` | 1,653 (1.6)   | 1,653 (1.6)     | 25 / 25                    |
| Palette            | startup / 5,127 B             | `dist/webview/chunks/4EN2JQLD.js` | 5,561 (5.4)   | 7,727 (7.5)     | 25 / 25                    |
| PopoverMenu        | startup / 1,820 B             | `dist/webview/chunks/JKPI4SBE.js` | 1,998 (2.0)   | 1,998 (2.0)     | 25 / 25                    |
| GooeyMenuContent   | startup / 4,594 B             | `dist/webview/chunks/RE52ZEHA.js` | 5,066 (4.9)   | 5,066 (4.9)     | 25 / 25                    |
| UsageDialogContent | deferred JS / 12,325 B        | `dist/webview/chunks/XB5VHD6R.js` | 12,954 (12.7) | 12,954 (12.7)   | 25 / 25                    |
| AgentMapContent    | deferred JS / 7,524 B         | `dist/webview/chunks/IGMEOE6I.js` | 8,170 (8.0)   | 8,170 (8.0)     | 25 / 25                    |

Palette also owns the deferred closure containing `paletteDialog.tsx` (1,963 B) and `ListBody.tsx` (203 B). These shared outputs are charged to its 25 KiB closure cap and to the legacy aggregate where shared with legacy panels; they cannot escape either measurement. Hashed names identify this exact production build.

Every new entry has a physical-output cap in `scripts/check-bundle-size.mjs`
and a static-import closure cap in `scripts/lib/webviewBundles.mjs`: measured
size plus 15%, rounded up to 25 KiB. The original 900 KiB startup, 50 KiB
aggregate, 125 KiB highlighting, 25 KiB action-dialog and 25 KiB tasks caps are
unchanged. Shared legacy dependencies and all unclassified deferred JavaScript
still count against the original aggregate. Usage/Agent body imports are real
new outputs, not a relabeling of the old aggregate. Bundle ownership, lazy
placement, reachability and VSIX inclusion remain enforced by the split gate.

### Other shipped bundle gates

| Bundle                          | Before KiB | After KiB | Cap KiB |
| ------------------------------- | ---------- | --------- | ------- |
| `dist/extension.js`             | 439.5      | 439.5     | 600     |
| `dist/conversation.js`          | 193.1      | 193.1     | 250     |
| `dist/tab.js`                   | 49.5       | 49.5      | 75      |
| `dist/modelApi.js`              | 446.9      | 446.9     | 475     |
| `dist/review.js`                | 29.0       | 29.0      | 50      |
| `dist/sessionBoard.js`          | 45.0       | 45.0      | 75      |
| `dist/reviewer.js`              | 22.5       | 22.5      | 75      |
| `dist/foreignHooks.js`          | 69.2       | 69.2      | 100     |
| `dist/hookRuntime.js`           | 43.0       | 43.0      | 50      |
| `dist/pluginHooks.js`           | 34.6       | 34.6      | 50      |
| `dist/planMarkdown.js`          | 144.1      | 144.1     | 150     |
| `dist/checkpointStore.js`       | 76.9       | 76.9      | 225     |
| `dist/agentImport.js`           | 115.6      | 115.6     | 125     |
| `dist/browserCheck.js`          | 42.4       | 42.4      | 75      |
| `dist/browserRuntime.js`        | 19.3       | 19.3      | 50      |
| `dist/conversationGit.js`       | 72.2       | 72.2      | 150     |
| `dist/bundledSkills.js`         | 14.7       | 14.7      | 50      |
| `dist/codeIntel.js`             | 39.1       | 39.1      | 100     |
| `dist/voice.js`                 | 19.7       | 19.7      | 50      |
| `dist/webFetch.js`              | 37.4       | 37.4      | 75      |
| `dist/museCodeReviewer.js`      | 23.0       | 23.0      | 75      |
| `dist/extensionHooks.js`        | 35.8       | 35.8      | 75      |
| `dist/report.js`                | 21.6       | 21.6      | 75      |
| `dist/recorder.js`              | 24.2       | 24.2      | 75      |
| `dist/whatsNew.js`              | 18.6       | 18.6      | 50      |
| `dist/whatsNew.json`            | 7.6        | 7.6       | 40      |
| `dist/judge.js`                 | 47.0       | 47.0      | 100     |
| `dist/uiText.js`                | 53.1       | 53.1      | 125     |
| `dist/uiTextRuntime.js`         | 3.5        | 3.5       | 25      |
| `dist/uiTextHooks.js`           | 4.7        | 4.7       | 25      |
| `dist/uiTextSurfaces.js`        | 2.5        | 2.5       | 25      |
| `dist/validation.js`            | 39.8       | 39.8      | 50      |
| `dist/wire.js`                  | 40.8       | 40.8      | 50      |
| `dist/searchWorker.js`          | 4.9        | 4.9       | 50      |
| `dist/pageWorker.js`            | 188.6      | 188.6     | 300     |
| `dist/webview/whatsNew.js`      | 0.7        | 0.7       | 25      |
| `dist/webview/referencePage.js` | 37.0       | 37.0      | 50      |
| `dist/reference.js`             | 98.2       | 98.2      | 100     |
| `dist/acp.js`                   | 821.4      | 821.4     | 850     |

## Host and browser evidence

`configureWebview` in `src/host/views/webviewSetup.ts` and the tasks panel use
`asWebviewUri` and a `localResourceRoots` entry covering all of `dist/webview`,
including `chunks/`. Both use `src/host/html.ts`'s shared pure CSP builder.
`script-src` includes the per-document nonce and the host's exact local asset
source. Default deny, no broad HTTPS source, no unsafe inline/eval remain.

The CSP unit cases cover VS Code, VSCodium, code-server, Theia and a companion
embedder using that builder, with relative chunk URLs and retry query strings.
These are host-origin contract tests, not claims of live installations of all
editors. There is no separate companion React HTML/CSP builder in this checkout;
ACP clients use native editor UI. A companion that embeds this React surface
uses the same asset-origin contract.

`node test/e2e/webviewDiet.mjs` serves the production ESM and fake host on
loopback in Chrome under the exact shared script policy. It proves all eight
chunks absent from empty-chat startup, each requested on first use, and each
actual failed network import produces an error row and succeeds after retry in
the same document. Each wait uses 5 seconds; no Vitest timeout override was used.
Harness menu actions now wait for their real controls to exist before clicking.
Reply/quote child controls wait inside the opener callback. The quote-chip fixture now chooses the actual Ask action (its previous first row was Copy), and readiness checks require the intended chips, mention options and usage facts. The existing suite assertions remain; cold first use and failures have dedicated
coverage, while repeat interaction suites share warm setup.

## Intentional failures and exact restoration

Each mutation ran its owning test at the repository default timeout and exited

1. A `finally` restored the original bytes; SHA-256 matched before and after.
   The final verification ran the restored files.

| Mutation          | Owning test                          | Failures / exit | Restored source SHA-256                                            |
| ----------------- | ------------------------------------ | --------------- | ------------------------------------------------------------------ |
| static-palette    | `test/unit/webviewBundle.test.mjs`   | 1 / 1           | `150e54c87ca1668edb3fbe9b9951e5e93d654dc7fa95c0171d1bb07f1f002749` |
| failure-row       | `test/unit/DeferredSurface.test.tsx` | 1 / 1           | `000c34748fcc96c7b1f496500a0be1aadc884e895091c93deb0e52b57671a2e0` |
| chunk-csp         | `test/unit/html.test.ts`             | 5 / 1           | `bec3d49237f2e3ee2cc36d36182acddd1c1d4474044add08aaf78b9d1ae0d9de` |
| english-roundtrip | `test/unit/uiTextRegions.test.mjs`   | 1 / 1           | `76db8b792e3a0b96f7fe841eaf221156ec736428efdaba34a1d1f09a5cac4984` |
| windows-paths     | `test/unit/webviewBundles.test.mjs`  | 1 / 1           | `069973695768079d03eeffbb63e4c782a3a08ce8719cf69de6962ea4fe846af3` |

An additional empty-list ARIA drill restored `Composer.tsx`'s old unconditional mention-listbox reference: its new assertion failed (1 failed / 76 passed; exit 1), then byte-exact restoration matched SHA-256 `762c39170efacf6a818d0263a8f8cb17af2b56d638016c1eef3b29e2ff590f54`. The restored Composer/AppLazy/DeferredSurface batch passed 85 tests at the default timeout.

The new budget fixtures also dispatch each surface at its 25 KiB cap and one
byte over, asserting the actual size gate succeeds and fails respectively.
No thresholds, rules, ignores or timeouts were weakened. All original
DeferredSurface tests, including the outer reload-boundary test, are retained.

## Final rig receipts

- `npm run typecheck`: all five projects, exit 0 on the restored final source.
- Scoped `eslint --max-warnings=0` and `prettier --check`: all changed existing/new files, exit 0. No rule/configuration levels changed.
- `npm run deadcode` (plain Knip), `jscpd`, `npm run check:l10n`, `npm run check:host-api` and `npm run check:reference`: exit 0. Localization reported 14 complete tables and zero problems; duplication reported zero clones.
- Webview-focused suites plus HTML/setup, codec and bundle gates: **84 files, 1,287 tests**, in 29 batches of at most three files with `--maxWorkers=3`. All final results pass at the repository default timeout. One reference admission test initially hit 5 seconds during cold imports; those real fixture imports moved to shared `beforeAll`, retaining every admission assertion. The same three-file batch passed 58 tests. The final ARIA change also passed the Composer/AppLazy/DeferredSurface batch (85 tests).
- `npm run build`: exit 0, including physical size, static closures, split/ownership, host globals and notices. The measured target assertions also pass: 60.3 KiB saved and legacy aggregate 32.1 KiB.
- `node test/e2e/webviewDiet.mjs`: exit 0 on the final production build; eight startup/first-use checks and eight actual failed-fetch/retry checks under CSP, with 5-second waits.
- Affected accessibility scenarios: 16 pages (reply-chip, quote-chip, add-context and paid-usage × four themes), zero violated/undecided rules and zero missing results. The initial full matrix exposed one invalid ARIA reference and stale harness clicks; the focused rerun proves their fixes without exemptions.
- Full `npm run test:a11y`: two complete scans at existing defaults. The final scan covered 628 pages (157 scenarios × four themes), **zero violated and zero undecided rules**, but **exit 1** because light/usage-install missed the unchanged 10-second readiness deadline. The initial run had eight incomplete pages and one invalid ARIA reference; its deterministic harness/ARIA faults are fixed. The isolated usage-install rerun passed all four themes with zero violations, undecided rules or missing results (exit 0). The brief's 120-minute timebox bounds this lane: the lead still owes a complete all-pages exit-0 receipt, explicitly deferred in PLAN §7. No scenario/rule/deadline was removed or loosened.
- `npm run package`: exit 0; `muse-spark-code-0.14.2.vsix` is **2,253,031 B (2,200.2 KiB)**, below 2,400 KiB. Every emitted browser output is allowlisted into the archive; the existing 2400 KiB VSIX cap is unchanged.
- Local commit hooks: the local commit uses the unchanged lint-staged (Prettier/ESLint) and staged Gitleaks hooks.

`npm run package` used the repository's supported named badge-network skip,
`BADGE_CHECK_SKIP_NETWORK='DIET1 lane forbids external network'`, because the
shared brief prohibits public network. Badge structure still ran; CI rejects
this override and must check remote badges. No hooks were altered. No full
`npm run quality`, coverage run, integration host installation, public network,
model call, merge or push was attempted; integrated quality remains the lead's
required gate. No tools or dependencies were installed. The standalone browser-smoke program is registered as a real Knip entrypoint; no ignore or issue rule changed. Unused internal type re-exports were removed.
