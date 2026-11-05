"""Isolated real DSH loader/model fixture; never uses the user's profile or external models."""
import http.server,http.cookiejar,json,os,re,subprocess,tempfile,threading,time,urllib.request
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
CLI='/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh'
requests=[]
control={'hold':False}
model_started=threading.Event()
release_model=threading.Event()
class Model(http.server.BaseHTTPRequestHandler):
 def do_POST(self):
  req=json.loads(self.rfile.read(int(self.headers.get('Content-Length',0))))
  texts='\n'.join(m.get('content','') for m in req.get('messages',[]) if m.get('role')=='user' and isinstance(m.get('content',''),str))
  match=re.search(r'runId=([a-f0-9-]{36})',texts)
  requests.append({'runId':match.group(1) if match else None})
  if control['hold']:
   model_started.set()
   release_model.wait(15)
  if not match:
   delta={'role':'assistant','content':'No execution identity.'};reason='stop'
  else:
   args={'runId':match.group(1),'status':'completed','summary':'Synthetic fixture completed','evidence':['synthetic test: passed']}
   delta={'tool_calls':[{'index':0,'id':'call-'+str(len(requests)),'type':'function','function':{'name':'dwb_report_execution','arguments':json.dumps(args)}}]};reason='tool_calls'
  self.send_response(200);self.send_header('Content-Type','text/event-stream');self.end_headers()
  for d,r in [(delta,None),({},reason)]:
   chunk={'id':'fixture','object':'chat.completion.chunk','created':1,'model':'fixture','choices':[{'index':0,'delta':d,'finish_reason':r}]}
   self.wfile.write(('data: '+json.dumps(chunk)+'\n\n').encode())
  self.wfile.write(b'data: [DONE]\n\n')
 def log_message(self,*args):pass
