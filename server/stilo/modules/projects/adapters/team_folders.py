"""Where the teams' projects are on disk: data/team_<team>/ holds folders at
any depth, and a folder with a manifest.json is a project. The team's
index.json lists the flat workspaces from before folders (workspaces/<name>)
and who could open them; user-state.json in a project keeps each account's
open files there."""
import json
import time
from pathlib import Path

from stilo.modules.workspace import MANIFEST
from ..model.paths import safe_component

INDEX_FILE = "index.json"
USER_STATE_FILE = "user-state.json"
GROUP_IDS = ("left", "right")
TAB_VIEWS = ("source", "preview")


def _clean_tab(tab):
    """A tab as kept: a path shown one way, or None."""
    if isinstance(tab, dict) and isinstance(tab.get("path"), str) and tab.get("view") in TAB_VIEWS:
        return {"path": tab["path"], "view": tab["view"]}
    return None


def _clean_groups(groups) -> list:
    """The editor's groups as kept: at most the two, each with its tabs
    (at most 200) and the one it shows; anything else is dropped."""
    if not isinstance(groups, list):
        return []
    cleaned = []
    for group in groups[:len(GROUP_IDS)]:
        if not isinstance(group, dict) or group.get("id") not in GROUP_IDS or any(g["id"] == group["id"] for g in cleaned):
            continue
        tabs = group.get("tabs") if isinstance(group.get("tabs"), list) else []
        kept = [tab for tab in (_clean_tab(t) for t in tabs) if tab][:200]
        cleaned.append({"id": group["id"], "tabs": kept, "active": _clean_tab(group.get("active"))})
    return cleaned


class TeamFolders:
    def __init__(self, data_dir: Path | None):
        self.data_dir = data_dir

    def workspaces_dir(self, team: str) -> Path:
        """data/team_<team>/workspaces: where the flat workspaces from before folders are."""
        if self.data_dir is None:
            raise PermissionError("Cloud storage is not enabled on this server")
        return self.data_dir / f"team_{safe_component(team)}" / "workspaces"

    def team_root(self, team: str) -> Path:
        return self.workspaces_dir(team).parent

    def under_team(self, team: str, relpath: str) -> Path:
        """relpath under the team's root, checked again after resolving (defence in depth)."""
        base = self.team_root(team).resolve()
        candidate = (base / relpath).resolve() if relpath else base
        if candidate != base and base not in candidate.parents:
            raise PermissionError("Path escapes team directory")
        return candidate

    def is_project(self, directory: Path) -> bool:
        """A folder with a manifest, not itself inside a project: a project's
        folders are its files' folders (one holding a manifest.json of a
        user's is never opened as a project of its own)."""
        directory = Path(directory)
        if not (directory / MANIFEST).is_file():
            return False
        root = self.data_dir.resolve() if self.data_dir is not None else None
        for parent in directory.resolve().parents:
            if root is None or parent == root or root not in parent.parents:
                break
            if (parent / MANIFEST).is_file():
                return False
        return True

    @staticmethod
    def modified(path: Path):
        """Last-modified time (epoch seconds), or None if unavailable."""
        try:
            return path.stat().st_mtime
        except OSError:
            return None

    # ---- the team's index of flat workspaces (from before folders) -----------
    def read_index(self, team: str) -> dict:
        path = self.team_root(team) / INDEX_FILE
        if not path.exists():
            return {"workspaces": {}}
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            return {"workspaces": {}}
        if not isinstance(data.get("workspaces"), dict):
            data["workspaces"] = {}
        return data

    def write_index(self, team: str, index: dict) -> None:
        path = self.team_root(team) / INDEX_FILE
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(index, indent=2), encoding="utf-8")

    # ---- each account's open files in a project --------------------------------
    @staticmethod
    def _read_user_states(project_dir: Path) -> dict:
        path = project_dir / USER_STATE_FILE
        if not path.exists():
            return {}
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            return {}
        return data if isinstance(data, dict) else {}

    def read_user_state(self, project_dir: Path, username: str) -> dict:
        entry = self._read_user_states(project_dir).get(username)
        if not isinstance(entry, dict):
            return {"openFiles": [], "activeFile": None, "groups": []}
        open_files = [str(p) for p in entry.get("openFiles", []) if isinstance(p, str)]
        active = entry.get("activeFile")
        return {"openFiles": open_files, "activeFile": active if isinstance(active, str) else None,
                "groups": _clean_groups(entry.get("groups"))}

    def write_user_state(self, project_dir: Path, username: str, open_files, active_file, groups=None) -> None:
        data = self._read_user_states(project_dir)
        # Capped, so a runaway client can't bloat the file.
        cleaned = [str(p) for p in (open_files or []) if isinstance(p, str)][:200]
        data[username] = {"openFiles": cleaned, "activeFile": active_file if isinstance(active_file, str) else None,
                          "groups": _clean_groups(groups), "updatedAt": time.time()}
        (project_dir / USER_STATE_FILE).write_text(json.dumps(data, indent=2), encoding="utf-8")
