import json
import os
import shutil
import stat
import tempfile
import threading
import time
import unittest
import uuid
from datetime import datetime

from todos.core import TodoError, TodoStore, apply_template, to_iso

# Local noon, so "today" is stable regardless of time zone.
NOON = datetime(2026, 10, 3, 12)


class StoreTest(unittest.TestCase):
    def setUp(self):
        self.clock = NOON
        self.root = tempfile.mkdtemp(prefix="corgiops-")
        self.store = self.make_store()

    def tearDown(self):
        shutil.rmtree(self.root, ignore_errors=True)

    def make_store(self):
        return TodoStore(dir=os.path.join(self.root, "todos"), now=lambda: self.clock)

    def assertSubset(self, actual, expected):
        self.assertEqual({k: actual.get(k) for k in expected}, expected)


class TodoStoreTest(StoreTest):
    def test_creates_the_directory_and_returns_no_tasks_when_empty(self):
        self.assertEqual(self.store.list(), [])
        self.assertTrue(os.path.isdir(self.store.dir))

    def test_adds_tasks_with_uuid_ids_and_persists_them(self):
        a = self.store.add(title="A", description="first")
        b = self.store.add(title="B", description="second", status="done")
        self.assertRegex(a["id"], r"^[0-9a-f-]{36}$")
        self.assertNotEqual(a["id"], b["id"])
        self.assertSubset(a, {"status": "todo", "targetDate": "2026-10-03"})
        self.assertNotIn("completionDate", a)
        self.assertEqual(b["completionDate"], "2026-10-03")

        with open(self.store.file) as f:
            on_disk = json.load(f)
        self.assertEqual(on_disk["schemaVersion"], 5)
        self.assertEqual(len(on_disk["tasks"]), 2)
        self.assertEqual(self.make_store().list(status="done"), [b])

    def test_requires_title_and_description(self):
        with self.assertRaisesRegex(TodoError, "title is required"):
            self.store.add(title="  ", description="x")
        with self.assertRaisesRegex(TodoError, "description is required"):
            self.store.add(title="x", description="")
        task = self.store.add(title="x", description="y")
        with self.assertRaises(TodoError):
            self.store.update(task["id"], description=" ")

    def test_updates_changes_status_and_removes(self):
        task = self.store.add(title="A", description="first")
        self.assertSubset(self.store.update(task["id"], title="A2"), {"title": "A2", "description": "first"})
        self.assertSubset(
            self.store.update(task["id"], title=None, status=None),
            {"title": "A2", "description": "first", "status": "todo"},
        )
        self.assertEqual(self.store.set_status(task["id"], "in-progress")["status"], "in-progress")
        self.store.remove(task["id"])
        self.assertEqual(self.store.list(), [])
        with self.assertRaisesRegex(TodoError, f"task {task['id']} not found"):
            self.store.get(task["id"])

    def test_concurrent_writers_do_not_lose_tasks(self):
        stores = [self.make_store() for _ in range(20)]
        threads = [threading.Thread(target=s.add, kwargs={"title": f"T{i}", "description": "d"}) for i, s in enumerate(stores)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()
        titles = sorted(t["title"] for t in self.store.list())
        self.assertEqual(titles, sorted(f"T{i}" for i in range(20)))

    def test_reports_a_corrupt_file_instead_of_overwriting_it(self):
        self.store.list()
        with open(self.store.file, "w") as f:
            f.write("{not json")
        with self.assertRaisesRegex(TodoError, "corrupt"):
            self.store.add(title="A", description="a")
        with open(self.store.file) as f:
            self.assertEqual(f.read(), "{not json")

    def test_watch_fires_on_changes_from_another_store(self):
        calls = []
        stop = self.store.watch(lambda: calls.append(1), interval=0.02)
        self.make_store().add(title="A", description="a")
        time.sleep(0.2)
        stop()
        self.assertGreater(len(calls), 0)

    def test_completion_date_follows_the_done_status(self):
        task = self.store.add(title="A", description="a")
        with self.assertRaisesRegex(TodoError, "only be set on done"):
            self.store.update(task["id"], completion_date="2026-10-01")

        done = self.store.update(task["id"], status="done", completion_date="2026-10-01")
        self.assertEqual(done["completionDate"], "2026-10-01")
        self.assertEqual(self.store.update(task["id"], title="A2")["completionDate"], "2026-10-01")

        reopened = self.store.update(task["id"], status="todo")
        self.assertNotIn("completionDate", reopened)
        self.assertEqual(self.store.set_status(task["id"], "done")["completionDate"], "2026-10-03")

    def test_explicitly_none_optional_fields_fall_back_to_defaults(self):
        task = self.store.add(title="A", description="a", status=None, target_date=None, completion_date=None, fields=None)
        self.assertSubset(task, {"status": "todo", "targetDate": "2026-10-03"})
        self.assertEqual(self.store.update(task["id"], target_date=None)["targetDate"], "2026-10-03")

    def test_rejects_malformed_dates(self):
        with self.assertRaisesRegex(TodoError, "YYYY-MM-DD"):
            self.store.add(title="A", description="a", target_date="tomorrow")
        with self.assertRaisesRegex(TodoError, "YYYY-MM-DD"):
            self.store.add(title="A", description="a", target_date="2026-02-30")

    def test_postpone_pull_to_today_and_reopen(self):
        overdue = self.store.add(title="A", description="a", target_date="2026-09-20")
        self.assertEqual(self.store.postpone(overdue["id"])["targetDate"], "2026-10-04")
        # Always tomorrow, not target + 1.
        self.assertEqual(self.store.postpone(overdue["id"])["targetDate"], "2026-10-04")
        self.assertEqual(self.store.pull_to_today(overdue["id"])["targetDate"], "2026-10-03")

        self.store.update(overdue["id"], status="done", target_date="2026-10-01")
        self.assertSubset(self.store.reopen(overdue["id"]), {"status": "in-progress", "targetDate": "2026-10-03"})
        self.assertNotIn("completionDate", self.store.get(overdue["id"]))

    def test_list_views_filter_and_sort(self):
        def add(title, **kwargs):
            self.store.add(title=title, description="d", **kwargs)

        add("todo-today")
        add("doing-overdue", status="in-progress", target_date="2026-10-01")
        add("later", target_date="2026-10-10")
        add("soon", target_date="2026-10-04")
        add("done-old", status="done", completion_date="2026-09-01")
        add("done-new", status="done", completion_date="2026-10-02")

        def titles(view):
            return [t["title"] for t in self.store.list(view=view)]

        self.assertEqual(titles("current"), ["doing-overdue", "todo-today"])
        self.assertEqual(titles("upcoming"), ["soon", "later"])
        self.assertEqual(titles("completed"), ["done-new", "done-old"])

        self.clock = datetime(2026, 10, 4, 12)
        self.assertEqual(titles("current"), ["doing-overdue", "todo-today", "soon"])

    def test_keeps_data_private_to_the_owner(self):
        self.store.add(title="A", description="a")
        self.assertEqual(stat.S_IMODE(os.stat(self.store.dir).st_mode), 0o700)
        self.assertEqual(stat.S_IMODE(os.stat(self.store.file).st_mode), 0o600)

    def test_rejects_pre_uuid_files_instead_of_overwriting_them(self):
        self.store.list()
        with open(self.store.file, "w") as f:
            json.dump({"schemaVersion": 3, "nextId": 1, "tasks": []}, f)
        with self.assertRaisesRegex(TodoError, "unsupported format"):
            self.store.add(title="A", description="a")

    def test_reads_files_written_by_the_typescript_version(self):
        task = {
            "id": "6f1c2c1e-3f0a-4c7e-9a51-1d0f8a0b6c11",
            "status": "done",
            "title": "A",
            "description": "a",
            "targetDate": "2026-10-01",
            "fields": [{"type": "link", "name": "PR", "editable": True, "visibleOnLists": False, "value": "https://x.example"}],
            "comments": [],
            "createdAt": "2026-10-01T09:00:00.000Z",
            "updatedAt": "2026-10-01T09:00:00.000Z",
            "completionDate": "2026-10-02",
        }
        self.store.list()
        with open(self.store.file, "w") as f:
            json.dump({"schemaVersion": 5, "tasks": [task]}, f)
        self.assertEqual(self.store.list(), [task])


class SubtasksTest(StoreTest):
    def test_parent_id_sets_changes_and_clears_the_parent(self):
        parent = self.store.add(title="P", description="p")
        other = self.store.add(title="O", description="o")
        child = self.store.add(title="C", description="c", parent_id=f" {parent['id']} ")
        self.assertEqual(child["parentId"], parent["id"])
        self.assertEqual(self.store.update(child["id"], title="C2")["parentId"], parent["id"])
        self.assertEqual(self.store.update(child["id"], parent_id=other["id"])["parentId"], other["id"])
        self.assertNotIn("parentId", self.store.update(child["id"], parent_id=None))
        self.assertNotIn("parentId", self.store.add(title="D", description="d", parent_id=None))

    def test_get_with_subtasks_lists_direct_subtask_ids_in_creation_order(self):
        parent = self.store.add(title="P", description="p")
        a = self.store.add(title="A", description="a", parent_id=parent["id"])
        b = self.store.add(title="B", description="b", parent_id=parent["id"])
        self.store.add(title="Grandchild", description="g", parent_id=a["id"])
        self.assertSubset(self.store.get_with_subtasks(parent["id"]), {"title": "P", "subtaskIds": [a["id"], b["id"]]})
        self.assertEqual(self.store.get_with_subtasks(b["id"])["subtaskIds"], [])

    def test_rejects_unknown_parents_and_cycles(self):
        a = self.store.add(title="A", description="a")
        b = self.store.add(title="B", description="b", parent_id=a["id"])
        c = self.store.add(title="C", description="c", parent_id=b["id"])
        with self.assertRaisesRegex(TodoError, r"parentId must be a task id"):
            self.store.add(title="X", description="x", parent_id="nope")
        missing = str(uuid.uuid4())
        with self.assertRaisesRegex(TodoError, f"task {missing} not found"):
            self.store.add(title="X", description="x", parent_id=missing)
        with self.assertRaisesRegex(TodoError, "own parent or ancestor"):
            self.store.update(a["id"], parent_id=a["id"])
        with self.assertRaisesRegex(TodoError, "own parent or ancestor"):
            self.store.update(a["id"], parent_id=c["id"])
        self.assertNotIn("parentId", self.store.get(a["id"]))

    def test_a_task_with_subtasks_cant_be_removed(self):
        parent = self.store.add(title="P", description="p")
        child = self.store.add(title="C", description="c", parent_id=parent["id"])
        with self.assertRaisesRegex(TodoError, "has 1 subtask; delete or move them first"):
            self.store.remove(parent["id"])
        self.store.remove(child["id"])
        self.store.remove(parent["id"])
        self.assertEqual(self.store.list(), [])


class CommentsTest(StoreTest):
    def test_add_update_and_remove_with_timestamps(self):
        task = self.store.add(title="A", description="a")
        self.assertEqual(task["comments"], [])
        (comment,) = self.store.add_comment(task["id"], " Started ")["comments"]
        self.assertSubset(comment, {"text": "Started", "createdAt": to_iso(self.clock), "updatedAt": to_iso(self.clock)})
        with self.assertRaisesRegex(TodoError, "comment text is required"):
            self.store.add_comment(task["id"], " ")

        self.clock = datetime(2026, 10, 3, 13)
        updated = self.store.update_comment(task["id"], comment["id"], "Halfway")
        self.assertEqual(updated["comments"], [{**comment, "text": "Halfway", "updatedAt": to_iso(self.clock)}])
        self.assertEqual(updated["updatedAt"], to_iso(self.clock))
        with self.assertRaisesRegex(TodoError, f"task {task['id']} has no comment nope"):
            self.store.update_comment(task["id"], "nope", "x")

        self.assertEqual(self.store.remove_comment(task["id"], comment["id"])["comments"], [])
        with self.assertRaisesRegex(TodoError, "has no comment"):
            self.store.remove_comment(task["id"], comment["id"])

    def test_update_comments_keeps_edits_adds_and_drops_comments(self):
        task = self.store.add(title="A", description="a")
        self.store.add_comment(task["id"], "one")
        self.store.add_comment(task["id"], "two")
        one, two, _ = self.store.add_comment(task["id"], "three")["comments"]

        self.clock = datetime(2026, 10, 3, 13)
        comments = self.store.update(
            task["id"],
            comments=[{"id": one["id"], "text": "one"}, {"id": two["id"], "text": "two!"}, {"text": "four"}],
        )["comments"]
        now = to_iso(self.clock)
        self.assertEqual(comments[:2], [one, {**two, "text": "two!", "updatedAt": now}])
        self.assertSubset(comments[2], {"text": "four", "createdAt": now, "updatedAt": now})
        # Omitted leaves them alone.
        self.assertEqual(self.store.update(task["id"], title="A2")["comments"], comments)
        with self.assertRaisesRegex(TodoError, "has no comment"):
            self.store.update(task["id"], comments=[{"id": str(uuid.uuid4()), "text": "x"}])
        with self.assertRaisesRegex(TodoError, "listed twice"):
            self.store.update(task["id"], comments=[{"id": one["id"], "text": "a"}, {"id": one["id"], "text": "b"}])


class CustomFieldsTest(StoreTest):
    def test_fill_in_option_defaults_and_validate_values(self):
        task = self.store.add(
            title="A",
            description="a",
            fields=[
                {"type": "text", "name": "Notes", "value": "hi"},
                {"type": "link", "name": "PR", "value": " https://example.com ", "visibleOnLists": True},
                {"type": "date", "name": "Due"},
                {"type": "timestamp", "name": "At", "value": "2026-10-03T09:00:00+03:00", "editable": False},
            ],
        )
        self.assertEqual(
            task["fields"],
            [
                {"type": "text", "name": "Notes", "editable": True, "visibleOnLists": False, "textbox": True, "value": "hi"},
                {"type": "link", "name": "PR", "editable": True, "visibleOnLists": True, "value": "https://example.com"},
                {"type": "date", "name": "Due", "editable": True, "visibleOnLists": False, "value": ""},
                {"type": "timestamp", "name": "At", "editable": False, "visibleOnLists": False, "value": "2026-10-03T09:00:00+03:00"},
            ],
        )
        with self.assertRaisesRegex(TodoError, "YYYY-MM-DD"):
            self.store.add(title="B", description="b", fields=[{"type": "date", "name": "Due", "value": "soon"}])
        with self.assertRaisesRegex(TodoError, "field name is required"):
            self.store.add(title="B", description="b", fields=[{"type": "text", "name": " "}])
        with self.assertRaisesRegex(TodoError, "duplicate field name: X"):
            self.store.add(title="B", description="b", fields=[{"type": "text", "name": "X"}, {"type": "link", "name": "X"}])

    def test_links_must_be_http_urls(self):
        task = self.store.add(title="A", description="a")
        for value in ["file:///Applications/Calculator.app", "/tmp/evil.command", "javascript:alert(1)", "-a Terminal", "x"]:
            with self.assertRaisesRegex(TodoError, r"http\(s\) URLs"):
                self.store.set_field(task["id"], name="L", type="link", value=value)
        updated = self.store.set_field(task["id"], name="L", type="link", value="http://example.com/a?b")
        self.assertEqual(updated["fields"][0]["value"], "http://example.com/a?b")

    def test_set_field_adds_or_changes_a_field_by_name_keeping_unspecified_options(self):
        task = self.store.add(title="A", description="a")
        self.store.set_field(task["id"], name="PR", type="link", value="https://x.example", visible_on_lists=True)
        updated = self.store.set_field(task["id"], name="PR", value="https://y.example", type=None)
        self.assertEqual(updated["fields"], [{"type": "link", "name": "PR", "editable": True, "visibleOnLists": True, "value": "https://y.example"}])
        self.assertSubset(self.store.set_field(task["id"], name="Notes")["fields"][1], {"type": "text", "textbox": True})

        self.assertEqual([f["name"] for f in self.store.remove_field(task["id"], "PR")["fields"]], ["Notes"])
        with self.assertRaisesRegex(TodoError, 'no field "PR"'):
            self.store.remove_field(task["id"], "PR")

    def test_non_editable_fields_are_locked_once_saved_but_can_be_removed(self):
        task = self.store.add(title="A", description="a", fields=[{"type": "text", "name": "Id", "value": "1", "editable": False}])
        with self.assertRaisesRegex(TodoError, 'field "Id" is not editable'):
            self.store.set_field(task["id"], name="Id", value="2")
        with self.assertRaisesRegex(TodoError, "not editable"):
            self.store.set_field(task["id"], name="Id", editable=True)
        with self.assertRaisesRegex(TodoError, "not editable"):
            self.store.update(task["id"], fields=[{**task["fields"][0], "value": "2"}])
        # Unchanged locked fields pass through a full update.
        self.assertEqual(self.store.update(task["id"], title="A2", fields=task["fields"])["fields"], task["fields"])

        # Added later, it locks from then on.
        self.store.set_field(task["id"], name="Ref", value="r", editable=False)
        with self.assertRaisesRegex(TodoError, "not editable"):
            self.store.set_field(task["id"], name="Ref", value="s")

        self.assertEqual(self.store.update(task["id"], fields=[])["fields"], [])


class TemplatesTest(StoreTest):
    def test_crud_stored_apart_from_tasks(self):
        bug = self.store.add_template(name="Bug", title="Fix: ", fields=[{"type": "link", "name": "Issue"}])
        self.assertSubset(bug, {"name": "Bug", "title": "Fix:", "description": ""})
        self.assertSubset(bug["fields"][0], {"name": "Issue", "value": ""})
        self.store.add_template(name="Admin")
        self.assertEqual([t["name"] for t in self.store.list_templates()], ["Admin", "Bug"])
        self.assertTrue(os.path.exists(self.store.templates_file))
        self.assertFalse(os.path.exists(self.store.file))

        with self.assertRaisesRegex(TodoError, 'a template named "Bug" already exists'):
            self.store.add_template(name="Bug")
        with self.assertRaisesRegex(TodoError, "already exists"):
            self.store.update_template(bug["id"], name="Admin")
        with self.assertRaisesRegex(TodoError, "template name is required"):
            self.store.add_template(name=" ")

        self.assertSubset(
            self.store.update_template("Bug", name="Defect", description="Steps:", title=None),
            {"name": "Defect", "title": "Fix:", "description": "Steps:"},
        )
        self.assertSubset(
            self.store.set_template_field(bug["id"], name="Issue", value="https://x", editable=False)["fields"][0],
            {"type": "link", "value": "https://x", "editable": False},
        )
        # Not locked on a template.
        self.assertEqual(self.store.set_template_field(bug["id"], name="Issue", value="https://y")["fields"][0]["value"], "https://y")
        self.assertEqual(self.store.remove_template_field("Defect", "Issue")["fields"], [])
        with self.assertRaisesRegex(TodoError, 'template "Defect" has no field "Issue"'):
            self.store.remove_template_field(bug["id"], "Issue")

        self.store.remove_template("Defect")
        with self.assertRaisesRegex(TodoError, f'template "{bug["id"]}" not found'):
            self.store.get_template(bug["id"])
        with self.assertRaisesRegex(TodoError, 'template "Nope" not found'):
            self.store.get_template("Nope")

    def test_add_from_template_fills_in_from_the_template_explicit_values_win(self):
        self.store.add_template(
            name="Review",
            title="Review PR",
            description="Check tests",
            fields=[{"type": "link", "name": "PR", "value": "https://default"}, {"type": "text", "name": "Notes"}],
        )
        task = self.store.add_from_template(
            "Review",
            title="Review #42",
            target_date="2026-10-05",
            fields=[{"type": "link", "name": "PR", "value": "https://42"}],
        )
        self.assertSubset(task, {"title": "Review #42", "description": "Check tests", "targetDate": "2026-10-05", "status": "todo"})
        self.assertEqual([(f["name"], f["value"]) for f in task["fields"]], [("PR", "https://42"), ("Notes", "")])

        self.store.add_template(name="Blank")
        with self.assertRaisesRegex(TodoError, "title is required"):
            self.store.add_from_template("Blank")


class ApplyTemplateTest(unittest.TestCase):
    @staticmethod
    def template(**fields):
        return {
            "id": "00000000-0000-4000-8000-000000000000",
            "name": "T",
            "title": "",
            "description": "",
            "fields": [],
            "createdAt": "2026-10-03T09:00:00.000Z",
            "updatedAt": "2026-10-03T09:00:00.000Z",
            **fields,
        }

    @staticmethod
    def text(name, value):
        return {"type": "text", "name": name, "value": value, "editable": True, "visibleOnLists": False, "textbox": True}

    def test_only_non_empty_template_values_override(self):
        text = self.text
        values = {"title": "Mine", "description": "Mine too", "fields": [text("A", "a"), text("B", "b")], "extra": 1}
        self.assertEqual(apply_template(values, self.template(description="  ")), values)
        self.assertEqual(
            apply_template(values, self.template(title="T", description="D", fields=[text("B", "tb"), text("A", ""), text("C", "")])),
            {"title": "T", "description": "D", "fields": [text("A", "a"), text("B", "tb"), text("C", "")], "extra": 1},
        )


if __name__ == "__main__":
    unittest.main()
