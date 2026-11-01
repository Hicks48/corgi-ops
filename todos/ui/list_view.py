"""List screens: tasks by view (Completed / Current / Upcoming) and templates."""
from __future__ import annotations

import tkinter as tk
from typing import Callable, Dict, List, Optional

from todos.core import VIEW_LABELS, VIEWS

from .field_buttons import field_buttons
from .theme import ACCENT, BG, BORDER, DIM, ON_ACCENT, STATUS_BADGES, STATUS_COLORS
from .widgets import Button, Hints, ScrollFrame, StatusLine, label, one_line, wrap_lines

VIEW_ACTIONS = {
    "current": ("+1 day", "+"),
    "upcoming": ("Pull to today", "t"),
    "completed": ("Reopen", "r"),
}

EMPTY_TEXT = {
    "current": "Nothing on for today. Press a to add a task.",
    "upcoming": "No upcoming tasks.",
    "completed": "No completed tasks yet.",
}

# Wrap width before a card knows its size (e.g. right after it is built).
DEFAULT_WIDTH_PX = 800


def _note_for(view: str, task: dict) -> Optional[str]:
    return task["targetDate"] if view == "upcoming" else task.get("completionDate") if view == "completed" else None


class Card(tk.Frame):
    """A selectable bordered card. Clicks anywhere on it (except buttons) call `on_click`."""

    def __init__(self, parent: tk.Misc, on_click: Callable[[], None]):
        super().__init__(parent, bg=BORDER)
        self.inner = tk.Frame(self, bg=BG)
        self.inner.pack(fill="both", expand=True, padx=1, pady=1)
        self.body = tk.Frame(self.inner, bg=BG)
        self.body.pack(fill="both", expand=True, padx=8, pady=4)
        self.on_click = on_click
        self.wrapped: List = []  # (label, text, max lines)
        self._width = 0
        self.body.bind("<Configure>", self._resize)

    def finish(self) -> None:
        """Call once built: wires clicks on every non-button child."""

        def wire(widget: tk.Misc) -> None:
            if not isinstance(widget, Button):
                widget.bind("<Button-1>", lambda _e: self.on_click(), add="+")
            for child in widget.winfo_children():
                wire(child)

        wire(self)
        self._rewrap(DEFAULT_WIDTH_PX)

    def wrapped_text(self, text: str, max_lines: int, fg: str = DIM) -> tk.Label:
        widget = label(self.body, fg=fg)
        widget.pack(fill="x")
        self.wrapped.append((widget, text, max_lines))
        return widget

    def _resize(self, event) -> None:
        if event.width > 1 and event.width != self._width:
            self._width = event.width
            self._rewrap(event.width)

    def _rewrap(self, width: int) -> None:
        for widget, text, max_lines in self.wrapped:
            widget.configure(text="\n".join(wrap_lines(text, width)[:max_lines]))

    def set_selected(self, selected: bool) -> None:
        self.configure(bg=ACCENT if selected else BORDER)


class TaskCard(Card):
    def __init__(self, parent, task: dict, note: Optional[str], action_label: str, on_click, on_action, on_field_action):
        super().__init__(parent, on_click)
        self.task = task
        top = tk.Frame(self.body, bg=BG)
        top.pack(fill="x")
        label(top, STATUS_BADGES[task["status"]], fg=STATUS_COLORS[task["status"]]).pack(side="left", padx=(0, 8))
        self.action = Button(top, action_label, on_action)
        self.action.pack(side="right", padx=(8, 0))
        if note:
            label(top, note, fg=DIM).pack(side="right", padx=(8, 0))
        self.title = label(top, task["title"], bold=True)
        self.title.pack(side="left", fill="x", expand=True)
        self.field_buttons: Dict[str, list] = {}
        for field in (f for f in task["fields"] if f["visibleOnLists"]):
            row = tk.Frame(self.body, bg=BG)
            row.pack(fill="x")
            label(row, f"{field['name']}:", fg=DIM).pack(side="left", padx=(0, 8))
            if field["value"]:
                self.field_buttons[field["name"]] = field_buttons(row, field["type"], lambda a, f=field: on_field_action(a, f), BG)
            # One line even for textbox fields.
            label(row, one_line(field["value"])).pack(side="left", fill="x", expand=True)
        self.description = self.wrapped_text(task["description"], 3)
        self.finish()

    def set_selected(self, selected: bool) -> None:
        super().set_selected(selected)
        self.action.recolor(ACCENT if selected else DIM)
        for buttons in self.field_buttons.values():
            for button in buttons:
                button.recolor(ACCENT if selected else DIM)


