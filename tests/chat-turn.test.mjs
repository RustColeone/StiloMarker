import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
// The Agent page's pieces live in the Assistant module; a function's calls to
// another piece go through the shared context `app`, given here as the fakes too.
const read = (name) => readFile(new URL(`../app/modules/assistant/adapters/${name}.js`, import.meta.url), 'utf8');
const sources = { turns: await read('turns'), proposals: await read('proposals'), conversations: await read('conversations') };
const slice = (file, start, end) => { const source = sources[file]; return source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start))); };
const turnSource = slice('turns', 'async function runAgentTurn(', '\n  return { ');
const proposalSource = slice('proposals', 'async function autoApplyProposals(', '\n  /** URL of an image the agent generated');
const cancelSource = slice('conversations', 'function cancelChatForWorkspaceChange(', '\n  function ensureChatWorkspaceLoaded(');
// A piece sees as bare names only what it takes from `app`, imports or defines;
// anything else must be reached through `app`, so a missed `app.` fails here.
const bareNames = (file) => {
  const source = sources[file];
  const taken = source.match(/^  const \{ ([^}]*) \} = app;$/m)[1].split(',');
  const imported = [...source.matchAll(/^import \{([^}]*)\} from/gm)].flatMap((m) => m[1].split(','));
  const own = [...source.matchAll(/^  (?:async )?function (\w+)/gm)].map((m) => m[1]);
  return [...taken, ...imported, ...own].map((name) => name.trim()).filter(Boolean);
};
const build = (fakes, files, source, names) => {
  const params = [...new Set(files.flatMap(bareNames))];
  return new Function(...params, 'app', `${source}\nreturn ${names};`)(...params.map((name) => fakes[name]), fakes);
};
const deferred = () => { let resolve; const promise = new Promise(r => resolve = r); return { resolve, promise }; };
function harness() {
  let project = { id:'A', name:'A', content:'base' }, progress, payload, token='token-A';
  const gate=deferred(), thread={id:'thread',messages:[{role:'user',content:'request',contextPaths:['note.md']}],contextPaths:[]};
  const state={configured:true,threads:[thread],streamingText:'',reasoningText:''}, applications=[],saves=[];
  const dependencies = {
    mcpControls:{getRequest:()=>({})}, identity:{account:()=>({token:'acct-A'}),token:()=>'acct-A'}, chatState:state, controller:{getProject:()=>project}, settings:{serverUrl:'https://test.invalid'},
    chatWorkspaceKey:()=>project.id, chatConnectionInfo:()=>({token}), agentDocumentSignature:p=>p.content,
    collaboration:{getConnectionInfo:()=>({token}),getRevision:()=>5,getClientId:()=> 'client'},
    contextFiles:(_,ctx)=>ctx.contextPaths, persistChatWorkspaceState:()=>saves.push(project.id),cacheChatWorkspace:()=>{},
    renderChatPanel:()=>{},projectSnapshot:p=>p,sortChatThreads:()=>{},
    agent:{requestOverride:()=>({}),served:()=>{}}, agentStatus:()=>({configured:true}),
    createChatMessage:(role,content,extra)=>({role,content,...extra}), describeAgentActivity:()=>'',
    sendChatRequest:(_,body,callback)=>{payload=body;progress=callback;return gate.promise;},
    autoApplyProposals:async(message,guard)=>applications.push({message,guard}), TAB_ID:'tab-A',
  };
  const api = build(dependencies, ['turns', 'conversations'], `${turnSource}\n${cancelSource}`, '{runAgentTurn,cancelChatForWorkspaceChange}');
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
  const h=harness(), done=h.run();assert.deepEqual(h.payload.contextFiles,['note.md']);assert.equal(h.payload.accountToken,'acct-A');
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
  const apply=build(deps, ['proposals'], proposalSource, 'autoApplyProposals');
  return {apply,confirm,applications,guard:{current:()=>current,signature:'original',baseRevision:1},change(){content='new';},switch(){current=false;}};
}
test('typing during generation no longer throws the agent\'s edits away: they go on to be placed into the newer text', async () => {
  // Each edit is then fitted into the file as it is now (tests/workspace-write.test.mjs).
  const h=proposalHarness();h.change();const message={proposedOperations:[{type:'update-file'}]};
  await h.apply(message,h.guard);assert.equal(h.applications.length,1);
});
test('a delayed delete confirmation cannot apply to a different workspace', async () => {
  const h=proposalHarness(), message={proposedOperations:[{type:'delete-node'}]};const applying=h.apply(message,h.guard);
  h.switch();h.confirm.resolve(true);await applying;assert.equal(h.applications.length,0);
});
