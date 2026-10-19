// The phone's bottom sheet (the bottom area: the Log), beside its drawers
// (drawer.js). Its state is on #app: data-mobile-bottom ("open" | "closed")
// and data-sheet-size, half the screen or all of it below the top bar ("half"
// | "full"); it opens at half. Its header drags it (phone.js): the sheet
// follows the finger (data-bottom-drag, --sheet-drag-height), and on release
// settles at the nearest of closed, half and full, or one step the way it was
// flicked. tuning: { flick } px/ms that counts as a flick.
export function createSheet({ appEl, panel, tuning, onChange = () => {}, doc = globalThis.document, win = globalThis.window }) {
  let from = 0;

  const isOpen = () => appEl.dataset.mobileBottom === "open";
  const full = () => appEl.dataset.sheetSize === "full";

  function set(open) {
    const was = isOpen();
    if (open && !was) appEl.dataset.sheetSize = "half";
    appEl.dataset.mobileBottom = open ? "open" : "closed";
    if (open !== was) onChange(open);
  }

  // Its heights, as the CSS draws them.
  function heights() {
    const viewport = Number.parseFloat(doc.documentElement.style.getPropertyValue("--mobile-viewport-height")) || win.innerHeight;
    const topbar = Number.parseFloat(win.getComputedStyle(appEl).getPropertyValue("--topbar-height")) || 0;
    return [0, viewport * 0.5, viewport - topbar]; // closed, half, full
  }

  // A drag: travel is how far the finger went down (up is negative).
  function begin() {
    from = panel?.offsetHeight ?? 0;
    appEl.dataset.bottomDrag = "1";
  }
  const heightAt = (travel) => Math.min(heights()[2], Math.max(0, from - travel));
  const follow = (travel) => appEl.style.setProperty("--sheet-drag-height", `${Math.round(heightAt(travel))}px`);
  // Where it settles; returns whether it stays open.
  function end(travel, velocity) {
    delete appEl.dataset.bottomDrag;
    const stops = heights();
    const height = heightAt(travel);
    const stop = Math.abs(velocity) > tuning.flick
      ? Math.max(0, Math.min(2, (full() ? 2 : 1) + (velocity < 0 ? 1 : -1)))
      : stops.reduce((best, value, index) => (Math.abs(value - height) < Math.abs(stops[best] - height) ? index : best), 0);
    if (stop) appEl.dataset.sheetSize = stop === 2 ? "full" : "half";
    return stop > 0;
  }
  const reset = () => { delete appEl.dataset.bottomDrag; };

  if (!appEl.dataset.mobileBottom) appEl.dataset.mobileBottom = "closed";
  return { isOpen, set, begin, follow, end, reset, vertical: true, panel };
}
