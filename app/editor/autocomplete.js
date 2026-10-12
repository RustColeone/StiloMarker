// Source-pane autocomplete: file paths and images in Markdown links, words
// from the document, and .bmap block properties, shown at the caret.
// main.js creates this on first use and passes its shared values in `app`.
import { getPath, isBmapFileName, isImageFileName, isMarkdownFileName, isTextFileName } from "../domain/project-model.js";

export function createAutocomplete(app) {
  function buildProjectFileSuggestions(project, activeFileId, kind = "path") {
    const activePath = activeFileId ? getPath(project, activeFileId) : "";
    return Object.values(project.nodes)
      .filter((node) => node.kind === "file")
      .filter((node) => node.id !== activeFileId)
      .filter((node) => {
        if (kind === "image") {
          return isImageFileName(node.name);
        }
        return true;
      })
      .map((node) => {
        const fullPath = getPath(project, node.id);
        return {
          fileId: node.id,
          fullPath,
          insertText: app.getRelativePath(activePath, fullPath),
          label: node.name,
          detail: fullPath,
          kind: isImageFileName(node.name) ? "image" : (node.name.endsWith(".md") ? "note" : "file")
        };
      })
      .sort((left, right) => left.detail.localeCompare(right.detail));
  }

  /** General word completion: suggest words already present in the document that
   *  share the typed prefix, ranked by frequency. Makes the popup useful beyond
   *  link/path contexts, like an editor's basic word-based IntelliSense. */
  function buildWordSuggestions(text, token) {
    const prefix = token.toLowerCase();
    const counts = new Map();
    const wordPattern = /[A-Za-z][A-Za-z0-9_-]{2,}/g;
    let match;
    while ((match = wordPattern.exec(text)) !== null) {
      const word = match[0];
      const lower = word.toLowerCase();
      if (lower === prefix || !lower.startsWith(prefix)) continue;
      counts.set(word, (counts.get(word) ?? 0) + 1);
    }
    return Array.from(counts.entries())
      .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
      .slice(0, 10)
      .map(([word, count]) => ({
        insertText: word,
        label: word,
        detail: count > 1 ? `${count}×` : "word",
        kind: "word"
      }));
  }

  // ── .bmap autocomplete helpers ──────────────────────────────────────────────

  /** Determine block depth and type at a given cursor position in a .bmap source. */
  function findBmapBlockContext(before) {
    let depth = 0;
    let currentBlockType = null;
    const re = /\.(node|connect)\s*\{|\{|\}/g;
    let m;
    while ((m = re.exec(before)) !== null) {
      if (m[1]) {
        if (depth === 0) currentBlockType = m[1];
        depth++;
      } else if (m[0] === "{") {
        depth++;
      } else {
        depth--;
        if (depth <= 0) { depth = 0; currentBlockType = null; }
      }
    }
    return { depth, blockType: currentBlockType, inStylesBlock: depth >= 2 };
  }

  /** Build an autocomplete context object for .bmap files. */
  function findBmapAutocompleteContext(force) {
    const value = app.getEditorText();
    const cursor = app.getEditorSelection().start;
    const before = value.slice(0, cursor);
    const lineStart = before.lastIndexOf("\n") + 1;
    const linePrefix = before.slice(lineStart);
    const trimmedPrefix = linePrefix.trimStart();
    const { depth, blockType, inStylesBlock } = findBmapBlockContext(before);

    // Inside styles sub-block (depth >= 2)
    if (inStylesBlock) {
      const styleKvMatch = linePrefix.match(/^\s*([\w-]+)\s*:\s*(\w*)$/);
      if (styleKvMatch) {
        const key = styleKvMatch[1].toLowerCase();
        const token = styleKvMatch[2];
        if (key === "mode")   return { kind: "bmap-mode-value",   token, start: cursor - token.length, end: cursor };
        if (key === "arrow")  return { kind: "bmap-arrow-value",  token, start: cursor - token.length, end: cursor };
        if (key === "dashed") return { kind: "bmap-dashed-value", token, start: cursor - token.length, end: cursor };
      }
      const propKeyMatch = linePrefix.match(/^\s*([\w-]*)$/);
      if (propKeyMatch && (propKeyMatch[1] || force)) {
        const token = propKeyMatch[1];
        return { kind: "bmap-style-prop", token, start: cursor - token.length, end: cursor };
      }
      return null;
    }

    // Inside a .node or .connect block (depth === 1)
    if (depth === 1 && blockType) {
      if (blockType === "connect") {
        const sideIdxMatch = linePrefix.match(/^\s*(from|to)\s*:\s*\S+\.side\.(\d*)$/);
        if (sideIdxMatch) {
          const token = sideIdxMatch[2];
          return { kind: "bmap-side-index", token, start: cursor - token.length, end: cursor };
        }
        const sideKeyMatch = linePrefix.match(/^\s*(from|to)\s*:\s*\S+\.(\w*)$/);
        if (sideKeyMatch) {
          const token = sideKeyMatch[2];
          return { kind: "bmap-side-key", token, start: cursor - token.length, end: cursor };
        }
        const endpointMatch = linePrefix.match(/^\s*(from|to)\s*:\s*([A-Za-z0-9_-]*)$/);
        if (endpointMatch) {
          const token = endpointMatch[2];
          return { kind: "bmap-endpoint-node", token, start: cursor - token.length, end: cursor };
        }
      }
      const shapeMatch = linePrefix.match(/^\s*shape\s*:\s*(\w*)$/);
      if (shapeMatch) {
        const token = shapeMatch[1];
        return { kind: "bmap-shape-value", token, start: cursor - token.length, end: cursor };
      }
      if (blockType === "node") {
        const fileMatch = linePrefix.match(/^\s*file\s*:\s*(.*)$/);
        if (fileMatch) {
          const token = fileMatch[1];
          return { kind: "bmap-file-value", token, start: cursor - token.length, end: cursor };
        }
      }
      const propKeyMatch = linePrefix.match(/^\s*([\w-]*)$/);
      if (propKeyMatch && (propKeyMatch[1] || force)) {
        const token = propKeyMatch[1];
        const kind = blockType === "node" ? "bmap-node-prop" : "bmap-connect-prop";
        return { kind, token, start: cursor - token.length, end: cursor };
      }
      return null;
    }

    // Top level (depth === 0): suggest block types after a leading "."
    if (depth === 0) {
      const blockTypeMatch = linePrefix.match(/^\s*\.(\w*)$/);
      if (blockTypeMatch) {
        const token = blockTypeMatch[1];
        return { kind: "bmap-block-type", token, start: cursor - token.length, end: cursor };
      }
      if (force && !trimmedPrefix) {
        return { kind: "bmap-block-type", token: "", start: cursor, end: cursor };
      }
    }

    return null;
  }

  const BMAP_AUTOCOMPLETE_LABELS = {
    "bmap-block-type":    "Block type",
    "bmap-node-prop":     "Node properties",
    "bmap-connect-prop":  "Connect properties",
    "bmap-style-prop":    "Style properties",
    "bmap-shape-value":   "Shape",
    "bmap-mode-value":    "Connector mode",
    "bmap-arrow-value":   "Arrow style",
    "bmap-dashed-value":  "Dashed line",
    "bmap-side-key":      "Side segment",
    "bmap-side-index":    "Side — 0 top · 1 right · 2 bottom · 3 left",
    "bmap-endpoint-node": "Node ID",
    "bmap-file-value":    "Project files",
  };

  function getBmapAutocompleteItems(context, project, activeFile) {
    const token = context.token.toLowerCase();
    const filter = (items) =>
      items.filter((item) => !token || item.label.toLowerCase().startsWith(token) || item.insertText.toLowerCase().startsWith(token));

    switch (context.kind) {
      case "bmap-block-type":
        return filter([
          { label: "node",    detail: "Diagram node — id, name, pos, shape, file, styles", insertText: "node {\n  id: \n  name: \n  pos: {x: 0, y: 0}\n}" },
          { label: "connect", detail: "Connector between two nodes",                        insertText: "connect {\n  from: .side.1\n  to: .side.3\n}" },
        ]);

      case "bmap-node-prop":
        return filter([
          { label: "id:",     detail: "Unique node identifier",                        insertText: "id: " },
          { label: "name:",   detail: "Display label shown in the node header",        insertText: "name: " },
          { label: "text:",   detail: "Secondary description text in the node body",   insertText: "text: " },
          { label: "shape:",  detail: "Node shape: rect or circle",                    insertText: "shape: " },
          { label: "pos:",    detail: "Position as {x: N, y: N}",                      insertText: "pos: {x: 0, y: 0}" },
          { label: "file:",   detail: "Link to a project file (shown via ⊞ preview)", insertText: "file: " },
          { label: "styles:", detail: "CSS style overrides block",                     insertText: "styles: {\n  \n}" },
        ]);

      case "bmap-connect-prop":
        return filter([
          { label: "from:",   detail: "Source endpoint — nodeId.side.N", insertText: "from: " },
          { label: "to:",     detail: "Target endpoint — nodeId.side.N", insertText: "to: " },
          { label: "styles:", detail: "Connector appearance block",       insertText: "styles: {\n  \n}" },
        ]);

      case "bmap-style-prop":
        return filter([
          { label: "background:",   detail: "Fill color, e.g. #fff8dc",           insertText: "background: " },
          { label: "border:",       detail: "Border shorthand, e.g. 1px solid #aaa", insertText: "border: " },
          { label: "border-radius:", detail: "Corner radius",                      insertText: "border-radius: " },
          { label: "color:",        detail: "Text or stroke color",                insertText: "color: " },
          { label: "font-size:",    detail: "Font size, e.g. 12px",               insertText: "font-size: " },
          { label: "font-weight:",  detail: "Font weight: bold or normal",        insertText: "font-weight: " },
          { label: "width:",        detail: "Node width in px",                   insertText: "width: " },
          { label: "opacity:",      detail: "Opacity 0–1",                        insertText: "opacity: " },
          { label: "mode:",         detail: "bezier or straight",                 insertText: "mode: " },
          { label: "arrow:",        detail: "end, start, both, or none",          insertText: "arrow: " },
          { label: "dashed:",       detail: "true or false",                      insertText: "dashed: " },
          { label: "thickness:",    detail: "Stroke width in px",                 insertText: "thickness: " },
        ]);

      case "bmap-shape-value":
        return filter([
          { label: "rect",   detail: "Rounded rectangle (default)", insertText: "rect" },
          { label: "circle", detail: "Circle / oval",               insertText: "circle" },
        ]);

      case "bmap-mode-value":
        return filter([
          { label: "bezier",   detail: "Curved connector (default)", insertText: "bezier" },
          { label: "straight", detail: "Straight line connector",    insertText: "straight" },
        ]);

      case "bmap-arrow-value":
        return filter([
          { label: "end",   detail: "Arrow at destination (default)", insertText: "end" },
          { label: "start", detail: "Arrow at source",                insertText: "start" },
          { label: "both",  detail: "Arrows at both ends",            insertText: "both" },
          { label: "none",  detail: "No arrowheads",                  insertText: "none" },
        ]);

      case "bmap-dashed-value":
        return filter([
          { label: "false", detail: "Solid line (default)", insertText: "false" },
          { label: "true",  detail: "Dashed line",          insertText: "true" },
        ]);

      case "bmap-side-key":
        return [{ label: "side", detail: "Side segment — follow with .N (0=top 1=right 2=bottom 3=left)", insertText: "side" }];

      case "bmap-side-index":
        return filter([
          { label: "0", detail: "Top",    insertText: "0" },
          { label: "1", detail: "Right",  insertText: "1" },
          { label: "2", detail: "Bottom", insertText: "2" },
          { label: "3", detail: "Left",   insertText: "3" },
        ]);

      case "bmap-endpoint-node": {
        const content = activeFile?.content ?? "";
        const nodeIds = [...content.matchAll(/^\s*id\s*:\s*(\S+)/gm)].map((nm) => nm[1]);
        return filter(nodeIds.map((id) => ({
          label: id,
          detail: "Node ID — follow with .side.N",
          insertText: id,
        })));
      }

      case "bmap-file-value":
        return buildProjectFileSuggestions(project, activeFile?.id ?? null, "path")
          .filter((item) => !token || item.insertText.toLowerCase().includes(token) || item.label.toLowerCase().includes(token));

      default:
        return [];
    }
  }

  // ── end .bmap autocomplete helpers ──────────────────────────────────────────

  function findAutocompleteContext(force = false) {
    const activeFile = app.controller.getActiveFile();
    if (!activeFile || !isTextFileName(activeFile.name)) {
      return null;
    }
    if (isBmapFileName(activeFile.name)) {
      return findBmapAutocompleteContext(force);
    }

    const value = app.getEditorText();
    const cursor = app.getEditorSelection().start;
    const before = value.slice(0, cursor);
    const lineStart = before.lastIndexOf("\n") + 1;
    const linePrefix = before.slice(lineStart);

    if (isMarkdownFileName(activeFile.name)) {
      const imageMatch = linePrefix.match(/!\[[^\]]*\]\(([^)]*)$/);
      if (imageMatch) {
        const token = imageMatch[1];
        return {
          kind: "image",
          token,
          start: cursor - token.length,
          end: cursor
        };
      }

      const linkMatch = linePrefix.match(/\[[^\]]*\]\(([^)]*)$/);
      if (linkMatch) {
        const token = linkMatch[1];
        return {
          kind: "path",
          token,
          start: cursor - token.length,
          end: cursor
        };
      }
    }

    const genericMatch = linePrefix.match(/([./A-Za-z0-9_-][./A-Za-z0-9_\-/]*)$/);
    if (genericMatch && (force || genericMatch[1].includes("/") || genericMatch[1].startsWith("."))) {
      const token = genericMatch[1];
      return {
        kind: "path",
        token,
        start: cursor - token.length,
        end: cursor
      };
    }

    // General word completion: trigger automatically once a plain word reaches a
    // few characters, so the popup is useful for prose, not just links/paths.
    const wordMatch = linePrefix.match(/([A-Za-z][A-Za-z0-9_-]*)$/);
    if (wordMatch && (force || wordMatch[1].length >= 3)) {
      const token = wordMatch[1];
      return {
        kind: "word",
        token,
        start: cursor - token.length,
        end: cursor
      };
    }

    if (!force) {
      return null;
    }

    return {
      kind: "path",
      token: "",
      start: cursor,
      end: cursor
    };
  }

  function hideEditorAutocomplete() {
    app.autocompleteState.items = [];
    app.autocompleteState.activeIndex = 0;
    app.autocompleteState.userChose = false;
    app.autocompleteState.range = null;
    app.autocompleteState.kind = "";
    app.elements.editorAutocomplete.hidden = true;
    app.elements.editorAutocompleteList.replaceChildren();
  }

  function renderEditorAutocomplete() {
    app.elements.editorAutocompleteList.replaceChildren();

    app.autocompleteState.items.forEach((item, index) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = `editor-autocomplete-item${index === app.autocompleteState.activeIndex ? " is-active" : ""}`;
      button.innerHTML = `<span class="editor-autocomplete-item-title">${app.escapeEditorHtml(item.label)}</span><span class="editor-autocomplete-item-detail">${app.escapeEditorHtml(item.detail)}</span>`;
      button.addEventListener("mousedown", (event) => {
        event.preventDefault();
        acceptEditorAutocomplete(index);
      });
      app.elements.editorAutocompleteList.append(button);
    });

    app.elements.editorAutocomplete.hidden = app.autocompleteState.items.length === 0;
    if (!app.elements.editorAutocomplete.hidden) {
      positionEditorAutocompleteAtCaret();
      // Keep the active row scrolled into view during keyboard navigation.
      app.elements.editorAutocompleteList
        .querySelector(".editor-autocomplete-item.is-active")
        ?.scrollIntoView({ block: "nearest" });
    }
  }

  /** Anchor the completion popup directly under the text caret (VSCode-style),
   *  flipping above the caret when it would overflow the editor surface. */
  function positionEditorAutocompleteAtCaret() {
    const surface = app.elements.editorContent.closest(".editor-surface");
    if (!surface) return;

    const selection = globalThis.getSelection?.();
    let caretRect = null;
    if (selection && selection.rangeCount > 0) {
      const range = selection.getRangeAt(0).cloneRange();
      range.collapse(true);
      const rects = range.getClientRects();
      if (rects.length > 0) {
        caretRect = rects[0];
      } else {
        const bounding = range.getBoundingClientRect();
        if (bounding && (bounding.width || bounding.height || bounding.top)) {
          caretRect = bounding;
        }
      }
      if (!caretRect) {
        // Collapsed caret on an empty line yields no rect — fall back to the line.
        const anchor = selection.anchorNode;
        const anchorEl = anchor?.nodeType === Node.ELEMENT_NODE ? anchor : anchor?.parentElement;
        const lineEl = anchorEl?.closest?.(".editor-line");
        if (lineEl) caretRect = lineEl.getBoundingClientRect();
      }
    }
    if (!caretRect) return;

    const base = surface.getBoundingClientRect();
    const popup = app.elements.editorAutocomplete;
    const left = Math.max(0, Math.min(caretRect.left - base.left, base.width - popup.offsetWidth - 4));
    popup.style.bottom = "auto";
    popup.style.left = `${left}px`;
    popup.style.top = `${caretRect.bottom - base.top + 2}px`;

    // Flip above the caret if the popup would spill below the editor surface.
    const popupHeight = popup.offsetHeight;
    const caretTop = caretRect.top - base.top;
    if (caretRect.bottom - base.top + 2 + popupHeight > base.height && caretTop > popupHeight) {
      popup.style.top = `${caretTop - popupHeight - 2}px`;
    }
  }

  function showEditorAutocomplete(force = false) {
    const context = findAutocompleteContext(force);
    if (!context) {
      hideEditorAutocomplete();
      return;
    }

    const activeFile = app.controller.getActiveFile();
    const project = app.controller.getProject();
    const tokenLower = context.token.toLowerCase();

    let items;
    if (context.kind.startsWith("bmap-")) {
      items = getBmapAutocompleteItems(context, project, activeFile);
    } else if (context.kind === "word") {
      items = buildWordSuggestions(app.getEditorText(), context.token);
    } else {
      items = buildProjectFileSuggestions(project, activeFile?.id ?? null, context.kind)
        .filter((item) => !tokenLower || item.insertText.toLowerCase().includes(tokenLower) || item.detail.toLowerCase().includes(tokenLower));
    }

    if (items.length === 0) {
      hideEditorAutocomplete();
      return;
    }

    app.autocompleteState.items = items.slice(0, 12);
    app.autocompleteState.activeIndex = 0;
    app.autocompleteState.userChose = false;
    app.autocompleteState.range = { start: context.start, end: context.end };
    app.autocompleteState.kind = context.kind;
    app.elements.editorAutocompleteLabel.textContent = context.kind.startsWith("bmap-")
      ? (BMAP_AUTOCOMPLETE_LABELS[context.kind] ?? "bmap")
      : context.kind === "image" ? "Image paths" : "Project paths";
    renderEditorAutocomplete();
  }


  function acceptEditorAutocomplete(index = app.autocompleteState.activeIndex) {
    const item = app.autocompleteState.items[index];
    const range = app.autocompleteState.range;
    if (!item || !range) {
      hideEditorAutocomplete();
      return;
    }
    app.replaceEditorRange(range.start, range.end, item.insertText);
    app.logDebug("action", "Autocomplete accepted", item.detail);
    hideEditorAutocomplete();
  }

  return { acceptEditorAutocomplete, hideEditorAutocomplete, renderEditorAutocomplete, showEditorAutocomplete };
}
