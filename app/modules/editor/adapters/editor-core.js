// The source editor: the contenteditable that shows a file's text, split by
// job into parts that share one editor object (`ed`):
//   editor-dom.js      the text and the DOM, caret and selection
//   editor-render.js   rendering lines incrementally, scroll, measurements
//   editor-window.js   of a long file, only the lines in view (lazy rendering)
//   editor-history.js  edits, undo / redo, telling the app the text changed
//   editor-cursors.js  other people's cursors and the overview ruler
//   editor-toolbar.js  the formatting toolbar's edits, the drop caret
//   editor-keys.js     indentation and key handling
// Each source editor has its own (editors.js): `app` is that editor's context,
// its elements, render cache, shown file and history its own, the rest the
// Editor's shared values (including fileContentFromEditor(file, text), which
// maps the edited text back into the whole file when the editor shows only
// part of it).
import { installCursors } from "./editor-cursors.js";
import { installDom } from "./editor-dom.js";
import { installHistory } from "./editor-history.js";
import { installKeys } from "./editor-keys.js";
import { installRender } from "./editor-render.js";
import { installToolbar } from "./editor-toolbar.js";
import { installWindow } from "./editor-window.js";

// What the app calls (the same functions as before the split): each editor's
// own; the Editor's shared context hands them to the active editor.
export const EDITOR_API = [
    "applyEditorEdit", "applyEditorRender", "attachSelectionChangeListener", "caretIntoView", "clamp",
    "clampEditorSelection", "clearEditorDropCaret", "clientColor", "consumeExternalEditorSelection", "diffEditorTexts", "editedOneLine",
    "forwardEditorWheel", "getEditorLineHeight", "getEditorSelection", "getEditorText",
    "getEditorTextOffsetFromPoint", "handleEditorKeydown", "handleIndentKeydown", "loadEditorContent",
    "notifyEditorChanged", "onRemoteCursor", "pruneRemoteCursors", "pushEditorHistoryState",
    "queueExternalEditorSelection", "refreshFormatToolbar", "renderEditorContent", "drawMarkBar", "renderRemoteCursors",
    "replaceEditorRange", "resetEditorHistory", "scheduleOverviewRuler", "scheduleRemoteCursorRender",
    "setEditorSelection", "showEditorDropCaret", "syncEditorScroll", "textOffsetToDomPosition",
    "transformEditorSelection", "updateEditorWindow", "isOffsetRendered", "renderedRange", "editorLineTop", "revealEditorLine", "selectAllInEditor"
];

export function createEditorCore(app) {
  const ed = { rendering: false, typing: false };
  for (const install of [installDom, installRender, installWindow, installHistory, installCursors, installToolbar, installKeys]) install(ed, app);
  return {
    ...Object.fromEntries(EDITOR_API.map((name) => [name, ed[name]])),
    isRendering: () => ed.rendering, // redrawing the text (the page may report focus oddly meanwhile)
    isTyping: () => ed.typing        // applying a keystroke: the rest of the app may catch up later
  };
}
