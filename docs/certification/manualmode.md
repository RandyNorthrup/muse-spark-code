# Certification — MANUALMODE: Manual really asks before every command (Muse Code backend)

## 2026-10-18 — protocol mechanism (first result)

Real use (linuxlt, VS Code 1.139, extension in Manual, Muse Code 1.4.7)
showed commands (`touch`, `sleep 300; curl …; rm`, `sudo ls`) running with no
approval reaching the editor; the session files record
`"policy_decision":"allow:llm_judge"`. Manual selects MSP `promptUnmatched`
(`src/shared/permissionModes.ts:75`), so the judge decides unmatched calls
inside that mode.

### Mechanism: per-session permission profile `:ask-me` (stable in 1.4.7)

Muse Code 1.4.7's own schema (`muse schema generate-json-schema`, pinned
binary `/home/randy/lanes/_rig/muse-pinned/1.4.7-R6101.1/muse-bin`,
exported 2026-10-18 to worktree `temp/schema147/`) carries a stable
`session/start.permissionProfile` member (amendment 42624, ADR 42197 D2):
"a profile id the host catalog already admits — the rows
`permissionProfile/list` serves … Select, never create. Omitted means
today's behavior." `ApprovalMode` stays closed (select, never create);
`SessionConfig` still admits only `mcpServers`. There is NO wire member that
turns the judge off besides the profile.

Live catalog from the pinned 1.4.7 host (`serve --provider echo`,
`permissionProfile/list` with `experimentalApi`, 2026-10-18,
worktree `temp/probe-profiles.mjs`, zero model calls):

| profileId       | label        | reviewerAuthority | description                                                                                                                     |
| --------------- | ------------ | ----------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `:read-only`    | Read only    | human             | Reads files only.                                                                                                               |
| `:ask-me`       | Ask me       | **human**         | Edits workspace and temporary files; requires approval for protected writes, new network targets, and other restricted actions. |
| `:auto-review`  | Auto-review  | **autoReview**    | Same access as Ask me; AI reviews eligible actions; trusted permission hooks may decide approval requests first.                |
| `:unrestricted` | Unrestricted | none              | No filesystem sandbox or approval prompts…                                                                                      |

