import { connectToServer, fetchSessionState, hostSession, openEventStream, openWorkspaceSession, pushOperation, pushSessionState, sanitizeProjectForSync, uploadAsset } from "./sync-service.js";

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
    clearScheduledSyncs();
    if (connection?.eventSource) {
      connection.eventSource.close();
    }
    connection = null;
    presence = [];
    emitStatus("offline", detail);
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
    if (snapshot.project) {
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

    if (previousContent === nextContent) {
      return;
    }

    const existingEntry = pendingTextPatches.get(path);
    if (existingEntry) {
      // A patch is already queued for this path. Cancel its timer and extend
      // the debounce window, but keep the original previousContent so the
      // resulting operation covers the entire accumulated change.
      window.clearTimeout(existingEntry.timer);
      const base = existingEntry.baseContent;
      const timer = window.setTimeout(() => {
        pendingTextPatches.delete(path);
        const op = buildPatchOp(path, base, nextContent);
        if (op) {
          publishOperation(op).catch(async (error) => {
            if (error.status === 409) {
              await reloadFromServer(error.message || "Text patch conflicted with a remote change.");
              return;
            }
            disconnect(error.message || "Sync failed.");
          });
        }
      }, 250);
      pendingTextPatches.set(path, { timer, baseContent: base });
      return;
    }

    // First call in this debounce window - record the base content.
    const timer = window.setTimeout(() => {
      pendingTextPatches.delete(path);
      const op = buildPatchOp(path, previousContent, nextContent);
      if (op) {
        publishOperation(op).catch(async (error) => {
          if (error.status === 409) {
            await reloadFromServer(error.message || "Text patch conflicted with a remote change.");
            return;
          }
          disconnect(error.message || "Sync failed.");
        });
      }
    }, 250);
    pendingTextPatches.set(path, { timer, baseContent: previousContent });
  }

  function buildPatchOp(path, previousContent, nextContent) {
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
      baseRevision: localRevision
    };

    // Track in-flight for OT rebase.
    inFlightPatches.set(path, { baseRevision: localRevision, start, end: previousEnd, text: insertText, removedText });
    return operation;
  }

  let awarenessTimer = null;
  function scheduleAwareness(fileId, selStart, selEnd) {
    if (!connection) return;
    if (awarenessTimer) window.clearTimeout(awarenessTimer);
    awarenessTimer = window.setTimeout(() => {
      awarenessTimer = null;
      if (!connection) return;
      fetch(`${connection.serverUrl}/api/session/presence?token=${encodeURIComponent(connection.token)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileId, selStart, selEnd })
      }).catch(() => { /* non-critical — ignore */ });
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
            const pending = inFlightPatches.get(event.operation.path);
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
        disconnect("Connection to server lost.");
      }
    );
  }

  // Open a persistent team workspace as a logged-in account. Unlike connect()'s
  // master branch (which pushes the local project), a cloud workspace already
  // holds the canonical project, so we always PULL it.
  async function openWorkspace(serverUrl, accountToken, team, path) {
    disconnect();
    emitStatus("reachable", "Opening workspace…");

    const session = await openWorkspaceSession(serverUrl, accountToken, team, path);
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
    reloadFromServer,
    hasPendingPatch(fileId) {
      return pendingTextPatches.has(fileId);
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