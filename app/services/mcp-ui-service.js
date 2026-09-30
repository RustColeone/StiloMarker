import { normalizeServerUrl } from './sync-service.js';

// Optional controls. No request runs until the user loads or tests connections.
export function createMcpControls({ list, status, loadButton, summary, getIdentity, fetchImpl = fetch }) {
  let scope = null, generation = 0, servers = [], selected = new Set(), loading = false, notice = '';
  const checks = new Map();
  let rendered = '';
  function identity() { return getIdentity(); }
  function syncScope() {
    const next = identity()?.scope ?? null;
    if (next !== scope) {
      scope = next; generation += 1; servers = []; selected.clear(); checks.clear(); loading = false; notice = '';
    }
    return next;
  }
  async function request(body, owner) {
    const response = await fetchImpl(`${normalizeServerUrl(owner.serverUrl)}/api/chat/mcp`, {
      method: 'POST', headers: {'content-type':'application/json', Authorization:`Bearer ${owner.token}`},
      body: JSON.stringify(body), signal: AbortSignal.timeout(20000)
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.message || 'Could not check connections.');
    return data;
  }
  function render() {
    syncScope();
    const stamp = JSON.stringify([scope,servers,[...selected],loading,notice,[...checks]]);
    if (stamp === rendered) return;
    rendered = stamp;
    const focusedServer = document.activeElement?.dataset?.mcpServer;
    loadButton.disabled = !scope || loading;
    loadButton.textContent = loading ? 'Loading…' : 'Load connections';
    status.textContent = !scope ? 'Sign in to use the connections provided by your server.'
      : notice || 'Select up to two connections for chat in this workspace. Nothing is enabled by default.';
    list.replaceChildren();
    for (const server of servers) {
      const row = document.createElement('div'); row.className = 'mcp-connection';
      const label = document.createElement('label'); label.className = 'checkbox-row';
      const box = document.createElement('input');box.type = 'checkbox';box.checked = selected.has(server.id);
      box.dataset.mcpServer = server.id;
      box.disabled = !box.checked && selected.size >= 2;
      box.addEventListener('change', () => {
        if (box.checked) selected.add(server.id); else selected.delete(server.id);
        render();
      });
      const title = document.createElement('span');title.textContent = server.label;
      label.append(box,title);
      const test = document.createElement('button');test.type = 'button';test.textContent = 'Test';
      test.setAttribute('aria-label',`Test ${server.label}`);
      test.disabled = checks.get(server.id)?.pending ?? false;
      test.addEventListener('click', () => { void check(server.id); });
      const detail = document.createElement('span');detail.className = 'subtle-label mcp-connection-status';
      detail.textContent = checks.get(server.id)?.message ?? 'Not checked';
      row.append(label,test,detail);list.append(row);
    }
    const labels = servers.filter(s => selected.has(s.id)).map(s => s.label);
    summary.hidden = labels.length === 0;
    summary.textContent = labels.length ? `Connected tools: ${labels.join(', ')}` : '';
    if (focusedServer) [...list.querySelectorAll('input')].find(box => box.dataset.mcpServer === focusedServer)?.focus({preventScroll:true});
  }
  async function load() {
    syncScope();const owner = identity();if (!owner || loading) return;
    const requestGeneration = generation;
    loading = true;notice = '';render();
    try {
      const result = await request({action:'list'},owner);
      if (identity()?.scope !== owner.scope || generation !== requestGeneration) return;
      servers = Array.isArray(result.servers) ? result.servers : [];
      selected = new Set([...selected].filter(id => servers.some(s => s.id === id)));
      notice = result.message || (servers.length ? '' : 'No MCP connections are configured for your account.');
    } catch (error) {
      if (identity()?.scope === owner.scope && generation === requestGeneration) notice = error.name === 'TimeoutError' ? 'Connection check timed out. You can keep using chat.' : error.message;
    } finally {
      if (identity()?.scope === owner.scope && generation === requestGeneration) loading = false;
      render();
    }
  }
  async function check(id) {
    const owner = identity();if (!owner || checks.get(id)?.pending) return;
    const requestGeneration = generation;
    checks.set(id,{pending:true,message:'Checking…'});render();
    try {
      const result = await request({action:'check',servers:[id]},owner);
      if (identity()?.scope !== owner.scope || generation !== requestGeneration) return;
      const item = result.servers?.find(s => s.id === id);
      checks.set(id,{message:item?.ready ? `Ready · ${item.toolCount} read-only tools` : item?.message || 'Connection unavailable.'});
    } catch (error) {
      if (identity()?.scope === owner.scope && generation === requestGeneration) checks.set(id,{message:error.name === 'TimeoutError' ? 'Check timed out.' : error.message});
    } finally { render(); }
  }
  loadButton.addEventListener('click', () => { void load(); });
  return { render, getRequest() {
    syncScope();const owner = identity();
    return owner && selected.size ? {mcpServers:[...selected], accountToken:owner.token} : {};
  }};
}
