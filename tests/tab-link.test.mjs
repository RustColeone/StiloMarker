// Windows of one browser linked on one of its workspaces (sync/adapters/
// tabs.js): the production sync runtime in each window, a real
// BroadcastChannel between them, and a stand-in for Web Locks (with a window
// that crashes: its lock let go of, its channel gone silent).
import test from "node:test";
import assert from "node:assert/strict";
import { createTabLink } from "../app/modules/sync/adapters/tabs.js";
import { createRuntime } from "../app/modules/sync/service/runtime.js";
import { applySyncOperation } from "../app/modules/workspace/index.js";

// Web Locks, as one browser keeps them for its windows.
function lockManager() {
  const held = new Map();   // name -> window id
  const queue = new Map();  // name -> [{ win, grant }]
  const releases = new Map(); // name -> release()
  function grantNext(name) {
    const next = (queue.get(name) ?? []).shift();
    next?.grant();
  }
  function run(win, name, callback) {
    held.set(name, win);
    let release;
    const released = new Promise((resolve) => { release = resolve; });
    releases.set(name, release);
    const result = Promise.resolve().then(() => callback({ name }));
    // Let go when the callback's promise settles, or when the window crashes.
    Promise.race([result.catch(() => {}), released]).then(() => {
      if (held.get(name) !== win) return;
      held.delete(name);
      releases.delete(name);
      grantNext(name);
    });
    return result;
  }
  return {
    forWindow(win) {
      return {
        request(name, options, callback) {
          if (held.has(name)) {
            if (options.ifAvailable) return Promise.resolve().then(() => callback(null));
            return new Promise((resolve, reject) => {
              const entry = { win, grant: () => run(win, name, callback).then(resolve, reject) };
              queue.set(name, [...(queue.get(name) ?? []), entry]);
              options.signal?.addEventListener("abort", () => {
                queue.set(name, (queue.get(name) ?? []).filter((other) => other !== entry));
                reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
              });
            });
          }
          return run(win, name, callback);
        },
        query: async () => ({ held: [...held.keys()].map((name) => ({ name })), pending: [...queue].flatMap(([name, list]) => list.map(() => ({ name }))) })
      };
    },
    // The browser lets go of everything a crashed window held or waited for.
    crash(win) {
      for (const [name, list] of queue) queue.set(name, list.filter((entry) => entry.win !== win));
      for (const [name, holder] of [...held]) if (holder === win) releases.get(name)?.();
    }
  };
}

function project() {
  return { id: "w", name: "W", rootId: "root", activeFileId: "f", nodes: {
    root: { id: "root", kind: "folder", name: "W", children: ["f"] },
    f: { id: "f", kind: "file", parentId: "root", name: "notes.md", content: "Hello" } } };
}
const fileText = (win, name = "notes.md") => Object.values(win.project.nodes).find((node) => node.name === name)?.content;

function openWindow(name, locks) {
  const channels = [];
  // Its channels, closed (silent) when it crashes.
  class Channel extends BroadcastChannel {
    constructor(channelName) { super(channelName); channels.push(this); }
  }
  const win = { name, project: project(), channels, dead: false };
  win.link = createTabLink({
    createRuntime,
    getProject: () => win.project,
    replace: (next) => { win.project = next; },
    applyOperation: (clientId, operation) => { win.project = applySyncOperation(win.project, operation); },
    preserveLocalFiles: async () => {},
    locks: locks.forWindow(name),
    Channel
  });
  win.type = (next, file = "notes.md") => {
    const previous = fileText(win, file);
    const id = Object.values(win.project.nodes).find((node) => node.name === file).id;
    win.project = { ...win.project, nodes: { ...win.project.nodes, [id]: { ...win.project.nodes[id], content: next } } };
    win.link.runtime().scheduleTextPatch(file, previous, next);
  };
  win.crash = () => {
    win.dead = true;
    for (const channel of channels) { channel.onmessage = null; channel.close(); }
    locks.crash(name);
  };
  win.close = () => { win.link.follow(null); };
  return win;
}

