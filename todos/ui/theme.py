"""Terminal-like look: one monospace font, dark background, thin borders and an orange accent (as the TUI had)."""
import tkinter as tk
import tkinter.font as tkfont
from tkinter import ttk

BG = "#1a1a1a"
TEXT = "#e4e4e4"
DIM = "#8a8a8a"
BORDER = "#4e4e4e"
ACCENT = "#f5a742"
ON_ACCENT = "#000000"
ERROR = "#ff5f5f"

STATUS_COLORS = {"todo": "#87afd7", "in-progress": "#f5a742", "done": "#87d787"}
STATUS_BADGES = {"todo": "○ TODO", "in-progress": "◐ IN PROGRESS", "done": "● DONE"}

MONOSPACE = ["Menlo", "SF Mono", "Consolas", "DejaVu Sans Mono", "Liberation Mono", "Ubuntu Mono"]


class Fonts:
    normal: tkfont.Font
    bold: tkfont.Font

    @classmethod
    def init(cls, root: tk.Misc, size: int = 13) -> None:
        families = set(tkfont.families(root))
        family = next((f for f in MONOSPACE if f in families), tkfont.Font(root, name="TkFixedFont", exists=True).actual("family"))
        cls.normal = tkfont.Font(root, family=family, size=size)
        cls.bold = tkfont.Font(root, family=family, size=size, weight="bold")

    @classmethod
    def char_width(cls) -> int:
        return max(1, cls.normal.measure("0"))


def apply(root: tk.Tk) -> None:
    """Fonts, colors and ttk styles for the whole app. Call once, before building widgets."""
    Fonts.init(root)
    root.configure(bg=BG)
    for name in ("TkDefaultFont", "TkTextFont", "TkFixedFont", "TkMenuFont", "TkHeadingFont"):
        tkfont.Font(root, name=name, exists=True).configure(**Fonts.normal.actual())
    style = ttk.Style(root)
    # clam honours custom colors on every platform (aqua ignores them).
    style.theme_use("clam")
    style.configure(".", background=BG, foreground=TEXT, fieldbackground=BG, bordercolor=BORDER, font=Fonts.normal)
    style.layout(
        "Thin.Vertical.TScrollbar",
        [("Vertical.Scrollbar.trough", {"sticky": "ns", "children": [("Vertical.Scrollbar.thumb", {"expand": "1", "sticky": "nswe"})]})],
    )
    style.configure("Thin.Vertical.TScrollbar", troughcolor=BG, background=BORDER, bordercolor=BG, lightcolor=BORDER, darkcolor=BORDER, arrowsize=6, width=6)
    style.map("Thin.Vertical.TScrollbar", background=[("active", DIM)])
    style.configure("Picker.TCombobox", arrowcolor=DIM, bordercolor=BG, lightcolor=BG, darkcolor=BG, background=BG, padding=0)
    style.map(
        "Picker.TCombobox",
        fieldbackground=[("readonly", BG)],
        foreground=[("readonly", TEXT)],
        selectbackground=[("readonly", BG)],
        selectforeground=[("readonly", TEXT)],
        arrowcolor=[("active", ACCENT)],
    )
    # The dropdown list is a plain Tk listbox.
    for option, value in (("background", BG), ("foreground", TEXT), ("selectBackground", ACCENT), ("selectForeground", ON_ACCENT), ("font", Fonts.normal)):
        root.option_add(f"*TCombobox*Listbox.{option}", value)
