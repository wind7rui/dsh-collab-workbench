import test from 'node:test'
import assert from 'node:assert/strict'
import { install as channels } from '../src/host/channels.js'
import { install as tasks } from '../src/host/tasks.js'

function fixture() {
 const group={id:'g',name:'G',status:'active',members:['a','b'],admins:['a'],sessions:{a:{id:'sa',count:0},b:{id:'sb',count:0}},log:[],seq:0}
 const items=[1,2].map(n=>({id:`task_${n}`,title:`T${n}`,groupId:'g',schedulerVersion:1,status:'进行中',assignees:['b']}))
 let initiator
 const sent=[],routes=[],events=[],inbox=[]
 const rt={state:{tasks:{items}},ctx:{get:()=>({currentInitiator:()=>initiator}),sessions:{flush:async()=>{}},sessionProjections:{stateOf:()=>({'next-turn':inbox})}},loadAll:async()=>{},getGroup:()=>group,getRole:id=>['a','b'].includes(id)?{id,name:id,status:'active'}:undefined,getTask:id=>items.find(t=>t.id===id),touch(){},resolveAgent:async id=>({session:{snapshotEvents:()=>events},followup:m=>{sent.push({id,m});inbox.push(m)}}),routeTaskMessage:async(g,l,id)=>{routes.push(id);return ['b']},nextId:()=>`task_${items.length+1}`,addTask:t=>items.push(t)}
 channels(rt);tasks(rt)
 return {rt,group,sent,routes,items,events,inbox,as:id=>{initiator=id?{id}:undefined}}
}
test('ambiguous task mentions and taskless worker @ never start ordinary sessions; explicit task routes original run',async()=>{
 const {rt,sent,routes,items}=fixture()
 let result=await rt.postGroupMessage({groupId:'g',text:'@b 启动 task_1 task_2'})
 assert.equal(sent.length,0);assert.match(result.errors[0].error,/歧义/)
 result=await rt.postGroupMessage({groupId:'g',text:'@b 继续'})
 assert.equal(sent.length,0);assert.match(result.errors[0].error,/taskId/)
 await rt.postGroupMessage({groupId:'g',taskId:'task_1',text:'@b 继续'})
 assert.deepEqual(routes,['task_1']);assert.equal(sent.length,0)
 items[1].assignees=['a'] // Admin coordination remains available despite an unrelated formal task.
 await rt.postGroupMessage({groupId:'g',text:'管理员请协调'})
 assert.equal(sent[0].id,'sa')
})
test('trusted group initiator supplies notification identity and cannot impersonate before commit',async()=>{
 const {rt,group,as,items}=fixture();as('sa')
 await rt.createTask({groupId:'g',title:'new',assignees:['b']})
 assert.equal(group.log.at(-1).from,'a');assert.equal(group.log.at(-1).fromName,'a')
 const count=items.length
 await assert.rejects(rt.createTask({groupId:'g',title:'fake',assignees:['b'],fromRoleId:'b'}),/冒充/)
 assert.equal(items.length,count)
 await assert.rejects(rt.updateTask('task_1',{priority:'高'},{fromRoleId:'b'}),/冒充/)
 await assert.rejects(rt.postGroupMessage({groupId:'g',text:'fake',fromRoleId:'b'}),/冒充/)
})
test('agentless task notification is system, real user message remains user and public system forgery fails',async()=>{
 const {rt,group}=fixture()
 await rt.createTask({groupId:'g',title:'system task',assignees:['b']})
 assert.equal(group.log.at(-1).fromName,'系统');assert.equal(group.log.at(-1).system,true)
 await rt.postGroupMessage({groupId:'g',text:'真实用户',noWake:true})
 assert.equal(group.log.at(-1).fromName,'用户');assert.equal(group.log.at(-1).system,undefined)
 await assert.rejects(rt.postGroupMessage({groupId:'g',text:'fake',system:true}),/冒充系统/)
})
test('fixed handoff target survives rotation threshold and never replaces newer session',async()=>{
 const {rt,group,sent,inbox}=fixture()
 group.sessions.a.count=59
 const line={id:'fixed-handoff',seq:0,text:'review',fromName:'系统',targetSessionId:'sa'}
 rt.ensureGroupSession=()=>{throw new Error('fixed handoff must not ensure or rotate')}
 await rt.deliverAdminHandoff(group,line,'a')
 assert.equal(group.sessions.a.count,60)
 await rt.deliverAdminHandoff(group,line,'a')
 assert.equal(sent.length,1);assert.equal(group.sessions.a.count,60)
 group.sessions.a={id:'new-sa',count:2,pendingSeed:'new seed',seen:10}
 await rt.deliverAdminHandoff(group,line,'a')
 assert.equal(sent.length,1)
 inbox.length=0 // A distinct later handoff can still target the historical session.
 await rt.deliverAdminHandoff(group,{...line,id:'other-handoff'},'a')
 assert.equal(sent.at(-1).id,'sa')
 assert.deepEqual(group.sessions.a,{id:'new-sa',count:2,pendingSeed:'new seed',seen:10})
})
test('admin handoff bypasses task router and deduplicates both inbox and admitted user events',async()=>{
 const {rt,group,sent,routes,items,inbox,events}=fixture()
 items[0].assignees=['a']
 const line={id:'handoff-1',seq:0,text:'继续协调',fromName:'系统'}
 await rt.deliverAdminHandoff(group,line,'a');await rt.deliverAdminHandoff(group,line,'a')
 assert.equal(sent.length,1);assert.equal(routes.length,0)
 events.push({type:'user/message',data:inbox.pop()})
 await rt.deliverAdminHandoff(group,line,'a');assert.equal(sent.length,1)
 await assert.rejects(rt.deliverAdminHandoff(group,line,'b'),/管理员/)
})
