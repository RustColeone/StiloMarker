"""Socket-free MCP transport, scoping, tool loop and failure regressions."""
import copy, importlib.util, io, json, os, sys, tempfile, time, unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
from urllib.error import HTTPError
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'server'))
import mcp_client as mcp
import mdnotes_server as server

CONFIG={'id':'library','label':'Reference library','url':'https://tools.example.invalid/mcp','allowedTools':['search'],'teams':['friends'],'tokenEnv':'TEST_MCP_KEY'}
TOOL={'name':'search','description':'Search reference notes','inputSchema':{'type':'object','properties':{'query':{'type':'string'}}},'annotations':{'readOnlyHint':True}}
class Response(io.BytesIO):
 def __init__(self,payload,headers=None):
  super().__init__(payload if isinstance(payload,bytes) else json.dumps(payload).encode());self.headers=headers or {'Content-Type':'application/json'}
class Opener:
 def __init__(self,fn=None):self.requests=[];self.fn=fn;self.deleted=0
 def open(self,request,timeout):
  self.requests.append(request)
  if request.method=='DELETE':self.deleted+=1;return Response(b'')
  payload=json.loads(request.data);method=payload['method']
  if self.fn:
   result=self.fn(request,payload)
   if result is not None:return result
  if method=='initialize':return Response({'jsonrpc':'2.0','id':payload['id'],'result':{'protocolVersion':'2025-11-25','capabilities':{'tools':{}}}}, {'Content-Type':'application/json','Mcp-Session-Id':'per-turn-session'})
  if method=='notifications/initialized':return Response(b'')
  result={'tools':[copy.deepcopy(TOOL)]} if method=='tools/list' else {'content':[{'type':'text','text':'Reference: https://example.invalid/source'}]}
  return Response({'jsonrpc':'2.0','id':payload['id'],'result':result})
