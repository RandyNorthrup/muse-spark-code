# Certification — Muse Code at its latest release (M127, MUSEUPDATE)

Numbered M126 until 2026-10-17, when that number was found already taken on
the rig branches by simple settings (D110). The milestone, its fixtures
directory (`test/fixtures/m127/`) and every comment moved to M127. The
recorded frames keep the client name they were captured with
(`m126_capture`), since a capture is never edited.

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
  `test/fixtures/m127/` with `provenance.json`. The release-notes summary
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
  forwarded on start and resume when a caller supplies one (no surface
  supplies one yet; the host's configured default applies, as before),
  `sandboxAvailability`/`sandboxUnavailableReason`
  parsed into `MuseHostInfo`, `sessionRename` requested at every
  handshake (older hosts ignore it; this host did not grant it, so rename
  stays behind the platform gate). Review correction (RVMUSEUPDATE,
  2026-10-17): `outputLimit`, skill `title` and the sandbox posture are
  carried on the summary/info types but no picker, palette or panel
  displays them yet; read "parsed and mapped" as exactly that.
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
- Team: `museCodeLoadedSessionCeiling(version)` returns Muse Code's
  documented bound (32 through 1.4.4, 256 from 1.4.5, unknown→32) and
  `computeTeamCeiling` uses it for `museCode` sources. Review correction
  (RVMUSEUPDATE, 2026-10-17): `computeTeamCeiling` has no production
  caller yet (true before this lane too) and nothing passes
  `museCodeVersion`, so no running surface applies the 256 bound today;
  the fixed 4 is gone from the formula, the wiring is team-integration
  work. Contributor RPM corrected to the documented 150
  (still ~9 workers). Stale frame-drop comment fixed (the host answers
  `-32002`/`-32700`, the connection stays open).
- Tests: `test/unit/museCodeLatest.test.ts` (34 tests (33 from the lane, 1 review regression) over the recorded
  fixtures plus schema-faithful params for events the echo host cannot
  emit), ceiling/RPM updates in `teamCeilings.test.ts`,
  `teamConstants.test.ts`. Fixtures under `test/fixtures/m127/`.

## Proven through the built product

`npm run build` green on the final tree (SDK 1.4.10 types through every
bundle, size/split/globals gates inside). Real-use steps for the lead:

1. `muse serve --provider echo --no-session-log`, initialize with
   `requestedCapabilities` including `sessionRename`, confirm
   `sandboxAvailability: available` and no `sessionRename` grant.
2. `model/list`: rows carry `outputLimit`; `toModelSummary` maps it onto
   the model summary (no picker displays it yet).
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
  (`event: sessionStart` kept verbatim) under `test/fixtures/m127/`;
  34 tests in `museCodeLatest.test.ts`.
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
- Methods the product does not call beyond the above stay unwrapped
  until a surface needs them. Review correction (RVMUSEUPDATE,
  2026-10-17): the first draft of this record wrongly listed
  `task/background`, `task/stopAll` and `goal/*` here; all were already
  wrapped before this lane (M45/M46). The genuinely unwrapped remainder
  includes `skill/setActivation` (1.4.6), `workflow/*` except resume,
  `computerUseSettings/*` and the owner-decision mutations above.
  `messagePhase` on items (1.4.8) is captured in the fixtures but not
  mapped: commentary and final-answer items render alike today.
- Host-loop settings (`hooksMaxStopContinuations`,
  `subagentMaxConcurrent`) are proven by the reference gate, the defaults
  test and the real-use steps above, not by a host unit harness: no unit
  test constructs `ModelApiHost` (the suite has none by design; see the
  lane's test rules), and building the first stub-deps harness would be a
  stand-in.
- `muse` binary on this rig is 1.4.9 (latest 1.4.10): the stable surface
  is identical (same fingerprint). Of the 1.4.10-only wire deltas, the
  `turn/retracted` outcome is incorporated from the SDK and schema; the
  `model_provider` vendor word rides Muse Code's own hook payloads (the
  product's Model API hook payload already carried the field before this
  lane), so there was nothing to change for it here. The lead's rigs
  should move to 1.4.10.
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
  `museCodeLatest.test.ts` 33/33 at the lane head; 34/34 after the review regression test; neighbors `mapNotification`,
  `teamCeilings`, `manifest` 91/91.
- `security:sast` still skips on this rig (semgrep not installable:
  read-only FS blocks pip, scratch venv has no wheel support); the gate
  runs in hosted CI.

## PR206 budget probe (2026-10-17, rig linuxlt, lane PR206BUDGET)

- `test/unit/modelsActivationBudget.test.ts`: baseline 561,352 B,
  current 572,418 B, growth +11,066 B vs the 3,072 B cap — must shed
  at least 7,994 B. Cap stays; the Muse Code backend moves off the
  activation path into a lazy bundle (M57's `dist/modelApi.js` precedent).
- `@muse-code/sdk` is the only `node_modules` package in the activation
  bundle (18 files, 227,831 source bytes, identical in both builds —
  not the growth, but dead weight). It is pulled in by `MuseCodeHost.ts`
  (`ChildStdioTransport`, SDK values) and, separately, by
  `host/resources/museResourceLaunch.ts` (`spawnMspConnection`), which stays.
- `src/core/backends/musecode/` inputs: 139,246 B at baseline vs
  211,274 B current (+72,028 source bytes), including this branch's
  `MuseCodeHost.ts` +91 lines and `mapNotification.ts` +109 lines.
- Stub probe (temp-only esbuild run, tree untouched): replacing
  `MuseCodeHost.ts` with an empty class drops 5 modules and 76,489
  minified bytes (572,418 → 495,929). Source bytes of the dropped five:
  `MuseCodeHost.ts` 119,887, `mapNotification.ts` 23,211,
  `promptLedger.ts` 8,948, `sessionRecords.ts` 6,811, `feedback.ts` 2,704.
  `host/resources/museResourceLaunch.ts` stays on the activation path, so
  the SDK stays; `host/team/processLifetime.ts` is not in the activation
  bundle and is out of scope.
- Fix: new `dist/museCode.js` entry (`museCodeEntry.ts`) carrying the five,
  loaded by `MuseCodeBackendManager` on first spawn; no behaviour change.

## PR206 budget fix (2026-10-17, rig linuxlt, lane PR206BUDGET)

- `dist/museCode.js` (from `src/host/backend/museCodeEntry.ts`) carries the
  host, its notification mapping and the SDK; `MuseCodeBackendManager` and
  the account host require it on the first backend start. The governor's
  spawn glue (`museResourceLaunch.ts`) stays at activation and takes its
  spawn paths from the loaded bundle. `usageRecording` travels in the
  manager's deps and lands on the bundle's host at the first spawn, before
  any host is constructed — the only reader is the constructor default.
- `MODEL_TEXT.attachedTextFile` moved to `TEXT_ATTACHMENT_MODEL_TEXT`,
  read by `dist/museCode.js`, `dist/modelApi.js`, `dist/conversation.js`
  and `dist/runtimeEngine.js`; the split gate guards the new block.
- Measured: activation 572,418 B → 481,143 B (growth −80,209 B, cap
  +3,072 B); `dist/museCode.js` 97.6 KiB (budget 125 KiB).
  Activation names the SDK nowhere, not even in a type-only root import:
  under `verbatimModuleSyntax` esbuild preserves the statement and the
  SDK's side effects ride along (~15 KiB), so the manager, the account
  host and the spawn glue take SDK types through the SDK's own modules.
  No behaviour
  change: `museCodeLatest` 34/34, `mapNotification`, `attachments`,
  `attachArgs`, `teamCeilings`, `accounts`, `accountPolicy`,
  `modelTextCompression`, `mediaBudget`, `questionContracts`,
  `bundleExports`, `lazyBundleFiles`, `bundleDiet`, `packagedBundles` green.

## PR206 budget review corrections (2026-10-17, rig macmini, lane RVPR206BUDGET)

- The `usageRecording` sentence above held only in the panel: the terminal
  and headless runtime passed no dep, its installed recording landed on the
  engine bundle's own copy of the host class, and the manager put the absent
  dep over the bundle's copy, so those Muse Code sessions recorded no
  usage. Proved on the built bundles (`installUsageRecording` left
  `dist/museCode.js`'s static unset); fixed in `ac92aa667` (the manager
  forwards dep-else-installed onto the bundle's class at every load).
- Both spawn paths took their resource lease before requiring the bundle,
  so a bundle that would not load held admission with no tree to release
  it; the bundle loads first now (`06b695d10`).
- The production build was red: the notices header named the new bundle
  but `THIRD_PARTY_NOTICES.txt` was never regenerated (`8954974f7`).
- The loader tests fed the guard a hand-written bundle and stayed green
  with a renamed entry export; the guard is now also checked against the
  real entry module, watched failing on the rename (`9f8a2e63b`).
- Measured on the merged tree (main `81dacaf5a` is an ancestor):
  `modelsActivationBudget` baseline 561,352 B, current 481,225 B,
  growth −80,127 B against the unchanged +3,072 B cap.

## PR206FIX Codex threads (2026-10-18, rig macmini, lane PR206FIX)

Codex review of 2026-10-17 21:10Z; each thread re-checked against this
branch head (`3229ce356`): none was fixed by a later commit, so each is
fixed below at its cause.

- T1 (P2, `hooks.ts` process gate): OPEN — `acquireHookProcessSlot` still
  takes no cap (fixed 4) and the plugin path still calls `acquireCommand`
  with the default; fix threads `museSpark.hooksMaxRunningCommands`
  through both gates.
- T2 (P2, abort wake): OPEN — `onAbort` still splices the waiter without
  draining; fix reruns the eligible-waiter drain after removing an aborted
  queue entry.
- T3 (P1, unreachable MSP wrappers): OPEN in part — the `list*` trio is on
  the `AgentSession` contract (`agentBackend.ts`), but
  `importForeignSkills`/`resumeWorkflowRun`/recap/computer-use have
  neither contract nor production caller; fix wires each through the
  backend contract, UI surfacing recorded as follow-up scope.
- T4 (P1, README): OPEN — none of the three settings appears in
  `README.md`; fix documents defaults, bounds and behavior there.
- T5 (P2, Stop-setting scope): OPEN — one setting still governs all four
  sites (one shared constant before `6a14dc657`); fix restores their own
  limits to the three non-Stop loops so the setting governs only Stop
  continuations, as documented.
- T6 (P1, empty captures): OPEN — `task/list` and `plugin/list` fixtures
  are still empty arrays and the computer-use fixture an error frame;
  fix captures nonempty/success frames live with Muse Code 1.4.10.

### Resolutions (lane PR206FIX, commits on `feat/muse-code-latest-fix`)

- T1: `acquireHookProcessSlot` takes the caller's cap
  (`hooks.ts`), `runPluginHandler` takes the dispatch's cap, and the VS
  Code runner (`toolIo runHook`) reads `museSpark.hooksMaxRunningCommands`
  per hook process through a new `ToolIoDeps` getter wired at all three
  `createToolIo` sites (panel setting; defaults elsewhere). Absent keeps
  the fallback 4. Proven in `museCodeLatest.test.ts` (process gate under
  0/1/default) and `pluginDispatch.test.ts` (plugin path at cap 2).
- T2: the abort path reruns the eligible-waiter drain after removing the
  entry (`wakeEligibleWaiters`, shared with release). The new test watched
  failing pre-fix (`expected false to be true`, 29 ms) and green post-fix.
- T3: every wrapper now sits on the backend contract — the `list*` trio
  plus `importForeignSkills`/`resumeWorkflowRun` as `AgentSession`
  optionals, `requestSessionRecap`/`cancelSessionRecap`/
  `checkComputerUseSetup` as `AgentHost` optionals (`agentBackend.ts`);
  the row/receipt types moved there with them. Panels stay owner design
  work (CHANGELOG says so). Enforced by typecheck through the
  `startSession` return-site assignability.
- T4: all three settings in the README settings table (defaults, bounds,
  behavior) plus a Hooks-section paragraph and the Subagents-block
  mention; CHANGELOG `[Unreleased] → Fixed` records the behavior fixes.
- T5: the three non-Stop sites compare against `HOOK_MAX_TASK_REFUSALS`
  and `TEAMMATE_MAX_IDLE_KEEPS` (both 8, the measured pre-`6a14dc657`
  bound); the setting governs only the Stop site, as documented.
- T6, live with Muse Code 1.4.10 on 2026-10-18 (real SDK client,
  `muse serve --provider echo --no-session-log`; driver in `temp/`,
  fixtures committed):
  - `plugin/list` nonempty recorded (`plugin-list-1.4.10.json`): a
    locally installed Agent Plugins bundle serves `source:
"foreignImport"`; the parser already matched exactly.
  - The binary's own schema export (`muse schema generate-json-schema`,
    fingerprint `sha256:5d3b…` — identical to 1.4.9) confirms every
    required row field the parsers read (task, plugin, hook, import
    receipt, workflow resume, recap, computer-use success) and caught one
    real bug: quarantine entries are `{id, reasons[]}`, not the shared
    `{id, reason?}` — fixed (parser, types, mapper, tests).
  - `task/list` gains the wire's additive-optionals `tool` and
    `backgroundInitiator` on the parser, summary and mapper.
  - Measured negatives: a running `session/userShell` is not listed
    (nonempty `task/list` needs a model-driven background task — no
    provider calls in this lane); `computerUseSetup/check` answers
    `computerUseUnavailable` even on this Mac (no grants for a headless
    CLI); `skill/import` receipts stay empty because foreign sources
    resolve outside this sandbox (`/Users/randy` reads denied).

## PR206W1 review threads (2026-10-18, rig macbook, lane PR206W1)

Codex review of 2026-10-18 on PR #206, 11 threads plus the VSIX budget
failure. One line each (OPEN = fixed in this lane; citations are the
commits that already fixed it, re-verified below):

- T1 (P2, `hooks.ts:1279` process gate): fixed by `b0c7712e8` —
  `toolIo runHook` passes the configured cap per process, dispatch and
  the plugin path take the dispatch's cap.
- T2 (P2, `hooks.ts:1203` abort wake): fixed by `b0c7712e8` — `onAbort`
  reruns `wakeEligibleWaiters` after removing the entry.
- T3 (P1, `MuseCodeHost.ts:2194` unreachable wrappers): fixed by
  `1be8f0d14` — every wrapper sits on the `AgentSession`/`AgentHost`
  contract as an optional (`agentBackend.ts`).
- T4 (P1, `package.json:927` README): fixed by `1be8f0d14` — all three
  settings documented with defaults, bounds and behavior.
- T5 (P2, `ModelApiHost.ts` Stop-setting scope): fixed by `b0c7712e8` —
  the three non-Stop loops keep their own 8-bounds, the setting governs
  Stop only.
- T6 (P1, `MuseCodeHost.ts:365` empty captures): fixed by `1453706f6` —
  nonempty `plugin-list-1.4.10.json` plus CLI schema-export verification.
- T7 (P2 security, `ModelApiHost.ts:2918` Stop hard cap): OPEN — the
  setting accepts any integer ≥ 1; fix keeps Muse Code's own 8 as an
  unoverrideable ceiling (schema `lte` plus a clamp at the use site).
- T8 (P1, `hooks.ts:430` ToolUseStart): OPEN — still wired, still fires
  nothing; fix keeps it unsupported (out of `WIRED_EVENTS`, honest
  not-wired warning) until a tool-start firing point exists.
- T9 (P1, `museCodeLatest.test.ts:157` retry frame): OPEN in part — the
  members match the pinned SDK 1.4.10 `TurnModelRetryScheduledParams`
  contract, which folds live frames; fix type-locks the test payload to
  that contract and verifies it against a fresh CLI schema export (a
  live provider-retry frame needs a real rate-limit event: lead-owned).
- T10 (P1, `MuseCodeHost.ts:2340` sandbox availability): OPEN — parsed
  into `HostInfo`, never consumed; fix warns after host construction
  when configured-on but the CLI reports `unavailable`.
- T11 (P1, `mapNotification.ts:446` view-health reason): OPEN —
  `noneReason` parsed, dropped; fix carries it in the notice.
- CI (VSIX 3,797,152 B over the 3,788,800 B budget by 8,352 B): OPEN —
  reproduced with `npm run package`, fixed by shrinking, never by
  raising the budget. Current state in "PR206W1 VSIX budget" below:
  cause measured, SDK-import diet banked, ~7 KB remainder OPEN.

### Resolutions (lane PR206W1, branch `feat/muse-code-latest-w1`)

- T1/T2/T3/T4/T5/T6: re-verified at this head, no new change. T1: `toolIo
runHook` passes the configured cap per process (`toolIo.ts:1084-1087`),
  `dispatchHooks` and `runPluginHandler` take the dispatch's cap, and all
  three `createToolIo` sites wire the getter (`extension.ts:2019,2807`,
  runtime defaults). T2: `onAbort` drains via `wakeEligibleWaiters`
  (`hooks.ts:1237-1244`). T3: optionals on both contracts
  (`agentBackend.ts:667-806`), enforced by typecheck. T4: README
  settings table plus Hooks/Subagents sections. T5: `HOOK_MAX_TASK_REFUSALS`
  / `TEAMMATE_MAX_IDLE_KEEPS` own the non-Stop loops. T6:
  `plugin-list-1.4.10.json` nonempty. Re-verified in this lane at the
  repo default timeout, no overrides: `museCodeLatest` 40/40 (process
  gate, defaults, refusal scope, retry, view-health),
  `pluginDispatch` + `teamCeilings` 41 passed / 2 skipped,
  `mapNotification` 39/39, `sandbox` 17/17, plus two `vitest related`
  sweeps over every changed module (hooks + ModelApiHost: 12 files,
  1069 passed; mapNotification + sandbox + manager + settings +
  agentEvents: 46 files, 891 passed after the one expectation the
  `nextAttempt` fix intentionally moved).
- T7: `hooksMaxStopContinuations` is 1–8 everywhere. Schema `lte(8)`
  (`settings.ts`), manifest `"maximum": 8` (`package.json`), and an
  unoverrideable `Math.min(..., 8)` at the single use site
  (`ModelApiHost.ts:2918`) so programmatic getters never pass Muse Code's
  own bound either. Descriptions (`package.nls.json`, README table +
  Hooks paragraph) name the 1–8 bound and the refusal; reference
  regenerated (`check:reference` green). New test refuses 1000 (warns
  once, default in effect) and accepts 3. Red drill: without the `lte`
  the test fails; restored.
- T8: `ToolUseStart` leaves `WIRED_EVENTS` (stays parsed in
  `HOOK_EVENTS`); configuring it warns `not wired on the Model API
backend` and keeps no handler. A tool-start firing point would span
  every tool path (verify commands, the main loop, code-intel, subagents)
  with observe-only semantics to invent — explicitly deferred by the
  thread's own alternative. Test asserts the warning plus zero handlers.
  Red drill: re-adding it to the set fails the test; restored. Cert
  drill entry "`ToolUseStart` removed from the wired set" now describes
  intended behavior (the gate is the not-wired warning test).
- T9: the payload is member-for-member the pinned SDK 1.4.10
  `TurnModelRetryScheduledParams` (which folds live
  `turn/modelRetryScheduled` frames in `session-fold.js`) and the CLI
  1.4.10's own schema export, regenerated on this rig 2026-10-18
  (`muse schema generate-json-schema`, fingerprint
  `sha256:5d3b43e5…914c` — identical to the lane's recorded 1.4.9):
  required attempt/maxAttempts/nextAttempt/retryDelayMs/sessionId/turnId
  (+ envelope sourceRange/viewCursor, which the non-strict parser
  ignores) with optional errorKind/httpStatus/system — exactly the zod
  schema. The test payload is annotated
  `Omit<TurnModelRetryScheduledParams, 'sourceRange' | 'viewCursor'>`,
  so a wire-contract move fails compilation. Same export caught one real
  adjacent bug: `TurnRetryScheduledParams` requires `nextAttempt`, which
  the turn-level parser dropped — schema, mapping, domain comment and
  both tests now carry it (red drill: without the mapping line the
  facets test fails; restored). A live provider-retry frame needs a real
  rate-limit event — no live model calls in this lane — and stays
  lead-owned real-life proof.
- T10: `sandboxAvailabilityWarning` (pure, `sandbox.ts`) decides from the
  window posture plus the handshake report: warns only when configured-on
  meets `unavailable` (host reason spliced when sent, generic otherwise
  — never inferred), silent for available/unknown/future/off. The
  manager calls it after host construction (`museCodeBackendManager.ts`),
  covering direct and account spawns. Three tests over the real
  function; red drill (flipped comparison) fails all three; restored.
- T11: `session/viewHealthChanged` keeps `noneReason`
  (`(unavailable: projectionUnavailable)`); reasonless shape unchanged
  (the old gate-fire drill still holds for it). New test; red drill
  (reason dropped) fails it; restored.
- Red-drill log: T7 (schema), T8 (wired set), T9 mapping, T10 (pure
  function), T11 (mapping) — each watched failing, each restored
  byte-exact before the final green run below.

## PR206W1 VSIX budget (2026-10-18, rig macbook)

- Symptom (hosted CI): `VSIX is 3797152 bytes; budget is 3788800 bytes
(3700 KiB)` — over by 8,352 B. `npm run package` on this Mac stops
  earlier at the helper gate (`Required Linux created-path helper
excluded from VSIX: x64`): the Linux helpers are gitignored artifacts
  compiled only on Linux (`scripts/build-linux-helper.mjs` returns
  off-Linux), so the absolute packed proof stays CI-owned.
- Cause, measured with a base worktree at the merge base (`81dacaf5a`,
  `npm run build` there, `temp/vsix-rig.mjs` driving the repo's own
  `packRuntimeArchive` over each tree's real `dist` + `l10n`): staged
  solid-brotli archives base→head — code `1073989 → 1082639`
  (**+8,650 B**), ui tables `857923 → 859148` (**+1,225 B**), usage
  unchanged. Staged README/CHANGELOG slices are branch-identical
  (rendered marketplace doc; sliced recent releases, no Unreleased
  Highlights); staged `package.json`/`package.nls.json` grow ~1 KB
  compacted. So the branch ships ~+10–11 KB against ~2 KB of headroom:
  the new `dist/museCode.js` bundle (+100,299 raw) net of the activation
  split (−82,383), the headless runtime's backend growth (+6,310 output
  bytes: the wrappers and notices it also serves), the five translated
  UI keys and the three manifest settings. Every byte audited is a
  feature or its translation — no leak (ship-list audit), no duplicated
  module across the split, minified production output, no stray console
  calls, gates untouched.
- Diet banked in this lane: SDK barrel imports become deep imports
  (`MuseCodeHost.ts`, `museCodeEntry.ts`, `processLifetime.ts` — the
  established `connection.js`/`fingerprint.js`/`spawn.js` precedent),
  cutting unreachable facade/fold/pending modules from the bundle graph
  (SDK inputs per bundle 227,831 → 49,641 source bytes;
  `museCode.js` −2,623 B, `runtimeEngine.js` −2,627 B raw). Same modules,
  same side effects, only direct paths. All bundle guards green
  (`check-bundle-size`, `check-bundle-split`, `modelsActivationBudget`
  — activation stays SDK-free — plus the loader/shape suites).
- Remainder: roughly a further ~7 KB of shipped bytes still has no
  legitimate cut inside this lane's scope — every remaining candidate
  is a whole feature (backend, notices, translations) or architecture
  (shared chunks, another lazy split). OPEN for the lead: a dedicated
  diet lane, or the release's headroom decision. Budget untouched,
  no test weakened. Rig kept at `temp/vsix-rig.mjs` (gitignored) for
  re-measurement; base worktree removed.
