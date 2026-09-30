# Deployment and releases

The current installation runs `stilomarker.service` behind nginx. The Python
backend serves static files directly from its working checkout: editing that
checkout publishes frontend files immediately, even before the backend restarts.
Prepare and test a release in a separate directory before copying it into place.

## Release numbering

- `v0.1.17`: app release, following `MAJOR.MINOR.PATCH`.
- `SYNC_PROTOCOL_VERSION` / `MIN_CLIENT_VERSION`: numeric sync compatibility.
  Keep the wire field `version` numeric so old clients remain safely rejected.
  Ordinary app releases do not need a protocol increment.
- Document S.E.N labels and workspace revisions are separate and unchanged.

Use `node tools/release-version.mjs 0.1.18` to set the next app release and
`node tools/release-version.mjs --check` to verify all release labels agree.

## Coordinated deployment

1. Run the frontend tests and `python3 -B tests/server-reliability.test.py` and `python3 -B tests/mcp-client.test.py` in
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

## Verified release: v0.1.12

Deployed on 2026-09-22 at 18:25 UTC. `stilomarker.service` was restarted and
`https://stilomarker.ngantech.net/api/ping` reported `appVersion: 0.1.12` and
`minSyncVersion: 112`. Public frontend assets matched the tested checkout.

Validation: 78 non-network Node tests and 12 Python reliability tests passed
(including the existing broker regression checks). An isolated guest workspace
on the public domain passed SSE, emoji-patch, stale-write, old-client, and
whole-project-write checks. Its stream was closed afterward; no persistent
writing project was opened or modified by these checks.

Private deployment backup:
`/home/laplacengan/backups/stilomarker/20260922T182556Z-v0.1.12`.
It contains pre-release source/configuration and a stopped-service data backup
with nine validated project manifests. Keep it outside the web root.


## Verified release: v0.1.13

Deployed on 2026-09-22 at 19:23 UTC. Public ping reports app release `0.1.13`
and sync compatibility `113`; eight frontend assets matched the staged release.
Old sync clients must reload because insertion transforms and acknowledgment
handling changed together.

Validation: 101 socket-free Node tests and 19 Python reliability tests passed.
Coverage includes two production clients against the Python broker over stdio,
continued typing behind in-flight patches, both HTTP/SSE acknowledgment orders,
2,025 short splice pairs, storage errors, collapsed folders, and UI save handlers.

A temporary guest workspace on the public domain passed two-client SSE,
same-position insert convergence, complete operation acknowledgments, emoji,
replacement/rename barriers, invalid bases, removed-text validation, and old-client
rejection. Its streams were closed afterward. No persistent writing project was
opened by the smoke test. Browser UI/OPFS behavior was exercised with test adapters,
not a live browser automation session.

Private deployment backup:
`/home/laplacengan/backups/stilomarker/20260922T192326Z-v0.1.13`.
The service was stopped for the data backup and coordinated code copy; nine
project manifests were validated. Settings and deployment configuration were
preserved.


## Verified release: v0.1.14

Deployed on 2026-09-23 at 05:39 UTC. Public ping reports app release `0.1.14`
and sync compatibility `114`; twelve public assets matched the deployed release.
Existing tabs must reload to use revision-checked chat writes and agent edits.

Validation: 118 socket-free Node tests and 25 Python reliability tests passed.
Chromium browser checks at five mobile/tablet viewport sizes passed against the
public origin with staged assets and isolated, mocked chat requests. Coverage
includes mobile Enter and IME input, attached-file context, thread drafts,
streaming scroll/selection, touch targets, and workspace isolation. Physical iOS
keyboard behavior has not yet been verified.

Public API checks in a temporary guest workspace passed two-client document SSE,
concurrent inserts, emoji offsets, replacement/rename barriers, stale operation
rejection, and old-client rejection. Chat checks confirmed stale saves preserve
messages, both clients receive ordered chat updates, merged retries succeed,
missing revisions and old clients are rejected, and chat revisions are independent
of document revisions. A stale agent delete was rejected. No persistent writing
project was opened or modified by these checks; both guest streams were closed.

Chat history now persists atomically in a separate `chat.json` sidecar for saved
workspaces (and a `.chat.json` sidecar for legacy session storage). Include these
files in backups. Composer drafts, selection, and attachments remain device-local.

Private deployment backup:
`/home/laplacengan/backups/stilomarker/20260923T053908Z-v0.1.14`.
The service was stopped for the coordinated backup and code copy; nine project
manifests were validated. Existing settings and deployment configuration were
preserved. MCP integration remains a separate follow-up.


## Verified release: v0.1.15

Deployed on 2026-09-25 at 00:54 UTC. Public ping reports app release `0.1.15`
and unchanged sync compatibility `114`; twelve public assets matched the release.
This frontend polish release preserves the chat provider, security preferences,
and sync behavior. Reload open tabs to load the updated shell.

Validation: all 118 socket-free Node tests passed. The existing chat browser suite
and new mobile navigation suite both passed at five viewport sizes with isolated
storage and mocked APIs. Checks include touch sizes, short-screen menus/dialogs,
Find/Replace, editor caret and IME preservation during resize, swipe cancellation,
multitouch, reversal, rapid navigation, diagram/scroll gesture ownership, chat
collapse, and desktop preference preservation. Physical-device testing is deferred.

Public guest checks passed document SSE/convergence and stale-write safeguards,
chat conflict rejection and peer propagation, and stale agent edit rejection.
No persistent writing projects were opened or changed. The service is active with
no traceback logged since deployment.

Private deployment backup:
`/home/laplacengan/backups/stilomarker/20260925T005422Z-v0.1.15`.
The service was stopped for the backup and coordinated copy; nine project
manifests were validated. The backup includes chat sidecars where present.


## Verified release: v0.1.16

Deployed on 2026-09-30 at 04:42 UTC. Public ping reports app release `0.1.16`
and unchanged sync compatibility `114`; fourteen public frontend assets matched
this release. Reload existing tabs once to load the recovery fixes. Security and
account settings are unchanged; MCP connections remain deferred.

Validation: 129 socket-free JavaScript tests and 25 Python reliability tests
passed. The existing chat and mobile navigation browser suites passed at five
viewport sizes. The new session recovery suite passed against staged assets and
again against the actual deployed frontend, using isolated mocked accounts and
workspace data. It covers offline startup, retry without a Resume click, root-path
Resume, apparently connected empty views, silent stream recovery, duplicate
foreground events, newer cloud text without stale writes, suspension persistence,
expired account sessions plus temporary login failure, and logout during a pending
login. No browser runtime errors were reported.

The public temporary-guest smoke also passed document and chat sync/conflict
checks. Saved writing projects were not opened or changed. The service is active,
with no traceback logged since deployment.

Private deployment backup:
`/home/laplacengan/backups/stilomarker/20260930T044239Z-v0.1.16`.
The service was stopped for the backup and coordinated copy; nine project
manifests were validated. Chat sidecars were included where present.
