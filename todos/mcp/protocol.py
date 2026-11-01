"""Minimal MCP server (tools only) over stdio: newline-delimited JSON-RPC 2.0, no SDK.
Spec: https://modelcontextprotocol.io/specification"""
from __future__ import annotations

import json
import sys
import traceback
from typing import Any, BinaryIO, Callable, Dict, List, Optional

SUPPORTED_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"]

PARSE_ERROR = -32700
INVALID_REQUEST = -32600
METHOD_NOT_FOUND = -32601
INVALID_PARAMS = -32602
INTERNAL_ERROR = -32603

Schema = Dict[str, Any]
ToolResult = Dict[str, Any]


# JSON Schema builders for tool inputs. Only what `validate` understands.
def string(description: str) -> Schema:
    return {"type": "string", "description": description}


def boolean(description: str) -> Schema:
    return {"type": "boolean", "description": description}


def enum(values, description: str) -> Schema:
    return {"type": "string", "enum": list(values), "description": description}


def nullable(schema: Schema) -> Schema:
    return {**schema, "type": [schema["type"], "null"]}


def array(items: Schema, description: str) -> Schema:
    return {"type": "array", "items": items, "description": description}


def obj(properties: Dict[str, Schema], required: List[str] = ()) -> Schema:
    schema: Schema = {"type": "object", "properties": properties, "additionalProperties": False}
    if required:
        schema["required"] = list(required)
    return schema


_TYPES = {
    "string": lambda v: isinstance(v, str),
    "boolean": lambda v: isinstance(v, bool),
    "array": lambda v: isinstance(v, list),
    "object": lambda v: isinstance(v, dict),
    "null": lambda v: v is None,
}


def validate(schema: Schema, value: Any, path: str = "") -> Any:
    """Checks `value` against `schema`, returning it with unknown object keys dropped. Raises ValueError."""
    types = schema["type"] if isinstance(schema["type"], list) else [schema["type"]]
    where = path or "arguments"
    if not any(_TYPES[t](value) for t in types):
        raise ValueError(f"{where}: expected {' or '.join(types)}")
    if value is None:
        return None
    if "enum" in schema and value not in schema["enum"]:
        raise ValueError(f"{where}: expected one of {', '.join(schema['enum'])}")
    if isinstance(value, list):
        return [validate(schema["items"], item, f"{path}[{index}]") for index, item in enumerate(value)]
    if isinstance(value, dict):
        for key in schema.get("required", []):
            if key not in value:
                raise ValueError(f"{path + '.' if path else ''}{key}: required")
        properties = schema["properties"]
        return {key: validate(properties[key], item, f"{path + '.' if path else ''}{key}") for key, item in value.items() if key in properties}
    return value


class RpcError(Exception):
    def __init__(self, code: int, message: str):
        super().__init__(message)
        self.code = code


class Tool:
    def __init__(self, name: str, description: str, input_schema: Schema, annotations: Optional[dict], handler: Callable[[dict], ToolResult]):
        self.name = name
        self.description = description
        self.input_schema = input_schema
        self.annotations = annotations
        self.handler = handler

    def describe(self) -> dict:
        result = {"name": self.name, "description": self.description, "inputSchema": self.input_schema}
        if self.annotations:
            result["annotations"] = self.annotations
        return result


class McpServer:
    def __init__(self, name: str, version: str):
        self.info = {"name": name, "version": version}
        self.tools: Dict[str, Tool] = {}

    def tool(self, name: str, description: str, properties: Dict[str, Schema], required: List[str] = (), annotations: Optional[dict] = None):
        """Registers the decorated function as a tool; it gets the validated arguments as a dict."""

        def register(handler: Callable[[dict], ToolResult]) -> Callable[[dict], ToolResult]:
            self.tools[name] = Tool(name, description, obj(properties, required), annotations, handler)
            return handler

        return register

    def handle(self, message: Any) -> Optional[dict]:
        """Handles one JSON-RPC message; returns the response, or None for notifications and responses."""
        if not isinstance(message, dict) or message.get("jsonrpc") != "2.0":
            return _error(None, INVALID_REQUEST, "invalid request")
        if "method" not in message:
            return None  # A response to a request we never send.
        id_ = message.get("id")
        is_request = "id" in message
        try:
            result = self._dispatch(message["method"], message.get("params") or {})
        except RpcError as err:
            return _error(id_, err.code, str(err)) if is_request else None
        except Exception as err:  # noqa: BLE001 - one bad call must not take the server down
            traceback.print_exc(file=sys.stderr)
            return _error(id_, INTERNAL_ERROR, f"internal error: {err}") if is_request else None
        return {"jsonrpc": "2.0", "id": id_, "result": result} if is_request else None

    def _dispatch(self, method: str, params: dict) -> Any:
        if method == "initialize":
            requested = params.get("protocolVersion")
            return {
                "protocolVersion": requested if requested in SUPPORTED_VERSIONS else SUPPORTED_VERSIONS[0],
                "capabilities": {"tools": {"listChanged": False}},
                "serverInfo": self.info,
            }
        if method == "ping":
            return {}
        if method == "tools/list":
            return {"tools": [tool.describe() for tool in self.tools.values()]}
        if method == "tools/call":
            return self._call(params.get("name"), params.get("arguments") or {})
        if method.startswith("notifications/"):
            return None
        raise RpcError(METHOD_NOT_FOUND, f"method not found: {method}")

    def _call(self, name: Any, arguments: Any) -> ToolResult:
        tool = self.tools.get(name) if isinstance(name, str) else None
        if tool is None:
            raise RpcError(INVALID_PARAMS, f"tool {name} not found")
        try:
            args = validate(tool.input_schema, arguments)
        except ValueError as err:
            return text_result(f"Input validation error: Invalid arguments for tool {name}: {err}", is_error=True)
        return tool.handler(args)

    def serve(self, stdin: Optional[BinaryIO] = None, stdout: Optional[BinaryIO] = None) -> None:
        """Serves until stdin closes. Logs go to stderr; stdout carries only protocol messages."""
        stdin = stdin or sys.stdin.buffer
        stdout = stdout or sys.stdout.buffer
        for line in stdin:
            if not line.strip():
                continue
            try:
                message = json.loads(line)
            except ValueError:
                response: Optional[dict] = _error(None, PARSE_ERROR, "parse error")
            else:
                response = self.handle(message)
            if response is not None:
                stdout.write(json.dumps(response, ensure_ascii=False).encode("utf-8") + b"\n")
                stdout.flush()


def text_result(text: str, is_error: bool = False) -> ToolResult:
    result: ToolResult = {"content": [{"type": "text", "text": text}]}
    if is_error:
        result["isError"] = True
    return result


def _error(id_: Any, code: int, message: str) -> dict:
    return {"jsonrpc": "2.0", "id": id_, "error": {"code": code, "message": message}}
