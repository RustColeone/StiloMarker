// Identity's messages to the server (server/stilo/modules/identity/adapters/routes.py).
export function createIdentityApi(server) {
  return {
    login: (username, password) => server.request("/api/auth/login", {
      method: "POST", body: { username, password }, failure: "Login failed.", timeout: 15000
    }),
    getAccess: (token, team, path) => server.request("/api/workspaces/access", {
      query: { token, team, path }, failure: "Could not read access list."
    }),
    setAccess: (token, team, path, whitelist, blacklist) => server.request("/api/workspaces/access", {
      method: "POST", query: { token }, body: { team, path, whitelist, blacklist }, failure: "Could not update access list."
    })
  };
}
