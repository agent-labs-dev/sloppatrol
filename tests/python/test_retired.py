from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

from conftest import SCRIPTS, commit, git, write

from skills.sloppatrol.scripts import gate


def invoke(root: Path, *args: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [sys.executable, str(SCRIPTS / "gate.py"), *args, "--json"],
        cwd=root,
        text=True,
        capture_output=True,
        check=False,
    )


def retired_repo(tmp_path: Path) -> tuple[Path, str]:
    git(tmp_path, "init", "-q")
    git(tmp_path, "config", "user.name", "Test")
    git(tmp_path, "config", "user.email", "test@example.invalid")
    write(tmp_path, ".sloppatrol/scripts/size-no-growth.py", "print('rule')\n")
    write(tmp_path, "docs/design.md", "Intro\nThe size-no-growth rule is retired.\n")
    commit(tmp_path)
    (tmp_path / ".sloppatrol/scripts/size-no-growth.py").unlink()
    deleted = commit(tmp_path)
    return tmp_path, deleted


def test_retired_rule_still_named_in_docs_fails_the_gate(tmp_path: Path) -> None:
    root, deleted = retired_repo(tmp_path)
    result = invoke(root)
    assert result.returncode == 1, result.stdout + result.stderr
    data = json.loads(result.stdout)
    assert data["findings"] == [
        {
            "id": "sloppatrol-retired-id",
            "kind": "gate",
            "path": "docs/design.md",
            "line": 2,
            "message": f"size-no-growth was deleted in {deleted}",
            "suppressed": False,
            "marker_line": None,
        }
    ]


def test_retired_references_are_ignored_in_history_files_and_readded_ids(tmp_path: Path) -> None:
    root, _ = retired_repo(tmp_path)
    (root / "docs/design.md").write_text("Intro\nNo cap.\n")
    write(root, ".sloppatrol/reports/old.md", "size-no-growth fired twice\n")
    write(root, ".sloppatrol/runs/review.json", '{"note": "size-no-growth"}\n')
    write(root, ".sloppatrol/ledger.json", '{"reason": "size-no-growth"}\n')
    write(root, ".sloppatrol/rule-tests/size-no-growth-test.yml", "size-no-growth\n")
    write(root, ".sloppatrol/script-tests/size-no-growth/case/expected", "size-no-growth\n")
    write(root, "CHANGELOG.md", "size-no-growth\n")
    commit(root)
    data = json.loads(invoke(root).stdout)
    assert not any(item["id"] == "sloppatrol-retired-id" for item in data["findings"])
    write(root, ".sloppatrol/scripts/size-no-growth.py", "print('rule')\n")
    commit(root)
    assert gate.retired_ids(root) == {}


def test_shallow_full_gate_needs_history_for_retired_ids(tmp_path: Path) -> None:
    git(tmp_path, "init", "-q")
    git(tmp_path, "config", "user.name", "Test")
    git(tmp_path, "config", "user.email", "test@example.invalid")
    write(tmp_path, "src/a.py", "good()\n")
    commit(tmp_path)
    clone = tmp_path.parent / "shallow-retired"
    git(tmp_path.parent, "clone", "--depth", "1", tmp_path.as_uri(), str(clone))
    result = invoke(clone, "--all")
    assert result.returncode == 2
    assert {item["id"] for item in json.loads(result.stdout)["findings"]} == {"sloppatrol-base"}
