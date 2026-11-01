"""Small validation toolkit (stands in for a schema library): parsers check a value, normalize it
(trim, defaults) and record problems as issues instead of raising on the first one."""
from __future__ import annotations

from typing import Any, Callable, List, Optional, Sequence, Tuple, TypeVar, Union

from .errors import TodoError

T = TypeVar("T")
Path = Tuple[Union[str, int], ...]


class Invalid(Exception):
    def __init__(self, issues: List[Tuple[Path, str]]):
        super().__init__("; ".join(message for _, message in issues))
        self.issues = issues

    def pretty(self) -> str:
        lines = []
        for path, message in self.issues:
            lines.append(f"✖ {message}")
            if path:
                lines.append("  → at " + ".".join(str(part) for part in path))
        return "\n".join(lines)


class Issues:
    def __init__(self) -> None:
        self.items: List[Tuple[Path, str]] = []

    def add(self, path: Path, message: str) -> None:
        self.items.append((path, message))

    def check(self) -> None:
        if self.items:
            raise Invalid(self.items)


Parser = Callable[[Any, Path, Issues], T]


def parse(parser: Parser, value: Any) -> Any:
    """Runs `parser`, turning issues into one TodoError (messages joined by `; `)."""
    issues = Issues()
    result = parser(value, (), issues)
    try:
        issues.check()
    except Invalid as err:
        raise TodoError(str(err)) from None
    return result


def validate(parser: Parser, value: Any) -> Any:
    """Runs `parser`, raising `Invalid` with every issue found."""
    issues = Issues()
    result = parser(value, (), issues)
    issues.check()
    return result


def _label(path: Path) -> str:
    return str(path[-1]) if path else "value"


def string(value: Any, path: Path, issues: Issues, *, trim: bool = False) -> Optional[str]:
    if not isinstance(value, str):
        issues.add(path, f"{_label(path)} {'is required' if value is None else 'must be a string'}")
        return None
    return value.strip() if trim else value


def required_text(message: str) -> Parser:
    """Trimmed, non-empty string."""

    def parser(value: Any, path: Path, issues: Issues) -> Optional[str]:
        text = string(value, path, issues, trim=True)
        if text == "":
            issues.add(path, message)
        return text

    return parser


def boolean(value: Any, path: Path, issues: Issues) -> Optional[bool]:
    if not isinstance(value, bool):
        issues.add(path, f"{_label(path)} must be true or false")
        return None
    return value


def one_of(choices: Sequence[str], what: str) -> Parser:
    def parser(value: Any, path: Path, issues: Issues) -> Optional[str]:
        if value not in choices:
            issues.add(path, f"invalid {what}: {value} (expected {', '.join(choices)})")
            return None
        return value

    return parser


def matching(check: Callable[[str], bool], message: str, *, trim: bool = False) -> Parser:
    """A string that passes `check`."""

    def parser(value: Any, path: Path, issues: Issues) -> Optional[str]:
        text = string(value, path, issues, trim=trim)
        if text is not None and not check(text):
            issues.add(path, message)
        return text

    return parser


def or_empty(parser: Parser) -> Parser:
    def wrapped(value: Any, path: Path, issues: Issues) -> Any:
        return "" if value == "" else parser(value, path, issues)

    return wrapped


def list_of(item: Parser) -> Parser:
    def parser(value: Any, path: Path, issues: Issues) -> Optional[list]:
        if not isinstance(value, list):
            issues.add(path, f"{_label(path)} must be a list")
            return None
        return [item(entry, path + (index,), issues) for index, entry in enumerate(value)]

    return parser


def record(value: Any, path: Path, issues: Issues) -> Optional[dict]:
    if not isinstance(value, dict):
        issues.add(path, f"{_label(path)} must be an object")
        return None
    return value


def field(obj: dict, key: str, parser: Parser, path: Path, issues: Issues, out: dict, *, optional: bool = False, default: Any = None) -> None:
    """Parses `obj[key]` into `out[key]`. Missing optional keys stay missing unless there's a `default`."""
    if key not in obj or obj[key] is None:
        if default is not None:
            out[key] = default
        elif not optional:
            parser(None, path + (key,), issues)
        return
    out[key] = parser(obj[key], path + (key,), issues)
