from __future__ import annotations

import tkinter as tk
from tkinter import ttk
from typing import Dict, List, Optional

from todos.core import STATUS_LABELS, STATUSES, apply_template, format_local_date_time, short_id

from .details_form import DetailsForm, FocusId
from .keys import Key, cycle
from .theme import ACCENT, BG, DIM, ON_ACCENT, STATUS_BADGES, STATUS_COLORS, TEXT
from .widgets import Box, Button, DateEntry, Entry, Text, label, textbox_height

NEW_COMMENT: FocusId = "comment:new"


def subtask_id(task: dict) -> FocusId:
    return f"subtask:{task['id']}"


def comment_id(comment: dict) -> FocusId:
    return f"comment:{comment['id']}"


def _template_label(template: dict) -> str:
    return f"{template['name']} · {template['title']}" if template["title"] else template["name"]


class TaskDetails(DetailsForm):
    text_placeholder = "Required"

    def __init__(self, parent: tk.Misc, app, task: Optional[dict], parent_task: Optional[dict], subtasks: List[dict], templates: List[dict], today: str):
        self.task = task
        self.parent_task = parent_task
        self.subtasks = subtasks
        self.templates = templates
        self.today = today
        self.status_value = task["status"] if task else "todo"
        self.applied: Optional[str] = None
        # Removals are staged until save, like custom fields.
        self.comments: List[dict] = list(task["comments"]) if task else []
        self.comment_widgets: Dict[str, tuple] = {}
        self.header_text = f"Task {short_id(task['id'])}" if task else "New Task"
        meta = f"Created {format_local_date_time(task['createdAt'])} · Updated {format_local_date_time(task['updatedAt'])}" if task else None
        initial = {"title": task["title"], "description": task["description"], "fields": task["fields"]} if task else {"title": "", "description": "", "fields": []}
        super().__init__(parent, app, initial, meta=meta, delete_prompt=f'Delete "{task["title"]}"' if task else None)

    @property
    def can_pick(self) -> bool:
        return self.task is None and len(self.templates) > 0

    def top_ids(self) -> List[FocusId]:
        return [
            *(["template"] if self.can_pick else []),
            "status",
            *(["completionDate"] if self.status_value == "done" else []),
            "targetDate",
            *(["id"] if self.task else []),
            "parent",
        ]

    def above_ids(self) -> List[FocusId]:
        return [subtask_id(t) for t in self.subtasks]

    def below_ids(self) -> List[FocusId]:
        return [*(comment_id(c) for c in self.comments), NEW_COMMENT] if self.task else []

    def is_locked(self, field: dict) -> bool:
        # Locked once saved; a new non-editable field can still be filled in before the first save.
        return not field["editable"] and self.task is not None and any(saved["name"] == field["name"] for saved in self.task["fields"])

    def build_top(self, frame: tk.Frame) -> None:
        row = tk.Frame(frame, bg=BG)
        row.pack(fill="x")
        if self.can_pick:
            box = Box(row, "Template", lambda: self.set_focus("template"))
            box.pack(side="left", padx=(0, 8))
            self.picker = ttk.Combobox(box.body, values=[_template_label(t) for t in self.templates], state="readonly", width=22, style="Picker.TCombobox")
            self.picker.set("none")
            self.picker.pack(fill="x")
            self.picker.bind("<<ComboboxSelected>>", lambda _e: self.pick(self.templates[self.picker.current()]))
            self.add_focusable("template", self.picker, box)

        status_box = Box(row, "Status", lambda: self.cycle_status(1, focus=True))
        status_box.pack(side="left", padx=(0, 8))
        self.status_label = label(status_box.body, takefocus=1, cursor="hand2", width=15)
        self.status_label.pack()
        status_box.clickable(self.status_label)
        self.add_focusable("status", self.status_label, status_box)

        self.completion_box = Box(row, "Completed", lambda: self.set_focus("completionDate"))
        self.completion = DateEntry(self.completion_box.body, (self.task or {}).get("completionDate") or self.today)
        self.completion.pack()
        self.add_focusable("completionDate", self.completion, self.completion_box)

        self.target_box = Box(row, "Target date", lambda: self.set_focus("targetDate"))
        self.target_box.pack(side="left", padx=(0, 8))
        self.target = DateEntry(self.target_box.body, self.task["targetDate"] if self.task else self.today)
        self.target.pack()
        self.add_focusable("targetDate", self.target, self.target_box)

        row2 = tk.Frame(frame, bg=BG)
        row2.pack(fill="x")
        if self.task:
            id_box = Box(row2, "Id", lambda: self.set_focus("id"))
            id_box.pack(side="left", padx=(0, 8))
            self.id_label = label(id_box.body, short_id(self.task["id"]), fg=DIM, takefocus=1)
            self.id_label.pack(side="left", padx=(0, 8))
            id_box.clickable(self.id_label)
            Button(id_box.body, "copy", self.copy_id).pack(side="left")
            self.add_focusable("id", self.id_label, id_box)

        parent_title = f"Parent · {self.parent_task['title']}" if self.parent_task else "Parent"
        parent_box = Box(row2, parent_title, lambda: self.set_focus("parent"))
        parent_box.pack(side="left", fill="x", expand=True)
        if self.parent_task:
            Button(parent_box.body, "open", lambda: self.app.open_task(self.parent_task)).pack(side="right", padx=(8, 0))
        self.parent_entry = Entry(parent_box.body, (self.task or {}).get("parentId", ""), placeholder="Optional; id of the parent task")
        self.parent_entry.pack(side="left", fill="x", expand=True)
        self.add_focusable("parent", self.parent_entry, parent_box)
        self._render_status()

    def build_above(self, frame: tk.Frame) -> None:
        if not self.subtasks:
            return
        box = Box(frame, "Subtasks")
        box.pack(fill="x")
        for task in self.subtasks:
            row = tk.Frame(box.body, bg=BG, takefocus=1)
            row.pack(fill="x")
            badge = label(row, STATUS_BADGES[task["status"]], fg=STATUS_COLORS[task["status"]])
            badge.pack(side="left", padx=(0, 8))
            button = Button(row, "open", lambda t=task: self.app.open_task(t))
            button.pack(side="right")
            title = label(row, task["title"])
            title.pack(side="left", fill="x", expand=True)
            id = subtask_id(task)
            for widget in (row, badge, title):
                widget.bind("<Button-1>", lambda _e, i=id: self.set_focus(i))

            def on_active(active: bool, row=row, badge=badge, title=title, button=button, task=task) -> None:
                bg = ACCENT if active else BG
                for widget in (row, title):
                    widget.configure(bg=bg)
                badge.configure(bg=bg, fg=ON_ACCENT if active else STATUS_COLORS[task["status"]])
                title.configure(fg=ON_ACCENT if active else TEXT)
                button.recolor(ON_ACCENT if active else DIM, bg)

            self.add_focusable(id, row, on_active=on_active)

    def build_below(self, frame: tk.Frame) -> None:
        if not self.task:
            return
        for comment in self.comments:
            edited = "" if comment["updatedAt"] == comment["createdAt"] else f" · edited {format_local_date_time(comment['updatedAt'])}"
            id = comment_id(comment)
            box = Box(frame, f"Comment · {format_local_date_time(comment['createdAt'])}{edited}", lambda i=id: self.set_focus(i))
            box.pack(fill="x")
            Button(box.body, "remove", lambda c=comment: self.remove_comment(c)).pack(side="right", anchor="n", padx=(8, 0))
            text = Text(box.body, comment["text"], height=textbox_height(comment["text"]))
            text.pack(side="left", fill="x", expand=True)
            self.comment_widgets[comment["id"]] = (box, text)
            self.add_focusable(id, text, box)
        box = Box(frame, "New comment", lambda: self.set_focus(NEW_COMMENT))
        box.pack(fill="x")
        self.new_comment = Text(box.body, height=2, placeholder="Progress note; saved with ctrl+s")
        self.new_comment.pack(fill="x")
        self.add_focusable(NEW_COMMENT, self.new_comment, box)

    def _render_status(self) -> None:
        self.status_label.configure(text=f"‹ {STATUS_LABELS[self.status_value]} ›", fg=STATUS_COLORS[self.status_value])
        if self.status_value == "done":
            self.completion_box.pack(side="left", padx=(0, 8), before=self.target_box)
        else:
            self.completion_box.pack_forget()

    def cycle_status(self, delta: int, focus: bool = False) -> None:
        self.status_value = cycle(STATUSES, self.status_value, delta)
        self._render_status()
        if focus:
            self.set_focus("status")

    def pick(self, template: dict) -> None:
        self.replace(apply_template(self.values(), template))
        self.applied = template["name"]
        self.picker.set(template["name"])
        self.set_focus("title")

    def copy_id(self) -> None:
        try:
            self.system.copy(self.task["id"])
            self.show_notice("Copied task id")
        except Exception as err:  # noqa: BLE001
            self.show_error(str(err))

    def remove_comment(self, comment: dict) -> None:
        index = self.comments.index(comment)
        self.comments.remove(comment)
        self.comment_widgets.pop(comment["id"])[0].destroy()
        self.remove_focusable(comment_id(comment))
        neighbours = (self.comments[index : index + 1] or self.comments[index - 1 : index]) if self.comments else []
        self.set_focus(comment_id(neighbours[0]) if neighbours else NEW_COMMENT)
        self.show_notice("Removed comment (ctrl+s to save, esc to discard)")

    def comment_values(self) -> List[dict]:
        """Read from the widgets at save time; an empty new-comment box adds nothing."""
        added = self.new_comment.value
        return [
            *({"id": c["id"], "text": self.comment_widgets[c["id"]][1].value} for c in self.comments),
            *([{"text": added}] if added.strip() else []),
        ]

    def on_key(self, key: Key) -> bool:
        focus = self.focus_id
        if focus == "template" and key.name in ("return", "space"):
            self.picker.event_generate("<Down>")
            return True
        if key.command("p") and self.parent_task:
            self.app.open_task(self.parent_task)
            return True
        subtask = next((t for t in self.subtasks if subtask_id(t) == focus), None)
        if subtask and key.name == "return":
            self.app.open_task(subtask)
            return True
        comment = next((c for c in self.comments if comment_id(c) == focus), None)
        if comment and key.command("x"):
            self.remove_comment(comment)
            return True
        if key.command("y") and focus == "id":
            self.copy_id()
            return True
        if focus == "status" and key.name in ("left", "right", "space"):
            self.cycle_status(-1 if key.name == "left" else 1)
            return True
        return False

    def extra_hints(self) -> List[str]:
        focus = self.focus_id
        return [
            *(["enter pick template"] if self.can_pick else []),
            "←→ status",
            *(["ctrl+y copy id"] if focus == "id" else []),
            *(["ctrl+p open parent"] if self.parent_task else []),
            *(["enter open subtask"] if focus.startswith("subtask:") else []),
            *(["ctrl+x remove comment"] if focus.startswith("comment:") and focus != NEW_COMMENT else []),
        ]

    def collect(self, values: dict) -> dict:
        return {
            **values,
            "status": self.status_value,
            "target_date": self.target.value.strip(),
            "completion_date": self.completion.value.strip() if self.status_value == "done" else None,
            "parent_id": self.parent_entry.value.strip() or None,
            **({"comments": self.comment_values()} if self.task else {}),
        }

    def on_save(self, values: dict) -> None:
        self.app.save_task(self.task, values)

    def on_delete(self) -> None:
        self.app.delete_task(self.task)
