import * as fs from 'node:fs/promises'
import {join, resolve, isAbsolute} from 'node:path'
import {randomUUID} from 'node:crypto'

const START='<!-- dsh-workbench:managed:start -->'
const END='<!-- dsh-workbench:managed:end -->'
const generation=(task,runs)=>Math.max(1,task.generation??1,...runs.filter(r=>r.taskId===task.id).map(r=>r.generation??1))
export function snapshotSignature(tasks, runs=[]) {
  return JSON.stringify(tasks.map(t=>({id:t.id,revision:t.revision??1,status:t.status,generation:generation(t,runs)})).sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0))
}
const pick=(value,keys)=>Object.fromEntries(keys.filter(k=>value[k]!==undefined).map(k=>[k,value[k]]))
function projection(group,tasks,runs) {
  const current=tasks.flatMap(t=>{
    const latest=new Map()
    for(const r of runs.filter(r=>r.taskId===t.id && (r.generation??1)===generation(t,runs) && (!t.assignees || t.assignees.includes(r.roleId)))) latest.set(r.roleId,r)
    return [...latest.values()]
  })
  const signature=snapshotSignature(tasks,runs)
  const blocked=!!group.pendingDecision || current.some(r=>['failed','blocked','paused','cancelled'].includes(r.status)||r.attention||r.error)
  const done=tasks.length>0 && tasks.every(t=>t.status==='已完成')
  const delivered=done && group.delivery?.status==='delivered' && group.delivery.signature===signature
  return {version:1,groupId:group.id,signature,state:blocked?'BLOCKED':done?(delivered?'COMPLETE':'DELIVERY'):'IMPLEMENTATION',
    tasks:tasks.slice().sort((a,b)=>a.id.localeCompare(b.id)).map(t=>({...pick(t,['id','title','revision','status','executionSummary']),generation:generation(t,runs)})),
    runs:current.map(r=>pick(r,['id','taskId','roleId','generation','status','summary','error','attention','evidence'])).sort((a,b)=>a.id.localeCompare(b.id)),
    evidence:current.filter(r=>r.evidence?.length).map(r=>({runId:r.id,taskId:r.taskId,evidence:r.evidence})),
    handoffs:current.filter(r=>r.summary).map(r=>({runId:r.id,taskId:r.taskId,status:r.status,summary:r.summary})),
    delivery:group.delivery?pick(group.delivery,['signature','status','notifiedAt','summary']):null}
}
function homepage(raw,item,p) {
  const block=`${START}\n## 工作台派生状态\n\n状态：${p.state}\n\n${p.tasks.map(t=>`- ${t.id}：${t.status} — ${String(t.title??'').replace(/\n/g,' ')}`).join('\n')}\n\n证据与执行摘要：见 [work_item.json](./work_item.json) 的 workbench_projection。\n${END}`
  const start=raw.indexOf(START),end=raw.indexOf(END)
  if(start!==-1 || end!==-1) {
    if(start===-1 || end<start || raw.indexOf(START,start+START.length)!==-1 || raw.indexOf(END,end+END.length)!==-1) throw new Error('首页 managed 标记损坏，拒绝覆盖')
    return raw.slice(0,start)+block+raw.slice(end+END.length)
  }
  const initial=`# ${item.work_item_id} / ${item.title}\n\n状态：接收中，尚无角色调用或业务批准。\n\n协调员请在实际执行后更新：重要变化、待决入口、未验证、已完成、可以继续与证据。\n`
  // Only the exact known initializer is disposable; other prose is human-owned.
  const base=raw===initial?`# ${item.work_item_id} / ${item.title}\n`:raw
  return base+(base.endsWith('\n')?'\n':'\n\n')+block+'\n'
}

export function install(rt) {
  const io={...fs,...rt.config?.workItemSyncIO}
  const retryAt=new Map()
  let tail=Promise.resolve()
  async function read(path,optional=false) {
    try { if((await io.lstat(path)).isSymbolicLink()) throw new Error(`拒绝符号链接：${path}`);return await io.readFile(path,'utf8') }
    catch(error) {if(optional && error.code==='ENOENT') return '';throw error}
  }
  async function atomic(path,before,after,optional=false) {
    if(before===after) return
    const tmp=`${path}.${process.pid}.${randomUUID()}.tmp`
    try {
      await io.writeFile(tmp,after,{encoding:'utf8',flag:'wx'})
      if(await read(path,optional)!==before) throw new Error(`并发修改冲突：${path}`)
      await io.rename(tmp,path)
    } finally {await io.unlink(tmp).catch(()=>{})}
  }
  async function status(group,next) {
    if(JSON.stringify(group.workItemSync)===JSON.stringify(next)) return
    group.workItemSync=next
    rt.touch?.()
    await rt.saveAll?.()
  }
  async function sync() {
    for(const group of rt.listGroups()) {
      if(!group.dir || !isAbsolute(group.dir) || (retryAt.get(group.id)??0)>Date.now()) continue
      try {
        const root=join(group.dir,'.sopai','runs')
        let dirs
        try {dirs=await io.readdir(root,{withFileTypes:true})} catch(error) {if(error.code==='ENOENT') continue;throw error}
        if((await io.realpath(root))!==join(await io.realpath(group.dir),'.sopai','runs')) throw new Error('SOPAI运行目录含符号链接')
        const candidates=[]
        for(const dir of dirs) {
          if(!dir.isDirectory()) continue
          const path=join(root,dir.name,'work_item.json')
          let raw
          try {raw=await read(path)} catch(error) {if(error.code==='ENOENT') continue;throw error}
          const item=JSON.parse(raw)
          if(typeof item.project==='string' && isAbsolute(item.project) && resolve(item.project)===resolve(group.dir) && item.work_item_id===dir.name) candidates.push({path,raw,item,dir:join(root,dir.name)})
        }
        if(candidates.length>1) throw new Error(`多个匹配SOPAI工作项（${candidates.length}），拒绝猜测`)
        if(!candidates.length) {await status(group,{status:'unmatched'});continue}
        const c=candidates[0], tasks=rt.listTasks().filter(t=>t.groupId===group.id),runs=rt.state.execution?.runs??[]
        const p=projection(group,tasks,runs)
        const page=join(c.dir,'复核首页.md'),oldPage=await read(page,true),newPage=homepage(oldPage,c.item,p)
        const next=JSON.stringify({...c.item,state:p.state,workbench_projection:p},null,2)+'\n'
        // Preflight both inputs before either write; each rename repeats its own check.
        if(await read(c.path)!==c.raw || await read(page,true)!==oldPage) throw new Error('并发修改冲突：SOPAI投影输入已变化')
        await atomic(c.path,c.raw,next)
        await atomic(page,oldPage,newPage,true)
        retryAt.delete(group.id)
        await status(group,{status:'synced',workItemId:c.item.work_item_id,path:c.path,signature:p.signature})
      } catch(error) {
        retryAt.set(group.id,Date.now()+(rt.config?.workItemSyncRetryMs??30000))
        await status(group,{status:'error',error:String(error?.message??error)})
      }
    }
  }
  rt.syncWorkItems=()=>{const result=tail.then(sync);tail=result.catch(()=>{});return result}
}