`:ask-me` and `:auto-review` have the SAME access; only the reviewer
differs (human vs AI). That is exactly Manual's promise
(`src/shared/l10n/en.ts` `permissionModeDetails.manual`: "Muse asks before
running each command, unless a permission rule allows it; Muse Code edits
workspace files without asking").

Durable sessions on the pinned 1.4.7 host (`serve --provider echo`, stable
handshake WITHOUT `experimentalApi`, `session/start` with
`approvalMode: promptUnmatched`, 2026-10-18, `temp/probe-start-profile.mjs`):

- default (profile omitted): `permission_profile_committed`, cause
  `new_session_default`, reviewer `auto_review` — the judge is installed.
  Same definition sha as explicit `:auto-review`, so the default IS
  `:auto-review`.
- `permissionProfile: ':ask-me'`: accepted, cause `launch_cli`, reviewer
  **`human`** — no executable reviewer installed for the session.
- `permissionProfile: ':bogus'`: refused
  (`no profile :nope in the host catalog`), proving the member is honored.

### Ruled out (with sources)

- MSP approval modes (`muse schema`, SDK 1.4.4 `msp.d.ts:87`, 1.4.7 schema
  `ApprovalMode` closed enum): selecting `promptUnmatched` does not remove
  the judge — the incident happened inside it.
- `muse serve` flags (1.4.10 `--help`, 2026-10-18): "Approval mode is …
  selected on the wire, so there is no approval flag here."
  `serve --approval-judge off` is refused
  ("--approval-judge is not a serve option"); serve's hidden approval args
  are refusal routes (binary strings, `ServeArgs`).
- `MUSE_DISABLE_APPROVAL_JUDGE` (binary `EnvSnapshot … gate_overrides …
muse_disable_approval_judge`): process-wide for the whole serve host, so
  it would also strip Auto's judge, whose words allow it
  ("Muse Code runs the commands it judges simple without asking").
  Per-session profile is the precise tool; the env var is not used.
- `session/setApprovalMode` (1.4.7 schema): mode-only change, writes no
  profile fact — a mid-session Manual↔Auto switch keeps the starting
  profile. Mid-session profile switch is `session/setPermissionProfile`
  (amendment 42624 FR-42624-2), marked `x-msp-stability: experimental`,
  TO VERIFY live (next step), with `session/read` `permissionState`
  (`reviewerAttached` live evidence) as the ongoing observable.

### What remains to prove

1. DONE — `session/setPermissionProfile` on 1.4.7 with `experimentalApi`:
   accepted (`applyOutcome: completed`), `session/read` serves
   `permissionState` (`profileId`, `reviewerAuthority`, live
   `reviewerAttached`), `session/permissionProfileChanged` is broadcast, and
   `session/setApprovalMode` leaves the profile alone (verified live,
   `temp/probe-set-profile.mjs`, zero model calls). Without
   `experimentalApi` the switch is refused `experimentalRequired` (code
   -32601); on a host predating the method the answer is `methodNotFound`.
2. A real session where a command produces an approval request in Manual —
   needs a model turn; no model calls from this lane (not in brief), so the
   lead runs that drill in the real-life run (steps below). Up to that step,
   everything is proven against the real pinned binary above.

## 2026-10-18 — the fix (PLAN.md D123)

Interactive Manual and Edit-automatically sessions start with
`permissionProfile: ':ask-me'`; interactive Auto sessions with
`':auto-review'`; every other session omits it (host default, as before).
Every mode switch re-syncs the profile through the one session-level
`setApprovalMode` funnel. No mode string changed, so no l10n change.

Files: `src/shared/permissionModes.ts` (`mspPermissionProfile` decision
table), `src/shared/constants.ts` (profile ids),
`src/core/agent/agentBackend.ts` (`StartSessionOptions.permissionProfile`),
`src/core/backends/musecode/MuseCodeHost.ts` (start passthrough,
`syncPermissionProfile` after each mode switch; `methodNotFound` tolerated
once per session for older hosts, every other refusal surfaces),
`src/host/backend/museCodeBackendManager.ts` (`experimentalApi: true`),
`src/host/conversation/conversationController.ts` and `src/acp/agent.ts`
(interactive starts). Headless sessions (schedules, reviewers, best-of-N,
team workers, exec tap, eval) pass no profile and never switch modes, so
they cannot stall on an unanswered approval.

Proven live against the pinned 1.4.7 binary through the REAL
`MuseCodeHost`/`MuseSession` code (esbuild bundle of the unchanged
sources, `temp/probe-host.ts`, echo provider, zero model calls):

- `startSession({approvalMode: 'promptUnmatched', permissionProfile:
':ask-me'})` → `permissionState` `{profileId: ':ask-me',
reviewerAuthority: 'human'}` (default start: `':auto-review' /
'autoReview'`).
- `session.setApprovalMode('onRequest')` → profile `:auto-review`;
  back to `'promptUnmatched'` → `:ask-me`, each confirmed on
  `session/read`.

Unit test: `test/unit/permissionModes.test.ts`
`mspPermissionProfile` (real module, no stand-ins) — seen to fail with the
mapping broken (`promptUnmatched → undefined`: 1 failed, 10 passed) and to
pass with it (11 passed).

UNVERIFIED until the real-life run: a model-driven command raising
`approval/request` in Manual. Drill for the lead (linuxlt, VS Code, Manual,
Muse Code ≥ 1.4.7): ask Muse to run `touch manualmode-proof-<date>.txt` in
the workspace — an approval card must appear and nothing is written until
answered; repeat after switching Manual→Auto→Manual (the Auto turn may run
judge-simple commands free; the second Manual turn must ask again).

Floor: Muse Code older than 1.4.7 ignores `session/start.permissionProfile`
(unknown keys ignored) and answers `session/setPermissionProfile` with
`methodNotFound` (tolerated, one info log per session); Manual there behaves
as before. The Modes menu words hold on 1.4.7 and later.

## 2026-10-18 — three review corrections (lane PR251FIX)

Grok's review of PR #251 found three paths the fix above got wrong. Each is
fixed at its cause and proven below against the pinned 1.4.7 binary through
the REAL `MuseCodeHost`/`MuseSession` code (esbuild bundle of the changed
sources, worktree `temp/probe-pr251.ts`, `serve --provider echo`, zero model
calls; the probe reads `session/read` `approvalMode.mode` and
`permissionState.profileId` over its own connection). Every check failed on
the unfixed code first (scratch clone at `347c989ed0`, since removed) and
passes after.

1. Headless `acceptEdits` kept the old reviewer. The ACP agent sent
   `permissionProfile: ':ask-me'` for every interactive-looking mode,
   including headless exec (which rejects every approval). Now
   `mspStartPermissionProfile` (`src/shared/permissionModes.ts`) returns
   `undefined` when `isHeadless` is true, and `newSession`
   (`src/acp/agent.ts`) carries that: a headless `promptUnmatched` start
   commits `:auto-review`/`autoReview`, exactly the omitted-profile default
   an explicit `:ask-me` start does not. Unit test:
   `test/unit/permissionModes.test.ts` `mspStartPermissionProfile` — 2
   failed on the unfixed tree (`mspStartPermissionProfile is not a
function`), all 13 pass after.
2. A failed profile sync left the host in the new mode. `setApprovalMode`
   (`src/core/backends/musecode/MuseCodeHost.ts`) committed
   `session/setApprovalMode` and then threw on any other
   `session/setPermissionProfile` refusal, so the panel's and ACP's "the
   mode did not change" was false. Now it puts the previous mode (new
   `SessionOwner.currentMode`, `src/core/schedules/sessionOwner.ts`) back
   before throwing. Proven on a handshake WITHOUT `experimentalApi`: the
   Manual switch throws and `session/read` still says `onRequest`; on the
   unfixed code it said `promptUnmatched`.
