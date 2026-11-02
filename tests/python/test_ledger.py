from __future__ import annotations

import hashlib
import json
import shutil
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

import pytest
from conftest import SCRIPTS, check_run, finding, git, review, run_script, write


@pytest.fixture
def repo(tmp_path: Path) -> Path:
    git(tmp_path, "init", "-q")
    write(tmp_path, "src/a.lua", "local function unused()\n    return 1\nend\n")
    return tmp_path


def ledger(root: Path) -> dict:
    return json.loads((root / ".sloppatrol/ledger.json").read_text())


def project_rules(root: Path) -> None:
    """One ast-grep rule (local-rule) and one script rule (one-head), each valid for the gate."""
    write(root, ".sloppatrol/rules/local-rule.yml", "id: local-rule\nmessage: Avoid bad\nnote: Use good\n")
    write(
        root,
        ".sloppatrol/rule-tests/local-rule-test.yml",
        "id: local-rule\nvalid:\n  - good()\ninvalid:\n  - bad()\n",
    )
    script = write(root, ".sloppatrol/scripts/one-head.sh", "#!/bin/sh\n# sloppatrol-fix: Keep one head\n")
    script.chmod(0o755)
    for case, expected in (("clean", ""), ("hit", "a.txt:1\n")):
        write(root, f".sloppatrol/script-tests/one-head/{case}/head/a.txt", "x\n")
        write(root, f".sloppatrol/script-tests/one-head/{case}/expected", expected)


def project_skill(root: Path) -> None:
    """One named Settled entry and one named Anti-patterns entry, as the setup template writes them."""
    write(
        root,
        ".agents/skills/sloppatrol-project/SKILL.md",
        "## Settled\n\n- **Host callbacks** (dead-code): the client calls them by name, e.g. `a.lua`\n\n"
        "## Anti-patterns\n\n- **Plugin  entry points** (dead-code): kept after a rename, e.g. `a.lua:1`\n",
    )


def add(root: Path, **changes: object) -> str:
    result = run_script("ledger.py", root, "add", str(review(root, **changes)))
    assert result.returncode == 0, result.stdout + result.stderr
    return ledger(root)["items"][0]["id"]


@pytest.mark.parametrize("has_findings", [False, True])
def test_check_outcomes(repo: Path, has_findings: bool) -> None:
    path = review(repo, findings=[finding()] if has_findings else [], notes="Reviewed all callers.")
    code, data = check_run(repo, path)
    assert (code, data["outcome"]) == (0, "FINDINGS" if has_findings else "CLEAN")
    assert data["review_notes"] == "Reviewed all callers."
    human = run_script("ledger.py", repo, "check", str(path))
    assert "Reviewed all callers." in human.stdout
    if has_findings:
        identity = hashlib.sha256(b"dead-code\0src/a.lua\0local function unused()").hexdigest()[:10]
        assert f"src/a.lua:1 [dead-code] {identity} high Unused local function" in human.stdout


def test_multiline_quote_survives_line_move_and_commit(repo: Path) -> None:
    quote = "local function unused()\n\treturn   1"
    path = review(repo, findings=[finding(quote=quote)])
    code, before = check_run(repo, path)
    assert code == 0 and before["findings"][0]["line"] == 1
    for prefix in ("", "-- Added during the audit\n\n"):
        write(repo, "src/a.lua", prefix + "  local  function unused()\n return 1\nend\n")
        git(repo, "add", "src/a.lua")
        git(
            repo,
            "-c",
            "user.name=Test",
            "-c",
            "user.email=test@example.invalid",
            "-c",
            "commit.gpgsign=false",
            "commit",
            "-qm",
            "Audit fix",
        )
    code, after = check_run(repo, path)
    assert (code, after["outcome"]) == (0, "FINDINGS")
    assert after["findings"][0]["line"] == 3
    assert after["findings"][0]["id"] == before["findings"][0]["id"]


def test_ambiguous_quote_uses_first_match(repo: Path) -> None:
    write(repo, "src/a.lua", "return 1\nreturn 1\n")
    code, data = check_run(repo, review(repo, findings=[finding(quote="return 1")]))
    assert code == 0
    assert data["findings"][0]["line"] == 1
    assert data["findings"][0]["notes"] == ["quote matches 2 places; first used"]


