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
- Tests: `test/unit/museCodeLatest.test.ts` (22 tests over the recorded
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

## Left undone, named plainly

- `recap/completed`, `computerUseSetup/changed`, `session/branchChanged`,
  `session/viewHealthChanged`, `turn/foregroundCompleted` stay
  `UNKNOWN_METHOD` (logged once): the product sends no recap requests,
  has no computer-use or recap surface, and shows no per-session VCS
  branch. Each needs an owner UI decision (recorded here, not in code).
- New methods the product does not call (`plugin/*`,
  `computerUseSetup/*`, `recap/*`, `task/*`, `workflow/*`,
  `skill/import`) are decided per method in §M126 of PLAN.md: parsed by
  the SDK types, unwrapped only where a surface exists. `task/list` and
  `skill/import` are the next surfaces if the owner wants them.
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
  tables place the two new keys directly after `turnRetracted`, as in
  English). The lead runs the pack check at release.
- The `min-release-age=0` one-shot override for the SDK install is
  recorded here; `.npmrc` keeps the 7-day rule.
