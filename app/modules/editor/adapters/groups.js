// The editor's groups on the page (step 5 of docs/ARCHITECTURE.md): the two
// panes are the groups ("left" is #source-pane and "right" #preview-pane,
// named for today's layout), each with its tab strip. The source body and the
// preview body go to the group the view says holds them (its hosts); a group
// shows the body its active tab wants, or, when the other group holds that
// body, a placeholder with Show here. Each group's label names the view it
// shows. Drawn on every render (surface.js); on the phone the groups draw
// nothing of their own (the CSS), so the views show as before.
// Part of the Editor: `app` is its shared context (surface.js).
import { getPath } from "../../workspace/index.js";

const VIEWS = { source: "Source", preview: "Preview" };

export function createGroups(app) {
  const groupElement = (id) => document.querySelector(`.editor-group[data-group="${id}"]`);
  const bodyOf = (view) => (view === "source" ? app.elements.sourceBody : app.elements.previewBody);

  // The name a placeholder gives its tab: the file's, or a pane view's (History's diff).
  function nameOf(project, tab) {
    const paneView = app.paneViews.get(tab.fileId);
    if (paneView) return paneView.tab()?.label ?? "";
    return project.nodes[tab.fileId]?.name ?? "";
  }

  function drawGroups(project) {
    const state = app.view.get();
    for (const view of Object.keys(VIEWS)) {
      const home = groupElement(state.hosts[view]);
      const body = bodyOf(view);
      if (home && body && body.parentElement !== home) home.append(body);
    }
    for (const group of state.groups) {
      const element = groupElement(group.id);
      if (!element) continue;
      const held = Object.keys(VIEWS).filter((view) => state.hosts[view] === group.id);
      const wants = group.active?.view ?? held[0] ?? null;
      const holds = held.includes(wants);
      for (const view of held) bodyOf(view).dataset.shown = String(holds && view === wants);
      element.dataset.view = wants ?? "";
      const label = element.querySelector(".pane-label");
      if (label && wants) label.textContent = VIEWS[wants];
      const placeholder = element.querySelector(".group-placeholder");
      if (!placeholder) continue;
      placeholder.hidden = holds || !group.active;
      if (!placeholder.hidden) {
        const text = placeholder.querySelector(".group-placeholder-text");
        text.textContent = `${nameOf(project, group.active)} is open as ${VIEWS[wants]} in the other group.`;
        text.title = project.nodes[group.active.fileId] ? getPath(project, group.active.fileId) : "";
      }
    }
  }

  // Show here: the group's active tab takes its body back.
  for (const element of document.querySelectorAll(".editor-group")) {
    element.querySelector(".group-placeholder-button")?.addEventListener("click", () => {
      const group = app.view.get().groups.find((g) => g.id === element.dataset.group);
      if (group?.active) app.activateTab(group.id, group.active);
    });
  }

  return { drawGroups };
}
