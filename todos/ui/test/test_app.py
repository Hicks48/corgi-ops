"""UI tests: drive the app through `handle_key`, widget values and click handlers, and read what's on screen."""
import os
import shutil
import tempfile
import time
import unittest
from datetime import datetime

try:
    import tkinter as tk

    from todos.ui.app import App
    from todos.ui.keys import Key
    from todos.ui.widgets import Button, Entry, Text, mask_date
except ImportError:  # Python built without Tk
    tk = None

from todos.core import TodoStore, format_local_date_time, short_id


_root = None


def _shared_root():
    """One Tk for the whole run: Tk 9 on macOS crashes when a new Tk is created after another was destroyed."""
    global _root
    if _root is None:
        _root = tk.Tk()
        _root.withdraw()
    return _root


def _tk_available() -> bool:
    # Tk 8.5 (Apple's Python) hangs on recent macOS; the app refuses to start on it too.
    if tk is None or tk.TkVersion < 8.6:
        return False
    try:
        _shared_root()
        return True
    except tk.TclError:  # no display
        return False


# Local noon, so "today" is stable regardless of time zone.
NOW = datetime(2026, 10, 3, 12)


class MaskDateTest(unittest.TestCase):
    @unittest.skipIf(tk is None, "no tkinter")
    def test_keeps_digits_and_inserts_dashes(self):
        self.assertEqual(mask_date("2026", 4), ("2026", 4))
        self.assertEqual(mask_date("20261", 5), ("2026-1", 6))
        self.assertEqual(mask_date("2026-", 5), ("2026", 4))
        self.assertEqual(mask_date("2026/10/x03", 11), ("2026-10-03", 10))
        self.assertEqual(mask_date("", 0), ("", 0))

    @unittest.skipIf(tk is None, "no tkinter")
    def test_ignores_extra_digits_at_the_end_and_overwrites_in_the_middle(self):
        self.assertEqual(mask_date("2026-10-039", 11), ("2026-10-03", 10))
        # Typed "1" after "2026-1": replaces the next digit.
        self.assertEqual(mask_date("2026-110-03", 7), ("2026-11-03", 7))
        # Deleting a dash moves nothing.
        self.assertEqual(mask_date("202610-03", 4), ("2026-10-03", 4))


