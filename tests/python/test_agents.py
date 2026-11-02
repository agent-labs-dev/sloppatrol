from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path
from typing import Any

import pytest
from conftest import SCRIPTS, git, run_script, write

from skills.sloppatrol.scripts import agents

GOOD = """\
# Agent instructions

Work on this small library using the checks below.

## Checks

```sh
echo ok
```

## Rules

- Keep changes focused.
"""
PACK = """\
---
name: example-pack
description: Skills for the example project.
---
# Example pack

## Requirements

- **EX-1** Keep the public API compatible.
  This continuation is not part of the first line.
- **EX-2** Check error paths.

## Examples

- **IGNORE-1** Not a requirement.
"""


def check(tmp_path: Path, content: str = GOOD, *args: str) -> tuple[int, dict[str, Any]]:
    write(tmp_path, "AGENTS.md", content)
    result = run_script("agents.py", tmp_path, "check", "--json", *args)
    assert not result.stderr, result.stderr
    return result.returncode, json.loads(result.stdout)


def errors(root: Path, content: str) -> list[dict[str, Any]]:
    return [
        item for item in agents.check_file(root, "AGENTS.md", content, 300) if item["severity"] == "error"
    ]


def command_doc(command: str, tag: str = "sh") -> str:
    return GOOD.replace("```sh\necho ok", f"```{tag}\n{command}")


def test_good_instructions(tmp_path: Path) -> None:
    code, result = check(tmp_path)
    assert code == 0
    assert result == {"files": ["AGENTS.md"], "skills": [], "issues": []}
    human = run_script("agents.py", tmp_path, "check")
    assert human.stdout == "Totals: 1 files, 0 errors, 0 notes\n"


def test_missing_root(tmp_path: Path) -> None:
    result = run_script("agents.py", tmp_path, "check", "--json")
    assert result.returncode == 1
    assert [item["code"] for item in json.loads(result.stdout)["issues"]] == ["missing-root"]


@pytest.mark.parametrize(
    "content, code",
    [
        (GOOD.replace("Work on this small library using the checks below.", ""), "missing-summary"),
        (GOOD.replace("## Checks", "## Usage"), "missing-commands"),
        (GOOD.replace("```sh\necho ok\n```", "Run the tests."), "missing-commands"),
        (GOOD.replace("## Rules", "### Rules"), "missing-rules"),
        (GOOD.replace("## Rules", "## Guidance"), "missing-rules"),
        (GOOD + "\n" * 300, "over-budget"),
    ],
)
def test_required_parts(tmp_path: Path, content: str, code: str) -> None:
    assert [item["code"] for item in errors(tmp_path, content)] == [code]


def test_vendored_gate_must_be_in_the_checks(tmp_path: Path) -> None:
    write(tmp_path, ".sloppatrol/gate.py", "")
    assert [item["code"] for item in errors(tmp_path, GOOD)] == ["missing-gate"]
    assert errors(tmp_path, command_doc("python3 .sloppatrol/gate.py --base origin/main")) == []


@pytest.mark.parametrize(
    "intro", ["- Only a list.", "<!-- hidden prose -->", "```text\nexample\n```", "## Intro"]
)
def test_summary_requires_prose(tmp_path: Path, intro: str) -> None:
    content = GOOD.replace("Work on this small library using the checks below.", intro)
    assert "missing-summary" in {item["code"] for item in errors(tmp_path, content)}


def test_summary_without_h1_and_case_insensitive_headings(tmp_path: Path) -> None:
    content = (
        GOOD.replace("# Agent instructions\n\n", "")
        .replace("Checks", "DEVELOPMENT")
        .replace("Rules", "Boundaries")
    )
    assert errors(tmp_path, content) == []


def test_emphasized_summary_is_prose(tmp_path: Path) -> None:
    content = GOOD.replace("Work on this small library", "**Work** on this small library")
    assert errors(tmp_path, content) == []


def test_fenced_examples_do_not_supply_headings_or_paths(tmp_path: Path) -> None:
    content = (
        GOOD.replace("## Rules", "## Reference") + "\n````md\n## Rules\n```\n`gone.py`\n[x](gone.md)\n````\n"
    )
    assert [item["code"] for item in errors(tmp_path, content)] == ["missing-rules"]


def test_max_lines_boundary(tmp_path: Path) -> None:
    count = len(GOOD.splitlines())
    assert check(tmp_path, GOOD, "--max-lines", str(count))[0] == 0
    code, result = check(tmp_path, GOOD, "--max-lines", str(count - 1))
    assert code == 1
    assert result["issues"][0]["line"] == count


@pytest.mark.parametrize("title", ["Project Overview", "Summary", "Introduction", "About"])
def test_opening_summary_section(tmp_path: Path, title: str) -> None:
    content = GOOD.replace("Work on this", f"## {title}\n\nWork on this")
    assert errors(tmp_path, content) == []
    assert "missing-summary" in {
        item["code"] for item in errors(tmp_path, content.replace("Work on this", "- Work on this"))
    }


def sized_doc(size: int) -> str:
    return GOOD + "x" * (size - len(GOOD.encode("utf-8")))


