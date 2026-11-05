import test from 'node:test'
import assert from 'node:assert/strict'
import {install} from '../src/host/channels.js'
function fixture(){
 const group={id:'g',name:'G',status:'active',dir:'/tmp',members:['a','b'],admins:['a'],sessions:{a:{id:'sa',seen:0,count:0,pendingSeed:'seed'},b:{id:'sb',seen:0,count:0}},log:[],seq:0}
 const messages=[];const routes=[]
 const rt={ctx:{sessionController:{list:async()=>({items:[]})},sessions:{flush:async()=>{} }},loadAll:async()=>{},getGroup:()=>group,getRole:id=>({id,name:id,status:'active'}),getTask:id=>id==='task_1'?{id,groupId:'g',status:'待办',priority:'中'}:null,listTasks:()=>[],touch(){},resolveAgent:async id=>({followup:m=>messages.push({id,m})}), routeTaskMessage:async(g,l,t,ids)=>{routes.push({l,t,ids});return ['b']}}
 install(rt);return{rt,group,messages,routes}
}
test('group log uses immutable nonzero sequence and task messages route by identity',async()=>{
 const {rt,group,messages,routes}=fixture()
 await rt.postGroupMessage({groupId:'g',text:'task_1 请继续'})
 assert.equal(routes[0].l.seq,1);assert.equal(routes[0].t,'task_1');assert.equal(messages.length,0);assert.equal(group.log[0].taskId,'task_1')
})
test('pending decision no longer throws; unrelated user text does not clear it',async()=>{
 const {rt,group,messages}=fixture();group.pendingDecision={seq:99,time:1}
 await rt.postGroupMessage({groupId:'g',text:'@b 先等待',fromRoleId:'a'})
 assert.equal(messages.length,1);assert.equal(group.pendingDecision.seq,99)
 await rt.postGroupMessage({groupId:'g',text:'还有一个想法'})
 assert.equal(group.pendingDecision.seq,99)
})
test('failed followup preserves seed and seen for retry',async()=>{
 const {rt,group}=fixture();rt.resolveAgent=async()=>({followup(){throw new Error('offline')}})
 const result=await rt.postGroupMessage({groupId:'g',text:'new request'})
 assert.equal(group.sessions.a.seen,0);assert.equal(group.sessions.a.pendingSeed,'seed');assert.equal(result.errors.length,1)
})
