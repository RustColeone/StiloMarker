// The phone layout (Shell's frame): one pane at a time in the middle slot; the
// explorer as a drawer from the left edge; the ⋮ menu. The panes are their
// owners' (panes.add: the Editor's source and preview, the Assistant's chat),
// each with the file it shows. The top bar names that file; its name opens the
// list of open files (and Rename), and one switch shows the same file in its
// other view (Source ↔ Preview), hidden when the file has only one. Swiping
// changes panes too, and the file follows. Inert on the desktop, where the
// phone CSS does not apply, but the buttons' state stays right everywhere.

// The phone viewport's height as --mobile-viewport-height (the keyboard shrinks
// it); none on a wider screen or when zoomed. Returns the update, for tests.
export function installMobileViewport(window, element, maxWidth = 900) {
  const update = () => {
    const viewport = window.visualViewport;
    if (!window.matchMedia(`(max-width: ${maxWidth}px)`).matches || !viewport || viewport.scale !== 1) {
      element.style.removeProperty("--mobile-viewport-height");
      return;
    }
    element.style.setProperty("--mobile-viewport-height", `${viewport.height}px`);
  };
  window.visualViewport?.addEventListener("resize", update);
  window.addEventListener("resize", update);
  update();
  return update;
}

// Touch-gesture tuning.
const EDGE_ZONE = 24;            // px from the left edge that opens the drawer
const SLOP = 10;                 // px before a gesture is claimed at all
const DIRECTION_BIAS = 1.3;      // |dx| must exceed |dy| by this much
const SNAP_FRACTION = 0.35;      // past this share of travel, snap onward
const FLICK_VELOCITY = 0.45;     // px/ms that snaps regardless of distance

