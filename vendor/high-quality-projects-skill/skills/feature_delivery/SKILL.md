---
name: feature_delivery
description: Deliver scoped features and behavior changes in existing projects. Scan and enhance canonical code, clarify only the requested delta, map requirements to acceptance and tasks, verify readiness, implement with real tests and red drills, reconcile completion, and resume from current evidence. Use for adding a feature, extending behavior, implementing a scoped change, or resuming delivery. Use project_setup for a new project and quality_retrofit for a quality-only retrofit. Do not apply this full workflow to a read-only review or a simple prose-only edit.
---

# Feature delivery

Deliver the requested behavior and its verification as one complete change.
Keep the project's existing decisions, code, and documents authoritative.

## Locate and scan

Resolve this package with `scripts/skill-root.ps1` on PowerShell or
`scripts/skill-root.sh` on POSIX, using the script's actual package location.
Paths below use `${SKILL_ROOT}` for that result. Windows does not require Bash.

Run the corresponding native `detect-stack` script against the target workspace
and inspect its JSON. An `error` field blocks writes until inventory succeeds.
Record source state, including relevant existing uncommitted changes, before
modifying anything. Preserve that work; do not reset, clean, or stage unrelated
files. If overlapping changes cannot be safely reconciled, explain the exact
conflict and request only the missing decision.

If the project is actually new or empty, use `project_setup` for its product
contract before choosing a stack or writing product code.

Search by responsibility, behavior, symbols, and paths. Read canonical matches,
callers, tests, configuration, assets, existing plans, and rules before adding a
helper, dependency, document, or implementation. Record reuse decisions. Existing
source means feature delivery, not a new-project interview or unsolicited retrofit.

Read `${SKILL_ROOT}/docs/DELIVERY.md` in full. Apply the common contract and relevant
language sections of `${SKILL_ROOT}/docs/CODE-QUALITY.md`; use
`${SKILL_ROOT}/docs/RED-DRILLS.md` for failure verification. Do not duplicate those
procedures in another rules file.

## Clarify the delta and plan

1. Extract the requested outcome, compatibility constraints, known answers,
   authorization, canonical product brief, and non-goals. Ask only about a
   material unresolved choice. Do not restart discovery for settled decisions.
2. Define observable acceptance, appropriate negative/boundary cases, and stable
   identities. Keep business KPIs separate from buildable work.
3. Enhance the existing canonical plan in place. If none exists, adapt
   `${SKILL_ROOT}/templates/workflow/PLAN.md`. Replace all example facts and runtime
   values. Preserve existing IDs; do not create a competing task tracker.
4. Map every criterion to justified tasks, canonical changes, dependencies, and
   required evidence. Prefer a small complete increment over disconnected layers.
5. Record actual runtime context. For Python, the validator's `--observe-context`
   prints the current host/interpreter; independently observe any additional tool
   versions required by the project. Do not copy declared versions as observations.

Review the requirements themselves for clarity, conflicts, missing failure
behavior, scope, terminology, rules, and task coverage. Save an evidence-linked
readiness review in the project's existing report location. A requirements review
is not proof that code works. Add its receipt only after performing the review.

Use `verify-delivery.py --snapshot` to obtain current binding values; it does not
create passing evidence. Run readiness validation with the actual context and
resolve findings before implementing dependent work. If the Python 3.12+ helper
cannot run, record that gate as deferred; manual review does not turn it green.

## Implement and prove behavior

- Work on tasks whose dependencies are verified. Activate one owner for each
  change path; do not run competing edits to the same file.
- Extend canonical code and fixtures. New code needs a distinct responsibility
  or a recorded reason existing work cannot satisfy the requested contract.
- Run the real test commands and inspect actual results and discovery counts.
  No fabricated logs, copied success output, changed expectations to force green,
  zero-test success, or mock-only proof of behavior bypassed by the mock.
- Perform meaningful green/red/restored-green drills for affected behavior.
  Require the intended failure, actual changed inputs, exact restoration, and
  passing re-verification. Keep defects in disposable copies or fixtures.
- Save actual output and independent observations. Bind receipts to the current
  scope, source, rules, configuration, and environment. Batch receipts may cover
  several criteria only when the executed check actually exercises all of them.
- Mark work implemented before verification, and verified only after all
  applicable evidence passes. Keep failed/stale receipts as history and add new
  receipts after fresh checks. Never refresh hashes on an old passing claim.

## Reconcile and close

Compare every acceptance obligation with the current code and observed behavior.
Report missing, partial, contradictory, or unjustified work with its source ID,
location, severity, evidence, and next action. Inspect actual functionality even
when task statuses and structural validation are green.

Reopen or update the existing owning task. Add work only for a distinct gap;
preserve IDs and history. Repeat within authorized scope until complete or truly
blocked. If an unchanged finding recurs without progress, state what new evidence
or decision is needed. Do not silently widen scope or create an endless backlog.

Run closure validation, project quality gates, and applicable UI/security/release
checks. On an already-verified unchanged scope, reuse current evidence and leave
the plan byte-for-byte unchanged; do not append empty reviews or duplicate tasks.
Update README and changelog from shipped behavior, never from remaining intentions.

## Checkpoint and resume

Capture a complete checkpoint at verification boundaries and before handoff.
Include scoped fingerprints, verified task IDs, current context, blockers,
unresolved external outcomes, and the next safe action.

Use `update-delivery.py` with an explicit candidate and the observed plan digest
for state updates. It locks cooperating writers, checks the precondition, and
atomically replaces the plan. A lock or digest conflict requires re-observation;
never force an overwrite. Do not automatically remove an existing lock. Verify
its owner has stopped and inspect the last complete plan before resolving it.

On resume, rescan current source and run resume validation. Re-evaluate changed
requirements, prerequisite contracts, rules, configuration, or tool context.
Invalidate affected evidence and re-run its checks; preserve unaffected evidence.
Observe unknown external outcomes before taking further action. Never blindly
replay deployment, deletion, payment, messaging, or other consequential operations.

## Completion report

State delivered behavior, canonical paths enhanced, justified new code, readiness
and acceptance coverage, actual test/red-drill results, documentation changes,
remaining blockers, and the next action. Name skipped or deferred checks and
their impact. Validator success is a structural/evidence result, not a substitute
for semantic review or proof of production behavior.
