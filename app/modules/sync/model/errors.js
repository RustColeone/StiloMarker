// What a failed request means for the session. Pure.

// The server refuses an out-of-date tab (426) so it cannot overwrite newer work.
export function isUpgradeError(error) {
  return error?.status === 426 || error?.payload?.upgradeRequired === true;
}

// The account token is dead (usually a server restart: tokens live in memory).
// A fresh session token cannot help; only signing in again can.
export function isAuthExpiredError(error) {
  return error?.status === 401 || error?.status === 403 || /not logged in|invalid or expired/i.test(error?.message ?? "");
}

// A refused operation is not a broken connection. A 400/404/409 refuses one
// change (a stale path after a rename, say); tearing the session down for it
// silently stopped all syncing. Only network, sign-in and server failures end it.
export function isFatalSyncError(error) {
  const status = Number(error?.status);
  if (!Number.isFinite(status)) return true;
  if (status === 401 || status === 403) return true;
  return status >= 500;
}