3. A schedule on a Manual conversation kept `:ask-me`. Admission changed
   the mode but never the reviewer, so unmatched commands became refusals
   instead of judge allows. Now `admitScheduled` selects `:auto-review`
   while the unattended run is in charge and `restoreScheduleMode` puts the
   conversation's profile back with the mode, both in the same place as the
   mode change. Proven on a `:ask-me` `promptUnmatched` session with a real
   `UnattendedRun`: during admission `onRequest`/`:auto-review`, after the
   turn completes `promptUnmatched`/`:ask-me`; on the unfixed code the
   admission stayed `:ask-me`.

Files: `src/shared/permissionModes.ts` (`mspStartPermissionProfile`),
`src/acp/agent.ts` (headless start), `src/core/schedules/sessionOwner.ts`
(`currentMode`), `src/core/backends/musecode/MuseCodeHost.ts`
(`setPermissionProfile` split, `setApprovalMode` rollback, admission and
restore reviewer), `test/unit/permissionModes.test.ts`, `CHANGELOG.md`,
PLAN.md D123.

## 2026-10-19 — three failure-path corrections (lane PR251FIX2)

Grok's re-review found three failure paths the round above left open, and
the probes below found a fourth on the same code. Each is fixed at its
cause and proven against the pinned 1.4.7 binary through the REAL
`MuseCodeHost`/`MuseSession`/`UnattendedRun` code (esbuild bundles of the
sources, worktree `temp/probeA-fix2.ts` and `temp/probeB-fix2.ts`, `serve
--provider echo`, zero model calls). The probes ran on the unfixed tree
first (every check below failed there as described) and again after the
fix commit `4e2db43148` (all pass). All production handshakes in this tree
carry `experimentalApi`, so the probes' handshake WITHOUT it is the
deterministic stand-in for the refusal class the brief names (a managed
exclusion, `permission_profile_unavailable`, a dropped connection, a
deadline): every `session/setPermissionProfile` is refused
`experimentalRequired` while every `session/setApprovalMode` succeeds.

Wire facts established live in this run (pinned 1.4.7, 2026-10-18/19):

- `session/resume`, `session/read` and `session/start` serve
  `session.approvalMode` (`{ mode, source, lastCommandId }`) on every
  handshake; `session/list` rows carry no mode.
- `session.permissionState` (`{ profileId, reviewerAttached,
reviewerAuthority }`) is served only WITH `experimentalApi`; without it
  the block is omitted. The reviewer is therefore observable in the failure
  probes only by composition: the observed mode plus the omitted-profile
  default, which phase 0 of the probe re-establishes live (`:auto-review`).
- `session/setApprovalMode` still writes no profile fact (read-after-mode
  keeps the old profile), which is the desync mechanism in findings 1–2.

1. Resume, fork and load run the live rollback. `sessionRecordSchema`
   keeps `approvalMode.mode`, and `loaded()` seeds the new handle from it,
   so the first `setApprovalMode` after a resume or fork rolls back like a
   live one. Probe A part 1a (start `onRequest`, resume, switch to
   `promptUnmatched` with the profile refused): unfixed, `session/read`
   said `promptUnmatched` — Manual on with the phase-0 judge default, turns
   running. Fixed, it says `onRequest` and the turn sends on the restored
   mode. When the envelope serves no mode (a 1.3.0 record, a list row) the
   handle starts unseeded and the next item applies: the profile step fails,
   the session quarantines, and the throw is `PermissionReviewerError` —
   "The permission mode was applied, but its reviewer could not be
   installed (…). New turns are refused until the mode is set again." —
   never `permissionModeNotApplied`, which would be false there. Probe A
   part 1b (an unseeded handle, the pre-fix resume shape): unfixed, the
   follow-up `sendTurn` SENT on `promptUnmatched`; fixed, it is refused
   with "New turns are refused: the permission reviewer could not be
   installed. Set the permission mode again to recover."
