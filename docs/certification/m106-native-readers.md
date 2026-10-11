# C-M106-3 certification — native Muse Code readers (2026-10-11, macmini)

Scope: `src/core/backends/musecode/feedback.ts`,
`src/core/backends/musecode/modelEfforts.ts` (new),
`EffortSlider.tsx` and `HistoryDialog.tsx` (verified, unchanged).
Base-file touches: one refusal line in `MuseCodeHost.ts`, three strings in
`src/shared/l10n/en.ts` plus all 14 `l10n/ui.*.json` tables, one assertion in
`test/unit/museCodeSdk142.test.ts`. PLAN acceptance 13; refusal with an
upstream request where Muse Code sends no frame
(`docs/research/m106-s1-upstream.md`, unposted draft).

## What was built

- **Effort (S1).** `parseModelEffortExtras` / `NATIVE_MODEL_EFFORTS`
  (`modelEfforts.ts`) validate one captured 1.4.4 `model/list` row's extras
  with zod and return the complete ordered `variants` (including future tier
  strings verbatim and the explicit `unknown` catalogue), the described
  tiers and `defaultReasoningEffort`. Rows without extras read as before;
  malformed extras throw. The port object is typed as the host's
  `modelEfforts` port, so binding is a construction-site argument.
- **Feedback (S2).** `parseFeedbackOutcome` / `NATIVE_FEEDBACK_READER`
  (`feedback.ts`) validate the captured note-only receipt (id 5) and return
  `feedbackUploaded`; receipt identifiers (upload id, bundle path) never
  leave the host. A record-attached receipt — no captured frame — refuses
  with `feedbackRecordUnsupported` instead of reporting an uncertified
  disclosure; any other future outcome is shown exactly as it arrived.
- **Delete (S4).** `session/delete` answers `methodNotFound` with no terminal
  frame (id 6), so `deleteSession` without a lifecycle reader now refuses
  with `sessionDeleteUnsupported` (was the bare `Delete` label) before
  dispatch. History stays archive-only: no `onDelete` is wired, which the
  existing History tests pin.
- **EffortSlider / HistoryDialog.** No production change: the slider already
  renders the captured catalogue order, descriptions, default, unknown tiers
  and empty ranges (6 existing tests), and History already hides deletion
  without `onDelete`. Re-running their suites against the capture-backed
  readers is the verification.

## Tests (repository timeouts, macmini)

- New `test/unit/museCodeNativeReaders.test.ts`: 13 tests, all passing.
  Reads the real `msp-1.4.4-host-feedback.json` frames: every catalogue row
  round-trips, the contributor row is pinned, the captured receipt shows the
  upload without identifiers, attached/malformed receipts refuse, the host
  serves both readers end to end (spy: `withFiles`/`attachSessionRecord`
  false unless ticked; attached receipt rejects after its one request), and
  deletion refuses before dispatch with zero `session/delete` requests.
- Neighbours, unchanged behaviour: `feedback` 14, `museCodeSdk142` 31,
  `EffortSlider` 6, `HistoryDialog` 17, `m106CaptureFixtures` 8 — all pass.
- Static gates: `npm run typecheck` (5 projects) clean,
  `eslint --max-warnings=0` on all touched files clean, `prettier --check`
  clean, `node scripts/check-l10n.mjs` 0 problems, `npm run deadcode`
  (knip) clean.
- Intended contract change, not a weakening: `museCodeSdk142`'s no-reader
  deletion refusal now asserts `sessionDeleteUnsupported` instead of the
  `Delete` label.

## Red drills (break → named failure → SHA-256 byte-exact restore)

Pre-drill hashes: `feedback.ts`
`cb4c62539d151fed959e8211aa83cb32b12cfbf7ef64ae9691665e38e0b3af6a`,
`modelEfforts.ts`
`26d0a1802e1781e7ccd4c4264f2757ce9f0745e2225c0e5d42070162cc1f7afa`,
`MuseCodeHost.ts`
`de5bd30c94e223da6dc188727c8eb1023b9e3d54e4657900fea19f35046e63ed`.

