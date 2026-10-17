# Certification — Muse Code at its latest release (M126, MUSEUPDATE)

Lane MUSEUPDATE, 2026-10-17, worktree branch `feat/muse-code-latest`.
Rig `wslpc`, worktree `/home/randy/lanes/MUSEUPDATE`. The product pins
`@muse-code/sdk` 1.4.10 (published 2026-10-16) and implements the MSP
surface of CLI 1.4.5 through 1.4.10, read from the official changelog and
the CLI's own schema export.

## Captures (date, source, result)

All captured 2026-10-17 on this rig (installed CLI 1.4.9-R6297.1):

- Official changelog `https://dev.meta.ai/docs/muse-code/changelog`, read by
  page fetch: 1.4.5 (sessions 256, retry facets on `turn/retryScheduled`,
  permission profiles at start, `runtime_busy` retryable,
  `turn/retracted`, PostToolBatch/StopFailure hooks, `mcpLinkError`,
  `goal` 5-minute timeout, auto-review 15 steps, background prompts
  30 minutes), 1.4.6 (`skill/import`, `task/*`, `workflow/*`,
  `computerUseSetup/*`, recap request/cancel, `plugin/*` + marketplace,
  skill `setActivation`, code search/recall/refactor, `session/start`
  `userShell`, skill display titles, sessionRename capability groundwork),
  1.4.7 (sandbox availability, computer-use setup, skill display names,
  permission profiles on resume, hook timeout 600 s, plugin schema),
  1.4.8 (`sessionRename` capability, rename refusal on Windows,
  `messagePhase`, Windows spawning, `muse serve` model flag,
  `run_in_background`), 1.4.9 (plugin install, `hook/list`, `skill/list`
  session id + title, `approval/reviewing`, `toolUseStart`, v4 view
  cursors, explicit-undefined fix), 1.4.10 (`model_provider` names the
  model's vendor, `turn/retracted` outcome, StaleDroppableMethod retract,
  summary-shape fixes).
- `muse schema generate-json-schema --out temp/muse-captures/schema-1.4.9`
  and `--experimental`: stable fingerprint
  `sha256:5d3b43e5…914c` (69 methods, 41 notifications, 37 error kinds,
  7 capabilities) equals the SDK 1.4.10 `EXPECTED_SCHEMA_FINGERPRINT`, so
  the 1.4.9 CLI and the 1.4.10 SDK agree on the stable surface.
- Live `muse serve --provider echo --no-session-log` child processes over
  stdio (no model call, no sign-in; XDG/HOME pointed at a scratch dir
  holding one user skill, `--no-session-log` so nothing persisted):
  `initialize` (fingerprint above, `sandboxAvailability: available`,
  `sessionRename` requested but NOT granted), `model/list` rows with
  `outputLimit: 128000`, `contextLimit: 1007997`, `variants: "unknown"`,
  `skill/list` rows with and without `title` (`"Titled Skill"` served only
  with nested `metadata.display-name` frontmatter),
  `session/branchChanged`, `recap/completed` (`providerFailed` on echo),
  `turn/foregroundCompleted`, `item/completed` with
  `messagePhase: "finalAnswer"`, `computerUseSetup/check` refused
  `computerUseUnavailable`, `skill/import` dry-run receipt. Saved under
  `test/fixtures/m126/` with `provenance.json`. The release-notes summary
  for 1.4.5–1.4.10 above is captured here because the changelog page is
  not checked into the repo.

## Gate-fire drills (each seen red, restored byte-exact)

- Retry-reason order swapped (`system` before `errorKind`):
  `museCodeLatest.test.ts > maps a model retry` failed; restored
  (`mapNotification.ts` sha `e5925b86…` before and after).
- Ceiling 256→200: the ceiling tests in `museCodeLatest.test.ts`,
  `teamCeilings.test.ts`, `teamConstants.test.ts` failed; restored
  (`constants.ts` sha `e3eef439…`).
- `outputLimit` mapping dropped: recorded-rows test failed; restored
  (`MuseCodeHost.ts` sha `75ace93f…`).
- `ToolUseStart` removed from the wired set: parse test failed; restored
  (`hooks.ts` sha `cc9799d0…`).
- Unlimited gate removed (`state.running < max` without the `=== 0`
  branch): `starts every matching handler at once` failed; restored
  (`hooks.ts` sha `af925b0f…`).
- Waiter claim dropped (settle never resolves): `settles a requested
recap by commandId` failed; restored (`MuseCodeHost.ts` sha
  `3c9bf72e…` before and after).
