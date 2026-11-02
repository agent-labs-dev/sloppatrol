from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

import pytest
from conftest import SCRIPTS, commit, git, write

from skills.sloppatrol.scripts import agents, gate

AST = pytest.mark.skipif(shutil.which("ast-grep") is None, reason="ast-grep is not on PATH (requires 0.44.1)")
REASON = "Required by external callers"


@pytest.fixture
def repo(repo: Path) -> Path:
    write(repo, "src/a.py", "good()\n")
    return repo


def invoke(root: Path, *args: str, env: dict[str, str] | None = None) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [sys.executable, str(SCRIPTS / "gate.py"), *args],
        cwd=root,
        env={**os.environ, **(env or {})},
        text=True,
        capture_output=True,
        check=False,
    )


def report(root: Path, *args: str, code: int = 0) -> dict:
    result = invoke(root, *args, "--json")
    assert result.returncode == code, result.stdout + result.stderr
    assert len(result.stderr.splitlines()) == 1, result.stderr
    data = json.loads(result.stdout)
    assert set(data) == {"version", "ast_grep", "base", "findings"}
    return data


def rule(root: Path, rule_id: str = "check", *, scope: str = "all", extra: str = "") -> Path:
    write(root, ".sloppatrol/sgconfig.yml", "ruleDirs: [rules]\ntestConfigs: [{testDir: rule-tests}]\n")
    write(
        root,
        f".sloppatrol/rule-tests/{rule_id}-test.yml",
        f"id: {rule_id}\nvalid:\n  - good()\ninvalid:\n  - bad()\n",
    )
    return write(
        root,
        f".sloppatrol/rules/{rule_id}.yml",
        f"id: {rule_id}\nlanguage: Python\nseverity: error\nmessage: Replace bad call\n"
        f"note: Use good instead\nmetadata:\n  sloppatrol-scope: {scope}\nrule:\n  pattern: bad()\n{extra}",
    )


SCRIPT = """import os
import sys
from pathlib import Path
paths = Path(os.environ["SLOPPATROL_FILES"]).read_text().splitlines()
hits = []
for name in paths:
    if name.endswith(".txt"):
        for number, line in enumerate(Path(name).read_text().splitlines(), 1):
            if line == "BAD":
                hits.append(f"{name}:{number}: {os.environ['SLOPPATROL_RULE']} Replace BAD")
for hit in hits:
    print(hit)
sys.exit(bool(hits))
"""


def script(root: Path, rule_id: str = "script-check", *, scope: str = "all", body: str = SCRIPT) -> Path:
    path = write(
        root,
        f".sloppatrol/scripts/{rule_id}.py",
        f"#!{sys.executable}\n# sloppatrol-scope: {scope}\n# sloppatrol-fix: Replace BAD with GOOD\n" + body,
    )
    path.chmod(0o755)
    for case, text, expected in (("clean", "GOOD\n", ""), ("bad", "BAD\n", "sample.txt:1\n")):
        write(root, f".sloppatrol/script-tests/{rule_id}/{case}/head/sample.txt", text)
        write(root, f".sloppatrol/script-tests/{rule_id}/{case}/expected", expected)
    return path


def codes(data: dict) -> set[str]:
    return {hit["id"] for hit in data["findings"]}


def test_builtin_lenses_and_version() -> None:
    root = SCRIPTS.parents[2]
    package = json.loads((root / "package.json").read_text())
    assert {gate.VERSION, agents.VERSION, package["version"]} == {gate.VERSION}
    assert isinstance(gate.BUILTIN_LENSES, frozenset)
    assert (
        frozenset(
            [
                "comment-narration",
                "copy-slop",
                "dead-code",
                "defensive-noise",
                "hidden-dependency",
                "interface-leak",
                "oversized-modules",
                "parallel-implementations",
                "reader-journey",
                "reinvented-wheel",
                "session-residue",
                "shallow-modules",
                "silent-fallbacks",
                "speculative-abstraction",
                "stale-docs",
                "stringly-typed",
                "test-plumbing",
                "wall-of-text",
            ]
        )
        == gate.BUILTIN_LENSES
    )


@pytest.mark.parametrize("line", [1, 2, 3, 4])
def test_marker_window(line: int) -> None:
    text = "\n" * (line - 1) + f"# sloppatrol: check - {REASON}\n" + "\n" * 5
    assert gate.marker_covers("a.py", text, line, 4)


def test_marker_comment_block_and_four_lines_away() -> None:
    text = f"# sloppatrol: check - {REASON}\n# one\n# two\n# three\n# four\nbad()\n"
    assert gate.marker_covers("a.py", text, 1, 6)
    assert not gate.marker_covers("a.py", text.replace("# two", ""), 1, 6)
    assert not gate.marker_covers("a.py", text.replace("# two", "good()"), 1, 6)
    assert not gate.marker_covers("a.py", f"# sloppatrol: check - {REASON}\n\n\n\nbad()\n", 1, 5)
    assert not gate.marker_covers("a.py", text, 6, 1)


@pytest.mark.parametrize(
    "text, expected",
    [
        (f"# sloppatrol: missing - {REASON}", "sloppatrol-unknown-id"),
        (f"# sloppatrol: sloppatrol-unused-marker - {REASON}", "sloppatrol-unknown-id"),
        ("# sloppatrol: check -", "sloppatrol-weak-reason"),
        ("# sloppatrol: check - SAFE!!!", "sloppatrol-weak-reason"),
        ("# sloppatrol: check - two words", "sloppatrol-weak-reason"),
        (f"# sloppatrol: check: {REASON}", "sloppatrol-bad-marker"),
        (f"# sloppatrol: check \u2014 {REASON}", "sloppatrol-bad-marker"),
        (f"# sloppatrol: Check - {REASON}", "sloppatrol-bad-marker"),
        (f"# sloppatrol: check  - {REASON}", "sloppatrol-bad-marker"),
        (f"bad() # sloppatrol: check - {REASON}", "sloppatrol-trailing-marker"),
        (f"# see sloppatrol: check - {REASON}", "sloppatrol-bad-marker"),
        ("# ast-grep-ignore", "sloppatrol-ast-grep-ignore"),
        ("bad() # ast-grep-ignore", "sloppatrol-ast-grep-ignore"),
    ],
)
def test_marker_errors(text: str, expected: str) -> None:
    assert gate.scan_markers("a.py", text, {"check"})[0]["error"] == expected


