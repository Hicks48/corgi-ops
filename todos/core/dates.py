"""Calendar dates are plain `YYYY-MM-DD` strings in the user's local time zone; timestamps are ISO strings."""
import re
from datetime import date, datetime, timedelta, timezone

LocalDate = str

_DATE = re.compile(r"^(\d{4})-(\d{2})-(\d{2})$")
_TIME = r"(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d+)?)?"
_DATETIME = re.compile(rf"^\d{{4}}-\d{{2}}-\d{{2}}T{_TIME}Z$")
_DATETIME_OFFSET = re.compile(rf"^\d{{4}}-\d{{2}}-\d{{2}}T{_TIME}(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$")


def _local(moment: datetime) -> datetime:
    """Naive datetimes are local time already; aware ones are converted to it."""
    return moment.astimezone() if moment.tzinfo else moment


def to_local_date(moment: datetime) -> LocalDate:
    local = _local(moment)
    return f"{local.year:04d}-{local.month:02d}-{local.day:02d}"


def add_days(day: LocalDate, days: int) -> LocalDate:
    return (date.fromisoformat(day) + timedelta(days=days)).isoformat()


def to_iso(moment: datetime) -> str:
    """UTC ISO timestamp with milliseconds, e.g. `2026-10-03T09:00:00.000Z`."""
    utc = moment.astimezone(timezone.utc)
    return utc.strftime("%Y-%m-%dT%H:%M:%S.") + f"{utc.microsecond // 1000:03d}Z"


def parse_iso(text: str) -> datetime:
    """Parses an ISO timestamp as written by `to_iso` (or any `is_iso_datetime` value)."""
    head, sep, rest = text.partition(".")
    if sep:
        # fromisoformat (3.9) only takes 3 or 6 fraction digits and no `Z`.
        digits = re.match(r"\d*", rest).group(0)
        text = f"{head}.{(digits + '000000')[:6]}{rest[len(digits):]}"
    if text.endswith("Z"):
        text = text[:-1] + "+00:00"
    return datetime.fromisoformat(text)


def format_local_date_time(iso: str) -> str:
    """ISO timestamp as local `YYYY-MM-DD HH:MM`."""
    local = parse_iso(iso).astimezone()
    return f"{to_local_date(local)} {local.hour:02d}:{local.minute:02d}"


def is_local_date(text: str) -> bool:
    """True for a real calendar date written as `YYYY-MM-DD`."""
    match = _DATE.match(text)
    if not match:
        return False
    try:
        date(*(int(part) for part in match.groups()))
    except ValueError:
        return False
    return True


def is_iso_datetime(text: str, offset: bool = False) -> bool:
    """ISO 8601 date-time in UTC (`Z`), or with any offset when `offset`."""
    pattern = _DATETIME_OFFSET if offset else _DATETIME
    return bool(pattern.match(text)) and is_local_date(text[:10])
