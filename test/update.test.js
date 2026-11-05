import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { install, CHECK_TTL_MS, FETCH_TIMEOUT_MS } from '../src/host/update.js'

const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
const NAME = manifest.name
const CURRENT = manifest.version
const [major, minor, patch] = CURRENT.split('.').map(Number)
const next = offset => `${major}.${minor}.${patch + offset}`
const NEXT = next(1), NEXT2 = next(2), NEXT3 = next(3)
const REGISTRY = 'https://registry.example.test/'
const release = (version, name = NAME) => ({ ok: true, status: 200, json: async () => ({ name, version }) })
const fixture = ({ source = `${NAME}@${CURRENT}`, fetchImpl = async () => release(NEXT), registries = async () => ({ registry: REGISTRY, fallbackRegistries: [], resolved: REGISTRY }) } = {}) => {
  const calls = { fetch: [], bundles: 0 }
  let clock = 100_000
  const service = {
    listBundles: () => { calls.bundles++; return [{ name: NAME, version: CURRENT, source, installed: true }] },
    registries,
    installBundle: () => { throw new Error('update check must never install') },
  }
  const rt = { ctx: { get: key => key === 'pluginManager' ? service : undefined } }
  install(rt, { now: () => clock, fetchImpl: (...args) => { calls.fetch.push(args); return fetchImpl(...args) } })
  return { rt, calls, tick: ms => { clock += ms } }
}
const settle = () => new Promise(resolve => setImmediate(resolve))

test('local link, file and tarball sources never query registry or offer an update', async () => {
  for (const source of ['link:/src/workbench', `file:/tmp/${NAME}.tgz`, `${NAME}@file:/tmp/build.tgz`, '/tmp/build', 'https://example.test/build.tgz', 'https://example.test/download/abc123']) {
    const { rt, calls } = fixture({ source })
    const result = await rt.updateCheck({ fresh: true })
    assert.equal(result.source, 'local', source)
    assert.equal(result.available, false)
    assert.equal(result.latest, null)
    assert.equal(calls.fetch.length, 0)
  }
})

test('unidentified sources fail closed without looking up a package name', async () => {
  const { rt, calls } = fixture({ source: 'github:owner/project#v1.0.0' })
  assert.equal((await rt.updateCheck()).source, 'unknown')
  assert.equal(calls.fetch.length, 0)
})

test('npm registry 404 means no published release; old stable version is not offered', async () => {
  const { rt } = fixture({ fetchImpl: async () => ({ ok: false, status: 404 }) })
  const empty = await rt.updateCheck()
  assert.equal(empty.phase, 'idle')
  assert.equal(empty.latest, null)
  assert.equal(empty.available, false)
  const old = fixture({ fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ name: NAME, version: '0.0.9' }) }) })
  assert.equal((await old.rt.updateCheck()).available, false)
  assert.equal(old.rt.updateView().latest, '0.0.9')
})

test('newer stable npm release is offered; prerelease and name mismatch are not', async () => {
  const { rt, calls } = fixture()
  const state = await rt.updateCheck({ fresh: true })
  assert.deepEqual([state.name, state.current, state.latest, state.source, state.available], [NAME, CURRENT, NEXT, 'registry', true])
  assert.equal(calls.fetch.length, 1)
  assert.equal(calls.fetch[0][0], `${REGISTRY}${NAME}/latest`)
  assert.equal(calls.fetch[0][1].signal instanceof AbortSignal, true)
  assert.equal(FETCH_TIMEOUT_MS, 8000)
  const pre = fixture({ fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ name: NAME, version: `${major}.${minor}.${patch + 1}-beta.1` }) }) })
  assert.equal((await pre.rt.updateCheck()).available, false)
  assert.equal(pre.rt.updateView().latest, null)
  const wrong = fixture({ fetchImpl: async () => release(NEXT, 'other-package') })
  assert.equal((await wrong.rt.updateCheck()).phase, 'failed')
  assert.equal(wrong.rt.updateView().available, false)
})

test('network failure reports error and does not retain a previously found target', async () => {
  let fail = false
  const { rt } = fixture({ fetchImpl: async () => fail ? Promise.reject(new Error('offline')) : release(NEXT) })
  assert.equal((await rt.updateCheck()).available, true)
  fail = true
  const failed = await rt.updateCheck({ fresh: true })
  assert.equal(failed.phase, 'failed')
  assert.equal(failed.error, 'update-check-failed')
  assert.equal(failed.available, false)
})

test('single-flight, TTL and explicit refresh constrain registry requests', async () => {
  let answer
  const { rt, calls, tick } = fixture({ fetchImpl: () => new Promise(resolve => { answer = resolve }) })
  const a = rt.updateCheck(), b = rt.updateCheck()
  await settle()
  assert.equal(calls.fetch.length, 1)
  answer(release(NEXT))
  const [left, right] = await Promise.all([a, b])
  assert.deepEqual(left, right)
  await rt.updateCheck()
  assert.equal(calls.fetch.length, 1)
  tick(CHECK_TTL_MS)
  const c = rt.updateCheck()
  await settle()
  answer(release(NEXT2))
  assert.equal((await c).latest, NEXT2)
  assert.equal(calls.fetch.length, 2)
  const d = rt.updateCheck({ fresh: true })
  await settle()
  answer(release(NEXT3))
  assert.equal((await d).latest, NEXT3)
  assert.equal(calls.fetch.length, 3)
})

test('configured public registry falls back to the next one', async () => {
  const { rt, calls } = fixture({
    registries: async () => ({ registry: 'https://registry.npmjs.org/', resolved: 'https://registry.npmjs.org/', fallbackRegistries: ['https://registry.npmmirror.com/'] }),
    fetchImpl: async url => url.includes('npmjs.org') ? { ok: false, status: 404 } : release(NEXT2),
  })
  assert.equal((await rt.updateCheck()).latest, NEXT2)
  assert.equal(calls.fetch.length, 2)
})

test('checking exposes no installer authority and never calls the plugin manager', async () => {
  const { rt, calls } = fixture()
  await rt.updateCheck()
  assert.equal(rt.updateStart, undefined)
  assert.equal(typeof rt.updateView, 'function')
  assert.equal(calls.bundles, 1)
})
