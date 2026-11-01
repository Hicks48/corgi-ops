"""Details / edit form shared by tasks and templates: title, custom fields, description, keys, save / delete.
Subclasses add their own top row and sections above / below the description."""
from __future__ import annotations

import tkinter as tk
from typing import Callable, Dict, List, Optional

from todos.core import FIELD_TYPES, TodoError, parse, parse_custom_field

from .field_buttons import field_buttons, run_field_action
from .keys import Key, cycle
from .theme import ACCENT, BG, DIM, ERROR, ON_ACCENT
from .widgets import Box, Button, DateEntry, Entry, Hints, ScrollFrame, StatusLine, Text, label, one_line, textbox_height

FocusId = str


def custom_id(name: str) -> FocusId:
    return f"custom:{name}"


class Focusable:
    def __init__(self, widget: tk.Widget, box: Optional[Box], on_active: Optional[Callable[[bool], None]]):
        self.widget = widget
        self.box = box
        self.on_active = on_active


class DetailsForm(tk.Frame):
    """Owns the keyboard while shown (the app forwards keys to `handle_key`)."""

    header_text = ""
    text_placeholder = ""

    def __init__(self, parent: tk.Misc, app, initial: dict, meta: Optional[str] = None, delete_prompt: Optional[str] = None):
        super().__init__(parent, bg=BG)
        self.app = app
        self.system = app.system
        self.delete_prompt = delete_prompt
        self.focus_id: FocusId = "title"
        self.focusables: Dict[FocusId, Focusable] = {}
        self.custom: List[dict] = list(initial["fields"])
        self.custom_widgets: Dict[str, tuple] = {}
        self.new_field: Optional[NewFieldForm] = None
        self.confirming = False
        self.error: Optional[str] = None
        self.notice: Optional[str] = None

        head = tk.Frame(self, bg=BG)
        head.pack(side="top", fill="x")
        label(head, f" {self.header_text} ", bg=ACCENT, fg=ON_ACCENT).pack(side="left")
        if delete_prompt:
            Button(head, "delete", self.ask_delete).pack(side="right", padx=(8, 0))
        Button(head, "back", self.close).pack(side="right", padx=(8, 0))
        Button(head, "save", self.save).pack(side="right", padx=(8, 0))

        self.top = tk.Frame(self, bg=BG)
        self.top.pack(side="top", fill="x")

        self.footer = tk.Frame(self, bg=BG)
        self.footer.pack(side="bottom", fill="x")
        self.hints = Hints(self.footer)
        self.hints.pack(side="top", fill="x")
        self.status = StatusLine(self.footer, before=self.hints)
        self.confirm = tk.Frame(self.footer, bg=BG)
        self.confirm_label = label(self.confirm, fg=ERROR)
        self.confirm_label.pack(side="left", padx=(8, 8))
        Button(self.confirm, "yes, delete", lambda: self.handle_key(Key("y", "y"))).pack(side="left", padx=(0, 8))
        Button(self.confirm, "cancel", lambda: self.handle_key(Key("n", "n"))).pack(side="left")
        if meta:
            label(self.footer, f" {meta}", fg=DIM).pack(side="top", fill="x", before=self.hints)

        self.scroll = ScrollFrame(self)
        self.scroll.pack(side="top", fill="both", expand=True)
        content = self.scroll.inner

        self.build_top(self.top)

        self.title_box = Box(content, "Title", lambda: self.set_focus("title"))
        self.title_box.pack(fill="x", padx=(0, 4))
        # Wraps so long titles are shown in full; enter moves on instead of adding a line.
        self.title = Text(self.title_box.body, initial["title"], height=2, placeholder=self.text_placeholder)
        self.title.pack(fill="x")
        self.add_focusable("title", self.title, self.title_box)

        self.fields_frame = tk.Frame(content, bg=BG)
        self.fields_frame.pack(fill="x", padx=(0, 4))
        for f in self.custom:
            self.build_custom(f)

        self.above = tk.Frame(content, bg=BG)
        self.above.pack(fill="x", padx=(0, 4))
        self.build_above(self.above)

        self.description_box = Box(content, "Description", lambda: self.set_focus("description"))
        self.description_box.pack(fill="x", padx=(0, 4))
        height = max(6, min(20, len(initial["description"].split("\n")) + 1))
        self.description = Text(self.description_box.body, initial["description"], height=height, placeholder=self.text_placeholder)
        self.description.pack(fill="x")
        self.add_focusable("description", self.description, self.description_box)

        self.below = tk.Frame(content, bg=BG)
        self.below.pack(fill="x", padx=(0, 4))
        self.build_below(self.below)

    # Hooks for subclasses.

    def build_top(self, frame: tk.Frame) -> None:
        pass

    def build_above(self, frame: tk.Frame) -> None:
        pass

    def build_below(self, frame: tk.Frame) -> None:
        pass

    def top_ids(self) -> List[FocusId]:
        return []

    def above_ids(self) -> List[FocusId]:
        return []

    def below_ids(self) -> List[FocusId]:
        return []

    def is_locked(self, field: dict) -> bool:
        return False

    def on_key(self, key: Key) -> bool:
        """Keys the form doesn't handle itself. True when handled."""
        return False

    def extra_hints(self) -> List[str]:
        return []

    def collect(self, values: dict) -> dict:
        """Everything to save: the shared values plus the subclass's own."""
        return values

    def on_save(self, values: dict) -> None:
        """Raises to keep the form open and show the error."""

    def on_delete(self) -> None:
        pass

    # Focus.

    def add_focusable(self, id: FocusId, widget: tk.Widget, box: Optional[Box] = None, on_active: Optional[Callable[[bool], None]] = None) -> None:
        self.focusables[id] = Focusable(widget, box, on_active)
        widget.bind("<FocusIn>", lambda _e: self._focused(id), add="+")

    def remove_focusable(self, id: FocusId) -> None:
        self.focusables.pop(id, None)

    def order(self) -> List[FocusId]:
        return [
            *self.top_ids(),
            "title",
            *(custom_id(f["name"]) for f in self.custom),
            *self.above_ids(),
            "description",
            *self.below_ids(),
        ]

    def set_focus(self, id: FocusId) -> None:
        if id not in self.focusables:
            return
        self.focus_id = id
        self.focusables[id].widget.focus_set()
        self.refresh()
        target = self.focusables[id].box or self.focusables[id].widget
        if str(target).startswith(str(self.scroll.inner)):
            self.scroll.scroll_into_view(target)

    def _focused(self, id: FocusId) -> None:
        if self.focus_id != id:
            self.focus_id = id
            self.refresh()

    def focused_widget(self) -> tk.Widget:
        return self.focusables[self.focus_id].widget

    def refresh(self) -> None:
        if not self.winfo_exists():
            return  # e.g. saving closed the form
        busy = self.new_field is not None
        for id, item in self.focusables.items():
            active = id == self.focus_id and not busy
            if item.box:
                item.box.set_active(active)
            if item.on_active:
                item.on_active(active)
        self.status.show(self.error, self.notice)
        if self.confirming:
            self.confirm_label.configure(text=f"{self.delete_prompt}? y to confirm, any other key to cancel")
            self.confirm.pack(side="top", fill="x", before=self.hints)
        else:
            self.confirm.pack_forget()
        focused = self.focused_custom()
        self.hints.show(
            [
                "tab next field",
                *self.extra_hints(),
                "ctrl+s save",
                "esc back",
                "ctrl+n new field",
                *(["ctrl+x remove field", "ctrl+y copy", *(["ctrl+o open"] if focused["type"] == "link" else [])] if focused else []),
                *(["ctrl+d delete"] if self.delete_prompt else []),
            ]
        )

    def show_error(self, message: str) -> None:
        self.error = message
        self.notice = None
        self.refresh()

    def show_notice(self, message: Optional[str]) -> None:
        if message:
            self.error = None
        self.notice = message
        self.refresh()

    # Values.

    def current_value(self, field: dict) -> dict:
        """Field as currently shown, including unsaved edits."""
        widgets = self.custom_widgets.get(field["name"])
        if self.is_locked(field) or not widgets or not hasattr(widgets[1], "value"):
            return field
        value = widgets[1].value
        return {**field, "value": value if field["type"] == "text" and field.get("textbox") else value.strip()}

    def values(self) -> dict:
        """Values as currently shown. Read straight from the widgets so nothing typed is ever missed."""
        return {
            # Titles are one logical line; a pasted newline becomes a space.
            "title": one_line(self.title.value),
            "description": self.description.value,
            "fields": [self.current_value(f) for f in self.custom],
        }

    def replace(self, values: dict) -> None:
        """Replaces what the form shows."""
        self.title.set(values["title"])
        self.description.set(values["description"])
        for name in list(self.custom_widgets):
            self.custom_widgets.pop(name)[0].destroy()
            self.remove_focusable(custom_id(name))
        self.custom = list(values["fields"])
        for f in self.custom:
            self.build_custom(f)
        self.app.install_keys(self)
        self.refresh()

    # Custom fields.

    def build_custom(self, f: dict) -> None:
        id = custom_id(f["name"])
        locked = self.is_locked(f)
        box = Box(self.fields_frame, f"{f['name']} · {f['type']}{' · locked' if locked else ''}", lambda: self.set_focus(id))
        box.pack(fill="x")
        Button(box.body, "remove", lambda: self.remove_field(f)).pack(side="right", padx=(1, 0), anchor="n")
        field_buttons(box.body, f["type"], lambda action: self.field_action(action, f), BG)
        if locked:
            widget = label(box.body, f["value"] or "—", fg=DIM, takefocus=1, wraplength=600)
            box.clickable(widget)
        elif f["type"] == "text" and f.get("textbox"):
            widget = Text(box.body, f["value"], height=textbox_height(f["value"]))
        elif f["type"] == "date":
            widget = DateEntry(box.body, f["value"])
        else:
            widget = Entry(box.body, f["value"], placeholder="ISO 8601, e.g. 2026-10-03T09:00:00Z" if f["type"] == "timestamp" else "")
        widget.pack(side="left", fill="x", expand=True, anchor="n")
        self.custom_widgets[f["name"]] = (box, widget)
        self.add_focusable(id, widget, box)

    def focused_custom(self) -> Optional[dict]:
        return next((f for f in self.custom if custom_id(f["name"]) == self.focus_id), None)

    def field_action(self, action: str, field: dict) -> None:
        try:
            self.show_notice(run_field_action(self.system, action, self.current_value(field)))
        except Exception as err:  # noqa: BLE001 - clipboard / browser failures are shown, not fatal
            self.show_error(str(err))

    def remove_field(self, field: dict) -> None:
        index = self.custom.index(field)
        self.custom.remove(field)
        self.custom_widgets.pop(field["name"])[0].destroy()
        self.remove_focusable(custom_id(field["name"]))
        # Land on the neighbour, or the description when the last field goes.
        neighbours = self.custom[index : index + 1] or self.custom[index - 1 : index] if self.custom else []
        self.set_focus(custom_id(neighbours[0]["name"]) if neighbours else "description")
        self.show_notice(f"Removed {field['name']} (ctrl+s to save, esc to discard)")

    def open_new_field(self) -> None:
        self.new_field = NewFieldForm(self.footer, [f["name"] for f in self.custom], self.add_field, self.close_new_field)
        self.new_field.pack(side="top", fill="x", before=self.status if self.status.winfo_ismapped() else self.hints)
        self.app.install_keys(self.new_field)
        self.new_field.name.focus_set()
        self.refresh()

    def close_new_field(self) -> None:
        if self.new_field:
            self.new_field.destroy()
            self.new_field = None
        self.set_focus(self.focus_id)

    def add_field(self, field: dict) -> None:
        self.new_field.destroy()
        self.new_field = None
        self.custom.append(field)
        self.build_custom(field)
        self.app.install_keys(self)
        self.set_focus(custom_id(field["name"]))

    # Actions.

    def save(self) -> None:
        try:
            self.on_save(self.collect(self.values()))
        except Exception as err:  # noqa: BLE001 - shown in the form, which stays open
            self.show_error(str(err))

    def close(self) -> None:
        self.app.close_details()

    def ask_delete(self) -> None:
        if self.delete_prompt:
            self.confirming = True
            self.refresh()

    def handle_key(self, key: Key) -> bool:
        if self.new_field:
            return self.new_field.handle_key(key)
        self.notice = None
        if self.confirming:
            self.confirming = False
            self.refresh()
            if key.name == "y":
                try:
                    self.on_delete()
                except Exception as err:  # noqa: BLE001
                    self.show_error(str(err))
            return True
        if key.name == "escape":
            self.close()
            return True
        if key.name == "tab":
            self.set_focus(cycle(self.order(), self.focus_id, -1 if key.shift else 1))
            return True
        if self.focus_id == "title" and key.name == "return":
            self.set_focus(cycle(self.order(), "title", 1))
            return True
        focused = self.focused_custom()
        if key.command("s"):
            self.save()
        elif key.command("d"):
            self.ask_delete()
        elif key.command("n"):
            self.open_new_field()
        elif key.command("x") and focused:
            self.remove_field(focused)
        elif key.command("y") and focused:
            self.field_action("copy", focused)
        elif key.command("o") and focused:
            if focused["type"] == "link":
                self.field_action("open", focused)
        elif key.ctrl and key.name in ("x", "y", "o"):
            # Off a custom field these belong to the subclass; never let Tk's text bindings have them.
            self.on_key(key)
        else:
            handled = self.on_key(key)
            self.refresh()
            return handled
        self.refresh()
        return True


