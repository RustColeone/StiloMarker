"""The backend self-test: one server end to end over HTTP and the event
stream (PIN sessions, patches and their rebase, stale writes refused, accounts,
team workspaces, access, readers, backups, snapshots, publishing). It lived in
mdnotes_server.py (--selftest) until 2026-10-17.

    python3 -B tests/backend-selftest.py
"""
import json
import sys
import threading
import time
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "server"))
from mdnotes_server import EDIT_SESSION_GAP_SECONDS, SYNC_LEVEL, AccountStore, WorkspaceRegistry, build_server  # noqa: E402
from stilo.modules.sync import open_live  # noqa: E402
from stilo.modules.workspace import bump_edit_counters, default_project, node_id_by_path  # noqa: E402
from stilo.modules.identity import ACCESS_FILE  # noqa: E402


def run_selftest():
    static_root = Path(__file__).resolve().parents[1]
    state_file = static_root / "server" / "test-session-state.json"
    if state_file.exists():
        state_file.unlink()
    server = build_server("127.0.0.1", 0, "2468", static_root, state_file)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    host, port = server.server_address
    base_url = f"http://{host}:{port}"

    try:
        ping = json.loads(urlopen(f"{base_url}/api/ping").read().decode("utf-8"))
        assert ping["message"] == "pong"

        chat_status = json.loads(urlopen(f"{base_url}/api/chat/status").read().decode("utf-8"))
        assert "configured" in chat_status
        assert "localOnly" in chat_status

        connect_request = Request(
            f"{base_url}/api/session/connect",
            data=json.dumps({"pin": "2468", "displayName": "Tester"}).encode("utf-8"),
            headers={"Content-Type": "application/json"},
            method="POST"
        )
        session = json.loads(urlopen(connect_request).read().decode("utf-8"))
        token = session["token"]
        assert session["displayName"] == "Tester"

        state = json.loads(urlopen(f"{base_url}/api/session/state?token={token}").read().decode("utf-8"))
        assert state["project"]["name"] == "Workspace"
        assert len(state["presence"]) == 1

        def read_stream(result_container):
            with urlopen(f"{base_url}/api/events/stream?token={token}") as response:
                for raw_line in response:
                    if raw_line.startswith(b"data: "):
                        result_container.append(json.loads(raw_line[6:].decode("utf-8")))
                        if result_container[-1]["type"] == "operation":
                            break

        events = []
        stream_thread = threading.Thread(target=read_stream, args=(events,), daemon=True)
        stream_thread.start()
        time.sleep(0.2)

        state_request = Request(
            f"{base_url}/api/operations?token={token}",
            data=json.dumps({"version": SYNC_LEVEL, "operation": {"type": "create-file", "parentPath": "", "name": "shared.md", "content": "# Shared"}}).encode("utf-8"),
            headers={"Content-Type": "application/json"},
            method="POST"
        )
        update_response = json.loads(urlopen(state_request).read().decode("utf-8"))
        assert update_response["revision"] == 1

        stream_thread.join(timeout=3)
        assert any(event["type"] == "operation" for event in events)
        snapshot = json.loads(urlopen(f"{base_url}/api/session/state?token={token}").read().decode("utf-8"))
        assert any(node["name"] == "shared.md" for node in snapshot["project"]["nodes"].values())

        patch_request = Request(
            f"{base_url}/api/operations?token={token}",
            data=json.dumps({"version": SYNC_LEVEL, "operation": {"type": "patch-file", "path": "shared.md", "start": 8, "end": 8, "removedText": "", "text": " live", "baseRevision": 1}}).encode("utf-8"),
            headers={"Content-Type": "application/json"},
            method="POST"
        )
        patch_response = json.loads(urlopen(patch_request).read().decode("utf-8"))
        assert patch_response["revision"] == 2

        snapshot = json.loads(urlopen(f"{base_url}/api/session/state?token={token}").read().decode("utf-8"))
        shared_file = next(node for node in snapshot["project"]["nodes"].values() if node.get("name") == "shared.md")
        assert shared_file["content"] == "# Shared live"
        persisted = json.loads(state_file.read_text(encoding="utf-8"))
        assert persisted["revision"] == 2

        # --- stale-write gate over HTTP: a conflict must be 409, so the client
        # PULLS the newer copy instead of silently diverging. ---
        for _bad in ({"type": "update-file", "path": "shared.md", "content": "CLOBBER"},                  # no base version
                     {"type": "update-file", "path": "shared.md", "content": "CLOBBER", "baseRevision": 0}):  # stale base
            _req = Request(
                f"{base_url}/api/operations?token={token}",
                data=json.dumps({"version": SYNC_LEVEL, "operation": _bad}).encode("utf-8"),
                headers={"Content-Type": "application/json"}, method="POST")
            try:
                urlopen(_req)
                assert False, "stale/unguarded whole-file write should be refused"
            except HTTPError as _e:
                _body = _e.read().decode("utf-8", "replace")
                assert _e.code == 409, f"expected 409 so the client pulls, got {_e.code}: {_body}"
        _after = json.loads(urlopen(f"{base_url}/api/session/state?token={token}").read().decode("utf-8"))
        _shared = next(n for n in _after["project"]["nodes"].values() if n.get("name") == "shared.md")
        assert "CLOBBER" not in _shared["content"], "refused write must not reach the document"

        # --- stale-client gate: an operation with no client version is refused ---
        stale_req = Request(
            f"{base_url}/api/operations?token={token}",
            data=json.dumps({"operation": {"type": "patch-file", "path": "shared.md", "start": 0, "end": 0, "removedText": "", "text": "x", "baseRevision": 2}}).encode("utf-8"),
            headers={"Content-Type": "application/json"},
            method="POST"
        )
        try:
            urlopen(stale_req)
            assert False, "stale client (no version) should be refused with 426"
        except HTTPError as stale_err:
            assert stale_err.code == 426, f"expected 426 for stale client, got {stale_err.code}"
        # State must be untouched by the refused request.
        assert json.loads(state_file.read_text(encoding="utf-8"))["revision"] == 2

        # --- OT convergence test: two concurrent patches on the same file ---
        # At revision 2.  Client A inserts " A" at offset 13 (after "# Shared live").
        # Client B also sends baseRevision=2 and inserts " B" at offset 13 (same spot).
        # The server should accept both and produce "# Shared live A B"
        # (or "# Shared live B A" depending on scheduling, but both must succeed).
        patch_a = Request(
            f"{base_url}/api/operations?token={token}",
            data=json.dumps({"version": SYNC_LEVEL, "operation": {"type": "patch-file", "path": "shared.md", "start": 13, "end": 13, "removedText": "", "text": " A", "baseRevision": 2}}).encode("utf-8"),
            headers={"Content-Type": "application/json"},
            method="POST"
        )
        resp_a = json.loads(urlopen(patch_a).read().decode("utf-8"))
        assert resp_a["revision"] == 3

        patch_b = Request(
            f"{base_url}/api/operations?token={token}",
            data=json.dumps({"version": SYNC_LEVEL, "operation": {"type": "patch-file", "path": "shared.md", "start": 13, "end": 13, "removedText": "", "text": " B", "baseRevision": 2}}).encode("utf-8"),
            headers={"Content-Type": "application/json"},
            method="POST"
        )
        resp_b = json.loads(urlopen(patch_b).read().decode("utf-8"))
        assert resp_b["revision"] == 4

        snapshot = json.loads(urlopen(f"{base_url}/api/session/state?token={token}").read().decode("utf-8"))
        shared_file = next(node for node in snapshot["project"]["nodes"].values() if node.get("name") == "shared.md")
        # Both insertions must be present (order depends on arrival order).
        final_content = shared_file["content"]
        assert " A" in final_content and " B" in final_content, f"OT convergence failed: {final_content!r}"
        persisted = json.loads(state_file.read_text(encoding="utf-8"))
        assert persisted["revision"] == 4

        # --- OT rebase test: concurrent edits in DIFFERENT regions must not
        # misplace text. Two clients both branch from the same revision; the
        # second's offsets are STALE relative to the first's insert and MUST be
        # rebased forward, or its text lands in the wrong place (the exact
        # "characters ended up shifted while two devices edited" bug). ---
        create_ot = Request(
            f"{base_url}/api/operations?token={token}",
            data=json.dumps({"version": SYNC_LEVEL, "operation": {"type": "create-file", "parentPath": "", "name": "ot.md", "content": "0123456789"}}).encode("utf-8"),
            headers={"Content-Type": "application/json"}, method="POST")
        rev0 = json.loads(urlopen(create_ot).read().decode("utf-8"))["revision"]
        # Client A (based on rev0): insert "AAA" at offset 2.
        urlopen(Request(f"{base_url}/api/operations?token={token}",
            data=json.dumps({"version": SYNC_LEVEL, "operation": {"type": "patch-file", "path": "ot.md", "start": 2, "end": 2, "removedText": "", "text": "AAA", "baseRevision": rev0}}).encode("utf-8"),
            headers={"Content-Type": "application/json"}, method="POST"))
        # Client B (ALSO based on rev0 — never saw A): insert "BBB" at offset 8.
        urlopen(Request(f"{base_url}/api/operations?token={token}",
            data=json.dumps({"version": SYNC_LEVEL, "operation": {"type": "patch-file", "path": "ot.md", "start": 8, "end": 8, "removedText": "", "text": "BBB", "baseRevision": rev0}}).encode("utf-8"),
            headers={"Content-Type": "application/json"}, method="POST"))
        snap = json.loads(urlopen(f"{base_url}/api/session/state?token={token}").read().decode("utf-8"))
        ot_file = next(n for n in snap["project"]["nodes"].values() if n.get("name") == "ot.md")
        # After A: "01AAA23456789"; B's offset 8 rebases +3 → 11 → "01AAA234567BBB89".
        assert ot_file["content"] == "01AAA234567BBB89", f"OT rebase misplaced text: {ot_file['content']!r}"

        run_broker_selftest(state_file)

        print("Backend self-test passed.")
    finally:
        server.shutdown()
        server.server_close()
        if state_file.exists():
            state_file.unlink()


