// Identity's message to the server (server/stilo/modules/identity/adapters/routes.py):
// signing in. A project's access list is read and set by Cloud (Projects' routes).
export function createIdentityApi(server) {
  return {
    login: (username, password) => server.request("/api/auth/login", {
      method: "POST", body: { username, password }, failure: "Login failed.", timeout: 15000
    })
  };
}
