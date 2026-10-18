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
