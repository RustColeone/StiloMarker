// Persona files (`aria.persona.skill`) describe a character for the Roleplay
// chat: Markdown with an optional `---` header of `key: value` lines. Only a few
// keys mean anything to the app; the rest of the file is the character sheet
// and is sent to the model exactly as written.

const PERSONA_SUFFIX = ".persona.skill";
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
    body: body.trim()
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

function personaFileName(name) {
  const base = String(name ?? "").trim().replace(/[\\/:*?"<>|]+/g, "").replace(/\s+/g, " ") || "new character";
  return `${base}${PERSONA_SUFFIX}`;
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
`;
}

export {
  PERSONA_SUFFIX,
  colorFor,
  findMentions,
  initialsFor,
  parsePersona,
  personaAvatarHtml,
  personaFileName,
  personaHandle,
  personaSummary,
  personaTemplate
};
