# M107 lane 0 — translation and manifest handoff

`en.ts` and all 14 `l10n/ui.*.json` tables contain the 35 `resource*` keys:
level labels, waiting/pause/relocation notices, resume/run/move/keep actions,
metric/history/work labels, and settings descriptions. Each table has a
real translation; no entry or English allowance is added to
`l10n/untranslated.json`. Templates retain `{device}`, `{metric}`,
`{reading}`, `{threshold}` and `{time}`. Readers must use `UI_TEXT` at
runtime, `fill` for templates and the existing Intl helpers for values.

The settings descriptions are prepared as UI keys because W owns the
manifest contributions. Publishing unused NLS keys alone fails the
existing localization gate. When W adds the contribution entries, copy
the following values from the English table to `package.nls.json`, and
from each matching UI locale table to `package.nls.<locale>.json`:

| Manifest NLS key                                  | Source UI key                           |
| ------------------------------------------------- | --------------------------------------- |
| `command.showResources.title`                     | `resourceShow`                          |
| `command.resumeWorkNow.title`                     | `resourceResumeNow`                     |
| `config.resourceGovernor.description`             | `resourceGovernorDescription`           |
| `config.resourceCpuMaxPercent.description`        | `resourceCpuMaxPercentDescription`      |
| `config.resourceMemoryMaxPercent.description`     | `resourceMemoryMaxPercentDescription`   |
| `config.resourceMemoryMinFreeGiB.description`     | `resourceMemoryMinFreeGiBDescription`   |
| `config.resourceGpuMaxPercent.description`        | `resourceGpuMaxPercentDescription`      |
| `config.resourceDiskBusyMaxPercent.description`   | `resourceDiskBusyMaxPercentDescription` |
| `config.resourceRelocate.description`             | `resourceRelocateDescription`           |
| `config.resourceRelocate.enumDescriptions.paired` | `resourceRelocatePairedDescription`     |
| `config.resourceRelocate.enumDescriptions.ask`    | `resourceRelocateAskDescription`        |
| `config.resourceRelocate.enumDescriptions.off`    | `resourceRelocateOffDescription`        |

Settings are machine-scoped. Their defaults/ranges are independently
specified and tested in `resourceSettingsSchema`: on, CPU 85% (30–100),
memory in use 90% (40–98), free-memory floor 2 GiB (0.5–64, further capped
to 15% of total RAM), optional GPU/disk null (1–100 when set), relocation
`paired` (`paired|ask|off`). Optional null means no probe. Manifest ranges
must agree; runtime/ACP/headless adapters must reuse this schema rather
than maintain divergent settings defaults.

The governor itself charges nothing. No credential or paid-consent
behavior changes in lane 0. Paid extras retain the owner's existing
price/shared-budget first-charge consent; device headroom never grants
device or paid permission. A single-model user sees no new surface before
the governed-spawn wiring exists.

W must place these keys in the resource English fallback region when the
lazy governor/surfaces ship; no new build entry or region rule is invented
by this strings lane. U/H/J compose these labels into their actual surfaces.
Additional surface copy should use the same tables and localization gate.

Initial direct localization gate on Mac mini: 14 tables, 164 existing
manifest strings, 591 source files, **0 problems**, exit 0. Manifest files
are intentionally unchanged until their authorized contributions exist.
