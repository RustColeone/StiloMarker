// What the editor shows, with one owner (the Editor): the tabs open in the
// source and preview panes, which file (and which part of it) each pane
// shows, the node selected in the explorer, and a tab being dragged.
// Everyone reads get(); only these named actions change it, and each change
// lands in the trace under its name (kernel createState).
//
//   sourceOpenTabIds, previewOpenTabIds   file ids, in tab order
//   previewFileId      the file the preview shows (or the diff tab's id)
//   previewPart        the part of it the preview shows, or null for all of it
//   sourcePart         { fileId, partId } the source editor shows, or null
//   selectionNodeId    the node selected in the explorer
//   draggingTabState   { pane, fileId } while a tab is dragged, else null

export const EMPTY_VIEW = {
  sourceOpenTabIds: [], previewOpenTabIds: [], previewFileId: null, previewPart: null,
  sourcePart: null, selectionNodeId: null, draggingTabState: null
};

const tabsOf = (pane) => (pane === "source" ? "sourceOpenTabIds" : "previewOpenTabIds");
const isFile = (project, id) => project.nodes[id]?.kind === "file";

// Moves a tab before (or after) another; to the end when the other is not there.
export function moveTabWithinList(tabIds, draggedFileId, targetFileId, placeAfter = false) {
  const next = tabIds.filter((tabId) => tabId !== draggedFileId);
  const targetIndex = next.indexOf(targetFileId);
  if (targetIndex < 0) {
    next.push(draggedFileId);
    return next;
  }
  next.splice(targetIndex + (placeAfter ? 1 : 0), 0, draggedFileId);
  return next;
}

export function createView(state) {
  const get = state.get;

  return Object.freeze({
    get,
    on: state.on,

    // A project was opened or replaced: its active file is the one tab of
    // each pane, and it is selected (else the root).
    reset(project) {
      const active = project.activeFileId ?? null;
      state.set("reset", {
        sourceOpenTabIds: active ? [active] : [], previewOpenTabIds: active ? [active] : [], previewFileId: active,
        previewPart: null, sourcePart: null, selectionNodeId: active ?? project.rootId
      });
    },

    // The user picked a node, or one part of a file, in the explorer: it is
    // selected, and the source editor shows that part (or the whole file).
    pick(nodeId, partId = null) {
      state.set("pick", { selectionNodeId: nodeId, sourcePart: partId ? { fileId: nodeId, partId } : null });
    },

    // Only the explorer's selection moves (a new file, a fallback tab).
    select(nodeId) {
      state.set("select", { selectionNodeId: nodeId });
    },

    openTab(pane, fileId) {
      const key = tabsOf(pane);
      if (!get()[key].includes(fileId)) state.set(`open ${pane} tab`, { [key]: [...get()[key], fileId] });
    },

    // Closing the preview's shown tab shows the last one left.
    closeTab(pane, fileId) {
      const key = tabsOf(pane);
      const tabs = get()[key].filter((tabId) => tabId !== fileId);
      const patch = { [key]: tabs };
      if (pane === "preview" && get().previewFileId === fileId) patch.previewFileId = tabs[tabs.length - 1] ?? null;
      state.set(`close ${pane} tab`, patch);
    },

    // targetFileId null: to the end.
    moveTab(pane, draggedFileId, targetFileId, placeAfter = false) {
      const key = tabsOf(pane);
      state.set(`move ${pane} tab`, { [key]: moveTabWithinList(get()[key], draggedFileId, targetFileId, placeAfter) });
    },

    showPreview(fileId, partId = null) {
      state.set("show preview", { previewFileId: fileId, previewPart: partId });
    },

    // The diff tab is a preview target but not a project file.
    showDiff(diffTabId) {
      state.set("show diff", { previewFileId: diffTabId });
    },

    clearParts() {
      state.set("clear parts", { sourcePart: null, previewPart: null });
    },

    dragTab(dragging) {
      state.set(dragging ? "drag tab" : "drop tab", { draggingTabState: dragging });
    },

    // After the project changed: tabs only for files that still exist, the
    // active file among the source tabs, and the preview showing a tab.
    keepTabs(project, { diffTabId, diffActive }) {
      const view = get();
      const sourceOpenTabIds = view.sourceOpenTabIds.filter((id) => isFile(project, id));
      const previewOpenTabIds = view.previewOpenTabIds.filter((id) => isFile(project, id));
      if (project.activeFileId && !sourceOpenTabIds.includes(project.activeFileId)) sourceOpenTabIds.push(project.activeFileId);
      if (!project.activeFileId) sourceOpenTabIds.length = 0;
      let previewFileId = view.previewFileId;
      if (previewFileId === diffTabId) {
        if (!diffActive) previewFileId = previewOpenTabIds[previewOpenTabIds.length - 1] ?? null;
      } else if (previewFileId && !isFile(project, previewFileId)) {
        previewFileId = null;
      }
      if (previewFileId && previewFileId !== diffTabId && !previewOpenTabIds.includes(previewFileId)) previewOpenTabIds.push(previewFileId);
      if (!previewFileId && previewOpenTabIds.length > 0) previewFileId = previewOpenTabIds[previewOpenTabIds.length - 1];
      const same = (a, b) => a.length === b.length && a.every((id, i) => id === b[i]);
      state.set("keep tabs", {
        ...(same(sourceOpenTabIds, view.sourceOpenTabIds) ? {} : { sourceOpenTabIds }),
        ...(same(previewOpenTabIds, view.previewOpenTabIds) ? {} : { previewOpenTabIds }),
        previewFileId
      });
    }
  });
}
