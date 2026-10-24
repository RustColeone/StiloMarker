// The desktop frame (Shell's): the areas around the editor and whether they
// show: the left area (the left window, docked or floating over the editor:
// its pages are tabs, the activity bar their icons, the Explorer one of them;
// pages.js draws them), the right area (the side panel, its toggle in the top bar), the
// bottom area (the log), and the middle's source and preview panes; their
// sizes (the splitters), all kept in the settings. Showing an area is
// announced ("area" { area, shown }) so its owner can draw or load it; a
// resize is announced ("resized" { by: "splitter" | "window" }), and a change
// of layout ("layout").
const PHONE_MAX_WIDTH = 900; // must match the CSS breakpoint
const LAYOUT_KEYS = ["explorer", "explorerAnchor", "preview", "source", "chatPanel", "debugPanel", "sidebarWidth",
  "previewWidth", "previewWidthCustomized", "chatWidth", "debugPanelHeight"];

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

const NAMES = { left: "Left window", right: "Right panel", bottom: "Log", source: "Source", preview: "Preview" };

export function createAreas({ settings, events, pages, log = () => {}, doc = globalThis.document, win = globalThis.window }) {
  const $ = (id) => doc.getElementById(id);
  const appEl = $("app"), shellEl = $("workspace-shell"), editorGrid = $("editor-grid");
  const explorerPanel = $("explorer-panel"), rightPanel = $("chat-panel"), logPanel = $("debug-panel");
  let phone = null; // the phone layout, once created (frame/index.js)
  const isPhone = () => win.matchMedia(`(max-width: ${PHONE_MAX_WIDTH}px)`).matches;

  // ── Showing ──
  function toggle(area) {
    if (area === "left") {
      if (isPhone()) { phone.toggleExplorer(); return; }
      settings.change({ explorer: settings.explorer === "collapsed" ? "expanded" : "collapsed" }, "Toggle the Left Window");
    } else if (area === "right") {
      if (isPhone()) { phone.toggleRight(); return; }
      settings.change({ chatPanel: settings.chatPanel === "hidden" ? "shown" : "hidden" }, "Toggle the Right Panel");
    } else if (area === "bottom") {
      if (isPhone()) { phone.toggleBottom(); return; }
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
    if (area === "right") return isPhone() && phone ? phone.rightOpen() : settings.chatPanel === "shown";
    if (area === "bottom") return isPhone() && phone ? phone.bottomOpen() : Boolean(settings.debugPanel);
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
    if (explorerPanel?.contains(target) || doc.querySelector(".activity-bar")?.contains(target) || $("explorer-context-menu")?.contains(target)) return;
    settings.change({ explorer: "collapsed" }, "pressed outside the floating explorer");
  }, true);

  // Show a page (one of the Explorer's sections, or a tab) wherever it is.
  function revealSection(id) {
    pages?.open(id);
  }

  // ── Applying the settings to the page ──
  function apply() {
    appEl.dataset.explorer = settings.explorer;
    // On the phone the explorer is always a drawer: "floating" never reaches the
    // page there (its desktop rule outweighs the phone's and pinned the editor to
    // the 48px activity bar). The desktop choice is kept for the trip back.
    appEl.dataset.explorerAnchor = isPhone() ? "docked" : settings.explorerAnchor;
    appEl.dataset.preview = settings.preview;
    appEl.dataset.source = settings.source;
    appEl.dataset.chat = settings.chatPanel;
    appEl.dataset.debug = settings.debugPanel ? "on" : "off";
    appEl.style.setProperty("--sidebar-width", `${settings.sidebarWidth}px`);
    // The preview: as wide as dragged, else half of the editor (the CSS grid
    // shares it, whatever else opens or the window does; it was measured once
    // here, before the areas just shown took their space: ISSUES 6).
    appEl.style.setProperty("--preview-width", settings.previewWidthCustomized ? `${settings.previewWidth}px` : "1fr");
    appEl.style.setProperty("--chat-width", `${settings.chatWidth}px`);
    appEl.style.setProperty("--debug-height", `${settings.debugPanelHeight}px`);
    $("preview-collapse-button")?.setAttribute("aria-expanded", String(settings.preview === "shown"));
    $("chat-collapse-button")?.setAttribute("aria-expanded", String(settings.chatPanel === "shown"));
    showsDrawers();
    const rightToggle = $("right-panel-toggle");
    rightToggle?.classList.toggle("is-active", settings.chatPanel === "shown");
    rightToggle?.setAttribute("aria-pressed", String(settings.chatPanel === "shown"));
    const anchorButton = $("explorer-anchor-button");
    if (anchorButton) {
      const floating = settings.explorerAnchor === "floating";
      anchorButton.classList.toggle("is-active", floating);
      anchorButton.setAttribute("aria-pressed", String(floating));
      anchorButton.title = floating ? "Dock the left window (fixed panel)" : "Float the left window (overlay)";
    }
    phone?.applyView();
    events.emit("layout", {});
  }
  // The right and bottom areas show by their settings; on the phone they are
  // drawers the CSS slides, never [hidden] (that would win over the CSS).
  function showsDrawers() {
    const phoneLayout = isPhone();
    if (rightPanel) rightPanel.hidden = settings.chatPanel === "hidden" && !phoneLayout;
    if (logPanel) logPanel.hidden = !settings.debugPanel && !phoneLayout;
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
  // A double-click on it: the even split again.
  $("editor-splitter")?.addEventListener("dblclick", () => {
    if (settings.previewWidthCustomized) settings.change({ previewWidthCustomized: false }, "even split");
  });
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
  bind("preview-toggle-activity-button", "preview");
  bind("source-toggle-activity-button", "source");
  bind("right-panel-toggle", "right");
  bind("preview-collapse-button", "preview");
  bind("source-collapse-button", "source");
  bind("chat-collapse-button", "right");
  bind("log-collapse-button", "bottom");
  $("explorer-anchor-button")?.addEventListener("click", () => setExplorerAnchor(settings.explorerAnchor === "floating" ? "docked" : "floating"));

  // The window resized (keyboard, browser chrome): announced. Crossing the
  // phone breakpoint (rotation, a resized window) decides the layout again.
  win.addEventListener("resize", () => {
    phone?.cancelGesture();
    events.emit("resized", { by: "window" });
  });
  win.matchMedia(`(max-width: ${PHONE_MAX_WIDTH}px)`).addEventListener("change", () => {
    phone?.closeAll();
    apply();
  });

  return { toggle, shown, apply, isPhone, revealSection, setExplorerAnchor, usePhone: (next) => { phone = next; } };
}
