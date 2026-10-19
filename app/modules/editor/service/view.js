// What the editor shows, with one owner (the Editor): its groups of tabs (step
// 5 of docs/ARCHITECTURE.md), a tab being a file in a view ("source" or
// "preview"); the group each view's body is in (one source editor and one
// preview for now); which file (and which part of it) the preview shows; the
// node selected in the explorer; and a tab being dragged.
// Everyone reads get(); only these named actions change it, and each change
// lands in the trace under its name (kernel createState).
//
//   groups        [{ id, tabs: [{ fileId, view }], active: { fileId, view } | null }],
//                 "left" then "right"; a group's active tab is what it shows
//   hosts         { source, preview }: the group each body is in. The source
//                 body shows the project's active file, the preview previewFileId,
//                 so the active tab of the group holding a body is that body's file
//   focus         the group last worked in
//   previewFileId      the file the preview shows (or a pane view's id: History's diff)
//   previewPart        the part of it the preview shows, or null for all of it
//   sourcePart         { fileId, partId } the source editor shows, or null
//   selectionNodeId    the node selected in the explorer
//   draggingTabState   { group, fileId, view } while a tab is dragged, else null
//
// Today's layout is the default: the source tabs on the left, the preview tabs
// on the right. The actions that take a view work in the group holding that
// view's body unless given a group; activate and moveToGroup move a body to
// another group, and closeGroup hands a closed group's bodies to the other.

const seal = (groups) => Object.freeze(groups.map((group) => Object.freeze({
  ...group, tabs: Object.freeze(group.tabs.map((tab) => Object.freeze({ ...tab }))), active: group.active ? Object.freeze({ ...group.active }) : null
})));

export const EMPTY_VIEW = {
  groups: seal([{ id: "left", tabs: [], active: null }, { id: "right", tabs: [], active: null }]),
  hosts: Object.freeze({ source: "left", preview: "right" }), focus: "left",
  previewFileId: null, previewPart: null, sourcePart: null, selectionNodeId: null, draggingTabState: null
};

export const sameTab = (a, b) => Boolean(a && b) && a.fileId === b.fileId && a.view === b.view;
const isFile = (project, id) => project.nodes[id]?.kind === "file";

// Reading a view state: a group, the group holding a view's body, and the
// files open in a view there (in tab order).
export const groupOf = (state, id) => state.groups.find((group) => group.id === id) ?? null;
export const hostOf = (state, view) => groupOf(state, state.hosts[view]);
export const filesIn = (state, view) => (hostOf(state, view)?.tabs ?? []).filter((tab) => tab.view === view).map((tab) => tab.fileId);

// The groups as kept with the workspace's open tabs, by path (ids are this
// page's own), and back. pathOf(id) / idOf(path): null when not a file.
export function savedGroups(state, pathOf) {
  const saved = (tab) => {
    const path = tab ? pathOf(tab.fileId) : null;
    return path ? { path, view: tab.view } : null;
  };
  return state.groups.map((group) => ({ id: group.id, tabs: group.tabs.map(saved).filter(Boolean), active: saved(group.active) }));
}

// Each body goes to the group showing its view (the left first), else to one
// holding a tab of it, else where it is by default; the preview shows that
// group's preview tab.
export function groupsFromSaved(saved, idOf) {
  const byId = new Map();
  for (const group of Array.isArray(saved) ? saved : []) if (!byId.has(group?.id)) byId.set(group?.id, group); // the first of a group named twice
  const groups = EMPTY_VIEW.groups.map(({ id }) => {
    const kept = byId.get(id);
    const tabs = (kept?.tabs ?? []).flatMap((tab) => {
      const fileId = idOf(tab.path);
      return fileId ? [{ fileId, view: tab.view }] : [];
    });
    const shown = kept?.active ? { fileId: idOf(kept.active.path), view: kept.active.view } : null;
    return { id, tabs, active: tabs.find((tab) => sameTab(tab, shown)) ?? tabs.at(-1) ?? null };
  });
  const holder = (view) => (groups.find((group) => group.active?.view === view)
    ?? groups.find((group) => group.tabs.some((tab) => tab.view === view)))?.id ?? EMPTY_VIEW.hosts[view];
  const hosts = { source: holder("source"), preview: holder("preview") };
  const shownPreview = groups.find((group) => group.id === hosts.preview)?.active;
  return { groups, hosts, previewFileId: shownPreview?.view === "preview" ? shownPreview.fileId : null };
}