- D1: removed the attached-receipt refusal → `refuses a record-attached
receipt with the upstream request` and `reports the uncertified
attachment instead of an upload success` fail (2 failed, 11 passed);
  restored, hash matches.
- D2: narrowed `variants` to arrays (dropped `unknown`) → `preserves the
explicit unknown catalogue and future tiers verbatim` fails; restored,
  hash matches.
- D3: reverted the delete refusal to `memoryDeleteAction` → both deletion
  refusal tests fail; restored, hash matches.

## Open for the lead / integration

- Bind `NATIVE_MODEL_EFFORTS` and `NATIVE_FEEDBACK_READER` at the
  extension's `MuseCodeBackendManager` and the shared runtime backend
  construction (C-M106-5); until then both features keep refusing before
  dispatch in production, as S1 specifies.
- Restore list (0.17.1 truth pass, still pending): `FeedbackDialog.tsx`
  with its lazy turn-menu entry, zod bridge, ten dialog-only strings and
  Help's **Send feedback to Muse Code** — only after the reader is bound
  end to end. History `onDelete` wiring — only after the CLI ships typed
  delete frames (upstream request 1).
- Native `session/started`/`session/closed` notification reader and
  `parseDeleteAdmission` are out of scope here: no `deleteCompleted` or
  durable `listChanged` frame exists in the captures.
- All editors: the readers live in the shared core host serving VS Code,
  ACP and exec; no editor-specific path was added. Windows/macOS/Linux:
  no paths are compared or matched.

---

# C-M106-3R2 certification — end-to-end binding and the feedback dialog (2026-10-11, macmini)

Scope: bind the R1 readers where the backend is constructed (VS Code
window and CLI/ACP runtime) and restore the feedback dialog on the real
reader. Round 1 left both "for integration"; this round finishes the
chain — a reader nobody calls is not implemented.

Commits: `6f4b33c73` (host binding), plus the dialog and split commits of
this lane. Capture: `test/fixtures/m106/msp-1.4.4-host-feedback.json`
(workspace `/var/folders/r2/xm1s2y_x67zg6lz1kr7x8f2h0000gp/T/cm1061-msp-RCamx3`,
CLI `1.4.4-R5419.1`, provider `meta`, 0 model attempts, 6 requests). The
capture proves three wirings this round relies on: the client requests
`requestedCapabilities: ["sessionListStream", "feedback"]` and the server
grants exactly that; `feedback/submit` sends `{classification, note,
withFiles, attachSessionRecord}` note-only; the receipt (id 5) is
`{outcome: "uploaded", ...}` with `sessionRecordAttached: false`.

## What was built

- **Binding, both hosts.** `NATIVE_MUSE_CODE_FEATURE_PORTS`
  (`MuseCodeHost.ts`) carries the note-only `feedback/submit` receipt
  reader. `src/extension.ts` (VS Code window) and `museCodeManager` in
  `src/runtime/backends.ts` (CLI and ACP) pass it to
  `MuseCodeBackendManager`, which forwards it to every `MuseCodeHost`; the
  handshake now also asks for the `feedback` grant
  (`MSP_REQUESTED_CAPABILITIES`, appended last so the IDE-server warning's
  first capability is unchanged). `MuseSession` exposes the host disclosure
  ports through two new optional `AgentSession` members
  (`previewFeedbackNote?`, `submitFeedback?`); the Model API backend
  implements neither, so its sessions refuse before dispatch.
- **Effort preload split.** The `model/list` effort reader binds the same
  way, but `MuseCodeBackendManager.spawn` preloads its module from the new
  `dist/modelEfforts.js` (`modelEffortsEntry.ts`) on first spawn when the
  construction did not inject one. Static binding measured +684 B on the
  activation bundle and broke the lane K budget (3237 vs 3072); the split
  measures 2689 with identical behaviour — same captured catalogue through
  the same preload in both hosts. An injected reader (tests) wins over the
  preload.
