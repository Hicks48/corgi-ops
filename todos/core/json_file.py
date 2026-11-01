from __future__ import annotations

import json
import os
import time
from typing import Callable, Generic, TypeVar

from .errors import TodoError
from .validation import Invalid, Parser, validate

T = TypeVar("T")
R = TypeVar("R")

LOCK_STALE_S = 10.0
LOCK_RETRY_S = 0.025
LOCK_TIMEOUT_S = 5.0
# Task data is personal: owner-only access.
PRIVATE_DIR = 0o700
PRIVATE_FILE = 0o600


class JsonFile(Generic[T]):
    """One validated JSON file, written under a lockfile with atomic renames."""

    def __init__(self, dir: str, name: str, parser: Parser, empty: Callable[[], T]):
        self.dir = dir
        self.path = os.path.join(dir, name)
        self.lock = os.path.join(dir, f"{os.path.splitext(name)[0]}.lock")
        self.parser = parser
        self.empty = empty

    def read(self) -> T:
        os.makedirs(self.dir, mode=PRIVATE_DIR, exist_ok=True)
        try:
            with open(self.path, encoding="utf-8") as f:
                raw = f.read()
        except FileNotFoundError:
            return self.empty()
        try:
            return validate(self.parser, json.loads(raw))
        except Invalid as err:
            detail = err.pretty()
        except ValueError as err:
            detail = str(err)
        raise TodoError(f"{self.path} is corrupt or has an unsupported format:\n{detail}")

    def mutate(self, fn: Callable[[T], R]) -> R:
        os.makedirs(self.dir, mode=PRIVATE_DIR, exist_ok=True)
        self._acquire_lock()
        try:
            data = self.read()
            result = fn(data)
            # Never let a bug write a file that the next read would reject.
            try:
                validate(self.parser, data)
            except Invalid as err:
                raise TodoError(f"refusing to write invalid data:\n{err.pretty()}") from None
            # Atomic replace so readers never see a half-written file.
            tmp = f"{self.path}.{os.getpid()}.tmp"
            fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, PRIVATE_FILE)
            with os.fdopen(fd, "w", encoding="utf-8") as f:
                f.write(json.dumps(data, indent=2, ensure_ascii=False) + "\n")
            os.replace(tmp, self.path)
            return result
        finally:
            _remove(self.lock)

    def _acquire_lock(self) -> None:
        deadline = time.monotonic() + LOCK_TIMEOUT_S
        while True:
            try:
                os.close(os.open(self.lock, os.O_WRONLY | os.O_CREAT | os.O_EXCL, PRIVATE_FILE))
                return
            except FileExistsError:
                pass
            # A crashed writer leaves its lock behind; steal it once it is clearly stale.
            try:
                age = time.time() - os.stat(self.lock).st_mtime
            except FileNotFoundError:
                age = 0.0
            if age > LOCK_STALE_S:
                _remove(self.lock)
                continue
            if time.monotonic() > deadline:
                raise TodoError(f"timed out waiting for lock {self.lock}")
            time.sleep(LOCK_RETRY_S)


def _remove(path: str) -> None:
    try:
        os.remove(path)
    except FileNotFoundError:
        pass
