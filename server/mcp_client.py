"""Optional, owner-configured MCP read tools. No network work at app startup.

Streamable HTTP only, legacy 2025-11-25 or stateless 2026-07-28. Each chat turn
owns its sessions; credentials, results and connection state are never shared.
"""
import base64
import hashlib
import json
import os
import re
import time
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urlparse
from urllib.request import Request, build_opener, HTTPRedirectHandler

MODERN = '2026-07-28'
LEGACY = ('2025-11-25', '2025-06-18', '2025-03-26')
MAX_BYTES = 1024 * 1024

class MCPError(RuntimeError):
    pass

class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        # Never forward a configured credential to a redirected destination.
        return None

def header_value(value):
    value = str(value)
    if value.strip() != value or any(ord(c) < 32 or ord(c) > 126 for c in value) or (value.startswith('=?base64?') and value.endswith('?=')):
        return '=?base64?' + base64.b64encode(value.encode()).decode() + '?='
    return value

def parameter_headers(schema):
    """Validate all annotations, including annotations in unsupported schema paths."""
    found, names = [], set()
    def walk(node, path=(), reachable=True, depth=0):
        if depth > 32: raise MCPError('Tool schema is too deeply nested.')
        if isinstance(node, list):
            for value in node: walk(value, path, False, depth+1)
        elif isinstance(node, dict):
            if 'x-mcp-header' in node:
                name = node['x-mcp-header']
                if (not path or not reachable or not isinstance(name, str)
                    or not re.fullmatch(r"[!#$%&'*+.^_`|~0-9A-Za-z-]+", name)
                    or name.lower() in names or node.get('type') not in ('string', 'integer', 'boolean')):
                    raise MCPError('Tool has an unsupported parameter header.')
                names.add(name.lower()); found.append((path, name, node['type']))
            for key, value in node.items():
                if key == 'properties' and isinstance(value, dict):
                    for prop, child in value.items(): walk(child, (*path, prop), reachable, depth+1)
                elif isinstance(value, (dict, list)):
                    walk(value, path, False, depth+1)
    walk(schema)
    return found

