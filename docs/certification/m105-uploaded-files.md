# C-M105-8 — uploaded-files binding (Delete uploaded files and age-based clean-up)

Linux rig `linuxlt`, worktree `/home/randy/lanes/CM1058`, branch `c/m105-8`,
base `68e6e7206` (m105/port-0171). No sub-agents. No live or paid model
calls, no pushes, no merges. PLAN M105 lane F (Files API) is the
specification; where this record differs from PLAN it says so.

## What this lane binds

`ConversationDeps.uploadedFiles` had no production supplier: the VS Code
command and the usage dialog's uploaded-files section ran against an
undefined port. This lane supplies it on both hosts from one core factory
over the per-session upload ledger the media work already has:

- `src/core/media/uploadedFiles.ts` (new): `createUploadedFilesPort`
  over `{ ledger(), post?, confirmForeign? }`. No ledger reads an empty
  read-only report and deletes nothing; a failed provider delete propagates
  with its reason and the row stays.
- VS Code (`src/extension.ts` + `src/host/conversation/uploadedFilesBinding.ts`,
  new): the port over the shared `loadSessionUploads` loader, the report
  posted to the usage dialog (`uploadedFilesReport` message, list + dialog
  delete buttons), foreign deletions behind a modal, and **Delete Uploaded
  Files…** as a QuickPick over the ledger.
- Runtime (`src/runtime/backends.ts`, `src/acp/uploads.ts` + `/uploads` in
  `src/acp/agent.ts`): the same core port over the agent-data-folder ledger;
  `/uploads`, `/uploads delete <file>`, `/uploads delete-all`. A foreign
  file is kept with its reason (a single-shot command cannot ask the modal
  question); empty or missing ledgers say so and delete nothing.

Age-based clean-up: uploads carry `museSpark.mediaUploadExpiryDays`
(`uploadExpirySeconds`, 7 by default, clamped 1–30 days into the wire's
`expires_after` bounds) at both Files constructions. Automatic clean-up
(`UploadLedger.cleanup`, reached from session deletion and the
`cleanupPeriodDays` purge through `releaseSession`) now offers only
unreferenced uploads at or past the provider's `expiresAt`; a younger
orphan stays listed until then, and explicit deletion (`deleteFile`,
`deleteAllOurs`) removes it early. A provider 404 on delete records the
file as gone, never as an error. One judgment call against PLAN's letter:
PLAN D85.2 says deleting a session deletes its provider copy "once no
session refers to it"; the owner's brief orders the age gate, so a young
orphan is deleted at expiry rather than at release. The provider also
removes it at expiry, so nothing lingers past the configured days.

