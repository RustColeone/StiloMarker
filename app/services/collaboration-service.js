import { connectToServer, fetchSessionState, hostSession, openEventStream, openWorkspaceSession, pushCursor, pushOperation, pushSessionState, sanitizeProjectForSync, uploadAsset } from "./sync-service.js";

function fingerprintProject(project) {
  return JSON.stringify(sanitizeProjectForSync(project));
}

function createCollaborationRuntime({ getProject, replaceProject, applyOperation, onStatusChange, onRemoteCursor, onPatchConfirmed, onHostCounters, onChatWorkspaceUpdate, onCommentsUpdate, preserveLocalFiles, reauthenticate }) {
  let connection = null;
  let isApplyingRemote = false;
  let pendingTextPatches = new Map();
  let pendingSnapshotTimer = null;
  let lastFingerprint = "";
  let presence = [];
  // OT state: revision we last confirmed with the server, and in-flight patch ops
  let localRevision = 0;
  let inFlightPatches = new Map(); // path -> { baseRevision, start, end, text, removedText }
  let generation = 0;
  let reloadPromise = null;
  let recovering = false;
  let eventRevision = 0;
  let deferredEvents = [];
  const localEdits = new Set();
  const activeWrites = new Set();
  const ownOperations = new Set();
  let nextOperationId = 0;
  let modelGeneration = 0;
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
          files.push({ id: child.id, path, parentPath, name: child.name, content: child.content ?? "" });
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

  function markUnsyncedDirty() {
    const project = getProject();
    for (const file of flattenProjectPaths(project).files) {
      if (localEdits.has(file.path) || pendingTextPatches.has(file.path) || inFlightPatches.has(file.path)) {
        project.nodes[file.id].dirty = true;
      }
    }
  }

  function disconnect(detail = "Server offline") {
    markUnsyncedDirty();
    // A deliberate teardown (user left / opening a different session): stop any
    // reconnect loop so we don't keep resurrecting a session they left.
    generation += 1;
    modelGeneration += 1;
    localEdits.clear();
    ownOperations.clear();
    activeWrites.clear();
    reloadPromise = null;
    recovering = false;
    deferredEvents = [];
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

  // The server refuses stale clients (HTTP 426) so they can't clobber newer
  // content. Detect that response...
  function isUpgradeError(error) {
    return error?.status === 426 || error?.payload?.upgradeRequired === true;
  }

  // The ACCOUNT token is dead (typically because the server restarted — tokens
  // live in memory). Refreshing the session token cannot help; only logging in
  // again can. Without this a tab retries the same dead token forever: one was
  // observed making 504 failed attempts over four hours.
  function isAuthExpiredError(error) {
    return error?.status === 403 || /not logged in|invalid or expired/i.test(error?.message ?? "");
  }
  let reauthInFlight = false;

  // ...and when it happens, STOP everything (no reconnect, no queued pushes). A
  // stale tab must go quiet until it reloads to the current version; main.js turns
  // this status into an upgrade prompt / forced refresh.
  function handleUpgradeRequired(error) {
    reconnectCtx = null;
    clearReconnect();
    clearScheduledSyncs();
    reconnecting = false;
    if (connection?.eventSource) {
      try { connection.eventSource.close(); } catch { /* ignore */ }
    }
    emitStatus("upgrade-required", error?.message || "This app is out of date. Reload to update.");
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
    const epoch = generation;
    const baseBeforeReconnect = localRevision;
    emitStatus("reconnecting", `Reconnecting… (attempt ${reconnectAttempts})`);
    try {
      // Fresh session token — the server may have restarted, invalidating ours.
      const session = await openWorkspaceSession(
        reconnectCtx.serverUrl, reconnectCtx.accountToken, reconnectCtx.team, reconnectCtx.path, reconnectCtx.device,
        `reconnect#${reconnectAttempts}`
      );
      if (epoch !== generation || !connection) return;
      connection.token = session.token;
      connection.clientId = session.clientId ?? connection.clientId;
      connection.sessionId = session.sessionId ?? session.workspace ?? connection.sessionId;
      connection.role = session.role ?? connection.role;
      if (baseBeforeReconnect === Number(session.revision)) {
        await reconcileLocalIntoServer(baseBeforeReconnect);
      } else {
        await reloadFromServer("Loaded the newer cloud version.");
      }
      if (epoch !== generation || !connection) return;
      clearReconnect();
      attachEventStream(reconnectCtx.serverUrl);
      emitStatus("connected", `Reconnected at revision ${connection.revision}.`);
    } catch (error) {
      if (epoch !== generation) return;
      // A stale client is refused by the server — stop the loop and prompt an
      // update instead of hammering reconnect forever.
      if (isUpgradeError(error)) {
        handleUpgradeRequired(error);
        return;
      }
      // Account token expired: log in again and retry with a fresh one, instead
      // of re-sending the dead token on every future attempt.
      if (isAuthExpiredError(error) && typeof reauthenticate === "function" && !reauthInFlight) {
        reauthInFlight = true;
        try {
          const freshToken = await reauthenticate();
          if (freshToken) {
            if (epoch !== generation || !reconnectCtx) return;
            reconnectCtx.accountToken = freshToken;
            emitStatus("reconnecting", "Signed in again — reconnecting…");
            reauthInFlight = false;
            void attemptReconnect(); // retry straight away with the new token
            return;
          }
          // Could not sign in (no stored credentials, or they were rejected):
          // stop the loop rather than hammer a dead session.
          clearReconnect();
          disconnect("Session expired — sign in again to reconnect.");
          return;
        } catch {
          clearReconnect();
          disconnect("Session expired — sign in again to reconnect.");
          return;
        } finally {
          reauthInFlight = false;
        }
      }
      // Keep trying while the intent stands; edits remain safe in the local model.
      if (reconnectCtx) {
        emitStatus("reconnecting", `Reconnect failed — retrying… (${error?.message || "offline"})`);
        scheduleReconnectAttempt();
      }
    }
  }

  // Only reconcile against the revision the local copy actually came from.
  // Never relabel older contents with a revision obtained during recovery.
  async function reconcileLocalIntoServer(baseRevision) {
    if (!connection) return;
    const epoch = generation;
    const snapshot = await fetchSessionState(connection.serverUrl, connection.token);
    if (epoch !== generation) return;
    if (Number(snapshot.revision) !== baseRevision) {
      await reloadFromServer("Cloud changed during reconnect — loaded its newer version.");
      return;
    }
    presence = snapshot.presence ?? presence;

    const server = flattenProjectPaths(snapshot.project);
    const serverFolders = new Set(server.folders.map((f) => f.path));
    const serverFiles = new Map(server.files.map((f) => [f.path, f.content]));
    const local = flattenProjectPaths(getProject());

    const pushOp = async (operation) => {
      if (epoch !== generation || !connection) throw new Error("Session changed");
      const result = await pushOperation(connection.serverUrl, connection.token, operation);
      if (epoch !== generation) throw new Error("Session changed");
      // Keep the ORIGINAL local base until the final authoritative pull.
      // An ack can include peer revisions that this local tree has never seen.
      adoptHostCounters(result);
    };

    try {
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
          await pushOp({ type: "update-file", path: file.path, content: file.content, baseRevision });
        }
      }
    } catch (error) {
      if (error.status !== 409) throw error;
      await reloadFromServer("Cloud changed during recovery — local edits saved in Snapshots.");
      return;
    }
    // Adopt a snapshot as well: a peer may have changed a different file while
    // these requests were running, and locally generated node ids can differ.
    await reloadFromServer("Reconnected — changes saved.");
  }

  async function publishSnapshot(project, baseRevision = localRevision) {
    if (!connection || isApplyingRemote || recovering) {
      return;
    }

    const fingerprint = fingerprintProject(project);
    if (fingerprint === lastFingerprint) {
      return;
    }

    // Declare the revision this copy is based on: the server refuses the replace
    // if it has moved on, so a stale tab can no longer wipe newer work.
    if (reconnecting) return;
    const epoch = generation;
    const modelEpoch = modelGeneration;
    const request = pushSessionState(connection.serverUrl, connection.token, project, baseRevision);
    activeWrites.add(request);
    let result;
    try { result = await request; } finally { activeWrites.delete(request); }
    if (epoch !== generation || modelEpoch !== modelGeneration || !connection) return;
    lastFingerprint = fingerprint;
    localRevision = Math.max(localRevision, result.revision ?? localRevision);
    connection.revision = localRevision;
    emitStatus("connected", `Connected. Revision ${connection.revision}.`);
  }

  function adoptHostCounters(result) {
    if (result?.counters && result?.path && typeof onHostCounters === "function") {
      onHostCounters(result.path, result.counters);
    }
  }

  async function publishOperation(operation) {
    if (!connection || isApplyingRemote || recovering) {
      return;
    }
    // Reconnecting: don't push against the dead token. Text content is re-pushed
    // by the reconcile; structural ops made during the (usually brief) outage are
    // a known gap (content safety is the priority).
    if (reconnecting) {
      return;
    }

    const epoch = generation;
    const modelEpoch = modelGeneration;
    const pending = inFlightPatches.get(operation.path);
    const operationId = `${generation}-${++nextOperationId}`;
    ownOperations.add(operationId);
    const request = pushOperation(connection.serverUrl, connection.token, { ...operation, operationId });
    activeWrites.add(request);
    let result;
    try { result = await request; }
    catch (error) {
      if (error.status >= 400 && error.status < 500) ownOperations.delete(operationId);
      throw error;
    } finally { activeWrites.delete(request); }
    if (epoch !== generation || modelEpoch !== modelGeneration || !connection) return;
    if (Number(result.revision) > localRevision + 1 && !recovering) {
      await reloadFromServer("Caught up with changes confirmed by the server.");
      return;
    }
    localRevision = Math.max(localRevision, result.revision ?? localRevision);
    connection.revision = localRevision;
    adoptHostCounters(result);
    // Once the server confirms this op, it's no longer in-flight.
    if (operation.type === "patch-file" && inFlightPatches.get(operation.path) === pending) {
      inFlightPatches.delete(operation.path);
      if (!pendingTextPatches.has(operation.path)) localEdits.delete(operation.path);
    }
    lastFingerprint = fingerprintProject(getProject());
    if (!recovering) emitStatus("connected", `Connected. Revision ${connection.revision}.`);
    // Text is now confirmed on the server — broadcast the definitive cursor
    // position so peers see where we ended up after the edit.
    if (typeof onPatchConfirmed === "function") {
      onPatchConfirmed();
    }
  }

  // Files the user has edited locally that the server has not confirmed. A pull
  // must never silently discard these: a dropped stream followed by a server
  // pull is exactly what turned "connection blipped" into "everything reverted
  // to a previous version and my edits are gone".
  function collectUnsyncedLocalFiles() {
    const project = getProject();
    const out = new Map();
    if (!project?.nodes) return out;
    const walk = (nodeId, parentPath) => {
      const node = project.nodes[nodeId];
      for (const childId of node?.children ?? []) {
        const child = project.nodes[childId];
        if (!child) continue;
        const path = parentPath ? `${parentPath}/${child.name}` : child.name;
        if (child.kind === "folder") {
          walk(childId, path);
        } else if (child.kind === "file" && (child.dirty || localEdits.has(path) || pendingTextPatches.has(path) || inFlightPatches.has(path)) && !isImageName(child.name)) {
          out.set(path, child.content ?? "");
        }
      }
    };
    walk(project.rootId, "");
    return out;
  }

  // Preserve a conflicting draft in history BEFORE replacing the local model.
  // A preservation failure leaves the draft on screen and blocks further sends.
  // Recheck after each await so typing during the fetch/archive cannot be lost.
  async function adoptSnapshot(snapshot, epoch) {
    if (!snapshot.project?.nodes?.[snapshot.project.rootId]) {
      throw new Error("The server returned an invalid workspace.");
    }
    const serverFiles = new Map(flattenProjectPaths(snapshot.project).files.map((f) => [f.path, f.content]));
    const archived = new Map();
    while (epoch === generation && connection) {
      const unsynced = collectUnsyncedLocalFiles();
      const toArchive = new Map([...unsynced].filter(([path, content]) =>
        serverFiles.get(path) !== content && archived.get(path) !== content));
      if (!toArchive.size) break;
      if (typeof preserveLocalFiles !== "function") {
        throw new Error("Cannot preserve local edits — the current draft has been kept on this device.");
      }
      await preserveLocalFiles(toArchive);
      for (const [path, content] of toArchive) archived.set(path, content);
    }
    if (epoch !== generation || !connection) return;
    clearScheduledSyncs();
    modelGeneration += 1;
    localEdits.clear();
    ownOperations.clear();
    isApplyingRemote = true;
    try { replaceProject(snapshot.project); } finally { isApplyingRemote = false; }
    presence = snapshot.presence ?? presence;
    localRevision = Number(snapshot.revision);
    eventRevision = localRevision;
    connection.revision = localRevision;
    lastFingerprint = fingerprintProject(snapshot.project);
    return archived.size;
  }

  function reloadFromServer(detail) {
    if (!connection) return Promise.resolve();
    if (reloadPromise) return reloadPromise;
    const epoch = generation;
    recovering = true;
    const task = (async () => {
      // Pause sends and settle requests already issued before taking the
      // snapshot; their successful writes must be included in that snapshot.
      await Promise.allSettled([...activeWrites]);
      if (epoch !== generation || !connection) return;
      const snapshot = await fetchSessionState(connection.serverUrl, connection.token);
      if (epoch !== generation) return;
      const saved = await adoptSnapshot(snapshot, epoch);
      if (epoch !== generation) return;
      recovering = false;
      emitStatus("connected", saved
        ? `${detail || "Loaded cloud version."} Local changes preserved in Snapshots (${saved} file(s)).`
        : (detail || "Loaded cloud version."));
      const queued = deferredEvents;
      deferredEvents = [];
      reloadPromise = null;
      for (const event of queued) handleEvent(event);
    })();
    reloadPromise = task;
    task.catch((error) => {
      if (epoch === generation) emitStatus("sync-error", `Sync paused; local edits kept. ${error.message}`);
    });
    task.finally(() => {
      if (epoch === generation && reloadPromise === task) reloadPromise = null;
    }).catch(() => {});
    return task;
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
    if (!connection || isApplyingRemote || recovering) {
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
    localEdits.add(path);

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

  // A rejected OPERATION is not a broken CONNECTION. A 400/404/422 means the
  // server refused this one op (e.g. a stale path after a rename, or a file it
  // doesn't have). Tearing down the whole session for that is what silently
  // stopped ALL syncing: once disconnected, notifyEditorChanged stops queueing
  // patches, so the workspace goes quiet while the user keeps typing and the
  // server revision never moves again. Only transport/auth/server failures are
  // genuinely fatal to the session.
  function isFatalSyncError(error) {
    const status = Number(error?.status);
    if (!Number.isFinite(status)) return true;          // network/parse failure — really offline
    if (status === 401 || status === 403) return true;  // auth gone — must re-authenticate
    if (status >= 500) return true;                     // server side is broken
    return false;                                       // other 4xx: this op failed, session is fine
  }

  // Send the pending patch for a file, SERIALIZED: at most one patch per file may
  // be in flight at a time. If the previous one hasn't confirmed yet, wait — so
  // the next patch's offsets (and its send-time baseRevision) are always computed
  // against the server's current, confirmed content, never a stale/overlapping
  // base (the cause of characters landing in the wrong place while typing fast).
  function sendTextPatch(path) {
    const entry = pendingTextPatches.get(path);
    if (!entry || !connection || reconnecting || recovering) return;
    if (inFlightPatches.has(path)) {
      entry.timer = window.setTimeout(() => sendTextPatch(path), 120);
      return;
    }
    pendingTextPatches.delete(path);
    const op = buildPatchOp(path, entry.baseContent, entry.latest); // baseRevision = localRevision (now)
    if (!op) return;
    const epoch = generation;
    const modelEpoch = modelGeneration;
    const pending = inFlightPatches.get(path);
    publishOperation(op).catch(async (error) => {
      if (epoch !== generation || modelEpoch !== modelGeneration || !connection) return;
      // Preserve the rejected draft even if a remote operation cleared dirty.
      const file = flattenProjectPaths(getProject()).files.find((f) => f.path === path);
      if (inFlightPatches.get(path) === pending) inFlightPatches.delete(path);
      if (file && !pendingTextPatches.has(path)) {
        pendingTextPatches.set(path, { baseContent: entry.baseContent, latest: file.content, timer: null });
      }
      if (isUpgradeError(error)) {
        handleUpgradeRequired(error);
        return;
      }
      if (isFatalSyncError(error)) {
        handleStreamError();
        return;
      }
      try {
        await reloadFromServer(`A change to "${path}" was rejected — loaded the cloud version.`);
      } catch (recoveryError) {
        emitStatus("sync-error", `Sync paused; local edits kept. ${recoveryError.message}`);
      }
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
    for (const key of [...localEdits]) {
      const nk = remapped(key);
      if (nk) { localEdits.delete(key); localEdits.add(nk); }
    }
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
    for (const key of [...localEdits]) if (matches(key)) localEdits.delete(key);
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

    const splitsPair = (text, offset) => offset > 0 && offset < text.length
      && /[\uD800-\uDBFF]/.test(text[offset - 1]) && /[\uDC00-\uDFFF]/.test(text[offset]);
    if (splitsPair(previousContent, start) || splitsPair(nextContent, start)) start -= 1;
    if (splitsPair(previousContent, previousEnd) || splitsPair(nextContent, nextEnd)) {
      previousEnd += 1;
      nextEnd += 1;
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
    if (!connection || isApplyingRemote || recovering) {
      return;
    }

    if (pendingSnapshotTimer) {
      window.clearTimeout(pendingSnapshotTimer);
    }

    const baseRevision = localRevision;
    const snapshot = sanitizeProjectForSync(project);
    pendingSnapshotTimer = window.setTimeout(() => {
      pendingSnapshotTimer = null;
      publishSnapshot(snapshot, baseRevision).catch((error) => {
        if (error?.status === 409) {
          // Server moved on: adopt its copy instead of replacing it with ours.
          reloadFromServer("Server has newer content — pulled it instead of replacing.")
            .catch((error) => emitStatus("sync-error", `Sync paused; local edits kept. ${error.message}`));
          return;
        }
        if (isUpgradeError(error)) {
          handleUpgradeRequired(error);
          return;
        }
        if (!isFatalSyncError(error)) {
          emitStatus("connected", `Server rejected a project snapshot (${error.message || error.status}). Still connected.`);
          return;
        }
        handleStreamError();
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
    eventRevision = localRevision;

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
      localRevision = Number(snapshot.revision);
      eventRevision = localRevision;
      connection.revision = localRevision;
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
    const epoch = generation;
    connection.eventSource = openEventStream(
      serverUrl,
      connection.token,
      (event) => { if (epoch === generation) handleEvent(event); },
      () => { if (epoch === generation) handleStreamError(); }
    );
  }

  function handleEvent(event) {
    if (!connection) return;
    if (recovering) {
      deferredEvents.push(event);
      return;
    }
    if (event.type === "ready") {
      // Ready marks the subscription revision. The earlier HTTP snapshot
      // cannot cover edits in the interval before the stream opened.
      if (Number(event.revision) > eventRevision) {
        void reloadFromServer("Caught up with edits made while joining.")
          .catch((error) => emitStatus("sync-error", `Sync paused; local edits kept. ${error.message}`));
      }
      return;
    }
    if (event.type === "operation" || event.type === "state") {
      if (Number(event.revision) <= eventRevision) return;
      if (event.type === "operation" && Number(event.revision) !== eventRevision + 1) {
        deferredEvents.push(event);
        void reloadFromServer("Caught up with missed changes.")
          .catch((error) => emitStatus("sync-error", `Sync paused; local edits kept. ${error.message}`));
        return;
      }
      eventRevision = Number(event.revision);
    }

    if (event.type === "operation" && event.operation) {
      if (event.clientId === connection.clientId && ownOperations.delete(event.operation.operationId)) {
        localRevision = Math.max(localRevision, event.revision ?? localRevision);
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
        markUnsyncedDirty();
      } catch (err) {
        isApplyingRemote = false;
        // Model has diverged from server — reload authoritative state.
        reloadFromServer(`Sync conflict at revision ${event.revision} — reloading.`).catch(() => {});
        return;
      } finally {
        isApplyingRemote = false;
      }
      lastFingerprint = fingerprintProject(getProject());
      localRevision = Math.max(localRevision, event.revision ?? localRevision);
      connection.revision = localRevision;
      emitStatus("connected", `Connected. Applied remote operation at revision ${connection.revision}.`);
      return;
    }

    if (event.type === "state" && event.project) {
      if (event.clientId === connection.clientId) {
        localRevision = Math.max(localRevision, event.revision ?? localRevision);
        connection.revision = localRevision;
        emitStatus("connected", `Connected. Revision ${connection.revision}.`);
        return;
      }
      void reloadFromServer("Loaded the updated cloud workspace.")
        .catch((error) => emitStatus("sync-error", `Sync paused; local edits kept. ${error.message}`));
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

    // Line comments are shared, so a teammate's change arrives here and the
    // list is replaced wholesale (it is small and the server is authoritative).
    // Not filtered by clientId: the author's own echo is harmless and keeps
    // every tab of theirs in step too.
    if (event.type === "comments") {
      if (typeof onCommentsUpdate === "function") onCommentsUpdate(event.files ?? {});
      return;
    }

    if (event.type === "chat-workspace-update") {
      if (event.clientId !== connection.clientId && typeof onChatWorkspaceUpdate === "function") {
        onChatWorkspaceUpdate(event.workspace);
      }
    }
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
    let session;
    try {
      session = await openWorkspaceSession(serverUrl, accountToken, team, path, device, options.reason || "open");
    } catch (error) {
      // Stale client refused at the door — prompt an update instead of a raw error.
      if (isUpgradeError(error)) handleUpgradeRequired(error);
      throw error;
    }
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
    eventRevision = localRevision;
    // Set the reconnect context up-front so reconcileLocalIntoServer() can use it.
    // Reuse the device id on reconnect so we replace only THIS device's session.
    reconnectCtx = { serverUrl, accountToken, team, path, device };
    clearReconnect();

    // Pull-vs-push, REVISION GATED. Pushing this device's copy over the server is
    // only safe when we are based on the server's current revision (we were in
    // sync, then edited offline). If the server moved on since we last synced,
    // our copy is stale and pushing it would overwrite newer work from another
    // device — that is exactly how a whole workspace got reverted to an old
    // version. When the base is unknown or behind, PULL.
    const serverRevision = Number(session.revision ?? 0);
    const localBase = options.localBaseRevision == null ? NaN : Number(options.localBaseRevision);
    const localIsCurrent = Number.isFinite(localBase) && localBase === serverRevision;
    const shouldReconcile = Boolean(options.reconcileLocal) && localIsCurrent;
    if (options.reconcileLocal && !localIsCurrent) {
      emitStatus(
        "connected",
        `Server is at revision ${serverRevision}, ahead of this device (${Number.isFinite(localBase) ? localBase : "unknown"}) — pulling instead of overwriting it.`
      );
    }

    if (shouldReconcile) {
      await reconcileLocalIntoServer(localBase);
      emitStatus("connected", `Opened ${session.workspace} — restored unsynced changes.`);
    } else {
      if (options.reconcileLocal) {
        await reloadFromServer("Loaded the newer cloud workspace.");
      } else {
        const snapshot = await fetchSessionState(serverUrl, connection.token);
        // Opening another workspace must not archive the previous one's files.
        isApplyingRemote = true;
        try { replaceProject(snapshot.project); } finally { isApplyingRemote = false; }
        presence = snapshot.presence ?? [];
        localRevision = Number(snapshot.revision);
        eventRevision = localRevision;
        connection.revision = localRevision;
        lastFingerprint = fingerprintProject(snapshot.project);
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
    eventRevision = localRevision;

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
      return localEdits.has(path) || pendingTextPatches.has(path) || inFlightPatches.has(path) || reconnecting || recovering;
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