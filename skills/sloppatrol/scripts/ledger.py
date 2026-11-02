#!/usr/bin/env python3
# SPDX-FileCopyrightText: 2026 Agent Labs
# SPDX-License-Identifier: MIT
"""Anchor review findings to source quotes and remember verdicts across runs."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import subprocess
import sys
from datetime import date, datetime, timezone
from pathlib import Path, PureWindowsPath
from tempfile import NamedTemporaryFile
from typing import Any

sys.dont_write_bytecode = True

# The marker grammar, coverage window and registered ids have one definition, in the sibling gate.py.
# Running a script puts its own directory first on sys.path, so this resolves wherever the pair sits.
import gate  # noqa: E402 (after sys.dont_write_bytecode, so no __pycache__)


def git(root: Path, *args: str) -> subprocess.CompletedProcess[str] | None:
    try:
        return subprocess.run(
            ["git", "-C", str(root), *args],
            capture_output=True,
            check=False,
            encoding="utf-8",
            errors="surrogateescape",
        )
    except OSError:
        return None


def safe_path(root: Path, name: str) -> Path | None:
    """Reject absolute paths, Windows paths, NULs, and resolved symlink escapes."""
    if "\0" in name or "\\" in name or Path(name).is_absolute() or PureWindowsPath(name).drive:
        return None
    try:
        path = (root / name).resolve()
    except (OSError, ValueError, RuntimeError):
        return None
    return path if path.is_relative_to(root) else None


def reason_error(reason: str) -> str | None:
    words = re.findall(r"[^\W_]+", reason.casefold())
    if not words or " ".join(words) in gate.GENERIC_REASONS:
        return "generic or empty reason"
    if len(words) < 3:
        return "reason must contain at least three words"
    return None


FIELDS = ("lens", "file", "quote", "what", "why", "confidence")
STATUSES = ("open", "confirmed", "decide", "dismissed", "unproven", "bug", "fixed")
REASON_REQUIRED = ("decide", "dismissed", "unproven", "bug")
GUARD_REQUIRED = ("confirmed", "fixed")
GUARD = re.compile(r"(?P<kind>rule|settled|lens-only):\s*(?P<value>.*?)\s*")
TOOL_RULE = re.compile(r"[\w.-]+:\S+")
PROJECT_SKILL = ".agents/skills/sloppatrol-project/SKILL.md"
NAMED_ENTRY = re.compile(r"- \*\*(?P<name>[^*\n]+)\*\*")
FENCE = re.compile(r" {0,3}(?P<fence>`{3,}|~{3,})(?P<info>.*)")
OUTCOMES = {"CLEAN": 0, "FINDINGS": 0, "INCOMPLETE": 1, "FAILED": 2}

LEDGER_PATH = ".sloppatrol/ledger.json"


def fields(data: Any, required: tuple[str, ...], optional: tuple[str, ...] = ()) -> None:
    if not isinstance(data, dict):
        raise ValueError("expected an object")
    if unknown := data.keys() - set(required + optional):
        raise ValueError(f"unknown keys: {', '.join(sorted(unknown))}")
    if missing := set(required) - data.keys():
        raise ValueError(f"missing keys: {', '.join(sorted(missing))}")


def finding_shape(item: Any, extra: tuple[str, ...] = (), optional: tuple[str, ...] = ()) -> None:
    fields(item, FIELDS + extra, optional)
    for key in FIELDS:
        if not isinstance(item[key], str) or not item[key].strip():
            raise ValueError(f"{key} must be a non-empty string")
    if item["confidence"] not in ("high", "medium", "low"):
        raise ValueError("confidence must be high, medium, or low")


def run_shape(data: Any) -> None:
    fields(data, ("lenses", "scope", "files_read", "findings"), ("notes",))
    for key in ("lenses", "scope", "files_read"):
        if not isinstance(data[key], list) or not all(
            isinstance(value, str) and value.strip() for value in data[key]
        ):
            raise ValueError(f"{key} must be a list of non-empty strings")
    for key in ("lenses", "files_read"):
        if not data[key]:
            raise ValueError(f"{key} is empty")
    if not isinstance(data.get("notes", ""), str):
        raise ValueError("notes must be a string")
    if not isinstance(data["findings"], list):
        raise ValueError("findings must be a list")
    for index, item in enumerate(data["findings"]):
        try:
            finding_shape(item)
        except ValueError as error:
            raise ValueError(f"findings[{index}]: {error}") from error


def normalize(quote: str) -> list[str]:
    return [" ".join(line.split()) for line in quote.splitlines()]


def finding_id(item: dict[str, Any]) -> str:
    anchor = "\0".join((item["lens"], item["file"], "\n".join(normalize(item["quote"]))))
    return hashlib.sha256(anchor.encode("utf-8")).hexdigest()[:10]


def matches(content: str, quote: str) -> list[int]:
    lines, wanted = normalize(content), normalize(quote)
    return [i + 1 for i in range(len(lines) - len(wanted) + 1) if lines[i : i + len(wanted)] == wanted]


def rooted(root: Path, name: str) -> Path:
    path = safe_path(root, name)
    if path is None:
        raise ValueError(f"{name}: path is absolute or escapes root")
    return path


def read_source(root: Path, name: str) -> str:
    return rooted(root, name).read_text(encoding="utf-8")


def registered(root: Path) -> tuple[set[str], set[str]]:
    """(rule ids, every registered id) as the gate discovers them; a broken .sloppatrol config is an error."""
    try:
        rules, ids = gate.discover(root, gate.corpus(root))
    except gate.GateError as error:
        raise ValueError(f"gate config: {error}") from error
    return set(rules), ids


def entry_key(name: str) -> str:
    return " ".join(name.casefold().split())


def named_entries(root: Path) -> dict[str, set[str]]:
    """The project skill's `- **<name>**` entries under its Settled and Anti-patterns headings."""
    try:
        text = (root / PROJECT_SKILL).read_text(encoding="utf-8")
    except OSError as error:
        raise ValueError(
            f"a settled guard needs the project skill {PROJECT_SKILL}: {error.strerror}"
        ) from error
    entries: dict[str, set[str]] = {"Settled": set(), "Anti-patterns": set()}
    section, fence = None, ""
    for line in text.splitlines():
        marker = FENCE.fullmatch(line)
        if fence:
            # A fence closes only on the same character, at least as long, with nothing after it.
            closes = marker and marker["fence"][0] == fence[0] and len(marker["fence"]) >= len(fence)
            if closes and not marker["info"].strip():
                fence = ""
        elif marker:
            fence = marker["fence"]
        elif heading := re.match(r"#{1,2} (.*)", line):
            section = heading[1].strip()
        elif section in entries and (match := NAMED_ENTRY.match(line)):
            entries[section].add(entry_key(match["name"]))
    return entries


