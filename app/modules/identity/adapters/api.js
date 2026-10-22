// Identity's messages to the server (server/stilo/modules/identity/adapters/routes.py):
// signing in, and an admin's accounts. A project's access list is read and set
// by Cloud (Projects' routes).
export function createIdentityApi(server) {
  return {
    login: (username, password) => server.request("/api/auth/login", {
      method: "POST", body: { username, password }, failure: "Login failed.", timeout: 15000
    }),
    listAccounts: (token) => server.request("/api/accounts", { query: { token }, failure: "Could not read the accounts." }),
    // { action: "add" | "password" | "teams" | "admin" | "remove", username, password?, teams?, admin? }
    changeAccount: (token, change) => server.request("/api/accounts", {
      method: "POST", query: { token }, body: change, failure: "The account was not changed.", timeout: 15000
    })
  };
}
