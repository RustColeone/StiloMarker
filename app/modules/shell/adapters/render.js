// Drawing the app again, asked of Shell: render(project, { only }) announces
// a "render" event and each module draws its own part. A full redraw waits
// while a module says it is busy (the Editor while a keystroke is applied:
// the editor has drawn it, the rest follows once typing pauses, or every
// MAX_MS during a long burst; drawing everything per key cost a whole-app
// redraw each time). "status" redraws never wait.
const IDLE_MS = 250;
const MAX_MS = 1500;

export function createRender(events) {
  const holds = new Set();
  let timer = null, deadline = 0, pending = null;
  const busy = () => [...holds].some((hold) => hold());
  const cancel = () => { if (timer) clearTimeout(timer); timer = null; deadline = 0; pending = null; };

  function render(project, { only } = {}) {
    if (only === "status") { events.emit("render", { project, only }); return; }
    if (busy()) {
      pending = project;
      const now = performance.now();
      if (!deadline) deadline = now + MAX_MS;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        const next = pending;
        cancel();
        render(next);
      }, Math.max(0, Math.min(IDLE_MS, deadline - now)));
      return;
    }
    cancel(); // this redraw covers whatever was waiting
    events.emit("render", { project });
  }

  return {
    render,
    // A module busy in a way a redraw would disturb: (busy) -> bool, asked before each full redraw.
    holdWhile(busyNow) { holds.add(busyNow); return () => holds.delete(busyNow); }
  };
}
