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
