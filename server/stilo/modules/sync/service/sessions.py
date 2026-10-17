"""Who is in one workspace right now: session tokens and their roles,
presence, leases (a heartbeat; a silent session is closed after 75 s), and
the event queue each open stream reads. Events go to every stream, or only
to some accounts' streams. In memory; a restart starts empty."""
import queue
import secrets
import time
import uuid

from stilo.kernel.log import log as _log

LEASE_SECONDS = 75


class Sessions:
    def __init__(self, lock, revision):
        """lock: the workspace's lock (mutations and joins are atomic together);
        revision(): the workspace's current revision."""
        self.lock = lock
        self._revision = revision
        self.tokens: dict[str, str] = {}       # token -> client id
        self.presence: dict[str, dict] = {}    # token -> {clientId, displayName, connectedAt, user, device}
        self.leases: dict[str, float] = {}     # token -> last heartbeat (monotonic)
        self.subscribers: dict[str, queue.Queue] = {}
        self.roles: dict[str, str] = {}        # token -> master | editor | reader | client

    # ---- joining and leaving ------------------------------------------------

    def admit(self, display_name: str, role: str, identity: str | None = None, device: str | None = None,
              leased: bool = False) -> dict:
        """A token and a presence for someone already allowed in. The same
        account on the same device replaces its old session (see evict); on
        another device it is a second presence."""
        token = secrets.token_urlsafe(24)
        client_id = f"client-{uuid.uuid4().hex[:12]}"
        display_name = display_name.strip()[:40] or f"Peer {client_id[-4:]}"
        with self.lock:
            self.tokens[token] = client_id
            self.presence[token] = {"clientId": client_id, "displayName": display_name, "connectedAt": time.time(),
                                    "user": identity, "device": device}
            self.roles[token] = role
            if leased:
                self.leases[token] = time.monotonic()
        _log("CONNECT", f"{display_name} joined as {role}", clientId=client_id, revision=self._revision())
        self.broadcast_presence(f"{display_name} joined the session.")
        return {"token": token, "clientId": client_id, "displayName": display_name, "revision": self._revision(),
                "sessionId": "default", "role": role}

    def evict(self, identity: str, device: str | None = None) -> None:
        """Drop earlier sessions of this account (on this device, when given), so a
        reload does not leave a ghost presence. Their streams end on their next write."""
        if not identity:
            return
        with self.lock:
            stale = [token for token, entry in self.presence.items()
                     if entry.get("user") == identity and (device is None or entry.get("device") == device)]
            for token in stale:
                self._forget(token)
        if stale:
            self.broadcast_presence("Replaced a duplicate session.")

    def _forget(self, token: str) -> None:
        for table in (self.presence, self.leases, self.tokens, self.roles, self.subscribers):
            table.pop(token, None)

    def authorize(self, token: str) -> str:
        with self.lock:
            client_id = self.tokens.get(token)
        if not client_id:
            raise PermissionError("Invalid or expired session token")
        return client_id

    def role(self, token: str) -> str | None:
        with self.lock:
            return self.roles.get(token)

    def name_of(self, token: str, client_id: str = "") -> str:
        return self.presence.get(token, {}).get("displayName", client_id[-8:] if client_id else f"…{token[-4:]}")

    def get_presence(self) -> list[dict]:
        with self.lock:
            return list(self.presence.values())

    # ---- streams --------------------------------------------------------------

    def subscribe(self, token: str, leased: bool = False) -> queue.Queue:
        """A queue of this workspace's events, starting with "ready" at the
        current revision (registered atomically with changes, so the client can
        compare it with the state it fetched)."""
        client_id = self.authorize(token)
        events = queue.Queue()
        with self.lock:
            events.put({"type": "ready", "clientId": client_id, "revision": self._revision(), "serverTime": time.time()})
            self.subscribers[token] = events
            if leased:
                self.leases[token] = time.monotonic()
        return events

    def renew_lease(self, token: str) -> None:
        with self.lock:
            self.authorize(token)
            if token in self.leases:
                self.leases[token] = time.monotonic()

    def lease_expired(self, token: str) -> bool:
        return token in self.leases and time.monotonic() - self.leases[token] > LEASE_SECONDS

    def should_close(self, token: str) -> bool:
        with self.lock:
            return token not in self.tokens or self.lease_expired(token)

    def unsubscribe(self, token: str, expected_queue=None, expired_only=False, revoke=False) -> bool:
        """Close a stream (only that queue, when given; only if its lease ran out,
        when asked). The presence goes; with revoke, the token too."""
        with self.lock:
            if expected_queue is not None and self.subscribers.get(token) is not expected_queue:
                return False
            if expired_only and not self.lease_expired(token):
                return False
            had_token = token in self.tokens
            self.subscribers.pop(token, None)
            if revoke:  # a role lasts as long as its token, not as long as one stream
                self.leases.pop(token, None)
                self.tokens.pop(token, None)
                self.roles.pop(token, None)
            presence = self.presence.pop(token, None)
        if presence:
            _log("DISCONNECT", f"{presence['displayName']} left", clientId=presence["clientId"])
            self.broadcast_presence(f"{presence['displayName']} left the session.")
        return had_token

    # ---- events ---------------------------------------------------------------

    def broadcast(self, event: dict, exclude_token: str | None = None) -> None:
        with self.lock:
            targets = [q for token, q in self.subscribers.items() if token != exclude_token]
        for target in targets:
            target.put(event)

    def broadcast_to_users(self, usernames, event: dict) -> None:
        """Only to the streams of these accounts (private chats)."""
        wanted = set(usernames)
        with self.lock:
            targets = [q for token, q in self.subscribers.items() if self.presence.get(token, {}).get("user") in wanted]
        for target in targets:
            target.put(event)

    def broadcast_presence(self, message: str) -> None:
        self.broadcast({"type": "presence", "presence": self.get_presence(), "message": message,
                        "serverTime": time.time(), "revision": self._revision()})

    def listeners(self, token: str) -> list[str]:
        """Names of everyone else with an open stream (for the log)."""
        with self.lock:
            return [self.name_of(other) for other in self.subscribers if other != token]

    def cursor(self, token: str, file_id: str, sel_start: int, sel_end: int) -> None:
        client_id = self.authorize(token)
        with self.lock:
            name = self.presence.get(token, {}).get("displayName", "")
            count = sum(1 for other in self.subscribers if other != token)
        self.broadcast({"type": "cursor", "clientId": client_id, "displayName": name, "fileId": file_id,
                        "selStart": int(sel_start), "selEnd": int(sel_end), "serverTime": time.time()}, exclude_token=token)
        _log("CURSOR", f"from={name!r}  fileId={file_id!r}  sel={sel_start}–{sel_end}  to={count} peer(s)")
