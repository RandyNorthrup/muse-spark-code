# M107 C2 — team and runners

Worktree `/home/randy/lanes/M107C2`, branch `m107/c2`, base `c8bdf35fc`.
Read the rig brief, shared `codex/common.md`, AGENTS, D87 and M107,
lane 0/G/platform/strings records and the M100 research's M96c safety
lessons. Direct Kubuntu checks use the repository's default test timeout.
No merge, push, rebase, credentials, live/paid model calls or dependency.
The explicit lane brief overrides common.md's historical merge step and
leaves aggregate quality to the lead.

## Scope and dependency plan

This base has none of `src/host/team`, `src/core/team`, `src/core/runners`,
M96's launcher/load guard/callers or M96c's slots/picker/check runner.
The brief explicitly directs building against injected ports when another
milestone's dependency is absent. Implement only C2's governor adapters in
its five named surviving paths, never a replacement M96 scheduler, launcher
or runner. `loadGuard.ts` is already absent; there is no caller to remove.

- Filter M96c's already eligible/fairly ordered local work by G's capacity.
  Preserve configured caps and conservatively refuse unknown occupancy.
- Add G's priority/FIFO queue before the injected M96c slot acquisition.
  Preserve M96c child preflight before waiting and recheck after admission.
  Keep the exact parent permit; cancellation never releases running work.
- Checks share this adapter under `check`, workers under `worker`.
- Attach the admitted permit to the registry before durable intent/spawn,
  using an injected required binding instead of another governor/sampler.
- Supply runner preferences only for queued checks at relocate/pause and
  only through M96c's approved-runner selector. Running attempts, Keep here,
  relocation off and normal/throttle leave routing unchanged. Ask is an
  explicit confirmation proposal; this adapter never dispatches anything.

No startup import/bundle, new UI, user-facing text, command, setting, wire
shape, cast escape hatch, dependency or gate change is needed. Technical
diagnostics remain internal. W owns joined PLAN/CHANGELOG/help-reference
and final delivery docs; this record carries those exact handoffs below.

## Named integration handoffs

- **C2–M96c picker/slots:** call `pickResourceReady` after existing readiness,
  scoring, aging and fair-share ordering, only for local candidates. Supply
  configured caps, scheduler occupancy including reservations, G's live
  capacity and T's background counts (null when unknown). Bind
  `SchedulerSlotPort` to M96c's child reservation/preflight and slot queue;
  acquire must honor cancellation and refuse newly impossible child waits.
- **C2–C1/T reserved registration:** supply `TeamProcessRegistryPort.attach`
  from the same process's G queue/lifetime owner. It must attach the exact
  already held permit, never re-admit, and invoke `onRetired` only after a
  failed spawn or registry-proved whole-tree retirement. C1's current
  `ResourceLaunchHost.admit` exposes no attach-reserved-permit operation;
  this join requires C1/W ownership and is not fabricated here.
- **C2–M96 K launcher:** call `prepareTeamProcess` before the existing
  durable intent and spawn; register the job/dedicated group through its
  returned lease. Root exit calls `complete(false)`, failed spawn or proved
  whole-tree retirement calls `complete(true)`. Stop/kill use the lease
  directly, outside admission. Keep K's journaling, identity proof,
  configured priority and delegated controls. Remove its old load guard
  and bind hints to G's level when that dependency is joined.
- **C2–M96c checks/R:** bind `requestCheckSlot` and consume
  `resourceRunnerPreference` within existing authorized SSH routing. R must
  recheck runner approval/admission, confirm Ask, honor Keep here until
  admission and publish the existing row/notice/Traffic/journal evidence.
  A running check still requires explicit Move to and proved retirement.
- **C2–W delivery:** join M96/M96c, the ports above and their single-model
  goldens; update CHANGELOG/PLAN/help reference with actual shipped behavior.
  These portable adapters have no VS Code imports and can serve every
  editor/runtime. No installed-editor or completed production-binding
  claim is made on this dependency-incomplete base.

Validation and byte-exact red/restored drill receipts follow as executed.

## First-piece verification

The three new owning suites pass **24/24 tests** with the repository's
default timeout, including priority/FIFO recovery, one item per kind,
pause, existing caps, unknown registry occupancy, both child-slot rules,
pre/post-acquisition cancellation, cancellation-ignoring acquisition,
root-exit uncertainty, failed launch/binding and runner proposal controls.
Scoped V8 coverage of all five C2 modules passes the unchanged thresholds:
**100% statements (54/54), branches (23/23), functions (12/12) and lines
(49/49)**. All five projects in `npm run typecheck` exit 0; scoped ESLint
exits 0 with no warnings after correcting its ordinary naming/await/style
findings. No lint suppression or gate change was added.

One initial test fixture attempted renewed throttle inside the governor's
minimum dwell after Resume now; advancing the fake clock by the existing
`RESOURCE_MIN_DWELL_MS` fixes the fixture. No production timing change or
raised test timeout. The final async/style edits received the complete
owning coverage run above and a fresh unit-project compiler check before
the early hooked commit. Guard drills and aggregate scoped gate receipts
are recorded in the next piece.
