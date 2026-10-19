// Pages in hosts, like a browser's tabs or an IDE's sections: a host is a
// place in the page (step 5 of docs/ARCHITECTURE.md: the areas), and any
// module adds its feature there as a page with its own body. A page never
// knows what other pages share its host. Two kinds of host:
//
//   a tab host ([data-tab-host="side"]: the side panel, the bottom area, the
//   Settings dialog): Shell draws the strip, shows one page at a time and
//   remembers which (settings.openPages[host]); the open page's toolbar shows
//   in [data-tab-host-toolbar], what its "+" does in [data-tab-host-new].
//   A strip's `data-tab-class` names its tabs' look.
//   a section host ([data-section-host="left"]: the left area, under the
//   explorer): each page is a collapsible section Shell draws around its body
//   (which carries .sidebar-panel-body), its toolbar in the section's header.
//   Collapsed per section and kept (settings.sidebarPanels); never chosen,
//   they start collapsed on a phone, where they pushed the file tree off screen.
//
//   pages.add({ host, id, label, title?, order?, body, toolbar?, className?, headerClass?,
//               available?, newItem?(), shown?(visible) })
//     body       the element holding the page (shown only while it is open)
//     toolbar    shown with it: in its tab host's header while open, or in its section's header
//     newItem    what the host's "+" button does on this page (hidden without one)
//     shown      told when the user switches to it (true) or away (false)
//   pages.show(host, id)   pages.active(host) -> id   pages.badge(host, id, count)
//   pages.available(host, id, available)   a page with nothing to show hides
//   pages.reveal(host, id)   its section expanded and scrolled to
//   pages.onChange(host, listener(id))
export function createPages({ registry, settings, events = null, isPhone = () => false, doc = globalThis.document }) {
  const listeners = new Map(); // host -> Set(listener)
  const places = new Map();    // host -> its elements (looked up once)
  const sections = new Map();  // page key -> its section element
  const unavailable = new Set(); // page keys with nothing to show

  const pagesOf = (host) => registry.all().filter((page) => page.host === host).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const shownPagesOf = (host) => pagesOf(host).filter((page) => !unavailable.has(page.key));
  function placeOf(host) {
    if (!places.has(host)) {
      places.set(host, {
        strip: doc?.querySelector(`[data-tab-host="${host}"]`) ?? null,
        toolbar: doc?.querySelector(`[data-tab-host-toolbar="${host}"]`) ?? null,
        plus: doc?.querySelector(`[data-tab-host-new="${host}"]`) ?? null,
        sections: doc?.querySelector(`[data-section-host="${host}"]`) ?? null
      });
    }
    return places.get(host);
  }

  function active(host) {
    const pages = shownPagesOf(host);
    const remembered = settings.openPages?.[host];
    return (pages.find((page) => page.id === remembered) ?? pages[0])?.id ?? null;
  }

  // ── A section host's sections ──
  function collapsed(id) {
    const stored = settings.sidebarPanels;
    if (stored && typeof stored === "object" && id in stored) return Boolean(stored[id]);
    return isPhone();
  }

  function sectionOf(page) {
    if (sections.has(page.key)) return sections.get(page.key);
    const section = doc.createElement("section");
    section.className = `sidebar-panel ${page.className ?? ""}`.trim();
    section.dataset.page = page.id;
    section.setAttribute("aria-label", page.title ?? page.label);
    const toggle = doc.createElement("button");
    toggle.type = "button";
    toggle.className = `sidebar-panel-header sidebar-panel-toggle ${page.headerClass ?? ""}`.trim();
    toggle.dataset.panel = page.id;
    if (page.body?.id) toggle.setAttribute("aria-controls", page.body.id);
    const caret = doc.createElement("span");
    caret.className = "sidebar-panel-caret";
    caret.setAttribute("aria-hidden", "true");
    const title = doc.createElement("span");
    title.className = "sidebar-panel-title";
    title.textContent = page.label;
    toggle.append(caret, title);
    if (page.toolbar) toggle.append(page.toolbar);
    section.append(toggle);
    if (page.body) section.append(page.body);
    sections.set(page.key, section);
    return section;
  }

  function drawSections(host, container) {
    const pages = pagesOf(host);
    const ids = pages.map((page) => page.id).join(" ");
    if (container.dataset.pages !== ids) {
      container.append(...pages.map(sectionOf)); // in order
      container.dataset.pages = ids;
    }
    for (const page of pages) {
      const section = sectionOf(page);
      section.hidden = unavailable.has(page.key);
      const shut = collapsed(page.id);
      section.dataset.collapsed = String(shut);
      section.querySelector(".sidebar-panel-toggle")?.setAttribute("aria-expanded", String(!shut));
    }
  }

  function toggleSection(host, id) {
    const ids = pagesOf(host).map((page) => page.id);
    if (!ids.includes(id)) return;
    // All written the first time, so flipping one doesn't leave the others
    // following the viewport and collapsing again on the next resize.
    const next = { ...(settings.sidebarPanels ?? {}) };
    for (const key of ids) if (!(key in next)) next[key] = collapsed(key);
    next[id] = !next[id];
    settings.change({ sidebarPanels: next }, `${id} section ${next[id] ? "collapsed" : "expanded"}`);
  }

  // ── Drawing a host ──
  // A tab host: its tab buttons, which page is open, its toolbar, the "+" button.
  function draw(host) {
    const place = placeOf(host);
    if (place.sections) {
      drawSections(host, place.sections);
      return;
    }
    const { strip } = place;
    const open = active(host);
    const pages = pagesOf(host);
    if (strip) {
      const ids = pages.map((page) => page.id).join(" ");
      if (strip.dataset.pages !== ids) {
        strip.replaceChildren(...pages.map((page) => {
          const button = doc.createElement("button");
          button.type = "button";
          button.className = strip.dataset.tabClass ?? "chat-tab"; // the host's look
          button.setAttribute("role", "tab");
          button.dataset.page = page.id;
          button.textContent = page.label;
          if (page.title) button.title = page.title;
          return button;
        }));
        strip.dataset.pages = ids;
      }
      for (const button of strip.querySelectorAll("[data-page]")) {
        button.setAttribute("aria-selected", String(button.dataset.page === open));
        button.hidden = unavailable.has(`${host}/${button.dataset.page}`);
      }
    }
    for (const page of pages) {
      const visible = page.id === open;
      if (page.body && page.body.hidden === visible) page.body.hidden = !visible;
      if (page.toolbar) {
        if (place.toolbar && page.toolbar.parentElement !== place.toolbar) place.toolbar.append(page.toolbar);
        page.toolbar.hidden = !visible;
      }
    }
    if (place.plus) place.plus.hidden = !pages.find((page) => page.id === open)?.newItem;
  }

  function show(host, id) {
    const previous = active(host);
    if (!shownPagesOf(host).some((page) => page.id === id) || previous === id) return;
    settings.change({ openPages: { ...(settings.openPages ?? {}), [host]: id } }, `open the ${id} page`);
    pagesOf(host).find((page) => page.id === previous)?.shown?.(false);
    draw(host);
    pagesOf(host).find((page) => page.id === id)?.shown?.(true);
    for (const listener of [...(listeners.get(host) ?? [])]) listener(id);
  }

  function badge(host, id, count) {
    const button = placeOf(host).strip?.querySelector(`[data-page="${id}"]`);
    const value = count ? String(count) : "";
    if (!button || button.dataset.unread === value) return;
    button.dataset.unread = value;
    const label = pagesOf(host).find((page) => page.id === id)?.label ?? id;
    button.setAttribute("aria-label", count ? `${label}, ${count} unread` : label);
  }

  function available(host, id, yes) {
    const key = `${host}/${id}`;
    if (unavailable.has(key) === !yes) return;
    if (yes) unavailable.delete(key);
    else unavailable.add(key);
    draw(host);
  }

  // A section shown: expanded, and scrolled to.
  function reveal(host, id) {
    if (collapsed(id)) toggleSection(host, id);
    const page = pagesOf(host).find((entry) => entry.id === id);
    if (page && sections.has(page.key)) sections.get(page.key).scrollIntoView({ block: "nearest" });
  }

  function add(page) {
    const remove = registry.add({ ...page, key: `${page.host}/${page.id}` });
    if (page.available === false) unavailable.add(`${page.host}/${page.id}`);
    // Bind the host the first time it gets a page: a strip's tabs and its
    // "+" button, or a section host's headers.
    const place = placeOf(page.host);
    const bindOnce = (element, bind) => {
      if (!element || element.dataset.bound) return;
      element.dataset.bound = "1";
      bind(element);
    };
    bindOnce(place.strip, (strip) => strip.addEventListener("click", (event) => {
      const button = event.target.closest("[data-page]");
      if (button) show(page.host, button.dataset.page);
    }));
    bindOnce(place.plus, (plus) => plus.addEventListener("click", () => {
      pagesOf(page.host).find((entry) => entry.id === active(page.host))?.newItem?.();
    }));
    bindOnce(place.sections, (container) => container.addEventListener("click", (event) => {
      const toggle = event.target.closest(".sidebar-panel-toggle");
      if (toggle?.dataset.panel) toggleSection(page.host, toggle.dataset.panel);
    }));
    // Not shown(true) here: a page added while its feature is still being set
    // up must not draw yet; the feature draws when it is ready.
    draw(page.host);
    return remove;
  }

  // The sections follow their kept state, and the viewport while never chosen.
  const drawSectionHosts = () => {
    for (const [host, place] of places) if (place.sections) draw(host);
  };
  settings.on?.((view, changed) => { if (changed.includes("sidebarPanels")) drawSectionHosts(); });
  events?.on("layout", drawSectionHosts);

  return Object.freeze({
    add, show, active, badge, available, reveal,
    onChange(host, listener) {
      if (!listeners.has(host)) listeners.set(host, new Set());
      listeners.get(host).add(listener);
      return () => listeners.get(host)?.delete(listener);
    }
  });
}
