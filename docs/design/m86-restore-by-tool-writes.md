# M86 — Restore by the tools' own writes (PLAN.md D63) — SPEC v3.1

Lead's spec after two review rounds (design: review-_.md; confirmation of v2: confirm-claude.md,
confirm-codex.md). This text is complete: implement it as written. A lane that finds a contradiction or a hole stops
and reports to the lead; it does not redesign alone. Ids in [brackets] cite the finding a rule answers
(CC/CP = Claude correctness/paths, CX = Codex, MU = Muse, V2-_ = Codex confirmation, CM-* = Claude confirmation).

## 1. Why and what changes for the user

M72 inferred which changes were the turn's from whole-workspace captures; seven Codex rounds found races in that
guess. M86 reverses only writes the model's own file tools made, and only along an unbroken chain of bytes ending in
exactly what is on disk now. Shell commands, MCP tools, hooks and the user's own changes are never undone; the restore
says when commands ran. Captures are removed.

## 2. Vocabulary

- **Instance**: one extension-host lifetime of one window (a reload is a new instance). Id: random UUID.
- **Owner**: `{ instance, sessionId, unitId }`, where a unit is a turn (`turnId`) or a restore/Redo **batch**
  (`batchId`). Each unit of a conversation gets a unique **sequence** number from a per-conversation CAS allocator
  (create-only ref per number; on collision allocate the next) — turns at turn start, batches at restore/Redo start.
  [CC-M3, CX-B4, V2-B1, CM-2]
- **Write**: one recorded publication by an owner to one file: `{ id, instance, seq, owner, path, before, after,
createdFolders[] }`, `seq` = per-instance monotonic counter taken at intent time. `before`/`after` =
  `{ present: boolean, oid?: string, mode?: string }`.
- **Path identity**: canonical workspace-relative path, from realpath at write time, computed by the recorder, compared
  exactly (never case-folded). At restore, keys are re-resolved and keys that now name one file are merged. [CP-M5]

## 3. The restore rule

Restore of conversation S from unit U (a turn chosen by the user) onward:

1. **Range** = every unit of S whose sequence ≥ U's (turns AND S's own batches). Units of S with a lower sequence and
   all units of other conversations are **foreign**. [V2-B1, CM-2]
2. **Completeness** [CM-1, V2-M3, C3-M2]: the host passes the transcript's turn ids of S from U onward, including the
   turn ids of every child session those turns started. A child turn inherits its top turn's recording decision, and a
   child turn whose record cannot be created does not run. Refuse the whole range `writesIncomplete` if any listed turn
   has no M86 turn record, if any range unit is not complete (section 6.4), or if any
   journal intent names an owner in the range that has no record.
3. **Per file F**, take the range's writes to F and order them (section 4). The chain must be unbroken:
   `wᵢ.after == wᵢ₊₁.before` (presence + oid). A foreign write to F whose position in the order is known (same
   instance, by seq) and falls between w₁ and wₙ breaks the chain. [CC-B1, CP-B1, CX-B1]
4. If the file already holds `w₁.before` → **unchanged** (no write, not refused). Check this first. [CM-m2]
5. Else if the chain is unbroken and the file holds exactly `wₙ.after` → write `w₁.before` (delete when absent).
6. Else refuse F with the reason (section 8).
7. Mode: bytes and presence decide; mode never refuses. A restore keeps an existing file's current mode; a file it
   recreates gets `w₁.before.mode`. Remove the execute-bit comparison and mode-setting for existing files from the kept
   writer. [MU-4, CM-m9]

## 4. Order of writes [CC-M2, CX-B3, CP-M9, V2-M1, CM-4]

- Within one instance: by `seq`, across all owners (parent and child turns, batches).
- Within one instance, writes to one canonical path are serialized: a per-path lock is held from the pre-copy through
  the intent, the conditional publication and the outcome entry, across all owners, so seq order is publication order.
  [X3-M3]
- Across instances, for one path: merge the per-instance seq-ordered lists of the range's writes, heads only: start
  from the head whose `before` is not any other range write's `after` on this path (if not exactly one such head →
  `orderUnknown`); at each step the next write is the unique head with `before == current after`; none → refuse
  `changedBetween`; more than one → refuse `orderUnknown` (conservative: any two byte-consistent merges share the first
  before and the last after, so this never refuses a case where the answer could differ). [X3-M4]
