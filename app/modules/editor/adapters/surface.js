// The Editor's parts, created and wired here (main.js used to create each one
// with its own list of main's values): the source editor, highlighting, find
// and replace, autocomplete, links, the tab strips and the preview pane,
// resuming positions, showing the active file, and the editor's events. They
// share one context, `app`, as before the move. It holds
//   - the Editor's own state: undo history, search, autocomplete, the render
//     cache, dragging text, other people's cursors, the file shown;
//   - every part's functions, the view, the project (Workspace) and dialogs (Shell);
//   - PORT: what main.js still provides, because no module owns it yet.
// What other code may call is FUNCTIONS below (editor.parts()).
import { escapeHtmlAttribute } from "../model/html.js";
import { getRelativePath, getRelativeProjectPath, normalizePath } from "../model/paths.js";
import { DIFF_TAB_ID } from "../service/view.js";
import { getNodeIdByPath, getPath, isBmapFileName, isImageFileName, isMarkdownFileName } from "../../workspace/index.js";
import { createAutocomplete } from "./autocomplete.js";
import { createEditorCore } from "./editor-core.js";
import { installEditorEvents } from "./editor-events.js";
import { createFindReplace } from "./find-replace.js";
import { createHighlighter } from "./highlight.js";
import { createLinks } from "./links.js";
import { createPreview } from "./preview.js";
import { createResume } from "./resume.js";
import { createShowFile } from "./show-file.js";
import { createTabs } from "./tabs.js";

// What main.js attaches (editor.attach(port)); each entry should move to an
// owner, or become an extension point, and leave this list.
export const PORT = [
  "collaboration", "workspaceMode", "settings", "elements", "identity", "saveUserState",
  "logDebug", "traceEditorEvent", "formatEditorDebugValue",
  "commentsForActiveFile", "scheduleCommentReanchor", "agentPendingDecorations", "updateEditorAgentBar",
  "imageSrcFor", "closeDiff", "diffState", "formatSnapshotTime",
  "render", "updateStatus", "renderWelcomeState", "setMobileExplorerOpen", "togglePreview",
  "scope", "isReadOnly", "onDrop"
];

