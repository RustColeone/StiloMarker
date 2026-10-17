"""Chats as callers ask for them: every request names the account (its token)
and the project, and only members of a conversation see it. Characters'
replies run on the server (one after another, each seeing the replies
before it, streamed to every member), or in a member's own browser (with
their key or a local model): then the server holds a claim, hands out the
prompt, relays the progress and stores the result; a claim that goes quiet
is closed with what was written.

places (today the server's WorkspaceRegistry):
    authorize_project(token, team, path) -> (identity, team, relpath)
    project_dir(team, relpath) -> the project's folder
    project_copy(team, relpath) -> a copy of the project (live, or read from disk)
    live(team, relpath) -> the open shared workspace, or None
    people(team, relpath) -> usernames of everyone who may open the project
    place_of(workspace) -> (team, relpath), or None
runner (set once the agent exists): build_persona_payload(...) and
    chat(..., persona=, cast=) of the server's agent (ChatProxy).
"""
import threading
import time

from stilo.kernel.log import log as _log
from stilo.modules.characters import persona_handle, persona_header, persona_summary, split_author_notes
from stilo.modules.file_types import BUILTIN as FILE_TYPES
from stilo.modules.workspace import node_id_by_path, path_of
from ..adapters.store import DB_NAME, ProjectChats
from ..model.members import char_key, responders, user_key
from .replies import ReplyQueue

TYPING_INTERVAL = 0.25  # seconds between live updates of a reply being written
CLAIM_SECONDS = 60      # a browser writing a reply must report progress at least this often
BACKUP_DAYS = 14


