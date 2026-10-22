"""Changing the accounts: the rules the admin page and server/accounts.py
share. Pure: the accounts (username -> {"password", "teams", "admin"}) in,
new accounts out; a change that may not happen raises ValueError, with
the reason. There is always an admin once there is one: the last admin can be
neither removed nor made an ordinary account."""
from .passwords import hash_password, is_hashed, password_problem

MAX_NAME = 64


def _name(value: str, what: str) -> str:
    name = str(value or "").strip()
    if not name or len(name) > MAX_NAME or name in (".", "..") or any(c in name for c in '/\\') or any(ord(c) < 32 for c in name):
        raise ValueError(f"That is not a usable {what} name.")
    return name


def _teams(values) -> list[str]:
    teams = []
    for value in values or []:
        team = _name(value, "team")
        if team not in teams:
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
    name = _name(username, "user")
    if any(existing.lower() == name.lower() for existing in users):
        raise ValueError(f"There is already an account {name!r}.")
    problem = password_problem(password)
    if problem:
        raise ValueError(problem)
    out = _copy(users)
    out[name] = {"password": hash_password(password), "teams": _teams(teams), "admin": bool(admin)}
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
    out[username]["teams"] = _teams(teams)
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