2. A failed rollback is never swallowed. The rollback mints a fresh token
   (a foreground turn that ends during the profile call retires the
   captured one), and when the rollback itself fails the session
   quarantines with the `PermissionReviewerError` naming the wire mode the
   host runs. Probe B races a turn cancel against the mode change until a
   terminal lands between the forward apply and the rollback (1 hit in 30
   attempts on the unfixed tree: the change threw the profile error while
   the host ran `promptUnmatched` and the later turn SENT). After the fix,
   208 further attempts across seven runs rolled back to `onRequest`. The
   panel keeps the chosen mode on
   `PermissionReviewerError` (it is the mode the host runs) and shows its
   sentence; any other throw still reverts to the previous mode. ACP
   `setMode` publishes the requested mode before rethrowing, so the editor
   agrees with the host; load paths (`matchAdvertised`, `restoreChoice`)
   keep failing the load, with true words either way.
3. A failed schedule restore never bricks the session. The restore applies
   the conversation's mode and reviewer as one unit; when the reviewer
   cannot be put back the session quarantines, and the restore gate
   resolves once that outcome is recorded instead of rejecting every later
   call. Probe A part 3 (a real `UnattendedRun` admitted on a Manual
   conversation, profile refused): unfixed, the settled wire mode was back
   on `promptUnmatched` but every later `sendTurn` and `setApprovalMode`
   rethrew the stale restore refusal
   (`session/setPermissionProfile requires experimentalApi capability`);
   fixed, the mode settles on `promptUnmatched`, the log carries one true
   sentence, and later calls hear the quarantine words. What actually
   delivers schedules in this tree: no production path sends through
   `sendScheduledTurn`/`steerScheduledTurn` — the only production delivery
   composition (the runtime engine, `src/runtime/schedules/engine.ts`)
   refuses every target, and `ScheduleAgentSession`
   (`src/host/schedules/backgroundTarget.ts`) is never constructed — so
   the admission and restore paths are proven by driving the real session
   class directly, as above.
4. Found by probe B while proving item 2: a turn that ends while the mode
   command itself is in flight tears its adoption (the ack arrived, so the
   host runs the new mode, but the owner cannot adopt it). Unfixed and
   still after items 1–3, that threw `scheduleBusy` with the host on the
   new mode, the owner on the old, and turns live — the original desync in
   a new guise. Now `applyModeEffect` quarantines on a torn adoption and
   throws `PermissionReviewerError` with the effective mode the ack
   served, on the forward change, the rollback and the restore alike; a
   torn rollback keeps the error that already names the true (previous)
   host mode. One post-fix run hit this path once (`quarantined=1`, turns
   refused, menu mode agreeing with the host).

Committed tests (real code only, no stand-ins): `test/unit/sessionOwner.test.ts`
— quarantine refuses starts and steers while a later applied mode recovers;
`test/unit/sessionRecords.test.ts` — the recorded 1.4.7 resume envelope
keeps `approvalMode.mode` (capture date and command above) and a 1.3.0
record parses with none. The pre-fix failures they pin were observed live
first: probe A `1a-rolled-back`, `1b-turns-refused` and `3-gate-resolves`
on the unfixed tree. Suites: `sessionOwner` (1), `sessionRecords` (12),
`permissionModes` (13) — 26 passed with the repository's own timeout.

UNVERIFIED until real use (lead drills, linuxlt, VS Code, Manual, Muse
Code ≥ 1.4.7): the Modes menu agreeing with the host on each failure path
(switch Manual→Auto with the profile step forced to fail, e.g. a managed
profile exclusion; the menu must keep showing the host's mode with the
quarantine sentence, and setting the mode again must recover), and the
standing drill above (a model-driven command raising `approval/request` in
Manual after each recovery). A quarantined session's refused turn must
arrive as the quarantine sentence in the panel, not `scheduleBusy`.

Files: `src/core/backends/musecode/sessionRecords.ts` (`approvalMode`),
`src/core/backends/musecode/MuseCodeHost.ts` (envelope seeding, fresh-token
rollback, `PermissionReviewerError` quarantine on unknown previous mode,
failed rollback and torn adoption, unit restore with a resolving gate,
quarantine gates on `sendTurn`/`steer`/`admitScheduled`),
`src/core/schedules/sessionOwner.ts` (`quarantine`, `quarantined`,
`canSteer` refuses), `src/core/agent/agentBackend.ts`
(`PermissionReviewerError`, `isPermissionReviewerError`,
`setApprovalMode` contract), `src/host/conversation/conversationController.ts`
(three catch sites keep the host's mode and show its sentence),
`src/acp/agent.ts` (`setMode` publishes before rethrowing),
`src/shared/l10n/en.ts` + all 14 `l10n/ui.*.json`
(`permissionReviewerNotInstalled`, `permissionReviewerMissing`),
`test/unit/sessionOwner.test.ts`, `test/unit/sessionRecords.test.ts`,
`CHANGELOG.md`, PLAN.md D123.

## 2026-10-19 — Grok's second re-review corrections (lane PR251FIX3B)

GRV251D found three failure-path defects in the section above, each fixed
at its cause below. The section above stands except where this one
corrects it: item 1's throw is now `ModeKeptError` (not the raw profile
refusal); item 2's "panel keeps the chosen mode" and "ACP publishes the
requested mode" hold only when the host runs the chosen mode — a torn
rollback shows the previous mode on both surfaces; item 4's torn sentence
is no longer the reviewer-not-installed sentence with `scheduleBusy`
(which was false there: the turn had ended and the restored reviewer was
still installed).

