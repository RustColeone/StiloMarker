import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const source=readFileSync(new URL('../app/main.js',import.meta.url),'utf8');
const section=(start,end)=>source.slice(source.indexOf(start),source.indexOf(end,source.indexOf(start)));

test('a failed automatic workspace open keeps the cloud draft instead of restoring an empty private snapshot',async()=>{
  const draft={nodes:{file:{kind:'file',dirty:true,content:'phone draft'}}};let visible=draft;
  const deps={syncState:{account:{token:'test'},status:'offline'},settings:{syncedProjectId:'team/notes',syncedRevision:7},
    controller:{getProject:()=>visible,replaceProject:p=>visible=p},
    collaboration:{isConnected:()=>false,openWorkspace:async()=>{throw Object.assign(new Error('offline'),{status:503});},disconnect:()=>{}},
    currentWorkspaceView:()=>({activeFile:'note.md'}),snapshotDirtyFiles:async()=>{},getDeviceId:()=> 'test-device',
    render:()=>{},logDebug:()=>{}};
  const fn=new Function(...Object.keys(deps),`let workspaceMode='synced', privateProjectSnapshot={nodes:{}}, openWorkspaceInFlight=null; ${section('async function handleOpenWorkspace(', '\nasync function performLogin(')};return handleOpenWorkspace;`)(...Object.values(deps));
  await assert.rejects(fn('team','notes',{automatic:true}),{status:503});
  assert.equal(visible,draft);assert.equal(visible.nodes.file.content,'phone draft');
});

test('a cancelled login cannot restore account credentials after logout',async()=>{
  let resolve;const syncState={account:null},settings={accountPassword:''};
  const deps={syncState,settings,loginToServer:()=>new Promise(r=>resolve=r)};
  const login=new Function(...Object.keys(deps),`${section('async function performLogin(', '\nasync function handleAccountLogin(')};return performLogin;`)(...Object.values(deps));
  const pending=login('test','test-only',{silent:true,isCurrent:()=>false});
  resolve({token:'old-result',username:'test',teams:[]});
  await assert.rejects(pending,{status:499});assert.equal(syncState.account,null);assert.equal(settings.accountPassword,'');
});
