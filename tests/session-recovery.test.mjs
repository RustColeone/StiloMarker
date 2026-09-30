import test from 'node:test';
import assert from 'node:assert/strict';
import { rememberedWorkspace, createSessionRecovery } from '../app/services/session-recovery-service.js';
test('root workspaces and legacy paths are valid resume targets', () => {
  assert.deepEqual(rememberedWorkspace({team:'friends',path:''}),{team:'friends',path:''});
  assert.deepEqual(rememberedWorkspace({team:'friends',name:'Campaign'}),{team:'friends',path:'workspaces/Campaign'});
  assert.equal(rememberedWorkspace({team:'friends'}),null);
});
function harness(restore) {
  let timer=null; const errors=[];
  const recovery=createSessionRecovery({restore,onError:e=>errors.push(e),setTimer:(fn,delay)=>(timer={fn,delay}),clearTimer:()=>{timer=null;}});
  return {recovery,errors,get timer(){return timer;}};
}
test('failed startup retries and a foreground event bypasses backoff', async () => {
  let calls=0;const h=harness(async()=>{if(++calls===1)throw new TypeError('offline');});
  assert.equal(await h.recovery.run(),false);assert.equal(h.timer.delay,1000);assert.equal(h.recovery.isPending(),true);
  assert.equal(await h.recovery.run(),true);assert.equal(h.timer,null);assert.equal(calls,2);assert.equal(h.recovery.isPending(),false);
});
test('simultaneous Resume and foreground events share one open', async () => {
  let resolve,calls=0;const h=harness(()=>{calls++;return new Promise(r=>resolve=r);});
  const first=h.recovery.run(),second=h.recovery.run();await Promise.resolve();
  assert.equal(calls,1);assert.equal(first,second);resolve();await first;
});
test('logout cancels a retry and a late failure cannot schedule another',async()=>{
  let reject;const h=harness(()=>new Promise((_,r)=>reject=r));
  const pending=h.recovery.run();await Promise.resolve();h.recovery.cancel();reject(new Error('late'));
  await pending;assert.equal(h.timer,null);assert.equal(h.errors.length,0);
});
test('rejected credentials do not trigger an endless login loop',async()=>{
  const h=harness(async()=>{throw Object.assign(new Error('invalid credentials'),{status:401});});
  await h.recovery.run();assert.equal(h.timer,null);assert.equal(h.errors.length,1);
});