- View-health separator changed (`: ` for ` ()`): `shows view-health
moves` failed; restored (`mapNotification.ts` sha `0cec988b…` before
  and after).

## What changed, and where

- Pins: `package.json`/`package-lock.json` `@muse-code/sdk` 1.4.4→1.4.10
  (installed with a one-shot `--min-release-age=0`; the 7-day hygiene in
  `.npmrc` is untouched). Fingerprint map gains the 1.4.9/1.4.10 build.
  No repo file pins the `muse` binary: CI and job runners use the
  installed CLI. For the lead: runners need CLI ≥1.4.9 (stable fingerprint
  `sha256:5d3b43e5…914c`); this rig runs 1.4.9, latest release is 1.4.10.
- `MuseCodeHost.ts`: `outputLimit` parsed and mapped (`toModelSummary`),
  skill `title` parsed and mapped (`toSkillSummary`), `permissionProfile`
  on start and resume, `sandboxAvailability`/`sandboxUnavailableReason`
  parsed into `MuseHostInfo`, `sessionRename` requested at every
  handshake (older hosts ignore it; this host did not grant it, so rename
  stays behind the platform gate).
- `mapNotification.ts`: `turn/modelRetryScheduled` → `turnRetry` (reason
  from the attempt's own words), 1.4.6 facets on `turn/retryScheduled`,
  `approval/reviewing` → notice naming the approval,
  `plugin/changed`/`plugin/marketplaceChanged` → `skillsChanged`,
  declined `turn/retracted` → its own notice. New UI keys
  `turnRetractDeclined`, `approvalReviewing` in all 14 tables in English
  order (verified programmatically; `check:l10n` 0 problems).
- `agentEvents.ts`: `turnRetry` gains optional `nextAttempt`, `system`,
  `errorKind`, `httpStatus`.
- `hooks.ts`: `ToolUseStart` parses and is wired (fires nothing until a
  tool-start firing point exists, like `SessionFork`); dispatch takes
  `maxRunningCommands` (0 = all at once).
- Settings (machine): `museSpark.hooksMaxStopContinuations` (8, min 1),
  `museSpark.hooksMaxRunningCommands` (0, min 0),
  `museSpark.subagentMaxConcurrent` (8, 1–64, named in the spawn
  description). Manifest, `package.nls.json`, `settings.ts`, extension
  deps, backend manager, headless runtime, `featureCatalog.ts`, reference
  regenerated (89→92 settings, gate green).
- Team: serve ceiling reads the served version (32 through 1.4.4, 256 from
  1.4.5, unknown→32); contributor RPM corrected to the documented 150
  (still ~9 workers). Stale frame-drop comment fixed (the host answers
  `-32002`/`-32700`, the connection stays open).
- Tests: `test/unit/museCodeLatest.test.ts` (33 tests over the recorded
  fixtures plus schema-faithful params for events the echo host cannot
  emit), ceiling/RPM updates in `teamCeilings.test.ts`,
  `teamConstants.test.ts`. Fixtures under `test/fixtures/m126/`.

## Proven through the built product

`npm run build` green on the final tree (SDK 1.4.10 types through every
bundle, size/split/globals gates inside). Real-use steps for the lead:

1. `muse serve --provider echo --no-session-log`, initialize with
   `requestedCapabilities` including `sessionRename`, confirm
   `sandboxAvailability: available` and no `sessionRename` grant.
2. `model/list`: rows carry `outputLimit`; the picker reads it.
3. Install a skill with nested `metadata.display-name`; `skill/list`
   carries `title`.
4. Set `museSpark.hooksMaxRunningCommands: 1` with two slow SessionStart
   hooks: they run one at a time; at 0 they start together.
5. Set `museSpark.subagentMaxConcurrent: 3`: the spawn tool says
   "Up to 3"; the fourth child queues.
6. `task/list`, `hook/list`, `plugin/list` with a session id: empty
   task/plugin rows, the workspace hook row from `.muse/hooks.json`.
7. `recap/request`: ack `accepted`, then `recap/completed`
   (`providerFailed` on the echo provider); the waiter resolves with
   the outcome and reason.
8. `computerUseSetup/check`: `-32033 computerUseUnavailable` on Linux;
   on macOS the three grants with no prompt.

## Second round: every remaining method wrapped, every notice surfaced

- Queries: `MuseSession.listBackgroundTasks` (`task/list`),
  `listSessionHooks` (`hook/list`), `listSessionPlugins` (`plugin/list`),
  on the `AgentSession` contract as optionals (absent where the backend
  keeps none). Recorded empty task/plugin lists and the real hook row
  (`event: sessionStart` kept verbatim) under `test/fixtures/m126/`;
  33 tests in `museCodeLatest.test.ts`.
- `MuseSession.importForeignSkills` (`skill/import`, dry-run preview,
  commandId-idempotent) over the wire; the `importSkills` command keeps
  its CLI transport (M91 behavior unchanged).
- `MuseSession.resumeWorkflowRun` (`workflow/resume`): host-driven, the
  reply names the driven turn. The Tasks surface stays read-only; a
  resume affordance there is an owner UI decision.
- `MuseCodeHost.requestSessionRecap`/`cancelSessionRecap`: ack admits,
  the settlement resolves a commandId waiter (past
  `RECAP_SETTLE_TIMEOUT_MS` = 60 s the wait ends, a late settlement
  becomes a notice). Unsolicited settlements map to a notice with the
  text as it came (standard notice redaction applies).
- `MuseCodeHost.checkComputerUseSetup` (`computerUseSetup/check`): the
  three macOS grants with no prompt; the recorded Linux refusal
  (`computerUseUnavailable`) flows as the MSP error.
- Notices: `recap/completed` (unclaimed), `session/branchChanged`
  (branch spliced, bare sentence when detached), `session/viewHealthChanged`
  (served word spliced, v1 emits only `unavailable`),
  `turn/foregroundCompleted` (why the indicator keeps spinning). New UI
  keys `sessionBranchChanged`, `sessionViewHealthChanged`,
  `turnForegroundCompleted` in all 14 tables in English order.
- Mutations without an approval surface stay unwrapped by owner
  decision: `plugin/install`, `plugin/marketplaceAdd/Remove/Update`
  (install and remove code), `computerUseSetup/start` (opens the macOS
  opt-in flow). `computerUseSetup/changed` stays `UNKNOWN_METHOD`
  (logged once): no computer-use surface exists.

## Left undone, named plainly

- UI wiring for the newly wrapped reads (background-task, hook and
  plugin panels; a History-dialog recap action; a Tasks resume
  affordance) is owner design work; the backend methods, types and
  fixtures are in place and tested.
- New methods the product does not call beyond the above
  (`task/cancel`, `task/stopAll`, `task/background`, `goal/*`,
  `workflow/*` except resume) are parsed by the SDK types and unwrapped
  until a surface needs them.
- Host-loop settings (`hooksMaxStopContinuations`,
  `subagentMaxConcurrent`) are proven by the reference gate, the defaults
  test and the real-use steps above, not by a host unit harness: no unit
  test constructs `ModelApiHost` (the suite has none by design; see the
  lane's test rules), and building the first stub-deps harness would be a
  stand-in.
- `muse` binary on this rig is 1.4.9 (latest 1.4.10): the stable surface
  is identical (same fingerprint), and the 1.4.10-only wire deltas
  (`turn/retracted` outcome, `model_provider` vendor) are incorporated
  from the SDK and schema. The lead's rigs should move to 1.4.10.
- The `l10n-pack-diag.mjs` order check named in the lane brief is not on
  this rig; key order was verified programmatically instead (all 14
  tables place the three new keys directly after `turnRetracted`, as
  in English). The lead runs the pack check at release.
- The `min-release-age=0` one-shot override for the SDK install is
  recorded here; `.npmrc` keeps the 7-day rule.

## Final gates on the finished tree (2026-10-17, exit 0 throughout)

- `npm run lint` (eslint zero warnings + prettier + ps-skip on Linux),
  `format:check`, `typecheck` (all four projects), knip (3 config hints
  only), cycles (none), duplication (0 clones), `check:l10n`
  (0 problems), `check:reference` (92 settings, current),
  `check:host-api` (0 problems), `check:plan` (219, 0 drift),
  `check:roadmap` (219 entries, current), `npm run build` (budgets in),
  `security:audit` (2 advisories under the exceptions file).
- The final typecheck caught 7 indexed-access narrowings in
  `museCodeLatest.test.ts` (`rows[0]`, `settlements[0]` under
  `noUncheckedIndexedAccess`); fixed with the `!` precedent from
  `importHookSources.test.ts`, re-greened, then committed.
- Tests on the finished tree, repo default timeout, no overrides:
  `museCodeLatest.test.ts` 33/33; neighbors `mapNotification`,
  `teamCeilings`, `manifest` 91/91.
- `security:sast` still skips on this rig (semgrep not installable:
  read-only FS blocks pip, scratch venv has no wheel support); the gate
  runs in hosted CI.
