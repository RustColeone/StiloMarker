// The account this tab is signed in as, and signing in and out. The stored
// sign-in (the username and the token the server gave, never the password)
// is kept by whoever attaches `credentials`:
//   credentials.read()  -> { username, token, password, proven }   (password: only as a page before v0.3.1 left it)
//   credentials.write({ username?, token?, password?, proven? })
import { ignored } from "../../../kernel/index.js";
import { mayRestore, provenAfterSignIn, provenAfterSignOut } from "../model/credentials.js";

const cancelled = () => Object.assign(new Error("Session restoration cancelled."), { status: 499 });

export function createAccount({ api, server, events, log }) {
  let current = null; // { token, username, teams, admin }
  let credentials = { read: () => ({}), write() {} };

  function set(next) {
    current = next ? Object.freeze({ ...next, teams: Object.freeze([...(next.teams ?? [])]) }) : null;
    events.emit("account", { account: current });
  }

  // The token kept for next time, and the password (if a page before v0.3.1 kept one) no longer.
  function keep(result) {
    credentials.write({ username: result.username, token: result.token, password: "",
      proven: provenAfterSignIn(credentials.read().proven, server.url(), result.username) });
    set({ token: result.token, username: result.username, teams: result.teams ?? [], admin: result.admin === true });
  }

  async function signIn(username, password, { isCurrent = () => true } = {}) {
    const name = String(username ?? "").trim();
    if (!name) throw new Error("Username is required.");
    const result = await api.login(name, String(password ?? ""));
    if (!isCurrent()) throw cancelled();
    keep(result);
    log(`signed in as ${result.username}`);
    return result;
  }

  // Signed in again with the token kept (the server keeps its sign-ins, so a
  // restart ends none). A page from before v0.3.1 kept the password instead:
  // it signs in with it once, and keeps the token from then on. A token the
  // server no longer takes (signed out elsewhere, a new password, 30 days
  // unused) is forgotten: the account signs in again by hand.
  async function restore({ isCurrent = () => true } = {}) {
    const stored = credentials.read();
    if (!mayRestore(stored, server.url())) return null;
    if (!stored.token) return signIn(stored.username, stored.password, { isCurrent });
    let result;
    try {
      result = await api.signedIn(stored.token);
    } catch (error) {
      if (![401, 403].includes(error.status)) throw error;
      credentials.write({ token: "" });
      log("the kept sign-in has ended");
      return null;
    }
    if (!isCurrent()) throw cancelled();
    keep({ ...result, token: stored.token });
    log(`signed in again as ${result.username}`);
    return { ...result, token: stored.token };
  }

  return {
    attach(port) { credentials = port; },
    account: () => current,
    token: () => current?.token ?? null,
    signIn,
    // Sign in again by itself, when this server has seen this account before
    // and its token is kept. Returns the sign-in reply, or null when there is
    // nothing to restore (or the kept sign-in has ended).
    canRestore: () => mayRestore(credentials.read(), server.url()),
    restore,
    // Signed out on purpose: the server ends the token too, and this browser
    // forgets it and that this server knew the account, so it is not signed in
    // again by itself. The username stays.
    signOut() {
      const token = current?.token ?? credentials.read().token;
      if (token) void api.logout(token).catch(ignored("ending the sign-in on the server failed (offline?); this browser forgets it anyway"));
      credentials.write({ token: "", password: "", proven: provenAfterSignOut(credentials.read().proven, server.url()) });
      log("signed out");
      set(null);
    },
    // The token stopped working (for example a failed sign-in): forget it only.
    drop() { if (current) set(null); }
  };
}
