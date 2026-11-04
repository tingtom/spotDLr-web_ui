"""
spotDLr's version: the one place it's written. Shown in Settings → About.

When releasing: set VERSION here, rename [Unreleased] in CHANGELOG.md to this version, then tag vVERSION.
The Windows build refuses a tag that doesn't match VERSION, so the installer never shows a wrong number.
"""

import subprocess
import sys
import time
from pathlib import Path

VERSION = "2.6.0"


_build_cache = {"at": 0.0, "value": None}


def source_build():
    """From source, where this copy stands against the tags: "v2.0.1" (exactly the release),
    "v2.0.1-3-gabc1234" (3 commits after it), "-dirty" (uncommitted changes). None in the installed app."""
    if getattr(sys, "frozen", False):
        return None
    fork_build = Path(__file__).parent / ".fork-build"
    try:
        sha = fork_build.read_text(encoding="utf-8").strip()
        if sha:
            return f"fork-{sha}"
    except OSError:
        pass
    # Re-checked every 30 s, not once per run: committing while spotDLr runs must clear "unsaved edits"
    if time.monotonic() - _build_cache["at"] < 30:
        return _build_cache["value"]
    try:
        result = subprocess.run(["git", "describe", "--tags", "--dirty", "--always"], cwd=Path(__file__).parent,
                                capture_output=True, text=True, timeout=3)
        value = (result.stdout.strip() or None) if result.returncode == 0 else None
    except (OSError, subprocess.SubprocessError):
        value = None  # no git, or not a git checkout (e.g. a downloaded zip)
    _build_cache.update(at=time.monotonic(), value=value)
    return value
