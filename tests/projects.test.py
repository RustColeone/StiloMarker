"""Projects (server): safe names and paths, the teams' folders as the file
browser lists them, each account's open files, who may open a project, the
flat workspaces from before folders, and the module's routes over HTTP."""
import json, socket, sys, tempfile, threading, unittest, urllib.error, urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "server"))
import mdnotes_server as server  # noqa: E402
from stilo.modules.identity import AccountStore, open_identity  # noqa: E402
from stilo.modules.projects import open_projects, safe_component, safe_relpath  # noqa: E402
from stilo.modules.workspace import MANIFEST  # noqa: E402

USERS = [{"username": "amy", "password": "pw", "teams": ["red"]}, {"username": "ben", "password": "pw", "teams": ["red"]}]


class Paths(unittest.TestCase):
    def test_names_and_paths_never_leave_the_data_folder(self):
        self.assertEqual(safe_component(" Novel 2 "), "Novel 2")
        for bad in ("", ".", "..", "a/b", "a\\b", "x" * 65, "semi;colon"):
            with self.assertRaises(ValueError):
                safe_component(bad)
        self.assertEqual(safe_relpath("/books//Novel/"), "books/Novel")
        self.assertEqual(safe_relpath(""), "")
        with self.assertRaises(ValueError):
            safe_relpath("books/../../etc")