server=http.server.ThreadingHTTPServer(('127.0.0.1',0),Model)
threading.Thread(target=server.serve_forever,daemon=True).start()
try:
 with tempfile.TemporaryDirectory(prefix='dwb-native-',dir=ROOT/'test') as tmp:
  home=Path(tmp);overlay=home/'patch.yml'
  bootstrap=home/'bootstrap.mjs'
  bootstrap.write_text("import '"+(ROOT/'test/native-register.mjs').as_uri()+"';\nexport const name='workbench-test-bootstrap';\nexport const inject=['sessionController','sessionProjections','sessions','sessionTitle','workspaceRegistry','tools','llm','connection'];\nexport async function apply(ctx,config){const plugin=await import('"+(ROOT/'index.js').as_uri()+"');return plugin.apply(ctx,config)}\n")
  overlay.write_text(f'''- id: llm-pi-ai
  config:
    providers:
      dwb-mock:
        api: openai-completions
        baseURL: http://127.0.0.1:{server.server_port}/v1
        apiKeyEnv: DWB_MOCK_API_KEY
        models:
          - id: fixture
            name: fixture
            contextWindow: 128000
            maxTokens: 512
            input: [text]
- id: session-telemetry-otel
  disabled: true
- insert:
    - id: workbench-native-test
      name: '{bootstrap}'
      config:
        home: '{home / "workbench"}'
        tickMs: 250
''')
  env=dict(os.environ,DSH_HOME=str(home),DWB_MOCK_API_KEY='fixture');env.pop('DSH_PROFILE_DIR',None);env.pop('DSH_PROFILE',None)
  log=home/'host.log'
  with log.open('w') as output:
   proc=subprocess.Popen([CLI,'web','--patch',str(overlay),'--no-open','--host','127.0.0.1','--port','0'],cwd=ROOT,env=env,stdout=output,stderr=subprocess.STDOUT,text=True)
   try:
    deadline=time.monotonic()+25;url=None
    while time.monotonic()<deadline:
     text=log.read_text();match=re.search(r'dsh web: (http://\S+)',text)
     if match:url=match.group(1);break
     if proc.poll() is not None:raise AssertionError(text)
     time.sleep(.1)
    assert url,log.read_text()
    origin=url.split('/?',1)[0]
    opener=urllib.request.build_opener(urllib.request.ProxyHandler({}),urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
    opener.open(url,timeout=10).close()
    def call(endpoint,payload=None):
     req=urllib.request.Request(origin+'/api/dsh-workbench',data=json.dumps({'endpoint':endpoint,'payload':payload or {}}).encode(),headers={'Origin':origin,'Content-Type':'application/json'})
     try:
      with opener.open(req,timeout=10) as res:data=json.load(res)
     except urllib.error.HTTPError as error:raise AssertionError(error.read().decode()+'\n'+log.read_text())
     assert data['ok'],data
     return data['data']
    call('overview')
    roles=[call('roles.create',{'name':name,'model':'dwb-mock/fixture'})['role']['id'] for name in ['Native A','Native B']]
    group=call('groups.create',{'name':'Native test','members':roles,'admins':[roles[0]],'customDir':str(home/'project')})['group']
    task=call('tasks.create',{'title':'Synthetic implementation','groupId':group['id'],'assignees':roles})['task']
    deadline=time.monotonic()+25
    while time.monotonic()<deadline:
     status=call('execution.status',{'taskId':task['id']})
     if status.get('error'):raise AssertionError(status)
     if len(status['runs'])==2 and all(r['status']=='completed' for r in status['runs']):break
     time.sleep(.15)
    else:raise AssertionError(json.dumps(status,ensure_ascii=False)+'\n'+log.read_text())
    assert len({r['sessionId'] for r in status['runs']})==2
    assert call('tasks.list')['tasks'][0]['status']=='已完成'
    assert sum(1 for r in requests if r['runId'])==2,requests
    deadline=time.monotonic()+10
    while time.monotonic()<deadline:
     review=call('execution.status',{'groupId':group['id']})
     if review.get('reviewOutbox') and review['reviewOutbox'][-1]['status']=='sent':break
     time.sleep(.1)
    else:raise AssertionError('administrator handoff missing: '+json.dumps(review,ensure_ascii=False))
    assert review['projects'][0]['delivery']['status']=='awaiting-review'
    assert review['reviewOutbox'][-1]['targetSessionId']
    print('PASS real DSH: loader, stable task Sessions, inbox admission, two synthetic worker calls, own-run tools, aggregate completion, durable administrator handoff')
    control['hold']=True
    second=call('tasks.create',{'title':'Interrupted fixture','groupId':group['id'],'assignees':[roles[0]]})['task']
    assert model_started.wait(8),'worker never reached the controlled model boundary'
    before=call('execution.status',{'taskId':second['id']})['runs'][0]
    proc.kill();proc.wait(timeout=10)
    control['hold']=False;release_model.set()
    previous_count=len(re.findall(r'dsh web: (http://\S+)',log.read_text()))
    proc=subprocess.Popen([CLI,'web','--patch',str(overlay),'--no-open','--host','127.0.0.1','--port','0'],cwd=ROOT,env=env,stdout=output,stderr=subprocess.STDOUT,text=True)
    deadline=time.monotonic()+25
    while time.monotonic()<deadline:
     urls=re.findall(r'dsh web: (http://\S+)',log.read_text())
     if len(urls)>previous_count: url=urls[-1];break
     if proc.poll() is not None:raise AssertionError(log.read_text())
     time.sleep(.1)
    else:raise AssertionError('restart did not advertise URL\n'+log.read_text())
    origin=url.split('/?',1)[0]
    opener=urllib.request.build_opener(urllib.request.ProxyHandler({}),urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()));opener.open(url,timeout=10).close()
    deadline=time.monotonic()+25
    while time.monotonic()<deadline:
     recovered=call('execution.status',{'taskId':second['id']})
     if recovered['runs'][0]['status']=='completed':break
     time.sleep(.15)
    else:raise AssertionError('recovery failed: '+json.dumps(recovered,ensure_ascii=False)+'\n'+log.read_text())
    assert recovered['runs'][0]['sessionId']==before['sessionId']
    assert recovered['runs'][0]['attempts']>=2
    assert all(r['status']=='completed' for r in call('execution.status',{'taskId':task['id']})['runs'])
    assert sum(1 for r in requests if r['runId'] in {x['id'] for x in status['runs']})==2
    print('PASS real DSH crash recovery: killed mid-model, resumed same worker Session, no replay of completed work')
   finally:
    proc.terminate()
    try:proc.wait(timeout=10)
    except subprocess.TimeoutExpired:proc.kill();proc.wait()
    if proc.returncode not in (0,-15):print('Fixture host exit:',proc.returncode)
    if 'PASS real DSH' not in '':
     lines=[l for l in log.read_text().splitlines() if 'workbench' in l.lower() or 'Error:' in l]
     if lines:print('\n'.join(lines[-15:]))
finally:server.shutdown();server.server_close()
