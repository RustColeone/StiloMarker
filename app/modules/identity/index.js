// Identity and access (browser): the account this tab is signed in as,
// signing in and out (and in again by itself where it has before), and who
// may open a project. The server's half is server/stilo/modules/identity.
//
// API:
//   attach({ read, write })        where the username and password are kept
//                                  (Shell's settings, from the start; adapters/stored-sign-in.js)
//   account() -> { token, username, teams, admin } | null      token() -> string | null
//   signIn(username, password, { isCurrent }) -> the server's reply
//   canRestore()   restore({ isCurrent }) -> reply | null
//   signOut()      drop()
//   events: "account" { account }   signed in, out, or dropped
// Settings → Accounts (adapters/admin-page.js), for an admin: the server's
// accounts, their teams and admins, added, changed and removed.
// Static: participantColor(clientId), a person's colour in a session (model/colors.js).
import { defineModule } from "../../kernel/index.js";

export { participantColor } from "./model/colors.js";
import { createIdentityApi } from "./adapters/api.js";
import { createAccount } from "./service/account.js";
import { signInSettings } from "./adapters/stored-sign-in.js";
import { addAdminPage } from "./adapters/admin-page.js";

export default defineModule({
  name: "identity",
  level: 2,
  uses: ["shell"],
  owns: { state: ["the signed-in account", "stored sign-in"], events: ["account"] },
  start(ctx) {
    const { server } = ctx.use("shell");
    const api = createIdentityApi(server);
    const events = ctx.emitter();
    const account = createAccount({ api, server, events, log: (message) => ctx.log(message) });
    const { settings } = ctx.use("shell");
    if (settings) account.attach(signInSettings(settings));
    const shell = ctx.use("shell");
    if (globalThis.document && shell.settingsDialog) {
      const page = addAdminPage({ shell, account, api });
      events.on("account", ({ account: signedIn }) => page?.showFor(signedIn));
    }
    return { ...account, events: { on: events.on } };
  }
});