class MCPClient:
    def __init__(self, config, *, opener=None, cancelled=lambda: False):
        self.config = config
        self.opener = opener or build_opener(NoRedirect())
        self.cancelled = cancelled
        self.version = config.get('protocolVersion', LEGACY[0])
        self.session = None
        self.next_id = 0
        self.schemas = {}
        self.secret = os.environ.get(config.get('tokenEnv', ''), '')
        if config.get('tokenEnv') and not self.secret:
            raise MCPError('The server owner needs to supply the connection credential.')
        if any(ord(c) < 32 or ord(c) > 126 for c in self.secret):
            raise MCPError('The connection credential is invalid.')

    def _read(self, response, request_id, deadline):
        size, buffer, data = 0, b'', []
        sse = response.headers.get('Content-Type', '').split(';')[0].strip() == 'text/event-stream'
        while True:
            if self.cancelled(): raise MCPError('Chat stopped.')
            if time.monotonic() >= deadline: raise MCPError('Connection timed out.')
            chunk = response.read1(4096)
            size += len(chunk)
            if size > MAX_BYTES: raise MCPError('Connection response exceeded the size limit.')
            buffer += chunk
            if not sse:
                if not chunk:
                    try: return json.loads(buffer)
                    except (ValueError, UnicodeError): raise MCPError('Connection returned invalid JSON.') from None
                continue
            # A response can contain notifications before the matching result.
            while b'\n' in buffer or (not chunk and buffer):
                if b'\n' in buffer: line, buffer = buffer.split(b'\n', 1)
                else: line, buffer = buffer, b''
                line = line.rstrip(b'\r')
                if line.startswith(b'data:'): data.append(line[5:].lstrip(b' '))
                if not line and data:
                    try: event = json.loads(b'\n'.join(data))
                    except (ValueError, UnicodeError): raise MCPError('Connection returned an invalid event.') from None
                    data = []
                    if isinstance(event, dict) and event.get('id') == request_id:
                        return event
            if not chunk: raise MCPError('Connection closed before returning a result.')

    def rpc(self, method, params=None, *, notification=False, deadline=None, extra_headers=None):
        if self.cancelled(): raise MCPError('Chat stopped.')
        deadline = deadline or time.monotonic() + 12
        remaining = deadline - time.monotonic()
        if remaining <= 0: raise MCPError('Connection timed out.')
        self.next_id += 1
        request_id = self.next_id
        params = dict(params or {})
        headers = {'Content-Type':'application/json', 'Accept':'application/json, text/event-stream', 'MCP-Protocol-Version':self.version}
        if self.secret: headers['Authorization'] = 'Bearer ' + self.secret
        if self.version == MODERN:
            params['_meta'] = {'io.modelcontextprotocol/protocolVersion': self.version,
                'io.modelcontextprotocol/clientInfo': {'name':'StiloMarker', 'version':'1'},
                'io.modelcontextprotocol/clientCapabilities': {}}
            headers['Mcp-Method'] = method
            if method == 'tools/call': headers['Mcp-Name'] = header_value(params['name'])
            headers.update(extra_headers or {})
        elif self.session:
            headers['Mcp-Session-Id'] = self.session
        payload = {'jsonrpc':'2.0','method':method,'params':params}
        if not notification: payload['id'] = request_id
        request = Request(self.config['url'], data=json.dumps(payload).encode(), headers=headers, method='POST')
        try:
            with self.opener.open(request, timeout=min(8, remaining)) as response:
                if method == 'initialize':
                    session = response.headers.get('Mcp-Session-Id')
                    if session and (len(session)>256 or any(ord(c)<33 or ord(c)>126 for c in session)):
                        raise MCPError('Connection returned an invalid session.')
                    self.session = session
                if notification: return {}
                result = self._read(response, request_id, deadline)
        except HTTPError as error:
            code = error.code; error.close()
            raise MCPError(f'Connection returned HTTP {code}.') from None
        except (URLError, OSError, TimeoutError):
            raise MCPError('Connection unavailable or timed out.') from None
        if not isinstance(result, dict) or result.get('jsonrpc') != '2.0' or result.get('id') != request_id:
            raise MCPError('Connection returned a mismatched response.')
        if 'error' in result: raise MCPError('The connected tool reported a protocol error.')
        value = result.get('result')
        if not isinstance(value, dict): raise MCPError('Connection returned an invalid result.')
        if value.get('inputRequests'): raise MCPError('This tool requires interactive authorization, which is not supported yet.')
        return value

    def tools(self, deadline):
        if self.version != MODERN:
            init = self.rpc('initialize', {'protocolVersion':self.version,'capabilities':{},
                'clientInfo':{'name':'StiloMarker','version':'1'}}, deadline=deadline)
            version = init.get('protocolVersion')
            if version not in LEGACY: raise MCPError('Unsupported MCP protocol version.')
            self.version = version
            self.rpc('notifications/initialized', notification=True, deadline=deadline)
            capabilities = init.get('capabilities')
            if not isinstance(capabilities, dict) or not isinstance(capabilities.get('tools'), dict):
                raise MCPError('Connection does not provide tools.')
        allowed = set(self.config['allowedTools'])
        cursor, seen, accepted = None, set(), []
        for _ in range(8):
            result = self.rpc('tools/list', {'cursor':cursor} if cursor else {}, deadline=deadline)
            tools = result.get('tools')
            if not isinstance(tools, list): raise MCPError('Connection returned an invalid tool list.')
            for tool in tools:
                if not isinstance(tool, dict): continue
                name = tool.get('name'); schema = tool.get('inputSchema')
                if (not isinstance(name, str) or name not in allowed or name in self.schemas
                    or not isinstance(tool.get('annotations'), dict)
                    or tool['annotations'].get('readOnlyHint') is not True
                    or not isinstance(schema, dict) or schema.get('type') != 'object'
                    or len(json.dumps(schema)) > 16000): continue
                try: headers = parameter_headers(schema) if self.version == MODERN else []
                except MCPError: continue
                self.schemas[name] = headers
                accepted.append({'name':name, 'description':str(tool.get('description', name))[:1500], 'inputSchema':schema})
                if len(accepted)>=20: return accepted
            cursor = result.get('nextCursor')
            if not cursor: return accepted
            if not isinstance(cursor, str) or cursor in seen: raise MCPError('Connection returned a repeated page cursor.')
            seen.add(cursor)
        raise MCPError('Connection tool list exceeded the page limit.')

    def call(self, name, arguments):
        if name not in self.schemas: raise MCPError('Tool is not enabled.')
        if not isinstance(arguments, dict) or len(json.dumps(arguments)) > 16000:
            raise MCPError('Invalid tool arguments.')
        headers = {}
        for path, label, kind in self.schemas[name]:
            value = arguments
            for part in path:
                value = value.get(part) if isinstance(value, dict) else None
            if value is None: continue
            valid = ((kind=='string' and isinstance(value,str)) or (kind=='boolean' and isinstance(value,bool))
                or (kind=='integer' and type(value) is int and abs(value)<=2**53-1))
            if not valid: raise MCPError('Invalid tool parameter header value.')
            headers['Mcp-Param-'+label] = header_value(str(value).lower() if kind=='boolean' else value)
        return self.rpc('tools/call', {'name':name,'arguments':arguments}, extra_headers=headers)

    def close(self):
        if not self.session: return
        headers = {'Mcp-Session-Id': self.session, 'MCP-Protocol-Version':self.version}
        if self.secret: headers['Authorization'] = 'Bearer '+self.secret
        self.session = None
        try:
            with self.opener.open(Request(self.config['url'],headers=headers,method='DELETE'),timeout=2): pass
        except (OSError, URLError): pass

