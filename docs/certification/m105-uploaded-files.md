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
- `test/unit/conversationController.test.ts`: 685 passed (incl. the new
  dialog-dispatch test), 4 skipped, 4 pre-existing suite failures above.
- Lane suites final: `uploadLedger` 14, `uploadedFiles` 4,
  `uploadedFilesBinding` 5, `acpUploads` 8, `uploadedFilesComposition` 6,
  `acpAccounts` and `fileSessionStore` green alongside: 87 passed total.
- `test/unit/files.test.ts`: 11 passed, 5 pre-existing sandbox-proxy
  failures above (identical on the clean base).
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

## Round 2 — RVCM1058 findings (2026-10-11, macmini lane CM1058R2)

Branch `c/m105-8` at `98eb03aaa` plus round-2 commits below. Every P1/P2/P3
finding is fixed with a regression test that fails without it; each guard
was broken on purpose (red drill), seen to fail its named test, and
restored byte-exact (SHA-256 checked). All runs at the repository default
timeout, `npx vitest run <files> --maxWorkers=3`, at most 3 files per run.

**Correction of the round-1 judgment call (ruling 5):** PLAN D85.2 wins.
A file is deleted at the provider when its LAST session reference is
released or purged, however young. The age sweep stays only for orphans
no release ever saw (a crash, another install). The young-orphan age gate
is removed from the release path (`UploadLedger.cleanup` takes a
`'release' | 'sweep'` scope); the round-1 drill bullets above describe the
superseded behavior.

| Finding             | Fix (file)                                                                                                                                                             | Regression test (fails without)                                                                                                  | Red drill (break → failure → restore)                                                                                                  |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| 1 (P2) diet +75 B   | `modelApiEntry.ts` expiry hunk replaced by diet-safe `productionMediaEntry.ts` lazy replay; no guard moves                                                             | `deferredBundles` diet guard (review-confirmed red pre-fix: 523,704 vs 523,629)                                                  | review's base+lane measurement; post-fix bundle 523,388                                                                                |
| 2 (P2) types        | typed fixtures (`UploadedFilesLedger` Pick, `filesClient`, `StoredSession`); no casts                                                                                  | unit project `tsc --noEmit` (review-confirmed exit 2 pre-fix; exit 0 now, all five typechecks)                                   | review's five-error run; green re-run                                                                                                  |
| 3 (P2) cancel       | preparing signal into `runUploadsCommand` + VS Code command + port + ledger; checked before every destructive dispatch                                                 | `acpUploads` cancel trio + agent busy-gate/log proof; `uploadedFilesBinding` per-await test; controller/ledger/port signal tests | removed both delete-path checks → cancel-during-read resolves `handled` instead of rejecting; restored                                 |
| 4 (P2) headless     | `runExec` forwards `runtime.uploads` as serve does                                                                                                                     | `execRun` lane-F run (exit 8 without it)                                                                                         | spread to `undefined` → `expected [] to have a length of 1`; restored                                                                  |
| 5 (P2) release      | `cleanup(state, isCurrent, 'release')` deletes unreferenced at once; sweep keeps the age gate for unseen orphans                                                       | `uploadLedger` release-vs-sweep tests; composition purge expectations updated                                                    | scope to `'sweep'` → `expected [] to have a length of 1`; restored                                                                     |
| 6 (P2) expiry       | setting read per upload (`productionMedia.ts`, `sessionUploads.ts`)                                                                                                    | composition `reads the expiry setting on every upload` ([604800] then [86400])                                                   | frozen callback → second body keeps `604800` instead of `86400`; restored                                                              |
| 7 (P2) key removal  | `createUploadedFilesPort` retains the last ledger; reads stay read-only, deletes refuse via the ledger                                                                 | port retained read-only test; binding real-ledger key-removal test; composition keyed end-to-end (live → retained → refused)     | retention to plain `ledger` → deep-equal fail on the retained read; restored                                                           |
| 8 (P2) stale report | controller drops on account+generation (both paths); message carries `accountId`+`generation` (`protocol.ts`); reducer drops older generations; authState still clears | controller generation + account-change tests; `uiState` drop + clear tests                                                       | generation clause out → `post` called once; account equality out → account-change posts; reducer gate out → stale paints; all restored |
| 9 (P2) ACP listing  | rows show `n. name (id, …)`; delete accepts id or 1-based number                                                                                                       | `deletes by listed number` test                                                                                                  | index resolution out → number delete rejects; restored                                                                                 |
| 10 (P2) 404         | single-file delete goes through `removeEntry` (the one normalising path)                                                                                               | ledger 404-as-gone test                                                                                                          | direct `files.delete` → rejects `Not found`, row stays; restored                                                                       |
| 11 (P2) ACP foreign | `confirmForeign` permission request (`session/request_permission`, same question as the VS Code dialog); deny/failure/cancel keeps                                     | command allow test; agent allow + cannot-answer tests                                                                            | ask removed → both allow tests fail, Kept sent; restored                                                                               |
| 12 (P3) assembly    | real `createRuntimeBackend` property tests (Model API serves the port, Muse Code none, ephemeral keyless); runExec e2e                                                 | fail when `backends.ts` property removed (`expected 'undefined' to be 'function'`)                                               | drilled both; serve line drilled gap (below)                                                                                           |
| 13 (P3) docs        | scope fixed to the account's files (`en.ts` + 14 `ui.*.json` + regen reference + README lifecycle)                                                                     | `check:reference` stale error when source reverts without regen; `check:l10n` 0 problems                                         | reverted phrase → `Stale reference` error; restored                                                                                    |
| 14 (P3) casts       | no `as never`/`as any` remains in lane tests/sources (typed fakes from round 1); nothing to justify, no PLAN §8 row needed                                             | `grep` + unit typecheck exit 0                                                                                                   | none needed (no guard to break)                                                                                                        |

