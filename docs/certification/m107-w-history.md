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

## Not done here

- Resource rows get no monthly rollup: detail only, seven days.
- The open minute is appended when it closes, so the page can lag by up to a
  minute (no cross-bundle read-time flush from the usage page).
- The runtime host binds no registered trees, so the ACP agent records no
  harness-work rows; the VS Code window does.
- Installed-editor browser scenes (four themes, 320/690 px) remain the lead's
  rig run; jsdom covers the mount.
