# Native delivery contract

Use this contract for scoped feature work, setup handoffs, and quality
retrofits. The workflow, schema, and validator are first-party code and
instructions in this package. They do not depend on an external specification
framework.

## Ownership and scope

- Keep the existing product brief authoritative for product-wide decisions.
- Keep one canonical plan for the work unit. Preserve its filename and location;
  use `PLAN.md` only when no equivalent plan exists.
- Keep project rules in the existing canonical rules file. Tool adapters point
  to that file. Record rule amendments, rationale, authority, and revisions there.
- Keep detailed command output and other proof in the project's existing report
  location. Reference artifacts from the plan rather than copying their contents.
- A root roadmap may link to separate feature plans when scale requires it. It
  must not maintain a second copy of their task states.

Scan paths, symbols, responsibilities, callers, tests, assets, and configuration
before creating work. Scope is the requested change and its necessary
dependencies. Existing authorization carries forward; only material unresolved
decisions require clarification.

## The delivery loop

1. **Discover the delta.** Read the current brief, rules, plan, and source.
   Establish what the request changes, what must remain compatible, and what
   observable outcome would demonstrate success.
2. **Specify acceptance.** Give each obligation a stable ID and observable
   preconditions, action, and expected result. Include negative/boundary cases
   appropriate to the behavior. Separate buildable obligations from business
   metrics that require later observation.
3. **Plan the smallest justified increments.** Map tasks to acceptance, canonical
   change paths, and dependencies. Explain why any new implementation is needed.
   Do not add a task merely to populate a template.
4. **Review readiness.** Check clarity, contradictory requirements, terminology,
   missing failure behavior, scope, rules, coverage, and dependency ordering.
   Record the review separately from behavior-test results. Run structural
   readiness validation; fix its findings before implementation depends on it.
5. **Implement and verify.** Work only on ready tasks. Apply the existing
   [code-quality rules](CODE-QUALITY.md) and [red-drill procedure](RED-DRILLS.md).
   Record actual command output and independent behavior observations.
6. **Reconcile.** Compare each acceptance criterion with current implementation
   and evidence. Classify missing, partial, contradictory, and unjustified work.
   Update or reopen its existing owning task. Add a task only for distinct work,
   preserving IDs and historical evidence. Do not rewrite requirements to excuse
   a failed implementation.
7. **Close or checkpoint.** Close only when all applicable criteria and active
   tasks are verified with current evidence. Otherwise record the real blocker
   or next safe task. Repeating an unchanged review must not create duplicates.
   Stop a loop that repeats the same unresolved finding without new evidence;
   state the specific action needed to make progress.

## Canonical plan format

The plan contains human-readable rationale and exactly one JSON block fenced
with `quality-ledger`. Structured obligations, references, states, and evidence
live only in that block. Prose may explain and reference their IDs; it must not
maintain competing task checkboxes or statuses. Use
[`templates/workflow/PLAN.md`](../templates/workflow/PLAN.md) as a starting asset,
adapting existing work instead of overwriting it.

All object fields listed below are required. Optional values are explicit null;
arrays may be empty only where the lifecycle permits it. Unknown fields,
duplicate JSON keys, unsupported schema versions, and duplicate ledger blocks
are errors. Version 1 supports at most 1,000 total requirement, acceptance,
task, and evidence records in a plan up to 4 MiB. Split larger efforts into
cohesive work units instead of silently truncating validation.

IDs begin with a letter and contain up to 64 letters, digits, underscores,
periods, colons, or hyphens. Preserve existing IDs when adopting a plan. IDs are
globally unique across records and never reused for different work.

### Top-level record

| Field | Meaning |
|---|---|
| `schema_version` | Integer `1` |
| `work` | Work-unit identity and shared inputs |
| `requirements` | Nonempty requirement records |
| `acceptance` | Nonempty observable criteria |
| `tasks` | Nonempty justified implementation records |
| `evidence` | Actual observations; empty before reviews/tests run |
| `checkpoint` | Complete resume boundary or null |

### Work and requirements

`work` contains `id`, `title`, positive `scope_revision`, `brief`, `brief_reason`,
`rules`, `inputs`, and `environment`.

- `brief` is the canonical workspace-relative brief path or null. Null requires
  a concrete `brief_reason`, such as a bounded change with sufficient existing
  product context. It must not bypass critical product discovery.
