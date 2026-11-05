import test from 'node:test'
import assert from 'node:assert/strict'
import { ExecutionEngine } from '../src/host/execution-engine.js'

function fixture(options = {}) {
  let clock = 100
  const state = { runs: [], inputs: [], version: 1 }
  const calls = [], snapshots = []
  const transport = {
    async ensureSession(run) { calls.push(['ensure', run.id]); return `s-${run.id}` },
    async deliver(run, input) { calls.push(['deliver', run.id, input.id]) },
    async cancel(run) { calls.push(['cancel', run.id]) },
  }
  const engine = new ExecutionEngine({ getState: () => state,
    persist: async () => snapshots.push(structuredClone(state)), transport,
    now: () => clock, ...options })
  return { engine, state, transport, calls, snapshots, advance: n => { clock += n } }
}
const task = (id = 't', assignees = ['a'], priority = '中') =>
  ({ id, groupId: 'g', title: id, description: 'Do the work', assignees, priority })

test('priority, global role lock, concurrency, independent sessions and scheduling gate', async () => {
  const f = fixture({ maxConcurrent: 2, canRun: r => r.roleId !== 'disabled' })
  await f.engine.enqueue(task('low', ['a'], '低'))
  await f.engine.enqueue(task('high', ['a', 'b', 'c', 'disabled'], '高'))
  await Promise.all([f.engine.tick(), f.engine.tick()])
  const active = f.state.runs.filter(r => r.status === 'running')
  assert.deepEqual(active.map(r => r.roleId), ['a', 'b'])
  assert.ok(active.every(r => r.taskId === 'high'))
  assert.equal(new Set(active.map(r => r.sessionId)).size, 2)
  assert.equal(f.calls.filter(c => c[0] === 'deliver').length, 2)
})

test('persist run and input before ensure, session and delivery intent before deliver', async () => {
  const f = fixture()
  f.transport.ensureSession = async run => {
    const saved = f.snapshots.at(-1)
    assert.equal(saved.runs[0].id, run.id)
    assert.equal(saved.inputs[0].status, 'pending')
    return 'session'
  }
  f.transport.deliver = async (run, input) => {
    const saved = f.snapshots.at(-1)
    assert.equal(saved.runs[0].sessionId, 'session')
    assert.equal(saved.inputs.find(i => i.id === input.id).status, 'delivering')
  }
  await f.engine.enqueue(task()); await f.engine.tick()
  assert.equal(f.state.inputs[0].status, 'sent')
})

test('delivery failure uses exponential backoff and finite attempts', async () => {
  const f = fixture({ maxAttempts: 3, retryBaseMs: 10 })
  f.transport.deliver = async () => { throw Error('offline') }
  await f.engine.enqueue(task()); await f.engine.tick()
  assert.equal(f.state.runs[0].status, 'retry')
  assert.equal(f.state.runs[0].nextAt, 110)
  await f.engine.tick(); assert.equal(f.state.runs[0].attempts, 1)
  f.advance(10); await f.engine.tick()
  assert.equal(f.state.runs[0].nextAt, 130)
  f.advance(20); await f.engine.tick()
  assert.equal(f.state.runs[0].status, 'failed')
  assert.match(f.state.runs[0].error, /offline/)
})

test('completion requires proof and inputs deduplicate without reopening terminal runs', async () => {
  const f = fixture(); await f.engine.enqueue(task()); await f.engine.tick()
  const run = f.state.runs[0]
  await assert.rejects(f.engine.report(run.id, { status: 'completed', summary: 'done' }), /evidence/)
  await f.engine.input('t', 'one', { eventId: 'evt' })
  await f.engine.input('t', 'one', { eventId: 'evt' })
  assert.equal(f.state.inputs.filter(i => i.eventId === 'evt').length, 1)
  await assert.rejects(f.engine.report(run.id, { status: 'completed', summary: 'done', evidence: ['test passed'] }), /未处理输入/)
  await f.engine.tick()
  for (const input of f.state.inputs) await f.engine.event(run.sessionId, {type:'user/message',data:{source:{executionInputId:input.id}}})
  await f.engine.report(run.id, { status: 'completed', summary: 'done', evidence: ['test passed'] })
  await f.engine.input('t', 'more'); await f.engine.retryTask('t')
  assert.equal(run.status, 'completed'); assert.equal(f.state.inputs.length, 2)
  const copy = f.engine.list('t'); copy[0].summary = 'changed'
  assert.equal(run.summary, 'done')
})

test('restart recovers logged admission and never redelivers it', async () => {
  const f = fixture(); await f.engine.enqueue(task()); await f.engine.tick()
  const run = f.state.runs[0], input = f.state.inputs[0]
  input.status = 'delivering'
  await f.engine.recover(new Map([[run.sessionId, { running: true, events: [
    { type: 'inbox/inserted', message: { source: { executionInputId: input.id } } },
  ] }]]))
  assert.equal(input.status, 'sent')
  await f.engine.tick()
  assert.equal(f.calls.filter(c => c[0] === 'deliver').length, 1)
})

test('recovery of an interrupted worker is bounded and retains stable unlogged input id', async () => {
  const f = fixture({ maxAttempts: 2 }); await f.engine.enqueue(task()); await f.engine.tick()
  const run = f.state.runs[0], id = f.state.inputs[0].id
  f.state.inputs[0].status = 'delivering'
  await f.engine.recover(new Map())
  assert.equal(run.status, 'queued'); assert.equal(f.state.inputs[0].id, id)
  await f.engine.tick(); await f.engine.recover(new Map())
  assert.equal(run.status, 'failed')
})

