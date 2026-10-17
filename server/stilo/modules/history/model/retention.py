"""What History keeps: the file key of a snapshot, which snapshots go when the
store is over budget, whether a backup is worth taking, and which backups a
retention policy keeps. Pure."""
import calendar
import time

# Backups: every active day for two weeks, then the last active day of each
# week, then of each month; safety and manual copies for two weeks.
POLICY = {"daily_days": 14, "weekly": 8, "monthly": 6, "safety_days": 14, "max_safety": 60, "burst_seconds": 60}


def over_budget(versions_by_file: dict, keep_id=None):
    """Snapshot versions in the order they go when the store is over budget:
    oldest first, across every file, never `keep_id`. Yields (file, version)."""
    pool = sorted(((v.get("createdAt", 0), key, v) for key, vs in versions_by_file.items() for v in vs), key=lambda item: item[0])
    for _, key, version in pool:
        if version["id"] != keep_id:
            yield key, version


def skip_backup(latest: dict | None, kind: str, revision: int, stamp_ms: int, policy=POLICY) -> bool:
    """Nothing changed since the latest backup (a daily or safety copy would add
    nothing), or a burst of destructive changes already has its copy."""
    if latest and latest.get("revision") == revision and kind in ("daily", "safety"):
        return True
    return bool(kind == "safety" and latest and latest.get("kind") in ("safety", "manual")
                and stamp_ms - latest.get("createdAt", 0) < policy["burst_seconds"] * 1000)


def backups_to_drop(backups: list, now_ms: int, policy=POLICY) -> list:
    """The backups a retention policy no longer keeps."""
    day_number = lambda day: calendar.timegm(time.strptime(day, "%Y-%m-%d")) // 86400  # UTC, DST-proof
    today = int(now_ms / 1000) // 86400
    keep = set()
    dailies = sorted((b for b in backups if b.get("kind") == "daily"), key=lambda b: b.get("createdAt", 0), reverse=True)
    weeks, months = {}, {}
    for b in dailies:
        if today - day_number(b["day"]) < policy["daily_days"]:
            keep.add(b["id"])
        weeks.setdefault(time.strftime("%G-%V", time.strptime(b["day"], "%Y-%m-%d")), b)  # newest of each ISO week
        months.setdefault(b["day"][:7], b)                                                 # newest of each month
    for key in sorted(weeks, reverse=True)[:policy["weekly"]]:
        keep.add(weeks[key]["id"])
    for key in sorted(months, reverse=True)[:policy["monthly"]]:
        keep.add(months[key]["id"])
    others = sorted((b for b in backups if b.get("kind") != "daily"), key=lambda b: b.get("createdAt", 0), reverse=True)
    for position, b in enumerate(others):
        if now_ms - b.get("createdAt", 0) < policy["safety_days"] * 86400 * 1000 and position < policy["max_safety"]:
            keep.add(b["id"])
    return [b for b in backups if b["id"] not in keep]


def backup_summary(backup: dict) -> dict:
    return {key: backup.get(key) for key in ("id", "createdAt", "day", "kind", "label", "revision", "size")} | {
        "fileCount": len(backup.get("files", [])), "folderCount": len(backup.get("folders", []))}
