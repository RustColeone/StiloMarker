"""Accounts stay what the account file says (v0.2.40), on the server.

An account removed, given a new password or taken out of a team loses what
it may no longer have, wherever the change was made (the admin page,
server/accounts.py, the file by hand): its sign-ins and its sessions in the
team projects. A sign-in lasts two weeks at most; wrong passwords for one
name make it wait a minute, and a name with no account takes as long to
refuse as one with. The file is read only as it should be (a team list, a
password string), one that does not read is never written over from the
page, account names have nothing invisible or look-alike, team names are
folder names, spelled one way, and the account file is never served under
any spelling, whatever it is called."""
import json
import socket
import subprocess
import sys
import tempfile
import threading
import unittest
import urllib.request
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "server"))
import mdnotes_server as server  # noqa: E402
from stilo.modules.identity import AccountStore, accounts as rules, open_identity, read_accounts, write_accounts  # noqa: E402
from stilo.modules.identity.adapters import account_file  # noqa: E402
from stilo.modules.identity.service import identity as identity_service  # noqa: E402
from stilo.modules.projects import safe_component  # noqa: E402
from stilo.modules.transport.adapters.web import is_denied  # noqa: E402


def quiet(test):
    """The server's log kept out of the test's output."""
    for module in (server, account_file, identity_service):
        logs = patch.object(module, "_log")
        logs.start()
        test.addCleanup(logs.stop)


class Sessions(unittest.TestCase):
    """The whole server's modules: Identity tells Sync what changed."""

    def setUp(self):
        quiet(self)
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        folder = Path(self.tmp.name)
        users = rules.add_account({}, "leo", "leo-password", ["red", "blue"], admin=True)
        users = rules.add_account(users, "mia", "mia-password", ["red", "blue"])
        self.path = folder / "people.json"
        write_accounts(self.path, users)
        self.modules = server.start_server_modules(server.settings("2468", folder / "state.json", None, AccountStore(self.path), folder / "data"))
        self.addCleanup(self.modules.stop)
        self.identity, self.directory = self.modules["identity"], self.modules["sync"].directory
        self.leo = self.identity.login("leo", "leo-password")["token"]
        self.mia = self.identity.login("mia", "mia-password")["token"]
        for team in ("red", "blue"):
            self.modules["cloud"].create_project(self.leo, team, "", "Book")

    def open(self, token, team):
        return self.directory.open_workspace(token, team, "Book")["token"]

    def live(self, session) -> bool:
        try:
            self.directory.broker_for_token(session).authorize(session)
            return True
        except PermissionError:
            return False

    def test_a_removed_account_loses_its_sign_in_and_its_sessions(self):
        red, blue = self.open(self.mia, "red"), self.open(self.mia, "blue")
        mine = self.open(self.leo, "red")
        self.identity.accounts_change(self.leo, {"action": "remove", "username": "mia"})
        self.assertIsNone(self.identity.who(self.mia))
        self.assertFalse(self.live(red) or self.live(blue), "its sessions end")
        self.assertTrue(self.live(mine), "no one else's")

    def test_leaving_a_team_ends_the_sessions_there_only(self):
        red, blue = self.open(self.mia, "red"), self.open(self.mia, "blue")
        self.identity.accounts_change(self.leo, {"action": "teams", "username": "mia", "teams": ["blue"]})
        self.assertFalse(self.live(red))
        self.assertTrue(self.live(blue))
        self.assertIsNotNone(self.identity.who(self.mia), "still signed in")
        with self.assertRaises(PermissionError):
            self.open(self.mia, "red")

    def test_a_new_password_signs_the_account_out_but_not_its_own_change(self):
        session = self.open(self.mia, "red")
        self.identity.accounts_change(self.leo, {"action": "password", "username": "mia", "password": "another-one"})
        self.assertIsNone(self.identity.who(self.mia))
        self.assertFalse(self.live(session))
        other = self.identity.login("leo", "leo-password")["token"]  # leo on another device
        mine = self.open(self.leo, "red")
        self.identity.accounts_change(self.leo, {"action": "password", "username": "leo", "password": "leo-password-2"})
        self.assertIsNotNone(self.identity.who(self.leo), "the page that changed it stays signed in")
        self.assertTrue(self.live(mine))
        self.assertIsNone(self.identity.who(other), "the other device signs in again")

    def test_a_refused_change_keeps_no_one_signed_in_later(self):
        mine = self.open(self.leo, "red")
        with self.assertRaisesRegex(ValueError, "at least 8"):
            self.identity.accounts_change(self.leo, {"action": "password", "username": "leo", "password": "short"})
        users = read_accounts(self.path)  # then a new password for leo, by hand
        users = rules.set_password(users, "leo", "changed-by-hand")
        write_accounts(self.path, users)
        self.identity.accounts.refresh(0)
        self.assertIsNone(self.identity.who(self.leo), "the page that tried before is signed out too")
        self.assertFalse(self.live(mine))

    def test_a_change_by_hand_or_by_the_command_line_counts_too(self):
        session = self.open(self.mia, "red")
        users = read_accounts(self.path)
        del users["mia"]
        write_accounts(self.path, users)
        self.identity.accounts.refresh(0)  # what the server does every few seconds
        self.assertIsNone(self.identity.who(self.mia))
        self.assertFalse(self.live(session))

    def test_a_sign_in_lasts_two_weeks_at_most(self):
        username, made = self.identity._tokens[self.mia]
        self.identity._tokens[self.mia] = (username, made - identity_service.TOKEN_DAYS * 86400 - 1)
        self.assertIsNone(self.identity.who(self.mia))
        self.assertIsNotNone(self.identity.who(self.leo))


