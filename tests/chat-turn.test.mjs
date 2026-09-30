import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const source = await readFile(new URL('../app/main.js', import.meta.url), 'utf8');
const slice = (start, end) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));
const turnSource = slice('async function runAgentTurn(', '\nfunction isPreviewableFileName(');
const proposalSource = slice('async function autoApplyProposals(', '\nasync function acceptAgentOperations(');
const cancelSource = slice('function cancelChatForWorkspaceChange(', '\nfunction ensureChatWorkspaceLoaded(');
const deferred = () => { let resolve; const promise = new Promise(r => resolve = r); return { resolve, promise }; };
function harness() {
  let project = { id:'A', name:'A', content:'base' }, progress, payload, token='token-A';
  const gate=deferred(), thread={id:'thread',messages:[{role:'user',content:'request',contextPaths:['note.md']}],contextPaths:[]};
  const state={configured:true,threads:[thread],streamingText:'',reasoningText:''}, applications=[],saves=[];
  const dependencies = {
    mcpControls:{getRequest:()=>({})}, chatState:state, controller:{getProject:()=>project}, settings:{serverUrl:'https://test.invalid'},
    chatWorkspaceKey:()=>project.id, chatConnectionInfo:()=>({token}), agentDocumentSignature:p=>p.content,
    collaboration:{getConnectionInfo:()=>({token}),getRevision:()=>5,getClientId:()=> 'client'},
    resolveChatContextFiles:(_,ctx)=>ctx.contextPaths, persistChatWorkspaceState:()=>saves.push(project.id),cacheChatWorkspace:()=>{},
    renderChatPanel:()=>{},buildAgentProjectSnapshot:p=>p, agentRequestOverride:()=>({}),sortChatThreads:()=>{},
    createChatMessage:(role,content,extra)=>({role,content,...extra}), describeAgentActivity:()=>'',
    sendChatRequest:(_,body,callback)=>{payload=body;progress=callback;return gate.promise;},
    autoApplyProposals:async(message,guard)=>applications.push({message,guard}),
  };
  const api = new Function(...Object.keys(dependencies),`${turnSource}\n${cancelSource}\nreturn {runAgentTurn,cancelChatForWorkspaceChange};`)(...Object.values(dependencies));
  return {state,thread,gate,applications,saves,api,get payload(){return payload;},emit:e=>progress(e),run:()=>api.runAgentTurn(thread,project),switch(){project={id:'B',name:'B',content:'other'};token='token-B';},changeText(){project.content='new typing';}};
}

test('late replies and progress cannot affect a new workspace or its active request', async () => {
  const h=harness(), oldTurn=h.run(); h.emit({type:'delta',text:'partial'});
  h.api.cancelChatForWorkspaceChange(); h.switch();
  const nextTurn={}; h.state.turn=nextTurn; h.state.sending=true;h.state.streamingText='new workspace reply';
  h.emit({type:'delta',text:'late old text'});
  h.gate.resolve({message:'old reply',proposedOperations:[{type:'update-file',path:'note.md'}]}); await oldTurn;
  assert.equal(h.applications.length,0);assert.deepEqual(h.saves,['A']);
  assert.equal(h.state.turn,nextTurn);assert.equal(h.state.sending,true);assert.equal(h.state.streamingText,'new workspace reply');
  assert.equal(h.thread.messages.at(-1).content,'partial');assert.equal(h.thread.messages.at(-1).interrupted,true);
});

test('submitted attachments survive composer clearing and proposals retain their original revision', async () => {
  const h=harness(), done=h.run();assert.deepEqual(h.payload.contextFiles,['note.md']);
  h.gate.resolve({message:'reply',proposedOperations:[{type:'update-file',path:'note.md'}]});await done;
  assert.equal(h.applications[0].message.baseRevision,5);assert.equal(h.state.sending,false);
});

test('stop preserves partial text even when transport delivers a result after abort', async () => {
  const h=harness(), done=h.run();h.emit({type:'delta',text:'partial answer'});h.state.abortController.abort();
  h.gate.resolve({message:'should be ignored',proposedOperations:[{type:'delete-node',path:'note.md'}]});await done;
  assert.equal(h.applications.length,0);assert.equal(h.thread.messages.at(-1).content,'partial answer');
  assert.equal(h.thread.messages.at(-1).interrupted,true);
});

function proposalHarness() {
  let content='original', current=true;const confirm=deferred(),applications=[];
  const deps={controller:{getProject:()=>({content})},agentDocumentSignature:p=>p.content,
    showConfirmDialog:()=>confirm.promise,acceptAgentOperations:async(...args)=>applications.push(args),persistChatWorkspaceState:()=>{},renderChatPanel:()=>{},showToast:()=>{}};
  const apply=new Function(...Object.keys(deps),`${proposalSource};return autoApplyProposals;`)(...Object.values(deps));
  return {apply,confirm,applications,guard:{current:()=>current,signature:'original',baseRevision:1},change(){content='new';},switch(){current=false;}};
}
test('typing during generation prevents auto-application over the newer text', async () => {
  const h=proposalHarness();h.change();const message={proposedOperations:[{type:'update-file'}]};
  await h.apply(message,h.guard);assert.equal(h.applications.length,0);assert.equal(message.proposalState,'stale');
});
test('a delayed delete confirmation cannot apply to a different workspace', async () => {
  const h=proposalHarness(), message={proposedOperations:[{type:'delete-node'}]};const applying=h.apply(message,h.guard);
  h.switch();h.confirm.resolve(true);await applying;assert.equal(h.applications.length,0);
});
