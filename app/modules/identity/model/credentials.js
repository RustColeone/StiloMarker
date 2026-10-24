// When this browser may sign an account in again without asking: only to a
// server where that same username has signed in before, and only while it
// keeps that server's token (or, from a page before v0.3.1, the password,
// used once). `proven` maps a server address to the username that last
// signed in there; signing out forgets that server's entry.

export function mayRestore(stored, server) {
  const proven = stored?.proven?.[server];
  return Boolean(proven && proven === stored.username && (stored.token || stored.password));
}

export function provenAfterSignIn(proven, server, username) {
  return { ...(proven ?? {}), [server]: username };
}

export function provenAfterSignOut(proven, server) {
  const { [server]: _dropped, ...rest } = proven ?? {};
  return rest;
}
