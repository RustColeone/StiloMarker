"""Nothing reaches outside a workspace's folder (v0.2.39), on the server.

A name that walks out of its folder (.., ., a slash) or reads as another name
is refused by every operation; a whole project pushed or imported with one is
refused; the folder store never writes, replays or deletes outside its
folder, nor writes over the server's own files under another spelling on
disk; images are uploaded only by someone who may edit, as images, at paths
a file may have, and only the workspace's own files are served; a folder
inside a project is never a project of its own."""
import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import importlib.util
spec = importlib.util.spec_from_file_location('mdnotes_server', Path(__file__).resolve().parents[1] / 'server/mdnotes_server.py')
server = importlib.util.module_from_spec(spec)
spec.loader.exec_module(server)
from stilo.modules.file_types import BUILTIN as FILE_TYPES  # noqa: E402
from stilo.modules.projects.adapters.team_folders import TeamFolders  # noqa: E402
from stilo.modules.sync import open_live  # noqa: E402
from stilo.modules.workspace import FolderStore, default_project, tree_problem  # noqa: E402


def tree(*nodes):
    """A project: (id, kind, name, parent id) per node under the root."""
    project = default_project()
    root = project["rootId"]
    project["nodes"][root]["children"] = []
    for node_id, kind, name, parent in nodes:
        parent = parent or root
        node = {"id": node_id, "kind": kind, "name": name, "parentId": parent}
        if kind == "folder":
            node["children"] = []
        else:
            node["content"] = "x"
        project["nodes"][node_id] = node
        project["nodes"][parent].setdefault("children", []).append(node_id)
    return project


