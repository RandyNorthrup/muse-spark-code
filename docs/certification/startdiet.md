# STARTDIET — chat startup headroom

Rig: macmini, branch `perf/startup-diet-3`, release base `2d4d72bd` (0.14.0).
No dependencies, translations, host/wire shapes, live or paid calls changed.
The rig brief forbids full quality/full unit runs and integration merges;
those remain the lead's responsibility. Local commits use existing hooks.

## Measurement

The production build's esbuild metafile counts `main.js` and every static
import transitively, once. Splitting a static chunk earns no startup reduction.
The forty largest baseline contributions and shortest static import chains:

|     KiB | Startup module                                                      | Static import chain from main.tsx                                                                                                                                                                                                                                                   |
| ------: | ------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 200.862 | node_modules/react-dom/cjs/react-dom-client.production.js           | main.tsx → react-dom/client.js → react-dom/cjs/react-dom-client.production.js                                                                                                                                                                                                       |
| 108.745 | src/shared/l10n/en.ts                                               | main.tsx → installTable.ts → src/shared/l10n/en.ts                                                                                                                                                                                                                                  |
|  42.829 | src/webview/state/uiState.ts                                        | main.tsx → App.tsx → state/uiState.ts                                                                                                                                                                                                                                               |
|  32.804 | src/webview/App.tsx                                                 | main.tsx → App.tsx                                                                                                                                                                                                                                                                  |
|  20.378 | node_modules/highlight.js/lib/core.js                               | main.tsx → App.tsx → components/Transcript.tsx → components/CodeBlock.tsx → highlight.ts → highlight.js/es/core.js → highlight.js/lib/core.js                                                                                                                                       |
|  14.863 | node_modules/zod/v4/core/schemas.js                                 | main.tsx → installTable.ts → zod/mini/index.js → zod/v4/mini/external.js → zod/v4/core/index.js → zod/v4/core/schemas.js                                                                                                                                                            |
|  13.508 | src/webview/components/Transcript.tsx                               | main.tsx → App.tsx → components/Transcript.tsx                                                                                                                                                                                                                                      |
|  13.131 | node_modules/highlight.js/es/languages/css.js                       | main.tsx → App.tsx → components/Transcript.tsx → components/CodeBlock.tsx → highlight.ts → highlight.js/es/languages/css.js                                                                                                                                                         |
|  11.784 | src/webview/components/Composer.tsx                                 | main.tsx → App.tsx → components/Composer.tsx                                                                                                                                                                                                                                        |
|  11.095 | src/shared/protocol.ts                                              | main.tsx → state/snapshot.ts → src/shared/protocol.ts                                                                                                                                                                                                                               |
|  10.016 | node_modules/mdast-util-from-markdown/lib/index.js                  | main.tsx → App.tsx → components/Transcript.tsx → components/MarkdownView.tsx → react-markdown/index.js → react-markdown/lib/index.js → remark-parse/index.js → remark-parse/lib/index.js → mdast-util-from-markdown/index.js → mdast-util-from-markdown/lib/index.js                |
|   9.879 | node_modules/property-information/lib/svg.js                        | main.tsx → App.tsx → components/Transcript.tsx → components/MarkdownView.tsx → react-markdown/index.js → react-markdown/lib/index.js → hast-util-to-jsx-runtime/index.js → hast-util-to-jsx-runtime/lib/index.js → property-information/index.js → property-information/lib/svg.js  |
|   9.532 | src/shared/constants.ts                                             | main.tsx → src/shared/constants.ts                                                                                                                                                                                                                                                  |
|   8.192 | src/shared/palette.ts                                               | main.tsx → App.tsx → src/shared/palette.ts                                                                                                                                                                                                                                          |
|   7.894 | src/webview/components/ToolRow.tsx                                  | main.tsx → App.tsx → components/Transcript.tsx → components/ToolRow.tsx                                                                                                                                                                                                             |
|   7.640 | node_modules/react/cjs/react.production.js                          | main.tsx → react/index.js → react/cjs/react.production.js                                                                                                                                                                                                                           |
|   7.584 | node_modules/highlight.js/es/languages/typescript.js                | main.tsx → App.tsx → components/Transcript.tsx → components/CodeBlock.tsx → highlight.ts → highlight.js/es/languages/typescript.js                                                                                                                                                  |
|   6.655 | src/webview/components/icons.tsx                                    | main.tsx → App.tsx → components/icons.tsx                                                                                                                                                                                                                                           |
|   6.341 | node_modules/highlight.js/es/languages/javascript.js                | main.tsx → App.tsx → components/Transcript.tsx → components/CodeBlock.tsx → highlight.ts → highlight.js/es/languages/javascript.js                                                                                                                                                  |
|   6.313 | node_modules/highlight.js/es/languages/sql.js                       | main.tsx → App.tsx → components/Transcript.tsx → components/CodeBlock.tsx → highlight.ts → highlight.js/es/languages/sql.js                                                                                                                                                         |
|   5.887 | node_modules/highlight.js/es/languages/cpp.js                       | main.tsx → App.tsx → components/Transcript.tsx → components/CodeBlock.tsx → highlight.ts → highlight.js/es/languages/cpp.js                                                                                                                                                         |
|   5.718 | node_modules/hast-util-to-jsx-runtime/lib/index.js                  | main.tsx → App.tsx → components/Transcript.tsx → components/MarkdownView.tsx → react-markdown/index.js → react-markdown/lib/index.js → hast-util-to-jsx-runtime/index.js → hast-util-to-jsx-runtime/lib/index.js                                                                    |
|   5.162 | src/webview/components/Palette.tsx                                  | main.tsx → App.tsx → components/Palette.tsx                                                                                                                                                                                                                                         |
|   4.548 | src/shared/agentEvents.ts                                           | main.tsx → state/snapshot.ts → src/shared/agentEvents.ts                                                                                                                                                                                                                            |
|   4.536 | node_modules/highlight.js/es/languages/c.js                         | main.tsx → App.tsx → components/Transcript.tsx → components/CodeBlock.tsx → highlight.ts → highlight.js/es/languages/c.js                                                                                                                                                           |
|   4.532 | node_modules/micromark-extension-gfm-table/lib/syntax.js            | main.tsx → App.tsx → components/Transcript.tsx → components/MarkdownView.tsx → remark-gfm/index.js → remark-gfm/lib/index.js → micromark-extension-gfm/index.js → micromark-extension-gfm-table/index.js → micromark-extension-gfm-table/lib/syntax.js                              |
|   4.493 | src/webview/components/GooeyMenu.tsx                                | main.tsx → App.tsx → components/Transcript.tsx → components/GooeyMenu.tsx                                                                                                                                                                                                           |
|   4.375 | node_modules/zod/v4/core/util.js                                    | main.tsx → installTable.ts → zod/mini/index.js → zod/v4/mini/external.js → zod/v4/core/index.js → zod/v4/core/util.js                                                                                                                                                               |
|   4.358 | src/webview/components/QuestionCard.tsx                             | main.tsx → App.tsx → components/Transcript.tsx → components/ToolRow.tsx → components/QuestionCard.tsx                                                                                                                                                                               |
|   4.339 | src/webview/components/ToolBodies.tsx                               | main.tsx → App.tsx → components/Transcript.tsx → components/ToolRow.tsx → components/ToolBodies.tsx                                                                                                                                                                                 |
|   4.285 | node_modules/property-information/lib/html.js                       | main.tsx → App.tsx → components/Transcript.tsx → components/MarkdownView.tsx → react-markdown/index.js → react-markdown/lib/index.js → hast-util-to-jsx-runtime/index.js → hast-util-to-jsx-runtime/lib/index.js → property-information/index.js → property-information/lib/html.js |
|   4.278 | node_modules/highlight.js/es/languages/powershell.js                | main.tsx → App.tsx → components/Transcript.tsx → components/CodeBlock.tsx → highlight.ts → highlight.js/es/languages/powershell.js                                                                                                                                                  |
|   4.191 | src/shared/redact.ts                                                | main.tsx → state/snapshot.ts → src/shared/redact.ts                                                                                                                                                                                                                                 |
|   3.953 | node_modules/highlight.js/es/languages/csharp.js                    | main.tsx → App.tsx → components/Transcript.tsx → components/CodeBlock.tsx → highlight.ts → highlight.js/es/languages/csharp.js                                                                                                                                                      |
|   3.943 | node_modules/micromark-extension-gfm-footnote/lib/syntax.js         | main.tsx → App.tsx → components/Transcript.tsx → components/MarkdownView.tsx → remark-gfm/index.js → remark-gfm/lib/index.js → micromark-extension-gfm/index.js → micromark-extension-gfm-footnote/index.js → micromark-extension-gfm-footnote/lib/syntax.js                        |
|   3.933 | node_modules/unified/lib/index.js                                   | main.tsx → App.tsx → components/Transcript.tsx → components/MarkdownView.tsx → react-markdown/index.js → react-markdown/lib/index.js → unified/index.js → unified/lib/index.js                                                                                                      |
|   3.695 | src/shared/paid.ts                                                  | main.tsx → App.tsx → src/shared/paid.ts                                                                                                                                                                                                                                             |
|   3.676 | src/webview/components/SignIn.tsx                                   | main.tsx → App.tsx → components/SignIn.tsx                                                                                                                                                                                                                                          |
|   3.659 | node_modules/micromark-extension-gfm-autolink-literal/lib/syntax.js | main.tsx → App.tsx → components/Transcript.tsx → components/MarkdownView.tsx → remark-gfm/index.js → remark-gfm/lib/index.js → micromark-extension-gfm/index.js → micromark-extension-gfm-autolink-literal/index.js → micromark-extension-gfm-autolink-literal/lib/syntax.js        |
|   3.580 | node_modules/react-dom/cjs/react-dom.production.js                  | main.tsx → react-dom/client.js → react-dom/cjs/react-dom-client.production.js → react-dom/index.js → react-dom/cjs/react-dom.production.js                                                                                                                                          |