def run_broker_selftest(state_file):
    # --- directory-backed workspace: real files + externalized image asset ---
    import base64 as _b64, tempfile as _tf, shutil as _sh
    _dir = Path(_tf.mkdtemp()) / "WorkNotes"
    _b = open_live("2468", folder=_dir)
    _png = "data:image/png;base64," + _b64.b64encode(bytes.fromhex(
        "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489"
        "0000000d4944415478da6360000002000154a24f5f0000000049454e44ae426082")).decode()
    _b._apply_operation({"type": "create-file", "parentPath": "", "name": "welcome.md", "content": "# Hi"})
    _img_op = {"type": "create-file", "parentPath": "", "name": "logo.png", "content": _png}
    _b._apply_operation(_img_op)
    _b.save()
    assert (_dir / "welcome.md").read_text(encoding="utf-8") == "# Hi", "text not written as a real file"
    assert (_dir / "logo.png").read_bytes()[:4] == b"\x89PNG", "image not written as real bytes"
    assert _img_op["content"] == "", "image data URL not stripped from the broadcast op"
    assert "data:image" not in (_dir / "manifest.json").read_text(encoding="utf-8"), "manifest still inlines images"
    assert _b.resolve_asset("logo.png") == (_dir / "logo.png").resolve(), "asset path not resolvable"
    assert _b.resolve_asset("../../etc/passwd") is None, "asset path traversal not blocked"
    _b2 = open_live("2468", folder=_dir)  # reload
    _reload = {n["name"]: n for n in _b2.project["nodes"].values() if n.get("kind") == "file"}
    assert _reload["welcome.md"]["content"] == "# Hi", "text not re-hydrated on load"
    assert _reload["logo.png"]["content"] == "", "image should stay externalized on load"
    _sh.rmtree(_dir.parent, ignore_errors=True)

    # --- file-browser navigation: nested folders, projects, access rules ----
    _data = Path(_tf.mkdtemp())
    _acct = AccountStore(None)
    _acct.users = {
        "alice": {"password": "pw", "teams": ["qa"]},
        "bob": {"password": "pw", "teams": ["qa"]},
        "carol": {"password": "pw", "teams": ["other"]},
    }
    _reg = WorkspaceRegistry("2468", state_file, master_pin="1367", accounts=_acct, data_dir=_data)
    _alice = _reg.identity.login("alice", "pw")["token"]
    _bob = _reg.identity.login("bob", "pw")["token"]
    _alice_id = {"username": "alice", "teams": ["qa"]}
    _bob_id = {"username": "bob", "teams": ["qa"]}

    # No team → the caller's teams (name + modified); a fresh team is empty.
    assert [t["name"] for t in _reg.projects.browse(_alice)["teams"]] == ["qa"], "browse should list the caller's teams"
    assert _reg.projects.browse(_alice, "qa", "")["entries"] == [], "fresh team should browse empty"

    # Create a normal folder, then a project inside it.
    _reg.projects.make_folder(_alice, "qa", "", "workspaces")
    _created = _reg.cloud.create_project(_alice, "qa", "workspaces", "Alpha")
    assert _created["id"] == "qa/workspaces/Alpha"
    _alpha_dir = _data / "team_qa" / "workspaces" / "Alpha"
    assert (_alpha_dir / "manifest.json").is_file(), "project must carry a manifest.json"
    assert (_alpha_dir / ACCESS_FILE).is_file(), "project must record its access file"

    # Browse classifies dir-with-manifest as project, others as folder.
    _root = {e["name"]: e for e in _reg.projects.browse(_alice, "qa", "")["entries"]}
    assert _root["workspaces"]["kind"] == "folder"
    _ws = {e["name"]: e for e in _reg.projects.browse(_alice, "qa", "workspaces")["entries"]}
    assert _ws["Alpha"]["kind"] == "project" and _ws["Alpha"]["path"] == "workspaces/Alpha"
    # Reserved bookkeeping files never appear as entries.
    assert "manifest.json" not in _ws and ACCESS_FILE not in _ws and "index.json" not in _root

    # Browsing into a project is rejected (open it instead).
    try:
        _reg.projects.browse(_alice, "qa", "workspaces/Alpha")
        assert False, "browsing into a project should fail"
    except ValueError:
        pass

    # Open-by-path admits and binds a directory-backed broker.
    _sess = _reg.open_workspace(_alice, "qa", "workspaces/Alpha")
    assert _sess["workspace"] == "qa/workspaces/Alpha"
    assert _reg.brokers["qa/workspaces/Alpha"].folder is not None, "opened broker not directory-backed"

    # Access: both lists empty ⇒ everyone in the team.
    assert _reg.projects.can_access(_bob_id, "qa", "workspaces/Alpha"), "empty access should allow team members"
    # Whitelist limits to listed members.
    _reg.projects.set_access(_alice, "qa", "workspaces/Alpha", ["alice"], [])
    assert _reg.projects.can_access(_alice_id, "qa", "workspaces/Alpha")
    assert not _reg.projects.can_access(_bob_id, "qa", "workspaces/Alpha"), "whitelist should exclude bob"
    # Blacklist excludes a member even with an empty whitelist.
    _reg.projects.set_access(_alice, "qa", "workspaces/Alpha", [], ["bob"])
    assert _reg.projects.can_access(_alice_id, "qa", "workspaces/Alpha")
    assert not _reg.projects.can_access(_bob_id, "qa", "workspaces/Alpha"), "blacklist should exclude bob"
    # Only the owner may change access.
    try:
        _reg.projects.set_access(_bob, "qa", "workspaces/Alpha", [], [])
        assert False, "non-owner should not edit access"
    except PermissionError:
        pass

    # access.json survives a publish/replace-project wipe.
    _reg.projects.set_access(_alice, "qa", "workspaces/Alpha", ["alice"], [])
    _broker = _reg.brokers["qa/workspaces/Alpha"]
    _broker._apply_operation({"type": "replace-project", "baseRevision": _broker.revision, "project": default_project()})
    assert (_alpha_dir / ACCESS_FILE).is_file(), "the access file must survive replace-project"
    assert _reg.projects.read_access("qa", "workspaces/Alpha")["whitelist"] == ["alice"], "whitelist lost on publish"

    # Lazy-migrate a legacy index.json members list into the whitelist.
    _legacy = _data / "team_qa" / "workspaces" / "Legacy"
    _legacy.mkdir(parents=True, exist_ok=True)
    (_legacy / "manifest.json").write_text('{"project":{},"revision":0}', encoding="utf-8")
    _reg.projects.folders.write_index("qa", {"workspaces": {"Legacy": {"members": ["bob"], "createdBy": "bob"}}})
    _acc = _reg.projects.read_access("qa", "workspaces/Legacy")
    assert _acc["whitelist"] == ["bob"] and _acc["createdBy"] == "bob", "legacy members not migrated"
    assert (_legacy / ACCESS_FILE).is_file(), "migration should persist the access file"
    assert not _reg.projects.can_access(_alice_id, "qa", "workspaces/Legacy"), "migrated whitelist should gate alice"

    # Path traversal in a browse path is rejected.
    try:
        _reg.projects.browse(_alice, "qa", "../../etc")
        assert False, "path traversal should be rejected"
    except (ValueError, PermissionError):
        pass

    # Per-user resume state: save + read back is per account, and survives a
    # publish (user-state.json is preserved like access.json).
    _alpha_broker = _reg.brokers["qa/workspaces/Alpha"]
    _alpha_broker.save()  # restore manifest.json (an earlier test wiped it)
    assert _reg.projects.read_user_state("qa", "workspaces/Alpha", "alice")["openFiles"] == [], "default resume is empty"
    _reg.projects.write_user_state(_alice, "qa", "workspaces/Alpha", ["welcome.md", "docs/spec.md"], "welcome.md")
    _rs = _reg.projects.read_user_state("qa", "workspaces/Alpha", "alice")
    assert _rs["openFiles"] == ["welcome.md", "docs/spec.md"] and _rs["activeFile"] == "welcome.md", "resume not saved"
    assert _reg.projects.read_user_state("qa", "workspaces/Alpha", "bob")["openFiles"] == [], "resume must be per-user"
    assert (_alpha_dir / "user-state.json").is_file(), "resume sidecar not written"
    # A publish (replace-project + persist) must preserve the resume sidecar.
    _alpha_broker._apply_operation({"type": "replace-project", "baseRevision": _alpha_broker.revision, "project": default_project()})
    _alpha_broker.save()
    assert (_alpha_dir / "user-state.json").is_file(), "user-state.json must survive replace-project"
    assert _reg.projects.read_user_state("qa", "workspaces/Alpha", "alice")["activeFile"] == "welcome.md", "resume lost on publish"
    # open_workspace hands the resume state back to the client.
    _sess2 = _reg.open_workspace(_alice, "qa", "workspaces/Alpha")
    assert _sess2.get("resume", {}).get("activeFile") == "welcome.md", "open should return resume state"

    # Cross-device resume: opening records the account's last workspace, and a
    # fresh login (a different device) gets it back.
    _login = _reg.identity.login("alice", "pw")
    assert _login.get("lastWorkspace", {}).get("path") == "workspaces/Alpha", "login should return last workspace"
    assert _login["lastWorkspace"]["team"] == "qa", "last workspace team"

    # --- Line comments (metadata about a line, never in the document) --------
    _CP = "workspaces/Alpha"
    _cf = "第一卷/第一回试写.md"  # CJK path must work here too
    _c1 = _reg.comments.save(_alice, "qa", _CP, {"file": _cf, "line": 41,
                                                "anchorText": "原文这一行", "text": "check this pacing"})["comment"]
    assert _c1["author"] == "alice" and _c1["line"] == 41
    _all = _reg.comments.list(_alice, "qa", _CP)["files"]
    assert [c["text"] for c in _all[_cf]] == ["check this pacing"]
    # comments.json lives beside the project but is never a browseable file.
    assert (_alpha_dir / "comments.json").is_file(), "sidecar not written"
    assert "comments.json" not in {e["name"] for e in _reg.projects.browse(_alice, "qa", "workspaces")["entries"]}

    # Editing by id updates in place rather than adding a duplicate.
    _reg.comments.save(_alice, "qa", _CP, {"file": _cf, "id": _c1["id"], "text": "revised note"})
    assert len(_reg.comments.list(_alice, "qa", _CP)["files"][_cf]) == 1
    assert _reg.comments.list(_alice, "qa", _CP)["files"][_cf][0]["text"] == "revised note"

    # Re-anchoring moves a comment when edits above shift its line.
    _reg.comments.reanchor(_alice, "qa", _CP, _cf, [{"id": _c1["id"], "line": 57, "anchorText": "原文这一行"}])
    assert _reg.comments.list(_alice, "qa", _CP)["files"][_cf][0]["line"] == 57, "re-anchor did not move the comment"

    # Comments survive a publish (replace-project wipes the project dir).
    _alpha_broker._apply_operation({"type": "replace-project", "baseRevision": _alpha_broker.revision,
                                    "project": default_project()})
    _alpha_broker.save()
    assert (_alpha_dir / "comments.json").is_file(), "comments.json must survive replace-project"
    assert _reg.comments.list(_alice, "qa", _CP)["files"][_cf][0]["text"] == "revised note", "comments lost on publish"

    # Empty text is rejected; access follows the project (bob is blacklisted/off-list).
    try:
        _reg.comments.save(_alice, "qa", _CP, {"file": _cf, "text": "   "})
        assert False, "empty comment should be rejected"
    except ValueError:
        pass
    for _call in (lambda: _reg.comments.list(_bob, "qa", _CP),
                  lambda: _reg.comments.save(_bob, "qa", _CP, {"file": _cf, "text": "nope"})):
        try:
            _call()
            assert False, "non-whitelisted user must not reach comments"
        except PermissionError:
            pass

    assert _reg.comments.delete(_alice, "qa", _CP, _c1["id"])["deleted"], "delete failed"
    assert _reg.comments.list(_alice, "qa", _CP)["files"] == {}, "comment not removed"

    # --- Stale-write protection (an old tab must not overwrite newer work) ---
    _ss = _reg.open_workspace(_alice, "qa", "workspaces/Alpha")
    _stok = _ss["token"]
    _sb = _reg.brokers["qa/workspaces/Alpha"]
    _sb.apply_operation(_stok, {"type": "create-file", "parentPath": "", "name": "race.md", "content": "v1"})
    _nid = node_id_by_path(_sb.project, "race.md")
    _created_at = _sb.revision  # race.md last changed here

    # A whole-file write that doesn't say what it is based on is refused.
    try:
        _sb.apply_operation(_stok, {"type": "update-file", "path": "race.md", "content": "CLOBBER"})
        assert False, "unguarded update-file must be refused"
    except ValueError as e:
        assert "conflict" in str(e).lower()
    # A write from a client that hadn't seen the latest change is refused...
    try:
        _sb.apply_operation(_stok, {"type": "update-file", "path": "race.md",
                                    "content": "STALE", "baseRevision": _created_at - 1})
        assert False, "stale update-file must be refused"
    except ValueError as e:
        assert "conflict" in str(e).lower()
    assert _sb.project["nodes"][_nid]["content"] == "v1", "refused write must not change content"
    # ...an up-to-date one still applies (normal saving must keep working).
    _sb.apply_operation(_stok, {"type": "update-file", "path": "race.md",
                                "content": "v2", "baseRevision": _sb.revision})
    assert _sb.project["nodes"][_nid]["content"] == "v2", "matching update-file must apply"
    # Editing a DIFFERENT file doesn't make this one stale (per-path, not global).
    _sb.apply_operation(_stok, {"type": "create-file", "parentPath": "", "name": "other.md", "content": "o"})
    _sb.apply_operation(_stok, {"type": "update-file", "path": "race.md",
                                "content": "v3", "baseRevision": _sb.rebase.changed_at["race.md"]})
    assert _sb.project["nodes"][_nid]["content"] == "v3", "unrelated edits must not block a write"

    # A patch whose base predates what we can rebase from is refused rather
    # than silently landing at the wrong offsets (corrupting the file).
    _sb.rebase.entries = []  # e.g. after a server restart, or trimmed away
    try:
        _sb.apply_operation(_stok, {"type": "patch-file", "path": "race.md", "start": 0, "end": 0,
                                    "removedText": "", "text": "X", "baseRevision": max(0, _sb.revision - 5)})
        assert False, "un-rebasable patch must be refused"
    except ValueError as e:
        assert "conflict" in str(e).lower()

    # set_state (publish) WIPES the tree: it must be based on the current revision.
    try:
        _sb.set_state(_stok, default_project(), base_revision=_sb.revision - 1)
        assert False, "stale replace must be refused"
    except ValueError as e:
        assert "conflict" in str(e).lower()
    try:
        _sb.set_state(_stok, default_project(), base_revision=None)
        assert False, "unguarded replace must be refused"
    except ValueError as e:
        assert "conflict" in str(e).lower()
    assert node_id_by_path(_sb.project, "race.md"), "refused replace must not wipe the tree"
    _sb.set_state(_stok, default_project(), base_revision=_sb.revision)  # current base is accepted

    # --- Server-side snapshots ---------------------------------------------
    _P = "workspaces/Alpha"
    _f = "第一卷/第一回试写.md"  # CJK path: must NOT go through safe_component
    _r1 = _reg.history.create_snapshot(_alice, "qa", _P, _f, "第一版 content", "first")
    assert _r1["created"] and _r1["version"]["author"] == "alice", "snapshot not created"
    assert not _reg.history.create_snapshot(_alice, "qa", _P, _f, "第一版 content")["created"], "identical content must dedup"
    _r2 = _reg.history.create_snapshot(_alice, "qa", _P, _f, "第二版 content")
    _vers = _reg.history.list_snapshot_versions(_alice, "qa", _P, _f)["versions"]
    assert [v["id"] for v in _vers] == [_r2["version"]["id"], _r1["version"]["id"]], "versions must be newest first"
    assert _reg.history.get_snapshot_content(_alice, "qa", _P, _r1["version"]["id"])["content"] == "第一版 content", "CJK content round-trip"
    assert _reg.history.list_snapshot_paths(_alice, "qa", _P)["paths"] == [_f], "path listing"

    # Identical content in another file shares one blob (content-addressed).
    _reg.history.create_snapshot(_alice, "qa", _P, "大纲.md", "第二版 content")
    _snapstore = _reg.history.snapshots.store("qa", _P)
    _snapdir = _snapstore.folder
    _idx = _snapstore.load()
    assert _idx["refs"][_r2["version"]["blob"]] == 2, "shared blob should be refcounted twice"
    assert len(list((_snapdir / "blobs").glob("*.gz"))) == 2, "dedup: two distinct contents -> two blobs"

    # Stored OUTSIDE the project dir, so a publish (which wipes it) keeps them.
    assert not any("_snapshots" in str(x) for x in _alpha_dir.rglob("*")), "snapshots must not live in the project dir"
    _alpha_broker._apply_operation({"type": "replace-project", "baseRevision": _alpha_broker.revision, "project": default_project()})
    _alpha_broker.save()
    assert _reg.history.list_snapshot_paths(_alice, "qa", _P)["paths"] == ["大纲.md", _f], "snapshots lost on publish"

    # Per-file cap of 30; pruned blobs are actually deleted from disk.
    for _i in range(35):
        _reg.history.create_snapshot(_alice, "qa", _P, "churn.md", f"rev {_i}")
    _churn = _reg.history.list_snapshot_versions(_alice, "qa", _P, "churn.md")["versions"]
    assert len(_churn) == 30, f"expected 30 versions, got {len(_churn)}"
    assert _churn[0]["byteSize"] == len("rev 34"), "newest version kept"
    _live_blobs = {v["blob"] for vs in _snapstore.load()["files"].values() for v in vs}
    assert {b.stem for b in (_snapdir / "blobs").glob("*.gz")} == _live_blobs, "orphan blobs left behind"

    # Delete drops the version; its unshared blob goes with it.
    _reg.history.delete_snapshot(_alice, "qa", _P, _r1["version"]["id"])
    assert _r1["version"]["blob"] not in _snapstore.load()["refs"], "released blob still referenced"
    assert not (_snapdir / "blobs" / f"{_r1['version']['blob']}.gz").exists(), "unreferenced blob not deleted"

    # Import (migration) keeps the original timestamp and is idempotent.
    _t = 1700000000000
    _imp = _reg.history.create_snapshot(_alice, "qa", _P, "migrated.md", "old text", created_at=_t)
    assert _imp["created"] and _imp["version"]["createdAt"] == _t, "import must keep its timestamp"
    assert not _reg.history.create_snapshot(_alice, "qa", _P, "migrated.md", "old text", created_at=_t)["created"], "re-import must be a no-op"
    _reg.history.create_snapshot(_alice, "qa", _P, "migrated.md", "newer text")
    # An older import whose content equals the newest is still real history.
    assert _reg.history.create_snapshot(_alice, "qa", _P, "migrated.md", "newer text", created_at=_t - 1000)["created"], "historical import dropped"
    assert len(_reg.history.list_snapshot_versions(_alice, "qa", _P, "migrated.md")["versions"]) == 3

    # Access control follows the project: bob is not on Alpha's whitelist.
    for _call in (lambda: _reg.history.list_snapshot_paths(_bob, "qa", _P),
                  lambda: _reg.history.create_snapshot(_bob, "qa", _P, "x.md", "nope")):
        try:
            _call()
            assert False, "non-whitelisted user must not reach snapshots"
        except PermissionError:
            pass
    # Traversal / bad keys are rejected.
    for _bad in ("../../etc", ""):
        try:
            _reg.history.list_snapshot_paths(_alice, "qa", _bad)
            assert False, f"bad project path accepted: {_bad!r}"
        except (ValueError, PermissionError):
            pass
    try:
        _reg.history.create_snapshot(_alice, "qa", _P, "/../", "x")
        assert False, "empty file key accepted"
    except ValueError:
        pass

    # --- Capability tiers: master / editor / reader -------------------------
    _RP = "workspaces/Alpha"
    _reg.projects.set_access(_alice, "qa", _RP, [], [], [])          # open to the team, no readers
    assert _reg.projects.role_for(_alice_id, "qa", _RP) == "master", "creator should be master"
    assert _reg.projects.role_for(_bob_id, "qa", _RP) == "editor", "a plain member should be an editor"
    _reg.projects.set_access(_alice, "qa", _RP, [], [], ["bob"])
    assert _reg.projects.role_for(_bob_id, "qa", _RP) == "reader", "listed reader should be read-only"
    # readers survive a whitelist edit that omits them
    _reg.projects.set_access(_alice, "qa", _RP, [], [])
    assert _reg.projects.read_access("qa", _RP)["readers"] == ["bob"], "omitted readers must not be cleared"

    _rb = _reg.brokers["qa/" + _RP]
    _rs = _reg.open_workspace(_bob, "qa", _RP)
    assert _rs["role"] == "reader", f"expected reader session, got {_rs['role']}"
    for _op in ({"type": "create-file", "parentPath": "", "name": "nope.md", "content": "x"},
                {"type": "update-file", "path": "race.md", "content": "x", "baseRevision": _rb.revision}):
        try:
            _rb.apply_operation(_rs["token"], _op)
            assert False, "a reader must not be able to write"
        except PermissionError:
            pass

    # An editor may write, but may NOT replace the whole tree.
    _reg.projects.set_access(_alice, "qa", _RP, [], [], [])
    _es = _reg.open_workspace(_bob, "qa", _RP)
    assert _es["role"] == "editor"
    _rb.apply_operation(_es["token"], {"type": "create-file", "parentPath": "", "name": "editor-ok.md", "content": "x"})
    assert node_id_by_path(_rb.project, "editor-ok.md"), "editor write should apply"
    try:
        _rb.set_state(_es["token"], default_project(), base_revision=_rb.revision)
        assert False, "an editor must not replace the whole tree"
    except PermissionError:
        pass
    # ...but the owner still can.
    _ms = _reg.open_workspace(_alice, "qa", _RP)
    assert _ms["role"] == "master", "owner should still be master"
    _rb.set_state(_ms["token"], default_project(), base_revision=_rb.revision)

    # --- S.E.N display counters -------------------------------------
    # E counts writing sittings, N edits within one. Both are cosmetic:
    # nothing orders on them, which is why they may reset.
    _node = {"sourceVersion": 0, "editSessions": 0, "sessionEdits": 0, "lastEditAt": 0}
    _t0 = 1_000_000.0
    bump_edit_counters(_node, _t0, gap=EDIT_SESSION_GAP_SECONDS)
    assert (_node["editSessions"], _node["sessionEdits"]) == (1, 1), _node
    # Two more edits moments later stay in the same sitting.
    bump_edit_counters(_node, _t0 + 5, gap=EDIT_SESSION_GAP_SECONDS)
    bump_edit_counters(_node, _t0 + 30, gap=EDIT_SESSION_GAP_SECONDS)
    assert (_node["editSessions"], _node["sessionEdits"]) == (1, 3), _node
    # A gap longer than the threshold opens a new sitting and resets N.
    bump_edit_counters(_node, _t0 + 30 + EDIT_SESSION_GAP_SECONDS + 1, gap=EDIT_SESSION_GAP_SECONDS)
    assert (_node["editSessions"], _node["sessionEdits"]) == (2, 1), _node
    # A gap of exactly the threshold is still the same sitting (strict >):
    # the previous edit landed at _t0+631, so this one is 600s later.
    bump_edit_counters(_node, _t0 + 30 + 2 * EDIT_SESSION_GAP_SECONDS + 1, gap=EDIT_SESSION_GAP_SECONDS)
    assert (_node["editSessions"], _node["sessionEdits"]) == (2, 2), _node
    # The lifetime counter never resets, and nothing here touched revision.
    assert _node["sourceVersion"] == 5, _node
    # Counters survive a real edit path, and a second author in the same
    # room joins the SAME sitting rather than starting their own.
    _cb = open_live("1234")
    _m = _cb.connect("1234")
    _cb.apply_operation(_m["token"], {"type": "create-file", "parentPath": "", "name": "sen.md", "content": ""})
    _rev_before = _cb.revision
    _cb.apply_operation(_m["token"], {"type": "update-file", "path": "sen.md", "content": "a",
                                      "baseRevision": _cb.revision})
    _cb.apply_operation(_m["token"], {"type": "update-file", "path": "sen.md", "content": "ab",
                                      "baseRevision": _cb.revision})
    _sen = _cb.project["nodes"][node_id_by_path(_cb.project, "sen.md")]
    assert (_sen["editSessions"], _sen["sessionEdits"]) == (1, 2), _sen
    assert _cb.revision == _rev_before + 2, "revision must still advance once per operation"

    # A snapshot records the file's counters as the baseline the label
    # counts from, and must do so WITHOUT touching the project tree: no
    # revision bump and no path_changed_at, or snapshotting a file you are
    # editing would make your own next write conflict.
    _ws = _reg.open_workspace(_alice, "qa", _RP)
    _wb = _reg.brokers["qa/" + _RP]
    _wb.apply_operation(_ws["token"], {"type": "create-file", "parentPath": "", "name": "sen.md", "content": ""})
    for _i in range(4):
        _wb.apply_operation(_ws["token"], {"type": "update-file", "path": "sen.md",
                                           "content": "x" * (_i + 1), "baseRevision": _wb.revision})
    _snap_node = _wb.project["nodes"][node_id_by_path(_wb.project, "sen.md")]
    assert (_snap_node["editSessions"], _snap_node["sessionEdits"]) == (1, 4), _snap_node
    _rev_at_snapshot = _wb.revision
    _changed_at = dict(_wb.rebase.changed_at)
    _made = _reg.history.create_snapshot(_alice, "qa", _RP, "sen.md", "xxxx", "first cut")
    assert _made["created"], "snapshot should be created"
    assert _made["version"]["editSessions"] == 1 and _made["version"]["sessionEdits"] == 4, _made["version"]
    assert _wb.revision == _rev_at_snapshot, "a snapshot must not bump the revision"
    assert _wb.rebase.changed_at == _changed_at, "a snapshot must not mark the path changed"
    # ...so the very next write from a client based on the pre-snapshot
    # revision still applies rather than 409ing.
    _wb.apply_operation(_ws["token"], {"type": "update-file", "path": "sen.md",
                                       "content": "xxxxy", "baseRevision": _rev_at_snapshot})
    # The listing hands the client S and the baseline in one call.
    _listing = _reg.history.list_snapshot_paths(_alice, "qa", _RP)
    _base = _listing["baselines"]["sen.md"]
    assert _base == {"count": 1, "editSessions": 1, "sessionEdits": 4}, _base
    assert "sen.md" in _listing["paths"], _listing["paths"]
    # Label maths (mirrors fileVersionLabel in main.js): same sitting, so N
    # subtracts the baseline — one edit since the snapshot reads v1.0.1.
    _now = _wb.project["nodes"][node_id_by_path(_wb.project, "sen.md")]
    _E = _now["editSessions"] - _base["editSessions"]
    _N = _now["sessionEdits"] if _E > 0 else _now["sessionEdits"] - _base["sessionEdits"]
    assert (_base["count"], _E, _N) == (1, 0, 1), (_base["count"], _E, _N)

    # Snapshotting while another thread edits the same file: the baseline is
    # read under the broker's lock and BEFORE _snapshot_lock, so this must
    # neither deadlock nor record a half-applied counter rollover. Re-nesting
    # those two locks would hang this loop.
    import threading as _th
    _stop = _th.Event()
    _errors = []

    def _hammer():
        try:
            while not _stop.is_set():
                _wb.apply_operation(_ws["token"], {"type": "update-file", "path": "sen.md",
                                                   "content": "y" * 8, "baseRevision": _wb.revision})
        except Exception as _e:  # noqa: BLE001 - surfaced on the main thread
            _errors.append(_e)

    _t = _th.Thread(target=_hammer, daemon=True)
    _t.start()
    try:
        for _i in range(25):
            _v = _reg.history.create_snapshot(_alice, "qa", _RP, "sen.md", f"concurrent {_i}")
            _ver = _v.get("version") or {}
            if "sessionEdits" in _ver:
                assert _ver["sessionEdits"] <= _ver["sourceVersion"], _ver
                assert _ver["editSessions"] >= 1, _ver
    finally:
        _stop.set()
        _t.join(timeout=10)
    assert not _t.is_alive(), "snapshot/edit contention deadlocked"
    assert not _errors, _errors

    # Directly prove the baseline read takes the broker's lock: while another
    # thread holds it, the read must block rather than observe a node that is
    # mid-bump. (The contention loop above only shows it does not crash.)
    _done = _th.Event()

    def _read_baseline():
        _reg.history.snapshots.counters("qa", _RP, "sen.md")
        _done.set()

    with _wb.lock:
        _reader = _th.Thread(target=_read_baseline, daemon=True)
        _reader.start()
        assert not _done.wait(timeout=0.5), "baseline read did NOT take the broker lock"
    _reader.join(timeout=5)
    assert _done.is_set(), "baseline read never completed after the lock was released"

    _sh.rmtree(_data, ignore_errors=True)


if __name__ == "__main__":
    run_selftest()
