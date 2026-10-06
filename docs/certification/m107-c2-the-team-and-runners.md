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

## Red/restored drills

All **28** deliberate mutations ran a complete owning file directly with
`npx vitest run <file> --maxWorkers=3 --reporter=json --outputFile=<scratch>`
and the repository default timeout. Each exited **1** with the named
failure below; no test filter, skip, timeout, gate or threshold changed.
Every source was restored in `finally` from saved bytes and verified
SHA-256-identical after each mutation. The check-kind mutation also
deadlocks an intentionally misclassified check until the default test
timeout; the parent test below fails directly on same-kind refusal.
The removed initial child preflight also leaves an expected unhandled
refusal in the deliberately broken implementation; its named assertion
fails before accepting the impossible wait. Neither outcome remains after
restoration.

| Mutation                                     | Named failing test                                                                    |
| -------------------------------------------- | ------------------------------------------------------------------------------------- |
| Ignore the existing configured cap           | preserves existing caps at normal and narrows them at throttle without widening zero  |
| Accept an already full scheduler             | preserves existing caps at normal and narrows them at throttle without widening zero  |
| Block normal available capacity              | preserves existing caps at normal and narrows them at throttle without widening zero  |
| Treat unknown registry occupancy as free     | refuses unknown or occupied registry counts even when scheduler slots are free        |
| Accept the registry capacity boundary        | refuses unknown or occupied registry counts even when scheduler slots are free        |
| Reverse the eligible picker order            | preserves eligible-task order while allowing another kind past a busy worker          |
| Change team admission to foreground          | runs one background item per kind and keeps priority/FIFO order through recovery      |
| Remove preflight before waiting              | refuses a delegating parent before it waits on all existing scheduler slots at normal |
| Remove preflight after governor admission    | rechecks child preflight after governor waiting and releases a rejected reservation   |
| Remove the pre-acquisition abort check       | honors a caller abort before local acquisition begins                                 |
| Remove the post-acquisition abort check      | cleans up both slots when cancellation races a cancellation-ignoring acquisition      |
| Keep a rejected admission reservation        | rechecks child preflight after governor waiting and releases a rejected reservation   |
| Release a retired slot twice                 | retains granted occupancy after cancel and releases it only once on retirement        |
| Keep the permit after scheduler release      | runs one background item per kind and keeps priority/FIFO order through recovery      |
| Do not abort pending local acquisition       | cleans up both slots when cancellation races a cancellation-ignoring acquisition      |
| Do not cancel queued work                    | cancels queued background work immediately at pause without acquiring a slot          |
| Drop the registry retirement callback        | attaches the exact reserved permit before launch and retains root-exit uncertainty    |
| Keep the reservation after failed binding    | releases a failed registry attachment before any process can spawn                    |
| Propose relocation for a running attempt     | leaves running attempts alone even at pause                                           |
| Ignore Keep here                             | honors Keep here without consulting runners                                           |
| Ignore relocation off                        | does no runner activity with relocation off                                           |
| Consult runners at normal                    | leaves normal routing unchanged without consulting runners                            |
| Consult runners at throttle                  | leaves throttle routing unchanged without consulting runners                          |
| Return a proposal without an approved runner | marks Ask as a confirmation proposal and never turns a missing runner into success    |
| Remove Ask confirmation                      | marks Ask as a confirmation proposal and never turns a missing runner into success    |
| Charge heavy checks to the worker kind       | passes the exact parent and refuses same-kind child waiting at throttle               |
| Drop the exact check parent permit           | passes the exact parent and refuses same-kind child waiting at throttle               |
| Disable runner proposals at relocate/pause   | proposes only an already approved matching runner at relocate                         |

Saved/restored production hashes, also unchanged from the early code commit:

- `src/core/runners/routing.ts`: `9b58a25f89df7ed4052970c66c6e064e3acd015cab300e4e1302b99c5bca4fa6`
- `src/core/team/scheduler/pick.ts`: `fad5cac42e24185497e122ac7eb0ffaa21af42ae22dd18853f17e45d4e1d573e`
- `src/core/team/scheduler/slots.ts`: `e3575dc284698915fd5da0ec7d4c896c4b975aa8d5274c9593f9f2fa0dc54d94`
- `src/host/team/checkSlots.ts`: `a758121c5b25f64f192fea507b75e9590282d364073a1615b21b5639dede40ee`
- `src/host/team/processLifetime.ts`: `c4db5b993d2271fe819e5ccbafe01b01a36de8886a84b4e2e26f9bcf0a9cee35`

The post-commit assertion refinements check queue occupancy immediately
after cleanup, so the release/cancel drills fail promptly on an assertion
instead of depending on a subsequent pending admission timing out. No
production behavior changed after the first commit. `SchedulerSlotPort`
preflight must be read-only: M96c owns child reservations made at delegate;
its acquire method atomically consumes the existing/reserved slot and obeys
the supplied cancellation signal. No second reservation in preflight.

