import test from 'node:test'
import assert from 'node:assert/strict'
import {runtime,seed} from './runtime-fixture.mjs'

test('RPC create automatically starts independent sessions and joins per-assignee completion',async()=>{
 const f=await runtime();try{
  seed(f.rt)
  const response=await f.request('tasks.create',{title:'Implement',groupId:'group_1',assignees:['role_1','role_2']})
  assert.equal(response.ok,true,JSON.stringify(response));await f.settle()
  const task=response.data.task,runs=f.rt.executionRuns(task.id)
  assert.equal(runs.length,2);assert.notEqual(runs[0].sessionId,runs[1].sessionId)
  assert.equal(f.rt.getTask(task.id).status,'进行中')
  for(const r of runs){const a=f.sessions.get(r.sessionId);assert.ok(a.session.snapshotEvents()[0].data.inserted[0].source.executionInputId)}
  await f.call('dwb_report_execution',{runId:runs[0].id,status:'completed',summary:'A done',evidence:['A.txt']},runs[0]);await f.settle()
  assert.notEqual(f.rt.getTask(task.id).status,'已完成')
  await f.call('dwb_report_execution',{runId:runs[1].id,status:'completed',summary:'B done',evidence:['B.txt']},runs[1]);await f.settle()
  assert.equal(f.rt.getTask(task.id).status,'已完成')
 }finally{await f.close()}
})
test('task topic route reaches task session and does not create general chat session',async()=>{
 const f=await runtime();try{seed(f.rt);const t=await f.rt.createTask({title:'T',groupId:'group_1',assignees:['role_2']});await f.settle()
 const res=await f.request('messages.post',{groupId:'group_1',taskId:t.id,text:'more details'})
 assert.equal(res.ok,true);await f.settle()
 const run=f.rt.executionRuns(t.id)[0];assert.equal(f.rt.state.execution.inputs.filter(i=>i.runId===run.id).length,2)
 assert.equal(Object.keys(f.rt.getGroup('group_1').sessions??{}).length,0)
 }finally{await f.close()}
})
test('dependencies wait; completed prerequisite releases dependent task automatically',async()=>{
 const f=await runtime();try{seed(f.rt)
 const a=await f.rt.createTask({title:'A',groupId:'group_1',assignees:['role_1']})
 const b=await f.rt.createTask({title:'B',groupId:'group_1',assignees:['role_2'],dependencies:[a.id]});await f.settle()
 assert.equal(f.rt.executionRuns(b.id)[0].status,'queued')
 const run=f.rt.executionRuns(a.id)[0]
 await f.call('dwb_report_execution',{runId:run.id,status:'completed',summary:'ready',evidence:['test passed']},run);await f.settle()
 assert.equal(f.rt.executionRuns(b.id)[0].status,'running')
 }finally{await f.close()}
})
test('member stop survives restart; legacy work is migrated paused without launch',async()=>{
 const f=await runtime();let g
 try{seed(f.rt);const t=await f.rt.createTask({title:'T',groupId:'group_1',assignees:['role_2']});await f.settle()
 await f.rt.stopPerson('group_1','role_2');assert.equal(f.rt.executionRuns(t.id)[0].status,'paused')
 await f.close(false)
 g=await runtime({home:f.home,sessions:f.sessions});await g.settle()
 assert.equal(g.rt.executionRuns(t.id)[0].status,'paused')
 await g.rt.retryExecution(t.id);await g.settle();assert.equal(g.rt.executionRuns(t.id)[0].status,'running')
 }finally{if(g)await g.close();else await f.close()}
})
test('ordinary user message cannot clear decision; exact option resumes task',async()=>{
 const f=await runtime();try{const group=seed(f.rt);const t=await f.rt.createTask({title:'T',groupId:group.id,assignees:['role_2']});await f.settle()
 group.pendingDecision={seq:20,taskId:t.id,options:'A Go | B Stop'}
 const run=f.rt.executionRuns(t.id)[0];await f.rt.executionEngine.report(run.id,{status:'blocked',summary:'choose'})
 const a=f.sessions.get(run.sessionId);a.status='idle'
 await f.rt.postGroupMessage({groupId:group.id,text:'some unrelated context',taskId:t.id});assert.ok(group.pendingDecision)
 await f.rt.postGroupMessage({groupId:group.id,text:'A'});await f.settle()
 assert.equal(group.pendingDecision,null);assert.equal(f.rt.executionRuns(t.id)[0].status,'running')
 }finally{await f.close()}
})
