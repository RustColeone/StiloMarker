// The source editor: the contenteditable that shows a file's text, split by
// job into parts that share one editor object (`ed`):
//   editor-dom.js      the text and the DOM, caret and selection
//   editor-render.js   rendering lines incrementally, scroll, measurements
//   editor-history.js  edits, undo / redo, telling the app the text changed
//   editor-cursors.js  other people's cursors and the overview ruler
//   editor-toolbar.js  the formatting toolbar's edits, the drop caret
//   editor-keys.js     indentation and key handling
// main.js creates it on first use and passes its shared values in `app`
// (including fileContentFromEditor(file, text), which maps the edited text back
// into the whole file when the editor shows only part of it).
import { installCursors } from "./editor-cursors.js";
import { installDom } from "./editor-dom.js";
import { installHistory } from "./editor-history.js";
import { installKeys } from "./editor-keys.js";
import { installRender } from "./editor-render.js";
import { installToolbar } from "./editor-toolbar.js";

// What the app calls (the same functions as before the split).
const API = [
    "applyEditorEdit", "applyEditorRender", "attachSelectionChangeListener", "caretIntoView", "clamp",
    "clampEditorSelection", "clearEditorDropCaret", "clientColor", "consumeExternalEditorSelection",
    "forwardEditorWheel", "getEditorLineHeight", "getEditorSelection", "getEditorText",
    "getEditorTextOffsetFromPoint", "handleEditorKeydown", "handleIndentKeydown", "loadEditorContent",
    "notifyEditorChanged", "onRemoteCursor", "pruneRemoteCursors", "pushEditorHistoryState",
    "queueExternalEditorSelection", "refreshFormatToolbar", "renderEditorContent", "renderRemoteCursors",
    "replaceEditorRange", "resetEditorHistory", "scheduleOverviewRuler", "scheduleRemoteCursorRender",
    "setEditorSelection", "showEditorDropCaret", "syncEditorScroll", "textOffsetToDomPosition",
    "transformEditorSelection"
];

export function createEditorCore(app) {
  const ed = {};
  for (const install of [installDom, installRender, installHistory, installCursors, installToolbar, installKeys]) install(ed, app);
  return Object.fromEntries(API.map((name) => [name, ed[name]]));
}
