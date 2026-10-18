// Reviewing the agent's applied edits: the lines each one changed are marked
// in the editor (the Editor's marks: tinted lines, a badge on the tab and the
// explorer row, a Keep / Drop bar over the file) until Keep or Drop; jumping
// to them; and the project as it was before each batch, for Drop to bring
// back what a delete removed.
// Part of the Assistant's Agent page: `app` is its shared context (panel.js).
import { UPDATE_FILE } from "../../workspace/index.js";
import { changedLineRange } from "../model/review.js";

const KIND = "agent-pending";
const CHECKPOINT_MAX = 10; // the last ten batches

export function createReview(app, editor) {
  const { controller, escapeHtmlAttribute } = app;
  const marks = editor.marks;

  // batchId → { project: a copy before the batch, baseRevision }.
  const agentCheckpoints = new Map();

  function captureAgentCheckpoint(batchId, baseRevision) {
    agentCheckpoints.set(batchId, { project: structuredClone(controller.getProject()), baseRevision });
    if (agentCheckpoints.size > CHECKPOINT_MAX) agentCheckpoints.delete(agentCheckpoints.keys().next().value);
  }

  // The bar over a marked file: Keep / Drop for whoever asked for the batch.
  function reviewBar(batchId) {
    const found = app.findBatchMessage(batchId);
    if (!found) return "";
    const attr = app.isOwnBatch(found.msg) ? "" : " disabled";
    const bid = escapeHtmlAttribute(batchId);
    return `<span class="agent-bar-label">Agent edits applied</span>` +
      `<button class="agent-bar-btn agent-bar-keep" type="button" data-batch-keep="${bid}"${attr} title="Finalise — keep agent changes">✓ Keep</button>` +
      `<button class="agent-bar-btn agent-bar-drop" type="button" data-batch-drop-final="${bid}"${attr} title="Revert agent changes">✗ Drop</button>`;
  }

  // Mark the lines each accepted edit of a batch changed.
  function registerAgentDecorations(ops, batchId) {
    const byPath = {};
    const mark = (range) => ({ owner: "assistant", kind: KIND, ...range, batchId,
      title: "Pending agent edit — review in chat", bar: () => reviewBar(batchId) });
    for (const op of ops) {
      if (op.proposalState !== "accepted") continue;
      if (op.type === UPDATE_FILE && typeof op.preImage === "string") {
        const range = changedLineRange(op.preImage, op.content ?? "");
        if (range) byPath[op.path] = mark(range);
      } else if (op.type === "create-file") {
        const lineCount = (op.content ?? "").split("\n").length;
        byPath[op.parentPath ? `${op.parentPath}/${op.name}` : op.name] = mark({ lineStart: 0, lineEnd: Math.max(0, lineCount - 1) });
      }
    }
    marks.put(byPath, `the agent's batch ${batchId} applied`);
  }

  function clearAgentDecorations(batchId) {
    marks.remove((entry) => entry.owner === "assistant" && entry.batchId === batchId, `the agent's batch ${batchId} reviewed`);
  }

  const batchMarked = (batchId) => marks.entries().some(([, entry]) => entry.owner === "assistant" && entry.batchId === batchId);

  // Open the first marked file of a batch, at its first changed line.
  function jumpToAgentChange(batchId) {
    for (const [path, entry] of marks.entries()) {
      if (entry.owner === "assistant" && entry.batchId === batchId && editor.parts().revealMark(path)) return;
    }
  }

  return { agentCheckpoints, captureAgentCheckpoint, registerAgentDecorations, clearAgentDecorations, batchMarked, jumpToAgentChange };
}