export function createSurface({ port, view, previews, highlighters, toolbars, workspace, shell }) {
  const missing = PORT.filter((name) => !(name in port));
  if (missing.length) throw new Error(`editor.attach: the port lacks ${missing.join(", ")}`);
  const composing = { now: false }; // an IME composition is under way

  const app = {
    // Autocomplete: the list shown under the caret.
    autocompleteState: {
      items: [],
      activeIndex: 0,
      // True once the user has deliberately chosen an entry (arrow keys or the
      // mouse). Enter only accepts a suggestion when this is set — otherwise Enter
      // means "new line", which is what it means everywhere else in the editor.
      userChose: false,
      range: null,
      kind: ""
    },
    // Find and replace.
    searchState: {
      open: false,
      replaceMode: false,
      caseSensitive: false,
      wholeWord: false,
      regex: false,
      matches: [],      // [{ start, end }] plain-text offsets into the active file
      currentIndex: -1
    },
    // Undo/redo history for the contenteditable editor.
    // Each entry: { start, end, patch } where `patch` turns the previous entry's
    // text into this one's: { at, removed, inserted } (null for the first entry).
    // Only `text` — the text of entry `index` — is held in full. Entries used to
    // carry a full copy of the document each: on a 90k-character chapter that was
    // ~180KB per keystroke, ~72MB at the 400-entry cap, for every open file.
    editorHistory: { stack: [], index: -1, maxSize: 400, text: "" },
    // Incremental editor render cache (see renderEditorContent).
    editorRenderCache: {
      fileId: null,     // file the cache describes
      kind: null,       // highlighter used
      els: [],          // line elements, in DOM order, as rendered
      texts: [],        // each line's text as rendered
      html: [],         // each line's final HTML as rendered
      heights: [],      // gutter heights measured for each line
      gutter: [],       // gutter row HTML as rendered
      metricsKey: "",   // geometry the heights were measured under (see below)
      gutterEpoch: "",  // line count / agent range / comments the gutter rows reflect
      textExact: true   // every line's DOM text equals its source line
    },
    // Text dragged out of the editor, and where a drop would land.
    editorDragState: { selection: null, dropOffset: null },
    // Other people's cursors, by client id.
    remoteCursorsByClient: new Map(),
    // The file the editor's text is (what its DOM shows), or null.
    shown: { fileId: null },

    view, previews, highlighters, toolbars, parts: workspace.parts, DIFF_TAB_ID,
    escapeHtmlAttribute, normalizePath, getRelativePath, getRelativeProjectPath,
    notify: (message) => shell.notify(message),
    showToast: (message, options) => shell.toast(message, options),
    scope: () => port.scope(),
    redrawRemoteCursors: () => app.renderRemoteCursors(Array.from(app.remoteCursorsByClient.values())),
    isPreviewableFileName,
    resolveProjectAssetUrl,
    editorLinkTooltip: createLinkTooltip(),
    linksPanelEl: document.getElementById("links-panel"),
    outgoingLinksListEl: document.getElementById("outgoing-links-list"),
    backlinksListEl: document.getElementById("backlinks-list")
  };
  Object.defineProperty(app, "controller", { get: () => workspace.project(), enumerable: true });
  Object.defineProperty(app, "editorIsComposing", { get: () => composing.now, enumerable: true });
  for (const name of PORT.filter((name) => name !== "scope")) {
    Object.defineProperty(app, name, { get: () => port[name], enumerable: true });
  }

  // The parts. Assigning a function onto a name the context already holds
  // throws: two parts (or a part and the port) never share a name.
  const add = (part) => {
    for (const [name, fn] of Object.entries(part)) {
      if (name in app) throw new Error(`editor: "${name}" is defined twice`);
      app[name] = fn;
    }
    return part;
  };
  add(createHighlighter(app));
  add(createEditorCore(app));
  add(createAutocomplete(app));
  add(createFindReplace(app));
  add(createLinks(app));
  add({ ...createTabs(app), ...createPreview(app, previews) });
  add(createResume(app));
  add(createShowFile(app, composing));
  installEditorEvents(app, composing);
  app.editorLinkTooltip.el.addEventListener("mouseleave", () => app.hideLinkTooltip(true));

  function isPreviewableFileName(name) {
    return isMarkdownFileName(name) || isImageFileName(name) || isBmapFileName(name)
      || previews.all().some((preview) => preview.matches({ name, content: "" }));
  }

  function resolveProjectAssetUrl(project, sourceFileId, url) {
    const trimmed = String(url ?? "").trim();
    if (!trimmed || /^(https?:\/\/|data:|blob:|#|\/)/i.test(trimmed)) return trimmed;
    const basePath = sourceFileId ? getPath(project, sourceFileId) : "";
    const baseSegments = basePath.split("/").filter(Boolean);
    baseSegments.pop();
    const nodeId = getNodeIdByPath(project, normalizePath([...baseSegments, trimmed].join("/")));
    const node = nodeId ? project.nodes[nodeId] : null;
    return node?.kind === "file" && isImageFileName(node.name) ? app.imageSrcFor(project, node) : trimmed;
  }

  // What other code calls: the parts' functions, and a few questions about the
  // editor's own state (never the state itself).
  return Object.freeze({
    // Plain values only: reading a getter would call main.js's port during the attach.
    ...Object.fromEntries(Object.entries(Object.getOwnPropertyDescriptors(app))
      .filter(([name, d]) => typeof d.value === "function" && !["notify", "showToast", "scope"].includes(name))
      .map(([name, d]) => [name, d.value])),
    isComposing: () => composing.now,
    isFindOpen: () => app.searchState.open,
    dropOffset: () => app.editorDragState.dropOffset,
    historyPosition: () => `${app.editorHistory.index}/${app.editorHistory.stack.length}`, // for the log panel's editor trace
    // A collaborator's patch landed: their cursor moves to the end of what they typed.
    moveRemoteCursor(clientId, position) {
      const cached = app.remoteCursorsByClient.get(clientId);
      if (cached) app.remoteCursorsByClient.set(clientId, { ...cached, selStart: position, selEnd: position });
    },
    // Settings changed the glyph metrics: measure again on the next render.
    forgetMeasurements() { app.editorRenderCache.metricsKey = ""; }
  });
}

// The tooltip shown over a link in the source editor.
function createLinkTooltip() {
  const el = document.createElement("div");
  el.className = "editor-link-tooltip";
  el.hidden = true;
  el.setAttribute("aria-hidden", "true");
  const header = document.createElement("div");
  header.className = "editor-link-tooltip-header";
  const nameEl = document.createElement("span");
  nameEl.className = "editor-link-tooltip-name";
  const hintEl = document.createElement("span");
  hintEl.className = "editor-link-tooltip-hint";
  hintEl.textContent = "Follow Link (Ctrl+Click)";
  header.append(nameEl, hintEl);
  const previewEl = document.createElement("div");
  previewEl.className = "editor-link-tooltip-preview preview-output";
  el.append(header, previewEl);
  document.body.append(el);
  return { el, nameEl, hintEl, previewEl };
}
