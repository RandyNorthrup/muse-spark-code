# M86 build contract (lead) — read with SPEC.md (v3.1)

Branch: `feature/m86-restore` (from main bdfb651e = v0.10.0 + the shared types commit). Each lane works in its own
worktree on its own branch from that commit and commits locally; the lead merges lanes in order L2 → L1 → L3 → L4.
Shared types: `src/core/checkpoints/toolWrites.ts` (lead-owned; ask the lead to change it). Shared design: `SPEC.md`.

## File ownership (only touch your own files; anything else → tell the lead)

- **L1 recorder** (Claude): NEW `src/host/checkpoints/writeJournal.ts`, NEW `src/host/checkpoints/writeRecorder.ts`;
  edits `src/host/checkpoints/checkpointHost.ts` (`withCheckpointCopies` reduced to the storage refusal + activity
  marks; delete `asUserEdit`), `src/host/backend/checkpointedMemory.ts` (view on raw io; delete `userWrites`,
  `beforeDelete`, `afterDelete`), the memory io/store owner-per-call seam (`src/core/memory/*` as needed), the image
  reservation seam (`src/core/backends/modelapi/imageGeneration.ts`, `src/host/backend/toolIo.ts` fill/release
  conditions), the per-turn owner io creation in `src/core/backends/modelapi/ModelApiHost.ts` (where the checkpoint
  session id and turn id are known; child turns too), `src/extension.ts` wiring for these. Tests for spec rows G, H, I,
  J, K, O2, V, W and the recorder parts of B, F, N, O.
- **L2 engine** (Claude): NEW `src/core/checkpoints/restoreChain.ts` exporting
  `decideRange(input: RangeInput): RangeDecision` (pure, no I/O). Tests: NEW `test/unit/restoreChain.test.ts` covering
  every decision rule of spec sections 3, 4, 6.4, 8 (Redo mode), 9 (notKept poisoning) and rows A (logic), C, D, E
  (merge), F (unsettled resolution), L, M, N, P (range), U, X as pure cases.
- **L3 store** (Claude): REWRITE `src/host/checkpoints/checkpointStore.ts` (units, sequence CAS allocator under
  `refs/muse-spark/m86/`, unit records fold/seal/recovery reading `WriteJournal`, restore/Redo execution through the
  kept writer `checkpointFiles.ts` with `decideRange`, retention by sequence, archives re-keyed, legacy M72 read-only,
  completeness input), `src/host/checkpoints/windowPresence.ts` (fenced-window-v2, leave-on-close, legacy v1 detection,
  delete the saves part), `src/host/checkpoints/checkpointRecords.ts`/`recordRefs.ts` (new schema/root),
  `src/host/checkpoints/checkpointFiles.ts` (drop mode comparison/setting for existing files; folder removal; EBUSY
  retry on delete; `tooLarge`), DELETE `ignoredScan.ts` and capture code, `src/core/checkpoints/restorePlan.ts` (keep
  only the types the writer needs, or move them), `src/host/conversation/conversationCheckpoints.ts` and the restore /
  Redo paths of `conversationController.ts` (transcript turn ids incl. child sessions; Redo carries `sourceSessionId`;
  outcome rendering with the keys below; commands note), `src/host/planFeatures.ts` (delete `noteUserWrite`),
  `withCheckpointEdit`'s finally (log a failed release). Tests: the integration rows A, B, E (CAS), F, M, P, Q, R, S, T,
  X, Y and the port of still-valid M72 tests; delete moot ones.
- **L4 text and docs** (Codex): `src/shared/l10n/en.ts` + all 14 `l10n/ui.*.json` (keys below, real translations;
  `npm run check:l10n` 0 problems), `package.json` default `turnCheckpoints: true` + 15 `package.nls*.json` descriptions
  (drop "Preview", describe M86), README "Turn checkpoints" section and setting row, `docs/PRIVACY.md`, CHANGELOG
  `[Unreleased]`, PLAN (D63 amended: captures removed, commands noted; D51 amended; M86 status), and
  `docs/certification/m86.md` skeleton (sections the lanes fill). No code outside `en.ts`.

