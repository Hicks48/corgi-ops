from __future__ import annotations

import threading
import tkinter as tk
from typing import Callable, Dict, List, Optional

from todos.core import VIEWS, TodoStore, tasks_in_view

from . import theme
from .field_buttons import run_field_action
from .keys import Key
from .list_view import VIEW_ACTIONS, ListView, TemplateListView
from .system import System, TkSystem
from .task_details import TaskDetails
from .template_details import TemplateDetails
from .widgets import ScrollFrame

KEYS_TAG = "TodosKeys"
WATCH_POLL_MS = 100
TICK_MS = 60_000


class App:
    """Screens: list (by view), templates list, task details, template details."""

    def __init__(self, root: tk.Misc, store: TodoStore, system: Optional[System] = None, on_exit: Optional[Callable[[], None]] = None):
        self.root = root
        self.store = store
        self.system = system or TkSystem(root)
        self.on_exit = on_exit or self.quit
        theme.apply(root)

        self.tasks: List[dict] = []
        self.templates: List[dict] = []
        self.error: Optional[str] = None
        self.notice: Optional[str] = None
        self.mode = "list"
        self.view = "current"
        self.indexes: Dict[str, int] = {view: 0 for view in VIEWS}
        self.template_index = 0
        self.screen: Optional[tk.Widget] = None

        self.container = tk.Frame(root, bg=theme.BG)
        self.container.pack(fill="both", expand=True, padx=8, pady=6)
        # Our key handling runs before the widgets' own bindings (see install_keys).
        root.bind_class(KEYS_TAG, "<Key>", self._on_key_event)
        self._bind_wheel()

        self.reload()
        self.render()

        self._changed = threading.Event()
        self._stop_watch = store.watch(self._changed.set)
        self._closed = False
        root.after(WATCH_POLL_MS, self._poll_changes)
        # Re-render each minute so views roll over at midnight.
        root.after(TICK_MS, self._tick)

    # Data.

    def reload(self) -> None:
        try:
            self.tasks = self.store.list()
            self.templates = self.store.list_templates()
            self.error = None
        except Exception as err:  # noqa: BLE001 - e.g. a corrupt file; shown, and retried on the next change
            self.error = str(err)

    def _poll_changes(self) -> None:
        if self._closed:
            return
        if self._changed.is_set():
            self._changed.clear()
            self.reload()
            if self.mode in ("list", "templates"):
                self.render()
        self.root.after(WATCH_POLL_MS, self._poll_changes)

    def _tick(self) -> None:
        if self._closed:
            return
        if self.mode == "list":
            self.render()
        self.root.after(TICK_MS, self._tick)

    def today(self) -> str:
        return self.store.today()

    def view_tasks(self) -> List[dict]:
        return tasks_in_view(self.tasks, self.view, self.today())

    def selected_index(self) -> int:
        return max(0, min(self.indexes[self.view], len(self.view_tasks()) - 1))

    def selected_template_index(self) -> int:
        return max(0, min(self.template_index, len(self.templates) - 1))

    # Screens.

    def _show(self, screen: tk.Widget) -> None:
        if self.screen is not None:
            self.screen.destroy()
        self.screen = screen
        screen.pack(fill="both", expand=True)
        self.install_keys(screen)

    def install_keys(self, widget: tk.Misc) -> None:
        """Puts the app's key tag first on `widget` and its descendants, so keys reach `handle_key` before Tk's defaults."""
        tags = widget.bindtags()
        if KEYS_TAG not in tags:
            widget.bindtags((KEYS_TAG, *tags))
        for child in widget.winfo_children():
            self.install_keys(child)

    def render(self) -> None:
        if self.mode == "list":
            if not isinstance(self.screen, ListView):
                self._show(ListView(self.container, self))
            self.screen.update_view(self.view, self.view_tasks(), self.selected_index(), self.today(), self.error, self.notice)
        elif self.mode == "templates":
            if not isinstance(self.screen, TemplateListView):
                self._show(TemplateListView(self.container, self))
            self.screen.update_view(self.templates, self.selected_template_index(), self.error)
        else:
            return
        self.install_keys(self.screen)
        self.screen.focus_set()

    def _details(self, form) -> None:
        self._show(form)
        form.set_focus("title")

    def show_list(self) -> None:
        self.mode = "list"
        self.render()

    def show_templates(self) -> None:
        self.mode = "templates"
        self.render()

    def open_task(self, task: Optional[dict]) -> None:
        """Task details; `None` for a new task. Leaves any unsaved edits behind."""
        if task is not None:
            task = next((t for t in self.tasks if t["id"] == task["id"]), task)
        self.mode = "details"
        parent = next((t for t in self.tasks if task and t["id"] == task.get("parentId")), None)
        subtasks = [t for t in self.tasks if task and t.get("parentId") == task["id"]]
        self._details(TaskDetails(self.container, self, task, parent, subtasks, self.templates, self.today()))

    def open_template(self, template: Optional[dict]) -> None:
        self.mode = "template"
        self._details(TemplateDetails(self.container, self, template))

    def close_details(self) -> None:
        if self.mode == "template":
            self.show_templates()
        else:
            self.show_list()

    # Actions.

    def switch_view(self, view: str) -> None:
        self.view = view
        self.notice = None
        self.render()

    def _step_view(self, delta: int) -> None:
        index = VIEWS.index(self.view) + delta
        if 0 <= index < len(VIEWS):
            self.switch_view(VIEWS[index])

    def select(self, index: int) -> None:
        self.indexes[self.view] = index
        self.render()

    def click_task(self, index: int, task: dict) -> None:
        """Clicking the selected card opens it; any other card gets selected."""
        if index == self.selected_index():
            self.open_task(task)
        else:
            self.select(index)

    def click_template(self, index: int, template: dict) -> None:
        if index == self.selected_template_index():
            self.open_template(template)
        else:
            self.template_index = index
            self.render()

    def run_action(self, task: dict) -> None:
        """The view's quick action. The task leaves the view, so the cursor lands on its neighbour."""
        actions = {"current": self.store.postpone, "upcoming": self.store.pull_to_today, "completed": self.store.reopen}
        try:
            actions[self.view](task["id"])
            self.reload()
        except Exception as err:  # noqa: BLE001
            self.error = str(err)
        self.render()

    def field_action(self, action: str, field: dict) -> None:
        try:
            self.notice = run_field_action(self.system, action, field)
        except Exception as err:  # noqa: BLE001
            self.error = str(err)
        self.render()

    def _reload_and_show(self, task: dict) -> None:
        """Reloads, then shows `task` in whichever view it now belongs to."""
        self.reload()
        today = self.today()
        target = next((v for v in VIEWS if any(t["id"] == task["id"] for t in tasks_in_view(self.tasks, v, today))), self.view)
        ids = [t["id"] for t in tasks_in_view(self.tasks, target, today)]
        self.view = target
        self.indexes[target] = ids.index(task["id"]) if task["id"] in ids else 0

    def save_task(self, editing: Optional[dict], values: dict) -> None:
        """Raises (keeping the form open) when the store rejects the values."""
        if editing:
            task = self.store.update(editing["id"], **values)
        else:
            task = self.store.add(**{k: v for k, v in values.items() if k != "comments"})
        self._reload_and_show(task)
        self.show_list()

    def delete_task(self, task: dict) -> None:
        self.store.remove(task["id"])
        self.reload()
        self.show_list()

    def save_template(self, editing: Optional[dict], values: dict) -> None:
        if editing:
            template = self.store.update_template(editing["id"], **values)
        else:
            template = self.store.add_template(**values)
        self.reload()
        ids = [t["id"] for t in self.templates]
        self.template_index = ids.index(template["id"]) if template["id"] in ids else 0
        self.show_templates()

    def delete_template(self, template: dict) -> None:
        self.store.remove_template(template["id"])
        self.reload()
        self.show_templates()

    def quit(self) -> None:
        self.close()
        self.root.destroy()

    def close(self) -> None:
        self._closed = True
        self._stop_watch()

    # Input.

    def _on_key_event(self, event):
        return "break" if self.handle_key(Key.from_event(event)) else None

    def handle_key(self, key: Key) -> bool:
        """Routes a key to the current screen. True when handled (Tk's own handling is then skipped)."""
        if self.mode in ("details", "template"):
            return self.screen.handle_key(key)
        if key.ctrl or key.meta:
            return False
        if self.mode == "templates":
            return self._templates_key(key)
        self.notice = None
        action_key = VIEW_ACTIONS[self.view][1]
        tasks = self.view_tasks()
        selected = self.selected_index()
        # Printable keys match on the typed character: layouts differ in keysyms (e.g. `[` is option+8 on Finnish Macs).
        if key.char == action_key:
            if tasks:
                self.run_action(tasks[selected])
        elif key.char == "[" or key.name == "left":
            self._step_view(-1)
        elif key.char == "]" or key.name == "right":
            self._step_view(1)
        elif key.name == "q":
            self.on_exit()
        elif key.name in ("up", "k"):
            self.select(max(0, selected - 1))
        elif key.name in ("down", "j"):
            self.select(min(len(tasks) - 1, selected + 1))
        elif key.name == "return":
            if tasks:
                self.open_task(tasks[selected])
        elif key.name == "a":
            self.open_task(None)
        elif key.name == "p":
            self.show_templates()
        else:
            return False
        return True

    def _templates_key(self, key: Key) -> bool:
        selected = self.selected_template_index()
        if key.name == "q":
            self.on_exit()
        elif key.name in ("escape", "p"):
            self.show_list()
        elif key.name in ("up", "k"):
            self.template_index = max(0, selected - 1)
            self.render()
        elif key.name in ("down", "j"):
            self.template_index = min(len(self.templates) - 1, selected + 1)
            self.render()
        elif key.name == "return":
            if self.templates:
                self.open_template(self.templates[selected])
        elif key.name == "a":
            self.open_template(None)
        else:
            return False
        return True

    def _bind_wheel(self) -> None:
        self.root.bind_all("<MouseWheel>", lambda e: self._wheel(e, -40 * (e.delta / 120 if abs(e.delta) >= 120 else e.delta)))
        self.root.bind_all("<Button-4>", lambda e: self._wheel(e, -40))
        self.root.bind_all("<Button-5>", lambda e: self._wheel(e, 40))
        try:
            # Tk 9 reports trackpads separately, in pixels.
            self.root.bind_all("<TouchpadScroll>", self._touchpad)
        except tk.TclError:
            pass

    def _touchpad(self, event) -> None:
        _dx, dy = self.root.tk.splitlist(self.root.tk.call("tk::PreciseScrollDeltas", event.delta))
        self._wheel(event, -int(dy))

    def _wheel(self, event, pixels: float) -> None:
        widget = self.root.winfo_containing(event.x_root, event.y_root)
        while widget is not None and not isinstance(widget, ScrollFrame):
            widget = widget.master
        if widget is not None and pixels:
            widget.scroll(int(pixels))
