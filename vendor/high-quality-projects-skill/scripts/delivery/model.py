"""Define the delivery record independently of parsing and filesystem access."""

from dataclasses import dataclass
from enum import StrEnum


class TaskStatus(StrEnum):
    """Distinguish progress from evidence-backed verification."""

    PLANNED = "planned"
    ACTIVE = "active"
    BLOCKED = "blocked"
    IMPLEMENTED = "implemented"
    VERIFIED = "verified"
    SUPERSEDED = "superseded"


class ResultStatus(StrEnum):
    """Represent a check result without converting missing proof to success."""

    SUCCESS = "pass"
    FAIL = "fail"
    DEFERRED = "deferred"
    STALE = "stale"


class EvidenceKind(StrEnum):
    """Name independent kinds of evidence required by an acceptance criterion."""

    BEHAVIOR = "behavior"
    RED = "red"
    MANUAL = "manual"
    READINESS = "readiness"


class ChangeAction(StrEnum):
    """Describe the intended final state of a task's owned path."""

    CREATE = "create"
    MODIFY = "modify"
    DELETE = "delete"


@dataclass(frozen=True)
class Environment:
    """Describe observed runtime identity, with tool versions supplied by the caller."""

    platform: str
    tools: dict[str, str]


@dataclass(frozen=True)
class RuleSource:
    """Identify a canonical project rule file and its declared revision."""

    path: str
    revision: str


@dataclass(frozen=True)
class Work:
    """Identify one bounded delivery effort and its shared inputs."""

    id: str
    title: str
    scope_revision: int
    brief: str | None
    brief_reason: str | None
    rules: tuple[RuleSource, ...]
    inputs: tuple[str, ...]
    environment: Environment


@dataclass(frozen=True)
class Requirement:
    """State one obligation with stable acceptance references."""

    id: str
    statement: str
    priority: str
    acceptance: tuple[str, ...]
    superseded_by: str | None


@dataclass(frozen=True)
class Acceptance:
    """Define an observable outcome and the evidence it requires."""

    id: str
    requirement: str
    given: str
    when: str
    then: str
    checks: tuple[EvidenceKind, ...]
    manual_reason: str | None


@dataclass(frozen=True)
class Change:
    """Bind a task to a path and its intended final state."""

    path: str
    action: ChangeAction


@dataclass(frozen=True)
class Task:
    """Connect implementation work to acceptance, dependencies, and evidence."""

    id: str
    purpose: str
    acceptance: tuple[str, ...]
    depends_on: tuple[str, ...]
    changes: tuple[Change, ...]
    status: TaskStatus
    evidence: tuple[str, ...]
    blocker: str | None
    superseded_by: str | None


@dataclass(frozen=True)
class Fingerprint:
    """Record file content identity; null digest means verified absence."""

    path: str
    sha256: str | None


@dataclass(frozen=True)
class RedProof:
    """Describe the intended failure and exact restoration of a drill."""

    mutation: str
    baseline_exit: int
    mutated_exit: int
    restored_exit: int
    expected_diagnostic: str
    observed_diagnostic: str
    before: tuple[Fingerprint, ...]
    mutated: tuple[Fingerprint, ...]
    after: tuple[Fingerprint, ...]


@dataclass(frozen=True)
class Evidence:
    """Bind an observed result and artifact to the relevant source and contract."""

    id: str
    acceptance: tuple[str, ...]
    kind: EvidenceKind
    status: ResultStatus
    command: tuple[str, ...]
    method: str
    environment: Environment
    exit_code: int | None
    artifact: Fingerprint | None
    inputs: tuple[Fingerprint, ...]
    scope_sha256: str | None
    red: RedProof | None
    reason: str | None


@dataclass(frozen=True)
class PendingOperation:
    """Retain an external outcome that must be re-observed before continuing."""

    id: str
    description: str
    next_action: str


@dataclass(frozen=True)
class Checkpoint:
    """Retain a complete delivery boundary without authorizing blind replay."""

    scope_sha256: str
    inputs: tuple[Fingerprint, ...]
    environment: Environment
    verified_tasks: tuple[str, ...]
    pending_operations: tuple[PendingOperation, ...]
    next_action: str
    source_revision: str | None


@dataclass(frozen=True)
class Ledger:
    """Contain the single authoritative structured record for a work unit."""

    schema_version: int
    work: Work
    requirements: tuple[Requirement, ...]
    acceptance: tuple[Acceptance, ...]
    tasks: tuple[Task, ...]
    evidence: tuple[Evidence, ...]
    checkpoint: Checkpoint | None
    prose_sha256: str = ""
    plan_path: str | None = None


@dataclass(frozen=True)
class Finding:
    """Identify a deterministic failed check and the affected record."""

    code: str
    location: str
    message: str