@unittest.skipUnless(_tk_available(), "needs a Python with working Tk and a display")
class AppTest(unittest.TestCase):
    def setUp(self):
        self.root_dir = tempfile.mkdtemp(prefix="corgiops-")
        self.store = TodoStore(dir=os.path.join(self.root_dir, "todos"), now=lambda: NOW)
        self.effects = []
        self.exited = False
        # Mapped: Tk delivers clicks only to windows on screen.
        self.tk = tk.Toplevel(_shared_root())
        self.tk.geometry("900x700+40+40")
        self.app = None

    def tearDown(self):
        if self.app:
            self.app.close()
        self.tk.destroy()
        shutil.rmtree(self.root_dir, ignore_errors=True)

    class FakeSystem:
        def __init__(self, effects):
            self.effects = effects

        def copy(self, text):
            self.effects.append(f"copy {text}")

        def open(self, url):
            self.effects.append(f"open {url}")

    def mount(self):
        self.app = App(self.tk, self.store, self.FakeSystem(self.effects), on_exit=lambda: setattr(self, "exited", True))
        self.flush()

    def flush(self):
        self.tk.update_idletasks()
        self.tk.update()

    # Input.

    def press(self, name, char=None, ctrl=False, shift=False):
        self.app.handle_key(Key(name, name if char is None and len(name) == 1 else (char or ""), ctrl=ctrl, shift=shift))
        self.flush()

    def save(self):
        self.press("s", ctrl=True)

    def tab(self, times=1, back=False):
        for _ in range(times):
            self.press("tab", shift=back)

    def focused(self):
        return self.app.screen.focused_widget()

    def type(self, text):
        widget = self.focused()
        widget.insert("insert", text)
        self.flush()

    def backspace(self, count=1):
        """Deletes `count` characters at the end of the focused input."""
        widget = self.focused()
        for _ in range(count):
            if isinstance(widget, Text):
                widget.delete("end-2c", "end-1c")
            else:
                widget.delete(len(widget.get()) - 1, "end")
            widget.icursor("end") if not isinstance(widget, Text) else widget.mark_set("insert", "end-1c")
        self.flush()

    def click(self, widget):
        widget.event_generate("<Button-1>", x=1, y=1)
        self.flush()

    # Reading the screen.

    def widgets(self, widget=None, visible=False):
        """The screen's widgets; with `visible`, only those laid out (packed / placed) along with their parents."""
        widget = widget or self.app.screen
        yield widget
        for child in widget.winfo_children():
            if not visible or child.winfo_manager():
                yield from self.widgets(child, visible)

    def frame(self):
        """All text on screen (labels and inputs), in widget order."""
        parts = []
        for w in self.widgets(visible=True):
            if isinstance(w, Text):
                parts.append(w.value)
            elif isinstance(w, Entry):
                parts.append(w.value)
            elif isinstance(w, tk.Label):
                parts.append(w.cget("text"))
        return "\n".join(p.replace(" ", " ") for p in parts)

    def see(self, text, absent=False):
        deadline = time.monotonic() + 2
        while True:
            self.flush()
            frame = self.frame()
            if (text in frame) != absent:
                return frame
            if time.monotonic() > deadline:
                self.fail(f'"{text}" never {"disappeared" if absent else "appeared"}:\n{frame}')
            time.sleep(0.01)

    def gone(self, text):
        return self.see(text, absent=True)

    def find(self, text, kind=tk.Label if tk else None):
        for w in self.widgets(visible=True):
            if isinstance(w, kind) and text in w.cget("text"):
                return w
        self.fail(f'no widget with "{text}"')

    def buttons(self, text):
        return [w for w in self.widgets(visible=True) if isinstance(w, Button) and w.cget("text") == f"[ {text} ]"]

    # Tests (ported from the TUI's).

    def test_opens_on_current_tasks_in_progress_first(self):
        self.store.add(title="Walk corgi", description="Around the block")
        self.store.add(title="Feed corgi", description="Kibble", status="in-progress", target_date="2026-10-01")
        self.store.add(title="Groom corgi", description="Later", target_date="2026-10-09")
        self.store.add(title="Bathe corgi", description="Done", status="done")
        self.mount()
        frame = self.see("Walk corgi")
        self.assertIn("Current Tasks", frame)
        self.assertIn("2 tasks · 2026-10-03", frame)
        self.assertNotIn("Groom corgi", frame)
        self.assertNotIn("Bathe corgi", frame)
        self.assertLess(frame.index("Feed corgi"), frame.index("Walk corgi"))
        self.assertIn("[ +1 day ]", frame)

    def test_descriptions_are_cut_to_3_lines(self):
        self.store.add(title="Long", description="one\ntwo\nthree\nfour\nfive")
        self.mount()
        self.assertNotIn("four", self.see("three"))

    def test_brackets_switch_between_views(self):
        self.store.add(title="Groom corgi", description="Later", target_date="2026-10-09")
        self.store.add(title="Bathe corgi", description="Done", status="done")
        self.mount()
        self.see("Nothing on for today")
        self.press("bracketright", "]")
        upcoming = self.see("Groom corgi")
        self.assertIn("[ Pull to today ]", upcoming)
        self.assertIn("2026-10-09", upcoming)
        self.press("bracketright", "]")
        self.see("Groom corgi")  # already on the last view
        self.press("bracketleft", "[")
        self.see("Nothing on for today")
        self.press("bracketleft", "[")
        self.assertIn("[ Reopen ]", self.see("Bathe corgi"))

    def test_arrows_switch_views_too(self):
        self.store.add(title="Groom corgi", description="Later", target_date="2026-10-09")
        self.mount()
        self.see("Nothing on for today")
        self.press("right")
        self.see("Groom corgi")
        self.press("left")
        self.see("Nothing on for today")

    def test_view_actions(self):
        task1 = self.store.add(title="Walk corgi", description="Around the block")
        task2 = self.store.add(title="Bathe corgi", description="Done", status="done")
        self.mount()
        self.see("Walk corgi")
        self.press("plus", "+")
        self.see("Nothing on for today")
        self.assertEqual(self.store.get(task1["id"])["targetDate"], "2026-10-04")

        self.press("bracketright", "]")
        self.see("Walk corgi")
        self.press("t")
        self.see("No upcoming tasks")
        self.assertEqual(self.store.get(task1["id"])["targetDate"], "2026-10-03")

        self.press("bracketleft", "[")
        self.press("bracketleft", "[")
        self.see("Bathe corgi")
        self.press("r")
        self.see("No completed tasks yet")
        task = self.store.get(task2["id"])
        self.assertEqual((task["status"], task["targetDate"]), ("in-progress", "2026-10-03"))

    def test_action_buttons_cards_and_tabs_respond_to_the_mouse(self):
        task1 = self.store.add(title="Walk corgi", description="Around the block")
        task2 = self.store.add(title="Feed corgi", description="Kibble")
        self.mount()
        self.see("Feed corgi")
        self.click(self.buttons("+1 day")[1])
        self.gone("Feed corgi")
        self.assertEqual(self.store.get(task2["id"])["targetDate"], "2026-10-04")

        self.click(self.find("Upcoming Tasks"))
        self.see("Feed corgi")
        self.click(self.find("Current Tasks"))
        self.see("Walk corgi")
        # Clicking the selected card opens it.
        self.click(self.find("Walk corgi"))
        self.see(f"Task {short_id(task1['id'])}")

    def test_clicking_a_card_selects_it(self):
        self.store.add(title="Walk corgi", description="Around the block")
        task2 = self.store.add(title="Feed corgi", description="Kibble")
        self.mount()
        self.click(self.find("Kibble"))
        self.press("return")
        self.assertIn("Kibble", self.see(f"Task {short_id(task2['id'])}"))

    def test_lists_show_visible_custom_fields_with_copy_open_buttons(self):
        self.store.add(
            title="Review PR",
            description="Check it",
            fields=[
                {"type": "link", "name": "PR", "value": "https://example.com/1", "visibleOnLists": True},
                {"type": "text", "name": "Notes", "value": "first\nsecond", "visibleOnLists": True},
                {"type": "text", "name": "Secret", "value": "hidden"},
            ],
        )
        self.mount()
        frame = self.see("https://example.com/1")
        self.assertIn("PR:", frame)
        self.assertIn("first second", frame)
        self.assertNotIn("hidden", frame)
        self.click(self.buttons("open")[0])
        self.see("Opened PR")
        self.click(self.buttons("copy")[0])
        self.see("Copied PR")
        self.assertEqual(self.effects, ["open https://example.com/1", "copy https://example.com/1"])

    def test_clicking_a_box_in_the_details_view_focuses_it(self):
        task1 = self.store.add(title="Walk corgi", description="Around the block")
        self.mount()
        self.press("return")
        self.see(f"Task {short_id(task1['id'])}")
        self.click(self.app.screen.target_box.title)
        self.backspace()
        self.type("5")
        self.click(self.app.screen.description_box.title)
        self.focused().mark_set("insert", "end-1c")
        self.type("!")
        self.save()
        self.see("[ Pull to today ]")
        task = self.store.get(task1["id"])
        self.assertEqual((task["targetDate"], task["description"]), ("2026-10-05", "Around the block!"))

    def test_adds_edits_and_removes_custom_fields_in_the_details_view(self):
        task1 = self.store.add(title="Walk corgi", description="Around the block")
        self.mount()
        self.press("return")
        self.see(f"Task {short_id(task1['id'])}")

        self.press("n", ctrl=True)
        self.see("New field")
        self.press("return")
        self.see("field name is required")
        self.app.screen.new_field.name.insert("end", "Route")
        self.tab(back=True)  # type
        self.press("right")  # link
        self.see("‹ link ›")
        self.tab()  # name
        self.tab()  # editable
        self.press("space", " ")
        self.see("[ ] editable")
        self.tab()  # visible on lists
        self.press("space", " ")
        self.see("[x] visible on lists")
        self.press("return")
        self.gone("New field")
        self.see("Route · link")

        # The new field has focus; a non-editable field can be filled in until it is saved.
        self.type("https://maps.example/park")
        self.press("y", ctrl=True)
        self.see("Copied Route")
        self.assertEqual(self.effects, ["copy https://maps.example/park"])
        self.save()

        self.assertIn("[ open ]", self.see("https://maps.example/park"))
        self.assertEqual(
            self.store.get(task1["id"])["fields"],
            [{"type": "link", "name": "Route", "editable": False, "visibleOnLists": True, "value": "https://maps.example/park"}],
        )

        # Locked now: shown read-only, but it can be removed.
        self.press("return")
        self.see("Route · link · locked")
        self.click(self.find("https://maps.example/park"))
        self.see("ctrl+x remove field")
        self.press("x", ctrl=True)
        self.gone("Route · link")
        self.save()
        self.see("[ +1 day ]")
        self.assertEqual(self.store.get(task1["id"])["fields"], [])

    def test_editable_custom_fields_save_their_typed_value(self):
        task1 = self.store.add(title="Walk corgi", description="Around the block", fields=[{"type": "date", "name": "Vet", "value": "2026-10-09"}])
        self.mount()
        self.press("return")
        self.see("Vet · date")
        self.tab()  # title -> Vet
        self.backspace()
        self.type("8")
        self.save()
        self.see("[ +1 day ]")
        self.assertEqual(self.store.get(task1["id"])["fields"][0]["value"], "2026-10-08")

        self.press("return")
        self.see("Vet · date")
        self.tab()
        self.type("x")  # ignored
        self.backspace()
        self.save()
        self.see("date fields must be YYYY-MM-DD")

    def test_adds_a_task_from_any_view_with_todo_today_defaults(self):
        self.mount()
        self.see("Nothing on for today")
        self.press("bracketleft", "[")
        self.see("No completed tasks yet")
        self.press("a")
        form = self.see("New Task")
        self.assertIn("‹ Todo ›", form)
        self.assertIn("2026-10-03", form)
        self.assertNotIn("ctrl+d delete", form)
        self.type("Brush corgi")
        self.press("return")  # enter in the title moves to the description
        self.type("Lots of fur")
        self.save()
        # Lands in the view the new task belongs to.
        frame = self.see("[ +1 day ]")
        self.assertIn("Brush corgi", frame)
        self.assertIn("1 task · 2026-10-03", frame)
        (task,) = self.store.list()
        self.assertEqual(
            (task["title"], task["description"], task["status"], task["targetDate"]),
            ("Brush corgi", "Lots of fur", "todo", "2026-10-03"),
        )

    def test_required_fields_keep_the_details_view_open(self):
        self.mount()
        self.press("a")
        self.see("New Task")
        self.type("No description")
        self.save()
        self.see("description is required")
        self.assertEqual(self.store.list(), [])

    def test_edits_status_completion_and_target_date(self):
        task1 = self.store.add(title="Walk corgi", description="Around the block")
        self.mount()
        self.press("return")
        details = self.see(f"Task {short_id(task1['id'])}")
        self.assertIn("Around the block", details)
        created = format_local_date_time(self.store.get(task1["id"])["createdAt"])
        self.assertIn(f"Created {created} · Updated {created}", details)
        self.assertNotIn(" Completed ", details)

        self.tab(4, back=True)  # title -> parent -> id -> target date -> status
        self.press("left")
        self.see("‹ Done ›")
        self.see(" Completed ")
        self.save()
        self.assertIn("Walk corgi", self.see("[ Reopen ]"))
        task = self.store.get(task1["id"])
        self.assertEqual((task["status"], task["completionDate"]), ("done", "2026-10-03"))

        # Back to todo and into the future: lands in upcoming.
        self.press("return")
        self.see(f"Task {short_id(task1['id'])}")
        self.tab(5, back=True)  # parent, id, target date, completion date, status
        self.press("right")
        self.see("‹ Todo ›")
        self.tab()  # target date (completion field is gone)
        self.backspace(2)
        self.type("10")
        self.save()
        self.see("[ Pull to today ]")
        task = self.store.get(task1["id"])
        self.assertEqual((task["status"], task["targetDate"]), ("todo", "2026-10-10"))
        self.assertNotIn("completionDate", task)

    def test_rejects_an_incomplete_date(self):
        task1 = self.store.add(title="Walk corgi", description="Around the block")
        self.mount()
        self.press("return")
        self.tab(3, back=True)  # title -> parent -> id -> target date
        self.backspace()
        self.save()
        self.see("must be a date")
        self.assertEqual(self.store.get(task1["id"])["targetDate"], "2026-10-03")

    def test_date_inputs_only_take_yyyy_mm_dd(self):
        task1 = self.store.add(title="Walk corgi", description="Around the block")
        self.mount()
        self.press("return")
        self.tab(3, back=True)
        self.backspace(10)
        self.see("YYYY-MM-DD")  # placeholder: empty
        self.type("2026/1x012!")
        self.see("2026-10-12")
        self.save()
        self.see("[ Pull to today ]")
        self.assertEqual(self.store.get(task1["id"])["targetDate"], "2026-10-12")

    def test_deletes_only_from_the_details_view_after_confirming(self):
        task1 = self.store.add(title="Walk corgi", description="Around the block")
        self.mount()
        self.press("d")
        self.assertEqual(len(self.store.list()), 1)
        self.press("return")
        self.see(f"Task {short_id(task1['id'])}")
        self.press("d", ctrl=True)
        self.see("y to confirm")
        self.press("n")
        self.gone("y to confirm")
        self.assertEqual(len(self.store.list()), 1)
        self.press("d", ctrl=True)
        self.see("y to confirm")
        self.press("y")
        self.see("Nothing on for today")
        self.assertEqual(self.store.list(), [])

    def test_esc_leaves_the_details_view_without_saving(self):
        task1 = self.store.add(title="Walk corgi", description="Around the block")
        self.mount()
        self.press("return")
        self.see(f"Task {short_id(task1['id'])}")
        self.focused().mark_set("insert", "end-1c")
        self.type(" changed")
        self.press("escape")
        self.see("Current Tasks")
        self.assertEqual(self.store.get(task1["id"])["title"], "Walk corgi")

    def test_picks_up_changes_written_by_another_process(self):
        self.mount()
        self.see("Nothing on for today")
        TodoStore(dir=self.store.dir, now=lambda: NOW).add(title="From the CLI", description="x")
        self.see("From the CLI")

    def test_q_exits(self):
        self.mount()
        self.press("q")
        self.assertTrue(self.exited)

    def test_p_opens_templates_add_edit_and_delete(self):
        self.mount()
        self.press("p")
        self.see("No templates yet")
        self.press("a")
        self.see("New Template")
        self.type("Walk")  # title has focus
        self.tab(back=True)  # name
        self.save()
        self.see("template name is required")
        self.type("Daily walk")
        self.press("n", ctrl=True)
        self.see("New field")
        self.app.screen.new_field.name.insert("end", "Route")
        self.press("return")
        self.see("Route · text")
        self.type("Park")
        self.save()

        self.see("Fields: Route")
        (template,) = self.store.list_templates()
        self.assertEqual((template["name"], template["title"], template["description"]), ("Daily walk", "Walk", ""))
        self.assertEqual(template["fields"][0]["value"], "Park")

        self.press("return")
        self.see(f"Template {short_id(template['id'])}")
        self.press("d", ctrl=True)
        self.see('Delete template "Daily walk"? y to confirm')
        self.press("y")
        self.see("No templates yet")
        self.assertEqual(self.store.list_templates(), [])
        self.press("escape")
        self.see("Nothing on for today")

    def test_a_new_task_can_start_from_a_template(self):
        self.store.add_template(
            name="Walk",
            title="Walk corgi",
            fields=[{"type": "link", "name": "Route", "value": "https://maps.example/park"}, {"type": "text", "name": "Notes"}],
        )
        self.store.add_template(name="Groom", title="Groom corgi", description="Brush and trim")
        self.mount()
        self.press("a")
        self.see("New Task")
        self.type("Mine")
        self.press("return")  # description
        self.type("My own description")
        self.tab(5, back=True)  # description -> title -> parent -> target date -> status -> template
        self.assertEqual(self.app.screen.focus_id, "template")
        picker = self.app.screen.picker
        self.assertEqual(list(picker.cget("values")), ["Groom · Groom corgi", "Walk · Walk corgi"])
        picker.current(1)
        picker.event_generate("<<ComboboxSelected>>")
        frame = self.see("Route · link")
        self.assertEqual(picker.get(), "Walk")
        self.assertIn("Walk corgi", frame)
        # Empty template description leaves ours alone.
        self.assertIn("My own description", frame)
        self.save()

        self.see("[ +1 day ]")
        (task,) = self.store.list()
        self.assertEqual((task["title"], task["description"]), ("Walk corgi", "My own description"))
        self.assertEqual([(f["name"], f["value"]) for f in task["fields"]], [("Route", "https://maps.example/park"), ("Notes", "")])

        # Not offered when editing.
        self.press("return")
        self.see(f"Task {short_id(task['id'])}")
        self.assertNotIn("Template", self.frame())

    def test_sets_a_parent_copies_the_id_jumps_between_parent_and_subtasks(self):
        parent = self.store.add(title="Groom corgi", description="All of it")
        child = self.store.add(title="Brush corgi", description="Coat")
        self.mount()
        self.press("down")
        self.press("return")
        self.see(f"Task {short_id(child['id'])}")
        self.tab(back=True)  # title -> parent
        self.type(parent["id"])
        self.save()
        self.see("[ +1 day ]")
        self.assertEqual(self.store.get(child["id"])["parentId"], parent["id"])

        self.press("return")
        self.see("Parent · Groom corgi")
        self.tab(2, back=True)  # title -> parent -> id
        self.press("y", ctrl=True)
        self.see("Copied task id")
        self.assertEqual(self.effects, [f"copy {child['id']}"])

        self.press("p", ctrl=True)
        frame = self.see(f"Task {short_id(parent['id'])}")
        self.assertIn("All of it", frame)
        self.assertNotIn("Parent ·", frame)
        self.assertIn("Subtasks", frame)
        self.assertIn("Brush corgi", frame)

        # title -> subtask, enter opens it.
        self.tab()
        self.press("return")
        self.see(f"Task {short_id(child['id'])}")
        self.press("p", ctrl=True)
        self.see(f"Task {short_id(parent['id'])}")

        # The subtask's button opens it too.
        self.click(self.buttons("open")[0])
        self.see(f"Task {short_id(child['id'])}")
        self.press("p", ctrl=True)
        self.see(f"Task {short_id(parent['id'])}")

        self.press("d", ctrl=True)
        self.see("y to confirm")
        self.press("y")
        self.see("has 1 subtask")

    def test_adds_edits_and_removes_comments_saved_with_the_task(self):
        task = self.store.add(title="Walk corgi", description="Around the block")
        self.store.add_comment(task["id"], "Leash found")
        self.store.add_comment(task["id"], "Left home")
        self.mount()
        self.press("return")
        self.assertIn("Comment · 2026-10-03 12:00", self.see("Leash found"))

        self.tab(2)  # title -> description -> first comment
        self.press("x", ctrl=True)
        self.see("Removed comment")
        self.gone("Leash found")

        # Now on "Left home": edit it, then add one in the new-comment box.
        self.focused().mark_set("insert", "end-1c")
        self.type(" at 9")
        self.tab()
        self.type("Back home")
        self.save()
        self.see("[ +1 day ]")
        self.assertEqual([c["text"] for c in self.store.get(task["id"])["comments"]], ["Left home at 9", "Back home"])

        # esc discards a staged removal.
        self.press("return")
        self.see("Back home")
        self.tab(2)
        self.press("x", ctrl=True)
        self.see("Removed comment")
        self.press("escape")
        self.see("Current Tasks")
        self.assertEqual(len(self.store.get(task["id"])["comments"]), 2)


if __name__ == "__main__":
    unittest.main()
