// Find and replace in the open file: the find bar, match highlighting,
// stepping through matches, and replacing one or all.
// main.js creates this on first use and passes its shared values in `app`.
import { isTextFileName } from "../../workspace/index.js";
import { ignore } from "../../../kernel/index.js";

export function createFindReplace(app) {
  // Build the RegExp for the current query + toggles, or null on empty/invalid.
  function buildSearchRegex() {
    const raw = app.elements.findInput?.value ?? "";
    if (!raw) return null;
    let source = app.searchState.regex ? raw : raw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (app.searchState.wholeWord) source = `\\b(?:${source})\\b`;
    const flags = "g" + (app.searchState.caseSensitive ? "" : "i");
    try {
      return new RegExp(source, flags);
    } catch {
      return null; // invalid regex — caller shows the error state
    }
  }

  // Scan the active file's text for all matches. Preserves the current match near
  // the caret when possible so re-computing (e.g. after an edit) doesn't jump.
  function computeSearchMatches({ keepCaret = false } = {}) {
    const activeFile = app.controller.getActiveFile();
    const canSearch = Boolean(activeFile && isTextFileName(activeFile.name));
    const regex = canSearch ? buildSearchRegex() : null;
    const invalid = canSearch && app.searchState.regex && Boolean(app.elements.findInput?.value) && !regex;
    app.elements.findInput?.classList.toggle("is-error", invalid);
    app.searchState.matches = [];
    if (regex) {
      const text = app.getEditorText();
      let m;
      let guard = 0;
      while ((m = regex.exec(text)) !== null) {
        const start = m.index;
        const end = start + m[0].length;
        app.searchState.matches.push({ start, end });
        if (m[0].length === 0) regex.lastIndex += 1; // avoid an infinite loop on zero-width
        if (++guard > 20000) break;                  // sanity cap on pathological patterns
      }
    }
    if (app.searchState.matches.length === 0) {
      app.searchState.currentIndex = -1;
    } else if (keepCaret) {
      const caret = app.getEditorSelection().start;
      const idx = app.searchState.matches.findIndex((mm) => mm.start >= caret);
      app.searchState.currentIndex = idx >= 0 ? idx : 0;
    } else if (app.searchState.currentIndex < 0 || app.searchState.currentIndex >= app.searchState.matches.length) {
      app.searchState.currentIndex = 0;
    }
    updateFindCount();
    renderSearchHighlights();
  }

  function updateFindCount() {
    if (!app.elements.findCount) return;
    const total = app.searchState.matches.length;
    if (app.elements.findInput && !app.elements.findInput.value) {
      app.elements.findCount.textContent = "No results";
    } else if (total === 0) {
      app.elements.findCount.textContent = app.elements.findInput?.classList.contains("is-error") ? "Bad pattern" : "No results";
    } else {
      app.elements.findCount.textContent = `${app.searchState.currentIndex + 1} of ${total}`;
    }
  }

  // Draw a highlight box (one per visual line) over each match, reusing the remote-
  // cursor rect technique. Positioned relative to #editor-scroll so it tracks the
  // content as #editor-content scrolls.
  function renderSearchHighlights() {
    const layer = app.elements.editorSearchHighlights;
    if (!layer) return;
    layer.textContent = "";
    if (!app.searchState.open || !app.searchState.matches.length) return;
    const scrollRect = app.elements.editorScroll.getBoundingClientRect();
    const MAX = 500;
    // Only matches in the page (of a long file, the lines in view: editor-window.js).
    const shown = app.renderedRange();
    app.searchState.matches.map((match, index) => ({ match, index }))
      .filter(({ match }) => match.end >= shown.start && match.start <= shown.end).slice(0, MAX).forEach(({ match, index }) => {
      try {
        const s = app.textOffsetToDomPosition(match.start);
        const e = app.textOffsetToDomPosition(match.end);
        const range = document.createRange();
        range.setStart(s.node, s.offset);
        range.setEnd(e.node, e.offset);
        const rects = Array.from(range.getClientRects()).filter((r) => r.width > 0 && r.height > 0);
        const isCurrent = index === app.searchState.currentIndex;
        for (const rect of rects) {
          // Skip rects entirely outside the visible band (cheap virtualization).
          if (rect.bottom < scrollRect.top - 40 || rect.top > scrollRect.bottom + 40) continue;
          const box = document.createElement("div");
          box.className = `search-match${isCurrent ? " is-current" : ""}`;
          box.style.left = `${rect.left - scrollRect.left}px`;
          box.style.top = `${rect.top - scrollRect.top}px`;
          box.style.width = `${rect.width}px`;
          box.style.height = `${rect.height}px`;
          layer.append(box);
        }
      } catch (error) { ignore(error, "drawing a search match failed (out of range during a re-render?)"); }
    });
    app.scheduleOverviewRuler(); // search hits are ruler markers too
  }

  function gotoMatch(index) {
    if (!app.searchState.matches.length) return;
    // A match that runs past the end of the current text is a leftover from a
    // document we are no longer showing; re-search before moving the caret rather
    // than selecting a phantom range.
    const textLength = app.getEditorText().length;
    if (app.searchState.matches.some((m) => m.end > textLength)) {
      app.searchState.currentIndex = -1;
      computeSearchMatches();
      if (!app.searchState.matches.length) return;
    }
    const total = app.searchState.matches.length;
    app.searchState.currentIndex = ((index % total) + total) % total;
    const match = app.searchState.matches[app.searchState.currentIndex];
    // Select the match IN the editor even though the find box has focus, then
    // scroll it into view. Focusing the editor briefly is what lets the selection
    // land; we return focus to the find input so the user keeps typing.
    app.elements.editorContent.focus({ preventScroll: true });
    app.setEditorSelection(match.start, match.end);
    app.caretIntoView(app.getEditorLineHeight() * 2);
    app.elements.findInput?.focus();
    updateFindCount();
    renderSearchHighlights();
  }

  function findNext() {
    if (!app.searchState.matches.length) { computeSearchMatches(); }
    if (app.searchState.matches.length) gotoMatch(app.searchState.currentIndex + 1);
  }

  function findPrev() {
    if (!app.searchState.matches.length) { computeSearchMatches(); }
    if (app.searchState.matches.length) gotoMatch(app.searchState.currentIndex - 1);
  }

  // The replacement text for one match (regex mode honors $1, $&, … via a scoped
  // re-run of the pattern on just that match).
  function replacementFor(matchText) {
    const replaceRaw = app.elements.replaceInput?.value ?? "";
    if (!app.searchState.regex) return replaceRaw;
    const single = buildSearchRegex();
    if (!single) return replaceRaw;
    // matchText is exactly one match, so a single replace applies the templates.
    return matchText.replace(new RegExp(single.source, single.flags.replace("g", "")), replaceRaw);
  }

  function replaceCurrent() {
    if (app.searchState.currentIndex < 0 || !app.searchState.matches.length) { findNext(); return; }
    const match = app.searchState.matches[app.searchState.currentIndex];
    const text = app.getEditorText();
    const matchText = text.slice(match.start, match.end);
    const replacement = replacementFor(matchText);
    const newText = text.slice(0, match.start) + replacement + text.slice(match.end);
    const caret = match.start + replacement.length;
    app.applyEditorEdit(newText, caret, caret);
    computeSearchMatches();
    // Move to the next match at/after where we just replaced.
    const nextIdx = app.searchState.matches.findIndex((mm) => mm.start >= caret);
    if (app.searchState.matches.length) gotoMatch(nextIdx >= 0 ? nextIdx : 0);
    app.elements.findInput?.focus();
  }

  function replaceAllMatches() {
    const regex = buildSearchRegex();
    if (!regex || !app.searchState.matches.length) return;
    const text = app.getEditorText();
    const replaceRaw = app.elements.replaceInput?.value ?? "";
    const count = app.searchState.matches.length;
    // String.replace with a global regex applies $1/$& templates in regex mode;
    // in plain mode the pattern is escaped so it's a literal replace.
    const newText = text.replace(regex, replaceRaw);
    app.applyEditorEdit(newText, 0, 0);
    computeSearchMatches();
    app.showToast(`Replaced ${count} occurrence${count === 1 ? "" : "s"}`);
    app.elements.findInput?.focus();
  }

  function openFindBar(replaceMode = false) {
    if (!app.elements.editorFindBar) return;
    app.searchState.open = true;
    app.searchState.replaceMode = replaceMode;
    app.elements.editorFindBar.hidden = false;
    if (app.elements.findReplaceRow) app.elements.findReplaceRow.hidden = !replaceMode;
    // Seed the find box with the current selection (VS Code behaviour).
    const sel = app.getEditorSelection();
    if (sel.end > sel.start) {
      const selected = app.getEditorText().slice(sel.start, sel.end);
      if (!selected.includes("\n")) app.elements.findInput.value = selected;
    }
    computeSearchMatches({ keepCaret: true });
    app.elements.findInput?.focus();
    app.elements.findInput?.select();
  }

  function closeFindBar() {
    app.searchState.open = false;
    if (app.elements.editorFindBar) app.elements.editorFindBar.hidden = true;
    if (app.elements.editorSearchHighlights) app.elements.editorSearchHighlights.textContent = "";
    app.elements.editorContent?.focus({ preventScroll: true });
  }

  function toggleFindOption(key, buttonEl) {
    app.searchState[key] = !app.searchState[key];
    buttonEl?.setAttribute("aria-pressed", String(app.searchState[key]));
    computeSearchMatches({ keepCaret: true });
  }

  return {
    closeFindBar, computeSearchMatches, findNext, findPrev, gotoMatch, openFindBar,
    renderSearchHighlights, replaceAllMatches, replaceCurrent, toggleFindOption
  };
}
