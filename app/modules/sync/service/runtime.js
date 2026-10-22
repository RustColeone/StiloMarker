// One tab's live connection to a shared workspace: joining (a PIN session, a
// team workspace, or hosting this project for guests), sending this tab's
// changes, applying everyone else's in revision order, and keeping the tab's
// typing safe through dropped streams, reconnects and conflicts (a pull never
// silently discards unconfirmed typing: it is archived first).
//
// Events Sync does not know (other modules' events on the same stream) go to
// `onEvent`; Sync owns operation, state, presence, cursor and ready.
import { buildTextPatch, applyTextPatch, cloneModelData, isTextPatch } from "../../workspace/index.js";
import { builtinTypes } from "../../file-types/index.js";
import { isAuthExpiredError, isFatalSyncError, isUpgradeError } from "../model/errors.js";
import { fingerprintProject, flattenProjectPaths, sanitizeProjectForSync, unsyncedFiles } from "../model/paths.js";
import { rebaseIncoming } from "../model/rebase.js";
import { createPatchQueue } from "./patches.js";
import { mergeOffline } from "./offline-merge.js";
import { ignore, ignored } from "../../../kernel/index.js";

const RECONNECT_DELAYS = [1000, 2000, 4000, 8000, 15000, 30000];
const isImageName = (name) => builtinTypes.isImage(name);
const superseded = () => Object.assign(new Error("Workspace open was superseded."), { status: 499 });

