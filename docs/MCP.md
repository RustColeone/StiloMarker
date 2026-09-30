# Connected tools for in-app chat

StiloMarker can use selected **read-only MCP tools** during an agent chat turn. This feature is optional. With no `MDNOTES_MCP_CONFIG`, the app makes no MCP requests and the existing chat works as before. It does not participate in workspace loading, syncing, or reconnecting.

## Set up a connection

1. Run an MCP server with a Streamable HTTP endpoint reachable from the StiloMarker **backend**. Choose a server you trust: its `readOnlyHint` is a declaration by that server, not proof that the implementation cannot modify data.
2. Put a JSON file outside the StiloMarker web root, readable by the service account. For example, `~/.config/stilomarker/mcp.json`:

   ```json
   {
     "servers": [{
       "id": "reference",
       "label": "Reference library",
       "url": "https://mcp.example.net/mcp",
       "protocolVersion": "2025-11-25",
       "tokenEnv": "MCP_REFERENCE_TOKEN",
       "allowedTools": ["search_notes", "read_note"],
       "teams": ["friends"]
     }]
   }
   ```

3. Set `MDNOTES_MCP_CONFIG` to the absolute path of that file in the StiloMarker service environment. Set `MCP_REFERENCE_TOKEN` there if the endpoint needs a bearer token. Restart the service. Keep both values out of the served checkout. The token remains on the backend; a browser gets only the connection ID and label.
4. Sign in to an account in an allowed team. Open **Settings → Agent → Connected tools (MCP)**, select **Load connections**, optionally **Test** a connection, and select up to two. The selection applies to the current account and workspace in this browser tab. It is off by default and clears when the account or workspace changes.

`allowedTools` and `teams` must be explicit, nonempty lists. The provider must advertise each approved tool with `annotations.readOnlyHint: true` and an object input schema. A connection may be listed but report no available tools if it does not. `protocolVersion` is explicit; it defaults to `2025-11-25` and may also be `2025-06-18`, `2025-03-26`, or `2026-07-28`. The latter uses the stateless transport and header metadata defined by that version. Configure at most eight connections; the chat can select two per turn. HTTP is permitted for a trusted private-network server, but HTTPS is recommended when traffic crosses networks. Redirects are rejected so credentials are never forwarded to a different endpoint.

When selected, the provider receives the model's tool arguments, which may contain search terms or relevant excerpts from the chat. Tool results are shown to the model as untrusted reference material. Calls have size, count, and time limits; unavailable connections are reported in chat activity and do not stop ordinary workspace chat. The existing workspace tools remain available for reading and proposing file edits. The MCP bridge currently supports Streamable HTTP tools returning text or structured content. It does not support local stdio servers, resources/prompts, browser OAuth, interactive authorization, or MCP write tools.

Protocol references: [2025 Streamable HTTP transport](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports), [2026 Streamable HTTP transport](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/main/docs/specification/2026-07-28/basic/transports/streamable-http.mdx).

## Checks

Run `python3 -B tests/mcp-client.test.py` for socket-free protocol, access, and agent integration regressions. `tests/mcp-browser.py` exercises the controls and opt-in request on the public origin with API routes mocked; it does not touch a real project or MCP server. A live provider still needs a real endpoint and credential to be configured by the server owner.
