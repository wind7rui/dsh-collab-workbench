import { snapshotSignature } from './work-item-sync.js'

/** Durable review handoffs; execution completion never implies user delivery. */
export function install(rt) {
  let tail = Promise.resolve()
  const mutations = new Map()
  const mutate = (groupId, operation) => {
    const previous = mutations.get(groupId) ?? Promise.resolve()
    const result = previous.catch(() => {}).then(operation)
    const settled = result.catch(() => {})
    mutations.set(groupId, settled)
    settled.finally(() => { if (mutations.get(groupId) === settled) mutations.delete(groupId) })
    return result
  }
  // Final notification and scope changes share one project commit boundary.
  const createTask = rt.createTask, updateTask = rt.updateTask
  rt.createTask = args => mutate(args.groupId, () => createTask(args))
  rt.updateTask = (id, patch, options) => mutate(rt.getTask(id)?.groupId ?? id, () => updateTask(id, patch, options))
  const tasksFor = group => rt.listTasks().filter(t => t.groupId === group.id)
  const runsFor = group => (rt.executionRuns?.() ?? []).filter(r => r.groupId === group.id)
  const signatureFor = group => snapshotSignature(tasksFor(group), runsFor(group))
  const save = async () => { rt.touch(); await rt.saveAll() }
  const outside = fn => {
    const agents = rt.ctx.get?.('agents')
    return agents?.withoutInitiator ? agents.withoutInitiator(fn) : fn()
  }
  const process = async ({ deliver = true } = {}) => {
    const outbox = (rt.state.execution.reviewOutbox ??= [])
    let changed = false
    for (const group of rt.listGroups().filter(g => g.status === 'active')) {
      const tasks = tasksFor(group), signature = signatureFor(group)
      const complete = tasks.length > 0 && tasks.every(t => t.status === '已完成')
      const previous = group.delivery
      if (!previous || previous.signature !== signature) {
        group.delivery = { signature, status: complete ? 'awaiting-review' : 'in-progress', updatedAt: Date.now() }
        changed = true
        // Initial recovery records historical facts without unexpectedly waking old projects.
        if (complete && previous) {
          const id = `review:${group.id}:${signature}`
          if (!outbox.some(n => n.id === id)) outbox.push({ id, groupId: group.id, signature, status: 'pending', createdAt: Date.now() })
        }
      }
      for (const notice of outbox.filter(n => n.groupId === group.id && n.status === 'pending' && (n.signature !== signature || group.delivery.status === 'delivered'))) {
        notice.status = 'superseded'; changed = true
      }
    }
    if (changed) await save()
    if (!deliver) return
    for (const notice of outbox.filter(n => n.status === 'pending')) {
      const group = rt.getGroup(notice.groupId)
      if (!group || group.status !== 'active') { notice.status = 'discarded'; await save(); continue }
      const roleId = notice.targetSessionId ? notice.roleId : (group.admins ?? []).find(id => group.members?.includes(id) && rt.getRole(id)?.status === 'active')
      if (!roleId) {
        if (notice.error !== '无可用群管理员，等待管理员恢复') { notice.error = '无可用群管理员，等待管理员恢复'; await save() }
        continue
      }
      try {
        if (!notice.targetSessionId) {
          const entry = await rt.ensureGroupSession(group, rt.getRole(roleId))
          notice.roleId = roleId; notice.targetSessionId = entry.id
          await save() // Pin recipient before admission; rotation cannot duplicate a retry.
        }
        await outside(async () => {
          await rt.deliverAdminHandoff(group, { id: notice.id, targetSessionId: notice.targetSessionId, seq: 0, fromName: '系统',
            text: `【最终复核交接】当前任务版本已全部完成。请读取任务执行结果与证据，核对使用入口、使用说明及未验证范围；必要时安排返工，不得把测试完成直接视为交付。复核完成后用 dwb_notify_user 向用户统一交付一次。当前交接：${notice.id}` }, roleId)
        })
        notice.status = 'sent'; notice.roleId = roleId; notice.sentAt = Date.now(); delete notice.error
        group.delivery.reviewRequestedAt = notice.sentAt
        await save()
      } catch (error) {
        const message = String(error?.message ?? error)
        if (notice.error !== message) { notice.error = message; await save() }
      }
    }
  }
  rt.syncDelivery = options => { const job = tail.then(() => process(options)); tail = job.catch(() => {}); return job }
  rt.completeDelivery = ({ groupId, fromRoleId, summary }) => mutate(groupId, async () => {
    await rt.loadAll(); await rt.executionReady
    const group = rt.getGroup(groupId)
    if (!group || group.status !== 'active') throw new Error('群组不存在或不可用')
    const roleId = rt.resolveGroupActor(group, fromRoleId)
    if (!roleId || !group.admins?.includes(roleId)) throw new Error('仅群管理员可以完成最终交付')
    const tasks = tasksFor(group)
    if (!tasks.length || tasks.some(t => t.status !== '已完成')) throw new Error('仍有未完成任务，不能宣布最终交付')
    const signature = signatureFor(group)
    if (!String(summary ?? '').trim()) throw new Error('交付摘要不能为空')
    if (group.delivery?.status === 'delivered' && group.delivery.signature === signature) return { duplicate: true }
    await rt.postGroupMessage({ groupId, fromRoleId: roleId, noWake: true,
      messageId: `delivery:${group.id}:${signature}`, text: `✅ 任务完成（${rt.getRole(roleId)?.name ?? '管理员'}）：\n${summary}` })
    group.delivery = { signature, status: 'delivered', notifiedAt: Date.now(), summary: String(summary), roleId }
    await save()
    await rt.syncWorkItems?.()
    return { duplicate: false }
  })
}