- **Feedback dialog, restored.** `src/webview/components/FeedbackDialog.tsx`
  (lazy chunk, opened from the assistant turn's `⋯` menu) offers exactly
  what the capture certifies: a note with its classification. No Files and
  no Session-record checkboxes: no captured frame certifies them, and a
  record-attached receipt refuses with the upstream request — no control is
  shown that would be refused. The zod bridge is
  `src/webview/feedbackBridge.ts` (`previewFeedback`/`submitFeedback` with
  `requestId` correlation, every answer parsed before use, stale answers
  dropped, close rejects the in-flight send); the controller answers
  `feedbackPreview`/`feedbackOutcome` from the current session, refusing
  before dispatch without a session, without the port, for another session,
  for an unknown classification, without the grant, or while signed out.
  Ten strings in all 14 tables (five restored verbatim from the removed
  dialog, five new: the note-only privacy line and the four classification
  labels; Italian keeps the loanword `Bug` via `l10n/untranslated.json`) and
  Help's **Send feedback to Muse Code** (`native-feedback` in
  `src/shared/featureCatalog.ts`, reference regenerated to 78 features).
- **Session delete.** Unchanged: still refused with
  `sessionDeleteUnsupported` (1.4.4 sends no delete frames); History keeps
  hiding deletion. The upstream draft
  (`docs/research/m106-s1-upstream.md`) is untouched for the lead to file.

## Bundle evidence (production build, caps unraised)

- `dist/webview action dialogs: 22.7 KiB (budget 25 KiB)` — the dialog rides
  the lazy chunk with the other action dialogs.
- `dist/webview surface English: 24.4 KiB (budget 25 KiB)` — nine of the ten
  new keys load with the dialog; verified in `dist`: all nine are absent
  from `dist/webview/main.js` and present only in the lazy chunk, while
  `feedbackTitle` (the turn-menu label) paints with the menu in first
  paint. `dist/webview/main.js + static imports: 744.7 KiB (900)`.
- `dist/modelEfforts.js: 1.3 KiB (budget 25 KiB)`, loading only on the
  first model catalogue read, never at activation; `uiText: false` declared
  (pure validation, no English of its own).
- `dist/extension.js: 551.4 KiB (600)`; activation growth 2689 B over the
  pre-K baseline (561352 → 564041, allowance 3072).

## Tests (repository timeouts, macmini)

- New `test/unit/museCodeNativeBinding.test.ts`: 2 tests. A real `muse
serve` process over the real SDK transport (fake CLI serving the captured
  catalogue behind `MUSE_FAKE_MODEL_LIST=capture` and the captured receipt):
  the grant is asked and echoed, the contributor row arrives with its
  ordered variants and default, the receipt resolves to the upload line,
  deletion refuses — in the VS Code manager and in the runtime
  construction alike.
- New `test/unit/FeedbackDialog.test.tsx`: 7 React tests — captured
  disclosure only (four labels, no checkboxes), scrubbed preview before
  consent with the exact preview sent, re-preview after edit, refreshed
  preview after a mid-send refusal, bug-requires-note, unknown
  classification ignored, refusal and verbatim outcome statuses.
- New `test/unit/feedbackBridge.test.ts`: 5 tests — preview/send
  round-trips, refusal text, malformed/stale answers dropped, attachable
  disclosure refused before posting, close rejects the in-flight send.
- `test/unit/conversationController.test.ts`: 5 new dispatch tests (686
  total, all pass) — preview echo, no-session refusal with zero dispatch,
  byte-identical wire order end to end, wrong-session / unknown-class /
  no-grant refusals, signed-in refusal while signed out.
- `test/unit/museCodeNativeReaders.test.ts`: +2 (15 total) — the submit
  params serialise byte-identically, and submit refuses without the reader
  or the grant before dispatch. `protocol.test.ts`: +9 rows (152 total).
