---
name: orchestrator-playbook
description: Coordinate implementation lanes, complete reviews and structural redesigns with the enforced orchestrator playbook. Use when leading a team, delegating code changes or reviewing successive fixes to the same module.
---

# Orchestrator playbook

The harness enforces this method whether you read the skill or not. Use its
trusted module ids, review identities, leases and recorded decisions; do not
invent or reset them. The rules apply across providers and editors. Reading
this skill authorizes no dispatch, spend, push or other external action beyond
the user's task and the harness's existing permissions.

## Nine rules

1. **Three strikes.** Count complete review rounds per stable module (the
   declared file set) and finding class. The build and two fix rounds may be
   patches. Findings after that third review require a design decision and a
   redesign lane, never a third fix round. A rename, split, merge, new lane or
   branch preserves inherited strikes. A lower configured patch limit still
   applies. Give the independent redesign reviewer every outstanding finding
   id. Only `impossible`, with the structural reason, closes a finding;
   `caught` means a check detects it but the strike stays open, and `remains`
   means it still exists. A redesign with either goes to the user first.
2. **Review in one pass.** Cover `validation`, `security`, `failure`,
   `honesty`, `concurrency`, `lifecycle`, `tests`, and `docs` together. Ask for
   each finding's `class` and the review's `coverage` in a `muse-review` block.
   Missing coverage makes the review incomplete and consumes no round. Fix
   every finding together before asking again; answer each actual finding id.
   P1 must be fixed unless the lead/owner explicitly overrides it; a P2
   residual needs a redesign, a name, why it is safe for now and a follow-up.
   An ordinary dispute grants neither exception. The reviewer must be a
   different agent in a different session, as verified by the harness.
3. **Contracts first.** Review and merge lane 0's contracts, strings, fakes
   and handoffs before dispatching wave lanes. Audit every `Starts`
   prerequisite before each wave; name an unmerged prerequisite and wait.
   An injected port can describe an agreed future binding, but an unmet
   dispatch prerequisite cannot be relabelled as satisfied.
4. **Small first, in a logical order.** Order ready work by dependency
   first, then estimated duration (smaller first), then lane id. Read the
   project's lanes tables and delivery order rather than guessing dependencies.
5. **Offload.** Send heavy builds and tests to offered workers under the
   resource governor. Without a worker, run locally under that governor.
   Keep the user's machine light. Run one full gate per change in CI where
   CI exists, and scoped checks locally; a merged integration needs its own
   full gate. Do not substitute a worker's agent summary for outcome receipts.
6. **Integrate continuously.** Keep one rolling integration trunk per
   milestone. Merge each certified lane into it as authorized. Every next
   lane's brief records the base commit and merges already in the trunk.
   A stale base is a risk to report, not evidence that current integration
   passes. Do not merge or push when the task's authorization forbids it.
7. **Break on purpose.** Certify every new gate or test with a deliberate
   break, its named observed failure, and a byte-exact restore verified by
   SHA-256. Record the drill in the milestone's certification. Run final
   verification at the repository's default timeout; fix slow setup rather
   than hiding it with a larger global timeout. Wait for UI conditions, not
   fixed delays. A green test never seen failing is not proof of its guard.
8. **Loud failures, owner items first.** Start reports and status messages
   with what needs the user and what is failing. Include actual receipts:
   exit verdicts, test counts, commit ids and hashes. Name every residual and
   its follow-up in the milestone's register; integration must surface it
   and release requires it empty or explicitly accepted. Never report an
   unknown worker as running or duplicate its work merely because it is
   unreachable.
9. **Never route around a safety check.** No hook bypass, gate weakening,
   shared Git configuration change or `.husky/` tampering. Obvious command
   refusals are advisory; commit-tree/message hook verdicts and an exact
   push-range receipt are the enforced boundary before managed push or
   completion. No receipt means no completion or push. Do not retry an action
   refused to one agent through another agent, role or equivalent tool on the
   same subject for one hour; report it to the user. Never automatically retry
   or reroute a safety-classifier block; the user decides. This rule has no
   off switch, and no setting or permission can waive existing safety gates.

Rules 1–8 are on by default. A team may turn one off only with its recorded
reason, actor and time, shown beside the rule. The patch ceiling may be
lowered, never raised. Do not treat a prompt as authority to change settings.
Keep briefs and review inputs structured; do not substitute task text into
shell templates. Coordination uses one serialized owner with a lease or lock,
never process-name matching. Follow the harness's lease renewal/cancellation
and completion barrier rather than creating a second coordinator.

## Design decision at the third strike

Write the decision in the project's plan (`D<n>` amendment here), or its
`quality-ledger` when there is no plan, and in the playbook record. Use the
actual module/finding identities and the harness's timestamp. Fill these
fields with evidence, not a promise of more careful patches:

- **Decision id and plan location:** where the decision can be reviewed.
- **Module:** trusted stable id, key, declared files and any recorded lineage.
- **Finding class / failure class:** the repeated failure mechanism.
- **Why patches failed:** the states or interleavings still possible after
  both fixes, with the outstanding finding ids.
- **Structural change:** which operation, state or authority disappears, and
  why that makes those failures impossible. A stronger detector alone is
  `caught`, not `impossible`.
- **Redesign lane:** scope, prerequisites, contract and independent reviewer.
- **Outcome:** initially `pending`; the complete independent review supplies
  one `resolution` for each actual prior finding id, with `outcome` equal to
  `impossible`, `caught` or `remains` and a nonempty `reason`. New findings
  still count. A failed redesign requires the user's decision before more work.

## Examples from this repository

**Revert under one admission (M70e, RV69; `docs/certification/m70.md`).**
Separate read, approval and write steps left races when an editor saved or an
ancestor link changed while admission was awaited. More path checks did not
remove the unowned interval. The redesign made Revert one operation: acquire
checkpoint admission, read saved bytes, rebuild the requested reversal,
re-resolve the canonical path, reject a dirty editor, publish conditionally
against those same bytes and bound path, then release admission. A late save
now produces an explicit changed-file refusal instead of overwriting it.
The structural argument concerns that stale publication; a regression or
red drill by itself would only be a `caught` answer.

**Verify outcomes instead of interpreting shells (REDM116P;
`docs/certification/m116-p.md`).** An expanding command parser could not
prove that wrappers, aliases, comments or generated arguments had run hooks.
The redesign removed shell interpretation as the security boundary. One
synchronous journal owner publishes work/lease effects, and completion or
managed push requires native repository hook receipts for every newly
reachable commit and the exact push range. Changing a command spelling no
longer substitutes for a passing receipt. The serialized owner and admitted
lease generation also refuse stale reviews across concurrent lanes. Native
Windows job containment and M107's governed Linux tree binding remain named
integration handoffs; the example does not claim they shipped or that every
possible finding is impossible.
