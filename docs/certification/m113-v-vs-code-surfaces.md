# M113 V � VS Code report surfaces

Lane `m113/v`, Windows 11 rig, base `9b83bc3b0` (lane 0 + R).
No model, paid, credential, remote-network or install operation. The local browser harness uses loopback only. No dependency, gate, timeout or bundle cap changed. Full quality is reserved for W by the rig brief.

## Implemented

- A separate, lazy report tab and strict host/page bridge; verified R HTML in an empty-sandbox iframe. Report source and diff values remain text. Copy Markdown, four Save as formats, Attach to draft, scoped History, Diff previous, Refresh and the all-kind picker.
- `/report` recognition ahead of authentication and model admission. The controller receives an injected report operation; attaching inserts reviewed Markdown into the originating draft without sending it.
- Separate **Show report�** palette item and command, leaving M93's **Report a problem** intact. Account & usage exposes a button when its report callback is bound.
- Saved-id membership and metadata validation, canonical verification, normalized diff re-scrub, busy admission, stale-operation refusal and fixed localized failure messages. Save writes only to the user's dialog selection and cancellation writes nothing.
- Five additional labels with real translations in all fourteen tables. Existing lane-0 report labels are reused at runtime.
- Shared React `ReportApp` accepts an injected bridge for the companion and native hosts; no VS Code import in the page, parser contracts or renderer logic.

## Integration ownership and bindings

The brief expressly reserves other lanes' files. These are named handoffs, not production mocks:

1. **W � engine and build:** package `src/host/reporting/reportPanelEntry.ts` as `dist/reportingPanel.js` (Node; shared English fallback), and `src/webview/reporting/main.tsx` as its own `dist/webview/reportingPage.js` plus CSS. Register both lazy entries in knip, bundle split/size and host API records. Bind `dist/reporting.js`'s `createReportingEngine(ReportingEngineContext)` to K/S/H and R; its return type is `ReportPanelEngine`. The panel factory installs the caller's language before use. Factory acquisition failures are explicit localized errors.
2. **W � commands/help:** contribute `museSpark.showReport`, register its command constant with the main command catalogue, and add featureCatalog/reference relationships for `showReport`, `/report`, report tab and usage button. All manifest translations were already supplied by lane 0. README and CHANGELOG must describe local deterministic reports, the picker/actions and the retained M93 problem action.
3. **W � composer binding:** dispatch palette action `{ type: 'showReport' }` to `ConversationController.showDeterministicReport()`, and supply `UsageDialog.reportAction` with `reporting/UsageReportAction` loaded through the reporting lazy boundary, binding its `onUsageReport` to the same operation with `usage` arguments. The dialog renders the supplied slot; the report button and label stay outside its legacy deferred chunk. Provide a dedicated strict report-command/ack protocol and intercept the composer before its optimistic model row. The controller's compatibility guard presently reports a rejected model submission through existing `sendFailed`, opens the local report and retains attachments. It never starts a model turn, including signed-out use. This fallback is safe, but needs the dedicated acknowledgment for the final polished composer flow.
4. **S/X/W � snapshot identity:** the factory derives a SHA-256 workspace key from slash-normalized root (case folded on Windows), and supplies workspace root, storage root and l10n. Align it with S/X's canonical history identity. Bind actual session/check-run/registry/network-policy sources; no collector is fabricated here. History and compare call the lane-0 host contracts and validate their results.
5. **X / M104 native owners:** mount the same `ReportApp` with a `ReportingBridge`, implementing the strict page messages over `reports/*`. X owns ACP Markdown/text and CLI formats/flags; native JCEF/WebView2/SWT, TUI and desktop adapter tests are waiting for their owners. This lane makes no certification claim for those absent hosts.
6. **H � saved options:** history metadata on this base carries only a header, so Refresh of an opened saved report uses its kind/scope with local defaults (`full=false`, `network=false`); expose saved normalized options if Refresh must reproduce historical breakdown/session flags. Live report Refresh preserves its original options and advances only `asOf`.
7. **W � final harness:** register the independent report/history/diff/error scenes with the shipping build and accessibility command. Four standard theme palettes live in the lazy adapter; move them into the shared constants region if W centralizes those colors.

## Final verification � Windows 11 rig, 2026-10-06

