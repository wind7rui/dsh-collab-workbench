import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdir,writeFile,readFile} from 'node:fs/promises'
import {join} from 'node:path'
import {runtime,seed} from './runtime-fixture.mjs'
import {install as groups} from '../src/host/groups.js'

test('delete tombstones before cancellation, includes task sessions and preserves custom directory',async()=>{
 const f=await runtime();try{
  const group=seed(f.rt);group.dir=join(f.home,'custom');group.isCustomDir=true
  await mkdir(group.dir);await writeFile(join(group.dir,'keep.txt'),'keep')
  const t=await f.rt.createTask({title:'T',groupId:group.id,assignees:['role_2']});await f.settle()
  const ids=f.rt.executionRuns(t.id).map(r=>r.sessionId)
  groups(f.rt)
  const cleaned=[];f.rt.cleanWorkspaceRefs=async()=>{};f.rt.purgeSessionFiles=async set=>{assert.equal(group.status,'deleting');cleaned.push(...set)};f.rt.purgeSessionRegistry=async()=>{}
  const result=await f.rt.deleteGroup(group.id);await f.settle()
  assert.equal(result.deleted,true);assert.ok(ids.every(id=>cleaned.includes(id)))
  assert.equal(await readFile(join(group.dir,'keep.txt'),'utf8'),'keep')
  assert.equal(f.rt.getGroup(group.id),undefined);assert.ok(f.rt.executionRuns(t.id).every(r=>r.status==='cancelled'))
 }finally{await f.close()}
})
test('disabled roles remain paused and force deletion removes admins and invalidates assignment',async()=>{
 const f=await runtime();try{
  const group=seed(f.rt)
  const t=await f.rt.createTask({title:'T',groupId:group.id,assignees:['role_1','role_2']});await f.settle()
  await f.rt.setRoleStatus('role_2','disabled');await f.settle();assert.equal(f.rt.executionRuns(t.id).find(r=>r.roleId==='role_2').status,'paused')
  await f.rt.forceDeleteRole('role_1');await f.settle()
  assert.ok(!f.rt.getGroup(group.id).admins.includes('role_1'));assert.ok(!f.rt.getTask(t.id).assignees.includes('role_1'))
  assert.ok(f.rt.executionRuns(t.id).filter(r=>r.roleId==='role_1').every(r=>r.status==='cancelled'))
 }finally{await f.close()}
})
test('membership removal invalidates task ownership and blocks moving active task directories',async()=>{
 const f=await runtime();try{
  const group=seed(f.rt);group.dir=join(f.home,'groups','Test')
  await mkdir(group.dir,{recursive:true})
  const t=await f.rt.createTask({title:'T',groupId:group.id,assignees:['role_2']});await f.settle()
  groups(f.rt)
  await assert.rejects(f.rt.renameGroup(group.id,'Moved'),/先完成或停止/)
  await f.rt.updateGroupMeta(group.id,{members:['role_1']});await f.settle()
  assert.deepEqual(f.rt.getTask(t.id).assignees,[])
  assert.equal(f.rt.executionRuns(t.id)[0].status,'cancelled')
 }finally{await f.close()}
})
test('migration pauses legacy tasks but recovers a new task missing its run intent',async()=>{
 const f=await runtime();let next
 try{
  seed(f.rt)
  f.rt.addTask({id:'task_50',title:'legacy',groupId:'group_1',assignees:['role_1'],priority:'中',status:'待办'})
  f.rt.addTask({id:'task_51',title:'new committed task',groupId:'group_1',assignees:['role_2'],priority:'中',status:'待办',schedulerVersion:1,revision:1})
  await f.rt.saveAll();await f.close(false)
  next=await runtime({home:f.home,sessions:f.sessions});await next.settle()
  assert.equal(next.rt.executionRuns('task_50')[0].status,'paused')
  assert.equal(next.rt.executionRuns('task_51')[0].status,'running')
 }finally{if(next)await next.close();else await f.close()}
})