class PathSafety(unittest.TestCase):
    def setUp(self):
        logs = patch.object(server, "_log")
        logs.start()
        self.addCleanup(logs.stop)
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.base = Path(self.tmp.name)
        self.folder = self.base / "team" / "notes"
        self.sibling = self.base / "team" / "notes2"   # its name starts like the workspace's
        self.sibling.mkdir(parents=True)
        (self.sibling / "keep.md").write_text("sibling")
        self.broker = open_live("2468", folder=self.folder)
        self.token = self.broker.connect("2468", "Tester")["token"]

    def outside(self):
        """Every file outside the workspace's folder (the sibling's, and anything new)."""
        return sorted(str(p.relative_to(self.base)) for p in self.base.rglob("*") if p.is_file() and self.folder not in p.parents)

    def op(self, operation):
        return self.broker.apply_operation(self.token, operation)

    def test_names_that_walk_out_are_refused(self):
        before = self.outside()
        for operation in ({"type": "create-folder", "parentPath": "", "name": ".."},
                          {"type": "create-folder", "parentPath": "", "name": "."},
                          {"type": "create-file", "parentPath": "", "name": "../notes2/keep.md", "content": "gone"},
                          {"type": "create-file", "parentPath": "", "name": "./access.json", "content": "{}"},
                          {"type": "create-file", "parentPath": "", "name": "a\\\\b.md", "content": ""},
                          {"type": "create-folder", "parentPath": "", "name": "trailing."}):
            with self.assertRaises(ValueError, msg=operation["name"]):
                self.op(operation)
        self.op({"type": "create-folder", "parentPath": "", "name": "sub"})
        with self.assertRaises(ValueError):
            self.op({"type": "rename-node", "path": "sub", "name": ".."})
        self.assertEqual(self.outside(), before)
        self.assertEqual((self.sibling / "keep.md").read_text(), "sibling")

    def test_a_whole_project_that_walks_out_is_refused(self):
        bad = tree(("up", "folder", "..", None), ("f", "file", "evil.md", "up"))
        self.assertRegex(tree_problem(bad, FILE_TYPES), "cannot be a file or folder name")
        with self.assertRaisesRegex(ValueError, "cannot be a file or folder name"):
            self.broker.set_state(self.token, bad, self.broker.revision)
        stray = tree(("f", "file", "notes.md", None))
        stray["nodes"]["g"] = {"id": "g", "kind": "file", "name": "comments.json", "parentId": stray["rootId"], "content": "{}"}
        self.assertRegex(tree_problem(stray, FILE_TYPES), "not in the folder it names")
        self.assertRegex(tree_problem(tree(("a", "file", "Chat.JSON", None)), FILE_TYPES), "kept for the app's own file")
        self.assertIsNone(tree_problem(tree(("d", "folder", "data", None), ("m", "file", "manifest.json", "d")), FILE_TYPES))
        self.assertEqual(self.outside(), ["team/notes2/keep.md"])

    def test_the_folder_store_never_writes_replays_or_deletes_outside(self):
        store = FolderStore(self.folder)
        bad = tree(("up", "folder", "..", None), ("f", "file", "notes2.md", "up"))
        with self.assertRaisesRegex(ValueError, "leaves the workspace's folder"):
            store.save(bad, 5, None)
        self.assertFalse((self.base / "team" / "notes2.md").exists())
        # An interrupted save from before the checks, replayed: what is outside is skipped.
        journal = {"project": bad, "revision": 6, "previousProject": default_project()}
        (self.folder / ".pending-state.json").write_text(json.dumps(journal))
        FolderStore(self.folder).load()
        self.assertFalse((self.base / "team" / "notes2.md").exists())
        # A tree that once held such a folder, now without it: nothing outside is deleted.
        store.finish_commit({"project": default_project(), "revision": 7, "previousProject": tree(("up", "folder", "..", None))})
        self.assertEqual((self.sibling / "keep.md").read_text(), "sibling")
        self.assertTrue(self.folder.exists())

    def test_the_servers_own_files_under_another_spelling_on_disk(self):
        self.op({"type": "create-file", "parentPath": "", "name": "notes.md", "content": "hello"})
        manifest = self.folder / "manifest.json"
        self.assertTrue(manifest.exists())
        os.link(manifest, self.folder / "alias.json")  # what a disk that ignores case makes of another spelling
        with self.assertRaisesRegex(ValueError, "one of the app's own files"):
            FolderStore(self.folder).save(tree(("a", "file", "alias.json", None)), 9, None)

    def test_images_are_uploaded_by_editors_as_images_inside_the_folder(self):
        self.assertEqual(self.broker.write_asset_chunk(self.token, "pics/a.png", 0, b"png"), 3)
        self.assertEqual((self.folder / "pics" / "a.png").read_bytes(), b"png")
        for path in ("access.json", "../notes2/x.png", "pics/../../notes2/x.png", "./x.png", "conversations.sqlite"):
            with self.assertRaises(PermissionError, msg=path):
                self.broker.write_asset_chunk(self.token, path, 0, b"x")
        reader = self.broker.connect("2468", "Reader")["token"]
        self.broker.sessions.roles[reader] = "reader"
        with self.assertRaisesRegex(PermissionError, "read-only"):
            self.broker.write_asset_chunk(reader, "pics/b.png", 0, b"x")
        self.assertEqual(self.outside(), ["team/notes2/keep.md"])

    def test_only_the_workspaces_own_files_are_served(self):
        self.op({"type": "create-file", "parentPath": "", "name": "notes.md", "content": "hello"})
        self.assertIsNotNone(self.broker.resolve_asset("notes.md"))
        for path in ("manifest.json", "../notes2/keep.md", "missing.png"):
            self.assertIsNone(self.broker.resolve_asset(path), path)

    def test_a_folder_inside_a_project_is_never_a_project(self):
        folders = TeamFolders(self.base)
        project = self.base / "team_red" / "P"
        (project / "sub").mkdir(parents=True)
        (project / "manifest.json").write_text("{}")
        (project / "sub" / "manifest.json").write_text("{}")
        self.assertTrue(folders.is_project(project))
        self.assertFalse(folders.is_project(project / "sub"))


if __name__ == "__main__":
    unittest.main()
