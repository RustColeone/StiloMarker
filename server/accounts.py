#!/usr/bin/env python3
"""The accounts, from the command line (the server need not be running; a
running one reads the file again within seconds). Passwords are asked for,
never given on the command line, and never printed.

    python3 server/accounts.py convert --admin leo    hash every password kept as typed, once;
                                                      leo becomes an admin
    python3 server/accounts.py list                   who, their teams, who is an admin
    python3 server/accounts.py add mia --teams red,blue [--admin]
    python3 server/accounts.py password mia           a new password
    python3 server/accounts.py admin mia [--off]      make (or stop making) an admin
    python3 server/accounts.py remove mia

--file names the account file (default: $MDNOTES_WHITELIST, else the one
next to this script, as the server reads). --password-stdin reads a new
password from standard input instead of asking (for scripts). The rules are
Identity's (stilo/modules/identity/model/accounts.py), the same the admin
page keeps: the last admin can be neither removed nor made ordinary."""
import argparse
import getpass
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from stilo.modules.identity import ACCOUNT_FILE, accounts as rules, read_accounts, write_accounts  # noqa: E402


def new_password(args) -> str:
    if args.password_stdin:
        # As UTF-8 whatever the system's own encoding, as the browser sends it.
        return sys.stdin.buffer.readline().decode("utf-8").rstrip("\r\n")
    first = getpass.getpass("New password: ")
    if first != getpass.getpass("Again: "):
        raise ValueError("The two passwords differ.")
    return first


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description="Manage the server's accounts.")
    parser.add_argument("--file", default=os.environ.get("MDNOTES_WHITELIST", str(Path(__file__).resolve().parent / ACCOUNT_FILE)))
    parser.add_argument("--password-stdin", action="store_true", help="read a new password from standard input")
    commands = parser.add_subparsers(dest="command", required=True)
    convert = commands.add_parser("convert", help="hash every password kept as typed; name the first admin")
    convert.add_argument("--admin", required=True)
    commands.add_parser("list", help="the accounts, their teams and admins")
    add = commands.add_parser("add", help="a new account")
    add.add_argument("username")
    add.add_argument("--teams", default="")
    add.add_argument("--admin", action="store_true")
    password = commands.add_parser("password", help="a new password for an account")
    password.add_argument("username")
    admin = commands.add_parser("admin", help="make an account an admin (--off: an ordinary account)")
    admin.add_argument("username")
    admin.add_argument("--off", action="store_true")
    remove = commands.add_parser("remove", help="remove an account")
    remove.add_argument("username")
    args = parser.parse_args(argv)

    path = Path(args.file)
    try:
        users = read_accounts(path) if path.exists() else {}
        if args.command == "list":
            for row in rules.listing(users):
                marks = ["admin"] if row["admin"] else []
                if not row["hashed"]:
                    marks.append("password as typed")
                print(f"{row['username']}\tteams: {', '.join(row['teams']) or '-'}" + (f"\t({', '.join(marks)})" if marks else ""))
            return 0
        if args.command == "convert":
            users, hashed = rules.convert(users, args.admin)
            message = f"Hashed {hashed} password(s); {args.admin} is an admin."
        elif args.command == "add":
            users = rules.add_account(users, args.username, new_password(args), [t for t in args.teams.split(",") if t.strip()], args.admin)
            message = f"Added {args.username.strip()}."
        elif args.command == "password":
            users = rules.set_password(users, args.username, new_password(args))
            message = f"{args.username}'s password changed."
        elif args.command == "admin":
            users = rules.set_admin(users, args.username, not args.off)
            message = f"{args.username} is {'no longer ' if args.off else ''}an admin."
        else:
            users = rules.remove_account(users, args.username)
            message = f"Removed {args.username}."
        write_accounts(path, users)
    except (OSError, ValueError) as error:
        print(f"accounts: {error}", file=sys.stderr)
        return 1
    print(message)
    return 0


if __name__ == "__main__":
    sys.exit(main())
