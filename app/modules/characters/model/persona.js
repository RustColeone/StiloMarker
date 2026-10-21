// Character files (`aria.persona.skill`): Markdown with an optional `---`
// header of `key: value` lines. The rest is the character sheet, sent to the
// model as written, except an `## Author's notes` section the character never
// knows. Pure. The server's twin is server/stilo/modules/characters/model.py;
// spec/characters/*.cases.json keep the two in step.

import { builtinTypes } from "../../file-types/index.js";

// The extension belongs to the File types module.
const PERSONA_SUFFIX = builtinTypes.extensionsOf("persona")[0];
const MAX_TEMPERATURE = 1.5;

function personaBaseName(path) {
  const name = String(path ?? "").split("/").pop() ?? "";
  return name.toLowerCase().endsWith(PERSONA_SUFFIX) ? name.slice(0, -PERSONA_SUFFIX.length) : name;
}

/** `@handle` for a persona file: its name, lowercased, spaces as hyphens. */
function personaHandle(path) {
  return personaBaseName(path).trim().toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^\p{L}\p{N}_-]/gu, "")
    .replace(/^-+|-+$/g, "") || "character";
}

function cleanValue(raw) {
  let value = raw.trim().replace(/\s+#.*$/, "").trim();
  if (value.length >= 2 && /^(["']).*\1$/.test(value)) value = value.slice(1, -1);
  return value;
}

function splitHeader(content) {
  const text = String(content ?? "").replace(/^﻿/, "").replace(/\r\n?/g, "\n");
  const match = /^---[ \t]*\n([\s\S]*?)\n---[ \t]*(?:\n|$)/.exec(text);
  if (!match) return { header: {}, body: text };
  const header = {};
  for (const line of match[1].split("\n")) {
    const colon = line.indexOf(":");
    if (colon <= 0 || /^\s*#/.test(line)) continue;
    const key = line.slice(0, colon).trim().toLowerCase();
    if (key && !(key in header)) header[key] = cleanValue(line.slice(colon + 1));
  }
  return { header, body: text.slice(match[0].length) };
}

/** A stable colour for a character without one: hue from a hash of the name. */
function colorFor(name) {
  let hash = 0;
  for (const char of String(name ?? "")) hash = (hash * 31 + char.codePointAt(0)) >>> 0;
  return `hsl(${hash % 360} 42% 42%)`;
}

function initialsFor(name) {
  const words = String(name ?? "").trim().split(/\s+/).filter(Boolean);
  const letters = words.length > 1 ? [words[0], words[words.length - 1]] : words;
  return letters.map((word) => Array.from(word)[0] ?? "").join("").toUpperCase() || "?";
}

function parsePersona(content, path) {
  const { header, body } = splitHeader(content);
  const name = header.name || personaBaseName(path).trim() || "Character";
  const color = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(header.color ?? "") ? header.color : colorFor(name);
  const parsedTemperature = Number.parseFloat(header.temperature);
  const temperature = Number.isFinite(parsedTemperature)
    ? Math.min(MAX_TEMPERATURE, Math.max(0, parsedTemperature))
    : null;
  return {
    path: String(path ?? ""),
    name,
    handle: personaHandle(path),
    avatar: header.avatar || "",
    color,
    temperature,
    body: body.trim(),
    // What the character knows, and the author's notes it never knows.
    ...(({ sheet, notes }) => ({ sheet: sheet.trim(), notes }))(splitAuthorNotes(body)),
    notesMode: notesMode(header)
  };
}

/** First paragraph of prose (headings and quotes skipped), for telling each
 *  character who else is in the conversation. */
function personaSummary(body, limit = 200) {
  const paragraphs = String(body ?? "").replace(/\r\n?/g, "\n").split(/\n\s*\n/);
  for (const paragraph of paragraphs) {
    const lines = paragraph.split("\n").filter((line) => line.trim() && !/^\s*(#|>|---)/.test(line));
    const text = lines.join(" ").replace(/[*_`]/g, "").replace(/\s+/g, " ").trim();
    if (text) return text.length > limit ? `${text.slice(0, limit - 1).trimEnd()}…` : text;
  }
  return "";
}

/** Handles addressed in `text`, in the order they first appear. `@all` (or
 *  `@everyone`) stands for every member, in cast order. An `@` inside a word —
 *  an e-mail address — is not a mention, nor is a handle not in the cast. */
function findMentions(text, members) {
  const handles = (members ?? []).map((member) => String(member.handle ?? "").toLowerCase()).filter(Boolean);
  const known = new Set(handles);
  const found = [];
  const add = (handle) => { if (!found.includes(handle)) found.push(handle); };
  const pattern = /(^|[^\p{L}\p{N}_@.])@([\p{L}\p{N}_-]+)/gu;
  for (const match of String(text ?? "").matchAll(pattern)) {
    const token = match[2].toLowerCase().replace(/-+$/, "");
    if (token === "all" || token === "everyone") handles.forEach(add);
    else if (known.has(token)) add(token);
  }
  return found;
}

function escapeHtml(value) {
  return String(value ?? "").replaceAll("&", "&amp;").replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

/** Round avatar: the character's image when it resolves, else initials on
 *  their colour. `src` is already resolved to something an <img> can load. */
function personaAvatarHtml(persona, src = "", className = "persona-avatar") {
  const style = `--persona-color:${escapeHtml(persona?.color ?? colorFor(persona?.name))}`;
  const inner = src
    ? `<img src="${escapeHtml(src)}" alt="" loading="lazy" draggable="false">`
    : escapeHtml(initialsFor(persona?.name));
  return `<span class="${escapeHtml(className)}" style="${style}" aria-hidden="true">${inner}</span>`;
}

// The author's notes in a character's preview: a collapsed panel that says
// plainly whether the character ever sees them.
function authorNotesHtml(persona) {
  if (!persona?.notes) return "";
  const who = persona.notesMode === "hints"
    ? "The character may get light hints from these (notes: hints), never the facts."
    : "The character never sees these.";
  return `<details class="persona-notes"><summary>Author's notes <span>${escapeHtml(who)}</span></summary>`
    + `<div class="persona-notes-body">${escapeHtml(persona.notes)}</div></details>`;
}

function personaFileName(name) {
  const base = String(name ?? "").trim().replace(/[\\/:*?"<>|]+/g, "").replace(/\s+/g, " ") || "new character";
  return `${base}${PERSONA_SUFFIX}`;
}

// ---- Author's notes and what characters may read ---------------------------

// "## Author's notes" (also "Author notes", any case) starts a section the
// character never knows; it runs to the next level-2 heading or the end. A
// heading inside a fenced code block is not a heading.
const NOTES_HEADING = /^##[ \t]+author'?s?[ \t]+notes?[ \t]*$/i;

function splitAuthorNotes(body) {
  const sheet = [], notes = [];
  let inNotes = false, fence = null;
  for (const line of String(body ?? "").replace(/\r\n?/g, "\n").split("\n")) {
    if (!fence && /^##[ \t]/.test(line)) {
      inNotes = NOTES_HEADING.test(line.trim());
      if (inNotes) continue;
    }
    (inNotes ? notes : sheet).push(line);
    const marker = /^[ \t]*(```|~~~)/.exec(line)?.[1];
    if (marker) fence = fence === null ? marker : (marker === fence ? null : fence);
  }
  return { sheet: sheet.join("\n").replace(/\s+$/, ""), notes: notes.join("\n").trim() };
}

// "hidden" (the default): a character never sees its notes. "hints": the
// sheet's header says `notes: hints`, and light hints for foreshadowing are allowed.
function notesMode(header) {
  return String(header?.notes ?? "").trim().toLowerCase() === "hints" ? "hints" : "hidden";
}

// A character file as another reader may see it: header and sheet, never the notes.
function withoutAuthorNotes(content) {
  const text = String(content ?? "").replace(/^\ufeff/, "").replace(/\r\n?/g, "\n");
  const match = /^---[ \t]*\n[\s\S]*?\n---[ \t]*(?:\n|$)/.exec(text);
  const head = match ? match[0] : "";
  return head + splitAuthorNotes(text.slice(head.length)).sheet;
}

// The project as a character may see it: no hidden files or folders, and every
// character file without its author's notes. A new object; the project is unchanged.
function charactersView(project) {
  if (!project?.nodes) return project;
  const nodes = {};
  const visit = (id, prefix) => {
    const node = project.nodes[id];
    if (!node) return;
    const path = node.parentId ? `${prefix}${node.name}` : "";
    if (path && hiddenFromCharacters(path)) return;
    const copy = { ...node };
    if (copy.kind === "file" && builtinTypes.is(copy.name, "persona")) copy.content = withoutAuthorNotes(copy.content);
    nodes[id] = copy;
    for (const child of node.children ?? []) visit(child, path ? `${path}/` : "");
    if (copy.children) copy.children = node.children.filter((child) => child in nodes);
  };
  visit(project.rootId ?? "root", "");
  return { ...project, nodes };
}

// Files characters cannot see at all: anything in a folder named Plans (any
// depth, any case) and any *.plan.md file. The agent still reads them.
function hiddenFromCharacters(path) {
  const segments = String(path ?? "").split("/").filter(Boolean);
  const name = (segments.at(-1) ?? "").toLowerCase();
  return segments.some((segment) => segment.toLowerCase() === "plans") || name.endsWith(".plan.md");
}

function personaTemplate(name = "New Character") {
  return `---
name: ${name}
avatar:
color:
---
## Who they are
A sentence or two: who this character is and what they want.

## How they speak
Tone, vocabulary, habits, things they would never say.

## Example lines
> "A line that sounds exactly like them."

## What they know / don't know
What they have seen, what they believe, what is hidden from them.

## Author's notes
Plans and foreshadowing the character must not know yet. The character never
sees this section (add \`notes: hints\` to the header to allow light hints).
`;
}

export {
  PERSONA_SUFFIX,
  authorNotesHtml,
  charactersView,
  colorFor,
  findMentions,
  hiddenFromCharacters,
  notesMode,
  splitAuthorNotes,
  splitHeader,
  withoutAuthorNotes,
  initialsFor,
  parsePersona,
  personaAvatarHtml,
  personaFileName,
  personaHandle,
  personaSummary,
  personaTemplate
};