- Neighbours, unchanged behaviour: `feedback` 14, `museCodeSdk142` 31,
  `MuseCodeHost` 129, `museCodeBackendManager`, `modelApiGoldenRequests`
  (byte-identical for users who never open the dialog), `Transcript` +
  `featureCatalogDetails` 69 — all pass.
- Static gates: `npm run typecheck` (5 projects) clean,
  `eslint --max-warnings=0` on all touched files clean, `prettier --check`
  clean, `node scripts/check-l10n.mjs` 0 problems,
  `npm run check:reference` current (78 features), `npm run deadcode`
  (knip) clean, `npm run duplication` (jscpd) 0 clones,
  `npm run check:host-api` 0 problems, `npm run build` green.
- Blocked by this rig's sandbox (EPERM on loopback listen; no browser):
  `npm run test:a11y` and any screenshot run. The reviewer runs those —
  scenes below.

## Red drills (break → named failure → SHA-256 byte-exact restore)

- D4: removed `feedback` from `MSP_REQUESTED_CAPABILITIES` → both binding
  tests fail (`expected ['sessionMcp', …(2)] to include 'feedback'`);
  `constants.ts` restored (`f37424a8…`).
- D5: manager built without `featurePorts` → captured catalogue reads with
  `variants: undefined` (`expected undefined to deeply equal ['minimal',
…]`); test-only drill file removed, production untouched.
- D6: removed the controller's `message.sessionId !== session.sessionId`
  check → the wrong-session refusal dispatches (`expected 0 requests,
received 1` posture); `conversationController.ts` restored
  (`5314f638…`).
- D7: added a checkbox to the dialog → the no-attachable-disclosure test
  fails (plus label ambiguity in four others);
  `FeedbackDialog.tsx` restored (`b1b778bb…`).
- D8: bridge resolves the first waiter regardless of `requestId` → the
  stale-answer test settles early; `feedbackBridge.ts` restored
  (`1f804f9d…`).
- D9: removed the protocol note cap → the overlong-note rejection fails;
  `protocol.ts` restored (`ebe1a6d7…`).
- D10: reordered `feedbackRequestSchema` fields → both byte-identical
  goldens fail (wire order is canonicalised by the schema, not the
  callers); `feedback.ts` restored (`cb4c6253…`).
- D11: removed the manager effort preload → both binding tests lose the
  catalogue variants; `museCodeBackendManager.ts` restored (`f4a57629…`).

## Walked-back items this lane restored (R1 → R2)

- `src/webview/components/FeedbackDialog.tsx` (removed in `8f9c83a2c`):
  restored on the real reader, note + classification only.
- Its lazy turn-menu entry (`Transcript.tsx` assistant-row menu,
  `App.tsx` lazy chunk + bridge lifecycle).
- Its zod bridge (`previewFeedback`/`submitFeedback`/`feedbackPreview`/
  `feedbackOutcome` in `src/shared/protocol.ts`, answered in
  `conversationController.ts`, correlated in `feedbackBridge.ts`).
- Ten strings in all 14 languages (five restored verbatim, five new).
- Help's Send-feedback entry (`native-feedback` in
  `src/shared/featureCatalog.ts` + regenerated reference + capability and
  action maps in `referenceSource.ts`).
- Reader binding at both constructions (`extension.ts`,
  `runtime/backends.ts`, `feedback` grant, effort preload).

## Still hidden, with reasons

- Files and Session-record checkboxes: no captured frame certifies them;
  record-attached receipts refuse with `feedbackRecordUnsupported`
  (upstream request 2). Offering them would show a control that refuses.
- Session delete / History deletion: 1.4.4 sends no delete frames;
  `sessionDeleteUnsupported` stays, History stays archive-only (upstream
  request 1).
- The `feedbackClassification*` labels and dialog strings stay out of
  first paint except `feedbackTitle`, which labels the turn-menu entry and
  must paint with the menu.
