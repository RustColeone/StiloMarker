"""Changing the accounts: the rules the admin page and server/accounts.py
share. Pure: the accounts (username -> {"password", "teams", "admin"}) in,
new accounts out; a change that may not happen raises ValueError, with
the reason. There is always an admin once there is one: the last admin can be
neither removed nor made an ordinary account."""
import re
import unicodedata

from .passwords import hash_password, is_hashed, password_problem

MAX_NAME = 64
# A team's projects are kept in a folder named after it, so a team name is one
# Projects can name a folder (projects/model/paths.py safe_component; a test
# checks they agree).
TEAM_NAME = re.compile(r"[A-Za-z0-9 _.-]{1,64}")


def fold(name: str) -> str:
    """A name as another that differs only in case or Unicode form reads it."""
    return unicodedata.normalize("NFKC", name).casefold()


def _name(value: str) -> str:
    """An account name: what is typed to sign in and shown to others, so
    nothing invisible or that reads as another name (no control or format
    characters, which take in zero-width and right-to-left marks, and only
    in the form NFKC gives it)."""
    name = str(value or "").strip()
    if (not name or len(name) > MAX_NAME or name in (".", "..") or any(c in name for c in "/\\")
            or any(unicodedata.category(c).startswith("C") for c in name) or unicodedata.normalize("NFKC", name) != name):
        raise ValueError("That is not a usable user name: letters, numbers and plain punctuation, up to 64.")
    return name


def _teams(values, users: dict) -> list[str]:
    """Team names as given, each spelled as the accounts already spell it
    ("Red" joins "red"), so one team never becomes two folders."""
    known = {team.casefold(): team for user in users.values() for team in user["teams"]}
    teams = []
    for value in values or []:
        team = str(value or "").strip()
        if not TEAM_NAME.fullmatch(team) or team in (".", ".."):
            raise ValueError("That is not a usable team name: letters, numbers, spaces and _.- only, up to 64.")
        team = known.get(team.casefold(), team)
        if team.casefold() not in (t.casefold() for t in teams):
            teams.append(team)
    return teams


def _copy(users: dict) -> dict:
    return {name: {**user, "teams": list(user["teams"])} for name, user in users.items()}


def _existing(users: dict, username: str) -> str:
    if username not in users:
        raise ValueError(f"There is no account {username!r}.")
    return username


def _keep_an_admin(users: dict, username: str) -> None:
    others = [name for name, user in users.items() if user.get("admin") and name != username]
    if users[username].get("admin") and not others:
        raise ValueError(f"{username} is the last admin: make someone else an admin first.")


def listing(users: dict) -> list[dict]:
    """The accounts as the admin page shows them (never a password)."""
    return [{"username": name, "teams": list(user["teams"]), "admin": bool(user.get("admin")), "hashed": is_hashed(user["password"])}
            for name, user in sorted(users.items(), key=lambda item: item[0].lower())]


def convert(users: dict, admin: str) -> tuple[dict, int]:
    """Every password kept as typed hashed, and `admin` an admin: (accounts, how many hashed)."""
    _existing(users, admin)
    out = _copy(users)
    hashed = 0
    for user in out.values():
        if user["password"] and not is_hashed(user["password"]):
            user["password"] = hash_password(user["password"])
            hashed += 1
    out[admin]["admin"] = True
    return out, hashed


def add_account(users: dict, username: str, password: str, teams=(), admin: bool = False) -> dict:
    name = _name(username)
    if any(fold(existing) == fold(name) for existing in users):
        raise ValueError(f"There is already an account {name!r}.")
    problem = password_problem(password)
    if problem:
        raise ValueError(problem)
    out = _copy(users)
    out[name] = {"password": hash_password(password), "teams": _teams(teams, users), "admin": bool(admin)}
    return out


def set_password(users: dict, username: str, password: str) -> dict:
    _existing(users, username)
    problem = password_problem(password)
    if problem:
        raise ValueError(problem)
    out = _copy(users)
    out[username]["password"] = hash_password(password)
    return out


def set_teams(users: dict, username: str, teams) -> dict:
    _existing(users, username)
    out = _copy(users)
    out[username]["teams"] = _teams(teams, {name: user for name, user in users.items() if name != username})
    return out


def set_admin(users: dict, username: str, admin: bool) -> dict:
    _existing(users, username)
    if not admin:
        _keep_an_admin(users, username)
    out = _copy(users)
    out[username]["admin"] = bool(admin)
    return out


def remove_account(users: dict, username: str) -> dict:
    _existing(users, username)
    _keep_an_admin(users, username)
    out = _copy(users)
    del out[username]
    return out
