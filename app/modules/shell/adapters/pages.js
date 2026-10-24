// Pages in hosts, like a browser's tabs or an IDE's sections: a host is a
// place in the page (step 5 of docs/ARCHITECTURE.md: the areas), and any
// module adds its feature there as a page with its own body. A page never
// knows what other pages share its host. Two kinds of host:
//
//   a tab host ([data-tab-host="side"]: the left window, the side panel, the
//   bottom area, the Settings dialog): Shell draws the strip, shows one page
//   at a time and remembers which (settings.openPages[host]); the open page's
//   toolbar shows in [data-tab-host-toolbar], what its "+" does in
//   [data-tab-host-new], its label in [data-tab-host-title] (a title row,
//   [data-tab-host-header], hidden while a page with its own header is open).
//   A strip's `data-tab-class` names its tabs' look; a
//   host may have several strips (the left window's: the activity bar, and
//   the phone's row at the drawer's top). An icons strip
//   (data-tab-style="icons") draws each page's icon, its label as the tip;
//   pressing the icon of the page showing hides the area (data-tab-toggles).
//   a section host ([data-section-host="explorer"]: under the explorer's tree,
//   in the left window's Explorer page): each page is a collapsible section
//   Shell draws around its body (which carries .sidebar-panel-body), its
//   toolbar in the section's header. Collapsed per section and kept
//   (settings.sidebarPanels); never chosen, they start collapsed on a phone,
//   where they pushed the file tree off screen.
//
//   pages.add({ host, id, label, title?, icon?, order?, body, toolbar?, className?, headerClass?,
//               available?, movable?, ownHeader?, newItem?(), shown?(visible) })
//     icon       an SVG's markup, shown when the page is in the left window
//     movable    false: it stays in its host (the Explorer page)
//     ownHeader  its body draws its own header (the host's title row hides)
//     body       the element holding the page (shown only while it is open)
//     toolbar    shown with it: in its tab host's header while open, or in its section's header
//     newItem    what the host's "+" button does on this page (hidden without one)
//     shown      told when the user switches to it (true) or away (false)
//   pages.show(host, id)   pages.active(host) -> id   pages.badge(host, id, count)
//   pages.available(host, id, available)   a page with nothing to show hides
//   pages.reveal(host, id)   its section expanded and scrolled to
//   pages.open(id)   brought on screen wherever it is: its area shown, its tab
//                    chosen or its section expanded
//   pages.onChange(host, listener(id))
//
// The areas' pages move (step 5k): right-click a tab or a section's header
// for Move to Explorer / Left / Right / Bottom, or drag it onto another area
// (an area's element carries [data-page-drop="<host>"]); the page's body (and
// toolbar) goes to that host as a section or a tab, the area shows it, and
// the choice is kept (settings.pageHosts). Dropped anywhere on the left window
// or its activity bar, a page is one of its tabs. A page shown when its area
// shows is told (shown).
//   pages.move(id, host)   pages.hostOf(id) -> host   pages.areaOf(id) -> "left" | "right" | "bottom"
//   pages.isOpen(id)   the open tab of its host, or a section
//   pages.visible(id)   open, and its area showing (and its section not collapsed)
// areaShown(host) and showArea(host): the frame's, for the area holding a host.
const AREA_HOSTS = { explorer: "Explorer", left: "Left", side: "Right", bottom: "Bottom" };
const AREA_OF_HOST = { explorer: "left", left: "left", side: "right", bottom: "bottom" };

