// This source is embedded into the existing Client factory by scripts/build-approvals.mjs.
// Never serialize a pending interaction or expose its answer as a Host endpoint/tool.
export function matchApproval(item, pending) {
  return !!item && item.outcome === 'pending' && !!item.callId &&
    pending?.kind === 'approval' && pending.sessionId === item.sessionId &&
    pending.callId === item.callId && pending.toolName === item.toolName &&
    (pending.reason ?? '') === (item.reason ?? '') && pending.answerable === true &&
    typeof pending.answer === 'function'
}

// Outcome/decidedAt never participate in position or identity. Stable sort keeps
// source order for equal timestamps, including messages from the same millisecond.
export function approvalTimeline(lines = [], items = []) {
  return [...lines.map(line=>({kind:'message',time:line.time,line})),
    ...items.map(item=>({kind:'approval',time:item.askedAt,item}))]
    .sort((a,b)=>(Number(a.time)||0)-(Number(b.time)||0))
}

export function createApprovalUI(React, ctx, call) {
  const h = React.createElement
  const NS = 'dwbApprovals'
  const zh = {title:'等待权限审批',allow:'允许一次',reject:'拒绝',open:'打开原会话',reason:'申请原因',command:'操作内容',permission:'申请权限',pending:'等待审批',sending:'已提交，等待宿主确认',expired:'已取消或过期',allowed:'已允许一次',rejected:'已拒绝',unavailable:'审批不可用',connecting:'正在连接原生审批…',history:'审批记录',error:'审批状态读取失败',unknown:'尚未找到可操作的原生请求，请打开原会话查看',task:'任务',scope:'仅授权本次操作，不修改长期权限',details:'权限审批详情'}
  const en = {title:'Permission approval required',allow:'Allow once',reject:'Reject',open:'Open original session',reason:'Reason',command:'Operation',permission:'Requested access',pending:'Waiting for approval',sending:'Submitted; awaiting Host confirmation',expired:'Cancelled or expired',allowed:'Allowed once',rejected:'Rejected',unavailable:'Approval unavailable',connecting:'Connecting to native approval…',history:'Approval history',error:'Failed to read approval state',unknown:'No actionable native request; open its original session',task:'Task',scope:'Authorizes this operation only; does not change policy',details:'Permission approval details'}
  ctx.effect(()=>ctx.locale.register(NS,{zh,en}),'workbench: approval locales')
  const t = ctx.locale.bind(NS)
  const locks = new WeakSet()
  // Retain native requester scopes for the plugin lifetime, not the visible chat's
  // lifetime: switching groups/tabs must not withdraw an unanswered approval.
  const retained = new Map(), watched = new Map()
  let active = true, checking = false
  const updateRetentions = (groupId, ids) => {
    if(!active)return
    watched.set(groupId,new Set(ids ?? []))
    const keep=new Set([...watched.values()].flatMap(ids=>[...ids]))
    for(const [id,ref] of retained)if(!keep.has(id)){ref.release();retained.delete(id)}
    for(const id of keep)if(!retained.has(id)){
      const ref=ctx.sessions.retain(id,{source:'controllerOperation'})
      retained.set(id,ref);ref.ready.catch(()=>{})
    }
  }
  ctx.effect(()=>{
    const check=async()=>{
      if(!active||checking||!watched.size)return
      checking=true
      try {
        const listing=await call('groups.list',{})
        if(!active)return
        const present=new Set((listing.groups??[]).filter(g=>g.status==='active').map(g=>g.id))
        for(const id of [...watched.keys()]){
          if(!present.has(id)){updateRetentions(id,[]);watched.delete(id);continue}
          try {const data=await call('approvals.list',{groupId:id});updateRetentions(id,data.sessions)}catch{/* transport owns cancellation; never auto-answer */}
        }
      }catch{/* keep scopes through transient transport failures */}finally{checking=false}
    }
    const timer=setInterval(check,2000);timer.unref?.()
    return()=>{active=false;clearInterval(timer);for(const ref of retained.values())ref.release();retained.clear();watched.clear()}
  },'workbench: approval requester lifetimes')
  const css = `.dwb-approvals{padding:12px 16px;display:flex;flex-direction:column;gap:10px;min-width:0}.dwb-approval{border:1px solid var(--dsw-alias-state-warn-secondary);border-radius:12px;background:var(--dsw-specific-input-major);overflow:hidden;color:var(--dsw-alias-label-primary)}.dwb-approval-head{background:var(--dsw-alias-state-warn-tertiary);color:var(--dsw-alias-state-warn-primary);padding:10px 16px;font-size:13px;line-height:18px;display:flex;gap:8px;flex-wrap:wrap}.dwb-approval-body{padding:12px 16px 0;font-size:13px;line-height:20px}.dwb-approval-body p{margin:0 0 8px}.dwb-approval-command{white-space:pre-wrap;overflow-wrap:anywhere;max-height:200px;overflow:auto;font-family:var(--ds-font-family-code);font-size:12px;color:var(--dsw-alias-label-secondary)}.dwb-approval-note{color:var(--dsw-alias-label-tertiary)}.dwb-approval-actions{display:flex;flex-wrap:wrap;justify-content:flex-end;gap:8px;padding:12px 16px}.dwb-approval button{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);border-radius:8px;padding:7px 12px;font-size:13px;cursor:pointer;min-height:34px}.dwb-approval button:hover:not(:disabled){background:var(--dsw-alias-bg-layer-2)}.dwb-approval button:focus-visible{outline:2px solid var(--dsw-alias-state-info-primary);outline-offset:2px}.dwb-approval button:disabled{opacity:.5;cursor:default}.dwb-approval .dwb-approval-allow{background:var(--dsw-alias-state-warn-tertiary);color:var(--dsw-alias-state-warn-primary);border-color:var(--dsw-alias-state-warn-secondary);font-weight:600}.dwb-approval .dwb-approval-reject:hover:not(:disabled){color:var(--dsw-alias-state-error-primary)}.dwb-approval-error{color:var(--dsw-alias-state-error-primary);padding:8px 16px;font-size:13px}`
  function Card({item, pending, refresh}) {
    const [sending,setSending]=React.useState(false),[error,setError]=React.useState(null)
    const available=matchApproval(item,pending)
    const answer=async outcome=>{
      if(!matchApproval(item,pending)||locks.has(pending))return
      locks.add(pending);setSending(true);setError(null)
      try {await pending.answer(outcome);refresh()}
      catch(e){setError(String(e?.message??e));if(pending.answerable){locks.delete(pending);setSending(false)}}
    }
    const status=item.outcome==='pending'?(sending?t('sending'):available?t('pending'):item.live?t('connecting'):t('expired')):
      t({'allowed-once':'allowed',rejected:'rejected',cancelled:'expired',expired:'expired',unavailable:'unavailable'}[item.outcome]??'expired')
    return h('section',{className:'dwb-approval','aria-label':t('details'),'data-approval-id':item.id},
      h('div',{className:'dwb-approval-head'},h('strong',null,item.outcome==='pending'?t('title'):t('history')),h('span',null,item.roleName),item.taskId?h('span',null,`${t('task')} ${item.taskId}`):null),
      h('div',{className:'dwb-approval-body'},item.taskTitle?h('p',null,item.taskTitle):null,
        h('p',null,`${item.toolName} · ${status}`),item.reason?h('p',null,`${t('reason')}：${item.reason}`):null,
        item.permission?h('p',null,`${t('permission')}：${item.permission}`):null,
        item.command?h('pre',{className:'dwb-approval-command'},item.command):null,
        h('p',{className:'dwb-approval-note'},item.outcome==='pending'?t('scope'):status),
        item.outcome==='pending'&&!available?h('p',{className:'dwb-approval-note'},t('unknown')):null),
      error?h('div',{className:'dwb-approval-error',role:'alert'},error):null,
      h('div',{className:'dwb-approval-actions'},
        h('button',{type:'button',onClick:()=>ctx.uiWorkspace.openSession(item.sessionId)},t('open')),
        item.outcome==='pending'?h(React.Fragment,null,
          h('button',{type:'button',className:'dwb-approval-reject',disabled:!available||sending,onClick:()=>answer('rejected')},t('reject')),
          h('button',{type:'button',className:'dwb-approval-allow',disabled:!available||sending,onClick:()=>answer('allowed-once')},t('allow'))):null))
  }
  return function GroupApprovals({groupId,useSessionStatus,lines=[],renderMessage}) {
    const [snapshot,setSnapshot]=React.useState({groupId,items:[],sessions:[],errors:[]}),[error,setError]=React.useState(null)
    const refs=React.useRef(retained),generation=React.useRef(0),refreshRef=React.useRef(()=>{})
    const statuses=useSessionStatus(map=>map)
    const [,localeTick]=React.useState(0)
    React.useEffect(()=>ctx.locale.subscribe(()=>localeTick(n=>n+1)),[])
    React.useEffect(()=>{
      const gen=++generation.current;let dead=false,busy=false
      const refresh=async()=>{
        if(dead||busy)return;busy=true
        try{
          const data=await call('approvals.list',{groupId})
          if(dead||generation.current!==gen)return
          setSnapshot({...data,groupId});setError(data.errors?.length?t('error'):null)
          updateRetentions(groupId,data.sessions)
        }catch(e){if(!dead)setError(String(e?.message??e))}finally{busy=false}
      }
      refreshRef.current=refresh;refresh();const timer=setInterval(refresh,1200)
      return()=>{dead=true;++generation.current;clearInterval(timer)}
    },[groupId])
    // Never show or answer a previous group's snapshot while its replacement loads.
    const items=snapshot.groupId===groupId?snapshot.items:[]
    const visibleError=snapshot.groupId===groupId?error:null
    if(!items.length&&!visibleError&&!renderMessage)return null
    const timeline=approvalTimeline(lines,items)
    return h(React.Fragment,null,h('style',null,css),visibleError?h('div',{className:'dwb-approval-error',role:'alert'},visibleError):null,
      ...timeline.map((entry,index)=>{
        if(entry.kind==='message')return renderMessage?.(entry.line,timeline[index-1]?.kind==='message'?timeline[index-1].line:null)
        const item=entry.item
        return h('div',{className:'dwb-approvals',key:`approval:${item.sessionId}:${item.id}`},h(Card,{item,pending:items.filter(a=>a.outcome==='pending'&&a.sessionId===item.sessionId&&a.callId===item.callId).length===1?statuses?.get(item.sessionId)?.pendingInteraction:null,refresh:()=>refreshRef.current()}))
      }))
  }
}
