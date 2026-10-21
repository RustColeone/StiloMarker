// The workspace agent's tools, run against the project as this turn sees it,
// for the agent this browser runs with the user's own key: reading the
// project (list_files, read_file) and proposing changes to it (never applied
// here: they come back as proposals the user keeps or drops). The twin of the
// server's (server/stilo/modules/assistant/service/tools.py, model/edits.py);
// both run spec/assistant/tools.cases.json. Pure.
import { UPDATE_FILE, getNodeIdByPath, isImageFileName } from "../../workspace/index.js";
import { walkProjectTree } from "../../characters/index.js";
import { ignore } from "../../../kernel/index.js";
import contract from "./agent-contract.js";

export const MAX_EDITS = contract.limits.maxEdits;
export const READ_TOOLS = Object.freeze([...contract.readTools]);

export class EditError extends Error {}

// How many times `find` occurs in `text`, not overlapping (Python's str.count).
function occurrences(text, find) {
  let count = 0;
  for (let at = text.indexOf(find); at >= 0; at = text.indexOf(find, at + find.length)) count += 1;
  return count;
}

// Each edit's `find` must occur exactly once in `text`, edits may not
// overlap, and `replace` replaces it (empty deletes). All or nothing.
export function applyEdits(text, edits) {
  if (!Array.isArray(edits) || !edits.length) throw new EditError("edits must be a non-empty list of {find, replace}");
  if (edits.length > MAX_EDITS) throw new EditError(`at most ${MAX_EDITS} edits per call; split the change`);
  const spans = edits.map((edit, index) => {
    const number = index + 1;
    if (!edit || typeof edit !== "object" || Array.isArray(edit)) throw new EditError(`edit ${number} must be an object with find and replace`);
    const find = edit.find, replace = edit.replace ?? "";
    if (typeof find !== "string" || !find) throw new EditError(`edit ${number}: find must be the exact text to change (not empty)`);
    if (typeof replace !== "string") throw new EditError(`edit ${number}: replace must be text`);
    const count = occurrences(text, find);
    if (count === 0) throw new EditError(`edit ${number}: find was not found; copy the passage exactly as the file has it (read_file first)`);
    if (count > 1) throw new EditError(`edit ${number}: find matches ${count} times; include more surrounding text so it matches once`);
    const start = text.indexOf(find);
    return { start, end: start + find.length, replace, number };
  });
  spans.sort((a, b) => a.start - b.start || a.end - b.end || a.number - b.number);
  for (let index = 1; index < spans.length; index += 1) {
    if (spans[index].start < spans[index - 1].end) {
      throw new EditError(`edits ${spans[index - 1].number} and ${spans[index].number} overlap; merge them into one edit`);
    }
  }
  let out = text;
  for (const span of [...spans].reverse()) out = out.slice(0, span.start) + span.replace + out.slice(span.end);
  return out;
}

const nodeAt = (project, path) => {
  const id = getNodeIdByPath(project ?? { nodes: {} }, path);
  return id ? project.nodes[id] : null;
};

// An edit_file call, resolved against the file as the agent sees it this
// turn (the project, or an earlier proposal for the same file in this turn).
export function proposeEdit(project, proposals, path, edits, proposalId) {
  const target = String(path ?? "").trim();
  if (!target) return { error: "path is required" };
  if (isImageFileName(target)) return { error: "Images cannot be edited as text." };
  let base = null;
  for (const proposal of [...proposals].reverse()) {
    if ("content" in proposal && proposal.type !== "delete-node") {
      const at = proposal.path || [proposal.parentPath, proposal.name].filter(Boolean).join("/");
      if (at === target) { base = proposal.content ?? ""; break; }
    }
  }
  if (base === null) {
    const node = nodeAt(project, target);
    if (!node || node.kind !== "file") return { error: `File not found: ${target}. Use create_file for a new file.` };
    base = node.content ?? "";
  }
  let content;
  try {
    content = applyEdits(base, edits);
  } catch (error) {
    if (error instanceof EditError) return { error: error.message };
    throw error;
  }
  if (content === base) return { status: "unchanged", message: "These edits change nothing." };
  proposals.push({ proposalId, type: UPDATE_FILE, path: target, content, preImage: base,
    edits: edits.map((edit) => ({ find: edit.find, replace: edit.replace ?? "" })) });
  return { status: "proposed", proposalId, edits: edits.length };
}

const text = (value, fallback = "") => (value === undefined || value === null ? fallback : String(value));

// A move's index, as the server reads it (a whole number, or none).
function indexOf(value) {
  if (typeof value === "number" && Number.isFinite(value)) return Math.trunc(value);
  if (typeof value === "boolean") return value ? 1 : 0;
  if (typeof value === "string" && /^\s*[-+]?\d+\s*$/.test(value)) return Number.parseInt(value, 10);
  return undefined;
}

// One tool call against the project. Read tools answer at once; the others
// add a proposal and answer that they did. With readOnly (a character) only
// reading is allowed. newId() names a proposal.
export function runTool(name, args, project, proposals, { readOnly = false, newId }) {
  if (!args || typeof args !== "object" || Array.isArray(args)) return { error: "Tool arguments must be an object." };
  if (readOnly && !READ_TOOLS.includes(name)) return { error: "Characters can read workspace files but cannot change them." };
  const proposalId = newId();
  if (name === "list_files") return { files: walkProjectTree(project) };
  if (name === "read_file") {
    const path = text(args.path).trim();
    const id = getNodeIdByPath(project, path);
    if (!id) return { error: `File not found: ${path}` };
    const node = project.nodes[id] ?? {};
    if (node.kind !== "file") return { error: `Not a file: ${path}` };
    return { content: node.content ?? "" };
  }
  if (name === "generate_image") return { error: "Image generation is not available." };
  if (name === "create_file") {
    proposals.push({ proposalId, type: "create-file", parentPath: text(args.parentPath), name: text(args.name), content: text(args.content) });
    return { status: "proposed", proposalId };
  }
  if (name === "edit_file") return proposeEdit(project, proposals, args.path, args.edits, proposalId);
  if (name === "update_file") {
    const path = text(args.path).trim();
    proposals.push({ proposalId, type: UPDATE_FILE, path, content: text(args.content), preImage: nodeAt(project, path)?.content ?? "" });
    return { status: "proposed", proposalId };
  }
  if (name === "rename_node") {
    const path = text(args.path).trim();
    proposals.push({ proposalId, type: "rename-node", path, name: text(args.name), preImage: nodeAt(project, path)?.name ?? "" });
    return { status: "proposed", proposalId };
  }
  if (name === "delete_node") {
    proposals.push({ proposalId, type: "delete-node", path: text(args.path).trim() });
    return { status: "proposed", proposalId };
  }
  if (name === "create_folder") {
    proposals.push({ proposalId, type: "create-folder", parentPath: text(args.parentPath), name: text(args.name) });
    return { status: "proposed", proposalId };
  }
  if (name === "move_node") {
    const operation = { proposalId, type: "move-node", path: text(args.path).trim(), parentPath: text(args.parentPath) };
    if ("index" in args && indexOf(args.index) !== undefined) operation.index = indexOf(args.index);
    proposals.push(operation);
    return { status: "proposed", proposalId };
  }
  return { error: `Unknown tool: ${name}` };
}

// A tool call's arguments as the model sent them (unreadable: none).
export function toolArguments(raw) {
  if (raw && typeof raw === "object") return raw;
  try {
    return JSON.parse(raw || "{}");
  } catch (error) {
    ignore(error, "the model sent unreadable tool arguments: none, as the server reads them");
    return {};
  }
}