- Foreign writes across instances are not ordered: bytes decide (a foreign write between ours breaks the chain unless it
  wrote identical bytes — the ABA limit, section 12).

## 5. Recording

### 5.1 Owner-bound io [CP-B2, CC-M1, CP-M2, CM-m11]

Recording happens only through an io bound to an owner, created where the Model API host knows the checkpoint session
id and turn id: per turn and per child turn; the memory tools get the owner per call (the store is one per window, so
the owner is an argument, not a constructor field). The window-wide `withCheckpointCopies` keeps the storage-path
refusal (unconditional, checkpoints on or off) and activity marks; it records nothing. The Memory view uses its own
store over raw io (delete `userWrites`, `beforeDelete`, `afterDelete`); Muse Code's `mcp__ide__*` image tools use the
non-recording io; the extension's writes for the user (Create AGENTS.md, exports, plan saves, Revert, autosave) are
never recorded. Owner lifecycle [V2/CX-M1]: the io is created when the turn's record is created and lives until the
turn's end is sealed; Stop and cancellation end it like an end; a turn queued before the setting went off records if
it started recording; setting off before a turn starts → no recording, and that turn has no record (so a range
containing it is refused, rule 3.2).

### 5.2 Which writes, with one lifecycle each [CP §1, CP-M3, V2-M8, CM-m4, CM-m19]

| Write                                           | Recorded as                                                                                                                                                                                                                                                                     |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `write_file`, `edit_file` (`publishText`)       | one write per publication                                                                                                                                                                                                                                                       |
| format on edit (`writeFileIfUnchanged`)         | one write; a `'changed'` result → `aborted` [CP-m5]                                                                                                                                                                                                                             |
| `rename_symbol` (ToolIo path)                   | one write per file                                                                                                                                                                                                                                                              |
| image `reserveFile`                             | write absent→empty, intent before the `wx` create                                                                                                                                                                                                                               |
| image `fill`                                    | write empty→bytes, intent before writing; the held handle's `fstat` must show size 0 and the path must still name the same inode immediately before writing; any failure (partial fill, close failure) leaves the intent unsettled (rule 6.4), never cleaned up blindly [X3-M2] |
| image `release`                                 | write empty→absent, only if the file is still size 0 and the same inode; otherwise nothing is removed and the intent is `aborted` (the user's bytes stay)                                                                                                                       |
| `add_memory` new note (`createFileExclusively`) | write absent→bytes, intent before create (an io seam, not an after hook)                                                                                                                                                                                                        |
| `add_memory` append, `edit_memory`, index line  | one write each (memory replacements pass `place.checked` as the expected canonical path) [CP §4]                                                                                                                                                                                |

### 5.3 One write [CC-B2, CP-M1, CX-B2, CP-M4, CP-M6, CM-m3]

1. Pre-write copy, per write (no per-turn dedup), through the confined copier reading from the opened handle (never
   git-by-path). [CC-M9a]
2. Intent appended and fsynced (section 6) with `before` = the copy's oid/presence/mode and `after` = the oid of the
   exact bytes about to be published (in-process `gitBlobOid` over the in-memory content). `createdFolders` = every
   folder the publication will create (the `mkdir` result chain).
3. Publish **conditionally** on the copy: the existing conditional writer with a function-form expectation (accepts
   "absent" for a new file; refuses any other change between copy and publish). On refusal the tool reports it and the
   intent is marked `aborted`.
4. `done` appended. `after.mode` from the published temp file's handle before the rename.
   A before that is a regular file larger than CHECKPOINT_FILE_MAX_BYTES: the tool write proceeds; the write is recorded
   with `before.oid` only and its path is `notKept` in any range (never deletes a file that existed). [CM-m8] A destination
   that is not a regular file (a directory, a FIFO, a socket, a device, a link) is refused before mutation with an explicit
   tool error, without opening it. [X3-M6]

## 6. Durability: per-instance journal [CP-B3, CC-M5, CM-5, V2-M5]

### 6.1 Layout (new paths only; nothing under `staging/`, `windows/` or any legacy ref prefix)

`<storage>/m86/<instance>/journal.jsonl` (append + fsync per entry) and `<storage>/m86/<instance>/blobs/<oid>`
(content-addressed before copies and kept after bytes, written + fsynced before the intent). No git process per write.

### 6.2 Entries

`intent {write}`, `done {id}`, `aborted {id}`, `seal {owner, units}` (written when a unit ends and its writes are
folded). A torn final line is ignored as an entry; if it was an intent, the write it would have described is unknown
(rule 6.4).

### 6.3 Folding [X3-M1, C3-M1]

At a unit's end the owner io is drained (no new admissions; in-flight writes awaited). Every intent of the unit is
then folded, by write id (idempotent across CAS retries and recovery), into the unit's record (CAS ref under
`refs/muse-spark/m86/`) with its outcome: `done`, `aborted` (only with proof nothing changed: conditional refusal,
`'changed'`, failure before the rename, a skipped release) or `unsettled` (neither entry, or its entry not durable).
The record's tree references every blob it needs (tree edges keep them reachable). The record carries `status`:
`complete` only when no write is unsettled and no `incomplete` marker (section 9) was journaled; else `incomplete`.
Then `seal` is appended, and only after it the running mark is withdrawn. The folded record is authoritative over the
journal. A seal never settles anything.