## Highlighting

Baseline startup: 914,658 bytes (893.221 KiB); original deferred UI 49.7 KiB.
After the highlighting split: startup 800.6 KiB, deferred highlighting 93.1
KiB (new 125 KiB budget by D6), original deferred UI 49.9 KiB (same 50 cap).
All eighteen languages and aliases remain available. Only a supported, closed
fence imports the engine; open/unknown fences need no engine. Safe plain code,
labels, keyboard scrolling and Copy/Insert/Apply work during chunk latency.
The engine shares React and language resolution rather than duplicating them.

Highlighting-piece receipts on macmini:

- Production build including size, split, host-global and notices gates: exit 0.
  Exact startup 819,843 bytes (800.628 KiB).
- All five typecheck projects: exit 0. Changed-file ESLint and Prettier: exit 0.
- Seven owning unit files, 87 unique tests: pass. Every invocation names at most
  three files and uses `--maxWorkers=3 --testTimeout=120000`.
- Empty, sign-in, transcript and Markdown PNGs: before/after byte-identical.
  The CLI Chrome capture wrote a shot then failed to exit on this rig; rebuilt
  the original webview from the release Git sources into `temp/`, verified all
  original metafile output names/byte counts, and used Playwright over the same
  fake-host page at 690×673, reduced motion, six-second scenario settle.