Concurrency: the ledger's existing lock
(`fileUploadLedgerStorage` over `core/fileLock`'s `withMkdirLock`).
There is no `src/core/locks/fileLease.ts` on this base. Two windows
serialize on the same lock file; the composition test proves one delete.

Money and privacy: clean-up, purge and delete paths issue only `DELETE`
(no `POST`, `GET`, no `authorizeUpload` beyond upload admission, no paid
traffic); the ledger on disk holds metadata only (the composition test
asserts the exact key set and no paths). Shown errors go through
`redactSecrets`.

## Red drills (deliberate breaks, all restored)

- `test/unit/uploadLedger.test.ts`: the young-orphan test failed twice on
  the base (`DELETE` issued for an unexpired entry), then passed after the
  `expiresAt` gate; `deleteAllOurs` on a young orphan failed after gating
  (0 deletes) and passed after its immediate loop.
- `test/unit/uploadedFilesComposition.test.ts`: the expiry test failed
  while the fake returned a 30-day receipt against the 7-day default
  (`Invalid upload receipt`), proving the wire validation still bites;
  fixed with a fitting receipt.
- The 4 `conversationController.test.ts` review suites
  (`M70 native material admission, held Host/Plan admission`) fail on this
  rig AND on a clean base worktree at `68e6e7206` (scratch worktree under
  `$TMPDIR`, removed): pre-existing, real-git timing, unrelated to this
  lane. Not touched.
- 5 `files.test.ts` wire tests fail identically on the lane and on the
  clean base (proxy 502 on the loopback fake server: the sandbox exports
  `HTTPS_PROXY` with an empty `no_proxy`). Environmental, pre-existing;
  the lead runs them outside the sandbox. Not touched, not worked around.
- `npm run duplication` (threshold 0) is red on the base (about 30
  pre-existing pairs, mostly intra-file). This lane adds no new pair: the
  port interface, the error describer, the Files client, the report
  fixture and the ACP harness are each defined once and shared; the
  reference `uploads` feature covers the new host actions.

## Tests (repository default timeout, no --testTimeout)

- `test/unit/uploadLedger.test.ts`: 14 passed (4 new).
- `test/unit/uploadedFiles.test.ts`: 4 passed (new).
- `test/unit/uploadedFilesBinding.test.ts`: 5 passed (new).
- `test/unit/acpUploads.test.ts`: 8 passed (new).
- `test/unit/uploadedFilesComposition.test.ts`: 6 passed (new).
- `test/unit/conversationController.test.ts`: 684 passed, 4 skipped,
  4 pre-existing suite failures above.
- `test/unit/fileSessionStore.test.ts`, `test/unit/files.test.ts`,
  `test/unit/mediaUploadStores.test.ts`,
  `test/unit/mediaProductionService.test.ts`: run in final verification.
- Gates: `node scripts/check-l10n.mjs` 0 problems (5 new keys × 15
  tables); `tsc` host + webview clean; eslint/prettier clean on touched
  files; `npm run build` exits 0 (rows below).

## Bundle rows (exact bytes from `npm run build`)

- `dist/extension.js` 553.0 KiB (budget 600 KiB).
- `dist/acp.js` 235.9 KiB (budget 850 KiB).
- `dist/media.js` 20.5 KiB; `dist/modelApi.js` 511.4 KiB (budget 525 KiB);
  `dist/productionMedia.js` 66.9 KiB. No cap raised.

## Reference and strings

- 6 new English keys (`deleteUploadedFilesPick`, `uploadsDescription`,
  `uploadsUsage`, `uploadNotFound`, `uploadForeignKept`, `uploadsName`),
  translated in all 14 tables; `check:l10n` 0 problems.
- New `uploads` reference feature (Model API on VS Code + ACP) covering
  the `deleteUploadedFile` / `deleteAllUploadedFiles` host actions;
  `check:reference` green after `reference:generate`; `check:host-api`
  green after `-- --write` (QuickPick `canPickMany` row).

## Hand-off for the lead

- Unavailable-settings registry: `src/shared/settingsAvailability.ts`
  does not exist on this base; nothing to remove here. If the settings
  branch carries `museSpark.mediaUploadExpiryDays` as unavailable, that
  entry goes now that uploads honor it and the command is bound.
- Help/README lines that became true: the README settings row for
  `mediaUploadExpiryDays` (true as written, kept) and the media paragraph
  (rewritten: expiry honored, command bound in VS Code + `/uploads`);
  `docs/acp.md` M105 commands (added `/uploads`).
- Still needs (real delete response not captured): the exact
  `DELETE /v1/files/{id}` response body for a live provider delete. To
  capture today: `curl -X DELETE "$MODEL_API_BASE_URL/v1/files/<file_id>"
-H "Authorization: Bearer $KEY"` on a throwaway upload and record the
  JSON (the code accepts `{id, object: 'file', deleted: true}` from the
  U6 capture; a live receipt confirms it unchanged).
- Native-host and companion rows: none touched; C-M105-6 owns them.
- Shared hunks (touch points for the sibling lanes): `uploadLedger.ts`
  cleanup/`deleteAllOurs`; `files.ts` `uploadExpirySeconds`;
  `sessionUploads.ts` return type + `expiryDays`; `ModelApiHost.ts` /
  `modelApiEntry.ts` / `modelApiBackendManager.ts` `uploadExpiryDays`;
  `protocol.ts` 3 messages; `conversationController.ts` auth set + 2
  dispatch cases; `uiState.ts` + usage dialog adapter; `agent.ts`
  `/uploads`; `backends.ts` / `main.ts` runtime port. No helper copied an
  existing one.

## What remains

- Provider/editor certification (lead-owned): live receipts L/LA/LR,
  Windows/macOS native qualification, hosted matrix.
- The M104 companion `attachments/*` bridge and native-host rows
  (C-M105-6, per brief).
- `deleteAllOurs` keeps referenced uploads (by design; the dialog's
  Delete-all button stays disabled for them with the in-use title).