### 6.4 Completeness and unsettled writes

A unit with a `complete` record is complete. An `unsettled` write is resolved only at restore time, and only when it is
the path's last write in the range: the file holds its `after` → it happened; holds its `before` → it did not; anything
else → the path is refused `changedAfter`. An unsettled write anywhere else in a range → the range is refused
`writesIncomplete`. A dead instance's unsealed journal is recovered by any window: it folds the journal into the units'
records by CAS (idempotent by write id; a torn final line counts as an unsettled intent when it parses as one; a torn
line that does not parse makes its unit `incomplete`), and it never writes into another instance's journal.

### 6.5 Lifetime

Journal folders are deleted only by retention (section 9), never by gone-window tidy (old or new code).

## 7. Mixed versions and migration [CP-M8, CC-M8, CM-3, V2-M5]

- M86 records, refs and journals live under `refs/muse-spark/m86/` and `<storage>/m86/`; 0.10.0 code neither lists,
  parses nor deletes them, and its GC keeps ref-reachable objects.
- M86 publishes `fenced-window-v2` in presence (not the v1 key), so a running 0.10.0 window sees it as native-unsafe
  and refuses its own restores while an M86 window is live. An M86 window that has seen any v1 window since it opened
  leaves its presence file in place when it closes, so a 0.10.0 window stays fenced until it reloads (0.10.0 never
  removes a v2 file); M86 windows remove such left files once no v1 window is live. [X3-M5, C3-M3] M86 reads v1 presence as a legacy live window: while one is
  live, M86 refuses its own restores (`legacyWindowOpen`, with text asking to reload the other window) and deletes no
  records of any kind.
- M72 checkpoint records: listed as legacy (no file restore, `checkpointsLegacyReadOnly`); a range containing any
  legacy turn is refused whole; M72 restore records are not redoable (the panel says so). `sequence` allocation counts
  M72 and M86 units.

## 8. Restore, Redo, outcome, text

- Admission unchanged: no restore while any turn runs anywhere; Model API session attached; native fence; trust;
  Restricted Mode; CAS `RESTORE_REF` reservation and takeover.
- A restore is a batch: its writes are recorded through the same journal with owner `{instance, S, batchId}` and the
  batch's own sequence number.
- **Redo** of batch B [V2-M2]: the units in range are B and every unit of S numbered after B; the chain rule applies to
  B's writes reversed, and any later unit's write to the same path breaks it. Paths already at B's targets are
  unchanged. Redo is itself a batch. A Redo request carries `sourceSessionId` and must match the attached session and
  B's owner. [CC-M9b] Redo is "spent" when every path of B is unchanged or done; a Redo with paths left refusable stays
  offered. Test A's "Redo again" → all unchanged, reported as nothing to do.
- Refusal reasons (UI_TEXT + all 14 tables): `changedAfter`, `changedBetween`, `orderUnknown`, `unsaved`, `linked`,
  `notKept`, `writesIncomplete` (whole range), `tooLarge`, `failed`; `unchanged` counted separately.
