"""Check relationship coverage and legal state independently of receipt contents."""

from __future__ import annotations

from collections import Counter
from dataclasses import dataclass
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from collections.abc import Mapping

from .model import (
    Acceptance,
    Evidence,
    EvidenceKind,
    Finding,
    Ledger,
    Requirement,
    ResultStatus,
    Task,
    TaskStatus,
)

REQUIREMENT_PRIORITIES = frozenset({"critical", "normal", "low"})


def duplicates(values: tuple[str, ...]) -> tuple[str, ...]:
    """Return repeated values in deterministic order."""
    return tuple(sorted(value for value, count in Counter(values).items() if count > 1))


def reachable(start: str, edges: Mapping[str, tuple[str, ...]]) -> set[str]:
    """Find transitive references without recursing on malformed cycles."""
    visited: set[str] = set()
    pending = list(edges.get(start, ()))
    while pending:
        node = pending.pop()
        if node not in visited:
            visited.add(node)
            pending.extend(edges.get(node, ()))
    return visited


def check_references(
    values: tuple[str, ...],
    targets: set[str],
    location: str,
) -> list[Finding]:
    """Report duplicate and dangling references without accepting empty coverage."""
    findings = [
        Finding("duplicate-reference", location, f"Reference {value} is repeated")
        for value in duplicates(values)
    ]
    findings.extend(
        Finding("dangling-reference", location, f"Reference {value} does not exist")
        for value in sorted(set(values) - targets)
    )
    return findings


@dataclass(frozen=True)
class Graph:
    """Index record relationships once for the specialized graph checks."""

    requirements: dict[str, Requirement]
    acceptance: dict[str, Acceptance]
    tasks: dict[str, Task]
    evidence: dict[str, Evidence]


def check_foundation(ledger: Ledger) -> list[Finding]:
    """Require a meaningful work scope and unambiguous identities."""
    collections = (ledger.requirements, ledger.acceptance, ledger.tasks, ledger.evidence)
    identifiers = tuple(item.id for collection in collections for item in collection)
    findings = [
        Finding("duplicate-id", identifier, "Record IDs must be globally unique")
        for identifier in duplicates(identifiers)
    ]
    if not ledger.requirements or not ledger.acceptance or not ledger.tasks:
        findings.append(
            Finding("empty-scope", "ledger", "Requirements, acceptance, and tasks are required")
        )
    if not any(item.superseded_by is None for item in ledger.requirements):
        findings.append(
            Finding(
                "empty-active-scope", "requirements", "At least one active requirement is required"
            )
        )
    if ledger.work.scope_revision < 1:
        findings.append(
            Finding("scope-revision", "work.scope_revision", "Revision must be positive")
        )
    if not ledger.work.rules:
        findings.append(
            Finding("rules-missing", "work.rules", "A canonical rules file is required")
        )
    if ledger.work.brief is None and ledger.work.brief_reason is None:
        findings.append(Finding("brief-reason", "work", "Omitting a brief requires a scope reason"))
    return findings


def check_requirement(item: Requirement, graph: Graph) -> list[Finding]:
    """Validate requirement ownership, priority, and acceptance coverage."""
    findings = check_references(item.acceptance, set(graph.acceptance), item.id)
    if item.priority not in REQUIREMENT_PRIORITIES:
        findings.append(Finding("priority", item.id, "Use critical, normal, or low"))
    if item.superseded_by:
        findings.extend(check_references((item.superseded_by,), set(graph.requirements), item.id))
    elif not item.acceptance:
        findings.append(
            Finding("acceptance-missing", item.id, "Active requirement has no criteria")
        )
    findings.extend(
        Finding("requirement-mismatch", identifier, "Acceptance points to a different requirement")
        for identifier in item.acceptance
        if identifier in graph.acceptance and graph.acceptance[identifier].requirement != item.id
    )
    return findings


def check_applicability(item: Acceptance) -> list[Finding]:
    """Keep planning reviews separate from meaningful implementation evidence."""
    findings = check_references(tuple(item.checks), set(EvidenceKind), item.id)
    if not item.checks:
        findings.append(Finding("checks-missing", item.id, "Verification kinds are required"))
    if EvidenceKind.READINESS in item.checks:
        findings.append(
            Finding(
                "readiness-not-behavior",
                item.id,
                "Readiness cannot satisfy implementation acceptance",
            )
        )
    if EvidenceKind.BEHAVIOR in item.checks and EvidenceKind.RED not in item.checks:
        findings.append(Finding("red-required", item.id, "Behavioral checks require a red drill"))
    if EvidenceKind.RED in item.checks and EvidenceKind.BEHAVIOR not in item.checks:
        findings.append(Finding("behavior-required", item.id, "A red drill needs a behavior check"))
    if EvidenceKind.MANUAL in item.checks and item.manual_reason is None:
        findings.append(
            Finding("manual-reason", item.id, "Manual checks require an applicability reason")
        )
    return findings


def check_criterion(item: Acceptance, graph: Graph) -> list[Finding]:
    """Validate both directions of acceptance ownership and active task coverage."""
    findings = check_references((item.requirement,), set(graph.requirements), item.id)
    findings.extend(check_applicability(item))
    parent = graph.requirements.get(item.requirement)
    if parent and item.id not in parent.acceptance:
        findings.append(
            Finding("acceptance-unlisted", item.id, "Parent does not reference this criterion")
        )
    covered = any(
        item.id in task.acceptance and task.status != TaskStatus.SUPERSEDED
        for task in graph.tasks.values()
    )
    if parent and not parent.superseded_by and not covered:
        findings.append(Finding("task-coverage", item.id, "Active criterion has no active task"))
    return findings