// api: adapters/api.js; clock: adapters/page.js (both given by index.js).
// away() -> { bases, ops }: what this tab did while away (Sync notes it);
// onAwayMerged({ merged, kept, skipped }): how putting it together went.
export function createRuntime({ getProject, replaceProject, applyOperation, onStatusChange, onRemoteCursor,
  onPatchConfirmed, onHostCounters, onEvent, preserveLocalFiles, reauthenticate, uploadAsset: uploadAssetPort, clock, api,
  away = () => ({ bases: new Map(), ops: [] }), onAwayMerged = () => {} }) {
  let connection = null;
  let isApplyingRemote = false;
  let pendingSnapshotTimer = null;
  // The project as last known to match the server, for publishSnapshot's "is
  // there anything new to send". A copy sharing the immutable text, serialised
  // only when a whole-project publish (rare) compares it.
  let lastSyncedSource = null;
  let lastFingerprint = "";
  const noteSynced = (project) => {
    const { handles, sourceIndex, ...model } = project ?? {};
    lastSyncedSource = cloneModelData(model);
    lastFingerprint = null;
  };
  const syncedFingerprint = () => {
    if (lastFingerprint === null) lastFingerprint = lastSyncedSource ? fingerprintProject(lastSyncedSource) : "";
    return lastFingerprint;
  };
  let presence = [];
  let localRevision = 0;    // the revision this tab last confirmed with the server
  let generation = 0;       // a new session (or a teardown)
  let modelGeneration = 0;  // the local model replaced
  let reloadPromise = null;
  let recovering = false;
  let eventRevision = 0;
  let deferredEvents = [];
  const activeWrites = new Set();
  const ownOperations = new Set();
  let nextOperationId = 0;
  // A cloud workspace reconnects on its own: the stream drops, edits keep
  // accumulating locally, the session is reopened with backoff, and on success
  // the local project is reconciled INTO the server so nothing typed is lost.
  let reconnectCtx = null; // { serverUrl, accountToken, team, path, device }
  let reconnecting = false;
  let reconnectTimer = null;
  let reconnectAttempts = 0;
  let reconnectTask = null;
  let leaseTimer = null;
  let reauthInFlight = false;

  const patches = createPatchQueue({
    clock,
    canQueue: () => Boolean(connection) && !isApplyingRemote && !recovering && !reconnecting,
    canSend: () => Boolean(connection) && !reconnecting && !recovering,
    revision: () => localRevision,
    send: (op) => publishOperation(op),
    epoch: () => `${generation}:${modelGeneration}`,
    currentText: (path) => flattenProjectPaths(getProject()).files.find((file) => file.path === path)?.content,
    buildTextPatch,
    failed: (path, error) => {
      if (!connection) return;
      if (isUpgradeError(error)) return handleUpgradeRequired(error);
      if (isFatalSyncError(error)) return handleStreamError();
      reloadFromServer(`A change to "${path}" was rejected — loaded the cloud version.`)
        .catch((recoveryError) => emitStatus("sync-error", `Sync paused; local edits kept. ${recoveryError.message}`));
    }
  });
  const collectUnsyncedLocalFiles = () => unsyncedFiles(getProject(), patches.unconfirmed, isImageName);
  const syncError = (error) => emitStatus("sync-error", `Sync paused; local edits kept. ${error.message}`);

  function clearReconnect() {
    if (reconnectTimer) clock.clearTimeout(reconnectTimer);
    reconnectTimer = null;
    reconnecting = false;
    reconnectAttempts = 0;
  }

  function emitStatus(status, detail) {
    onStatusChange({
      status, detail, presence,
      revision: connection?.revision ?? 0,
      sessionId: connection?.sessionId ?? null,
      displayName: connection?.displayName ?? null,
      clientId: connection?.clientId ?? null,
      role: connection?.role ?? null
    });
  }

  function clearScheduledSyncs() {
    patches.clear();
    if (pendingSnapshotTimer) clock.clearTimeout(pendingSnapshotTimer);
    pendingSnapshotTimer = null;
  }

  function markUnsyncedDirty() {
    const project = getProject();
    for (const file of flattenProjectPaths(project).files) {
      if (patches.unconfirmed(file.path)) project.nodes[file.id].dirty = true;
    }
  }

  function clearLeaseTimer() {
    if (leaseTimer !== null) clock.clearTimeout(leaseTimer);
    leaseTimer = null;
  }

  function scheduleLease() {
    clearLeaseTimer();
    if (!connection?.eventSource) return;
    const token = connection.token;
    const epoch = generation;
    leaseTimer = clock.setTimeout(async () => {
      leaseTimer = null;
      if (epoch !== generation || connection?.token !== token || !connection.eventSource) return;
      if (clock.hidden()) {
        scheduleLease();
        return;
      }
      try {
        await api.renewSessionLease(connection.serverUrl, token);
      } catch {
        if (epoch === generation && connection?.token === token) handleStreamError();
        return;
      }
      if (epoch === generation && connection?.token === token) scheduleLease();
    }, 20000);
  }

  function leaveOnPageHide() {
    if (connection?.token) api.leaveSession(connection.serverUrl, connection.token);
  }

  // A deliberate teardown (left, or opening another session): no reconnect.
  function disconnect(detail = "Server offline") {
    markUnsyncedDirty();
    generation += 1;
    modelGeneration += 1;
    patches.forgetEdits();
    ownOperations.clear();
    activeWrites.clear();
    reloadPromise = null;
    recovering = false;
    deferredEvents = [];
    reconnectCtx = null;
    reconnectTask = null;
    clearReconnect();
    clearLeaseTimer();
    clearScheduledSyncs();
    connection?.eventSource?.close();
    connection = null;
    presence = [];
    emitStatus("offline", detail);
  }

  // An out-of-date tab stops everything (no reconnect, no queued sends) until
  // it reloads; main.js turns this status into an update prompt.
  function handleUpgradeRequired(error) {
    reconnectCtx = null;
    reconnectTask = null;
    clearReconnect();
    clearLeaseTimer();
    clearScheduledSyncs();
    reconnecting = false;
    connection?.eventSource?.close();
    emitStatus("upgrade-required", error?.message || "This app is out of date. Reload to update.");
  }

  // The stream dropped. A cloud workspace is NOT torn down (that would drop the
  // synced edits and fall back to the pre-open project): it reconnects.
  function handleStreamError() {
    if (!connection || reconnecting) return;
    clearLeaseTimer();
    if (connection.eventSource) {
      connection.eventSource.close();
      connection.eventSource = null;
    }
    if (!reconnectCtx) {
      // PIN, guest and host sessions cannot reopen; main.js's PIN reconnect takes over.
      disconnect("Connection to server lost.");
      return;
    }
    // Queued patches would go to a dead token; the reconcile sends every changed file.
    clearScheduledSyncs();
    reconnecting = true;
    reconnectAttempts = 0;
    emitStatus("reconnecting", "Connection lost — reconnecting…");
    if (!clock.hidden()) scheduleReconnectAttempt();
  }

  function scheduleReconnectAttempt(immediate = false) {
    if (!reconnectCtx || (clock.hidden())) return;
    const delay = immediate ? 0 : RECONNECT_DELAYS[Math.min(reconnectAttempts, RECONNECT_DELAYS.length - 1)];
    reconnectAttempts += 1;
    reconnectTimer = clock.setTimeout(() => {
      reconnectTimer = null;
      void attemptReconnect();
    }, delay);
  }

  function attemptReconnect() {
    if (reconnectTask) return reconnectTask;
    const task = runReconnect();
    reconnectTask = task;
    const done = () => { if (reconnectTask === task) reconnectTask = null; };
    task.then(done, done);
    return task;
  }

  async function resumeConnection() {
    if (!connection) return false;
    if (!reconnectCtx) {
      // A PIN or guest session cannot be opened again, but its stream can: a
      // fresh one on the same token replaces one that may have died quietly
      // (what was missed arrives with it). A token the server forgot fails
      // there, and the session is joined again as after any drop.
      connection.eventSource?.close();
      connection.eventSource = null;
      attachEventStream(connection.serverUrl);
      return true;
    }
    if (!reconnecting) handleStreamError();
    if (reconnectTimer) clock.clearTimeout(reconnectTimer);
    reconnectTimer = null;
    await attemptReconnect();
    return true;
  }

  async function runReconnect() {
    if (!reconnectCtx || !connection) return;
    const epoch = generation;
    const baseBeforeReconnect = localRevision;
    emitStatus("reconnecting", `Reconnecting… (attempt ${reconnectAttempts})`);
    try {
      // A fresh session token: the server may have restarted.
      const session = await api.openWorkspaceSession(reconnectCtx.serverUrl, reconnectCtx.accountToken, reconnectCtx.team,
        reconnectCtx.path, reconnectCtx.device, `reconnect#${reconnectAttempts}`);
      if (epoch !== generation || !connection) return;
      connection.token = session.token;
      connection.clientId = session.clientId ?? connection.clientId;
      connection.sessionId = session.sessionId ?? session.workspace ?? connection.sessionId;
      connection.role = session.role ?? connection.role;
      await mergeAwayIntoServer(baseBeforeReconnect);
      if (epoch !== generation || !connection) return;
      clearReconnect();
      attachEventStream(reconnectCtx.serverUrl);
      emitStatus("connected", `Reconnected at revision ${connection.revision}.`);
    } catch (error) {
      if (epoch !== generation) return;
      if (isUpgradeError(error)) return handleUpgradeRequired(error);
      // The account token died: sign in again and retry with a fresh one,
      // instead of sending the dead token on every attempt.
      if (isAuthExpiredError(error) && typeof reauthenticate === "function" && !reauthInFlight) {
        reauthInFlight = true;
        try {
          const freshToken = await reauthenticate();
          if (freshToken) {
            if (epoch !== generation || !reconnectCtx) return;
            reconnectCtx.accountToken = freshToken;
            emitStatus("reconnecting", "Signed in again — reconnecting…");
            reauthInFlight = false;
            scheduleReconnectAttempt(true);
            return;
          }
          clearReconnect();
          disconnect("Session expired — sign in again to reconnect.");
          return;
        } catch (authError) {
          if (epoch !== generation) return;
          emitStatus("reconnecting", `Sign-in temporarily unavailable — retrying… (${authError.message})`);
          scheduleReconnectAttempt();
          return;
        } finally {
          reauthInFlight = false;
        }
      }
      if (reconnectCtx) {
        emitStatus("reconnecting", `Reconnect failed — retrying… (${error?.message || "offline"})`);
        scheduleReconnectAttempt();
      }
    }
  }

  // What this tab did while away, put together with what others did
  // meanwhile, file by file (service/offline-merge.js), then the server's copy
  // (with all of it) opened. What could not be merged is kept in Snapshots;
  // the server's stands. inStepAt: the revision this tab was last in step with.
  async function mergeAwayIntoServer(inStepAt) {
    if (!connection) return;
    const epoch = generation;
    const current = () => { if (epoch !== generation || !connection) throw superseded(); };
    const { bases, ops } = away();
    const result = await mergeOffline({
      fetchState: async () => { const state = await api.fetchSessionState(connection.serverUrl, connection.token); current(); return state; },
      push: async (operation) => { const answer = await api.pushOperation(connection.serverUrl, connection.token, operation); current(); adoptHostCounters(answer); },
      local: getProject(), unsynced: collectUnsyncedLocalFiles(), bases, ops, inStepAt: Number(inStepAt), buildTextPatch, isImage: isImageName
    });
    if (result.kept.size && typeof preserveLocalFiles === "function") await preserveLocalFiles(result.kept);
    current();
    onAwayMerged(result);
    const merged = result.merged.size, kept = result.kept.size;
    await reloadFromServer(kept ? `Reconnected — ${merged ? `${merged} file(s) merged; ` : ""}${kept} kept in Snapshots (changed here and there).`
      : merged ? `Reconnected — ${merged} file(s) with changes made away merged.` : "Reconnected.", { handled: new Set([...result.merged, ...result.kept.keys()]) });
  }

  // Replace the whole project, declaring the revision it is based on: the
  // server refuses it if it moved on, so a stale tab cannot wipe newer work.
  async function publishSnapshot(project, baseRevision = localRevision) {
    if (!connection || isApplyingRemote || recovering || reconnecting) return;
    const fingerprint = fingerprintProject(project);
    if (fingerprint === syncedFingerprint()) return;
    const epoch = generation;
    const modelEpoch = modelGeneration;
    const request = api.pushSessionState(connection.serverUrl, connection.token, sanitizeProjectForSync(project), baseRevision);
    activeWrites.add(request);
    let result;
    try { result = await request; } finally { activeWrites.delete(request); }
    if (epoch !== generation || modelEpoch !== modelGeneration || !connection) return;
    lastFingerprint = fingerprint;
    lastSyncedSource = null;
    localRevision = Math.max(localRevision, result.revision ?? localRevision);
    connection.revision = localRevision;
    emitStatus("connected", `Connected. Revision ${connection.revision}.`);
  }

  function adoptHostCounters(result) {
    if (result?.counters && result?.path && typeof onHostCounters === "function") onHostCounters(result.path, result.counters);
  }

  async function publishOperation(operation, { optimistic = true } = {}) {
    // Reconnecting: text is sent again by the reconcile; structural changes made
    // during a (usually brief) outage are a known gap.
    if (!connection || isApplyingRemote || recovering || reconnecting) return;
    const epoch = generation;
    const modelEpoch = modelGeneration;
    const operationId = `${generation}-${++nextOperationId}`;
    if (optimistic) ownOperations.add(operationId);
    const sent = patches.inFlight(operation.path);
    if (sent && isTextPatch(operation)) sent.operationId = operationId;
    const request = api.pushOperation(connection.serverUrl, connection.token, { ...operation, operationId });
    activeWrites.add(request);
    let result;
    try { result = await request; } catch (error) {
      if (error.status >= 400 && error.status < 500) ownOperations.delete(operationId);
      throw error;
    } finally { activeWrites.delete(request); }
    if (epoch !== generation || modelEpoch !== modelGeneration || !connection) return;
    // The HTTP reply and the stream may arrive in either order; both confirm
    // through the same ordered event path.
    handleEvent(result.type ? result : { type: "operation", clientId: connection.clientId, revision: result.revision,
      operation: { ...operation, operationId } });
    return result;
  }

  // Archive conflicting typing BEFORE replacing the local model. If archiving
  // fails, the draft stays on screen and nothing more is sent. Rechecked after
  // each await so typing during the fetch cannot be lost.
  async function adoptSnapshot(snapshot, epoch, handled = new Set()) {
    if (!snapshot.project?.nodes?.[snapshot.project.rootId]) throw new Error("The server returned an invalid workspace.");
    const serverFiles = new Map(flattenProjectPaths(snapshot.project).files.map((f) => [f.path, f.content]));
    const archived = new Map();
    while (epoch === generation && connection) {
      const toArchive = new Map([...collectUnsyncedLocalFiles()].filter(([path, content]) =>
        !handled.has(path) && serverFiles.get(path) !== content && archived.get(path) !== content));
      if (!toArchive.size) break;
      if (typeof preserveLocalFiles !== "function") throw new Error("Cannot preserve local edits — the current draft has been kept on this device.");
      await preserveLocalFiles(toArchive);
      for (const [path, content] of toArchive) archived.set(path, content);
    }
    if (epoch !== generation || !connection) return;
    clearScheduledSyncs();
    modelGeneration += 1;
    patches.forgetEdits();
    ownOperations.clear();
    isApplyingRemote = true;
    try { replaceProject(snapshot.project); } finally { isApplyingRemote = false; }
    presence = snapshot.presence ?? presence;
    localRevision = Number(snapshot.revision);
    eventRevision = localRevision;
    connection.revision = localRevision;
    noteSynced(snapshot.project);
    return archived.size;
  }

  // handled: paths already merged or kept (a merge after being away): not archived again.
  function reloadFromServer(detail, { handled } = {}) {
    if (!connection) return Promise.resolve();
    if (reloadPromise) return reloadPromise;
    const epoch = generation;
    recovering = true;
    const task = (async () => {
      // Settle the requests already sent: their writes belong in the snapshot.
      await Promise.allSettled([...activeWrites]);
      if (epoch !== generation || !connection) return;
      const snapshot = await api.fetchSessionState(connection.serverUrl, connection.token);
      if (epoch !== generation) return;
      const saved = await adoptSnapshot(snapshot, epoch, handled);
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
    task.catch((error) => { if (epoch === generation) syncError(error); });
    const done = () => { if (epoch === generation && reloadPromise === task) reloadPromise = null; };
    task.then(done, done);
    return task;
  }

  let awarenessTimer = null;
  function scheduleAwareness(fileId, selStart, selEnd) {
    if (!connection) return;
    if (awarenessTimer) clock.clearTimeout(awarenessTimer);
    awarenessTimer = clock.setTimeout(() => {
      awarenessTimer = null;
      if (connection) api.pushCursor(connection.serverUrl, connection.token, { fileId, selStart, selEnd }).catch(ignored("sending the cursor failed"));
    }, 100);
  }

  function scheduleSnapshot(project) {
    if (!connection || isApplyingRemote || recovering) return;
    if (pendingSnapshotTimer) clock.clearTimeout(pendingSnapshotTimer);
    const baseRevision = localRevision;
    const snapshot = sanitizeProjectForSync(project);
    pendingSnapshotTimer = clock.setTimeout(() => {
      pendingSnapshotTimer = null;
      publishSnapshot(snapshot, baseRevision).catch((error) => {
        if (error?.status === 409) {
          // The server moved on: take its copy instead of replacing it with ours.
          reloadFromServer("Server has newer content — pulled it instead of replacing.").catch(syncError);
          return;
        }
        if (isUpgradeError(error)) return handleUpgradeRequired(error);
        if (!isFatalSyncError(error)) {
          emitStatus("connected", `Server rejected a project snapshot (${error.message || error.status}). Still connected.`);
          return;
        }
        handleStreamError();
      });
    }, 120);
  }

  function startSession(serverUrl, session, extra) {
    connection = { serverUrl, token: session.token, clientId: session.clientId, displayName: session.displayName || session.clientId,
      sessionId: session.sessionId ?? session.workspace, revision: session.revision ?? 0, eventSource: null, ...extra };
    localRevision = connection.revision;
    eventRevision = localRevision;
  }

  function adoptRemote(snapshot) {
    isApplyingRemote = true;
    try { replaceProject(snapshot.project); } finally { isApplyingRemote = false; }
    noteSynced(snapshot.project);
    localRevision = Number(snapshot.revision);
    eventRevision = localRevision;
    connection.revision = localRevision;
  }

  async function connect(serverUrl, pin, displayName = "") {
    disconnect();
    emitStatus("reachable", "Connecting to server...");
    const session = await api.connectToServer(serverUrl, pin, displayName);
    startSession(serverUrl, session, { displayName: (session.displayName ?? displayName.trim()) || session.clientId,
      sessionId: session.sessionId ?? "default", role: session.role ?? "client" });
    const snapshot = await api.fetchSessionState(serverUrl, connection.token);
    presence = snapshot.presence ?? [];
    if (connection.role === "master") {
      // The master's local project is the session's.
      await publishSnapshot(getProject());
      emitStatus("connected", "Connected as master. Project pushed to server.");
    } else if (snapshot.project) {
      adoptRemote(snapshot);
      emitStatus("connected", `Connected as client. Pulled server revision ${connection.revision}.`);
    } else {
      emitStatus("connected", "Connected as client. Server has no project yet.");
    }
    attachEventStream(serverUrl);
    return session;
  }

  function attachEventStream(serverUrl) {
    const epoch = generation;
    const stream = api.openEventStream(serverUrl, connection.token,
      (event) => { if (epoch === generation && connection?.eventSource === stream) handleEvent(event); },
      () => { if (epoch === generation && connection?.eventSource === stream) handleStreamError(); });
    connection.eventSource = stream;
    scheduleLease();
  }

  function handleEvent(event) {
    if (!connection) return;
    if (recovering) {
      deferredEvents.push(event);
      return;
    }
    if (event.type === "ready") {
      // The subscription's revision: edits made between the snapshot and the
      // stream opening are not in the snapshot.
      if (Number(event.revision) > eventRevision) void reloadFromServer("Caught up with edits made while joining.").catch(syncError);
      return;
    }
    if (event.type === "operation" || event.type === "state") {
      if (Number(event.revision) <= eventRevision) return;
      if (event.type === "operation" && Number(event.revision) !== eventRevision + 1) {
        deferredEvents.push(event);
        void reloadFromServer("Caught up with missed changes.").catch(syncError);
        return;
      }
      eventRevision = Number(event.revision);
    }
    if (event.type === "operation" && event.operation) return applyRemoteOperation(event);
    if (event.type === "state" && event.project) {
      if (event.clientId === connection.clientId) {
        localRevision = Math.max(localRevision, event.revision ?? localRevision);
        connection.revision = localRevision;
        emitStatus("connected", `Connected. Revision ${connection.revision}.`);
        return;
      }
      void reloadFromServer("Loaded the updated cloud workspace.").catch(syncError);
      return;
    }
    if (event.type === "presence") {
      presence = event.presence ?? [];
      emitStatus("connected", event.message || `Presence updated. ${presence.length} active.`);
      return;
    }
    if (event.type === "cursor") {
      onRemoteCursor?.(event);
      return;
    }
    if (event.type !== "operation" && event.type !== "state") onEvent?.(event, { ownClientId: connection.clientId });
  }

  function applyRemoteOperation(event) {
    if (event.clientId === connection.clientId && ownOperations.delete(event.operation.operationId)) {
      patches.confirm(event.operation.path, event.operation.operationId);
      adoptHostCounters({ path: event.operation.path, counters: event.operation.counters });
      noteSynced(getProject());
      localRevision = Math.max(localRevision, event.revision ?? localRevision);
      connection.revision = localRevision;
      emitStatus("connected", `Connected. Revision ${connection.revision}.`);
      onPatchConfirmed?.();
      return;
    }
    let opToApply = event.operation;
    try {
      if (isTextPatch(opToApply) && opToApply.path) {
        const path = opToApply.path;
        opToApply = rebaseIncoming(opToApply, patches.inFlight(path), patches.queued(path), { buildTextPatch, applyTextPatch });
        const file = flattenProjectPaths(getProject()).files.find((entry) => entry.path === path);
        if (!file) throw new Error("Remote patch targets a missing file");
        applyTextPatch(file.content, opToApply); // strict check before the model changes
      } else if (collectUnsyncedLocalFiles().size) {
        // Whole-file and structural changes cannot safely commute with drafts.
        throw new Error("Workspace changed while local edits were pending");
      }
    } catch {
      void reloadFromServer("Sync conflict — preserving local edits and loading the cloud version.").catch(syncError);
      return;
    }
    isApplyingRemote = true;
    try {
      applyOperation(event.clientId, opToApply);
      markUnsyncedDirty();
    } catch (error) {
      isApplyingRemote = false;
      ignore(error, `applying the change at revision ${event.revision} failed; reloading`);
      reloadFromServer(`Sync conflict at revision ${event.revision} — reloading.`).catch(ignored("reloading after a failed change failed"));
      return;
    } finally {
      isApplyingRemote = false;
    }
    noteSynced(getProject());
    localRevision = Math.max(localRevision, event.revision ?? localRevision);
    connection.revision = localRevision;
    emitStatus("connected", `Connected. Applied remote operation at revision ${connection.revision}.`);
  }

  // Open a team workspace as a signed-in account. Normally the cloud copy is
  // pulled. With { reconcileLocal: true } (a reload that still holds unsynced
  // edits for THIS workspace) the local copy is pushed instead, but only when it
  // is based on the server's current revision: pushing a stale copy over newer
  // work is how a whole workspace once went back to an old version.
  async function openWorkspace(serverUrl, accountToken, team, path, options = {}) {
    disconnect();
    const epoch = generation;
    emitStatus("reachable", "Opening workspace…");
    const device = options.device || null;
    let session;
    try {
      session = await api.openWorkspaceSession(serverUrl, accountToken, team, path, device, options.reason || "open");
    } catch (error) {
      if (isUpgradeError(error)) handleUpgradeRequired(error);
      throw error;
    }
    if (epoch !== generation) throw superseded();
    // Team workspaces keep files on disk and serve images by URL, so images
    // upload as files instead of travelling in operations.
    startSession(serverUrl, session, { role: session.role ?? "master", directoryBacked: true });
    reconnectCtx = { serverUrl, accountToken, team, path, device }; // the same device replaces only its own session
    clearReconnect();
    const localBase = options.localBaseRevision == null ? NaN : Number(options.localBaseRevision);
    if (options.reconcileLocal) {
      // Changes made here before (offline, or before a reload): merged in.
      await mergeAwayIntoServer(localBase);
      if (epoch !== generation) throw superseded();
      emitStatus("connected", `Opened ${session.workspace} — changes made here merged.`);
    } else {
      const snapshot = await api.fetchSessionState(serverUrl, connection.token);
      if (epoch !== generation) throw superseded();
      adoptRemote(snapshot); // opening another workspace must not archive the previous one's files
      presence = snapshot.presence ?? [];
      emitStatus("connected", `Opened ${session.workspace} at revision ${connection.revision}.`);
    }
    attachEventStream(serverUrl);
    return session;
  }

  // Host this project for guests: a temporary session whose PIN is shared.
  async function hostForGuests(serverUrl, displayName = "") {
    disconnect();
    emitStatus("reachable", "Starting host session…");
    const session = await api.hostSession(serverUrl, displayName);
    startSession(serverUrl, session, { role: "master" });
    await publishSnapshot(getProject());
    emitStatus("connected", `Hosting for guests — PIN ${session.guestPin}.`);
    attachEventStream(serverUrl);
    return { guestPin: session.guestPin, workspace: session.workspace };
  }

  return {
    connect, openWorkspace, resumeConnection, hostForGuests, disconnect, leaveOnPageHide,
    publishOperation, publishSnapshot, scheduleSnapshot, scheduleAwareness, reloadFromServer,
    scheduleTextPatch: patches.schedule,
    // Typing still waiting, sent now (the page is going).
    flushPatches: () => patches.flushAll(),
    remapPatchPath: patches.remap,
    dropPatchPath: patches.drop,
    hasPendingPatch: (path) => patches.hasQueued(path),
    // Text the server has not confirmed yet (auto-save must not call it saved).
    hasUnsyncedText: (path) => patches.unconfirmed(path) || reconnecting || recovering,
    isReconnecting: () => reconnecting,
    isDirectoryBacked: () => Boolean(connection?.directoryBacked),
    // An image's bytes go to the workspace's file store in chunks, not through operations.
    async uploadAsset(path, dataUrl) {
      if (!connection) throw new Error("Not connected.");
      await uploadAssetPort(connection.serverUrl, connection.token, path, dataUrl);
    },
    getConnectionInfo: () => connection && { serverUrl: connection.serverUrl, token: connection.token, sessionId: connection.sessionId },
    getRole: () => connection?.role ?? null,
    getClientId: () => connection?.clientId ?? null,
    getRevision: () => localRevision,
    isConnected: () => Boolean(connection),
    isApplyingRemote: () => isApplyingRemote,
    getPresence: () => presence
  };
}
