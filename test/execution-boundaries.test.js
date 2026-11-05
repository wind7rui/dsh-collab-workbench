import test from 'node:test'
import assert from 'node:assert/strict'
import {ExecutionEngine} from '../src/host/execution-engine.js'
function setup(){let now=1;const state={runs:[],inputs:[]};let sends=0;const engine=new ExecutionEngine({getState:()=>state,persist:async()=>{},now:()=>now,transport:{ensureSession:async r=>'s-'+r.id,deliver:async()=>{sends++},cancel:async()=>{}},staleMs:10});return{engine,state,advance:()=>{now+=20},sends:()=>sends}}
const task={id:'task_1',groupId:'g',assignees:['a'],title:'T',description:'D',priority:'中',status:'待办'}
test('restart respects durable user stop even if ledger missed last turn end',async()=>{
 const {engine,state}=setup();await engine.enqueue(task);await engine.tick();const r=state.runs[0]
 await engine.recover(new Map([[r.sessionId,{events:[{seq:20,type:'turn/end',status:'aborted',cause:'user'}],running:false}]]))
 assert.equal(r.status,'paused')
})
test('inbox admission is sent, user/message is read',async()=>{
 const {engine,state}=setup();await engine.enqueue(task);await engine.tick();const r=state.runs[0],i=state.inputs[0]
 await engine.event(r.sessionId,{seq:1,type:'agent/inbox/spliced',data:{inserted:[{source:{executionInputId:i.id}}]}})
 assert.equal(i.status,'sent')
 await engine.event(r.sessionId,{seq:2,type:'user/message',data:{source:{executionInputId:i.id}}})
 assert.equal(i.status,'read')
})
test('ordinary followups do not exhaust transient retry budget',async()=>{
 const {engine,state}=setup();await engine.enqueue(task);await engine.tick();const r=state.runs[0]
 for(let n=0;n<5;n++){await engine.event(r.sessionId,{type:'turn/end',status:'completed'});await engine.input(task.id,'more',{eventId:'e'+n});await engine.tick();assert.equal(r.status,'running')}
})
test('progress-only report still requires final outcome after turn ends',async()=>{
 const {engine,state,advance}=setup();await engine.enqueue(task);await engine.tick();const r=state.runs[0]
 await engine.report(r.id,{status:'running',summary:'progress'})
 await engine.event(r.sessionId,{type:'turn/end',status:'completed'});advance();await engine.tick()
 assert.equal(r.reminders,1)
})
test('followup accepted during a running turn dispatches immediately after its end',async()=>{
 const {engine,state,sends}=setup();await engine.enqueue(task);await engine.tick();const r=state.runs[0]
 await engine.input(task.id,'new correction',{eventId:'late'})
 await engine.event(r.sessionId,{type:'turn/end',status:'completed'})
 assert.equal(r.status,'queued');await engine.tick();assert.equal(sends(),2)
})
test('decision resolution persists answer and release in the same checkpoint',async()=>{
 const {engine,state}=setup();await engine.enqueue(task);await engine.tick();const r=state.runs[0]
 await engine.report(r.id,{status:'blocked',summary:'choose'})
 state.pendingDecision={seq:9};let snapshot
 engine.persist=async()=>{snapshot=structuredClone(state)}
 await engine.resolveDecision(task.id,'Answer A',{eventId:'decision:9',runId:r.id,commit(){state.pendingDecision=null}})
 assert.equal(snapshot.pendingDecision,null);assert.equal(snapshot.runs[0].status,'queued')
 assert.equal(snapshot.inputs.find(i=>i.kind==='decision').text,'Answer A')
})
test('idle ticks do not produce durable writes',async()=>{
 const {engine}=setup();let writes=0;engine.persist=async()=>{writes++}
 await engine.tick();await engine.tick();assert.equal(writes,0)
})
