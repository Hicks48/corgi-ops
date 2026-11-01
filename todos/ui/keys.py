from __future__ import annotations

import sys
from dataclasses import dataclass
from typing import Sequence, TypeVar

T = TypeVar("T")

_NAMES = {"iso_left_tab": "tab", "kp_enter": "return"}


@dataclass(frozen=True)
class Key:
    """A key press, independent of Tk so screens can be driven directly in tests."""

    name: str
    """Lowercased keysym: `a`, `return`, `escape`, `tab`, `left`, `space`, `bracketleft`..."""
    char: str = ""
    """The typed character, if any. Printable keys are matched on this (layouts differ in keysyms)."""
    ctrl: bool = False
    shift: bool = False
    meta: bool = False
    """Command on macOS."""

    @staticmethod
    def from_event(event) -> "Key":
        name = event.keysym.lower()
        state = event.state if isinstance(event.state, int) else 0
        shift = bool(state & 0x1) or event.keysym == "ISO_Left_Tab"
        meta = sys.platform == "darwin" and bool(state & 0x8)
        char = event.char if event.char and event.char.isprintable() else ""
        return Key(_NAMES.get(name, name), char, ctrl=bool(state & 0x4), shift=shift, meta=meta)

    def command(self, letter: str) -> bool:
        """ctrl+<letter>; on macOS also cmd+<letter> for save, as desktop users expect."""
        return self.name == letter and (self.ctrl or (self.meta and letter == "s"))


def cycle(items: Sequence[T], current: T, delta: int) -> T:
    """The item `delta` steps from `current`, wrapping around."""
    return items[(list(items).index(current) + delta) % len(items)]