@pytest.mark.parametrize(
    "changes, message",
    [
        ({"findings": [finding(quote="local function gone()")]}, "quote not found"),
        ({"findings": [finding(quote="local function unused()\nend")]}, "quote not found"),
        ({"scope": ["src/a.lua", "src/b.lua"]}, "not in files_read"),
        ({"scope": ["src/a.lua", "missing.lua"]}, "missing.lua"),
        ({"lenses": ["unknown"]}, "unknown lens"),
        ({"findings": [finding(lens="comment-narration")]}, "not in run's lenses"),
        ({"findings": [finding(file="src/b.lua")]}, "outside scope"),
    ],
)
def test_incomplete_runs(repo: Path, changes: dict, message: str) -> None:
    write(repo, "src/b.lua", "local function unused()\n")
    path = review(repo, **changes)
    code, data = check_run(repo, path)
    assert (code, data["outcome"]) == (1, "INCOMPLETE")
    assert message in run_script("ledger.py", repo, "check", str(path)).stdout


@pytest.mark.parametrize(
    "changes, message",
    [
        ({"head": "obsolete", "extra": True}, "unknown keys: extra, head"),
        ({"findings": [finding(line=1)]}, "findings[0]: unknown keys: line"),
        ({"files_read": []}, "files_read is empty"),
        ({"findings": [finding(confidence="certain")]}, "confidence must be"),
        ({"notes": []}, "notes must be a string"),
    ],
)
def test_schema_errors_fail(repo: Path, changes: dict, message: str) -> None:
    code, data = check_run(repo, review(repo, **changes))
    assert (code, data["outcome"]) == (2, "FAILED")
    assert message in data["notes"][0]


def test_unreadable_malformed_and_batch_outcomes(repo: Path) -> None:
    clean = review(repo, findings=[]).rename(repo / "clean.json")
    incomplete = review(repo, scope=["missing.lua"]).rename(repo / "incomplete.json")
    malformed = write(repo, "malformed.json", "{bad json")
    failed = [malformed, repo / "missing.json", repo / "src"]
    for path in failed:
        code, data = check_run(repo, path)
        assert (code, data["outcome"]) == (2, "FAILED")
    for paths, expected in (([clean], 0), ([clean, incomplete], 1), ([incomplete, *failed, clean], 2)):
        assert run_script("ledger.py", repo, "check", *map(str, paths), "--json").returncode == expected


@pytest.mark.parametrize(
    "name, marker, gap",
    [
        ("src/a.lua", "-- sloppatrol: dead-code - Called by external plugins", 0),
        ("code.py", "# sloppatrol: dead-code - Called by external plugins", 2),
        (
            "code.js",
            "// sloppatrol: dead-code - Called by external plugins\n// Loaded\n// by name\n// at runtime.",
            0,
        ),
        ("code.html", "<!-- sloppatrol: dead-code - Called by external plugins -->", 0),
    ],
)
def test_suppression_honoured_and_not_added(repo: Path, name: str, marker: str, gap: int) -> None:
    write(repo, name, marker + "\n" * (gap + 1) + "unused()\n")
    for quote in ("unused()", marker):
        path = review(repo, scope=[name], files_read=[name], findings=[finding(file=name, quote=quote)])
        code, data = check_run(repo, path)
        assert (code, data["outcome"]) == (0, "CLEAN")
        assert data["findings"][0]["status"] == "SUPPRESSED"
        assert "SUPPRESSED" in run_script("ledger.py", repo, "check", str(path)).stdout
        assert run_script("ledger.py", repo, "add", str(path)).returncode == 0
        assert ledger(repo)["items"] == []


@pytest.mark.parametrize(
    "marker, gap, message",
    [
        ("-- sloppatrol: dead-code - intentional", 0, "sloppatrol-weak-reason"),
        ("-- sloppatrol: dead-code - External callback", 0, "sloppatrol-weak-reason"),
        ("-- sloppatrol: dead-code - Called by external plugins", 3, ""),
        ("unused() -- sloppatrol: dead-code - Called by external plugins", 0, "sloppatrol-trailing-marker"),
        ("-- sloppatrol: dead-code: Called by external plugins", 0, "sloppatrol-bad-marker"),
        ("-- ast-grep-ignore: dead-code", 0, "sloppatrol-ast-grep-ignore"),
        ("# sloppatrol: dead-code - Called by external plugins", 0, ""),
    ],
)
def test_invalid_or_distant_suppression_cannot_hide_finding(
    repo: Path, marker: str, gap: int, message: str
) -> None:
    write(repo, "src/a.lua", marker + "\n" * (gap + 1) + "local function unused()\n")
    code, data = check_run(repo, review(repo))
    assert (code, data["outcome"]) == (0, "FINDINGS")
    assert data["findings"][0]["status"] == "REPORTED"
    if message:
        assert message in data["findings"][0]["notes"][0]


