"""Provide argument handling and machine-readable reports for delivery checks."""

import argparse
import hashlib
import json
from dataclasses import asdict, dataclass
from pathlib import Path

from .checks import Report, validate
from .graph import check_graph
from .model import EvidenceKind, Finding, Ledger
from .reader import PlanError, fail, parse_json, parse_plan, read_environment, read_input
from .snapshot import (
    current_inputs,
    input_paths,
    observed_environment,
    owned_path,
    semantic_digest,
    shared_paths,
)

EXIT_OK = 0
EXIT_FINDINGS = 1
EXIT_INPUT = 2
STAGES = ("readiness", "closure", "resume")


def parser() -> argparse.ArgumentParser:
    """Describe read-only validation and snapshot modes."""
    result = argparse.ArgumentParser(
        description="Validate a native delivery ledger; recorded commands are never executed."
    )
    mode = result.add_mutually_exclusive_group(required=True)
    mode.add_argument("--plan", type=Path, help="Canonical Markdown plan")
    mode.add_argument(
        "--observe-context", action="store_true", help="Print actual host/Python context"
    )
    result.add_argument("--root", type=Path, default=Path.cwd(), help="Owning workspace root")
    result.add_argument("--stage", choices=STAGES, default="readiness")
    result.add_argument("--format", choices=("text", "json"), default="text")
    result.add_argument(
        "--context", type=Path, help="Freshly observed platform/tool versions as JSON"
    )
    result.add_argument(
        "--snapshot", action="store_true", help="Emit current receipt fingerprints as JSON"
    )
    result.add_argument(
        "--acceptance", nargs="+", help="Acceptance IDs to fingerprint; default is active scope"
    )
    return result


def encode(value: object) -> str:
    """Serialize deterministic Unicode JSON for files and CLI consumers."""
    return json.dumps(value, ensure_ascii=False, sort_keys=True, indent=2)


@dataclass(frozen=True)
class Options:
    """Contain the typed local command request after argparse validation."""

    plan: Path
    root: Path
    stage: str
    output_format: str
    context: Path | None
    snapshot: bool
    acceptance: tuple[str, ...]


def select_acceptance(ledger: Ledger, requested: tuple[str, ...]) -> tuple[str, ...]:
    """Select only current acceptance obligations for a receipt snapshot."""
    active = {item.id for item in ledger.requirements if not item.superseded_by}
    valid = {item.id for item in ledger.acceptance if item.requirement in active}
    selected = requested or tuple(sorted(valid))
    if not selected or len(selected) != len(set(selected)) or not set(selected) <= valid:
        fail("acceptance", "select unique active acceptance IDs")
    return selected


def snapshot_output(
    ledger: Ledger, root: Path, digest: str, requested: tuple[str, ...]
) -> tuple[int, str]:
    """Emit scoped observations without inventing successful evidence."""
    findings = check_graph(ledger)
    if findings:
        return EXIT_FINDINGS, encode(
            {"passed": False, "findings": [asdict(item) for item in findings]}
        )
    selected = select_acceptance(ledger, requested)
    payload = {
        "acceptance": selected,
        "plan_sha256": digest,
        "scope_sha256": semantic_digest(ledger, selected),
        "inputs": {
            kind.value: [
                asdict(item) for item in current_inputs(root, input_paths(ledger, selected, kind))
            ]
            for kind in (EvidenceKind.READINESS, EvidenceKind.BEHAVIOR)
        },
        "declared_environment": asdict(ledger.work.environment),
        "notice": "Fingerprints are observations, not proof that commands or reviews ran.",
    }
    return EXIT_OK, encode(payload)


def report_output(report: Report, output_format: str) -> tuple[int, str]:
    """Render stable findings and explicitly scoped claims."""
    claim = "Structural and recorded-evidence checks; semantic review remains required."
    if output_format == "json":
        payload: dict[str, object] = {"passed": report.passed, **asdict(report)}
        payload["claim_scope"] = claim
        output = encode(payload)
    else:
        lines = [f"{'PASS' if report.passed else 'FAIL'}: {report.stage} record/evidence checks"]
        lines.append(f"Checked: {', '.join(report.checks)}")
        lines.extend(f"{item.code} | {item.location} | {item.message}" for item in report.findings)
        lines.append(claim)
        output = "\n".join(lines)
    return EXIT_OK if report.passed else EXIT_FINDINGS, output


def execute(options: Options) -> tuple[int, str]:
    """Resolve the explicit workspace and verify the same plan was checked throughout."""
    root = options.root.resolve(strict=True)
    if not root.is_dir():
        fail("root", "expected a workspace directory")
    plan = (root / options.plan).resolve(strict=True)
    if not plan.is_relative_to(root):
        fail("plan", "must stay inside the owning workspace")
    original = read_input(plan)
    _, ledger = parse_plan(original, plan.relative_to(root).as_posix())
    declared_paths = shared_paths(ledger)
    declared_paths.update(change.path for task in ledger.tasks for change in task.changes)
    for relative in declared_paths:
        if owned_path(root, relative) == plan and relative != ledger.plan_path:
            fail("plan", "use the canonical plan path instead of a file alias")
    context = None
    if options.context:
        raw = read_input((root / options.context).resolve(strict=True))
        context = read_environment(parse_json(raw.decode("utf-8-sig")), "context")
    if options.snapshot:
        if options.stage != "readiness":
            fail("stage", "snapshot mode does not perform closure or resume validation")
        result = snapshot_output(
            ledger, root, hashlib.sha256(original).hexdigest(), options.acceptance
        )
    else:
        if options.acceptance:
            fail("acceptance", "selection is supported only in snapshot mode")
        report = validate(ledger, root, options.stage, context)
        result = report_output(report, options.output_format)
    if read_input(plan) != original:
        fail("plan", "changed during validation; repeat against current source")
    return result


def run(argv: list[str] | None = None) -> tuple[int, str]:
    """Return the observed result without writing files or launching commands."""
    args = parser().parse_args(argv)
    if args.observe_context:
        if args.snapshot or args.context or args.acceptance or args.stage != "readiness":
            parser().error("Context observation cannot be combined with plan validation options")
        return EXIT_OK, encode(asdict(observed_environment()))
    options = Options(
        args.plan,
        args.root,
        args.stage,
        args.format,
        args.context,
        args.snapshot,
        tuple(args.acceptance or ()),
    )
    try:
        result = execute(options)
    except (PlanError, OSError, UnicodeError) as error:
        finding = Finding("input-error", "plan", str(error))
        output = (
            encode({"passed": False, "findings": [asdict(finding)]})
            if options.output_format == "json" or options.snapshot
            else f"ERROR: {error}"
        )
        result = EXIT_INPUT, output
    return result
