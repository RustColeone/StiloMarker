// The album in the preview pane: a table of every entry, or one entry's image
// when the explorer opened that entry (`partId`).
const escapeHtml = (value) => String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;").replaceAll('"', "&quot;");

function renderTable(target, entries) {
  const frame = document.createElement("div");
  frame.className = "urldb-preview";
  if (entries.length === 0) {
    const empty = document.createElement("div");
    empty.className = "editor-readonly-note";
    empty.textContent = "No entries yet. Add sections like [Name] and url = https://...";
    frame.append(empty);
  } else {
    const table = document.createElement("table");
    table.className = "urldb-table";
    table.innerHTML = "<thead><tr><th>Preview</th><th>Name</th><th>URL</th><th>Description</th></tr></thead>";
    const body = document.createElement("tbody");
    for (const entry of entries) {
      const row = document.createElement("tr");
      row.innerHTML = `<td><img src="${escapeHtml(entry.url)}" alt="${escapeHtml(entry.name)}"></td><td>${escapeHtml(entry.name)}</td>`
        + `<td><a href="${escapeHtml(entry.url)}" target="_blank" rel="noreferrer">${escapeHtml(entry.url)}</a></td><td>${escapeHtml(entry.description)}</td>`;
      body.append(row);
    }
    table.append(body);
    frame.append(table);
  }
  target.append(frame);
}

function renderEntry(target, entry) {
  const frame = document.createElement("div");
  frame.className = "asset-preview remote-asset-preview";
  const image = document.createElement("img");
  image.src = entry.url;
  image.alt = entry.name;
  const meta = document.createElement("div");
  meta.className = "remote-asset-meta";
  meta.innerHTML = `<strong>${escapeHtml(entry.name)}</strong><span>${escapeHtml(entry.description || entry.url)}</span>`;
  frame.append(image, meta);
  target.append(frame);
}

export function renderAlbumPreview(target, entries, partId) {
  const entry = partId ? entries.find((candidate) => candidate.id === partId) : null;
  if (entry) renderEntry(target, entry);
  else renderTable(target, entries);
  return { shouldTypeset: false, content: "" };
}