- **Commands note** [MU-2, V2-M6, CM-m10]: each unit record carries `ranProcesses: boolean`, set by invocation, not by
  activity marks: true when any unit of S in the range invoked the shell tool, `then_run`, checks, hooks, or an MCP
  tool, or had a background task alive at any time during the range. The outcome then says: "Commands, hooks or MCP
  tools ran in these turns; files they changed are not undone — check your version control." This note never blocks
  "Rewind conversation and restore files"; refusals do.
- Memory scope [V2-M6]: personal memory (outside the workspace) is never restored; README says so.
- M72 round-7 items fixed here: confined copy from the handle [CC-M9a]; Redo bound to its conversation [CC-M9b];
  `withCheckpointEdit`'s `finally` logs a failed release instead of failing a completed edit [CC-M9c]; memory
  replacement link-follow [CP §4]; Windows delete retries EBUSY/EPERM [CP-m8]; >16 MiB → `tooLarge` [CP-m3].

## 9. Caps, retention, folders [MU-3, V2-M4, V2-M7, V2-N1]

- Per unit: CHECKPOINT_UNIT_INTENTS_MAX intents and CHECKPOINT_UNIT_BLOB_BYTES_MAX kept blob bytes (named constants,
  not raised later). Past the blob budget, writes are recorded with oids only (`notKept` for their paths in any range:
  any `notKept` write poisons the whole merged path). Past the intent budget, an `incomplete {owner}` entry is
  appended and fsynced before the first unrecorded write, the fold carries it into the record, and any range containing
  the unit is refused whole; the tool write still proceeds. [C3-m1] Disk full while journaling → the tool
  write is refused before mutation, honestly reported.
- Retention: per conversation, by sequence (never clock), deletes whole oldest units with their journal entries and
  blobs. A restore from U needs only S's units from U on, which are newer than anything retention deletes first. A
  deleted foreign record only removes an ordering hint; bytes still decide.
- Folders: `createdFolders` lists every folder a write created; a restore that deletes the file removes those folders
  bottom-up when empty.

## 10. What goes away (delete; no dead code; knip must show it gone)

Captures (start/end snapshots, `captureNow`, index sync, `git status`, coverage, `scanIgnored`, linked-folder and
nested-repo coverage, exclude refresh, shadow index files, the file-count and size limits on captures),
`changedOutside` and all attribution, `userSaves`/`noteUserSave`/`recentSaves`/peer saves files (M86 refuses its own
restores while any v1 window is live, section 7, so it never reads or writes them), `startedWallAt`,
`asUserEdit`/`noteUserWrite`/`userWrites`/`beforeDelete`/`afterDelete`, `withToolCopies`/`endsAsCopied`,
`restorePlan`'s tree steps (move `Expectation`/`FileStep` types next to the writer; drop the `stat` kind),
`isIgnoredIncomplete`, `unsure`, the per-turn journal dedup in `beforeToolWrite`.
Keep: presence and native fences, `RESTORE_REF`, storage separation guards (canonical), `isStoragePath`, the conditional
writer and link/case/junction checks, `copyInsideWorkspace`, `withCheckpointEdit(At)`, archives (re-keyed to units),
the shadow repo as object and CAS ref store.

## 11. Settings and docs

