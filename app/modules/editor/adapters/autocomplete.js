// Source-pane autocomplete: file paths and images in Markdown links, words
// from the document, and what a format adds through the `completions`
// extension point (a diagram's blocks and properties), shown at the caret.
// Part of the Editor: `app` is its shared context (surface.js).
import { getPath, isImageFileName, isMarkdownFileName, isTextFileName } from "../../workspace/index.js";
import { builtinTypes } from "../../file-types/index.js";

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

  function findAutocompleteContext(force = false) {
    const activeFile = app.controller.getActiveFile();
    if (!activeFile || !isTextFileName(activeFile.name)) {
      return null;
    }
    const value = app.getEditorText();
    const cursor = app.getEditorSelection().start;
    // A format's own completions (editor.completions): its context, or none here.
    const provider = app.completions.get(builtinTypes.formatOf(activeFile.name));
    if (provider) {
      const context = provider.find({ text: value, cursor, force });
      return context ? { ...context, provider } : null;
    }
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
    if (context.provider) {
      items = context.provider.items(context, { project, file: activeFile,
        projectFiles: (kind) => buildProjectFileSuggestions(project, activeFile?.id ?? null, kind) });
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
    app.elements.editorAutocompleteLabel.textContent = context.provider
      ? context.provider.label(context)
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

  return {
    acceptEditorAutocomplete, hideEditorAutocomplete, renderEditorAutocomplete,
    showEditorAutocomplete
  };
}
