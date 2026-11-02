"""This repository is public: no tracked file may carry text that belongs to a private codebase.

The generic patterns catch machine-local paths and non-public hosts. Words specific to a private
codebase cannot be listed here without publishing them, so a maintainer passes their own list at
run time: `SLOPPATROL_PRIVATE_DENYLIST=/path/outside/the/repo pytest tests/python/test_public_text.py`, one
case-insensitive regular expression per line.
"""

from __future__ import annotations

import os
import re
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
PUBLIC_PATTERNS = (
    r"/home/[a-z_][\w-]*/",
    r"/Users/[A-Za-z][\w-]*/",
    r"\b[\w-]+\.internal\b",
    r"\b(?:10\.\d{1,3}|192\.168|172\.(?:1[6-9]|2\d|3[01]))\.\d{1,3}\.\d{1,3}\b",
)


def tracked_text() -> list[tuple[str, str]]:
    names = subprocess.run(
        ["git", "-C", str(ROOT), "ls-files", "-z"], capture_output=True, check=True, text=True
    ).stdout.split("\0")
    files = []
    for name in filter(None, names):
        try:
            files.append((name, (ROOT / name).read_text(encoding="utf-8")))
        except (UnicodeDecodeError, FileNotFoundError):
            continue
    return files


def violations(patterns: list[str]) -> list[str]:
    pattern = re.compile("|".join(f"(?:{p})" for p in patterns), re.IGNORECASE)
    return [
        f"{name}:{number}: {match[0]}"
        for name, text in tracked_text()
        for number, line in enumerate(text.splitlines(), 1)
        if (match := pattern.search(line))
    ]


def test_no_machine_paths_or_private_hosts() -> None:
    assert violations(list(PUBLIC_PATTERNS)) == []


def test_no_private_codebase_terms() -> None:
    denylist = os.environ.get("SLOPPATROL_PRIVATE_DENYLIST")
    if not denylist:
        return
    lines = Path(denylist).read_text(encoding="utf-8").splitlines()
    patterns = [line.strip() for line in lines if line.strip() and not line.startswith("#")]
    assert violations(patterns) == []
