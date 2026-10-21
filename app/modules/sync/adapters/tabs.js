// The windows of this browser on one of its own workspaces, kept live
// together ("Live in both", O1 of the stability review). One window (the
// first; the next when it goes) puts their edits in order (service/broker.js)
// and alone keeps this browser's copy; the others follow it as devices follow
// the server, each through its own sync runtime (service/runtime.js), over a
// BroadcastChannel. A Web Lock decides who leads: the browser lets go of it
// when a window closes or crashes, and the window waiting next takes over
// from its copy of the broker (it follows every change). A window alone on a
// workspace only holds the lock and listens: its broker starts when another
// window asks for it. Without Web Locks or BroadcastChannel (an old
// browser), windows are not linked.
//
//   createTabLink({ createRuntime, getProject, replace, applyOperation,
//     preserveLocalFiles, onChange, onSaved, onTakeOver, log, locks?, Channel?, clock? })
//     onTakeOver(): this window keeps the workspace now (the one that did
//     went): this browser's copy is this window's to write, all of it.
//     applyOperation(clientId, operation): another window's change, to this
//     window's project (the runtime's); the broker applies changes to its own
//     copy of the project itself (Workspace's applySyncOperation).
//   follow(key)       the copy this window is on (a "local:" key), or null: off the link
//   runtime()         this window's runtime on the link (scheduleTextPatch, publishOperation…)
//   linked()          on the link and connected (leading or following)
//   following()       another window leads: this one keeps no copy
//   others()          how many other windows are on the link
//   savedRevision()   (following) the revision the leading window last saved
//   saved(project)    (leading) this browser's copy of `project` was written
//   flush()           typing waiting to go, sent now (the page is going)
//   state()           { linked, leading, others, waiting } for the status bar
import { createBroker } from "../service/broker.js";
import { applySyncOperation, getPath } from "../../workspace/index.js";
import { ignore, ignored } from "../../../kernel/index.js";

const LOCK = "mdnotes-link:";
const CHANNEL = "mdnotes-link:";
const CALL_TIMEOUT = 4000;
const OPEN_DELAYS = [250, 1000, 2000, 4000, 8000, 15000];
const BUFFER = 200;          // the latest changes heard, replayed to a stream that opens after them
const DRAIN_MS = 50;         // a window taking over first hears what the last one said
const COUNT_EVERY = 3000;    // how often the windows on the link are counted
const LOCK_ANSWER = 3000;    // a browser that never answers for the lock: this window is not linked

const unavailable = (message) => Object.assign(new Error(message), { status: 503 });
const epochOf = (token) => String(token ?? "").split("|")[0];

// Each file's text, by path: what a broker and a window must agree on.
function contents(project) {
  return JSON.stringify(Object.values(project?.nodes ?? {}).filter((node) => node.kind === "file")
    .map((node) => [getPath(project, node.id), node.content ?? ""]).sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)));
}

// The project as the broker keeps it: without what belongs to one window
// (folder handles, the index of a folder on disk).
function shareable(project) {
  const { handles, sourceIndex, ...rest } = project ?? {};
  return structuredClone(rest);
}