FLAG_LABELS = {"editable": "editable", "visibleOnLists": "visible on lists", "textbox": "textbox"}


class NewFieldForm(Box):
    """Inline form for a new custom field. Owns the keyboard while shown."""

    def __init__(self, parent: tk.Misc, taken: List[str], on_add: Callable[[dict], None], on_cancel: Callable[[], None]):
        super().__init__(parent, "New field")
        self.set_active(True)
        self.taken = taken
        self.on_add = on_add
        self.on_cancel = on_cancel
        self.type = "text"
        self.flags = {"editable": True, "visibleOnLists": False, "textbox": True}
        self.control = "name"

        row = tk.Frame(self.body, bg=BG)
        row.pack(fill="x")
        self.type_label = label(row, cursor="hand2")
        self.type_label.pack(side="left", padx=(0, 16))
        self.type_label.bind("<Button-1>", lambda _e: self._click("type"))
        self.name_label = label(row, "Name")
        self.name_label.pack(side="left", padx=(0, 8))
        self.name = Entry(row, placeholder="Required")
        self.name.configure(width=24)
        self.name.pack(side="left")
        self.name.bind("<FocusIn>", lambda _e: self._set_control("name"), add="+")

        flags = tk.Frame(self.body, bg=BG)
        flags.pack(fill="x")
        self.flag_labels: Dict[str, tk.Label] = {}
        for flag in FLAG_LABELS:
            widget = label(flags, cursor="hand2")
            widget.bind("<Button-1>", lambda _e, f=flag: self._click(f))
            self.flag_labels[flag] = widget

        self.error = label(self.body, fg=ERROR)
        bottom = tk.Frame(self.body, bg=BG)
        bottom.pack(side="bottom", fill="x")
        label(bottom, "tab next  ←→/space change  enter add  esc cancel", fg=DIM).pack(side="left")
        Button(bottom, "cancel", on_cancel).pack(side="right", padx=(8, 0))
        Button(bottom, "add", self.add).pack(side="right")
        self._render()

    def controls(self) -> List[str]:
        return ["type", "name", "editable", "visibleOnLists", *(["textbox"] if self.type == "text" else [])]

    def _render(self) -> None:
        color = lambda c: ACCENT if self.control == c else DIM  # noqa: E731
        self.type_label.configure(text=f"Type ‹ {self.type} ›", fg=color("type"))
        self.name_label.configure(fg=color("name"))
        for flag, widget in self.flag_labels.items():
            widget.configure(text=f"[{'x' if self.flags[flag] else ' '}] {FLAG_LABELS[flag]}", fg=color(flag))
            if flag in self.controls():
                widget.pack(side="left", padx=(0, 16))
            else:
                widget.pack_forget()

    def _set_control(self, control: str) -> None:
        self.control = control
        (self.name if control == "name" else self).focus_set()
        self._render()

    def _click(self, control: str) -> None:
        self._set_control(control)
        self._change(1)

    def _change(self, delta: int) -> None:
        if self.control == "type":
            self.type = cycle(FIELD_TYPES, self.type, delta)
        elif self.control != "name":
            self.flags[self.control] = not self.flags[self.control]
        self._render()

    def add(self) -> None:
        try:
            field = parse(parse_custom_field, {"type": self.type, "name": self.name.value, **self.flags})
        except TodoError as err:
            return self._fail(str(err))
        if field["name"] in self.taken:
            return self._fail(f"duplicate field name: {field['name']}")
        self.on_add(field)

    def _fail(self, message: str) -> None:
        self.error.configure(text=message)
        self.error.pack(fill="x")

    def handle_key(self, key: Key) -> bool:
        if key.name == "escape":
            self.on_cancel()
        elif key.name == "return":
            self.add()
        elif key.name == "tab":
            self._set_control(cycle(self.controls(), self.control, -1 if key.shift else 1))
        elif self.control == "name":
            return False  # typing into the name
        elif key.name in ("left", "right", "space"):
            self._change(-1 if key.name == "left" else 1)
        return True


