import test from 'node:test'
import assert from 'node:assert/strict'
import { install as installUpdates } from '../src/host/update.js'
import { install as installApi } from '../src/host/api.js'

const call = async (fetch, endpoint, payload = {}) => {
  const response = await fetch(new Request('http://local/api/dsh-workbench', { method:'POST', body:JSON.stringify({endpoint,payload}) }))
  return { status:response.status, body:await response.json() }
}

test('Host RPC only checks for updates; there is no install endpoint at all', async () => {
  let route
  let managerCalls = 0
  let requests = 0
  const rt = {
    ctx:{
      get:key => key === 'pluginManager' ? {
        listBundles:async() => { managerCalls++; return [{name:'dsh-collab-workbench',source:'dsh-collab-workbench@file:/tmp/workbench.tgz',installed:true}] },
        installBundle:async() => { managerCalls++; throw Error('must not install') },
      } : undefined,
      connection:{fetch:{register(entry){route=entry.fetch}}},
    },
    loadAll:async()=>{requests++},
    executionReady:Promise.resolve(),
  }
  installUpdates(rt, { fetchImpl:async()=>{throw Error('must not fetch registry')} })
  installApi(rt)
  const checked = await call(route, 'updates.check', {fresh:true,spec:'other-package@9.9.9'})
  assert.equal(checked.status,200)
  assert.equal(checked.body.data.source,'local')
  assert.equal(checked.body.data.available,false)
  const attempt = await call(route, 'updates.install', {spec:'other-package@9.9.9'})
  assert.equal(attempt.status,404)
  assert.equal(attempt.body.ok, false)
  assert.equal(managerCalls,1)
  assert.equal(rt.updateStart, undefined)
  // The unknown endpoint is rejected before the ledger is loaded.
  assert.equal(requests,1)
})