Wire facts established live in this run (pinned 1.4.7 and 1.4.4,
`serve --provider echo`, zero model calls, 2026-10-19):

- `session/setApprovalMode` with an unknown mode is refused `invalidParams`
  (`Invalid params: session/setApprovalMode params`, 1.4.7).
- `session/setPermissionProfile` without `experimentalApi` is refused
  `experimentalRequired`
  (`session/setPermissionProfile requires experimentalApi capability`, 1.4.7
  and 1.4.4 alike) while `session/setApprovalMode` succeeds: the
  deterministic stand-in for the refusal class, as in the previous run.
- 1.4.4 WITH `experimentalApi` refuses the profile switch with
  kind=`internal`
  (`permission command submit failed: session permission transition
execution is unavailable`); `methodNotFound` stays the answer only on
  hosts predating the method (SDK `ErrorKind` vocabulary, tolerated by an
  identical moved check).
- `session/resume` serves `approvalMode` on 1.4.7 (the drill asserts
  `record.approvalMode.mode === 'onRequest'`).

1. Resume, adopt and the menu show the running mode (GRV251D-1). Every
   `setApprovalMode` failure names the wire mode the host runs, including a
   rollback that succeeded: a refused mode command, or a profile step the
   rollback undoes, throws `ModeKeptError` with the running mode and turns
   stay live. `resumeAfterRestart` and `adopt` move the composer onto that
   mode (`composerModeForApprovalMode`) with the error's own sentence; when
   no menu mode selects it, the send already in flight is refused (the
   invalidation epoch is bumped) instead of showing a mode the host is not
   running. Drill D2 (start `onRequest`, resume, switch to
   `promptUnmatched` with the profile refused): failed before the fix (the
   raw refusal named nothing); after, it throws `ModeKeptError` with
   `actualMode === 'onRequest'` and the turn sends on the restored mode.
2. Both surfaces show `actualMode` (GRV251D-2). The Modes menu and ACP
   `setMode` (plus ACP `matchAdvertised`/`restoreChoice`, which had no
   failure mapping) publish the mapped running mode, not the requested one:
   a torn rollback shows the previous mode. The torn sentence is its own
   (`permissionReviewerTorn`: the running mode is unconfirmed, new turns
   refused until the mode is set again) — the old reviewer-not-installed
   sentence with `scheduleBusy` was false on that path. The drill's D1/D3
   assertions on `actualMode` cover the propagation; a bounded turn-cancel
   race probe hit a forward tear once (attempt 2 of 40: `actualMode`
   `onRequest`, the torn sentence, the next send refused with the
   reviewer-missing sentence), proving the path end to end.
3. Quarantine only on known disagreement (GRV251D-3). A thrown
   `session/setApprovalMode` that did not change the host releases its
   effect but keeps the seeded mode (`modeApplied(effect, false)` no longer
   forgets or quarantines) and never uses the reviewer sentence. Drill D1
   (bogus mode on a seeded session): failed before the fix (forgotten mode,
   quarantined, turn refused with the reviewer sentence); after, it throws
   `ModeKeptError` with `actualMode === 'onRequest'` and the turn sends.
   Drill D3 (1.4.4, profile step fails with kind=`internal`): throws
   `ModeKeptError` with `actualMode === 'onRequest'`, turns live.