- Red code-body drill: replace the Suspense plain-code fallback with null;
  `CodeBlockLazy.test.tsx` exits 1 because code vanishes while the import waits.
- Red split drill: statically import `HighlightedCode`; `npm run build` exits 1
  with the HighlightedCode/runtime placement errors and every eager highlight.js
  input rejected. Restore and rebuild: exit 0. Both drills restore CodeBlock's
  exact SHA-256 `74c1a53625569b62a4756bad3ce5a79fe787d33a040dcfa97252d3f3375194fc`.

## Final split

Share, Session Board, handoff and secret prompts now load only when shown,
with the existing closeable DeferredSurface boundary. TasksApp imports only
for the Tasks document; its loading text is read inside mountTasks after the
installed table is validated. The localization gate caught module-level reads
in the first fallback placement; moving the branch into mountTasks restores
zero problems without an ignore or a changed language value.

The initial dialog split exceeded the original deferred cap: 52.0/50 KiB.
Reusing the palette shell made it eager and removed duplicate list/blur markup,
but left 80 bytes of imported-path overhead. Reusing the palette's Escape
handler saved startup bytes only; that route was stopped after those two tries.
Hash-only generated chunk filenames remove repeated labels from every import,
bringing the original cohort to 49.697 KiB. Every filename remains hashed,
reachable, guarded by source/entry point, and shipped by the same `chunks/*.js`
packaging rule. No source file rename, cap change, dependency, ignore or
feature removal was needed.

