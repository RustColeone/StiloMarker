import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createState } from '../app/kernel/index.js';
import { createMode } from '../app/modules/sync/service/mode.js';
// Accounts and opening cloud workspaces live in their own module; it reads
// main's shared values through `app`, so the harness passes deps both ways.
const source=readFileSync(new URL('../app/features/cloud-browser.js',import.meta.url),'utf8');
const section=(start,end)=>source.slice(source.indexOf(start),source.indexOf(end,source.indexOf(start)));

test('a failed automatic workspace open keeps the cloud draft instead of restoring an empty private snapshot',async()=>{
  const draft={nodes:{file:{kind:'file',dirty:true,content:'phone draft'}}};let visible=draft;
  const deps={syncState:{status:'offline'},identity:{account:()=>({token:'test'}),token:()=>'test'},settings:{syncedProjectId:'team/notes',syncedRevision:7},
    controller:{getProject:()=>visible,replaceProject:p=>visible=p},
    collaboration:{isConnected:()=>false,openWorkspace:async()=>{throw Object.assign(new Error('offline'),{status:503});},disconnect:()=>{}},
    currentWorkspaceView:()=>({activeFile:'note.md'}),snapshotDirtyFiles:async()=>{},getDeviceId:()=> 'test-device',
    render:()=>{},logDebug:()=>{}};
  const kept={nodes:{}};
  const mode=createMode(createState('sync',{workspaceMode:'synced',privateProject:kept}));
  const app={...deps,mode};
  const fn=new Function('app',...Object.keys(deps),`let openWorkspaceInFlight=null; ${section('async function handleOpenWorkspace(', '\n  async function performLogin(')};return handleOpenWorkspace;`)(app,...Object.values(deps));
  await assert.rejects(fn('team','notes',{automatic:true}),{status:503});
  assert.equal(visible,draft);assert.equal(visible.nodes.file.content,'phone draft');
  assert.deepEqual(mode.get(),{workspaceMode:'synced',privateProject:kept},'the failed open put the mode back');
});
// A cancelled sign-in storing nothing is Identity's: tests/identity.test.mjs.