@pytest.mark.parametrize(
    "size, expected",
    [(12288, None), (12289, "bytes-note"), (32768, "bytes-note"), (32769, "over-bytes")],
)
def test_byte_budget_boundaries(tmp_path: Path, size: int, expected: str | None) -> None:
    code, result = check(tmp_path, sized_doc(size))
    assert code == int(expected == "over-bytes")
    assert [item["code"] for item in result["issues"]] == ([expected] if expected else [])
    if expected:
        assert f"{size} bytes" in result["issues"][0]["message"]
        assert result["issues"][0]["severity"] == ("error" if expected == "over-bytes" else "note")


def test_byte_budget_counts_utf8_and_original_newlines(tmp_path: Path) -> None:
    content = sized_doc(32767) + "é"
    assert check(tmp_path, content)[1]["issues"][0]["code"] == "over-bytes"
    content = sized_doc(32768).replace("\n", "\r\n")
    (tmp_path / "AGENTS.md").write_bytes(content.encode("utf-8"))
    found = agents.check(tmp_path)["issues"]
    assert found[0]["code"] == "over-bytes"
    assert f"{len(content.encode('utf-8'))} bytes" in found[0]["message"]


def test_byte_budget_chains_do_not_combine_siblings(tmp_path: Path) -> None:
    write(tmp_path, "AGENTS.md", sized_doc(12000))
    write(tmp_path, "one/AGENTS.md", sized_doc(12000))
    write(tmp_path, "two/AGENTS.md", sized_doc(12000))
    write(tmp_path, "one/deep/AGENTS.md", sized_doc(12000))
    found = agents.check(tmp_path)["issues"]
    assert [(item["file"], item["code"]) for item in found] == [
        ("one/AGENTS.md", "bytes-note"),
        ("one/deep/AGENTS.md", "over-bytes"),
        ("two/AGENTS.md", "bytes-note"),
    ]
    assert "36000 bytes" in found[1]["message"]
    assert "'Rules' (one/deep/AGENTS.md:11)" in found[1]["message"]


def test_byte_budget_does_not_charge_assembly_separators_or_empty_files(tmp_path: Path) -> None:
    write(tmp_path, "AGENTS.md", sized_doc(16384))
    write(tmp_path, "one/AGENTS.md", " \n" * 40)
    write(tmp_path, "one/deep/AGENTS.md", sized_doc(16384))
    found = [item for item in agents.check(tmp_path)["issues"] if item["code"] == "over-bytes"]
    assert found == []


def test_byte_budget_names_cut_sections_and_ignores_examples(tmp_path: Path) -> None:
    content = sized_doc(32768) + "\n```text\n## Example only\n```\n<!-- ## Hidden -->\n## Later\nDetails\n"
    found = check(tmp_path, content)[1]["issues"][0]
    assert found["code"] == "over-bytes"
    assert found["line"] == 14
    assert "first H2 affected: 'Rules'" in found["message"]
    assert "first H2 starting past the cut: 'Later'" in found["message"]
    assert "Example" not in found["message"] and "Hidden" not in found["message"]


def test_byte_budget_reports_ancestor_cut_for_descendant_chain(tmp_path: Path) -> None:
    write(tmp_path, "AGENTS.md", sized_doc(32769))
    write(tmp_path, "one/AGENTS.md", GOOD)
    found = agents.check(tmp_path)["issues"]
    assert len(found) == 2
    assert all(item["code"] == "over-bytes" for item in found)
    assert "'Rules' (AGENTS.md:11)" in found[1]["message"]
    assert "first H2 starting past the cut: 'Checks' (one/AGENTS.md:5)" in found[1]["message"]
    assert found[1]["file"] == "one/AGENTS.md" and found[1]["line"] == 1


def test_byte_budget_without_headings_and_with_line_budget(tmp_path: Path) -> None:
    _, result = check(tmp_path, "x" * 32769 + "\n" * 301)
    codes = {item["code"] for item in result["issues"]}
    assert {"over-bytes", "over-budget"} <= codes
    found = next(item for item in result["issues"] if item["code"] == "over-bytes")
    assert "no H2 section past the cut" in found["message"]


@pytest.mark.parametrize("in_git", [False, True])
def test_enumeration_skips_directories_and_gitignored_files(tmp_path: Path, in_git: bool) -> None:
    if in_git:
        git(tmp_path, "init", "-q")
    write(tmp_path, "AGENTS.md", GOOD)
    write(tmp_path, "nested/AGENTS.md", GOOD)
    for directory in agents.SKIP_DIRS - {".git"}:
        write(tmp_path, f"{directory}/AGENTS.md", "bad")
    write(tmp_path, "ignored/AGENTS.md", "bad")
    write(tmp_path, ".gitignore", "ignored/\n")
    expected = (
        ["AGENTS.md", "nested/AGENTS.md"]
        if in_git
        else ["AGENTS.md", "ignored/AGENTS.md", "nested/AGENTS.md"]
    )
    assert agents.check(tmp_path)["files"] == expected


def test_git_tracks_ignored_files_and_handles_deleted_files(tmp_path: Path) -> None:
    git(tmp_path, "init", "-q")
    write(tmp_path, "AGENTS.md", GOOD)
    child = write(tmp_path, "nested/AGENTS.md", GOOD)
    # Fixtures only; never stage anything in the repository under test.
    git(tmp_path, "add", "AGENTS.md", "nested/AGENTS.md")
    write(tmp_path, ".gitignore", "nested/\n")
    assert agents.check(tmp_path)["files"] == ["AGENTS.md", "nested/AGENTS.md"]
    child.unlink()
    assert agents.check(tmp_path)["issues"] == []
    (tmp_path / "AGENTS.md").unlink()
    assert agents.check(tmp_path)["issues"][0]["code"] == "missing-root"


