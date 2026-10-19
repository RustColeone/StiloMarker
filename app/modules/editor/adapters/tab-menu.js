// A tab's menu (right-click on a tab): closing it, the others in its group,
// those to its right or all of them; opening the file as Source or Preview in
// the same group (a tab is a file in a view: step 5 of docs/ARCHITECTURE.md);
// copying its path.
// Part of the Editor module: `app` is its shared context (surface.js).
import { getPath } from "../../workspace/index.js";
import { sameTab } from "../service/view.js";

export function createTabMenu(app) {
  const menu = () => app.elements.tabContextMenu;

  function closeTabMenu() {
    const element = menu();
    if (element && !element.hidden) element.hidden = true;
  }

  const tabsOf = (group) => app.view.get().groups.find((g) => g.id === group)?.tabs ?? [];
  const closeIn = (group, tabs) => {
    for (const tab of tabs) app.closeTab(group, tab);
    app.renderTabs(app.controller.getProject());
  };

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

  // A file's tab ({ fileId, view }) in a group. Open as: the file in the
  // other view, in the same group (its body moves here).
  function openTabMenu(group, tab, x, y) {
    app.closeTabOverflowMenu();
    const project = app.controller.getProject();
    if (project.nodes[tab.fileId]?.kind !== "file") return;
    const tabs = tabsOf(group);
    const index = tabs.findIndex((t) => sameTab(t, tab));
    const others = tabs.filter((t) => !sameTab(t, tab));
    const right = index < 0 ? [] : tabs.slice(index + 1);
    const openAs = (view) => [`Open as ${view === "source" ? "Source" : "Preview"}`, () => app.activateTab(group, { fileId: tab.fileId, view }),
      { checked: tab.view === view, disabled: tab.view === view || !app.canOpenFileInPane(tab.fileId, view) }];
    draw([
      ["Close", () => closeIn(group, [tab])],
      ["Close Others", () => closeIn(group, others), { disabled: !others.length }],
      ["Close to the Right", () => closeIn(group, right), { disabled: !right.length }],
      ["Close All", () => closeIn(group, [...tabs])],
      null,
      openAs("source"),
      openAs("preview"),
      null,
      ["Copy Path", () => void app.copyText(getPath(project, tab.fileId))]
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
