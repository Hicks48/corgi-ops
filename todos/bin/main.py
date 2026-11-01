"""Launcher: one command for all adapters.
No args = UI, `mcp` = MCP server, `--version`, anything else goes to the CLI. Adapters are imported lazily so
only the chosen one loads (the CLI and MCP server work on Pythons without Tk)."""
import sys

VERSION = "0.1.0"


def main() -> None:
    args = sys.argv[1:]
    if not args:
        from todos.ui import main as ui

        ui()
    elif args[0] == "mcp":
        from todos.mcp import create_server

        create_server().serve()
    elif args[0] in ("--version", "-v"):
        print(VERSION)
    else:
        from todos.cli import main as cli

        sys.exit(cli(args))
