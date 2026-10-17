"""Bind verification to scoped semantic inputs and workspace-owned file content."""

import hashlib
import json
import platform
from dataclasses import asdict
from pathlib import Path, PurePosixPath, PureWindowsPath

from .graph import reachable
from .model import Environment, EvidenceKind, Fingerprint, Ledger, TaskStatus
from .reader import CONTROL_CHARACTER_LIMIT, fail


def observed_environment() -> Environment:
    """Observe this interpreter and host without executing a command from a plan."""
    return Environment(platform.system().lower(), {"python": platform.python_version()})


def owned_path(root: Path, relative: str) -> Path:
    """Resolve a portable relative path without admitting escape or link traversal."""
    posix = PurePosixPath(relative)
    windows = PureWindowsPath(relative)
    if (
        not relative
        or any(ord(character) < CONTROL_CHARACTER_LIMIT for character in relative)
        or "\\" in relative
        or posix.is_absolute()
        or windows.drive
        or ".." in posix.parts
        or relative in {".", ""}
        or str(posix) != relative
        or ":" in relative
    ):
        fail(relative, "use a normalized workspace-relative POSIX path")
    candidate = root.joinpath(*posix.parts)
    try:
        resolved = candidate.resolve()
        if not resolved.is_relative_to(root.resolve()):
            fail(relative, "path escapes the workspace")
    except (OSError, RuntimeError) as error:
        fail(relative, "path cannot be resolved", cause=error)
    return resolved


def file_fingerprint(root: Path, relative: str) -> Fingerprint:
    """Hash a regular file, preserving missing-file observations explicitly."""
    path = owned_path(root, relative)
    try:
        if not path.exists():
            return Fingerprint(relative, None)
        if not path.is_file():
            fail(relative, "expected a regular file")
        with path.open("rb") as stream:
            digest = hashlib.file_digest(stream, "sha256").hexdigest()
    except OSError as error:
        fail(relative, "file cannot be read", cause=error)
    return Fingerprint(relative, digest)


def shared_paths(ledger: Ledger) -> set[str]:
    """Collect canonical rules, product context, and declared shared inputs."""
    paths = set(ledger.work.inputs)
    paths.update(rule.path for rule in ledger.work.rules)
    if ledger.work.brief:
        paths.add(ledger.work.brief)
    return paths


def scoped_tasks(ledger: Ledger, acceptance_ids: tuple[str, ...]) -> set[str]:
    """Include tasks owning the claims and their transitive dependencies."""
    selected = {
        task.id
        for task in ledger.tasks
        if set(task.acceptance).intersection(acceptance_ids)
        and task.status != TaskStatus.SUPERSEDED
    }
    edges = {task.id: task.depends_on for task in ledger.tasks}
    for identifier in tuple(selected):
        selected.update(reachable(identifier, edges))
    return selected


def input_paths(
    ledger: Ledger,
    acceptance_ids: tuple[str, ...],
    kind: EvidenceKind,
) -> tuple[str, ...]:
    """Scope readiness to planning inputs and behavior to its implementation inputs."""
    paths = shared_paths(ledger)
    if kind != EvidenceKind.READINESS:
        task_ids = scoped_tasks(ledger, acceptance_ids)
        paths.update(
            change.path for task in ledger.tasks if task.id in task_ids for change in task.changes
        )
    # The active plan is covered by semantic/prose identity, not by a raw byte
    # digest that would include the receipt being written into that same plan.
    if ledger.plan_path is not None:
        paths.discard(ledger.plan_path)
    return tuple(sorted(paths))


def semantic_digest(ledger: Ledger, acceptance_ids: tuple[str, ...]) -> str:
    """Hash scoped obligations and their prerequisite contracts, excluding progress metadata."""
    if not ledger.prose_sha256:
        fail("plan", "load a complete Markdown plan before fingerprinting evidence")
    task_ids = scoped_tasks(ledger, acceptance_ids)
    criterion_ids = set(acceptance_ids)
    criterion_ids.update(
        identifier for task in ledger.tasks if task.id in task_ids for identifier in task.acceptance
    )
    criteria = [item for item in ledger.acceptance if item.id in criterion_ids]
    requirement_ids = {item.requirement for item in criteria}
    work = asdict(ledger.work)
    # Revision is an audit label. Actual changed obligations, inputs, rules, and
    # environment determine affected proof; unrelated work retains its identity.
    del work["scope_revision"]
    work["inputs"] = sorted(ledger.work.inputs)
    work["rules"] = sorted(
        (asdict(item) for item in ledger.work.rules), key=lambda item: str(item["path"])
    )
    payload = {
        "schema_version": ledger.schema_version,
        "prose_sha256": ledger.prose_sha256,
        "work": work,
        "requirements": sorted(
            (
                {**asdict(item), "acceptance": sorted(item.acceptance)}
                for item in ledger.requirements
                if item.id in requirement_ids
            ),
            key=lambda item: str(item["id"]),
        ),
        "acceptance": sorted(
            ({**asdict(item), "checks": sorted(item.checks)} for item in criteria),
            key=lambda item: str(item["id"]),
        ),
        "tasks": sorted(
            (
                {
                    "id": item.id,
                    "purpose": item.purpose,
                    "acceptance": sorted(item.acceptance),
                    "depends_on": sorted(item.depends_on),
                    "changes": [
                        asdict(change)
                        for change in sorted(
                            item.changes, key=lambda change: (change.path, change.action)
                        )
                    ],
                }
                for item in ledger.tasks
                if item.id in task_ids
            ),
            key=lambda item: str(item["id"]),
        ),
    }
    encoded = json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return hashlib.sha256(encoded.encode("utf-8")).hexdigest()


def current_inputs(root: Path, paths: tuple[str, ...]) -> tuple[Fingerprint, ...]:
    """Capture sorted file observations without interpreting missing paths as empty files."""
    return tuple(file_fingerprint(root, path) for path in sorted(set(paths)))


def assert_unique_paths(root: Path, paths: tuple[str, ...]) -> None:
    """Reject duplicate aliases that would make file coverage ambiguous."""
    observed: set[Path] = set()
    for relative in paths:
        path = owned_path(root, relative).resolve()
        if path in observed:
            fail(relative, "duplicate path or alias")
        observed.add(path)


def fingerprint_map(values: tuple[Fingerprint, ...]) -> dict[str, str | None]:
    """Convert unique observations into a comparison map."""
    result: dict[str, str | None] = {}
    for value in values:
        if value.path in result:
            fail(value.path, "duplicate fingerprint path")
        result[value.path] = value.sha256
    return result