`museSpark.turnCheckpoints` default `true`; the 15 nls descriptions drop "Preview" and describe M86. README "Turn
checkpoints" rewritten: what a restore undoes (the model's own file-tool edits, while the file holds exactly what the
model left), what it never undoes (commands, hooks, MCP tools, your edits, other windows' writes, personal memory), the
formatter-hook note (a PostToolUse/then_run formatter makes files not restorable; format on edit is restorable), the
ABA and compare-to-rename limits; `restoreConfirmDetail`/`restoreBothConfirmDetail` rewritten; PRIVACY (no captures;
only tool-written files' bytes stored); CHANGELOG [Unreleased]; PLAN: D63 amended (captures removed; commands noted),
D51 amended, M86 status; `docs/certification/m86.md`.

## 12. Limits (stated in README and certification) [CX-M9]

- ABA: if someone else writes exactly the bytes the model left, the restore cannot tell.
- The final compare-to-rename window of the filesystem writer (documented in `fsAtomic.ts`).
- Foreign writes in other windows are judged by bytes, not order.

## 13. Test matrix (real git and fs; R = refused with reason; OK = restored; U = unchanged)

A. Tool writes a (new), b (changed) → OK (a deleted, b back) → Redo → OK → Redo again → U (nothing to do).
B. User saves b after the tool → R changedAfter; same from a peer window, an idle peer, and in the gap between publish
and done (deterministic pause).
C. Chain breaks → R changedBetween: user save between two turns' writes; another conversation's write between two of
ours (same window); a command between two tool writes of one turn; Memory view edit between two memory-tool writes;
a formatter hook after the tool → R, while format-on-edit's write → OK. [CP-M10b]
D. Parent/child in one window: child A→B, parent B→D, child D→E → restore parent's turn → A. Child-first then parent →
correct w₁.
E. Same conversation in two windows: unique sequence via CAS (collision test); per-path merge: one valid merge → OK;
two matching heads at any step → R orderUnknown (even when a unique complete merge exists); none → R changedBetween.
Same instance: overlapping publications to one path serialize (deterministic test).
F. Crash cases: intent fsynced, process killed before rename → file holds before → not done; after the rename → done;
rename landed, `done` lost, a later unit reverted the file → R writesIncomplete (not a wrong restore); failed `done`
or `seal` fsync; crash between fold and seal → recovery idempotent; capped unit finalized `incomplete`; torn last
line; recovery by a new instance; reload then restore → OK.
G. Copy-then-publish race → the tool write refused, intent aborted, nothing restorable.
H. Format on edit `'changed'` → aborted.
I. Image: reserve, crash before fill → restore deletes the empty file (absent→empty recorded); reserve+fill → restore
deletes; release → nothing left; the user writes into the reserved inode during generation → fill refused, release
leaves the user's bytes; partial fill / close failure → unsettled → R.
J. Memory: new note restored (deleted); refused once the user edited it; Memory view writes never recorded; personal
memory never restored.
K. Owner binding: two conversations in one window writing their own files at once → each restore touches only its own.
L. Mode: chmod after the write → bytes restored, user's mode kept; recreated file gets before's mode.
M. Already restored (Edit Review Revert) → U; Restore and rewind proceeds.
N. Caps: blob budget → those paths R notKept, others OK; intent budget → R writesIncomplete; disk full → tool write
refused before mutation.
O. Links/junctions swapped into the path → R linked; swapped parent junction during the pre-write copy → refused, no
outside bytes stored (drill); case-sensitive (Kubuntu) vs folding (Windows, macOS) identity.
P. Legacy: M72 records → no file restore; mixed range → R whole; a live 0.10.0 window (v1 presence) → M86 refuses its
own restores and deletes nothing; an M86 window makes a 0.10.0 window's restore refuse (fenced-window-v2); an M86
window that saw a v1 window closes → its presence stays, the 0.10.0 window stays fenced; cleaned up when no v1 is
live.
Q. Completeness: a turn run with the setting off inside the range → R writesIncomplete; a turn whose record failed → R;
a child turn without a record (setting off mid-turn) → R; a child turn whose record fails does not run.
O2. Non-regular destinations (directory, FIFO, link) → the tool write refused before mutation, nothing opened.
R. Commands note: shell, hook, MCP tool, background task alive in range → note shown; rewind not blocked.
S. Muse Code session → no file restore, honest text.
T. Archive/unarchive; retention by sequence keeps every unit from U on.
U. Redo bound to its conversation; Redo after a later unit wrote the path → R changedBetween.
V. withCheckpointEdit: failed release after a completed edit → success reported.
W. Memory replacement through a link swapped after locate → refused.
X. Restore further back after a restore → the batch is in range → OK.
Y. Windows EBUSY on delete retried.
Every M72 test that still applies is ported; the moot ones are deleted with a line each in the certification.

## 14. Gates

Typecheck, eslint, prettier, check:l10n, check:host-api, deadcode, cycles, jscpd, build with caps (the checkpoint
bundle must shrink), the checkpoint suites on Kubuntu, the Mac mini and the Windows VM, and a red drill for each guard:
chain check, last-after check, unchanged-first, owner binding, intent-before-publish, conditional publish, completeness
(3.2), per-path merge, sequence CAS, caps, legacy refusal, fenced-window-v2, Redo binding, recovery folding.