def check_task_state(item: Task, graph: Graph) -> list[Finding]:
    """Validate explicit lifecycle states without trusting a verified label alone."""
    findings = []
    if item.status == TaskStatus.SUPERSEDED:
        if item.superseded_by:
            findings.extend(check_references((item.superseded_by,), set(graph.tasks), item.id))
        else:
            findings.append(
                Finding("replacement-missing", item.id, "Superseded task needs a replacement ID")
            )
    elif item.superseded_by:
        findings.append(
            Finding("replacement-state", item.id, "Only superseded tasks name replacements")
        )
    elif not item.acceptance:
        findings.append(Finding("unjustified-task", item.id, "Task has no acceptance obligation"))
    if item.status == TaskStatus.BLOCKED and not item.blocker:
        findings.append(
            Finding("blocker-missing", item.id, "Blocked task needs a concrete blocker")
        )
    if item.status != TaskStatus.BLOCKED and item.blocker:
        findings.append(Finding("blocker-state", item.id, "A blocker requires blocked status"))
    if not item.changes and item.status != TaskStatus.SUPERSEDED:
        findings.append(
            Finding("changes-missing", item.id, "Task must identify canonical change paths")
        )
    if item.status == TaskStatus.VERIFIED and not item.evidence:
        findings.append(
            Finding("task-evidence-missing", item.id, "Verified task has no evidence references")
        )
    return findings


def check_task_links(item: Task, graph: Graph) -> list[Finding]:
    """Validate typed references and prevent unrelated receipts from satisfying work."""
    findings = check_references(item.acceptance, set(graph.acceptance), item.id)
    findings.extend(check_references(item.depends_on, set(graph.tasks), item.id))
    findings.extend(check_references(item.evidence, set(graph.evidence), item.id))
    for identifier in item.acceptance:
        criterion = graph.acceptance.get(identifier)
        parent = graph.requirements.get(criterion.requirement) if criterion else None
        if parent and parent.superseded_by and item.status != TaskStatus.SUPERSEDED:
            findings.append(
                Finding("superseded-scope", item.id, "Active task belongs to superseded scope")
            )
    for identifier in item.evidence:
        receipt = graph.evidence.get(identifier)
        if receipt and not set(receipt.acceptance).intersection(item.acceptance):
            findings.append(
                Finding(
                    "unrelated-evidence",
                    item.id,
                    f"Receipt {identifier} covers unrelated acceptance",
                )
            )
    return findings


def check_dependencies(item: Task, graph: Graph) -> list[Finding]:
    """Require verified dependencies before work becomes active or completed."""
    edges = {task.id: task.depends_on for task in graph.tasks.values()}
    findings = []
    if item.id in reachable(item.id, edges):
        findings.append(Finding("dependency-cycle", item.id, "Task dependency cycle detected"))
    if item.status in {TaskStatus.ACTIVE, TaskStatus.IMPLEMENTED, TaskStatus.VERIFIED}:
        findings.extend(
            Finding("dependency-unverified", item.id, f"Dependency {identifier} is not verified")
            for identifier in item.depends_on
            if identifier in graph.tasks and graph.tasks[identifier].status != TaskStatus.VERIFIED
        )
    return findings


def check_evidence_links(item: Evidence, graph: Graph) -> list[Finding]:
    """Keep every receipt scoped and every unsuccessful result explained."""
    findings = check_references(item.acceptance, set(graph.acceptance), item.id)
    if not item.acceptance:
        findings.append(
            Finding("evidence-unscoped", item.id, "Receipt must identify acceptance claims")
        )
    if item.status != ResultStatus.SUCCESS and not item.reason:
        findings.append(
            Finding("result-reason", item.id, "Non-passing evidence needs a reason and follow-up")
        )
    return findings


def check_replacements(graph: Graph) -> list[Finding]:
    """Reject replacement cycles while retaining historical record identities."""
    findings: list[Finding] = []
    groups = (graph.requirements.values(), graph.tasks.values())
    for group in groups:
        edges = {item.id: (item.superseded_by,) if item.superseded_by else () for item in group}
        findings.extend(
            Finding("replacement-cycle", identifier, "Replacement cycle detected")
            for identifier in edges
            if identifier in reachable(identifier, edges)
        )
    return findings


def check_graph(ledger: Ledger) -> list[Finding]:
    """Run scoped structural checks before any filesystem evidence is considered."""
    findings = check_foundation(ledger)
    if findings:
        return findings
    graph = Graph(
        {item.id: item for item in ledger.requirements},
        {item.id: item for item in ledger.acceptance},
        {item.id: item for item in ledger.tasks},
        {item.id: item for item in ledger.evidence},
    )
    for requirement in ledger.requirements:
        findings.extend(check_requirement(requirement, graph))
    for criterion in ledger.acceptance:
        findings.extend(check_criterion(criterion, graph))
    for task in ledger.tasks:
        findings.extend(check_task_state(task, graph))
        findings.extend(check_task_links(task, graph))
        findings.extend(check_dependencies(task, graph))
    for receipt in ledger.evidence:
        findings.extend(check_evidence_links(receipt, graph))
    findings.extend(check_replacements(graph))
    return findings