React, UI store/protocol validation, the inline English fallback, Markdown/GFM
and row renderers stay eager because restored conversations need them at the
first paint. No inactive locale table enters the browser bundle: only its
embedded installed table and the English fallback. What's New already has its
independent script; usage, review/diff, history and agent dialogs retain their
existing guarded splits. The browser target remains chrome128 for oldest-host
compatibility; the measured startup closure contains no removable platform
polyfill. Shared React/localization/language helpers occur once in the ESM graph.

| Closure                           |   Before KiB | After KiB | Cap KiB |
| --------------------------------- | -----------: | --------: | ------: |
| Chat startup, every static import |      893.221 |   792.149 |     900 |
| deferred JS                       |       49.654 |    49.697 |      50 |
| code highlighting                 | eager before |    93.131 |     125 |
| action dialogs                    | eager before |     9.141 |      25 |
| tasks tab                         | eager before |     1.343 |      25 |

Exact startup: 914,658 → 811,161 bytes; reduction 101.071 KiB. Headroom 107.851 KiB.

Every browser output below uses the production metafile’s bytes; eager/deferred classification follows the import graph. Shared helpers and React occur once.

### Before: all browser outputs

| Output                           |     KiB | Reachability / entry                    |
| -------------------------------- | ------: | --------------------------------------- |
| chunks/AgentMap-ZOFLGSUG.js      |   7.871 | deferred · components/AgentMap.tsx      |
| chunks/BestOfNDialog-ABXKF4X3.js |   6.906 | deferred · components/BestOfNDialog.tsx |
| chunks/chunk-3CFQKQGP.js         |   1.369 | startup                                 |
| chunks/chunk-3OBQEWZJ.js         |   8.901 | startup                                 |
| chunks/chunk-4Q5HCL2Z.js         |   1.979 | startup                                 |
| chunks/chunk-5OYIARPN.js         |   0.000 | startup                                 |
| chunks/chunk-5XJK4AW5.js         |   4.978 | startup                                 |
| chunks/chunk-BB77NEIC.js         |   3.943 | startup                                 |
| chunks/chunk-EG4V7H62.js         |   0.363 | startup                                 |
| chunks/chunk-FZXGJA3Y.js         |   0.924 | startup                                 |
| chunks/chunk-K3VYIGRV.js         |   1.116 | startup                                 |
| chunks/chunk-MBTAPHGF.js         |  31.700 | startup                                 |
| chunks/chunk-MR54SRLZ.js         | 124.411 | startup                                 |
| chunks/chunk-QEOB2KPP.js         |   6.886 | startup                                 |
| chunks/chunk-QZK5GULQ.js         |   1.518 | startup                                 |
| chunks/chunk-RFXYRSRX.js         |  78.950 | startup                                 |
| chunks/chunk-Z2F7XT3M.js         |   0.205 | startup                                 |
| chunks/chunk-ZSGWWC3V.js         |   8.055 | startup                                 |
| chunks/GitPanel-55BFGUB4.js      |   8.743 | deferred · components/GitPanel.tsx      |
| chunks/HistoryDialog-H4OYP7XY.js |   3.351 | deferred · components/HistoryDialog.tsx |
| chunks/ReportDialog-UQHYIPGG.js  |   4.671 | deferred · components/ReportDialog.tsx  |
| chunks/ReviewPane-ETUY6SVE.js    |   5.510 | deferred · components/ReviewPane.tsx    |
| chunks/UsageDialog-GMMBFJRK.js   |  12.603 | deferred · components/UsageDialog.tsx   |
| main.css                         |  53.626 | stylesheet                              |
| main.js                          | 617.923 | startup · main.tsx                      |

