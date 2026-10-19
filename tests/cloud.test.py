"""Cloud (server): a team's project made, copied out with its images, brought
in again under a free name, and deleted into the trash by its owner only,
over HTTP; the routes answer as they did before the module existed."""
import base64, json, socket, sys, tempfile, threading, unittest, urllib.error, urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "server"))
import mdnotes_server as server  # noqa: E402

USERS = [{"username": "amy", "password": "pw", "teams": ["red"]}, {"username": "ben", "password": "pw", "teams": ["red"]}]
PNG = b"\x89PNG\r\n\x1a\nimage"


class Routes(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        folder = Path(self.tmp.name)
        (folder / "accounts.json").write_text(json.dumps({"users": USERS}))
        with socket.socket() as probe:
            probe.bind(("127.0.0.1", 0))
            self.port = probe.getsockname()[1]
        self.httpd = server.build_server("127.0.0.1", self.port, "2468", ROOT, folder / "state.json",
                                         whitelist_file=folder / "accounts.json", data_dir=folder / "data")
        threading.Thread(target=self.httpd.serve_forever, daemon=True).start()

    def tearDown(self):
        self.httpd.shutdown()
        self.httpd.server_close()
        self.tmp.cleanup()

    def call(self, method, path, body=None, raw=None):
        data = raw if raw is not None else json.dumps(body).encode() if body is not None else None
        request = urllib.request.Request(f"http://127.0.0.1:{self.port}{path}", method=method, data=data,
                                         headers={"content-type": "application/octet-stream" if raw is not None else "application/json"})
        try:
            with urllib.request.urlopen(request, timeout=10) as response:
                return response.status, json.loads(response.read())
        except urllib.error.HTTPError as error:
            return error.code, json.loads(error.read())

    def login(self, name):
        return self.call("POST", "/api/auth/login", {"username": name, "password": "pw"})[1]["token"]

    def test_made_copied_out_brought_in_and_deleted(self):
        amy, ben = self.login("amy"), self.login("ben")
        status, made = self.call("POST", f"/api/workspaces/create?token={amy}", {"team": "red", "path": "", "name": "Novel"})
        self.assertEqual((status, made["path"], made["kind"], made["createdBy"]), (200, "Novel", "project", "amy"))
        self.assertEqual(self.call("POST", f"/api/workspaces/create?token={amy}", {"team": "red", "path": "", "name": "Novel"}),
                         (400, {"message": "A file or folder with that name already exists"}))
        self.assertEqual(self.call("POST", f"/api/workspaces/create?token={amy}", {"team": "red", "path": "Novel", "name": "Inner"}),
                         (400, {"message": "Cannot nest a project inside another project"}))
        # An image, uploaded to the live project, travels inside the copy as a data URL.
        session = self.call("POST", f"/api/workspaces/open?token={amy}", {"team": "red", "path": "Novel", "version": 117})[1]["token"]
        self.call("POST", f"/api/operations?token={session}", {"version": 117, "operation": {
            "type": "create-file", "parentPath": "", "name": "cover.png", "content": ""}})
        self.call("POST", f"/api/workspaces/asset?token={session}&path=cover.png&offset=0", raw=PNG)
        status, copied = self.call("GET", f"/api/workspaces/export?token={ben}&team=red&path=Novel")
        self.assertEqual((status, copied["name"]), (200, "Novel"))
        cover = next(node for node in copied["project"]["nodes"].values() if node["name"] == "cover.png")
        self.assertEqual(base64.b64decode(cover["content"].split(",", 1)[1]), PNG)
        status, brought = self.call("POST", f"/api/workspaces/import?token={ben}",
                                    {"team": "red", "path": "", "name": "Novel", "project": copied["project"]})
        self.assertEqual((status, brought["path"], brought["createdBy"]), (200, "Novel-2", "ben"), "a taken name gets -2")
        self.assertEqual(self.call("GET", f"/api/workspaces/export?token={amy}&team=red&path=Novel-2")[1]["name"], "Novel-2")
        bad = {"rootId": "r", "nodes": {"r": {"id": "r", "name": "x"}, "f": {"id": "f", "name": "../escape.md"}}}
        self.assertEqual(self.call("POST", f"/api/workspaces/import?token={ben}", {"team": "red", "path": "", "name": "Bad", "project": bad}),
                         (400, {"message": "Invalid file or folder name in payload"}))
        # Only the owner deletes a project; it waits in the trash.
        self.assertEqual(self.call("POST", f"/api/workspaces/delete?token={ben}", {"team": "red", "path": "Novel"})[0], 403)
        status, gone = self.call("POST", f"/api/workspaces/delete?token={amy}", {"team": "red", "path": "Novel"})
        self.assertEqual((status, gone["deleted"], gone["trashDays"]), (200, True, 30))
        self.assertEqual(self.call("GET", f"/api/workspaces/export?token={amy}&team=red&path=Novel"),
                         (400, {"message": "Not a project directory"}))
        self.assertEqual(self.call("POST", f"/api/workspaces/delete?token={amy}", {"team": "red", "path": ""}),
                         (400, {"message": "Cannot delete the team root"}))


if __name__ == "__main__":
    unittest.main()
