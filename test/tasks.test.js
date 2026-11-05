import test from 'node:test'
import assert from 'node:assert/strict'
import { install } from '../src/host/tasks.js'

function fixture() {
  const group = { id: 'group_1', name: 'G', members: ['role_1'], status: 'active' }
  const state = { tasks: { items: [] } }
  let calls = 0
  const rt = { state, ctx: {}, loadAll: async () => {}, touch() {}, nextId: () => `task_${++calls}`, getGroup: id => ['group_1', 'G'].includes(id) ? group : undefined,
    getRole: id => ({ id, name: id, status: 'active' }), listTasks: () => state.tasks.items, getTask: id => state.tasks.items.find(t=>t.id===id), addTask: t=>state.tasks.items.push(t),
    postGroupMessage: async () => {}, taskChanged: async () => {}, taskCreated: async () => {} }
  install(rt)
  return {rt,group}
}

test('task creation obeys decision and membership checks on business entry point', async () => {
  const {rt,group}=fixture()
  group.pendingDecision={seq:1}
  await assert.rejects(rt.createTask({title:'X',groupId:'group_1',assignees:['role_1']}),/决策/)
  group.pendingDecision=null
  await assert.rejects(rt.createTask({title:'X',groupId:'group_1',assignees:['outsider']}),/成员/)
})
test('task creation schedules exactly once with canonical id; notification carries identity', async()=>{
  const {rt}=fixture();const scheduled=[];const messages=[]
  rt.taskCreated=async t=>scheduled.push(t.id)
  rt.postGroupMessage=async m=>messages.push(m)
  const t=await rt.createTask({title:'X',groupId:'G',assignees:['role_1']})
  assert.deepEqual(scheduled,[t.id]);assert.equal(messages[0].taskId,t.id)
})
test('public task patch cannot overwrite identity or execution state',async()=>{
  const {rt}=fixture();const t=await rt.createTask({title:'X',groupId:'G',assignees:['role_1']})
  await assert.rejects(rt.updateTask(t.id,{id:'evil',groupId:'other',execution:{}}),/字段/)
  await assert.rejects(rt.updateTask(t.id,{assignees:[]}),/至少/)
})
test('completedAt survives metadata edits and dependencies reject cycles',async()=>{
  const {rt}=fixture();const a=await rt.createTask({title:'A',groupId:'G',assignees:['role_1']})
  const b=await rt.createTask({title:'B',groupId:'G',assignees:['role_1'],dependencies:[a.id]})
  await assert.rejects(rt.updateTask(a.id,{dependencies:[b.id]}),/循环/)
  await rt.updateTask(a.id,{status:'已完成'});const at=rt.getTask(a.id).completedAt
  await rt.updateTask(a.id,{title:'A edited'});assert.equal(rt.getTask(a.id).completedAt,at)
})
