import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { loadModules, resolveFromRoot } from "./helpers/mocks.mjs";

const { projectModel } = await loadModules();

test("agent proposal round-trip via project model ops", () => {
  let p = projectModel.createProject("Test");
  p = projectModel.applySyncOperation(p, { type: "create-file", parentPath: "", name: "notes.md", content: "# Hello" });
  assert.ok(projectModel.getNodeIdByPath(p, "notes.md"), "create-file via applySyncOperation");

  p = projectModel.applySyncOperation(p, { type: "update-file", path: "notes.md", content: "# Updated" });
  assert.equal(projectModel.getNodeByPath(p, "notes.md").content, "# Updated", "update-file via applySyncOperation");

  p = projectModel.applySyncOperation(p, { type: "create-folder", parentPath: "", name: "archive" });
  assert.ok(projectModel.getNodeIdByPath(p, "archive"), "create-folder via applySyncOperation");

  p = projectModel.applySyncOperation(p, { type: "move-node", path: "notes.md", parentPath: "archive" });
  assert.ok(projectModel.getNodeIdByPath(p, "archive/notes.md"), "move-node via applySyncOperation");
});

test("backend: agentic tool loop + proposal symbols present", async () => {
  const backendSource = await readFile(resolveFromRoot("server/mdnotes_server.py"), "utf8");
  // Phase 1: tool loop + proposals
  assert.match(backendSource, /_get_tool_schemas/);
  assert.match(backendSource, /_execute_tool_call/);
  assert.match(backendSource, /proposedOperations/);
  assert.match(backendSource, /batchId/);
  assert.match(backendSource, /max_tool_iterations/);
  assert.match(backendSource, /preImage/);
  // Phase 2: sole-author revert
  assert.match(backendSource, /revision_authors/);
  assert.match(backendSource, /snapshot_history/);
  assert.match(backendSource, /revert-to-revision/);
  assert.match(backendSource, /_authorize_sole_author_revert/);
  assert.match(backendSource, /SNAPSHOT_HISTORY_N/);
});

test("client: agent decoration, checkpoint, and proposal symbols present", async () => {
  const mainSource = await readFile(resolveFromRoot("app/main.js"), "utf8");
  assert.match(mainSource, /agentPendingDecorations/);
  assert.match(mainSource, /computeChangedLineRange/);
  assert.match(mainSource, /registerAgentDecorations/);
  assert.match(mainSource, /clearAgentDecorations/);
  assert.match(mainSource, /agentCheckpoints/);
  assert.match(mainSource, /captureAgentCheckpoint/);
  assert.match(mainSource, /acceptAgentOperations/);
  assert.match(mainSource, /findBatchMessage/);
  assert.match(mainSource, /renderProposalCard/);
  assert.match(mainSource, /proposedOperations/);
});

test("chat-storage: preserves proposal fields through normalization", async () => {
  const chatStorageSource = await readFile(resolveFromRoot("app/services/chat-storage-service.js"), "utf8");
  assert.match(chatStorageSource, /proposedOperations/);
  assert.match(chatStorageSource, /batchId/);
  assert.match(chatStorageSource, /proposalState/);
  assert.match(chatStorageSource, /originatorId/);
});
