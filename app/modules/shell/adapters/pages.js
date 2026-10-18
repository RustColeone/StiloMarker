// Pages in tab hosts, like a browser's tabs: a host is a place in the page
// with a tab strip (`[data-tab-host="side"]`), and any module adds its feature
// there as a page with its own body. Shell draws the strip, shows one page at
// a time and remembers which (settings.openPages[host]); a page never knows
// what other pages share its host.
//
//   pages.add({ host, id, label, title?, order?, body, newItem?(), shown?(visible) })
//     body       the element holding the page (shown only while it is open)
//     newItem    what the host's "+" button does on this page (hidden without one)
//     shown      told when the user switches to it (true) or away (false)
//   pages.show(host, id)   pages.active(host) -> id   pages.badge(host, id, count)
//   pages.onChange(host, listener(id))
export function createPages({ registry, settings, doc = globalThis.document }) {
  const listeners = new Map(); // host -> Set(listener)
  const strips = new Map();    // host -> the strip element (looked up once)

  const pagesOf = (host) => registry.all().filter((page) => page.host === host).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const stripOf = (host) => {
    if (!strips.has(host)) strips.set(host, doc?.querySelector(`[data-tab-host="${host}"]`) ?? null);
    return strips.get(host);
  };
  const newButtonOf = (host) => doc?.querySelector(`[data-tab-host-new="${host}"]`) ?? null;

  function active(host) {
    const pages = pagesOf(host);
    const remembered = settings.openPages?.[host];
    return (pages.find((page) => page.id === remembered) ?? pages[0])?.id ?? null;
  }

  // Draws the host: its tab buttons, which page is open, the "+" button.
  function draw(host) {
    const strip = stripOf(host);
    const open = active(host);
    const pages = pagesOf(host);
    if (strip) {
      const ids = pages.map((page) => page.id).join(" ");
      if (strip.dataset.pages !== ids) {
        strip.replaceChildren(...pages.map((page) => {
          const button = doc.createElement("button");
          button.type = "button";
          button.className = "chat-tab";
          button.setAttribute("role", "tab");
          button.dataset.page = page.id;
          button.textContent = page.label;
          if (page.title) button.title = page.title;
          return button;
        }));
        strip.dataset.pages = ids;
      }
      for (const button of strip.querySelectorAll("[data-page]")) button.setAttribute("aria-selected", String(button.dataset.page === open));
    }
    for (const page of pages) {
      const visible = page.id === open;
      if (page.body && page.body.hidden === visible) page.body.hidden = !visible;
    }
    const plus = newButtonOf(host);
    if (plus) plus.hidden = !pages.find((page) => page.id === open)?.newItem;
  }

  function show(host, id) {
    const previous = active(host);
    if (!pagesOf(host).some((page) => page.id === id) || previous === id) return;
    settings.change({ openPages: { ...(settings.openPages ?? {}), [host]: id } }, `open the ${id} page`);
    pagesOf(host).find((page) => page.id === previous)?.shown?.(false);
    draw(host);
    pagesOf(host).find((page) => page.id === id)?.shown?.(true);
    for (const listener of [...(listeners.get(host) ?? [])]) listener(id);
  }

  function badge(host, id, count) {
    const button = stripOf(host)?.querySelector(`[data-page="${id}"]`);
    const value = count ? String(count) : "";
    if (!button || button.dataset.unread === value) return;
    button.dataset.unread = value;
    const label = pagesOf(host).find((page) => page.id === id)?.label ?? id;
    button.setAttribute("aria-label", count ? `${label}, ${count} unread` : label);
  }

  function add(page) {
    const remove = registry.add({ ...page, key: `${page.host}/${page.id}` });
    // Bind the host's strip and "+" button the first time it gets a page.
    const strip = stripOf(page.host);
    if (strip && !strip.dataset.bound) {
      strip.dataset.bound = "1";
      strip.addEventListener("click", (event) => {
        const button = event.target.closest("[data-page]");
        if (button) show(page.host, button.dataset.page);
      });
      newButtonOf(page.host)?.addEventListener("click", () => {
        pagesOf(page.host).find((entry) => entry.id === active(page.host))?.newItem?.();
      });
    }
    // Not shown(true) here: a page added while its feature is still being set
    // up must not draw yet; the feature draws when it is ready.
    draw(page.host);
    return remove;
  }

  return Object.freeze({
    add, show, active, badge,
    onChange(host, listener) {
      if (!listeners.has(host)) listeners.set(host, new Set());
      listeners.get(host).add(listener);
      return () => listeners.get(host)?.delete(listener);
    }
  });
}
