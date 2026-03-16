function escapeUrlDbValue(value) {
  return String(value ?? "").replaceAll("\\", "\\\\").replaceAll("\n", "\\n");
}

function unescapeUrlDbValue(value) {
  return String(value ?? "").replace(/\\n/g, "\n").replace(/\\\\/g, "\\");
}

function parseUrlDb(content) {
  const normalized = String(content ?? "").replace(/\r\n/g, "\n");
  const lines = normalized.split("\n");
  const entries = [];
  let current = null;

  function commitCurrent() {
    if (!current) {
      return;
    }
    const name = current.name.trim();
    if (name) {
      entries.push({
        id: `entry-${entries.length + 1}`,
        name,
        url: current.url.trim(),
        description: current.description.trim()
      });
    }
    current = null;
  }

  lines.forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      return;
    }

    const sectionMatch = trimmed.match(/^\[(.+)\]$/);
    if (sectionMatch) {
      commitCurrent();
      current = {
        name: sectionMatch[1],
        url: "",
        description: ""
      };
      return;
    }

    const kvMatch = trimmed.match(/^(url|description)\s*=\s*(.*)$/i);
    if (!kvMatch || !current) {
      return;
    }

    const key = kvMatch[1].toLowerCase();
    current[key] = unescapeUrlDbValue(kvMatch[2]);
  });

  commitCurrent();
  return entries;
}

function formatUrlDbEntryBody(entry) {
  const lines = [`url = ${entry.url ?? ""}`];
  if (entry.description) {
    lines.push(`description = ${entry.description}`);
  }
  return lines.join("\n");
}

function parseUrlDbEntryBody(content) {
  const lines = String(content ?? "").replace(/\r\n/g, "\n").split("\n");
  const result = {
    url: "",
    description: ""
  };

  lines.forEach((line) => {
    const match = line.match(/^\s*(url|description)\s*=\s*(.*)$/i);
    if (!match) {
      return;
    }
    const key = match[1].toLowerCase();
    result[key] = unescapeUrlDbValue(match[2]);
  });

  return result;
}

function serializeUrlDb(entries) {
  return entries.map((entry) => {
    const lines = [
      `[${entry.name}]`,
      `url = ${escapeUrlDbValue(entry.url)}`
    ];

    if (entry.description) {
      lines.push(`description = ${escapeUrlDbValue(entry.description)}`);
    }

    return lines.join("\n");
  }).join("\n\n");
}

function appendUrlDbEntry(content, entry) {
  const entries = parseUrlDb(content);
  if (entries.some((current) => current.name.toLowerCase() === entry.name.toLowerCase())) {
    throw new Error(`A bookmark named \"${entry.name}\" already exists in this album.`);
  }

  entries.push({
    name: entry.name.trim(),
    url: entry.url.trim(),
    description: String(entry.description ?? "").trim()
  });
  return serializeUrlDb(entries);
}

function updateUrlDbEntry(content, entryId, updates) {
  const entries = parseUrlDb(content);
  const entry = entries.find((current) => current.id === entryId);
  if (!entry) {
    throw new Error("Bookmark entry not found.");
  }

  if (typeof updates.name === "string") {
    const trimmedName = updates.name.trim();
    if (!trimmedName) {
      throw new Error("Bookmark name is required.");
    }
    if (entries.some((current) => current.id !== entryId && current.name.toLowerCase() === trimmedName.toLowerCase())) {
      throw new Error(`A bookmark named \"${trimmedName}\" already exists in this album.`);
    }
    entry.name = trimmedName;
  }

  if (typeof updates.url === "string") {
    entry.url = updates.url.trim();
  }

  if (typeof updates.description === "string") {
    entry.description = updates.description.trim();
  }

  return serializeUrlDb(entries);
}

function removeUrlDbEntry(content, entryId) {
  const entries = parseUrlDb(content);
  const nextEntries = entries.filter((entry) => entry.id !== entryId);
  if (nextEntries.length === entries.length) {
    throw new Error("Bookmark entry not found.");
  }
  return serializeUrlDb(nextEntries);
}

export { appendUrlDbEntry, formatUrlDbEntryBody, parseUrlDb, parseUrlDbEntryBody, removeUrlDbEntry, serializeUrlDb, updateUrlDbEntry };