import assert from 'node:assert/strict'
import { test } from 'node:test'
import * as fs from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { install } from '../src/host/ledger.js'

const deferred = () => {
  let resolve
  const promise = new Promise(done => { resolve = done })
  return { promise, resolve }
}
const turn = () => new Promise(resolve => setImmediate(resolve))
const initial = () => ({
  roles: { items: [{ id: 'role_1' }], seq: 1 },
  groups: { items: [{ id: 'group_1' }], seq: 1 },
  tasks: { items: [{ id: 'task_1' }], seq: 1 },
  execution: { runs: [{ id: 'run_1', status: 'pending' }], arbitrary: { retained: true } },
})

async function fixture(t, state = initial(), ledgerIO) {
  const home = await fs.mkdtemp(join(tmpdir(), 'workbench-ledger-'))
  t.after(() => fs.rm(home, { recursive: true, force: true }))
  const statePath = join(home, 'state.json')
  if (state !== undefined) await fs.writeFile(statePath, typeof state === 'string' ? state : JSON.stringify(state))
  const rt = { home, statePath, ...(ledgerIO ? { config: { ledgerIO } } : {}) }
  install(rt)
  return { rt, statePath, read: async () => JSON.parse(await fs.readFile(statePath, 'utf8')) }
}

test('concurrent initial loads share one read and cannot overwrite a mutation', async t => {
  const gate = deferred()
  let reads = 0
  const { rt, read } = await fixture(t, initial(), {
    ...fs,
    async mkdir() {},
    async readFile(...args) {
      reads++
      const raw = await fs.readFile(...args)
      await gate.promise
      return raw
    },
  })
  const first = rt.loadAll()
  const second = rt.loadAll()
  await turn()
  try {
    assert.equal(reads, 1)
    assert.strictEqual(first, second)
  } finally {
    gate.resolve()
    await Promise.all([first, second])
  }
  rt.addRole({ id: 'role_2' })
  await rt.saveAll()
  assert.equal((await read()).roles.items.length, 2)
})

test('saveAll drains mutations made during a blocked write, including new execution state', async t => {
  const gate = deferred()
  let writes = 0
  const { rt, read } = await fixture(t, initial(), {
    ...fs,
    async mkdir() {},
    async writeFile(...args) {
      writes++
      if (writes === 1) await gate.promise
      return fs.writeFile(...args)
    },
  })
  await rt.loadAll()
  rt.state.execution.runs[0].status = 'running'
  rt.touch()
  const saving = rt.saveAll()
  await turn()
  try {
    assert.equal(writes, 1)
    rt.addRole({ id: 'role_2' })
    rt.addGroup({ id: 'group_2' })
    rt.addTask({ id: 'task_2' })
    rt.state.execution.runs.push({ id: 'run_2', status: 'complete' })
    rt.touch()
  } finally {
    gate.resolve()
    await saving
  }
  const disk = await read()
  assert.equal(writes, 2)
  assert.equal(disk.roles.items.length, 2)
  assert.equal(disk.groups.items.length, 2)
  assert.equal(disk.tasks.items.length, 2)
  assert.equal(disk.execution.runs.length, 2)
  assert.deepEqual(disk.execution.arbitrary, { retained: true })
  assert.equal(rt.dirty, false)
})

for (const corrupt of ['{broken json', 'null', '[]', '{"roles":{"items":null}}']) {
  test(`corrupt state fails closed and stays unchanged: ${corrupt}`, async t => {
    const { rt, statePath } = await fixture(t, corrupt)
    await assert.rejects(rt.loadAll())
    await assert.rejects(rt.saveAll())
    assert.equal(await fs.readFile(statePath, 'utf8'), corrupt)
  })
}

test('non-ENOENT read failure prevents all writes', async t => {
  const error = Object.assign(new Error('denied'), { code: 'EACCES' })
  let writes = 0
  const { rt, read } = await fixture(t, initial(), {
    ...fs,
    async readFile() { throw error },
    async writeFile(...args) { writes++; return fs.writeFile(...args) },
  })
  await assert.rejects(rt.loadAll(), failure => failure === error)
  await assert.rejects(rt.saveAll(), failure => failure === error)
  assert.equal(writes, 0)
  assert.deepEqual(await read(), initial())
})

test('failed background save retains dirty state and commit retries durably', async t => {
  const error = Object.assign(new Error('disk full'), { code: 'ENOSPC' })
  let fail = true
  const { rt, read } = await fixture(t, initial(), {
    ...fs,
    async mkdir() {},
    async writeFile(...args) {
      if (fail) throw error
      return fs.writeFile(...args)
    },
  })
  await rt.loadAll()
  rt.addTask({ id: 'task_2' })
  await assert.rejects(rt.saveAll(), failure => failure === error)
  await turn()
  assert.equal(rt.dirty, true)
  assert.deepEqual(await read(), initial())
  fail = false
  await rt.commit()
  assert.equal(rt.dirty, false)
  assert.equal((await read()).tasks.items.length, 2)
  rt.state.execution.extra = { durable: true }
  await rt.commit()
  assert.deepEqual((await read()).execution.extra, { durable: true })
})

test('rename failure remains dirty and can be retried', async t => {
  let fail = true
  const error = new Error('rename failed')
  const { rt, read } = await fixture(t, initial(), {
    ...fs,
    async rename(...args) {
      if (fail) throw error
      return fs.rename(...args)
    },
  })
  await rt.loadAll()
  rt.state.execution.changed = true
  await assert.rejects(rt.saveAll(), failure => failure === error)
  assert.equal(rt.dirty, true)
  assert.deepEqual(await read(), initial())
  fail = false
  await rt.saveAll()
  assert.equal((await read()).execution.changed, true)
  assert.equal(rt.dirty, false)
})

test('missing file initializes defaults with optional config absent', async t => {
  const { rt, statePath, read } = await fixture(t)
  await fs.unlink(statePath)
  await rt.loadAll()
  assert.deepEqual(rt.listRoles(), [])
  rt.addRole({ id: rt.nextId('role') })
  await rt.saveAll()
  assert.equal((await read()).roles.items[0].id, 'role_1')
})
