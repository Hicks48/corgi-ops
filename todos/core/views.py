from __future__ import annotations

from typing import List

from .dates import LocalDate
from .schema import Task

VIEWS = ("completed", "current", "upcoming")

VIEW_LABELS = {
    "completed": "Completed Tasks",
    "current": "Current Tasks",
    "upcoming": "Upcoming Tasks",
}


def tasks_in_view(tasks: List[Task], view: str, today: LocalDate) -> List[Task]:
    """Tasks belonging to `view` on `today`, in display order. Ties keep file (creation) order."""
    if view == "current":
        current = [t for t in tasks if t["status"] != "done" and t["targetDate"] <= today]
        return sorted(current, key=lambda t: (t["status"] != "in-progress", t["targetDate"]))
    if view == "upcoming":
        upcoming = [t for t in tasks if t["status"] != "done" and t["targetDate"] > today]
        return sorted(upcoming, key=lambda t: (t["targetDate"], t["status"] != "in-progress"))
    if view == "completed":
        done = [t for t in tasks if t["status"] == "done"]
        # reverse keeps ties in their original order.
        return sorted(done, key=lambda t: (t.get("completionDate", ""), t["updatedAt"]), reverse=True)
    raise ValueError(f"unknown view: {view}")
