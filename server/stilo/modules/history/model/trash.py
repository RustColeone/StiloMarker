"""The trash's rules: how long a deleted project is kept, which entries have
expired, and the name a restored project takes when its old place is taken.
Pure."""

DAY_MS = 86400 * 1000
TRASH_DAYS = 30   # the longest a deleted project is kept; a server may keep it less


def keep_days(requested) -> int:
    """The server's setting, as a whole number of days from 1 to TRASH_DAYS."""
    try:
        days = int(requested)
    except (TypeError, ValueError):
        return TRASH_DAYS
    return max(1, min(TRASH_DAYS, days))


def expires_at(entry: dict, days: int) -> int:
    return int(entry.get("deletedAt", 0)) + days * DAY_MS


def expired(entries: list, now_ms: int, days: int) -> list:
    return [entry for entry in entries if expires_at(entry, days) <= now_ms]


def free_name(name: str, taken) -> str:
    """`name`, or "name (restored)", "name (restored 2)"... the first that
    `taken(candidate)` says is free."""
    candidate, counter = name, 1
    while taken(candidate):
        candidate = f"{name} (restored)" if counter == 1 else f"{name} (restored {counter})"
        counter += 1
    return candidate
