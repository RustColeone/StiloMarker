// The Log's command line (under the log, like a terminal under its output): a
// command run by typing its name, or part of it, with suggestions as one
// types (model/command-search.js). Arrow keys choose, Enter runs, Tab
// completes, Escape closes the list (then clears the line); a suggestion runs
// on a click or tap too. Focused with nothing typed, it lists every command,
// Reload Window first; "help" or "?" finds the command that lists them in the
// log. What ran goes into the log, and what went wrong.
import { searchCommands } from "../model/command-search.js";
import { chordLabel } from "../model/keys.js";

const FIRST = ["shell.reload-window", "shell.list-commands"];
const MAX_RECENT = 8;

// commands: Shell's registry; run(id): Shell's; log(kind, message, detail);
// showAll(): the log's All tab, so what a command did shows.
export function createCommandLine({ commands, run, log, showAll, doc = globalThis.document }) {
  const input = doc?.getElementById("log-command-input");
  const list = doc?.getElementById("log-suggestions");
  if (!input || !list) return { focus() {} };
  const mac = /Mac|iPhone|iPad/.test(globalThis.navigator?.platform ?? "");
  const recent = [];
  let items = [];
  let chosen = 0;
  // Enter with nothing typed runs a suggestion only once one was chosen with the arrows.
  let picked = false;

  const typed = () => (input.value.trim() === "?" ? "help" : input.value);

  function open() {
    items = searchCommands(commands.all(), typed(), { recent, first: FIRST });
    chosen = Math.min(chosen, Math.max(0, items.length - 1));
    draw();
  }

  function close() {
    list.hidden = true;
    input.setAttribute("aria-expanded", "false");
    input.removeAttribute("aria-activedescendant");
  }

  function draw() {
    list.replaceChildren();
    if (!items.length) {
      const empty = doc.createElement("div");
      empty.className = "log-suggestion is-empty";
      empty.textContent = `No command matches “${input.value.trim()}”. Type help to list them all.`;
      list.append(empty);
    }
    items.forEach((item, index) => {
      const row = doc.createElement("div");
      row.id = `log-suggestion-${index}`;
      row.className = "log-suggestion";
      row.classList.toggle("is-chosen", index === chosen);
      row.classList.toggle("is-disabled", !item.enabled);
      row.classList.toggle("is-danger", item.danger);
      row.setAttribute("role", "option");
      row.setAttribute("aria-selected", String(index === chosen));
      row.title = item.id;
      const title = doc.createElement("span");
      title.className = "log-suggestion-title";
      title.textContent = item.title;
      const keys = doc.createElement("span");
      keys.className = "log-suggestion-keys";
      keys.textContent = item.keys.map((text) => chordLabel(text, mac)).join("  ");
      row.append(title, keys);
      // The line keeps the focus (a tap would take it), then the click runs it.
      row.addEventListener("mousedown", (event) => event.preventDefault());
      row.addEventListener("click", () => { chosen = index; void runChosen(); });
      list.append(row);
    });
    list.hidden = false;
    input.setAttribute("aria-expanded", "true");
    if (items.length) input.setAttribute("aria-activedescendant", `log-suggestion-${chosen}`);
    list.querySelector(".is-chosen")?.scrollIntoView?.({ block: "nearest" });
  }

  function remember(id) {
    const at = recent.indexOf(id);
    if (at >= 0) recent.splice(at, 1);
    recent.unshift(id);
    recent.length = Math.min(recent.length, MAX_RECENT);
  }

  async function runChosen() {
    const item = items[chosen];
    if (!item) {
      if (input.value.trim()) log("failed", `No command matches “${input.value.trim()}”`, "Type help to list them all.");
      return;
    }
    input.value = "";
    chosen = 0;
    picked = false;
    close();
    showAll();
    log("action", `> ${item.title}`, item.id);
    remember(item.id);
    if (!item.enabled) {
      log("failed", `${item.title} is not available now`);
      return;
    }
    try {
      // Done says nothing more (as in a terminal); a command says what it did itself.
      if (!await run(item.id)) log("failed", `${item.title} is not available now`);
    } catch (error) {
      log("failed", `${item.title} failed`, error?.message ?? String(error));
    }
  }

  input.addEventListener("keydown", (event) => {
    if (event.isComposing) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (list.hidden) { open(); return; }
      if (!items.length) return;
      chosen = (chosen + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
      picked = true;
      draw();
    } else if (event.key === "Enter") {
      event.preventDefault();
      if (!input.value.trim() && !picked) return;
      if (list.hidden) items = searchCommands(commands.all(), typed(), { recent, first: FIRST });
      void runChosen();
    } else if (event.key === "Tab" && !list.hidden && items[chosen]) {
      event.preventDefault();
      input.value = items[chosen].title;
      open();
    } else if (event.key === "Escape") {
      // The line's own: a menu or the phone's sheet must not close with it.
      event.preventDefault();
      event.stopPropagation();
      if (!list.hidden) close();
      else if (input.value) input.value = "";
      else input.blur();
    }
  });
  input.addEventListener("input", () => { chosen = 0; picked = false; open(); });
  input.addEventListener("focus", () => open());
  input.addEventListener("blur", close);

  return {
    // Run Command… (F1): the line focused, its list open.
    focus() { input.focus(); }
  };
}

// Help: List Commands — every command typed here can run, in the log.
export function listCommands({ commands, log, mac = /Mac|iPhone|iPad/.test(globalThis.navigator?.platform ?? "") }) {
  const all = searchCommands(commands.all(), "");
  log("response", `${all.length} commands (type part of a name in the line below)`);
  for (const item of all) {
    const keys = item.keys.map((text) => chordLabel(text, mac)).join(", ");
    log("response", item.title, [item.id, keys, item.enabled ? "" : "not available now"].filter(Boolean).join(" · "));
  }
}
