import test from 'node:test'
import assert from 'node:assert/strict'
import { runtime, seed } from './runtime-fixture.mjs'

async function finish(f, task) {
  await f.settle()
  for (const run of f.rt.executionRuns(task.id)) {
    await f.call('dwb_report_execution', { runId: run.id, status: 'completed', summary: 'verified', evidence: ['test passed'] }, run)
  }
  await f.settle()
}
const handoffs = f => (f.rt.state.execution.reviewOutbox ?? [])

test('all assignees complete before durable admin handoff; repeated sync does not resend', async () => {
  const f = await runtime()
  try {
    const group = seed(f.rt)
    const task = await f.rt.createTask({ title: 'T', groupId: group.id, assignees: ['role_1', 'role_2'] })
    await f.settle()
    const [a,b] = f.rt.executionRuns(task.id)
    await f.call('dwb_report_execution', {runId:a.id,status:'completed',summary:'A',evidence:['A']}, a)
    assert.equal(handoffs(f).length, 0)
    await f.call('dwb_report_execution', {runId:b.id,status:'completed',summary:'B',evidence:['B']}, b)
    await f.settle()
    assert.equal(group.delivery.status, 'awaiting-review')
    assert.equal(handoffs(f).length, 1)
    assert.equal(handoffs(f)[0].status, 'sent')
    const admin = f.sessions.get(group.sessions.role_1.id)
    const admitted = () => admin.session.snapshotEvents().filter(e => e.type === 'agent/inbox/spliced').flatMap(e => e.data.inserted ?? [])
    assert.equal(admitted().length, 1)
    await f.rt.syncDelivery(); await f.rt.syncDelivery()
    assert.equal(admitted().length, 1)
    assert.equal(group.log.filter(l => l.id === handoffs(f)[0].id).length, 0)
    assert.ok(admitted()[0].id.startsWith('dwb-handoff-'))
  } finally { await f.close() }
})

test('prerequisite completion starts dependent test but does not request final delivery', async () => {
  const f = await runtime()
  try {
    const g=seed(f.rt)
    const a=await f.rt.createTask({title:'Implement',groupId:g.id,assignees:['role_2']})
    const b=await f.rt.createTask({title:'Verify',groupId:g.id,assignees:['role_2'],dependencies:[a.id]})
    await finish(f,a)
    assert.equal(handoffs(f).length,0)
    assert.equal(f.rt.executionRuns(b.id)[0].status,'running')
    await finish(f,b)
    assert.equal(handoffs(f).filter(x=>x.status==='sent').length,1)
  } finally {await f.close()}
})

test('handoff delivery failure remains durable and retries once without duplicate group notice', async () => {
  const f=await runtime()
  try {
    const g=seed(f.rt), t=await f.rt.createTask({title:'T',groupId:g.id,assignees:['role_2']})
    await f.settle(); f.failDelivery(true)
    await finish(f,t)
    assert.equal(handoffs(f)[0].status,'pending')
    assert.ok(handoffs(f)[0].error)
    f.failDelivery(false); await f.rt.syncDelivery()
    assert.equal(handoffs(f)[0].status,'sent')
    assert.equal(g.log.filter(l=>l.id===handoffs(f)[0].id).length,0)
  }finally{await f.close()}
})

test('no administrator keeps review pending; restored administrator receives it', async()=>{
  const f=await runtime()
  try {
    const g=seed(f.rt);g.admins=[]
    const t=await f.rt.createTask({title:'T',groupId:g.id,assignees:['role_2']})
    await finish(f,t)
    assert.equal(handoffs(f)[0].status,'pending')
    g.admins=['role_1'];await f.rt.syncDelivery()
    assert.equal(handoffs(f)[0].status,'sent')
  }finally{await f.close()}
})

