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

## C-M106-3R4 — RVCM1063B (2026-10-11, linuxlt)

The authorized `snap/04f47a026` merge is `f22ba55f7`, with installed hooks.
Changelog conflicts retain both behaviours; reference conflicts were regenerated.
The combined translation tables were reordered to the English shape without
changing values. The four required merge replays passed: execRun/execFetch/
execTestLauncher **810**, execStdio **44**. No push, rebase, additional merge,
dependency, live model request or paid request.

| Finding              | Repair                                                                                                                                                                                                                                                                  | Regression                                                                                                                                                                                            | Deliberate failure and restoration                                                                                                            |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| P1, inert feedback   | Dialog is a sibling of the header, transcript and composer. The first-use lifecycle owns its bridge, cleanup and explicit row opener. It joins the existing modal arbitration.                                                                                          | `feedbackBrowser`: three 320 px scenes in six themes; real pointer input, focus inside, Tab/Shift+Tab wrap, Escape and opener return, inert page. `App`: actual note control, not the loading dialog. | Put dialog back inside header: all 18 interaction cases fail. Combined P1/P3 run: 25 failed, 2 passed. App and harness restored byte-exact.   |
| P2, session revival  | Session mismatch discards feedback state during render; unmount closes and settles the lazy port. Closed ports refuse fresh previews too.                                                                                                                               | `App`: S1 → S2 → S1 stays closed, explicit reopen gets a fresh form. `feedbackBridge`: fresh closed-port preview refuses with zero posts.                                                             | Remove state discard: named session-change regression fails. Restore App byte-exact. Closed-preview guard drill recorded below.               |
| P2, effort range     | `effortLevelsFor` projects served variants to the selectable vocabulary; absent catalogue alone falls back. Footer, pointer/keyboard palette, ACP options/default/clamping/admission and controller selection use it. Headless reads ACP options after model switching. | Served/absent table across pointer, keyboard, palette and ACP; empty/unknown/future-only ACP lists never fabricate options; controller and headless refusal regressions.                              | Remove catalogue projection and slider admission guard: 7 failed, 167 passed across ACP/Palette/EffortSlider. Both files restored byte-exact. |
| P3, pseudo receipt   | Fake host reads `feedbackUploaded` through the same installed-language lookup used by scene labels.                                                                                                                                                                     | Six Chrome pseudo receipt cases and `feedbackScenes`.                                                                                                                                                 | Hardcode English receipt: six pseudo cases and scene-source assertion fail, independently of the inert check. Harness restored byte-exact.    |
| P3, unavailable tier | Served descriptions and unfamiliar names remain visible; tiers absent from the selectable vocabulary/range are disabled and cannot dispatch.                                                                                                                            | Footer table, standalone slider and mouse-only palette dots.                                                                                                                                          | Included in the seven-failure effort drill; slider restored byte-exact.                                                                       |

The production feedback request schema, local redactor, second scrub and exact
preview check moved unchanged into `feedbackRequest.ts`; the native receipt
reader re-exports them for existing hosts. Browser imports no longer bring the
native receipt schema/taxonomy. The lifecycle and form have separate lazy
owners. A new first-use lifecycle guard measures its complete static closure;
existing startup, original deferred aggregate and action-dialog caps are
unchanged. The effort footer and catalogue adapter also load with the existing
slider owner. Every loading/failure/retry uses the existing accessible boundary.

The handshake expectation now includes the intentionally requested fourth
`feedback` capability, documented by R2 above and its captured request/grant.
The deferred fixture includes `modelEfforts` and its required-membership and
activation/ACP exclusion drills; its headless fixture matches the production
Node target and navigator definition. Omit that fixture: 88 failures. Combined
closed-preview/fixture drill: 89 failed, 57 passed; exact restores verified.

Initial complete feedback verification: **215 passed** (App 188, real Chrome
24, scene registration 3). Complete ACP table verification: **148 passed**.
All commands use repository deadlines and at most three files/workers.
Final owning/dependent, typecheck, static/build and accessibility results are
recorded below; these initial counts do not claim the final split verified.

### External integration controls

Native review: the same dirty repository on this machine gives **refused**
through `processGitRunner` and **material** through Node's native Git runner.
One control fails, one passes. The wrapper throws `GitExitError.exitCode = 1`
for an empty filter inventory; the collector reads only `code`, so it refuses
before Host/Plan admission. Both files are byte-identical to `dedaf3eb0`:
`reviewCollector.ts` SHA-256 `6e29097b44d12773399bc5f69c881647bb4407fe972813436b9357fcd36afc21`;
`git.ts` `bc792b7e6f3e51b39fd25669f4725c45f281a7147681080d82ccc66b19789e2d`.
This is the lead-owned collector defect named by the brief, not a new reader
regression. The temporary control suite was removed after preserving its
receipt in this record. No user Git configuration was changed.