- ACP/CLI have no interactive feedback prompt: no turn menu exists there;
  the runtime binds the same readers, so a future headless surface inherits
  the receipt parsing and refusals unchanged.
- The five new non-English string sets (privacy line, four labels) are
  first-draft translations by this lane; a native speaker has not reviewed
  them.

## For the reviewer (browser + loopback, outside the lane sandbox)

- New harness scenes to author, run and baseline (320 px `*-narrow`
  pattern, ready `[role="dialog"]`): `feedback-narrow` (idle),
  `feedback-preview-narrow` (approved preview),
  `feedback-sent-narrow` (upload outcome) — each across the six themes
  (`light dark hc-dark hc-light one-dark-pro dracula`), e.g.
  `node scripts/harness-shots.mjs feedback-narrow --theme=dark`, plus the
  pseudo-locale pass (`npm run harness:shots -- --lang=pseudo`), then
  `npm run check:visual` with reviewed baselines named.
- `npm run test:a11y` (blocked here: EPERM on `127.0.0.1` listen).
- Opt-in live receipt against a real 1.4.4 `muse serve` is still open
  (owner's key, per the R1 record).

## C-M106-3R3 review repairs (RVCM1063, 2026-10-11, macmini)

All four P2 and four P3 findings fixed and shipped; no residuals. Commits
`9b028535e` (findings 1/2/5/8), `65e962c44` (finding 3), `5ebd79a55`
(findings 4/6/7), plus the docs commit below. Every drill broke the guard,
saw the named test fail, and restored byte-exact (hash-verified).

| Finding             | Fix                                                                                                                                                                                                                                                                                                                                                                                                  | Regression test (fails without it)                                                                                                                                                                                                           | Red drill                                                                                                           |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| 1, dialog honesty   | `parseFeedbackOutcome` resolves only `uploaded`; every other SDK outcome (`recorded`, `acceptedWithoutReceipt`, `trackingFailed`, `trackingUncertain`, `dark`, `disabled`, `noCredential`, `authRejected`, `rateLimited`, `failed`, future strings) refuses with its own sentence in all 14 tables; the dialog shows `error.message`, never the generic failure over a reason                        | `museCodeNativeReaders`: per-outcome refusal table + unknown-outcome line; `FeedbackDialog`: sign-in refusal, rate-limit sentence, reasonless refusal                                                                                        | reader guard returned verbatim: 10 failed; dialog `refusalOf` forced generic: 1 failed                              |
| 8, false success    | bridge rejects a reply with neither outcome nor error (`feedbackFailed`)                                                                                                                                                                                                                                                                                                                             | `feedbackBridge`: neither-outcome-nor-error rejects                                                                                                                                                                                          | resolve-instead-of-reject: 1 failed                                                                                 |
| 2, note limit       | textarea `maxLength={FEEDBACK_NOTE_MAX_CHARS}` + `{used} of {max}` counter; bridge refuses overlong preview/submit with the too-long sentence before posting, so nothing waits                                                                                                                                                                                                                       | `FeedbackDialog`: maxLength attribute + counter text, refused preview settles with reason and re-enables Preview; `feedbackBridge`: overlong preview/submit reject with reason, zero posts                                                   | maxLength removed: 1 failed; bridge pre-check removed: 1 failed                                                     |
| 5, request ids      | module-lifetime id holder (no two bridges share an id); `close()` rejects preview waiters too; App closes the bridge when the session changes                                                                                                                                                                                                                                                        | `feedbackBridge`: ids unique across bridges, stale answer settles nothing; `App`: session change unmounts the dialog and removes the bridge listener                                                                                         | per-bridge ids: 1 failed; App effect removed: 1 failed (proves the test is not a false positive on the render hide) |
| 3, effort catalogue | `variants`/`reasoningEffortVariants`/`defaultReasoningEffort` ride `ModelSummary` → controller `toModelOption` → `modelOptionSchema` (open strings, so a later tier never rejects the list); footer and palette dots render the catalogue via `catalogueSliderProps`; ACP options name the catalogue tiers and new sessions start on its default; malformed rows read tierless with a logged warning | `effortCatalogue`: captured frame → host → mapping → wire parse → rendered tiers (descriptions, `max` pressed), plus a `turbo` row riding the wire; host isolation, `effort` helper, palette registry, App footer, ACP default/options tests | mapping drops `variants`: composition fails; `catch`→`finally`: isolation fails                                     |
| 4, styling + scenes | form uses `question-input`, `question-actions`, `button-primary/secondary`; block labels, full-width controls, counter; modal title wraps beside its close button; `feedback(-preview/-sent)-narrow` scenes drive the real dialog with end-state readiness gates                                                                                                                                     | `feedbackScenes.test.mjs`: registration, 320 px sizing, steps, readiness markers, label key, host answers                                                                                                                                    | renamed scene step: 1 failed                                                                                        |
| 6, Italian label    | `feedbackClassificationBadResult` reads `Brutto risultato` again                                                                                                                                                                                                                                                                                                                                     | `feedbackL10n`: pins the corrected wording                                                                                                                                                                                                   | reverted wording: 1 failed                                                                                          |
| 7, binding test     | VS Code case asserts `src/extension.ts` carries `featurePorts: NATIVE_MUSE_CODE_FEATURE_PORTS`                                                                                                                                                                                                                                                                                                       | `museCodeNativeBinding`: production-wiring read                                                                                                                                                                                              | wiring line deleted: 1 failed                                                                                       |

Deliberate non-changes, with reasons:

- The panel composer keeps the `high` default (`constants.ts` documents the
  TUI agreement); the controller imposes it on every session start, so the
  footer honestly shows the running effort. The catalogue default takes the
  dot whenever the session runs it, and ACP starts on it.
- A catalogue tier outside the extension's vocabulary (and the SDK's closed
  `ReasoningEffort` union) renders with its catalogue name but is not
  selectable through the `EffortLevel`-typed path; ACP does not offer it.