- `rules` is a nonempty array of `{ "path": ..., "revision": ... }`. These
  files remain canonical; the ledger references them rather than repeating policy.
- `inputs` lists additional existing files affecting verification, such as
  schemas, dependency locks, test configuration, or architecture decisions.
- `environment` contains `platform` and a nonempty `tools` map of tool names to
  actual version strings. Include the tool set used by this work's checks.

A requirement contains `id`, `statement`, `priority` (`critical`, `normal`, or
`low`), `acceptance` (criterion IDs), and `superseded_by` (replacement ID or null).
Active requirements need acceptance coverage. Retain superseded records and
link replacements; replacement cycles are invalid.

### Acceptance and tasks

An acceptance record contains `id`, `requirement`, `given`, `when`, `then`,
`checks`, and `manual_reason`.

- `checks` declares required proof kinds: `behavior`, `red`, and/or `manual`.
  Automated behavior and red drills require each other. Manual verification
  requires an applicability reason, not convenience or a missing test tool.
- Requirements review uses `readiness` evidence. It cannot appear in `checks`
  as a substitute for implementation proof.
- Each active criterion needs an active owning task. Both directions of the
  requirement/acceptance relationship must agree.

A task contains `id`, `purpose`, `acceptance`, `depends_on`, `changes`, `status`,
`evidence`, `blocker`, and `superseded_by`.

- `changes` lists `{ "path": ..., "action": "create|modify|delete" }` records.
  Paths are exact canonical files, not globs. A change is justified by its
  acceptance links, including enabling work shared by several criteria.
- Status is `planned`, `active`, `blocked`, `implemented`, `verified`, or
  `superseded`. Blocked tasks name their blocker. Superseded tasks name their
  replacement. Active/completed tasks require verified dependencies.
- `implemented` describes code progress. `verified` additionally requires the
  task's own applicable evidence and the intended file outcomes.

## Evidence receipts

Receipts contain `id`, `acceptance`, `kind`, `status`, `command`, `method`,
`environment`, `exit_code`, `artifact`, `inputs`, `scope_sha256`, `red`, and `reason`.

- `kind` is `readiness`, `behavior`, `red`, or `manual`.
- `status` is `pass`, `fail`, `deferred`, or `stale`. Non-passing results require
  a reason and next action. Historical failed/stale receipts remain available,
  but never count as passing evidence.
- `command` is the actual argv array for executable checks. The validator never
  executes it. `method` explains the observation; it must describe work actually
  performed. Manual/review receipts have an empty command array and null exit code.
- A passing executable receipt has exit code zero. The separate red proof
  records the expected failing child run.
- `artifact` is `{ "path": ..., "sha256": ... }`; passing receipts require a
  nonempty artifact with a matching lowercase SHA-256 digest.
- `inputs` is an array of the same fingerprint shape. A null digest means an
  observed absent file, which is distinct from an empty file's digest.
- `scope_sha256` binds the obligation and task/dependency definitions. Obtain
  current fingerprints using snapshot mode, then bind the actual check output.
  A snapshot is not proof that any check ran.

Readiness receipts cover planning inputs: brief, rules, and declared shared
inputs. Behavior receipts additionally cover their owning tasks' change paths
and transitive dependencies. Receipt artifacts cannot also be source inputs.
Paths must be normalized workspace-relative POSIX paths; escaping the workspace
through traversal or symlinks is refused.

### Red proof

The `red` object is present only for red receipts and contains:

- `mutation`: the defect intentionally introduced.
- `baseline_exit`, `mutated_exit`, `restored_exit`: zero, intended positive
  nonzero failure, and zero respectively.
- `expected_diagnostic` and `observed_diagnostic`: the failure that establishes
  sensitivity. Its identity must also appear in the bound artifact.
- `before`, `mutated`, and `after`: nonempty fingerprint arrays for the same
  drilled paths. At least one input changes in the mutation, before/after match
  exactly, and restored content matches current receipt inputs.

Do not classify timeout, startup, missing-dependency, or unrelated failures as
successful behavioral drills. Review the log and actual failure mechanism;
exit-code and string checks alone do not determine semantic correctness.

## Freshness, changes, and resume

A checkpoint contains `scope_sha256`, `inputs`, `environment`, `verified_tasks`,
`pending_operations`, `next_action`, and `source_revision`.