Native schedule fixture: `/run/user/1000/systemd/user` is owned by uid 1000
with mode **0775**, so the real guard correctly refuses that ancestor before
the deliberately writable drop-in. A private launcher trust anchor still
encounters that ancestor; a private runtime-root experiment cannot use the
real user manager and returns unavailable. Following the common two-fix
rule, the original test was restored. No search-root permissions, user bus,
launcher guard, assertion, timeout or skip was changed. The lead decides the
safe native fixture/environment qualification; this result is not green.

### Final receipts and incomplete qualification

- All **five typechecks passed** in `temp/typecheck-verified.log`.
- Production `npm run build` passed with existing caps unchanged. Final exact
  bytes: startup **761,456** (reviewed before **763,671**, strict cap
  **761,548.8**), original deferred **32,648** (cap **32,870.4**), action
  dialogs **23,877** (cap **25,600**), first-use lifecycle **2,273** (new
  guard **25,600**), headless **100,939** (existing cap **102,400**).
  `resolveExecOutputCap` already supplies the same 32,768 fallback that the
  unnecessary full fallback policy constructor produced; supplied records
  retain their own capped maximum. The eager constructor was removed.
- Final completed owning files: real Chrome **24**, webview budgets **58**,
  App **191**, ACP **148**, execRun **95**, execResources **6**; all pass at
  repository deadlines. Headless admission drill: replacing ACP admission
  with the static family guard makes the named new refusal test return 8
  instead of 2; source restored byte-exact. That exploratory concurrent run
  also hit three Chrome and two standalone-process deadlines. Final isolated
  files pass without increasing a timeout.
- Related selection: **276 files**, **213 completed**, **6,980 passed**,
  **2 failed**, **163 skipped**, plus four failed conversation suite hooks.
  `docs/certification/m106-r4-dependents.json` names every result and all
  **63 incomplete/not-started files**, including interrupted reviewMaterial.
  Heavy process/browser files were isolated; other batches contain at most
  three files. Live flags were verified off; no live tests are implied run.
- Remaining completed reds: native schedule's real 0775 search ancestor;
  conversation's four inherited no-filter admission hooks; deferredBundles'
  10-second setup hook under the App/ACP batch (120 cases not executed);
  evalRunner's held-out-floor 120-second timeout (that batch took 3,654 s).
  These are unresolved qualification blockers, not passing tests. The expanded
  150-minute brief allowance expired during native review; its related process
  tree was stopped and the exact remaining list preserved.
- Static checks observed green: deadcode, localization, host API, reference,
  roadmap, plan and production build. Initial lint findings were fixed;
  initial duplication found a pre-existing dialog-refusal repetition and the
  new native runtime fixture repetition, both consolidated without changing
  assertions. Final lint/format/hook receipts accompany the commits; aggregate
  quality remains lead-owned and is not claimed.
- Repository accessibility command: **12 pages**, all three narrow scenes in
  its four built-in themes, zero violations/undecided results. The separate
  six-theme audit receipt is appended below. Full visual baseline qualification
  and the 63 remaining dependents have not been completed here.

No review finding is accepted as a residual. The five product repairs are
implemented and the main owning paths verified; the complete brief is **not
certified complete** because the named qualification work remains. Lead next:
land the no-filter collector repair, qualify the native fixture on a safe
systemd root, resolve the setup/evaluation deadlines, complete the exact
remaining sweep and visual gate, then review/integrate the local commits.

Six-theme axe receipt: **18 pages, zero violations and zero incomplete rules**,
all three narrow scenes in light, dark, hc-dark, hc-light, One Dark Pro and
Dracula; `docs/certification/m106-r4-a11y.json`. Browser and server closed.

Final hook receipt: `84ed63c96` ran installed lint-staged ESLint/Prettier
and gitleaks successfully; staged and committed diffs re-read. Fixture
facade cleanup retains identical behaviour; final duplication gate reports
zero clones. Worktree remains unreleased and the qualification holds above
remain explicit. HUB: integration run — combined translation tables,
featureCatalog, referenceSource and generated reference data.

## Round 5 — RVCM1063C findings (2026-10-12, linuxlt rig)

Merge note: the brief's `snap/train` ref does not exist locally and
`release/train-0.15.0` is already fully merged (`c15b7eeae` is an
ancestor of this lane), so the merge step is satisfied with no new
merge. The named review-collector fix lives on `fix/review-git-exit`,
whose base has diverged by ~779 files; instead of that merge, its two
source hunks (`gitExitCode` in `src/host/git.ts`, `exitOf`/filter
admission in `src/host/review/reviewCollector.ts`) are ported verbatim
to this lane's files as `7b09ed4d2`. That port clears the four
held-admission controller hooks and the reviewMaterial representative
case on this rig; both were red on base and head alike before it.

