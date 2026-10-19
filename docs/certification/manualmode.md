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