## UI text keys (L4 creates; L3 uses; English below, translations by L4)

Keep: `restoreRefusedUnsaved`, `restoreRefusedFailed`, `restoreRefusedChanged` (changedAfter), `restoreDone`,
`restoreNothing`, `redoDone`, `redoGone`, `checkpointsLegacyReadOnly`, `checkpointsOff`, `checkpointsRestricted`,
`checkpointsNoGit`, `restoreTurnRunning`, `restoreTurnElsewhere`.
New:

- `restoreRefusedBetween`: 'Left as they are, changed by something else between the model's edits: {files}'
- `restoreRefusedOrderUnknown`: 'Left as they are, edited from more than one window in an order that cannot be told: {files}'
- `restoreRefusedLinked`: 'Left as they are, reached through a link or junction: {files}'
- `restoreRefusedNotKept`: 'Not restorable, the earlier version was not kept: {files}'
- `restoreRefusedTooLarge`: 'Not restorable, too large to keep a copy of: {files}'
- `restoreUnchanged`: forms({ one: 'Already as before: {count} file.', other: 'Already as before: {count} files.' })
- `restoreWritesIncomplete`: 'Nothing was restored: some of these turns' edits were not fully recorded (a reload or crash mid-edit, or file checkpoints were off).'
- `restoreLegacyInRange`: 'Nothing was restored: some of these turns were recorded by an earlier version, which this one cannot restore.'
- `restoreLegacyWindowOpen`: 'Another window runs an older version of Muse Spark; reload it, then try again.'
- `restoreCommandsNote`: 'Commands, hooks or MCP tools ran in these turns; files they changed are not undone. Check your version control.'
  Rewrite: `restoreConfirmDetail`, `restoreBothConfirmDetail`, `checkpointsModelApiOnly` to the M86 promise.
  Delete: `restoreRefusedNotCovered`, `restoreRefusedNoCopy`, `restoreUnsure`, `restoreIgnoredIncomplete`.

## Interfaces between lanes

- L1 `WriteJournal` (writeJournal.ts):
  `new WriteJournal({ storageDir, instance, fs })`;
  `writeBlob(bytes): Promise<string /*oid*/>` (content-addressed, fsynced, under `<storage>/m86/<instance>/blobs/`);
  `appendIntent(write: WriteRecord)`, `appendDone(id)`, `appendAborted(id)`, `appendIncomplete(owner)`,
  `appendSeal(owner)` (each fsynced before resolving);
  `static readAll(storageDir): Promise<ReadonlyMap<string /*instance*/, { entries: JournalEntry[], tornTail: 'none' | 'unparsed' | 'intent' }>>`;
  `static blobPath(storageDir, instance, oid): string`.
- L1 `createOwnerIo(io: ToolIo, deps): OwnerIo` (writeRecorder.ts) where `OwnerIo = ToolIo & { drain(): Promise<void> }`;
  deps include `{ journal, owner, workspaceRoot, canonicalPath, now }`; per-canonical-path lock inside; memory tools get
  `recordMemoryWrite`-style owner-per-call entry points (L1 decides the shape, documents it in its report).
- L3 consumes the journal (fold/recovery) and calls `decideRange`; L3 exposes to the host
  `startUnit(owner): Promise<{ sequence }>` / `endUnit(owner, { ranProcesses }): Promise<void>` used where turns start and
  end today (`prepareCheckpointTurn` / `endTurn` paths), and the restore/Redo request shapes the controller uses.
- Integration points L1↔L3 (where a turn starts: create the unit record, then the owner io) are wired by L3 in
  `checkpointHost.ts`'s turn preparation after L1 lands; L1 provides the factory and leaves a clearly marked call site.

## Rules for every lane

Follow scratchpad/r3/common.md (rigs via rig-test.sh with your lane slot; never git stash; never npm install; explicit
git add; no --no-verify; jscpd 0 clones; check:host-api; prettier; eslint; typecheck incl. test/unit tsconfig). Red
drill every guard you add. Report: commits, spec rows covered with test names, drills (machine, hashes), anything in
SPEC/CONTRACT you found wrong (stop and report rather than redesign).
