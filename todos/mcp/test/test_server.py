import io
import json
import os
import shutil
import tempfile
import unittest
from datetime import datetime

from todos.core import TodoStore
from todos.mcp import create_server


class ServerTest(unittest.TestCase):
    def setUp(self):
        self.root = tempfile.mkdtemp(prefix="corgiops-")
        self.server = create_server(TodoStore(dir=os.path.join(self.root, "todos"), now=lambda: datetime(2026, 10, 3, 12)))
        self.next_id = 0

    def tearDown(self):
        shutil.rmtree(self.root, ignore_errors=True)

    def request(self, method, params=None):
        self.next_id += 1
        response = self.server.handle({"jsonrpc": "2.0", "id": self.next_id, "method": method, "params": params or {}})
        self.assertEqual(response["id"], self.next_id)
        return response

    def call(self, name, args=None):
        result = self.request("tools/call", {"name": name, "arguments": args or {}})["result"]
        return {"isError": result.get("isError", False), "text": result["content"][0]["text"]}

    def call_json(self, name, args=None):
        result = self.call(name, args)
        self.assertFalse(result["isError"], result["text"])
        return json.loads(result["text"])

    def test_initializes_and_exposes_the_task_tools(self):
        init = self.request("initialize", {"protocolVersion": "2025-06-18", "capabilities": {}, "clientInfo": {"name": "t", "version": "0"}})
        self.assertEqual(init["result"]["protocolVersion"], "2025-06-18")
        self.assertEqual(init["result"]["serverInfo"]["name"], "corgi-todos")
        self.assertIsNone(self.server.handle({"jsonrpc": "2.0", "method": "notifications/initialized"}))

        tools = self.request("tools/list")["result"]["tools"]
        self.assertEqual(
            sorted(t["name"] for t in tools),
            [
                "add_task",
                "add_task_comment",
                "add_template",
                "delete_task",
                "delete_task_comment",
                "delete_template",
                "get_task",
                "get_template",
                "list_tasks",
                "list_templates",
                "postpone_task",
                "pull_task_to_today",
                "remove_task_field",
                "remove_template_field",
                "reopen_task",
                "set_task_field",
                "set_task_status",
                "set_template_field",
                "update_task",
                "update_task_comment",
                "update_template",
            ],
        )
        get_task = next(t for t in tools if t["name"] == "get_task")
        self.assertEqual(get_task["inputSchema"]["required"], ["id"])
        self.assertEqual(get_task["annotations"], {"readOnlyHint": True})

    def test_full_task_lifecycle(self):
        added = self.call_json("add_task", {"title": "Walk corgi", "description": "Around the block"})
        self.assertEqual((added["status"], added["targetDate"]), ("todo", "2026-10-03"))
        id_ = added["id"]

        self.call("set_task_status", {"id": id_, "status": "in-progress"})
        self.call("update_task", {"id": id_, "title": "Walk the corgi"})
        task = self.call_json("get_task", {"id": id_})
        self.assertEqual((task["title"], task["description"], task["status"]), ("Walk the corgi", "Around the block", "in-progress"))
        self.assertEqual(self.call_json("list_tasks", {"status": "todo"}), [])

        self.assertEqual(len(self.call_json("list_tasks", {"view": "current"})), 1)
        self.assertEqual(self.call_json("postpone_task", {"id": id_})["targetDate"], "2026-10-04")
        self.assertEqual(len(self.call_json("list_tasks", {"view": "upcoming"})), 1)
        self.call("pull_task_to_today", {"id": id_})
        self.assertEqual(self.call_json("set_task_status", {"id": id_, "status": "done"})["completionDate"], "2026-10-03")
        self.assertEqual(self.call_json("reopen_task", {"id": id_})["status"], "in-progress")

        self.call("delete_task", {"id": id_})
        self.assertEqual(self.call_json("list_tasks"), [])

    def test_domain_errors_come_back_as_tool_errors(self):
        self.assertEqual(self.call("get_task", {"id": "nope"}), {"isError": True, "text": "task nope not found"})
        self.assertEqual(self.call("add_task", {"title": " ", "description": "x"}), {"isError": True, "text": "title is required"})

    def test_invalid_arguments_and_unknown_tools_and_methods(self):
        result = self.call("set_task_status", {"id": "x", "status": "nope"})
        self.assertTrue(result["isError"])
        self.assertIn("status: expected one of todo, in-progress, done", result["text"])
        self.assertTrue(self.call("get_task", {})["isError"])
        self.assertEqual(self.request("tools/call", {"name": "nope"})["error"]["code"], -32602)
        self.assertEqual(self.request("nope")["error"]["code"], -32601)

    def test_custom_fields(self):
        fields = [{"type": "link", "name": "PR", "value": "https://example.com", "editable": False}]
        added = self.call_json("add_task", {"title": "Review", "description": "x", "fields": fields})
        id_ = added["id"]
        self.assertEqual(added["fields"], [{"type": "link", "name": "PR", "value": "https://example.com", "editable": False, "visibleOnLists": False}])

        self.assertEqual(
            self.call("set_task_field", {"id": id_, "name": "PR", "value": "https://y.example"}),
            {"isError": True, "text": 'field "PR" is not editable'},
        )
        updated = self.call_json("set_task_field", {"id": id_, "name": "Due", "type": "date", "value": "2026-10-09"})
        self.assertEqual([f["name"] for f in updated["fields"]], ["PR", "Due"])
        removed = self.call_json("remove_task_field", {"id": id_, "name": "PR"})
        self.assertEqual(removed["fields"], [{"type": "date", "name": "Due", "value": "2026-10-09", "editable": True, "visibleOnLists": False}])

    def test_templates(self):
        fields = [{"type": "text", "name": "Notes", "value": "from template"}]
        added = self.call_json("add_template", {"name": "Walk", "title": "Walk corgi", "fields": fields})
        self.assertEqual((added["name"], added["title"], added["description"]), ("Walk", "Walk corgi", ""))
        self.call("update_template", {"template": "Walk", "description": "Around the block"})
        self.call("set_template_field", {"template": added["id"], "name": "Route", "type": "link"})
        self.assertEqual([t["name"] for t in self.call_json("list_templates")], ["Walk"])
        self.assertEqual(len(self.call_json("get_template", {"template": added["id"]})["fields"]), 2)

        task = self.call_json("add_task", {"template": "Walk", "title": "Evening walk"})
        self.assertEqual((task["title"], task["description"]), ("Evening walk", "Around the block"))
        self.assertEqual([f["name"] for f in task["fields"]], ["Notes", "Route"])
        self.assertEqual(self.call("add_task", {"title": "x"}), {"isError": True, "text": "description is required"})

        self.call("remove_template_field", {"template": "Walk", "name": "Route"})
        self.call("delete_template", {"template": "Walk"})
        self.assertEqual(self.call("get_template", {"template": "Walk"}), {"isError": True, "text": 'template "Walk" not found'})

    def test_subtasks(self):
        parent = self.call_json("add_task", {"title": "Groom", "description": "All of it"})
        child = self.call_json("add_task", {"title": "Brush", "description": "Coat", "parentId": parent["id"]})
        self.assertEqual(child["parentId"], parent["id"])
        self.assertEqual(self.call_json("get_task", {"id": parent["id"]})["subtaskIds"], [child["id"]])
        self.assertEqual(
            self.call("delete_task", {"id": parent["id"]}),
            {"isError": True, "text": f"task {parent['id']} has 1 subtask; delete or move them first"},
        )
        self.assertNotIn("parentId", self.call_json("update_task", {"id": child["id"], "parentId": None}))
        self.assertFalse(self.call("delete_task", {"id": parent["id"]})["isError"])

    def test_comments(self):
        task = self.call_json("add_task", {"title": "Walk", "description": "Around"})
        (comment,) = self.call_json("add_task_comment", {"id": task["id"], "text": "Left home"})["comments"]
        self.assertEqual(comment["text"], "Left home")
        self.call("update_task_comment", {"id": task["id"], "commentId": comment["id"], "text": "Left home at 9"})
        comments = self.call_json("get_task", {"id": task["id"]})["comments"]
        self.assertEqual([(c["id"], c["text"]) for c in comments], [(comment["id"], "Left home at 9")])
        self.assertEqual(self.call_json("delete_task_comment", {"id": task["id"], "commentId": comment["id"]})["comments"], [])
        self.assertEqual(self.call("add_task_comment", {"id": task["id"], "text": ""}), {"isError": True, "text": "comment text is required"})

    def test_serves_newline_delimited_json_over_stdio(self):
        requests = [
            {"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {"protocolVersion": "1999-01-01"}},
            {"jsonrpc": "2.0", "method": "notifications/initialized"},
            {"jsonrpc": "2.0", "id": 2, "method": "tools/call", "params": {"name": "list_tasks", "arguments": {}}},
        ]
        stdin = io.BytesIO(b"".join(json.dumps(r).encode() + b"\n" for r in requests) + b"not json\n")
        stdout = io.BytesIO()
        self.server.serve(stdin, stdout)
        responses = [json.loads(line) for line in stdout.getvalue().splitlines()]
        self.assertEqual([r["id"] for r in responses], [1, 2, None])
        self.assertEqual(responses[0]["result"]["protocolVersion"], "2025-11-25")
        self.assertEqual(responses[1]["result"]["content"][0]["text"], "[]")
        self.assertEqual(responses[2]["error"]["code"], -32700)


if __name__ == "__main__":
    unittest.main()