### After: all browser outputs

| Output             |     KiB | Reachability / entry                         |
| ------------------ | ------: | -------------------------------------------- |
| chunks/2HVEACRS.js |   0.198 | startup                                      |
| chunks/2TEO5AI5.js |   0.536 | startup                                      |
| chunks/4A6KS436.js |   0.754 | deferred · components/SecretPromptDialog.tsx |
| chunks/4NDTZUKT.js |   1.052 | startup                                      |
| chunks/4QORFRD2.js |   1.506 | startup                                      |
| chunks/6H6HIFU7.js |   8.049 | startup                                      |
| chunks/BFLAA6JG.js |  93.131 | deferred · components/HighlightedCode.tsx    |
| chunks/C64TUA5K.js |   0.357 | startup                                      |
| chunks/DQPCBI5I.js |   7.896 | deferred · components/AgentMap.tsx           |
| chunks/FDNK3VAN.js |   5.155 | startup                                      |
| chunks/GAMWOCGS.js |   3.983 | startup                                      |
| chunks/HMBFOJ5V.js |   3.335 | deferred · components/HistoryDialog.tsx      |
| chunks/HV73WSUR.js |   4.673 | deferred · components/ReportDialog.tsx       |
| chunks/I2C3X3GO.js | 123.025 | startup                                      |
| chunks/IGRX2VK3.js |   1.104 | startup                                      |
| chunks/J2VS23O7.js | 159.508 | startup                                      |
| chunks/JVPIHTG6.js |   3.966 | startup                                      |
| chunks/LUY4TKSL.js |   1.992 | startup                                      |
| chunks/MQEIEY3K.js |   0.000 | startup                                      |
| chunks/MXPEWN36.js |   0.264 | startup                                      |
| chunks/O4Q3THVV.js |   1.486 | startup                                      |
| chunks/OYAEPE5Q.js |   6.896 | deferred · components/BestOfNDialog.tsx      |
| chunks/QASH74NP.js |   5.513 | deferred · components/ReviewPane.tsx         |
| chunks/QQ3TOYQJ.js |   8.763 | deferred · components/GitPanel.tsx           |
| chunks/R4SLIWUW.js |   6.879 | startup                                      |
| chunks/SKVWGIO3.js |   0.923 | startup                                      |
| chunks/U6KVNNFE.js |   8.664 | startup                                      |
| chunks/UA7GGJIE.js |   2.227 | deferred · components/SessionBoardDialog.tsx |
| chunks/UOJ6TTI4.js |  31.700 | startup                                      |
| chunks/XZXYOOKZ.js |   1.343 | deferred · TasksApp.tsx                      |
| chunks/YLRYJ3JI.js |   1.342 | deferred · components/HandoffDialog.tsx      |
| chunks/Z225V56M.js |   1.377 | startup                                      |
| chunks/ZAKDFJMY.js |  12.622 | deferred · components/UsageDialog.tsx        |
| chunks/ZBQ6LQRK.js |   4.818 | deferred · components/ShareView.tsx          |
| chunks/ZX6KS2TY.js |  74.204 | startup                                      |
| chunks/ZXQBZBPZ.js |   1.354 | startup                                      |
| main.css           |  53.626 | stylesheet                                   |
| main.js            | 354.866 | startup · main.tsx                           |

