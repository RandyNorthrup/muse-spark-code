# NOLIMITSSET: no floor, ceiling or default of ours on a person's value (D121)

Lane NOLIMITSSET, branch `fix/0190-nolimitsset`, base `11733df2be`, rig
`linuxlt`, worktree `/home/randy/lanes/NOLIMITSSET`, 2026-10-20. The lead's
settings sweep during Windows real use found bounds of ours on person-set
values in the packed product's settings and reference. Every one is removed
here; what stays, and the evidence for keeping it, is listed below.

## What was removed

| Setting                               | Old bound of ours           | New rule                                                                                                                                                |
| ------------------------------------- | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `museSpark.hooksMaxStopContinuations` | `maximum: 8`                | 0 is none (the default); a set whole count governs as set (`stopContinuationLimitFor`: 0 → Infinity, else the value)                                    |
| `museSpark.subagentMaxConcurrent`     | `maximum: 64`               | 0 is none (the default); a set whole count governs as set (`subagentConcurrencyFor`: 0 → Infinity, else the value)                                      |
| `museSpark.modelApiCommandRules`      | `maxItems: 500`             | every rule is read; the `tooMany` problem kind, its notice text and the `COMMAND_RULES_MAX` constant are gone                                           |
| `museSpark.browserCheckExtraHosts`    | `maxItems: 32`              | every host is kept; `BROWSER_CHECK_EXTRA_HOSTS_MAX` is gone (each entry stays a plain host name or IP)                                                  |
| `museSpark.resourceCpuMaxPercent`     | `minimum: 30`               | null is none (the default); a set percentage 0–100 governs as set                                                                                       |
| `museSpark.resourceMemoryMaxPercent`  | `minimum: 40, maximum: 98`  | null is none (the default); a set percentage 0–100 governs as set                                                                                       |
| `museSpark.resourceMemoryMinFreeGiB`  | `minimum: 0.5, maximum: 64` | null is none (the default); a set GiB floor of zero or more governs as set                                                                              |
| `museSpark.resourceDiskMinFreeGiB`    | `minimum: 2`                | null is none (the default); a set GiB floor of zero or more governs as set                                                                              |
| `museSpark.usageHistoryDays`          | default `365`, `30–1825`    | null (the default) keeps every rolled-up day until the person sets a day count or clears history; a set whole number of days of at least 1 trims as set |
| `museSpark.webSearchMaxPerRequest`    | `maximum: 20`               | 0 is none (the default, sends no max); a set whole count of at least 1 sends as set                                                                     |
| `museSpark.mediaUploadExpiryDays`     | `minimum: 1, maximum: 30`   | 7 by default; a set whole number of days of at least 1 converts to `expires_after` seconds as set                                                       |

For each, the bound left `package.json`, the settings reader/zod schema
(`src/host/settings.ts`), the constants that only served it
(`src/shared/constants.ts`, `src/shared/browserCheckConstants.ts`), every
clamp in code (`stopContinuationLimitFor`, `subagentConcurrencyFor`,
`webSearchMaxCallsFor`, `compileCommandRules`, `uploadExpirySeconds`,
`searchAllowanceUsd`, `resourceSettingsSchema`, `retain`/`rollUp`, the usage
settings file), the CLI-mirroring resource flag validation
(`src/runtime/resources/args.ts`, via the shared schema), and every text
that stated the old bound (English plus all 14 translations, the README,
`docs/acp.md`, the CHANGELOG `[0.19.0]` Fixed entry). The reference was
regenerated with the repository's script. A value outside the quantity's
own nature — a negative count, a percentage past 100, a non-whole or
sub-1 day count — is refused with the product's sentence naming the
setting (`Setting museSpark.<key> is invalid and its default is in
effect`), never clamped silently.

## What was kept, and why

- `museSpark.webSearchMaxPerRequest` max 20 and
  `museSpark.mediaUploadExpiryDays` 1–30 are recorded in PLAN.md as the
  provider's. Verified: neither number comes from a capability record with
  a documentation URL. The hosted-search capability is
  `{ tool: 'web_search' }` with no maximum
  (`src/core/providers/capabilityRecord.ts:147`,
  `src/core/backends/modelapi/modelCapabilities.ts:46`); the media
  capability record carries formats, inline maxima and duration but no
  expiry range (`src/core/media/metaMediaCapabilities.ts`), and the
  research captures show only that `expires_after` seconds are honoured,
  never a documented 1–30 day range (`docs/research/m105-captures/`,
  `docs/research/meta-coverage-2026-10-05.md`). Both literals were ours,
  so both were removed, not moved to a record.
- Plain input-shape bounds stay: a rule's words/examples/justification
  lengths, a profile name's length, a path's length, a host entry's shape,
  wire-shape checks (a safe positive integer of `expires_after` seconds,
  the upload receipt's `expires_at` verification). None limits how many
  values the person sets.
- `resourceGpuMaxPercent` / `resourceDiskBusyMaxPercent` 1–100,
  `screenRecordingMaxSeconds` 10–600 and the questions deferral are out of
  this lane's brief (GPU/disk-busy probes, another lane's recording and
  lane NOLIMITSQ's deferral); untouched.
- `RESOURCE_HISTORY_MAX_DAYS` (1825) stays as the read/display row cap in
  `src/shared/resourceHistory.ts` and the unreadable-choice fallback in
  `src/core/usage/resourceJournal.ts`; retention itself no longer trims to
  it. The 15% RAM cap on the memory floor (`RESOURCE_MEMORY_FLOOR_MAX_FRACTION`)
  stays: observed, out of this brief, listed for the lead.
- `mediaUploadExpiryDays` default 7 stays: an upload needs an `expires_after`
  value on the wire, and 7 days is the value the captures upload with, not
  a limit on the person's choice.

## Proof

- Red first: the extended `test/unit/noDefaultLimits.test.ts` (plus the
  rewritten cap tests in `commandRules`, `resourcesContracts`,
  `resourceNoLimits`, `museCodeLatest`, `permissionPolicy`,
  `mediaContracts`) ran against the untouched tree: 19 failures, each the
  old bound refusing or truncating the new-rule value.
- Green after: the same suites pass on the final tree (348 tests across
  the touched suites, repository's own timeouts, `--maxWorkers=3`),
  including a real journal over a temp folder that keeps a 400-day-old
  day with nothing set and trims it at a set 10 days, and the manifest
  firewall assertions (`not.toHaveProperty('maximum'/'maxItems'/'minimum')`)
  so a bound of ours on these settings cannot return.
- Gates on the final tree: prettier, eslint zero warnings on touched
  files, `npm run typecheck` (all projects), `node scripts/check-l10n.mjs`
  (14 UI + 14 usage tables, 266 manifest strings, 0 problems),
  `npm run check:reference`, `npm run check:catches`, duplication,
  cycles, deadcode, `npm run build` with budgets — exit codes in the lane
  report.
