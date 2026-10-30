# RLF-ACPHONEST: what the ACP agent tells editors is true (RLF-HARVEST B2, B3, B5)

Branch `rec/rlf-acphonest`, worktree `/Users/randy/lanes/RLF-ACPHONEST`
(rig `macmini`), base `int/recovery` b781451b94 plus the harvest's fixes.
Built 2026-10-30 against Muse Code CLI 1.4.11 (`1.4.11-R6667.1`) and
`@muse-code/sdk` 1.4.11. Every capture below is recorded live with zero
model calls unless named; every suite runs real code only.

## B2 — ACP editors hear the mode Muse Code actually runs (H6)

`src/acp/agent.ts` maps each `approvalModeChanged` wire word through
`composerModeForApprovalMode`: the echo of the client's own set is one
info line (`Muse Code runs approval mode …`); a move the CLI made on its
own (ceiling, managed policy, or a set whose broadcast wins the race
against its own acknowledgement) keeps the warn and sends
`current_mode_update` plus refreshed config options, so the editor shows
the running mode. An unmapped wire word warns only.

Suites: `test/unit/acpApprovalModeChanged.test.ts` (2 tests) over the
1.4.11 echo capture (`test/fixtures/acphonest/`, provenance in
`provenance.json`; `model/list` stitched from the 1.4.7 echo capture
because 1.4.11 serves the echo catalogue empty). Red/green: forcing the
echo down the warn path fails 1/2; removing the moved-branch sends fails
1/2; restored, 2/2 green.

Packed product (`muse-spark-code-acp-0.19.0-darwin-x64.tgz`, real
`muse serve --provider echo`, scripted editor): before
(`temp/caps/b2-before.json`), both sets' echoes warn
(`now runs approval mode promptUnmatched`, `now runs approval mode
denyUnmatched`) and the client gets 4 updates; after
(`temp/caps/b2-final.json`), the acceptEdits echo is info, the plan
broadcast (which won the race against its own ack, so the editor still
showed acceptEdits while the CLI ran denyUnmatched) warns once and the
client gets 6 updates ending in `current_mode_update plan` with the
refreshed mode option. Per-step warn counts stay 0/1; the behaviour
change is the info line and the two extra updates.

## B3 — Shutdown honesty (H7, H8)