### Node bundles and generated content

All existing Node/content caps are unchanged. Values are the size gate’s reported KiB.

| Artifact                 | Before KiB | After KiB | Cap KiB |
| ------------------------ | ---------: | --------: | ------: |
| dist/extension.js        |      436.7 |     436.7 |     600 |
| dist/conversation.js     |      193.1 |     193.1 |     250 |
| dist/tab.js              |       49.4 |      49.4 |      75 |
| dist/modelApi.js         |      446.6 |     446.6 |     475 |
| dist/review.js           |       29.0 |      29.0 |      50 |
| dist/sessionBoard.js     |       45.0 |      45.0 |      75 |
| dist/reviewer.js         |       22.5 |      22.5 |      75 |
| dist/foreignHooks.js     |       69.2 |      69.2 |     100 |
| dist/hookRuntime.js      |       43.0 |      43.0 |      50 |
| dist/pluginHooks.js      |       34.1 |      34.1 |      50 |
| dist/planMarkdown.js     |      144.1 |     144.1 |     150 |
| dist/checkpointStore.js  |       76.9 |      76.9 |     225 |
| dist/agentImport.js      |      116.1 |     116.1 |     125 |
| dist/browserCheck.js     |       37.6 |      37.6 |      75 |
| dist/browserRuntime.js   |       19.3 |      19.3 |      50 |
| dist/conversationGit.js  |       71.4 |      71.4 |     150 |
| dist/bundledSkills.js    |       14.7 |      14.7 |      50 |
| dist/codeIntel.js        |       39.1 |      39.1 |     100 |
| dist/voice.js            |       18.9 |      18.9 |      50 |
| dist/webFetch.js         |       37.4 |      37.4 |      75 |
| dist/museCodeReviewer.js |       23.0 |      23.0 |      75 |
| dist/extensionHooks.js   |       35.8 |      35.8 |      75 |
| dist/report.js           |       21.6 |      21.6 |      75 |
| dist/recorder.js         |       24.2 |      24.2 |      75 |
| dist/whatsNew.js         |       18.6 |      18.6 |      50 |
| dist/whatsNew.json       |       21.4 |      21.4 |      40 |
| dist/judge.js            |       47.0 |      47.0 |     100 |
| dist/uiText.js           |       48.0 |      48.0 |     125 |
| dist/uiTextRuntime.js    |        3.5 |       3.5 |      25 |
| dist/uiTextHooks.js      |        4.6 |       4.6 |      25 |
| dist/uiTextSurfaces.js   |        2.5 |       2.5 |      25 |
| dist/validation.js       |       39.8 |      39.8 |      50 |
| dist/wire.js             |       40.4 |      40.4 |      50 |
| dist/searchWorker.js     |        4.9 |       4.9 |      50 |
| dist/pageWorker.js       |      188.6 |     188.6 |     300 |
| dist/acp.js              |      816.8 |     816.8 |     850 |

### Independent What's New page

| Artifact                  | Before KiB | After KiB |               Cap KiB |
| ------------------------- | ---------: | --------: | --------------------: |
| dist/webview/whatsNew.js  |        0.7 |       0.7 |                    25 |
| dist/webview/whatsNew.css |        2.5 |       2.5 | stylesheet, unchanged |

## Verification

All commands run directly on macmini. No invocation selects more than three
unit files; every one uses `--maxWorkers=3 --testTimeout=120000`. No full unit
suite or quality command was run, as the lane rules explicitly forbid them.

- Production `npm run build`: exit 0, including size, split, host-global and
  notices gates. The startup reduction is 101.071 KiB; 107.851 KiB below cap.
