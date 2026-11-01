import io
import json
import os
import shutil
import tempfile
import unittest
from datetime import datetime

from todos.cli import main
from todos.cli.args import ArgsError, parse_args
from todos.cli.terminal import terminal_safe, terminal_safe_json
from todos.core import TodoStore


class TerminalTest(unittest.TestCase):
    def test_terminal_safe_drops_control_characters_but_keeps_newlines_and_tabs(self):
        self.assertEqual(terminal_safe("a\u001b[2Jb\u001b]52;c;eA==\u0007c\rd\u009be\u007f"), "a[2Jb]52;c;eA==cde")
        self.assertEqual(terminal_safe("line 1\n\tline 2"), "line 1\n\tline 2")

    def test_terminal_safe_json_escapes_del_and_c1_characters(self):
        text = terminal_safe_json({"title": "a\u001b\u009b\u007fb"})
        self.assertNotRegex(text, "[\u0000-\u0008\u000b-\u001f\u007f-\u009f]")
        self.assertEqual(json.loads(text), {"title": "a\u001b\u009b\u007fb"})


class ArgsTest(unittest.TestCase):
    def test_options_and_positionals_in_any_order(self):
        values, positionals = parse_args(["add", "--title=A", "x", "--json", "--description", "d"], ["title", "description"], {"json": None, "help": "h"})
        self.assertEqual(values, {"json": True, "help": False, "title": "A", "description": "d"})
        self.assertEqual(positionals, ["add", "x"])
        self.assertEqual(parse_args(["-h"], [], {"help": "h"})[0], {"help": True})

    def test_rejects_unknown_missing_and_ambiguous_values(self):
        for argv in (["--nope"], ["--title"], ["--title", "--json"], ["-x"]):
            with self.assertRaises(ArgsError):
                parse_args(argv, ["title"], {"json": None})


class CliTest(unittest.TestCase):
    def setUp(self):
        self.root = tempfile.mkdtemp(prefix="corgiops-")
        self.store = TodoStore(dir=os.path.join(self.root, "todos"), now=lambda: datetime(2026, 10, 3, 12))

    def tearDown(self):
        shutil.rmtree(self.root, ignore_errors=True)

    def run_cli(self, *argv):
        out, err = io.StringIO(), io.StringIO()
        code = main(list(argv), store=self.store, out=out, err=err)
        return code, out.getvalue(), err.getvalue()

    def test_add_list_show_update_and_remove(self):
        code, out, _ = self.run_cli("add", "--title", "Walk", "--description", "Around", "--json")
        self.assertEqual(code, 0)
        task = json.loads(out)
        self.assertEqual(self.run_cli("list")[1], f"{task['id']}  Todo         2026-10-03  Walk\n")
        self.run_cli("comment", "add", task["id"], "--text", "Left home")
        _, out, _ = self.run_cli("show", task["id"])
        self.assertIn("Status:  Todo", out)
        self.assertIn("Comments:", out)
        self.assertIn("    Left home", out)
        _, out, _ = self.run_cli("update", task["id"], "--status", "done")
        self.assertEqual(out, f"Updated {task['id']} Walk\n")
        self.assertEqual(self.run_cli("list", "--view", "completed", "--json")[1].count('"title"'), 1)
        self.run_cli("rm", task["id"])
        self.assertEqual(self.run_cli("list")[1], "No tasks.\n")

    def test_parent_flag_sets_and_clears(self):
        parent = self.store.add(title="P", description="p")
        child = self.store.add(title="C", description="c")
        self.run_cli("update", child["id"], "--parent", parent["id"])
        self.assertEqual(self.store.get(child["id"])["parentId"], parent["id"])
        self.assertIn(f"Subtasks: {child['id']}", self.run_cli("show", parent["id"])[1])
        self.run_cli("update", child["id"], "--parent", "")
        self.assertNotIn("parentId", self.store.get(child["id"]))

    def test_fields_and_templates(self):
        task = self.store.add(title="A", description="a")
        _, out, _ = self.run_cli("field", "set", task["id"], "--name", "PR", "--type", "link", "--value", "https://x.example", "--editable", "false")
        self.assertEqual(out, f'{task["id"]} field "PR" set\n')
        self.assertIn("PR (link, locked): https://x.example", self.run_cli("show", task["id"])[1])

        self.run_cli("template", "add", "--name", "Walk", "--title", "Walk corgi")
        self.run_cli("template", "field", "set", "Walk", "--name", "Route", "--value", "park")
        _, out, _ = self.run_cli("add", "--template", "Walk", "--description", "Around", "--json")
        self.assertEqual(json.loads(out)["title"], "Walk corgi")
        self.assertIn("  (Walk corgi)", self.run_cli("template", "list")[1])

    def test_usage_and_domain_errors(self):
        code, _, err = self.run_cli("status", "x", "nope")
        self.assertEqual(code, 2)
        self.assertTrue(err.startswith("error: invalid status: nope"))
        self.assertIn("Usage:", err)
        code, _, err = self.run_cli("show", "nope")
        self.assertEqual((code, err), (1, "error: task nope not found\n"))
        self.assertEqual(self.run_cli("--bogus")[0], 2)
        self.assertEqual(self.run_cli("update", "x")[0], 2)
        self.assertIn("Usage:", self.run_cli()[1])

    def test_output_is_terminal_safe(self):
        self.store.add(title="evil\u001b[2J", description="d")
        self.assertNotIn("\u001b", self.run_cli("list")[1])


if __name__ == "__main__":
    unittest.main()
