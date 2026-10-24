// Identity's messages to the server (server/stilo/modules/identity/adapters/routes.py):
// signing in (with a password, or again with the token kept) and out, and an admin's accounts. A project's access list is read and set
// by Cloud (Projects' routes).
export function createIdentityApi(server) {
  return {
    login: (username, password) => server.request("/api/auth/login", {
      method: "POST", body: { username, password }, failure: "Login failed.", timeout: 15000
    }),
    signedIn: (token) => server.request("/api/auth/me", { query: { token }, failure: "Could not sign in again.", timeout: 15000 }),
    logout: (token) => server.request("/api/auth/logout", { method: "POST", query: { token }, failure: "Could not sign out on the server." }),
    listAccounts: (token) => server.request("/api/accounts", { query: { token }, failure: "Could not read the accounts." }),
    // { action: "add" | "password" | "teams" | "admin" | "remove", username, password?, teams?, admin? }
    changeAccount: (token, change) => server.request("/api/accounts", {
      method: "POST", query: { token }, body: change, failure: "The account was not changed.", timeout: 15000
    })
  };
}