- `npm run typecheck`: all five projects exit 0; final Tasks mounting change
  also passes `npm run typecheck:webview`.
- Changed-file ESLint and Prettier: exit 0. Final commit hook receipts are
  recorded below after the complete accessibility run.
- `npm run deadcode`: exit 0; no dead exports/dependencies. `npx jscpd`: exit 0,
  zero clones across 1,162 files. Localization: 14 tables, 164 manifest strings,
  592 source files, zero problems. Host API: 332 APIs, zero problems.
- Unit coverage of changed/owning modules: 302 unique tests across sixteen
  files, all passing: highlight, CodeBlockLazy, MarkdownView, Transcript,
  renderCost, webviewBundles, bundleSize, App, AppLazy, TasksApp, Palette,
  handoffDialog, secretPromptDialog, ShareView, SessionBoardDialog and
  vsixPackaging. Existing packaging tests prove hashed chunks ship while source,
  metafiles and private artifacts do not. Budget tests admit exactly each cap
  and reject the next byte; shared/unclassified lazy helpers keep their original
  charge, and static re-imports remain charged to startup.
- Share latency red drill: break shareClosed into focusRequested; AppLazy exits
  1 because closing cannot remove the loading dialog. Restore App's SHA-256
  `8331d54d47e12cc20dff79a9f1e11508f19d08479dfb60c9fe275cb06b77b0aa` exactly,
  then AppLazy passes. Latest state/language and focus return are also covered.
- The first full axe run covered 620 pages (155 scenarios × four themes): zero
  violations/undecided rules, but one page failed its report checkbox assertion
  because its fixed 400 ms timer preceded the lazy import. The harness now uses
  its existing bounded whenFound helper; exact two checkboxes and 24 px geometry
  remain mandatory. An 800 ms delayed ReportDialog import passes; removing a
  checkbox still produces the same harness error. No timeout/threshold/exemption
  was changed. The final complete rerun passes all 620 pages, with zero
  violated/undecided rules, zero exemptions and zero missing results.

### Screenshot comparison

Original-release and final production bundles render the same four startup
harness scenarios byte for byte, at 690×673 with reduced motion after the
standard scenario settle. These are the final images; SHA-256 equality was
verified against the original captures, not inferred from visual similarity.

| Scenario | Image | Equal before/after SHA-256 |
| -------- | ----- | -------------------------- |

| empty | [empty](startdiet/empty.png) | 1349c83893bde3a3b7abef48fd487dadf8717c861fcc5a3dcf5aa9a02247e597 |
| signin | [signin](startdiet/signin.png) | 7607ca73ab8a5ea9635b1df6a440c6a47eabeb0873bfa40b57ba838089f6e96f |
| transcript | [transcript](startdiet/transcript.png) | dd57c74625204cde1552e87ca752277b83a99f4bd28a336806b3e5e011b25e58 |
| markdown | [markdown](startdiet/markdown.png) | ee22da9527ee7e0520b2c5e018f699985ea46cb9d91c8079b6b692e81ec307bf |

### Remaining certification

- [x] Final `npm run test:a11y`: exit 0, 620 pages (155 scenarios × four
      themes), 0 rules violated, 0 rules undecided, 0 exempt, 0 pages without
      a result. Existing unmeasurable covered/offscreen contrast and glyph
      accounting stays unchanged.
- [x] Final changed-file Prettier and ESLint: exit 0; both implementation
      commits run the existing lint-staged/Prettier/ESLint and gitleaks hooks,
      with no leaks found. The certification-only commit uses those same hooks.
- [x] Code commits: `a86da80f` (highlighting) and `48355c88` (dialogs/Tasks,
      shared palette markup, hash-only generated paths and report readiness).
- [x] No push, merge, rebase, dependency/global install, live or paid call.

The lead owns the full multi-rig quality/integration gate and release packaging.
No claim is made about a measured wall-clock acceleration from the byte savings.