def test_deleted_tracked_skill_is_not_checked(tmp_path: Path) -> None:
    git(tmp_path, "init", "-q")
    write(tmp_path, "AGENTS.md", GOOD)
    skill = write(tmp_path, ".agents/skills/example/SKILL.md", "---\nname: example\ndescription: x\n---\n")
    git(tmp_path, "add", "AGENTS.md", ".agents/skills/example/SKILL.md")
    skill.unlink()
    assert agents.check(tmp_path) == {"files": ["AGENTS.md"], "skills": [], "issues": []}


def test_nested_paths_are_relative_to_instruction_file(tmp_path: Path) -> None:
    write(tmp_path, "AGENTS.md", GOOD)
    write(tmp_path, "nested/local.md", "local")
    write(tmp_path, "shared.py", "")
    write(tmp_path, "nested/AGENTS.md", GOOD + "\n[local](local.md#anchor), `local.md`, `shared.py`\n")
    assert agents.check(tmp_path)["issues"] == []
    write(tmp_path, "nested/AGENTS.md", GOOD + "\n[bad](shared.py)\n`missing.py`\n")
    found = agents.check(tmp_path)["issues"]
    assert [(item["code"], item["file"]) for item in found] == [
        ("dead-link", "nested/AGENTS.md"),
        ("dead-path", "nested/AGENTS.md"),
    ]


def test_cd_earlier_on_the_line_sets_path_context(tmp_path: Path) -> None:
    write(tmp_path, "daemon/test/index.js", "")
    line = "\n- Daemon: `cd daemon && npm test` (or `node --test test/`, which runs `test/index.js`).\n"
    assert errors(tmp_path, GOOD + line) == []
    assert [item["message"] for item in errors(tmp_path, GOOD + line.replace("index.js", "main.js"))] == [
        "path does not exist: test/main.js"
    ]


@pytest.mark.parametrize(
    "reference",
    [
        "[guide](gone.md#part)",
        "[guide][ref]\n\n[ref]: gone.md 'Title'",
        "[guide][]\n\n[guide]: <gone.md>",
        "[guide]\n\n[guide]: gone.md",
    ],
)
def test_dead_link_forms(tmp_path: Path, reference: str) -> None:
    found = errors(tmp_path, GOOD + reference + "\n")
    assert len(found) == 1
    assert found[0]["code"] == "dead-link"
    assert found[0]["message"].endswith("gone.md")


def test_legitimate_links_and_escaped_destinations(tmp_path: Path) -> None:
    write(tmp_path, "a file.md", "")
    write(tmp_path, "guide(v2).md", "")
    content = (
        GOOD
        + """\n
[external](https://example.invalid/gone.md)
[mail](mailto:team@example.invalid)
[anchor](#local) [absolute](/outside) [cdn](//example.invalid/file)
[scheme](custom:guide.md)
[space](a%20file.md#part) [angle](<a file.md> "Title")
[parens](guide(v2).md) [escaped](guide\\(v2\\).md)
`[literal](not-a-link.md)`
<!-- [hidden](gone.md) `hidden.py` -->
"""
    )
    assert errors(tmp_path, content) == []


@pytest.mark.parametrize(
    "value",
    [
        "gone.py",
        "docs/gone.md",
        "./missing",
        "docs/missing/",
        "tests/*.py",
        "tests/**/test_?.py",
        "``docs/gone.md``",
    ],
)
def test_dead_paths(tmp_path: Path, value: str) -> None:
    content = GOOD + (value if value.startswith("``") else f"`{value}`")
    assert [item["code"] for item in errors(tmp_path, content)] == ["dead-path"]


@pytest.mark.parametrize(
    "value",
    [
        "https://example.invalid/x.py",
        "mailto:team@example.invalid",
        "<root>/src/x.py",
        "scripts/<name>.py",
        "owner/repo",
        "npm run test",
        "python3 script.py",
        "1.2.3",
        "v1.2.3-beta",
        "a.b.c",
        "--file=x.py",
        "-x.py",
        "~/file.py",
        "$HOME/file.py",
        "${ROOT}/file.py",
        "/tmp/nonexistent.py",
    ],
)
def test_path_lookalikes_are_ignored(tmp_path: Path, value: str) -> None:
    assert errors(tmp_path, GOOD + f"`{value}`\n") == []


def test_globs_match_files_and_directories(tmp_path: Path) -> None:
    write(tmp_path, "tests/nested/test_a.py", "")
    content = GOOD + "\n`tests/**/*.py` `tests/*/` `tests/nested/test_?.py`\n"
    assert errors(tmp_path, content) == []


def test_brace_paths_require_every_alternative(tmp_path: Path) -> None:
    write(tmp_path, "docs/one.md", "")
    write(tmp_path, "docs/two.md", "")
    content = GOOD + "`docs/{one,two}.md` `docs/{missing,{one,two}}.md`\n"
    found = errors(tmp_path, content)
    assert [(item["code"], item["message"]) for item in found] == [
        ("dead-path", "path does not exist: docs/missing.md")
    ]


