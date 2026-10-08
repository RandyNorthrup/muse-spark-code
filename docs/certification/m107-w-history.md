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

| Finding                                                          | Repair                                                                                                                                                                                                                                         | Regression (`test/unit/…`)                                                                                                    |
| ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| P1 retention/Delete history removal could act outside the folder | `src/runtime/usage/nodeUsageFs.ts` `remove()`: rename to a fresh `.removing-*` name in the same parent, prove dev/ino of entry and parent with no linked ancestor, remove, re-prove the parent; any swap refuses and a moved entry is put back | `resourceHistoryReview`: swap right before `rm` (retention and the primitive itself), swap right before the quarantine rename |
| P2 off-period readings written after consent                     | `src/runtime/resources/history.ts` `isAdmitted()`: consent checked at collection; the collector is dropped while off                                                                                                                           | `resourceHistoryReview`: off, sample, on, flush → no minute                                                                   |
| P2 Delete history resurrected pre-delete minutes                 | `src/runtime/usage/resourceResetFile.ts` reset boundary written before the delete (`usageServiceEntry.ts` `deleteHistory`); collectors drop held data on a new boundary; `ResourceJournal.append`/`writeLive` refuse records at or before it   | `resourceHistoryReview`: sample, delete via `createUsageAccess.connect`, flush → no minute                                    |
| P2 retried events duplicated                                     | `src/core/usage/resourceJournal.ts`: each line carries a collector-scoped `id`, reused on retry; reads keep one copy per (collector, id)                                                                                                       | `resourceHistoryReview`: complete line then `EIO`, retry → one event, count 1                                                 |
| P2 window shutdown lost the open minute                          | `resourceGovernorEntry.ts` `flushResourceHistory()` joined to `admission.ts` disposal, bounded by `RESOURCE_HISTORY_FLUSH_TIMEOUT_MS` (2 s)                                                                                                    | `resourceHistoryReview`: real window host via `configureResources`/`admitResource`, dispose → minute line in the journal      |
| P2 stale stat sizes charged to the 32 MiB cap                    | `ResourceJournal.readFile`/`readLive`/`readRollups`: budget checked before each read, read only the measured size, charge bytes actually read                                                                                                  | `resourceHistoryReview`: nine files 3.5 MiB at stat, 4 MiB at read → refused, ≤ 32 MiB read                                   |

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
`4edd06c86`; the later `readJson` refactor only removes duplicated code.