- The checkpoint fingerprints all current acceptance scope and its files.
- `verified_tasks` lists exactly the tasks recorded as verified.
- `pending_operations` contains `{ "id": ..., "description": ...,
  "next_action": ... }` for unresolved external outcomes. Resume refuses blind
  replay until observation resolves them. Closure cannot conceal those outcomes.
- `source_revision` records available Git identity for audit, or null where
  version control is unavailable. Source content fingerprints are authoritative:
  an unchanged commit does not make edited files fresh.

`scope_revision` is an audit label. Semantic fingerprints use the plan's narrative, actual obligations,
verification profile, canonical input definitions, and transitive prerequisite
contracts. Progress metadata and receipts are excluded, avoiding circular
self-hashes. The active plan is excluded from raw input hashes because its
narrative and semantic record are already bound by the scope digest. This permits
plan and rule updates without hashing a receipt into itself. A changed dependency criterion invalidates dependent proof; an
unrelated revision annotation alone does not.

On resume, repeat the focused scan, capture current runtime/tool context, run
resume validation, and inspect the current source. Mark affected proof stale
and move its task out of verified state before continuing. Do not clear a
finding by overwriting its old fingerprint while keeping the old passing claim.
Re-run checks and create a new receipt, preserving the original as history.

When amending rules, record the old/new revision, reason, authority, and impacted
work in the canonical rules file. Its changed content invalidates bound evidence.
Do not change a rule merely to excuse an unexplained implementation failure.

## Validator usage and limits

Requires Python 3.12+. Run from the target workspace with this package's root
resolved by the existing native helper:

```console
python <package-root>/scripts/verify-delivery.py --observe-context
python <package-root>/scripts/verify-delivery.py --root . --plan PLAN.md --snapshot
python <package-root>/scripts/verify-delivery.py --root . --plan PLAN.md --stage readiness --context reports/context.json
python <package-root>/scripts/verify-delivery.py --root . --plan PLAN.md --stage closure --context reports/context.json --format json
python <package-root>/scripts/verify-delivery.py --root . --plan PLAN.md --stage resume --context reports/context.json
```

`<package-root>` denotes the actual resolved package path. For a subset snapshot,
add `--acceptance AC-001 AC-002`. Capture `context.json` from current observations
with the same platform/tool fields as the plan; copying the plan's declared
versions does not establish current runtime identity. Keep context and artifacts
in the project's existing report location and record the commands used to
observe versions.

`--observe-context` reports the actual current host and Python version. It does
not guess versions of other project tools; observe those independently when they
are part of the declared profile.

### Atomic state updates

Prepare a complete candidate Markdown plan inside the owning workspace. Preserve
its existing rationale, identities, and history. Obtain the current plan's byte
digest from snapshot mode, then apply the candidate explicitly:

```console
python <package-root>/scripts/update-delivery.py --root . --plan PLAN.md --candidate reports/candidate.md --expected-sha256 <observed-plan-digest>
```

For initial creation use `missing` as the expected digest. The writer validates
record structure and paths, acquires a cooperating-writer lock, verifies the
precondition, flushes complete candidate bytes, rechecks the precondition, and
atomically replaces the plan. An identical candidate does not change the plan's
bytes or modification time. It never executes a recorded command.

Exit 1 means a lock or digest conflict. Re-observe and reconcile; do not force an
overwrite. An interrupted process may leave its lock directory, while the last
complete plan remains intact. Inspect `PLAN.md.lock/owner.json`, confirm the prior
writer is no longer operating, and inspect the saved plan before removing only
that stale lock. The tool never deletes another writer's lock automatically.
These locks coordinate cooperating writers; arbitrary external editors do not
honor them, so re-observation is still required at handoff and before consequential
actions. Invalid candidates and I/O failures return exit 2.

Exit 0 means the requested record/evidence checks passed. Exit 1 reports
validation findings. Exit 2 reports malformed/unreadable input. JSON reports
include the stage, check categories actually reached, findings, record counts,
and the limited scope of the result. No command in the ledger is executed.

The validator checks consistency and file bindings. It cannot prove that a
caller honestly ran a command, that a manual review was competent, or that a
test measures the requested behavior. The workflows require independent
semantic review, real execution evidence, and behavioral evaluation. A missing
runtime or skipped gate remains deferred and cannot establish complete delivery.
