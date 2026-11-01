"""Desktop UI (tkinter) over core. Needs a Python with Tk 8.6+."""


NEEDS_TK = (
    "The UI needs a Python with Tk 8.6 or newer (e.g. the python.org installer, or Homebrew's python-tk). "
    "The CLI and MCP server work without it."
)


def main() -> None:
    import os
    import sys

    try:
        import tkinter as tk
    except ImportError:
        sys.exit(f"error: this Python has no tkinter. {NEEDS_TK}")
    # Apple's /usr/bin/python3 ships Tk 8.5, which hangs on recent macOS instead of opening a window.
    if tk.TkVersion < 8.6:
        sys.exit(f"error: this Python has Tk {tk.TkVersion}. {NEEDS_TK}")

    from todos.core import TodoStore

    from .app import App

    if sys.platform == "win32":
        try:
            import ctypes

            # Without this Windows scales the window up as a bitmap and the text is blurry.
            ctypes.windll.shcore.SetProcessDpiAwareness(1)
        except (AttributeError, OSError):
            pass
    root = tk.Tk(className="corgi-todos")
    root.title("Corgi Todos")
    root.geometry("1000x760")
    root.minsize(640, 420)
    icon = os.path.join(os.path.dirname(os.path.abspath(__file__)), "assets", "icon.png")
    try:
        root.iconphoto(True, tk.PhotoImage(file=icon))
    except tk.TclError:
        pass
    app = App(root, TodoStore())
    root.protocol("WM_DELETE_WINDOW", app.quit)
    if sys.platform == "darwin":
        root.createcommand("tk::mac::Quit", app.quit)
    root.lift()
    root.focus_force()
    root.mainloop()
