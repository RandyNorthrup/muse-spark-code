# M107 W-history — resource history in production

2026-10-08, host Windows 11 workstation plus the Kubuntu rig (slot 2), on
`m107/w-history` from `origin/release/0.16.0` (`c2e0932aa`), for the combined
0.17 release. PR #140's review found `LazyResourcesSection` never mounted and
no durable journal behind any history surface. This lane closes PLAN §8's
`M107-J-M102-history-binding` for the parts named below. No model calls
(**0 attempts**), no credential, dependency, push, rebase or merge.

## What now shows real data

| Surface                                           | Source                                                                                                    |
| ------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| VS Code usage page, **Resources** section         | `createUsageAccess` reads the journal; `UsagePageState.resources`; UsageApp mounts `LazyResourcesSection` |
| Companion page and native hosts' embedded page    | The same usage service and page bundle (`usageCompanion.js`, MHP stdio)                                   |
| `resources history`, `usage resources` (`--json`) | `createResources` reads the journal by default; text is the page's aggregate (`resourceHistoryText`)      |
| ACP `/usage resources`, `/resources history`      | The agent's runtime host, the same aggregate and text                                                     |

Recording: the VS Code window's governor (`resourceGovernorEntry`: the
existing `governor.onSample` and `events.subscribe` streams, and the launch
host's new `treeUsage()` over its cached tree readings) and the ACP agent
(`createResources(..., { isRecordingHistory })`, a narrow `onSample` option on
the runtime host). One-shot CLI commands and headless `exec` only read; the
exec run ledger stays headless's history surface.

## Journal design

- **Location.** `usage/v1/resources/<UTC day>/<collector>.<generation>.jsonl`
  under the machine's private agent data folder (`agentDataFolder`, the same
  machine scope as `resources.json` and the usage journal), through
  `NodeUsageFs` (no linked ancestors, private modes). The usage page's
  **Delete history** removes it with the usage journal.
- **Format.** One strict line per record, `{"v":1,"record":ResourceRecord}`;
  the record is J's schema with history date guards. No process identity,
  command, path, process name or environment can be written or read.
- **Durability.** Append-only with `O_APPEND`, flushed (`fsync`) before the
  append resolves. A failed write moves the collector to a fresh generation
  file, so a partial line is never extended. A torn final line (crash) is
  ignored; any other unreadable, oversized, wrong-day or schema-invalid line
  refuses the read with a fixed code. Newer-version lines are skipped.
- **Bounds.** 4 MiB per file (excess dropped, reported once, never retried
  forever), 32 MiB per read, records under 4 KiB, seven recorded days (records
  outside the window are never stored or shown), expired day folders removed
  once per UTC day by writers and readers with a two-day margin.
- **Concurrency.** One file per collector, so windows and agents never share a
  file. Reads merge collectors; `aggregateResources(records, sources)` replaces
  a cumulative minute snapshot only within its own collector.
- **Consent.** Recording needs the host's usage-history choice (VS Code
  `museSpark.usageHistory`, the agent's usage-history flag) and the shared
  usage-history file; an unreadable choice is not consent. Reads always work.
- **Never blocks.** Admission never awaits recording; one sample at a time is
  in flight, later samples are skipped while a write is slow.

## Editor parity

Every editor's usage page uses the same `createUsageAccess` service, so the
section appears in VS Code, the companion page and the native hosts' embedded
page. ACP clients and any terminal read the same journal through the runtime
host. The CLI and ACP text and the page share `resourceHistoryText` and the
validated `ResourceHistory` aggregate.

## Tests

Kubuntu rig, repository default timeouts, `rig-test.sh kubuntu … 2`.
New: `resourceJournal` 8, `resourceHistoryWiring` 4, `UsageAppResources` 3,
launch host `treeUsage` 1. Updated: `acpResources`, `runtimeResources`,
`ResourcesSection` and `execResources` (the built CLI now prints the journal).

| Run | Files                                                                                                                  | Result                                              |
| --- | ---------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| 1   | resource/usage owners (12 files)                                                                                       | 152 passed                                          |
| 2   | run 1 + `cliUsage`, `execResources`                                                                                    | 168 passed, 1 failed (old CLI expectation, updated) |
| 3   | `execResources`, CLI usage, deferred bundles, delivery, disk, relocation, usage panel/rollup/text/integration, journal | 225 passed, 10 skipped (Windows-only launch file)   |

## Red drills

Byte-exact mutation, owning test, byte-identical restore (hash checked):

| Drill | Guard                                                                    | Owning test (failed while mutated)                                   |
| ----- | ------------------------------------------------------------------------ | -------------------------------------------------------------------- |
| D1    | Unparseable line refuses (`throw` → `continue`)                          | `resourceJournal`: torn final line vs unreadable line                |
| D2    | Collector-scoped snapshot key (`[source, atMs]` → `['', atMs]`)          | `resourceJournal`: concurrent collectors                             |
| D3    | Per-file byte bound (cap → `Number.MAX_SAFE_INTEGER`)                    | `resourceJournal`: bounds                                            |
| D4    | Whole-read byte bound                                                    | `resourceJournal`: bounds                                            |
| D5    | Fresh generation after a failed write (`generation += 1` removed)        | `resourceJournal`: failed write                                      |
| D6    | Consent (`isEnabled` check removed)                                      | `resourceJournal`: consent                                           |
| D7    | Seven-day record filter on read (removed)                                | `resourceJournal`: retention (Kubuntu, after adding the edge record) |
| D8    | Unavailable is `null`, never an empty aggregate                          | `resourceHistoryWiring`: unreadable journal                          |
| D9    | Strict `resources` state field (`resourceHistorySchema` → `z.unknown()`) | `resourceHistoryWiring`: strict field (Kubuntu, 295 ms)              |
| D10   | Retired tree's final reading (push removed)                              | `resourceLaunchHost`: J history work source                          |
| D11   | Agent records its governor samples (`recorder.sample` removed)           | `resourceHistoryWiring`: records and serves                          |
| D12   | UsageApp mounts the lazy section (mount → `null`)                        | `UsageAppResources` (Kubuntu)                                        |

