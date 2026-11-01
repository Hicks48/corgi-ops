"""Minimal option parser (like node:util parseArgs): `--name value`, `--name=value`, boolean flags and
positionals in any order. argparse is avoided because it reorders, abbreviates and prints its own help."""
from typing import Dict, List, Optional, Tuple, Union


class ArgsError(Exception):
    pass


def parse_args(argv: List[str], strings: List[str], flags: Dict[str, Optional[str]]) -> Tuple[Dict[str, Union[str, bool]], List[str]]:
    """`strings`: options taking a value. `flags`: boolean options, mapped to their short alias (or None).
    Returns (values, positionals); options not given are missing from values, flags default to False."""
    values: Dict[str, Union[str, bool]] = {name: False for name in flags}
    shorts = {short: name for name, short in flags.items() if short}
    positionals: List[str] = []
    args = iter(argv)
    for arg in args:
        if arg == "--":
            positionals.extend(args)
            break
        if arg.startswith("--"):
            name, eq, inline = arg[2:].partition("=")
            if name in flags:
                if eq:
                    raise ArgsError(f"option '--{name}' does not take an argument")
                values[name] = True
            elif name in strings:
                if eq:
                    values[name] = inline
                    continue
                value = next(args, None)
                if value is None:
                    raise ArgsError(f"option '--{name} <value>' argument missing")
                if value.startswith("-") and value != "-":
                    raise ArgsError(
                        f"option '--{name}' argument is ambiguous; to give a value starting with a dash use '--{name}=<value>'"
                    )
                values[name] = value
            else:
                raise ArgsError(f"unknown option '--{name}'")
        elif arg.startswith("-") and arg != "-":
            for short in arg[1:]:
                if short not in shorts:
                    raise ArgsError(f"unknown option '-{short}'")
                values[shorts[short]] = True
        else:
            positionals.append(arg)
    return values, positionals
