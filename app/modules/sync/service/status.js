// This tab's session as the rest of the app sees it, with one owner (Sync):
// whether it is connected, what to tell the user, who else is here, and what
// the server last said it offers. Read through a live view (sync.status);
// Sync updates it from the session, and the code that pings the server or
// reconnects says what happened with status.change({ … }).
export const SESSION_STATUS = {
  status: "offline",           // offline | reachable | connected | reconnecting | sync-error | upgrade-required
  detail: "No server checked yet.",
  presence: [],                // who is in the session
  sessionId: null,
  revision: 0,
  displayName: null,
  clientId: null,
  role: null,                  // master | client | reader
  // Whether the last-pinged server has accounts and hosting.
  accountsAvailable: false,
  hostingAvailable: false
};

// What the session's own report changes. An out-of-date tab only learns that
// it is out of date (and why); everything else stays as it was.
export function statusFromSession(next) {
  if (next.status === "upgrade-required") return { status: next.status, detail: next.detail };
  return {
    status: next.status,
    detail: next.detail,
    presence: next.presence ?? [],
    sessionId: next.sessionId,
    revision: next.revision ?? 0,
    displayName: next.displayName ?? null,
    clientId: next.clientId ?? null,
    role: next.role ?? null
  };
}
