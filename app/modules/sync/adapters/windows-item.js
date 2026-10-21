// The status bar's word on this browser's other windows on the same
// workspace (adapters/tabs.js): nothing while this window is alone on it;
// "2 windows" while they are linked; a warning when this window has waited
// a while for the one that keeps the workspace (its changes stay marked as
// unsaved until that window has them).
const WAIT_SAID_AFTER = 3000;

export function addWindowsItem({ shell }) {
  const item = shell.statusBar.add({ id: "windows", order: 16, dot: true, hidden: true });
  let waitTimer = null;
  let last = { linked: false, leading: false, others: 0, waiting: false };

  function show() {
    const { linked, leading, others, waiting } = last;
    if (waiting && !leading && !waitTimer) {
      item.set({ hidden: false, text: "Waiting for the other window", tone: "warning",
        title: "This workspace is open in another window of this browser, which keeps it, and that window is not answering. Your changes here stay marked as unsaved until it does; closing this window could lose them." });
      return;
    }
    if (!linked || others < 1) { item.set({ hidden: true }); return; }
    const count = others + 1;
    item.set({ hidden: false, text: `${count} windows`, tone: null,
      title: `This workspace is open in ${count} windows of this browser: what you do in one shows in the others. `
        + (leading ? "This window keeps it in this browser." : "The window that opened it first keeps it in this browser; this one sends it your changes.") });
  }

  function draw(state) {
    last = state;
    if (state.waiting && !state.leading) {
      if (!waitTimer) waitTimer = setTimeout(() => { waitTimer = null; if (last.waiting && !last.leading) show(); }, WAIT_SAID_AFTER);
    } else if (waitTimer) {
      clearTimeout(waitTimer);
      waitTimer = null;
    }
    show();
  }

  return { draw };
}
