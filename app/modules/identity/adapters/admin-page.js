// Settings → Accounts, for an admin signed in to a server with accounts: who
// has an account, their teams and who is an admin; add an account, set a
// password or the teams, make or unmake an admin, remove one. The server
// keeps the rules (the last admin stays) and says why a change is refused;
// what it answers is drawn. Hidden for everyone else.
const ID = "accounts";

export function addAdminPage({ shell, account, api, doc = globalThis.document }) {
  if (!doc || !shell.settingsDialog) return null;
  // A page of the Settings dialog, beside the others (their panels are in index.html).
  const panel = doc.createElement("div");
  panel.id = "settings-panel-accounts";
  panel.className = "settings-tab-panel";
  panel.hidden = true;
  const body = doc.createElement("section");
  body.className = "settings-section accounts-admin";
  panel.append(body);
  doc.querySelector(".settings-tab-panels")?.append(panel);
  body.innerHTML = `
    <h3>Accounts</h3>
    <p class="subtle-label">Accounts on this server. Passwords are kept hashed; a new one needs at least 8 characters.</p>
    <div class="accounts-admin-actions"><button type="button" class="find-btn" data-act="add">Add Account…</button></div>
    <table class="accounts-admin-table">
      <thead><tr><th>Account</th><th>Teams</th><th>Admin</th><th></th></tr></thead>
      <tbody></tbody>
    </table>
    <p class="accounts-admin-status subtle-label" aria-live="polite"></p>`;
  const rows = body.querySelector("tbody");
  const status = body.querySelector(".accounts-admin-status");
  let accounts = [];

  function draw() {
    const me = account.account()?.username;
    rows.replaceChildren(...accounts.map((row) => {
      const tr = doc.createElement("tr");
      tr.dataset.username = row.username;
      const name = doc.createElement("td");
      name.textContent = row.username + (row.username === me ? " (you)" : "");
      if (!row.hashed) name.title = "Its password is kept as typed: set a new one, or run server/accounts.py convert.";
      const teams = doc.createElement("td");
      teams.textContent = row.teams.join(", ") || "–";
      const admin = doc.createElement("td");
      const box = doc.createElement("input");
      box.type = "checkbox";
      box.checked = row.admin;
      box.setAttribute("aria-label", `${row.username} is an admin`);
      box.addEventListener("change", () => void change({ action: "admin", username: row.username, admin: box.checked }, () => { box.checked = row.admin; }));
      admin.append(box);
      const actions = doc.createElement("td");
      const buttons = doc.createElement("div");
      buttons.className = "accounts-admin-row-actions";
      actions.append(buttons);
      for (const [label, act] of [["Password…", "password"], ["Teams…", "teams"], ["Remove", "remove"]]) {
        const button = doc.createElement("button");
        button.type = "button";
        button.className = "find-btn";
        button.dataset.act = act;
        button.textContent = label;
        button.addEventListener("click", () => void rowAction(act, row));
        buttons.append(button);
      }
      tr.append(name, teams, admin, actions);
      return tr;
    }));
  }

  // A change sent; the accounts as the server then has them drawn, or why not said.
  async function change(request, undo = () => {}) {
    try {
      accounts = (await api.changeAccount(account.token(), request)).accounts ?? accounts;
      status.textContent = "";
      draw();
      return true;
    } catch (error) {
      undo();
      status.textContent = error.message;
      return false;
    }
  }

  async function rowAction(act, row) {
    if (act === "password") {
      const values = await shell.form({ eyebrow: "Accounts", title: `New Password for ${row.username}`, submitLabel: "Set Password",
        fields: [{ name: "password", label: "Password", type: "password" }] });
      if (values && await change({ action: "password", username: row.username, password: values.password })) shell.toast(`${row.username}'s password changed.`);
    } else if (act === "teams") {
      const value = await shell.input({ title: `Teams of ${row.username}`, label: "Teams (separated by commas)", value: row.teams.join(", "), submitLabel: "Save" });
      if (value !== null) await change({ action: "teams", username: row.username, teams: value.split(",").map((team) => team.trim()).filter(Boolean) });
    } else if (await shell.confirm({ title: "Remove Account", message: `Remove ${row.username}? They are signed out at once; their projects stay.`, acceptLabel: "Remove", danger: true })) {
      await change({ action: "remove", username: row.username });
    }
  }

  body.querySelector('[data-act="add"]').addEventListener("click", async () => {
    const values = await shell.form({ eyebrow: "Accounts", title: "Add Account", submitLabel: "Add",
      fields: [{ name: "username", label: "Name" }, { name: "password", label: "Password", type: "password" },
        { name: "teams", label: "Teams (separated by commas)", placeholder: "red, blue" }] });
    if (!values) return;
    const teams = String(values.teams ?? "").split(",").map((team) => team.trim()).filter(Boolean);
    if (await change({ action: "add", username: values.username, password: values.password, teams })) shell.toast(`Added ${values.username.trim()}.`);
  });

  async function load() {
    try {
      accounts = (await api.listAccounts(account.token())).accounts ?? [];
      status.textContent = "";
    } catch (error) {
      accounts = [];
      status.textContent = error.message;
    }
    draw();
  }

  shell.settingsDialog.addPage({ id: ID, label: "Accounts", order: 60, body: panel, shown: (visible) => { if (visible) void load(); } });
  const showFor = (signedIn) => shell.pages.available("settings", ID, Boolean(signedIn?.admin));
  showFor(account.account());
  return { showFor, load };
}
