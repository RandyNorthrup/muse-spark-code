"""Verify stage-specific evidence and freshness without claiming semantic correctness."""

from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from pathlib import Path

from .graph import check_graph
from .model import (
    ChangeAction,
    Environment,
    Evidence,
    EvidenceKind,
    Finding,
    Ledger,
    ResultStatus,
    Task,
    TaskStatus,
)
from .reader import PlanError, fail
from .snapshot import (
    assert_unique_paths,
    current_inputs,
    file_fingerprint,
    fingerprint_map,
    input_paths,
    owned_path,
    semantic_digest,
    shared_paths,
)


@dataclass(frozen=True)
class Report:
    """Report completed check categories and findings without false-green summaries."""

    stage: str
    checks: tuple[str, ...]
    findings: tuple[Finding, ...]
    requirements: int
    acceptance: int
    tasks: int
    evidence: int

    @property
    def passed(self) -> bool:
        """Indicate that the requested structural/evidence checks completed successfully."""
        return not self.findings


def check_paths(ledger: Ledger, root: Path) -> list[Finding]:
    """Validate canonical input paths and avoid aliases in declared file sets."""
    findings = []
    groups = [("work.inputs", ledger.work.inputs)]
    groups.append(("work.rules", tuple(rule.path for rule in ledger.work.rules)))
    groups.extend((task.id, tuple(change.path for change in task.changes)) for task in ledger.tasks)
    all_paths = shared_paths(ledger)
    all_paths.update(change.path for task in ledger.tasks for change in task.changes)
    groups.append(("work", tuple(sorted(all_paths))))
    for location, paths in groups:
        try:
            assert_unique_paths(root, paths)
        except PlanError as error:
            findings.append(Finding("path-invalid", location, str(error)))
    for relative in sorted(shared_paths(ledger)):
        try:
            if relative != ledger.plan_path and file_fingerprint(root, relative).sha256 is None:
                findings.append(
                    Finding("input-missing", relative, "Canonical input file does not exist")
                )
        except PlanError as error:
            findings.append(Finding("path-invalid", relative, str(error)))
    return findings


def check_active_changes(ledger: Ledger, root: Path) -> list[Finding]:
    """Reject concurrent ownership of the same canonical change path."""
    owners: dict[Path, str] = {}
    findings = []
    for task in ledger.tasks:
        if task.status != TaskStatus.ACTIVE:
            continue
        for change in task.changes:
            path = owned_path(root, change.path)
            if path in owners:
                findings.append(
                    Finding(
                        "active-write-conflict",
                        task.id,
                        f"Path is also active in {owners[path]}: {change.path}",
                    )
                )
            owners[path] = task.id
    return findings


def check_environment(
    expected: Environment,
    observed: Environment | None,
    location: str,
) -> list[Finding]:
    """Require independently supplied context rather than trusting receipt versions alone."""
    if observed is None:
        return [
            Finding(
                "context-missing", location, "Provide a freshly observed environment with --context"
            )
        ]
    if expected != observed:
        return [
            Finding(
                "environment-stale",
                location,
                "Observed platform/tool versions differ from the plan",
            )
        ]
    return []


def check_receipt_result(ledger: Ledger, receipt: Evidence) -> list[Finding]:
    """Check result metadata independently of source and artifact access."""
    findings = []
    if receipt.environment != ledger.work.environment:
        findings.append(
            Finding(
                "evidence-environment",
                receipt.id,
                "Receipt environment differs from the current profile",
            )
        )
    if receipt.kind in {EvidenceKind.BEHAVIOR, EvidenceKind.RED}:
        if not receipt.command:
            findings.append(
                Finding("command-missing", receipt.id, "Executable evidence needs command argv")
            )
        if receipt.exit_code != 0:
            findings.append(
                Finding("positive-exit", receipt.id, "Passing execution needs exit zero")
            )
    elif receipt.exit_code is not None:
        findings.append(
            Finding("manual-exit", receipt.id, "Manual reviews cannot invent exit codes")
        )
    return findings


