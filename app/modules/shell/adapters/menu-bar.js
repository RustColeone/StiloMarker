// Draws the menu bar from the registered menus and commands, in the markup
// the styles (desktop and the phone's ⋮ panel) expect:
//   .menu-group > button.menu-trigger + div.menu-popover > button[data-command]
import { layoutMenus } from "../model/menu-layout.js";

export function createMenuBar({ root, commands, menus, run, report, doc = document }) {
  let groups = [];

  function render() {
    root.replaceChildren();
    groups = [];
    for (const menu of layoutMenus(menus.all(), commands.all())) {
      if (!menu.items.length) continue;
      const group = doc.createElement("div");
      group.className = "menu-group";
      const trigger = doc.createElement("button");
      trigger.type = "button";
      trigger.className = "menu-trigger";
      trigger.id = `${menu.id}-menu-button`;
      trigger.textContent = menu.label;
      const popover = doc.createElement("div");
      popover.id = `${menu.id}-menu`;
      popover.className = "menu-popover";
      popover.hidden = true;
      for (const item of menu.items) {
        const button = doc.createElement("button");
        button.type = "button";
        button.dataset.command = item.id;
        if (item.danger) button.className = "menu-danger-button";
        button.textContent = item.title;
        popover.append(button);
      }
      group.append(trigger, popover);
      root.append(group);
      groups.push({ trigger, popover });
    }
  }

  function close() {
    for (const { trigger, popover } of groups) {
      trigger.classList.remove("is-open");
      popover.hidden = true;
    }
  }

  root.addEventListener("click", (event) => {
    const trigger = event.target.closest(".menu-trigger");
    if (trigger) {
      event.stopPropagation();
      const id = trigger.id;
      const open = groups.find((g) => g.trigger === trigger)?.popover.hidden;
      close();
      if (!open) return;
      render(); // titles may depend on the moment ("Show Chat" / "Hide Chat")
      const group = groups.find((g) => g.trigger.id === id);
      group?.trigger.classList.add("is-open");
      if (group) group.popover.hidden = false;
      return;
    }
    const item = event.target.closest("[data-command]");
    if (item) {
      close();
      run(item.dataset.command).catch(report);
    }
  });
  doc.addEventListener("click", (event) => {
    if (!event.target.closest?.(".menu-group")) close();
  });

  // Re-draw when a module adds or removes a menu or a command with a menu.
  let scheduled = false;
  const schedule = () => {
    if (scheduled) return;
    scheduled = true;
    queueMicrotask(() => { scheduled = false; render(); });
  };
  commands.onChange(schedule);
  menus.onChange(schedule);
  render();

  return { close, render };
}
