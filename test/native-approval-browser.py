"""Disposable real Harness + native approval + actual Chrome group-card test."""
import http.server,http.cookiejar,json,os,re,subprocess,tempfile,threading,time,urllib.request
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
CLI='/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh'
NODE='/Users/wxq/.dsh/dsh-runtimes/dsh-primary-runtime/dependencies/node/bin/node'
class Model(http.server.BaseHTTPRequestHandler):
 def do_POST(self):
  req=json.loads(self.rfile.read(int(self.headers.get('Content-Length',0))))
  texts='\n'.join(m.get('content','') for m in req.get('messages',[]) if m.get('role')=='user' and isinstance(m.get('content',''),str))
  match=re.search(r'runId=([a-f0-9-]{36})',texts)
  results=[m for m in req.get('messages',[]) if m.get('role')=='tool']
  if not match:delta={'role':'assistant','content':'Fixture ready.'};reason='stop'
  else:
   if not results:
    name='bash';args={'description':'Synthetic permission approval test','command':"printf approval-fixture",'sandbox_permissions':'danger-full-access','justification':'Synthetic fixture only: print a fixed string; no files or user data are changed.'}
   else:name='dwb_report_execution';args={'runId':match.group(1),'status':'completed','summary':'Approval fixture done','evidence':['printf returned approval-fixture']}
   delta={'tool_calls':[{'index':0,'id':'native-approval-'+str(len(results)),'type':'function','function':{'name':name,'arguments':json.dumps(args)}}]};reason='tool_calls'
  self.send_response(200);self.send_header('Content-Type','text/event-stream');self.end_headers()
  for d,r in [(delta,None),({},reason)]:
   self.wfile.write(('data: '+json.dumps({'id':'fixture','object':'chat.completion.chunk','created':1,'model':'fixture','choices':[{'index':0,'delta':d,'finish_reason':r}]})+'\n\n').encode())
  self.wfile.write(b'data: [DONE]\n\n')
 def log_message(self,*args):pass
server=http.server.ThreadingHTTPServer(('127.0.0.1',0),Model);threading.Thread(target=server.serve_forever,daemon=True).start()
try:
 with tempfile.TemporaryDirectory(prefix='dwb-approval-',dir=ROOT/'test') as tmp:
  home=Path(tmp);overlay=home/'patch.yml';bootstrap=home/'bootstrap.mjs'
  bootstrap.write_text("import '"+(ROOT/'test/native-register.mjs').as_uri()+"';\nexport const name='workbench-test-bootstrap';\nexport const inject=['sessionController','sessionProjections','sessions','sessionTitle','workspaceRegistry','tools','llm','connection'];\nexport async function apply(ctx,config){const plugin=await import('"+(ROOT/'index.js').as_uri()+"');return plugin.apply(ctx,config)}\n")
  manifest=json.loads((ROOT/'package.json').read_text());manifest['main']='bootstrap.mjs';manifest['exports']['.']='./bootstrap.mjs';manifest['files']=['bootstrap.mjs','client.js']
  (home/'package.json').write_text(json.dumps(manifest));(home/'client.js').write_text((ROOT/'client.js').read_text().replace('  injectStyles();',"  injectStyles(); window.__dwbFixtureOpen=()=>ctx.layout.selectPanel('workbench'); window.__dwbFixtureTheme=id=>ctx.get('theme').setTheme(id);"))
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
     match=re.search(r'dsh web: (http://\S+)',log.read_text())
     if match:url=match.group(1);break
     if proc.poll() is not None:raise AssertionError('Fixture host exited')
     time.sleep(.1)
    assert url,'Host did not start'
    origin=url.split('/?',1)[0]
    opener=urllib.request.build_opener(urllib.request.ProxyHandler({}),urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()));opener.open(url,timeout=10).close()
    def call(endpoint,payload=None):
     req=urllib.request.Request(origin+'/api/dsh-workbench',data=json.dumps({'endpoint':endpoint,'payload':payload or {}}).encode(),headers={'Origin':origin,'Content-Type':'application/json'})
     with opener.open(req,timeout=10) as res:data=json.load(res)
     assert data['ok'],data
     return data['data']
    role=call('roles.create',{'name':'Native QA','model':'dwb-mock/fixture'})['role']['id']
    group=call('groups.create',{'name':'Native approval group','members':[role],'admins':[role],'customDir':str(home/'project')})['group']
    call('groups.create',{'name':'Other approval group','members':[role],'customDir':str(home/'other-project')})
    # Ensure the actual Client package is served in this isolated host. The bootstrap Host
    # has no Client manifest, so mount the workspace package's Client directly via a fixture.
    result=subprocess.run([NODE,str(ROOT/'test/approval-browser.mjs')],cwd=ROOT,env=dict(env,DWB_BROWSER_HOME=str(home),DWB_BROWSER_URL=url,DWB_BROWSER_GROUP=group['id'],DWB_BROWSER_ROLE=role),text=True,capture_output=True,timeout=80)
    print(result.stdout)
    artifacts=ROOT/'test-artifacts';artifacts.mkdir(exist_ok=True)
    for name in ['approval-light.png','approval-dark.png','approval-browser-result.json']:
     source=home/name
     if source.exists():(artifacts/name).write_bytes(source.read_bytes())
    if result.returncode:raise AssertionError(result.stderr+'\n'+ '\n'.join(l for l in log.read_text().splitlines() if 'Error' in l or 'failed' in l))
    approvals=call('approvals.list',{'groupId':group['id']})
    assert any(a['outcome']=='allowed-once' for a in approvals['items']),approvals
    print('PASS Host audit: original allowed-once decision observed via approval projection')
   finally:
    proc.terminate()
    try:proc.wait(timeout=10)
    except subprocess.TimeoutExpired:proc.kill();proc.wait()
finally:server.shutdown();server.server_close()
