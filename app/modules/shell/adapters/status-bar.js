// The status bar along the bottom of the page (an extension point): any module
// adds an item and keeps it up to date; Shell places the items in order.
//
//   statusBar.add({ id, order, title?, action?(), dot?, grow?, hidden? })
//     -> { set({ text?, tone?, title?, hidden? }), element, extra }
//   id        the item is #status-<id>-item, its text #status-<id>-text
//   action    makes the item a button that runs it
//   dot       a coloured dot before the text; tone "success" | "warning" | "danger" | null
//   extra     an element before the text the owner may fill (e.g. people's dots)
export function createStatusBar({ registry, doc = globalThis.document }) {
  const bar = doc?.querySelector(".status-bar");
  const items = new Map(); // id -> { element }

  function place() {
    if (!bar) return;
    const ordered = registry.all().sort((a, b) => (a.order ?? 0) - (b.order ?? 0)).map((item) => items.get(item.id)?.element).filter(Boolean);
    bar.replaceChildren(...ordered);
  }

  function add(item) {
    const element = doc.createElement(item.action ? "button" : "div");
    element.id = `status-${item.id}-item`;
    element.className = `status-item${item.action ? " status-item-action" : ""}${item.grow ? " status-item-grow" : ""}${item.className ? ` ${item.className}` : ""}`;
    if (item.action) {
      element.type = "button";
      element.addEventListener("click", () => item.action());
    }
    if (item.title) element.title = item.title;
    element.hidden = Boolean(item.hidden);
    const dot = item.dot ? doc.createElement("span") : null;
    if (dot) dot.className = "status-dot";
    const extra = item.extra ? doc.createElement("span") : null;
    if (extra) Object.assign(extra, item.extra);
    const text = doc.createElement("span");
    text.id = `status-${item.id}-text`;
    text.textContent = item.text ?? "";
    element.append(...[dot, extra, text].filter(Boolean));
    items.set(item.id, { element });
    registry.add(item);
    place();
    return Object.freeze({
      element,
      extra,
      set({ text: value, tone, title, hidden } = {}) {
        if (value !== undefined && text.textContent !== value) text.textContent = value;
        if (tone !== undefined && dot) {
          dot.classList.remove("is-success", "is-warning", "is-danger");
          if (tone) dot.classList.add(`is-${tone}`);
        }
        if (title !== undefined) element.title = title;
        if (hidden !== undefined) element.hidden = hidden;
      }
    });
  }

  return Object.freeze({ add });
}
