import { connectToServer, fetchSessionState, openEventStream, pushOperation, pushSessionState, sanitizeProjectForSync } from "./sync-service.js";

function fingerprintProject(project) {
  return JSON.stringify(sanitizeProjectForSync(project));
}

function createCollaborationRuntime({ getProject, replaceProject, applyOperation, onStatusChange }) {
  let connection = null;
  let isApplyingRemote = false;
  let pendingTextPatches = new Map();
  let pendingSnapshotTimer = null;
  let lastFingerprint = "";
  let presence = [];

  function emitStatus(status, detail) {
    onStatusChange({
      status,
      detail,
      presence,
      revision: connection?.revision ?? 0,
      sessionId: connection?.sessionId ?? null,
      displayName: connection?.displayName ?? null,
      clientId: connection?.clientId ?? null
    });
  }

  function clearScheduledSyncs() {
    pendingTextPatches.forEach((entry) => window.clearTimeout(entry.timer));
    pendingTextPatches.clear();
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
    connection.revision = result.revision ?? connection.revision;
    lastFingerprint = fingerprintProject(getProject());
    emitStatus("connected", `Connected. Revision ${connection.revision}.`);
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

  function scheduleTextPatch(path, previousContent, nextContent) {
    if (!connection || isApplyingRemote) {
      return;
    }

    if (previousContent === nextContent) {
      return;
    }

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

    const operation = {
      type: "patch-file",
      path,
      start,
      end: previousEnd,
      removedText: previousContent.slice(start, previousEnd),
      text: nextContent.slice(start, nextEnd)
    };

    const existingEntry = pendingTextPatches.get(path);
    if (existingEntry) {
      window.clearTimeout(existingEntry.timer);
    }

    const timer = window.setTimeout(() => {
      pendingTextPatches.delete(path);
      publishOperation(operation).catch(async (error) => {
        if (error.status === 409) {
          await reloadFromServer(error.message || "Text patch conflicted with a remote change.");
          return;
        }
        disconnect(error.message || "Sync failed.");
      });
    }, 250);
    pendingTextPatches.set(path, { timer, operation });
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
      eventSource: null
    };

    const snapshot = await fetchSessionState(serverUrl, connection.token);
    presence = snapshot.presence ?? [];
    if (snapshot.project) {
      isApplyingRemote = true;
      replaceProject(snapshot.project);
      isApplyingRemote = false;
      lastFingerprint = fingerprintProject(snapshot.project);
      connection.revision = snapshot.revision ?? connection.revision;
      emitStatus("connected", `Connected. Pulled server revision ${connection.revision}.`);
    } else {
      await pushCurrentProject();
      emitStatus("connected", "Connected. Uploaded local project to server.");
    }

    connection.eventSource = openEventStream(
      serverUrl,
      connection.token,
      (event) => {
        if (!connection) {
          return;
        }

        if (event.type === "operation" && event.operation) {
          if (event.clientId === connection.clientId) {
            connection.revision = event.revision ?? connection.revision;
            emitStatus("connected", `Connected. Revision ${connection.revision}.`);
            return;
          }
          isApplyingRemote = true;
          applyOperation(event.operation);
          isApplyingRemote = false;
          lastFingerprint = fingerprintProject(getProject());
          connection.revision = event.revision ?? connection.revision;
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
        }
      },
      () => {
        disconnect("Connection to server lost.");
      }
    );

    return session;
  }

  return {
    connect,
    disconnect,
    publishOperation,
    publishSnapshot,
    scheduleTextPatch,
    scheduleSnapshot,
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