"""Accounts (Identity): passwords kept as salted scrypt hashes (a file from
before hashing still signs in until converted), the rules the admin page and
server/accounts.py share (the last admin stays), the account file written
whole and private, the command line (convert, add, password, admin, remove,
list; passwords asked for, never printed), and the admin routes (admins only;
a removed account signed out). The page: accounts-browser.py."""
import io
import json
import os
import stat
import subprocess
import sys
import tempfile
import unittest
from contextlib import redirect_stderr, redirect_stdout
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "server"))
from stilo.modules.identity import AccountStore, accounts as rules, open_identity, read_accounts, write_accounts  # noqa: E402
from stilo.modules.identity.model.passwords import hash_password, is_hashed, verify_password  # noqa: E402

CLI = ROOT / "server" / "accounts.py"


def plain_file(directory, users):
    path = Path(directory) / "accounts.json"
    path.write_text(json.dumps({"users": users}), encoding="utf-8")
    return path


class Passwords(unittest.TestCase):
    def test_hashed_salted_and_checked(self):
        one, two = hash_password("correct horse"), hash_password("correct horse")
        self.assertTrue(is_hashed(one) and one != two, "salted: the same password hashes differently")
        self.assertTrue(verify_password(one, "correct horse"))
        self.assertFalse(verify_password(one, "correct horsE"))
        self.assertFalse(verify_password(one, ""))
        self.assertFalse(verify_password("scrypt$broken", "x"), "a damaged entry signs no one in")
        self.assertTrue(verify_password("as-typed", "as-typed"), "a file from before hashing still signs in")
        self.assertFalse(verify_password("", ""))


class Rules(unittest.TestCase):
    def setUp(self):
        self.users = {"leo": {"password": "pw-leo-123", "teams": ["red"], "admin": False},
                      "mia": {"password": "pw-mia-123", "teams": [], "admin": False}}

    def test_convert_hashes_once_and_names_the_admin(self):
        users, hashed = rules.convert(self.users, "leo")
        self.assertEqual(hashed, 2)
        self.assertTrue(users["leo"]["admin"] and not users["mia"]["admin"])
        self.assertTrue(verify_password(users["mia"]["password"], "pw-mia-123"))
        again, hashed = rules.convert(users, "leo")
        self.assertEqual(hashed, 0, "a hashed password is left alone")
        self.assertEqual(again["mia"]["password"], users["mia"]["password"])
        self.assertEqual(self.users["leo"]["password"], "pw-leo-123", "the accounts given are not changed")
        with self.assertRaisesRegex(ValueError, "no account"):
            rules.convert(self.users, "nobody")

    def test_the_last_admin_stays(self):
        users, _ = rules.convert(self.users, "leo")
        with self.assertRaisesRegex(ValueError, "last admin"):
            rules.set_admin(users, "leo", False)
        with self.assertRaisesRegex(ValueError, "last admin"):
            rules.remove_account(users, "leo")
        users = rules.set_admin(users, "mia", True)
        users = rules.set_admin(users, "leo", False)
        self.assertEqual([row["username"] for row in rules.listing(users) if row["admin"]], ["mia"])
        self.assertNotIn("leo", rules.remove_account(users, "leo"))

    def test_adding_names_teams_and_passwords(self):
        users = rules.add_account(self.users, "  zoe ", "long enough", ["red", " red", "blue"], admin=True)
        self.assertEqual(users["zoe"]["teams"], ["red", "blue"])
        self.assertTrue(verify_password(users["zoe"]["password"], "long enough"))
        with self.assertRaisesRegex(ValueError, "already"):
            rules.add_account(users, "ZOE", "long enough")
        with self.assertRaisesRegex(ValueError, "at least 8"):
            rules.add_account(users, "kim", "short")
        for bad in ["", "a/b", "..", "x" * 65]:
            with self.assertRaises(ValueError, msg=bad):
                rules.add_account(users, bad, "long enough")
        with self.assertRaises(ValueError):
            rules.set_teams(users, "zoe", ["../up"])
        self.assertEqual(rules.set_teams(users, "zoe", [])["zoe"]["teams"], [])
        listed = rules.listing(users)
        self.assertNotIn("password", json.dumps(listed), "the listing never carries a password")