Measured first, in the packed product: four one-turn runs on
`muse-spark-1.3-contributor` (see Model calls below). Runs 1–3 ended
with no durable tool call (the lane sandbox breaks `sandbox-exec`, exit
71; run 4 passed the CLI-documented `--disable-sandbox` in an empty
scratch workspace running `sleep` only). Run 4 backgrounded a real
`sleep 120` tool, then the before-bits `dispose()` released the session
while the host stayed up: the session journal
(`01a18ea3-9907-7bf2-af14-7e1b8b0b2a9f`) shows NO terminal fold for the
tool until host death ~4 s later (`item/completed` at 21:07:48.597Z,
`cancelled by runtime client` — the death's attribution, not the
stop's). Before-bits verdict: `task/stopAll` is sent but never settled,
and the task survives the dispose window. A zero-call resume of the
frozen session afterwards lists `tasks: []`.

Built (`src/core/backends/musecode/MuseCodeHost.ts`): `dispose()` now
settles `stopAllTasks()` before the handle is forgotten (deafened at
once, as before); a release on a dead or closing host sends nothing and
says one info line; a failed stop warns with the failure's kind via
`causeForLog`; a close that won the race stays at trace; a surface
re-adopted mid-settle gets a fresh handle whose untrack cannot evict it;
`close()` says the abandonment once, with the count
(`Closing the host releases N held session(s) …`). The ACP
`an update was not sent` warn keeps `causeForLog` (its machine code is
the kind a bare name would lose). The H8 site is
`resourceFailureReporter` (`src/runtime/resources/text.ts`), which now
names the reading and the cause (`resourceUnavailableWhy`, already in
all 15 tables).

Suites: `test/unit/musecodeDispose.test.ts` (7),
`test/unit/resourceFailureReporter.test.ts` (4),
`test/unit/acpUpdateNotSent.test.ts` (1). Red/green: removing the
release guard fails 1; the plain reporter line fails 2; the singular
close wording fails 1; restored, all green.

Packed phase0 (zero model calls, echo): before
(`temp/caps/b3-before-0.json`), a dead-host dispose warns
`task/stopAll … failed: Cancelled`; after (`temp/caps/b3-final-0.json`)
that warn is gone, the close says
`Closing the host releases 1 held session without stopping their
background tasks`, and the surviving session still answers
(`bSurvived: true`). `npm run check:catches`: no count rise.

OPEN — the after-bits one-turn drill (a session end with a running
background task showing the task stopped) needs 1 model request; the
lane's budget of 4 is spent (see below). Ask the lead for +1, or accept
the echo ordering suites as the after-proof.

## B5 — The session lifecycle reader (H10)

Built (`src/core/backends/musecode/lifecycle.ts`, new):
`MuseCodeLifecycleReader` parses `session/started` through the shared
session-record schema (the envelope matches `session/listChanged`,
proven by `test/fixtures/m127/note-session-started-1.4.9.json` and
`test/fixtures/acphonest/note-session-started-1.4.11.json`) and is bound
in `NATIVE_MUSE_CODE_FEATURE_PORTS`, so both the VS Code manager and the
ACP runtime supply it. A started session reaches `onSessionListEvent`
as `{ type: 'changed', record }` with no re-list; the VS Code
controller's existing handler posts the list, so the row appears without
a reload. The `MSP session/started is not shown by this extension` info
line is gone everywhere the reader is bound.

Delete stays refused, honestly: `parseDeleteAdmission` is now optional
on the interface and absent on the native reader, and `deleteSession`
refuses with `sessionDeleteUnsupported` before sending while it is
absent (`isDeleteCapableReader`). No delete frame was ever captured
from a served CLI — `session/delete` is refused `-32601 methodNotFound`
on 1.4.11 (`session-delete-1.4.11.json`), the m106 captures carry no
`deleteCompleted` frame, and the CLI removed delete in 1.4.4 — so there
is nothing to parse, only the refusal to keep. A `deleteCompleted`
notice refuses by name (`LifecycleDeleteUnreadableError`), never a bare
`Error`. The delete gate's version table is untouched.

Suites: `test/unit/musecodeLifecycle.test.ts` (8),
`test/unit/museCodeNativeBinding.test.ts` (3, re-pinned to the started
reader with no admission parser), `test/unit/sessionDelete.test.ts`
(12, green unchanged). Red/green: breaking the started match fails 3/8;
a guard that sends despite the absent parser fails 1/8; restored, all
green.

Packed product (zero model calls): `temp/caps/b5-final.json` —
`listSawStartWithoutRelist: true`, `sessionStartedNotShown: false`,
`deleteRefusal: "Muse Code 1.4.11 cannot delete conversations."`,
`errors: []`. The agent drill (`temp/caps/b2-final.json`, production
construction) no longer logs the not-shown line.

NOT PROVEN — the brief's second-client drill and end-to-end delete are
impossible on CLI 1.4.11, measured, not assumed: `muse serve` is stdio
with a single client ("The client owns this process's stdin and stdout
and is its only connection"), and two `serve` processes on one scratch
home notify each other of nothing (`temp/caps/twohost.mjs`: A heard
`[]` when B started a session; A lists it only on re-read). The
started-reader half above is the shippable part; delete needs a CLI
that serves it (1.4.0–1.4.3, per the gate table), which no rig has.
The brief's Windows confirmation is likewise open; this lane ran on
macmini (darwin) and hosted CI owns the Windows run.

## Shared test rig

`test/unit/helpers/acpReplayRig.ts` (new): one real-agent-over-replay
helper (`startAcpReplayRig`, `createReplayAgent`,
`withReplayEditorSession`, `flushReplayBackend`). `startLiveHost`
grew scripted captures (`LiveHostOptions`). The B2, dispose and
lifecycle suites and the pre-existing `sessionTitles` suite all run on
it; `npm run duplication` reports 0 clones.

## Model calls

4 requests, all `muse-spark-1.3-contributor` on the meta provider, $0
contributor tier, empty scratch workspaces — the brief's cap, reached on
the before-bits measurement. Counted afterwards from Muse Code's own
session records (`runtime.user_intent.accepted` × 1 and
`model_id: muse-spark-1.3-contributor` in each):

- `01a18e9a-c57e-7a00-9dfa-a6117640d664` (run 1, no durable tool)
- `01a18e9a-5d76-7953-af35-b4afe794a6cb` (run 2, no durable tool)
- `01a18e9c-3594-79d1-bc79-e425179c2374` (run 3, no durable tool)
- `01a18ea3-9907-7bf2-af14-7e1b8b0b2a9f` (run 4, backgrounded `sleep 120`)

plus `01a18ea3-d96d-…` (run 4's second session, started, no turn, no
model use). No other model id appears in any drill record.

## Gates

prettier/eslint on touched files 0; `typecheck` 0; `check-l10n` 0;
`check:reference` 0; `check:host-api` 0; `check:plan` 0;
`check:roadmap` 0 (after `roadmap:generate`); `check:catches` 0 (no
rise); `duplication` 0 clones; `cycles` 0; `deadcode` 0; `build` 0
(all budgets hold); touched suites plus `vitest related` on all seven
changed sources, green with the repository's own timeouts (see below).

## Commits

- `7a9898f0c` B2: editors hear the approval mode Muse Code runs
- `dfbcb5250` B3: orderly release, named failure kinds, named causes
- `a5da41bc3` B3: the host-close line counts its sessions
- `9f793e81a` the replay rig imports PermissionMode from constants
- `3178a4c4f` B5: the started lifecycle reader; delete stays refused
- `f0788829b` one shared replay rig for the ACP suites
- (records) PLAN §6, CHANGELOG, roadmap entry, this record