D1–D6, D8, D10 and D11 ran on the host; D7, D9 and D12 on Kubuntu slot 2.
D7 first passed while mutated: the day-folder filter hid the record filter.
The test gained a record inside a still-read folder but past seven days, and
then failed while mutated. D9's host run hit the default deadline, so it was
repeated on Kubuntu, where it failed on the assertion. Every restore was
hash-checked byte-identical.

## Gates

Host, on the final source: `npm run typecheck` (all five projects) **0**;
ESLint `--max-warnings=0` on every changed source/test/script **0**;
Prettier `--check` on every changed file **0**; plain `knip` **0**;
`duplication` (jscpd) **0**; `cycles` **0**; `check:l10n` **0** (0 problems);
`check:reference` **0** (current); `npm run build` **0** (size, split,
host-globals and notices). `check:host-api` first exited **1** for the two new
importers (`node:crypto` 92 → 93 from `runtime/resources/history.ts`,
`node:path` 139 → 140 from `runtime/usage/usageSettingsFile.ts`); the record
was regenerated with `--write`, reviewed, and the recheck exited **0**.

| Artifact / closure                | Before KiB | After KiB | Cap KiB |
| --------------------------------- | ---------: | --------: | ------: |
| `dist/resourceGovernor.js`        |       93.2 |     110.5 |     125 |
| `dist/usageService.js`            |       84.4 |      88.8 |     100 |
| `dist/usagePanel.js`              |       67.3 |      71.8 |      75 |
| `dist/usageCompanion.js`          |       38.8 |      43.3 |      50 |
| `dist/webview/usage.js` + static  |      342.7 |     376.8 |     500 |
| `dist/webview/usage.css`          |        7.4 |       9.1 |      25 |
| Usage body (lazy)                 |       35.8 |      36.2 |      50 |
| Resource history closure          |       44.5 |      44.4 |      50 |
| `dist/webview/resourceHistory.js` |        8.5 |       7.2 |      25 |
| Surface English (deferred table)  |       24.8 |      24.8 |      25 |
| Webview startup + static chunks   |      732.4 |     732.6 |     900 |
| `dist/extension.js`               |      509.4 |     509.7 |     600 |

The history section stays lazy: UsageApp's `LazyResourcesSection` loads the
shared `ResourcesSection` chunk on first mount, and its CSS joins `usage.css`.
The page's strict state schema puts J's history parser in the usage page
bundle, not in chat startup. The first build exceeded the 25 KiB surface
English table by 0.1 KiB: the usage page now reaches the history root, whose
English is installed by its own `browser-resource-english` import. The
key-collection walk now stops at the independent resource roots
(`scripts/lib/uiTextRegions.mjs`), so those keys are not duplicated; no cap
changed; the table is back at the release base's 24.8 KiB.

## FIXM107W2: RVM107W2 repair and the open items

2026-10-08, on `m107/w-history` after `352e040dd`. Every regression below
failed on `352e040dd` (Kubuntu slot 2, the new file copied into a detached
`352e040dd` worktree: **8 of 8 failed**, each on its own assertion) and passes
on the repaired tree. Default timeouts throughout.

| Finding                                                          | Repair                                                                                                                                                                                                                                                      | Regression (`test/unit/…`)                                                                                                    |
| ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| P1 retention/Delete history removal could act outside the folder | `src/runtime/usage/nodeUsageFs.ts` `remove()`: rename to a fresh `.removing-*` name in the same parent, prove dev/ino of entry and parent with no linked ancestor, remove, re-prove the parent; a detected swap refuses (exact residuals: FIXM107W2G below) | `resourceHistoryReview`: swap right before `rm` (retention and the primitive itself), swap right before the quarantine rename |
| P2 off-period readings written after consent                     | `src/runtime/resources/history.ts` `isAdmitted()`: consent checked at collection; the collector is dropped while off                                                                                                                                        | `resourceHistoryReview`: off, sample, on, flush → no minute                                                                   |
| P2 Delete history resurrected pre-delete minutes                 | `src/runtime/usage/resourceResetFile.ts` reset boundary written before the delete (`usageServiceEntry.ts` `deleteHistory`); collectors drop held data on a new boundary; `ResourceJournal.append`/`writeLive` refuse records at or before it                | `resourceHistoryReview`: sample, delete via `createUsageAccess.connect`, flush → no minute                                    |
| P2 retried events duplicated                                     | `src/core/usage/resourceJournal.ts`: each line carries a collector-scoped `id`, reused on retry; reads keep one copy per (collector, id)                                                                                                                    | `resourceHistoryReview`: complete line then `EIO`, retry → one event, count 1                                                 |
| P2 window shutdown lost the open minute                          | `resourceGovernorEntry.ts` `flushResourceHistory()` joined to `admission.ts` disposal, bounded by `RESOURCE_HISTORY_FLUSH_TIMEOUT_MS` (2 s)                                                                                                                 | `resourceHistoryReview`: real window host via `configureResources`/`admitResource`, dispose → minute line in the journal      |
| P2 stale stat sizes charged to the 32 MiB cap                    | `ResourceJournal.readFile`/`readLive`/`readRollups`: budget checked before each read, read only the measured size, charge bytes actually read                                                                                                               | `resourceHistoryReview`: nine files 3.5 MiB at stat, 4 MiB at read → refused, ≤ 32 MiB read                                   |