The first duplication run found a 14-line clone of C1's general healthy
reading in the new test helper. C2 tests now supply only their scripted
memory readings and leave other metrics unknown, rather than copying a
whole-machine healthy scenario. This also exercises capacity changes while
other readings are unknown. The next duplication run has **1,243 files,
zero clones**, exit 0, with no ignore/threshold change. The complete owning
coverage run remains **24/24, 100%** in every dimension. All 28 drills are
repeated against the final fixture and restore the same production hashes.

## Scoped delivery checks (Kubuntu)

| Check                                                        | Result                                                                                                                                      |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run typecheck`                                          | All five projects exit 0; later async/style and final fixture edits receive fresh unit-project checks, which include the production sources |
| Scoped ESLint on all nine source/test/helper files           | Exit 0, zero warnings                                                                                                                       |
| `npm run deadcode`                                           | Exit 0; only the unchanged vendor/axe-core configuration hints                                                                              |
| `npx jscpd`                                                  | Exit 0 after the fixture correction; 1,243 files, zero clones                                                                               |
| `node scripts/check-l10n.mjs`                                | Exit 0; 14 tables, 164 manifest strings, 639 source files, zero problems                                                                    |
| `npm run check:host-api`                                     | Exit 0; 336 VS Code APIs, 32 vscode importers, 26 Node built-ins, 61 theme variables, zero problems; inventory not edited                   |
| `npm run cycles -- <C2 picker/check/lifetime/routing roots>` | Exit 0; repository roots plus all C2 modules, 598 files, no cycle                                                                           |
| `npm run build`                                              | Exit 0; existing artifact caps, bundle/model-text split, host globals and 83-package notices all pass                                       |

Measured production sizes (KiB): extension **446.2/600**, Model API
**449.4/475**, checkpoint store **77.3/225**, ACP **837.9/850**, shared
English **48.7/125**, startup webview **894.8/900** and deferred webview
JavaScript **49.7/50**. The existing resource governor is **61.0** and its
admission shim **1.5**; this base has no dedicated size-gate row for those
two artifacts. Their final budget remains W's existing ownership. No cap
or build graph changes in C2. The absent M96 team bundle's incremental
size must be measured when its ports are joined.

C2 is staged against the missing M96/M96c dependency, so these modules
are not claimed as shipped behavior. Build metafiles confirm none is in
the current shipping graph; there is no new activation/webview import.
The full `npm run quality`, native/editor matrix, fifteen-heavy-check
responsiveness/second-window measurements, joined single-model goldens,
M96 load-guard removal/caller replacement, hints, registry attachment and
R dispatch/surfaces remain the named lead/W/dependency handoffs above.
The lane brief forbids aggregate quality and other-lane edits here.
No failing scoped gate, threshold waiver or production fake is accepted.

## Final restored receipt

The early code commit is **637448a3d**, with ordinary serial lint-staged
and staged redacted gitleaks (29.92 KB, zero leaks). Only this record and
the two test assertion/fixture files change in the finishing commit.
All five production hashes above remain identical to that code commit.
The repeated 28-drill run exits 1 for every mutation and restores each file;
the final complete restored coverage run exits **0**, **24/24 tests**, with
the repository's default timeout and **100%** statements, branches,
functions and lines. The fresh final unit-project compiler and scoped
ESLint exit 0; explicit-path Prettier and `git diff --check` pass. Shipping
metafile inspection finds **zero C2 inputs across 38 metafiles**.
The finishing explicit-path commit uses the repository's unmodified hooks.

## FIXM107C2 — RVM107C2 repair (2026-10-06, Kubuntu)

Repair starts from reviewed HEAD `7c9dd73bc`. The code, regressions, plan,
changelog and first receipts are committed as **bf00e5c73**, with hooks on.

Review `RVM107C2.report.md` reports one P2 and no P1/P3. The P2 is fixed:
`GovernedTeamSlots` now requires the same live `TeamCapacityPort` used by
the picker and calls `isResourceSlotAvailable` after local acquisition
returns, before it returns runnable work. The port reads the queue's same
governor/registry, existing configured caps and current scheduler occupancy.
The helper excludes exactly the current acquired local reservation, clamps
the result at zero and still refuses unknown registry occupancy. All worker
and heavy-check admissions use this single path; the picker uses the same
helper without a held reservation.

When capacity has fallen, both unstarted reservations are released before
the same request re-enters the governor queue. Its kind, priority, exact
parent and combined cancellation signal are preserved. Child preflight
runs again on each acquired governor permit; a same-kind child made
impossible by throttle is refused instead of waiting on its parent. No
running slot or registry tree is retired because the capacity fell. The
final returned permit is the exact renewed governor reservation, ready for
the existing C1/T attachment handoff.

Before changing production code, the full owning slot file ran with the
three capacity-transition cases added. It exited **1**, with **13 existing
tests passing and 3 regressions failing**: worker/check at pause returned a
runnable slot, and the two workers at throttle both became runnable. The
fixture counts local reservations explicitly; it introduces no production
scheduler or new dependency. The added cancellation/child cases also fail
under the final guard drill below.

| Finding / case                                                | Status    | Regression in `teamResourceSlots.test.ts`                                                                         | Red drill                                                                              |
| ------------------------------------------------------------- | --------- | ----------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| P2: capacity falls to pause during worker/check local waiting | Fixed     | `rechecks pause after a worker/check waits for a local slot and releases both unstarted reservations` (two cases) | Bypass the final live helper: both fail with a runnable slot at pause                  |
| P2: capacity falls to one while two workers wait              | Fixed     | `rechecks throttle after two workers wait for local slots and admits at most one`                                 | Bypass the helper, or exclude two local reservations: two workers become runnable      |
| Requeued cancellation retains no unstarted reservation        | Preserved | `cancels work requeued after local acquisition without holding either reservation`                                | Bypass the helper: the work never requeues                                             |
| Reduced capacity makes a same-kind child impossible           | Preserved | `refuses a same-kind child made impossible while local acquisition waits`                                         | Bypass the helper, or exclude two reservations: the child resolves instead of refusing |

Two deliberate production mutations ran the **complete 18-test owning
file**, with default repository timeouts and no filter/skip. Bypassing
`isResourceSlotAvailable` at final admission exited **1**, failing all five
new cases while the 13 existing tests passed. Subtracting two reservations
instead of only the acquired slot exited **1**, failing the throttle and
same-kind child cases while 16 tests passed. Both mutations restored the
saved source bytes in `finally` and verified the same SHA-256:
`3589865fbfa5e3ac9ed1cd93b96315744523ce28e88f2140c301ecd7ca0d7007`.
These are additional review-repair receipts; the original 28 drills and
their historical production hashes above remain their original receipts.

The restored three owning suites pass **29/29** with default timeouts.
Scoped V8 coverage on all five C2 production modules passes unchanged
thresholds with **100% statements (60/60), branches (30/30), functions
(12/12), and lines (55/55)**. `npm run typecheck` passes all five projects;
scoped ESLint passes with no warnings. No suppression, cast escape hatch,
new user text, wire shape, setting, command or dependency is added.
The existing `.husky/_/pre-commit` launcher is present; commits use the
unmodified serial lint-staged and staged redacted gitleaks hooks.

No reviewed P2/P3 remains. The named **M107-C2-live-capacity-binding**
residual in PLAN §9 carries the existing unshipped M96/M96c and C1/T joins:
M96c/W must bind the required live capacity port including the acquired
local reservation, then certify fairness, child rules, dispatch, all-editor
responsiveness and bundle costs in production. The rig brief overrides
common.md's historical merge step and prohibits full `npm run quality`;
the integration lead retains that gate. No merge, push, rebase, credential,
live/paid call, external message, install or other-lane change occurred.

### Review-repair final scoped gate receipts

Every check below ran directly on Kubuntu, serially with respect to
Vitest/compiler/ESLint/build work. No repository timeout or gate changed.
The final restored coverage run remains **29/29**, with the repository's
default per-test timeout and the 100% coverage counts above. All eight
post-commit scoped delivery commands below exit **0**; the full five-project
compiler also passed before the code commit.

| Check                                                               | Receipt                                                                                                 |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `npm run typecheck`; fresh final `npm run typecheck:unit`           | All five projects pass; final unit compiler includes the production adapter and updated tests           |
| `npx eslint --max-warnings=0` on the three changed TypeScript files | Zero warnings/errors; no suppression                                                                    |
| `npx prettier --check` on all six changed files; `git diff --check` | Pass                                                                                                    |
| `npm run deadcode`                                                  | Pass; only the same vendor/axe-core configuration hints                                                 |
| `npx jscpd`                                                         | 1,243 files, zero clones                                                                                |
| `npm run check:l10n`                                                | 14 tables, 164 manifest strings, 639 source files, zero problems                                        |
| `npm run check:host-api`                                            | 336 APIs, 32 VS Code importers, 26 Node built-ins, 61 theme variables, zero problems; no inventory edit |
| `npm run build`                                                     | All existing caps, model-text/bundle splits, host globals and 83-package notices pass                   |
| Normal code-commit hooks                                            | Serial lint-staged passes; staged redacted gitleaks scans 14.89 KB, zero leaks                          |

Production sizes remain extension **446.2/600 KiB**, Model API
**449.4/475**, ACP **837.9/850**, checkpoint store **77.3/225**, shared
English **48.7/125**, startup webview **894.8/900** and deferred JavaScript
**49.7/50**. Governor **61.0 KiB** and its admission shim **1.5 KiB** retain
their existing W-owned final budget handoff. Fresh production metafile
inspection, normalizing Windows separators before comparisons, finds
**zero C2 shipping inputs across all 39 metafiles**, including ACP.
The required live capacity/registry port therefore remains a qualified
integration handoff, not a claim of joined shipped behavior. The final
receipt-only commit again uses explicit paths and unmodified hooks.
