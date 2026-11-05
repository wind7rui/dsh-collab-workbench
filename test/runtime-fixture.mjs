import {mkdtemp,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join,basename,resolve} from 'node:path'
import {AsyncLocalStorage} from 'node:async_hooks'
import {randomUUID} from 'node:crypto'
import * as ledger from '../src/host/ledger.js'
import * as agents from '../src/host/agents.js'
import * as groups from '../src/host/groups.js'
import * as channels from '../src/host/channels.js'
import * as tasks from '../src/host/tasks.js'
import * as execution from '../src/host/execution.js'
import * as delivery from '../src/host/delivery.js'
import * as executionTools from '../src/host/execution-tools.js'
import * as api from '../src/host/api.js'

export async function runtime(options={}){
 const home=options.home??await mkdtemp(join(tmpdir(),'dwb-test-'))
 const handlers=new Map(),sessions=options.sessions??new Map(),definitions=new Map(),guards=[],cleanups=[],local=new AsyncLocalStorage()
 let rpc,failDelivery=false
 const emit=(name,...args)=>{for(const fn of handlers.get(name)??[]) fn(...args)}
 const service={get:id=>sessions.get(id),currentInitiator:()=>local.getStore(),withoutInitiator:fn=>local.run(undefined,fn)}
 const ctx={get:name=>name==='agents'?service:name==='sessionController'?ctx.sessionController:undefined,
  on(name,fn){handlers.set(name,[...(handlers.get(name)??[]),fn])},effect(fn){cleanups.push(fn())},
  tools:{register:d=>definitions.set(d.name,d),guard:g=>guards.push(g)},
  connection:{fetch:{register:r=>{rpc=r.fetch}}},
  workspaceRegistry:{archiveSession:async()=>{}},sessionTitle:{rename:async()=>{}},
  sessionProjections:{stateOf(session){const inbox={'next-turn':[],'next-step':[]};for(const e of session.snapshotEvents())if(e.type==='agent/inbox/spliced'){const d=e.data;inbox[d.target].splice(d.start,d.removedCount??0,...(d.inserted??[]))}return inbox}},
  sessions:{flush:async()=>true},
  sessionController:{
   async inspect(id){const a=sessions.get(id);if(!a)throw Object.assign(new Error('session not found'),{code:'session/not-found'});return{events:a.session.snapshotEvents()}},
   async create({sessionId=randomUUID()}){if(sessions.has(sessionId))throw new Error('duplicate');const events=[];const a={id:sessionId,status:'idle',session:{id:sessionId,snapshotEvents:()=>structuredClone(events)},followup(m){if(failDelivery)throw new Error('temporary delivery failed');a.status='running';append(a,'agent/inbox/spliced',{target:'next-turn',start:0,inserted:[m]})},cancel(cause,options={}){a.status='idle';if(!options.keepInbox)for(const target of ['next-step','next-turn']){const pending=ctx.sessionProjections.stateOf(a.session)[target];if(pending.length)append(a,'agent/inbox/spliced',{target,start:0,removedCount:pending.length,inserted:[],outcome:'canceled'})}append(a,'turn/end',{reason:{kind:'aborted',reason:cause}})}};sessions.set(sessionId,a);return{sessionId}},
   async resolveAgent(id){return {agent:sessions.get(id)}},
   async list(){return{items:[...sessions.values()].map(a=>({sessionId:a.id,running:a.status==='running'}))}},
   selectModel:async()=>{},
  }}
 function append(a,type,data){const events=a.session.snapshotEvents();const event={seq:events.length,time:Date.now(),type,data};const orig=a.session.snapshotEvents;a.session.snapshotEvents=()=>[...orig(),structuredClone(event)];emit('session/event',a.session,event);return event}
 const rt={ctx,home,statePath:join(home,'state.json'),config:{tickMs:3600000,retryBaseMs:0,...options.config}}
 ledger.install(rt);agents.install(rt);groups.install(rt);channels.install(rt);tasks.install(rt)
 rt.ensureGroupWorkspace=async()=> 'ws';rt.ensureWorkspace=async()=> 'ws'
 execution.install(rt);delivery.install(rt);executionTools.install(rt);api.install(rt)
 await rt.startExecution()
 const settle=async()=>{await rt.drainExecution();await rt.saveAll() }
 async function call(name,args,run){return local.run(run?sessions.get(run.sessionId):undefined,async()=>{if(run){const a=sessions.get(run.sessionId),events=a.session.snapshotEvents(),readIds=new Set(events.filter(e=>e.type==='user/message').map(e=>e.data.id));for(const m of events.filter(e=>e.type==='agent/inbox/spliced').flatMap(e=>e.data.inserted??[]))if(!readIds.has(m.id))append(a,'user/message',m);await settle()}
 const def=definitions.get(name);const exec={agent:run?sessions.get(run.sessionId):undefined,name,arguments:args,concludeTurn(){if(run){const a=sessions.get(run.sessionId);a.status='idle';append(a,'turn/end',{reason:{kind:'completed'}})}}};for(const g of guards){const reason=g(exec);if(reason)throw new Error(reason)}return def.execute(args,exec)})}
 return {rt,ctx,sessions,definitions,append,settle,call,home,failDelivery:value=>{failDelivery=value},
  async request(endpoint,payload={}){const res=await rpc(new Request('http://local/api/dsh-workbench',{method:'POST',body:JSON.stringify({endpoint,payload})}));return res.json()},
  async close(remove=true){for(const cleanup of cleanups)await cleanup?.();if(remove){if(!basename(home).startsWith('dwb-test-')||resolve(home)===resolve(tmpdir()))throw new Error('Unexpected test cleanup path');await rm(home,{recursive:true,force:true})}}}
}
export function seed(rt){
 const group={id:'group_1',name:'Test',status:'active',dir:'/tmp',members:['role_1','role_2'],admins:['role_1']}
 rt.addGroup(group);rt.addRole({id:'role_1',name:'A',status:'active'});rt.addRole({id:'role_2',name:'B',status:'active'});return group
}
