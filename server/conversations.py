"""Chats: per-project conversations between people and characters.

One SQLite database per project (``conversations.sqlite`` in the project
folder) holds the conversations, who is in each, their messages, and each
person's private notes about their contacts. Members are keys:
``user:<account>`` for people and ``char:<path of a character file>`` for
characters. A conversation of exactly two members is a *pair* and is unique for
those two (starting a chat with someone reopens it); anything larger is a
*group*. Inviting someone into a pair starts a new group, so the private chat
is kept.

Everything here checks membership itself: a person who is not a member of a
conversation gets LookupError (treated as "not found"), never its contents.
"""
import json
import re
import sqlite3
import threading
import time
from collections import deque
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from stilo.modules.file_types import BUILTIN as FILE_TYPES

DB_NAME = "conversations.sqlite"
# SQLite's write-ahead log lives next to the database; all three must survive
# a publish and never be shown or exported as project files.
SIDE_FILES = (DB_NAME, DB_NAME + "-wal", DB_NAME + "-shm")
MAX_MESSAGE = 16000
MAX_TITLE = 120
MAX_ALIAS = 80
MAX_NOTE = 4000
MAX_MEMBERS = 24
PAGE = 50
PERSONA_SUFFIX = FILE_TYPES.extensions_of("persona")[0]  # the File types module owns it

SCHEMA = """
CREATE TABLE IF NOT EXISTS conversations (
  id INTEGER PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('pair', 'group')),
  title TEXT NOT NULL DEFAULT '',
  pair_key TEXT UNIQUE,
  created_by TEXT NOT NULL,
  created_at REAL NOT NULL,
  updated_at REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS members (
  conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  member TEXT NOT NULL,
  joined_at REAL NOT NULL,
  last_read_id INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (conversation_id, member)
);
CREATE INDEX IF NOT EXISTS members_by_member ON members(member);
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  author TEXT NOT NULL,
  author_name TEXT NOT NULL DEFAULT '',
  content TEXT NOT NULL,
  context_paths TEXT NOT NULL DEFAULT '[]',
  created_at REAL NOT NULL,
  state TEXT NOT NULL DEFAULT 'done'
);
CREATE INDEX IF NOT EXISTS messages_by_conversation ON messages(conversation_id, id);
CREATE TABLE IF NOT EXISTS contact_notes (
  owner TEXT NOT NULL,
  contact TEXT NOT NULL,
  alias TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  updated_at REAL NOT NULL,
  PRIMARY KEY (owner, contact)
);
"""

FTS_SCHEMA = """
CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(content, content='messages', content_rowid='id');
CREATE TRIGGER IF NOT EXISTS messages_ai AFTER INSERT ON messages BEGIN
  INSERT INTO messages_fts(rowid, content) VALUES (new.id, new.content);
END;
CREATE TRIGGER IF NOT EXISTS messages_ad AFTER DELETE ON messages BEGIN
  INSERT INTO messages_fts(messages_fts, rowid, content) VALUES ('delete', old.id, old.content);
END;
CREATE TRIGGER IF NOT EXISTS messages_au AFTER UPDATE OF content ON messages BEGIN
  INSERT INTO messages_fts(messages_fts, rowid, content) VALUES ('delete', old.id, old.content);
  INSERT INTO messages_fts(rowid, content) VALUES (new.id, new.content);
END;
"""

# Mirrors app/services/persona-service.js (personaHandle / findMentions); the
# shared case table in spec/characters/mentions.cases.json keeps the two in step.
_HANDLE_STRIP = re.compile(r"[^\w-]", re.UNICODE)
_MENTION = re.compile(r"(^|[^\w@.])@([\w-]+)", re.UNICODE)


def persona_handle(path: str) -> str:
    name = str(path or "").rsplit("/", 1)[-1]
    if name.lower().endswith(PERSONA_SUFFIX):
        name = name[: -len(PERSONA_SUFFIX)]
    handle = _HANDLE_STRIP.sub("", re.sub(r"\s+", "-", name.strip().lower())).strip("-")
    return handle or "character"


