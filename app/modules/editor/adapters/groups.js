// The editor's groups on the page (step 5 of docs/ARCHITECTURE.md): the two
// panes are the groups ("left" is #source-pane and "right" #preview-pane,
// named for today's layout), each with its tab strip and its own source
// editor (editors.js). The preview body goes to the group the view says holds
// it (hosts.preview); a group shows the body its active tab wants: its editor
// for a source tab; for a preview tab the preview, or when the other group
// holds it, a second preview of its own (History's diff stays in the preview:
// a placeholder with Show here). Each group's label says what it does with
// which file ("Editing" / "Previewing", and its name); its ▾ switches the
// file between Source and Preview. Drawn on every render (surface.js); on the
// phone the groups draw nothing of their own, the second previews none and
// only the active editor shows (the CSS), so the views show as before.
// Part of the Editor: `app` is its shared context (surface.js).
import { getPath } from "../../workspace/index.js";

const VIEWS = { source: "Source", preview: "Preview" };

export function createGroups(app) {
  const groupElement = (id) => document.querySelector(`.editor-group[data-group="${id}"]`);

  // A group's second preview: made the first time it needs one.
  const seconds = new Map(); // group id -> its second preview's body
  function secondOf(groupId, element) {
    if (!seconds.has(groupId)) {
      const body = document.createElement("div");
      body.className = "preview-body second-preview";
      const output = document.createElement("article");
      output.className = "preview-output";
      body.append(output);
      element.append(body);
      seconds.set(groupId, body);
    }
    return seconds.get(groupId);
  }

  // A group's label: the view (a verb while it shows a file), the file's name,
  // and its ▾ when the file can switch views.
  function drawLabel(label, view, group, project) {
    const active = group.active;
    const file = active ? project.nodes[active.fileId] : null;
    const paneView = active ? app.paneViews.get(active.fileId) : null;
    const verb = !active ? VIEWS[view]
      : paneView ? "Viewing"
        : view === "source" ? (app.workspace.location.readOnly() ? "Reading" : "Editing") : "Previewing";
    label.querySelector(".pane-label-view").textContent = verb;
    label.querySelector(".pane-label-file").textContent = active ? nameOf(project, active) : "";
    label.dataset.view = view;
    label.title = file ? `${getPath(project, file.id)}: switch between Source and Preview` : "";
    label.disabled = file?.kind !== "file";
  }

  // The name a placeholder gives its tab: the file's, or a pane view's (History's diff).
  function nameOf(project, tab) {
    const paneView = app.paneViews.get(tab.fileId);
    if (paneView) return paneView.tab()?.label ?? "";
    return project.nodes[tab.fileId]?.name ?? "";
  }

  function drawGroups(project) {
    const state = app.view.get();
    const previewBody = app.elements.previewBody;
    const home = groupElement(state.hosts.preview);
    if (home && previewBody.parentElement !== home) home.append(previewBody);
    for (const group of state.groups) {
      const element = groupElement(group.id);
      if (!element) continue;
      const previewHere = state.hosts.preview === group.id;
      // Its active tab's view; with none, the active editor (the welcome page) or the preview it holds.
      const wants = group.active?.view ?? (state.hosts.source === group.id ? "source" : previewHere ? "preview" : null);
      const holds = wants === "source" || (wants === "preview" && previewHere);
      const editorBody = app.editorOf(group.id)?.elements.sourceBody;
      if (editorBody) editorBody.dataset.shown = String(wants === "source");
      if (previewHere) previewBody.dataset.shown = String(wants === "preview");
      element.dataset.view = wants ?? "";
      const label = element.querySelector(".pane-label");
      if (label && wants) drawLabel(label, wants, group, project);
      // A preview tab whose preview the other group holds: a second preview here
      // (not a pane view: History's diff stays where the preview is).
      const file = group.active ? project.nodes[group.active.fileId] : null;
      const second = !holds && wants === "preview" && file?.kind === "file";
      if (second) {
        const body = secondOf(group.id, element);
        body.dataset.shown = "true";
        const target = body.querySelector(".preview-output");
        // Not drawn again while the user edits inside it (a diagram node's
        // fields, a table's cell), as the main preview; another file to show is always drawn.
        const editingInside = target.contains(document.activeElement) && document.activeElement !== target;
        if (!editingInside || body.dataset.drawn !== file.id) {
          body.dataset.drawn = file.id;
          const state = app.renderPreviewContent(target, project, file, { secondary: true });
          if (state.shouldTypeset) void app.typesetPreview(state.content, target);
        }
      } else if (seconds.has(group.id)) {
        seconds.get(group.id).dataset.shown = "false";
      }
      const placeholder = element.querySelector(".group-placeholder");
      if (!placeholder) continue;
      placeholder.hidden = holds || !group.active || second;
      if (!placeholder.hidden) {
        const text = placeholder.querySelector(".group-placeholder-text");
        text.textContent = `${nameOf(project, group.active)} is open as ${VIEWS[wants]} in the other group.`;
        text.title = project.nodes[group.active.fileId] ? getPath(project, group.active.fileId) : "";
      }
    }
  }

  // Show here: the group's active tab takes its body back. The label's ▾:
  // the active tab's file as Source or Preview.
  for (const element of document.querySelectorAll(".editor-group")) {
    element.querySelector(".pane-label")?.addEventListener("click", (event) => {
      const group = app.view.get().groups.find((g) => g.id === element.dataset.group);
      if (event.currentTarget.getAttribute("aria-expanded") === "true") { app.closeTabMenu(); return; }
      if (group?.active) app.openViewMenu(group.id, group.active, event.currentTarget);
    });
    element.querySelector(".group-placeholder-button")?.addEventListener("click", () => {
      const group = app.view.get().groups.find((g) => g.id === element.dataset.group);
      if (group?.active) app.activateTab(group.id, group.active);
    });
  }

  return { drawGroups };
}
