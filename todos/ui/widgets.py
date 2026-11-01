"""Terminal-style building blocks: titled boxes, `[ button ]` labels, plain inputs, a scroll area, hints."""
from __future__ import annotations

import re
import textwrap
import tkinter as tk
from tkinter import ttk
from typing import Callable, List, Optional

from todos.core import is_local_date

from .theme import ACCENT, BG, BORDER, DIM, ERROR, ON_ACCENT, TEXT, Fonts


class Box(tk.Frame):
    """A bordered box with its title set into the top border, like a TUI box. Content goes in `body`."""

    def __init__(self, parent: tk.Misc, title: str = "", on_click: Optional[Callable[[], None]] = None):
        super().__init__(parent, bg=BG)
        half = Fonts.normal.metrics("linespace") // 2
        self.border = tk.Frame(self, bg=BORDER)
        self.border.pack(fill="both", expand=True, pady=(half, 0))
        inner = tk.Frame(self.border, bg=BG)
        inner.pack(fill="both", expand=True, padx=1, pady=1)
        self.body = tk.Frame(inner, bg=BG)
        self.body.pack(fill="both", expand=True, padx=8, pady=(half, 4))
        self.title = tk.Label(self, text=f" {title} " if title else "", bg=BG, fg=DIM, font=Fonts.normal, bd=0, padx=0, pady=0)
        if title:
            self.title.place(x=10, y=0)
        self.on_click = on_click
        for widget in (self.border, inner, self.body, self.title):
            widget.bind("<Button-1>", self._click)

    def _click(self, _event=None) -> None:
        if self.on_click:
            self.on_click()

    def set_title(self, title: str) -> None:
        self.title.configure(text=f" {title} ")
        self.title.place(x=10, y=0)

    def set_active(self, active: bool) -> None:
        self.border.configure(bg=ACCENT if active else BORDER)
        self.title.configure(fg=ACCENT if active else DIM)

    def clickable(self, *widgets: tk.Widget) -> None:
        """Lets clicks on these (non-input) children focus the box too."""
        for widget in widgets:
            widget.bind("<Button-1>", self._click, add="+")


class Button(tk.Label):
    """`[ label ]` that runs `command` on click. Clicks don't reach whatever is underneath."""

    def __init__(self, parent: tk.Misc, label: str, command: Callable[[], None], fg: str = DIM, bg: str = BG):
        super().__init__(parent, text=f"[ {label} ]", fg=fg, bg=bg, font=Fonts.normal, cursor="hand2", bd=0, padx=0, pady=0)
        self.command = command
        self.bind("<Button-1>", self._run)
        self.bind("<Enter>", lambda _e: self.configure(fg=ACCENT if self["bg"] != ACCENT else ON_ACCENT))
        self.bind("<Leave>", lambda _e: self.configure(fg=self.color))
        self.color = fg

    def _run(self, _event=None):
        self.command()
        return "break"

    def recolor(self, fg: str, bg: Optional[str] = None) -> None:
        self.color = fg
        self.configure(fg=fg, bg=bg or self["bg"])


def label(parent: tk.Misc, text: str = "", fg: str = TEXT, bold: bool = False, **options) -> tk.Label:
    return tk.Label(parent, text=text, fg=fg, bg=options.pop("bg", BG), font=Fonts.bold if bold else Fonts.normal, bd=0, padx=0, pady=0, anchor="w", justify="left", **options)


_INPUT = dict(
    bg=BG,
    fg=TEXT,
    insertbackground=ACCENT,
    selectbackground=ACCENT,
    selectforeground=ON_ACCENT,
    relief="flat",
    bd=0,
    highlightthickness=0,
)


