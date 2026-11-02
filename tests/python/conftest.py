from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path
from typing import Any

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

SCRIPTS = Path(__file__).resolve().parents[2] / "skills/sloppatrol/scripts"


def write(root: Path, name: str, text: str) -> Path:
    path = root / name
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")
    return path


def run_script(script: str, root: Path, *args: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [sys.executable, str(SCRIPTS / script), *args, "--root", str(root)],
        text=True,
        capture_output=True,
        check=False,
    )


def git(root: Path, *args: str) -> str:
    return subprocess.check_output(["git", "-C", str(root), *args], text=True).strip()


@pytest.fixture
def repo(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    """An empty git repository isolated from the caller's CI variables, hooks and signing."""
    for key in (
        "GITHUB_ACTIONS",
        "GITHUB_BASE_REF",
        "GITHUB_EVENT_NAME",
        "SLOPPATROL_BASE",
        "SLOPPATROL_CHANGED",
    ):
        monkeypatch.delenv(key, raising=False)
    git(tmp_path, "init", "-q")
    git(tmp_path, "config", "user.name", "Test")
    git(tmp_path, "config", "user.email", "test@example.invalid")
    git(tmp_path, "config", "commit.gpgsign", "false")
    git(tmp_path, "config", "core.hooksPath", str(tmp_path / "no-hooks"))
    return tmp_path


def commit(root: Path) -> str:
    git(root, "add", "-A")
    git(root, "commit", "-qm", "fixture", "--allow-empty")
    return git(root, "rev-parse", "HEAD")


def review(root: Path, **changes: Any) -> Path:
    data = {
        "lenses": ["dead-code"],
        "scope": ["src/a.lua"],
        "files_read": ["src/a.lua"],
        "findings": [finding()],
        **changes,
    }
    return write(root, ".sloppatrol/runs/review.json", json.dumps(data))


def finding(**changes: Any) -> dict[str, Any]:
    return {
        "lens": "dead-code",
        "file": "src/a.lua",
        "quote": "local function unused()",
        "what": "Unused local function",
        "why": "No callers or dynamic references remain",
        "confidence": "high",
        **changes,
    }


def check_run(root: Path, path: Path) -> tuple[int, dict[str, Any]]:
    result = run_script("ledger.py", root, "check", str(path), "--json")
    assert not result.stderr, result.stderr
    return result.returncode, json.loads(result.stdout)[0]