Cause → findings → fix → test → drill:

- **Startup admission → finding 1.** `attach()` sent the composer's
  default high on every new and attached session. It now clamps to the
  highest tier the session's model serves and sends nothing when the
  catalogue has no selectable tier; the composer echoes the clamp.
  Test `the first send admits the $catalogue catalogue` in
  `test/unit/conversationController.test.ts` (low-only/empty/future-only
  through the real controller/MSP fixture). Drill: guard removed → 3/3
  fail with the review's `[high]`-vs-expected signature; file restored
  byte-exact (`bd22a3ea…`).
- **Unfamiliar-tier presentation → findings 2 + 6.** The Modes footer
  hid for future-only catalogues (`App.tsx` condition) and an unfamiliar
  tier's tooltip/name repeated its name (`EffortSlider.tsx`). The footer
  renders whenever the catalogue names tiers (visibility decided in the
  lazy `EffortMenuFooter`, keeping the startup closure under its strict
  baseline), and an unselectable tier's tooltip and accessible name
  carry the new `effortTierUnsupported` sentence (en + 14 tables) in the
  footer and the palette row alike. Tests: App `keeps the $catalogue
catalogue visible…` (future-only/mixed) plus updated slider units.
  Drills: App condition restored → 2/2 App cases fail; label restored →
  2 slider cases fail; after relocating the check, breaking it fails
  exactly the future-only case; all files restored byte-exact.
- **Modal arbitration → finding 3.** The `openSharing` overlay and the
  share view rendered unconditionally over feedback. Both wait while
  feedback owns the panel under the one-modal policy; the overlay/state
  persists so the queued surface opens on feedback close (sharePreview
  can only answer a user share action, but an in-flight answer racing
  feedback is the same class, so it waits too). Test `queues a
host-opened sharing surface…` in `test/unit/App.test.tsx`. Drill:
  gate removed → 1/1 fails with two dialogs; restored byte-exact.
- **ACP assertion → finding 4.** The promoted-preview assertion omitted
  the `locations` the repair sends; it now asserts
  `[{ path: path.join('/ws', 'a.ts') }]` (resolver-agrees on win32).
  Full file 22/22. Drill: `locations` dropped from `translate.ts` →
  the named test fails; restored byte-exact (`f7bff799…`).
- **Visual inventory → finding 5.** `componentAuditInputs` gains
  `FeedbackDialog` + `FeedbackSurface`; `m114-audit.json` gains both
  owner rows (P2, scenes `feedback-narrow` /
  `feedback-preview-narrow`), all three narrow scenes, the bridge
  classification + sources entries, and nine hash refreshes across seven
  files (App/slider twice from this round, five inherited).
  `visualMatrix` 9/9 and
  `m114Audit` 7/7 pass. Drill: inputs removed → the exact gate test
  fails; restored byte-exact. Manifest captures (3 scenes × states ×
  themes × widths) need browser renders — no bytes invented — so
  capture plus reviewed baseline qualification stays the lead's step.
  Scenes that move and why: `modes` (footer newly renders for
  future-only catalogues), `prompts`/`chatShare`/`share` (now queue
  behind feedback), the three new feedback scenes (first baselines).
  No baseline PNG was created or changed.

Final gates (linuxlt, repository timeouts): five typechecks pass;
`npm run build` exits 0 with no cap moved (extension 551.7/600 KiB,
modelApi 517.7/525 KiB, chat startup closure **761,480** bytes vs the
strict **761,548.8** review baseline, margin +68.8); `check-l10n` 0
problems; `check-bundle-split` 0; scoped ESLint/Prettier clean;
`reviewMaterial` representative and all four held-admission hooks pass;
`nativeScheduleBackground` passes here (its review red did not
reproduce on this rig); full `reviewMaterial` (547 s) and
`check:visual` captures (browser) not run here. No new dependency, no
guard widened, no `as`/`eslint-disable`/`any` added.

Dependents (`vitest related` over the five touched src files, repo
timeouts, linuxlt): **193 files, 185 pass, 6 fail; 6,245 pass, 43
fail, 41 skip.** One failure was this round's (palette row's `turbo`
title, fixed the same way as finding 6). The other five files fail on
sandbox-blocked primitives only — loopback listen/connect timeouts
(`configuredProviders`, 21 `runtimeChatGpt` timeouts), missing D-Bus
secret service (`runtimeChatGpt` DBus line), blocked outbound fetch
(`chatGptVsCode` fetch-failed/cancelled, `subscriptionIntegration`),
and a proxy-injected 502 where 401 was expected
(`usageIntegration`); all five passed in the review's rig replay, and
none touches an edited path. Lead re-runs them outside the sandbox.