def check_settled(root: Path, name: str) -> None:
    """A settled guard names an Anti-patterns entry; a Settled entry tells verifiers to dismiss the shape."""
    entries = named_entries(root)
    if entry_key(name) in entries["Settled"]:
        raise ValueError(
            f"guard names a Settled entry, which verifiers dismiss; name the Anti-patterns entry: {name}"
        )
    if entry_key(name) in entries["Anti-patterns"]:
        return
    raise ValueError(f"guard names no Anti-patterns entry (`- **<name>**: ...`) in {PROJECT_SKILL}: {name}")


def guard_kind(guard: str) -> str:
    """rule, tool-rule, settled or lens-only; raises ValueError on anything else."""
    match = GUARD.fullmatch(guard)
    if not match or not match["value"]:
        raise ValueError("guard must be rule:<id>, rule:<tool>:<code>, settled:<name> or 'lens-only: <why>'")
    if match["kind"] == "lens-only" and (error := reason_error(match["value"])):
        raise ValueError(f"lens-only guard: {error}")
    if match["kind"] == "rule" and ":" in match["value"]:
        if not TOOL_RULE.fullmatch(match["value"]):
            raise ValueError("guard must be rule:<tool>:<code>")
        return "tool-rule"
    return match["kind"]


def ledger_items(data: Any) -> dict[str, Any]:
    """Validate one v1 ledger document and return its items keyed by id."""
    fields(data, ("schema_version", "items"))
    if type(data["schema_version"]) is not int or data["schema_version"] != 1:
        raise ValueError("ledger schema_version must be 1")
    if not isinstance(data["items"], list):
        raise ValueError("ledger items must be a list")
    items = {}
    for item in data["items"]:
        finding_shape(item, ("id", "status", "reason", "first_seen", "updated"), ("guard",))
        if item["id"] != finding_id(item) or item["id"] in items:
            raise ValueError("ledger id is incorrect or duplicated")
        if item["status"] not in STATUSES or not isinstance(item["reason"], str):
            raise ValueError("invalid ledger status or reason")
        if item["status"] in REASON_REQUIRED and (error := reason_error(item["reason"])):
            raise ValueError(error)
        if "guard" in item:
            if not isinstance(item["guard"], str):
                raise ValueError("guard must be a string")
            guard_kind(item["guard"])
        for key in ("first_seen", "updated"):
            if not isinstance(item[key], str) or date.fromisoformat(item[key]).isoformat() != item[key]:
                raise ValueError(f"{key} must be a YYYY-MM-DD date")
        items[item["id"]] = item
    return items