@pytest.mark.parametrize("status", ["decide", "dismissed", "unproven", "bug"])
def test_verdict_remembered_and_edited_code_resurfaces(repo: Path, status: str) -> None:
    identity = add(repo)
    reason = "Called by external plugins"
    assert (
        run_script("ledger.py", repo, "set", identity, "--status", status, "--reason", reason).returncode == 0
    )
    path = review(repo)
    result = run_script("ledger.py", repo, "check", str(path))
    assert result.returncode == 0 and f"PREVIOUSLY {status.upper()}: {reason}" in result.stdout
    assert add(repo) == identity
    assert ledger(repo)["items"][0]["status"] == status
    write(repo, "src/a.lua", "local function renamed()\nend\n")
    path = review(repo, findings=[finding(quote="local function renamed()")])
    code, data = check_run(repo, path)
    assert code == 0 and data["findings"][0]["id"] != identity
    assert "previous" not in data["findings"][0]
    assert run_script("ledger.py", repo, "add", str(path)).returncode == 0
    assert {item["status"] for item in ledger(repo)["items"]} == {status, "open"}


@pytest.mark.parametrize("parent_is_file", [False, True])
def test_list_treats_a_path_that_stopped_being_a_file_as_gone(repo: Path, parent_is_file: bool) -> None:
    add(repo)
    (repo / "src/a.lua").unlink()
    if parent_is_file:
        (repo / "src").rmdir()
        (repo / "src").write_text("now a file\n", encoding="utf-8")
    else:
        (repo / "src/a.lua").mkdir()
    result = run_script("ledger.py", repo, "list")
    assert result.returncode == 0 and "gone; verify and mark fixed" in result.stdout


@pytest.mark.parametrize("deleted", [False, True])
def test_fixed_refused_until_quote_gone_and_list_resolves_location(repo: Path, deleted: bool) -> None:
    identity = add(repo)
    guard = ("--guard", "rule:luacheck:211")
    result = run_script("ledger.py", repo, "set", identity, "--status", "fixed", *guard)
    assert result.returncode == 1 and "still present at src/a.lua:1" in result.stdout
    if deleted:
        (repo / "src/a.lua").unlink()
    else:
        write(repo, "src/a.lua", "return 2\n")
    result = run_script("ledger.py", repo, "list")
    assert result.returncode == 0 and "gone; verify and mark fixed" in result.stdout
    items = json.loads(run_script("ledger.py", repo, "list", "--json").stdout)
    assert items[0]["line"] is None
    assert run_script("ledger.py", repo, "set", identity, "--status", "fixed", *guard).returncode == 0
    assert ledger(repo)["items"][0]["status"] == "fixed"
    write(repo, "src/a.lua", "local function unused()\n")
    assert "PREVIOUSLY FIXED" in run_script("ledger.py", repo, "check", str(review(repo))).stdout


def test_add_refuses_whole_batch_and_partial_keeps_only_valid_findings(repo: Path) -> None:
    clean = review(repo).rename(repo / "valid.json")
    write(repo, "src/b.lua", "return 2\n")
    mixed = review(
        repo,
        scope=["src/a.lua", "src/b.lua"],
        findings=[
            finding(),
            finding(file="src/b.lua", quote="return 2"),
            finding(quote="missing()"),
        ],
    ).rename(repo / "mixed.json")
    bad = review(repo, extra=True)
    result = run_script("ledger.py", repo, "add", str(clean), str(mixed), str(bad))
    assert result.returncode == 1 and not (repo / ".sloppatrol/ledger.json").exists()
    result = run_script("ledger.py", repo, "add", str(clean), str(mixed), str(bad), "--partial")
    assert result.returncode == 0
    assert len(ledger(repo)["items"]) == 1


