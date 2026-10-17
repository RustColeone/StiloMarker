// The team's trash (protocol/history.contract.json): deleted cloud projects
// and folders, kept with their history for a number of days and then removed
// by the server. Its owner can restore one, or remove it sooner. The dialog is
// made on first use; History owns it.
const DAY = 86400 * 1000;

export function createTrash({ shell, identity }) {
  const send = (path, options) => shell.server.request(path, { ...options, query: { token: identity.token(), ...options.query } });
  const list = (team) => send("/api/trash", { query: { team }, failure: "Could not read the trash." });
  const restore = (team, id) => send("/api/trash/restore", { method: "POST", body: { team, id }, failure: "Could not restore it." });
  const remove = (team, id) => send("/api/trash/delete", { method: "POST", body: { team, id }, failure: "Could not remove it." });

  let view = null;
  function makeView() {
    const dialog = document.createElement("dialog");
    dialog.id = "trash-dialog";
    dialog.className = "app-dialog";
    dialog.innerHTML = `<form method="dialog" class="app-dialog-form">
        <header class="dialog-header"><div><div class="eyebrow"></div><h2>Trash</h2></div>
          <p class="subtle-label trash-note"></p></header>
        <div class="trash-list" role="list"></div>
        <menu class="dialog-actions"><button value="close" type="submit">Close</button></menu>
      </form>`;
    document.body.append(dialog);
    const pick = (selector) => dialog.querySelector(selector);
    return { dialog, team: pick(".eyebrow"), note: pick(".trash-note"), list: pick(".trash-list") };
  }

  function describe(entry, now) {
    const what = entry.kind === "folder" ? "Folder" : entry.kind === "history" ? "History only" : "Project";
    const when = new Date(entry.deletedAt).toLocaleDateString(undefined, { day: "numeric", month: "short" });
    const left = Math.max(0, Math.ceil((entry.expiresAt - now) / DAY));
    const by = entry.deletedBy ? ` by ${entry.deletedBy}` : "";
    return `${what} · deleted${by} on ${when} · ${left === 0 ? "goes today" : `${left} day${left === 1 ? "" : "s"} left`}`;
  }

  function button(label, run, danger = false) {
    const element = document.createElement("button");
    element.type = "button";
    element.className = `browser-tool-btn${danger ? " is-danger" : ""}`;
    element.textContent = label;
    element.addEventListener("click", run);
    return element;
  }

  async function render(team, onChange) {
    const { days, entries } = await list(team);
    view.note.textContent = `Deleted projects and folders stay here for ${days} days, then they are removed for good. Only a project's owner can restore it.`;
    const now = Date.now();
    view.list.replaceChildren(...entries.map((entry) => {
      const row = document.createElement("div");
      row.className = "trash-row";
      row.setAttribute("role", "listitem");
      row.dataset.trashId = entry.id;
      const text = document.createElement("div");
      text.className = "trash-text";
      text.innerHTML = "<strong></strong><span class=\"subtle-label\"></span>";
      text.querySelector("strong").textContent = entry.path;
      text.querySelector("span").textContent = describe(entry, now);
      const actions = document.createElement("div");
      actions.className = "trash-actions";
      if (entry.restorable) actions.append(button("Restore", () => act(async () => {
        const restored = await restore(team, entry.id);
        shell.toast(restored.path === entry.path ? `Restored ${restored.path}` : `Restored as ${restored.path}`);
      })));
      if (entry.removable) actions.append(button("Delete now", () => act(async () => {
        if (!await shell.confirm({ title: "Delete for good", message: `Remove ${entry.path} and its history now? This cannot be undone.`, acceptLabel: "Delete" })) return;
        await remove(team, entry.id);
      }), true));
      row.append(text, actions);
      return row;
    }));
    if (!entries.length) {
      const empty = document.createElement("p");
      empty.className = "subtle-label";
      empty.textContent = "The trash is empty.";
      view.list.append(empty);
    }
    async function act(run) {
      try {
        await run();
        onChange?.();
        await render(team, onChange);
      } catch (error) {
        shell.notify(error.message);
      }
    }
  }

  // Shows the trash of `team`; onChange() runs after something was restored or removed.
  async function open(team, { onChange } = {}) {
    view ??= makeView();
    view.team.textContent = `Team ${team}`;
    try {
      await render(team, onChange);
      if (!view.dialog.open) view.dialog.showModal();
    } catch (error) {
      shell.notify(error.message);
    }
  }

  return { open, list, restore, remove };
}
