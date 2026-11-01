import os
import sys

if not __package__:
    # Run as `python3 todos/bin`: put the repo root (not this dir) on the path so `todos` imports.
    sys.path[0] = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from todos.bin.main import main  # noqa: E402

main()
