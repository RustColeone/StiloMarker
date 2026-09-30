// App releases use major.minor.patch. This is independent of sync compatibility.
// Update release versions with: node tools/release-version.mjs 0.1.13
export const APP_VERSION = "0.1.13";
// Monotonic wire compatibility level; bump only when old sync clients must stop.
export const SYNC_PROTOCOL_VERSION = 113;