const sameGroups = (a, b) => a.length === b.length && a.every((group, i) => group.id === b[i].id
  && ((!group.active && !b[i].active) || sameTab(group.active, b[i].active))
  && group.tabs.length === b[i].tabs.length && group.tabs.every((tab, j) => sameTab(tab, b[i].tabs[j])));

export function createView(state) {
  const get = state.get;
  // The groups with one of them changed; set only when something did.
  const change = (action, id, edit, patch = {}) => {
    const groups = seal(get().groups.map((group) => (group.id === id ? edit(group) : group)));
    state.set(action, sameGroups(groups, get().groups) ? patch : { ...patch, groups });
  };

  return Object.freeze({
    get,
    on: state.on,

    // A project was opened or replaced: its active file is the one tab of
    // each view, in today's layout, and it is selected (else the root).
    reset(project) {
      const active = project.activeFileId ?? null;
      const tab = (view) => (active ? { fileId: active, view } : null);
      state.set("reset", {
        groups: seal([{ id: "left", tabs: active ? [tab("source")] : [], active: tab("source") },
          { id: "right", tabs: active ? [tab("preview")] : [], active: tab("preview") }]),
        hosts: EMPTY_VIEW.hosts, focus: "left",
        previewFileId: active, previewPart: null, sourcePart: null, selectionNodeId: active ?? project.rootId
      });
    },

    // The groups as they were when the workspace was last open (groupsFromSaved).
    restore({ groups, hosts, previewFileId }) {
      state.set("restore groups", { groups: seal(groups), hosts: Object.freeze({ ...hosts }), focus: hosts.source, previewFileId, previewPart: null });
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

    openTab(view, fileId, group = get().hosts[view]) {
      const tab = { fileId, view };
      change(`open ${view} tab`, group, (g) => (g.tabs.some((t) => sameTab(t, tab)) ? g : { ...g, tabs: [...g.tabs, tab] }));
    },

    // The source editor shows a file: it is the active tab of the group holding it.
    showSource(fileId) {
      const group = get().hosts.source;
      change("show source", group, (g) => ({ ...g, active: fileId ? { fileId, view: "source" } : null }), { focus: group });
    },

    // Closing a tab shows the group's last one left; closing the preview's
    // shown tab shows the last preview tab there.
    closeTab(view, fileId, group = get().hosts[view]) {
      const tab = { fileId, view };
      const before = groupOf(get(), group);
      const tabs = before?.tabs.filter((t) => !sameTab(t, tab)) ?? [];
      const patch = {};
      if (view === "preview" && group === get().hosts.preview && get().previewFileId === fileId) {
        patch.previewFileId = tabs.filter((t) => t.view === "preview").at(-1)?.fileId ?? null;
      }
      change(`close ${view} tab`, group, (g) => ({ ...g, tabs, active: sameTab(g.active, tab) ? tabs.at(-1) ?? null : g.active }), patch);
    },

    // A tab in a group comes on screen (clicked, Show here, Open as): it is
    // that group's active tab, and the body of its view moves to that group
    // (the other group, if its active tab wants the same body, then shows a
    // placeholder). A preview tab is what the preview shows.
    activate(group, tab) {
      const next = { fileId: tab.fileId, view: tab.view };
      const patch = { hosts: Object.freeze({ ...get().hosts, [next.view]: group }), focus: group };
      if (next.view === "preview") Object.assign(patch, { previewFileId: next.fileId, previewPart: null });
      change(`show ${next.view} tab`, group, (g) => ({
        ...g, tabs: g.tabs.some((t) => sameTab(t, next)) ? g.tabs : [...g.tabs, next], active: next
      }), patch);
    },

    // A tab moved within its group, before (or after) another; to the end when target is null.
    moveTab(group, dragged, target, placeAfter = false) {
      change("move tab", group, (g) => {
        const rest = g.tabs.filter((t) => !sameTab(t, dragged));
        const at = target ? rest.findIndex((t) => sameTab(t, target)) : -1;
        const tabs = [...rest];
        if (at < 0) tabs.push({ ...dragged });
        else tabs.splice(at + (placeAfter ? 1 : 0), 0, { ...dragged });
        return { ...g, tabs };
      });
    },

    // A tab moved (or, keep: copied) to another group, before or after a tab
    // there or at the end, where it comes on screen (its body follows). The
    // group it left shows its last tab.
    moveToGroup(from, to, tab, { keep = false, target = null, placeAfter = false } = {}) {
      const moving = { fileId: tab.fileId, view: tab.view };
      const groups = get().groups.map((g) => {
        if (g.id === from && !keep && from !== to) {
          const tabs = g.tabs.filter((t) => !sameTab(t, moving));
          return { ...g, tabs, active: sameTab(g.active, moving) ? tabs.at(-1) ?? null : g.active };
        }
        if (g.id === to) {
          const rest = g.tabs.filter((t) => !sameTab(t, moving));
          const at = target ? rest.findIndex((t) => sameTab(t, target)) : -1;
          const tabs = [...rest];
          if (at < 0) tabs.push(moving);
          else tabs.splice(at + (placeAfter ? 1 : 0), 0, moving);
          return { ...g, tabs, active: moving };
        }
        return g;
      });
      const patch = { groups: seal(groups), hosts: Object.freeze({ ...get().hosts, [moving.view]: to }), focus: to };
      if (moving.view === "preview") Object.assign(patch, { previewFileId: moving.fileId, previewPart: null });
      state.set(keep ? "open tab to the side" : "move tab to group", patch);
    },

    // A group closed (its last tab gone): the bodies it held go to the other,
    // where what opens next shows.
    closeGroup(group) {
      const other = get().groups.find((g) => g.id !== group)?.id;
      if (!other) return;
      const hosts = Object.fromEntries(Object.entries(get().hosts).map(([view, holder]) => [view, holder === group ? other : holder]));
      state.set("close group", { hosts: Object.freeze(hosts), focus: other });
    },

    showPreview(fileId, partId = null) {
      const group = get().hosts.preview;
      change("show preview", group, (g) => ({ ...g, active: fileId ? { fileId, view: "preview" } : null }),
        { previewFileId: fileId, previewPart: partId, focus: group });
    },

    // A pane view (editor.paneViews: History's diff) is a preview target but not a project file.
    showView(viewId) {
      const group = get().hosts.preview;
      change("show a view", group, (g) => ({ ...g, active: { fileId: viewId, view: "preview" } }), { previewFileId: viewId, focus: group });
    },

    clearParts() {
      state.set("clear parts", { sourcePart: null, previewPart: null });
    },

    dragTab(dragging) {
      state.set(dragging ? "drag tab" : "drop tab", { draggingTabState: dragging });
    },

    // After the project changed: tabs only for files that still exist, the
    // active file a source tab, and the preview showing a tab; the groups
    // holding the bodies show their files.
    // views: every pane view's id; open: those open now.
    keepTabs(project, { views = [], open = [] } = {}) {
      const view = get();
      const active = project.activeFileId ?? null;
      let previewFileId = view.previewFileId;
      const previewTabs = filesIn(view, "preview").filter((id) => isFile(project, id));
      if (views.includes(previewFileId)) {
        if (!open.includes(previewFileId)) previewFileId = previewTabs.at(-1) ?? null;
      } else if (previewFileId && !isFile(project, previewFileId)) {
        previewFileId = null;
      }
      if (!previewFileId) previewFileId = previewTabs.at(-1) ?? null;
      const shown = (fileId, kind) => (fileId ? { fileId, view: kind } : null);
      const groups = seal(view.groups.map((group) => {
        // A pane view's tab is drawn apart from the files' (editor.paneViews).
        let tabs = group.tabs.filter((tab) => isFile(project, tab.fileId));
        let current = group.active && (isFile(project, group.active.fileId) || views.includes(group.active.fileId)) ? group.active : null;
        if (group.id === view.hosts.source) {
          if (!active) tabs = tabs.filter((tab) => tab.view !== "source");
          else if (!tabs.some((tab) => sameTab(tab, shown(active, "source")))) tabs = [...tabs, shown(active, "source")];
          if (!current || current.view === "source") current = shown(active, "source");
        }
        if (group.id === view.hosts.preview) {
          if (previewFileId && !views.includes(previewFileId) && !tabs.some((tab) => sameTab(tab, shown(previewFileId, "preview")))) {
            tabs = [...tabs, shown(previewFileId, "preview")];
          }
          if (!current || current.view === "preview") current = shown(previewFileId, "preview");
        }
        return { ...group, tabs, active: current };
      }));
      state.set("keep tabs", { ...(sameGroups(groups, view.groups) ? {} : { groups }), previewFileId });
    }
  });
}
