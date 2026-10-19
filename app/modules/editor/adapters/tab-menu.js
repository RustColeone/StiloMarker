// A tab's menu (right-click on a tab): closing it, the others, those to its
// right or all of them; opening the file as Source or Preview (a tab is a file
// and a view: step 5 of docs/ARCHITECTURE.md; today the two views are the two
// panes, and the other pane shows when it was hidden); copying its path.
// Part of the Editor module: `app` is its shared context (surface.js).
import { getPath } from "../../workspace/index.js";

export function createTabMenu(app) {
  const menu = () => app.elements.tabContextMenu;

  function closeTabMenu() {
    const element = menu();
    if (element && !element.hidden) element.hidden = true;
  }

  const tabsOf = (pane) => (pane === "source" ? app.view.get().sourceOpenTabIds : app.view.get().previewOpenTabIds);
  const closeIn = (pane, fileIds) => {
    for (const fileId of fileIds) (pane === "source" ? app.closeSourceTab : app.closePreviewTab)(fileId);
    app.renderTabs(app.controller.getProject());
  };

  // Shows the file in the other pane, showing that pane when it was hidden.
  function openAs(view, fileId) {
    if (view === "source") app.setActiveSourceFile(fileId);
    else app.setPreviewFile(fileId);
    if (app.settings[view] === "hidden") app.toggleArea(view);
  }

  // entries: [label, run, { checked, disabled }] or null for a separator.
  function draw(entries, x, y) {
    const element = menu();
    if (!element) return;
    element.replaceChildren(...entries.map((entry) => {
      if (!entry) {
        const line = document.createElement("div");
        line.className = "tab-context-separator";
        line.setAttribute("role", "separator");
        return line;
      }
      const [label, run, { checked = false, disabled = false } = {}] = entry;
      const button = document.createElement("button");
      button.type = "button";
      button.setAttribute("role", checked ? "menuitemradio" : "menuitem");
      if (checked) button.setAttribute("aria-checked", "true");
      button.className = checked ? "is-checked" : "";
      button.disabled = disabled;
      button.textContent = label;
      button.addEventListener("click", () => { closeTabMenu(); run(); });
      return button;
    }));
    element.style.left = `${x}px`;
    element.style.top = `${y}px`;
    element.hidden = false;
    // Inside the window.
    const rect = element.getBoundingClientRect();
    const margin = 8;
    if (rect.right > window.innerWidth - margin) element.style.left = `${Math.max(margin, window.innerWidth - margin - rect.width)}px`;
    if (rect.bottom > window.innerHeight - margin) element.style.top = `${Math.max(margin, window.innerHeight - margin - rect.height)}px`;
    element.querySelector("button:not(:disabled)")?.focus({ preventScroll: true });
  }

  // A file's tab.
  function openTabMenu(pane, fileId, x, y) {
    app.closeTabOverflowMenu();
    const project = app.controller.getProject();
    if (project.nodes[fileId]?.kind !== "file") return;
    const tabs = tabsOf(pane);
    const index = tabs.indexOf(fileId);
    const others = tabs.filter((id) => id !== fileId);
    const right = index < 0 ? [] : tabs.slice(index + 1);
    draw([
      ["Close", () => closeIn(pane, [fileId])],
      ["Close Others", () => closeIn(pane, others), { disabled: !others.length }],
      ["Close to the Right", () => closeIn(pane, right), { disabled: !right.length }],
      ["Close All", () => closeIn(pane, [...tabs])],
      null,
      ["Open as Source", () => openAs("source", fileId), { checked: pane === "source", disabled: pane === "source" || !app.canOpenFileInPane(fileId, "source") }],
      ["Open as Preview", () => openAs("preview", fileId), { checked: pane === "preview", disabled: pane === "preview" || !app.canOpenFileInPane(fileId, "preview") }],
      null,
      ["Copy Path", () => void app.copyText(getPath(project, fileId))]
    ], x, y);
  }

  // A tab that is not a file (History's diff): it only closes.
  function openViewTabMenu(close, x, y) {
    app.closeTabOverflowMenu();
    draw([["Close", close]], x, y);
  }

  // A press outside, Escape, or the window changing closes it.
  document.addEventListener("pointerdown", (event) => {
    if (!menu()?.hidden && !menu().contains(event.target)) closeTabMenu();
  }, true);
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !menu()?.hidden) closeTabMenu();
  });
  window.addEventListener("resize", closeTabMenu);

  return { openTabMenu, openViewTabMenu, closeTabMenu };
}