class AccountFile(unittest.TestCase):
    def test_written_whole_private_and_read_back(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "accounts.json"
            users = rules.add_account({}, "leo", "long enough", ["red"], admin=True)
            write_accounts(path, users)
            self.assertEqual(stat.S_IMODE(path.stat().st_mode), 0o600)
            self.assertEqual(read_accounts(path), users)
            self.assertEqual(sorted(p.name for p in Path(tmp).iterdir()), ["accounts.json"], "no temporary file left")

    def test_the_store_signs_in_either_kind_and_says_what_needs_converting(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = plain_file(tmp, [{"username": "leo", "password": "pw-leo-123", "teams": ["red"]}])
            store = AccountStore(path)
            self.assertEqual(store.authenticate("leo", "pw-leo-123"), {"username": "leo", "teams": ["red"], "admin": False})
            users, _ = rules.convert(store.users, "leo")
            store.save(users)
            self.assertEqual(store.authenticate("leo", "pw-leo-123")["admin"], True)
            self.assertIsNone(store.authenticate("leo", "wrong"))
            self.assertTrue(is_hashed(json.loads(path.read_text())["users"][0]["password"]))


class CommandLine(unittest.TestCase):
    def run_cli(self, *args, stdin=""):
        result = subprocess.run([sys.executable, str(CLI), *args], input=stdin, capture_output=True, text=True, timeout=60)
        return result.returncode, result.stdout, result.stderr

    def test_convert_add_password_admin_remove_list(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = plain_file(tmp, [{"username": "leo", "password": "secret-leo", "teams": ["red"]},
                                    {"username": "mia", "password": "secret-mia", "teams": []}])
            f = ["--file", str(path)]
            code, out, err = self.run_cli(*f, "convert", "--admin", "leo")
            self.assertEqual((code, out.strip()), (0, "Hashed 2 password(s); leo is an admin."), err)
            self.assertNotIn("secret", path.read_text(), "no password kept as typed")
            code, out, _ = self.run_cli(*f, "--password-stdin", "add", "zoe", "--teams", "red,blue", stdin="zoe-password\n")
            self.assertEqual(code, 0, out)
            code, out, _ = self.run_cli(*f, "--password-stdin", "password", "mia", stdin="mia-new-pass\n")
            self.assertEqual(code, 0)
            store = AccountStore(path)
            self.assertIsNotNone(store.authenticate("zoe", "zoe-password"))
            self.assertIsNotNone(store.authenticate("mia", "mia-new-pass"))
            self.assertIsNone(store.authenticate("mia", "secret-mia"))
            code, _, err = self.run_cli(*f, "admin", "leo", "--off")
            self.assertEqual(code, 1)
            self.assertIn("last admin", err)
            self.assertEqual(self.run_cli(*f, "admin", "zoe")[0], 0)
            self.assertEqual(self.run_cli(*f, "remove", "leo")[0], 0)
            code, out, _ = self.run_cli(*f, "list")
            self.assertEqual(out.splitlines(), ["mia\tteams: -", "zoe\tteams: red, blue\t(admin)"])
            self.assertNotIn("password", out.lower())
            code, _, err = self.run_cli(*f, "--password-stdin", "add", "kim", stdin="short\n")
            self.assertEqual(code, 1)
            self.assertIn("at least 8", err)


class AdminRoutes(unittest.TestCase):
    """Identity's admin operations (what the routes call): admins only; a
    removed account signed out at once."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        users = rules.add_account({}, "leo", "leo-password", ["red"], admin=True)
        users = rules.add_account(users, "mia", "mia-password", ["red"])
        path = Path(self.tmp.name) / "accounts.json"
        write_accounts(path, users)
        self.identity = open_identity(AccountStore(path), Path(self.tmp.name) / "data")
        self.leo = self.identity.login("leo", "leo-password")["token"]
        self.mia = self.identity.login("mia", "mia-password")["token"]

    def tearDown(self):
        self.tmp.cleanup()

    def test_only_admins_and_the_rules_hold(self):
        with self.assertRaises(PermissionError):
            self.identity.accounts_list(self.mia)
        self.assertEqual([row["username"] for row in self.identity.accounts_list(self.leo)], ["leo", "mia"])
        self.identity.accounts_change(self.leo, {"action": "add", "username": "zoe", "password": "zoe-password", "teams": ["blue"]})
        self.assertIsNotNone(self.identity.accounts.authenticate("zoe", "zoe-password"))
        with self.assertRaisesRegex(ValueError, "last admin"):
            self.identity.accounts_change(self.leo, {"action": "admin", "username": "leo", "admin": False})
        self.identity.accounts_change(self.leo, {"action": "remove", "username": "mia"})
        self.assertIsNone(self.identity.who(self.mia), "a removed account is signed out")
        self.assertEqual(self.identity.login("leo", "leo-password")["admin"], True)


if __name__ == "__main__":
    unittest.main()