def load_ledger(path: Path) -> dict[str, Any]:
    """Load the single v1 ledger file, or an empty ledger when it does not exist."""
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return {}
    return ledger_items(data)


def ordered(items: dict[str, Any]) -> list[dict[str, Any]]:
    return sorted(items.values(), key=lambda item: (item["file"], item["id"]))


def render_v1(items: list[dict[str, Any]]) -> str:
    return json.dumps({"schema_version": 1, "items": items}, indent=2) + "\n"


def write_atomic(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with NamedTemporaryFile(mode="w", encoding="utf-8", dir=path.parent, delete=False) as stream:
        temporary = Path(stream.name)
        try:
            stream.write(text)
            stream.close()
            temporary.replace(path)
        finally:
            temporary.unlink(missing_ok=True)


def save_ledger(path: Path, items: dict[str, Any]) -> None:
    write_atomic(path, render_v1(ordered(items)))


def check_finding(item: dict[str, Any], root: Path, ids: set[str], data: dict[str, Any]) -> dict[str, Any]:
    result: dict[str, Any] = dict(item, id=finding_id(item), line=None, status="UNVERIFIABLE", notes=[])
    try:
        path = rooted(root, item["file"])
        scope = {safe_path(root, name) for name in data["scope"]}
        read = {safe_path(root, name) for name in data["files_read"]}
        if path not in scope:
            raise ValueError("finding file outside scope")
        if path not in read:
            raise ValueError("finding file not in files_read")
        if item["lens"] not in ids or item["lens"] not in data["lenses"]:
            raise ValueError("finding lens unknown or not in run's lenses")
        content = read_source(root, item["file"])
        locations = matches(content, item["quote"])
        if not locations:
            raise ValueError("quote not found")
    except (OSError, ValueError) as error:
        result["notes"].append(str(error))
        return result
    result.update(line=locations[0], status="REPORTED")
    if len(locations) > 1:
        result["notes"].append(f"quote matches {len(locations)} places; first used")
    for marker in gate.scan_markers(item["file"], content, ids):
        if marker["id"] not in {None, item["lens"]} or not gate.marker_covers(
            item["file"], content, marker["line"], locations[0]
        ):
            continue
        if marker["error"] is None:
            result.update(status="SUPPRESSED", suppression=marker)
            break
        result["notes"].append(f"invalid marker at line {marker['line']}: {marker['error']}")
    return result


def check_run(name: str, root: Path, ids: set[str], ledger: dict[str, Any]) -> dict[str, Any]:
    result: dict[str, Any] = {"input": name, "outcome": "FAILED", "findings": [], "notes": []}
    try:
        data = json.loads((root / name).read_text(encoding="utf-8"))
        run_shape(data)
    except (OSError, ValueError) as error:
        result["notes"].append(str(error))
        return result
    result["review_notes"] = data.get("notes", "")
    result["notes"].extend(f"unknown lens: {lens}" for lens in sorted(set(data["lenses"]) - ids))
    read = {safe_path(root, name) for name in data["files_read"]}
    for file in sorted(set(data["scope"])):
        try:
            read_source(root, file)
            if safe_path(root, file) not in read:
                raise ValueError("scope file not in files_read")
        except (OSError, ValueError) as error:
            result["notes"].append(f"{file}: {error}")
    for item in data["findings"]:
        finding = check_finding(item, root, ids, data)
        previous = ledger.get(finding["id"])
        if previous and previous["status"] in (*REASON_REQUIRED, "fixed"):
            finding["previous"] = {key: previous[key] for key in ("status", "reason")}
        result["findings"].append(finding)
    statuses = [item["status"] for item in result["findings"]]
    result["outcome"] = (
        "INCOMPLETE"
        if result["notes"] or "UNVERIFIABLE" in statuses
        else "FINDINGS"
        if "REPORTED" in statuses
        else "CLEAN"
    )
    return result


def print_run(result: dict[str, Any]) -> None:
    print(f"{result['input']}: {result['outcome']}")
    for note in [*result["notes"], result.get("review_notes", "")]:
        if note:
            print(f"  {note}")
    for item in result["findings"]:
        print(
            f"{item['file']}:{item['line'] or '?'} [{item['lens']}] "
            f"{item['id']} {item['confidence']} {item['what']}"
        )
        if item["status"] != "REPORTED":
            print(f"  {item['status']}")
        if previous := item.get("previous"):
            print(f"  PREVIOUSLY {previous['status'].upper()}: {previous['reason']}")
        for note in item["notes"]:
            print(f"  {note}")


def current_line(root: Path, item: dict[str, Any]) -> int | None:
    try:
        locations = matches(read_source(root, item["file"]), item["quote"])
    except (FileNotFoundError, NotADirectoryError, IsADirectoryError):
        return None
    return locations[0] if locations else None


def list_items(root: Path, items: dict[str, Any], args: argparse.Namespace) -> int:
    selected = [item for item in items.values() if not args.status or item["status"] in args.status]
    selected.sort(key=lambda item: (STATUSES.index(item["status"]), item["file"], item["id"]))
    output = [dict(item, guard=item.get("guard"), line=current_line(root, item)) for item in selected]
    if args.as_json:
        print(json.dumps(output, indent=2))
    elif not output:
        print("no items" + (f" with status {', '.join(args.status)}" if args.status else ""))
    else:
        group = None
        for item in output:
            if item["status"] != group:
                group = item["status"]
                print(f"{group}:")
            location = str(item["line"]) if item["line"] else "gone"
            if not item["line"] and item["status"] in ("open", "confirmed", "unproven"):
                location += "; verify and mark fixed"
            print(f"  {item['id']} {item['file']}:{location} [{item['lens']}] {item['what']}")
            if item["reason"]:
                print(f"    {item['reason']}")
            if item["guard"]:
                print(f"    guard: {item['guard']}")
    return 0


def check_guard(root: Path, items: dict[str, Any], args: argparse.Namespace) -> None:
    """confirmed and fixed need a guard, given now or stored by an earlier verdict."""
    if args.guard is not None:
        if args.status not in GUARD_REQUIRED:
            raise ValueError("--guard applies only to confirmed and fixed")
        name = args.guard.partition(":")[2].strip()
        kind = guard_kind(args.guard)
        if kind == "rule" and name not in registered(root)[0]:
            raise ValueError(f"guard names no rule in .sloppatrol/rules or .sloppatrol/scripts: {name}")
        if kind == "settled":
            check_settled(root, name)
    elif args.status in GUARD_REQUIRED:
        for identity in args.ids:
            if not items[identity].get("guard"):
                raise ValueError(f"{identity}: {args.status} needs --guard")


def stale_guards(root: Path, items: dict[str, Any]) -> list[str]:
    """Stored guards that name a rule or Anti-patterns entry that no longer exists.

    `set` resolves a guard when it is written; a rule retired afterwards leaves a guard that guards
    nothing and that load-time parsing accepts. Settled guards are checked against the same entries.
    """
    guarded = [(item, guard_kind(item["guard"])) for item in items.values() if item.get("guard")]
    rules = registered(root)[0] if any(kind == "rule" for _, kind in guarded) else set()
    anti = named_entries(root)["Anti-patterns"] if any(kind == "settled" for _, kind in guarded) else set()
    stale = []
    for item, kind in guarded:
        name = item["guard"].partition(":")[2].strip()
        if kind == "rule" and name not in rules:
            stale.append(
                f"{item['id']}: guard names no rule in .sloppatrol/rules or .sloppatrol/scripts: {name}"
            )
        if kind == "settled" and entry_key(name) not in anti:
            stale.append(f"{item['id']}: guard names no Anti-patterns entry in {PROJECT_SKILL}: {name}")
    return stale


def report_guards(root: Path, items: dict[str, Any]) -> int:
    stale = stale_guards(root, items)
    print("\n".join(stale) if stale else f"{len(items)} items, every stored guard resolves")
    return 1 if stale else 0


def set_items(root: Path, items: dict[str, Any], args: argparse.Namespace) -> int:
    for identity in args.ids:
        if identity not in items:
            raise ValueError(f"unknown id: {identity}")
    if args.status in REASON_REQUIRED and (error := reason_error(args.reason)):
        raise ValueError(error)
    check_guard(root, items, args)
    if args.status == "fixed":
        present = [(items[identity], current_line(root, items[identity])) for identity in args.ids]
        if any(line for _, line in present):
            for item, line in present:
                if line:
                    print(f"{item['id']}: still present at {item['file']}:{line}")
            return 1
    today = datetime.now(timezone.utc).date().isoformat()
    for identity in args.ids:
        item = items[identity]
        item.update(status=args.status, reason=args.reason, updated=today)
        if args.status not in GUARD_REQUIRED:
            item.pop("guard", None)
        elif args.guard is not None:
            item["guard"] = args.guard
    return 0


def add_items(items: dict[str, Any], results: list[dict[str, Any]]) -> list[str]:
    messages = []
    today = datetime.now(timezone.utc).date().isoformat()
    for result in results:
        for finding in result["findings"]:
            if finding["status"] != "REPORTED":
                continue
            identity = finding["id"]
            messages.append(f"{'kept' if identity in items else 'added'} {identity}")
            if identity not in items:
                items[identity] = dict(
                    id=identity,
                    **{key: finding[key] for key in FIELDS},
                    status="open",
                    reason="",
                    first_seen=today,
                    updated=today,
                )
            items[identity]["updated"] = today
    return messages


def rekey_ledger(path: Path) -> int:
    """Recompute ids that no longer match their lens, file and quote.

    A finding's id hashes its file, so a refactor that moves the file (or edits a quote) leaves an id
    that fails validation, and then every command fails before it reads a finding. Only the ids
    change; verdicts, reasons and guards are kept.
    """
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        print("no ledger")
        return 0
    if not isinstance(data, dict) or data.get("schema_version") != 1:
        raise ValueError("ledger schema_version must be 1")
    if not isinstance(data.get("items"), list):
        raise ValueError("ledger items must be a list")
    moved = []
    for item in data["items"]:
        finding_shape(item, ("id", "status", "reason", "first_seen", "updated"), ("guard",))
        if (new := finding_id(item)) != item["id"]:
            moved.append(f"{item['id']} -> {new}  {item['file']}")
            item["id"] = new
    unique = {item["id"] for item in data["items"]}
    if len(unique) != len(data["items"]):
        raise ValueError("rekey would make two findings share an id; merge them by hand")
    if moved:
        write_atomic(path, render_v1(ordered({item["id"]: item for item in data["items"]})))
    print("\n".join(moved) if moved else "every id matches")
    return 0


LEDGER_COMMANDS = ("list", "guards", "set")


def ledger_command(root: Path, path: Path, items: dict[str, Any], args: argparse.Namespace) -> int:
    """The commands that read or write the ledger without a run file."""
    if args.command == "list":
        return list_items(root, items, args)
    if args.command == "guards":
        return report_guards(root, items)
    code = set_items(root, items, args)
    if not code:
        save_ledger(path, items)
        print("\n".join(f"{identity} {args.status}" for identity in args.ids))
    return code


def argument_parser() -> argparse.ArgumentParser:
    plain: dict[str, Any] = {"color": False} if sys.version_info >= (3, 14) else {}
    parser = argparse.ArgumentParser(description=__doc__, **plain)
    parser.add_argument("--root", type=Path, help="repository root (default: git toplevel or cwd)")
    commands = parser.add_subparsers(dest="command", required=True)
    for command in ("check", "add", "set", "list", "guards", "rekey"):
        sub = commands.add_parser(command, **plain)
        sub.add_argument("--root", type=Path, default=argparse.SUPPRESS, help="repository root")
        if command in ("check", "add"):
            sub.add_argument("runs", metavar="RUN", nargs="+")
        if command in ("check", "list"):
            sub.add_argument("--json", action="store_true", dest="as_json")
        if command == "add":
            sub.add_argument("--partial", action="store_true", help="add only valid, unsuppressed findings")
        if command == "set":
            sub.add_argument("ids", metavar="ID", nargs="+")
            sub.add_argument("--status", choices=STATUSES, required=True)
            sub.add_argument("--reason", default="")
            sub.add_argument("--guard", help="what stops a recurrence; required for confirmed and fixed")
        if command == "list":
            sub.add_argument("--status", choices=STATUSES, action="append")
    return parser


def main() -> int:
    parser = argument_parser()
    args = parser.parse_args()
    try:
        toplevel = git(Path.cwd(), "rev-parse", "--show-toplevel") if args.root is None else None
        root = (
            args.root
            or Path(toplevel.stdout.rstrip("\n") if toplevel and not toplevel.returncode else Path.cwd())
        ).resolve()
        if not root.is_dir():
            raise ValueError("--root must be an existing directory")
        path = rooted(root, LEDGER_PATH)
        if args.command == "rekey":
            return rekey_ledger(path)
        items = load_ledger(path)
        if args.command in LEDGER_COMMANDS:
            return ledger_command(root, path, items, args)
        ids = registered(root)[1]
        results = [check_run(name, root, ids, items) for name in args.runs]
        if args.command == "check" and args.as_json:
            print(json.dumps(results, indent=2))
        else:
            for result in results:
                print_run(result)
        code = max(OUTCOMES[result["outcome"]] for result in results)
        if args.command == "check":
            return code
        if code and not args.partial:
            print("add refused: use --partial to add valid findings from non-FAILED runs")
            return 1
        messages = add_items(items, results)
        save_ledger(path, items)
        for message in messages:
            print(message)
        return 0
    except (OSError, ValueError, RuntimeError) as error:
        # A refused value, not a mistyped command: no usage line.
        print(f"ledger.py: {error}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
