// The edits the agent proposes: applied (Keep) or undone (Drop), files it
// generated, the batch they belong to.
// Part of the Assistant's Agent page: `app` is its shared context (panel.js).
import { undoSteps } from "../model/undo.js";
import { isImageFileName, UPDATE_FILE } from "../../workspace/index.js";
import { normalizeServerUrl } from "../../shell/index.js";

export function createProposals(app) {
  const { agentCheckpoints, captureAgentCheckpoint, clearAgentDecorations, collaboration, controller, jumpToAgentChange, notify, registerAgentDecorations, settings, workspace, showConfirmDialog, showToast, identity, chatState, agent } = app;
  // ---------------------------------------------------------------------------
  // Proposal card click handlers (Phase 4 / Phase 3 transport)
  // ---------------------------------------------------------------------------

  /** Find the thread and message that own a given batchId. */
  function findBatchMessage(batchId) {
    for (const thread of chatState.threads) {
      const msg = thread.messages.find((m) => m.batchId === batchId);
      if (msg) return { thread, msg };
    }
    return null;
  }

  /** Apply an agent batch immediately on arrival, then surface Keep/Drop review.
   *  Deletes still get a one-time confirm (Phase 7 safety) since they're destructive,
   *  but everything is recoverable via Drop (the checkpoint captures pre-apply state). */
  async function autoApplyProposals(message, guard) {
    const ops = message.proposedOperations ?? [];
    if (!ops.length) return;
    if (ops.some(op => op.type === "delete-node")) {
      const confirmed = await showConfirmDialog({ title: "Delete included",
        message: "Some of these changes delete files or folders. Apply them now? You can still Drop to undo.", acceptLabel: "Apply" });
      if (!guard.current()) return;
      if (!confirmed) { message.proposalState = "dropped"; app.persistChatWorkspaceState(); return; }
    }
    if (!guard.current()) return;
    await acceptAgentOperations(ops, message, guard);
    if (!guard.current()) return;
    message.proposalState = ops.some(op => op.proposalState === "accepted") ? "accepted" : "stale";
    app.persistChatWorkspaceState();
    app.renderChatPanel(controller.getProject());
  }

  /** URL of an image the agent generated (kept on the server for 14 days). */
  function generatedImageUrl(image) {
    const token = identity.token();
    if (!token || !image?.id) return "";
    return `${normalizeServerUrl(settings.serverUrl)}/api/generated?token=${encodeURIComponent(token)}&id=${encodeURIComponent(image.id)}`;
  }

  /** Bytes of a generated image as a data: URL, the form image files take. */
  async function fetchGeneratedImage(image) {
    const url = generatedImageUrl(image);
    if (!url) throw new Error("Sign in to save generated images.");
    const response = await fetch(url);
    if (!response.ok) throw new Error(response.status === 404 ? "The generated image has expired." : `Image download failed (${response.status}).`);
    const blob = await response.blob();
    return await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error ?? new Error("Could not read the generated image."));
      reader.readAsDataURL(blob);
    });
  }

  // The agent is a collaborator: each text edit goes through the Workspace
  // write path and is placed into the file as it is now, so it merges with
  // whatever anyone typed meanwhile. An edit that no longer fits is marked
  // stale on its own; the rest still apply. Other changes (create, rename,
  // move, delete) are sent one at a time, and the server refuses any that no
  // longer make sense.
  async function acceptAgentOperations(ops, message, guard) {
    if (message.batchId) captureAgentCheckpoint(message.batchId, message.baseRevision);
    let unplaced = 0;
    for (const op of ops) {
      if (!guard.current()) return;
      const name = op.name ?? op.path?.split("/").pop() ?? "";
      // The agent cannot write image bytes itself; a generated image is fetched
      // from the server and saved like any image the user adds.
      const generated = op.type === "create-file" && op.generatedImage?.id && isImageFileName(name);
      if ((op.type === UPDATE_FILE || op.type === "create-file") && isImageFileName(name) && !generated) {
        op.proposalState = "stale"; continue;
      }
      if (op.type === UPDATE_FILE) {
        try { await workspace.write(op.path, op.content, { base: op.preImage, source: "assistant" }); op.proposalState = "accepted"; }
        catch { op.proposalState = "stale"; unplaced += 1; }
        continue;
      }
      const { proposalId, preImage, proposalState, generatedImage, ...cleanOp } = op;
      try {
        if (generated) {
          cleanOp.content = await fetchGeneratedImage(generatedImage);
          if (!guard.current()) return;
        }
        await applyAgentStructure(cleanOp, Boolean(generated));
        op.proposalState = "accepted";
      } catch (error) {
        op.proposalState = "stale";
        for (const remaining of ops.slice(ops.indexOf(op) + 1)) remaining.proposalState = "stale";
        if (guard.current()) showToast(`Agent edit was not applied: ${error.message}`);
        break;
      }
    }
    if (unplaced && guard.current()) {
      showToast(`${unplaced} agent edit${unplaced === 1 ? "" : "s"} no longer fit the file${unplaced === 1 ? "" : "s"} and ${unplaced === 1 ? "was" : "were"} not applied.`);
    }
    if (guard.current() && message.batchId) registerAgentDecorations(ops, message.batchId);
  }

  // A create, rename, move or delete, sent for the server's confirmation (or
  // applied here in a workspace kept in this browser). Image bytes in a cloud
  // workspace upload first: they live on disk, not in the operation log.
  async function applyAgentStructure(op, binary = false) {
    if (collaboration.isConnected() && app.workspaceMode() === "synced") {
      let operation = op;
      if (binary && collaboration.isDirectoryBacked?.()) {
        await collaboration.uploadAsset([op.parentPath, op.name].filter(Boolean).join("/"), op.content);
        operation = { ...op, content: "" };
      }
      const result = await collaboration.publishOperation({ ...operation, baseRevision: collaboration.getRevision() }, { optimistic: false });
      if (!result) throw new Error("Workspace connection changed");
    } else {
      controller.applySyncOperation(op);
    }
  }

  // Drop after the edits were applied: undo the agent's own changes, newest
  // first. Text through the write path (lines others changed stay), the rest
  // by undoSteps(). Returns what could not be undone.
  async function undoAgentBatch(msg, checkpoint) {
    const failed = [];
    for (const op of [...(msg.proposedOperations ?? [])].reverse()) {
      if (op.proposalState !== "accepted") continue;
      try {
        if (op.type === UPDATE_FILE) await workspace.write(op.path, op.preImage, { base: op.content, source: "assistant undo" });
        else for (const step of undoSteps(op, checkpoint?.project)) await applyAgentStructure(step, step.type === "create-file" && isImageFileName(step.name));
      } catch {
        failed.push(op.path ?? [op.parentPath, op.name].filter(Boolean).join("/"));
      }
    }
    return failed;
  }

  async function dropAgentBatch(batchId) {
    const found = findBatchMessage(batchId);
    if (!found) return;
    const { msg } = found;
    if (msg.proposalState === "accepted") {
      const failed = await undoAgentBatch(msg, agentCheckpoints.get(batchId));
      agentCheckpoints.delete(batchId);
      if (failed.length) notify(`Dropped. These could not be undone because they changed too much since: ${failed.join(", ")}.`);
    }
    msg.proposalState = "dropped";
    clearAgentDecorations(batchId);    // Phase 5: remove line tints on drop
    app.persistChatWorkspaceState(controller.getProject());
    app.renderChatPanel(controller.getProject());
  }

  document.addEventListener("click", (event) => {
    // Retry a failed agent turn.
    if (event.target.closest("[data-chat-retry]")) {
      void app.retryLastChatTurn();
      return;
    }

    // Expand / collapse the agent activity log.
    if (event.target.closest("[data-chat-activity-toggle]")) {
      chatState.activityExpanded = !chatState.activityExpanded;
      app.renderChatPanel(controller.getProject());
      return;
    }

    // Expand / collapse a persisted "Thought for…" section on an assistant message.
    const thoughtToggle = event.target.closest("[data-chat-thought-toggle]");
    if (thoughtToggle) {
      const id = thoughtToggle.getAttribute("data-chat-thought-toggle");
      if (chatState.expandedReasoning.has(id)) chatState.expandedReasoning.delete(id);
      else chatState.expandedReasoning.add(id);
      app.renderChatPanel(controller.getProject());
      return;
    }

    // Jump to first changed line in editor (Phase 5 / subtask 5.3)
    const jumpBtn = event.target.closest("[data-batch-jump]");
    if (jumpBtn) {
      jumpToAgentChange(jumpBtn.dataset.batchJump);
      return;
    }

    // Keep — finalise applied agent edits: clear decorations and mark kept.
    const keepBtn = event.target.closest("[data-batch-keep]");
    if (keepBtn) {
      const batchId = keepBtn.dataset.batchKeep;
      const found = findBatchMessage(batchId);
      if (!found) return;
      found.msg.proposalState = "kept";
      agentCheckpoints.delete(batchId);  // release checkpoint memory (subtask 6.5)
      clearAgentDecorations(batchId);    // Phase 5: remove line tints
      app.persistChatWorkspaceState(controller.getProject());
      app.renderChatPanel(controller.getProject());
      return;
    }

    // Drop all (pre-accept dismiss) or Drop post-accept (undo the agent's changes)
    const dropTarget = event.target.closest("[data-batch-drop-all]") ?? event.target.closest("[data-batch-drop-final]");
    if (dropTarget) {
      void dropAgentBatch(dropTarget.dataset.batchDropAll ?? dropTarget.dataset.batchDropFinal);
      return;
    }
  });

  return { findBatchMessage, autoApplyProposals, generatedImageUrl, fetchGeneratedImage, acceptAgentOperations, applyAgentStructure, undoAgentBatch, dropAgentBatch };
}
