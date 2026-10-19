// One of the phone's side drawers (phone.js): the explorer from the left
// edge, the side panel from the right (the bottom sheet is sheet.js). Its
// state is on #app (data-<state>: "open" | "closed"), so the CSS slides it;
// while a finger drags it, data-<drag> is set and <progress> (0 closed … 1
// open) follows the finger. opens: the way a drag opens it ("right", "left").
// tuning: { snap } past this share of travel it snaps onward; { flick } px/ms
// that decides regardless of distance.
export function createDrawer({ appEl, panel, button = null, state, drag, progress, opens, tuning, onChange = () => {} }) {
  const sign = opens === "right" ? 1 : -1;
  let size = 1, from = 0;

  const isOpen = () => appEl.dataset[state] === "open";
  const setProgress = (value) => appEl.style.setProperty(progress, String(Math.min(1, Math.max(0, value))));

  function set(open) {
    const was = isOpen();
    appEl.dataset[state] = open ? "open" : "closed";
    button?.classList.toggle("is-active", open);
    button?.setAttribute("aria-expanded", String(open));
    setProgress(open ? 1 : 0);
    if (open !== was) onChange(open);
  }

  // A drag: travel is the finger's distance sideways (right is positive).
  const at = (travel) => from + (sign * travel) / size;
  function begin() {
    size = Math.max(1, panel?.offsetWidth ?? 1);
    from = isOpen() ? 1 : 0;
    appEl.dataset[drag] = "1";
  }
  const follow = (travel) => setProgress(at(travel));
  // Whether the drawer ends open, given the travel and the last speed.
  function end(travel, velocity) {
    delete appEl.dataset[drag];
    return Math.abs(velocity) > tuning.flick ? sign * velocity > 0 : at(travel) > (from ? 1 - tuning.snap : tuning.snap);
  }
  // A cancelled drag: back to where it was.
  function reset() {
    delete appEl.dataset[drag];
    setProgress(isOpen() ? 1 : 0);
  }

  if (!appEl.dataset[state]) appEl.dataset[state] = "closed";
  return { isOpen, set, begin, follow, end, reset, vertical: false, panel };
}
