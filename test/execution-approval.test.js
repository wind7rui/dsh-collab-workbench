import test from 'node:test'
import assert from 'node:assert/strict'
import { ExecutionEngine } from '../src/host/execution-engine.js'

async function fixture(options = {}) {
  let now = 100
  const state = {runs: [], inputs: []}, deliveries = []
  const engine = new ExecutionEngine({getState: () => state, persist: async () => {},
    now: () => now, staleMs: 10, maxAttempts: 2, ...options,
    transport: {ensureSession: async r => `s-${r.id}`, deliver: async (r, i) => deliveries.push(i.id), cancel: async () => {}}})
  const enqueue = (id, role = 'a') => engine.enqueue({id, groupId: 'g', title: id, assignees: [role]})
  await enqueue('t'); await engine.tick()
  const run = state.runs[0]
  const event = (type, seq, data = {}) => engine.event(run.sessionId, {type, seq, data})
  return {engine, state, run, event, enqueue, deliveries, advance: () => {now += 100}}
}

test('multiple IDs settle exactly once; audit seq duplicates never reopen approvals', async () => {
  const f = await fixture()
  await f.event('approval/asked', 1, {id: 'a', toolName: 'bash', callId: 'c', reason: 'write'})
  await f.event('approval/asked', 2, {id: 'b', toolName: 'edit'})
  assert.equal(f.run.status, 'approval-wait')
  assert.deepEqual(f.run.approvalIds, ['a', 'b'])
  await f.event('approval/decided', 3, {id: 'a', outcome: 'deny'})
  assert.deepEqual(f.run.approvalIds, ['b'])
  await f.event('approval/asked', 1, {id: 'a'})
  await f.event('approval/decided', 4, {id: 'unknown'})
  assert.equal(f.run.status, 'approval-wait')
  await f.event('approval/decided', 5, {id: 'b', outcome: 'allow'})
  assert.equal(f.run.status, 'running')
  assert.deepEqual(f.run.approvalIds, [])
})

test('approval holds cap and role lock, skips watchdog/delivery and cannot be faked or woken', async () => {
  for (const maxConcurrent of [1, 3]) {
    const f = await fixture({maxConcurrent})
    await f.event('approval/asked', 1, {id: 'a', toolName: 'bash'})
    await f.enqueue('same-role')
    if (maxConcurrent === 1) await f.enqueue('other-role', 'b')
    f.advance()
    await f.engine.input('t', 'followup')
    await f.engine.retryTask('t'); await f.engine.resolveDecision('t', 'decision')
    await assert.rejects(f.engine.report(f.run.id, {status: 'running'}), /approval/i)
    await f.event('user/message', 2, {source: {executionInputId: f.state.inputs[0].id}})
    await f.engine.tick()
    assert.equal(f.run.status, 'approval-wait')
    assert.equal(f.run.attention, undefined)
    assert.equal(f.deliveries.length, 1)
    assert.equal(f.state.inputs.filter(i => i.runId === f.run.id).length, 2)
    assert.ok(f.state.runs.slice(1).every(r => r.status === 'queued'))
  }
})

test('explicit cancel/pause clear IDs and late decisions cannot revive', async () => {
  for (const action of ['cancel', 'pause']) {
    const f = await fixture()
    await f.event('approval/asked', 1, {id: 'a'})
    if (action === 'cancel') await f.engine.cancelTask('t')
    else await f.engine.pauseRole('g', 'a')
    await f.event('approval/decided', 2, {id: 'a'})
    assert.equal(f.run.status, action === 'cancel' ? 'cancelled' : 'paused')
    assert.deepEqual(f.run.approvalIds, [])
  }
})

test('turn end orphans approvals and retains normal lifecycle including user stop', async () => {
  for (const stopped of [false, true]) {
    const f = await fixture()
    await f.event('approval/asked', 1, {id: 'a'})
    await f.event('turn/end', 2, stopped ? {status: 'aborted', cause: 'user'} : {status: 'success'})
    assert.deepEqual(f.run.approvalIds, [])
    assert.equal(f.run.status, stopped ? 'paused' : 'waiting')
  }
})

test('recovery derives IDs from entire audit; live waits, cold orphan recovery is bounded', async () => {
  const asked = {type: 'approval/asked', seq: 1, data: {id: 'a', toolName: 'bash'}}
  const f = await fixture()
  await f.event(asked.type, asked.seq, asked.data)
  const recover = (running, events = [asked]) => f.engine.recover(new Map([[f.run.sessionId, {running, events}]]))
  await recover(true)
  assert.equal(f.run.status, 'approval-wait')
  assert.deepEqual(f.run.approvalIds, ['a'])
  await recover(true, [asked, {type: 'approval/decided', seq: 2, data: {id: 'a'}}])
  assert.equal(f.run.status, 'running')
  assert.deepEqual(f.run.approvalIds, [])
  await f.event(asked.type, asked.seq, asked.data)
  assert.equal(f.run.status, 'running')
  await recover(false)
  assert.equal(f.run.status, 'queued')
  assert.deepEqual(f.run.approvalIds, [])
  await f.engine.tick(); await recover(false)
  assert.equal(f.run.status, 'failed')
  await recover(true)
  assert.equal(f.run.status, 'failed')
})