@pytest.mark.parametrize("suffix", ["::run", "::Type.method", ":12", ":12:4", ":12-16"])
@pytest.mark.parametrize("reference", ["`{}`", "[source]({})"])
def test_source_locations_resolve_files(tmp_path: Path, suffix: str, reference: str) -> None:
    write(tmp_path, "src/main.py", "")
    write(tmp_path, "local.py", "")
    content = GOOD + reference.format("src/main.py" + suffix) + reference.format("local.py" + suffix)
    assert errors(tmp_path, content) == []
    found = errors(tmp_path, GOOD + reference.format("src/missing.py" + suffix))
    assert len(found) == 1
    assert found[0]["message"].endswith("src/missing.py")


@pytest.mark.parametrize(
    "value", ["@file://workspace/report.md", "custom://host/missing.py", "@custom:missing.md"]
)
def test_at_prefixed_and_custom_schemes(tmp_path: Path, value: str) -> None:
    assert errors(tmp_path, GOOD + f"`{value}` [resource]({value})\n") == []


def test_service_identifiers_are_not_paths_unless_directory_exists(tmp_path: Path) -> None:
    content = GOOD + "`permissions/storage.reader` `permissions/storage.writer`\n"
    assert errors(tmp_path, content) == []
    (tmp_path / "permissions").mkdir()
    assert len(errors(tmp_path, content)) == 2
    assert errors(tmp_path, GOOD + "`permissions/missing.py`\n")[0]["code"] == "dead-path"


@pytest.mark.parametrize("directory", ["checks", "checks/"])
def test_inline_files_resolve_against_earlier_directory(tmp_path: Path, directory: str) -> None:
    write(tmp_path, "checks/first.py", "")
    write(tmp_path, "checks/second.py", "")
    content = GOOD + f"In `{directory}` run `first.py` and `second.py`; also `missing.py`.\n"
    assert [item["message"] for item in errors(tmp_path, content)] == ["path does not exist: missing.py"]
    content = GOOD + f"Read `first.py` before `{directory}`.\n`second.py`\n"
    assert len(errors(tmp_path, content)) == 2


def test_inline_files_resolve_against_linked_file(tmp_path: Path) -> None:
    write(tmp_path, "docs/topic/guide.md", "")
    write(tmp_path, "docs/topic/one.md", "")
    write(tmp_path, "docs/topic/two.md", "")
    content = (
        GOOD
        + "Read [`guide.md`](docs/topic/guide.md) (plus `topic/{one,two}.md` and `one.md`).\n"
        + "Read [guide](docs/topic/guide.md) then `topic/missing.md`.\n"
        + "`topic/one.md`\n"
    )
    assert [item["message"] for item in errors(tmp_path, content)] == [
        "path does not exist: topic/missing.md",
        "path does not exist: topic/one.md",
    ]


@pytest.mark.parametrize("prefix", ["No", "No new", "Never create", "Do not add", "Don't introduce"])
def test_prohibited_files_are_not_required(tmp_path: Path, prefix: str) -> None:
    content = GOOD + f"{prefix} `registry.py` in `src/`. Read `missing.py`.\n"
    (tmp_path / "src").mkdir()
    assert [item["message"] for item in errors(tmp_path, content)] == ["path does not exist: missing.py"]


def test_explicit_other_repository_and_ellipsis_examples(tmp_path: Path) -> None:
    content = (
        GOOD
        + "Cases live in the `sample-suite` repository (`team/sample-suite`); "
        + "add `sample-suite/cases/new/`. Local code is `src/{client,runner,...}`.\n"
        + "Read `src/{client,runner,\u2026}` and `src/missing.py`.\n"
        + "Read `sample-suite/cases/new/`.\n"
    )
    assert [item["message"] for item in errors(tmp_path, content)] == [
        "path does not exist: src/missing.py",
        "path does not exist: sample-suite/cases/new/",
    ]


@pytest.mark.parametrize("form", ["import", "symlink", "duplicate", "other-symlink", "broken-symlink"])
def test_claude_sibling(tmp_path: Path, form: str) -> None:
    write(tmp_path, "AGENTS.md", GOOD)
    sibling = tmp_path / "CLAUDE.md"
    if form == "import":
        sibling.write_text("@AGENTS.md\n\nClaude-specific instructions.\n")
    elif form == "symlink":
        sibling.symlink_to("AGENTS.md")
    elif form == "duplicate":
        sibling.write_text(GOOD)
    else:
        sibling.symlink_to("OTHER.md")
        if form == "other-symlink":
            write(tmp_path, "OTHER.md", GOOD)
    assert [item["code"] for item in agents.check(tmp_path)["issues"]] == (
        [] if form in {"import", "symlink"} else ["claude-md"]
    )


@pytest.mark.parametrize("runner", ["npm", "pnpm", "yarn", "bun"])
def test_package_scripts_and_nearest_manifest(tmp_path: Path, runner: str) -> None:
    write(tmp_path, "package.json", json.dumps({"scripts": {"check": "echo ok"}}))
    assert errors(tmp_path, command_doc(f"{runner} run check")) == []
    assert errors(tmp_path, command_doc(f"{runner} run missing"))[0]["code"] == "dead-script"
    write(tmp_path, "nested/package.json", '{"scripts": {"local": "echo ok"}}')
    content = command_doc(f"{runner} run local && {runner} run check")
    found = agents.check_file(tmp_path, "nested/AGENTS.md", content, 300)
    assert [item["message"] for item in found if item["code"] == "dead-script"] == [
        f"{runner} run check: no script in nearest package.json"
    ]


