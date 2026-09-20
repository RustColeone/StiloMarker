import test from "node:test";
import assert from "node:assert/strict";

import { addFile, createProject, markFileSaved, markFilesSaved, getNode } from "../app/domain/project-model.js";

const GAP_MS = 600 * 1000;

function projectWithFile() {
  const base = createProject("Novel");
  const next = addFile(base, base.rootId, "ch1.md");
  const id = Object.values(next.nodes).find((n) => n.kind === "file" && n.name === "ch1.md").id;
  return { project: next, id };
}

test("edit sessions: a new file starts at 0.0.0", () => {
  const { project, id } = projectWithFile();
  const file = getNode(project, id);
  assert.equal(file.editSessions, 0);
  assert.equal(file.sessionEdits, 0);
  assert.equal(file.sourceVersion, 0);
});

test("edit sessions: consecutive saves stay in one sitting", () => {
  let { project, id } = projectWithFile();
  project = markFileSaved(project, id);
  project = markFileSaved(project, id);
  project = markFileSaved(project, id);
  const file = getNode(project, id);
  assert.equal(file.editSessions, 1, "one sitting");
  assert.equal(file.sessionEdits, 3, "three edits in it");
  assert.equal(file.sourceVersion, 3, "lifetime count keeps climbing");
});

test("edit sessions: an idle gap opens a new sitting and resets N", () => {
  let { project, id } = projectWithFile();
  project = markFileSaved(project, id);
  project = markFileSaved(project, id);
  // Walk away: rewind lastEditAt past the gap rather than waiting 10 minutes.
  project = structuredClone(project);
  project.nodes[id].lastEditAt = Date.now() - GAP_MS - 1000;
  project = markFileSaved(project, id);
  const file = getNode(project, id);
  assert.equal(file.editSessions, 2, "second sitting");
  assert.equal(file.sessionEdits, 1, "N reset");
  assert.equal(file.sourceVersion, 3, "lifetime count did NOT reset");
});

test("edit sessions: countEdits=false leaves every counter alone", () => {
  // A synced workspace: the host owns the counters so all peers agree on E.
  let { project, id } = projectWithFile();
  project = markFileSaved(project, id, false);
  project = markFileSaved(project, id, false);
  const file = getNode(project, id);
  assert.equal(file.editSessions, 0);
  assert.equal(file.sessionEdits, 0);
  assert.equal(file.sourceVersion, 0, "no local drift against the host");
  assert.equal(file.dirty, false, "but the file is still marked saved");
});

test("edit sessions: a batch auto-save shares one timestamp", () => {
  const base = createProject("Novel");
  const withA = addFile(base, base.rootId, "a.md");
  const withB = addFile(withA, withA.rootId, "b.md");
  const ids = Object.values(withB.nodes).filter((n) => n.kind === "file").map((n) => n.id);
  let project = withB;
  for (const id of ids) project.nodes[id].dirty = true;
  project = markFilesSaved(project, ids);
  const stamps = new Set(ids.map((id) => getNode(project, id).lastEditAt));
  assert.equal(stamps.size, 1, "one flush is one instant");
  for (const id of ids) {
    assert.equal(getNode(project, id).editSessions, 1);
    assert.equal(getNode(project, id).sessionEdits, 1);
  }
});

test("edit sessions: markFilesSaved honours countEdits=false too", () => {
  const base = createProject("Novel");
  const withA = addFile(base, base.rootId, "a.md");
  const id = Object.values(withA.nodes).find((n) => n.kind === "file").id;
  withA.nodes[id].dirty = true;
  const project = markFilesSaved(withA, [id], false);
  assert.equal(getNode(project, id).sourceVersion, 0);
  assert.equal(getNode(project, id).dirty, false);
});