def test_ledger_stable_dates_sorting_and_list_filters(repo: Path) -> None:
    write(repo, "z.lua", "return 2\n")
    path = review(
        repo,
        scope=["z.lua", "src/a.lua"],
        files_read=["z.lua", "src/a.lua"],
        findings=[
            finding(file="z.lua", quote="return 2"),
            finding(),
        ],
    )
    assert run_script("ledger.py", repo, "add", str(path)).returncode == 0
    original = (repo / ".sloppatrol/ledger.json").read_bytes()
    result = run_script("ledger.py", repo, "add", str(path))
    assert result.returncode == 0 and result.stdout.count("kept ") == 2
    assert (repo / ".sloppatrol/ledger.json").read_bytes() == original
    assert original.endswith(b"\n") and b'\n  "schema_version": 1,' in original
    first, last = ledger(repo)["items"]
    assert first["file"] == "src/a.lua" and last["file"] == "z.lua"
    assert first["first_seen"] == first["updated"] == datetime.now(timezone.utc).date().isoformat()
    project_skill(repo)
    guard = ("--guard", "settled: plugin entry points")
    assert run_script("ledger.py", repo, "set", first["id"], "--status", "confirmed", *guard).returncode == 0
    listing = json.loads(run_script("ledger.py", repo, "list", "--json").stdout)
    assert [item["status"] for item in listing] == ["open", "confirmed"]
    filtered = run_script("ledger.py", repo, "list", "--status", "confirmed", "--status", "bug", "--json")
    assert [item["id"] for item in json.loads(filtered.stdout)] == [first["id"]]
    assert (
        run_script("ledger.py", repo, "list", "--status", "dismissed").stdout
        == "no items with status dismissed\n"
    )
    before_fixed = (repo / ".sloppatrol/ledger.json").read_bytes()
    write(repo, "z.lua", "return 3\n")
    refused = run_script("ledger.py", repo, "set", last["id"], first["id"], "--status", "fixed", *guard)
    assert refused.returncode == 1 and (repo / ".sloppatrol/ledger.json").read_bytes() == before_fixed
    stored = ledger(repo)
    stored["items"][0].update(first_seen="2020-01-01", updated="2020-01-02")
    write(repo, ".sloppatrol/ledger.json", json.dumps(stored))
    assert run_script("ledger.py", repo, "add", str(review(repo))).returncode == 0
    refreshed = ledger(repo)["items"][0]
    assert refreshed["first_seen"] == "2020-01-01" and refreshed["updated"] == first["updated"]
    assert refreshed["status"] == "confirmed"


def test_unknown_ids_bad_reasons_and_corrupt_ledger_do_not_write(repo: Path) -> None:
    identity = add(repo)
    path = repo / ".sloppatrol/ledger.json"
    original = path.read_bytes()
    for args in (
        (identity, "unknown", "--status", "confirmed"),
        (identity, "--status", "dismissed"),
        (identity, "--status", "bug", "--reason", "Too short"),
    ):
        result = run_script("ledger.py", repo, "set", *args)
        assert result.returncode == 2 and path.read_bytes() == original
    write(repo, ".sloppatrol/ledger.json", '{"schema_version": 1, "items": [], "typo": 1}')
    damaged = path.read_bytes()
    result = run_script("ledger.py", repo, "add", str(review(repo)))
    assert result.returncode == 2 and "typo" in result.stderr
    assert path.read_bytes() == damaged


@pytest.mark.parametrize(
    ("guard", "kind"),
    [
        ("rule:local-rule", "rule"),
        ("rule:one-head", "rule"),
        ("rule:ruff:BLE001", "tool-rule"),
        ("settled:Plugin entry points", "settled"),
        ("lens-only: the loader resolves names at runtime", "lens-only"),
    ],
)
def test_guard_grammar_accepted_stored_and_listed(repo: Path, guard: str, kind: str) -> None:
    project_rules(repo)
    project_skill(repo)
    identity = add(repo)
    result = run_script("ledger.py", repo, "set", identity, "--status", "confirmed", "--guard", guard)
    assert result.returncode == 0, result.stderr
    assert ledger(repo)["items"][0]["guard"] == guard
    assert f"guard: {guard}" in run_script("ledger.py", repo, "list").stdout
    assert json.loads(run_script("ledger.py", repo, "list", "--json").stdout)[0]["guard"] == guard