- The receipt's `cause`, `sessionNote`, `localTracingNote` and `retryAfterMs`
  stay host-side: no captured frame certifies showing them, and free text
  from the server never reaches the panel.
- The twelve new sentences are first-draft translations by this lane, as the
  earlier sets were; a native speaker has not reviewed them.

Gates run on the rig: `node scripts/check-l10n.mjs` 0 problems (14 UI
tables); `npm run typecheck:host`, `typecheck:webview` clean; `npm run
build` exits 0 with budgets held; eslint/prettier clean on every touched
file. Full files green: `FeedbackDialog` (12), `feedbackBridge` (8),
`museCodeNativeReaders`, `protocol`, `EffortSlider`, `effort`,
`paletteRegistry`, `effortCatalogue` (composition), `conversationController`
(686), `App` (188). `acpAgent`: 142 pass including the new catalogue test;
`exposes all three ChatGPT actions` fails identically on the untouched lane
base `f48fb0e7d` (verified in a clean worktree) — pre-existing, unrelated to
this lane. One earlier single-test flake in `App.test.tsx` passed on the
next three consecutive runs.

## For the reviewer (browser + loopback, outside the lane sandbox) — updated

- The three narrow scenes are AUTHORED (`feedback-narrow`,
  `feedback-preview-narrow`, `feedback-sent-narrow` in
  `test/harness/index.html`, registered in `scripts/lib/harnessServer.mjs`,
  pinned by `test/unit/feedbackScenes.test.mjs`). Still the reviewer's:
  render and review baselines (`npm run harness:shots` incl. `--lang=pseudo`,
  six themes), regenerate the visual manifest/audit entries, run
  `npm run check:visual` and `npm run test:a11y`.
- Opt-in live receipt against a real 1.4.4 `muse serve` is still open
  (owner's key, per the R1 record).