class Entry(tk.Entry):
    """Single-line input with an optional dim placeholder shown while empty."""

    def __init__(self, parent: tk.Misc, value: str = "", placeholder: str = ""):
        self.var = tk.StringVar(parent, value)
        super().__init__(parent, textvariable=self.var, font=Fonts.normal, **_INPUT)
        self.placeholder = _Placeholder(self, placeholder, lambda: self.var.get() == "")
        self.var.trace_add("write", lambda *_: self.placeholder.refresh())

    @property
    def value(self) -> str:
        return self.var.get()

    def set(self, value: str) -> None:
        self.var.set(value)
        self.icursor("end")


class Text(tk.Text):
    """Multiline input (word wrapped) with an optional placeholder."""

    def __init__(self, parent: tk.Misc, value: str = "", height: int = 3, placeholder: str = ""):
        super().__init__(parent, height=height, width=1, wrap="word", undo=True, font=Fonts.normal, padx=0, pady=0, **_INPUT)
        self.insert("1.0", value)
        self.edit_reset()
        self.placeholder = _Placeholder(self, placeholder, lambda: self.value == "")
        self.bind("<<Modified>>", self._modified)
        self.edit_modified(False)

    def _modified(self, _event=None) -> None:
        self.placeholder.refresh()
        self.edit_modified(False)

    @property
    def value(self) -> str:
        return self.get("1.0", "end-1c")

    def set(self, value: str) -> None:
        self.delete("1.0", "end")
        self.insert("1.0", value)


class _Placeholder:
    def __init__(self, widget: tk.Widget, text: str, empty: Callable[[], bool]):
        self.widget = widget
        self.empty = empty
        self.label = tk.Label(widget, text=text, fg=DIM, bg=BG, font=Fonts.normal, bd=0, padx=0, pady=0, cursor="xterm") if text else None
        if self.label:
            self.label.bind("<Button-1>", lambda _e: (widget.focus_set(), "break")[1])
        self.refresh()

    def refresh(self) -> None:
        if not self.label:
            return
        if self.empty():
            self.label.place(x=0, y=0)
        else:
            self.label.place_forget()


DATE_DIGITS = 8


def _format_digits(digits: str) -> str:
    """`YYYY-MM-DD`, or as much of it as `digits` covers."""
    return "-".join(part for part in (digits[:4], digits[4:6], digits[6:]) if part)


def _index_after_digits(n: int) -> int:
    """Text index of the spot after `n` digits."""
    return n + (1 if n > 4 else 0) + (1 if n > 6 else 0)


def mask_date(text: str, cursor: int):
    """
    Forces `text` into `YYYY-MM-DD` shape: digits only, dashes inserted. Typing into a full date overwrites
    the digit after the cursor. Returns the new text and cursor.
    """
    digits = re.sub(r"\D", "", text)
    before = len(re.sub(r"\D", "", text[:cursor]))
    if len(digits) > DATE_DIGITS:
        digits = digits[:before] + digits[before + len(digits) - DATE_DIGITS :]
    digits = digits[:DATE_DIGITS]
    before = min(before, len(digits))
    return _format_digits(digits), _index_after_digits(before)


class DateEntry(Entry):
    """Single-line `YYYY-MM-DD` input that rejects anything else as it is typed. Incomplete or impossible dates show in red."""

    def __init__(self, parent: tk.Misc, value: str = ""):
        super().__init__(parent, value, placeholder="YYYY-MM-DD")
        self.configure(width=11)
        self._masking = False
        self.var.trace_add("write", self._mask)
        self._color()

    def _mask(self, *_):
        if self._masking:
            return
        text, cursor = mask_date(self.var.get(), self.index("insert"))
        if text != self.var.get():
            self._masking = True
            try:
                self.var.set(text)
            finally:
                self._masking = False
            # The insert cursor moves after the variable is written; put it right once that's done.
            self.after_idle(lambda: self.icursor(cursor))
            self.icursor(cursor)
        self._color()

    def _color(self) -> None:
        valid = self.value == "" or is_local_date(self.value)
        self.configure(fg=TEXT if valid else ERROR)