export function createTabLink({ createRuntime, getProject, replace, applyOperation, preserveLocalFiles, onChange = () => {}, onSaved = () => {},
  onTakeOver = () => {}, log = () => {}, locks = globalThis.navigator?.locks, Channel = globalThis.BroadcastChannel,
  clock = { setTimeout: (fn, ms) => setTimeout(fn, ms), clearTimeout: (id) => clearTimeout(id), hidden: () => false } }) {
  const supported = Boolean(locks?.request && Channel);
  const tabId = `win-${Math.random().toString(36).slice(2, 10)}`;
  let link = null;
  let status = "offline";
  let nextCall = 0;

  // Said only when it changes (a window alone says nothing, again and again).
  let said = "";
  const changed = () => {
    const now = state();
    const text = JSON.stringify(now);
    if (text === said) return;
    said = text;
    onChange(now);
  };
  // A message to the other windows (a closed channel says nothing).
  const post = (current, message) => {
    try { current.channel.postMessage(message); } catch (error) { ignore(error, "the channel is closed: the window is leaving"); }
  };
  const state = () => ({ linked: linked(), leading: Boolean(link?.leading), others: link?.others ?? 0, waiting: Boolean(link) && !linked() });
  const linked = () => Boolean(link) && status === "connected";

  // ---- What the runtime sends, as to a server: to this window's broker
  // when it leads, else over the channel to the window that does.
  const api = {
    openWorkspaceSession: () => call("open"),
    fetchSessionState: async (url, token) => {
      const current = link;
      const result = await call("state", {}, token);
      // A follower keeps its own copy of the broker, to take over from.
      if (current && link === current && !current.leading) {
        current.mirror = createBroker({ project: structuredClone(result.project), revision: result.revision, applyOperation: applySyncOperation });
      }
      return result;
    },
    pushSessionState: (url, token, project, baseRevision) => call("replace", { project: shareable(project), baseRevision }, token),
    pushOperation: (url, token, operation) => call("operation", { operation }, token),
    pushCursor: async () => true,
    renewSessionLease: async () => {},
    leaveSession: () => {},
    openEventStream: (url, token, onEvent, onError) => openStream(token, onEvent, onError),
    connectToServer: () => Promise.reject(new Error("Linked windows have no server.")),
    hostSession: () => Promise.reject(new Error("Linked windows have no server.")),
    uploadAsset: () => Promise.reject(new Error("Linked windows have no server."))
  };

  const runtime = createRuntime({
    getProject,
    replaceProject: (project) => replace(project),
    applyOperation,
    preserveLocalFiles,
    onStatusChange(next) {
      status = next.status;
      changed();
    },
    onRemoteCursor: () => {},
    onHostCounters: () => {},
    onPatchConfirmed: () => {},
    onEvent: () => {},
    reauthenticate: async () => null,
    uploadAsset: api.uploadAsset,
    clock,
    api
  });

  // The window that leads is known: now, or once it says so.
  function leader(current) {
    if ((current.leading && current.broker) || (!current.leading && current.epoch)) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const timer = clock.setTimeout(() => {
        current.waiters = current.waiters.filter((waiter) => waiter !== done);
        reject(unavailable("The other window did not answer."));
      }, CALL_TIMEOUT);
      const done = () => { clock.clearTimeout(timer); resolve(); };
      current.waiters.push(done);
      post(current, { kind: "who" });
    });
  }

  async function call(method, args = {}, token = null) {
    const current = link;
    if (!current) throw unavailable("Not linked with other windows.");
    if (current.leading && !current.broker) throw unavailable("No other window is on this workspace.");
    await leader(current);
    if (link !== current) throw unavailable("Not linked with other windows.");
    if (token && epochOf(token) !== current.epoch) throw unavailable("The window that keeps the workspace changed.");
    // Leading: answered here (copied, so the broker and this window share nothing).
    if (current.leading) return structuredClone(serve(current, tabId, method, structuredClone(args)));
    return new Promise((resolve, reject) => {
      const id = ++nextCall;
      const timer = clock.setTimeout(() => {
        current.pending.delete(id);
        reject(unavailable("The other window did not answer."));
      }, CALL_TIMEOUT);
      current.pending.set(id, { resolve, reject, timer });
      post(current, { kind: "call", epoch: current.epoch, from: tabId, id, method, args });
    });
  }

  // ---- Leading: the broker answers every window.
  function serve(current, from, method, args) {
    const broker = current.broker;
    if (method === "open") {
      return { token: `${current.epoch}|${from}`, clientId: from, displayName: from, revision: broker.revision(),
        sessionId: current.key, workspace: current.key, role: "master" };
    }
    if (method === "state") {
      keepInStep(current);
      const { project, revision } = current.broker.state();
      return { project, revision, presence: [] };
    }
    if (method === "operation") {
      const event = broker.apply(from, args.operation);
      emit(current, event);
      return event;
    }
    if (method === "replace") {
      const event = broker.replace(from, args.project, args.baseRevision);
      emit(current, event);
      return { revision: event.revision };
    }
    throw Object.assign(new Error(`Unknown request: ${method}`), { status: 400 });
  }

  // A window joins (or reloads the workspace): the broker must hold what this
  // window shows. A change that reached this window's project some other way
  // than the link (none should) would leave the broker behind, and a window
  // joining or taking over would take its older text: the broker starts again
  // from this window's project, a revision on, and the others reload it.
  function keepInStep(current) {
    const project = getProject();
    const files = Object.values(project?.nodes ?? {}).filter((node) => node.kind === "file");
    if (files.some((node) => runtime.hasUnsyncedText(getPath(project, node.id)))) return; // its own typing is on its way
    if (contents(current.broker.state().project) === contents(project)) return;
    log("The linked workspace was behind this window: it starts again from this window's copy");
    current.broker = createBroker({ project: shareable(project), revision: current.broker.revision() + 1, applyOperation: applySyncOperation });
    const { project: fresh, revision } = current.broker.state();
    emit(current, { type: "state", clientId: tabId, revision, project: fresh });
  }

  // A change, to every window: this one's streams, and the others'.
  function emit(current, event) {
    remember(current, current.epoch, event);
    for (const stream of [...current.streams]) if (stream.epoch === current.epoch) stream.onEvent(structuredClone(event));
    post(current, { kind: "event", epoch: current.epoch, event });
  }

  function remember(current, epoch, event) {
    current.heard.push({ epoch, event });
    if (current.heard.length > BUFFER) current.heard.shift();
  }

  function openStream(token, onEvent, onError) {
    const current = link;
    const stream = { epoch: epochOf(token), onEvent, onError, close() { current?.streams.delete(stream); } };
    if (!current || stream.epoch !== current.epoch) {
      queueMicrotask(() => onError?.(unavailable("The window that keeps the workspace changed.")));
      return stream;
    }
    current.streams.add(stream);
    // What was said between the copy fetched and now (the runtime drops what it has).
    const heard = current.heard.filter((entry) => entry.epoch === stream.epoch).map((entry) => entry.event);
    queueMicrotask(() => { for (const event of heard) if (current.streams.has(stream)) stream.onEvent(structuredClone(event)); });
    return stream;
  }

  // ---- The channel: requests to the window that leads, its answers and changes.
  function heardOn(current, data) {
    if (link !== current || !data || typeof data !== "object") return;
    if (data.kind === "who") {
      // Another window wants to join: the broker starts, if it hasn't.
      if (current.leading) start(current);
      return;
    }
    if (data.kind === "call") {
      if (!current.leading || !current.broker) return;
      const answer = (reply) => post(current, { kind: "reply", to: data.from, id: data.id, ...reply });
      if (data.epoch !== current.epoch) { answer({ error: { message: "The window that keeps the workspace changed.", status: 503 } }); return; }
      try {
        answer({ result: serve(current, data.from, data.method, data.args ?? {}) });
      } catch (error) {
        answer({ error: { message: error.message, status: error.status ?? 500 } });
      }
      return;
    }
    if (data.kind === "reply") {
      if (data.to !== tabId) return;
      const waiting = current.pending.get(data.id);
      if (!waiting) return;
      current.pending.delete(data.id);
      clock.clearTimeout(waiting.timer);
      if (data.error) waiting.reject(Object.assign(new Error(data.error.message), { status: data.error.status }));
      else waiting.resolve(data.result);
      return;
    }
    if (data.kind === "leader") {
      if (current.leading || data.epoch === current.epoch) return;
      current.epoch = data.epoch;
      const waiters = current.waiters;
      current.waiters = [];
      waiters.forEach((done) => done());
      // A stream to the window that led before has ended.
      for (const stream of [...current.streams]) if (stream.epoch !== data.epoch) stream.onError?.(unavailable("Another window keeps the workspace now."));
      changed();
      return;
    }
    if (data.kind === "event") {
      if (current.leading || data.epoch !== current.epoch) return;
      remember(current, data.epoch, data.event);
      if (current.mirror && !current.mirror.follow(structuredClone(data.event))) {
        log("This window's copy of the linked workspace fell out of step; taking over would start afresh");
        current.mirror = null;
      }
      for (const stream of [...current.streams]) if (stream.epoch === data.epoch) stream.onEvent(data.event);
      return;
    }
    if (data.kind === "saved") {
      if (current.leading || data.epoch !== current.epoch) return;
      current.savedRevision = Math.max(current.savedRevision, Number(data.revision) || 0);
      onSaved();
    }
  }

  // ---- Joining, leading, leaving.
  async function open(current) {
    for (let attempt = 0; link === current && !runtime.isConnected(); attempt += 1) {
      try {
        await runtime.openWorkspace(`tabs:${current.key}`, tabId, "tabs", current.key, { device: tabId, reason: current.leading ? "lead" : "follow" });
        return;
      } catch (error) {
        if (link !== current) return;
        log(`Linking with the other windows failed (${error.message}); trying again`);
        await new Promise((resolve) => clock.setTimeout(resolve, OPEN_DELAYS[Math.min(attempt, OPEN_DELAYS.length - 1)]));
      }
    }
  }

  // This window holds the lock: it leads. Taking over from a window that
  // went (this one followed it), the broker starts at once, from the copy
  // this window kept; first on the workspace, only once another window asks.
  function lead(current) {
    return new Promise((release) => {
      // What the window that led last said is heard first.
      clock.setTimeout(() => {
        if (link !== current) { release(); return; }
        current.release = release;
        current.leading = true;
        current.epoch = `${tabId}.${Date.now().toString(36)}`;
        for (const [id, waiting] of current.pending) {
          clock.clearTimeout(waiting.timer);
          waiting.reject(unavailable("This window keeps the workspace now."));
          current.pending.delete(id);
        }
        if (runtime.isConnected()) {
          log("This window keeps the linked workspace now (the one that did went)");
          onTakeOver();
          start(current);
          for (const stream of [...current.streams]) if (stream.epoch !== current.epoch) stream.onError?.(unavailable("This window keeps the workspace now."));
          void runtime.resumeConnection().catch(ignored("taking over: reconnecting to this window's own broker failed"));
        }
        void count(current);
        changed();
      }, DRAIN_MS);
    });
  }

  // The broker, started once: from the copy of it this window kept as it
  // followed; out of step (or none), from this window's project, a revision
  // on when it followed (the others then reload it). Said to every window.
  function start(current) {
    if (!current.broker) {
      const following = runtime.isConnected();
      current.broker = current.mirror
        ?? createBroker({ project: shareable(getProject()), revision: following ? runtime.getRevision() + 1 : 0, applyOperation: applySyncOperation });
      current.mirror = null;
      if (!following) {
        log("Another window opened this workspace: this one keeps it and puts their edits in order");
        void open(current);
      }
    }
    post(current, { kind: "leader", epoch: current.epoch });
    const waiters = current.waiters;
    current.waiters = [];
    waiters.forEach((done) => done());
  }

  async function count(current) {
    try {
      const { pending = [], held = [] } = await locks.query();
      const name = LOCK + current.key;
      const waiting = pending.filter((lock) => lock.name === name).length;
      const leading = held.some((lock) => lock.name === name) ? 1 : 0;
      if (link === current) {
        current.others = current.leading ? waiting : Math.max(0, waiting + leading - 1);
        changed();
      }
    } catch (error) {
      ignore(error, "the windows on the link could not be counted");
    }
  }

  function follow(key) {
    if (!supported || (link?.key ?? null) === (key ?? null)) return;
    leave();
    if (!key) return;
    const current = { key, channel: new Channel(CHANNEL + key), epoch: null, leading: false, broker: null, mirror: null, others: 0,
      streams: new Set(), pending: new Map(), waiters: [], heard: [], savedRevision: 0, release: null, stop: new AbortController(), counter: null };
    link = current;
    current.channel.onmessage = (event) => heardOn(current, event.data);
    // Counted while linked (a window alone, leading with no broker, has no one to count).
    current.counter = setInterval(() => { if (current.broker || !current.leading) void count(current); }, COUNT_EVERY);
    // No answer for the lock (a browser that keeps it from this page): not
    // linked, and this window keeps its copy itself, as before links.
    const unanswered = clock.setTimeout(() => {
      if (link !== current || current.answered) return;
      log("The browser did not answer for the lock that links windows: this window is not linked");
      leave();
    }, LOCK_ANSWER);
    locks.request(LOCK + key, { ifAvailable: true }, (lock) => {
      current.answered = true;
      clock.clearTimeout(unanswered);
      if (link !== current) return undefined;
      if (lock) return lead(current);
      // Another window leads: follow it, and wait to take over when it goes.
      void open(current);
      locks.request(LOCK + key, { signal: current.stop.signal }, () => (link === current ? lead(current) : undefined))
        .catch((error) => { if (error?.name !== "AbortError") ignore(error, "waiting to take over the linked workspace failed"); });
      void count(current);
      return undefined;
    }).catch(ignored("the lock that decides which window leads could not be asked for"));
    changed();
  }

  // Off the link (another workspace, or a shared one): typing still waiting
  // is sent first; the lock is let go of (the next window takes over).
  function leave() {
    const current = link;
    if (!current) return;
    flush();
    link = null;
    current.stop.abort();
    clearInterval(current.counter);
    for (const waiting of current.pending.values()) { clock.clearTimeout(waiting.timer); waiting.reject(unavailable("Left the linked windows.")); }
    current.pending.clear();
    runtime.disconnect("Left the linked windows.");
    // What was just sent goes out before the channel closes and the lock goes.
    clock.setTimeout(() => { current.channel.close(); current.release?.(); }, 500);
    changed();
  }

  function flush() {
    if (link && runtime.isConnected()) runtime.flushPatches?.();
  }

  return {
    follow,
    runtime: () => (link ? runtime : null),
    linked,
    following: () => Boolean(link) && !link.leading,
    others: () => link?.others ?? 0,
    savedRevision: () => link?.savedRevision ?? 0,
    saved(project) {
      const current = link;
      if (!current?.leading || !current.broker || !linked() || project !== getProject()) return;
      post(current, { kind: "saved", epoch: current.epoch, revision: runtime.getRevision() });
    },
    flush,
    state,
    supported
  };
}
