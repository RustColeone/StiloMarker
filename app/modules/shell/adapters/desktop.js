// The desktop build (desktop/): when the app runs in its window, the bridge
// its preload gives (window.stiloDesktop: the release, a newer one, its
// download page; the window's zoom; its title bar). There the service worker is not used
// (the files are the app's own); updates come from the release feed instead.
const LOOK_EVERY = 6 * 60 * 60 * 1000;

export const desktopBridge = (win = globalThis.window) => win?.stiloDesktop ?? null;

// onUpdate({ version, url }) once a newer release is out: at start, then every few hours.
export function watchReleases({ bridge, onUpdate, log, every = LOOK_EVERY }) {
  let told = null;
  const look = async () => {
    const update = await bridge.checkForUpdate().catch((error) => {
      log("Looking for a newer release failed", error?.message ?? String(error));
      return null;
    });
    if (update?.available && update.version !== told) {
      told = update.version;
      onUpdate(update);
    }
  };
  void look();
  const timer = setInterval(look, every);
  return () => clearInterval(timer);
}

// The window's zoom (the desktop app's own: it takes the keys and Ctrl+wheel
// before the page sees them): View's Zoom In, Zoom Out and Reset Zoom, and a
// status bar item while it is not 100% (a click: 100% again).
export function addZoom({ zoom, commands, statusBar }) {
  const item = statusBar.add({ id: "zoom", order: 58, title: "The window's zoom. Click for 100%.", hidden: true,
    action: () => void zoom.step("reset").then(show) });
  function show(factor) {
    if (typeof factor === "number") item.set({ text: `${Math.round(factor * 100)}%`, hidden: factor === 1 });
  }
  [["in", "Zoom In", "Mod+="], ["out", "Zoom Out", "Mod+-"], ["reset", "Reset Zoom", "Mod+0"]].forEach(([direction, title, key], index) => {
    commands.add({ id: `shell.zoom-${direction}`, title, keys: [key], menu: { id: "view", group: 2, order: index + 1 },
      run: () => void zoom.step(direction).then(show) });
  });
  zoom.onChange(show);
  void zoom.get().then(show);
}

// "rgb(37, 37, 38)" (a computed colour) -> "#252526"; anything else -> null.
export function hexColor(css) {
  const match = /^rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(String(css ?? "").trim());
  return match ? `#${match.slice(1, 4).map((part) => Number(part).toString(16).padStart(2, "0")).join("")}` : null;
}

// The desktop app's one bar: its window has no title bar of the system's, so
// the top bar is it (dragged, it moves the window: styles.css, on
// html[data-window-frame="overlay"]), and the system's buttons drawn over it
// take its colours and height, told again when the theme or the bar changes.
export function joinTitleBar({ frame, doc = globalThis.document, win = globalThis.window }) {
  const bar = doc?.querySelector(".topbar");
  if (!bar) return;
  const overlay = win.navigator?.windowControlsOverlay;
  // Full screen, the buttons are gone (and the room kept for them).
  const mark = () => { doc.documentElement.dataset.windowFrame = overlay?.visible ? "overlay" : "system"; };
  let told = "";
  const tell = () => {
    const style = win.getComputedStyle(bar);
    const look = { color: hexColor(style.backgroundColor), symbolColor: hexColor(style.color), height: Math.round(bar.getBoundingClientRect().height) };
    const key = JSON.stringify(look);
    if (!look.color || !look.symbolColor || !look.height || key === told) return;
    told = key;
    void frame.set(look);
  };
  mark();
  tell();
  overlay?.addEventListener?.("geometrychange", mark);
  new win.MutationObserver(tell).observe(doc.documentElement, { attributes: true, attributeFilter: ["data-theme", "data-theme-id", "style"] });
  new win.ResizeObserver(tell).observe(bar);
}