@pytest.mark.parametrize(
    "text",
    [
        "# tests, .sloppatrol: build tooling",
        "# tools/sloppatrol: a path",
        "# nosloppatrol: word",
        "# sloppatrol-fix: header",
    ],
)
def test_sloppatrol_inside_a_path_or_word_is_prose(text: str) -> None:
    assert gate.scan_markers("a.py", text, {"check"}) == []


@pytest.mark.parametrize(
    "name, token, suffix",
    [
        ("a.py", "#", ""),
        ("a.js", "//", ""),
        ("a.lua", "--", ""),
        ("a.ini", ";", ""),
        ("a.tex", "%", ""),
        ("a.html", "<!--", " -->"),
        ("Dockerfile", "#", ""),
        (".luacheckrc", "--", ""),
        (".gitignore", "#", ""),
    ],
)
def test_marker_api(name: str, token: str, suffix: str) -> None:
    assert gate.scan_markers(name, f"{token} sloppatrol: check - {REASON}{suffix}", {"check"}) == [
        dict(line=1, id="check", reason=REASON, error=None)
    ]


def test_markdown_and_quoted_text_are_not_markers() -> None:
    assert not gate.scan_markers("a.md", f"<!-- sloppatrol: missing - {REASON} -->\n# ast-grep-ignore", set())
    assert not gate.scan_markers("a.py", f'x = "# sloppatrol: missing - {REASON}"', set())
    assert not gate.scan_markers("a.js", 'const x = "// ast-grep-ignore";', set())
    text = f'content = """\n# sloppatrol: check - {REASON}\n"""'
    assert gate.scan_markers("a.py", text, {"check"})[0]["line"] == 2


def test_gate_passes_its_own_gate(repo: Path) -> None:
    shutil.copy2(SCRIPTS / "gate.py", repo / "gate.py")
    assert report(repo)["findings"] == []


def test_project_lenses_register_without_unused_checks(repo: Path) -> None:
    write(repo, ".sloppatrol/lenses/local-review.md", "Project review lens\n")
    write(repo, "src/a.py", f"# sloppatrol: local-review - {REASON}\ngood()\n")
    assert report(repo)["findings"] == []
    write(repo, ".sloppatrol/ids", "unknown\n")
    write(repo, "src/a.py", f"# sloppatrol: unknown - {REASON}\ngood()\n")
    assert codes(report(repo, code=1)) == {"sloppatrol-unknown-id"}


@AST
def test_multiple_covering_markers_are_both_used(repo: Path) -> None:
    rule(repo)
    write(repo, "src/a.py", f"# sloppatrol: check - {REASON}\n# sloppatrol: check - {REASON}\nbad()\n")
    data = report(repo)
    assert codes(data) == {"check"} and data["findings"][0]["marker_line"] == 1


@AST
def test_default_severity_and_multiline_message(repo: Path) -> None:
    path = rule(repo)
    path.write_text(
        path.read_text()
        .replace("severity: error\n", "")
        .replace("message: Replace bad call", "message: |\n  Replace bad call\n  with good")
    )
    write(repo, "src/a.py", "bad()\n")
    result = invoke(repo)
    assert result.returncode == 1
    assert result.stdout.splitlines()[0] == "src/a.py:1: check Replace bad call with good"