def check_receipt_inputs(ledger: Ledger, root: Path, receipt: Evidence) -> list[Finding]:
    """Require current semantic scope and complete file observations."""
    findings = []
    if receipt.scope_sha256 != semantic_digest(ledger, receipt.acceptance):
        findings.append(
            Finding("scope-stale", receipt.id, "Requirements, tasks, or profile changed")
        )
    try:
        expected = current_inputs(root, input_paths(ledger, receipt.acceptance, receipt.kind))
        if fingerprint_map(receipt.inputs) != fingerprint_map(expected):
            findings.append(
                Finding("inputs-stale", receipt.id, "Input coverage or content changed")
            )
        for item in receipt.inputs:
            owned_path(root, item.path)
    except PlanError as error:
        findings.append(Finding("fingerprint-invalid", receipt.id, str(error)))
    return findings


def artifact_contains(path: Path, diagnostic: str) -> bool:
    """Search a log with bounded buffers, including matches across chunk boundaries."""
    chunk_size = 65536
    overlap = max(len(diagnostic) - 1, 0)
    previous = ""
    with path.open(encoding="utf-8", errors="replace") as stream:
        while chunk := stream.read(chunk_size):
            text = previous + chunk
            if diagnostic in text:
                return True
            previous = text[-overlap:] if overlap else ""
    return False


def inspect_artifact(ledger: Ledger, root: Path, receipt: Evidence) -> tuple[list[Finding], bool]:
    """Inspect a bound, nonempty artifact and reject circular input aliases."""
    if receipt.artifact is None or receipt.artifact.sha256 is None:
        return [
            Finding("artifact-missing", receipt.id, "Passing evidence needs a hashed artifact")
        ], False
    findings = []
    actual = file_fingerprint(root, receipt.artifact.path)
    if actual != receipt.artifact:
        findings.append(Finding("artifact-stale", receipt.id, "Artifact is missing or changed"))
    if actual.sha256 is None:
        return findings, False
    path = owned_path(root, receipt.artifact.path)
    if path.stat().st_size == 0:
        findings.append(
            Finding("artifact-empty", receipt.id, "Empty artifact cannot support proof")
        )
    inputs = {
        owned_path(root, item) for item in input_paths(ledger, receipt.acceptance, receipt.kind)
    }
    if path in inputs:
        findings.append(Finding("circular-evidence", receipt.id, "Artifact is also a source input"))
    present = bool(receipt.red and artifact_contains(path, receipt.red.expected_diagnostic))
    return findings, present


def check_receipt(ledger: Ledger, root: Path, receipt: Evidence) -> list[Finding]:
    """Validate recorded results, source bindings, artifacts, and drill outcomes."""
    if receipt.status != ResultStatus.SUCCESS:
        return [Finding("evidence-not-passing", receipt.id, f"Evidence is {receipt.status}")]
    findings = check_receipt_result(ledger, receipt)
    findings.extend(check_receipt_inputs(ledger, root, receipt))
    diagnostic_present = False
    try:
        artifact_findings, diagnostic_present = inspect_artifact(ledger, root, receipt)
        findings.extend(artifact_findings)
    except (PlanError, OSError) as error:
        findings.append(Finding("artifact-invalid", receipt.id, str(error)))
    if receipt.kind == EvidenceKind.RED:
        findings.extend(check_red(receipt, diagnostic_present=diagnostic_present))
    elif receipt.red is not None:
        findings.append(Finding("red-kind", receipt.id, "Red proof belongs to red evidence"))
    return findings