class MCPTests(unittest.TestCase):
 def setUp(self):
  self.env=patch.dict(os.environ,{'TEST_MCP_KEY':'mcp-test-secret','MDNOTES_MCP_CONFIG':''});self.env.start();self.addCleanup(self.env.stop)
 def client(self,opener=None,**extra):return mcp.MCPClient({**CONFIG,**extra},opener=opener or Opener())
 def test_legacy_handshake_and_cleanup(self):
  opener=Opener();client=self.client(opener);self.assertEqual(client.tools(time.monotonic()+12)[0]['name'],'search');client.call('search',{'query':'dragon'});client.close()
  self.assertEqual([json.loads(r.data)['method'] for r in opener.requests if r.data],['initialize','notifications/initialized','tools/list','tools/call'])
  self.assertEqual(opener.requests[2].get_header('Mcp-session-id'),'per-turn-session');self.assertEqual(opener.deleted,1)
  self.assertEqual(opener.requests[3].get_header('Authorization'),'Bearer mcp-test-secret')
 def test_modern_metadata_and_parameter_headers(self):
  def remote(req,payload):
   if payload['method']=='tools/list':
    tool=copy.deepcopy(TOOL);tool['inputSchema']['properties']['query']['x-mcp-header']='Query'
    return Response({'jsonrpc':'2.0','id':payload['id'],'result':{'tools':[tool]}})
  opener=Opener(remote);client=self.client(opener,protocolVersion=mcp.MODERN);client.tools(time.monotonic()+12);client.call('search',{'query':'龍\nnotes'})
  self.assertEqual(len(opener.requests),2);request=opener.requests[-1]
  self.assertEqual(request.get_header('Mcp-method'),'tools/call');self.assertEqual(request.get_header('Mcp-name'),'search')
  self.assertTrue(request.get_header('Mcp-param-query').startswith('=?base64?'))
  self.assertEqual(json.loads(request.data)['params']['_meta']['io.modelcontextprotocol/protocolVersion'],mcp.MODERN)
 def test_sse_notifications_then_matching_result(self):
  def remote(req,p):
   if p['method']=='tools/list':return Response(('data: '+json.dumps({'jsonrpc':'2.0','method':'notifications/progress'})+'\r\n\r\ndata: '+json.dumps({'jsonrpc':'2.0','id':p['id'],'result':{'tools':[TOOL]}})+'\r\n\r\n').encode(),{'Content-Type':'text/event-stream'})
  client=self.client(Opener(remote));self.assertEqual(len(client.tools(time.monotonic()+12)),1)
 def test_only_allowlisted_read_only_tools(self):
  def remote(req,p):
   if p['method']=='tools/list':return Response({'jsonrpc':'2.0','id':p['id'],'result':{'tools':[dict(TOOL,name='other'),dict(TOOL,annotations={'readOnlyHint':False})]}})
  client=self.client(Opener(remote));self.assertEqual(client.tools(time.monotonic()+12),[])
  with self.assertRaises(mcp.MCPError):client.call('search',{})
 def test_bad_header_schema_is_excluded(self):
  schema={'type':'object','properties':{'x':{'type':'string','x-mcp-header':'bad\r\nsecret'}}}
  with self.assertRaises(mcp.MCPError):mcp.parameter_headers(schema)
  with self.assertRaises(mcp.MCPError):mcp.parameter_headers({'type':'object','oneOf':[{'properties':{'x':{'type':'string','x-mcp-header':'X'}}}]})
 def test_repeated_pagination_is_bounded(self):
  def remote(req,p):
   if p['method']=='tools/list':return Response({'jsonrpc':'2.0','id':p['id'],'result':{'tools':[],'nextCursor':'same'}})
  with self.assertRaises(mcp.MCPError):self.client(Opener(remote)).tools(time.monotonic()+12)
 def test_wrong_response_id_is_rejected(self):
  client=self.client(Opener(lambda req,p:Response({'jsonrpc':'2.0','id':999,'result':{}})))
  with self.assertRaises(mcp.MCPError):client.tools(time.monotonic()+12)
 def test_http_error_does_not_expose_secret_or_url(self):
  def remote(req,p):raise HTTPError(req.full_url,403,'mcp-test-secret',{},io.BytesIO(b'mcp-test-secret'))
  with self.assertRaises(mcp.MCPError) as caught:self.client(Opener(remote)).tools(time.monotonic()+12)
  self.assertEqual(str(caught.exception),'Connection returned HTTP 403.')
 def test_redirects_never_forward_credentials(self):
  self.assertIsNone(mcp.NoRedirect().redirect_request(None,None,302,'',{},'https://elsewhere.invalid'))
 def test_output_and_call_budget(self):
  def remote(req,p):
   if p['method']=='tools/call':return Response({'jsonrpc':'2.0','id':p['id'],'result':{'content':[{'type':'text','text':'x'*40000}]}})
  turn=mcp.MCPTurn([CONFIG],factory=lambda c,**kw:self.client(Opener(remote)));alias=next(iter(turn.routes))
  first=turn.call(alias,{});self.assertEqual(len(first['content']),16000);self.assertTrue(first['truncated'])
  self.assertEqual(len(turn.call(alias,{})['content']),14000);self.assertTrue(turn.call(alias,{})['isError']);turn.close()
 def test_stop_prevents_network_call(self):
  opener=Opener();client=mcp.MCPClient(CONFIG,opener=opener,cancelled=lambda:True)
  with self.assertRaises(mcp.MCPError):client.tools(time.monotonic()+12)
  self.assertEqual(opener.requests,[])
 def test_unavailable_server_isolated_from_other_connections(self):
  def factory(c,**kw):
   if c['id']=='broken':raise mcp.MCPError('Unavailable')
   return self.client()
  turn=mcp.MCPTurn([{**CONFIG,'id':'broken'},CONFIG],factory=factory)
  self.assertFalse(turn.statuses[0]['ready']);self.assertTrue(turn.statuses[1]['ready']);self.assertEqual(len(turn.tools),1);turn.close()
 def test_configuration_and_team_scope(self):
  with tempfile.TemporaryDirectory() as directory:
   path=Path(directory)/'mcp.json';path.write_text(json.dumps({'servers':[CONFIG]}));manager=mcp.MCPManager(path)
   self.assertEqual(manager.visible({'teams':['strangers']}),[])
   with self.assertRaises(PermissionError):manager.select(['library'],{'teams':['strangers']})
   self.assertEqual(len(manager.select(['library'],{'teams':['friends']})),1)
   self.assertIsNotNone(mcp.MCPManager(path,static_root=directory).error)
 def test_missing_config_does_not_break_normal_server(self):
  manager=mcp.MCPManager('/nonexistent/mcp-private.json');self.assertEqual(manager.configs,{})
  self.assertNotIn('/nonexistent',manager.error)
 def test_authenticated_metadata_hides_urls_and_credentials(self):
  proxy=SimpleNamespace(mcp=mcp.MCPManager());proxy.mcp.configs={'library':CONFIG}
  handler=object.__new__(server.MDNotesRequestHandler);handler.headers={'Authorization':'Bearer account-test'}
  handler.registry=SimpleNamespace(_require_account=lambda token:{'teams':['friends']} if token=='account-test' else (_ for _ in ()).throw(PermissionError()))
  handler.chat_proxy=proxy;handler._read_json=lambda:{'action':'list'};results=[];handler._write_json=lambda status,body:results.append((status,body))
  handler._handle_mcp();self.assertEqual(results[-1][1]['servers'],[{'id':'library','label':'Reference library'}])
  self.assertNotIn('url',json.dumps(results));self.assertNotIn('secret',json.dumps(results))
  handler.headers={};handler._handle_mcp();self.assertEqual(results[-1][0],403)
 def test_chat_tool_loop_uses_mcp_and_retains_workspace_tools(self):
  proxy=server.ChatProxy();seen=[];opener=Opener();provider_headers=[]
  def completion(payload,headers,emit):
   provider_headers.append(headers);seen.append(copy.deepcopy(payload))
   if len(seen)==1:
    alias=next(t['function']['name'] for t in payload['tools'] if t['function']['name'].startswith('mcp_'))
    return {'choices':[{'message':{'tool_calls':[{'id':'call-1','type':'function','function':{'name':alias,'arguments':'{"query":"dragon"}'}}]}}]}
   self.assertIn('Reference: https://example.invalid/source',payload['messages'][-1]['content'])
   return {'choices':[{'message':{'content':'Answer from the reference library.'}}]}
  proxy._stream_completion=completion
  factory=lambda configs,**kw:mcp.MCPTurn(configs,**kw,factory=lambda c,**args:self.client(opener))
  with patch.object(server,'MCPTurn',factory),patch.object(server,'_log'):
   result=proxy.chat([{'role':'user','content':'Find a dragon reference'}],[],'Test',{'rootId':'root','nodes':{'root':{'kind':'folder','children':[]}}},override={'apiKey':'model-test-key','apiUrl':'https://model.example.invalid'},mcp_configs=[CONFIG])
  self.assertEqual(result['message'],'Answer from the reference library.');self.assertEqual(result['proposedOperations'],[])
  self.assertTrue(any(t['function']['name']=='read_file' for t in seen[0]['tools']))
  self.assertTrue(all(h['Authorization']=='Bearer model-test-key' for h in provider_headers))
  self.assertTrue(all(r.get_header('Authorization')=='Bearer mcp-test-secret' for r in opener.requests))
  self.assertIsNone(proxy._req.mcp_turn);self.assertEqual(opener.deleted,1)
if __name__=='__main__':unittest.main()