class ScrollFrame(tk.Frame):
    """Vertically scrolling area; put content in `inner`. The app routes mouse wheel events here."""

    def __init__(self, parent: tk.Misc):
        super().__init__(parent, bg=BG)
        self.canvas = tk.Canvas(self, bg=BG, highlightthickness=0, bd=0, yscrollincrement=1)
        self.scrollbar = ttk.Scrollbar(self, orient="vertical", command=self.canvas.yview, style="Thin.Vertical.TScrollbar")
        self.canvas.configure(yscrollcommand=self.scrollbar.set)
        self.scrollbar.pack(side="right", fill="y")
        self.canvas.pack(side="left", fill="both", expand=True)
        self.inner = tk.Frame(self.canvas, bg=BG)
        self._window = self.canvas.create_window(0, 0, window=self.inner, anchor="nw")
        self.canvas.bind("<Configure>", lambda e: self.canvas.itemconfigure(self._window, width=e.width))
        self.inner.bind("<Configure>", lambda _e: self.canvas.configure(scrollregion=(0, 0, self.inner.winfo_width(), self.inner.winfo_height())))

    def scroll(self, pixels: int) -> None:
        if self.inner.winfo_height() > self.canvas.winfo_height():
            self.canvas.yview_scroll(int(pixels), "units")

    def scroll_into_view(self, widget: tk.Widget) -> None:
        self.update_idletasks()
        total = self.inner.winfo_height()
        if total <= 1:
            return
        top = widget.winfo_rooty() - self.inner.winfo_rooty()
        bottom = top + widget.winfo_height()
        view_top = self.canvas.canvasy(0)
        view_height = self.canvas.winfo_height()
        if top < view_top:
            self.canvas.yview_moveto(top / total)
        elif bottom > view_top + view_height:
            self.canvas.yview_moveto(max(0, bottom - view_height) / total)

    def scroll_to_top(self) -> None:
        self.canvas.yview_moveto(0)


class Hints(tk.Label):
    """Footer key hints; wraps between hints, never inside one."""

    def __init__(self, parent: tk.Misc):
        super().__init__(parent, fg=DIM, bg=BG, font=Fonts.normal, anchor="w", justify="left", bd=0, padx=8, pady=2)
        self.bind("<Configure>", lambda e: self.configure(wraplength=max(100, e.width - 16)))

    def show(self, hints: List[str]) -> None:
        self.configure(text="   ".join(h.replace(" ", " ") for h in hints))


class StatusLine(tk.Label):
    """One line for an error (red) or a notice (accent)."""

    def __init__(self, parent: tk.Misc, before: tk.Widget):
        super().__init__(parent, bg=BG, font=Fonts.normal, anchor="w", justify="left", bd=0, padx=8, pady=0)
        # Packed just above `before` while there's something to show.
        self.before = before
        self.bind("<Configure>", lambda e: self.configure(wraplength=max(100, e.width - 16)))

    def show(self, error: Optional[str] = None, notice: Optional[str] = None) -> None:
        text, color = (error, ERROR) if error else (notice, ACCENT) if notice else ("", DIM)
        self.configure(text=text or "", fg=color)
        if text:
            self.pack(side="top", fill="x", before=self.before)
        else:
            self.pack_forget()


def wrap_lines(text: str, width_px: int) -> List[str]:
    """`text` word-wrapped to `width_px` in the app font, as display lines."""
    cols = max(10, width_px // Fonts.char_width())
    lines: List[str] = []
    for paragraph in text.split("\n"):
        lines.extend(textwrap.wrap(paragraph, cols, break_long_words=True, replace_whitespace=False) or [""])
    return lines


def one_line(text: str) -> str:
    """Newlines (and the space around them) become single spaces."""
    return re.sub(r"\s*\n\s*", " ", text)


def textbox_height(value: str) -> int:
    """Tall enough to show the whole value without scrolling, within reason."""
    return min(10, max(3, len(value.split("\n"))))
