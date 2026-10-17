// When this browser may sign an account in again without asking: only to a
// server where that same username has signed in before, and only while a
// password is stored. `proven` maps a server address to the username that
// last signed in there; signing out forgets that server's entry.

export function mayRestore(stored, server) {
  const proven = stored?.proven?.[server];
  return Boolean(proven && proven === stored.username && stored.password);
}

export function provenAfterSignIn(proven, server, username) {
  return { ...(proven ?? {}), [server]: username };
}

export function provenAfterSignOut(proven, server) {
  const { [server]: _dropped, ...rest } = proven ?? {};
  return rest;
}