def check_red(receipt: Evidence, *, diagnostic_present: bool) -> list[Finding]:
    """Reject surviving mutations, missing diagnostics, and incomplete restoration."""
    proof = receipt.red
    if proof is None:
        return [
            Finding(
                "red-proof-missing",
                receipt.id,
                "Red evidence needs all three runs and file observations",
            )
        ]
    findings = []
    if proof.baseline_exit != 0 or proof.restored_exit != 0 or proof.mutated_exit <= 0:
        findings.append(
            Finding(
                "red-exits", receipt.id, "Require green, intended non-zero red, and restored green"
            )
        )
    if proof.expected_diagnostic not in proof.observed_diagnostic:
        findings.append(
            Finding(
                "red-diagnostic",
                receipt.id,
                "Observed failure does not contain the intended diagnostic",
            )
        )
    if not diagnostic_present:
        findings.append(
            Finding(
                "red-artifact",
                receipt.id,
                "Artifact does not contain the intended failure diagnostic",
            )
        )
    try:
        before = fingerprint_map(proof.before)
        mutated = fingerprint_map(proof.mutated)
        after = fingerprint_map(proof.after)
        inputs = fingerprint_map(receipt.inputs)
        if not before or before != after:
            findings.append(
                Finding(
                    "red-restoration",
                    receipt.id,
                    "Before and restored observations must be nonempty and equal",
                )
            )
        if set(before) != set(mutated) or before == mutated:
            findings.append(
                Finding(
                    "red-mutation",
                    receipt.id,
                    "At least one scoped file must actually change during the drill",
                )
            )
        if any(path not in inputs or inputs[path] != digest for path, digest in before.items()):
            findings.append(
                Finding(
                    "red-inputs",
                    receipt.id,
                    "Drilled paths must match the final verified source inputs",
                )
            )
    except PlanError as error:
        findings.append(Finding("red-fingerprints", receipt.id, str(error)))
    return findings


def check_acceptance_evidence(
    ledger: Ledger,
    root: Path,
    *,
    readiness: bool,
) -> list[Finding]:
    """Require every applicable proof and preserve the distinction between review and behavior."""
    findings = []
    requirements = {item.id: item for item in ledger.requirements}
    receipts = {item.id: item for item in ledger.evidence}
    checked: set[str] = set()
    for criterion in ledger.acceptance:
        if requirements[criterion.requirement].superseded_by:
            continue
        kinds = (EvidenceKind.READINESS,) if readiness else criterion.checks
        owners = [
            task
            for task in ledger.tasks
            if criterion.id in task.acceptance and task.status != TaskStatus.SUPERSEDED
        ]
        for kind in kinds:
            if readiness:
                candidates = [
                    receipt
                    for receipt in ledger.evidence
                    if criterion.id in receipt.acceptance and receipt.kind == kind
                ]
            else:
                candidates = [
                    receipts[identifier]
                    for task in owners
                    for identifier in task.evidence
                    if criterion.id in receipts[identifier].acceptance
                    and receipts[identifier].kind == kind
                ]
            passing = [item for item in candidates if item.status == ResultStatus.SUCCESS]
            if not passing:
                findings.append(
                    Finding(
                        "evidence-coverage",
                        criterion.id,
                        f"No passing {kind} receipt covers this acceptance criterion",
                    )
                )
                continue
            # A bad active passing claim cannot be hidden beside a good one.
            # Historical failed/stale receipts remain available without counting as proof.
            for receipt in passing:
                if receipt.id not in checked:
                    findings.extend(check_receipt(ledger, root, receipt))
                    checked.add(receipt.id)
    return findings


def check_task_completion(ledger: Ledger) -> list[Finding]:
    """Refuse closure while any active task remains short of verified status."""
    return [
        Finding("task-unverified", task.id, f"Task is {task.status}, not verified")
        for task in ledger.tasks
        if task.status not in {TaskStatus.VERIFIED, TaskStatus.SUPERSEDED}
    ]


def check_verified_task(ledger: Ledger, root: Path, task: Task) -> list[Finding]:
    """Require the task's own acceptance evidence on every verified state claim."""
    findings = []
    criteria = {item.id: item for item in ledger.acceptance}
    receipts = {item.id: item for item in ledger.evidence}
    for identifier in task.acceptance:
        for kind in criteria[identifier].checks:
            candidates = [
                receipts[item]
                for item in task.evidence
                if identifier in receipts[item].acceptance
                and receipts[item].kind == kind
                and receipts[item].status == ResultStatus.SUCCESS
            ]
            if not candidates:
                findings.append(
                    Finding(
                        "task-evidence-coverage",
                        task.id,
                        f"No referenced {kind} proof for {identifier}",
                    )
                )
            for receipt in candidates:
                findings.extend(check_receipt(ledger, root, receipt))
    for change in task.changes:
        try:
            exists = file_fingerprint(root, change.path).sha256 is not None
            if exists != (change.action != ChangeAction.DELETE):
                findings.append(
                    Finding("change-outcome", task.id, f"Unexpected path state for {change.path}")
                )
        except PlanError as error:
            findings.append(Finding("change-invalid", task.id, str(error)))
    return findings


