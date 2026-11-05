import test from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'node:fs/promises'
import {join,resolve,basename} from 'node:path'
import {tmpdir} from 'node:os'
import {install,snapshotSignature} from '../src/host/work-item-sync.js'

async function fixture(t,io={}) {
  const home=await fs.mkdtemp(join(tmpdir(),'dwb-test-'))
  t.after(async()=>{assert.ok(basename(home).startsWith('dwb-test-'));assert.notEqual(resolve(home),resolve(tmpdir()));await fs.rm(home,{recursive:true,force:true})})
  const group={id:'g',dir:home},tasks=[{id:'t',groupId:'g',revision:1,status:'进行中',assignees:['r']}]
  const rt={config:{workItemSyncIO:io},state:{execution:{runs:[]}},listGroups:()=>[group],listTasks:()=>tasks,saveAll:async()=>{}}
  install(rt)
  const add=async(id='WI-test',patch={})=>{
    const dir=join(home,'.sopai','runs',id);await fs.mkdir(dir,{recursive:true})
    const item={work_item_id:id,title:'测试',project:home,state:'INTAKE',sources:[{path:'manual'}],decisions:[{id:'d'}],calls:[{id:'call'}],handoffs:['human'],...patch}
    const path=join(dir,'work_item.json'),page=join(dir,'复核首页.md')
    await fs.writeFile(path,JSON.stringify(item,null,2)+'\n')
    await fs.writeFile(page,`# ${id} / 测试\n\n状态：接收中，尚无角色调用或业务批准。\n\n协调员请在实际执行后更新：重要变化、待决入口、未验证、已完成、可以继续与证据。\n`)
    return {path,page,item,read:async()=>JSON.parse(await fs.readFile(path,'utf8'))}
  }
  return {home,group,tasks,rt,add}
}
test('projects only existing unique matches; preserves manual history and exact initializer replacement',async t=>{
  let writes=0
  const f=await fixture(t,{writeFile:async(...args)=>{writes++;return fs.writeFile(...args)}}),c=await f.add()
  await f.rt.syncWorkItems()
  const item=await c.read()
  for(const key of ['sources','decisions','calls','handoffs']) assert.deepEqual(item[key],c.item[key])
  assert.equal(item.state,'IMPLEMENTATION');assert.equal(item.workbench_projection.runs.length,0)
  const page=await fs.readFile(c.page,'utf8');assert.ok(!page.includes('尚无角色调用'));assert.match(page,/managed:start/)
  const count=writes;await f.rt.syncWorkItems();assert.equal(writes,count)
  await fs.writeFile(c.page,'人工前言\n'+page+'\n人工结论')
  f.tasks[0].status='已完成';await f.rt.syncWorkItems()
  assert.equal((await c.read()).state,'DELIVERY')
  assert.match(await fs.readFile(c.page,'utf8'),/^人工前言/);assert.match(await fs.readFile(c.page,'utf8'),/人工结论$/)
})
test('multiple candidates refuse guessing and malformed or unreadable data is visible without retry writes every tick',async t=>{
  const f=await fixture(t),a=await f.add(),b=await f.add('WI-other')
  const before=await fs.readFile(a.path,'utf8');await f.rt.syncWorkItems()
  assert.equal(f.group.workItemSync.status,'error');assert.match(f.group.workItemSync.error,/多个/)
  assert.equal(await fs.readFile(a.path,'utf8'),before)
  await f.rt.syncWorkItems();assert.equal(await fs.readFile(a.path,'utf8'),before)
  assert.equal((await b.read()).state,'INTAKE')
})
test('does not create items or match relative projects and mismatched ids',async t=>{
  const f=await fixture(t);await f.rt.syncWorkItems()
  await assert.rejects(fs.stat(join(f.home,'.sopai')),{code:'ENOENT'})
  const a=await f.add('WI-relative',{project:'.'}),b=await f.add('WI-wrong',{work_item_id:'different'})
  await f.rt.syncWorkItems();assert.equal(f.group.workItemSync.status,'unmatched')
  assert.equal((await a.read()).state,'INTAKE');assert.equal((await b.read()).state,'INTAKE')
})
test('only current generation summaries affect state and delivery requires matching current signature',async t=>{
  const f=await fixture(t),c=await f.add()
  f.rt.state.execution.runs=[{id:'old',taskId:'t',roleId:'r',generation:1,status:'failed',evidence:['stale']},{id:'new',taskId:'t',roleId:'r',generation:2,status:'completed',summary:'verified',evidence:['test passed']}]
  f.tasks[0].status='已完成';f.group.delivery={status:'delivered',signature:'old'}
  await f.rt.syncWorkItems();assert.equal((await c.read()).state,'DELIVERY')
  f.group.delivery.signature=snapshotSignature(f.tasks,f.rt.state.execution.runs)
  await f.rt.syncWorkItems();let item=await c.read();assert.equal(item.state,'COMPLETE');assert.equal(item.workbench_projection.runs.length,1);assert.equal(item.workbench_projection.evidence[0].runId,'new')
  f.tasks[0].revision++;await f.rt.syncWorkItems();assert.equal((await c.read()).state,'DELIVERY')
  f.rt.state.execution.runs[1].status='blocked';await f.rt.syncWorkItems();assert.equal((await c.read()).state,'BLOCKED')
})
test('first managed block preserves non-template prose',async t=>{
  const f=await fixture(t),c=await f.add();await fs.writeFile(c.page,'人工复核\n状态：接收中，尚无角色调用或业务批准。\n')
  await f.rt.syncWorkItems();assert.match(await fs.readFile(c.page,'utf8'),/^人工复核\n状态：接收中，尚无角色调用或业务批准。/)
})
test('read errors and atomic write errors are visible and retries are throttled',async t=>{
  let attempts=0,fail=false
  const f=await fixture(t,{writeFile:async(...args)=>{if(fail){attempts++;throw new Error('disk failure')}return fs.writeFile(...args)}}),c=await f.add()
  fail=true;await f.rt.syncWorkItems();assert.match(f.group.workItemSync.error,/disk failure/)
  await f.rt.syncWorkItems();assert.equal(attempts,1);assert.equal((await c.read()).state,'INTAKE')
  const other=await fixture(t,{readFile:async()=>{throw new Error('read denied')}});await other.add();await other.rt.syncWorkItems();assert.match(other.group.workItemSync.error,/read denied/)
})
test('pre-rename content reread detects concurrent edits and leaves no temp files',async t=>{
  let target,modified=false
  const f=await fixture(t,{writeFile:async(path,...args)=>{
    await fs.writeFile(path,...args)
    if(target && path.startsWith(target+'.') && !modified){modified=true;await fs.writeFile(target,'{"human":"concurrent"}\n')}
  }}),c=await f.add();target=c.path
  await f.rt.syncWorkItems();assert.match(f.group.workItemSync.error,/并发修改冲突/)
  assert.equal(await fs.readFile(target,'utf8'),'{"human":"concurrent"}\n')
  assert.equal((await fs.readdir(join(f.home,'.sopai','runs','WI-test'))).filter(x=>x.endsWith('.tmp')).length,0)
})
test('invalid JSON is visible and retry can recover without fabricated history',async t=>{
  const f=await fixture(t),c=await f.add();f.rt.config.workItemSyncRetryMs=0
  await fs.writeFile(c.path,'{broken');await f.rt.syncWorkItems()
  assert.equal(f.group.workItemSync.status,'error');assert.equal(await fs.readFile(c.path,'utf8'),'{broken')
  await fs.writeFile(c.path,JSON.stringify(c.item));await f.rt.syncWorkItems()
  assert.equal(f.group.workItemSync.status,'synced');assert.deepEqual((await c.read()).calls,c.item.calls)
})
test('corrupt managed region is an error and leaves item untouched',async t=>{
  const f=await fixture(t),c=await f.add(),before=await fs.readFile(c.path,'utf8')
  await fs.writeFile(c.page,'human\n<!-- dsh-workbench:managed:start -->\nunfinished')
  await f.rt.syncWorkItems();assert.match(f.group.workItemSync.error,/managed/)
  assert.equal(await fs.readFile(c.path,'utf8'),before)
})
test('stable signature sorts ids and changes with revision/status/generation',()=>{
  const tasks=[{id:'b',revision:1,status:'待办'},{id:'a',revision:2,status:'已完成'}]
  assert.equal(snapshotSignature(tasks),snapshotSignature(tasks.slice().reverse()))
  assert.notEqual(snapshotSignature(tasks),snapshotSignature(tasks,[{taskId:'b',generation:2}]))
})