def test_zero_rules_no_ast_grep_or_base(repo: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(gate.shutil, "which", lambda _: None)
    monkeypatch.chdir(repo)
    monkeypatch.setattr(sys, "argv", ["gate.py", "--base", "does-not-exist"])
    assert gate.main() == 0


@AST
def test_json_suppression_text_fixes_and_summary(repo: Path) -> None:
    rule(repo)
    write(repo, "src/a.py", f"# sloppatrol: check - {REASON}\nbad()\n\n\n\nbad()\n")
    data = report(repo, code=1)
    assert data["version"] == "0.1.0" and data["ast_grep"] == "0.44.1"
    assert data["base"] == dict(ref=None, merge_base=None, changed=0)
    assert data["findings"] == [
        dict(
            id="check",
            kind="ast-grep",
            path="src/a.py",
            line=2,
            message="Replace bad call",
            suppressed=True,
            marker_line=1,
        ),
        dict(
            id="check",
            kind="ast-grep",
            path="src/a.py",
            line=6,
            message="Replace bad call",
            suppressed=False,
            marker_line=None,
        ),
    ]
    result = invoke(repo)
    assert result.stdout == "src/a.py:6: check Replace bad call\nfix:\n  check: Use good instead\n"
    assert result.stderr.startswith(
        "sloppatrol gate 0.1.0: 1 findings, 1 suppressed, 1 rules (1 ast-grep, 0 script);"
    )
    assert "; ast-grep 0.44.1; base not needed (merge-base -), 0 changed files; " in result.stderr
    assert result.stderr.endswith(" s\n")


@AST
@pytest.mark.parametrize(
    "scope, all_files, unused", [("all", False, True), ("changed", False, False), ("changed", True, True)]
)
def test_unused_marker_scope(repo: Path, scope: str, all_files: bool, unused: bool) -> None:
    rule(repo, scope=scope)
    write(repo, "src/a.py", f"# sloppatrol: check - {REASON}\ngood()\n# sloppatrol: dead-code - {REASON}\n")
    commit(repo)
    args = ["--all"] if all_files else ["--base", "HEAD"]
    data = report(repo, *args, code=int(unused))
    assert codes(data) == ({"sloppatrol-unused-marker"} if unused else set())


@AST
def test_all_marker_codes_and_line_one_ignore(repo: Path) -> None:
    rule(repo)
    write(
        repo,
        "src/a.py",
        "# ast-grep-ignore\n\nbad()\n"
        f"# sloppatrol: missing - {REASON}\n# sloppatrol: check - ok\n# sloppatrol: check: no\n"
        f"good() # sloppatrol: check - {REASON}\n# sloppatrol: check - {REASON}\n",
    )
    data = report(repo, code=1)
    assert codes(data) == {
        "sloppatrol-ast-grep-ignore",
        "sloppatrol-unknown-id",
        "sloppatrol-weak-reason",
        "sloppatrol-bad-marker",
        "sloppatrol-trailing-marker",
        "sloppatrol-unused-marker",
    }


@AST
def test_rule_filter_tests_markers_and_unknown_id(repo: Path) -> None:
    rule(repo, "one")
    rule(repo, "two")
    write(repo, ".sloppatrol/rule-tests/two-test.yml", "id: two\nvalid: [bad()]\ninvalid: [good()]\n")
    write(repo, "src/a.py", f"# sloppatrol: one - {REASON}\nbad()\n# sloppatrol: two - ok\n")
    assert codes(report(repo, "--rule", "one")) == {"one"}
    data = report(repo, "--rule", "one", "--rule", "two", code=1)
    assert {"one", "two", "sloppatrol-rule-test", "sloppatrol-weak-reason"} <= codes(data)
    assert "unknown rule id" in report(repo, "--rule", "nope", code=2)["findings"][0]["message"]


@pytest.mark.parametrize(
    "key, value",
    [
        ("id", "different"),
        ("severity", "warning"),
        ("severity", "off"),
        ("message", None),
        ("note", None),
        ("metadata", "  sloppatrol-scope: maybe"),
    ],
)
def test_rule_validation(repo: Path, key: str, value: str | None) -> None:
    path = rule(repo)
    lines = path.read_text().splitlines()
    if key == "metadata":
        lines[lines.index("  sloppatrol-scope: all")] = value or ""
    else:
        lines = [
            f"{key}: {value}" if line.startswith(key + ":") and value is not None else line
            for line in lines
            if not (line.startswith(key + ":") and value is None)
        ]
    path.write_text("\n".join(lines))
    assert "sloppatrol-config" in codes(report(repo, code=2))


@pytest.mark.parametrize("name", ["sloppatrol-reserved", "bad_name", "dead-code"])
def test_invalid_reserved_and_builtin_duplicate_id(repo: Path, name: str) -> None:
    rule(repo, name)
    assert "invalid, reserved or duplicate id" in report(repo, code=2)["findings"][0]["message"]


@pytest.mark.parametrize("other", ["scripts/check.py", "lenses/check.md", "scripts/check.sh"])
def test_ids_unique_across_sources(repo: Path, other: str) -> None:
    if other.endswith(".sh"):
        script(repo, "check")
    else:
        rule(repo)
    write(repo, ".sloppatrol/" + other, "")
    assert "duplicate id" in report(repo, code=2)["findings"][0]["message"]


@pytest.mark.parametrize(
    "text",
    [
        None,
        "id: check\nvalid: []\ninvalid: [bad()]\n",
        "id: check\nvalid: [good()]\ninvalid: []\n",
        "id: unknown\nvalid: [good()]\ninvalid: [bad()]\n",
    ],
)
def test_rule_test_pairing(repo: Path, text: str | None) -> None:
    rule(repo)
    path = repo / ".sloppatrol/rule-tests/check-test.yml"
    if text is None:
        path.unlink()
    else:
        path.write_text(text)
    assert codes(report(repo, code=2)) == {"sloppatrol-config"}


@pytest.mark.parametrize("name, text", [("unknown-test.yml", "id: unknown\n"), ("stray.yml", "id: check\n")])
def test_orphan_rule_test(repo: Path, name: str, text: str) -> None:
    rule(repo)
    write(repo, ".sloppatrol/rule-tests/" + name, text)
    assert codes(report(repo, code=2)) == {"sloppatrol-config"}


@pytest.mark.parametrize(
    "defect",
    [
        "executable",
        "shebang",
        "fix",
        "scope",
        "unknown-header",
        "late-fix",
        "no-tests",
        "no-empty",
        "no-nonempty",
        "missing-head",
        "missing-expected",
        "directory",
        "symlink",
    ],
)
def test_script_validation(repo: Path, defect: str) -> None:
    path = script(repo)
    cases = repo / ".sloppatrol/script-tests/script-check"
    if defect == "executable":
        path.chmod(0o644)
    elif defect in {"shebang", "fix", "scope", "unknown-header", "late-fix"}:
        text = path.read_text()
        changes = {
            "shebang": (f"#!{sys.executable}\n", ""),
            "fix": ("# sloppatrol-fix:", "# fix:"),
            "scope": ("sloppatrol-scope: all", "sloppatrol-scope: no"),
            "unknown-header": ("sloppatrol-scope:", "sloppatrol-other:"),
            "late-fix": ("# sloppatrol-fix:", "\n" * 40 + "# sloppatrol-fix:"),
        }
        path.write_text(text.replace(*changes[defect]))
    elif defect == "no-tests":
        shutil.rmtree(cases)
    elif defect in {"no-empty", "no-nonempty"}:
        (cases / ("clean" if defect == "no-empty" else "bad") / "expected").write_text(
            "sample.txt:1\n" if defect == "no-empty" else ""
        )
    elif defect == "missing-head":
        shutil.rmtree(cases / "clean/head")
    elif defect == "missing-expected":
        (cases / "clean/expected").unlink()
    else:
        path.unlink()
        if defect == "directory":
            path.mkdir()
        else:
            path.symlink_to(repo / "src/a.py")
    assert codes(report(repo, code=2)) == {"sloppatrol-config"}


@pytest.mark.parametrize(
    "key, value",
    [
        ("id", "[check]"),
        ("message", '"unterminated'),
        ("note", "{foo: bar}"),
        ("files", "{a,b}"),
        ("metadata", "{sloppatrol-scope: all}"),
    ],
)
def test_reader_errors_name_the_line(repo: Path, key: str, value: str) -> None:
    path = rule(repo)
    write(repo, str(path.relative_to(repo)), path.read_text() + f"{key}: {value}\n")
    message = report(repo, code=2)["findings"][0]["message"]
    assert f"{path}:" in message


@AST
def test_reader_scalars_blocks_lists_and_cwd(repo: Path) -> None:
    path = rule(repo, extra="files:\n- 'src/{a,b}.py'\n- \"no-such-file.py\"\nignores: [never-present.py]\n")
    path.write_text(
        path.read_text()
        .replace("message: Replace bad call", "message: 'Replace bad call' # comment")
        .replace("note: Use good instead", "note: >-\n  Use good\n  instead")
    )
    write(repo, "src/a.py", "bad()\n")
    result = invoke(repo / "src")
    assert result.returncode == 1, result.stdout
    assert "check: Use good instead" in result.stdout


def test_glob_liveness_is_per_rule(repo: Path) -> None:
    rule(repo, extra="files: ['no-such-file.py']\n")
    assert "match no corpus" in report(repo, code=2)["findings"][0]["message"]


@pytest.mark.parametrize("name", ["bad\tname.py", "bad\nname.py"])
def test_corpus_rejects_unrepresentable_paths(repo: Path, name: str) -> None:
    write(repo, name, "good()")
    assert "TAB or newline" in report(repo, code=2)["findings"][0]["message"]


@pytest.mark.parametrize(
    "args", [("--all", "--base", "HEAD"), ("--version",), ("--files", "a.py"), ("--base", "")]
)
def test_usage_errors(repo: Path, args: tuple[str, ...]) -> None:
    assert invoke(repo, *args).returncode == 2


@AST
def test_changed_scope_amr_and_worktree_changes(repo: Path) -> None:
    rule(repo, scope="changed")
    for name in ("unchanged", "committed", "staged", "unstaged", "deleted", "renamed"):
        write(repo, f"src/{name}.py", "bad()\n" + f"# stable content for {name}\n" * 10)
    base = commit(repo)
    write(repo, "src/committed.py", "bad()\n# committed change\n")
    commit(repo)
    write(repo, "src/staged.py", "bad()\n# staged change\n")
    git(repo, "add", "src/staged.py")
    write(repo, "src/unstaged.py", "bad()\n# unstaged change\n")
    write(repo, "src/new.py", "bad()\n")
    (repo / "src/deleted.py").unlink()
    git(repo, "mv", "src/renamed.py", "src/new-name.py")
    data = report(repo, "--base", base, code=1)
    assert {h["path"] for h in data["findings"]} == {
        "src/committed.py",
        "src/staged.py",
        "src/unstaged.py",
        "src/new.py",
        "src/new-name.py",
    }
    rows = gate.changes(repo, base)
    assert data["base"]["changed"] == len(rows)
    assert ["R", "src/renamed.py", "src/new-name.py"] in rows
    assert ["D", "src/deleted.py"] in rows
    assert ["A", "src/new.py"] in rows


def test_rename_threshold_is_twenty_five_percent(repo: Path) -> None:
    original = "".join(f"stable line {n:03d}\n" for n in range(100))
    write(repo, "old.txt", original)
    base = commit(repo)
    git(repo, "mv", "old.txt", "new.txt")
    write(repo, "new.txt", "".join(original.splitlines(keepends=True)[:40]) + "new content\n" * 100)
    assert ["R", "old.txt", "new.txt"] in gate.changes(repo, base)
    assert "R" not in git(repo, "diff", "--name-status", "-M50%", base)


def test_typechange_is_a_modification(repo: Path) -> None:
    write(repo, "target.txt", "good()\n")
    base = commit(repo)
    (repo / "src/a.py").unlink()
    (repo / "src/a.py").symlink_to("../target.txt")
    assert git(repo, "diff", "--name-status", base).startswith("T\t")
    assert gate.changes(repo, base) == [["M", "src/a.py"]]


@AST
def test_all_empty_tree_and_unused_markers(repo: Path) -> None:
    rule(repo, scope="changed")
    write(repo, "src/a.py", "bad()\n")
    commit(repo)
    data = report(repo, "--all", code=1)
    assert data["base"]["ref"] == data["base"]["merge_base"] == gate.EMPTY_TREE
    assert ["A", "src/a.py"] in gate.changes(repo, gate.EMPTY_TREE)
    assert data["base"]["changed"] == len(gate.changes(repo, gate.EMPTY_TREE))
    assert {h["path"] for h in data["findings"]} == {"src/a.py"}


def test_all_without_rules_and_without_commit(repo: Path) -> None:
    assert report(repo, "--all")["base"]["merge_base"] == gate.EMPTY_TREE


@AST
@pytest.mark.parametrize(
    "trap",
    ["missing-ref", "unrelated-history", "shallow", "pull_request", "pull_request_target", "merge_group"],
)
def test_base_traps(repo: Path, trap: str, monkeypatch: pytest.MonkeyPatch) -> None:
    rule(repo, scope="changed")
    base = commit(repo)
    ref = "HEAD"
    if trap == "missing-ref":
        ref = "missing"
    elif trap == "unrelated-history":
        tree = git(repo, "rev-parse", "HEAD^{tree}")
        ref = git(repo, "commit-tree", tree, "-m", "unrelated")
    elif trap == "shallow":
        write(repo, "src/a.py", "good()\n# second commit\n")
        commit(repo)
        clone = repo.parent / "shallow"
        git(repo.parent, "clone", "--depth", "1", repo.as_uri(), str(clone))
        assert git(clone, "rev-parse", "--is-shallow-repository") == "true"
        repo = clone
    else:
        monkeypatch.setenv("GITHUB_EVENT_NAME", trap)
    data = report(repo, "--base", ref, code=2)
    assert codes(data) == {"sloppatrol-base"}
    assert "--base" in data["findings"][0]["message"] and "fetch-depth: 0" in data["findings"][0]["message"]
    assert base


def test_shallow_without_changed_rules_works(repo: Path) -> None:
    commit(repo)
    clone = repo.parent / "shallow-no-rules"
    git(repo.parent, "clone", "--depth", "1", repo.as_uri(), str(clone))
    data = report(clone, code=2)
    assert codes(data) == {"sloppatrol-base"}


@AST
def test_base_precedence_and_default(repo: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    rule(repo, scope="changed")
    base = commit(repo)
    git(repo, "update-ref", "refs/remotes/origin/main", base)
    git(repo, "symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main")
    assert report(repo)["base"]["ref"] == "origin/HEAD"
    monkeypatch.setenv("GITHUB_BASE_REF", "main")
    assert report(repo)["base"]["ref"] == "origin/main"
    assert report(repo, "--base", base)["base"]["ref"] == base


@AST
def test_hidden_files_deleted_paths_and_nested_clone(repo: Path) -> None:
    rule(repo)
    write(repo, ".github/check.py", "bad()\n")
    write(repo, "gone.py", "bad()\n")
    commit(repo)
    (repo / "gone.py").unlink()
    git(repo, "clone", "-q", str(repo), str(repo / "nested"))
    write(repo, ".sloppatrol/script-tests/unused/case/head/ignore.py", "# sloppatrol: unknown - no\nbad()\n")
    data = report(repo, code=1)
    assert {h["path"] for h in data["findings"]} == {".github/check.py"}


def test_script_test_cases_outside_sloppatrol_are_not_corpus(repo: Path) -> None:
    marker = "# sloppatrol: shipped-rule - the case proves the marker suppresses the hit\n"
    write(repo, "catalog/shipped-rule/script-tests/shipped-rule/case/head/a.py", marker)
    write(repo, "script-tests/notes.py", marker)
    data = report(repo, code=1)
    assert [(h["path"], h["id"]) for h in data["findings"]] == [
        ("script-tests/notes.py", "sloppatrol-unknown-id")
    ]


def test_ast_grep_missing_no_sg_fallback(
    repo: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    rule(repo)
    monkeypatch.setattr(gate.shutil, "which", lambda _: None)
    monkeypatch.chdir(repo)
    monkeypatch.setattr(sys, "argv", ["gate.py", "--json"])
    assert gate.main() == 2
    assert "ast-grep is required on PATH" in capsys.readouterr().out


@AST
def test_real_ast_missing_path_and_error_stderr(
    repo: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    rule(repo)
    result = subprocess.run(
        ["ast-grep", "scan", "-c", ".sloppatrol/sgconfig.yml", "missing.py"],
        cwd=repo,
        text=True,
        capture_output=True,
        check=False,
    )
    assert result.returncode == 0 and result.stderr.startswith("ERROR")
    real_run = gate.run

    def vanished(args: list[str], root: Path, **kwargs: object) -> subprocess.CompletedProcess[str]:
        if args[:2] == ["ast-grep", "scan"]:
            (root / "src/a.py").unlink()
        return real_run(args, root, **kwargs)

    monkeypatch.setattr(gate, "run", vanished)
    monkeypatch.chdir(repo)
    monkeypatch.setattr(sys, "argv", ["gate.py", "--json"])
    assert gate.main() == 2
    assert "sloppatrol-ast-grep" in capsys.readouterr().out


@AST
@pytest.mark.parametrize(
    "operation, returncode, stdout, stderr",
    [
        ("scan", 9, "", "failed"),
        ("scan", 0, "not JSON", ""),
        ("scan", 0, "{}", ""),
        ("scan", 0, "", "ERROR: missing path"),
        ("test", 8, "", "config error"),
    ],
)
def test_ast_failures(  # noqa: PLR0913, PLR0917 -- parametrized subprocess outcomes
    repo: Path, monkeypatch: pytest.MonkeyPatch, operation: str, returncode: int, stdout: str, stderr: str
) -> None:
    rule(repo)
    real_run = gate.run

    def faulty(args: list[str], root: Path, **kwargs: object) -> subprocess.CompletedProcess[str]:
        if args[:2] == ["ast-grep", operation]:
            return subprocess.CompletedProcess(args, returncode, stdout, stderr)
        return real_run(args, root, **kwargs)

    monkeypatch.setattr(gate, "run", faulty)
    monkeypatch.chdir(repo)
    monkeypatch.setattr(sys, "argv", ["gate.py"])
    assert gate.main() == 2


@AST
def test_rule_test_failure_is_finding(repo: Path) -> None:
    rule(repo)
    write(repo, ".sloppatrol/rule-tests/check-test.yml", "id: check\nvalid: [bad()]\ninvalid: [good()]\n")
    assert codes(report(repo, code=1)) == {"sloppatrol-rule-test"}


def test_script_findings_suppression_and_fix(repo: Path) -> None:
    script(repo)
    write(repo, "bad.txt", "BAD\n")
    data = report(repo, code=1)
    assert data["findings"][0]["kind"] == "script"
    assert "fix:\n  script-check: Replace BAD with GOOD\n" in invoke(repo).stdout
    path = script(repo)
    path.write_text(path.read_text().replace('name.endswith(".txt")', 'name.endswith((".txt", ".py"))'))
    write(repo, "bad.txt", "GOOD\n")
    write(repo, "src/a.py", f"# sloppatrol: script-check - {REASON}\nBAD\n")
    assert report(repo)["findings"][0]["suppressed"] is True


@pytest.mark.parametrize(
    "body",
    [
        "raise SystemExit(2)",
        "raise SystemExit(1)",
        "print('src/a.py:1: script-check broken')",
        "print('malformed'); raise SystemExit(1)",
        "print('src/a.py:1: foreign broken'); raise SystemExit(1)",
        "print('missing.py:1: script-check broken'); raise SystemExit(1)",
        "print('src/a.py:0: script-check broken'); raise SystemExit(1)",
        "print('src/a.py:-1: script-check broken'); raise SystemExit(1)",
        "print('src/a.py:1: script-check '); raise SystemExit(1)",
        "import time; time.sleep(60)",
    ],
)
def test_script_protocol_breaches_exit_two(
    repo: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str], body: str
) -> None:
    script(repo, body=body)
    monkeypatch.setattr(gate, "SCRIPT_TIMEOUT", 0.1)
    monkeypatch.chdir(repo)
    monkeypatch.setattr(sys, "argv", ["gate.py", "--json"])
    assert gate.main() == 2
    assert codes(json.loads(capsys.readouterr().out)) == {"sloppatrol-script-protocol"}


def test_protocol_failure_continues_other_scripts(repo: Path) -> None:
    script(repo, "a-fails", body="raise SystemExit(8)\n")
    script(repo, "z-runs", body="from pathlib import Path\nPath('ran').write_text('yes')\n" + SCRIPT)
    assert "sloppatrol-script-protocol" in codes(report(repo, code=2))
    assert (repo / "ran").read_text() == "yes"


def test_script_environment_and_unset_base(repo: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    body = """import os
from pathlib import Path
assert str(Path.cwd()) == os.environ["SLOPPATROL_ROOT"]
assert os.environ["SLOPPATROL_RULE"] == "script-check"
assert Path(os.environ["SLOPPATROL_LIB"]).is_absolute()
assert Path(os.environ["SLOPPATROL_FILES"]).is_file()
if Path("live.flag").exists():
    assert "SLOPPATROL_BASE" not in os.environ and "SLOPPATROL_CHANGED" not in os.environ
else:
    assert os.environ["SLOPPATROL_BASE"]
    assert Path(os.environ["SLOPPATROL_CHANGED"]).is_file()
"""
    script(repo, body=body + SCRIPT)
    write(repo, "live.flag", "")
    monkeypatch.setenv("SLOPPATROL_BASE", "stale")
    monkeypatch.setenv("SLOPPATROL_CHANGED", "stale")
    assert not report(repo)["findings"]


def test_script_tests_base_head_deletions_empty_and_suppressed(repo: Path) -> None:
    body = """import os
import subprocess
from pathlib import Path
if not Path("live.flag").exists():
    changed = Path(os.environ["SLOPPATROL_CHANGED"]).read_text()
    if Path("deletion.flag").exists():
        assert "D\\tdeleted.txt" in changed
        assert not Path("deleted.txt").exists()
        previous = subprocess.check_output(["git", "show", os.environ["SLOPPATROL_BASE"] + ":deleted.txt"])
        assert previous == b"BAD\\n"
"""
    path = script(repo, body=body + SCRIPT.replace('name.endswith(".txt")', 'name.endswith((".txt", ".py"))'))
    assert path.exists()
    write(repo, "live.flag", "")
    case = ".sloppatrol/script-tests/script-check/deletion/"
    write(repo, case + "base/deleted.txt", "BAD\n")
    write(repo, case + "head/deletion.flag", "")
    write(repo, case + "head/clean.py", f"# sloppatrol: script-check - {REASON}\nBAD\n")
    write(repo, case + "expected", "")
    assert not report(repo)["findings"]


def test_script_fixture_replaces_directories_with_files(repo: Path) -> None:
    script(repo)
    case = ".sloppatrol/script-tests/script-check/replaced/"
    write(repo, case + "base/old/child.txt", "BAD\n")
    write(repo, case + "head/old", "GOOD\n")
    write(repo, case + "expected", "")
    assert not report(repo)["findings"]


def test_script_helpers_are_imported_and_never_run_as_rules(repo: Path) -> None:
    write(repo, ".sloppatrol/lib/helper.py", "VALUE = 42\n")
    body = 'import sys, os\nsys.path.insert(0, os.environ["SLOPPATROL_LIB"])\nfrom helper import VALUE\n'
    script(repo, body=body + "assert VALUE == 42\n" + SCRIPT)
    assert not report(repo)["findings"]


def test_rule_filter_skips_other_script_and_its_base(repo: Path) -> None:
    script(repo, "selected")
    script(repo, "unselected", scope="changed", body="raise SystemExit(2)\n")
    write(repo, "src/a.py", f"# sloppatrol: unselected - ok\n# sloppatrol: selected - {REASON}\n")
    data = report(repo, "--rule", "selected", code=1)
    assert data["base"]["merge_base"] is None
    assert codes(data) == {"sloppatrol-unused-marker"}


def test_script_all_receives_empty_tree_and_change_rows(repo: Path) -> None:
    body = f'''import os
from pathlib import Path
if Path("live.flag").exists():
    assert os.environ["SLOPPATROL_BASE"] == "{gate.EMPTY_TREE}"
    assert "A\\tsrc/a.py\\n" in Path(os.environ["SLOPPATROL_CHANGED"]).read_text()
'''
    script(repo, scope="changed", body=body + SCRIPT)
    write(repo, "live.flag", "")
    commit(repo)
    assert report(repo, "--all")["findings"] == []


def test_script_test_cases_are_not_changes(repo: Path) -> None:
    body = """import os
import sys
from pathlib import Path
rows = Path(os.environ["SLOPPATROL_CHANGED"]).read_text().splitlines()
changed = [row.split(chr(9))[-1] for row in rows]
bad = [p for p in changed if p.endswith(".txt") and "BAD" in Path(p).read_text()]
hits = [f"{p}:1: {os.environ['SLOPPATROL_RULE']} BAD" for p in bad]
for hit in hits:
    print(hit)
sys.exit(bool(hits))
"""
    base = commit(repo)
    script(repo, scope="changed", body=body)
    commit(repo)
    assert report(repo, "--base", base)["findings"] == []


def test_script_test_mismatch_reports_missing_and_extra(repo: Path) -> None:
    script(repo)
    write(repo, ".sloppatrol/script-tests/script-check/bad/expected", "sample.txt:99\n")
    data = report(repo, code=1)
    assert codes(data) == {"sloppatrol-script-test"}
    assert "missing ['sample.txt:99'], extra ['sample.txt:1']" in data["findings"][0]["message"]


@AST
def test_chunking_and_deduplication(
    repo: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    rule(repo)
    for index in range(1001):
        write(repo, f"many/{index}.py", "good()\n")
    write(repo, "src/a.py", "bad()\n")
    real_run, counts = gate.run, []

    def repeated(args: list[str], root: Path, **kwargs: object) -> subprocess.CompletedProcess[str]:
        result = real_run(args, root, **kwargs)
        if args[:2] == ["ast-grep", "scan"]:
            counts.append(len(args) - args.index("--") - 1)
            result.stdout *= 2
        return result

    monkeypatch.setattr(gate, "run", repeated)
    monkeypatch.chdir(repo)
    monkeypatch.setattr(sys, "argv", ["gate.py", "--json"])
    assert gate.main() == 1
    assert len(json.loads(capsys.readouterr().out)["findings"]) == 1
    assert len(counts) == 2 and counts[0] == 1000 and counts[1] > 0


def test_line_numbers_count_newlines_only() -> None:
    text = f'x = "a\x0cb"\n# sloppatrol: check - {REASON}\ngood()\ngood()\ngood()\nbad()\n'
    assert not gate.marker_covers("a.py", text, 2, 6)
    assert (
        gate.scan_markers("a.py", f'x = "\u2028"\n# sloppatrol: check - {REASON}\n', {"check"})[0]["line"]
        == 2
    )


@pytest.mark.parametrize(
    "name, text, line, covered",
    [
        ("a.sh", f"#!/bin/sh\n# sloppatrol: check - {REASON}\necho\n", 2, True),
        (
            "a.js",
            f"#!/usr/bin/env node\n// one\n// two\n// three\n// sloppatrol: check - {REASON}\n",
            5,
            True,
        ),
        ("a.js", f"#!/usr/bin/env node\nrun()\n// sloppatrol: check - {REASON}\n", 3, False),
        ("a.py", f"# one\n# two\n# three\n\n# sloppatrol: check - {REASON}\n", 5, False),
    ],
)
def test_line_one_hit_is_covered_by_the_leading_comment_block(
    name: str, text: str, line: int, covered: bool
) -> None:
    assert gate.marker_covers(name, text, line, 1) is covered


def test_rule_test_lists_only_need_one_case(tmp_path: Path) -> None:
    path = write(tmp_path, "t.yml", 'id: check\nvalid: [\n  "a: b"]\ninvalid:\n  - print("a: b")\n')
    assert gate.yaml_fields(path, {"id", "valid", "invalid"}) == dict(id="check", valid=True, invalid=True)


def test_untracked_directories_are_not_changes(repo: Path) -> None:
    base = commit(repo)
    git(repo, "clone", "-q", str(repo), str(repo / "nested"))
    write(repo, "new.txt", "x\n")
    assert gate.changes(repo, base) == [["A", "new.txt"]]


def test_script_tests_ignore_hook_environment_and_global_config(repo: Path) -> None:
    script(repo)
    commit(repo)
    index = repo.parent / "hook-index"
    shutil.copy2(repo / ".git/index", index)
    before = index.read_bytes()
    hook = write(repo.parent, "global-hooks/pre-commit", "#!/bin/sh\nexit 1\n")
    hook.chmod(0o755)
    excludes = write(repo.parent, "global-excludes", "*.txt\n")
    config = write(
        repo.parent, "global.gitconfig", f"[core]\n\thooksPath = {hook.parent}\n\texcludesFile = {excludes}\n"
    )
    env = dict(GIT_INDEX_FILE=str(index), GIT_CONFIG_GLOBAL=str(config))
    result = invoke(repo, "--json", env=env)
    assert result.returncode == 0, result.stdout
    assert index.read_bytes() == before


def test_script_output_may_quote_other_locations(repo: Path) -> None:
    script(repo)
    body = "print('src/a.py:1: script-check copy of src/b.py:12: dup block'); raise SystemExit(1)\n"
    (repo / ".sloppatrol/scripts/script-check.py").write_text(
        (repo / ".sloppatrol/scripts/script-check.py").read_text().replace(SCRIPT, "")
        + "from pathlib import Path\nif not Path('live.flag').exists():\n"
        + "".join("    " + line + "\n" for line in SCRIPT.splitlines())
        + "else:\n    "
        + body
    )
    write(repo, "live.flag", "")
    hits = report(repo, code=1)["findings"]
    assert [(h["path"], h["line"], h["message"]) for h in hits] == [
        ("src/a.py", 1, "copy of src/b.py:12: dup block")
    ]


def test_script_expected_ignores_blank_lines(repo: Path) -> None:
    script(repo)
    write(repo, ".sloppatrol/script-tests/script-check/clean/expected", "\n")
    write(repo, ".sloppatrol/script-tests/script-check/bad/expected", "sample.txt:1\n\n")
    assert report(repo)["findings"] == []


def test_all_needs_no_history(repo: Path) -> None:
    script(repo, scope="changed")
    commit(repo)
    clone = repo.parent / "shallow-all"
    git(repo.parent, "clone", "--depth", "1", repo.as_uri(), str(clone))
    data = report(clone, "--all", code=2)
    assert codes(data) == {"sloppatrol-base"}


@AST
@pytest.mark.parametrize(
    "config", ["ruleDirs: [other]\ntestConfigs: [{testDir: rule-tests}]\n", "ruleDirs: [rules]\n"]
)
def test_rules_or_rule_tests_that_ast_grep_skips_fail_closed(repo: Path, config: str) -> None:
    rule(repo)
    (repo / ".sloppatrol/other").mkdir()
    write(repo, ".sloppatrol/other/keep.txt", "")
    write(repo, ".sloppatrol/sgconfig.yml", config)
    write(repo, "src/a.py", "bad()\n")
    assert codes(report(repo, code=2)) == {"sloppatrol-ast-grep"}


@AST
def test_files_ast_grep_skips_by_design_pass_and_unreadable_files_fail_closed(repo: Path) -> None:
    rule(repo)
    write(repo, "src/empty.py", "")
    write(repo, "src/huge.py", "bad()\n" + "x = 1\n" * 600_000)
    assert report(repo, "--all")["findings"] == []
    (repo / "src/c.py").write_bytes(b'x = "\xff\xfe"\nbad()\n')
    data = report(repo, code=2)
    assert (
        codes(data) == {"sloppatrol-ast-grep"} and "could not read 1 files" in data["findings"][0]["message"]
    )


@AST
def test_ast_grep_ignore_in_any_parsed_file(repo: Path) -> None:
    rule(repo)
    write(
        repo,
        ".sloppatrol/sgconfig.yml",
        (repo / ".sloppatrol/sgconfig.yml").read_text() + 'languageGlobs:\n  python: ["*.pyw"]\n',
    )
    write(repo, "src/s.pyi", "# ast-grep-ignore\nbad()\n")
    write(repo, "src/w.pyw", "# ast-grep-ignore\nbad()\n")
    write(repo, "docs/notes.md", "Never write ast-grep-ignore.\n")
    data = report(repo, code=1)
    ignored = {(h["path"], h["line"]) for h in data["findings"] if h["id"] == "sloppatrol-ast-grep-ignore"}
    assert ignored == {("src/s.pyi", 1), ("src/w.pyw", 1)}


def test_github_annotations_and_summary_block(repo: Path) -> None:
    script(repo)
    write(repo, ".sloppatrol/script-tests/script-check/bad/expected", "sample.txt:2\n")
    write(repo, "a,b.txt", "BAD\n\nBAD\n")
    write(repo, "src/a.py", f"# sloppatrol: unknown - {REASON}\ngood()\n")
    plain = invoke(repo)
    assert plain.returncode == 1 and "::error" not in plain.stdout and "===" not in plain.stdout
    result = invoke(repo, env={"GITHUB_ACTIONS": "true"})
    assert result.returncode == 1
    lines = result.stdout.splitlines()
    test_message = "script-check/bad: missing ['sample.txt:2'], extra ['sample.txt:1']"
    assert lines[lines.index("fix:") + 2 :] == [
        f"::error title=sloppatrol-script-test::{test_message}",
        "::error file=a%2Cb.txt,line=1,title=script-check::Replace BAD",
        "::error file=a%2Cb.txt,line=3,title=script-check::Replace BAD",
        "::error file=src/a.py,line=1,title=sloppatrol-unknown-id::unknown",
        "=== sloppatrol findings: 4 ===",
        "script-check (2): a,b.txt:1 a,b.txt:3",
        "sloppatrol-script-test (1): sloppatrol",
        "sloppatrol-unknown-id (1): src/a.py:1",
        "=== end sloppatrol findings ===",
    ]
    clean = invoke(repo, "--json", env={"GITHUB_ACTIONS": "true"})
    assert "::error" not in clean.stdout and json.loads(clean.stdout)["findings"]


def inputs(path: Path, globs: str) -> Path:
    shebang, rest = path.read_text().split("\n", 1)
    path.write_text(f"{shebang}\n# sloppatrol-inputs: {globs}\n{rest}")
    return path


def sites(data: dict) -> set[tuple[str, str]]:
    return {(h["id"], h["path"]) for h in data["findings"] if not h["suppressed"]}


def test_sloppatrol_inputs_skip_an_untouched_whole_tree_script_under_fast(repo: Path) -> None:
    inputs(script(repo), "*.txt")
    write(repo, "old.txt", "BAD\n")
    write(repo, "keep.txt", "GOOD\n")
    write(repo, "src/b.py", f"# sloppatrol: script-check - {REASON}\ngood()\n")
    base = commit(repo)
    write(repo, "src/a.py", "good()\n# edited\n")
    full = report(repo, "--base", base, code=1)
    assert sites(full) == {("script-check", "old.txt"), ("sloppatrol-unused-marker", "src/b.py")}
    fast = invoke(repo, "--fast", "--base", base)
    assert fast.returncode == 0 and "--fast: 1 scripts skipped;" in fast.stderr, fast.stdout + fast.stderr
    write(repo, "new.txt", "BAD\n")
    moved = report(repo, "--fast", "--base", base, code=1)
    assert sites(moved) == sites(full) | {("script-check", "new.txt")}
    (repo / "new.txt").unlink()
    (repo / "old.txt").unlink()
    deleted = report(repo, "--fast", "--base", base, code=1)
    assert sites(deleted) == {("sloppatrol-unused-marker", "src/b.py")}


@pytest.mark.parametrize("globs", ["", "*.txt *.nomatch"])
def test_sloppatrol_inputs_must_name_corpus_paths(repo: Path, globs: str) -> None:
    inputs(script(repo), globs)
    write(repo, "old.txt", "GOOD\n")
    assert codes(report(repo, code=2)) == {"sloppatrol-config"}


@AST
def test_fast_keeps_every_finding_on_a_changed_file(repo: Path) -> None:
    rule(repo)
    script(repo)
    write(repo, "src/old.py", "bad()\n")
    write(repo, "src/kept.py", f"# sloppatrol: check - {REASON}\nbad()\n")
    write(repo, "old.txt", "BAD\n")
    base = commit(repo)
    write(repo, "src/new.py", "bad()\n")
    write(repo, "src/a.py", f"good()\n# sloppatrol: check - {REASON}\ngood()\n")
    write(repo, "new.txt", "BAD\n")
    full = report(repo, "--base", base, code=1)
    assert sites(full) == {
        ("check", "src/old.py"),
        ("check", "src/new.py"),
        ("sloppatrol-unused-marker", "src/a.py"),
        ("script-check", "old.txt"),
        ("script-check", "new.txt"),
    }
    assert sites(report(repo, "--fast", "--base", base, code=1)) == sites(full) - {("check", "src/old.py")}
    shutil.copy2(SCRIPTS / "gate.py", repo / ".sloppatrol/gate.py")
    assert sites(report(repo, "--fast", "--base", base, code=1)) == sites(full)


def test_fast_needs_a_base(repo: Path) -> None:
    assert invoke(repo, "--fast", "--all").returncode == 2


def test_scripts_never_receive_deleted_paths(repo: Path) -> None:
    body = """import os
from pathlib import Path
for name in Path(os.environ["SLOPPATROL_FILES"]).read_text().splitlines():
    assert Path(name).is_file(), name
"""
    inputs(script(repo, body=body + SCRIPT), "*.txt")
    write(repo, "gone.txt", "GOOD\n")
    write(repo, "staged.txt", "GOOD\n")
    write(repo, "keep.txt", "GOOD\n")
    base = commit(repo)
    (repo / "gone.txt").unlink()
    git(repo, "rm", "-q", "staged.txt")
    assert not report(repo, "--base", base)["findings"]
    fast = invoke(repo, "--fast", "--base", base)
    assert fast.returncode == 0 and "--fast: 0 scripts skipped;" in fast.stderr, fast.stdout + fast.stderr