def test_shell_split_quotes_prompts_assignments_comments_and_continuations(tmp_path: Path) -> None:
    write(tmp_path, "package.json", '{"scripts": {"ok": "echo ok"}}')
    command = (
        '$ A=b npm run ok && npm run bad || echo "a; npm run fake"; '
        "npm run worse | echo x # npm run ignored\n"
    )
    command += "npm run \\\nok\n"
    found = errors(tmp_path, command_doc(command))
    assert [item["message"].split(":")[0] for item in found] == ["npm run bad", "npm run worse"]
    assert len({item["line"] for item in found}) == 1


@pytest.mark.parametrize("tag", ["", "sh", "bash", "shell", "console", "zsh"])
def test_shell_tags_and_placeholder_lines(tmp_path: Path, tag: str) -> None:
    assert errors(tmp_path, command_doc("npm run missing", tag))[0]["code"] == "dead-script"
    assert errors(tmp_path, command_doc("npm run <script> && ./missing.py", tag)) == []
    assert errors(tmp_path, command_doc("npm run missing", "javascript")) == []


@pytest.mark.parametrize("tag", ["text", "python"])
def test_non_shell_fences_produce_no_path_errors_or_tool_notes(tmp_path: Path, tag: str) -> None:
    content = command_doc("not-a-command\n./missing.py\n`other.py`\n[link](missing.md)", tag)
    assert agents.check_file(tmp_path, "AGENTS.md", content, 300) == []


@pytest.mark.parametrize(
    "tree",
    [
        "src/\n  core/ # module\n    worker.py\n  api.py",
        "Root\n├── Child\n└── Child\n    └── Leaf",
        "src/\n|-- core/\n`-- api.py",
    ],
)
@pytest.mark.parametrize("tag", ["", "sh"])
def test_tree_listings_are_not_commands(tmp_path: Path, tree: str, tag: str) -> None:
    assert agents.check_file(tmp_path, "AGENTS.md", command_doc(tree, tag), 300) == []
    assert errors(tmp_path, command_doc(tree, tag) + "\n```sh\n./missing.py\n```\n")[0]["code"] == (
        "dead-script"
    )


def test_indented_shell_and_brace_scripts_still_checked(tmp_path: Path) -> None:
    write(tmp_path, "scripts/one.py", "")
    content = command_doc("  echo ok\n  python3 scripts/{one,missing}.py")
    assert [item["message"] for item in errors(tmp_path, content)] == [
        "command path does not exist: scripts/missing.py"
    ]


@pytest.mark.parametrize("location", [".venv/bin/local-tool", ".venv/Scripts/local-tool.exe"])
def test_tools_installed_in_project_environment(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, location: str
) -> None:
    monkeypatch.setattr(agents.shutil, "which", lambda _: None)
    tool = write(tmp_path, location, "")
    tool.chmod(0o755)
    content = command_doc("local-tool --help\nuv run local-tool")
    found = agents.check_file(tmp_path, "nested/AGENTS.md", content, 300)
    assert [item for item in found if "local-tool" in item["message"]] == []
    tool.chmod(0o644)
    found = agents.check_file(tmp_path, "nested/AGENTS.md", command_doc("local-tool"), 300)
    assert found[0]["code"] == "tool-not-found"


@pytest.mark.parametrize(
    "tool, filename, definition",
    [
        ("make", "Makefile", "check test: dep\n\t@echo ok\n"),
        ("just", "justfile", "check arg='value':\n    echo ok\n"),
    ],
)
def test_make_and_just(tmp_path: Path, tool: str, filename: str, definition: str) -> None:
    write(tmp_path, filename, definition)
    assert errors(tmp_path, command_doc(f"{tool} check")) == []
    assert errors(tmp_path, command_doc(f"{tool} missing"))[0]["code"] == "dead-script"
    assert errors(tmp_path, command_doc(f"{tool}")) == []
    if tool == "make":
        assert errors(tmp_path, command_doc("make -j 2 --load-average 1.5 check")) == []


