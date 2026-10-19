"""Names and paths a request may use: one name (a team, a folder, a project)
and a '/'-separated path inside a team's folder. Both are refused rather than
cleaned when they could leave the data folder."""
import re


def safe_component(name: str) -> str:
    """One path component: no traversal, no separators, a conservative alphabet."""
    cleaned = str(name or "").strip()
    if not cleaned or cleaned in {".", ".."} or "/" in cleaned or "\\" in cleaned:
        raise ValueError("Invalid name")
    if not re.fullmatch(r"[A-Za-z0-9 _.-]{1,64}", cleaned):
        raise ValueError("Name may only contain letters, numbers, spaces, _.-")
    return cleaned


def safe_relpath(path: str) -> str:
    """A path relative to a team's folder, each segment checked by
    safe_component; '' is the team's root."""
    raw = str(path or "").strip().strip("/")
    if not raw:
        return ""
    return "/".join(safe_component(segment) for segment in raw.split("/") if segment)
