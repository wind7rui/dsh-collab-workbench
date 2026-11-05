import test from 'node:test'
import assert from 'node:assert/strict'
import {runtime, seed} from './runtime-fixture.mjs'

test('running reports stay private; completion is concise with full evidence retained', async () => {
 const f = await runtime()
 try {
  seed(f.rt)
  const task = await f.rt.createTask({title:'T',groupId:'group_1',assignees:['role_2']})
  await f.settle()
  const run = f.rt.executionRuns(task.id)[0]
  const messages = []
  const post = f.rt.postGroupMessage
  f.rt.postGroupMessage = async args => {messages.push(args);return post(args)}
  await f.call('dwb_report_execution',{runId:run.id,status:'running',summary:'working'},run)
  await f.settle()
  assert.equal(messages.length,0)
  const summary = '完成验证'.repeat(100)
  const evidence = ['artifact.txt','passed '.repeat(100)]
  await f.call('dwb_report_execution',{runId:run.id,status:'completed',summary,evidence},run)
  await f.settle()
  assert.equal(messages.length,1)
  assert.ok(messages[0].text.length < 220)
  assert.match(messages[0].text,/dwb_task_execution/)
  const saved = f.rt.executionRuns(task.id)[0]
  assert.equal(saved.summary,summary)
  assert.deepEqual(saved.evidence,evidence)
 } finally {await f.close()}
})

test('blocked report produces only one attention notice', async () => {
 const f = await runtime()
 try {
  seed(f.rt)
  const task = await f.rt.createTask({title:'T',groupId:'group_1',assignees:['role_2']})
  await f.settle()
  const run = f.rt.executionRuns(task.id)[0]
  const messages = []
  const post = f.rt.postGroupMessage
  f.rt.postGroupMessage = async args => {messages.push(args);return post(args)}
  await f.call('dwb_report_execution',{runId:run.id,status:'blocked',summary:'需要接口权限'},run)
  await f.settle()
  assert.equal(messages.length,1)
  assert.match(messages[0].text,/需要接口权限/)
 } finally {await f.close()}
})