@pytest.mark.parametrize(
    "command",
    [
        "./scripts/test.py",
        "scripts/test.py",
        "python3 scripts/test.py",
        "luajit scripts/test.py",
        "uv run scripts/test.py",
        "uv run python3 scripts/test.py",
    ],
)
def test_script_paths_and_globs(tmp_path: Path, command: str, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(agents.shutil, "which", lambda _: "/test/tool")
    assert errors(tmp_path, command_doc(command))[0]["code"] == "dead-script"
    write(tmp_path, "scripts/test.py", "")
    assert errors(tmp_path, command_doc(command)) == []
    assert errors(tmp_path, command_doc(command.replace("test.py", "*.py"))) == []


def test_interpreter_inline_code_and_output_paths_are_not_files(tmp_path: Path) -> None:
    assert (
        errors(
            tmp_path,
            command_doc(
                'python3 -c "print(1)"\npython3 -m example\necho output > new.txt\nnpm run "$SCRIPT"'
            ),
        )
        == []
    )


def test_static_cd_selects_manifest_and_resets_at_next_block(tmp_path: Path) -> None:
    write(tmp_path, "package.json", '{"scripts":{"root":"echo ok"}}')
    write(tmp_path, "nested/package.json", '{"scripts":{"child":"echo ok"}}')
    content = command_doc("cd nested && npm run child") + "\n```sh\nnpm run root\n```\n"
    assert errors(tmp_path, content) == []


@pytest.mark.parametrize(
    "manifest, tool",
    [
        ('[project.scripts]\napp = "example:main"\n', "app"),
        ('[project]\ndependencies = ["one>=1", "dep[extra]>=2"]\n', "dep"),
        ('[project.optional-dependencies]\ntest = ["optional>=1"]\n', "optional"),
        ('[dependency-groups]\nlint = [\n "group-tool>=1",\n]\n', "group-tool"),
        ("[dependency-groups]\nlint = [\"Some_Tool>=1; python_version > '3.10'\"]\n", "some-tool"),
        ('[tool.uv]\ndev-dependencies = ["legacy"]\n', "legacy"),
        ('[tool.poetry.group.dev.dependencies]\npoetry-tool = "*"\n', "poetry-tool"),
    ],
)
def test_uv_project_scripts_and_dependencies(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, manifest: str, tool: str
) -> None:
    monkeypatch.setattr(agents.shutil, "which", lambda _: None)
    write(tmp_path, "pyproject.toml", manifest)
    assert errors(tmp_path, command_doc(f"uv run {tool}")) == []
    found = errors(tmp_path, command_doc("uv run nonexistent"))
    assert len(found) == 1 and found[0]["code"] == "dead-script"


def test_uv_on_path_and_unrelated_manifest_strings(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(agents.shutil, "which", lambda word: "/bin/tool" if word == "installed" else None)
    write(tmp_path, "pyproject.toml", '[project]\nname = "unrelated"\n# dependencies = ["comment"]\n')
    assert errors(tmp_path, command_doc("uv run installed")) == []
    assert errors(tmp_path, command_doc("uv run unrelated"))[0]["code"] == "dead-script"
    assert errors(tmp_path, command_doc("uv run comment"))[0]["code"] == "dead-script"


def test_uv_script_names_are_exact_and_group_labels_are_not_tools(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(agents.shutil, "which", lambda _: None)
    write(
        tmp_path,
        "pyproject.toml",
        '[project.scripts]\nmy_script = "example:main"\n'
        '[dependency-groups]\n"checks" = [{include-group = "lint"}]\n"lint" = ["real-tool"]\n',
    )
    assert errors(tmp_path, command_doc("uv run my_script\nuv run real-tool")) == []
    for name in ("my-script", "lint", "checks"):
        assert errors(tmp_path, command_doc(f"uv run {name}"))[0]["code"] == "dead-script"


def test_tool_not_found_is_only_a_note(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("PATH", "")
    code, result = check(tmp_path, command_doc("unavailable-tool --help\necho ok"))
    assert code == 0
    assert [(item["code"], item["severity"]) for item in result["issues"]] == [("tool-not-found", "note")]


@pytest.mark.parametrize("location", [".agents/skills/example-pack", ".claude/skills/example-pack"])
@pytest.mark.parametrize("reference", ["`{}/SKILL.md`", "[skill]({}/SKILL.md)", "[skill]({}/)"])
def test_skill_references(tmp_path: Path, location: str, reference: str) -> None:
    content = GOOD + reference.format(location) + "\n"
    assert [item["code"] for item in errors(tmp_path, content)] == ["dead-skill"]
    path = write(tmp_path, f"{location}/SKILL.md", PACK)
    assert errors(tmp_path, content) == []
    path.write_text(PACK.replace("name: example-pack", "name: wrong"))
    assert [item["code"] for item in errors(tmp_path, content)] == ["dead-skill"]


@pytest.mark.parametrize(
    "description",
    [
        '"Description # with hash"',
        "'It''s a description'",
        ">-\n  Multi-line\n  description.",
        "|\n  Literal description.",
    ],
)
def test_frontmatter_string_forms(tmp_path: Path, description: str) -> None:
    path = write(
        tmp_path, "example-pack/SKILL.md", f"---\nname: example-pack\ndescription: {description}\n---\n"
    )
    assert agents.frontmatter_error(path) is None


@pytest.mark.parametrize(
    "content",
    [
        "# Skill\n",
        "---\nname: example-pack",
        "---\nname: example-pack\n---\n",
        "---\nname: example-pack\ndescription: ''\n---\n",
        "---\nname: example-pack\ndescription: []\n---\n",
    ],
)
def test_invalid_frontmatter(tmp_path: Path, content: str) -> None:
    assert agents.frontmatter_error(write(tmp_path, "example-pack/SKILL.md", content)) is not None


@pytest.mark.parametrize(
    "args",
    [
        ("--max-lines", "0"),
        ("--max-lines", "no"),
        ("--root", "/nonexistent/sloppatrol-test-root"),
    ],
)
def test_cli_usage_and_io_errors(tmp_path: Path, args: tuple[str, ...]) -> None:
    result = subprocess.run(
        [sys.executable, str(SCRIPTS / "agents.py"), "check", "--root", str(tmp_path), *args],
        capture_output=True,
        text=True,
        check=False,
    )
    assert result.returncode == 2
    assert "Traceback" not in result.stderr and "error:" in result.stderr


def test_default_root_git_toplevel_and_cwd_fallback(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    write(tmp_path, "AGENTS.md", GOOD)
    git(tmp_path, "init", "-q")
    child = tmp_path / "nested"
    child.mkdir()
    result = subprocess.run(
        [sys.executable, str(SCRIPTS / "agents.py"), "check", "--json"],
        cwd=child,
        capture_output=True,
        text=True,
        check=False,
    )
    assert result.returncode == 0
    assert json.loads(result.stdout)["files"] == ["AGENTS.md"]
    monkeypatch.chdir(child)
    monkeypatch.setenv("PATH", "")
    assert agents.default_root() == child


def test_read_error_is_exit_two(tmp_path: Path) -> None:
    (tmp_path / "AGENTS.md").write_bytes(b"\xff")
    result = run_script("agents.py", tmp_path, "check")
    assert result.returncode == 2 and "Traceback" not in result.stderr


def test_redirections_are_not_targets(tmp_path: Path) -> None:
    write(tmp_path, "Makefile", "test:\n\t@echo ok\n")
    commands = "make test > results.log\nmake test 2>&1 | tee out.log\nmake test >>log.txt 2>/dev/null"
    assert errors(tmp_path, command_doc(commands)) == []


def test_link_label_code_is_not_a_standalone_path(tmp_path: Path) -> None:
    write(tmp_path, "src/main.ts", "")
    assert errors(tmp_path, GOOD + "\nEntry: [`main.ts`](src/main.ts).\n") == []


def test_bun_runs_an_existing_file_without_a_script(tmp_path: Path) -> None:
    write(tmp_path, "package.json", '{"scripts":{}}')
    write(tmp_path, "src/main.ts", "")
    assert errors(tmp_path, command_doc("bun run src/main.ts")) == []
    assert errors(tmp_path, command_doc("npm run src/main.ts"))[0]["code"] == "dead-script"


def test_command_paths_do_not_fall_back_to_root_after_cd(tmp_path: Path) -> None:
    write(tmp_path, "scripts/check.py", "")
    write(tmp_path, "tools/.keep", "")
    assert errors(tmp_path, command_doc("cd tools && python3 scripts/check.py"))[0]["code"] == "dead-script"


@pytest.mark.parametrize("path", ["app/docs/[[...slug]]/page.tsx", "app/og/docs/[...slug]/route.tsx"])
def test_literal_bracketed_paths(tmp_path: Path, path: str) -> None:
    write(tmp_path, path, "")
    assert errors(tmp_path, GOOD + f"\nSource: `{path}:12`.\n") == []
    assert errors(tmp_path, command_doc(f"node '{path}'")) == []
    assert errors(tmp_path, GOOD + f"\nSource: `{path}.missing.tsx`.\n")[0]["code"] == "dead-path"


@pytest.mark.parametrize("nested", [False, True])
def test_external_worktree_sibling_citations(tmp_path: Path, nested: bool) -> None:
    primary = tmp_path / "projects/docs"
    primary.mkdir(parents=True)
    git(primary, "init", "-q")
    git(primary, "config", "user.name", "Test")
    git(primary, "config", "user.email", "test@example.invalid")
    git(primary, "config", "commit.gpgsign", "false")
    git(primary, "config", "core.hooksPath", str(tmp_path / "no-hooks"))
    write(primary, "AGENTS.md", GOOD)
    write(primary, "guides/AGENTS.md", GOOD)
    git(primary, "add", "AGENTS.md", "guides/AGENTS.md")
    git(primary, "commit", "-qm", "initial")
    worktree = tmp_path / "worktrees/docs"
    git(primary, "worktree", "add", "-qb", "docs-check", str(worktree))
    write(tmp_path, "projects/client/src/export.ts", "")
    file = "guides/AGENTS.md" if nested else "AGENTS.md"
    prefix = "../../" if nested else "../"
    content = GOOD + f"\nSource: `{prefix}client/src/export.ts:12`.\n"
    found = agents.check_file(worktree, file, content, 300)
    assert found == []
    skill = write(tmp_path, "projects/client/.agents/skills/example-pack/SKILL.md", PACK)
    skill_content = content.replace("src/export.ts:12", ".agents/skills/example-pack/SKILL.md")
    assert agents.check_file(worktree, file, skill_content, 300) == []
    skill.write_text("No frontmatter")
    assert agents.check_file(worktree, file, skill_content, 300)[0]["code"] == "dead-skill"
    missing = content.replace("export.ts", "missing.ts")
    assert agents.check_file(worktree, file, missing, 300)[0]["code"] == "dead-path"
    # Executable paths must still resolve where the documented command runs.
    assert errors(worktree, command_doc("node ../client/src/export.ts"))[0]["code"] == "dead-script"
    write(primary, "local-only.ts", "")
    assert errors(worktree, GOOD + "\n`local-only.ts`\n")[0]["code"] == "dead-path"


def test_explicit_upstream_citation_is_not_a_local_path(tmp_path: Path) -> None:
    assert errors(tmp_path, GOOD + "\nIn the `client` repository, see `client/src/export.ts:12`.\n") == []
    assert (
        errors(tmp_path, GOOD + "\nThe local source is `client/src/export.ts`.\n")[0]["code"] == "dead-path"
    )


@pytest.mark.parametrize(
    "table",
    [
        "| Kind | Goal |\n| --- | --- |\n| Tutorial | Learn |\n| Reference | Look up |",
        "+-----------+---------+\n| Kind      | Goal    |\n+-----------+---------+\n"
        "| Tutorial  | Learn   |\n+-----------+---------+",
    ],
)
def test_untagged_tables_are_not_commands(tmp_path: Path, table: str) -> None:
    assert agents.check_file(tmp_path, "AGENTS.md", command_doc(table, ""), 300) == []
    mixed = command_doc(table + "\n\npython3 missing.py", "")
    assert [item["code"] for item in agents.check_file(tmp_path, "AGENTS.md", mixed, 300)] == ["dead-script"]


def test_untagged_pipeline_still_checks_commands(tmp_path: Path) -> None:
    assert errors(tmp_path, command_doc("echo ok | python3 missing.py", ""))[0]["code"] == "dead-script"


LINK = "Read [the guide](references/guide.md).\n"
SKILL = "---\nname: example\ndescription: Use when the example task comes up.\n---\n# Example\n\n" + LINK
ENTRY = ".agents/skills/example/SKILL.md"
GUIDE = ".agents/skills/example/references/guide.md"


@pytest.mark.parametrize(
    "files, expected",
    [
        ({}, []),
        ({ENTRY: "# No frontmatter\n" + LINK}, [("skill-frontmatter", "SKILL.md")]),
        (
            {ENTRY: SKILL.replace("name: example", "name: other")},
            [("skill-frontmatter", "SKILL.md")],
        ),
        # Sorts before `example`, so the first skill's issues are this one's.
        (
            {".agents/skills/Bad_Name/SKILL.md": SKILL.replace("example", "Bad_Name").replace(LINK, "")},
            [("skill-frontmatter", "SKILL.md")],
        ),
        (
            {ENTRY: SKILL.replace("Use when", "x" * 1025)},
            [("skill-frontmatter", "SKILL.md")],
        ),
        ({ENTRY: SKILL + "line\n" * 494}, [("skill-over-budget", "SKILL.md")]),
        ({ENTRY: SKILL + "line\n" * 493}, []),
        ({".agents/skills/example/references/old.md": "# Old\n"}, [("skill-orphan", "references/old.md")]),
        ({".agents/skills/example/scripts/run.py": ""}, [("skill-orphan", "scripts/run.py")]),
        (
            {GUIDE: "See [missing](gone.md).\n"},
            [("dead-link", "references/guide.md")],
        ),
        # Cited from a sibling reference, by a holding directory, or by a repository-root path.
        (
            {
                GUIDE: "See [more](more.md).\n",
                ".agents/skills/example/references/more.md": "",
            },
            [],
        ),
        (
            {
                GUIDE: "Lenses live in `references/lenses/`.\n",
                ".agents/skills/example/references/lenses/a.md": "",
            },
            [],
        ),
        (
            {
                GUIDE: "Run `.agents/skills/example/scripts/run.py`.\n",
                ".agents/skills/example/scripts/run.py": "",
            },
            [],
        ),
        # A percent-encoded link cites the decoded file.
        (
            {
                ENTRY: SKILL + "See [it](references/my%20guide.md).\n",
                ".agents/skills/example/references/my guide.md": "",
            },
            [],
        ),
        # Files outside references/, scripts/ and assets/ are not resources, so need no citation.
        ({".agents/skills/example/LICENSE": "MIT\n"}, []),
    ],
)
def test_skill_checks(tmp_path: Path, files: dict[str, str], expected: list[tuple[str, str]]) -> None:
    files = {
        ENTRY: SKILL,
        GUIDE: "# Guide\n",
        **files,
    }
    for name, text in files.items():
        write(tmp_path, name, text)
    _, result = check(tmp_path)
    skill = next(iter(result["skills"]))
    assert [(item["code"], item["file"].removeprefix(f"{skill}/")) for item in result["issues"]] == expected


@pytest.mark.parametrize(
    "path, discovered",
    [
        (".claude/skills/example/SKILL.md", True),
        ("skills/example/SKILL.md", True),
        ("plugins/demo/skills/example/SKILL.md", True),
        ("src/app/skills/group/example/SKILL.md", True),
        ("cache/skills/abc123/packs/example/SKILL.md", False),
        ("src/example/SKILL.md", False),
        (".sloppatrol/script-tests/rule/case/head/.agents/skills/example/SKILL.md", False),
    ],
)
def test_skill_discovery(tmp_path: Path, path: str, discovered: bool) -> None:
    write(tmp_path, path, "# Broken on purpose: discovered skills report their frontmatter\n")
    code, result = check(tmp_path)
    assert (result["skills"] == [str(Path(path).parent)], code) == ((True, 1) if discovered else (False, 0))


def test_max_skill_lines(tmp_path: Path) -> None:
    write(tmp_path, ".agents/skills/example/SKILL.md", SKILL)
    write(tmp_path, ".agents/skills/example/references/guide.md", "")
    code, result = check(tmp_path, GOOD, "--max-skill-lines", "5")
    assert code == 1 and [item["code"] for item in result["issues"]] == ["skill-over-budget"]


@pytest.mark.parametrize("in_git", [False, True])
def test_symlinked_skill_directory_is_checked_through_its_target(tmp_path: Path, in_git: bool) -> None:
    if in_git:
        git(tmp_path, "init", "-q")
    write(tmp_path, "tools/linked/SKILL.md", "# Broken on purpose\n")
    (tmp_path / ".agents/skills").mkdir(parents=True)
    (tmp_path / ".agents/skills/linked").symlink_to("../../tools/linked")
    code, result = check(tmp_path)
    assert (code, result["skills"]) == (1, ["tools/linked"])
    assert [item["code"] for item in result["issues"]] == ["skill-frontmatter"]
