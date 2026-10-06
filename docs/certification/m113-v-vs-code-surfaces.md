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
3. **W � composer binding:** dispatch palette action `{ type: 'showReport' }` to `ConversationController.showDeterministicReport()`, and bind `UsageDialog.onUsageReport` to the same operation with `usage` arguments. Provide a dedicated strict report-command/ack protocol and intercept the composer before its optimistic model row. The controller's compatibility guard presently reports a rejected model submission through existing `sendFailed`, opens the local report and retains attachments. It never starts a model turn, including signed-out use. This fallback is safe, but needs the dedicated acknowledgment for the final polished composer flow.
4. **S/X/W � snapshot identity:** the factory derives a SHA-256 workspace key from slash-normalized root (case folded on Windows), and supplies workspace root, storage root and l10n. Align it with S/X's canonical history identity. Bind actual session/check-run/registry/network-policy sources; no collector is fabricated here. History and compare call the lane-0 host contracts and validate their results.
5. **X / M104 native owners:** mount the same `ReportApp` with a `ReportingBridge`, implementing the strict page messages over `reports/*`. X owns ACP Markdown/text and CLI formats/flags; native JCEF/WebView2/SWT, TUI and desktop adapter tests are waiting for their owners. This lane makes no certification claim for those absent hosts.
6. **H � saved options:** history metadata on this base carries only a header, so Refresh of an opened saved report uses its kind/scope with local defaults (`full=false`, `network=false`); expose saved normalized options if Refresh must reproduce historical breakdown/session flags. Live report Refresh preserves its original options and advances only `asOf`.
7. **W � final harness:** register the independent report/history/diff/error scenes with the shipping build and accessibility command. Four standard theme palettes live in the lazy adapter; move them into the shared constants region if W centralizes those colors.

## Verification record

Final scoped gate and browser receipts are appended before lane completion. Eighteen deliberate mutations fired their named regressions with exit 1; every mutated file was restored byte-exact with matching SHA-256 (see `m113-v-red-drills.json`). Initial new suites: 20/20 pass with the repository's default timeout. Existing controller, usage and palette suites: 654/654 pass with the default timeout. Changed TypeScript/TSX and the independent harness verifier pass eslint with zero warnings. No aggregate quality claim.
