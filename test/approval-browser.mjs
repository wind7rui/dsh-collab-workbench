// Real-browser test against a disposable Harness, never the user's profile.
import {spawn} from 'node:child_process'
import {readFile,writeFile} from 'node:fs/promises'
import {join} from 'node:path'
const home=process.env.DWB_BROWSER_HOME,url=process.env.DWB_BROWSER_URL
if(!home||!url)throw new Error('Only run from the isolated native-approval-browser fixture')
const chrome=spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',['--headless=new','--disable-crash-reporter','--disable-crashpad','--no-first-run','--no-default-browser-check','--remote-debugging-port=0',`--user-data-dir=${join(home,'chrome')}`,'about:blank'],{stdio:['ignore','ignore','pipe']})
let chromeError='';chrome.stderr.on('data',d=>{chromeError+=d.toString()})
const pause=ms=>new Promise(r=>setTimeout(r,ms))
let socket
try{
 let port
 for(let n=0;n<100;n++){
  try{port=Number((await readFile(join(home,'chrome','DevToolsActivePort'),'utf8')).split('\n')[0]);break}catch{}
  if(chrome.exitCode!==null||chrome.signalCode!==null)throw new Error('Chrome failed: '+chromeError.slice(-1200))
  await pause(100)
 }
 if(!port)throw new Error('Chrome devtools unavailable: '+chromeError.slice(-1200))
 const tabs=await(await fetch(`http://127.0.0.1:${port}/json/list`)).json()
 socket=new WebSocket(tabs.find(t=>t.type==='page').webSocketDebuggerUrl)
 await new Promise((resolve,reject)=>{socket.addEventListener('open',resolve,{once:true});socket.addEventListener('error',reject,{once:true})})
 let seq=0;const pending=new Map(),errors=[]
 socket.addEventListener('message',({data})=>{const m=JSON.parse(data);if(m.id){const p=pending.get(m.id);if(p){pending.delete(m.id);clearTimeout(p.timer);m.error?p.reject(new Error(m.error.message)):p.resolve(m.result)}}else if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails.text+' '+(m.params.exceptionDetails.exception?.description??''))})
 const cdp=(method,params={})=>new Promise((resolve,reject)=>{const id=++seq,timer=setTimeout(()=>{pending.delete(id);reject(new Error('CDP timeout '+method+'; Chrome: '+chromeError.slice(-1800)))},15000);pending.set(id,{resolve,reject,timer});socket.send(JSON.stringify({id,method,params}))})
 const evaluate=async expression=>{const r=await cdp('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw new Error(r.exceptionDetails.exception?.description??r.exceptionDetails.text);return r.result?.value}
 const until=async(expression,label)=>{for(let n=0;n<150;n++){if(await evaluate(`(async()=>!!(await (${expression})))()`))return;await pause(100)}throw new Error(label+'\n'+errors.join('\n')+'\n'+await evaluate('document.body.innerText.slice(-2500)')+'\nWorkbench loaded: '+await evaluate('typeof window.dwbBack'))}
 await cdp('Runtime.enable');await cdp('Page.enable');await cdp('Emulation.setDeviceMetricsOverride',{width:1280,height:900,deviceScaleFactor:1,mobile:false});await cdp('Page.navigate',{url})
 await until(`document.readyState==='complete'`,'Page did not load')
 await evaluate(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()==='继续')?.click()`)
 await until(`typeof window.__dwbFixtureOpen==='function'`,'Workbench entry unavailable')
 await evaluate(`window.__dwbFixtureOpen(); true`)
 await until(`document.body.innerText.includes('Native approval group')`,'Group list unavailable')
 await evaluate(`Array.from(document.querySelectorAll('.dwb-gitem')).find(e=>e.textContent.includes('Native approval group'))?.click()`)
 // A selector fallback targets the visible group row without crossing outside the plugin.
 await evaluate(`(()=>{const el=Array.from(document.querySelectorAll('.dwb-app button,.dwb-app [role="button"],.dwb-group-item')).find(e=>e.textContent.includes('Native approval group'));el?.click()})()`)
 await until(`document.querySelector('.dwb-chat-name')?.textContent==='Native approval group'`,'Group did not open')
 const task=await evaluate(`fetch('/api/dsh-workbench',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({endpoint:'tasks.create',payload:{title:'Synthetic approval task',groupId:${JSON.stringify(process.env.DWB_BROWSER_GROUP)},assignees:[${JSON.stringify(process.env.DWB_BROWSER_ROLE)}]}})}).then(r=>r.json())`)
 if(!task.ok)throw new Error(JSON.stringify(task))
 await until(`document.querySelector('.dwb-approval-allow:not(:disabled)')`,'Actionable group approval unavailable')
 const state=await evaluate(`fetch('/api/dsh-workbench',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({endpoint:'execution.status',payload:{taskId:${JSON.stringify(task.data.task.id)}}})}).then(r=>r.json())`)
 if(state.data.runs[0].status!=='approval-wait')throw new Error('Task not in approval-wait: '+JSON.stringify(state))
 const record=await evaluate(`({text:document.querySelector('.dwb-approval')?.innerText,background:getComputedStyle(document.querySelector('.dwb-approval')).backgroundColor,border:getComputedStyle(document.querySelector('.dwb-approval')).borderTopColor})`)
 if(!record.text.includes('Native QA')||!record.text.includes('printf'))throw new Error('Missing member/command details '+JSON.stringify(record))
 // Capture only this synthetic fixture; no user session data or credentials.
 await evaluate(`window.__dwbFixtureTheme('light'); true`);await pause(150)
 await writeFile(join(home,'approval-light.png'),Buffer.from((await cdp('Page.captureScreenshot',{format:'png'})).data,'base64'))
 const light=await evaluate(`({bg:getComputedStyle(document.querySelector('.dwb-approval')).backgroundColor,fg:getComputedStyle(document.querySelector('.dwb-approval')).color,button:getComputedStyle(document.querySelector('.dwb-approval-allow')).color})`)
 await evaluate(`window.__dwbFixtureTheme('dark'); true`);await pause(150)
 await writeFile(join(home,'approval-dark.png'),Buffer.from((await cdp('Page.captureScreenshot',{format:'png'})).data,'base64'))
 const dark=await evaluate(`({bg:getComputedStyle(document.querySelector('.dwb-approval')).backgroundColor,fg:getComputedStyle(document.querySelector('.dwb-approval')).color,button:getComputedStyle(document.querySelector('.dwb-approval-allow')).color})`)
 if(light.bg===dark.bg||light.fg===dark.fg)throw new Error('Approval card did not adapt to actual theme: '+JSON.stringify({light,dark}))
 await evaluate(`window.__dwbFixtureTheme('light'); true`)
 console.log('PASS browser: group shows original native request and task approval-wait; light/dark styles adapt')
 await until(`Array.from(document.querySelectorAll('.dwb-gitem')).some(e=>e.textContent.includes('Other approval group'))`,'Second group unavailable')
 await evaluate(`Array.from(document.querySelectorAll('.dwb-gitem')).find(e=>e.textContent.includes('Other approval group')).click()`)
 await until(`document.querySelector('.dwb-chat-name')?.textContent==='Other approval group'`,'Group switch failed')
 if(await evaluate(`!!document.querySelector('.dwb-approval')`))throw new Error('Previous approval leaked into another group')
 await pause(2400)
 await evaluate(`Array.from(document.querySelectorAll('.dwb-gitem')).find(e=>e.textContent.includes('Native approval group')).click()`)
 await until(`document.querySelector('.dwb-approval-allow:not(:disabled)')`,'Switching groups withdrew the original request')
 console.log('PASS browser: switching groups hides old cards without withdrawing native approval')
 await evaluate(`document.querySelector('.dwb-approval-allow').click()`)
 await until(`document.querySelector('.dwb-approval')?.innerText.includes('已允许一次')`,'Host result not reflected in group')
 await until(`!document.querySelector('.dwb-approval-allow')`,'Answered controls still active')
 if(errors.length)throw new Error(errors.join('\n'))
 console.log('PASS browser: allow-once answered ORIGINAL native callback, group result synchronized, no Client exceptions')
 const api=(endpoint,payload={})=>evaluate(`fetch('/api/dsh-workbench',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(${JSON.stringify({endpoint,payload})})}).then(r=>r.json())`)
 const finished=()=>`fetch('/api/dsh-workbench',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({endpoint:'tasks.list'})}).then(r=>r.json()).then(d=>d.data.tasks.every(t=>t.status==='已完成'))`
 await until(finished(),'First task did not finish')
 const second=await api('tasks.create',{title:'Reject approval fixture',groupId:process.env.DWB_BROWSER_GROUP,assignees:[process.env.DWB_BROWSER_ROLE]})
 if(!second.ok)throw new Error(JSON.stringify(second))
 await until(`document.querySelector('.dwb-approval-reject:not(:disabled)')`,'Second native approval unavailable')
 await evaluate(`document.querySelector('.dwb-approval-reject:not(:disabled)').click()`)
 await until(`Array.from(document.querySelectorAll('.dwb-approval')).some(e=>e.innerText.includes('已拒绝'))`,'Reject not reflected')
 await until(finished(),'Rejected fixture did not finish')
 const third=await api('tasks.create',{title:'Cancel approval fixture',groupId:process.env.DWB_BROWSER_GROUP,assignees:[process.env.DWB_BROWSER_ROLE]})
 if(!third.ok)throw new Error(JSON.stringify(third))
 await until(`document.querySelector('.dwb-approval-allow:not(:disabled)')`,'Third native approval unavailable')
 const stopped=await api('execution.stop',{taskId:third.data.task.id});if(!stopped.ok)throw new Error(JSON.stringify(stopped))
 await until(`!document.querySelector('.dwb-approval-allow:not(:disabled)')`,'Cancelled approval still actionable')
 const audit=await api('approvals.list',{groupId:process.env.DWB_BROWSER_GROUP})
 if(!audit.data.items.some(a=>a.outcome==='rejected')||!audit.data.items.some(a=>a.outcome==='cancelled'||a.outcome==='expired'))throw new Error('Missing reject/cancel audit '+JSON.stringify(audit))
 if(errors.length)throw new Error(errors.join('\n'))
 await writeFile(join(home,'approval-browser-result.json'),JSON.stringify({light,dark,outcomes:audit.data.items.map(a=>a.outcome),exceptions:errors},null,2))
 console.log('PASS browser: rejection synchronized, cancelled request disabled; original Host audit includes all outcomes')
}finally{
 socket?.close();chrome.kill('SIGTERM')
 await new Promise(resolve=>{if(chrome.exitCode!==null||chrome.signalCode!==null)return resolve();const timer=setTimeout(()=>{chrome.kill('SIGKILL');resolve()},3000);chrome.once('exit',()=>{clearTimeout(timer);resolve()})})
}
