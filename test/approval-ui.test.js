import test from 'node:test'
import assert from 'node:assert/strict'
import {matchApproval,createApprovalUI,approvalTimeline} from '../src/client/approval-ui.js'
import {emptyApprovals,foldApprovals,approvalDisplayItems} from '../src/host/approvals-fold.js'

test('long history does not evict old unanswered approvals',()=>{
 const pending={id:'old',askedAt:0,outcome:'pending'}
 const items=approvalDisplayItems([pending,...Array.from({length:150},(_,i)=>({id:String(i),askedAt:i+1,outcome:'allowed-once'}))])
 assert.equal(items.length,41);assert.equal(items[0],pending)
})
test('display fold is incremental, joins exact call, and never retains authority',()=>{
 let s=emptyApprovals();const ignored={type:'assistant/message',data:{}}
 assert.equal(foldApprovals(s,ignored),s)
 s=foldApprovals(s,{type:'tool/call',data:{callId:'call1',name:'bash',arguments:JSON.stringify({command:'node test.cjs',sandbox_permissions:'danger-full-access'})}})
 s=foldApprovals(s,{type:'approval/asked',time:1,data:{id:'audit1',callId:'call1',toolName:'bash',reason:'browser test'}})
 assert.equal(s.approvals[0].command,'node test.cjs');assert.equal(s.approvals[0].permission,'danger-full-access')
 assert.equal(s.approvals[0].answer,undefined)
 s=foldApprovals(s,{type:'approval/decided',time:2,data:{id:'other',outcome:'allowed-once'}})
 assert.equal(s.approvals[0].outcome,'pending')
 s=foldApprovals(s,{type:'approval/decided',time:3,data:{id:'audit1',outcome:'rejected'}})
 assert.equal(s.approvals[0].outcome,'rejected')
})
test('ended turn expires orphaned requests; newer decisions cannot resurrect them',()=>{
 let s=foldApprovals(emptyApprovals(),{type:'approval/asked',time:1,data:{id:'a',toolName:'write'}})
 s=foldApprovals(s,{type:'turn/end',time:2,data:{}})
 s=foldApprovals(s,{type:'approval/decided',time:3,data:{id:'a',outcome:'allowed-once'}})
 assert.equal(s.approvals[0].outcome,'expired')
})
test('current native capability must match session, exact call, tool and reason; no ID guessing',()=>{
 const item={id:'audit-id',outcome:'pending',sessionId:'s',callId:'c',toolName:'bash',reason:'test'}
 const p={kind:'approval',key:'approval:42',sessionId:'s',callId:'c',toolName:'bash',reason:'test',answerable:true,answer(){}}
 assert.equal(matchApproval(item,p),true)
 for(const patch of [{sessionId:'other'},{callId:'other'},{reason:'other'},{toolName:'write'},{answerable:false},{kind:'question'}])assert.equal(matchApproval(item,{...p,...patch}),false)
 assert.equal(matchApproval({...item,outcome:'allowed-once'},p),false)
 assert.equal(matchApproval({...item,callId:''},{...p,callId:''}),false)
 assert.equal(matchApproval(item,undefined),false)
})
function setupCard(){
 const dictionaries={};const ctx={effect:fn=>fn(),locale:{register:(ns,dict)=>{dictionaries[ns]=dict;return()=>{}},bind:ns=>k=>dictionaries[ns].zh[k],subscribe:()=>()=>{}},uiWorkspace:{openSession(){}}}
 const effects=[];const states=[];let index=0
 const React={Fragment:'fragment',createElement:(type,props,...children)=>({type,props:props??{},children}),useState:initial=>{const i=index++;states[i]??=typeof initial==='function'?initial():initial;return[states[i],v=>{states[i]=typeof v==='function'?v(states[i]):v}]},useRef:initial=>{const i=index++;states[i]??={current:initial};return states[i]},useEffect:fn=>effects.push(fn)}
 const Group=createApprovalUI(React,ctx,async()=>({items:[],sessions:[]}))
 return {React,Group,reset(){index=0},states,effects}
}
test('group card calls original user answer once; settled/native-withdrawn cards cannot grant',async()=>{
 const f=setupCard(),items=[{id:'audit',outcome:'pending',sessionId:'s',callId:'c',toolName:'bash',reason:'test',roleName:'QA',command:'node test.cjs'}]
 const snap={groupId:'g',items,sessions:[]};f.states.push(snap,null,{current:new Map()},{current:0},{current:()=>{}},0)
 const p={kind:'approval',key:'approval:1',sessionId:'s',callId:'c',toolName:'bash',reason:'test',answerable:true,answer:async out=>{assert.equal(out,'allowed-once');p.answerable=false;calls++}}
 let calls=0
 const root=f.Group({groupId:'g',useSessionStatus:select=>select(new Map([['s',{pendingInteraction:p}]]))})
 const walk=node=>[node,...(node?.children??[]).flat().filter(x=>x&&typeof x==='object').flatMap(walk)]
 const cardElement=walk(root).find(x=>typeof x?.type==='function');assert.ok(cardElement)
 const card=cardElement.type(cardElement.props)
 const all=node=>[node,...(node?.children??[]).flat().filter(x=>x&&typeof x==='object').flatMap(all)]
 const allow=all(card).find(n=>n.type==='button'&&n.props.className==='dwb-approval-allow')
 assert.equal(allow.props.disabled,false)
 await allow.props.onClick();await allow.props.onClick();assert.equal(calls,1)
 assert.equal(matchApproval(items[0],p),false)
})
test('group navigation hides previous snapshot even when replacement fetch fails',()=>{
 const f=setupCard();f.states.push({groupId:'old',items:[{id:'a',outcome:'pending',sessionId:'s',callId:'c'}],sessions:[]})
 const root=f.Group({groupId:'new',useSessionStatus:select=>select(new Map())})
 assert.equal(root,null)
})
test('approvals remain chronological across decisions and interleave stably with messages',()=>{
 const items=[{id:'new',sessionId:'s',askedAt:30,outcome:'pending'},{id:'old',sessionId:'s',askedAt:10,outcome:'allowed-once'}]
 assert.deepEqual(approvalDisplayItems(items).map(a=>a.id),['old','new'])
 const lines=[{id:'before',time:5},{id:'between',time:20},{id:'tie-a',time:30},{id:'tie-b',time:30},{id:'after',time:40}]
 const ids=entries=>entries.map(e=>e.item?.id??e.line.id)
 const expected=['before','old','between','tie-a','tie-b','new','after']
 assert.deepEqual(ids(approvalTimeline(lines,items)),expected)
 assert.deepEqual(ids(approvalTimeline(lines,items.map(i=>({...i,outcome:'rejected',decidedAt:1000})))),expected)
 let state=emptyApprovals()
 for(const [id,time] of [['old',10],['new',30]])state=foldApprovals(state,{type:'approval/asked',time,data:{id,toolName:'bash'}})
 state=foldApprovals(state,{type:'approval/decided',time:100,data:{id:'old',outcome:'allowed-once'}})
 assert.deepEqual(state.approvals.map(a=>a.id),['old','new'])
})
test('integrated panel keeps approval keys and rendered order when outcomes update',()=>{
 const f=setupCard(),items=[{id:'a',sessionId:'s',askedAt:10,outcome:'pending'},{id:'b',sessionId:'s',askedAt:30,outcome:'pending'}]
 f.states.push({groupId:'g',items,sessions:[]})
 const props={groupId:'g',lines:[{id:'middle',time:20}],renderMessage:line=>({type:'message',props:{key:`message:${line.id}`},children:[]}),useSessionStatus:select=>select(new Map())}
 const keys=root=>root.children.flat().filter(node=>node?.props?.key).map(node=>node.props.key)
 const first=f.Group(props)
 assert.deepEqual(keys(first),['approval:s:a','message:middle','approval:s:b'])
 f.states[0]={groupId:'g',items:items.map(item=>({...item,outcome:'allowed-once',decidedAt:100})),sessions:[]};f.reset()
 assert.deepEqual(keys(f.Group(props)),keys(first))
})
test('integrated panel renders ordinary messages while a new group snapshot loads',()=>{
 const f=setupCard();f.states.push({groupId:'old',items:[{id:'stale',outcome:'pending',askedAt:1}],sessions:[]})
 const rendered=[]
 f.Group({groupId:'new',lines:[{id:'current',time:2}],renderMessage:(line,prev)=>{rendered.push([line.id,prev]);return line.id},useSessionStatus:select=>select(new Map())})
 assert.deepEqual(rendered,[['current',null]])
})