Round-2 suites (all green): `uploadLedger` 16, `uploadedFiles` 6,
`uploadedFilesBinding` 8, `acpUploads` 16, `uploadedFilesComposition` 11,
`conversationController` 692, `uiState` 185, `execRun` 98,
`deferredBundles` + `modelApiProductionMedia` 135. Typechecks host, unit,
webview, e2e, integration all exit 0. `check:l10n` 0 problems (14 UI, 14
usage, 253 manifest, 1544 sources). `check:reference` current.
`check:host-api` 0 problems. Production `npm run build` exit 0:
`modelApi.js` 523,388 (diet 523,629, general 537,600), `extension.js`
566,772 (614,400), `acp.js` 241,528 (870,400), `media.js` 20,992,
`productionMedia.js` 68,885. No guard or cap moves; no new dependency.

**Two implementers in this worktree:** this round ran as two sessions
sharing one checkout (one per half of the findings, roughly). The
designs were reconciled, not duplicated: the core port owns retention
(binding/runtime fallbacks removed as redundant), the controller guard
checks generation and account, the reducer gates on the stamped
generation. All drill breaks were restored byte-exact (SHA-256 checked
per file); `grep` shows no `DRILL` remnant and no scratch file remains.
One drill taught something: the ACP cancel-during-read test still
passes with the post-read check removed, because a second pre-delete
check (post-confirm) guards the same await; both out → the command
resolves `handled` after cancel instead of rejecting. Either check
alone still guards the behavior.

**Lead-owned residuals (true blockers, flagged per brief):**

- NOT RUN HERE (sandbox blocks loopback): five `files.test.ts` wire
  cases and four review-admission suites (`conversationController`
  Host/Plan admission), same as the review. First line of the final
  message names them.
- Serve's last-mile forwarding (`src/runtime/main.ts:795`): removing it
  leaves all 26 uploads/ACP/composition tests green (drilled). Serve
  boots a loopback listener the sandbox blocks; needs a hosted serve
  receipt (lead).
- Extension activation wiring (`src/extension.ts:3591` binding): needs
  the VS Code host; needs the integration run (still required overall).
- HUB files touched: `src/shared/protocol.ts` (optional
  `accountId`/`generation` on `uploadedFilesReport`), `src/shared/l10n/en.ts`,
  generated reference files. `vitest related` over the ten changed
  non-hub sources selected 107 files: 102 passed (3,075 tests),
  4 failed with 46 failures, every one triaged as
  pre-existing/environmental — `chatGptVsCode` (15, loopback `EPERM`),
  `runtimeChatGpt` (29, native OS store/grant lock),
  `subscriptionIntegration` (2, loopback `EPERM` in the log),
  `acpAgent` ChatGPT-actions (1, fails identically on the clean base
  `98eb03aaa`: the adapter reports unavailable without loopback/store).
  `configuredProviders` (loopback `EPERM`) and `files.test.ts` (loopback
  proxy) were excluded up front as NOT RUN HERE. Full integration run
  still required.
