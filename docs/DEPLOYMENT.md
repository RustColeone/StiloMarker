# Deployment and releases

The current installation runs `stilomarker.service` behind nginx. The Python
backend serves static files directly from its working checkout: editing that
checkout publishes frontend files immediately, even before the backend restarts.
Prepare and test a release in a separate directory before copying it into place.

## Release numbering

- `v0.1.12`: app release, following `MAJOR.MINOR.PATCH`.
- `SYNC_PROTOCOL_VERSION` / `MIN_CLIENT_VERSION`: numeric sync compatibility.
  Keep the wire field `version` numeric so old clients remain safely rejected.
  Ordinary app releases do not need a protocol increment.
- Document S.E.N labels and workspace revisions are separate and unchanged.

Use `node tools/release-version.mjs 0.1.13` to set the next app release and
`node tools/release-version.mjs --check` to verify all release labels agree.

## Coordinated deployment

1. Run the frontend tests and `python3 -B tests/server-reliability.test.py` in
   staging. `npm run test:reliability` runs focused regressions without an HTTP
   listener. The full HTTP smoke test is a separate check.
2. Back up the source release and deployment configuration outside the web root.
   Stop `stilomarker.service`, then copy `server/data` and the legacy session
   state to a private backup directory for a consistent data backup.
3. Copy the tested release files into the service checkout. Preserve runtime
   data, account whitelist, and environment configuration.
4. Start `stilomarker.service`. Check `systemctl is-active stilomarker.service`
   and the public site's `/api/ping`: `appVersion` must match the release and
   `minSyncVersion` must match the intended compatibility floor.
5. Verify public JavaScript assets, the service-worker cache label, and sync in
   a temporary guest workspace. Never use a real writing project for smoke tests.

The service restart briefly disconnects tabs. They reconnect; incompatible old
clients are asked to reload. A conflicting local draft is kept in Snapshots under
“Recovery: local edits before cloud reload” before loading the cloud version.

For rollback, stop the service before restoring a known code release. Keep the
current data unless recovery requires a data restore: restoring the backup also
removes edits made since that backup. Old code cannot replay the new
`.pending-state.json` recovery journal, so complete any pending journal with the
new backend before reverting the backend implementation.