class ListScreen(tk.Frame):
    """Header, scrolling cards and footer. Subclasses fill the header and cards."""

    def __init__(self, parent: tk.Misc):
        super().__init__(parent, bg=BG)
        self.header = tk.Frame(self, bg=BG)
        self.header.pack(side="top", fill="x")
        footer = tk.Frame(self, bg=BG)
        footer.pack(side="bottom", fill="x")
        self.hints = Hints(footer)
        self.hints.pack(side="top", fill="x")
        self.status = StatusLine(footer, before=self.hints)
        self.scroll = ScrollFrame(self)
        self.scroll.pack(side="top", fill="both", expand=True, pady=(4, 0))
        self.cards: List[Card] = []
        self.empty = label(self.scroll.inner, fg=DIM)

    def set_cards(self, cards: List[Card], empty_text: str) -> None:
        for card in self.cards:
            card.destroy()
        self.cards = cards
        for card in cards:
            card.pack(fill="x", pady=(0, 2), padx=(0, 4))
        self.empty.configure(text=f" {empty_text}")
        if cards:
            self.empty.pack_forget()
        else:
            self.empty.pack(fill="x")
        self.scroll.scroll_to_top()

    def select(self, index: int) -> None:
        for i, card in enumerate(self.cards):
            card.set_selected(i == index)
        if 0 <= index < len(self.cards):
            self.scroll.scroll_into_view(self.cards[index])


class ListView(ListScreen):
    def __init__(self, parent: tk.Misc, app):
        super().__init__(parent)
        self.app = app
        self.tabs: Dict[str, tk.Label] = {}
        tabs = tk.Frame(self.header, bg=BG)
        tabs.pack(side="left")
        for view in VIEWS:
            tab = label(tabs, f" {VIEW_LABELS[view]} ", cursor="hand2")
            tab.pack(side="left", padx=(0, 8))
            tab.bind("<Button-1>", lambda _e, v=view: app.switch_view(v))
            self.tabs[view] = tab
        self.count = label(self.header, fg=DIM)
        self.count.pack(side="right")
        self._shown = None

    def update_view(self, view: str, tasks: List[dict], selected: int, today: str, error: Optional[str], notice: Optional[str]) -> None:
        for v, tab in self.tabs.items():
            tab.configure(bg=ACCENT if v == view else BG, fg=ON_ACCENT if v == view else DIM)
        self.count.configure(text=f"{len(tasks)} {'task' if len(tasks) == 1 else 'tasks'} · {today} ")
        action_label, action_key = VIEW_ACTIONS[view]
        # Rebuild cards only when what they show changed; selection alone just recolors.
        shown = (view, [(t["id"], t["updatedAt"]) for t in tasks])
        if shown != self._shown:
            self._shown = shown
            cards = [
                TaskCard(
                    self.scroll.inner,
                    task,
                    _note_for(view, task),
                    action_label,
                    on_click=lambda i=index, t=task: self.app.click_task(i, t),
                    on_action=lambda t=task: self.app.run_action(t),
                    on_field_action=self.app.field_action,
                )
                for index, task in enumerate(tasks)
            ]
            self.set_cards(cards, EMPTY_TEXT[view])
        self.select(selected)
        self.status.show(error, notice)
        self.hints.show(["[ ] / ←→ switch view", "↑↓ select", "enter details", "a add", f"{action_key} {action_label}", "p templates", "q quit"])


class TemplateCard(Card):
    def __init__(self, parent, template: dict, on_click):
        super().__init__(parent, on_click)
        self.template = template
        top = tk.Frame(self.body, bg=BG)
        top.pack(fill="x")
        label(top, template["name"], bold=True).pack(side="left", padx=(0, 8))
        label(top, template["title"], fg=DIM).pack(side="left", fill="x", expand=True)
        if template["fields"]:
            label(self.body, f"Fields: {', '.join(f['name'] for f in template['fields'])}", fg=DIM).pack(fill="x")
        if template["description"]:
            self.wrapped_text(template["description"], 2)
        self.finish()


class TemplateListView(ListScreen):
    def __init__(self, parent: tk.Misc, app):
        super().__init__(parent)
        self.app = app
        label(self.header, " Templates ", bg=ACCENT, fg=ON_ACCENT).pack(side="left")
        self.count = label(self.header, fg=DIM)
        self.count.pack(side="right")
        self.hints.show(["↑↓ select", "enter details", "a add", "esc back to tasks", "q quit"])
        self._shown = None

    def update_view(self, templates: List[dict], selected: int, error: Optional[str]) -> None:
        self.count.configure(text=f"{len(templates)} {'template' if len(templates) == 1 else 'templates'} ")
        shown = [(t["id"], t["updatedAt"]) for t in templates]
        if shown != self._shown:
            self._shown = shown
            cards = [TemplateCard(self.scroll.inner, t, lambda i=i, t=t: self.app.click_template(i, t)) for i, t in enumerate(templates)]
            self.set_cards(cards, "No templates yet. Press a to add one.")
        self.select(selected)
        self.status.show(error)


