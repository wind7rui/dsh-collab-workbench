import { z } from 'zod'
import { APPROVAL_KEY, emptyApprovals, foldApprovals, approvalDisplayItems } from './approvals-fold.js'

export function install(rt) {
  const item = z.object({id:z.string(), toolName:z.string(), callId:z.string(), reason:z.string(), command:z.string(), permission:z.string(), askedAt:z.number(), outcome:z.string(), decidedAt:z.number().optional()})
  const viewSchema = z.array(item)
  rt.ctx.sessionProjections.register({key:APPROVAL_KEY, stateVersion:1,
    stateSchema:z.object({calls:z.array(z.object({id:z.string(),name:z.string(),arguments:z.string()})),approvals:viewSchema}),
    init:emptyApprovals, apply:foldApprovals, wire:{viewSchema,view:state=>state.approvals}})

  const owners = group => {
    const map = new Map()
    for (const [roleId, entry] of Object.entries(group.sessions ?? {})) if (entry.id) map.set(entry.id,{roleId})
    for (const run of rt.executionRuns?.() ?? []) if (run.groupId === group.id && run.sessionId) map.set(run.sessionId,{roleId:run.roleId,taskId:run.taskId,runId:run.id})
    return map
  }
  // Read-only UI data. Approval is answered ONLY by the original Client interaction.
  rt.groupApprovals = async groupId => {
    const group = rt.getGroup(groupId)
    if (!group || group.status !== 'active') throw new Error('群组不存在或不可用')
    const items = [], sessions = [], errors = []
    for (const [sessionId, owner] of owners(group)) {
      try {
        const projection = await rt.ctx.sessionController.projections({sessionId}, AbortSignal.timeout(5000))
        const approvals = projection?.values?.[APPROVAL_KEY] ?? []
        const run = owner.runId ? rt.executionRuns?.().find(r=>r.id===owner.runId) : null
        const live = rt.ctx.get?.('agents')?.get(sessionId)
        const pending = approvals.some(a=>a.outcome==='pending')
        if (pending || live?.status === 'running' || (run && ['starting','running','approval-wait'].includes(run.status))) sessions.push(sessionId)
        for (const approval of approvals) items.push({...approval, ...owner, sessionId, roleName:rt.getRole(owner.roleId)?.name ?? owner.roleId,
          live:!!live && pending, taskTitle:owner.taskId ? rt.getTask(owner.taskId)?.title ?? owner.taskId : ''})
      } catch(error) {errors.push({sessionId,error:String(error?.message??error)})}
    }
    return {items:approvalDisplayItems(items), sessions:[...new Set(sessions)], errors}
  }
}
