import os
from pathlib import Path


def corgiops_home() -> str:
    """Root for all corgi-ops app data. Override with CORGIOPS_HOME (used by tests)."""
    return os.environ.get("CORGIOPS_HOME") or str(Path.home() / ".corgiops")


def todos_dir() -> str:
    return os.path.join(corgiops_home(), "todos")
