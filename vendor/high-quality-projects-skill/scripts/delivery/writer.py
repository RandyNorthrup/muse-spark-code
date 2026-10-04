"""Update an owned native plan atomically with conflict detection and cooperative locking."""

import argparse
import hashlib
import json
import os
import shutil
import tempfile
from dataclasses import dataclass
from pathlib import Path

from .checks import check_paths
from .cli import EXIT_FINDINGS, EXIT_INPUT, EXIT_OK, encode
from .graph import check_graph
from .reader import DIGEST_PATTERN, PlanError, fail, parse_plan, read_input
from .snapshot import owned_path

MISSING = "missing"
DEFAULT_FILE_MODE = 0o666


class UpdateConflictError(RuntimeError):
    """Refuse a stale or concurrently owned update without altering the plan."""


@dataclass(frozen=True)
class UpdateResult:
    """Describe the exact persisted plan and whether its bytes changed."""

    plan: str
    changed: bool
    sha256: str
    work_id: str


def content_digest(value: bytes | None) -> str:
    """Identify current bytes or the explicitly absent initial state."""
    return MISSING if value is None else hashlib.sha256(value).hexdigest()


def require_expected(plan: Path, expected: str) -> bytes | None:
    """Compare actual plan bytes with the caller's observed precondition."""
    actual = read_input(plan) if plan.exists() else None
    if content_digest(actual) != expected:
        message = "Plan changed since observation; re-read it before updating."
        raise UpdateConflictError(message)
    return actual


def acquire_lock(path: Path, expected: str) -> None:
    """Acquire one cooperating-writer lock without deleting an existing lock."""
    try:
        path.mkdir()
    except FileExistsError as error:
        message = (
            f"Plan is locked at {path}; inspect its owner and resolve the existing writer first."
        )
        raise UpdateConflictError(message) from error
    try:
        (path / "owner.json").write_text(
            json.dumps({"pid": os.getpid(), "expected_sha256": expected}), encoding="utf-8"
        )
    except OSError:
        (path / "owner.json").unlink(missing_ok=True)
        path.rmdir()
        raise


def default_file_mode() -> int:
    """Return the mode an ordinary new file receives under the process umask."""
    # os.umask can only be read by setting it; restore it before returning.
    umask = os.umask(0)
    os.umask(umask)
    return DEFAULT_FILE_MODE & ~umask


def sync_directory(directory: Path) -> None:
    """Persist the rename itself on POSIX; Windows exposes no directory handle to flush."""
    if os.name == "nt":
        return
    descriptor = os.open(directory, os.O_RDONLY)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def replace_owned(plan: Path, candidate: bytes, expected: str) -> None:
    """Flush complete bytes, recheck the precondition, and atomically replace the plan."""
    temporary: Path | None = None
    try:
        with tempfile.NamedTemporaryFile(
            dir=plan.parent, prefix=f".{plan.name}.", suffix=".tmp", delete=False
        ) as stream:
            temporary = Path(stream.name)
            stream.write(candidate)
            stream.flush()
            os.fsync(stream.fileno())
        # Temporary files are owner-only; the replacement must keep the plan's
        # existing permissions or, for a new plan, those of an ordinary file.
        if plan.exists():
            shutil.copymode(plan, temporary)
        else:
            temporary.chmod(default_file_mode())
        require_expected(plan, expected)
        temporary.replace(plan)
        sync_directory(plan.parent)
    finally:
        if temporary is not None and temporary.exists():
            temporary.unlink()


def update(root: Path, plan_name: str, candidate_path: Path, expected: str) -> UpdateResult:
    """Validate a candidate and preserve the last complete plan on conflict or failure."""
    root = root.resolve(strict=True)
    plan = owned_path(root, plan_name)
    candidate_path = candidate_path.resolve(strict=True)
    if not candidate_path.is_relative_to(root) or candidate_path == plan:
        fail("candidate", "use a separate candidate file inside the owning workspace")
    if expected != MISSING and not DIGEST_PATTERN.fullmatch(expected):
        fail("expected-sha256", "use the observed lowercase digest or 'missing'")
    candidate = read_input(candidate_path)
    _, ledger = parse_plan(candidate, plan_name)
    findings = check_graph(ledger)
    if not findings:
        findings = check_paths(ledger, root)
    if findings:
        fail("candidate", "; ".join(f"{item.code}: {item.message}" for item in findings))
    lock = plan.with_name(plan.name + ".lock")
    acquire_lock(lock, expected)
    try:
        actual = require_expected(plan, expected)
        changed = actual != candidate
        if changed:
            replace_owned(plan, candidate, expected)
    finally:
        (lock / "owner.json").unlink()
        lock.rmdir()
    return UpdateResult(plan_name, changed, hashlib.sha256(candidate).hexdigest(), ledger.work.id)


def run(argv: list[str] | None = None) -> tuple[int, str]:
    """Expose explicit candidate writes separately from the read-only validator."""
    parser = argparse.ArgumentParser(description="Atomically update an owned native delivery plan.")
    parser.add_argument("--root", type=Path, default=Path.cwd())
    parser.add_argument("--plan", required=True)
    parser.add_argument("--candidate", type=Path, required=True)
    parser.add_argument("--expected-sha256", required=True)
    args = parser.parse_args(argv)
    try:
        result = update(args.root, args.plan, args.root / args.candidate, args.expected_sha256)
    except UpdateConflictError as error:
        return EXIT_FINDINGS, encode(
            {"updated": False, "code": "update-conflict", "message": str(error)}
        )
    except (PlanError, OSError) as error:
        return EXIT_INPUT, encode({"updated": False, "code": "input-error", "message": str(error)})
    return EXIT_OK, encode(
        {
            "updated": True,
            "changed": result.changed,
            "plan": result.plan,
            "sha256": result.sha256,
            "work_id": result.work_id,
        }
    )
