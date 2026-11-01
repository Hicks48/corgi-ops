from __future__ import annotations

import tkinter as tk
from typing import Callable, List

from .system import System
from .widgets import Button


def field_actions(field_type: str) -> List[str]:
    return ["open", "copy"] if field_type == "link" else ["copy"]


def field_buttons(parent: tk.Misc, field_type: str, on_action: Callable[[str], None], bg: str) -> List[Button]:
    """`[ open ] [ copy ]` buttons for a field's value, packed to the right of `parent`."""
    buttons = [Button(parent, action, lambda a=action: on_action(a), bg=bg) for action in field_actions(field_type)]
    for button in reversed(buttons):
        button.pack(side="right", padx=(1, 0))
    return buttons


def run_field_action(system: System, action: str, field: dict) -> str:
    """Runs the action; returns a message for the user."""
    if field["value"] == "":
        return f"{field['name']} is empty"
    if action == "open":
        system.open(field["value"])
        return f"Opened {field['name']}"
    system.copy(field["value"])
    return f"Copied {field['name']}"
