import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";

import { loadModules } from "./helpers/mocks.mjs";

const { projectModel, syncService } = await loadModules();

function startSyncServer() {
  const server = createServer((request, response) => {
    if (request.url === "/api/ping" && request.method === "GET") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ message: "pong", transport: "sse-text-ops" }));
      return;
    }

    if (request.url === "/api/session/connect" && request.method === "POST") {
      let body = "";
      request.on("data", (chunk) => {
        body += chunk;
      });
      request.on("end", () => {
        const payload = JSON.parse(body || "{}");
        if (payload.pin !== "2468") {
          response.writeHead(403, { "content-type": "application/json" });
          response.end(JSON.stringify({ message: "bad pin" }));
          return;
        }
        response.writeHead(200, { "content-type": "application/json" });
        response.end(
          JSON.stringify({
            message: "connected",
            token: "good-token",
            clientId: "client-a",
            displayName: payload.displayName || "Peer a",
            revision: 0,
            sessionId: "default"
          })
        );
      });
      return;
    }

    if (request.url === "/api/session/state?token=good-token" && request.method === "GET") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          project: projectModel.createProject("Server"),
          revision: 0,
          presence: [{ clientId: "client-a", displayName: "Peer a" }],
          sessionId: "default"
        })
      );
      return;
    }

    if (request.url === "/api/session/state?token=good-token" && request.method === "POST") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ message: "state stored", revision: 1 }));
      return;
    }

    if (request.url === "/api/operations?token=good-token" && request.method === "POST") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ message: "operation stored", revision: 2 }));
      return;
    }

    response.writeHead(404, { "content-type": "text/plain" });
    response.end("not found");
  });
  return server;
}

test("sync-service: ping, connect, fetch, push state and operations", async () => {
  const syncServer = startSyncServer();
  const port = await new Promise((resolvePort) => {
    syncServer.listen(0, () => resolvePort(syncServer.address().port));
  });
  const serverUrl = `http://127.0.0.1:${port}`;

  try {
    const pingResult = await syncService.pingServer(serverUrl);
    assert.equal(pingResult.message, "pong");
    assert.equal(pingResult.transport, "sse-text-ops");

    const connectResult = await syncService.connectToServer(serverUrl, "2468", "Tester");
    assert.equal(connectResult.token, "good-token");
    assert.equal(connectResult.displayName, "Tester");

    const stateResult = await syncService.fetchSessionState(serverUrl, connectResult.token);
    assert.equal(stateResult.revision, 0);
    assert.equal(stateResult.sessionId, "default");

    const pushResult = await syncService.pushSessionState(serverUrl, connectResult.token, projectModel.createProject("Push"));
    assert.equal(pushResult.revision, 1);

    const operationResult = await syncService.pushOperation(serverUrl, connectResult.token, {
      type: "patch-file",
      path: "docs/readme.md",
      start: 0,
      end: 0,
      removedText: "",
      text: "# New\n"
    });
    assert.equal(operationResult.revision, 2);
  } finally {
    await new Promise((resolveClose) => syncServer.close(resolveClose));
  }
});
