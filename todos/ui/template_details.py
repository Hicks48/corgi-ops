from __future__ import annotations

import tkinter as tk
from typing import List, Optional

from todos.core import format_local_date_time, short_id

from .details_form import DetailsForm, FocusId
from .theme import BG
from .widgets import Box, Entry


class TemplateDetails(DetailsForm):
    text_placeholder = "Optional; empty keeps the task's own"

    def __init__(self, parent: tk.Misc, app, template: Optional[dict]):
        self.template = template
        self.header_text = f"Template {short_id(template['id'])}" if template else "New Template"
        meta = (
            f"Created {format_local_date_time(template['createdAt'])} · Updated {format_local_date_time(template['updatedAt'])}"
            if template
            else None
        )
        initial = template or {"title": "", "description": "", "fields": []}
        super().__init__(parent, app, initial, meta=meta, delete_prompt=f'Delete template "{template["name"]}"' if template else None)

    def top_ids(self) -> List[FocusId]:
        return ["name"]

    def build_top(self, frame: tk.Frame) -> None:
        row = tk.Frame(frame, bg=BG)
        row.pack(fill="x")
        box = Box(row, "Name", lambda: self.set_focus("name"))
        box.pack(side="left")
        self.name = Entry(box.body, self.template["name"] if self.template else "", placeholder="Required")
        self.name.configure(width=38)
        self.name.pack()
        self.add_focusable("name", self.name, box)

    def collect(self, values: dict) -> dict:
        return {**values, "name": self.name.value}

    def on_save(self, values: dict) -> None:
        self.app.save_template(self.template, values)

    def on_delete(self) -> None:
        self.app.delete_template(self.template)
