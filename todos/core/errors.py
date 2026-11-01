class TodoError(Exception):
    """User-facing errors; adapters show these and let anything else crash."""

    @property
    def message(self) -> str:
        return str(self)