async function until(check, what, timeout = 8000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  assert.fail(`timed out: ${what}`);
}

test("linked windows: each one's typing reaches the other, concurrent typing converges, a new file appears", async () => {
  const locks = lockManager();
  const a = openWindow("a", locks), b = openWindow("b", locks);
  try {
    a.link.follow("local:w");
    await until(() => a.link.state().leading, "a leads");
    assert.equal(a.link.linked(), false, "alone, a window starts nothing");
    b.link.follow("local:w");
    await until(() => a.link.linked() && b.link.linked(), "b follows a");
    assert.equal(a.link.following(), false);
    assert.equal(b.link.following(), true);

    a.type("Hello from A");
    await until(() => fileText(b) === "Hello from A", "a's typing in b");
    // Both at once, at different places.
    a.type(">> Hello from A");
    b.type("Hello from A, and B");
    await until(() => fileText(a) === fileText(b) && fileText(a) === ">> Hello from A, and B", `converged: "${fileText(a)}" / "${fileText(b)}"`);

    // A new file, made in the follower.
    b.project = applySyncOperation(b.project, { type: "create-file", parentPath: "", name: "b.md", content: "from b" });
    await b.link.runtime().publishOperation({ type: "create-file", parentPath: "", name: "b.md", content: "from b" });
    await until(() => fileText(a, "b.md") === "from b", "b's new file in a");
    await until(() => b.link.others() === 1 && a.link.others() === 1, "each counts the other");
  } finally {
    a.close(); b.close();
    await new Promise((resolve) => setTimeout(resolve, 700));
  }
});

test("linked windows: the leading one crashes, the follower takes over and a new window joins it", async () => {
  const locks = lockManager();
  const a = openWindow("a", locks), b = openWindow("b", locks);
  let c = null;
  try {
    a.link.follow("local:w");
    await until(() => a.link.state().leading, "a leads");
    assert.equal(a.link.linked(), false, "alone, a window starts nothing");
    b.link.follow("local:w");
    await until(() => a.link.linked() && b.link.linked(), "b follows a");
    a.type("Hello, a");
    await until(() => fileText(b) === "Hello, a", "a's typing in b");

    a.crash();
    await until(() => !b.link.following() && b.link.linked(), "b takes over");
    b.type("Hello, a, then b");
    await new Promise((resolve) => setTimeout(resolve, 400));
    assert.equal(fileText(b), "Hello, a, then b");

    c = openWindow("c", locks);
    c.link.follow("local:w");
    await until(() => c.link.linked() && fileText(c) === "Hello, a, then b", "c joins b and has its text");
    c.type("Hello, a, then b, then c");
    await until(() => fileText(b) === "Hello, a, then b, then c", "c's typing in b");
  } finally {
    a.close(); b.close(); c?.close();
    await new Promise((resolve) => setTimeout(resolve, 700));
  }
});

test("linked windows: a change that reached the leading window some other way: a window joining gets it, the other reloads it", async () => {
  const locks = lockManager();
  const a = openWindow("a", locks), b = openWindow("b", locks);
  let c = null;
  try {
    a.link.follow("local:w");
    await until(() => a.link.state().leading, "a leads");
    b.link.follow("local:w");
    await until(() => a.link.linked() && b.link.linked(), "b follows a");
    // Not through the link (none of the app's changes do this; a safety net).
    a.project = { ...a.project, nodes: { ...a.project.nodes, f: { ...a.project.nodes.f, content: "Changed in a only" } } };
    c = openWindow("c", locks);
    c.link.follow("local:w");
    await until(() => c.link.linked() && fileText(c) === "Changed in a only", `c has a's text: "${fileText(c)}"`);
    await until(() => fileText(b) === "Changed in a only", `b reloads it: "${fileText(b)}"`);
    c.type("Changed in a only, then c");
    await until(() => fileText(a) === "Changed in a only, then c" && fileText(b) === "Changed in a only, then c", "c's typing in both");
  } finally {
    a.close(); b.close(); c?.close();
    await new Promise((resolve) => setTimeout(resolve, 700));
  }
});
