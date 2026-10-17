"""Identity and access (server): the access rules, signing in, the access
file (with projects from before it), and the module's routes over HTTP."""
import json, socket, sys, tempfile, threading, unittest, urllib.error, urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "server"))
import mdnotes_server as server  # noqa: E402
from stilo.modules.identity import ACCESS_FILE, AccountStore, can, open_identity  # noqa: E402
from stilo.modules.identity.model.access import changed_access, clean_access, may_open, role_of  # noqa: E402

ACCESS = clean_access({"whitelist": [], "blacklist": ["eve"], "readers": ["rita"], "createdBy": "olga"})


class Rules(unittest.TestCase):
    def test_who_may_open(self):
        self.assertTrue(may_open(ACCESS, "bob", ["red"], "red"), "empty whitelist: the whole team")
        self.assertFalse(may_open(ACCESS, "bob", ["blue"], "red"), "not in the team")
        self.assertFalse(may_open(ACCESS, "eve", ["red"], "red"), "blacklisted")
        listed = {**ACCESS, "whitelist": ["olga"]}
        self.assertFalse(may_open(listed, "bob", ["red"], "red"))
        self.assertTrue(may_open(listed, "olga", ["red"], "red"))

    def test_roles_and_what_they_may_do(self):
        self.assertEqual([role_of(ACCESS, u) for u in ("olga", "rita", "bob")], ["master", "reader", "editor"])
        self.assertEqual([can(r, "edit") for r in ("master", "editor", "reader")], [True, True, False])
        self.assertEqual([can(r, "replace") for r in ("master", "editor", "reader")], [True, False, False])
        self.assertTrue(can("reader", "open"))
        with self.assertRaises(ValueError):
            can("master", "fly")

    def test_only_the_owner_changes_access_and_the_first_setter_becomes_owner(self):
        with self.assertRaisesRegex(PermissionError, "owner"):
            changed_access(ACCESS, "bob", True, ["bob"], [])
        kept = changed_access(ACCESS, "olga", True, [" amy ", ""], [])
        self.assertEqual((kept["whitelist"], kept["readers"], kept["createdBy"]), (["amy"], ["rita"], "olga"))
        unowned = clean_access({})
        with self.assertRaisesRegex(PermissionError, "do not have access"):
            changed_access(unowned, "bob", False, [], [])
        self.assertEqual(changed_access(unowned, "bob", True, [], [], readers=[])["createdBy"], "bob")


def accounts_file(folder, users):
    path = Path(folder) / "accounts.json"
    path.write_text(json.dumps({"users": users}))
    return AccountStore(path)


class SigningIn(unittest.TestCase):
    def test_login_who_logout_and_team_changes_apply_at_once(self):
        with tempfile.TemporaryDirectory() as tmp:
            store = accounts_file(tmp, [{"username": "amy", "password": "pw", "teams": ["red"]}])
            identity = open_identity(store, Path(tmp))
            self.assertTrue(identity.enabled)
            with self.assertRaisesRegex(PermissionError, "Invalid"):
                identity.login("amy", "wrong")
            reply = identity.login(" amy ", "pw")
            self.assertEqual((reply["username"], reply["teams"], reply["lastWorkspace"]), ("amy", ["red"], None))
            token = reply["token"]
            self.assertEqual(identity.who(token), {"username": "amy", "teams": ["red"]})
            store.path.write_text(json.dumps({"users": [{"username": "amy", "password": "pw", "teams": ["red", "blue"]}]}))
            store._checked = 0
            self.assertEqual(identity.require(token)["teams"], ["red", "blue"])
            self.assertEqual(identity.require_team(identity.who(token), "blue"), "blue")
            with self.assertRaisesRegex(PermissionError, "not a member"):
                identity.require_team(identity.who(token), "green")
            identity.remember_workspace("amy", "red", "workspaces/Novel")
            self.assertEqual(identity.login("amy", "pw")["lastWorkspace"], {"team": "red", "path": "workspaces/Novel"})
            identity.logout(token)
            self.assertIsNone(identity.who(token))
            with self.assertRaisesRegex(PermissionError, "Not logged in"):
                identity.require(token)

    def test_without_accounts_nobody_signs_in(self):
        identity = open_identity()
        self.assertFalse(identity.enabled)
        with self.assertRaises(PermissionError):
            identity.login("amy", "pw")


class AccessFile(unittest.TestCase):
    def test_a_project_from_before_access_files_keeps_its_members(self):
        with tempfile.TemporaryDirectory() as tmp:
            project = Path(tmp) / "Novel"
            project.mkdir()
            identity = open_identity()
            access = identity.access(project, lambda: {"members": ["amy"], "createdBy": "amy"})
            self.assertEqual((access["whitelist"], access["createdBy"]), (["amy"], "amy"))
            self.assertTrue((project / ACCESS_FILE).is_file(), "written down the first time")
            self.assertEqual(identity.access(project)["whitelist"], ["amy"], "read back without the legacy meta")
            identity.claim({"username": "ben"}, project)
            self.assertEqual(identity.access(project), {"whitelist": [], "blacklist": [], "readers": [], "createdBy": "ben"})


def free_port():
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        return probe.getsockname()[1]


class Routes(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        folder = Path(self.tmp.name)
        whitelist = folder / "accounts.json"
        whitelist.write_text(json.dumps({"users": [{"username": "amy", "password": "pw", "teams": ["red"]},
                                                   {"username": "ben", "password": "pw", "teams": ["red"]}]}))
        self.port = free_port()
        self.httpd = server.build_server("127.0.0.1", self.port, "2468", ROOT, folder / "state.json",
                                         whitelist_file=whitelist, data_dir=folder / "data")
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

    def test_sign_in_and_access_over_http(self):
        self.assertEqual(self.call("POST", "/api/auth/login", {"username": "amy", "password": "no"})[0], 403)
        status, amy = self.call("POST", "/api/auth/login", {"username": "amy", "password": "pw"})
        self.assertEqual((status, amy["teams"]), (200, ["red"]))
        ben = self.call("POST", "/api/auth/login", {"username": "ben", "password": "pw"})[1]
        created = self.call("POST", f"/api/workspaces/create?token={amy['token']}", {"team": "red", "path": "", "name": "Novel", "version": 117})
        self.assertEqual(created[0], 200, created)
        path = created[1]["path"]
        status, access = self.call("GET", f"/api/workspaces/access?token={ben['token']}&team=red&path={path}")
        self.assertEqual((status, access["createdBy"]), (200, "amy"))
        refused = self.call("POST", f"/api/workspaces/access?token={ben['token']}", {"team": "red", "path": path, "whitelist": ["ben"]})
        self.assertEqual(refused, (403, {"message": "Only the project owner can change access"}))
        status, access = self.call("POST", f"/api/workspaces/access?token={amy['token']}", {"team": "red", "path": path, "whitelist": ["amy"]})
        self.assertEqual((status, access["whitelist"]), (200, ["amy"]))
        self.assertEqual(self.call("GET", f"/api/workspaces/access?token=nobody&team=red&path={path}")[0], 403)
        self.assertEqual(self.call("GET", f"/api/workspaces/access?team=red&path={path}")[0], 403)
        self.assertEqual(self.call("POST", f"/api/workspaces/access?token={amy['token']}", {"team": "red", "path": "nowhere"})[0], 400)
        self.assertTrue(self.call("GET", "/api/ping")[1]["accounts"])


if __name__ == "__main__":
    unittest.main()