test('final delivery is admin-only, deduplicated, and invalidated by rework',async()=>{
  const f=await runtime()
  try {
    const g=seed(f.rt),t=await f.rt.createTask({title:'T',groupId:g.id,assignees:['role_2']})
    await f.settle()
    await assert.rejects(f.rt.completeDelivery({groupId:g.id,fromRoleId:'role_1',summary:'done'}),/未完成/)
    await finish(f,t)
    await assert.rejects(f.rt.completeDelivery({groupId:g.id,fromRoleId:'role_2',summary:'done'}),/管理员/)
    assert.equal((await f.rt.completeDelivery({groupId:g.id,fromRoleId:'role_1',summary:'entry; verified; limits'})).duplicate,false)
    assert.equal(g.delivery.status,'delivered')
    assert.equal((await f.rt.completeDelivery({groupId:g.id,fromRoleId:'role_1',summary:'again'})).duplicate,true)
    assert.equal(g.log.filter(l=>l.text.startsWith('✅ 任务完成')).length,1)
    await f.rt.updateTask(t.id,{description:'rework'})
    await f.settle()
    assert.notEqual(g.delivery.status,'delivered')
  }finally{await f.close()}
})

test('recovery creates a durable missed completion handoff but defers transport',async()=>{
  const f=await runtime()
  try {
    const g=seed(f.rt)
    const t=await f.rt.createTask({title:'T',groupId:g.id,assignees:['role_2']})
    await f.settle()
    f.rt.updateTaskRecord(t.id,{status:'已完成'})
    await f.rt.syncDelivery({deliver:false})
    assert.equal(handoffs(f).length,1)
    assert.equal(handoffs(f)[0].status,'pending')
    assert.equal(Object.keys(g.sessions??{}).length,0)
    await f.rt.syncDelivery()
    assert.equal(handoffs(f)[0].status,'sent')
  }finally{await f.close()}
})

test('pending handoff survives restart and stays pinned across admin session rotation',async()=>{
  const f=await runtime();let restored
  try {
    const g=seed(f.rt),t=await f.rt.createTask({title:'T',groupId:g.id,assignees:['role_2']})
    await f.settle();f.failDelivery(true);await finish(f,t)
    const target=handoffs(f)[0].targetSessionId
    assert.ok(target)
    await f.close(false)
    restored=await runtime({home:f.home,sessions:f.sessions})
    const rg=restored.rt.getGroup(g.id)
    rg.sessions.role_1={id:'rotated-admin',count:0,seen:0}
    await restored.ctx.sessionController.create({sessionId:'rotated-admin'})
    // Existing session closures retain original transport failure switch.
    f.failDelivery(false)
    await restored.rt.syncDelivery()
    assert.equal(handoffs(restored)[0].status,'sent')
    assert.equal(handoffs(restored)[0].targetSessionId,target)
    assert.equal(rg.sessions.role_1.id,'rotated-admin')
  }finally{if(restored)await restored.close();else await f.close()}
})

test('scope mutation and final delivery are serialized; a new task invalidates delivery',async()=>{
  const f=await runtime()
  try {
    const g=seed(f.rt),t=await f.rt.createTask({title:'T',groupId:g.id,assignees:['role_2']})
    await finish(f,t)
    const post=f.rt.postGroupMessage;let release,entered
    const blocked=new Promise(r=>{entered=r})
    f.rt.postGroupMessage=async args=>{
      if(args.text.startsWith('✅')){entered();await new Promise(r=>{release=r})}
      return post(args)
    }
    const deliver=f.rt.completeDelivery({groupId:g.id,fromRoleId:'role_1',summary:'entry; verified; limits'})
    await blocked
    let created=false
    const next=f.rt.createTask({title:'Next',groupId:g.id,assignees:['role_2']}).then(t=>{created=true;return t})
    await Promise.resolve();assert.equal(created,false)
    release();await deliver;await next;await f.settle()
    assert.equal(g.delivery.status,'in-progress')
  }finally{await f.close()}
})

test('startup records historical completion without waking or pretending delivered',async()=>{
  const f=await runtime()
  try {
    const g=seed(f.rt)
    f.rt.addTask({id:'task_old',title:'Old',groupId:g.id,assignees:['role_2'],status:'已完成',revision:1})
    await f.rt.syncDelivery({deliver:false})
    assert.equal(g.delivery.status,'awaiting-review')
    await f.rt.syncDelivery()
    assert.equal(handoffs(f).length,0)
    assert.equal(Object.keys(g.sessions??{}).length,0)
  }finally{await f.close()}
})
