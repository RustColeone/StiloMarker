// Layout: showing / hiding the explorer, preview, source and chat panels, the
// phone layout's single-pane view, and the touch gestures (explorer drawer,
// swiping between panes). main.js creates this on first use and passes its
// shared values in `app`.


export function createLayout(app) {
  function toggleExplorer() {
    if (app.isMobileLayout()) { toggleMobileExplorer(); return; }
    app.settings.explorer = app.settings.explorer === "collapsed" ? "expanded" : "collapsed";
    app.elements.explorerSelect.value = app.settings.explorer;
    app.persistSettings();
    app.logDebug("action", "Explorer toggled", app.settings.explorer);
  }

  function setExplorerAnchor(mode) {
    const next = mode === "floating" ? "floating" : "docked";
    if (app.settings.explorerAnchor === next) return;
    app.settings.explorerAnchor = next;
    if (app.elements.explorerAnchorSelect) app.elements.explorerAnchorSelect.value = next;
    app.persistSettings();
    app.logDebug("action", "Explorer anchor changed", next);
  }

  function toggleExplorerAnchor() {
    setExplorerAnchor(app.settings.explorerAnchor === "floating" ? "docked" : "floating");
  }

  // In floating mode the explorer overlays the editor; a press outside it (that
  // isn't the toggle/pin controls or the explorer's own popovers) collapses it.
  function handleFloatingExplorerOutsidePress(event) {
    if (app.settings.explorerAnchor !== "floating" || app.settings.explorer !== "expanded") return;
    const target = event.target;
    if (app.elements.explorerPanel?.contains(target)) return;
    if (app.elements.explorerToggleButton?.contains(target)) return;
    if (app.elements.explorerContextMenu?.contains(target)) return;
    app.settings.explorer = "collapsed";
    if (app.elements.explorerSelect) app.elements.explorerSelect.value = app.settings.explorer;
    app.persistSettings();
  }

  function togglePreview() {
    if (app.isMobileLayout()) { selectMobilePane(app.mobileView === "preview" ? "source" : "preview"); return; }
    app.settings.preview = app.settings.preview === "hidden" ? "shown" : "hidden";
    // Never collapse both panes.
    if (app.settings.preview === "hidden" && app.settings.source === "hidden") {
      app.settings.source = "shown";
    }
    app.elements.previewSelect.value = app.settings.preview;
    app.persistSettings();
    app.logDebug("action", "Preview toggled", app.settings.preview);
  }

  function toggleSource() {
    if (app.isMobileLayout()) { selectMobilePane(app.mobileView === "source" ? "preview" : "source"); return; }
    app.settings.source = app.settings.source === "hidden" ? "shown" : "hidden";
    // Collapsing the source is a reading-focused mode — keep the preview visible.
    if (app.settings.source === "hidden" && app.settings.preview === "hidden") {
      app.settings.preview = "shown";
      app.elements.previewSelect.value = "shown";
    }
    app.persistSettings();
    app.logDebug("action", "Source toggled", app.settings.source);
  }

  function toggleChat() {
    if (app.isMobileLayout()) {
      selectMobilePane(app.mobileView === "chat" ? "source" : "chat");
      return;
    }
    app.settings.chatPanel = app.settings.chatPanel === "hidden" ? "shown" : "hidden";
    app.persistSettings();
    if (app.settings.chatPanel === "shown") {
      void app.refreshChatStatus({ silent: true });
      if (app.chat) app.chat.chatState.shouldScrollToBottom = true;
      app.renderChatPanel(app.controller.getProject());
    }
    app.logDebug("action", "Chat toggled", app.settings.chatPanel);
  }

  // ── Mobile view state ──────────────────────────────────────────────────────
  // On narrow screens the source/preview/chat panes share one slot; #app's
  // data-mobile-view picks which is visible. These helpers are inert on desktop
  // (the mobile CSS is gated behind a media query) but keep the button state and
  // ARIA in sync everywhere.
  function applyMobileViewState() {
    app.elements.app.dataset.mobileView = app.mobileView;
    // The chat panel is normally gated by the global `[hidden] { display:none
    // !important }` rule (driven by settings.chatPanel). In the mobile chat view
    // it must win over that, so drop the attribute and let the cascade decide per
    // viewport. A desktop window may retain a previous mobile pane selection;
    // only the active mobile layout can override the saved chat preference.
    if (app.elements.chatPanel) {
      app.elements.chatPanel.hidden = app.settings.chatPanel === "hidden" && !(app.isMobileLayout() && app.mobileView === "chat");
    }
    renderMobilePaneButtons(app.mobileView);
    renderMobilePaneCaption();
  }

  // Topbar caption (replaces the per-pane header on mobile): SOURCE/PREVIEW plus
  // the file name, truncated by CSS. This depends on which FILE is showing, not
  // just which view, so updateStatus refreshes it on every render — otherwise
  // switching files left a stale name in the mobile topbar.
  // Highlight = "this is the pane you are looking at". Takes the view explicitly
  // so a committed swipe can light the target up as it slides in, instead of the
  // button catching up only after the settle animation ends.
  function renderMobilePaneButtons(view) {
    for (const button of [app.elements.mobileSourceToggle, app.elements.mobilePreviewToggle, app.elements.mobileChatToggle]) {
      if (!button) continue;
      const active = button.dataset.pane === view;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", String(active));
    }
  }

  function renderMobilePaneCaption() {
    if (app.elements.mobilePaneCaption) {
      let caption = "";
      if (app.mobileView === "chat") {
        caption = "CHAT";
      } else if (app.mobileView === "preview") {
        const name = app.previewFileId === app.DIFF_TAB_ID
          ? (app.diffState.active ? `${app.diffState.path.split("/").pop()} (diff)` : null)
          : app.controller.getProject()?.nodes?.[app.previewFileId]?.name;
        caption = name ? `PREVIEW — ${name}` : "PREVIEW";
      } else {
        const name = app.controller.getActiveFile()?.name;
        caption = name ? `SOURCE — ${name}` : "SOURCE";
      }
      app.elements.mobilePaneCaption.textContent = caption;
    }
    // The pen (rename) button only makes sense when a real file is on screen.
    if (app.elements.mobileRenameButton) {
      app.elements.mobileRenameButton.hidden = app.currentMobileFileId() == null;
    }
  }

  function setMobileView(view) {
    cancelMobileGesture();
    app.mobileView = view;
    if (view === "preview") {
      // Mobile has a single pane toggle, so the preview should mirror the file
      // you're editing rather than a stale/independent preview target.
      const activeFile = app.controller.getActiveFile();
      if (activeFile && app.isPreviewableFileName(activeFile.name) && app.previewFileId !== activeFile.id) {
        app.setPreviewFile(activeFile.id);
      }
    }
    applyMobileViewState();
  }

  // Each topbar button selects its own pane. Tapping the one already showing is
  // a no-op rather than a toggle: with three dedicated buttons the highlight has
  // to mean "this is what you are looking at", and toggling would contradict it.
  function selectMobilePane(view) {
    if (!app.PANE_ORDER.includes(view)) return;
    if (view === app.mobileView) { cancelMobileGesture(); return; }
    setMobileView(view);
    if (view === "chat") openMobileChatView();
  }

  function openMobileChatView() {
    void app.refreshChatStatus({ silent: true });
    if (app.chat) app.chat.chatState.shouldScrollToBottom = true;
    app.renderChatPanel(app.controller.getProject());
  }

  function setDrawerProgress(progress) {
    const clamped = Math.min(1, Math.max(0, progress));
    app.elements.app.style.setProperty("--drawer-progress", String(clamped));
  }

  function paneElement(view) {
    if (view === "source") return app.elements.sourcePane;
    if (view === "preview") return document.querySelector(".preview-pane");
    return app.elements.chatPanel;
  }

  // A drag must not steal a scroll that belongs to content — a wide table or a
  // code block in the preview, the horizontal tab strip, a range input.
  function claimsHorizontalScroll(target) {
    let node = target;
    while (node && node !== document.body) {
      if (node.nodeType === 1) {
        if (node.closest?.(".tab-strip, input[type='range'], .cm-editor")) return true;
        const style = window.getComputedStyle(node);
        const scrolls = /(auto|scroll)/.test(style.overflowX);
        if (scrolls && node.scrollWidth > node.clientWidth + 1) return true;
      }
      node = node.parentNode;
    }
    return false;
  }

  function onGestureStart(event) {
    if (event.touches.length !== 1) { cancelMobileGesture(); return; }
    if (!app.isMobileLayout() || app.paneDrag) return;
    app.gesture = null;
    // Editing, canvas interaction, menus, and horizontal content own their drags.
    // Check before the edge gesture too, so a table at the left edge can scroll.
    if (event.target.closest?.("dialog, .menu-bar, .explorer-context-menu, .tab-overflow-menu, input, textarea, select, button, a, [contenteditable], .bmap-editor, .cm-editor")) return;
    if (claimsHorizontalScroll(event.target) || window.getSelection()?.isCollapsed === false) return;

    const touch = event.touches[0];
    const drawerOpen = app.elements.app.dataset.mobileExplorer === "open";
    app.gesture = {
      startX: touch.clientX,
      startY: touch.clientY,
      lastX: touch.clientX,
      lastT: event.timeStamp,
      velocity: 0,
      kind: null,           // "drawer" | "pane", decided on first qualifying move
      claimed: false,
      drawerOpen,
      fromEdge: touch.clientX <= app.EDGE_ZONE,
      allowPane: !drawerOpen && !claimsHorizontalScroll(event.target)
    };
  }

  function onGestureMove(event) {
    if (event.touches.length !== 1) { cancelMobileGesture(); return; }
    if (!app.gesture) return;
    const touch = event.touches[0];
    const dx = touch.clientX - app.gesture.startX;
    const dy = touch.clientY - app.gesture.startY;

    if (!app.gesture.claimed) {
      if (Math.abs(dx) < app.SLOP || Math.abs(dx) < Math.abs(dy) * app.DIRECTION_BIAS) {
        // Vertical or not yet decisive — let the page have it, and stop looking
        // once it is clearly a scroll so we don't fight it later in the gesture.
        if (Math.abs(dy) > app.SLOP * 2) app.gesture = null;
        return;
      }
      if (app.gesture.drawerOpen && dx < 0) app.gesture.kind = "drawer";
      else if (!app.gesture.drawerOpen && app.gesture.fromEdge && dx > 0) app.gesture.kind = "drawer";
      else if (app.gesture.allowPane) app.gesture.kind = "pane";
      if (!app.gesture.kind) { app.gesture = null; return; }
      app.gesture.claimed = true;
      if (app.gesture.kind === "drawer") beginDrawerDrag();
      else if (!beginPaneDrag(dx)) { app.gesture = null; return; }
    }

    const dt = Math.max(1, event.timeStamp - app.gesture.lastT);
    app.gesture.velocity = (touch.clientX - app.gesture.lastX) / dt;
    app.gesture.lastX = touch.clientX;
    app.gesture.lastT = event.timeStamp;

    event.preventDefault();  // we own it now — suppress scroll/selection
    if (app.gesture.kind === "drawer") updateDrawerDrag(dx);
    else updatePaneDrag(dx);
  }

  function onGestureEnd(event) {
    if (event.type === "touchcancel") { cancelMobileGesture(); return; }
    if (!app.gesture) return;
    const g = app.gesture;
    app.gesture = null;
    if (!g.claimed) return;
    if (g.kind === "drawer") endDrawerDrag(g);
    else endPaneDrag(g);
  }

  // Cancelled touches, rotation, and button navigation must restore the original
  // pane immediately, without a delayed animation switching it back afterward.
  function cancelMobileGesture() {
    app.gesture = null;
    delete app.elements.app.dataset.drawerDrag;
    setDrawerProgress(app.elements.app.dataset.mobileExplorer === "open" ? 1 : 0);
    const drag = app.paneDrag;
    if (!drag) return;
    app.paneDrag = null;
    drag.cancelSettle?.();
    for (const el of [drag.current, drag.incoming]) {
      el.classList.remove("pane-swipe-layer");
      el.style.transform = "";
    }
    drag.incoming.hidden = drag.incomingWasHidden;
    delete app.elements.app.dataset.paneDrag;
    delete app.elements.app.dataset.paneSettling;
    applyMobileViewState();
  }

  // ---- Drawer ----------------------------------------------------------------

  function beginDrawerDrag() {
    const sidebar = app.elements.explorerPanel ?? document.querySelector(".workspace-shell > .sidebar");
    app.drawerWidth = Math.max(1, sidebar?.offsetWidth ?? 1);
    app.elements.app.dataset.drawerDrag = "1";
  }

  function updateDrawerDrag(dx) {
    const base = app.gesture.drawerOpen ? app.drawerWidth : 0;
    setDrawerProgress((base + dx) / app.drawerWidth);
  }

  function endDrawerDrag(g) {
    delete app.elements.app.dataset.drawerDrag;
    const dx = g.lastX - g.startX;
    const progress = ((g.drawerOpen ? app.drawerWidth : 0) + dx) / app.drawerWidth;
    const flicked = Math.abs(g.velocity) > app.FLICK_VELOCITY;
    const open = flicked
      ? g.velocity > 0
      : progress > (g.drawerOpen ? 1 - app.SNAP_FRACTION : app.SNAP_FRACTION);
    setMobileExplorerOpen(open);
  }

  // ---- Pane carousel ---------------------------------------------------------

  function beginPaneDrag(dx) {
    const index = app.PANE_ORDER.indexOf(app.mobileView);
    const nextIndex = index + (dx < 0 ? 1 : -1);
    if (nextIndex < 0 || nextIndex >= app.PANE_ORDER.length) return false;  // at an end
    const current = paneElement(app.mobileView);
    const incoming = paneElement(app.PANE_ORDER[nextIndex]);
    if (!current || !incoming) return false;

    // The incoming pane is normally display:none and, for chat, also [hidden].
    // Lift both into the grid cell as layers the drag can translate.
    app.paneDrag = {
      index,
      nextIndex,
      current,
      incoming,
      incomingWasHidden: incoming.hidden,
      width: Math.max(1, current.offsetWidth || window.innerWidth)
    };
    incoming.hidden = false;
    current.classList.add("pane-swipe-layer");
    incoming.classList.add("pane-swipe-layer");
    app.elements.app.dataset.paneDrag = "1";
    updatePaneDrag(dx);
    return true;
  }

  function updatePaneDrag(dx) {
    if (!app.paneDrag) return;
    const direction = app.paneDrag.nextIndex > app.paneDrag.index ? -1 : 1;
    const limited = direction * Math.max(0, Math.min(app.paneDrag.width, dx * direction));
    const offset = -direction * app.paneDrag.width;
    app.paneDrag.current.style.transform = `translateX(${limited}px)`;
    app.paneDrag.incoming.style.transform = `translateX(${offset + limited}px)`;
  }

  function endPaneDrag(g) {
    if (!app.paneDrag) return;
    const drag = app.paneDrag;
    const dx = g.lastX - g.startX;
    const flicked = Math.abs(g.velocity) > app.FLICK_VELOCITY
      && Math.sign(g.velocity) === Math.sign(dx);
    const direction = drag.nextIndex > drag.index ? -1 : 1;
    const commit = Math.sign(dx) === direction && (flicked || Math.abs(dx) > drag.width * app.SNAP_FRACTION);
    const settleTo = commit ? direction * drag.width : 0;

    if (commit) renderMobilePaneButtons(app.PANE_ORDER[drag.nextIndex]);
    app.elements.app.dataset.paneSettling = "1";
    drag.current.style.transform = `translateX(${settleTo}px)`;
    drag.incoming.style.transform = `translateX(${settleTo - direction * drag.width}px)`;

    const finish = () => {
      if (app.paneDrag !== drag) return;
      app.paneDrag = null;
      for (const el of [drag.current, drag.incoming]) {
        el.classList.remove("pane-swipe-layer");
        el.style.transform = "";
      }
      delete app.elements.app.dataset.paneDrag;
      delete app.elements.app.dataset.paneSettling;
      if (commit) {
        setMobileView(app.PANE_ORDER[drag.nextIndex]);
        if (app.PANE_ORDER[drag.nextIndex] === "chat") openMobileChatView();
      } else {
        // Restore whatever [hidden] state the incoming pane had before the drag.
        drag.incoming.hidden = drag.incomingWasHidden;
        applyMobileViewState();
      }
      app.paneDrag = null;
    };
    // Settle on transitionend, with a timer as the backstop for a cancelled or
    // zero-duration transition (reduced motion), so panes can never stay stuck.
    let done = false;
    let timer;
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

  function setMobileExplorerOpen(open) {
    cancelMobileGesture();
    if (open) setMobileMenuOpen(false);
    app.elements.app.dataset.mobileExplorer = open ? "open" : "closed";
    app.elements.mobileExplorerButton?.classList.toggle("is-active", open);
    app.elements.mobileExplorerButton?.setAttribute("aria-expanded", String(open));
    setDrawerProgress(open ? 1 : 0);
  }

  function toggleMobileExplorer() {
    setMobileExplorerOpen(app.elements.app.dataset.mobileExplorer !== "open");
  }

  function setMobileMenuOpen(open) {
    cancelMobileGesture();
    if (open) setMobileExplorerOpen(false);
    app.elements.app.dataset.mobileMenu = open ? "open" : "closed";
    app.elements.mobileMenuButton?.classList.toggle("is-active", open);
    app.elements.mobileMenuButton?.setAttribute("aria-expanded", String(open));
    if (!open) app.closeMenus();
  }

  function toggleMobileMenu() {
    setMobileMenuOpen(app.elements.app.dataset.mobileMenu !== "open");
  }

  return { applyMobileViewState, cancelMobileGesture, handleFloatingExplorerOutsidePress, onGestureEnd, onGestureMove, onGestureStart, renderMobilePaneCaption, selectMobilePane, setExplorerAnchor, setMobileExplorerOpen, setMobileMenuOpen, toggleChat, toggleExplorer, toggleExplorerAnchor, toggleMobileExplorer, toggleMobileMenu, togglePreview, toggleSource };
}