| Open item             | Closure                                                                                                                                                                                                                                                                                                                            | Test                                                                                                |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Delete history count  | `src/shared/usageDeleteText.ts` + `deleteConfirmResources` (usage table, all 14 languages); service, VS Code dialog and companion pass the resource count from `ResourceJournal.count()` (lines, live files, daily rows; never parsed)                                                                                             | `usageService` (count and refusal), `resourceHistoryWiring` (end to end), `resourceJournal` (count) |
| Current minute        | every collector writes `live/<collector>.json` (atomic, ≤ every 15 s); reads include it unless the journal holds that segment; page and text label the minute containing `now` as "This minute so far" (`resourceHistoryCurrentMinute`, 14 languages)                                                                              | `resourceJournal`, `resourceHistoryWiring`, `UsageAppResources`                                     |
| Rollup                | PLAN D87.11 puts resource records "under D82's retention and rollups", so it is built: completed UTC days → `rollups/<YYYY-MM>.json` under the journal lock, kept for the usage-history days, re-rolled when a raw day changes, raw days removed only once rolled up, unreadable days kept raw; page "Earlier days" table and text | `resourceJournal` (two), `resourceHistoryWiring`, `UsageAppResources`                               |
| ACP harness-work rows | PLAN D87.2 requires them, through the H–C1 runtime spawn binding (one governor per process); the agent's spawns do not pass a registered launch host yet, so it records none, never an estimate. Recorded as an editor-parity note in `docs/ide-compatibility/resources.md`; **not closed by this lane**                           | —                                                                                                   |
| Browser scenes        | `test/harness/usage-resource-scenes.mjs` over the production `dist/webview/usage.js`: four themes × 320/690 px × history, unavailable, empty: **24 scenes, 0 axe violations, 0 page errors, no overflow**; all 24 element shots inspected and committed under `m107-w-history/` (1.19 MB total) with `scene-results.json`          | the harness                                                                                         |

Red drills (byte-exact, Kubuntu slot 2, owning test, hash-checked restore):
R1a post-removal parent proof (first passed while mutated: retention also
refused later at `list`; the direct primitive test was added and then
failed), R1b quarantine identity proof, R2 consent at collection, R3 reset
boundary write, R4 retried-event dedupe, R5 disposal flush, R6 bytes actually
read, O1 delete count, O2a live publish, O2b text label, O2c page label, O3
daily rows: **12 of 12 failed while mutated**, all restored identical.

Kubuntu runs on the repaired tree: 20 owning files, **361 passed, 1 failed**
(an older bounds test whose fake returned zero bytes; it now reads real bytes)
before the final fixes; the final run is recorded below.

Final Kubuntu run on the repaired tree (`4edd06c86` + `d17abcddf`):
**24 files, 387 passed, 0 failed**; after the duplication refactor the four
owning files ran again: **32 passed**.

FIXM107W2 gates, host: `npm run typecheck` (five projects) **0**; ESLint
`--max-warnings=0` on every changed source/test/script **0**; `build` **0**
(size, split, host-globals, notices); `cycles` **0**; `check:l10n` **0**
(14 UI and 14 usage tables, 0 problems); `check:reference` **0**. First-pass
failures, then fixed and rerun to **0**: Prettier `--check` (the runner had
passed the 24 PNG shots, which have no parser; text files only: 0); knip (the
new scene script, now a harness entry in `knip.jsonc`: 0); jscpd (three
clones: the journal's two JSON readers now share `readJson`, the review tests
share `swapScene`/`windowRecorder`: 0); `check:host-api` (four new importers,
all `src/runtime/usage/resourceResetFile.ts`: `node:fs` 46 → 47,
`node:fs/promises` 81 → 82, `node:path` 140 → 141, `node:timers/promises`
18 → 19; regenerated with `--write`, reviewed, recheck 0).

| Artifact / closure               | 352e040dd KiB | FIXM107W2 KiB | Cap KiB |
| -------------------------------- | ------------: | ------------: | ------: |
| `dist/resourceGovernor.js`       |         110.5 |         119.3 |     125 |
| `dist/resourceAdmission.js`      |           1.9 |           2.0 |      25 |
| `dist/usageService.js`           |          88.8 |          97.0 |     100 |
| `dist/usagePanel.js`             |          71.8 |          72.4 |      75 |
| `dist/usageCompanion.js`         |          43.3 |          43.8 |      50 |
| `dist/webview/usage.js` + static |         376.8 |         377.5 |     500 |
| Usage body (lazy)                |          36.2 |          36.2 |      50 |
| Resource history closure         |          44.4 |          46.6 |      50 |
| Surface English (deferred table) |          24.8 |          24.8 |      25 |
| Webview startup + static chunks  |         732.6 |         732.7 |     900 |
| `dist/extension.js`              |         509.7 |         509.7 |     600 |

`usageService.js` (97.0/100) and `resourceGovernor.js` (119.3/125) are now the
tightest caps on this path; no cap changed. Sizes are from the production build of
`4edd06c86`. RVM107W2G P3: that is not the final head; the FIXM107W2G table below is
from production builds of `85683ac94` and of the final head.

## FIXM107W2G: RVM107W2G round 3, visual review F1 and the theme class

2026-10-08, on `m107/w-history` after `85683ac94`. Commits: `352bb49c9`
(the three P2 fixes and their regressions), `5da90b170` (F1 layout, harness
theme class, re-rendered scenes) and the records commit that carries this
section. No model calls (**0 attempts**), no credential, dependency, push,
rebase or merge.

