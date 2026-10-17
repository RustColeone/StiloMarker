"""Who may open a project and what they may do there. Pure rules: the access
record is read and written by adapters/access_file.py.

An access record is {whitelist, blacklist, readers, createdBy}. Empty lists
mean everyone in the team.
"""

ROLES = ("master", "editor", "reader")

# What each role may do. master: the project's creator, who may also replace
# the whole tree (publish). reader: listed in readers; opens and reads only.
# editor: anyone else with access.
ACTIONS = {
    "open": {"master", "editor", "reader"},
    "edit": {"master", "editor"},
    "replace": {"master"},
}


def _names(values) -> list[str]:
    return [str(value).strip() for value in (values or []) if str(value).strip()]


def clean_access(data: dict | None) -> dict:
    data = data if isinstance(data, dict) else {}
    return {"whitelist": _names(data.get("whitelist")), "blacklist": _names(data.get("blacklist")),
            "readers": _names(data.get("readers")), "createdBy": data.get("createdBy")}


def from_legacy_members(meta: dict) -> dict:
    """The access record for a project from before access files: its members list."""
    return clean_access({"whitelist": meta.get("members", []), "createdBy": meta.get("createdBy")})


def may_open(access: dict, username: str, teams, team: str) -> bool:
    """In the team, AND (whitelist empty OR listed) AND not blacklisted."""
    if team not in teams or username in access["blacklist"]:
        return False
    return not access["whitelist"] or username in access["whitelist"]


def role_of(access: dict, username: str) -> str:
    if access.get("createdBy") and username == access["createdBy"]:
        return "master"
    if username in (access.get("readers") or []):
        return "reader"
    return "editor"


def can(role: str, action: str) -> bool:
    if action not in ACTIONS:
        raise ValueError(f"Unknown action {action!r}")
    return role in ACTIONS[action]


def owned_by_other(access: dict, username: str) -> bool:
    owner = access.get("createdBy")
    return bool(owner) and owner != username


def require_owner(access: dict, username: str, opens: bool, refusal: str) -> None:
    """Only the recorded owner may manage a project (change who may open it,
    delete it). With no owner recorded, anyone who may open it may."""
    if owned_by_other(access, username):
        raise PermissionError(refusal)
    if not access.get("createdBy") and not opens:
        raise PermissionError("You do not have access to that project")


def owner_record(username: str) -> dict:
    """The access record of a project someone just made: theirs, open to the team."""
    return clean_access({"createdBy": username})


def changed_access(current: dict, username: str, opens: bool, whitelist, blacklist, readers=None) -> dict:
    """The record after `username` sets the lists; with no owner yet, they
    become the owner. readers=None keeps the current readers."""
    require_owner(current, username, opens, "Only the project owner can change access")
    return {"whitelist": _names(whitelist), "blacklist": _names(blacklist),
            "readers": _names(readers) if readers is not None else list(current.get("readers", [])),
            "createdBy": current.get("createdBy") or username}
