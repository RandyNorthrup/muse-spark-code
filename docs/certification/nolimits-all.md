# No-limits: the report plan reader (D121)

2026-10-20, Linux rig `linuxlt`, worktree `/home/randy/lanes/PLANBOUND`,
branch `fix/0190-planbound`. Authority: the PLANBOUND run notes, shared
`~/lanes/_ctx/codex/common.md`, AGENTS.md and CLAUDE.md read in full. No
sub-agents, no waiting: every step ran in the foreground here.

## Finding and cause

The Grok review of the 0.19.0 join found that the report feature's plan
reader refused a person's PLAN.md above `REPORT_PLAN_MAX_BYTES` (4 MiB) with
`input-size` drift (`src/core/reporting/plan/reader.ts`, the bound enforced
in `parsePlan`; `src/runtime/reporting/engine.ts` also capped the file read
at that bound). That is a limit of ours in a default path, against the
owner's no-limits order D121: the only hard-coded limits are each provider's
own, and every other limit is one the person sets, none by default.

## Fix

- `src/core/reporting/plan/reader.ts`: `readPlan(text, evidence = {},
maxBytes = 0)` parses the whole plan however large. A byte limit applies
  only when set above 0; past it the read refuses with `input-size` drift
  naming the person's limit (`maxUtf8Bytes=<limit>`). The UTF-8 fast path
  (encode only when the bound is reachable) is kept, parameterized by the
  person's bound.
- `src/runtime/reporting/engine.ts`: `ReportingContext` gains optional
  `planMaxBytes` (0/absent = none). The plan source streams the whole
  PLAN.md through the shared chunked file reader with no cap of ours and
  passes the person's value to the parse.
- The person's setting: `museSpark.reports.planMaxBytes` (integer bytes,
  0 = none, machine-scoped) in `package.json`, all 16 `package.nls.*.json`
  tables with real translations, `src/host/settings.ts`, `SETTING_DEFAULTS`
  and `MACHINE_SCOPED_SETTINGS`, the reports feature entry, the regenerated
  `docs/reference.md`, the README report section plus both settings tables.
  The editor passes its value into the engine; the terminal/ACP runtime reads
  `reportsPlanMaxBytes` from the agent data folder's `settings.json`
  (`src/runtime/runtimeReportsPlan.ts`, 0 when absent/unreadable) and the
  daily-budget strict schema accepts the new key.
- `scripts/check-plan.mjs`: our own hygiene gate keeps exactly the same
  3,565,158-byte archive threshold as its own named constant with the reason,
  and no longer depends on a product bound (whole-file read, no cap).
- `src/core/reporting/plan/FORMAT.md`, the README and the 0.19.0 no-limits
  sentence: reports parse the whole plan however large unless the person sets
  their own byte bound.

`REPORT_PLAN_MAX_BYTES` stays exported for the repository's own plan
tooling (`plan-archive`, `gen-roadmap`); no product read enforces it.

## Tests and break proof

- `test/unit/planReader.test.ts` (55 passed): the oversized-input case now
  asserts a plan past the old 4 MiB bound parses with zero drift by default
  and refuses with `input-size` naming the set limit when one is set (byte
  and multi-byte UTF-8 inputs), and that explicit 0 means none.
- `test/unit/noDefaultLimits.test.ts` (20 passed): the new setting defaults
  to 0 in defaults and manifest, reads whole with nothing set, refuses past
  a person-set bound, and the runtime reader returns 0 for a missing key or
  file (real temp dir under `$TMPDIR`, removed afterwards).
- Break 1: `maxBytes > 0` forced to `>= 0` → 53 of 55 planReader tests
  failed (the default refused everything), reverted to 55 green.
- Break 2: runtime reader `?? 0` forced to `?? 1` → first passed (the
  missing-key case was uncovered), so the valid-file-without-key assertion
  was added; the break then failed exactly the new runtime test, reverted
  to 20 green.

## Gates (final tree)

- prettier on all touched files: clean.
- eslint on all touched files: zero warnings.
- `npm run typecheck`: exit 0, all five projects
  (host, webview, unit, e2e, integration) clean with zero errors, so there
  are no known errors in other files to compare.
- `npm run check:l10n`: 0 problems.
- `npm run check:reference`: current.
- `npm run check:plan`: `plan-format-v1; 222 milestones; 0 drift`, exit 0.
- Suites with the repo's own timeout: planReader 55, noDefaultLimits 20,
  reportEngineLanguage + runtimeAccountingEntry + runtimeDailyBudget 48,
  reportSourceFailures + reportPlaybookSchedules + manifest 68 passed and 1
  failed, paidMoneyStructure + execExactCount 50. The one manifest failure
  (`tiered CI` expects `check:no-output-cap`/`check:no-round-cap` CI leaves)
  fails identically on the untouched base commit, so it is pre-existing and
  unrelated; nothing in this change touches workflows or scripts.
- `npm run build`: exit 0, all bundle budgets, host globals, notices and
  legal scans green.
- `npm run check:roadmap` (CHANGELOG was touched): current, exit 0.

## Real use

- `muse-spark-code-acp report project` in a workspace whose PLAN.md exceeds
  the old 4 MiB bound now generates instead of reporting `input-size` drift;
  setting `"reportsPlanMaxBytes"` in the agent data folder's `settings.json`
  restores the refusal naming that value. (Lead: the packed-product run is
  yours outside the sandbox if you want it on record.)

## Open

- The pre-existing manifest `tiered CI` failure belongs to whoever owns the
  CI leaf rename; this lane did not touch it.
- `CONTRIBUTING.md` (archiving section) still describes the old 4 MiB
  product bound stopping check:plan, check:roadmap and /report; out of this
  lane's listed scope, left for the lane that owns that text.
