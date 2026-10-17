"""Parse the native JSON ledger with strict shape and duplicate-key checks."""

from __future__ import annotations

import hashlib
import json
import re
from dataclasses import replace
from enum import StrEnum
from typing import TYPE_CHECKING, NoReturn

if TYPE_CHECKING:
    from pathlib import Path

from .model import (
    Acceptance,
    Change,
    ChangeAction,
    Checkpoint,
    Environment,
    Evidence,
    EvidenceKind,
    Fingerprint,
    Ledger,
    PendingOperation,
    RedProof,
    Requirement,
    ResultStatus,
    RuleSource,
    Task,
    TaskStatus,
    Work,
)

SCHEMA_VERSION = 1
LEDGER_OPEN = "```quality-ledger"
LEDGER_CLOSE = "```"
DIGEST_PATTERN = re.compile(r"[0-9a-f]{64}\Z")
IDENTIFIER_PATTERN = re.compile(r"[A-Za-z][A-Za-z0-9_.:-]{0,63}\Z")
MAX_PLAN_BYTES = 4 * 1024 * 1024
MAX_RECORDS = 1000
CONTROL_CHARACTER_LIMIT = 32

type Json = bool | int | float | str | list[Json] | dict[str, Json] | None


class PlanError(ValueError):
    """Report unreadable or malformed input rather than a failed quality claim."""


def fail(location: str, message: str, *, cause: Exception | None = None) -> NoReturn:
    """Raise one consistently located input error with an optional underlying cause."""
    detail = f"{location}: {message}"
    raise PlanError(detail) from cause


def unique_object(pairs: list[tuple[str, Json]]) -> dict[str, Json]:
    """Reject duplicate JSON keys instead of silently keeping the final value."""
    result: dict[str, Json] = {}
    for key, value in pairs:
        if key in result:
            fail(key, "duplicate JSON key")
        result[key] = value
    return result


def reject_constant(value: str) -> None:
    """Reject non-JSON NaN and infinity constants."""
    fail("JSON", f"invalid numeric constant {value}")


def parse_json(text: str) -> object:
    """Decode JSON without accepting duplicate keys or non-finite constants."""
    try:
        value: object = json.loads(
            text, object_pairs_hook=unique_object, parse_constant=reject_constant
        )
    except json.JSONDecodeError as error:
        fail("JSON", f"{error.msg} at line {error.lineno}", cause=error)
    except PlanError:
        raise
    except ValueError as error:
        fail("JSON", "numeric value exceeds supported parser limits", cause=error)
    except RecursionError as error:
        fail("JSON", "nesting exceeds the supported parser depth", cause=error)
    return value


class Record:
    """Read one object with explicit allowed fields and located type errors."""

    def __init__(self, value: object, location: str, fields: str) -> None:
        """Require the exact documented field set for an object."""
        if not isinstance(value, dict) or not all(isinstance(key, str) for key in value):
            fail(location, "expected an object with string keys")
        self.data: dict[str, object] = dict(value)
        self.location = location
        allowed = set(fields.split())
        unknown = set(self.data) - allowed
        missing = allowed - set(self.data)
        if unknown:
            fail(location, f"unknown fields: {', '.join(sorted(unknown))}")
        if missing:
            fail(location, f"missing fields: {', '.join(sorted(missing))}")

    def text(self, key: str) -> str:
        """Read nonempty text without control characters."""
        value = self.data[key]
        if not isinstance(value, str) or not value.strip():
            fail(f"{self.location}.{key}", "expected nonempty text")
        if any(
            ord(character) < CONTROL_CHARACTER_LIMIT and character not in "\n\t"
            for character in value
        ):
            fail(f"{self.location}.{key}", "control characters are not allowed")
        return value

    def optional_text(self, key: str) -> str | None:
        """Read explicit null or nonempty text."""
        return None if self.data[key] is None else self.text(key)

    def integer(self, key: str) -> int:
        """Read an integer without accepting a boolean as an integer."""
        value = self.data[key]
        if not isinstance(value, int) or isinstance(value, bool):
            fail(f"{self.location}.{key}", "expected an integer")
        return value

    def identifier(self, key: str = "id") -> str:
        """Read an ID suitable for deterministic cross-references."""
        value = self.text(key)
        if not IDENTIFIER_PATTERN.fullmatch(value):
            fail(f"{self.location}.{key}", "invalid identifier")
        return value

    def digest(self, key: str) -> str:
        """Read a lowercase SHA-256 digest."""
        value = self.text(key)
        if not DIGEST_PATTERN.fullmatch(value):
            fail(f"{self.location}.{key}", "expected a lowercase SHA-256 digest")
        return value

    def items(self, key: str) -> list[object]:
        """Read a JSON array without inventing an absent empty value."""
        value = self.data[key]
        if not isinstance(value, list):
            fail(f"{self.location}.{key}", "expected an array")
        return list(value)

    def texts(self, key: str) -> tuple[str, ...]:
        """Read an array of nonempty strings."""
        values = self.items(key)
        result = []
        for index, value in enumerate(values):
            item = Record({"value": value}, f"{self.location}.{key}[{index}]", "value")
            result.append(item.text("value"))
        return tuple(result)

    def choice[T: StrEnum](self, key: str, enum: type[T]) -> T:
        """Read a supported enum value with a located error."""
        value = self.text(key)
        try:
            return enum(value)
        except ValueError as error:
            fail(f"{self.location}.{key}", f"unsupported value {value}", cause=error)