test('cancellation persists before side effects and ignores stale events and reports', async () => {
  const f = fixture(); await f.engine.enqueue(task()); await f.engine.tick()
  const run = f.state.runs[0]
  f.transport.cancel = async () => assert.equal(f.snapshots.at(-1).runs[0].status, 'cancelled')
  await f.engine.cancelTask('t')
  await f.engine.event(run.sessionId, { type: 'turn/end', status: 'completed' })
  await f.engine.report(run.id, { status: 'running' })
  assert.equal(run.status, 'cancelled')
  assert.ok(f.state.inputs.every(i => i.status === 'cancelled'))
})

test('quiet running workers get attention, no-report waiting gets only one reminder', async () => {
  const f = fixture({ staleMs: 10 }); await f.engine.enqueue(task()); await f.engine.tick()
  const run = f.state.runs[0]
  f.advance(11); await f.engine.tick()
  assert.equal(run.status, 'running'); assert.ok(run.attention)
  assert.equal(f.calls.filter(c => c[0] === 'cancel').length, 0)
  await f.engine.event(run.sessionId, { type: 'turn/end', status: 'completed' })
  assert.equal(run.status, 'waiting')
  f.advance(11); await f.engine.tick()
  assert.equal(f.state.inputs.filter(i => i.kind === 'continuation').length, 1)
  await f.engine.event(run.sessionId, { type: 'turn/end', status: 'completed' })
  f.advance(11); await f.engine.tick()
  assert.equal(run.status, 'blocked')
})

test('user abort pauses until explicit retry; legacy tasks never replay', async () => {
  const f = fixture(); await f.engine.enqueue(task()); await f.engine.tick()
  const run = f.state.runs[0]
  await f.engine.event(run.sessionId, { type: 'turn/end', status: 'aborted', cause: 'user' })
  assert.equal(run.status, 'paused')
  await f.engine.input('t', 'hello'); await f.engine.tick()
  assert.equal(run.status, 'paused')
  await f.engine.retryTask('t'); await f.engine.tick(); assert.equal(run.status, 'running')
  await f.engine.enqueue(task('old', ['z']), { legacy: true }); await f.engine.tick()
  assert.equal(f.engine.list('old')[0].status, 'paused')
})

test('reconcile revisions cancel old generations; external completion is distinct', async () => {
  const f = fixture(); const t = task(); await f.engine.enqueue(t); await f.engine.tick()
  const old = f.state.runs[0]
  await f.engine.reconcileTask({ ...t, description: 'new scope', assignees: ['a', 'b'] })
  assert.equal(old.status, 'cancelled'); assert.equal(f.state.runs.length, 3)
  assert.ok(f.state.runs.slice(1).every(r => r.generation === 2))
  await f.engine.event(old.sessionId, { type: 'user/message', source: { executionInputId: f.state.inputs[0].id } })
  assert.equal(old.status, 'cancelled')
  await f.engine.reconcileTask({ ...t, status: '已完成' })
  assert.ok(f.state.runs.slice(1).every(r => r.status === 'completed' && r.completedExternally))
})

test('removed assignee can be re-added without reviving cancelled run', async () => {
  const f = fixture(); const t = task('t', ['a', 'b'])
  await f.engine.enqueue(t); await f.engine.tick()
  const removed = f.state.runs.find(r => r.roleId === 'b')
  await f.engine.reconcileTask({ ...t, assignees: ['a'] })
  assert.equal(removed.status, 'cancelled')
  await f.engine.reconcileTask(t)
  assert.equal(f.state.runs.filter(r => r.roleId === 'b').length, 2)
  assert.equal(f.state.runs.at(-1).status, 'queued')
})

test('repeated recovery and duplicate error observations cannot multiply reminders', async () => {
  const f = fixture(); await f.engine.enqueue(task()); await f.engine.tick()
  const run = f.state.runs[0], original = f.state.inputs[0]
  const observations = new Map([[run.sessionId, { running: false, events: [
    { type: 'user/message', source: { executionInputId: original.id } },
  ] }]])
  await f.engine.recover(observations); await f.engine.recover(observations)
  await f.engine.event(run.sessionId, { type: 'turn/end', status: 'error' })
  await f.engine.event(run.sessionId, { type: 'turn/end', status: 'error' })
  assert.equal(f.state.inputs.filter(i => i.kind === 'recovery').length, 1)
})

test('tool heartbeat clears attention and explicit waiting report needs no reminder', async () => {
  const f = fixture({ staleMs: 10 }); await f.engine.enqueue(task()); await f.engine.tick()
  const run = f.state.runs[0]
  f.advance(11); await f.engine.tick(); assert.ok(run.attention)
  await f.engine.event(run.sessionId, { type: 'tool/result' })
  assert.equal(run.attention, undefined)
  await f.engine.report(run.id, { status: 'waiting', summary: 'Need user data' })
  await f.engine.recover(new Map([[run.sessionId, { running: false, events: [
    { type: 'user/message', source: { executionInputId: f.state.inputs[0].id } },
  ] }]]))
  f.advance(11); await f.engine.tick()
  assert.equal(run.status, 'waiting'); assert.equal(f.state.inputs.length, 1)
  await f.engine.input('t', 'Here is the data'); await f.engine.tick()
  assert.equal(run.status, 'running')
})

test('session creation failure retries without delivery; failed persistence prevents side effects', async () => {
  const f = fixture({ maxAttempts: 1 })
  f.transport.ensureSession = async () => { throw Error('session offline') }
  await f.engine.enqueue(task()); await f.engine.tick()
  assert.equal(f.state.runs[0].status, 'failed')
  assert.equal(f.calls.length, 0)
  const g = fixture()
  g.engine.persist = async () => { throw Error('disk offline') }
  await assert.rejects(g.engine.enqueue(task()), /disk offline/)
  await assert.rejects(g.engine.tick(), /disk offline/)
  assert.equal(g.calls.length, 0)
})
