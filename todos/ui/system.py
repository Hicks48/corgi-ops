"""Side effects outside the window; injectable so tests don't touch the real clipboard or browser."""
from __future__ import annotations

import subprocess
import sys
import tkinter as tk
from typing import Protocol

from todos.core import TodoError, is_web_url


class System(Protocol):
    def copy(self, text: str) -> None: ...

    def open(self, url: str) -> None: ...


class TkSystem:
    def __init__(self, root: tk.Tk):
        self.root = root

    def copy(self, text: str) -> None:
        self.root.clipboard_clear()
        self.root.clipboard_append(text)

    def open(self, url: str) -> None:
        # Core already validates links; this guards against anything else reaching the OS handler.
        if not is_web_url(url):
            raise TodoError(f"not an http(s) link: {url}")
        command = {"darwin": ["open"], "win32": ["explorer"]}.get(sys.platform, ["xdg-open"])
        # A list (no shell), so nothing in the url is interpreted.
        try:
            subprocess.Popen([*command, url], stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        except OSError as err:
            raise TodoError(f"could not open {url}: {err}") from None
