// The album's text, read and written. Pure. An album is a list of entries:
//
//   [Castle]
//   url = https://example.com/castle.jpg
//   description = The old keep
//
// An entry's id is its position ("entry-1"), so after a change the caller
// finds an entry again by its name, which is unique within the album.

function escapeValue(value) {
  return String(value ?? "").replaceAll("\\", "\\\\").replaceAll("\n", "\\n");
}

function unescapeValue(value) {
  return String(value ?? "").replace(/\\n/g, "\n").replace(/\\\\/g, "\\");
}

export function parseAlbum(content) {
  const entries = [];
  let current = null;
  const commit = () => {
    const name = current?.name.trim();
    if (name) entries.push({ id: `entry-${entries.length + 1}`, name, url: current.url.trim(), description: current.description.trim() });
    current = null;
  };
  for (const line of String(content ?? "").replace(/\r\n/g, "\n").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const section = trimmed.match(/^\[(.+)\]$/);
    if (section) {
      commit();
      current = { name: section[1], url: "", description: "" };
      continue;
    }
    const field = trimmed.match(/^(url|description)\s*=\s*(.*)$/i);
    if (field && current) current[field[1].toLowerCase()] = unescapeValue(field[2]);
  }
  commit();
  return entries;
}

export function serializeAlbum(entries) {
  return entries.map((entry) => {
    const lines = [`[${entry.name}]`, `url = ${escapeValue(entry.url)}`];
    if (entry.description) lines.push(`description = ${escapeValue(entry.description)}`);
    return lines.join("\n");
  }).join("\n\n");
}

// What the source editor shows for one entry, and the entry read back from it.
export function entryBody(entry) {
  const lines = [`url = ${entry.url ?? ""}`];
  if (entry.description) lines.push(`description = ${entry.description}`);
  return lines.join("\n");
}

export function parseEntryBody(content) {
  const result = { url: "", description: "" };
  for (const line of String(content ?? "").replace(/\r\n/g, "\n").split("\n")) {
    const match = line.match(/^\s*(url|description)\s*=\s*(.*)$/i);
    if (match) result[match[1].toLowerCase()] = unescapeValue(match[2]);
  }
  return result;
}

const clash = (name) => new Error(`An entry named "${name}" already exists in this album.`);
const taken = (entries, name, exceptId = null) =>
  entries.some((entry) => entry.id !== exceptId && entry.name.toLowerCase() === name.toLowerCase());

function find(entries, id) {
  const index = entries.findIndex((entry) => entry.id === id);
  if (index < 0) throw new Error("That album entry no longer exists.");
  return index;
}

export function updateEntry(content, id, updates) {
  const entries = parseAlbum(content);
  const entry = entries[find(entries, id)];
  if (typeof updates.name === "string") {
    const name = updates.name.trim();
    if (!name) throw new Error("An album entry needs a name.");
    if (taken(entries, name, id)) throw clash(name);
    entry.name = name;
  }
  if (typeof updates.url === "string") entry.url = updates.url.trim();
  if (typeof updates.description === "string") entry.description = updates.description.trim();
  return serializeAlbum(entries);
}

export function removeEntry(content, id) {
  const entries = parseAlbum(content);
  entries.splice(find(entries, id), 1);
  return serializeAlbum(entries);
}

// `index` null puts the entry last.
export function insertEntry(content, entry, index = null) {
  const entries = parseAlbum(content);
  const name = String(entry.name ?? "").trim();
  if (!name) throw new Error("An album entry needs a name.");
  if (taken(entries, name)) throw clash(name);
  const at = index === null ? entries.length : Math.max(0, Math.min(Number(index), entries.length));
  entries.splice(at, 0, { name, url: String(entry.url ?? "").trim(), description: String(entry.description ?? "").trim() });
  return serializeAlbum(entries);
}

// A name for a new entry that the album does not have yet.
export function nextEntryName(content) {
  const entries = parseAlbum(content);
  let index = 1;
  while (taken(entries, `reference image ${index}`)) index += 1;
  return `reference image ${index}`;
}

// The album as file parts (Workspace's `parts` extension point), less the
// adding, which needs a dialog.
export const albumParts = Object.freeze({
  list: (text) => parseAlbum(text).map((entry) => ({
    id: entry.id, name: entry.name, image: entry.url,
    title: entry.description ? `${entry.name}\n${entry.url}\n${entry.description}` : `${entry.name}\n${entry.url}`
  })),
  body: (text, id) => {
    const entries = parseAlbum(text);
    return entryBody(entries[find(entries, id)]);
  },
  withBody: (text, id, body) => updateEntry(text, id, parseEntryBody(body)),
  rename: (text, id, name) => updateEntry(text, id, { name }),
  remove: removeEntry,
  take: (text, id) => {
    const entries = parseAlbum(text);
    const { name, url, description } = entries[find(entries, id)];
    return { name, url, description };
  },
  insert: insertEntry,
  linkText: (entry) => `![${entry.name}](${entry.url})`
});
