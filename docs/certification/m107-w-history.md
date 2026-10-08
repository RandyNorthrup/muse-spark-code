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

Kubuntu rig, repository default timeouts, `rig-test.sh kubuntu … 2`:
12 files, **152 passed** (new: `resourceJournal` 8, `resourceHistoryWiring` 4,
`UsageAppResources` 3, launch host `treeUsage` 1; updated `acpResources`,
`runtimeResources`, `ResourcesSection`).

## Red drills

Byte-exact mutation, owning test, byte-identical restore (hash checked):

DRILLS

## Gates

GATES

## Not done here

- Resource rows get no monthly rollup: detail only, seven days.
- The open minute is appended when it closes, so the page can lag by up to a
  minute (no cross-bundle read-time flush from the usage page).
- The runtime host binds no registered trees, so the ACP agent records no
  harness-work rows; the VS Code window does.
- Installed-editor browser scenes (four themes, 320/690 px) remain the lead's
  rig run; jsdom covers the mount.