class MCPTurn:
    def __init__(self, configs, *, progress=None, cancelled=lambda: False, factory=MCPClient):
        self.clients, self.routes, self.tools, self.statuses = [], {}, [], []
        self.calls, self.remaining_chars = 0, 30000
        self.cancelled = cancelled
        deadline = time.monotonic()+12
        for config in configs:
            if cancelled(): break
            status = {'id':config['id'],'label':config['label'],'ready':False,'toolCount':0}
            if progress: progress({'type':'mcp-status','server':config['label'],'message':'Checking connected tools…'})
            try:
                client = factory(config, cancelled=cancelled); self.clients.append(client)
                tools = client.tools(deadline)
                for tool in tools:
                    alias = 'mcp_'+config['id']+'_'+hashlib.sha256(tool['name'].encode()).hexdigest()[:16]
                    self.routes[alias] = (client, tool['name'], config['label'])
                    self.tools.append({'type':'function','function':{'name':alias,
                        'description':f"Read-only tool from {config['label']}: {tool['description']}", 'parameters':tool['inputSchema']}})
                status.update(ready=bool(tools),toolCount=len(tools),message='Ready' if tools else 'No approved read-only tools were found.')
            except MCPError as error: status['message'] = str(error)
            except (ValueError, TypeError, AttributeError, RecursionError): status['message'] = 'Connection returned invalid tool metadata.'
            self.statuses.append(status)
            if progress and not status['ready']: progress({'type':'mcp-status','server':config['label'],'message':status['message']})

    def describe(self, alias):
        _, name, label = self.routes[alias]
        return {'name':name,'server':label,'target':''}

    def call(self, alias, arguments):
        if self.cancelled(): raise MCPError('Chat stopped.')
        if self.calls >= 8 or self.remaining_chars <= 0: return {'isError':True,'message':'Connected tool budget reached.'}
        self.calls += 1
        client, name, label = self.routes[alias]
        try:
            result = client.call(name, arguments)
            parts = []
            content = result.get('content', [])
            if not isinstance(content, list): raise MCPError('Tool returned invalid content.')
            for item in content:
                if not isinstance(item, dict): continue
                if item.get('type') == 'text': parts.append(str(item.get('text','')))
                elif item.get('type') == 'resource' and isinstance(item.get('resource'),dict):
                    parts.append(str(item['resource'].get('text','[Non-text resource omitted]')))
                else: parts.append('[Non-text content omitted]')
            if 'structuredContent' in result: parts.append(json.dumps(result['structuredContent'],ensure_ascii=False))
            text = '\n'.join(parts)
            limit = min(16000,self.remaining_chars)
            truncated = len(text)>limit
            self.remaining_chars -= min(len(text),limit)
            return {'source':label,'tool':name,'isError':bool(result.get('isError')),
                'content':text[:limit], 'truncated':truncated}
        except MCPError as error: return {'source':label,'tool':name,'isError':True,'message':str(error)}
        except (ValueError, TypeError, AttributeError, RecursionError):
            return {'source':label,'tool':name,'isError':True,'message':'Tool returned an invalid result.'}

    def close(self):
        for client in self.clients: client.close()

