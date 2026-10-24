// The frame around the editor (Shell's): the areas and what shows in them on
// the desktop (areas.js) and on the phone (phone.js).
//
//   frame.toggle(area)        "left" | "right" | "bottom" | "source" | "preview"
//   frame.shown(area)         on the phone, whether its drawer is open (right, bottom)
//   frame.isPhone()  frame.revealSection(id)  frame.apply()
//   frame.phonePanes.add({ id, order, element(), caption(), fileId(), shown?() })
//   frame.phoneView()  frame.showPane(id)  frame.setExplorerOpen(open)
//   events: "area" { area, shown, phone? }, "resized" { by }, "layout"
import { createAreas } from "./areas.js";
import { createPhone } from "./phone.js";

export function createFrame({ settings, events, registry, pages, commands, run, closeMenus, openSettings, log }) {
  const areas = createAreas({ settings, events, pages, log });
  const panes = { add: registry.add, all: registry.all };
  const phone = createPhone({ panes, isPhone: areas.isPhone, closeMenus, events, run });
  areas.usePhone(phone);

  const toggleLog = () => areas.toggle("bottom");
  commands.add({ id: "shell.toggle-explorer", title: "Toggle the Left Window", menu: { id: "view", group: 0, order: 1 }, run: () => areas.toggle("left") });
  commands.add({ id: "shell.toggle-log", title: "Toggle Log", menu: { id: "view", group: 0, order: 5 }, run: toggleLog });
  commands.add({ id: "shell.open-settings", title: "Open Settings", menu: { id: "settings", group: 0, order: 1 }, run: () => openSettings("appearance") });
  commands.add({ id: "shell.log-panel", title: () => (areas.shown("bottom") ? "Hide Log Panel" : "Show Log Panel"), menu: { id: "settings", group: 0, order: 2 }, run: toggleLog });
  // The status bar's collaborators (Sync's) reveal the Session section.
  commands.add({ id: "layout.show-session", title: "Show the Session Panel", run: () => areas.revealSection("session") });
  document.getElementById("settings-button")?.addEventListener("click", () => openSettings("appearance"));

  return Object.freeze({
    toggle: areas.toggle, shown: areas.shown, isPhone: areas.isPhone, revealSection: areas.revealSection,
    apply: areas.apply, setExplorerAnchor: areas.setExplorerAnchor,
    phonePanes: { add(pane) { const remove = registry.add(pane); phone.applyView(); return remove; } },
    phoneView: phone.view, showPane: phone.selectPane, setExplorerOpen: phone.setExplorerOpen,
    redrawCaption: phone.renderCaption
  });
}
