// The desktop frame (Shell's): the areas around the editor and whether they
// show: the left area (the explorer sidebar, docked or floating over the
// editor, with its collapsible sections), the right area (the side panel), the
// bottom area (the log), and the middle's source and preview panes; their
// sizes (the splitters), all kept in the settings. Showing an area is
// announced ("area" { area, shown }) so its owner can draw or load it; a
// resize is announced ("resized" { by: "splitter" | "window" }), and a change
// of layout ("layout").
const PHONE_MAX_WIDTH = 900; // must match the CSS breakpoint
const LAYOUT_KEYS = ["explorer", "explorerAnchor", "preview", "source", "chatPanel", "debugPanel", "sidebarWidth",
  "previewWidth", "previewWidthCustomized", "chatWidth", "debugPanelHeight", "sidebarPanels"];
const SECTIONS = ["links", "session"]; // the left area's collapsible sections

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

const NAMES = { left: "Explorer", right: "Chat", bottom: "Log", source: "Source", preview: "Preview" };

export function createAreas({ settings, events, log = () => {}, doc = globalThis.document, win = globalThis.window }) {
  const $ = (id) => doc.getElementById(id);
  const appEl = $("app"), shellEl = $("workspace-shell"), editorGrid = $("editor-grid");
  const explorerPanel = $("explorer-panel"), rightPanel = $("chat-panel"), logPanel = $("debug-panel");
  let phone = null; // the phone layout, once created (frame/index.js)
  const isPhone = () => win.matchMedia(`(max-width: ${PHONE_MAX_WIDTH}px)`).matches;

  // ── Showing ──
  function toggle(area) {
    if (area === "left") {
      if (isPhone()) { phone.toggleExplorer(); return; }
      settings.change({ explorer: settings.explorer === "collapsed" ? "expanded" : "collapsed" }, "Toggle Explorer");
    } else if (area === "right") {
      if (isPhone()) { phone.selectPane(phone.view() === "chat" ? "source" : "chat"); return; }
      settings.change({ chatPanel: settings.chatPanel === "hidden" ? "shown" : "hidden" }, "Toggle Chat");
    } else if (area === "bottom") {
      settings.change({ debugPanel: !settings.debugPanel }, "Toggle Log");
    } else if (area === "preview" || area === "source") {
      const other = area === "preview" ? "source" : "preview";
      if (isPhone()) { phone.selectPane(phone.view() === area ? other : area); return; }
      settings.change({ [area]: settings[area] === "hidden" ? "shown" : "hidden" }, `Toggle ${area}`);
      // Never both hidden: hiding one keeps the other.
      if (settings[area] === "hidden" && settings[other] === "hidden") settings.change({ [other]: "shown" }, `Toggle ${area}`);
    } else {
      return;
    }
    log(`${NAMES[area]} toggled: ${shown(area) ? "shown" : "hidden"}`);
    events.emit("area", { area, shown: shown(area) });
  }

  function shown(area) {
    if (area === "left") return settings.explorer !== "collapsed";
    if (area === "right") return settings.chatPanel === "shown";
    if (area === "bottom") return Boolean(settings.debugPanel);
    return settings[area] !== "hidden";
  }

  // The explorer docked (it resizes the editor) or floating over it.
  function setExplorerAnchor(mode) {
    const next = mode === "floating" ? "floating" : "docked";
    if (settings.explorerAnchor !== next) settings.change({ explorerAnchor: next }, "explorer anchor");
  }
  // Floating, a press outside it (not its toggles or its own menus) folds it away.
  doc.addEventListener("pointerdown", (event) => {
    if (settings.explorerAnchor !== "floating" || settings.explorer !== "expanded") return;
    const target = event.target;
    if (explorerPanel?.contains(target) || $("explorer-toggle-button")?.contains(target) || $("explorer-context-menu")?.contains(target)) return;
    settings.change({ explorer: "collapsed" }, "pressed outside the floating explorer");
  }, true);

  // ── The left area's sections (Linked Notes, Session) ──
  // Collapsed per section and kept; never chosen, they start collapsed on a
  // phone, where they pushed the file tree (the reason for the sidebar) off screen.
  function sectionCollapsed(id) {
    const stored = settings.sidebarPanels;
    if (stored && typeof stored === "object" && id in stored) return Boolean(stored[id]);
    return isPhone();
  }
  function drawSections() {
    for (const toggleEl of doc.querySelectorAll(".sidebar-panel-toggle")) {
      const id = toggleEl.dataset.panel;
      if (!id) continue;
      const collapsed = sectionCollapsed(id);
      toggleEl.closest(".sidebar-panel")?.setAttribute("data-collapsed", String(collapsed));
      toggleEl.setAttribute("aria-expanded", String(!collapsed));
    }
  }
  function toggleSection(id) {
    if (!SECTIONS.includes(id)) return;
    // Both written the first time, so flipping one doesn't leave the other
    // following the viewport and collapsing again on the next resize.
    const next = { ...(settings.sidebarPanels ?? {}) };
    for (const key of SECTIONS) if (!(key in next)) next[key] = sectionCollapsed(key);
    next[id] = !next[id];
    settings.change({ sidebarPanels: next }, `${id} section ${next[id] ? "collapsed" : "expanded"}`);
  }
  // Show a section: the explorer opened, the section expanded, scrolled to.
  function revealSection(id) {
    if (settings.explorer !== "expanded") settings.change({ explorer: "expanded" }, `show the ${id} section`);
    if (sectionCollapsed(id)) toggleSection(id);
    doc.querySelector(`.sidebar-panel-toggle[data-panel="${id}"]`)?.closest(".sidebar-panel")?.scrollIntoView({ block: "nearest" });
  }

  // ── Applying the settings to the page ──
  function apply() {
    const styles = win.getComputedStyle?.(appEl);
    const splitterSize = Number.parseFloat(styles?.getPropertyValue("--splitter-size") ?? "4") || 4;
    const gridWidth = editorGrid.getBoundingClientRect().width;
    const previewWidth = settings.previewWidthCustomized ? settings.previewWidth
      : (Number.isFinite(gridWidth) && gridWidth > 0 ? Math.round(clamp((gridWidth - splitterSize) / 2, 280, Math.max(320, gridWidth - 280))) : 420);
    appEl.dataset.explorer = settings.explorer;
    // On the phone the explorer is always a drawer: "floating" never reaches the
    // page there (its desktop rule outweighs the phone's and pinned the editor to
    // the 48px activity bar). The desktop choice is kept for the trip back.
    appEl.dataset.explorerAnchor = isPhone() ? "docked" : settings.explorerAnchor;
    drawSections();
    appEl.dataset.preview = settings.preview;
    appEl.dataset.source = settings.source;
    appEl.dataset.chat = settings.chatPanel;
    appEl.dataset.debug = settings.debugPanel ? "on" : "off";
    appEl.style.setProperty("--sidebar-width", `${settings.sidebarWidth}px`);
    appEl.style.setProperty("--preview-width", `${previewWidth}px`);
    appEl.style.setProperty("--chat-width", `${settings.chatWidth}px`);
    appEl.style.setProperty("--debug-height", `${settings.debugPanelHeight}px`);
    $("preview-collapse-button")?.setAttribute("aria-expanded", String(settings.preview === "shown"));
    $("chat-collapse-button")?.setAttribute("aria-expanded", String(settings.chatPanel === "shown"));
    if (logPanel) logPanel.hidden = !settings.debugPanel;
    $("chat-toggle-activity-button")?.classList.toggle("is-active", settings.chatPanel === "shown");
    const anchorButton = $("explorer-anchor-button");
    if (anchorButton) {
      const floating = settings.explorerAnchor === "floating";
      anchorButton.classList.toggle("is-active", floating);
      anchorButton.setAttribute("aria-pressed", String(floating));
      anchorButton.title = floating ? "Dock the explorer (fixed panel)" : "Float the explorer (overlay)";
    }
    phone?.applyView();
    events.emit("layout", {});
  }
  // The right area shows by its setting, or when the phone shows a pane in it
  // (that must win over the global [hidden] rule, so the attribute goes).
  function showsRight(phonePaneElement) {
    if (rightPanel) rightPanel.hidden = settings.chatPanel === "hidden" && !(phonePaneElement && phonePaneElement === rightPanel);
  }
  settings.on((view, changed) => { if (changed.some((key) => LAYOUT_KEYS.includes(key))) apply(); });

  // ── Sizes: the splitters ──
  const splitter = (id, { when, size }) => $(id)?.addEventListener("pointerdown", (event) => {
    if (!when()) return;
    event.preventDefault();
    const move = (moveEvent) => {
      settings.change(size(moveEvent), "resize");
      events.emit("resized", { by: "splitter" });
    };
    const up = () => { doc.removeEventListener("pointermove", move); doc.removeEventListener("pointerup", up); };
    doc.addEventListener("pointermove", move);
    doc.addEventListener("pointerup", up);
  });
  splitter("workspace-splitter", { when: () => settings.explorer !== "collapsed", size(event) {
    const rect = shellEl.getBoundingClientRect();
    return { sidebarWidth: Math.round(clamp(event.clientX - rect.left - 48, 180, Math.max(240, rect.width - 320))) }; // 48: the activity bar
  } });
  splitter("editor-splitter", { when: () => settings.preview !== "hidden", size(event) {
    const rect = editorGrid.getBoundingClientRect();
    return { previewWidthCustomized: true, previewWidth: Math.round(clamp(rect.right - event.clientX, 280, Math.max(320, rect.width - 280))) };
  } });
  splitter("chat-splitter", { when: () => settings.chatPanel !== "hidden", size(event) {
    const rect = shellEl.getBoundingClientRect();
    return { chatWidth: Math.round(clamp(rect.right - event.clientX, 300, Math.max(340, rect.width - 360))) };
  } });
  splitter("debug-splitter", { when: () => Boolean(settings.debugPanel), size(event) {
    const rect = shellEl.getBoundingClientRect();
    return { debugPanelHeight: Math.round(clamp(rect.bottom - 24 - event.clientY, 120, Math.max(180, rect.height - 220))) }; // 24: the status bar
  } });

  // ── Its controls ──
  const bind = (id, area) => $(id)?.addEventListener("click", () => toggle(area));
  bind("explorer-toggle-button", "left");
  bind("preview-toggle-activity-button", "preview");
  bind("source-toggle-activity-button", "source");
  bind("chat-toggle-activity-button", "right");
  bind("preview-collapse-button", "preview");
  bind("source-collapse-button", "source");
  bind("chat-collapse-button", "right");
  bind("log-collapse-button", "bottom");
  $("explorer-anchor-button")?.addEventListener("click", () => setExplorerAnchor(settings.explorerAnchor === "floating" ? "docked" : "floating"));
  doc.addEventListener("click", (event) => {
    const toggleEl = event.target.closest?.(".sidebar-panel-toggle");
    if (toggleEl?.dataset.panel) toggleSection(toggleEl.dataset.panel);
  });

  // The window resized (keyboard, browser chrome): announced. Crossing the
  // phone breakpoint (rotation, a resized window) decides the layout again.
  win.addEventListener("resize", () => {
    phone?.cancelGesture();
    events.emit("resized", { by: "window" });
  });
  win.matchMedia(`(max-width: ${PHONE_MAX_WIDTH}px)`).addEventListener("change", () => {
    phone?.cancelGesture();
    phone?.setExplorerOpen(false);
    phone?.setMenuOpen(false);
    apply();
  });

  return { toggle, shown, apply, isPhone, revealSection, showsRight, setExplorerAnchor, usePhone: (next) => { phone = next; } };
}