def find_mentions(text: str, handles) -> list[str]:
    """Handles addressed in text, in order of first mention; @all / @everyone
    stands for every handle given, in their order."""
    known = [str(h).lower() for h in handles if str(h)]
    known_set = set(known)
    found: list[str] = []
    for match in _MENTION.finditer(str(text or "")):
        token = match.group(2).lower().rstrip("-")
        picks = known if token in ("all", "everyone") else ([token] if token in known_set else [])
        for handle in picks:
            if handle not in found:
                found.append(handle)
    return found


def persona_header(content: str) -> dict:
    """The `key: value` header of a persona file (see persona-service.js)."""
    match = re.match(r"\ufeff?---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)", str(content or ""))
    header = {}
    if match:
        for line in match.group(1).splitlines():
            key, colon, value = line.partition(":")
            if not colon or line.lstrip().startswith("#"):
                continue
            value = re.sub(r"\s+#.*$", "", value.strip()).strip()
            if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
                value = value[1:-1]
            header.setdefault(key.strip().lower(), value)
    return {"header": header, "body": str(content or "")[match.end():] if match else str(content or "")}


def persona_summary(body: str, limit: int = 200) -> str:
    """First paragraph of prose: tells each character who else is present."""
    for paragraph in re.split(r"\n\s*\n", str(body or "").replace("\r", "")):
        lines = [l for l in paragraph.split("\n") if l.strip() and not re.match(r"\s*(#|>|---)", l)]
        text = re.sub(r"\s+", " ", re.sub(r"[*_`]", "", " ".join(lines))).strip()
        if text:
            return text if len(text) <= limit else text[: limit - 1].rstrip() + "…"
    return ""


def user_key(username: str) -> str:
    return f"user:{username}"


def char_key(path: str) -> str:
    return f"char:{path}"


def _clean_member(key) -> str:
    key = str(key or "").strip()
    if key.startswith("user:") and len(key) > 5:
        return key
    if key.startswith("char:") and key.lower().endswith(PERSONA_SUFFIX):
        return key
    raise ValueError(f"Not a chat member: {key!r}")


