import test from 'node:test'
import assert from 'node:assert/strict'
import { createUpdateUI } from '../src/client/update-ui.js'

function fixture() {
  const dicts = {}
  let calls = 0
  const React = {
    Fragment: Symbol('fragment'),
    createElement(type, props, ...children) { return { type, props: props ?? {}, children } },
    useState(initial) { return [initial, () => {}] },
    useEffect() {},
    useCallback(fn) { return fn },
  }
  const ctx = { effect(fn) { fn() }, locale: {
    register(_namespace, entries) { Object.assign(dicts, entries); return () => {} },
    bind() { return key => dicts.zh[key] },
  } }
  const components = createUpdateUI(React, ctx, async () => { calls++; throw Error('No network in UI tests') })
  return { React, components, dicts, calls: () => calls }
}

function walk(node, found = []) {
  if (!node || typeof node !== 'object') return found
  found.push(node)
  for (const child of node.children ?? []) walk(child, found)
  return found
}

test('about view displays local source without offering a manual upgrade', () => {
  const { components, dicts, calls } = fixture()
  assert.equal(dicts.zh.check, '检查更新')
  assert.equal(dicts.en.check, 'Check for updates')
  const tree = components.UpdateAbout({ status:{source:'local',current:'0.1.3',latest:null,available:false,phase:'idle'}, error:null, busy:false, refresh(){} })
  const nodes = walk(tree)
  assert.ok(nodes.some(node => node.type === 'style' && node.children[0].includes('--dsw-alias-bg-base')))
  assert.ok(nodes.some(node => node.type === 'p' && node.children.includes(dicts.zh.local)))
  assert.deepEqual(nodes.filter(node => node.type === 'button').map(node => node.children[0]), [dicts.zh.check])
  assert.ok(!nodes.some(node => node.type === 'ol'))
  assert.equal(calls(), 0)
})

test('an available version shows manual upgrade steps and never installs by itself', () => {
  const { components, dicts, calls } = fixture()
  const tree = components.UpdateAbout({ status:{source:'registry',current:'0.1.2',latest:'0.1.3',available:true,phase:'idle'}, error:null, busy:false, refresh(){} })
  const nodes = walk(tree)
  assert.deepEqual(nodes.filter(node => node.type === 'button').map(node => node.children[0]), [dicts.zh.check])
  assert.ok(nodes.some(node => node.type === 'h3' && node.children.includes(dicts.zh.guideTitle)))
  const steps = nodes.find(node => node.type === 'ol')
  assert.equal(steps.children.length, 3)
  assert.ok(nodes.some(node => node.type === 'code' && node.children[0] === 'dsh-collab-workbench@0.1.3'))
  assert.ok(nodes.some(node => node.type === 'p' && node.children.includes(dicts.zh.warning)))
  assert.equal(calls(), 0)
  const { status } = components.useUpdates()
  assert.equal(status.available, false)
})

test('install authority is gone from the client hook and failures stay visible', () => {
  const { components, dicts } = fixture()
  const updates = components.useUpdates()
  assert.equal(updates.install, undefined)
  assert.equal(typeof updates.refresh, 'function')
  const tree = components.UpdateAbout({ status:{source:'registry',current:'0.1.2',latest:null,available:false,phase:'failed',error:'update-check-failed'}, error:'update-check-failed', busy:false, refresh(){} })
  const nodes = walk(tree)
  const alert = nodes.find(node => node.type === 'p' && node.props.role === 'alert')
  assert.ok(alert.children.join('').includes('update-check-failed'))
  assert.ok(!nodes.some(node => node.type === 'ol'))
  assert.equal(dicts.en.warning.length > 0, true)
})