def check_checkpoint(ledger: Ledger, root: Path) -> list[Finding]:
    """Reject stale checkpoints and pending outcomes before resuming work."""
    checkpoint = ledger.checkpoint
    if checkpoint is None:
        return [
            Finding(
                "checkpoint-missing", "checkpoint", "Resume requires a complete saved checkpoint"
            )
        ]
    findings = []
    active_requirements = {item.id for item in ledger.requirements if not item.superseded_by}
    acceptance = tuple(
        item.id for item in ledger.acceptance if item.requirement in active_requirements
    )
    if checkpoint.scope_sha256 != semantic_digest(ledger, acceptance):
        findings.append(
            Finding(
                "checkpoint-scope-stale",
                "checkpoint",
                "Scoped semantic inputs changed since the checkpoint",
            )
        )
    if checkpoint.environment != ledger.work.environment:
        findings.append(
            Finding(
                "checkpoint-environment",
                "checkpoint",
                "Checkpoint used a different verification profile",
            )
        )
    verified = {task.id for task in ledger.tasks if task.status == TaskStatus.VERIFIED}
    if (
        len(checkpoint.verified_tasks) != len(set(checkpoint.verified_tasks))
        or set(checkpoint.verified_tasks) != verified
    ):
        findings.append(
            Finding(
                "checkpoint-progress",
                "checkpoint",
                "Verified-task identity no longer matches the checkpoint",
            )
        )
    try:
        expected = current_inputs(root, input_paths(ledger, acceptance, EvidenceKind.BEHAVIOR))
        if fingerprint_map(checkpoint.inputs) != fingerprint_map(expected):
            findings.append(
                Finding(
                    "checkpoint-inputs-stale",
                    "checkpoint",
                    "Source changed since the checkpoint; re-observe before proceeding",
                )
            )
    except PlanError as error:
        findings.append(Finding("checkpoint-inputs", "checkpoint", str(error)))
    findings.extend(
        Finding("outcome-unresolved", operation.id, operation.next_action)
        for operation in checkpoint.pending_operations
    )
    return findings


def validate(
    ledger: Ledger,
    root: Path,
    stage: str,
    context: Environment | None,
) -> Report:
    """Validate the requested stage while keeping skipped categories explicit."""
    if stage not in {"readiness", "closure", "resume"}:
        fail("stage", f"unsupported stage {stage}")
    findings = check_graph(ledger)
    checks = ["schema", "record-graph"]
    if not findings:
        findings.extend(check_paths(ledger, root))
        checks.append("owned-paths")
    if not findings:
        findings.extend(check_active_changes(ledger, root))
        checks.append("active-path-ownership")
        findings.extend(check_environment(ledger.work.environment, context, "work.environment"))
        findings.extend(check_acceptance_evidence(ledger, root, readiness=True))
        checks.extend(("environment", "readiness-receipts"))
        for task in ledger.tasks:
            if task.status == TaskStatus.VERIFIED:
                findings.extend(check_verified_task(ledger, root, task))
        checks.append("completed-receipts")
        if stage == "closure":
            findings.extend(check_acceptance_evidence(ledger, root, readiness=False))
            findings.extend(check_task_completion(ledger))
            checks.extend(("behavior-receipts", "task-completion"))
            if ledger.checkpoint and ledger.checkpoint.pending_operations:
                findings.extend(check_checkpoint(ledger, root))
        elif stage == "resume":
            findings.extend(check_checkpoint(ledger, root))
            checks.append("checkpoint-freshness")
    unique = sorted(set(findings), key=lambda item: (item.location, item.code, item.message))
    return Report(
        stage,
        tuple(checks),
        tuple(unique),
        len(ledger.requirements),
        len(ledger.acceptance),
        len(ledger.tasks),
        len(ledger.evidence),
    )