class Folders(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        folder = Path(self.tmp.name)
        (folder / "accounts.json").write_text(json.dumps({"users": USERS}))
        self.identity = open_identity(AccountStore(folder / "accounts.json"), folder)
        self.projects = open_projects(self.identity, folder / "data")
        self.amy = self.identity.login("amy", "pw")["token"]
        self.ben = self.identity.login("ben", "pw")["token"]

    def tearDown(self):
        self.tmp.cleanup()

    def project(self, relpath, owner="amy"):
        folder = self.projects.folders.under_team("red", relpath)
        folder.mkdir(parents=True)
        (folder / MANIFEST).write_text("{}")
        self.identity.claim({"username": owner}, folder)
        return folder

    def test_browsing_lists_folders_and_the_projects_one_may_open(self):
        self.assertEqual([t["name"] for t in self.projects.browse(self.amy)["teams"]], ["red"])
        self.assertEqual(self.projects.browse(self.amy, "red", "")["entries"], [], "an empty team is an empty root")
        self.projects.make_folder(self.amy, "red", "", "books")
        self.project("books/Novel")
        self.project("books/Secret")
        self.projects.set_access(self.amy, "red", "books/Secret", ["amy"], [])
        (self.projects.folders.under_team("red", "books") / "kept.db").mkdir()  # someone's bookkeeping
        self.projects.reserve("kept.db")
        listed = {e["name"]: e for e in self.projects.browse(self.ben, "red", "books")["entries"]}
        self.assertEqual(list(listed), ["Novel"], "ben may not open Secret; bookkeeping is never listed")
        self.assertEqual((listed["Novel"]["kind"], listed["Novel"]["canEdit"]), ("project", False))
        self.assertEqual(len(self.projects.browse(self.amy, "red", "books")["entries"]), 2)
        with self.assertRaisesRegex(ValueError, "open it instead"):
            self.projects.browse(self.amy, "red", "books/Novel")
        with self.assertRaisesRegex(ValueError, "inside a project"):
            self.projects.make_folder(self.amy, "red", "books/Novel", "x")
        with self.assertRaisesRegex(PermissionError, "not a member"):
            self.projects.browse(self.amy, "blue", "")

    def test_open_files_are_kept_per_account_and_capped(self):
        self.project("Novel")
        self.projects.write_user_state(self.amy, "red", "Novel", ["a.md", 3, "b.md"], "a.md")
        self.projects.write_user_state(self.ben, "red", "Novel", [f"{n}.md" for n in range(300)], 7)
        self.assertEqual(self.projects.read_user_state("red", "Novel", "amy"), {"openFiles": ["a.md", "b.md"], "activeFile": "a.md", "groups": []})
        ben = self.projects.read_user_state("red", "Novel", "ben")
        self.assertEqual((len(ben["openFiles"]), ben["activeFile"]), (200, None))
        self.assertEqual(self.projects.read_user_state("red", "Novel", "cat"), {"openFiles": [], "activeFile": None, "groups": []})
        with self.assertRaisesRegex(ValueError, "Not a project"):
            self.projects.write_user_state(self.amy, "red", "", [], None)

    def test_the_editor_groups_are_kept_cleaned(self):
        self.project("Novel")
        left = {"id": "left", "tabs": [{"path": "a.md", "view": "source"}, {"path": "b.md", "view": "preview"}, {"path": 3, "view": "source"},
                                       {"path": "c.md", "view": "sideways"}, "d.md"], "active": {"path": "b.md", "view": "preview"}}
        right = {"id": "right", "tabs": [{"path": f"{n}.md", "view": "preview"} for n in range(300)], "active": "0.md"}
        self.projects.write_user_state(self.amy, "red", "Novel", ["a.md"], "a.md", [left, right, {"id": "left", "tabs": []}, {"id": "middle"}])
        groups = self.projects.read_user_state("red", "Novel", "amy")["groups"]
        self.assertEqual(groups[0], {"id": "left", "tabs": [{"path": "a.md", "view": "source"}, {"path": "b.md", "view": "preview"}],
                                     "active": {"path": "b.md", "view": "preview"}})
        self.assertEqual((groups[1]["id"], len(groups[1]["tabs"]), groups[1]["active"]), ("right", 200, None))
        self.assertEqual(len(groups), 2, "a group twice, or one that is not, is dropped")
        self.projects.write_user_state(self.amy, "red", "Novel", ["a.md"], "a.md", {"left": "not a list"})
        self.assertEqual(self.projects.read_user_state("red", "Novel", "amy")["groups"], [])

    def test_who_may_open_and_edit(self):
        self.project("Novel")
        self.projects.set_access(self.amy, "red", "Novel", [], [], ["ben"])
        identity, team, relpath = self.projects.authorize_project(self.ben, "red", "/Novel/")
        self.assertEqual((identity["username"], team, relpath), ("ben", "red", "Novel"))
        self.assertFalse(self.projects.may_edit(identity, "red", "Novel"), "ben reads only")
        *_, role = self.projects.authorize_open(self.amy, "red", "Novel")
        self.assertEqual(role, "master")
        self.assertEqual(self.projects.people("red", "Novel"), ["amy", "ben"])
        self.projects.set_access(self.amy, "red", "Novel", ["amy"], [])
        with self.assertRaisesRegex(PermissionError, "do not have access"):
            self.projects.authorize_project(self.ben, "red", "Novel")
        with self.assertRaisesRegex(ValueError, "Not a project"):
            self.projects.authorize_project(self.amy, "red", "nowhere")

    def test_a_flat_workspace_from_before_folders_still_opens(self):
        self.projects.create_workspace(self.amy, "red", "Old")
        with self.assertRaisesRegex(ValueError, "already exists"):
            self.projects.create_workspace(self.amy, "red", "Old")
        _, team, relpath, folder, role = self.projects.authorize_open(self.amy, "red", "workspaces/Old")
        self.assertEqual((relpath, folder.name, role), ("workspaces/Old", "Old", "master"))
        with self.assertRaisesRegex(PermissionError, "do not have access"):
            self.projects.authorize_open(self.ben, "red", "workspaces/Old")
        with self.assertRaisesRegex(PermissionError, "Unknown workspace"):
            self.projects.authorize_open(self.amy, "red", "workspaces/Missing")


def free_port():
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        return probe.getsockname()[1]


class Routes(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        folder = Path(self.tmp.name)
        (folder / "accounts.json").write_text(json.dumps({"users": USERS}))
        self.port = free_port()
        self.httpd = server.build_server("127.0.0.1", self.port, "2468", ROOT, folder / "state.json",
                                         whitelist_file=folder / "accounts.json", data_dir=folder / "data")
        threading.Thread(target=self.httpd.serve_forever, daemon=True).start()

    def tearDown(self):
        self.httpd.shutdown()
        self.httpd.server_close()
        self.tmp.cleanup()

    def call(self, method, path, body=None):
        request = urllib.request.Request(f"http://127.0.0.1:{self.port}{path}", method=method,
                                         data=json.dumps(body).encode() if body is not None else None,
                                         headers={"content-type": "application/json"})
        try:
            with urllib.request.urlopen(request, timeout=10) as response:
                return response.status, json.loads(response.read())
        except urllib.error.HTTPError as error:
            return error.code, json.loads(error.read())

    def test_browse_new_folder_and_open_files_over_http(self):
        amy = self.call("POST", "/api/auth/login", {"username": "amy", "password": "pw"})[1]["token"]
        self.assertEqual(self.call("GET", f"/api/workspaces/browse?token={amy}"), (200, {"teams": [{"name": "red", "modified": None}]}))
        self.assertEqual(self.call("POST", f"/api/workspaces/mkdir?token={amy}", {"team": "red", "path": "", "name": "books"})[1]["path"], "books")
        self.assertEqual(self.call("POST", f"/api/workspaces/mkdir?token={amy}", {"team": "red", "path": "", "name": "books"}),
                         (400, {"message": "A file or folder with that name already exists"}))
        created = self.call("POST", f"/api/workspaces/create?token={amy}", {"team": "red", "path": "books", "name": "Novel", "version": 117})[1]
        listed = self.call("GET", f"/api/workspaces/browse?token={amy}&team=red&path=books")[1]["entries"]
        self.assertEqual([(e["name"], e["kind"]) for e in listed], [("Novel", "project")])
        self.assertEqual(self.call("POST", f"/api/workspaces/user-state?token={amy}",
                                   {"team": "red", "path": created["path"], "openFiles": ["welcome.md"], "activeFile": "welcome.md",
                                    "groups": [{"id": "right", "tabs": [{"path": "welcome.md", "view": "preview"}]}]}), (200, {"ok": True}))
        self.assertEqual(self.call("GET", "/api/workspaces/browse?team=red")[0], 403, "no token")
        self.assertEqual(self.call("GET", f"/api/workspaces/browse?token={amy}&team=red&path=../x")[0], 400)
        self.assertEqual(self.call("POST", f"/api/workspaces?token={amy}", {"team": "red", "name": "Old"}),
                         (404, {"message": "Not found"}), "making a flat workspace from before folders is gone")


if __name__ == "__main__":
    unittest.main()