class ChatsDesk:
    def __init__(self, places):
        self._places = places
        self.runner = None
        self.typing_interval = TYPING_INTERVAL
        self.on_message = None   # tests stand in their own reply hook: (desk, team, relpath, conversation, message, identity, options)
        self._stores: dict[str, ProjectChats] = {}
        self._stores_lock = threading.Lock()
        self.replies = ReplyQueue(self._run_reply)
        self._claims: dict = {}  # (workspace, conversation, trigger, character) -> claim
        self._claims_lock = threading.Lock()

    # ---- stores -----------------------------------------------------------------

    def store(self, team: str, relpath: str) -> ProjectChats:
        workspace_id = f"{team}/{relpath}"
        with self._stores_lock:
            store = self._stores.get(workspace_id)
            if store is None:
                store = ProjectChats(self._places.project_dir(team, relpath) / DB_NAME)
                self._stores[workspace_id] = store
            return store

    def close(self, workspace_id: str = None) -> None:
        """Close the databases of a project (and everything under it), or all."""
        with self._stores_lock:
            for wid in [w for w in self._stores if workspace_id is None or w == workspace_id or w.startswith(workspace_id + "/")]:
                try:
                    self._stores.pop(wid).close()
                except Exception:  # noqa: BLE001
                    pass

    def paths_moved(self, workspace, old_path: str, new_path: str) -> None:
        """A renamed or moved character file: its chats follow it."""
        place = self._places.place_of(workspace)
        if place is None:
            return
        team, relpath = place
        if not (self._places.project_dir(team, relpath) / DB_NAME).exists() and f"{team}/{relpath}" not in self._stores:
            return  # no chats yet: nothing to follow
        if self.store(team, relpath).rename_character_paths(old_path, new_path):
            workspace.broadcast({"type": "chat-update", "reason": "characters-moved", "serverTime": time.time()})

    def backup(self, folder_of, now=None) -> None:
        """A daily copy of each open project's chats, on days they changed.
        folder_of(team, relpath) -> where the copies go."""
        day = time.strftime("%Y-%m-%d", time.gmtime(time.time() if now is None else now))
        with self._stores_lock:
            stores = list(self._stores.items())
        for workspace_id, store in stores:
            if getattr(store, "backed_up_version", None) == store.version:
                continue
            team, relpath = workspace_id.split("/", 1)
            try:
                folder = folder_of(team, relpath)
                store.backup_to(folder / f"{day}.sqlite")
                store.backed_up_version = store.version
                for old in sorted(folder.glob("*.sqlite"))[:-BACKUP_DAYS]:
                    old.unlink(missing_ok=True)
            except Exception as error:  # noqa: BLE001
                _log("BACKUP", f"chat backup failed for {workspace_id}: {error}")

    # ---- who can be in a chat -------------------------------------------------------

    def characters(self, team: str, relpath: str, project: dict | None = None) -> list[dict]:
        project = project or self._places.project_copy(team, relpath)
        out = []
        for node_id, node in project.get("nodes", {}).items():
            name = node.get("name", "")
            if node.get("kind") != "file" or not FILE_TYPES.is_type(name, "persona"):
                continue
            path = path_of(project, node_id)
            header = persona_header(node.get("content", ""))["header"]
            out.append({"key": char_key(path), "path": path, "content": node.get("content", ""), "handle": persona_handle(path),
                        "name": (str(header.get("name") or "").strip() or FILE_TYPES.base_name(name))[:80]})
        return sorted(out, key=lambda c: c["name"].lower())

    def people(self, team: str, relpath: str) -> list[dict]:
        workspace = self._places.live(team, relpath)
        online = set()
        if workspace is not None:
            online = {entry.get("user") for entry in workspace.get_presence() if entry.get("user")}
        return [{"key": user_key(username), "username": username, "name": username, "online": username in online}
                for username in sorted(self._places.people(team, relpath), key=str.lower)]

    def _context(self, token, team, path):
        identity, team, relpath = self._places.authorize_project(token, team, path)
        return identity, team, relpath, self.store(team, relpath), user_key(identity["username"])

    def _members(self, team, relpath, keys) -> list[str]:
        """Only people with access and characters that exist may join a chat."""
        allowed = {p["key"] for p in self.people(team, relpath)} | {c["key"] for c in self.characters(team, relpath)}
        out = []
        for key in keys or []:
            if str(key) not in allowed:
                raise ValueError("Someone you picked isn't in this project")
            out.append(str(key))
        return out

    def notify(self, team, relpath, store, conversation_id, event: dict) -> None:
        """Tell the members of a conversation (only them) on the live stream."""
        workspace = self._places.live(team, relpath)
        if workspace is None:
            return
        users = [key[5:] for key in store.members(conversation_id) if key.startswith("user:")]
        try:
            workspace.broadcast_to_users(users, {**event, "conversationId": int(conversation_id), "serverTime": time.time()})
        except Exception:  # noqa: BLE001 - telling others never fails the change itself
            pass

    # ---- conversations ------------------------------------------------------------

    def overview(self, token, team, path) -> dict:
        _, team, relpath, store, me = self._context(token, team, path)
        characters = [{k: v for k, v in c.items() if k != "content"} for c in self.characters(team, relpath)]
        return {"me": me, "conversations": store.list_for(me), "people": self.people(team, relpath),
                "characters": characters, "notes": store.notes_for(me)}

    def messages(self, token, team, path, conversation_id, before=None, after=None) -> dict:
        _, team, relpath, store, me = self._context(token, team, path)
        return {"conversation": store.get(me, conversation_id),
                "messages": store.messages(me, conversation_id, before=before, after=after)}

    def start(self, token, team, path, members) -> dict:
        _, team, relpath, store, me = self._context(token, team, path)
        conversation, created = store.start(me, self._members(team, relpath, members))
        if created:
            self.notify(team, relpath, store, conversation["id"], {"type": "chat-update", "reason": "created"})
        return {"conversation": conversation, "created": created}

    def send(self, token, team, path, conversation_id, content, context_paths=None, options=None) -> dict:
        identity, team, relpath, store, me = self._context(token, team, path)
        message = store.send(me, conversation_id, content, identity["username"], context_paths)
        self.notify(team, relpath, store, conversation_id, {"type": "chat-message", "message": message})
        conversation = store.get(me, conversation_id)
        options = dict(options or {})
        replies = (self.on_message or ChatsDesk._queue_replies)(self, team, relpath, conversation, message, identity, options) or []
        return {"message": message, "conversation": conversation, "replies": replies, "claims": options.get("claims", [])}

    def invite(self, token, team, path, conversation_id, members) -> dict:
        _, team, relpath, store, me = self._context(token, team, path)
        conversation, created = store.invite(me, conversation_id, self._members(team, relpath, members))
        self.notify(team, relpath, store, conversation["id"], {"type": "chat-update", "reason": "members"})
        return {"conversation": conversation, "created": created}

    def leave(self, token, team, path, conversation_id) -> dict:
        _, team, relpath, store, me = self._context(token, team, path)
        store.leave(me, conversation_id)
        self.notify(team, relpath, store, conversation_id, {"type": "chat-update", "reason": "members"})
        return {"left": True}

    def rename(self, token, team, path, conversation_id, title) -> dict:
        _, team, relpath, store, me = self._context(token, team, path)
        conversation = store.rename(me, conversation_id, title)
        self.notify(team, relpath, store, conversation_id, {"type": "chat-update", "reason": "title"})
        return {"conversation": conversation}

    def read(self, token, team, path, conversation_id, message_id) -> dict:
        _, team, relpath, store, me = self._context(token, team, path)
        store.mark_read(me, conversation_id, message_id)
        return {"conversation": store.get(me, conversation_id)}

    def search(self, token, team, path, conversation_id, query) -> dict:
        _, team, relpath, store, me = self._context(token, team, path)
        return {"results": store.search(me, conversation_id, query)}

    def note(self, token, team, path, contact, alias=None, note=None) -> dict:
        _, team, relpath, store, me = self._context(token, team, path)
        if alias is None and note is None:
            return store.notes_for(me).get(str(contact), {"alias": "", "note": ""})
        return store.set_note(me, contact, alias or "", note or "")

    def import_group(self, token, team, path, title, characters, messages) -> dict:
        """One old Roleplay group chat becomes a group conversation of the
        importer and its characters."""
        identity, team, relpath, store, me = self._context(token, team, path)
        existing = {c["path"] for c in self.characters(team, relpath)}
        members = [char_key(p) for p in dict.fromkeys(str(p) for p in (characters or [])) if p in existing]
        rows = []
        for message in (messages or [])[:5000]:
            if not isinstance(message, dict):
                continue
            role, speaker = message.get("role"), str(message.get("speaker") or "")
            if role == "user":
                author, name = me, str(message.get("authorName") or identity["username"])
            elif role == "assistant" and char_key(speaker) in members:
                author, name = char_key(speaker), str(message.get("speakerName") or "")
            else:
                continue
            created = message.get("createdAt")
            rows.append({"author": author, "author_name": name, "content": str(message.get("content", "")),
                         "created_at": (float(created) / 1000 if isinstance(created, (int, float)) and created > 1e11 else created),
                         "state": "interrupted" if message.get("interrupted") else "done"})
        return {"conversation": store.import_group(me, str(title or "")[:120], members, rows)}

    def stop(self, token, team, path, conversation_id) -> dict:
        _, team, relpath, store, me = self._context(token, team, path)
        store.get(me, conversation_id)  # members only
        return {"stopped": self.replies.cancel(f"{team}/{relpath}#{int(conversation_id)}")}

    # ---- characters' replies, on the server ---------------------------------------

    @staticmethod
    def _queue_replies(desk, team, relpath, conversation, message, identity, options):
        """A private chat with a character: it answers every message. A group:
        the characters @mentioned answer (@all = all of them), in order."""
        if not message["author"].startswith("user:"):
            return []
        characters = desk.characters(team, relpath)
        keys = responders(conversation, message, characters)
        if not keys:
            return []
        if options.get("runner") == "client":
            return desk._claim(team, relpath, conversation, message, identity, characters, keys, options)
        if desk.runner is None:
            return []
        jobs = [{"team": team, "relpath": relpath, "conversation": conversation["id"], "character": key,
                 "trigger": message["id"], "model": options.get("model"), "identity": identity} for key in keys]
        accepted = desk.replies.submit(f"{team}/{relpath}#{conversation['id']}", jobs)
        store = desk.store(team, relpath)
        for job in accepted:  # everyone sees who is about to answer
            name = next((c["name"] for c in characters if c["key"] == job["character"]), "")
            desk.notify(team, relpath, store, conversation["id"],
                        {"type": "chat-typing", "character": job["character"], "name": name, "state": "queued", "text": ""})
        return [job["character"] for job in accepted]

    def reply_context(self, team, relpath, cid, char, trigger_id) -> dict | None:
        """What a reply is built from: the character's sheet, the others in the
        chat, this conversation as the transcript, the files attached to the
        message that asked, and the project. None if the character is gone."""
        store = self.store(team, relpath)
        project = self._places.project_copy(team, relpath)
        characters = self.characters(team, relpath, project)
        character = next((c for c in characters if c["key"] == char), None)
        members = store.members(cid)
        if character is None or char not in members:
            return None
        names = {c["key"]: c["name"] for c in characters}
        transcript = [{"name": names.get(m["author"], m["authorName"] or m["author"].split(":", 1)[-1]),
                       "content": m["content"], "self": m["author"] == char}
                      for m in store.history(cid) if m["state"] == "done"]
        cast = [{"name": c["name"], "summary": persona_summary(split_author_notes(persona_header(c["content"])["body"])["sheet"])}
                for c in characters if c["key"] in members]
        context_files = []
        for path in (store.message(trigger_id) or {}).get("contextPaths", []):
            node_id = node_id_by_path(project, path)
            node = project.get("nodes", {}).get(node_id) if node_id else None
            if node and node.get("kind") == "file":
                image = FILE_TYPES.is_image(node.get("name", ""))
                context_files.append({"path": path, "kind": "image" if image else "text", "content": "" if image else node.get("content", "")})
        header = persona_header(character["content"])["header"]
        return {"store": store, "project": project, "character": character, "transcript": transcript, "cast": cast,
                "context_files": context_files,
                "persona": {"path": character["path"], "name": character["name"], "content": character["content"],
                            "temperature": header.get("temperature")}}

    def _run_reply(self, job: dict, cancelled) -> None:
        team, relpath, cid, char = job["team"], job["relpath"], job["conversation"], job["character"]
        context = self.reply_context(team, relpath, cid, char, job["trigger"])
        store = self.store(team, relpath)
        if context is None:
            self.notify(team, relpath, store, cid, {"type": "chat-typing", "character": char, "state": "end", "text": ""})
            return
        character = context["character"]
        state = {"text": "", "last": 0.0}

        def typing(text_state="writing"):
            self.notify(team, relpath, store, cid, {"type": "chat-typing", "character": char, "name": character["name"],
                                                    "state": text_state, "text": state["text"]})

        def progress(event):
            if event.get("type") == "status":
                state["text"] = ""
            elif event.get("type") == "delta":
                state["text"] += event.get("text", "")
            elif event.get("type") != "tool":
                return
            now = time.monotonic()
            if now - state["last"] >= self.typing_interval:
                state["last"] = now
                typing("reading" if event.get("type") == "tool" else "writing")

        typing("writing")
        try:
            if self.runner is None:
                raise RuntimeError("Replies are not available on this server.")
            result = self.runner.chat(context["transcript"], context["context_files"], relpath.rsplit("/", 1)[-1],
                                      context["project"], progress=progress, model=job.get("model"), cancelled=cancelled,
                                      identity=job.get("identity"), persona=context["persona"], cast=context["cast"])
            message = store.post_as(cid, char, character["name"], result["message"])
        except Exception as error:  # noqa: BLE001 - the failure becomes a visible message
            partial = state["text"].strip()
            if cancelled():
                content, outcome = (partial or "(stopped before replying)"), "interrupted"
            else:
                content, outcome = f"{character['name']} could not reply: {error}", "error"
            message = store.post_as(cid, char, character["name"], content, outcome)
        typing("end")
        self.notify(team, relpath, store, cid, {"type": "chat-message", "message": message})

    # ---- characters' replies, in a member's own browser ------------------------------

    def _claim(self, team, relpath, conversation, message, identity, characters, keys, options):
        store = self.store(team, relpath)
        claims = []
        with self._claims_lock:
            for key in keys:
                claim_key = (f"{team}/{relpath}", conversation["id"], message["id"], key)
                if claim_key in self._claims:
                    continue
                name = next((c["name"] for c in characters if c["key"] == key), "")
                self._claims[claim_key] = {"user": identity["username"], "touched": time.monotonic(), "text": "", "name": name}
                claims.append({"character": key, "trigger": message["id"], "name": name})
        for claim in claims:
            self.notify(team, relpath, store, conversation["id"],
                        {"type": "chat-typing", "character": claim["character"], "name": claim["name"], "state": "queued", "text": ""})
        options["claims"] = claims
        return [claim["character"] for claim in claims]

    def _my_claim(self, team, relpath, cid, trigger, char, username) -> dict:
        claim = self._claims.get((f"{team}/{relpath}", int(cid), int(trigger), str(char)))
        if claim is None or claim["user"] != username:
            raise LookupError("That reply isn't yours to write (or it timed out)")
        return claim

    def prompt(self, token, team, path, conversation_id, character, trigger) -> dict:
        identity, team, relpath, store, me = self._context(token, team, path)
        store.get(me, conversation_id)  # members only
        with self._claims_lock:
            self._my_claim(team, relpath, conversation_id, trigger, character, identity["username"])["touched"] = time.monotonic()
        context = self.reply_context(team, relpath, int(conversation_id), str(character), int(trigger))
        if context is None or self.runner is None:
            raise LookupError("That character is no longer in this chat")
        payload, _ = self.runner.build_persona_payload(context["transcript"], context["context_files"], relpath.rsplit("/", 1)[-1],
                                                       context["project"], context["persona"], context["cast"], "")
        for key in ("model", "thinking", "reasoning_effort"):
            payload.pop(key, None)
        return {"payload": payload, "name": context["character"]["name"]}

    def typing(self, token, team, path, conversation_id, character, trigger, text, state="writing") -> dict:
        identity, team, relpath, store, me = self._context(token, team, path)
        with self._claims_lock:
            claim = self._my_claim(team, relpath, conversation_id, trigger, character, identity["username"])
            claim.update(touched=time.monotonic(), text=str(text or "")[:16000])
        self.notify(team, relpath, store, conversation_id, {"type": "chat-typing", "character": str(character), "name": claim["name"],
                                                            "state": "reading" if state == "reading" else "writing", "text": claim["text"]})
        return {"ok": True}

    def reply(self, token, team, path, conversation_id, character, trigger, content, state="done") -> dict:
        identity, team, relpath, store, me = self._context(token, team, path)
        with self._claims_lock:
            claim = self._my_claim(team, relpath, conversation_id, trigger, character, identity["username"])
            self._claims.pop((f"{team}/{relpath}", int(conversation_id), int(trigger), str(character)), None)
        state = state if state in ("done", "interrupted", "error") else "done"
        text = str(content or "").strip() or ("(stopped before replying)" if state != "done" else "")
        if not text:
            raise ValueError("The reply is empty")
        message = store.post_as(int(conversation_id), str(character), claim["name"], text, state)
        self.notify(team, relpath, store, conversation_id, {"type": "chat-typing", "character": str(character), "state": "end", "text": ""})
        self.notify(team, relpath, store, conversation_id, {"type": "chat-message", "message": message})
        return {"message": message}

    def expire_claims(self, now=None) -> int:
        """Replies whose browser went away: keep what was written, marked stopped."""
        now = time.monotonic() if now is None else now
        with self._claims_lock:
            stale = [(key, claim) for key, claim in self._claims.items() if now - claim["touched"] > CLAIM_SECONDS]
            for key, _ in stale:
                self._claims.pop(key, None)
        for (workspace_id, cid, _, char), claim in stale:
            team, relpath = workspace_id.split("/", 1)
            try:
                store = self.store(team, relpath)
                message = store.post_as(cid, char, claim["name"], claim["text"].strip() or "(the reply was interrupted)", "interrupted")
                self.notify(team, relpath, store, cid, {"type": "chat-typing", "character": char, "state": "end", "text": ""})
                self.notify(team, relpath, store, cid, {"type": "chat-message", "message": message})
            except Exception as error:  # noqa: BLE001
                _log("CHATS", f"could not close an expired reply: {error}")
        return len(stale)

    def shutdown(self) -> None:
        self.replies.shutdown()
        self.close()
