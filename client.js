// Generated from src/client by scripts/build-client.mjs. Do not edit by hand.
window.__ModuleLoader__.load({
  id: 'dsh-collab-workbench/client',
  factory: (require) => {
const module = { exports: {} }
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name2 in all)
    __defProp(target, name2, { get: all[name2], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// BEGIN WORKBENCH APPROVAL UI
// This source is embedded into the existing Client factory by scripts/build-approvals.mjs.
// Never serialize a pending interaction or expose its answer as a Host endpoint/tool.
function matchApproval(item, pending) {
  return !!item && item.outcome === 'pending' && !!item.callId &&
    pending?.kind === 'approval' && pending.sessionId === item.sessionId &&
    pending.callId === item.callId && pending.toolName === item.toolName &&
    (pending.reason ?? '') === (item.reason ?? '') && pending.answerable === true &&
    typeof pending.answer === 'function'
}

// Outcome/decidedAt never participate in position or identity. Stable sort keeps
// source order for equal timestamps, including messages from the same millisecond.
function approvalTimeline(lines = [], items = []) {
  return [...lines.map(line=>({kind:'message',time:line.time,line})),
    ...items.map(item=>({kind:'approval',time:item.askedAt,item}))]
    .sort((a,b)=>(Number(a.time)||0)-(Number(b.time)||0))
}

function createApprovalUI(React, ctx, call) {
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

// END WORKBENCH APPROVAL UI

// BEGIN WORKBENCH UPDATE UI
// Update check and manual-upgrade guidance for the existing Workbench panel;
// embedded into client.js at build time. Styles are owned by these components.
function createUpdateUI(React, ctx, call) {
  const h = React.createElement
  const NS = 'dwbUpdates'
  const zh = {
    about:'关于', cloud:'有新版本', title:'协作工作台', current:'当前版本', latest:'最新版本',
    check:'检查更新', checking:'正在检查…', update:'可升级',
    ready:'发现新版本，可按下方步骤手动升级。', currentState:'已是最新版本',
    local:'当前从本地文件安装，请从原安装来源更新。', other:'当前安装来源不支持在线检查更新。',
    pending:'尚未检查更新', failed:'检查更新失败', error:'无法检查更新，请检查网络后重试。',
    guideTitle:'升级步骤', note:'当前 Harness 不允许覆盖运行中的插件，因此不会自动安装。',
    step1:'打开 Harness 的插件（管理）页面。', step2:'卸载「协作工作台」。',
    step3:'安装下面这个版本，然后重启 Harness 并刷新页面。', spec:'安装版本',
    warning:'卸载后若安装失败，工作台会暂时不可用；请先备份工作台数据和项目文件，并确认网络与 registry 可用。',
    dataSafe:'升级只替换插件程序；$DSH_HOME/dsh-workbench 中的角色、群组和任务数据会保留。',
  }
  const en = {
    about:'About', cloud:'Update available', title:'Collaboration Workbench', current:'Installed version', latest:'Latest version',
    check:'Check for updates', checking:'Checking…', update:'Upgrade',
    ready:'A new version is available. Follow the steps below to upgrade manually.', currentState:'Up to date',
    local:'Installed from a local file; update it from the original source.', other:'This install source cannot check for updates.',
    pending:'Not checked yet', failed:'Update check failed', error:'Could not check for updates. Check your network and try again.',
    guideTitle:'Upgrade steps', note:'This Harness does not allow replacing a running plugin, so nothing is installed automatically.',
    step1:'Open the Harness plugins page.', step2:'Uninstall Collaboration Workbench.',
    step3:'Install the version below, then restart Harness and refresh the page.', spec:'Install version',
    warning:'If the install fails after uninstalling, the workbench stays unavailable until it succeeds. Back up workbench data and project files, and make sure the network and registry work first.',
    dataSafe:'Upgrading only replaces the plugin program; roles, groups and tasks in $DSH_HOME/dsh-workbench are preserved.',
  }
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'collaboration workbench: update locales')
  const t = ctx.locale.bind(NS)
  const css = `.dwb-update-cloud{width:52px;min-height:42px;padding:5px 0;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-brand-primary);cursor:pointer;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:2px}.dwb-update-cloud:hover{background:var(--dsw-alias-bg-layer-2)}.dwb-update-cloud:focus-visible,.dwb-update-about button:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}.dwb-update-cloud span{font-size:10px}.dwb-update-about{flex:1;min-width:0;overflow:auto;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);padding:56px 24px 24px}.dwb-update-card{max-width:640px;padding:20px;border:1px solid var(--dsw-alias-border-l2);border-radius:12px;background:var(--dsw-alias-bg-layer-1)}.dwb-update-about h2{font-size:18px;margin:0 0 18px}.dwb-update-about h3{font-size:14px;margin:18px 0 8px}.dwb-update-about dl{display:grid;grid-template-columns:max-content minmax(0,1fr);gap:10px 20px;margin:0 0 18px}.dwb-update-about dt{color:var(--dsw-alias-label-secondary)}.dwb-update-about dd{margin:0;overflow-wrap:anywhere}.dwb-update-state{font-size:13px;line-height:1.5;color:var(--dsw-alias-label-secondary);margin:0 0 16px}.dwb-update-error{color:var(--dsw-alias-state-error-primary)}.dwb-update-actions{display:flex;gap:10px;flex-wrap:wrap}.dwb-update-about button{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);border-radius:8px;padding:7px 12px;min-height:34px;cursor:pointer}.dwb-update-about button:hover:not(:disabled){background:var(--dsw-alias-bg-layer-2)}.dwb-update-about button:disabled{opacity:.5;cursor:default}.dwb-update-steps{margin:0;padding-left:20px;font-size:13px;line-height:1.9}.dwb-update-spec{display:inline-block;margin-top:8px;padding:6px 10px;border-radius:8px;background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l1);font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;user-select:all;overflow-wrap:anywhere}.dwb-update-note,.dwb-update-safe{font-size:12px;line-height:1.7;color:var(--dsw-alias-label-secondary);margin:10px 0 0}.dwb-update-safe{color:var(--dsw-alias-state-success-primary)}`
  function useUpdates() {
    const [status, setStatus] = React.useState({ phase:'idle', source:'unknown', current:null, latest:null, available:false })
    const [error, setError] = React.useState(null)
    const [busy, setBusy] = React.useState(false)
    const refresh = React.useCallback(async (fresh = false) => {
      setBusy(true)
      setError(null)
      try {
        const value = await call('updates.check', { fresh })
        setStatus(value)
        return value
      } catch (failure) {
        setError(String(failure?.message ?? failure))
        return null
      } finally { setBusy(false) }
    }, [])
    React.useEffect(() => {
      let active = true
      const check = async () => {
        try { const value = await call('updates.check', { fresh:false }); if (active) setStatus(value) }
        catch (failure) { if (active) setError(String(failure?.message ?? failure)) }
      }
      void check()
      const timer = setInterval(check, 60_000)
      return () => { active = false; clearInterval(timer) }
    }, [])
    return {status, error, busy, refresh}
  }
  function UpdateCloud({ onClick }) {
    return h(React.Fragment, null, h('style', null, css),
      h('button', { type:'button', className:'dwb-update-cloud', title:t('cloud'), 'aria-label':t('cloud'), onClick },
        h('svg', {width:18,height:18,viewBox:'0 0 24 24',fill:'none',stroke:'currentColor',strokeWidth:1.8,'aria-hidden':true},
          h('path',{d:'M7 18h11a4 4 0 0 0 .2-8A6.5 6.5 0 0 0 5.6 9 4.5 4.5 0 0 0 7 18Z'}),
          h('path',{d:'m12 15 0-6m-2.5 2.5L12 9l2.5 2.5'})),
        h('span',null,t('update'))))
  }
  function UpdateAbout({ status, error, busy, refresh }) {
    const failed = Boolean(error) || status.phase === 'failed'
    const state = failed ? t('failed') : status.source === 'local' ? t('local') : status.source !== 'registry' ? t('other')
      : status.available ? t('ready') : status.checkedAt ? status.latest ? t('currentState') : t('error') : t('pending')
    const spec = status.latest ? `dsh-collab-workbench@${status.latest}` : null
    return h('section', {className:'dwb-update-about', 'aria-label':t('title')},
      h('style',null,css),
      h('div',{className:'dwb-update-card'},
        h('h2',null,t('title')),
        h('dl',null,h('dt',null,t('current')),h('dd',null,status.current ?? '—'),h('dt',null,t('latest')),h('dd',null,status.latest ?? '—')),
        h('p',{className:`dwb-update-state ${failed ? 'dwb-update-error' : ''}`,role:failed ? 'alert':undefined},
          state, failed ? `: ${error ?? status.error ?? t('error')}` : ''),
        h('div',{className:'dwb-update-actions'},
          h('button',{type:'button',onClick:()=>refresh(true),disabled:busy},busy?t('checking'):t('check'))),
        status.available ? h(React.Fragment, null,
          h('h3',null,t('guideTitle')),
          h('ol',{className:'dwb-update-steps'},
            h('li',null,t('step1')), h('li',null,t('step2')),
            h('li',null,t('step3'), spec ? h('div',null,h('code',{className:'dwb-update-spec'},spec)) : null)),
          h('p',{className:'dwb-update-note'},t('note')),
          h('p',{className:'dwb-update-note'},t('warning')),
          h('p',{className:'dwb-update-safe'},t('dataSafe'))) : null))
  }
  return {useUpdates, UpdateCloud, UpdateAbout, t}
}

// END WORKBENCH UPDATE UI

// src/client/main.jsx
var main_exports = {};
__export(main_exports, {
  apply: () => apply,
  inject: () => inject,
  name: () => name
});
module.exports = __toCommonJS(main_exports);
var import_react8 = __toESM(require("react"), 1);

// src/client/app.jsx
var import_react7 = __toESM(require("react"), 1);
var import_dsh_client_ui_primitives2 = require("@deepseek-ai/dsh-client-ui-primitives");

// src/client/styles.js
var CSS = `
.dwb-app{
  --dwb-bg:var(--dsw-alias-bg-base);
  --dwb-bg-rail:var(--dsw-specific-sidebar-fill,var(--dsw-alias-bg-layer-1));
  --dwb-bg-list:var(--dsw-specific-sidebar-fill,var(--dsw-alias-bg-layer-1));
  --dwb-bg-chat:var(--dsw-alias-bg-base);
  --dwb-bg-panel:var(--dsw-alias-bg-layer-1);
  --dwb-bg-overlay:var(--dsw-alias-bg-overlay,var(--dsw-alias-bg-layer-1));
  --dwb-border:var(--dsw-alias-border-l2);
  --dwb-border-soft:var(--dsw-alias-border-l1);
  --dwb-text:var(--dsw-alias-label-primary);
  --dwb-text-2:var(--dsw-alias-label-secondary);
  --dwb-text-3:var(--dsw-alias-label-secondary);
  --dwb-accent:var(--dsw-alias-brand-primary);
  --dwb-fill:var(--dsw-alias-state-business-primary,var(--dsw-static-deepseek-500,#4176e6));
  --dwb-link:var(--dsw-alias-link,var(--dwb-fill));
  --dwb-accent-soft:color-mix(in srgb,var(--dsw-alias-brand-primary) 14%,transparent);
  --dwb-hover:color-mix(in srgb,var(--dsw-alias-label-primary) 7%,transparent);
  --dwb-bubble:var(--dsw-alias-bg-layer-2);
  --dwb-sys:var(--dsw-alias-bg-layer-1);
  --dwb-red:var(--dsw-alias-state-error-primary);
  --dwb-green:var(--dsw-alias-state-success-primary);
  --dwb-amber:var(--dsw-alias-state-warn-primary);
  display:flex; height:100%; width:100%;
  font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;
  color:var(--dwb-text); background:var(--dwb-bg-chat); font-size:14px; overflow:hidden;
}
.dwb-app *{box-sizing:border-box}
.dwb-app ::-webkit-scrollbar{width:6px;height:6px}
.dwb-app ::-webkit-scrollbar-thumb{background:color-mix(in srgb,var(--dsw-alias-label-primary) 20%,transparent);border-radius:3px}
.dwb-app ::-webkit-scrollbar-track{background:transparent}
.dwb-app button{font-family:inherit}

/* ============ \u4E3B\u9898\u6D3E\u751F\u5934\u50CF\uFF088 \u8272\u5FAA\u73AF\uFF0C\u6765\u81EA brand/success/warn/error \u53CA\u5176\u6DF7\u5408\uFF09 ============ */
.dwb-av{color:#fff}
.dwb-av0{background:var(--dwb-fill)}
.dwb-av1{background:var(--dsw-alias-state-success-primary)}
.dwb-av2{background:var(--dsw-alias-state-warn-primary)}
.dwb-av3{background:var(--dsw-alias-state-error-primary)}
.dwb-av4{background:color-mix(in srgb,var(--dwb-fill) 55%,var(--dsw-alias-state-success-primary))}
.dwb-av5{background:color-mix(in srgb,var(--dwb-fill) 55%,var(--dsw-alias-state-error-primary))}
.dwb-av6{background:color-mix(in srgb,var(--dsw-alias-state-success-primary) 55%,var(--dsw-alias-state-warn-primary))}
.dwb-av7{background:color-mix(in srgb,var(--dwb-fill) 45%,var(--dsw-alias-state-warn-primary))}
.dwb-av-self{background:var(--dwb-fill)}

/* ============ \u5DE6\u4FA7\u7A84\u5BFC\u822A\u5217\uFF08\u9489\u9489\u5F0F\uFF09 ============ */
.dwb-rail{
  width:64px; flex:none; background:var(--dwb-bg-rail);
  display:flex; flex-direction:column; align-items:center; gap:4px;
  padding:50px 0 10px; /* 40px \u5BF9\u9F50 DSH \u4FA7\u680F\u54C1\u724C\u884C + 10px \u539F\u95F4\u8DDD */
}
.dwb-rail-logo{font-size:22px; padding:6px 0 10px; filter:grayscale(.15)}
.dwb-rail-item{
  width:52px; padding:7px 0 5px; border:none; border-radius:10px; background:transparent;
  color:var(--dwb-text-3); cursor:pointer; display:flex; flex-direction:column; align-items:center; gap:2px;
  transition:background .15s,color .15s;
}
.dwb-rail-item:hover{background:var(--dwb-hover);color:var(--dwb-text-2)}
.dwb-rail-item.on{background:var(--dwb-accent-soft);color:var(--dwb-accent)}
.dwb-rail-icon{font-size:17px;line-height:1}
.dwb-rail-label{font-size:10px;line-height:1}

/* ============ \u5217\u8868\u5217\uFF08\u7FA4\u7EC4/\u4EBA\u5458/\u4EFB\u52A1\u7B5B\u9009\u5171\u7528\uFF09 ============ */
.dwb-col-list{
  width:264px; flex:none; background:var(--dwb-bg-list);
  border-right:1px solid var(--dwb-border-soft); display:flex; flex-direction:column; min-height:0;
}
.dwb-list-head{padding:52px 12px 8px; border-bottom:1px solid var(--dwb-border-soft); flex:none; /* \u9876\u90E8 40px \u5BF9\u9F50 DSH \u54C1\u724C\u884C */}
.dwb-list-title-row{display:flex; align-items:center; margin-bottom:8px}
.dwb-list-title{font-size:15px; font-weight:600}
.dwb-search{
  width:100%; background:var(--dsw-specific-input-major,transparent);
  border:1px solid var(--dwb-border-soft); color:var(--dwb-text-2);
  border-radius:8px; padding:7px 10px; font-size:12px; outline:none;
}
.dwb-search:focus{border-color:var(--dwb-accent); color:var(--dwb-text)}
.dwb-search::placeholder{color:var(--dwb-text-3)}
.dwb-list-scroll{flex:1; overflow-y:auto; padding:6px}
.dwb-list-empty{color:var(--dwb-text-3); font-size:12px; text-align:center; padding:28px 10px; line-height:1.9; white-space:pre-line}

.dwb-icon-btn{
  width:28px; height:28px; border:none; border-radius:7px; background:transparent;
  color:var(--dwb-text-2); cursor:pointer; font-size:14px; line-height:1; flex:none;
  display:inline-flex; align-items:center; justify-content:center;
}
.dwb-icon-btn:hover{background:var(--dwb-hover); color:var(--dwb-text)}
.dwb-icon-btn.on{background:var(--dwb-accent-soft); color:var(--dwb-accent)}

/* \u7FA4\u7EC4\u9879\uFF08\u5FAE\u4FE1\u5F0F\uFF09 */
.dwb-gitem{
  display:flex; align-items:center; gap:10px; width:100%; padding:9px 10px; margin-bottom:2px;
  border:none; border-radius:10px; background:transparent; color:var(--dwb-text);
  cursor:pointer; text-align:left; transition:background .12s;
}
.dwb-gitem:hover{background:var(--dwb-hover)}
.dwb-gitem.on{background:var(--dwb-accent-soft); box-shadow:inset 2px 0 0 var(--dwb-accent)}
.dwb-gitem.sm{padding:6px 8px; gap:8px}
.dwb-gmid{flex:1; min-width:0; display:flex; flex-direction:column; gap:2px}
.dwb-gname{font-size:13.5px; font-weight:550; white-space:nowrap; overflow:hidden; text-overflow:ellipsis}
.dwb-gpreview{font-size:12px; color:var(--dwb-text-3); white-space:nowrap; overflow:hidden; text-overflow:ellipsis}
.dwb-gright{display:flex; flex-direction:column; align-items:flex-end; gap:5px; flex:none}
.dwb-gtime{font-size:11px; color:var(--dwb-text-3)}
.dwb-unread{
  min-width:17px; height:17px; padding:0 5px; border-radius:9px; background:var(--dwb-red);
  color:#fff; font-size:10.5px; font-weight:600; display:inline-flex; align-items:center; justify-content:center;
}

/* \u4EBA\u5458/\u4EFB\u52A1\u5DE6\u4FA7\u5206\u7EC4 */
.dwb-org-sec{margin-bottom:8px}
.dwb-org-sec-title{font-size:11px; color:var(--dwb-text-3); letter-spacing:1px; padding:8px 10px 4px}
.dwb-filters{display:flex; flex-wrap:wrap; gap:4px; padding:0 8px}
.dwb-filters.col{flex-direction:column; align-items:stretch}
.dwb-filter{
  border:none; border-radius:7px; background:transparent; color:var(--dwb-text-2);
  padding:5px 10px; font-size:12px; cursor:pointer; text-align:left;
  white-space:nowrap; overflow:hidden; text-overflow:ellipsis;
}
.dwb-filter:hover{background:var(--dwb-hover)}
.dwb-filter.on{background:var(--dwb-accent-soft); color:var(--dwb-accent); font-weight:600}

/* ============ \u5BF9\u8BDD\u533A ============ */
.dwb-col-chat{flex:1; min-width:0; display:flex; flex-direction:column; background:var(--dwb-bg-chat); position:relative}
.dwb-chat-head{
  display:flex; align-items:center; gap:10px; padding:10px 16px;
  border-bottom:1px solid var(--dwb-border-soft); background:var(--dwb-bg-panel); flex:none;
}
.dwb-chat-headmid{min-width:0; display:flex; flex-direction:column; gap:1px}
.dwb-chat-name{font-size:14.5px; font-weight:600; white-space:nowrap; overflow:hidden; text-overflow:ellipsis}
.dwb-chat-sub{font-size:11.5px; color:var(--dwb-text-3)}
.dwb-avatar-stack{display:flex; align-items:center; margin-left:8px}
.dwb-avatar-stack>span{margin-left:-6px; box-shadow:0 0 0 2px var(--dwb-bg-panel)}
.dwb-avatar-stack>span:first-child{margin-left:0}
.dwb-stack-more{font-size:11px; color:var(--dwb-text-3); margin-left:4px}

.dwb-chat-body{flex:1; display:flex; min-height:0}

/* \u6D88\u606F\u6D41 */
.dwb-msgs{flex:1; overflow-y:auto; padding:16px 18px; display:flex; flex-direction:column; gap:2px}
.dwb-time-sep{
  align-self:center; margin:10px 0 8px; padding:2px 10px; border-radius:10px;
  background:var(--dwb-sys); color:var(--dwb-text-3); font-size:11px; flex:none;
}
.dwb-sysmsg{
  align-self:center; max-width:76%; margin:6px 0; padding:8px 12px; border-radius:10px;
  background:var(--dwb-sys); color:var(--dwb-text-2); font-size:12px; line-height:1.7;
  cursor:default; white-space:pre-wrap; word-break:break-word;
}
.dwb-sysmsg.open{cursor:pointer}
.dwb-sysmsg-head{display:flex; align-items:center; gap:6px; flex-wrap:wrap}
.dwb-sysmsg-body{margin-top:6px; color:var(--dwb-text-3)}
.dwb-sys-toggle{color:var(--dwb-link); font-size:11.5px; cursor:pointer; flex:none}
.dwb-sysmsg.task-notice{max-width:60%; padding:4px 12px; opacity:.7}
.dwb-sysmsg.task-notice .dwb-sysmsg-head{display:flex; align-items:center; gap:6px; font-size:11.5px}
.dwb-sysmsg-badge{font-size:12px; flex:none}
.dwb-sysmsg-text{overflow:hidden; text-overflow:ellipsis; white-space:nowrap; flex:1; min-width:0}

.dwb-mrow{display:flex; gap:9px; margin-top:10px; align-items:flex-start}
.dwb-mrow.grouped{margin-top:3px}
.dwb-mrow.self{flex-direction:row-reverse}
.dwb-mavatar{width:32px; flex:none; display:flex; justify-content:center}
.dwb-mrow:not(.grouped) .dwb-mavatar{padding-top:17px}
.dwb-mrow.grouped .dwb-mavatar{visibility:hidden; height:0; overflow:hidden}
.dwb-mbody{display:flex; flex-direction:column; gap:3px; max-width:min(72%,640px); min-width:0}
.dwb-mrow.self .dwb-mbody{align-items:flex-end}
.dwb-mname{font-size:11.5px; color:var(--dwb-text-3); padding:0 4px}
.dwb-bubble{
  padding:8px 12px; border-radius:4px 12px 12px 12px;
  background:var(--dwb-bubble); font-size:13.5px; line-height:1.7;
  white-space:pre-wrap; word-break:break-word;
}
.dwb-mrow.grouped .dwb-bubble{border-radius:4px 12px 12px 4px}
.dwb-mrow.self .dwb-bubble{border-radius:12px 4px 4px 12px}
.dwb-mrow.self.grouped .dwb-bubble{border-radius:12px 4px 4px 4px}
.dwb-at{color:var(--dwb-link); font-weight:550}

/* \u8F93\u5165\u533A\uFF08\u89C2\u611F\u5BF9\u9F50 DSH \u539F\u751F InputBar\uFF1A\u8BBE\u8BA1\u503C\u53D6\u81EA dsh-client-ui-conversation \u7684 InputBar.module.css\uFF0C
   \u5706\u89D2/\u914D\u8272/\u5C3A\u5BF8\u7528 --dsw-* \u4EE4\u724C\uFF0C\u7F3A\u5931\u65F6\u56DE\u9000\u5230\u672C\u63D2\u4EF6\u6D3E\u751F\u503C\uFF09 */
.dwb-composer{
  --dsh-composer-side-clearance:16px;
  --dsh-composer-card-max-width:min(calc(100% - 16px),952px);
  --dsh-composer-text-max-height:336px;
  flex:none; position:relative;
  display:flex; flex-direction:column; align-items:center;
  padding:0 var(--dsh-composer-side-clearance) 4px;
}
.dwb-comp-notice{
  width:100%; max-width:var(--dsh-composer-card-max-width);
  border-radius:var(--dsw-radius-md,12px);
  background:var(--dsw-alias-interactive-bg-hover,var(--dwb-hover));
  color:var(--dsw-alias-state-error-primary,var(--dwb-red));
  margin-bottom:6px; padding:4px 8px; font-size:12px; line-height:18px;
}
.dwb-comp-card{
  box-sizing:border-box; width:100%; max-width:var(--dsh-composer-card-max-width);
  --dsw-elevation-stroke-color:var(--dsw-alias-border-l2,var(--dwb-border));
  border-radius:var(--dsw-radius-panel,28px);
  background:var(--dsw-specific-input-major,var(--dsw-alias-bg-layer-1));
  box-shadow:var(--dsw-elevation-soft,0 0 0 .5px var(--dwb-border-soft));
  border:0;
  display:flex; flex-direction:column; gap:12px; padding:8px 0 0;
  font-size:var(--dsh-content-font-size,14px);
  line-height:calc(24px + var(--dsh-content-font-delta,0px));
  position:relative;
}
.dwb-ta{
  box-sizing:border-box; width:100%; min-height:36px;
  max-height:var(--dsh-composer-text-max-height);
  margin-right:4px; overflow-y:auto; resize:none; border:0; outline:none;
  background:transparent; color:var(--dwb-text);
  font-family:inherit; font-size:inherit; line-height:inherit;
  caret-color:var(--dwb-fill);
  padding:4px 8px 0 14px;
  white-space:pre-wrap; word-break:break-word; overflow-wrap:anywhere;
  scrollbar-color:var(--dsw-alias-scrollbar-bg-l2,color-mix(in srgb,var(--dsw-alias-label-primary) 20%,transparent)) transparent;
}
.dwb-ta::placeholder{color:var(--dsw-alias-label-caption,var(--dwb-text-3))}
/* \uFF0B \u53F7\u4E0A\u4F20\u7684\u9644\u4EF6 chips\uFF08\u53D1\u9001\u524D\uFF09 */
.dwb-comp-files{display:flex; flex-wrap:wrap; gap:4px; padding:2px 8px 0 14px}
.dwb-comp-file{
  display:inline-flex; align-items:center; gap:6px; min-width:0; max-width:100%;
  border:.5px solid var(--dsw-alias-border-l1,var(--dwb-border-soft));
  border-radius:var(--dsw-radius-sm,8px);
  background:var(--dsw-alias-bg-base,var(--dwb-bg));
  padding:3px 4px 3px 8px; font-size:12px; line-height:18px; color:var(--dwb-text-2);
}
.dwb-comp-file.pending{opacity:.6}
.dwb-comp-file.error{color:var(--dwb-red)}
.dwb-comp-file-name{max-width:180px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap}
.dwb-comp-file-size{color:var(--dwb-text-3); flex:none; font-size:11px}
.dwb-comp-file-x{
  border:none; background:transparent; color:var(--dwb-text-3); cursor:pointer;
  display:inline-flex; align-items:center; justify-content:center;
  width:18px; height:18px; padding:0; border-radius:999px; flex:none;
}
.dwb-comp-file-x:hover{background:var(--dwb-hover); color:var(--dwb-text)}
/* \u6D88\u606F\u6D41\u4E2D\u7684\u6587\u4EF6\u5361\u7247\uFF08\u53D1\u9001\u540E\uFF09 */
.dwb-mfiles{display:flex; flex-wrap:wrap; gap:6px; margin-top:4px; max-width:380px}
.dwb-mfile{
  display:inline-flex; align-items:center; gap:8px; min-width:0;
  border:1px solid var(--dwb-border-soft); border-radius:10px;
  background:var(--dwb-bubble); padding:7px 12px;
}
.dwb-mfile-info{display:flex; flex-direction:column; min-width:0}
.dwb-mfile-name{font-size:12.5px; color:var(--dwb-text); max-width:220px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap}
.dwb-mfile-size{font-size:11px; color:var(--dwb-text-3); max-width:220px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap}
.dwb-comp-row{
  display:flex; flex-wrap:wrap; justify-content:space-between; align-items:center;
  gap:12px; min-width:0; padding:2px 8px 6px;
}
.dwb-comp-tools,.dwb-comp-trailing{display:flex; align-items:center; min-width:0; gap:12px}
.dwb-comp-trailing{flex:none; margin-left:auto; gap:8px}
.dwb-comp-add{
  corner-shape:round;
  background:var(--dsw-specific-selector,color-mix(in srgb,var(--dsw-alias-label-primary) 8%,transparent));
  width:28px; height:28px; display:grid; place-items:center; flex:none;
  color:var(--dwb-text); cursor:pointer; border:none; border-radius:999px;
  transition:background-color .1s;
}
.dwb-comp-add:hover,.dwb-comp-add.on{background:var(--dsw-alias-interactive-bg-hover-solid,var(--dwb-hover))}
.dwb-comp-hint{font-size:12px; line-height:18px; color:var(--dsw-alias-label-caption,var(--dwb-text-3))}
.dwb-comp-send{
  corner-shape:round;
  background:var(--dsw-alias-button-info-fill,var(--dwb-fill)); color:#fff;
  width:34px; height:34px; display:grid; place-items:center; flex:none;
  cursor:pointer; border:none; border-radius:999px;
  transition:background-color .1s; transform:translateY(-2px);
}
.dwb-comp-send:hover:not(:disabled){background:var(--dsw-alias-button-info-hover,color-mix(in srgb,var(--dwb-fill) 85%,#fff))}
.dwb-comp-send:disabled{opacity:.4; cursor:default}
.dwb-comp-send:focus-visible,.dwb-comp-add:focus-visible{
  outline:var(--dsw-focus-ring-width,2px) solid var(--dsw-focus-ring-color,var(--dwb-fill));
  outline-offset:1px;
}

/* \u7FA4\u4FE1\u606F\u4FA7\u680F */
.dwb-ctx{
  width:236px; flex:none; border-left:1px solid var(--dwb-border-soft); background:var(--dwb-bg-list);
  overflow-y:auto; display:flex; flex-direction:column;
}
.dwb-ctx-sec{padding:12px 14px; border-bottom:1px solid var(--dwb-border-soft)}
.dwb-ctx-title{font-size:11px; color:var(--dwb-text-3); letter-spacing:1px; margin-bottom:8px}
.dwb-member-row{display:flex; align-items:center; gap:8px; padding:4px 0}
.dwb-member-name{font-size:13px; flex:1; min-width:0; white-space:nowrap; overflow:hidden; text-overflow:ellipsis}
.dwb-dot{width:8px; height:8px; border-radius:50%; background:var(--dsw-alias-state-idle-primary); flex:none}
.dwb-dot.on{background:var(--dwb-green)}
.dwb-ctx-empty{font-size:12px; color:var(--dwb-text-3); padding:4px 0}
.dwb-ctx-task{display:flex; align-items:center; gap:6px; padding:4px 0; font-size:12.5px}
.dwb-ctx-task-title{flex:1; min-width:0; white-space:nowrap; overflow:hidden; text-overflow:ellipsis}
.dwb-ctx-kv{display:flex; align-items:baseline; gap:8px; font-size:12px; padding:3px 0}
.dwb-ctx-kv span{color:var(--dwb-text-3); flex:none}
.dwb-ctx-kv b{font-weight:500; word-break:break-all}
.dwb-ctx-kv.col{flex-direction:column; gap:2px}
.dwb-ctx-dir{font-size:11px; color:var(--dwb-text-2)}

/* ============ \u7BA1\u7406\u533A\uFF08\u4EBA\u5458/\u4EFB\u52A1\u53F3\u4FA7\uFF09 ============ */
.dwb-col-manage{flex:1; min-width:0; display:flex; flex-direction:column; overflow-y:auto; background:var(--dwb-bg-chat)}
.dwb-manage-head{display:flex; align-items:baseline; gap:12px; padding:16px 20px 4px}
.dwb-manage-title{font-size:16px; font-weight:600}
.dwb-manage-sub{font-size:12px; color:var(--dwb-text-3)}
.dwb-form-card{margin:12px 20px; padding:14px 16px; background:var(--dwb-bg-panel); border:1px solid var(--dwb-border-soft); border-radius:12px}
.dwb-form-title{font-size:13px; font-weight:600; margin-bottom:10px}
.dwb-form-row{display:flex; gap:8px; align-items:center; flex-wrap:wrap; margin-bottom:8px}
.dwb-form-row:last-child{margin-bottom:0}
.dwb-assign-label{font-size:12px; color:var(--dwb-text-3)}
.dwb-manage-empty{flex:1; display:flex; align-items:center; justify-content:center; min-height:300px}
.dwb-cards{display:grid; grid-template-columns:repeat(auto-fill,minmax(300px,1fr)); gap:12px; padding:4px 20px 20px}

.dwb-card{background:var(--dwb-bg-panel); border:1px solid var(--dwb-border-soft); border-radius:12px; padding:13px 15px; display:flex; flex-direction:column; gap:8px}
.dwb-card.off{opacity:.6}
.dwb-card.tall{min-height:108px; padding:18px 20px; gap:12px}
.dwb-card.tall .dwb-card-desc{max-height:110px}
.dwb-card-hl>.dwb-card{border-color:var(--dwb-accent); box-shadow:0 0 0 1px var(--dwb-accent)}
.dwb-card-head{display:flex; align-items:center; gap:10px; min-width:0}
.dwb-card-mid{flex:1; min-width:0; display:flex; flex-direction:column; gap:1px}
.dwb-card-title{font-size:13.5px; font-weight:600; white-space:nowrap; overflow:hidden; text-overflow:ellipsis}
.dwb-card-sub{font-size:11.5px; color:var(--dwb-text-3)}
.dwb-card-desc{font-size:12px; color:var(--dwb-text-2); line-height:1.7; max-height:66px; overflow-y:auto; white-space:pre-wrap}
.dwb-card-actions{display:flex; gap:6px; margin-top:auto}
.dwb-card-foot{display:flex; align-items:center; gap:8px; flex-wrap:wrap}
.dwb-card-assignees{display:flex; align-items:center; gap:3px; min-width:0}

/* \u5FBD\u7AE0\uFF08\u72B6\u6001\u8272 + \u900F\u660E\u6DF7\u5408\u5E95\uFF0C\u8DDF\u968F\u4E3B\u9898\uFF09 */
.dwb-chip{
  display:inline-flex; align-items:center; padding:1px 8px; border-radius:9px;
  font-size:11px; font-weight:550; flex:none; line-height:1.6;
}
.dwb-chip.p-high{background:color-mix(in srgb,var(--dwb-red) 14%,transparent); color:var(--dwb-red)}
.dwb-chip.p-mid{background:color-mix(in srgb,var(--dwb-amber) 16%,transparent); color:var(--dwb-amber)}
.dwb-chip.p-low{background:color-mix(in srgb,var(--dwb-green) 14%,transparent); color:var(--dwb-green)}
.dwb-chip.st-done{background:color-mix(in srgb,var(--dwb-green) 14%,transparent); color:var(--dwb-green)}
.dwb-chip.st-doing{background:color-mix(in srgb,var(--dwb-amber) 16%,transparent); color:var(--dwb-amber)}
.dwb-chip.st-todo{background:color-mix(in srgb,var(--dsw-alias-label-primary) 10%,transparent); color:var(--dwb-text-2)}

/* \u5F39\u7A97 */
.dwb-modal-mask{position:fixed; inset:0; background:var(--dsw-alias-bg-mask-1,rgba(0,0,0,.35)); z-index:1000; display:flex; align-items:center; justify-content:center}
.dwb-modal{width:600px; max-width:94%; max-height:88%; overflow-y:auto; background:var(--dsw-alias-bg-layer-1); border:1px solid var(--dwb-border-soft); border-radius:16px; padding:24px 28px; box-shadow:var(--dsw-shadow-lv3,0 12px 32px rgba(0,0,0,.14))}
.dwb-modal-title{font-size:16px; font-weight:600; margin-bottom:16px}
.dwb-field{margin-bottom:16px}
.dwb-field>label{display:block; font-size:12px; color:var(--dwb-text-2); margin-bottom:6px}
.dwb-field-hint{font-size:11px; color:var(--dwb-text-3); margin-top:5px; line-height:1.6}
.dwb-member-pick{display:flex; flex-wrap:wrap; gap:8px}
.dwb-pick{
  display:inline-flex; align-items:center; gap:6px; padding:5px 10px; border-radius:9px;
  border:1px solid var(--dwb-border-soft); background:color-mix(in srgb,var(--dsw-alias-label-primary) 4%,transparent);
  cursor:pointer; font-size:12.5px; color:var(--dwb-text);
}
.dwb-pick:hover{border-color:var(--dwb-border)}
.dwb-pick.on{border-color:var(--dwb-accent); background:var(--dwb-accent-soft)}
.dwb-pick.sm{padding:3px 8px; font-size:12px}
.dwb-pick input{margin:0}
.dwb-pick-type{font-size:10.5px; color:var(--dwb-text-3)}
.dwb-modal-actions{display:flex; justify-content:flex-end; gap:10px; margin-top:12px}
/* \u5F39\u7A97\u5185\u591A\u884C\u6587\u672C\u57DF\uFF08\u804C\u8D23\u63CF\u8FF0\u7B49\uFF09 */
.dwb-textarea{
  width:100%; min-height:128px; max-height:280px; resize:vertical;
  background:var(--dsw-specific-input-major,transparent);
  border:1px solid var(--dwb-border-soft); color:var(--dwb-text);
  border-radius:8px; padding:8px 11px; font-size:13px; line-height:1.7;
  outline:none; font-family:inherit;
}
.dwb-textarea:focus{border-color:var(--dwb-accent)}
.dwb-textarea::placeholder{color:var(--dwb-text-3)}

/* \u901A\u7528\u63A7\u4EF6 */
.dwb-btn{
  border:none; border-radius:8px; background:color-mix(in srgb,var(--dsw-alias-label-primary) 10%,transparent);
  color:var(--dwb-text); padding:8px 14px; font-size:13px; cursor:pointer; font-family:inherit;
}
.dwb-btn:hover{background:color-mix(in srgb,var(--dsw-alias-label-primary) 16%,transparent)}
.dwb-btn.primary{background:var(--dwb-fill); color:#fff}
.dwb-btn.primary:hover{background:color-mix(in srgb,var(--dwb-fill) 85%,#fff)}
.dwb-btn.danger{background:color-mix(in srgb,var(--dwb-red) 14%,transparent); color:var(--dwb-red)}
.dwb-btn.danger:hover{background:color-mix(in srgb,var(--dwb-red) 22%,transparent)}
.dwb-btn.small{padding:4px 10px; font-size:12px}
.dwb-btn:disabled{background:color-mix(in srgb,var(--dsw-alias-label-primary) 8%,transparent); color:var(--dwb-text-3); cursor:default}
.dwb-input,.dwb-select{
  background:var(--dsw-specific-input-major,transparent); border:1px solid var(--dwb-border-soft);
  color:var(--dwb-text); border-radius:8px; padding:7px 11px; font-size:13px; outline:none; font-family:inherit;
}
.dwb-input:focus,.dwb-select:focus{border-color:var(--dwb-accent)}
.dwb-input::placeholder{color:var(--dwb-text-3)}
/* \u5DE5\u4F5C\u76EE\u5F55\u8F93\u5165\u884C\uFF1A\u8F93\u5165\u6846\u6491\u6EE1\u5269\u4F59\u5BBD\u5EA6\uFF08flex item \u9ED8\u8BA4\u6536\u7F29\u5230\u5185\u5BB9\u5BBD\u5EA6\u4F1A\u663E\u5F97\u7A84\uFF09 */
.dwb-dir-row .dwb-input{flex:1; min-width:0}
.dwb-err{color:var(--dwb-red); font-size:12.5px; padding:8px 12px; background:color-mix(in srgb,var(--dwb-red) 10%,transparent); border-radius:8px; margin-bottom:10px; white-space:pre-wrap}
.dwb-ok{color:var(--dwb-green); font-size:12.5px; padding:8px 12px; background:color-mix(in srgb,var(--dwb-green) 10%,transparent); border-radius:8px; margin-bottom:10px; white-space:pre-wrap}

/* \u4EBA\u5458\u8BE6\u60C5\uFF08\u56FA\u5B9A\u5E03\u5C40\xB7\u8FB9\u6846\u7EBF\u98CE\u683C\uFF1A\u65E0\u5E95\u8272\u586B\u5145\uFF0C\u4EC5\u5206\u9694\u7EBF\uFF1B\u7F16\u8F91\u6001\u9632\u6324\u538B\uFF09 */
.dwb-person-detail{width:760px; max-width:calc(100% - 48px); height:500px; display:flex; flex-direction:column; margin:36px auto 32px; background:transparent; border:none; border-radius:0; padding:0 40px}
.dwb-pd-head{flex:none; height:96px; display:flex; align-items:center; gap:18px; border-bottom:1px solid var(--dwb-border-soft)}
.dwb-pd-mid{flex:1; min-width:0}
.dwb-pd-name{font-size:20px; font-weight:600; letter-spacing:.3px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis}
.dwb-pd-name-input{font-size:17px; font-weight:600; max-width:300px}
.dwb-pd-sub{font-size:12.5px; color:var(--dwb-text-3); margin-top:6px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis}
.dwb-pd-meta{flex:none; height:56px; display:flex; align-items:center; gap:40px; border-bottom:1px solid var(--dwb-border-soft); overflow:hidden}
.dwb-pd-meta-item{flex:none; display:flex; align-items:center; gap:10px; font-size:13px; white-space:nowrap}
.dwb-pd-meta-item span{color:var(--dwb-text-3); font-size:12px}
.dwb-pd-meta-item b{font-weight:550; color:var(--dwb-text-2)}
.dwb-pd-model{display:inline-block; max-width:240px; overflow:hidden; text-overflow:ellipsis; vertical-align:middle}
.dwb-pd-meta-item .dwb-select{width:320px}
.dwb-pd-duty{flex:1; min-height:0; display:flex; flex-direction:column; padding:18px 0 14px}
.dwb-pd-duty .dwb-ctx-title{flex:none; margin-bottom:10px}
.dwb-pd-duty-text{flex:1; overflow-y:auto; font-size:13.5px; color:var(--dwb-text-2); line-height:2.0; white-space:pre-wrap; word-break:break-word; padding:2px 0}
.dwb-pd-duty-edit{flex:1; min-height:0; height:100%; max-height:none; resize:none; line-height:2.0}
.dwb-pd-actions{flex:none; height:72px; display:flex; align-items:center; gap:10px; border-top:1px solid var(--dwb-border-soft)}
.dwb-pd-confirm-text{font-size:12.5px; color:var(--dwb-text-2); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; min-width:0}

/* \u2705 \u4EFB\u52A1\u5B8C\u6210\u5361\u7247 */
.dwb-done-card{
  align-self:stretch; margin:8px 4px; padding:14px 18px;
  background:color-mix(in srgb,var(--dwb-green) 10%,transparent);
  border:1px solid color-mix(in srgb,var(--dwb-green) 30%,transparent);
  border-left:4px solid var(--dwb-green);
  border-radius:12px; display:flex; gap:12px; align-items:flex-start;
}
/* \u{1F4CA} \u8FDB\u5EA6\u6C47\u62A5\u5361\u7247 */
.dwb-progress-card{
  align-self:stretch; margin:6px 4px; padding:10px 16px;
  background:color-mix(in srgb,var(--dwb-accent) 6%,transparent);
  border:1px solid color-mix(in srgb,var(--dwb-accent) 20%,transparent);
  border-left:3px solid var(--dwb-accent);
  border-radius:10px; display:flex; gap:12px; align-items:flex-start;
  font-size:13px;
}

/* \u{1F64B} \u51B3\u7B56\u5361\u9009\u9879\u6309\u94AE */
.dwb-ask-options{
  display:flex; flex-wrap:wrap; gap:8px; margin-top:12px;
}
.dwb-ask-option-btn{
  padding:8px 16px; border-radius:10px; cursor:pointer;
  border:1.5px solid color-mix(in srgb,var(--dwb-amber,var(--dsw-alias-state-business-primary)) 50%,transparent);
  background:color-mix(in srgb,var(--dwb-amber,var(--dsw-alias-state-business-primary)) 8%,transparent);
  color:var(--dwb-text); font-size:13px; font-weight:500;
  transition:all .15s ease; text-align:left; max-width:100%;
}
.dwb-ask-option-btn:hover{
  background:color-mix(in srgb,var(--dwb-amber,var(--dsw-alias-state-business-primary)) 18%,transparent);
  border-color:var(--dwb-amber,var(--dsw-alias-state-business-primary));
  transform:translateY(-1px);
}
.dwb-ask-option-btn:active{transform:translateY(0)}

/* \u{1F4AD} \u6B63\u5728\u5DE5\u4F5C\u6307\u793A\u5668\uFF08typing indicator\uFF0C\u56FA\u5B9A\u5728\u8F93\u5165\u6846\u4E0A\u65B9\uFF09 */
.dwb-working{
  display:flex; flex-direction:column; gap:2px;
  padding:4px 16px 8px; flex:none;
  border-top:1px solid color-mix(in srgb,var(--dwb-border-soft,transparent) 60%,transparent);
}
.dwb-working-row{
  display:flex; align-items:center; gap:8px;
  font-size:12.5px; color:var(--dwb-text-secondary);
  padding:4px 12px;
  background:color-mix(in srgb,var(--dsw-alias-bg-layer-1,transparent) 60%,transparent);
  border-radius:10px;
  animation:dwb-working-in .3s ease;
}
.dwb-working-name{font-weight:600; color:var(--dwb-text)}
.dwb-working-label{opacity:.7}
.dwb-working-dots{
  display:inline-flex; gap:3px; align-items:center;
}
.dwb-working-dots i{
  width:5px; height:5px; border-radius:50%;
  background:var(--dwb-accent,var(--dsw-alias-state-business-primary));
  animation:dwb-dot-bounce 1.2s ease-in-out infinite;
}
.dwb-working-dots i:nth-child(2){animation-delay:.15s}
.dwb-working-dots i:nth-child(3){animation-delay:.3s}
@keyframes dwb-dot-bounce{
  0%,60%,100%{transform:translateY(0);opacity:.4}
  30%{transform:translateY(-4px);opacity:1}
}
@keyframes dwb-working-in{
  from{opacity:0;transform:translateY(4px)}
  to{opacity:1;transform:translateY(0)}
}

/* \u26A0\uFE0F \u9700\u8981\u51B3\u7B56\u5361\u7247\uFF08dwb_ask_user \u89E6\u53D1\uFF09\xB7 \u589E\u5F3A\u7248 */
.dwb-ask-card{
  align-self:stretch; margin:10px 4px; padding:16px 20px;
  background:color-mix(in srgb,var(--dwb-amber) 14%,transparent);
  border:2px solid color-mix(in srgb,var(--dwb-amber) 60%,transparent);
  border-left:6px solid var(--dwb-amber);
  border-radius:14px; display:flex; gap:14px; align-items:flex-start;
  box-shadow:0 2px 12px color-mix(in srgb,var(--dwb-amber) 20%,transparent);
}
.dwb-ask-user-tag{
  display:inline-flex; align-items:center; gap:4px;
  padding:2px 10px; border-radius:10px;
  background:color-mix(in srgb,var(--dwb-amber) 25%,transparent);
  color:var(--dwb-text); font-size:11px; font-weight:600; margin-bottom:6px;
}
.dwb-ask-icon{font-size:26px; flex:none; margin-top:2px}
.dwb-ask-body{font-size:14.5px; line-height:1.8; color:var(--dwb-text); white-space:pre-wrap; word-break:break-word}

/* \u7A7A\u72B6\u6001 */
.dwb-empty-wrap{flex:1; display:flex; flex-direction:column; align-items:center; justify-content:center; padding:30px; text-align:center}
.dwb-empty-icon{font-size:44px; opacity:.55; margin-bottom:14px}
.dwb-empty-title{font-size:14.5px; color:var(--dwb-text-2); font-weight:550}
.dwb-empty-hint{font-size:12px; color:var(--dwb-text-3); margin-top:8px; line-height:1.9; white-space:pre-line}
`;

// src/client/data.jsx
var import_react = require("react");

// src/client/rpc.js
async function call(endpoint, payload = {}) {
  const response = await fetch("api/dsh-workbench", {
    method: "POST",
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ endpoint, payload })
  });
  const body = await response.json().catch(() => ({ ok: false, error: "\u54CD\u5E94\u89E3\u6790\u5931\u8D25" }));
  if (!body.ok) {
    throw new Error(body.error ?? `RPC \u5931\u8D25: ${endpoint}`);
  }
  return body.data;
}

// src/client/data.jsx
function useGroups(pollMs = 2e4) {
  const [groups, setGroups] = (0, import_react.useState)([]);
  const [err, setErr] = (0, import_react.useState)(null);
  const load = (0, import_react.useCallback)(() => {
    call("groups.list").then((d) => {
      setGroups(d.groups ?? []);
      setErr(null);
    }).catch((e) => setErr(e.message));
  }, []);
  (0, import_react.useEffect)(() => {
    load();
    if (!pollMs) return;
    const t = setInterval(load, pollMs);
    return () => clearInterval(t);
  }, [load, pollMs]);
  return { groups, err, reload: load };
}
function useRoles(pollMs = 3e4) {
  const [roles, setRoles] = (0, import_react.useState)([]);
  const [presets, setPresets] = (0, import_react.useState)([]);
  const [err, setErr] = (0, import_react.useState)(null);
  const load = (0, import_react.useCallback)(() => {
    call("roles.list").then((d) => {
      setRoles(d.roles ?? []);
      setPresets(d.presets ?? []);
      setErr(null);
    }).catch((e) => setErr(e.message));
  }, []);
  (0, import_react.useEffect)(() => {
    load();
    if (!pollMs) return;
    const t = setInterval(load, pollMs);
    return () => clearInterval(t);
  }, [load, pollMs]);
  return { roles, presets, err, reload: load };
}
function useTasks(groupId) {
  const [tasks, setTasks] = (0, import_react.useState)([]);
  const [err, setErr] = (0, import_react.useState)(null);
  const [tick, setTick] = (0, import_react.useState)(0);
  (0, import_react.useEffect)(() => {
    let alive = true;
    call("tasks.list", { groupId: groupId || void 0 }).then((d) => {
      if (alive) {
        setTasks(d.tasks ?? []);
        setErr(null);
      }
    }).catch((e) => {
      if (alive) setErr(e.message);
    });
    return () => {
      alive = false;
    };
  }, [groupId, tick]);
  return { tasks, err, reload: () => setTick((t) => t + 1) };
}
function loadSeen() {
  try {
    return JSON.parse(localStorage.getItem("dwb-seen") || "{}");
  } catch {
    return {};
  }
}
function useSeen() {
  const [seen, setSeen] = (0, import_react.useState)(loadSeen);
  const markSeen = (0, import_react.useCallback)((id, seq) => {
    setSeen((prev) => {
      if ((prev[id] ?? 0) >= seq) return prev;
      const next = { ...prev, [id]: seq };
      try {
        localStorage.setItem("dwb-seen", JSON.stringify(next));
      } catch {
      }
      return next;
    });
  }, []);
  return [seen, markSeen];
}
function useModels() {
  const [models, setModels] = (0, import_react.useState)([]);
  const [def, setDef] = (0, import_react.useState)("");
  (0, import_react.useEffect)(() => {
    call("models.list").then((d) => {
      setModels(d.models ?? []);
      setDef(d.default ?? "");
    }).catch(() => {
    });
  }, []);
  return { models, defaultModel: def };
}

// src/client/groups.jsx
var import_react3 = __toESM(require("react"), 1);

// src/client/ui.jsx
var import_react2 = __toESM(require("react"), 1);
var import_jsx_runtime = require("react/jsx-runtime");
function hashCode(text) {
  let h = 0;
  const s = String(text ?? "");
  for (let i = 0; i < s.length; i++) h = h * 31 + s.charCodeAt(i) | 0;
  return Math.abs(h);
}
function avatarClass(name2) {
  return `dwb-av dwb-av${hashCode(name2) % 8}`;
}
function Avatar({ name: name2, size = 36, self = false, title }) {
  const label = String(name2 || "?").trim().charAt(0) || "?";
  return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
    "span",
    {
      title: title ?? (name2 || void 0),
      className: self ? "dwb-av dwb-av-self" : avatarClass(name2),
      style: {
        width: size,
        height: size,
        borderRadius: "50%",
        fontSize: Math.max(11, Math.round(size * 0.42)),
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        fontWeight: 600,
        flex: "none",
        userSelect: "none",
        lineHeight: 1
      },
      children: label
    }
  );
}
function escapeRegExp(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function renderMentions(text, names) {
  const str = String(text ?? "");
  if (!names || names.length === 0 || !str.includes("@")) return str;
  const sorted = [...new Set(names)].filter(Boolean).sort((a, b) => b.length - a.length).map(escapeRegExp);
  if (sorted.length === 0) return str;
  let re;
  try {
    re = new RegExp(`(^|[^\\w])@(${sorted.join("|")})(?=$|[\\s\uFF0C\u3002\uFF01\uFF1F,.!?\uFF1B;:\uFF1A])`, "g");
  } catch {
    return str;
  }
  const parts = [];
  let last = 0;
  let m;
  let key = 0;
  while ((m = re.exec(str)) !== null) {
    const start = m.index + m[1].length;
    if (start > last) parts.push(str.slice(last, start));
    parts.push(/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { className: "dwb-at", children: [
      "@",
      m[2]
    ] }, `at-${key++}`));
    last = start + 1 + m[2].length;
  }
  if (last < str.length) parts.push(str.slice(last));
  return parts;
}
var pad = (n) => String(n).padStart(2, "0");
function fmtTimeFull(ts) {
  if (!ts) return "";
  const d = new Date(ts);
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function fmtListTime(ts) {
  if (!ts) return "";
  const d = new Date(ts);
  const now = /* @__PURE__ */ new Date();
  if (d.toDateString() === now.toDateString()) return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const yest = new Date(now);
  yest.setDate(now.getDate() - 1);
  if (d.toDateString() === yest.toDateString()) return "\u6628\u5929";
  if (d.getFullYear() === now.getFullYear()) return `${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function Empty({ icon = "\u{1F5E8}", title, hint, children }) {
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dwb-empty-wrap", children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "dwb-empty-icon", children: icon }),
    title && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "dwb-empty-title", children: title }),
    hint && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "dwb-empty-hint", children: hint }),
    children
  ] });
}

// src/client/groups.jsx
var import_jsx_runtime2 = require("react/jsx-runtime");
function GroupColumn({ groups, activeId, seen, onSelect, onNew }) {
  const [q, setQ] = (0, import_react3.useState)("");
  const kw = q.trim().toLowerCase();
  const sorted = [...groups].sort((a, b) => (b.lastTime ?? 0) - (a.lastTime ?? 0));
  const filtered = kw ? sorted.filter((g) => g.name.toLowerCase().includes(kw)) : sorted;
  const hasPendingAsk = (g) => String(g.lastMessage ?? "").startsWith("\u26A0\uFE0F");
  return /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "dwb-col-list", children: [
    /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "dwb-list-head", children: [
      /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "dwb-list-title-row", children: [
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: "dwb-list-title", children: "\u6D88\u606F" }),
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { style: { flex: 1 } }),
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("button", { className: "dwb-icon-btn", title: "\u65B0\u5EFA\u7FA4\u7EC4", onClick: onNew, children: "\uFF0B" })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("input", { className: "dwb-search", placeholder: "\u641C\u7D22\u7FA4\u7EC4", value: q, onChange: (e) => setQ(e.target.value) })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "dwb-list-scroll", children: [
      filtered.length === 0 && /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { className: "dwb-list-empty", children: groups.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)(import_jsx_runtime2.Fragment, { children: [
        "\u8FD8\u6CA1\u6709\u7FA4\u7EC4",
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("br", {}),
        "\u70B9\u53F3\u4E0A\u89D2 \uFF0B \u521B\u5EFA"
      ] }) : "\u65E0\u5339\u914D\u7FA4\u7EC4" }),
      filtered.map((g) => {
        const unread = Math.max(0, (g.seq || 0) - (seen[g.id] || 0));
        return /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("button", { type: "button", className: `dwb-gitem ${g.id === activeId ? "on" : ""}`, onClick: () => onSelect(g.id), children: [
          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(Avatar, { name: g.name, size: 40 }),
          /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("span", { className: "dwb-gmid", children: [
            /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: "dwb-gname", children: g.name }),
            /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("span", { className: "dwb-gpreview", children: [
              g.lastFrom ? `${g.lastFrom}\uFF1A` : "",
              g.lastMessage || "\u6682\u65E0\u6D88\u606F"
            ] })
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("span", { className: "dwb-gright", children: [
            /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("span", { className: "dwb-gtime", children: [
              hasPendingAsk(g) ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { style: { color: "var(--dwb-amber)", fontSize: 15, marginRight: 4 }, children: "\u{1F64B}" }) : null,
              fmtListTime(g.lastTime)
            ] }),
            unread > 0 && /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: "dwb-unread", children: unread > 99 ? "99+" : unread })
          ] })
        ] }, g.id);
      })
    ] })
  ] });
}
function MemberAdminPicker({ people, members, admins, onChange }) {
  const active = people.filter((p) => p.status === "active");
  const adminId = admins[0] ?? "";
  const setAdmin = (id) => {
    const nextAdmins = id ? [id] : [];
    const nextMembers = id ? [.../* @__PURE__ */ new Set([id, ...members])] : members.filter((x) => x !== adminId);
    onChange({ members: nextMembers, admins: nextAdmins });
  };
  const toggleMember = (id) => {
    if (id === adminId) return;
    onChange({
      members: members.includes(id) ? members.filter((x) => x !== id) : [...members, id],
      admins
    });
  };
  const regulars = active.filter((p) => p.id !== adminId);
  const pickCount = members.filter((id) => id !== adminId).length;
  return /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)(import_jsx_runtime2.Fragment, { children: [
    /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "dwb-field", children: [
      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("label", { children: "\u7BA1\u7406\u5458\uFF08\u4E00\u540D \xB7 \u666E\u901A\u6D88\u606F\u5148\u6295\u9012\u7ED9\u7BA1\u7406\u5458\uFF09" }),
      /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("select", { className: "dwb-select", value: adminId, onChange: (e) => setAdmin(e.target.value), children: [
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("option", { value: "", children: "\uFF08\u672A\u9009\u62E9\uFF09" }),
        active.map((p) => /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("option", { value: p.id, children: [
          "\u{1F451} ",
          p.name
        ] }, p.id))
      ] })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "dwb-field", children: [
      /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("label", { children: [
        "\u666E\u901A\u6210\u5458\uFF08",
        pickCount,
        "\uFF09"
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "dwb-member-pick", children: [
        active.length === 0 && /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { className: "dwb-field-hint", children: "\u6682\u65E0\u53EF\u7528\u4EBA\u5458\uFF0C\u8BF7\u5148\u5230\u300C\u4EBA\u5458\u300D\u65B0\u5EFA" }),
        regulars.length === 0 && active.length > 0 && /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { className: "dwb-field-hint", children: "\u5168\u90E8\u4EBA\u5458\u90FD\u5DF2\u6210\u4E3A\u7BA1\u7406\u5458" }),
        regulars.map((p) => /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("label", { className: `dwb-pick ${members.includes(p.id) ? "on" : ""}`, children: [
          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("input", { type: "checkbox", checked: members.includes(p.id), onChange: () => toggleMember(p.id) }),
          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(Avatar, { name: p.name, size: 22 }),
          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { children: p.name })
        ] }, p.id))
      ] })
    ] })
  ] });
}
function NewGroupModal({ roles, onClose, onCreated }) {
  const [name2, setName] = (0, import_react3.useState)("");
  const [customDir, setCustomDir] = (0, import_react3.useState)("");
  const [members, setMembers] = (0, import_react3.useState)([]);
  const [admins, setAdmins] = (0, import_react3.useState)([]);
  const [notice, setNotice] = (0, import_react3.useState)("");
  const [err, setErr] = (0, import_react3.useState)(null);
  const [busy, setBusy] = (0, import_react3.useState)(false);
  const [picking, setPicking] = (0, import_react3.useState)(false);
  async function pickDir() {
    setPicking(true);
    setErr(null);
    try {
      const { path } = await call("directory.pick");
      if (path) setCustomDir(path);
    } catch (e) {
      setErr(`\u76EE\u5F55\u9009\u62E9\u5931\u8D25\uFF1A${e.message}`);
    }
    setPicking(false);
  }
  async function create() {
    if (admins.length === 0) {
      setErr("\u8BF7\u81F3\u5C11\u9009\u62E9\u4E00\u540D\u7BA1\u7406\u5458");
      return;
    }
    if (!customDir.trim()) {
      setErr("\u5FC5\u987B\u9009\u62E9\u5DE5\u4F5C\u76EE\u5F55\uFF1A\u70B9\u51FB \u{1F4C1} \u9009\u62E9\u6216\u8F93\u5165\u8DEF\u5F84");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const { group } = await call("groups.create", {
        name: name2,
        members,
        admins,
        notice,
        customDir: customDir.trim()
      });
      onCreated(group);
    } catch (e) {
      setErr(e.message);
      setBusy(false);
    }
  }
  const hasDir = customDir.trim().length > 0;
  return /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { className: "dwb-modal-mask", onClick: (e) => {
    if (e.target === e.currentTarget) onClose();
  }, children: /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "dwb-modal", children: [
    /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { className: "dwb-modal-title", children: "\u65B0\u5EFA\u7FA4\u7EC4" }),
    err && /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { className: "dwb-err", children: err }),
    /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "dwb-field", children: [
      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("label", { children: "\u7FA4\u7EC4\u540D\u79F0" }),
      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("input", { className: "dwb-input", autoFocus: true, placeholder: "\u5982 ERP\u9879\u76EE\u3001\u767B\u5F55\u7CFB\u7EDF", value: name2, onChange: (e) => setName(e.target.value) })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "dwb-field", children: [
      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("label", { children: "\u5DE5\u4F5C\u76EE\u5F55\uFF08\u5FC5\u9009\uFF09" }),
      /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { style: { display: "flex", gap: 6 }, className: "dwb-dir-row", children: [
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("input", { className: "dwb-input", placeholder: "\u70B9\u51FB \u{1F4C1} \u9009\u62E9\u76EE\u5F55\uFF0C\u6216\u8F93\u5165\u8DEF\u5F84\uFF08\u4E0D\u5B58\u5728\u4F1A\u81EA\u52A8\u521B\u5EFA\uFF09", value: customDir, onChange: (e) => setCustomDir(e.target.value) }),
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("button", { type: "button", className: "dwb-btn", disabled: picking, onClick: pickDir, title: "DSH \u539F\u751F\u76EE\u5F55\u9009\u62E9", children: picking ? "\u2026" : "\u{1F4C1}" })
      ] }),
      hasDir ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { className: "dwb-field-hint", style: { color: "var(--dwb-amber)" }, children: "\u6210\u5458\u5C06\u5728\u6B64\u76EE\u5F55\u8BFB\u53D6\u8D44\u6599/\u5B58\u653E\u6210\u679C\u7269\uFF0C\u7FA4\u9644\u4EF6\u4E5F\u5B58\u4E8E\u6B64\uFF1B\u5220\u9664\u7FA4\u7EC4\u65F6\u6B64\u76EE\u5F55\u5C06\u4FDD\u7559" }) : /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { className: "dwb-field-hint", style: { color: "var(--dwb-red)" }, children: "\u5FC5\u9009\uFF1A\u8BF7\u5148\u9009\u62E9\u5DE5\u4F5C\u76EE\u5F55\uFF0C\u5426\u5219\u65E0\u6CD5\u521B\u5EFA\u7FA4\u7EC4" })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(MemberAdminPicker, { people: roles, members, admins, onChange: ({ members: m, admins: a }) => {
      setMembers(m);
      setAdmins(a);
    } }),
    /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "dwb-field", children: [
      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("label", { children: "\u7FA4\u516C\u544A\uFF08\u53EF\u9009\uFF09" }),
      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("textarea", { className: "dwb-textarea", placeholder: "\u6BCF\u4F4D\u6210\u5458\u5728\u7FA4\u91CC\u53D1\u8A00\u524D\u90FD\u4F1A\u8BFB\u5230\u516C\u544A", value: notice, onChange: (e) => setNotice(e.target.value) })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "dwb-modal-actions", children: [
      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("button", { className: "dwb-btn", onClick: onClose, children: "\u53D6\u6D88" }),
      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("button", { className: "dwb-btn primary", disabled: !name2.trim() || !hasDir || members.length === 0 || busy, onClick: create, children: busy ? "\u521B\u5EFA\u4E2D\u2026" : "\u521B\u5EFA\u7FA4\u7EC4" })
    ] })
  ] }) });
}
function GroupEditModal({ group, roles, onClose, onSaved }) {
  const [name2, setName] = (0, import_react3.useState)(group?.name ?? "");
  const [notice, setNotice] = (0, import_react3.useState)(group?.notice ?? "");
  const [members, setMembers] = (0, import_react3.useState)(group?.members ?? []);
  const [admins, setAdmins] = (0, import_react3.useState)(group?.admins ?? []);
  const [err, setErr] = (0, import_react3.useState)(null);
  const [busy, setBusy] = (0, import_react3.useState)(false);
  async function save() {
    if (admins.length === 0) {
      setErr("\u8BF7\u81F3\u5C11\u4FDD\u7559\u4E00\u540D\u7BA1\u7406\u5458");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      await call("groups.update", { id: group.id, name: name2, notice, members, admins });
      onSaved();
    } catch (e) {
      setErr(e.message);
      setBusy(false);
    }
  }
  return /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { className: "dwb-modal-mask", onClick: (e) => {
    if (e.target === e.currentTarget) onClose();
  }, children: /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "dwb-modal", children: [
    /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "dwb-modal-title", children: [
      "\u7F16\u8F91\u7FA4\u7EC4 \xB7 ",
      group?.name
    ] }),
    err && /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { className: "dwb-err", children: err }),
    /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "dwb-field", children: [
      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("label", { children: "\u7FA4\u7EC4\u540D\u79F0" }),
      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("input", { className: "dwb-input", value: name2, onChange: (e) => setName(e.target.value) })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(MemberAdminPicker, { people: roles, members, admins, onChange: ({ members: m, admins: a }) => {
      setMembers(m);
      setAdmins(a);
    } }),
    /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "dwb-field", children: [
      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("label", { children: "\u7FA4\u516C\u544A" }),
      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("textarea", { className: "dwb-textarea", placeholder: "\u6BCF\u4F4D\u6210\u5458\u5728\u7FA4\u91CC\u53D1\u8A00\u524D\u90FD\u4F1A\u8BFB\u5230\u516C\u544A", value: notice, onChange: (e) => setNotice(e.target.value) })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "dwb-modal-actions", children: [
      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("button", { className: "dwb-btn", onClick: onClose, children: "\u53D6\u6D88" }),
      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("button", { className: "dwb-btn primary", disabled: busy, onClick: save, children: busy ? "\u4FDD\u5B58\u4E2D\u2026" : "\u4FDD\u5B58" })
    ] })
  ] }) });
}

// src/client/chat.jsx
var import_react4 = __toESM(require("react"), 1);
var import_dsh_client_ui_primitives = require("@deepseek-ai/dsh-client-ui-primitives");
var import_jsx_runtime3 = require("react/jsx-runtime");
var SYS_RE = /^(【新任务】|【任务更新】)/;
var ASK_RE = /^⚠️ 需要您的决策/;
var DONE_RE = /^✅ 任务完成/;
var PROGRESS_RE = /^📊 进度汇报/;
var GROUP_GAP_MS = 5 * 60 * 1e3;
function isSys(line) {
  return line.from == null && SYS_RE.test(String(line.text ?? ""));
}
function SysNotice({ text, names }) {
  const [open, setOpen] = (0, import_react4.useState)(false);
  const seg = String(text ?? "").split("\n");
  const head = seg[0];
  const more = seg.length > 1;
  const isTask = /^(【新任务】|【任务更新】)/.test(head);
  return /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: `dwb-sysmsg ${open ? "open" : ""} ${isTask ? "task-notice" : ""}`, children: [
    /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "dwb-sysmsg-head", onClick: () => more && setOpen((v) => !v), children: [
      isTask && /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: "dwb-sysmsg-badge", children: "\u{1F4CB}" }),
      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: "dwb-sysmsg-text", children: renderMentions(head, names) }),
      more && /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: "dwb-sys-toggle", children: open ? "\u6536\u8D77" : `\u5C55\u5F00(${seg.length - 1}\u884C)` })
    ] }),
    open && more && /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { className: "dwb-sysmsg-body", children: renderMentions(seg.slice(1).join("\n"), names) })
  ] });
}
function AskCard({ text, names, groupId, onReply }) {
  const raw = text.replace(ASK_RE, "").trim();
  const lines = raw.split("\n");
  const optLine = lines.find((l) => l.startsWith("\u53EF\u9009\u9879\uFF1A") || l.includes("\u53EF\u9009\u9879\uFF1A"));
  const question = lines.filter((l) => !l.startsWith("\u53EF\u9009\u9879\uFF1A") && !l.includes("\u53EF\u9009\u9879\uFF1A")).join("\n").trim();
  let options = [];
  if (optLine) {
    const optStr = optLine.replace(/^.*可选项：/, "").trim();
    options = optStr.split("|").map((s) => s.trim()).filter(Boolean);
  }
  const handleOptionClick = (opt) => {
    const letter = opt.match(/^([A-Z])/)?.[1] ?? opt;
    if (onReply) onReply(letter);
  };
  return /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "dwb-ask-card", children: [
    /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { className: "dwb-ask-icon", children: "\u{1F64B}" }),
    /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "dwb-ask-body", children: [
      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { className: "dwb-ask-user-tag", children: "\u{1F514} @\u4F60 \xB7 \u8BF7\u51B3\u7B56" }),
      renderMentions(question, names),
      options.length > 0 && /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { className: "dwb-ask-options", children: options.map((opt, i) => /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("button", { className: "dwb-ask-option-btn", onClick: () => handleOptionClick(opt), children: opt }, i)) })
    ] })
  ] });
}
function MessageRow({ line, prev, names, onQuickReply }) {
  const sys = isSys(line);
  const gap = !prev || !line.time || !prev.time || line.time - prev.time > GROUP_GAP_MS;
  const prevSys = prev ? isSys(prev) : false;
  const grouped = !sys && prev && !prevSys && !gap && prev.from === line.from && prev.fromName === line.fromName;
  const self = line.from == null;
  return /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)(import_react4.default.Fragment, { children: [
    gap && line.time && /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { className: "dwb-time-sep", children: fmtTimeFull(line.time) }),
    sys ? /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(SysNotice, { text: line.text, names }) : PROGRESS_RE.test(line.text) ? /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "dwb-progress-card", children: [
      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { className: "dwb-ask-icon", children: "\u{1F4CA}" }),
      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { className: "dwb-ask-body", children: renderMentions(line.text.replace(PROGRESS_RE, "").trim(), names) })
    ] }) : DONE_RE.test(line.text) ? /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "dwb-done-card", children: [
      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { className: "dwb-ask-icon", children: "\u2705" }),
      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { className: "dwb-ask-body", children: renderMentions(line.text.replace(DONE_RE, "").trim(), names) })
    ] }) : ASK_RE.test(line.text) ? /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(AskCard, { text: line.text, names, onReply: onQuickReply }) : /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: `dwb-mrow ${self ? "self" : ""} ${grouped ? "grouped" : ""}`, children: [
      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: "dwb-mavatar", children: grouped ? null : /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(Avatar, { name: self ? "\u6211" : line.fromName, self, size: 32 }) }),
      /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("span", { className: "dwb-mbody", children: [
        !grouped && !self && /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: "dwb-mname", children: line.fromName }),
        String(line.text ?? "").trim() && /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: "dwb-bubble", children: renderMentions(line.text, names) }),
        line.attachments?.length > 0 && /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: "dwb-mfiles", children: line.attachments.map((f, i) => /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("span", { className: "dwb-mfile", title: f.path ?? f.name, children: [
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(import_dsh_client_ui_primitives.FileTypeIcon, { path: f.name, size: 22 }),
          /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("span", { className: "dwb-mfile-info", children: [
            /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: "dwb-mfile-name", children: f.name }),
            /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("span", { className: "dwb-mfile-size", children: [
              (0, import_dsh_client_ui_primitives.fileSizeText)(f.size ?? 0),
              " \xB7 \u7FA4\u76EE\u5F55/",
              f.relPath ?? ""
            ] })
          ] })
        ] }, `${line.id}-f${i}`)) })
      ] })
    ] })
  ] }, line.id);
}
function WorkingIndicator({ members }) {
  const hasNames = members && members.length > 0;
  const nameStr = hasNames ? members.map((m) => m.name).join(" / ") : "\u6210\u5458";
  return /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { className: "dwb-working", children: /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "dwb-working-row", children: [
    /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("span", { className: "dwb-working-dots", children: [
      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("i", {}),
      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("i", {}),
      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("i", {})
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: "dwb-working-name", children: nameStr }),
    /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: "dwb-working-label", children: "\u6B63\u5728\u5DE5\u4F5C\u4E2D\u2026" })
  ] }) });
}
function MessageList({ lines, names, onQuickReply, approvalContent }) {
  const ref = (0, import_react4.useRef)(null);
  (0, import_react4.useEffect)(() => {
    const el = ref.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines.length]);
  return /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "dwb-msgs", ref, children: [
    lines.length === 0 && /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(Empty, { icon: "\u{1F4AC}", title: "\u6682\u65E0\u6D88\u606F", hint: "\u5728\u4E0B\u65B9\u8F93\u5165\u6846\u53D1\u8A00\uFF0C\u7528 @\u4EBA\u5458\u540D \u70B9\u540D\u6210\u5458\n\u65E0\u4EBA @ \u65F6\u6295\u9012\u5168\u4F53\u6210\u5458" }),
    approvalContent ? (0, import_react4.cloneElement)(approvalContent, { lines, renderMessage: (line, prev) => (0, import_jsx_runtime3.jsx)(MessageRow, { line, prev, names, onQuickReply }, `message:${line.id}`) }) : lines.map((line, i) => /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(MessageRow, { line, prev: i > 0 ? lines[i - 1] : null, names, onQuickReply }, line.id))
  ] });
}
var draftKey = (id) => `dwb:draft:${id}`;
function loadDraft(id) {
  if (!id) return "";
  try {
    return window.localStorage.getItem(draftKey(id)) ?? "";
  } catch {
    return "";
  }
}
function saveDraft(id, text) {
  if (!id) return;
  try {
    if (text) window.localStorage.setItem(draftKey(id), text);
    else window.localStorage.removeItem(draftKey(id));
  } catch {
  }
}
function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
    reader.onerror = () => reject(new Error(`\u8BFB\u53D6\u6587\u4EF6\u5931\u8D25\uFF1A${file.name}`));
    reader.readAsDataURL(file);
  });
}
var UPLOAD_MAX_BYTES = 10 * 1024 * 1024;
function Composer({ group, members, onSent }) {
  const gid = group?.id ?? null;
  const [text, setText] = (0, import_react4.useState)(() => loadDraft(gid));
  const [err, setErr] = (0, import_react4.useState)(null);
  const [pickerOpen, setPicker] = (0, import_react4.useState)(false);
  const [files, setFiles] = (0, import_react4.useState)([]);
  const taRef = (0, import_react4.useRef)(null);
  const fileInputRef = (0, import_react4.useRef)(null);
  const draftForRef = (0, import_react4.useRef)(gid);
  const filesRef = (0, import_react4.useRef)([]);
  filesRef.current = files;
  (0, import_react4.useEffect)(() => {
    const stale = filesRef.current.filter((f) => f.status === "ready" && f.path);
    for (const f of stale) {
      call("files.remove", { groupId: draftForRef.current, path: f.path }).catch(() => {
      });
    }
    setFiles([]);
    draftForRef.current = gid;
    setText(loadDraft(gid));
    if (taRef.current) taRef.current.style.height = "auto";
  }, [gid]);
  (0, import_react4.useEffect)(() => {
    saveDraft(draftForRef.current, text);
  }, [text]);
  function fit() {
    const el = taRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(336, el.scrollHeight)}px`;
  }
  function insertMention(name2) {
    const ta = taRef.current;
    const pos = ta && ta.selectionStart != null ? ta.selectionStart : text.length;
    const next = `${text.slice(0, pos)}@${name2} ${text.slice(ta && ta.selectionEnd != null ? ta.selectionEnd : text.length)}`;
    setText(next);
    setPicker(false);
    requestAnimationFrame(() => {
      ta?.focus();
      fit();
    });
  }
  async function onPick(e) {
    const picked = [...e.target.files ?? []];
    e.target.value = "";
    if (!group) return;
    for (const file of picked) {
      if (file.size > UPLOAD_MAX_BYTES) {
        setErr(`\u300C${file.name}\u300D\u8D85\u8FC7 10MB \u4E0A\u9650`);
        continue;
      }
      const key = `${file.name}:${file.size}:${Date.now()}:${Math.random().toString(36).slice(2, 6)}`;
      setFiles((list) => [...list, { key, name: file.name, size: file.size, status: "pending" }]);
      try {
        const base64 = await fileToBase64(file);
        const d = await call("files.upload", { groupId: group.id, name: file.name, base64 });
        setFiles((list) => list.map((x) => x.key === key ? { ...x, ...d.file, status: "ready" } : x));
      } catch (e2) {
        setFiles((list) => list.map((x) => x.key === key ? { ...x, status: "error", err: e2.message } : x));
      }
    }
  }
  async function removeFile(item) {
    if (item.status === "ready" && item.path && gid) {
      try {
        await call("files.remove", { groupId: gid, path: item.path });
      } catch {
      }
    }
    setFiles((list) => list.filter((x) => x.key !== item.key));
  }
  const readyFiles = files.filter((f) => f.status === "ready");
  const hasPending = files.some((f) => f.status === "pending");
  const canSend = Boolean(group) && (text.trim().length > 0 || readyFiles.length > 0) && !hasPending;
  async function send() {
    if (!canSend) return;
    setErr(null);
    try {
      await call("messages.post", {
        groupId: group.id,
        text,
        attachments: readyFiles.map((f) => ({ name: f.name, size: f.size, path: f.path }))
      });
      setText("");
      setFiles([]);
      if (taRef.current) taRef.current.style.height = "auto";
      onSent();
    } catch (e) {
      setErr(e.message);
    }
  }
  function onKeyDown(e) {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      send();
    }
  }
  const mentionItems = (0, import_react4.useMemo)(() => [
    { id: "dwb-mention-label", type: "label", text: "@ \u63D0\u53CA\u6210\u5458" },
    ...members.map((m) => ({ id: m.id, icon: /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(Avatar, { name: m.name, size: 20 }), label: m.name }))
  ], [members]);
  return /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "dwb-composer", children: [
    err && /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { className: "dwb-comp-notice", role: "alert", children: err }),
    /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "dwb-comp-card", children: [
      files.length > 0 && /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { className: "dwb-comp-files", children: files.map((f) => /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("span", { className: `dwb-comp-file ${f.status}`, title: f.err ?? f.path ?? f.name, children: [
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(import_dsh_client_ui_primitives.FileTypeIcon, { path: f.name, size: 16 }),
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: "dwb-comp-file-name", children: f.name }),
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: "dwb-comp-file-size", children: f.status === "pending" ? "\u4E0A\u4F20\u4E2D\u2026" : f.status === "error" ? "\u5931\u8D25" : (0, import_dsh_client_ui_primitives.fileSizeText)(f.size) }),
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
          "button",
          {
            type: "button",
            className: "dwb-comp-file-x",
            "aria-label": `\u79FB\u9664 ${f.name}`,
            onClick: () => removeFile(f),
            children: /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(import_dsh_client_ui_primitives.IconCloseOutlineRegular, { size: 12 })
          }
        )
      ] }, f.key)) }),
      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
        "textarea",
        {
          ref: taRef,
          className: "dwb-ta",
          placeholder: `\u53D1\u6D88\u606F\u5230 ${group?.name ?? "\u7FA4\u7EC4"}\u2026\uFF08\u7528 @\u4EBA\u5458\u540D \u70B9\u540D\uFF09`,
          value: text,
          rows: 1,
          onChange: (e) => {
            setText(e.target.value);
            fit();
          },
          onKeyDown
        }
      ),
      /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "dwb-comp-row", children: [
        /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "dwb-comp-tools", children: [
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(import_dsh_client_ui_primitives.Tooltip, { label: "\u6DFB\u52A0\u9644\u4EF6\uFF08\u5B58\u5165\u7FA4\u5DE5\u4F5C\u76EE\u5F55\uFF09", side: "top", delayMs: 400, children: /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
            "button",
            {
              type: "button",
              className: "dwb-comp-add",
              "aria-label": "\u6DFB\u52A0\u9644\u4EF6",
              disabled: !group,
              onClick: () => fileInputRef.current?.click(),
              children: /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(import_dsh_client_ui_primitives.IconPlusOutlineRegular, { size: 16 })
            }
          ) }),
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("input", { ref: fileInputRef, type: "file", multiple: true, hidden: true, onChange: onPick }),
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
            import_dsh_client_ui_primitives.Menu,
            {
              open: pickerOpen,
              onClose: () => setPicker(false),
              items: mentionItems,
              onSelect: (id) => {
                const m = members.find((x) => x.id === id);
                if (m) insertMention(m.name);
              },
              side: "top",
              align: "start",
              portal: true,
              dense: true,
              anchor: /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(import_dsh_client_ui_primitives.Tooltip, { label: "@ \u63D0\u53CA\u6210\u5458", side: "top", delayMs: 400, children: /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
                "button",
                {
                  type: "button",
                  className: `dwb-comp-add ${pickerOpen ? "on" : ""}`,
                  "aria-label": "@ \u63D0\u53CA\u6210\u5458",
                  "aria-haspopup": "menu",
                  "aria-expanded": pickerOpen,
                  onClick: () => setPicker((v) => !v),
                  children: /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(import_dsh_client_ui_primitives.IconUsersOutlineRegular, { size: 16 })
                }
              ) })
            }
          )
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "dwb-comp-trailing", children: [
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: "dwb-comp-hint", children: "Enter \u53D1\u9001 \xB7 Shift+Enter \u6362\u884C" }),
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(import_dsh_client_ui_primitives.Tooltip, { label: "\u53D1\u9001", side: "top", delayMs: 400, children: /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("button", { type: "button", className: "dwb-comp-send", disabled: !canSend, onClick: send, "aria-label": "\u53D1\u9001", children: /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(import_dsh_client_ui_primitives.IconSendOutlineRegular, { size: 16 }) }) })
        ] })
      ] })
    ] })
  ] });
}
function ContextPanel({ group, members }) {
  const { tasks } = useTasks(group?.id);
  return /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "dwb-ctx", children: [
    /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "dwb-ctx-sec", children: [
      /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "dwb-ctx-title", children: [
        "\u6210\u5458\uFF08",
        members.length,
        "\uFF09"
      ] }),
      members.map((m) => /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "dwb-member-row", children: [
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(Avatar, { name: m.name, size: 28 }),
        /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("span", { className: "dwb-member-name", children: [
          (group?.admins ?? []).includes(m.id) ? "\u{1F451} " : "",
          m.name
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: "dwb-dot on", title: m.status === "active" ? "\u542F\u7528" : "\u505C\u7528" })
      ] }, m.id))
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "dwb-ctx-sec", children: [
      /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "dwb-ctx-title", children: [
        "\u672C\u7FA4\u4EFB\u52A1\uFF08",
        tasks.length,
        "\uFF09"
      ] }),
      tasks.length === 0 && /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { className: "dwb-ctx-empty", children: "\u6682\u65E0\u4EFB\u52A1" }),
      tasks.map((t) => /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "dwb-ctx-task", children: [
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: `dwb-chip p-${t.priority === "\u9AD8" ? "high" : t.priority === "\u4F4E" ? "low" : "mid"}`, children: t.priority }),
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: "dwb-ctx-task-title", children: t.title }),
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: `dwb-chip st-${t.status === "\u5DF2\u5B8C\u6210" ? "done" : t.status === "\u8FDB\u884C\u4E2D" ? "doing" : "todo"}`, children: t.status })
      ] }, t.id))
    ] }),
    (group?.notice || (group?.admins ?? []).length > 0) && /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "dwb-ctx-sec", children: [
      group?.notice && /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)(import_jsx_runtime3.Fragment, { children: [
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { className: "dwb-ctx-title", children: "\u7FA4\u516C\u544A" }),
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { className: "dwb-ctx-notice", children: group.notice })
      ] }),
      (group?.admins ?? []).length > 0 && /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)(import_jsx_runtime3.Fragment, { children: [
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { className: "dwb-ctx-title", style: { marginTop: group?.notice ? 12 : 0 }, children: "\u7BA1\u7406\u5458" }),
        /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "dwb-ctx-kv", children: [
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { children: "\u{1F451}" }),
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("b", { children: (group.admins ?? []).map((id) => members.find((m) => m.id === id)?.name ?? id).join("\u3001") })
        ] })
      ] })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "dwb-ctx-sec", children: [
      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { className: "dwb-ctx-title", children: "\u7FA4\u4FE1\u606F" }),
      /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "dwb-ctx-kv", children: [
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { children: "\u7FA4\u7EC4\u540D" }),
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("b", { children: group?.name })
      ] }),
      group?.dir && /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "dwb-ctx-kv col", children: [
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { children: "\u5DE5\u4F5C\u76EE\u5F55" }),
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("b", { className: "dwb-ctx-dir", children: group.dir })
      ] })
    ] })
  ] });
}
function ChatColumn({ group, roles, showCtx, onToggleCtx, onNew, onGroupsChanged, onDeleted, useSessionStatus }) {
  const [lines, setLines] = (0, import_react4.useState)([]);
  const [err, setErr] = (0, import_react4.useState)(null);
  const [tick, setTick] = (0, import_react4.useState)(0);
  const [editOpen, setEditOpen] = (0, import_react4.useState)(false);
  const [delConfirm, setDelConfirm] = (0, import_react4.useState)(false);
  const [delBusy, setDelBusy] = (0, import_react4.useState)(false);
  const [showWorking, setShowWorking] = (0, import_react4.useState)(false);
  const [workingMembers, setWorkingMembers] = (0, import_react4.useState)([]);
  const sentAtRef = (0, import_react4.useRef)(0);
  const rolesRef = (0, import_react4.useRef)(roles);
  rolesRef.current = roles;
  (0, import_react4.useEffect)(() => {
    setEditOpen(false);
    setDelConfirm(false);
    setDelBusy(false);
    setErr(null);
    sentAtRef.current = 0;
  }, [group?.id]);
  const load = (0, import_react4.useCallback)(() => {
    if (!group) {
      setLines([]);
      setShowWorking(false);
      setWorkingMembers([]);
      return;
    }
    call("messages.transcript", { groupId: group.id }).then((d) => {
      setLines(d.lines ?? []);
      setErr(null);
      const list = d.activity ?? [];
      if (list.length > 0) {
        const rs = rolesRef.current;
        setShowWorking(true);
        setWorkingMembers(list.map((a) => ({
          roleId: a.roleId,
          name: rs.find((r) => r.id === a.roleId)?.name ?? a.roleId
        })));
      } else {
        setShowWorking(false);
        setWorkingMembers([]);
      }
    }).catch((e) => setErr(e.message));
  }, [group?.id]);
  (0, import_react4.useEffect)(() => {
    load();
    if (!group) return;
    const t = setInterval(load, 3e3);
    return () => clearInterval(t);
  }, [load, tick, group?.id]);
  const handleSent = (0, import_react4.useCallback)(() => {
    load();
    onGroupsChanged?.();
    setShowWorking(true);
    setWorkingMembers([]);
  }, [load, onGroupsChanged]);
  const handleQuickReply = (0, import_react4.useCallback)(async (letter) => {
    if (!group) return;
    try {
      await call("messages.post", { groupId: group.id, text: letter });
      handleSent();
    } catch {
    }
  }, [group?.id, handleSent]);
  async function doDelete() {
    setDelBusy(true);
    try {
      await call("groups.delete", { id: group.id });
      onGroupsChanged?.();
      onDeleted?.();
      window.setTimeout(() => {
        window.alert("\u7FA4\u7EC4\u5DF2\u5220\u9664\uFF0C\u6570\u636E\u5DF2\u5F7B\u5E95\u6E05\u9664\u3002\n\nDSH \u4FA7\u680F\u4E2D\u7684\u5DE5\u4F5C\u533A\u548C\u4F1A\u8BDD\u7F13\u5B58\u9700\u91CD\u542F DSH \u540E\u624D\u4F1A\u6D88\u5931\uFF08\u8FD9\u662F DSH \u5E73\u53F0\u7684\u663E\u793A\u7F13\u5B58\u673A\u5236\uFF0C\u4E0D\u5F71\u54CD\u6570\u636E\u5B89\u5168\uFF09\u3002");
      }, 200);
    } catch (e) {
      window.alert(e.message);
    }
    setDelBusy(false);
  }
  const members = (0, import_react4.useMemo)(
    () => (group?.members ?? []).map((id) => roles.find((r) => r.id === id)).filter(Boolean),
    [group, roles]
  );
  const names = group?.memberNames ?? [];
  if (!group) {
    return /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { className: "dwb-col-chat", children: /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(Empty, { icon: "\u{1F5C2}", title: "\u9009\u62E9\u4E00\u4E2A\u7FA4\u7EC4\u5F00\u59CB\u534F\u4F5C", hint: "\u5728\u5DE6\u4FA7\u9009\u62E9\u7FA4\u7EC4\uFF0C\u6216\u521B\u5EFA\u65B0\u7FA4\u7EC4", children: /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("button", { className: "dwb-btn primary", style: { marginTop: 12 }, onClick: onNew, children: "\uFF0B \u65B0\u5EFA\u7FA4\u7EC4" }) }) });
  }
  return /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "dwb-col-chat", children: [
    /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "dwb-chat-head", children: [
      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(Avatar, { name: group.name, size: 30 }),
      /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "dwb-chat-headmid", children: [
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { className: "dwb-chat-name", children: group.name }),
        /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "dwb-chat-sub", children: [
          members.length,
          " \u540D\u6210\u5458 \xB7 ",
          group.messageCount,
          " \u6761\u6D88\u606F"
        ] })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "dwb-avatar-stack", children: [
        members.slice(0, 5).map((m) => /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(Avatar, { name: m.name, size: 22 }, m.id)),
        members.length > 5 && /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("span", { className: "dwb-stack-more", children: [
          "+",
          members.length - 5
        ] })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("button", { type: "button", className: "dwb-icon-btn", title: "\u7F16\u8F91\u7FA4\u7EC4", onClick: () => setEditOpen(true), children: "\u270E" }),
      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("button", { type: "button", className: `dwb-icon-btn ${showCtx ? "on" : ""}`, title: "\u7FA4\u4FE1\u606F", onClick: onToggleCtx, children: "\u2630" }),
      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("button", { type: "button", className: "dwb-icon-btn", title: "\u5220\u9664\u7FA4\u7EC4", "aria-label": "\u5220\u9664\u7FA4\u7EC4", onClick: () => setDelConfirm(true), children: /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(import_dsh_client_ui_primitives.IconTrashOutlineRegular, { size: 16 }) })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "dwb-chat-body", children: [
      err && /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { className: "dwb-err", style: { margin: 12 }, children: err }),
      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(MessageList, { lines, names, onQuickReply: handleQuickReply, approvalContent: GroupApprovalPanel && useSessionStatus ? (0, import_jsx_runtime3.jsx)(GroupApprovalPanel, { groupId: group.id, useSessionStatus }, group.id) : null }),
      showCtx && /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(ContextPanel, { group, members })
    ] }),
    showWorking && /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(WorkingIndicator, { members: workingMembers }),
    /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(Composer, { group, members, onSent: handleSent }),
    editOpen && /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
      GroupEditModal,
      {
        group,
        roles,
        onClose: () => setEditOpen(false),
        onSaved: () => {
          setEditOpen(false);
          onGroupsChanged?.();
          load();
        }
      }
    ),
    delConfirm && /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { className: "dwb-modal-mask", onClick: (e) => {
      if (e.target === e.currentTarget) setDelConfirm(false);
    }, children: /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "dwb-modal", children: [
      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { className: "dwb-modal-title", children: "\u5220\u9664\u7FA4\u7EC4" }),
      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { className: "dwb-field", children: /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { style: { fontSize: 14, lineHeight: 1.8 }, children: [
        "\u786E\u5B9A\u5220\u9664\u7FA4\u7EC4\u300C",
        group.name,
        "\u300D\uFF1F",
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("br", {}),
        "\u5C06\u540C\u65F6\u5220\u9664\uFF1A",
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("br", {}),
        "\xB7 \u5DE5\u4F5C\u76EE\u5F55\u53CA\u5168\u90E8\u6587\u4EF6\uFF08",
        group.dir,
        "\uFF09",
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("br", {}),
        "\xB7 \u7FA4\u5185\u6240\u6709\u4EFB\u52A1\uFF08",
        group.seq ?? 0,
        " \u6761\u6D88\u606F\u5C06\u4E00\u5E76\u6E05\u9664\uFF09",
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("br", {}),
        "\xB7 \u8BE5\u7FA4\u7684\u5168\u90E8\u6210\u5458\u4F1A\u8BDD\u8BB0\u5F55",
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("br", {}),
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("b", { style: { color: "var(--dwb-red)" }, children: "\u6B64\u64CD\u4F5C\u4E0D\u53EF\u64A4\u9500\u3002" })
      ] }) }),
      /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "dwb-modal-actions", children: [
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("button", { className: "dwb-btn", onClick: () => setDelConfirm(false), children: "\u53D6\u6D88" }),
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("button", { className: "dwb-btn danger", disabled: delBusy, onClick: doDelete, children: delBusy ? "\u5220\u9664\u4E2D\u2026" : "\u786E\u8BA4\u5220\u9664" })
      ] })
    ] }) })
  ] });
}