export function createPages({ registry, settings, events = null, isPhone = () => false, areaShown = () => true, showArea = () => {},
  hideArea = () => {}, doc = globalThis.document, win = globalThis.window }) {
  const listeners = new Map(); // host -> Set(listener)
  const places = new Map();    // host -> its elements (looked up once)
  const sections = new Map();  // page key -> its section element
  const unavailable = new Set(); // page keys with nothing to show
  const placed = new Map();      // page key -> the host it is in now (moved, or kept)

  const hostOfPage = (page) => placed.get(page.key) ?? page.host;
  // A page moved in comes after the host's own, in the order they were moved.
  const orderOf = (page) => {
    if (!placed.has(page.key)) return page.order ?? 0;
    return 1000 + Object.keys(settings.pageHosts ?? {}).indexOf(page.id);
  };
  const pagesOf = (host) => registry.all().filter((page) => hostOfPage(page) === host).sort((a, b) => orderOf(a) - orderOf(b));
  const pageById = (id) => registry.all().find((page) => page.id === id && AREA_HOSTS[page.host]) ?? null;
  const shownPagesOf = (host) => pagesOf(host).filter((page) => !unavailable.has(page.key));
  function placeOf(host) {
    if (!places.has(host)) {
      places.set(host, {
        strips: doc ? [...doc.querySelectorAll(`[data-tab-host="${host}"]`)] : [],
        toolbar: doc?.querySelector(`[data-tab-host-toolbar="${host}"]`) ?? null,
        header: doc?.querySelector(`[data-tab-host-header="${host}"]`) ?? null,
        title: doc?.querySelector(`[data-tab-host-title="${host}"]`) ?? null,
        plus: doc?.querySelector(`[data-tab-host-new="${host}"]`) ?? null,
        bodies: doc?.querySelector(`[data-tab-host-pages="${host}"]`) ?? null,
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
  // Whether a host is on screen: its area shown, and the Explorer's sections
  // only while the left window shows the Explorer page.
  const hostShown = (host) => (host === "explorer" ? areaShown("left") && active("left") === "explorer" : areaShown(host));

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
    toggle.draggable = Boolean(AREA_HOSTS[page.host]);
    if (page.body?.id) toggle.setAttribute("aria-controls", page.body.id);
    const caret = doc.createElement("span");
    caret.className = "sidebar-panel-caret";
    caret.setAttribute("aria-hidden", "true");
    const title = doc.createElement("span");
    title.className = "sidebar-panel-title";
    title.textContent = page.label;
    toggle.append(caret, title);
    section.append(toggle);
    sections.set(page.key, section);
    return section;
  }

  // A page's body and toolbar in its section: the toolbar in the header, or,
  // when it holds controls, at the top of the section (no button in a button).
  function fillSection(page) {
    const section = sectionOf(page);
    const toggle = section.querySelector(".sidebar-panel-toggle");
    if (page.toolbar) {
      const controls = page.toolbar.matches("button, a, input, select") || page.toolbar.querySelector("button, a, input, select");
      const home = controls ? section : toggle;
      if (page.toolbar.parentElement !== home) {
        if (controls) toggle.after(page.toolbar);
        else toggle.append(page.toolbar);
      }
      page.toolbar.hidden = false;
    }
    if (page.body && page.body.parentElement !== section) section.append(page.body);
    if (page.body) page.body.hidden = false;
    return section;
  }

  function drawSections(host, container) {
    const pages = pagesOf(host);
    const ids = pages.map((page) => page.id).join(" ");
    if (container.dataset.pages !== ids) {
      container.append(...pages.map(fillSection)); // in order
      // Sections of pages that left this host go.
      for (const section of [...container.querySelectorAll(":scope > .sidebar-panel")]) {
        if (!ids.split(" ").includes(section.dataset.page)) section.remove();
      }
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
    const open = active(host);
    const pages = pagesOf(host);
    for (const strip of place.strips) {
      const ids = pages.map((page) => page.id).join(" ");
      const icons = strip.dataset.tabStyle === "icons";
      if (strip.dataset.pages !== ids) {
        const empty = doc.createElement("span");
        empty.className = "tab-host-empty";
        empty.textContent = "Empty: right-click a tab or a section and choose Move to…";
        strip.replaceChildren(...(pages.length || icons ? [] : [empty]), ...pages.map((page) => {
          const button = doc.createElement("button");
          button.type = "button";
          button.className = strip.dataset.tabClass ?? "chat-tab"; // the host's look
          button.draggable = Boolean(AREA_HOSTS[host]) && page.movable !== false;
          button.setAttribute("role", "tab");
          button.dataset.page = page.id;
          if (icons) {
            // The page's icon (a module's own markup), or its label's first letter.
            if (page.icon) button.innerHTML = page.icon;
            else button.append(Object.assign(doc.createElement("span"), { className: "page-icon-letter", textContent: page.label.slice(0, 1) }));
            button.setAttribute("aria-label", page.label);
            button.title = page.title ?? page.label;
          } else {
            button.textContent = page.label;
            if (page.title) button.title = page.title;
          }
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
      if (page.body && place.bodies && page.body.parentElement !== place.bodies) place.bodies.append(page.body);
      if (page.body && page.body.hidden === visible) page.body.hidden = !visible;
      if (page.toolbar) {
        if (place.toolbar && page.toolbar.parentElement !== place.toolbar) place.toolbar.append(page.toolbar);
        page.toolbar.hidden = !visible;
      }
    }
    const openPage = pages.find((page) => page.id === open);
    if (place.title) place.title.textContent = openPage?.label ?? "";
    if (place.header) place.header.hidden = !openPage || Boolean(openPage.ownHeader);
    if (place.plus) place.plus.hidden = !openPage?.newItem;
  }

  function show(host, id) {
    const previous = active(host);
    if (!shownPagesOf(host).some((page) => page.id === id) || previous === id) return;
    settings.change({ openPages: { ...(settings.openPages ?? {}), [host]: id } }, `open the ${id} page`);
    pagesOf(host).find((page) => page.id === previous)?.shown?.(false);
    // The Explorer page leaving or coming: its sections with it.
    if (host === "left" && previous === "explorer") for (const page of pagesOf("explorer")) page.shown?.(false);
    draw(host);
    pagesOf(host).find((page) => page.id === id)?.shown?.(true);
    if (host === "left" && id === "explorer") for (const page of pagesOf("explorer")) if (visible(page.id)) page.shown?.(true);
    for (const listener of [...(listeners.get(host) ?? [])]) listener(id);
  }

  function badge(host, id, count) {
    const value = count ? String(count) : "";
    const label = pagesOf(host).find((page) => page.id === id)?.label ?? id;
    for (const strip of placeOf(host).strips) {
      const button = strip.querySelector(`[data-page="${id}"]`);
      if (!button || button.dataset.unread === value) continue;
      button.dataset.unread = value;
      button.setAttribute("aria-label", count ? `${label}, ${count} unread` : label);
    }
  }

  function available(host, id, yes) {
    const key = `${host}/${id}`;
    if (unavailable.has(key) === !yes) return;
    if (yes) unavailable.delete(key);
    else unavailable.add(key);
    draw(host);
  }

  // ── Moving a page to another area's host ──
  function move(id, host) {
    const page = pageById(id);
    const from = page ? hostOfPage(page) : null;
    if (!page || !AREA_HOSTS[host] || from === host) return;
    page.shown?.(false);
    // Kept as the last move (so it sorts after those before it), or forgotten back home.
    const others = { ...(settings.pageHosts ?? {}) };
    delete others[page.id];
    if (host === page.host) placed.delete(page.key);
    else placed.set(page.key, host);
    settings.change({ pageHosts: host === page.host ? others : { ...others, [page.id]: host } }, `move the ${page.id} page to the ${host} area`);
    draw(from);
    draw(host);
    // It shows where it went, and its area with it.
    open(page.id);
    if (visible(page.id)) page.shown?.(true);
  }

  // A page brought on screen wherever it is.
  function open(id) {
    const host = hostOf(id);
    if (!host) return;
    if (placeOf(host).sections) reveal(host, id);
    else show(host, id);
    showArea(host);
  }

  const hostOf = (id) => {
    const page = pageById(id);
    return page ? hostOfPage(page) : null;
  };
  const areaOf = (id) => AREA_OF_HOST[hostOf(id)] ?? null;
  function isOpen(id) {
    const host = hostOf(id);
    if (!host || unavailable.has(pageById(id).key)) return false;
    return placeOf(host).sections ? true : active(host) === id;
  }
  function visible(id) {
    const host = hostOf(id);
    return Boolean(host) && isOpen(id) && hostShown(host) && !(placeOf(host).sections && collapsed(id));
  }

  // The menu on a page's tab or section header: Move to….
  let menu = null;
  function closeMenu() {
    if (menu) menu.hidden = true;
  }
  function openMenu(id, x, y) {
    const host = hostOf(id);
    if (!host || !doc || pageById(id)?.movable === false) return;
    if (!menu) {
      menu = doc.createElement("div");
      menu.className = "explorer-context-menu tab-context-menu page-move-menu";
      menu.setAttribute("role", "menu");
      menu.setAttribute("aria-label", "Move the page");
      doc.body.append(menu);
      doc.addEventListener("pointerdown", (event) => { if (!menu.hidden && !menu.contains(event.target)) closeMenu(); }, true);
      doc.addEventListener("keydown", (event) => { if (event.key === "Escape") closeMenu(); });
      win?.addEventListener("resize", closeMenu);
    }
    menu.replaceChildren(...Object.entries(AREA_HOSTS).map(([target, name]) => {
      const button = doc.createElement("button");
      button.type = "button";
      const here = target === host;
      button.setAttribute("role", here ? "menuitemradio" : "menuitem");
      if (here) button.setAttribute("aria-checked", "true");
      button.className = here ? "is-checked" : "";
      button.disabled = here;
      button.dataset.moveTo = target;
      button.textContent = `Move to ${name}`;
      button.addEventListener("click", () => { closeMenu(); move(id, target); });
      return button;
    }));
    menu.style.left = `${x}px`;
    menu.style.top = `${y}px`;
    menu.hidden = false;
    const rect = menu.getBoundingClientRect();
    const margin = 8;
    if (rect.right > (win?.innerWidth ?? Infinity) - margin) menu.style.left = `${Math.max(margin, win.innerWidth - margin - rect.width)}px`;
    if (rect.bottom > (win?.innerHeight ?? Infinity) - margin) menu.style.top = `${Math.max(margin, win.innerHeight - margin - rect.height)}px`;
    menu.querySelector("button:not(:disabled)")?.focus({ preventScroll: true });
  }

  // A section shown: expanded, and scrolled to (the Explorer's: its page shown).
  function reveal(host, id) {
    if (host === "explorer") show("left", "explorer");
    if (collapsed(id)) toggleSection(host, id);
    const page = pagesOf(host).find((entry) => entry.id === id);
    if (page && sections.has(page.key)) sections.get(page.key).scrollIntoView({ block: "nearest" });
  }

  function add(page) {
    const key = `${page.host}/${page.id}`;
    const remove = registry.add({ ...page, key });
    if (page.available === false) unavailable.add(key);
    const kept = settings.pageHosts?.[page.id];
    if (AREA_HOSTS[page.host] && AREA_HOSTS[kept] && kept !== page.host) placed.set(key, kept);
    const host = placed.get(key) ?? page.host;
    // Bind the host the first time it gets a page: a strip's tabs and its
    // "+" button, or a section host's headers.
    for (const target of AREA_HOSTS[page.host] ? Object.keys(AREA_HOSTS) : [page.host]) bindHost(target);
    // Not shown(true) here: a page added while its feature is still being set
    // up must not draw yet; the feature draws when it is ready.
    draw(host);
    return remove;
  }

  // ── Dragging a page onto another area (as Move to… does) ──
  const PAGE_DRAG = "text/stilo-page";
  const clearDropMarks = () => {
    for (const element of doc.querySelectorAll(".is-page-drop")) element.classList.remove("is-page-drop");
  };
  function startDrag(event, id) {
    if (!id || !event.dataTransfer) return;
    event.dataTransfer.setData(PAGE_DRAG, id);
    event.dataTransfer.effectAllowed = "move";
    closeMenu();
  }
  // An area's element takes a dragged page: marked while one is over it, moved there on the drop.
  function bindDrop(zone, host) {
    zone.addEventListener("dragover", (event) => {
      if (!event.dataTransfer?.types.includes(PAGE_DRAG)) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
      zone.classList.add("is-page-drop");
    });
    zone.addEventListener("dragleave", (event) => {
      if (!zone.contains(event.relatedTarget)) zone.classList.remove("is-page-drop");
    });
    zone.addEventListener("drop", (event) => {
      const id = event.dataTransfer?.getData(PAGE_DRAG);
      clearDropMarks();
      if (!id) return;
      event.preventDefault();
      event.stopPropagation();
      move(id, host);
    });
  }

  // A host bound the first time a page could be in it: a strip's tabs (and,
  // in an area, their Move to… menu) and its "+" button, or a section host's
  // headers.
  function bindHost(host) {
    const place = placeOf(host);
    const bindOnce = (element, bind) => {
      if (!element || element.dataset.bound) return;
      element.dataset.bound = "1";
      bind(element);
    };
    const area = Boolean(AREA_HOSTS[host]);
    for (const element of place.strips) bindOnce(element, (strip) => {
      strip.addEventListener("click", (event) => {
        const button = event.target.closest("[data-page]");
        if (!button) return;
        const id = button.dataset.page;
        // The left window's activity bar: an icon shows its page and the window;
        // the page showing, pressed again, hides the window. (A strip inside its
        // area, as the phone's row in the drawer, only shows the page.)
        const toggles = strip.dataset.tabToggles === "area";
        if (toggles && active(host) === id && hostShown(host)) { hideArea(host); return; }
        show(host, id);
        if (toggles) showArea(host);
      });
      if (area) strip.addEventListener("contextmenu", (event) => {
        const button = event.target.closest("[data-page]");
        if (!button) return;
        event.preventDefault();
        event.stopPropagation();
        openMenu(button.dataset.page, event.clientX, event.clientY);
      });
      if (area) strip.addEventListener("dragstart", (event) => startDrag(event, event.target.closest?.("[data-page]")?.dataset.page));
    });
    bindOnce(place.plus, (plus) => plus.addEventListener("click", () => {
      pagesOf(host).find((entry) => entry.id === active(host))?.newItem?.();
    }));
    bindOnce(place.sections, (container) => {
      container.addEventListener("click", (event) => {
        const toggle = event.target.closest(".sidebar-panel-toggle");
        if (toggle?.dataset.panel) toggleSection(host, toggle.dataset.panel);
      });
      container.addEventListener("contextmenu", (event) => {
        const toggle = event.target.closest(".sidebar-panel-toggle");
        if (!toggle?.dataset.panel) return;
        event.preventDefault();
        event.stopPropagation(); // the section's own menu, not the sidebar's (the Explorer's)
        openMenu(toggle.dataset.panel, event.clientX, event.clientY);
      });
      container.addEventListener("dragstart", (event) => startDrag(event, event.target.closest?.(".sidebar-panel-toggle")?.dataset.panel));
    });
    if (area) for (const zone of doc?.querySelectorAll(`[data-page-drop="${host}"]`) ?? []) bindOnce(zone, (element) => bindDrop(element, host));
  }

  // The sections follow their kept state, and the viewport while never chosen.
  const drawSectionHosts = () => {
    for (const [host, place] of places) if (place.sections) draw(host);
  };
  settings.on?.((view, changed) => { if (changed.includes("sidebarPanels")) drawSectionHosts(); });
  doc?.addEventListener("dragend", clearDropMarks);
  events?.on("layout", drawSectionHosts);
  // An area shown: the pages open in it are told (they draw, or load).
  events?.on("area", ({ area, shown }) => {
    if (!shown) return;
    for (const host of Object.keys(AREA_OF_HOST).filter((key) => AREA_OF_HOST[key] === area)) {
      for (const page of pagesOf(host)) if (visible(page.id)) page.shown?.(true);
    }
  });

  return Object.freeze({
    add, show, active, badge, available, reveal, open, move, hostOf, areaOf, isOpen, visible, closeMenu,
    onChange(host, listener) {
      if (!listeners.has(host)) listeners.set(host, new Set());
      listeners.get(host).add(listener);
      return () => listeners.get(host)?.delete(listener);
    }
  });
}