def test_guard_required_reused_and_refused(repo: Path) -> None:
    identity = add(repo)
    project_skill(repo)
    path = repo / ".sloppatrol/ledger.json"
    original = path.read_bytes()
    for guard in (
        (),
        ("--guard", "rule:missing-rule"),
        ("--guard", "rule:ruff:"),
        ("--guard", "settled:"),
        ("--guard", "settled:no such entry"),
        ("--guard", "settled:Host callbacks"),
        ("--guard", "lens-only: too short"),
        ("--guard", "lens-only: false positive"),
        ("--guard", "tracked elsewhere"),
    ):
        result = run_script("ledger.py", repo, "set", identity, "--status", "confirmed", *guard)
        assert result.returncode == 2 and path.read_bytes() == original, guard
    reason = ("--reason", "Called by external plugins")
    result = run_script(
        "ledger.py", repo, "set", identity, "--status", "dismissed", *reason, "--guard", "settled:x"
    )
    assert result.returncode == 2 and path.read_bytes() == original
    guard = "lens-only: names are built at runtime"
    assert (
        run_script("ledger.py", repo, "set", identity, "--status", "confirmed", "--guard", guard).returncode
        == 0
    )
    write(repo, "src/a.lua", "return 1\n")
    assert run_script("ledger.py", repo, "set", identity, "--status", "fixed").returncode == 0
    assert ledger(repo)["items"][0]["guard"] == guard
    assert run_script("ledger.py", repo, "set", identity, "--status", "open").returncode == 0
    assert "guard" not in ledger(repo)["items"][0]
    assert run_script("ledger.py", repo, "set", identity, "--status", "fixed").returncode == 2
    stored = ledger(repo)
    stored["items"][0]["guard"] = "rule:"
    write(repo, ".sloppatrol/ledger.json", json.dumps(stored))
    result = run_script("ledger.py", repo, "list")
    assert result.returncode == 2 and "guard must be" in result.stderr


def test_decide_needs_a_real_question(repo: Path) -> None:
    identity = add(repo)
    for reason in ("", "Keep it?", "needed"):
        result = run_script("ledger.py", repo, "set", identity, "--status", "decide", "--reason", reason)
        assert result.returncode == 2
    question = "Should the export keep the legacy CSV column?"
    assert (
        run_script("ledger.py", repo, "set", identity, "--status", "decide", "--reason", question).returncode
        == 0
    )
    assert "decide:" in run_script("ledger.py", repo, "list").stdout


def test_project_ids_register_for_reviews(repo: Path) -> None:
    write(repo, ".sloppatrol/lenses/local-lens.md", "# Local lens\n")
    project_rules(repo)
    for lens in ("local-lens", "local-rule", "one-head"):
        write(repo, "src/a.lua", f"-- sloppatrol: {lens} - Called by external plugins\nunused()\n")
        path = review(repo, lenses=[lens], findings=[finding(lens=lens, quote="unused()")])
        code, data = check_run(repo, path)
        assert code == 0 and data["findings"][0]["status"] == "SUPPRESSED"
    write(repo, ".sloppatrol/rules/broken.yml", "id: other\n")
    result = run_script("ledger.py", repo, "check", str(path))
    assert result.returncode == 2 and "gate config" in result.stderr