// src/client/roles.jsx
var import_react5 = __toESM(require("react"), 1);
var import_jsx_runtime4 = require("react/jsx-runtime");
function NewRoleModal({ onClose, onCreated }) {
  const { models, defaultModel } = useModels();
  const [name2, setName] = (0, import_react5.useState)("");
  const [instructions, setInstructions] = (0, import_react5.useState)("");
  const [model, setModel] = (0, import_react5.useState)("");
  const [err, setErr] = (0, import_react5.useState)(null);
  const [busy, setBusy] = (0, import_react5.useState)(false);
  async function create() {
    setBusy(true);
    setErr(null);
    try {
      await call("roles.create", { name: name2, instructions, model: model || void 0 });
      onCreated();
    } catch (e) {
      setErr(e.message);
      setBusy(false);
    }
  }
  return /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("div", { className: "dwb-modal-mask", onClick: (e) => {
    if (e.target === e.currentTarget) onClose();
  }, children: /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { className: "dwb-modal", children: [
    /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("div", { className: "dwb-modal-title", children: "\u65B0\u5EFA\u4EBA\u5458" }),
    err && /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("div", { className: "dwb-err", children: err }),
    /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { className: "dwb-field", children: [
      /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("label", { children: "\u4EBA\u5458\u540D" }),
      /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("input", { className: "dwb-input", autoFocus: true, placeholder: "\u5982 \u5DE5\u7A0B\u5E08A\u3001\u6D4B\u8BD5\u7532", value: name2, onChange: (e) => setName(e.target.value) })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { className: "dwb-field", children: [
      /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("label", { children: "\u804C\u8D23\u63CF\u8FF0" }),
      /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("textarea", { className: "dwb-textarea", placeholder: "\u8BE5\u4EBA\u5458\u8D1F\u8D23\u4EC0\u4E48\uFF08\u5982\u9700\u5B9A\u4E49\u804C\u8D23\uFF0C\u76F4\u63A5\u5728\u6B64\u63CF\u8FF0\uFF09", value: instructions, onChange: (e) => setInstructions(e.target.value) })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { className: "dwb-field", children: [
      /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("label", { children: [
        "\u6A21\u578B",
        defaultModel ? "\uFF08\u9ED8\u8BA4 " + defaultModel + "\uFF09" : ""
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("select", { className: "dwb-select", value: model, onChange: (e) => setModel(e.target.value), children: [
        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("option", { value: "", children: "\u7CFB\u7EDF\u9ED8\u8BA4" }),
        models.map((m) => /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("option", { value: m.id, children: m.label }, m.id))
      ] })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { className: "dwb-modal-actions", children: [
      /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("button", { className: "dwb-btn", onClick: onClose, children: "\u53D6\u6D88" }),
      /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("button", { className: "dwb-btn primary", disabled: !name2.trim() || busy, onClick: create, children: busy ? "\u521B\u5EFA\u4E2D\u2026" : "\u521B\u5EFA" })
    ] })
  ] }) });
}
function RolesView({ roles, groups, reload }) {
  const [sel, setSel] = (0, import_react5.useState)(null);
  const [newOpen, setNewOpen] = (0, import_react5.useState)(false);
  const selected = roles.find((r) => r.id === sel) ?? null;
  return /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)(import_jsx_runtime4.Fragment, { children: [
    /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { className: "dwb-col-list", children: [
      /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("div", { className: "dwb-list-head", children: /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { className: "dwb-list-title-row", children: [
        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("span", { className: "dwb-list-title", children: "\u4EBA\u5458" }),
        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("span", { style: { flex: 1 } }),
        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("button", { className: "dwb-icon-btn", title: "\u65B0\u5EFA\u4EBA\u5458", onClick: () => setNewOpen(true), children: "\uFF0B" })
      ] }) }),
      /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { className: "dwb-list-scroll", children: [
        /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { className: "dwb-org-sec", children: [
          /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { className: "dwb-org-sec-title", children: [
            "\u5168\u90E8\u4EBA\u5458\uFF08",
            roles.length,
            "\uFF09"
          ] }),
          roles.map((r) => /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("button", { type: "button", className: `dwb-gitem sm ${sel === r.id ? "on" : ""}`, onClick: () => setSel(r.id), children: [
            /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(Avatar, { name: r.name, size: 30 }),
            /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("span", { className: "dwb-gmid", children: /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("span", { className: "dwb-gname", children: r.name }) }),
            /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("span", { className: `dwb-dot ${r.status === "active" ? "on" : ""}` })
          ] }, r.id))
        ] }),
        roles.length === 0 && /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { className: "dwb-list-empty", children: [
          "\u6682\u65E0\u4EBA\u5458",
          /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("br", {}),
          "\u70B9\u4E0A\u65B9 \uFF0B \u65B0\u5EFA"
        ] })
      ] })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("div", { className: "dwb-col-manage", children: selected ? /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(
      PersonDetail,
      {
        person: selected,
        groupCount: groups.filter((g) => (g.members ?? []).includes(selected.id)).length,
        onChanged: reload,
        onDeleted: () => {
          setSel(null);
          reload();
        }
      },
      selected.id
    ) : /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(Empty, { icon: "\u{1F465}", title: "\u4ECE\u5DE6\u4FA7\u9009\u62E9\u4E00\u540D\u4EBA\u5458", hint: roles.length === 0 ? "\u6682\u65E0\u4EBA\u5458\uFF0C\u70B9\u5DE6\u4E0A\u89D2 \uFF0B \u65B0\u5EFA" : "\u70B9\u51FB\u5DE6\u4FA7\u4EBA\u5458\u67E5\u770B\u8BE6\u60C5\uFF0C\u652F\u6301\u7F16\u8F91\u3001\u505C\u7528\u548C\u5220\u9664" }) }),
    newOpen && /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(NewRoleModal, { onClose: () => setNewOpen(false), onCreated: () => {
      setNewOpen(false);
      reload();
    } })
  ] });
}
function PersonDetail({ person, groupCount, onChanged, onDeleted }) {
  const [editing, setEditing] = (0, import_react5.useState)(false);
  const [confirmDel, setConfirmDel] = (0, import_react5.useState)(false);
  const [name2, setName] = (0, import_react5.useState)(person.name);
  const [instructions, setInstructions] = (0, import_react5.useState)(person.instructions ?? "");
  const [model, setModel] = (0, import_react5.useState)(person.model ?? "");
  const [err, setErr] = (0, import_react5.useState)(null);
  const [busy, setBusy] = (0, import_react5.useState)(false);
  const { models } = useModels();
  function startEdit() {
    setName(person.name);
    setInstructions(person.instructions ?? "");
    setModel(person.model ?? "");
    setErr(null);
    setConfirmDel(false);
    setEditing(true);
  }
  async function save() {
    setBusy(true);
    setErr(null);
    const patch = {};
    if (name2.trim() && name2 !== person.name) patch.name = name2.trim();
    if (instructions !== (person.instructions ?? "")) patch.instructions = instructions;
    if (model !== (person.model ?? "")) patch.model = model || null;
    if (Object.keys(patch).length === 0) {
      setEditing(false);
      setBusy(false);
      return;
    }
    try {
      await call("roles.update", { id: person.id, patch });
      setEditing(false);
      onChanged();
    } catch (e) {
      setErr(e.message);
    }
    setBusy(false);
  }
  async function toggleStatus() {
    setErr(null);
    try {
      await call("roles.setStatus", { id: person.id, status: person.status === "active" ? "disabled" : "active" });
      onChanged();
    } catch (e) {
      setErr(e.message);
    }
  }
  async function remove() {
    setBusy(true);
    setErr(null);
    try {
      await call("roles.delete", { id: person.id, force: true });
      onDeleted();
    } catch (e) {
      setErr(e.message);
      setBusy(false);
      setConfirmDel(false);
    }
  }
  return /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { className: "dwb-person-detail", children: [
    /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { className: "dwb-pd-head", children: [
      /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(Avatar, { name: person.name, size: 64 }),
      /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { className: "dwb-pd-mid", children: [
        editing ? /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("input", { className: "dwb-input dwb-pd-name-input", value: name2, onChange: (e) => setName(e.target.value) }) : /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("div", { className: "dwb-pd-name", children: person.name }),
        /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { className: "dwb-pd-sub", children: [
          person.status === "active" ? "\u542F\u7528\u4E2D" : "\u5DF2\u505C\u7528",
          " \xB7 ",
          groupCount,
          " \u4E2A\u7FA4\u7EC4"
        ] })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("span", { className: `dwb-dot ${person.status === "active" ? "on" : ""}`, style: { width: 10, height: 10 } })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { className: "dwb-pd-meta", children: [
      /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { className: "dwb-pd-meta-item", children: [
        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("span", { children: "\u72B6\u6001" }),
        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("b", { children: person.status === "active" ? "\u542F\u7528" : "\u505C\u7528" })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { className: "dwb-pd-meta-item", children: [
        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("span", { children: "\u7FA4\u7EC4" }),
        /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("b", { children: [
          groupCount,
          " \u4E2A"
        ] })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { className: "dwb-pd-meta-item", children: [
        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("span", { children: "\u6A21\u578B" }),
        editing ? /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("select", { className: "dwb-select", value: model, onChange: (e) => setModel(e.target.value), children: [
          /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("option", { value: "", children: "\u7CFB\u7EDF\u9ED8\u8BA4" }),
          models.map((m) => /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("option", { value: m.id, children: m.label }, m.id))
        ] }) : /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("b", { className: "dwb-pd-model", children: person.model || "\u7CFB\u7EDF\u9ED8\u8BA4" })
      ] })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { className: "dwb-pd-duty", children: [
      /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { className: "dwb-ctx-title", children: [
        "\u804C\u8D23\u63CF\u8FF0",
        editing ? "\uFF08\u7F16\u8F91\u4E2D\uFF09" : ""
      ] }),
      editing ? /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(
        "textarea",
        {
          className: "dwb-textarea dwb-pd-duty-edit",
          value: instructions,
          placeholder: "\u8BE5\u4EBA\u5458\u8D1F\u8D23\u4EC0\u4E48\uFF08\u4F5C\u4E3A\u5E38\u9A7B\u6307\u4EE4\u6CE8\u5165\uFF09",
          onChange: (e) => setInstructions(e.target.value)
        }
      ) : /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("div", { className: "dwb-pd-duty-text", children: person.instructions || "\uFF08\u672A\u6307\u5B9A\u804C\u8D23\uFF0C\u6309\u7FA4\u7EC4\u5B89\u6392\u5DE5\u4F5C\uFF09" })
    ] }),
    err && /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("div", { className: "dwb-err", style: { margin: "0 0 10px" }, children: err }),
    /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("div", { className: "dwb-pd-actions", children: editing ? /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)(import_jsx_runtime4.Fragment, { children: [
      /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("button", { className: "dwb-btn primary", disabled: busy, onClick: save, children: busy ? "\u4FDD\u5B58\u4E2D\u2026" : "\u4FDD\u5B58" }),
      /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("button", { className: "dwb-btn", disabled: busy, onClick: () => {
        setEditing(false);
        setErr(null);
      }, children: "\u53D6\u6D88" })
    ] }) : confirmDel ? /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)(import_jsx_runtime4.Fragment, { children: [
      /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("span", { className: "dwb-pd-confirm-text", children: [
        "\u5220\u9664\u300C",
        person.name,
        "\u300D\u5E76\u79FB\u9664\u5176\u7FA4\u7EC4/\u4EFB\u52A1\u5F15\u7528\uFF1F"
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("span", { style: { flex: 1 } }),
      /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("button", { className: "dwb-btn danger", disabled: busy, onClick: remove, children: busy ? "\u5220\u9664\u4E2D\u2026" : "\u786E\u8BA4\u5220\u9664" }),
      /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("button", { className: "dwb-btn", disabled: busy, onClick: () => setConfirmDel(false), children: "\u53D6\u6D88" })
    ] }) : /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)(import_jsx_runtime4.Fragment, { children: [
      /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("button", { className: "dwb-btn", onClick: startEdit, children: "\u7F16\u8F91" }),
      /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("button", { className: "dwb-btn", onClick: toggleStatus, children: person.status === "active" ? "\u505C\u7528" : "\u542F\u7528" }),
      /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("span", { style: { flex: 1 } }),
      /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("button", { className: "dwb-btn danger", onClick: () => setConfirmDel(true), children: "\u5220\u9664" })
    ] }) })
  ] });
}

// src/client/tasks.jsx
var import_react6 = __toESM(require("react"), 1);
var import_jsx_runtime5 = require("react/jsx-runtime");
function TasksView({ groups, roles }) {
  const [statusF, setStatusF] = import_react6.default.useState("\u5168\u90E8");
  const [groupF, setGroupF] = import_react6.default.useState("\u5168\u90E8");
  const { tasks } = useTasks(groupF === "\u5168\u90E8" ? null : groupF);
  const filtered = statusF === "\u5168\u90E8" ? tasks : tasks.filter((t) => t.status === statusF);
  const filterBtn = (label, on, onClick) => /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("button", { type: "button", className: `dwb-filter ${on ? "on" : ""}`, onClick, children: label }, label);
  return /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)(import_jsx_runtime5.Fragment, { children: [
    /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("div", { className: "dwb-col-list", children: [
      /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("div", { className: "dwb-list-head", children: /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("div", { className: "dwb-list-title-row", children: /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("span", { className: "dwb-list-title", children: "\u4EFB\u52A1" }) }) }),
      /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("div", { className: "dwb-list-scroll", children: [
        /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("div", { className: "dwb-org-sec", children: [
          /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("div", { className: "dwb-org-sec-title", children: "\u72B6\u6001" }),
          /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("div", { className: "dwb-filters", children: ["\u5168\u90E8", "\u5F85\u529E", "\u8FDB\u884C\u4E2D", "\u5DF2\u5B8C\u6210"].map((s) => filterBtn(s, statusF === s, () => setStatusF(s))) })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("div", { className: "dwb-org-sec", children: [
          /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("div", { className: "dwb-org-sec-title", children: "\u7FA4\u7EC4" }),
          /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("div", { className: "dwb-filters col", children: [
            filterBtn("\u5168\u90E8\u7FA4\u7EC4", groupF === "\u5168\u90E8", () => setGroupF("\u5168\u90E8")),
            groups.map((g) => filterBtn(g.name, groupF === g.id, () => setGroupF(g.id)))
          ] })
        ] })
      ] })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("div", { className: "dwb-col-manage", children: [
      /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("div", { className: "dwb-manage-head", children: [
        /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("span", { className: "dwb-manage-title", children: "\u4EFB\u52A1\u5217\u8868" }),
        /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("span", { className: "dwb-manage-sub", children: [
          filtered.length,
          " \u4E2A\u4EFB\u52A1 \xB7 \u7531\u6210\u5458\u5728\u7FA4\u804A\u4E2D\u521B\u5EFA\u4E0E\u5206\u6D3E"
        ] })
      ] }),
      filtered.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("div", { className: "dwb-manage-empty", children: /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(Empty, { icon: "\u{1F4CB}", title: "\u6682\u65E0\u4EFB\u52A1", hint: "\u4EFB\u52A1\u7684\u521B\u5EFA\u4E0E\u5206\u6D3E\u7531\u6210\u5458\u5728\u7FA4\u804A\u4E2D\u5B8C\u6210\n\u53EF\u5728\u7FA4\u804A\u4E2D @\u6210\u5458 \u5B89\u6392\u5DE5\u4F5C" }) }) : /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("div", { className: "dwb-cards", children: filtered.map((t) => /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("div", { className: `dwb-card tall ${t.status === "\u5DF2\u5B8C\u6210" ? "off" : ""}`, children: [
        /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("div", { className: "dwb-card-head", children: [
          /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("span", { className: `dwb-chip p-${t.priority === "\u9AD8" ? "high" : t.priority === "\u4F4E" ? "low" : "mid"}`, children: t.priority }),
          /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("span", { className: `dwb-chip st-${t.status === "\u5DF2\u5B8C\u6210" ? "done" : t.status === "\u8FDB\u884C\u4E2D" ? "doing" : "todo"}`, children: t.status }),
          /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("span", { className: "dwb-card-title", children: t.title })
        ] }),
        t.description && /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("div", { className: "dwb-card-desc", children: t.description }),
        /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("div", { className: "dwb-card-foot", children: [
          /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("span", { className: "dwb-card-assignees", children: [
            (t.assignees ?? []).map((id) => {
              const r = roles.find((x) => x.id === id);
              return r ? /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(Avatar, { name: r.name, size: 20, title: r.name }, id) : null;
            }),
            /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("span", { className: "dwb-card-sub", children: t.assigneeNames?.join("\u3001") })
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("span", { className: "dwb-card-sub", children: t.groupName })
        ] })
      ] }, t.id)) })
    ] })
  ] });
}

// src/client/app.jsx
var import_jsx_runtime6 = require("react/jsx-runtime");
var injected = false;
function injectStyles() {
  if (injected) return;
  injected = true;
  const style = document.createElement("style");
  style.textContent = CSS;
  style.id = "dwb-styles";
  document.head.appendChild(style);
}
let workbenchTitle = () => "\u534F\u4F5C\u5DE5\u4F5C\u53F0";
function Rail({ view, onNav, updates }) {
  const item = (id, icon, label) => /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("button", { type: "button", className: `dwb-rail-item ${view === id ? "on" : ""}`, onClick: () => onNav(id), title: label, children: [
    /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("span", { className: "dwb-rail-icon", "aria-hidden": true, children: icon }),
    /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("span", { className: "dwb-rail-label", children: label })
  ] }, id);
  return /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("div", { className: "dwb-rail", children: [
    /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("div", { className: "dwb-rail-logo", title: workbenchTitle(), children: /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(import_dsh_client_ui_primitives2.IconUsersOutlineRegular, { size: 22 }) }),
    item("chat", "\u{1F4AC}", "\u6D88\u606F"),
    item("tasks", "\u{1F4CB}", "\u4EFB\u52A1"),
    item("org", "\u{1F465}", "\u4EBA\u5458"),
    /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("div", { style: { marginTop: "auto", display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }, children: [
      updates.status.available && /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(WorkbenchUpdateUI.UpdateCloud, { onClick: () => onNav("about") }),
      item("about", "\u24D8", WorkbenchUpdateUI.t("about"))
    ] })
  ] });
}
function WorkbenchView({ initialView = "chat", useSessionStatus }) {
  const [view, setView] = (0, import_react7.useState)(initialView);
  const updates = WorkbenchUpdateUI.useUpdates();
  const [activeGroupId, setActiveGroupId] = (0, import_react7.useState)(null);
  const [showCtx, setShowCtx] = (0, import_react7.useState)(false);
  const [newGroupOpen, setNewGroupOpen] = (0, import_react7.useState)(false);
  const g = useGroups();
  const r = useRoles();
  const [seen, markSeen] = useSeen();
  const activeGroup = g.groups.find((x) => x.id === activeGroupId) ?? null;
  (0, import_react7.useEffect)(() => {
    if (activeGroup) markSeen(activeGroup.id, activeGroup.seq || 0);
  }, [activeGroup?.id, activeGroup?.seq, markSeen]);
  return /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("div", { className: "dwb-app", children: [
    /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(Rail, { view, onNav: setView, updates }),
    view === "chat" && /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)(import_jsx_runtime6.Fragment, { children: [
      /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(
        GroupColumn,
        {
          groups: g.groups,
          activeId: activeGroupId,
          seen,
          onSelect: setActiveGroupId,
          onNew: () => setNewGroupOpen(true)
        }
      ),
      /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(
        ChatColumn,
        {
          group: activeGroup,
          useSessionStatus,
          roles: r.roles,
          showCtx,
          onToggleCtx: () => setShowCtx((v) => !v),
          onNew: () => setNewGroupOpen(true),
          onGroupsChanged: g.reload,
          onDeleted: () => setActiveGroupId(null)
        },
        activeGroup?.id ?? "none"
      ),
      newGroupOpen && /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(
        NewGroupModal,
        {
          roles: r.roles,
          onClose: () => setNewGroupOpen(false),
          onCreated: (grp) => {
            setNewGroupOpen(false);
            g.reload();
            setActiveGroupId(grp?.id ?? null);
          }
        }
      )
    ] }),
    view === "org" && /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(RolesView, { roles: r.roles, groups: g.groups, reload: r.reload }),
    view === "tasks" && /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(TasksView, { groups: g.groups, roles: r.roles }),
    view === "about" && /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(WorkbenchUpdateUI.UpdateAbout, { ...updates })
  ] });
}

// src/client/icon.jsx
var import_dsh_client_ui_primitives3 = require("@deepseek-ai/dsh-client-ui-primitives");
var import_jsx_runtime7 = require("react/jsx-runtime");
function WorkbenchIcon({ size = 18 }) {
  return /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(import_dsh_client_ui_primitives3.IconUsersOutlineRegular, { size });
}

// src/client/main.jsx
var name = "dsh-collab-workbench/client";
var GroupApprovalPanel;
var WorkbenchUpdateUI;
var inject = ["slots", "layout", "sessions", "locale", "uiWorkspace"];
function apply(ctx) {
  const titleNamespace = "dsh-collab-workbench-display";
  const titleDisposers = [
    ctx.locale.register(titleNamespace, "en", { title: "Collaboration Workbench" }),
    ctx.locale.register(titleNamespace, "zh", { title: "\u534F\u4F5C\u5DE5\u4F5C\u53F0" }),
    ctx.locale.register(titleNamespace, "zh-CN", { title: "\u534F\u4F5C\u5DE5\u4F5C\u53F0" })
  ];
  const translateTitle = ctx.locale.bind(titleNamespace);
  workbenchTitle = () => translateTitle("title");
  ctx.effect(() => () => {
    workbenchTitle = () => "\u534F\u4F5C\u5DE5\u4F5C\u53F0";
    for (const dispose of titleDisposers.reverse()) dispose();
  }, "collaboration workbench: localized title");
  GroupApprovalPanel = createApprovalUI(require("react"), ctx, call);
  WorkbenchUpdateUI = createUpdateUI(require("react"), ctx, call);
  injectStyles();
  window.dwbBack = () => {
    try {
      ctx.layout?.selectPanel("conversation");
    } catch {
    }
  };
  ctx.effect(() => {
    return () => {
      delete window.dwbBack;
    };
  }, "dsh-workbench: back handler");
  ctx.slots.inject("main", () => ctx.slots.register({
    name: "main",
    key: "workbench"
  }, WorkbenchView));
  ctx.slots.inject("sidebar.panellist", () => ctx.slots.register({
    name: "sidebar.panellist",
    id: "workbench",
    order: -100,
    label: () => workbenchTitle()
  }, WorkbenchIcon));
}

return module.exports;
  },
});
