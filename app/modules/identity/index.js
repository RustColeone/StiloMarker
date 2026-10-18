// Identity and access (browser): the account this tab is signed in as,
// signing in and out (and in again by itself where it has before), and who
// may open a project. The server's half is server/stilo/modules/identity.
//
// API:
//   attach({ read, write })        where the username and password are kept
//   account() -> { token, username, teams } | null      token() -> string | null
//   signIn(username, password, { isCurrent }) -> the server's reply
//   canRestore()   restore({ isCurrent }) -> reply | null
//   signOut()      drop()
//   getAccess(team, path)   setAccess(team, path, whitelist, blacklist)
//   events: "account" { account }   signed in, out, or dropped
// Static: participantColor(clientId), a person's colour in a session (model/colors.js).
import { defineModule } from "../../kernel/index.js";

export { participantColor } from "./model/colors.js";
import { createIdentityApi } from "./adapters/api.js";
import { createAccount } from "./service/account.js";

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
    const signedIn = () => {
      const token = account.token();
      if (!token) throw new Error("Sign in first.");
      return token;
    };
    return {
      ...account,
      getAccess: async (team, path) => api.getAccess(signedIn(), team, path),
      setAccess: async (team, path, whitelist, blacklist) => api.setAccess(signedIn(), team, path, whitelist, blacklist),
      events: { on: events.on }
    };
  }
});