class SigningIn(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.path = Path(self.tmp.name) / "accounts.json"
        write_accounts(self.path, rules.add_account({}, "leo", "leo-password", ["red"], admin=True))
        quiet(self)
        self.identity = open_identity(AccountStore(self.path), Path(self.tmp.name) / "data")

    def wrong(self, username, times):
        for _ in range(times):
            with self.assertRaisesRegex(PermissionError, "Invalid"):
                self.identity.login(username, "not-it-at-all")

    def test_wrong_passwords_make_that_name_wait(self):
        for username in ("leo", "nobody"):
            self.wrong(username, identity_service.TRIES)
            with self.assertRaisesRegex(PermissionError, "wait a minute"):
                self.identity.login(username, "leo-password")
        self.identity._tries = {name: [when - identity_service.TRIES_WAIT - 1 for when in tries]
                                for name, tries in self.identity._tries.items()}
        self.assertEqual(self.identity.login("leo", "leo-password")["username"], "leo", "a minute later")

    def test_a_name_with_no_account_is_checked_as_long(self):
        checked = []
        real = account_file.verify_password
        with patch.object(account_file, "verify_password", lambda stored, password: checked.append(stored) or real(stored, password)):
            self.assertIsNone(self.identity.accounts.authenticate("nobody", "some-password"))
        self.assertEqual(len(checked), 1)
        self.assertTrue(checked[0].startswith("scrypt$"))


class TheFile(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.path = Path(self.tmp.name) / "accounts.json"
        quiet(self)

    def write(self, users):
        self.path.write_text(json.dumps({"users": users}), encoding="utf-8")

    def test_read_only_as_it_should_be(self):
        self.write([{"username": "ann", "password": "as-typed-pw", "teams": "red"},
                    {"username": "bob", "password": 12345678, "teams": ["red", 7, " blue "]},
                    {"username": 42, "password": "x"}, ["not", "an", "entry"]])
        users = read_accounts(self.path)
        self.assertEqual(sorted(users), ["ann", "bob"])
        self.assertEqual(users["ann"]["teams"], [], "a string is not a list of team names")
        self.assertEqual(users["bob"]["teams"], ["red", "blue"])
        store = AccountStore(self.path)
        self.assertIsNone(store.authenticate("bob", "12345678"), "a password that is not a string signs no one in")

    def test_a_file_that_does_not_read_is_never_written_over_from_the_page(self):
        write_accounts(self.path, rules.add_account({}, "leo", "leo-password", admin=True))
        store = AccountStore(self.path)
        self.path.write_text('{"users": [{"username": "leo", ', encoding="utf-8")
        store.refresh(0)
        self.assertTrue(store.broken)
        self.assertIsNotNone(store.authenticate("leo", "leo-password"), "the accounts from before still sign in")
        with self.assertRaisesRegex(ValueError, "does not read"):
            store.save(rules.add_account(store.users, "mia", "mia-password"))
        self.assertTrue(self.path.read_text(encoding="utf-8").endswith(", "), "left as it was, for its owner to fix")
        write_accounts(self.path, rules.add_account({}, "leo", "leo-password", admin=True))
        store.refresh(0)
        self.assertFalse(store.broken)
        store.save(rules.add_account(store.users, "mia", "mia-password"))
        self.assertIn("mia", read_accounts(self.path))


class Names(unittest.TestCase):
    def test_account_names_have_nothing_invisible_or_look_alike(self):
        users = rules.add_account({}, "mia", "mia-password")
        for bad in ("mi​a", "‮aim", "ｍia", "mi\x00a", "a/b", "..", "x" * 65, "Mia", "MIA"):
            with self.subTest(name=bad), self.assertRaises(ValueError):
                rules.add_account(users, bad, "a-password")
        for good in ("Zoë", "李雷", "o'neil", "anna-lena.k"):
            with self.subTest(name=good):
                self.assertIn(good, rules.add_account(users, good, "a-password"))

    def test_team_names_are_folder_names_spelled_one_way(self):
        users = rules.add_account({}, "mia", "mia-password", ["Red Team", "Green"])
        users = rules.add_account(users, "leo", "leo-password", ["red team", "blue", "BLUE"])
        self.assertEqual(users["leo"]["teams"], ["Red Team", "blue"], "as the others spell it, once")
        self.assertEqual(rules.set_teams(users, "mia", ["GREEN", "red TEAM"])["mia"]["teams"], ["GREEN", "Red Team"],
                         "a team no one else is in takes the new spelling")
        for bad in ("a/b", "..", "rot;", "café", "x" * 65, ""):
            with self.subTest(team=bad), self.assertRaises(ValueError):
                rules.set_teams(users, "mia", [bad])
        for team in ("Red Team", "blue", "a.b-c_d", "x" * 64):
            self.assertEqual(safe_component(team), team, "a team name Projects can keep a folder under")


class NeverServed(unittest.TestCase):
    def test_under_any_spelling_whatever_it_is_called(self):
        private = {"whitelist.json", "people.json"}
        for path in ("people.json", "PEOPLE.JSON", "x/People.json.", "whitelist.json", "server/whitelist.json",
                     "SERVER/notes.md", "Data./team_red/Book/notes.md", "DATA/x", "venv/x", "app/main.PY", ".git/config"):
            with self.subTest(path=path):
                self.assertTrue(is_denied(path, private))
        for path in ("index.html", "app/main.js", "docs/MANUAL.md"):
            self.assertFalse(is_denied(path, private))

    def test_the_configured_file_is_kept_private(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "index.html").write_text("the app", encoding="utf-8")
            path = root / "people.json"  # in the folder served, under a name of its own
            write_accounts(path, rules.add_account({}, "leo", "leo-password", admin=True))
            with socket.socket() as probe:
                probe.bind(("127.0.0.1", 0))
                port = probe.getsockname()[1]
            with patch.object(server, "_log"):
                httpd = server.build_server("127.0.0.1", port, "2468", root, root / "state.json", whitelist_file=path, data_dir=root / "data")
            threading.Thread(target=httpd.serve_forever, daemon=True).start()
            try:
                with urllib.request.urlopen(f"http://127.0.0.1:{port}/people.json", timeout=10) as answer:
                    self.assertEqual(answer.read().decode("utf-8"), "the app")
            finally:
                httpd.shutdown()
                httpd.server_close()


class CommandLine(unittest.TestCase):
    def test_a_password_from_standard_input_is_utf8(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "accounts.json"
            done = subprocess.run([sys.executable, str(ROOT / "server" / "accounts.py"), "--file", str(path), "--password-stdin",
                                   "add", "--admin", "--", "zoë"], input="pässwörd-ünïcode\r\n".encode("utf-8"),
                                  capture_output=True, env={"PATH": "", "PYTHONIOENCODING": "ascii:replace", "LC_ALL": "C"}, timeout=60)
            self.assertEqual(done.returncode, 0, done.stderr.decode("utf-8", "replace"))
            self.assertIsNotNone(AccountStore(path).authenticate("zoë", "pässwörd-ünïcode"))


if __name__ == "__main__":
    unittest.main()
