from __future__ import annotations

import json
import re
import shutil
import subprocess
from pathlib import Path

import pytest
from conftest import write

from skills.sloppatrol.scripts.gate import glob_matches

pytestmark = pytest.mark.skipif(
    shutil.which("ast-grep") is None, reason="ast-grep is not on PATH (glob oracle requires 0.44.1)"
)


@pytest.mark.parametrize(
    "pattern",
    [
        "*",
        "*.py",
        "src/*.py",
        "src/*/a.py",
        "**",
        "**/*.py",
        "src/**/a.py",
        "src/**",
        "src/**a.py",
        "?.py",
        "src/?.py",
        "src?a.py",
        "src/?/a.py",
        "[ab].py",
        "[!b].py",
        "[^b].py",
        "[a-c].py",
        "{a,b}.py",
        "{src,lib}/**/*.py",
        "src/{a,b}.py",
        "**/{a,b}.py",
        "{,src/}a.py",
        "{a,,b}.py",
        "{a,{b,c}}.py",
        "{}a.py",
        "src/**/**/a.py",
        "***/*.py",
        ".github/*.py",
        "**/a?.py",
        "src/[ab]/*.py",
        "a[[]b.py",
        "absent/*.py",
    ],
)
def test_globset_against_ast_grep_entity_oracle(tmp_path: Path, pattern: str) -> None:
    names = [
        "a.py",
        "b.py",
        "c.py",
        "ab.py",
        "a[b.py",
        "src/a.py",
        "src/b.py",
        "src/ab.py",
        "src/a/a.py",
        "src/b/b.py",
        "src/a/deeper/a.py",
        "src/deep/a.py",
        "lib/a.py",
        ".github/a.py",
    ]
    for name in names:
        write(tmp_path, name, "good()\n")
    config = "id: oracle\nlanguage: Python\nmessage: no hit needed\nrule: {pattern: bad()}\n"
    config += f"files: [{json.dumps(pattern)}]\n"
    result = subprocess.run(
        ["ast-grep", "scan", "--inline-rules", config, "--inspect", "entity", "--json=stream", *names],
        cwd=tmp_path,
        text=True,
        capture_output=True,
        check=False,
    )
    assert result.returncode == 0, result.stderr
    actual = set(
        re.findall(r"(?m)^sg: entity\|file\|(.+): language=Python,appliedRuleCount=1$", result.stderr)
    )
    assert len(re.findall(r"(?m)^sg: entity\|file\|", result.stderr)) == len(names), result.stderr
    assert {name for name in names if glob_matches(pattern, name)} == actual


def test_ast_grep_pin_and_documented_inspect_flag() -> None:
    result = subprocess.run(["ast-grep", "--version"], text=True, capture_output=True, check=True)
    assert result.stdout.strip() == "ast-grep 0.44.1"
    help_text = subprocess.run(
        ["ast-grep", "scan", "--help"], text=True, capture_output=True, check=True
    ).stdout
    assert "--inspect <GRANULARITY>" in help_text
    assert "entity:" in help_text
