"""Mobile recovery regression against the public origin, isolated mocked sessions.
Static files come from this checkout. No real account or writing project is used.
"""
import asyncio,json,mimetypes,os
from pathlib import Path
from urllib.parse import urlparse,parse_qs
from playwright.async_api import async_playwright
ROOT=Path(__file__).resolve().parents[1]
BASE='https://stilomarker.ngantech.net'
async def main():
 async with async_playwright() as pw:
  browser=await pw.chromium.launch(executable_path=os.environ.get('STILO_BROWSER'))
  context=await browser.new_context(viewport={'width':390,'height':844},is_mobile=True,has_touch=True,service_workers='block')
  page=await context.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
  project={'id':'root-team','name':'Campaign','rootId':'root','activeFileId':None,'sourceMode':'memory','nodes':{
   'root':{'id':'root','kind':'folder','name':'Campaign','children':['file'],'expanded':True},
   'file':{'id':'file','kind':'file','parentId':'root','name':'session.md','content':'Cloud campaign notes','dirty':False}}}
  login_gate=asyncio.Event()
  state={'pings':0,'logins':0,'opens':0,'fail_open':True,'revision':1,'expired':False,'login_outage':False,'writes':0}
  settings={'serverUrl':BASE,'accountUsername':'test-user','accountPassword':'test-only','accountSuccess':{BASE:'test-user'},'lastWorkspace':{'team':'friends','path':''},'syncedProjectId':'friends/','syncedRevision':1}
  await page.add_init_script('localStorage.setItem("mdnotes.settings.v1",'+json.dumps(json.dumps(settings))+');localStorage.setItem("mdnotes.project.v1",'+json.dumps(json.dumps(project))+');')
  await page.add_init_script('''window.EventSource=class {constructor(){(window.testStreams??=[]).push(this);}close(){this.closed=true;}};''')
  async def route(route):
   path=urlparse(route.request.url).path
   if path.startswith('/api/'):
    code=200;payload={}
    if path=='/api/ping':
     state['pings']+=1
     if state['pings']==1:await route.abort('internetdisconnected');return
     payload={'accounts':True,'appVersion':'0.1.16','minSyncVersion':114}
    elif path=='/api/chat/status':payload={'configured':False}
    elif path=='/api/auth/login':
     state['logins']+=1
     if state.get('hold_login'):
      state['pending_login']=True
      await login_gate.wait()
     if state['login_outage']:state['login_outage']=False;await route.abort('internetdisconnected');return
     payload={'token':'account-'+str(state['logins']),'username':'test-user','teams':['friends']}
    elif path=='/api/workspaces/open':
     state['opens']+=1
     body=route.request.post_data_json
     assert body['team']=='friends' and body['path']=='',body
     token=parse_qs(urlparse(route.request.url).query).get('token',[''])[0]
     if state.get('expire_all') or (state['expired'] and token=='account-2'):code=403;payload={'message':'Not logged in'}
     elif state['fail_open']:code=503;payload={'message':'Temporary outage'}
     else:payload={'token':'session-'+str(state['opens']),'clientId':'mobile','workspace':'friends/','revision':state['revision'],'role':'master','resume':{'openFiles':[],'activeFile':None}}
    elif path=='/api/session/state':payload={'project':project,'revision':state['revision'],'presence':[]}
    elif path=='/api/chat/workspace':payload={'threads':[],'revision':0}
    elif path=='/api/operations':state['writes']+=1;payload={'revision':state['revision']}
    elif 'snapshots' in path:payload={'snapshots':[]}
    await route.fulfill(status=code,content_type='application/json',body=json.dumps(payload));return
   file=ROOT/(path.lstrip('/') or 'index.html')
   if file.is_file():
    if os.environ.get('STILO_LIVE_ASSETS'):
     if path!='/app/main.js':await route.continue_();return
     response=await route.fetch();body=await response.body()
    else:body=file.read_bytes()
    if path=='/app/main.js':body+=b'\nwindow.recoveryTest={controller,collaboration,sessionRestorer,render,setActiveSourceFile,handleAccountLogout,getMode:()=>workspaceMode,getStatus:()=>syncState.status,hasAccount:()=>Boolean(syncState.account)};'
    await route.fulfill(content_type=mimetypes.guess_type(str(file))[0] or 'text/plain',body=body)
   else:await route.continue_()
  await context.route('**/*',route)
  await page.goto(BASE,wait_until='domcontentloaded')
  await page.wait_for_function('!!window.recoveryTest')
  # Automatic retry after an offline boot reaches workspace open without a click.
  await page.wait_for_function('document.querySelector("#welcome-resume").hidden === false')
  for _ in range(100):
   if state['opens']:break
   await page.wait_for_timeout(50)
  assert state['opens']>=1,state
  state['fail_open']=False
  # The automatic retry must restore the root workspace without a click.
  await page.wait_for_function('window.recoveryTest.controller.getActiveFile()?.name === "session.md"')
  assert 'Cloud campaign notes' in await page.locator('#editor-content').inner_text()
  assert await page.locator('#app').get_attribute('data-mobile-explorer')!='open'
  # Reproduce an apparently connected workspace stranded at the welcome screen.
  await page.evaluate('''() => {const t=recoveryTest;t.controller.getProject().activeFileId=null;t.render(t.controller.getProject());}''')
  await page.locator('#welcome-resume').click()
  await page.wait_for_function('window.recoveryTest.controller.getActiveFile()?.name === "session.md"')
  # A silently dead stream must reconnect on foreground, pulling newer cloud
  # content without writing the stale local version back over it.
  project['nodes']['file']['content']='Newer cloud campaign notes';state['revision']=2
  before=state['opens']
  await page.evaluate('''() => {
   Object.defineProperty(document,'visibilityState',{configurable:true,value:'hidden'});document.dispatchEvent(new Event('visibilitychange'));
   Object.defineProperty(document,'visibilityState',{configurable:true,value:'visible'});document.dispatchEvent(new Event('visibilitychange'));
   window.dispatchEvent(new Event('online'));
  }''')
  await page.wait_for_function('document.querySelector("#editor-content").textContent.includes("Newer cloud campaign notes")')
  await page.wait_for_function('recoveryTest.getStatus()==="connected"')
  assert state['opens']==before+1,state
  assert state['writes']==0,state
  assert await page.evaluate('testStreams.slice(0,-1).every(s=>s.closed)')
  # Suspension persists the active file locally even before server resume save.
  saved=await page.evaluate('JSON.parse(localStorage.getItem("mdnotes.workspaceView.v1"))')
  assert saved['activeFile']=='session.md' and saved['workspace']=='friends/',saved
  # An expired account plus a temporary login outage must keep retrying.
  state['expired']=True;state['login_outage']=True
  before=state['logins']
  await page.evaluate('window.dispatchEvent(new Event("online"))')
  for _ in range(200):
   if state['logins']>=before+2 and await page.evaluate('recoveryTest.getStatus()==="connected"'):break
   await page.wait_for_timeout(50)
  assert state['logins']>=before+2,state
  assert await page.evaluate('recoveryTest.getStatus()')=='connected',state
  assert 'Newer cloud campaign notes' in await page.locator('#editor-content').inner_text()
  assert state['writes']==0,state
  # Logout while a replacement login is pending must remain logged out.
  state['expire_all']=True;state['hold_login']=True
  await page.evaluate('window.dispatchEvent(new Event("online"))')
  for _ in range(100):
   if state.get('pending_login'):break
   await page.wait_for_timeout(50)
  assert state.get('pending_login'),state
  await page.evaluate('recoveryTest.handleAccountLogout()')
  login_gate.set()
  await page.wait_for_timeout(200)
  assert not await page.evaluate('recoveryTest.hasAccount()')
  assert await page.evaluate('JSON.parse(localStorage.getItem("mdnotes.settings.v1")).accountPassword')==''
  assert not errors,errors
  print(json.dumps({'checks':['offline boot retries','failed open recovers','root-path Resume works','connected empty view resumes','foreground replaces silent stream','duplicate events coalesce','new cloud text not overwritten','active file persists on suspension','expired account and login outage recover','logout invalidates pending login'],'runtimeErrors':len(errors),'opens':state['opens'],'writes':state['writes']}))
  await browser.close()
asyncio.run(main())
