// The account this tab is signed in as, and signing in and out. The stored
// username and password are kept by whoever attaches `credentials`:
//   credentials.read()  -> { username, password, proven }
//   credentials.write({ username?, password?, proven? })
import { mayRestore, provenAfterSignIn, provenAfterSignOut } from "../model/credentials.js";

export function createAccount({ api, server, events, log }) {
  let current = null; // { token, username, teams, admin }
  let credentials = { read: () => ({}), write() {} };

  function set(next) {
    current = next ? Object.freeze({ ...next, teams: Object.freeze([...(next.teams ?? [])]) }) : null;
    events.emit("account", { account: current });
  }

  async function signIn(username, password, { isCurrent = () => true } = {}) {
    const name = String(username ?? "").trim();
    if (!name) throw new Error("Username is required.");
    const result = await api.login(name, String(password ?? ""));
    if (!isCurrent()) throw Object.assign(new Error("Session restoration cancelled."), { status: 499 });
    credentials.write({ username: result.username, password, proven: provenAfterSignIn(credentials.read().proven, server.url(), result.username) });
    log(`signed in as ${result.username}`);
    set({ token: result.token, username: result.username, teams: result.teams ?? [], admin: result.admin === true });
    return result;
  }

  return {
    attach(port) { credentials = port; },
    account: () => current,
    token: () => current?.token ?? null,
    signIn,
    // Sign in with the stored password, when this server has seen this account
    // before. Returns the sign-in reply, or null when there is nothing to restore.
    canRestore: () => mayRestore(credentials.read(), server.url()),
    restore(options) {
      const stored = credentials.read();
      return mayRestore(stored, server.url()) ? signIn(stored.username, stored.password, options) : Promise.resolve(null);
    },
    // Signed out on purpose: forget the password and that this server knew the
    // account, so it is not signed in again by itself. The username stays.
    signOut() {
      credentials.write({ password: "", proven: provenAfterSignOut(credentials.read().proven, server.url()) });
      log("signed out");
      set(null);
    },
    // The token stopped working (for example a failed sign-in): forget it only.
    drop() { if (current) set(null); }
  };
}