def test_default_root_relative_runs_plain_help_and_bad_root(
    repo: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    relative = review(repo).relative_to(repo).as_posix()
    for cwd in (repo, repo / "src"):
        result = subprocess.run(
            [sys.executable, str(SCRIPTS / "ledger.py"), "check", relative],
            cwd=cwd,
            capture_output=True,
            text=True,
            check=False,
        )
        assert result.returncode == 0, result.stdout + result.stderr
    monkeypatch.setenv("FORCE_COLOR", "1")
    for command in ((), ("check",), ("add",), ("set",), ("list",), ("guards",)):
        result = run_script("ledger.py", repo, *command, "--help")
        assert result.returncode == 0 and "usage:" in result.stdout and "\x1b" not in result.stdout
    assert run_script("ledger.py", repo / "absent", "list").returncode == 2
    assert run_script("ledger.py", repo, "set", "anything", "--status", "invalid").returncode == 2
    monkeypatch.setenv("PATH", "")
    result = subprocess.run(
        [sys.executable, str(SCRIPTS / "ledger.py"), "check", relative],
        cwd=repo,
        capture_output=True,
        text=True,
        check=False,
    )
    assert result.returncode == 2 and "git" in result.stderr


def test_standalone_helper_disables_bytecode(repo: Path) -> None:
    standalone = repo / "standalone.py"
    shutil.copyfile(SCRIPTS / "ledger.py", standalone)
    shutil.copyfile(SCRIPTS / "gate.py", repo / "gate.py")
    result = subprocess.run(
        [sys.executable, str(standalone), "check", str(review(repo))],
        cwd=repo,
        capture_output=True,
        text=True,
        check=False,
    )
    assert result.returncode == 0, result.stdout + result.stderr
    write(repo, "local_probe.py", "value = 1\n")
    probe = write(
        repo,
        "probe.py",
        "import runpy, sys\n"
        "sys.dont_write_bytecode = False\nrunpy.run_path('standalone.py')\n"
        "assert sys.dont_write_bytecode\nimport local_probe\n",
    )
    result = subprocess.run(
        [sys.executable, str(probe)], cwd=repo, capture_output=True, text=True, check=False
    )
    assert result.returncode == 0, result.stderr
    assert not list(repo.rglob("__pycache__"))


def test_settled_guard_explains_what_it_resolved_against(repo: Path) -> None:
    identity = add(repo)
    guard = ("--status", "confirmed", "--guard", "settled:Host callbacks")
    missing = run_script("ledger.py", repo, "set", identity, *guard)
    assert missing.returncode == 2 and ".agents/skills/sloppatrol-project/SKILL.md" in missing.stderr
    project_skill(repo)
    settled = run_script("ledger.py", repo, "set", identity, *guard)
    assert settled.returncode == 2 and "Settled entry" in settled.stderr
    skill = repo / ".agents/skills/sloppatrol-project/SKILL.md"
    skill.write_text(
        skill.read_text()
        + "- **Host callbacks** (dead-code): listed twice, e.g. `a.lua:1`\n"
        + "  ```md\n- **Indented fence** (dead-code): not an entry\n  ```\n"
        + "````md\n```\n- **Longer fence** (dead-code): not an entry\n````\n"
        + "# Appendix\n\n- **After the section** (dead-code): not an entry\n"
    )
    for name in ("Host callbacks", "Indented fence", "Longer fence", "After the section"):
        refused = run_script(
            "ledger.py", repo, "set", identity, "--status", "confirmed", "--guard", f"settled:{name}"
        )
        assert refused.returncode == 2, name


def test_guards_command_flags_a_guard_whose_rule_was_retired(repo: Path) -> None:
    project_rules(repo)
    identity = add(repo)
    run_script("ledger.py", repo, "set", identity, "--status", "confirmed", "--guard", "rule:one-head")
    assert run_script("ledger.py", repo, "guards").returncode == 0
    (repo / ".sloppatrol/scripts/one-head.sh").unlink()
    shutil.rmtree(repo / ".sloppatrol/script-tests/one-head")
    result = run_script("ledger.py", repo, "guards")
    assert result.returncode == 1
    assert f"{identity}: guard names no rule" in result.stdout
    assert "one-head" in result.stdout


def test_guards_command_flags_a_removed_anti_pattern_entry(repo: Path) -> None:
    project_skill(repo)
    identity = add(repo)
    run_script(
        "ledger.py", repo, "set", identity, "--status", "confirmed", "--guard", "settled:plugin entry points"
    )
    assert run_script("ledger.py", repo, "guards").returncode == 0
    (repo / ".agents/skills/sloppatrol-project/SKILL.md").write_text("## Anti-patterns\n\n")
    result = run_script("ledger.py", repo, "guards")
    assert result.returncode == 1
    assert "no Anti-patterns entry" in result.stdout


def test_rekey_repairs_ids_after_a_file_move(repo: Path) -> None:
    identity = add(repo)
    data = ledger(repo)
    data["items"][0]["file"] = "src/moved.lua"
    (repo / ".sloppatrol/ledger.json").write_text(json.dumps(data))
    assert run_script("ledger.py", repo, "list").returncode == 2
    result = run_script("ledger.py", repo, "rekey")
    assert result.returncode == 0 and f"{identity} -> " in result.stdout
    assert run_script("ledger.py", repo, "list").returncode == 0
    assert ledger(repo)["items"][0]["file"] == "src/moved.lua"
    assert "every id matches" in run_script("ledger.py", repo, "rekey").stdout
