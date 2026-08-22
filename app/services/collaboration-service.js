import { connectToServer, fetchSessionState, hostSession, openEventStream, openWorkspaceSession, pushCursor, pushOperation, pushSessionState, sanitizeProjectForSync, uploadAsset } from "./sync-service.js";

function fingerprintProject(project) {
  return JSON.stringify(sanitizeProjectForSync(project));
}

function createCollaborationRuntime({ getProject, replaceProject, applyOperation, onStatusChange, onRemoteCursor, onPatchConfirmed, onChatWorkspaceUpdate }) {
  let connection = null;
  let isApplyingRemote = false;
  let pendingTextPatches = new Map();
  let pendingSnapshotTimer = null;
  let lastFingerprint = "";
  let presence = [];
  // OT state: revision we last confirmed with the server, and in-flight patch ops
  let localRevision = 0;
  let inFlightPatches = new Map(); // path -> { baseRevision, start, end, text, removedText }
  // Resilient reconnect for cloud workspaces: re-auth context + backoff state.
  // While `reconnecting`, the connection is kept alive (edits keep accumulating
  // locally) and we retry re-opening the session; on success we reconcile the
  // local project INTO the server so nothing typed offline is lost.
  let reconnectCtx = null; // { serverUrl, accountToken, team, path }
  let reconnecting = false;
  let reconnectTimer = null;
  let reconnectAttempts = 0;
  const RECONNECT_DELAYS = [1000, 2000, 4000, 8000, 15000, 30000];

  function isImageName(name) {
    return /\.(png|jpe?g|gif|svg|webp|bmp)$/i.test(String(name || ""));
  }

  // Flatten a project into ordered folder + text-file lists with full paths
  // (root name excluded), used to diff the local tree against the server's.
  function flattenProjectPaths(project) {
    const folders = [];
    const files = [];
    if (!project?.nodes) return { folders, files };
    const walk = (nodeId, parentPath) => {
      const node = project.nodes[nodeId];
      for (const childId of node?.children ?? []) {
        const child = project.nodes[childId];
        if (!child) continue;
        const path = parentPath ? `${parentPath}/${child.name}` : child.name;
        if (child.kind === "folder") {
          folders.push({ path, parentPath, name: child.name });
          walk(childId, path);
        } else if (child.kind === "file") {
          files.push({ path, parentPath, name: child.name, content: child.content ?? "" });
        }
      }
    };
    walk(project.rootId, "");
    return { folders, files };
  }

  function clearReconnect() {
    if (reconnectTimer) {
      window.clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    reconnecting = false;
    reconnectAttempts = 0;
  }

  function emitStatus(status, detail) {
    onStatusChange({
      status,
      detail,
      presence,
      revision: connection?.revision ?? 0,
      sessionId: connection?.sessionId ?? null,
      displayName: connection?.displayName ?? null,
      clientId: connection?.clientId ?? null,
      role: connection?.role ?? null
    });
  }

  function clearScheduledSyncs() {
    pendingTextPatches.forEach((entry) => window.clearTimeout(entry.timer));
    pendingTextPatches.clear();
    inFlightPatches.clear();
    if (pendingSnapshotTimer) {
      window.clearTimeout(pendingSnapshotTimer);
      pendingSnapshotTimer = null;
    }
  }

  function disconnect(detail = "Server offline") {
    // A deliberate teardown (user left / opening a different session): stop any
    // reconnect loop so we don't keep resurrecting a session they left.
    reconnectCtx = null;
    clearReconnect();
    clearScheduledSyncs();
    if (connection?.eventSource) {
      connection.eventSource.close();
    }
    connection = null;
    presence = [];
    emitStatus("offline", detail);
  }

  // SSE stream error. For a cloud workspace we DON'T tear down (which would
  // discard the user's synced edits and revert to their pre-open project). We
  // keep the connection object alive, mark "reconnecting", and retry with backoff.
  function handleStreamError() {
    if (!connection || reconnecting) return;
    if (connection.eventSource) {
      try { connection.eventSource.close(); } catch { /* ignore */ }
      connection.eventSource = null;
    }
    if (!reconnectCtx) {
      // PIN/guest/host sessions have no re-auth context — fall back to the old
      // behaviour so main.js's PIN auto-reconnect can take over.
      disconnect("Connection to server lost.");
      return;
    }
    // Drop queued/in-flight patch timers (they'd fire against a dead token); the
    // reconcile on reconnect re-pushes the current content of every changed file.
    clearScheduledSyncs();
    reconnecting = true;
    reconnectAttempts = 0;
    emitStatus("reconnecting", "Connection lost — reconnecting…");
    scheduleReconnectAttempt();
  }

  function scheduleReconnectAttempt() {
    if (!reconnectCtx) return;
    const delay = RECONNECT_DELAYS[Math.min(reconnectAttempts, RECONNECT_DELAYS.length - 1)];
    reconnectAttempts += 1;
    reconnectTimer = window.setTimeout(() => {
      reconnectTimer = null;
      void attemptReconnect();
    }, delay);
  }

  async function attemptReconnect() {
    if (!reconnectCtx || !connection) return;
    emitStatus("reconnecting", `Reconnecting… (attempt ${reconnectAttempts})`);
    try {
      // Fresh session token — the server may have restarted, invalidating ours.
      const session = await openWorkspaceSession(
        reconnectCtx.serverUrl, reconnectCtx.accountToken, reconnectCtx.team, reconnectCtx.path, reconnectCtx.device
      );
      connection.token = session.token;
      connection.clientId = session.clientId ?? connection.clientId;
      connection.sessionId = session.sessionId ?? session.workspace ?? connection.sessionId;
      connection.role = session.role ?? connection.role;
      connection.revision = session.revision ?? connection.revision;
      localRevision = connection.revision;
      // Push everything we changed while offline so the server matches local.
      await reconcileLocalIntoServer();
      clearReconnect();
      attachEventStream(reconnectCtx.serverUrl);
      emitStatus("connected", `Reconnected at revision ${connection.revision}.`);
    } catch (error) {
      // Keep trying while the intent stands; edits remain safe in the local model.
      if (reconnectCtx) {
        emitStatus("reconnecting", `Reconnect failed — retrying… (${error?.message || "offline"})`);
        scheduleReconnectAttempt();
      }
    }
  }

  // Make the server reflect the local (actively-edited) project: create missing
  // folders/files and update changed text files. Additive + last-writer-wins in
  // favour of THIS client — the right call for the reconnecting author, and a
  // strict improvement over silently losing their offline work. (Images are
  // uploaded out-of-band as assets, so they're skipped here; server-only files
  // are left intact rather than deleted.)
  async function reconcileLocalIntoServer() {
    if (!connection) return;
    const snapshot = await fetchSessionState(reconnectCtx.serverUrl, connection.token);
    presence = snapshot.presence ?? presence;
    connection.revision = snapshot.revision ?? connection.revision;
    localRevision = connection.revision;

    const server = flattenProjectPaths(snapshot.project);
    const serverFolders = new Set(server.folders.map((f) => f.path));
    const serverFiles = new Map(server.files.map((f) => [f.path, f.content]));
    const local = flattenProjectPaths(getProject());

    const pushOp = async (operation) => {
      const result = await pushOperation(reconnectCtx.serverUrl, connection.token, operation);
      localRevision = result.revision ?? localRevision;
      connection.revision = localRevision;
    };

    // Folders shallow → deep so a parent always exists before its child.
    const foldersByDepth = local.folders
      .slice()
      .sort((a, b) => a.path.split("/").length - b.path.split("/").length);
    for (const folder of foldersByDepth) {
      if (!serverFolders.has(folder.path)) {
        await pushOp({ type: "create-folder", parentPath: folder.parentPath, name: folder.name });
        serverFolders.add(folder.path);
      }
    }
    for (const file of local.files) {
      if (isImageName(file.name)) continue;
      const serverContent = serverFiles.get(file.path);
      if (serverContent === undefined) {
        await pushOp({ type: "create-file", parentPath: file.parentPath, name: file.name, content: file.content });
      } else if (serverContent !== file.content) {
        await pushOp({ type: "update-file", path: file.path, content: file.content });
      }
    }
    lastFingerprint = fingerprintProject(getProject());
  }

  async function publishSnapshot(project) {
    if (!connection || isApplyingRemote) {
      return;
    }

    const fingerprint = fingerprintProject(project);
    if (fingerprint === lastFingerprint) {
      return;
    }

    const result = await pushSessionState(connection.serverUrl, connection.token, project);
    lastFingerprint = fingerprint;
    connection.revision = result.revision ?? connection.revision;
    emitStatus("connected", `Connected. Revision ${connection.revision}.`);
  }

  async function publishOperation(operation) {
    if (!connection || isApplyingRemote) {
      return;
    }
    // Reconnecting: don't push against the dead token. Text content is re-pushed
    // by the reconcile; structural ops made during the (usually brief) outage are
    // a known gap (content safety is the priority).
    if (reconnecting) {
      return;
    }

    const result = await pushOperation(connection.serverUrl, connection.token, operation);
    localRevision = result.revision ?? localRevision;
    connection.revision = localRevision;
    // Once the server confirms this op, it's no longer in-flight.
    if (operation.path) {
      inFlightPatches.delete(operation.path);
    }
    lastFingerprint = fingerprintProject(getProject());
    emitStatus("connected", `Connected. Revision ${connection.revision}.`);
    // Text is now confirmed on the server — broadcast the definitive cursor
    // position so peers see where we ended up after the edit.
    if (typeof onPatchConfirmed === "function") {
      onPatchConfirmed();
    }
  }

  async function reloadFromServer(detail) {
    if (!connection) {
      return;
    }

    const snapshot = await fetchSessionState(connection.serverUrl, connection.token);
    presence = snapshot.presence ?? [];
    // Only adopt a well-formed project — never blank the editor on a malformed or
    // empty snapshot (a transient server/race condition should not wipe the view).
    if (snapshot.project?.nodes && snapshot.project.rootId && snapshot.project.nodes[snapshot.project.rootId]) {
      isApplyingRemote = true;
      replaceProject(snapshot.project);
      isApplyingRemote = false;
      lastFingerprint = fingerprintProject(snapshot.project);
    }
    connection.revision = snapshot.revision ?? connection.revision;
    emitStatus("connected", detail || `Connected. Reloaded revision ${connection.revision}.`);
  }

  /**
   * Mirror of the server's _transform_offset: adjust one offset through a
   * single already-applied operation described by (appliedStart, appliedEnd,
   * insertedLength).
   */
  function transformOffset(offset, appliedStart, appliedEnd, insertedLength) {
    const removedLength = appliedEnd - appliedStart;
    if (offset <= appliedStart) return offset;
    if (offset <= appliedEnd) return appliedStart + insertedLength;
    return offset + insertedLength - removedLength;
  }

  function scheduleTextPatch(path, previousContent, nextContent) {
    if (!connection || isApplyingRemote) {
      return;
    }
    // While reconnecting the token is dead; the edit is safe in the local model
    // and will be re-pushed by reconcileLocalIntoServer() once the stream is back.
    if (reconnecting) {
      return;
    }
    if (previousContent === nextContent) {
      return;
    }

    // Coalesce into one pending entry per file. Keep the ORIGINAL base content
    // (so the eventual op spans the whole accumulated change) but always track the
    // LATEST content. baseRevision is stamped at SEND time (see sendTextPatch), by
    // which point serialization guarantees the base equals the server's current
    // content — the pair can never drift apart.
    const existing = pendingTextPatches.get(path);
    if (existing) window.clearTimeout(existing.timer);
    const entry = {
      baseContent: existing ? existing.baseContent : previousContent,
      latest: nextContent,
      timer: null,
    };
    entry.timer = window.setTimeout(() => sendTextPatch(path), 250);
    pendingTextPatches.set(path, entry);
  }

  // Send the pending patch for a file, SERIALIZED: at most one patch per file may
  // be in flight at a time. If the previous one hasn't confirmed yet, wait — so
  // the next patch's offsets (and its send-time baseRevision) are always computed
  // against the server's current, confirmed content, never a stale/overlapping
  // base (the cause of characters landing in the wrong place while typing fast).
  function sendTextPatch(path) {
    const entry = pendingTextPatches.get(path);
    if (!entry || !connection || reconnecting) return;
    if (inFlightPatches.has(path)) {
      entry.timer = window.setTimeout(() => sendTextPatch(path), 120);
      return;
    }
    pendingTextPatches.delete(path);
    const op = buildPatchOp(path, entry.baseContent, entry.latest); // baseRevision = localRevision (now)
    if (!op) return;
    publishOperation(op).catch(async (error) => {
      if (error.status === 409) {
        await reloadFromServer(error.message || "Text patch conflicted with a remote change.");
        return;
      }
      disconnect(error.message || "Sync failed.");
    });
  }

  // A rename/move changes a file's path (and, for a folder, all of its
  // descendants'). Text patches are keyed by path, so a queued patch for the OLD
  // path would be sent against a file the server just renamed → 400 "File path
  // not found" → sendTextPatch's catch disconnects ("server unreachable"). Re-key
  // any not-yet-sent pending patch to the NEW path so it lands correctly instead.
  // In-flight patches already left under the old path and clear themselves on
  // their own HTTP response, so they need no remap.
  function remapPatchPath(oldPath, newPath) {
    if (!oldPath || !newPath || oldPath === newPath) return;
    const remapped = (key) =>
      key === oldPath ? newPath
        : key.startsWith(`${oldPath}/`) ? `${newPath}${key.slice(oldPath.length)}`
          : null;
    for (const key of Array.from(pendingTextPatches.keys())) {
      const nk = remapped(key);
      if (!nk || nk === key) continue;
      const entry = pendingTextPatches.get(key);
      pendingTextPatches.delete(key);
      if (entry.timer) window.clearTimeout(entry.timer);
      entry.timer = window.setTimeout(() => sendTextPatch(nk), 250);
      pendingTextPatches.set(nk, entry);
    }
  }

  // A deleted file/folder can never receive a queued patch — drop them so they
  // don't 400 and disconnect. Covers a folder's descendants via path prefix.
  function dropPatchPath(path) {
    if (!path) return;
    const matches = (key) => key === path || key.startsWith(`${path}/`);
    for (const key of Array.from(pendingTextPatches.keys())) {
      if (!matches(key)) continue;
      const entry = pendingTextPatches.get(key);
      if (entry?.timer) window.clearTimeout(entry.timer);
      pendingTextPatches.delete(key);
    }
    for (const key of Array.from(inFlightPatches.keys())) {
      if (matches(key)) inFlightPatches.delete(key);
    }
  }

  function buildPatchOp(path, previousContent, nextContent, baseRevision = localRevision) {
    if (previousContent === nextContent) return null;

    let start = 0;
    while (start < previousContent.length && start < nextContent.length && previousContent[start] === nextContent[start]) {
      start += 1;
    }

    let previousEnd = previousContent.length;
    let nextEnd = nextContent.length;
    while (previousEnd > start && nextEnd > start && previousContent[previousEnd - 1] === nextContent[nextEnd - 1]) {
      previousEnd -= 1;
      nextEnd -= 1;
    }

    const removedText = previousContent.slice(start, previousEnd);
    const insertText = nextContent.slice(start, nextEnd);

    const operation = {
      type: "patch-file",
      path,
      start,
      end: previousEnd,
      removedText,
      text: insertText,
      baseRevision
    };

    // Track in-flight for OT rebase.
    inFlightPatches.set(path, { baseRevision, start, end: previousEnd, text: insertText, removedText });
    return operation;
  }

  let awarenessTimer = null;
  function scheduleAwareness(fileId, selStart, selEnd) {
    if (!connection) return;
    if (awarenessTimer) window.clearTimeout(awarenessTimer);
    awarenessTimer = window.setTimeout(() => {
      awarenessTimer = null;
      if (!connection) return;
      // Normalizes the (possibly empty, same-origin) serverUrl so the POST lands
      // on the app's base path — see pushCursor.
      pushCursor(connection.serverUrl, connection.token, { fileId, selStart, selEnd })
        .catch(() => { /* non-critical — ignore */ });
    }, 100);
  }

  function scheduleSnapshot(project) {
    if (!connection || isApplyingRemote) {
      return;
    }

    if (pendingSnapshotTimer) {
      window.clearTimeout(pendingSnapshotTimer);
    }

    pendingSnapshotTimer = window.setTimeout(() => {
      pendingSnapshotTimer = null;
      publishSnapshot(project).catch((error) => {
        disconnect(error.message || "Sync failed.");
      });
    }, 120);
  }

  async function connect(serverUrl, pin, displayName = "") {
    disconnect();
    emitStatus("reachable", "Connecting to server...");

    const session = await connectToServer(serverUrl, pin, displayName);
    connection = {
      serverUrl,
      token: session.token,
      clientId: session.clientId,
      displayName: (session.displayName ?? displayName.trim()) || session.clientId,
      sessionId: session.sessionId ?? "default",
      revision: session.revision ?? 0,
      role: session.role ?? "client",
      eventSource: null
    };
    localRevision = connection.revision;

    const snapshot = await fetchSessionState(serverUrl, connection.token);
    presence = snapshot.presence ?? [];
    if (connection.role === "master") {
      // Master always asserts their local project as the canonical server state.
      await publishSnapshot(getProject());
      emitStatus("connected", "Connected as master. Project pushed to server.");
    } else if (snapshot.project) {
      isApplyingRemote = true;
      replaceProject(snapshot.project);
      isApplyingRemote = false;
      lastFingerprint = fingerprintProject(snapshot.project);
      connection.revision = snapshot.revision ?? connection.revision;
      emitStatus("connected", `Connected as client. Pulled server revision ${connection.revision}.`);
    } else {
      emitStatus("connected", "Connected as client. Server has no project yet.");
    }

    attachEventStream(serverUrl);

    return session;
  }

  // Shared post-session wiring: open the SSE stream and route events. Used by
  // both PIN connect() and account openWorkspace().
  function attachEventStream(serverUrl) {
    connection.eventSource = openEventStream(
      serverUrl,
      connection.token,
      (event) => {
        if (!connection) {
          return;
        }

        if (event.type === "operation" && event.operation) {
          if (event.clientId === connection.clientId) {
            localRevision = event.revision ?? localRevision;
            connection.revision = localRevision;
            emitStatus("connected", `Connected. Revision ${connection.revision}.`);
            return;
          }
          // OT diamond: when we have an in-flight (unconfirmed) pending patch on the
          // same file as the incoming remote op, we must:
          //   1. Transform the INCOMING op through our pending op so it lands at the
          //      correct position in our local model (which already has pending applied).
          //   2. Transform our PENDING op through the incoming op so our next send has
          //      positions relative to the new server-canonical state.
          let opToApply = event.operation;
          if (event.operation.type === "patch-file" && event.operation.path) {
            const p = event.operation.path;
            // If we have UNSENT local edits for this file (a debounced patch not
            // yet in flight), flush them NOW so they become the in-flight op the
            // diamond accounts for below. Without this, the remote op is applied
            // at an offset that ignores our not-yet-sent insert/delete — which is
            // how characters ended up shifted while two devices edited together.
            // The flush is sent with the pre-remote baseRevision, so the server
            // rebases it through this remote op correctly.
            if (pendingTextPatches.has(p) && !inFlightPatches.has(p)) {
              window.clearTimeout(pendingTextPatches.get(p).timer);
              sendTextPatch(p);
            }
            const pending = inFlightPatches.get(p);
            if (pending) {
              // Save originals before mutating pending.
              const pendStart = pending.start;
              const pendEnd   = pending.end;
              const pendInsLen = String(pending.text ?? "").length;
              // 1. Adjust incoming op positions to our local-model coordinate space.
              opToApply = {
                ...event.operation,
                start: transformOffset(Number(event.operation.start), pendStart, pendEnd, pendInsLen),
                end:   transformOffset(Number(event.operation.end),   pendStart, pendEnd, pendInsLen),
              };
              // 2. Advance pending positions past the incoming op.
              const remStart = Number(event.operation.start);
              const remEnd   = Number(event.operation.end);
              const remInsLen = String(event.operation.text ?? "").length;
              pending.start = transformOffset(pendStart, remStart, remEnd, remInsLen);
              pending.end   = transformOffset(pendEnd,   remStart, remEnd, remInsLen);
            }
          }
          isApplyingRemote = true;
          try {
            applyOperation(event.clientId, opToApply);
          } catch (err) {
            isApplyingRemote = false;
            // Model has diverged from server — reload authoritative state.
            reloadFromServer(`Sync conflict at revision ${event.revision} — reloading.`).catch(() => {});
            return;
          } finally {
            isApplyingRemote = false;
          }
          lastFingerprint = fingerprintProject(getProject());
          localRevision = event.revision ?? localRevision;
          connection.revision = localRevision;
          emitStatus("connected", `Connected. Applied remote operation at revision ${connection.revision}.`);
          return;
        }

        if (event.type === "state" && event.project) {
          if (event.clientId === connection.clientId) {
            connection.revision = event.revision ?? connection.revision;
            emitStatus("connected", `Connected. Revision ${connection.revision}.`);
            return;
          }
          isApplyingRemote = true;
          replaceProject(event.project);
          isApplyingRemote = false;
          lastFingerprint = fingerprintProject(event.project);
          connection.revision = event.revision ?? connection.revision;
          emitStatus("connected", `Connected. Synced remote revision ${connection.revision}.`);
          return;
        }

        if (event.type === "presence") {
          presence = event.presence ?? [];
          emitStatus(connection ? "connected" : "reachable", event.message || `Presence updated. ${presence.length} active.`);
          return;
        }

        if (event.type === "cursor") {
          if (typeof onRemoteCursor === "function") {
            onRemoteCursor(event);
          }
        }

        if (event.type === "chat-workspace-update") {
          if (event.clientId !== connection.clientId && typeof onChatWorkspaceUpdate === "function") {
            onChatWorkspaceUpdate(event.workspace);
          }
        }
      },
      () => {
        handleStreamError();
      }
    );
  }

  // Open a persistent team workspace as a logged-in account. Normally a cloud
  // workspace holds the canonical project, so we PULL it. But when the caller
  // passes { reconcileLocal: true } — a reload that still has unsynced local
  // edits for THIS workspace — we instead keep the local project and push it
  // into the server so nothing typed offline is clobbered by a stale pull.
  async function openWorkspace(serverUrl, accountToken, team, path, options = {}) {
    disconnect();
    emitStatus("reachable", "Opening workspace…");

    const device = options.device || null;
    const session = await openWorkspaceSession(serverUrl, accountToken, team, path, device);
    connection = {
      serverUrl,
      token: session.token,
      clientId: session.clientId,
      displayName: session.displayName || session.clientId,
      sessionId: session.sessionId ?? session.workspace,
      revision: session.revision ?? 0,
      role: session.role ?? "master",
      // Team cloud workspaces store files on disk + serve image bytes by URL, so
      // images upload as binary assets instead of base64 in the op stream.
      directoryBacked: true,
      eventSource: null
    };
    localRevision = connection.revision;
    // Set the reconnect context up-front so reconcileLocalIntoServer() can use it.
    // Reuse the device id on reconnect so we replace only THIS device's session.
    reconnectCtx = { serverUrl, accountToken, team, path, device };
    clearReconnect();

    if (options.reconcileLocal) {
      await reconcileLocalIntoServer(); // keep local view, push it to the server
      emitStatus("connected", `Opened ${session.workspace} — restored unsynced changes.`);
    } else {
      const snapshot = await fetchSessionState(serverUrl, connection.token);
      presence = snapshot.presence ?? [];
      if (snapshot.project) {
        isApplyingRemote = true;
        replaceProject(snapshot.project);
        isApplyingRemote = false;
        lastFingerprint = fingerprintProject(snapshot.project);
        connection.revision = snapshot.revision ?? connection.revision;
      }
      emitStatus("connected", `Opened ${session.workspace} at revision ${connection.revision}.`);
    }

    attachEventStream(serverUrl);
    return session;
  }

  // Host the CURRENT local project as an ephemeral guest session. Returns the
  // generated guest PIN to share. The host is master and pushes the local
  // project as the session's canonical state.
  async function hostForGuests(serverUrl, displayName = "") {
    disconnect();
    emitStatus("reachable", "Starting host session…");

    const session = await hostSession(serverUrl, displayName);
    connection = {
      serverUrl,
      token: session.token,
      clientId: session.clientId,
      displayName: session.displayName || session.clientId,
      sessionId: session.sessionId ?? session.workspace,
      revision: session.revision ?? 0,
      role: "master",
      eventSource: null
    };
    localRevision = connection.revision;

    // Push our local project into the fresh ephemeral session.
    await publishSnapshot(getProject());
    emitStatus("connected", `Hosting for guests — PIN ${session.guestPin}.`);

    attachEventStream(serverUrl);
    return { guestPin: session.guestPin, workspace: session.workspace };
  }

  return {
    connect,
    openWorkspace,
    hostForGuests,
    disconnect,
    publishOperation,
    publishSnapshot,
    scheduleTextPatch,
    scheduleSnapshot,
    scheduleAwareness,
    remapPatchPath,
    dropPatchPath,
    reloadFromServer,
    hasPendingPatch(fileId) {
      return pendingTextPatches.has(fileId);
    },
    // True while a file's text still has a debounced or in-flight patch, i.e. the
    // server hasn't confirmed it yet — used by auto-save to avoid marking a file
    // "saved" before its content is durably on the server.
    hasUnsyncedText(path) {
      return pendingTextPatches.has(path) || inFlightPatches.has(path) || reconnecting;
    },
    isReconnecting() {
      return reconnecting;
    },
    isDirectoryBacked() {
      return Boolean(connection?.directoryBacked);
    },
    // Upload an image's bytes to the workspace's on-disk asset store (chunked),
    // instead of pushing the base64 through the op stream.
    async uploadAsset(path, dataUrl) {
      if (!connection) throw new Error("Not connected.");
      await uploadAsset(connection.serverUrl, connection.token, path, dataUrl);
    },
    getConnectionInfo() {
      if (!connection) return null;
      return { serverUrl: connection.serverUrl, token: connection.token };
    },
    getRole() {
      return connection?.role ?? null;
    },
    getClientId() {
      return connection?.clientId ?? null;
    },
    getRevision() {
      return localRevision;
    },
    isConnected() {
      return Boolean(connection);
    },
    isApplyingRemote() {
      return isApplyingRemote;
    },
    getPresence() {
      return presence;
    }
  };
}

export { createCollaborationRuntime };