// Which command goes in which menu, in which order. Pure, so the menu bar's
// contents can be tested without a page.
//
// menus:    [{ id, label, order }]
// commands: [{ id, title (text, or a function giving it), menu?: { id, group = 0, order = 0 }, danger?, keys? }]
// returns:  [{ id, label, items: [{ id, title, danger, group, keys }] }] in menu order
//           (a menu draws a line between groups, and an item's first shortcut);
//           commands that name an unknown menu are left out.

const titleOf = (command) => (typeof command.title === "function" ? String(command.title()) : command.title);

export function layoutMenus(menus, commands) {
  const sortedMenus = [...menus].sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.id.localeCompare(b.id));
  return sortedMenus.map((menu) => ({
    id: menu.id,
    label: menu.label,
    items: commands
      .filter((command) => command.menu?.id === menu.id)
      .sort((a, b) => (a.menu.group ?? 0) - (b.menu.group ?? 0)
        || (a.menu.order ?? 0) - (b.menu.order ?? 0)
        || titleOf(a).localeCompare(titleOf(b)))
      .map((command) => ({ id: command.id, title: titleOf(command), danger: Boolean(command.danger),
        group: command.menu.group ?? 0, keys: command.keys?.[0] ?? "" }))
  }));
}