def read_environment(value: object, location: str) -> Environment:
    """Read explicit runtime identity and observed tool versions."""
    record = Record(value, location, "platform tools")
    tools = record.data["tools"]
    if not isinstance(tools, dict) or not tools:
        fail(f"{location}.tools", "expected a nonempty tool-version object")
    versions: dict[str, str] = {}
    for key, version in tools.items():
        if not isinstance(key, str) or not key.strip():
            fail(location, "tool names must be nonempty strings")
        item = Record({"version": version}, f"{location}.tools.{key}", "version")
        versions[key] = item.text("version")
    return Environment(record.text("platform"), versions)


def read_fingerprint(value: object, location: str) -> Fingerprint:
    """Read a content digest or an explicit absent-path observation."""
    record = Record(value, location, "path sha256")
    digest = None if record.data["sha256"] is None else record.digest("sha256")
    return Fingerprint(record.text("path"), digest)


def read_fingerprints(record: Record, key: str) -> tuple[Fingerprint, ...]:
    """Read an ordered list of file observations."""
    return tuple(
        read_fingerprint(value, f"{record.location}.{key}[{index}]")
        for index, value in enumerate(record.items(key))
    )


def read_work(value: object) -> Work:
    """Read scope identity and canonical input references."""
    record = Record(
        value, "work", "id title scope_revision brief brief_reason rules inputs environment"
    )
    rules = []
    for index, rule in enumerate(record.items("rules")):
        item = Record(rule, f"work.rules[{index}]", "path revision")
        rules.append(RuleSource(item.text("path"), item.text("revision")))
    return Work(
        record.identifier(),
        record.text("title"),
        record.integer("scope_revision"),
        record.optional_text("brief"),
        record.optional_text("brief_reason"),
        tuple(rules),
        record.texts("inputs"),
        read_environment(record.data["environment"], "work.environment"),
    )


def read_requirement(value: object, location: str) -> Requirement:
    """Read one requirement without deriving intent from its task wording."""
    record = Record(value, location, "id statement priority acceptance superseded_by")
    return Requirement(
        record.identifier(),
        record.text("statement"),
        record.text("priority"),
        record.texts("acceptance"),
        record.optional_text("superseded_by"),
    )


def read_acceptance(value: object, location: str) -> Acceptance:
    """Read observable acceptance and explicit evidence applicability."""
    record = Record(value, location, "id requirement given when then checks manual_reason")
    checks = []
    for index, check in enumerate(record.items("checks")):
        item = Record({"kind": check}, f"{location}.checks[{index}]", "kind")
        checks.append(item.choice("kind", EvidenceKind))
    return Acceptance(
        record.identifier(),
        record.identifier("requirement"),
        record.text("given"),
        record.text("when"),
        record.text("then"),
        tuple(checks),
        record.optional_text("manual_reason"),
    )


def read_task(value: object, location: str) -> Task:
    """Read task dependencies, owned changes, progress, and evidence references."""
    record = Record(
        value,
        location,
        "id purpose acceptance depends_on changes status evidence blocker superseded_by",
    )
    changes = []
    for index, change in enumerate(record.items("changes")):
        item = Record(change, f"{location}.changes[{index}]", "path action")
        changes.append(Change(item.text("path"), item.choice("action", ChangeAction)))
    return Task(
        record.identifier(),
        record.text("purpose"),
        record.texts("acceptance"),
        record.texts("depends_on"),
        tuple(changes),
        record.choice("status", TaskStatus),
        record.texts("evidence"),
        record.optional_text("blocker"),
        record.optional_text("superseded_by"),
    )


def read_red(value: object, location: str) -> RedProof:
    """Read the three outcomes and before/after observations of a red drill."""
    record = Record(
        value,
        location,
        "mutation baseline_exit mutated_exit restored_exit expected_diagnostic "
        "observed_diagnostic before mutated after",
    )
    return RedProof(
        record.text("mutation"),
        record.integer("baseline_exit"),
        record.integer("mutated_exit"),
        record.integer("restored_exit"),
        record.text("expected_diagnostic"),
        record.text("observed_diagnostic"),
        read_fingerprints(record, "before"),
        read_fingerprints(record, "mutated"),
        read_fingerprints(record, "after"),
    )