Activation (owner's budget, never raised): the mode-sync orchestration
(`runSetApprovalMode`, profile sync, schedule restore, torn builder) moved
from `MuseCodeHost`'s static methods into the deferred bundle
`dist/approvalModes.js`
(`src/core/backends/musecode/approvalModesEntry.ts`, loaded on the first
mode change, schedule admission or restore; registered in
`scripts/build.mjs`, `scripts/lib/deferredBundles.mjs`,
`scripts/lib/acpBundles.mjs`, `scripts/check-bundle-size.mjs` (27 KiB,
measured 22.88 + 15% per D6), `scripts/third-party-notices.mjs`,
`scripts/cycles.json`, `src/shared/constants.ts`
(`REPORT_PACKAGE_FRAME_PATHS`), `.vscodeignore`,
`test/unit/noticesInput.test.mjs`, plus the regenerated
`src/shared/lazyBundles.generated.ts`). Activation stays identical in
behaviour; the suites driving the moved code are the drill below and
`sessionOwner`/`permissionModes`/`sessionRecords`.

Activation numbers (`test/unit/modelsActivationBudget.test.ts`, repo
timeout, `npx vitest run`, rig `linuxlt`):
`main` (`main-now` 81dacaf5a7): baseline=561352 current=564253 growth=2901
(pass). Branch before: baseline=561352 current=566559 growth=5207 (fail,
`expected 5207 to be less than or equal to 3072`). Branch after:
baseline=561352 current=565147 growth=3795 — still over the 3 KiB budget
by 723 bytes. Per-module esbuild metafile attribution (same harness, both
trees; main replicates at 564253): `MuseCodeHost.ts` +652, `sessionOwner.ts`
+148, `sessionRecords.ts` +53 (unmodified file, shaking ripple),
`constants.ts` +22 (the `dist/approvalModes.js` frame path),
`museCodeBackendManager.ts` +19 (unmodified file, ripple); every other
module, including the panel, the ACP agent, `agentBackend`,
`permissionModes` and the deferred entry itself, contributes nothing.
Swapping main's `MuseCodeHost.ts` back in (re-verified 2026-10-19)
measures current=564473 growth=3121 — still 49 over with the host change
gone entirely. The required non-host behavior alone (the owner's
release-keep contract, the packaged frame path) needs 220 of the 171 bytes
main leaves, so even a perfect zero-byte host shell cannot pass: the
budget is structurally short for these mandated fixes. No further honest
cut exists without moving every-turn hot paths behind the deferred import
or re-baselining the pre-K fixture — the lead's call; nothing was raised
or weakened to get here.

Committed tests (real code only, no stand-ins):
`test/e2e/sessionModes.live.e2e.test.ts` (env-gated `MUSE_LIVE_SESSION_MODES=1`,
never CI): three drills driving the real `MuseCodeHost`/`MuseSession`
against the pinned binaries with real refusals — D1 (GRV251D-3), D2
(GRV251D-1), D3 (kept contract on 1.4.4). D1/D2 failed on the unfixed tree
(no `ModeKeptError`, forgotten mode, quarantined turns) and pass after.
`test/unit/sessionOwner.test.ts` — a refused command releases without
forgetting or quarantining (fails on main's owner). `test/unit/permissionModes.test.ts`
— `composerModeForApprovalMode` (fails on main, which lacks it).
`test/unit/sessionRecords.test.ts` — unchanged, still green. Suites:
`sessionOwner` (2), `permissionModes` (17), `sessionRecords` (12) — 31
passed with the repository's own timeout.

UNVERIFIED until real use (lead drills, VS Code, Manual, Muse Code ≥
1.4.7): the Modes menu agreeing with the host on each failure path
(switch Manual→Auto with the profile step forced to fail, e.g. a managed
profile exclusion; the menu must show the running mode — the previous one
after a clean rollback, the chosen one when it quarantines — with the
error's own sentence, and setting the mode again must recover), the ACP
editor showing the mapped running mode on a torn rollback, and the
standing model-driven drill above. A quarantined session's refused turn
must arrive as the quarantine sentence in the panel, not `scheduleBusy`.

Files: `src/core/backends/musecode/approvalModesEntry.ts` (new),
`src/core/backends/musecode/MuseCodeHost.ts` (thin shells, torn return,
`modeOps`),
`src/core/schedules/sessionOwner.ts` (`modeApplied(false)` releases and
keeps),
`src/core/agent/agentBackend.ts` (`ModeKeptError`, `isModeKeptError`,
`SessionRecord.approvalMode`, `setApprovalMode` contract),
`src/shared/permissionModes.ts` (`composerModeForApprovalMode`),
`src/host/conversation/conversationController.ts` (`showRunningMode`,
three catch sites),
`src/acp/agent.ts` (`showRunningMode`, `syncRememberedMode`, `setMode`),
`src/shared/l10n/en.ts` + all 14 `l10n/ui.*.json`
(`permissionReviewerTorn`, `permissionReviewerUnknown`,
`permissionModeKept`),
`test/e2e/sessionModes.live.e2e.test.ts` (new),
`test/unit/sessionOwner.test.ts`, `test/unit/permissionModes.test.ts`,
`CHANGELOG.md`, PLAN.md D123.

## 2026-10-20 — Grok's third re-review corrections (lane PR251FIX4)

GRV251E confirms the GRV251D findings fixed and finds two more failure paths
whose words are not true; both are fixed at their cause below. Earlier
sections stand except where this one corrects them: the torn sentence
(`permissionReviewerTorn`, "the running mode is unconfirmed") is gone. A
forward tear names the acknowledgement's mode and says its reviewer was not
installed; a torn rollback names the previous mode and says it is restored
with its reviewer still installed. A refused schedule restore command now
quarantines (it did not), naming the admission mode the host still runs.

1. A torn adoption says the acknowledgement's mode
   (`src/core/backends/musecode/approvalModesEntry.ts`, `tornForwardError`
   / `tornRollbackError`). A torn forward adoption quarantines with
   `permissionReviewerNotInstalled` carrying `permissionReviewerTornReason`
   ("the mode change tore while applying") and the ack's mode, so the Modes
   menu and the ACP editor show that mode with a sentence that agrees with
   it. A torn rollback is replaced at the rollback site with
   `permissionReviewerRollbackTorn`: the previous mode is restored and its
   reviewer is still installed (the failed profile step never changed it),
   but the adoption could not be confirmed, so turns stay refused until the
   mode is set again. The host no longer quarantines inside `applyModeEffect`
   (`src/core/backends/musecode/MuseCodeHost.ts`): the deferred caller
   quarantines with the cause, so each quarantine keeps its sentence.
2. A refused schedule restore quarantines naming the mode the host still
   runs. `restoreScheduleEffect` wraps a thrown mode command: the host never
   changed, so it still runs the admission's mode with the admission's
   reviewer while the panel still shows the conversation's mode. It
   quarantines with `permissionRestoreRefused`, which names that mode, and
   the schedule-restore warn log ("new turns are refused") now fires only on
   a quarantined restore. `SessionOwner`
   (`src/core/schedules/sessionOwner.ts`) keeps the quarantine's sentence
   (`quarantineWith`, `quarantineCause`, both cleared with the quarantine);
   the three quarantined turn refusals (`sendTurn`, `steer`, the scheduled
   admission) repeat it instead of the generic reviewer-missing words.

No new live drill: a torn adoption needs a turn to end mid-command (the
previous run's race probe hit it once in 40 attempts — not a deterministic
test), and a schedule restore needs a schedule admission whose grant context
would be invented data. The committed proof is
`test/unit/approvalModesFailurePaths.test.ts`: the real `SessionOwner` plus
the real entry functions, with the wire side replaying the recorded 1.4.7
refusals (`invalidParams`, `experimentalRequired`, 2026-10-19 above) and the
recorded ack naming the applied mode; the tear itself comes from the real
owner's turn tracking (`observedStart`, the host's own `turnStarted` call).
Fail-before with the three pre-fix sources restored: the torn-forward test
gets the old unconfirmed-mode sentence instead of the
reviewer-not-installed one, the torn-rollback test gets it instead of the
restored-mode one (and the later refusal says the reviewer is missing), and
the restore test leaves turns live with the raw refusal escaping; green
after: 4 passed with the repository's own timeout. The clean-rollback guard
passes both ways.

Activation (`test/unit/modelsActivationBudget.test.ts`, repo timeout, rig
`linuxlt`): before baseline=561352 current=565147 growth=3795, after
baseline=561352 current=565482 growth=4130 (+335 bytes for the owner's
quarantine sentence and the three send-site fallbacks; the entry stays in
`dist/approvalModes.js`). The branch was already over the 3 KiB budget
before this lane; the release is making room elsewhere — nothing raised or
weakened to get here.

UNVERIFIED until real use (lead drills, VS Code, Manual, Muse Code ≥
1.4.7): the Modes menu agreeing with the host on a torn change (force a
turn to end mid-switch; the menu must show the ack's mode — the new mode on
a forward tear, the previous one on a torn rollback — with the sentence
above, and setting the mode again must recover), the ACP editor showing the
same on a torn rollback, and a refused schedule restore arriving as the
named-mode sentence on the next send. A quarantined session's refused turn
must arrive as the quarantine's own sentence in the panel.

Files: `src/core/backends/musecode/approvalModesEntry.ts`
(`tornForwardError`, `tornRollbackError`, restore wrap, quarantine causes),
`src/core/backends/musecode/MuseCodeHost.ts` (torn return without
quarantine, send/steer/admission repeat the cause),
`src/core/schedules/sessionOwner.ts` (`quarantineWith`, `quarantineCause`),
`src/shared/l10n/en.ts` + all 14 `l10n/ui.*.json`
(`permissionReviewerTornReason`, `permissionReviewerRollbackTorn`,
`permissionRestoreRefused`; `permissionReviewerTorn` removed),
`test/unit/approvalModesFailurePaths.test.ts` (new),
`CHANGELOG.md`, PLAN.md D123.

## 2026-10-19 — Grok's fourth re-review corrections (lane PR251FIX5)

GRV251F confirms the restore hole closed and finds three things left, each
fixed at its cause below. Earlier sections stand except where this one
corrects them: the quarantine sentence now survives the rollback's own mode
notice; tears on Plan and Bypass no longer claim a reviewer; and the proof
replays recorded frames through the real session instead of hand-written
objects.

Wire facts established live in this run (pinned 1.4.7
`/home/randy/lanes/_rig/muse-pinned/1.4.7-R6101.1/muse-bin`,
`serve --provider echo`, zero model calls, 2026-10-19,
`node temp/capture-approval-modes.mjs`, committed as
`test/fixtures/m106/msp-1.4.7-approval-modes.json`, 22 frames, 8 requests):

- An accepted `session/setApprovalMode` answers
  `{applyOutcome, commandId, effectiveMode: {mode, source, lastCommandId},
status}`: the ack echoes its `commandId` and names the mode the host runs
  (`promptUnmatched`, `denyUnmatched`, `onRequest` each recorded).
  `session/start` omits the echo, as the SDK's surface contract records.
- Here the `session/approvalModeChanged` broadcast arrives just ahead of its
  ack; the u16 trace has it the other way round (result, then the notice 5 ms
  later). Both interleavings are real: the test below replays the late one.
- An unknown mode is refused `invalidParams` (code -32602,
  `Invalid params: session/setApprovalMode params`); the profile step without
  `experimentalApi` is refused `experimentalRequired` (code -32601,
  `session/setPermissionProfile requires experimentalApi capability`).

1. A torn rollback's next send repeats the quarantine's own sentence
   (`src/core/schedules/sessionOwner.ts`, `observeMode`). The notice names
   the mode the quarantine already recorded (the rollback restored it), so
   the sentence stays; only a genuinely different mode drops it, and the
   later refusal then falls back to the generic words.
2. A tear in Plan or Bypass says what is true for that mode
   (`src/core/backends/musecode/approvalModesEntry.ts`,
   `tornUnconfirmedWords`, `permissionModeTornUnconfirmed`): the acknowledged
   mode is in effect but the adoption could not be confirmed. Those modes
   install no reviewer (`mspPermissionProfile` is `undefined`), so no tear
   there claims one failed. Manual, Edit automatically and Auto keep the
   reviewer wording, where a profile is real.
3. The proof replays the capture through the real `MuseCodeHost`/`MuseSession`
   over the real SDK `Connection` (`test/unit/approvalModesFailurePaths.test.ts`,
   rewritten): the recorded acks answer the session's own commands, the
   recorded refusals fail its profile step, the recorded broadcast arrives
   through the real dispatch path, and the test asserts the sentence the next
   `sendTurn` throws. Only the per-connection nonces (JSON-RPC id, the ack's
   `commandId` echo) are substituted; the tear is the host's own turn
   tracking for a started turn. A refused schedule restore is not replayed:
   restoring needs a schedule admission whose grant context would be invented
   data, and the re-review confirms that hole closed. Fail-before in a scratch
   clone of the pre-fix tree (9e7fa1d47a, new test and fixture checked out,
   since removed): the torn-rollback notice test gets the generic
   reviewer-missing sentence instead of the quarantine's, and the Plan test
   gets the reviewer sentence instead of the unconfirmed one (3 passed, 2
   failed); green after: 5 passed with the repository's own timeout.

Activation (`test/unit/modelsActivationBudget.test.ts`, repo timeout, rig
`linuxlt`): before baseline=561352 current=565482 growth=4130, after
baseline=561352 current=565497 growth=4145 (+15 bytes for the owner's
same-mode keep; the entry stays in `dist/approvalModes.js`). The branch was
already over the 3 KiB budget before this lane; the release is making room
elsewhere — nothing raised or weakened to get here.

UNVERIFIED until real use (lead drills, VS Code, Manual, Muse Code ≥
1.4.7): the Modes menu agreeing with the host when the rollback's notice
arrives after a torn rollback (the menu must keep showing the previous mode
with the quarantine sentence, and setting the mode again must recover), a
tear on Plan or Bypass arriving as the unconfirmed sentence on both
surfaces, and the standing model-driven drill above. A quarantined session's
refused turn must arrive as the quarantine's own sentence in the panel.

Files: `src/core/backends/musecode/approvalModesEntry.ts`
(`tornUnconfirmedWords`, both torn builders),
`src/core/schedules/sessionOwner.ts` (`observeMode` keeps the recorded
mode's sentence), `src/shared/l10n/en.ts` + all 14 `l10n/ui.*.json`
(`permissionModeTornUnconfirmed`),
`test/fixtures/m106/msp-1.4.7-approval-modes.json` (new capture),
`test/unit/approvalModesFailurePaths.test.ts` (rewritten on saved wire),
`CHANGELOG.md`, PLAN.md D123.
