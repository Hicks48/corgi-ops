import json
import re
from typing import Any

# Task text can come from agents; control characters (ANSI/OSC escapes etc.) could take over the terminal.
_CONTROL_CHARS = re.compile("[\u0000-\u0008\u000b-\u001f\u007f-\u009f]")
_DEL_AND_C1 = re.compile("[\u007f-\u009f]")


def terminal_safe(text: str) -> str:
    """Drops control characters except newline and tab."""
    return _CONTROL_CHARS.sub("", text)


def terminal_safe_json(value: Any) -> str:
    """json.dumps escapes C0 but not DEL / C1; escape those too (they only occur inside strings)."""
    text = json.dumps(value, indent=2, ensure_ascii=False)
    return _DEL_AND_C1.sub(lambda m: f"\\u{ord(m.group(0)):04x}", text)