| Check                                                                                                   | Result                                                                                                                                                                                                                                                                                                   |
| ------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm.cmd run typecheck`                                                                                 | PASS, all five projects. Re-ran `typecheck:unit` after the final fixture cleanup/factory tests; PASS.                                                                                                                                                                                                    |
| Changed-file eslint, zero warnings                                                                      | PASS (host, webview, translations source, changed tests and harness verifier).                                                                                                                                                                                                                           |
| Reporting CSS stylelint, zero warnings                                                                  | PASS.                                                                                                                                                                                                                                                                                                    |
| Changed-file Prettier and `git diff --check`                                                            | PASS.                                                                                                                                                                                                                                                                                                    |
| New unit suites, `--maxWorkers=3`, default timeout                                                      | 24/24 PASS: `reportingPanel`, `reportingApp`, `reportingRequest`.                                                                                                                                                                                                                                        |
| Existing touched suites, `--maxWorkers=3`, default timeout                                              | 654/654 PASS: `conversationController`, `UsageDialog`, `paletteRegistry`.                                                                                                                                                                                                                                |
| Plain `npx.cmd knip`                                                                                    | FAIL: own-page `main.tsx` and harness `verify.mjs` are not registered entries, and the dynamic namespace factory `createReportingWindow` needs its entry registered. W owns knip/build registrations. No ignore added.                                                                                   |
| `npx.cmd jscpd`                                                                                         | PASS: 0 clones. Shared test setup removes the reported six-line clone.                                                                                                                                                                                                                                   |
| `node scripts/check-l10n.mjs`                                                                           | FAIL: exactly the seven existing lane-0 manifest keys unused by `package.json`: `command.showReport.title`, reports network description and three enum descriptions, keepHistory description, agentSources description. No UI-table problem; all fourteen new translations present. W owns the manifest. |
| `npm.cmd run check:reference`                                                                           | FAIL: two `Missing localized slash description: report` results. W must bind the already translated `reportSlashDescription` and add the catalogue/reference rows.                                                                                                                                       |
| `npm.cmd run check:host-api`                                                                            | FAIL: generated inventory stale (338 APIs, 33 VS Code adapter files, 25 Node built-ins, 61 theme variables). W owns regeneration. The final run used restored source, with no deliberate mutation left in it.                                                                                            |
| `npm.cmd run build`                                                                                     | FAIL: deferred JavaScript **51,291 bytes**, **91 bytes over** its unchanged 50 KiB cap. The brief explicitly assigns the main diet/headroom and build registration to W. No production change followed this budget failure; verification, test cleanup and receipts only.                                |
| Existing production split and host-global scripts, run separately after size stopped the build pipeline | PASS. These scripts do not yet cover the new unregistered entries; W must add them.                                                                                                                                                                                                                      |
| Independent reporting harness                                                                           | PASS: 32 scenes, 4 themes � 690/320 px � report/history/diff/error; 0 page violations, 0 static-document violations, 0 page errors, 0 outer horizontal overflow; all keyboard-focus checks pass.                                                                                                         |

All 678 scoped unit tests passed on the repository's default timeout; no skipped tests or name filters. Full quality, coverage, remote/editor rigs and live sources are reserved for integration and were not run.

## Browser receipt and limits

Run from the worktree: `node test/harness/reporting/verify.mjs`. It builds only these entries into ignored `temp/m113-v`, renders the actual lane-0/R fixture, and serves the test-only scenes on loopback using the installed headless browser. No install, external fetch, user profile or model call. `m113-v-a11y.json` and `m113-v-320-light.png` record the final successful run.

The product iframe keeps `sandbox=""`. The parent axe result therefore records `frame-tested` as incomplete. The exact static R document is also scanned separately, without weakening its CSP. At 320 px, axe marks contrast of the obscured right-hand table columns incomplete in all four themes; there are no violations. R supplies captioned, keyboard-focusable, horizontally scrollable table regions. Inspection confirmed the incomplete reason is **partially obscured by another element**, and the static document's overall scroll width remains 320 px. No axe rule was excluded or disabled. The receipt preserves these incomplete results; it is not a claim of exhaustive manual accessibility certification.

## Deliberate failures and exact restoration

`m113-v-red-drills.json` records **27** mutations, each exiting 1 with the named regression, original/restored SHA-256 and `byteExact=true`. Every complete owning test file ran with `--maxWorkers=3` and the default timeout; none was filtered. The theme drill ran every harness scene. The source files and successful screenshot/receipt were restored byte-exact.

- Strict save and host-state messages; history-id membership and metadata; comparison headers; history ordering and scrub; wrong-kind and stale generation.
- Canceled and stale saves; serialized action admission; disabled command URIs; four-format output selection; empty iframe sandbox.
- Duplicate options, required scope, extra special-command arguments, missing flag values, schema refusal and slash word boundaries; controller interception before model admission.
- Engine, panel and window factories must be functions; missing lazy bundles retry rather than memoizing a failure.
- Completion status stays with its original panel: copy, attach and save regressions first failed, then passed after the fix, and fired again when its guard was deliberately removed.
- Foreground-token removal produces eight dark-theme contrast failures; `m113-v-a11y-red.json` retains that deliberately failing receipt. Its file hash matches after restoration.

## Bundle measurements and final handoff

Production build: extension **440.5/600 KiB**, conversation **194.0/250**, Model API **446.9/475**, ACP **821.5/850**, startup webview **798.0/900**, deferred **50.1/50**, core English **53.3/125**, surfaces English **4.9/25**. The approximately 1 KiB activation change contains only the command and loader; `dist/meta/extension.json` lists only `reportPanelBundle.ts` under reporting. All heavy schemas, picker, renderer calls, file and clipboard adapters remain in the lazy entry.

The independent probe records panel **74.4 KiB**, own browser page **453.3 KiB**, CSS **1.3 KiB**, with React, inline browser English and report validation included in the standalone page. This is an own page entry, not part of the already-full 50 KiB deferred group. Node English is shared through the existing fallback plugin. `m113-v-bundles.json` records inputs; no backend or agent input appears in either report entry. W must measure the joined split build (which can share React/English/schema chunks) and register the new entries' measured budgets by D6. No existing cap changed.

W must complete the seven named bindings above and run the aggregate gates after K/S/H/X and the diet are integrated. This lane is an implementation and bounded fake/browser certification, not a claim that the unbound base is a shipping reporting extension. Native/ACP/CLI behavior and live local-report timings belong to their named owners. The React checklist from `vercel:react-best-practices` was applied: stable bridge subscription with cleanup, state derived directly, explicit button names, labelled select and iframe, text rendering of source values, and no redundant memoization.

## RVM113V corrections — 2026-10-06, Windows 11 rig

This section supersedes the initial CSP/accessibility and deferred-budget
claims above. The review correctly attributes the original deferred overage
to V: the reviewed base used 51,157 bytes; V's button added 134 bytes to
reach 51,291, above the unchanged 51,200-byte cap. The earlier unrestricted
browser shell did not certify production iframe styles.

| Finding                      | Result                                                                                                                                                                                                                                  | Regression                                                                                                                                                                                                      | Deliberate failure                                                                                                                                                                |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P2 production CSP            | Fixed: the host sets the trusted renderer style's nonce and the iframe's style policy to the production shell nonce. Empty sandbox and parent CSP remain intact. Closing the tab clears documents tied to its old nonce.                | `reportingPanel`: “authorizes the iframe stylesheet with the actual production shell nonce”; reopened-picker regression. Browser harness loads the compiled host's actual HTML.                                 | Remove style nonce: unit regression fails, and all 32 production browser scenes reject the style with zero applied rules. Restore source and green receipt/screenshot byte-exact. |
| P2 diff scrub                | Fixed: clone decoded sections, call R's existing `scrubFields`, then validate the result. R's helper is exported exactly as in its reviewed `c459e96b9` correction; no other R behavior is changed.                                     | “scrubs decoded diff strings and keys while preserving already redacted rows”: quoted redacted API/password assignments, unredacted prose canaries, nested text lists and object keys; input remains untouched. | Restore serialized-JSON scrub, then independently bypass decoded scrubbing: the named test fails both times.                                                                      |
| P2 picker lifetime/admission | Fixed: public and page pickers go through busy admission. Pending history, selection and scope return only to their original panel; closing cancels QuickPick/InputBox tokens. Selected generation stays inside the admitted operation. | Busy/stale-failure, history/selection/scope cancellation and selected-kind regressions in `reportingPanel`.                                                                                                     | Independently bypass busy admission, stale failure protection, each awaited lifetime check and dialog cancellation: named regressions fail.                                       |
| P3 deferred growth           | Fixed: `UsageDialog.reportAction` is a slot; `reporting/UsageReportAction` owns the button and reads its label at render time. W binds it through the reporting lazy boundary.                                                          | `UsageDialog` injected-action regression and `reportingBundles` production graph: original cap and review-base size are both enforced; no reporting input enters legacy outputs.                                | Reinsert the report button into UsageDialog: the production bundle regression fails.                                                                                              |

No review finding is left as a residual. Existing integration handoffs 1–7
remain named above, including W's shipping entries/manifest/help/inventory,
the palette and composer bindings, and X/native/ACP/CLI/editor parity. They
remain safe as explicit unavailable/unbound operations and are not claimed
as completed product flows. W must bind the new action slot without
statically importing its reporting component into UsageDialog's chunk.

`m113-v-review-drills.json` records eleven deliberate mutations, complete
owning test-file runs, expected named failures, and original/restored
SHA-256 hashes. `m113-v-csp-red.json` records the additional complete
production-browser nonce drill and byte-exact restoration of the source,
green receipt and screenshot. Every Vitest run uses `--maxWorkers=3`, no
name filter and the repository's default timeout.

The updated `verify.mjs` builds the actual panel entry and executes it with
a fake VS Code port, real R fixture and real HTML builder. Chrome loads that
exact shell from loopback. The only test additions to the shell are a
nonce-authorized VS Code theme and fake editor bridge. It measures iframe
CSS rules, foreground, horizontal scrolling and width under the inherited
production CSP, observes CSP console errors, and runs all four themes at
690/320 px over report/history/diff/error. The separate standalone export
accessibility scan is retained. The ordinary browser favicon receives an
empty response; no console error or accessibility rule is suppressed.

### Review correction verification

| Check                                                       | Final result                                                                                                                                                                                                                                                                    |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm.cmd run typecheck`                                     | PASS, all five projects.                                                                                                                                                                                                                                                        |
| Changed-file eslint, reporting CSS stylelint, zero warnings | PASS.                                                                                                                                                                                                                                                                           |
| Changed-file Prettier and `git diff --check`                | PASS.                                                                                                                                                                                                                                                                           |
| Report panel/app/request files                              | 32/32 PASS.                                                                                                                                                                                                                                                                     |
| Controller/UsageDialog/palette files                        | 654/654 PASS.                                                                                                                                                                                                                                                                   |
| Production reporting bundle regression                      | 1/1 PASS.                                                                                                                                                                                                                                                                       |
| Browser harness                                             | 32/32 scenes PASS: zero page/standalone violations, zero CSP/page errors, keyboard focus present, ten applied iframe CSS rules and no outer/inner horizontal overflow. Sandbox axe `frame-tested` and narrow export contrast incompletes remain recorded.                       |
| `npm.cmd run build`                                         | PASS, including unchanged size/split/global/notices guards. Deferred **51,127/51,200 bytes**, 30 below the review base and 164 below the reviewed V tree. Startup **817,116/921,600 bytes**. Existing activation **440.5/600 KiB**, Model API **446.9/475**, ACP **821.5/850**. |
| `npx.cmd jscpd`                                             | PASS, zero clones.                                                                                                                                                                                                                                                              |
| `npm.cmd run deadcode`                                      | FAIL, unchanged W entry bindings: `reporting/main.tsx`, harness `verify.mjs`, namespace export `createReportingWindow`. New helper/action/test add no knip problem.                                                                                                             |
| `node scripts/check-l10n.mjs`                               | FAIL, exactly seven unbound report manifest keys; no UI-table problems across fourteen languages. W owns manifest registration.                                                                                                                                                 |
| `npm.cmd run check:reference`                               | FAIL, exactly two missing localized slash descriptions for `report`; W owns catalogue/reference binding.                                                                                                                                                                        |
| `npm.cmd run check:host-api`                                | FAIL, generated inventory stale: 342 VS Code APIs, 33 adapter files, 25 Node built-ins, 61 theme variables. W owns regeneration after integration; the added cancellation APIs are included in the source inventory.                                                            |

The cost expression passes the same guarded usage values to the same
estimator using a spread, saving the slot's otherwise 19-byte overhead;
cost/subscription behavior remains covered by all 41 UsageDialog tests.
All final test-file runs use default timeouts and at most three workers,
run directly on Windows 11. One intermediate controller run briefly
overlapped the approximately five-second bundle drill; the final controller,
usage, palette and bundle runs were repeated sequentially. No process,
timeout, hook, dependency or machine setting was changed to obtain a pass.

The independently built reporting panel is **99.5 KiB**, its standalone
browser page **453.3 KiB**, CSS **1.3 KiB**. R's decoded-field helper remains
in the lazy panel, never activation. These own-page builds are additional
to the existing shipping graph; W still owns their registration and joined
split measurement. Full `npm run quality`, coverage, other rigs, paid/live
sources and editor-adapter implementation were not run or claimed; the
brief reserves aggregate verification for the lead. No review residual,
dependency install, gate relaxation, push, rebase or merge.