def read_evidence(value: object, location: str) -> Evidence:
    """Read a receipt without interpreting recorded commands as executable input."""
    record = Record(
        value,
        location,
        "id acceptance kind status command method environment exit_code artifact "
        "inputs scope_sha256 red reason",
    )
    return Evidence(
        record.identifier(),
        record.texts("acceptance"),
        record.choice("kind", EvidenceKind),
        record.choice("status", ResultStatus),
        record.texts("command"),
        record.text("method"),
        read_environment(record.data["environment"], f"{location}.environment"),
        None if record.data["exit_code"] is None else record.integer("exit_code"),
        None
        if record.data["artifact"] is None
        else read_fingerprint(record.data["artifact"], f"{location}.artifact"),
        read_fingerprints(record, "inputs"),
        None if record.data["scope_sha256"] is None else record.digest("scope_sha256"),
        None if record.data["red"] is None else read_red(record.data["red"], f"{location}.red"),
        record.optional_text("reason"),
    )


def read_checkpoint(value: object) -> Checkpoint:
    """Read the last complete boundary and unresolved external outcomes."""
    record = Record(
        value,
        "checkpoint",
        "scope_sha256 inputs environment verified_tasks pending_operations "
        "next_action source_revision",
    )
    operations = []
    for index, operation in enumerate(record.items("pending_operations")):
        item = Record(
            operation, f"checkpoint.pending_operations[{index}]", "id description next_action"
        )
        operations.append(
            PendingOperation(item.identifier(), item.text("description"), item.text("next_action"))
        )
    return Checkpoint(
        record.digest("scope_sha256"),
        read_fingerprints(record, "inputs"),
        read_environment(record.data["environment"], "checkpoint.environment"),
        record.texts("verified_tasks"),
        tuple(operations),
        record.text("next_action"),
        record.optional_text("source_revision"),
    )


def read_ledger(value: object) -> Ledger:
    """Decode the exact supported ledger schema."""
    record = Record(
        value, "ledger", "schema_version work requirements acceptance tasks evidence checkpoint"
    )
    version = record.integer("schema_version")
    if version != SCHEMA_VERSION:
        fail("schema_version", f"unsupported version {version}")
    if (
        sum(len(record.items(key)) for key in ("requirements", "acceptance", "tasks", "evidence"))
        > MAX_RECORDS
    ):
        fail("ledger", "split work units larger than 1000 records into separate plans")
    return Ledger(
        version,
        read_work(record.data["work"]),
        tuple(
            read_requirement(item, f"requirements[{index}]")
            for index, item in enumerate(record.items("requirements"))
        ),
        tuple(
            read_acceptance(item, f"acceptance[{index}]")
            for index, item in enumerate(record.items("acceptance"))
        ),
        tuple(
            read_task(item, f"tasks[{index}]") for index, item in enumerate(record.items("tasks"))
        ),
        tuple(
            read_evidence(item, f"evidence[{index}]")
            for index, item in enumerate(record.items("evidence"))
        ),
        None if record.data["checkpoint"] is None else read_checkpoint(record.data["checkpoint"]),
    )


def ledger_bounds(text: str) -> tuple[int, int]:
    """Locate exactly one dedicated fenced record without parsing arbitrary Markdown."""
    lines = text.splitlines(keepends=True)
    starts = [index for index, line in enumerate(lines) if line.rstrip("\r\n") == LEDGER_OPEN]
    if len(starts) != 1:
        fail("plan", "expected exactly one quality-ledger fence")
    start = starts[0]
    for end in range(start + 1, len(lines)):
        if lines[end].rstrip("\r\n") == LEDGER_CLOSE:
            return sum(map(len, lines[: start + 1])), sum(map(len, lines[:end]))
    fail("plan", "quality-ledger fence is not closed")


def read_input(path: Path) -> bytes:
    """Read a bounded input before any decoder or digest can consume unbounded memory."""
    try:
        with path.open("rb") as stream:
            raw = stream.read(MAX_PLAN_BYTES + 1)
        if len(raw) > MAX_PLAN_BYTES:
            fail("plan", "file exceeds the supported 4 MiB limit")
    except OSError as error:
        fail("plan", str(error), cause=error)
    return raw


def parse_plan(raw: bytes, plan_path: str | None = None) -> tuple[str, Ledger]:
    """Decode source bytes and its one authoritative ledger."""
    try:
        text = raw.decode("utf-8-sig")
    except UnicodeError as error:
        fail("plan", "source must be UTF-8", cause=error)
    start, end = ledger_bounds(text)
    prose = (text[:start] + text[end:]).replace("\r\n", "\n")
    digest = hashlib.sha256(prose.encode("utf-8")).hexdigest()
    ledger = replace(
        read_ledger(parse_json(text[start:end])), prose_sha256=digest, plan_path=plan_path
    )
    return text, ledger


def load_plan(path: Path) -> tuple[str, Ledger]:
    """Load bounded UTF-8 source and its one authoritative ledger."""
    return parse_plan(read_input(path), path.name)