The 15 regressions are the `RVM107W2G` describes in
`test/unit/resourceHistoryReview.test.ts` (beside RVM107W2's) and
`test/unit/resourceHistoryDisposal.test.ts` (the 2 s flush case, in its own
file because the window host is configured and disposed once per process, as
in production), over shared fixtures in `test/unit/helpers/resources/`
(`journalFixtures.ts`, `fsSpies.ts`). Copied with those fixtures into a
detached `85683ac94` worktree and run on Kubuntu slot 2: **13 of 15
failed**, each on its own assertion, while RVM107W2's 8 passed there as they
should. The two that pass there do so by design: the Windows link rule (a
rule, not a bug) and "writes nothing stamped before a completed Delete
history", which round 2 already refused outside the lock; it owns the
inside-the-lock check (G7).

| Finding                                                   | Root fix (at `818037ad0`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Regression (`resourceHistoryReview`, RVM107W2G; `resourceHistoryDisposal`)                                                                                                                                                                                     |
| --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P2-1 a failed quarantine delete was reported as removed   | `src/runtime/usage/nodeUsageFs.ts:329` `remove()` first sweeps every quarantine of the same name (any age) in the validated parent; `:50` `erase()` deletes and proves the name absent (`usageRemoveIncomplete` otherwise); `:155` `purge()`; `:203`/`:213` listings hide quarantines and sweep stale ones (60 s) best effort; `:226` `sweep()` is strict. `src/core/usage/resourceJournal.ts:622` retention sweeps strictly before anything else; `:600` `retainReported()` reports through `onRetentionError` first and then hourly, and retries on the next append or read; `src/runtime/usage/usageServiceEntry.ts:123` logs it | fails then succeeds only once target and quarantine are gone; Delete history replies `writeFailed`, then `completed` with nothing left; refuses a removal whose delete returns but leaves the entry; reports a retention failure (twice) and sweeps the orphan |
| P2-2 an append could land after Delete history's boundary | `resourceJournal.ts:49` one cross-process write lock (`resources/write.lock`, 200 × 50 ms, stale 30 s); `:294` `exclusive()` proves the lock held (`:305`) right before the action; the boundary is checked inside it for appends (`:552`) and live writes (`:581`); `:592` `deleteWith()`; `src/runtime/resources/history.ts:59` Delete history writes the boundary and removes the folder inside `deleteWith`; reads drop anything at or before the boundary (journal `:667`, live `:524`, rollups `:387`)                                                                                                                        | the reviewer's probe (delete during the append's retention pass); a live write in flight (delete waits, then removes it); the disposed-window append past the 2 s wait; writes after a completed delete; lock no longer held; read and rollup filters          |
| P2-3 a swapped intermediate link redirected the rename    | `nodeUsageFs.ts:121` `inParent()`: Linux runs every step through the parent's no-follow descriptor; `:61` `pinned()`: Windows holds a handle on the entry through the rename and the delete (`:339`), so no ancestor can be renamed; the quarantine must be the target's dev/ino in the same validated parent, the parent is re-proved after the delete, and put-back (`:363`) only runs when the quarantine is present and the original name is free, never over a replacement                                                                                                                                                     | the swap-back probe during the rename (Linux: removed, outside untouched; Windows: the swap itself is refused; macOS: refused, outside bytes kept); put-back after a changed parent; a swap during a quarantine sweep                                          |
| P3 sizes were not from the final head                     | the table below is from production builds of `85683ac94` and of the final head                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | —                                                                                                                                                                                                                                                              |
| Windows rule: links above the data folder are normal      | `nodeUsageFs.ts:81` the data folder is canonicalised once (`canonicalPath`); only components inside the store must not be links                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | a data folder reached through a junction (Windows) or symlink (Linux/macOS) reads, writes and removes                                                                                                                                                          |

The 2 s disposal flush: its timer only stops _waiting_. The append it leaves
running still needs the write lock and checks the boundary inside it, so it
either lands before the delete (which then removes it) or after it (and
refuses). RVM107W2H P3 corrects this record: the test at `818037ad0` released
the append after 300 ms, so it never reached the 2 s wait. The FIXM107W2H
version waits until the flush's own timer fires with the append still blocked.

### Residuals, exactly

- **Linux:** every rename, stat and delete acts on the verified parent inode
  (`/proc/self/fd/<fd>`); a swapped parent or ancestor cannot redirect them.
- **Windows:** while the handle on the entry is open, Windows refuses to rename
  the parent or any ancestor (`EPERM`, measured on the host and the Win11 rig);
  the rename and the delete run under it.
- **macOS** (Node has no `openat`/`renameat` and no rename-blocking handles):
  a same-user process that replaces directories inside the private data folder,
  timed to the operation, can (a) during the quarantine rename, move an
  outside entry to a `.removing-*` name in its own directory; the call refuses
  (`usagePathChanged`), never deletes it, and puts it back only when it is
  reachable from the validated parent (test: put-back, macOS branch); and (b)
  between the last proof and `rm`, redirect the delete to an entry with that
  same quarantine name under the swapped-in directory. RVM107W2H P3 corrects
  the outcome: the call is not guaranteed to notice. It reports
  `usageRemoveIncomplete` when the directory is swapped back before its final
  check (the sweep probe's macOS branch) and can succeed when it is not.
- **Every platform:** the recursive delete inside a proven quarantine is Node's
  path-based `fs.rm`, so a same-user process writing into that quarantine while
  it is deleted could swap a subdirectory for a link.

Static links inside the store are refused on every operation. The earlier
claim "any swap refuses and a moved entry is put back" is withdrawn; the
statements above are the ones the tests prove. SECURITY (M107 section) and
PRIVACY carry the same wording.

### F1 and the theme class

Visual review F1 (320 px legends and trailing values cut off): the Resources
section is a size container (`ResourcesSection.css`). At 720 px and below each
history table becomes labelled cards: every cell shows its column header
(`data-label`), the tables keep explicit `table`/`row`/`cell` roles, and the
cards sit in an auto-fill grid (one column at 320 px, two at 690 px). Legends
wrap; chart frames size with their border. The scene harness now fails on any
element outside the section and on any table region that scrolls sideways.

Both resource-history harnesses apply and assert the captured theme body class
(`vscode-light`, `vscode-dark`, `vscode-high-contrast`,
`vscode-high-contrast vscode-high-contrast-light`) on every page:
`test/harness/resource-history-check.mjs` had a bare `<body>`;
`test/harness/usage-resource-scenes.mjs` had the class from its host but never
checked it.

Re-render: **24 scenes, 0 clipped, 0 axe violations, 0 page errors, no
overflow, every theme class**; all 24 inspected (history scenes cut into
readable tiles: charts, legends, cards, pager, events, totals, harness work,
earlier days; empty and unavailable in one sheet), dark and high-contrast
again after the class change. The committed shots total 3.46 MB (1.19 MB
before: the cards make the history scenes taller; 690 px is 6,273 px tall with
two columns). J's fixture harness: 8 pages, 0 axe, no overflow, every class,
section 18,121 bytes (25 KiB budget).

### Red drills

Byte-exact mutation, owning test, restore checked byte-identical by hash.
G1–G15 and G17 on Kubuntu slot 2, G16 on the Windows host (the Windows
branches only run there), T1/T2/G18 on the host's harnesses.

| Drill | Guard (mutation)                                               | Owning test (failed while mutated)                                     |
| ----- | -------------------------------------------------------------- | ---------------------------------------------------------------------- |
| G1    | same-name quarantine sweep in `remove()` (never matches)       | fails, then succeeds only once both are gone                           |
| G2    | delete proved absent (`return` instead of throwing)            | refuses a removal whose delete returns but leaves the entry            |
| G3    | listings hide quarantines (filter removed)                     | fails, then succeeds only once both are gone                           |
| G4    | strict sweep first in retention (removed)                      | reports a retention failure (called 1 time, not 2)                     |
| G5    | retention failure reported (`notify` removed)                  | reports a retention failure (called 0 times)                           |
| G6    | append boundary check inside the lock (removed)                | delete during the append's retention pass (a line on disk)             |
| G7    | live-write boundary check inside the lock (removed)            | writes nothing stamped before a completed Delete history               |
| G8    | Delete history holds the write lock (`action()` direct)        | Delete history waits for a live write in flight                        |
| G9    | append holds the write lock (bypassed)                         | disposed-window append past the 2 s wait (a line on disk)              |
| G10   | lock proved held before writing (removed)                      | never writes once the lock is no longer held                           |
| G11   | journal read drops records at or before the boundary (removed) | hides records whose removal never happened                             |
| G12   | live read drops records at or before the boundary (removed)    | hides records whose removal never happened                             |
| G13   | rollup drops records at or before the boundary (removed)       | rolls nothing up from before the boundary (1 minute, not 0)            |
| G14   | Linux parent pin (path-based instead)                          | swap-back probe, Linux branch (`usagePathChanged`, not removed)        |
| G15   | put-back after a changed parent (removed)                      | put-back, Linux branch (left under the quarantine name)                |
| G16   | Windows entry pin (never held)                                 | swap-back probe, put-back and sweep probe, Windows branches (3 failed) |
| G17   | data folder canonicalised once (raw path)                      | junction/symlink data folder (`linkedUsagePath`)                       |
| T1    | bare `<body>` back in `resource-history-check.mjs`             | the harness: exit 1, 8 of 8 pages flagged                              |
| T2    | no theme class in the usage scene host                         | the scene harness: exit 1, 24 of 24 scenes flagged                     |
| G18   | narrow cards off (`@container (max-width: 1px)`)               | the scene harness: exit 1, 8 history scenes clipped                    |

**20 of 20 failed while mutated; all restored identical.** G1–G17 ran twice:
on the first round-3 file, and again after its tests moved into
`resourceHistoryReview.test.ts` and `resourceHistoryDisposal.test.ts` (G9):
the same owning test failed each time.

### Runs

Kubuntu slot 2, repository default timeouts, at most three files per run, on
the final source: review + disposal + wiring **30/30** (the final layout);
before the move into those files: round 3 + journal + journal store
**44/44**, round 3 + review + wiring **28/28**; wiring + usage service +
journal store **41/41**; usage integration + rollup +
text **76/76**; export + panel + CLI **32/32**; exec/runtime/ACP resources
**34/34**; `ResourcesSection` + `UsageAppResources` + `UsageApp` **49/49**;
earlier in the round: export + companion chunks + deferred bundles **104/104**,
browser UI text + history bundle + webview bundles **17/17**, bundle size +
panel + CLI **73/73**. One failure on the way: the wiring test took the first
name in the resources root as its day folder; the write lock's files now live
there, so it picks the UTC day folder and waits for it (on Windows the live
minute can be read before the disposal flush writes the day file).

Win11 rig (slot 2): review + disposal + wiring **30/30** (the final layout;
**28/28** before the move). Windows host: round 3 and review **17/17**,
journal and wiring **19/19**. Three host-only timing failures (journal store's
300 ms warm scan and 30 s two-process append, usage integration's 15 s settle)
fail identically on `85683ac94` on the same loaded host (455 ms, timeout,
timeout) and pass on Kubuntu: host load, not this change.

### Gates and sizes

Host, on the final source: `npm run typecheck` (five projects) **0**; ESLint
`--max-warnings=0` on every changed source, test and harness **0**; stylelint
**0**; Prettier `--check` on every changed text file **0**; knip **0**;
`cycles` **0**; `check:l10n` **0**; `check:reference` **0**; `check:host-api`
**0** (no new importer); `npm run build` **0** (size, split, host-globals,
notices). jscpd first exited **1**: seven clones, all test code (round 3's
setup repeated the review file's, plus two repeats inside it). The shared
fixtures (`test/unit/helpers/resources/journalFixtures.ts`, `fsSpies.ts`), one
review file and the separate disposal file brought it to **0 clones**; ESLint,
knip and the unit typecheck were rerun on the result: **0**.

Production builds of `85683ac94` and of the final source (`5da90b170`; the
later commits change tests and records only). The `85683ac94` build ran in a
detached worktree through a `node_modules` junction: its size check passed;
its split check reported eight vendored packages "no longer carried" only
because the junction moves their paths outside `node_modules/`.

| Artifact / closure                | 85683ac94 KiB | Final KiB | Cap KiB |
| --------------------------------- | ------------: | --------: | ------: |
| `dist/resourceGovernor.js`        |         119.3 |     122.5 |     125 |
| `dist/resourceAdmission.js`       |           2.0 |       2.0 |      25 |
| `dist/usageService.js`            |          96.9 |      99.9 |     100 |
| `dist/usagePanel.js`              |          72.4 |      72.4 |      75 |
| `dist/usageCompanion.js`          |          43.8 |      43.8 |      50 |
| `dist/webview/usage.js` + static  |         377.5 |     377.5 |     500 |
| `dist/webview/usage.css`          |           9.1 |      10.0 |      25 |
| Usage body (lazy)                 |          36.2 |      36.2 |      50 |
| Resource history closure          |          46.6 |      49.4 |      50 |
| `dist/webview/resourceHistory.js` |           8.7 |      10.6 |      25 |
| Surface English (deferred table)  |          24.8 |      24.8 |      25 |
| Webview startup + static chunks   |         732.7 |     732.7 |     900 |
| `dist/extension.js`               |         509.7 |     509.7 |     600 |

`usageService.js` is 102,299 bytes of 102,400 (101 bytes free; 99,225 at
`85683ac94`): the write lock, sweeps and Windows pin cost 3,074 bytes after
trimming the round's own code (shared helpers for the parent proof, the
delete check and the diagnostics). The resource history closure is at 49.4 of
50 KiB (the labelled cards). No cap changed; both are the next additions'
limit on this path.

## FIXM107W2H: RVM107W2H, the final W2 round

2026-10-08, on `m107/w-history` after `818037ad0`. The Codex review
RVM107W2H of `85683ac94..818037ad0` found no P1, five P2s and two P3s.
Commits: `b5443ff6e` (fixes and regressions) and the commit that carries
this section (deterministic waits, one more guard test, the redundant
pre-action lease check removed, records). No model calls (**0 attempts**), no credential,
dependency, push, rebase or merge.

The regressions are the `RVM107W2H` describes in
`test/unit/resourceHistoryReview.test.ts`, the updated boundary-day rollup
test there, and the strengthened `test/unit/resourceHistoryDisposal.test.ts`.
Copied with the updated `test/unit/helpers/resources/fsSpies.ts` into a
detached `818037ad0` worktree and run on Kubuntu slot 2: **13 of 13 failed**,
each on its own assertion. The disposal test passes there by design: P3 was
about the test, not the code. It now takes 2.8 s there, past the 2 s wait.

| Finding                                                                          | Root fix (final head)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | Regression (`resourceHistoryReview`, RVM107W2H, unless named)                                                                                                                                                                              |
| -------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| P2-1 an earlier build's `.removing-<uuid>` survived a "completed" Delete history | `src/runtime/usage/nodeUsageFs.ts:27`/`:33` both formats are quarantine names; the earlier one has no time (always stale) and no original name (it may be any entry of its folder); `:401` `remove()` sweeps every quarantine of the name _after_ the removal (strict: a failure throws), so success means none is left                                                                                                                                                                                                                                                                                                                                     | the earlier quarantine of the usage folder is gone after Delete history; Delete history replies `writeFailed`, not `completed`, while it cannot be removed, then `completed`; listings hide and sweep the earlier format                   |
| P2-2 daily rows ignored the reset boundary                                       | `src/core/usage/resourceJournal.ts:71` rows record `builtAtMs`; `:715` reads drop rows built at or before the boundary; `:478` retention rebuilds such a row from boundary-filtered raw data, `:480`/`:483` give a day with nothing after the boundary no row, `:488` drops rows whose raw day is gone                                                                                                                                                                                                                                                                                                                                                      | a row rolled up before the boundary is hidden at once (no retention), then gone from the month file; a pre-boundary row whose raw day holds nothing after the boundary is dropped; the RVM107W2G boundary-day test now expects no row      |
| P2-3 retention could republish after Delete history                              | `resourceJournal.ts:651` retention runs inside `exclusive` (the write lock); the separate `resources/rollup.lock` is gone                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Delete history started while retention publishes a daily row is refused the write lock while retention holds it, completes after it, and nothing is left                                                                                   |
| P2-4 an expired lease let a paused write resume after deletion                   | `resourceJournal.ts:298` `fence(lock, atMs)`: lease generation, epoch and token current (`isHeld`) and `atMs` after the boundary; passed to appends (`:580`), live writes (`:605`) and retention's writes and removals (`:452`, `:498`–`:512`, with `reset + 1`). The pre-action `isHeld` check in `exclusive` is removed: `acquireLock` returns only a lease it just proved held, and every write proves it again at commit. `nodeUsageFs.ts:300` runs it on the open append handle before the write, `:331` on the flushed stage before its rename, `:380` on the proven quarantine before the delete; `src/core/usage/journalStore.ts:66`–`:69` the port | a paused append whose lease expired while a Delete history took over; a paused live write whose expired lease another writer took (lease part alone); a paused append after a boundary is written under a held lease (boundary part alone) |
| P2-5 put-back checked absence, then renamed (replacing)                          | `nodeUsageFs.ts:61` `restore()`: a file by `link` (EEXIST if taken, on every platform) then unlink; a directory on POSIX claims the name with an exclusive `mkdir` first (a rename can replace only an empty directory); Windows never renames over a directory and cannot claim one (residual below); `:390` used for every put-back                                                                                                                                                                                                                                                                                                                       | a removal whose fence refuses is put back; a file that takes the name just before the put-back keeps it (ours stays quarantined); a directory that takes the name keeps it on POSIX; on Windows the file-over-directory residual           |
| P3-6 the disposal regression never passed the 2 s wait                           | `resourceHistoryDisposal.test.ts` observes the flush's own `RESOURCE_HISTORY_FLUSH_TIMEOUT_MS` timer firing while the append is still blocked, checks that Delete history is then refused the write lock (counted, not timed), and passes the fence through the spy                                                                                                                                                                                                                                                                                                                                                                                         | the same test (3.0 s on Kubuntu)                                                                                                                                                                                                           |
| P3-7 the macOS redirected-delete outcome was stated as certain                   | SECURITY and the RVM107W2G residuals above now say the call is not guaranteed to notice                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | —                                                                                                                                                                                                                                          |

Measured before choosing the put-back primitives (Node 24, a probe on each
platform): POSIX renames replace a file, or only an _empty_ directory, and
refuse a non-empty one; Windows renames replace a file, refuse any directory
target, and rename a directory over an existing **file**; `link` refuses an
existing name everywhere.

### Residuals after FIXM107W2H, exactly

- **Put-back, POSIX directories:** a same-user process that deletes the
  exclusive claim and creates its own _empty_ directory in that instant has
  that empty directory replaced; content is never replaced (a non-empty
  directory refuses the rename).
- **Put-back, Windows directories:** Windows cannot claim a name for a
  directory, and its rename replaces a file: a file created at the
  directory's name before the put-back is replaced (the test's Windows branch
  shows it). RVM107W2L corrects the window: at `7a5ad5105` it was the whole
  span from the quarantine rename to the put-back; FIXM107W2L narrows it to
  between a free-name check and the rename.
- **Fence:** the check and the final call are two steps. A holder paused
  between them lands only in the tree it opened or staged in. If Delete
  history removed that tree meanwhile, the write goes with it: an open append
  writes to the removed file (POSIX), and a staged write's stage is gone, so
  its rename fails. On Windows an open append handle makes that Delete history
  fail instead, and it is retried. Reads drop anything at or before the
  boundary either way.
- The RVM107W2G macOS and every-platform residuals above still apply, with
  P3-7's wording.

### Bundle

`usageService.js` was 275 bytes over its cap after the fixes. No cap changed.
`BROWSER_LAUNCH_FLAGS` (its template substitutions) and the review prompt's
two `JSON.stringify` examples could not be proven side-effect free, so every
bundle importing `constants.ts` kept them unused (490 + 179 bytes in this one,
found by listing top-level declarations never referenced again). They are now
`/* @__PURE__ */`, the pattern `constants.ts` already uses. Bundles that use
them keep them; the others drop them.

### Red drills (W2H)

Byte-exact mutation, owning test on Kubuntu slot 2, restore checked
byte-identical by hash (`b5443ff6e` sources; H6, H7, H17 and G8 again after
their owning tests changed).

| Drill | Guard (mutation)                                                     | Owning test (failed while mutated)                                      |
| ----- | -------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| H1    | earlier `.removing-<uuid>` names recognised (old pattern)            | the earlier quarantine of the usage folder is gone                      |
| H2    | same-name quarantines swept after the removal (removed)              | the same                                                                |
| H3    | a nameless quarantine counts as this name (`target === name`)        | the same                                                                |
| H4    | reads drop rows built at or before the boundary (filter removed)     | a row rolled up before the boundary is hidden                           |
| H5    | retention drops such rows (condition removed)                        | the same, on the month file                                             |
| H6    | no row for a day with nothing after the boundary (always set)        | a pre-boundary row whose raw day holds nothing after it                 |
| H7    | retention under the write lock (an always-held fake lease)           | Delete history waits for a retention pass publishing a row              |
| H8    | fence: current lease generation (`isHeld` part removed)              | a paused live write whose lease another writer took                     |
| H9    | fence: write after the boundary (boundary part removed)              | a paused append after a boundary written under a held lease             |
| H10   | appends commit through their fence (not passed)                      | the same                                                                |
| H11   | live writes commit through their fence (not passed)                  | a paused live write whose lease another writer took                     |
| H12   | the file system runs the append fence (call removed)                 | a paused append after a boundary written under a held lease             |
| H13   | the file system runs the atomic-write fence (call removed)           | a paused live write whose lease another writer took                     |
| H14   | the file system runs the removal fence (call removed)                | a removal whose fence refuses is put back                               |
| H15   | a file is put back by `link` (plain `rename` instead)                | a file that takes the name just before the put-back keeps it            |
| H16   | a POSIX directory put-back claims the name (claim removed)           | a directory that takes the name keeps it                                |
| H17   | the disposal append holds the write lock (an always-held fake lease) | `resourceHistoryDisposal` (Delete history refused the lock: 0 refusals) |

**17 of 17 failed while mutated; all restored identical.** H6 and H17 first
stayed green. H6's earlier owning test wrote the boundary before any row
existed, where a separate check (no month write without a row) already holds;
the new test starts from a pre-boundary row. H17's "Delete history waits"
check was a 300 ms sleep, shorter than a Kubuntu Delete history; it now
counts the deleter's refused write-lock attempts, and so does the retention
test.

The RVM107W2G drills were run again on the new code: G2–G8, G11–G14 and G17
on Kubuntu, G16 on the Windows host, all red. G6 and G7 now fail with
`resourceHistoryLockLost` instead of their old assertion: with the boundary
check removed at admission, the commit fence refuses the same write. G1, G9
and G15 no longer match because the code moved; H2/H3, H17 and H15/H16 own
those guards now. G10's check is gone (above).

### Runs (W2H)

Repository default timeouts, at most three files per run; the disposal test
sets 15 s itself because it waits out the production 2 s timer.

- **Kubuntu slot 2, final source:** review + disposal + journal **47/47**;
  wiring + usage service + journal store **41/41**; usage integration +
  rollup + text **76/76**; export + panel + CLI **32/32**; exec/runtime/ACP
  resources **34/34**; browser launch + review + review bundle **43/43**;
  `ResourcesSection` + `UsageAppResources` + review UI **31/31**; bundle size
  - deferred bundles + companion chunks **145/145**; browser UI text +
    history bundle + webview bundles **17/17**: **466 passed**.
- **Win11 rig, natively:** review + disposal + journal **46/46**; wiring +
  usage service + browser launch **31/31**; usage integration +
  `UsageAppResources` + review **34/34**.
- **Mac mini:** review + disposal + journal **46/46** (the macOS residual
  branches run only there).
- One native Windows lesson: under the loaded host a Delete history took over
  a second, so a "before the boundary" stamp computed as `now - 1000` after
  it started was really after it; such stamps are now taken before the delete.

### Gates and sizes (W2H)

Host, on the final source: `npm run typecheck` (five projects) **0**; ESLint
`--max-warnings=0` on every changed source and test **0**; stylelint **0**;
Prettier `--check` on every changed text file **0**; knip **0**; `cycles`
**0**; `check:l10n` **0**; `check:reference` **0**; `check:host-api` **0**
(no new importer; `link` comes from the already-recorded `node:fs/promises`);
`npm run build` **0** (size, split, host-globals, notices). jscpd first exited
**1**: one clone, the older boundary-day test repeating the new `rawDay` and
`readerJournal` helpers; it uses them now, **0 clones**, and ESLint, Prettier
and the unit typecheck were rerun: **0**. Sizes are from the production build
of the final source.

| Artifact / closure               | 818037ad0 KiB | Final KiB | Cap KiB |
| -------------------------------- | ------------: | --------: | ------: |
| `dist/usageService.js`           |          99.9 |      99.4 |     100 |
| `dist/resourceGovernor.js`       |         122.5 |     122.0 |     125 |
| `dist/usagePanel.js`             |          72.4 |      71.6 |      75 |
| `dist/usageCompanion.js`         |          43.8 |      43.0 |      50 |
| `dist/webview/usage.js` + static |         377.5 |     376.7 |     500 |
| `dist/webview/usage.css`         |          10.0 |      10.0 |      25 |
| Usage body (lazy)                |          36.2 |      36.2 |      50 |
| Resource history closure         |          49.4 |      49.4 |      50 |
| Surface English (deferred table) |          24.8 |      24.8 |      25 |
| Webview startup + static chunks  |         732.7 |     731.9 |     900 |
| `dist/extension.js`              |         509.7 |     508.9 |     600 |

`usageService.js` is 101,795 bytes of 102,400 (605 free; 102,299 at
`818037ad0`). The fixes cost about 400 bytes; the pure annotations recovered
about 900 here and 0.5–0.8 KiB in every other bundle that imports
`constants.ts`. `dist/browserCheck.js`, which uses the flags, keeps them
(52.4 KiB). The resource history closure is unchanged at 49.4/50 KiB. No cap
changed.

## FIXM107W2L: the lead review of the put-back

2026-10-08, on `m107/w-history` after `7a5ad5105`. The lead's review of
`818037ad0..7a5ad5105` accepted the fence, the boundary rows and retention
under the lock, and asked for three fixes in `nodeUsageFs.ts`. No model calls
(**0 attempts**), no credential, dependency, push, rebase or merge; no shared
file beyond `nodeUsageFs.ts`, its test and these records.

| Finding                                                                                                                                                                              | Fix (final head)                                                                                                                                                                                     | Regression (`resourceHistoryReview`, RVM107W2L)                                                                        | On `7a5ad5105`                                                                             |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| P2 a Windows directory put-back renamed with no check, so a file created at the name any time after the quarantine rename (lstat, parent proof, the fence's lease read) was replaced | `src/runtime/usage/nodeUsageFs.ts:70` on win32 the name must be free immediately before the rename; a taken name skips the put-back and leaves the entry quarantined                                 | a file the fence writes at the name after the quarantine rename keeps its content; ours stays quarantined              | fails natively on this Windows host: the name is our directory (`EISDIR` reading the file) |
| P3 a POSIX claim was left at the name when the rename failed                                                                                                                         | `nodeUsageFs.ts:74`–`:79` the claim is removed with `rmdir` (empty only, never recursive) before the error is rethrown                                                                               | the put-back's rename fails (`EIO`): nothing is left at the name; ours stays quarantined                               | fails on Kubuntu: the empty claim is at the name                                           |
| P3 a fence refusal was reported as `usagePathChanged`                                                                                                                                | `nodeUsageFs.ts:392`–`:418` the fence runs after the identity proof, outside its `try`; its own error is rethrown after the put-back; `usagePathChanged` is kept for an entry or parent that changed | a removal refused by its fence reports `resourceHistoryLockLost` (and is put back); the two tests above check the same | fails on both: `usagePathChanged`                                                          |

Callers: nothing in `src` branches on either message. Retention reports any
failure through `onRetentionError`; Delete history and lock-claim removals
pass no fence. The earlier `remove()`-with-a-refusing-fence test now expects
the fence's own error. The Windows residual test (the file is created inside
the rename call itself, after the check) still shows the remaining window.

The residual, reworded in SECURITY and above: on Windows, a file created at a
directory's name **between the free-name check and the rename** is replaced.
At `7a5ad5105` the window was the whole span from the quarantine rename to the
put-back.

### Red drills (W2L)

| Drill | Guard (mutation)                                              | Owning test (failed while mutated)                                              |
| ----- | ------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| L1    | Windows free-name check before a directory put-back (removed) | a file that takes the name after the quarantine rename (Windows host: `EISDIR`) |
| L2    | POSIX claim given back on a failed rename (`rmdir` removed)   | the empty claim is gone (Kubuntu)                                               |
| L3    | the fence's own error rethrown (`usagePathChanged` instead)   | a removal refused by its fence (Kubuntu)                                        |

**3 of 3 failed while mutated; all restored identical.**

### Runs and gates (W2L)

Repository default timeouts, at most three files per run. Windows host,
natively: review **36/36**. Kubuntu slot 2: review + disposal + journal
**49/49**. Mac mini: the same **49/49**.

Host, on the final source: `npm run typecheck` (five projects) **0**; ESLint
`--max-warnings=0` on the changed source and test **0**; stylelint **0**; knip
**0**; jscpd **0**; `cycles` **0**; `check:l10n` **0**; `check:reference`
**0**; `check:host-api` **0** (`rmdir` comes from the recorded
`node:fs/promises`); `npm run build` **0**. Prettier `--check` first exited
**1** on this certification only (the section was appended unformatted);
formatted and rechecked on every changed text file: **0**.
`dist/usageService.js` is 102,054 of 102,400 bytes (99.7/100 KiB, 346 free;
101,795 at `7a5ad5105`). No cap changed.