// panes: { add, all } of { id, order, element(), caption() -> text, fileId() -> id | null,
//   shown?({ fileId })  it came on screen; fileId: the file the previous pane showed (to show too, if it can)
//   alternate?          the pane showing the same file another way (Source ↔ Preview)
//   canShow?(fileId)    whether it can show that file
//   files?() -> [{ id, name }]   the open files    open?(fileId)   show that one }
// isPhone(): the phone layout applies; showsRight(element): the pane on screen
// (null on the desktop), so the right area shows when that pane is in it.
export function createPhone({ panes, isPhone, closeMenus, events, run, showsRight, doc = globalThis.document, win = globalThis.window }) {
  const $ = (id) => doc.getElementById(id);
  const appEl = $("app");
  const explorerPanel = $("explorer-panel");
  const menuBar = doc.querySelector(".menu-bar");
  const explorerButton = $("mobile-explorer-button"), menuButton = $("mobile-menu-button");
  const caption = $("mobile-pane-caption"), fileButton = $("mobile-file-button"), fileList = $("mobile-file-list");
  const viewToggle = $("mobile-view-toggle");
  let view = "source";
  let lastFilePane = "source"; // the file pane to go back to from one without files (chat)
  let gesture = null, drawerWidth = 1, paneDrag = null;

  const ordered = () => panes.all().sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const paneOf = (id) => panes.all().find((pane) => pane.id === id) ?? null;
  const buttons = () => [...doc.querySelectorAll("[data-pane]")];

  // ── The pane showing ──
  function applyView() {
    appEl.dataset.mobileView = view;
    showsRight(isPhone() ? paneOf(view)?.element() : null);
    renderButtons(view);
    renderCaption();
  }

  // Highlight = "this is the pane you are looking at". Takes the view
  // explicitly so a committed swipe can light the target up as it slides in.
  function renderButtons(next) {
    for (const button of buttons()) {
      const active = button.dataset.pane === next;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", String(active));
    }
  }

  // The pane the switch goes to: the file's other view, or (from a pane with no
  // file of its own, the chat) back to the last file pane. None when the file
  // there could not be shown (a file with one view).
  function switchTarget() {
    const pane = paneOf(view);
    const target = paneOf(pane?.alternate ?? (pane?.files ? null : lastFilePane));
    if (!target || target === pane) return null;
    const fileId = pane?.fileId();
    return fileId && target.canShow && !target.canShow(fileId) ? null : target;
  }

  // The top bar: the file on screen (its name opens the list of open files),
  // and the switch to its other view, showing that view's icon.
  function renderCaption() {
    const pane = paneOf(view);
    if (caption) caption.textContent = pane?.caption() ?? "";
    const target = switchTarget();
    if (viewToggle) {
      viewToggle.hidden = !target;
      if (target) {
        viewToggle.dataset.target = target.id;
        const label = `Show ${target.id}`;
        viewToggle.setAttribute("aria-label", label);
        viewToggle.title = label;
      }
    }
  }

  function setView(next) {
    cancelGesture();
    setFileListOpen(false);
    const fileId = paneOf(view)?.fileId() ?? null; // the file the outgoing pane showed
    view = next;
    if (paneOf(next)?.files) lastFilePane = next;
    applyView();
    paneOf(next)?.shown?.({ fileId });
    events.emit("area", { area: next, shown: true, phone: true });
  }

  // ── The list of open files (from the file name) ──
  function filePane() {
    return paneOf(view)?.files ? paneOf(view) : paneOf(lastFilePane);
  }

  function setFileListOpen(open) {
    if (!fileList) return;
    if (open) {
      setMenuOpen(false);
      setExplorerOpen(false);
      drawFileList();
    }
    fileList.hidden = !open;
    fileButton?.setAttribute("aria-expanded", String(open));
  }

  function drawFileList() {
    const pane = filePane();
    const current = paneOf(view)?.fileId() ?? null;
    const item = (label, action, { checked = false, className = "" } = {}) => {
      const button = doc.createElement("button");
      button.type = "button";
      button.setAttribute("role", checked ? "menuitemradio" : "menuitem");
      if (checked) button.setAttribute("aria-checked", "true");
      button.className = `mobile-file-item ${className}`.trim();
      button.textContent = label;
      button.addEventListener("click", () => { setFileListOpen(false); action(); });
      return button;
    };
    const items = [];
    if (current) items.push(item("Rename…", () => void run("explorer.rename-file", current), { className: "is-action" }));
    for (const file of pane?.files?.() ?? []) items.push(item(file.name, () => showFile(file.id), { checked: file.id === current }));
    if (!items.length) items.push(item("No open files", () => {}, { className: "is-empty" }));
    fileList.replaceChildren(...items);
  }

  // A file chosen from the list: shown in this view if it can be, else in its other.
  function showFile(fileId) {
    const pane = filePane();
    const target = pane?.canShow && !pane.canShow(fileId) ? paneOf(pane.alternate) : pane;
    if (!target?.open) return;
    target.open(fileId);
    if (target.id !== view) setView(target.id);
    else renderCaption();
  }

  // Each button selects its own pane; the one already showing stays.
  function selectPane(next) {
    if (!paneOf(next)) return;
    if (next === view) { cancelGesture(); return; }
    setView(next);
  }

  // ── Drawer (the explorer) and the ⋮ menu ──
  function setDrawerProgress(progress) {
    appEl.style.setProperty("--drawer-progress", String(Math.min(1, Math.max(0, progress))));
  }

  function setExplorerOpen(open) {
    cancelGesture();
    if (open) { setMenuOpen(false); setFileListOpen(false); }
    appEl.dataset.mobileExplorer = open ? "open" : "closed";
    explorerButton?.classList.toggle("is-active", open);
    explorerButton?.setAttribute("aria-expanded", String(open));
    setDrawerProgress(open ? 1 : 0);
  }

  function setMenuOpen(open) {
    cancelGesture();
    if (open) { setExplorerOpen(false); setFileListOpen(false); }
    appEl.dataset.mobileMenu = open ? "open" : "closed";
    menuButton?.classList.toggle("is-active", open);
    menuButton?.setAttribute("aria-expanded", String(open));
    if (!open) closeMenus();
  }

  // ── Gestures: one dispatcher owns every horizontal drag, so the drawer and
  // the pane carousel never fight over a finger. Open drawer → drag closes it;
  // a touch at the left edge → drag opens it; otherwise → drag switches panes.
  // Nothing is claimed until the finger moved SLOP px, clearly sideways.
  function claimsHorizontalScroll(target) {
    let node = target;
    while (node && node !== doc.body) {
      if (node.nodeType === 1) {
        if (node.closest?.(".tab-strip, input[type='range'], .cm-editor")) return true;
        const style = win.getComputedStyle(node);
        if (/(auto|scroll)/.test(style.overflowX) && node.scrollWidth > node.clientWidth + 1) return true;
      }
      node = node.parentNode;
    }
    return false;
  }

  function onGestureStart(event) {
    if (event.touches.length !== 1) { cancelGesture(); return; }
    if (!isPhone() || paneDrag) return;
    gesture = null;
    // Editing, canvases, menus and horizontal content own their drags (checked
    // before the edge gesture too, so a table at the left edge can scroll).
    if (event.target.closest?.("dialog, .menu-bar, .explorer-context-menu, .tab-overflow-menu, input, textarea, select, button, a, [contenteditable], .bmap-editor, .cm-editor")) return;
    if (claimsHorizontalScroll(event.target) || win.getSelection()?.isCollapsed === false) return;
    const touch = event.touches[0];
    const drawerOpen = appEl.dataset.mobileExplorer === "open";
    gesture = { startX: touch.clientX, startY: touch.clientY, lastX: touch.clientX, lastT: event.timeStamp, velocity: 0,
      kind: null, claimed: false, drawerOpen, fromEdge: touch.clientX <= EDGE_ZONE, allowPane: !drawerOpen };
  }

  function onGestureMove(event) {
    if (event.touches.length !== 1) { cancelGesture(); return; }
    if (!gesture) return;
    const touch = event.touches[0];
    const dx = touch.clientX - gesture.startX;
    const dy = touch.clientY - gesture.startY;
    if (!gesture.claimed) {
      if (Math.abs(dx) < SLOP || Math.abs(dx) < Math.abs(dy) * DIRECTION_BIAS) {
        // Not decisive yet; once it is clearly a scroll, stop looking.
        if (Math.abs(dy) > SLOP * 2) gesture = null;
        return;
      }
      if (gesture.drawerOpen && dx < 0) gesture.kind = "drawer";
      else if (!gesture.drawerOpen && gesture.fromEdge && dx > 0) gesture.kind = "drawer";
      else if (gesture.allowPane) gesture.kind = "pane";
      if (!gesture.kind) { gesture = null; return; }
      gesture.claimed = true;
      if (gesture.kind === "drawer") beginDrawerDrag();
      else if (!beginPaneDrag(dx)) { gesture = null; return; }
    }
    const dt = Math.max(1, event.timeStamp - gesture.lastT);
    gesture.velocity = (touch.clientX - gesture.lastX) / dt;
    gesture.lastX = touch.clientX;
    gesture.lastT = event.timeStamp;
    event.preventDefault(); // ours now: no scroll or selection alongside
    if (gesture.kind === "drawer") updateDrawerDrag(dx);
    else updatePaneDrag(dx);
  }

  function onGestureEnd(event) {
    if (event.type === "touchcancel") { cancelGesture(); return; }
    if (!gesture) return;
    const g = gesture;
    gesture = null;
    if (!g.claimed) return;
    if (g.kind === "drawer") endDrawerDrag(g);
    else endPaneDrag(g);
  }

  // Cancelled touches, rotation and button navigation restore the pane at once.
  function cancelGesture() {
    gesture = null;
    delete appEl.dataset.drawerDrag;
    setDrawerProgress(appEl.dataset.mobileExplorer === "open" ? 1 : 0);
    const drag = paneDrag;
    if (!drag) return;
    paneDrag = null;
    drag.cancelSettle?.();
    for (const el of [drag.current, drag.incoming]) {
      el.classList.remove("pane-swipe-layer");
      el.style.transform = "";
    }
    drag.incoming.hidden = drag.incomingWasHidden;
    delete appEl.dataset.paneDrag;
    delete appEl.dataset.paneSettling;
    applyView();
  }

  function beginDrawerDrag() {
    drawerWidth = Math.max(1, explorerPanel?.offsetWidth ?? 1);
    appEl.dataset.drawerDrag = "1";
  }

  function updateDrawerDrag(dx) {
    setDrawerProgress(((gesture.drawerOpen ? drawerWidth : 0) + dx) / drawerWidth);
  }

  function endDrawerDrag(g) {
    delete appEl.dataset.drawerDrag;
    const progress = ((g.drawerOpen ? drawerWidth : 0) + (g.lastX - g.startX)) / drawerWidth;
    const open = Math.abs(g.velocity) > FLICK_VELOCITY ? g.velocity > 0 : progress > (g.drawerOpen ? 1 - SNAP_FRACTION : SNAP_FRACTION);
    setExplorerOpen(open);
  }

  function beginPaneDrag(dx) {
    const order = ordered().map((pane) => pane.id);
    const index = order.indexOf(view);
    const nextIndex = index + (dx < 0 ? 1 : -1);
    if (index < 0 || nextIndex < 0 || nextIndex >= order.length) return false; // at an end
    const current = paneOf(view).element();
    const incoming = paneOf(order[nextIndex]).element();
    if (!current || !incoming) return false;
    // The incoming pane is normally display:none (and maybe [hidden]): lift
    // both into the slot as layers the drag can move.
    paneDrag = { order, index, nextIndex, current, incoming, incomingWasHidden: incoming.hidden,
      width: Math.max(1, current.offsetWidth || win.innerWidth) };
    incoming.hidden = false;
    current.classList.add("pane-swipe-layer");
    incoming.classList.add("pane-swipe-layer");
    appEl.dataset.paneDrag = "1";
    updatePaneDrag(dx);
    return true;
  }

  function updatePaneDrag(dx) {
    if (!paneDrag) return;
    const direction = paneDrag.nextIndex > paneDrag.index ? -1 : 1;
    const limited = direction * Math.max(0, Math.min(paneDrag.width, dx * direction));
    paneDrag.current.style.transform = `translateX(${limited}px)`;
    paneDrag.incoming.style.transform = `translateX(${-direction * paneDrag.width + limited}px)`;
  }

  function endPaneDrag(g) {
    if (!paneDrag) return;
    const drag = paneDrag;
    const dx = g.lastX - g.startX;
    const flicked = Math.abs(g.velocity) > FLICK_VELOCITY && Math.sign(g.velocity) === Math.sign(dx);
    const direction = drag.nextIndex > drag.index ? -1 : 1;
    const commit = Math.sign(dx) === direction && (flicked || Math.abs(dx) > drag.width * SNAP_FRACTION);
    const settleTo = commit ? direction * drag.width : 0;
    const target = drag.order[drag.nextIndex];
    if (commit) renderButtons(target);
    appEl.dataset.paneSettling = "1";
    drag.current.style.transform = `translateX(${settleTo}px)`;
    drag.incoming.style.transform = `translateX(${settleTo - direction * drag.width}px)`;
    const finish = () => {
      if (paneDrag !== drag) return;
      paneDrag = null;
      for (const el of [drag.current, drag.incoming]) {
        el.classList.remove("pane-swipe-layer");
        el.style.transform = "";
      }
      delete appEl.dataset.paneDrag;
      delete appEl.dataset.paneSettling;
      if (commit) {
        setView(target);
      } else {
        drag.incoming.hidden = drag.incomingWasHidden; // as it was before the drag
        applyView();
      }
    };
    // Settle on transitionend, with a timer as the backstop (a cancelled or
    // zero-length transition, reduced motion), so panes never stay stuck.
    let done = false, timer;
    const once = (event) => {
      if (event && (event.target !== drag.current || event.propertyName !== "transform")) return;
      if (done) return;
      drag.cancelSettle();
      finish();
    };
    drag.cancelSettle = () => {
      done = true;
      clearTimeout(timer);
      drag.current.removeEventListener("transitionend", once);
    };
    drag.current.addEventListener("transitionend", once);
    timer = setTimeout(once, 320);
  }

  // ── Wiring ──
  // touchmove is not passive: a claimed drag stops the browser's own scroll.
  doc.addEventListener("touchstart", onGestureStart, { passive: true });
  doc.addEventListener("touchmove", onGestureMove, { passive: false });
  doc.addEventListener("touchend", onGestureEnd, { passive: true });
  doc.addEventListener("touchcancel", onGestureEnd, { passive: true });
  explorerButton?.addEventListener("click", () => setExplorerOpen(appEl.dataset.mobileExplorer !== "open"));
  for (const button of buttons()) button.addEventListener("click", () => selectPane(button.dataset.pane));
  // The switch: the same file in its other view.
  viewToggle?.addEventListener("click", () => {
    const target = switchTarget();
    if (target) selectPane(target.id);
  });
  fileButton?.addEventListener("click", (event) => {
    event.stopPropagation();
    setFileListOpen(fileList?.hidden ?? false);
  });
  doc.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && fileList && !fileList.hidden) { setFileListOpen(false); fileButton?.focus(); }
  });
  menuButton?.addEventListener("click", (event) => {
    event.stopPropagation();
    setMenuOpen(appEl.dataset.mobileMenu !== "open");
  });
  // A command chosen from the ⋮ menu closes it (menu triggers only open sub-menus).
  menuBar?.addEventListener("click", (event) => {
    const button = event.target.closest("button");
    if (button && !button.classList.contains("menu-trigger")) setMenuOpen(false);
  });
  // A tap outside a flyout closes it; the explorer's own menus count as inside it.
  doc.addEventListener("pointerdown", (event) => {
    const target = event.target;
    if (appEl.dataset.mobileMenu === "open" && !menuBar?.contains(target) && !menuButton?.contains(target)) setMenuOpen(false);
    if (fileList && !fileList.hidden && !fileList.contains(target) && !fileButton?.contains(target)) setFileListOpen(false);
    if (appEl.dataset.mobileExplorer === "open" && !explorerPanel?.contains(target) && !explorerButton?.contains(target)
      && !doc.getElementById("explorer-context-menu")?.contains(target)) setExplorerOpen(false);
  }, true);
  installMobileViewport(win, doc.documentElement);
  if (!appEl.dataset.mobileExplorer) appEl.dataset.mobileExplorer = "closed";
  if (!appEl.dataset.mobileMenu) appEl.dataset.mobileMenu = "closed";

  return {
    view: () => view, applyView, renderCaption, selectPane, setExplorerOpen, setMenuOpen, cancelGesture,
    toggleExplorer: () => setExplorerOpen(appEl.dataset.mobileExplorer !== "open")
  };
}