class MCPManager:
    def __init__(self, config_path=None, *, static_root=None):
        self.configs, self.error = {}, None
        path = config_path if config_path is not None else os.environ.get('MDNOTES_MCP_CONFIG','')
        if not path: return
        try:
            path = Path(path).resolve()
            if static_root and path.is_relative_to(Path(static_root).resolve()):
                raise ValueError('MCP configuration must be outside the web root.')
            with path.open('rb') as file: data=file.read(65537)
            if len(data)>65536: raise ValueError('MCP configuration is too large.')
            servers=json.loads(data).get('servers')
            if not isinstance(servers,list) or len(servers)>8: raise ValueError('Expected up to eight MCP servers.')
            configs={}
            for server in servers:
                if not isinstance(server,dict): raise ValueError('Invalid MCP server entry.')
                sid=server.get('id','');url=server.get('url','');parsed=urlparse(url)
                if not re.fullmatch('[a-z][a-z0-9_-]{0,23}',sid) or sid in configs: raise ValueError('Invalid or duplicate MCP server id.')
                if parsed.scheme not in ('http','https') or not parsed.hostname or parsed.username or parsed.password or parsed.fragment:
                    raise ValueError('MCP server requires an HTTP(S) URL without embedded credentials or fragment.')
                if server.get('protocolVersion',LEGACY[0]) not in (*LEGACY,MODERN): raise ValueError('Unsupported configured MCP protocol.')
                for field in ('allowedTools','teams'):
                    if not isinstance(server.get(field),list) or not server[field] or not all(isinstance(x,str) and x for x in server[field]):
                        raise ValueError('MCP servers require explicit tools and teams.')
                if 'tokenEnv' in server and not re.fullmatch('[A-Za-z_][A-Za-z0-9_]*',server['tokenEnv']): raise ValueError('Invalid credential environment name.')
                configs[sid]={**server,'label':str(server.get('label',sid))[:80]}
            self.configs=configs
        except (OSError,ValueError,TypeError,AttributeError,RecursionError):
            self.error='MCP configuration could not be loaded. Ask the server owner to check the configuration file.'

    def visible(self, identity):
        teams=set(identity.get('teams',[]))
        return [config for config in self.configs.values() if teams.intersection(config['teams'])]

    def select(self, ids, identity):
        if not isinstance(ids,list) or len(ids)>2 or not all(isinstance(x,str) for x in ids):
            raise ValueError('Select at most two MCP connections.')
        visible={c['id']:c for c in self.visible(identity)}
        if any(sid not in visible for sid in ids): raise PermissionError('An MCP connection is not available to this account.')
        return [visible[sid] for sid in dict.fromkeys(ids)]