class ProjectChats:
    """The conversations of one project. Thread-safe: one connection, one lock
    (SQLite in WAL mode; writes are short)."""

    def __init__(self, path: Path):
        self.path = Path(path)
        self.lock = threading.RLock()
        self.version = 0  # bumped on every committed write (for backups)
        self.db = sqlite3.connect(str(self.path), check_same_thread=False, isolation_level=None, timeout=10)
        self.db.row_factory = sqlite3.Row
        with self.lock:
            self.db.execute("PRAGMA journal_mode=WAL")
            self.db.execute("PRAGMA foreign_keys=ON")
            self.db.execute("PRAGMA busy_timeout=5000")
            self.db.executescript(SCHEMA)
            try:
                self.db.executescript(FTS_SCHEMA)
                self.fts = True
            except sqlite3.OperationalError:  # SQLite built without FTS5
                self.fts = False
            self.db.execute("PRAGMA user_version=1")

    def close(self) -> None:
        with self.lock:
            self.db.close()

    # ---- helpers ------------------------------------------------------------

    def _tx(self):
        return _Transaction(self)

    def _members(self, cid: int) -> list[str]:
        rows = self.db.execute("SELECT member FROM members WHERE conversation_id=? ORDER BY joined_at, member", (cid,))
        return [row["member"] for row in rows]

    def _require_member(self, cid, me: str) -> sqlite3.Row:
        try:
            cid = int(cid)
        except (TypeError, ValueError):
            raise LookupError("Conversation not found") from None
        row = self.db.execute(
            "SELECT c.* FROM conversations c JOIN members m ON m.conversation_id=c.id WHERE c.id=? AND m.member=?",
            (cid, me)).fetchone()
        if row is None:
            raise LookupError("Conversation not found")
        return row

    @staticmethod
    def _message(row) -> dict:
        return {"id": row["id"], "conversationId": row["conversation_id"], "author": row["author"],
                "authorName": row["author_name"], "content": row["content"],
                "contextPaths": json.loads(row["context_paths"] or "[]"), "createdAt": row["created_at"],
                "state": row["state"]}

    def _view(self, row, me: str) -> dict:
        cid = row["id"]
        members = self._members(cid)
        last = self.db.execute("SELECT * FROM messages WHERE conversation_id=? ORDER BY id DESC LIMIT 1", (cid,)).fetchone()
        read = self.db.execute("SELECT last_read_id FROM members WHERE conversation_id=? AND member=?", (cid, me)).fetchone()
        unread = self.db.execute("SELECT COUNT(*) FROM messages WHERE conversation_id=? AND id>? AND author<>?",
                                 (cid, read["last_read_id"] if read else 0, me)).fetchone()[0]
        return {"id": cid, "kind": row["kind"], "title": row["title"], "members": members,
                "createdBy": row["created_by"], "createdAt": row["created_at"], "updatedAt": row["updated_at"],
                "unread": unread, "last": self._message(last) if last else None}

    def _create(self, kind: str, members: list[str], me: str, title: str = "") -> int:
        now = time.time()
        pair_key = "\n".join(sorted(members)) if kind == "pair" else None
        cur = self.db.execute(
            "INSERT INTO conversations(kind, title, pair_key, created_by, created_at, updated_at) VALUES (?,?,?,?,?,?)",
            (kind, title[:MAX_TITLE], pair_key, me, now, now))
        cid = cur.lastrowid
        self.db.executemany("INSERT INTO members(conversation_id, member, joined_at) VALUES (?,?,?)",
                            [(cid, member, now) for member in members])
        return cid

    # ---- conversations --------------------------------------------------------

    def list_for(self, me: str) -> list[dict]:
        with self.lock:
            rows = self.db.execute(
                "SELECT c.* FROM conversations c JOIN members m ON m.conversation_id=c.id WHERE m.member=? "
                "ORDER BY c.updated_at DESC, c.id DESC", (me,)).fetchall()
            return [self._view(row, me) for row in rows]

    def get(self, me: str, cid) -> dict:
        with self.lock:
            return self._view(self._require_member(cid, me), me)

    def start(self, me: str, others) -> tuple[dict, bool]:
        """A conversation of me + others: the existing pair if it is two of us,
        else a new one. Returns (conversation, created)."""
        members = list(dict.fromkeys([me, *[_clean_member(key) for key in (others or [])]]))
        if len(members) < 2:
            raise ValueError("Pick someone to chat with")
        if len(members) > MAX_MEMBERS:
            raise ValueError(f"A chat holds up to {MAX_MEMBERS} members")
        with self.lock, self._tx():
            if len(members) == 2:
                existing = self.db.execute("SELECT * FROM conversations WHERE pair_key=?",
                                           ("\n".join(sorted(members)),)).fetchone()
                if existing is not None:
                    return self._view(existing, me), False
                cid = self._create("pair", members, me)
            else:
                cid = self._create("group", members, me)
            return self._view(self.db.execute("SELECT * FROM conversations WHERE id=?", (cid,)).fetchone(), me), True

    def invite(self, me: str, cid, others) -> tuple[dict, bool]:
        """Add people to a group; for a pair, start a new group with everyone so
        the private chat stays as it was. Returns (conversation, created_new)."""
        with self.lock:
            row = self._require_member(cid, me)
            current = self._members(row["id"])
        new = [key for key in dict.fromkeys(_clean_member(k) for k in (others or [])) if key not in current]
        if not new:
            raise ValueError("They are already in this chat")
        if row["kind"] == "pair":
            conversation, _ = self.start(me, [key for key in current + new if key != me])
            return conversation, True
        if len(current) + len(new) > MAX_MEMBERS:
            raise ValueError(f"A chat holds up to {MAX_MEMBERS} members")
        with self.lock, self._tx():
            now = time.time()
            self.db.executemany("INSERT INTO members(conversation_id, member, joined_at) VALUES (?,?,?)",
                                [(row["id"], key, now) for key in new])
            self.db.execute("UPDATE conversations SET updated_at=? WHERE id=?", (now, row["id"]))
            return self._view(self.db.execute("SELECT * FROM conversations WHERE id=?", (row["id"],)).fetchone(), me), False

    def leave(self, me: str, cid) -> None:
        with self.lock, self._tx():
            row = self._require_member(cid, me)
            if row["kind"] == "pair":
                raise ValueError("You can't leave a private chat")
            self.db.execute("DELETE FROM members WHERE conversation_id=? AND member=?", (row["id"], me))

    def rename(self, me: str, cid, title: str) -> dict:
        with self.lock, self._tx():
            row = self._require_member(cid, me)
            if row["kind"] == "pair":
                raise ValueError("A private chat is named after the person in it")
            self.db.execute("UPDATE conversations SET title=?, updated_at=? WHERE id=?",
                            (str(title or "").strip()[:MAX_TITLE], time.time(), row["id"]))
            return self._view(self.db.execute("SELECT * FROM conversations WHERE id=?", (row["id"],)).fetchone(), me)

    def import_group(self, me: str, title: str, members, messages) -> dict:
        """Bring an old Roleplay group chat in as a group (even of two), keeping
        who said what and when. Authors must be members."""
        members = list(dict.fromkeys([me, *[_clean_member(k) for k in members]]))
        with self.lock, self._tx():
            cid = self._create("group", members, me, title)
            last = 0
            for message in messages[:5000]:
                if message["author"] not in members or not str(message.get("content", "")).strip():
                    continue
                created = float(message.get("created_at") or time.time())
                cur = self.db.execute(
                    "INSERT INTO messages(conversation_id, author, author_name, content, context_paths, created_at, state) "
                    "VALUES (?,?,?,?,?,?,?)", (cid, message["author"], str(message.get("author_name") or "")[:MAX_ALIAS],
                                               str(message["content"])[:MAX_MESSAGE], "[]", created,
                                               message.get("state") or "done"))
                last = max(last, created)
                if message["author"] == me:
                    self.db.execute("UPDATE members SET last_read_id=? WHERE conversation_id=? AND member=?", (cur.lastrowid, cid, me))
            self.db.execute("UPDATE conversations SET updated_at=?, created_at=MIN(created_at, ?) WHERE id=?",
                            (max(last, time.time() - 1), last or time.time(), cid))
            top = self.db.execute("SELECT COALESCE(MAX(id),0) FROM messages WHERE conversation_id=?", (cid,)).fetchone()[0]
            self.db.execute("UPDATE members SET last_read_id=? WHERE conversation_id=? AND member=?", (top, cid, me))
            return self._view(self.db.execute("SELECT * FROM conversations WHERE id=?", (cid,)).fetchone(), me)

    def members(self, cid) -> list[str]:
        with self.lock:
            return self._members(int(cid))

    # ---- messages ---------------------------------------------------------------

    def messages(self, me: str, cid, before=None, after=None, limit=PAGE) -> list[dict]:
        limit = max(1, min(int(limit or PAGE), 200))
        with self.lock:
            row = self._require_member(cid, me)
            if after is not None:
                rows = self.db.execute("SELECT * FROM messages WHERE conversation_id=? AND id>? ORDER BY id LIMIT ?",
                                       (row["id"], int(after), limit)).fetchall()
            else:
                rows = self.db.execute(
                    "SELECT * FROM (SELECT * FROM messages WHERE conversation_id=? AND id<? ORDER BY id DESC LIMIT ?) ORDER BY id",
                    (row["id"], int(before) if before is not None else 2 ** 62, limit)).fetchall()
            return [self._message(r) for r in rows]

    def send(self, me: str, cid, content: str, author_name: str = "", context_paths=None) -> dict:
        content = str(content or "").strip()
        if not content:
            raise ValueError("Write something first")
        with self.lock, self._tx():
            row = self._require_member(cid, me)
            message = self._insert(row["id"], me, author_name, content[:MAX_MESSAGE], context_paths)
            self.db.execute("UPDATE members SET last_read_id=? WHERE conversation_id=? AND member=?",
                            (message["id"], row["id"], me))
            return message

    def post_as(self, cid, author: str, author_name: str, content: str, state: str = "done") -> dict:
        """A message by a member who isn't a signed-in person (a character's
        reply). The author must be a member of the conversation."""
        with self.lock, self._tx():
            if author not in self._members(int(cid)):
                raise LookupError("That character is not in this chat")
            return self._insert(int(cid), author, author_name, str(content or "")[:MAX_MESSAGE], None, state)

    def _insert(self, cid: int, author: str, author_name: str, content: str, context_paths, state="done") -> dict:
        now = time.time()
        paths = [str(p) for p in (context_paths or []) if str(p).strip()][:20]
        cur = self.db.execute(
            "INSERT INTO messages(conversation_id, author, author_name, content, context_paths, created_at, state) "
            "VALUES (?,?,?,?,?,?,?)", (cid, author, str(author_name or "")[:MAX_ALIAS], content, json.dumps(paths), now, state))
        self.db.execute("UPDATE conversations SET updated_at=? WHERE id=?", (now, cid))
        return self._message(self.db.execute("SELECT * FROM messages WHERE id=?", (cur.lastrowid,)).fetchone())

    def history(self, cid, limit=60) -> list[dict]:
        """The latest messages of a conversation, for a character's reply (the
        server's own use; no member check)."""
        with self.lock:
            rows = self.db.execute(
                "SELECT * FROM (SELECT * FROM messages WHERE conversation_id=? ORDER BY id DESC LIMIT ?) ORDER BY id",
                (int(cid), int(limit))).fetchall()
            return [self._message(r) for r in rows]

    def message(self, message_id) -> dict | None:
        with self.lock:
            row = self.db.execute("SELECT * FROM messages WHERE id=?", (int(message_id),)).fetchone()
            return self._message(row) if row else None

    def mark_read(self, me: str, cid, message_id) -> None:
        with self.lock, self._tx():
            row = self._require_member(cid, me)
            top = self.db.execute("SELECT COALESCE(MAX(id), 0) FROM messages WHERE conversation_id=?", (row["id"],)).fetchone()[0]
            self.db.execute("UPDATE members SET last_read_id=MAX(last_read_id, ?) WHERE conversation_id=? AND member=?",
                            (min(int(message_id), top), row["id"], me))

    def search(self, me: str, cid, query: str, limit=30) -> list[dict]:
        words = [w for w in re.split(r"\s+", str(query or "").strip()) if w]
        if not words:
            return []
        with self.lock:
            row = self._require_member(cid, me)
            if self.fts:
                expression = " ".join('"' + w.replace('"', '""') + '"*' for w in words)
                try:
                    rows = self.db.execute(
                        "SELECT m.*, snippet(messages_fts, 0, '[', ']', '…', 12) AS snip FROM messages_fts "
                        "JOIN messages m ON m.id=messages_fts.rowid WHERE messages_fts MATCH ? AND m.conversation_id=? "
                        "ORDER BY m.id DESC LIMIT ?", (expression, row["id"], int(limit))).fetchall()
                    return [{**self._message(r), "snippet": r["snip"]} for r in rows]
                except sqlite3.OperationalError:
                    pass  # an unusual query: fall back to a plain substring search
            clauses = " AND ".join("content LIKE ? ESCAPE '\\'" for _ in words)
            params = ["%" + w.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%" for w in words]
            rows = self.db.execute(f"SELECT * FROM messages WHERE conversation_id=? AND {clauses} ORDER BY id DESC LIMIT ?",
                                   (row["id"], *params, int(limit))).fetchall()
            return [{**self._message(r), "snippet": r["content"][:160]} for r in rows]

    # ---- private contact notes ---------------------------------------------------

    def notes_for(self, me: str) -> dict:
        with self.lock:
            rows = self.db.execute("SELECT contact, alias, note, updated_at FROM contact_notes WHERE owner=?", (me,))
            return {r["contact"]: {"alias": r["alias"], "note": r["note"], "updatedAt": r["updated_at"]} for r in rows}

    def set_note(self, me: str, contact: str, alias: str = "", note: str = "") -> dict:
        contact = _clean_member(contact)
        alias = str(alias or "").strip()[:MAX_ALIAS]
        note = str(note or "").strip()[:MAX_NOTE]
        with self.lock, self._tx():
            if not alias and not note:
                self.db.execute("DELETE FROM contact_notes WHERE owner=? AND contact=?", (me, contact))
            else:
                self.db.execute("INSERT INTO contact_notes(owner, contact, alias, note, updated_at) VALUES (?,?,?,?,?) "
                                "ON CONFLICT(owner, contact) DO UPDATE SET alias=excluded.alias, note=excluded.note, "
                                "updated_at=excluded.updated_at", (me, contact, alias, note, time.time()))
        return {"alias": alias, "note": note}

    # ---- characters follow their files -----------------------------------------------

    def rename_character_paths(self, old_path: str, new_path: str) -> int:
        """A character file (or a folder holding some) moved: follow it in
        members, authors, pair keys and notes. Returns rows changed."""
        old_path, new_path = str(old_path).strip("/"), str(new_path).strip("/")
        if not old_path or old_path == new_path:
            return 0

        def moved(key: str) -> str | None:
            if not key.startswith("char:"):
                return None
            path = key[5:]
            if path == old_path:
                return char_key(new_path)
            if path.startswith(old_path + "/"):
                return char_key(new_path + path[len(old_path):])
            return None

        changed = 0
        with self.lock, self._tx():
            for row in self.db.execute("SELECT conversation_id, member FROM members WHERE member LIKE 'char:%'").fetchall():
                target = moved(row["member"])
                if target:
                    self.db.execute("UPDATE OR REPLACE members SET member=? WHERE conversation_id=? AND member=?",
                                    (target, row["conversation_id"], row["member"]))
                    changed += 1
            for row in self.db.execute("SELECT DISTINCT author FROM messages WHERE author LIKE 'char:%'").fetchall():
                target = moved(row["author"])
                if target:
                    changed += self.db.execute("UPDATE messages SET author=? WHERE author=?", (target, row["author"])).rowcount
            for row in self.db.execute("SELECT id FROM conversations WHERE kind='pair'").fetchall():
                key = "\n".join(sorted(self._members(row["id"])))
                self.db.execute("UPDATE OR IGNORE conversations SET pair_key=? WHERE id=?", (key, row["id"]))
            for row in self.db.execute("SELECT owner, contact FROM contact_notes WHERE contact LIKE 'char:%'").fetchall():
                target = moved(row["contact"])
                if target:
                    self.db.execute("UPDATE OR REPLACE contact_notes SET contact=? WHERE owner=? AND contact=?",
                                    (target, row["owner"], row["contact"]))
                    changed += 1
        return changed

    def backup_to(self, target: Path) -> None:
        """A consistent copy of the database (SQLite's online backup)."""
        target.parent.mkdir(parents=True, exist_ok=True)
        with self.lock:
            copy = sqlite3.connect(str(target))
            try:
                self.db.backup(copy)
            finally:
                copy.close()


class _Transaction:
    """BEGIN IMMEDIATE … COMMIT/ROLLBACK, re-entrant on the same store."""

    def __init__(self, store: ProjectChats):
        self.store = store

    def __enter__(self):
        if not self.store.db.in_transaction:
            self.store.db.execute("BEGIN IMMEDIATE")
            self.owner = True
        else:
            self.owner = False
        return self

    def __exit__(self, exc_type, exc, tb):
        if self.owner:
            self.store.db.execute("ROLLBACK" if exc_type else "COMMIT")
            if not exc_type:
                self.store.version += 1
        return False


class ReplyQueue:
    """Characters' replies, run in worker threads: one at a time per
    conversation (so each character sees the replies before theirs), never the
    same (message, character) twice, and stoppable per conversation."""

    def __init__(self, run, workers: int = 2):
        self.run = run  # run(job, cancelled: () -> bool) -> None
        self.lock = threading.Lock()
        self.pending: dict[str, deque] = {}
        self.active: set[str] = set()
        self.cancelled: set[str] = set()
        self.seen: set[tuple] = set()
        self.pool = ThreadPoolExecutor(max_workers=workers, thread_name_prefix="chat-reply")

    def submit(self, conversation: str, jobs) -> list:
        accepted = []
        with self.lock:
            for job in jobs:
                key = (conversation, job["trigger"], job["character"])
                if key in self.seen:
                    continue
                self.seen.add(key)
                self.pending.setdefault(conversation, deque()).append(job)
                accepted.append(job)
            if accepted and conversation not in self.active:
                self.active.add(conversation)
                self.cancelled.discard(conversation)
                self.pool.submit(self._drain, conversation)
        return accepted

    def busy(self, conversation: str) -> bool:
        with self.lock:
            return conversation in self.active

    def cancel(self, conversation: str) -> bool:
        with self.lock:
            if conversation not in self.active:
                return False
            self.pending.pop(conversation, None)
            self.cancelled.add(conversation)
            return True

    def _drain(self, conversation: str) -> None:
        while True:
            with self.lock:
                queue = self.pending.get(conversation)
                if not queue or conversation in self.cancelled:
                    self.pending.pop(conversation, None)
                    self.active.discard(conversation)
                    self.cancelled.discard(conversation)
                    return
                job = queue.popleft()
            try:
                self.run(job, lambda: conversation in self.cancelled)
            except Exception:  # noqa: BLE001 — the runner reports its own failures
                pass

    def shutdown(self) -> None:
        self.pool.shutdown(wait=False, cancel_futures=True)
