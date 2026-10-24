// Find in Files: a page (Shell's pages: the left window's Search tab, which
// the user may move) that searches every text file of the workspace as you type,
// with Match case, whole word and regular expressions (model/search.js);
// results grouped by file, each with its line and the words around it, and a
// click opens the file at the match. Replace All (or a file's own Replace)
// replaces in the files as they are then (every file, not only the results
// shown), after asking with the true count, through Workspace's one write
// path (merged with others' edits, synced); a file that holds parts (an
// album) is left out, and said. Undo puts back what it replaced, in this
// workspace, in each file nobody changed since.
import { builtinTypes } from "../../file-types/index.js";
import { getPath, isTextFileName } from "../../workspace/index.js";
import { MATCH_LIMIT, findMatches, locate, replaceMatches, searchPattern, snippet } from "../model/search.js";

const SEARCH_AFTER = 200;   // ms after the last key
const AGAIN_AFTER = 600;    // ms after the workspace changed (while the page shows)
const SHOWN_AT_ONCE = 400;  // result rows drawn before "Show more"

export function addFindInFiles({ app, shell, workspace, doc = globalThis.document }) {
  if (!doc) return null;
  const body = doc.createElement("div");
  body.id = "search-files-body";
  body.className = "sidebar-panel-body search-files";
  body.innerHTML = `
    <div class="find-row search-files-row">
      <input class="find-input search-files-query" type="text" placeholder="Search all files" aria-label="Search all files" autocomplete="off" spellcheck="false">
      <button class="find-toggle" type="button" data-option="caseSensitive" title="Match case" aria-pressed="false">Aa</button>
      <button class="find-toggle" type="button" data-option="wholeWord" title="Match whole word" aria-pressed="false">|ab|</button>
      <button class="find-toggle" type="button" data-option="regex" title="Use regular expression" aria-pressed="false">.*</button>
    </div>
    <div class="find-row search-files-row">
      <input class="find-input search-files-replacement" type="text" placeholder="Replace" aria-label="Replace in all files" autocomplete="off" spellcheck="false">
      <button class="find-btn search-files-replace-all" type="button" title="Replace every match in every file">Replace All</button>
    </div>
    <div class="search-files-summary subtle-label" aria-live="polite"></div>
    <div class="search-files-results" role="list"></div>`;
  const $ = (selector) => body.querySelector(selector);
  const query = $(".search-files-query");
  const replacement = $(".search-files-replacement");
  const options = { caseSensitive: false, wholeWord: false, regex: false };
  let results = [];   // [{ node, path, text, matches }]
  let capped = false; // MATCH_LIMIT reached: there are more
  let shownRows = SHOWN_AT_ONCE;
  let undo = null;    // { key, files: [{ id, before, after }] } of the last Replace, in the workspace `key`
  let searchTimer = null;
  let againTimer = null;

  const project = () => app.controller.getProject();
  const here = () => workspace.location.key(project());
  const pattern = () => searchPattern(query.value, options);
  const textFiles = () => Object.values(project()?.nodes ?? {})
    .filter((node) => node.kind === "file" && isTextFileName(node.name))
    .map((node) => ({ node, path: getPath(project(), node.id) }))
    .sort((a, b) => a.path.localeCompare(b.path));

  function search() {
    clearTimeout(searchTimer);
    searchTimer = null;
    const { pattern: compiled, error } = pattern();
    query.classList.toggle("is-error", Boolean(error));
    results = [];
    capped = false;
    let left = MATCH_LIMIT; // in all the files together
    if (compiled) {
      for (const { node, path } of textFiles()) {
        const text = node.content ?? "";
        const matches = findMatches(text, compiled, left);
        if (matches.length) results.push({ node, path, text, matches: locate(text, matches) });
        left -= matches.length;
        if (left <= 0) { capped = true; break; }
      }
    }
    shownRows = SHOWN_AT_ONCE;
    draw(error);
  }

  const total = () => results.reduce((sum, file) => sum + file.matches.length, 0);

  function draw(error = null) {
    const summary = $(".search-files-summary");
    const list = $(".search-files-results");
    if (error) summary.textContent = "Not a regular expression.";
    else if (!query.value) summary.textContent = "";
    else if (!results.length) summary.textContent = "No results.";
    else summary.textContent = capped
      ? `${MATCH_LIMIT.toLocaleString("en")}+ results (the first ${MATCH_LIMIT.toLocaleString("en")} shown).`
      : `${total()} result${total() === 1 ? "" : "s"} in ${results.length} file${results.length === 1 ? "" : "s"}.`;
    if (undo && undo.key !== here()) undo = null; // made in another workspace
    if (undo) {
      const button = doc.createElement("button");
      button.type = "button";
      button.className = "find-btn search-files-undo";
      button.textContent = "Undo Replace";
      button.addEventListener("click", () => void undoReplace());
      summary.append(" ", button);
    }
    const rows = [];
    let left = shownRows;
    for (const file of results) {
      if (left <= 0) break;
      rows.push(fileRow(file));
      for (const match of file.matches.slice(0, left)) rows.push(matchRow(file, match));
      left -= file.matches.length;
    }
    if (left < 0) {
      const more = doc.createElement("button");
      more.type = "button";
      more.className = "find-btn search-files-more";
      more.textContent = `Show more (${total() - shownRows} left)`;
      more.addEventListener("click", () => { shownRows += SHOWN_AT_ONCE * 2; draw(); });
      rows.push(more);
    }
    list.replaceChildren(...rows);
    $(".search-files-replace-all").disabled = !results.length;
  }

  function fileRow(file) {
    const row = doc.createElement("div");
    row.className = "search-files-file";
    row.setAttribute("role", "listitem");
    const icon = doc.createElement("span");
    icon.className = `tree-icon file-icon ${builtinTypes.typeOf(file.node.name)?.icon ?? "is-file"}`;
    const name = doc.createElement("span");
    name.className = "search-files-name";
    name.textContent = file.node.name;
    name.title = file.path;
    const folder = doc.createElement("span");
    folder.className = "search-files-folder";
    folder.textContent = file.path.slice(0, -file.node.name.length).replace(/\/$/, "");
    const count = doc.createElement("span");
    count.className = "search-files-count";
    count.textContent = String(file.matches.length);
    const replaceHere = doc.createElement("button");
    replaceHere.type = "button";
    replaceHere.className = "find-btn search-files-replace-file";
    replaceHere.textContent = "Replace";
    replaceHere.title = `Replace the matches in ${file.node.name}`;
    replaceHere.addEventListener("click", () => void replace([file.node.id]));
    row.append(icon, name, folder, count, replaceHere);
    return row;
  }

  function matchRow(file, match) {
    const row = doc.createElement("button");
    row.type = "button";
    row.className = "search-files-match";
    row.setAttribute("role", "listitem");
    const { before, hit, after } = snippet(file.text, match);
    const line = doc.createElement("span");
    line.className = "search-files-line";
    line.textContent = String(match.line + 1);
    const mark = doc.createElement("mark");
    mark.textContent = hit;
    row.append(line, doc.createTextNode(before), mark, doc.createTextNode(after));
    row.title = `${file.path}, line ${match.line + 1}`;
    row.addEventListener("click", () => open(file, match));
    return row;
  }

  // The file opened in the source editor, the match selected (and its line in view).
  function open(file, match) {
    app.openSourceTab(file.node.id);
    app.controller.setActiveFile(file.node.id);
    requestAnimationFrame(() => {
      const shown = app.controller.getActiveFile();
      if (shown?.id !== file.node.id) return;
      app.elements.editorContent.focus({ preventScroll: true });
      // A file shown a part at a time (an album's entries) has other offsets: opened only.
      if (workspace.parts.of(shown.name)) return;
      const text = app.getEditorText();
      if (text.slice(match.start, match.end) !== file.text.slice(match.start, match.end)) { search(); return; } // changed meanwhile
      app.setEditorSelection(match.start, match.end);
      app.caretIntoView(app.getEditorLineHeight() * 3);
    });
  }

  // Replace in these files (by id; all the text files when none are named),
  // as they are now; asked first, with the true count. What it replaced is
  // kept for Undo.
  async function replace(ids = null) {
    if (searchTimer) search(); // the query typed a moment ago, not the one before
    const { pattern: compiled } = pattern();
    if (!compiled) return;
    const plan = [];
    const parts = [];
    for (const id of ids ?? textFiles().map(({ node }) => node.id)) {
      const node = project()?.nodes?.[id];
      if (!node) continue;
      const before = node.content ?? "";
      const { text: after, count } = replaceMatches(before, compiled, replacement.value, { regex: options.regex });
      if (!count) continue;
      // A file of parts (an album) shows each part on its own: its text is not replaced as a whole.
      if (workspace.parts.of(node.name)) { parts.push(node.name); continue; }
      plan.push({ id, name: node.name, before, after, count });
    }
    const leftOut = parts.length ? ` ${parts.join(", ")} ${parts.length === 1 ? "is" : "are"} left out (${parts.length === 1 ? "it holds" : "they hold"} parts: replace in each part).` : "";
    if (!plan.length) {
      if (parts.length) shell.toast(`Nothing replaced.${leftOut}`, { duration: 5000 });
      search();
      return;
    }
    const count = plan.reduce((sum, file) => sum + file.count, 0);
    const where = plan.length === 1 ? plan[0].name : `${plan.length} files`;
    const asked = await shell.confirm({ title: "Replace",
      message: `Replace ${count.toLocaleString("en")} match${count === 1 ? "" : "es"} in ${where} with “${replacement.value}”?${leftOut}`,
      acceptLabel: "Replace" });
    if (!asked) return;
    const key = here();
    const done = [];
    const missed = [];
    for (const file of plan) {
      const path = project()?.nodes?.[file.id] ? getPath(project(), file.id) : null;
      try {
        if (!path || here() !== key) throw new Error("gone");
        // Typing since the question is kept: the change is placed into the file as it is.
        const { text } = await workspace.write(path, file.after, { base: file.before, source: "find-in-files" });
        done.push({ id: file.id, before: file.before, after: text });
      } catch (error) {
        // Changed where it replaces (stale), gone, or not written at all: left as it is, and said.
        missed.push(workspace.isStale(error) || !path ? file.name : `${file.name} (${error.message})`);
      }
    }
    undo = done.length ? { key, files: done } : null;
    search();
    shell.toast(missed.length
      ? `Replaced in ${done.length} file${done.length === 1 ? "" : "s"}; ${missed.join(", ")} changed meanwhile and ${missed.length === 1 ? "was" : "were"} left as ${missed.length === 1 ? "it was" : "they were"}.${leftOut}`
      : `Replaced ${count.toLocaleString("en")} match${count === 1 ? "" : "es"} in ${done.length} file${done.length === 1 ? "" : "s"}.${leftOut}`, { duration: 4000 });
  }

  // What the last Replace changed, put back in each file nobody changed since
  // (in the workspace it was made in).
  async function undoReplace() {
    const kept = undo?.key === here() ? undo.files : [];
    undo = null;
    const missed = [];
    for (const { id, before, after } of kept) {
      const node = project()?.nodes?.[id];
      if (!node || (node.content ?? "") !== after) { missed.push(node?.name ?? "a file since removed"); continue; }
      try {
        await workspace.write(getPath(project(), id), before, { base: after, source: "find-in-files" });
      } catch (error) {
        missed.push(workspace.isStale(error) ? node.name : `${node.name} (${error.message})`);
      }
    }
    search();
    shell.toast(missed.length ? `Put back, except in ${missed.join(", ")} (changed since).` : "Replace undone.", { duration: 4000 });
  }

  query.addEventListener("input", () => {
    undo = null;
    clearTimeout(searchTimer);
    searchTimer = setTimeout(search, SEARCH_AFTER);
  });
  query.addEventListener("keydown", (event) => {
    if (event.key === "Enter") { event.preventDefault(); search(); }
    if (event.key === "Escape") app.elements.editorContent.focus();
  });
  for (const button of body.querySelectorAll("[data-option]")) {
    button.addEventListener("click", () => {
      options[button.dataset.option] = !options[button.dataset.option];
      button.setAttribute("aria-pressed", String(options[button.dataset.option]));
      search();
    });
  }
  $(".search-files-replace-all").addEventListener("click", () => void replace());

  // The workspace changed (typing, someone else, a file added): searched again
  // while the page shows and there is a query.
  workspace.project()?.subscribe?.(() => {
    if (!query.value || !shell.pages.visible("search")) return;
    clearTimeout(againTimer);
    againTimer = setTimeout(search, AGAIN_AFTER);
  });

  shell.pages.add({ host: "left", id: "search", order: 5, label: "Search", title: "Find in Files (Ctrl+Shift+F)", body, className: "search-files-panel",
    icon: `<svg class="activity-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="6.5"/><path d="M20.5 20.5 16 16"/></svg>`,
    shown: (visible) => { if (visible && query.value) search(); } });

  // Find in Files: the page shown wherever it is (the left window's Search
  // tab, unless moved), the query focused (the selection as the query).
  function reveal() {
    shell.pages.open("search");
    const selection = app.getEditorSelection();
    const selected = selection.end > selection.start ? app.getEditorText().slice(selection.start, selection.end) : "";
    if (selected && !selected.includes("\n") && doc.activeElement === app.elements.editorContent) {
      query.value = selected;
      search();
    }
    requestAnimationFrame(() => { query.focus(); query.select(); });
  }
  shell.commands.add({ id: "editor.find-in-files", title: "Find in Files", keywords: ["search", "all files", "replace"],
    keys: ["Mod+Shift+F"], menu: { id: "edit", group: 0, order: 2 }, run: reveal });
  return { reveal, search };
}
