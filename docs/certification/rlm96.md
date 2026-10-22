# RLM96 — land msm96 and make teams run (2026-10-22, linuxlt)

Recovery lane. Base: main at 0.19.0 (`c7bdd3e9`). Built work:
`src/RLM96/01-ms-msm96`, fetched from `~/gates/muse.git` and merged with
`git merge --no-ff`. This record is the lane's proof; `msm96.md` stays the
record of the built work itself.

## What the merge resolution kept

The worktree keeps current main plus msm96's genuine M96 additions, file by
file. Verified with a line-level union check (`temp/union-check.mjs`,
since removed): every line either side added is still present, and each
absence was judged:

- Main wins where it moved on: the ACP effort-tier refinement, the quota
  identity with provider/credential/observation ids (over the msm96 sha
  digest), the worker fence's macOS fd probe, the production-package
  no-fakes cleanup, the `runTreeProgram` limits parameter nothing calls.
- msm96 wins where the feature lives: team host/engine/panel chunks and
  their ship lists, the golden team request, `retryAfterMs` on the Model
  API entry, the team-configuration reference entry, the release latch,
  the README team sections (including the honest "remains unavailable
  until its integration is complete").
- D121/D208: our caps stay out (`TEAM_ENGINE_HARD_CEILING`,
  `TEAM_MAX_WORKERS_PER_CPU`, the temporary-host allowance).

(prettier reformatted 12 merged files afterwards; formatting only.)

## What this lane changed on top of the merge

- `test/e2e/team.live.e2e.test.ts` (new): one real enabled-team run through
  the real `TeamHostService`, real engine ports, real charter/prompt/
  toolset builders, the real fence and native helper, real git and a real
  `muse exec` worker turn on `muse-spark-1.3-contributor`, then collect,
  the tree's two-click merge and a byte-exact file check, plus a
  trace-audited call count (cap 12, brief).
- `test/unit/helpers/teamAvailabilityRig.ts` (new) with the shared latch
  rig; `test/unit/teamAvailability.test.ts` and
  `test/integration/teamPanelAvailability.test.ts` share it instead of
  copying the ports.
- `src/core/resources/commands.ts`: `execResourceFile` and
  `execResourceFileBytes` share one launch helper (duplication gate).
- Dropped 17 stale `@unwired` tags whose symbols have in-tree callers
  (deadcode gate): `acpFsWrite`/`acpFsRead`, `runEngineWorker`,
  `workerServeArgs`/`runMuseCodeWorker`, `recordTeamSwitch`/
  `switchHookPayload`, `loadRoles`, `generateEd25519Key`,
  `moveMcpSecretToVault`, `createSchedulePaidScope`, `runPluginHook`,
  the M123 checkout pair, the M115 report pair, `ARCHIVE_DAY_CHOICES`,
  `VAULT_IDLE_MINUTES`. Product wiring beyond today's callers stays with
  each marker's milestone (C-M96-5/M96b for the team entries).
- `knip.jsonc`: the team host chunk barrel entry and the installed `muse`
  binary the live drill drives.
- Regenerated (sanctioned writers): host-api record, lazy registry,
  third-party notices.

## The live enabled-team run (brief proof)

Expected first: at most 12 contributor-model calls. The flow test
delegated one engineering task, the worker wrote the dictated bytes to
`hello-team.txt`, collect settled `done`, the merge card completed with
`merge`, and the working tree holds the exact bytes.

- Run 2026-10-22 ~02:41 UTC: worker session
  `9cf98190-8b8d-49c7-a648-c966bd62a906`, 4 calls, both trace markers
  agree (`model response created` 4, `model completed` 4),
  usage `{input_tokens: 94340, output_tokens: 825}`.
- Earlier runs: 3 and 4 calls. Never above 4; cap 12 holds.
- Count method: `muse trace inspect` on the worker's session log;
  failures refuse (`count mismatch`) unless the two record families agree.

The drill's own path caught four driver bugs before the product ran
(each a harness fix, not product behavior): the stored team seeded after
service construction, the missing `probeEntries` call, the missing
orchestrator `approvalMode`, and the end-of-task commit/publish the
engine port performs.

## Red/green drills

1. Count audit fires (no spend: reuses the recorded session
   `9cf98190-…`, `TEAM_LIVE_SESSION` + `-t "the run cost"`).
   Break: cap `12` → `3`. Red exit 1:
   `AssertionError: expected 4 to be less than or equal to 3`.
   Restore `12`. Green exit 0, 1 passed.
2. Audit needs its session record (same reuse, no spend).
   Break: `TEAM_LIVE_SESSION=00000000-0000-4000-8000-000000000000`.
   Red exit 1: `Error: no session record for 00000000-…`.
   Restore the real id. Green exit 0, 1 passed.

## Gates (final tree)

- `npm run typecheck` (all five projects): exit 0.
- eslint on touched files: exit 0, zero warnings.
- prettier --check on changed files: exit 0 (after --write).
- `node scripts/check-l10n.mjs`: 0 problems.
- `npm run check:reference`: current.
- `npm run check:host-api`: 0 problems (after --write).
- `npm run check:plan`: 0 drift (222 milestones).
- `npm run check:roadmap`: current (222 entries).
- `npm run check:catches`: matches the baseline (2 identities refreshed
  after the `launchGovernedFile` extraction moved code around two
  behavior-identical handlers; counts unchanged).
- `npm run duplication`: 0 clones.
- `npm run cycles`: exit 0.
- `npm run deadcode` (knip): exit 0; only the 3 pre-existing
  configuration hints.
- `npm run build`: exit 0, every budget holds.
- `SEMGREP_ENABLE_VERSION_CHECK=0 npm run security:sast`: exit 0.
- `npm run security:audit`: exit 0.
- Suites (repository deadline, `--maxWorkers=3`): teamAvailability 6,
  teamWorkerCreate 132 (28 platform skips), teamHostService +
  teamRolesSection 127, golden invariants 42, the live drill 2
  (`MUSE_LIVE_E2E=1`), teamPanelAvailability 1 in the real Extension
  Development Host.
- `npx vitest related`: green for the touched sources.

## Merge verification notes

- `vitest related` on the touched team/resource sources: 1623 passed;
  the only failures are 4 tests that fail byte-identically on the
  untouched base (`c7bdd3e9`, measured in a nested base checkout, since
  removed): `mediaConvert` + 2× `privateRootLease` (the lane's
  group-writable `.app` ancestors trip the owner-only private-root guard)
  and `scheduleBackgroundReconcile` (same guard family for the launcher
  path). Not lane-caused; hosted CI owns them.
- `teamWorkerCreateBundle` failed two ways during the lane, both fixed
  here: the test build omitted production's `execGuard` chunk (fixed by
  mirroring production's team plugin set, which inlines the guard layer),
  then staged its packaged install inside the workspace (fixed by staging
  it under `os.tmpdir()`, as an installed location is).

## Still open (not this lane)

- Roles-file loaders, ACP/Muse worker entries (C-M96-5/M96b), the merge
  planner binding, the team MCP server and slot checks stay `@unwired`:
  wiring them means choosing call sites the plan assigns elsewhere.
- The product switch still needs the release latch and a true
  `museSpark.team` setting; README says the feature remains unavailable
  until its integration is complete.

## Integration (int/recovery, 2026-10-22)

Two test defects surfaced when the merged suites ran on the owner's
Windows 11 PC; neither came from a conflict resolution.

- `teamPanel` (2 cases) asserted `not.toHaveBeenCalled()` on the rig's
  plain recording functions, which always throws `is not a spy` (the
  same lines fail on `rec/rlm96` itself). They now read the rig's own
  records: `updateCalls` and `reloadCalls` stay empty.
- `modelsPanelVaultSection` "routes vault envelopes without reporting,
  and still reports garbage" asserted synchronously, while M96 made the
  panel receive host messages in order through an async queue (lazy team
  schemas first). It now waits for the garbage report and then requires
  it to be the only one, which proves the state and vault envelope before
  it were routed without a report.

Drill: an extra `deps.state.update('drill', 1)` at the start of
`roles/import` in `src/core/team/teamPanel.ts`, and `vaultEnvelopeOf`
matching `vaultStateDrill` in `src/webview/models/panel.tsx`, made all
three cases red (exit 1: `expected [ { key: 'drill', value: 1 } ] to
deeply equal []` twice, and two reports where one was expected);
restored byte-exact, green (exit 0, 40/40 across both files).
