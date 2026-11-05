// Tasks retain the existing UI status vocabulary; execution details live in execution.runs.
export const PRIORITIES = ['高', '中', '低']
export const TASK_STATUSES = ['待办', '进行中', '已完成']
const PATCH_FIELDS = new Set(['title', 'description', 'assignees', 'priority', 'status', 'dependencies'])

export function install(rt) {
  rt.validatePriority = (value = '中') => {
    if (!PRIORITIES.includes(value)) throw new Error(`优先级必须是 ${PRIORITIES.join('/')}`)
    return value
  }
  rt.validateTaskStatus = (value = '待办') => {
    if (!TASK_STATUSES.includes(value)) throw new Error(`状态必须是 ${TASK_STATUSES.join('/')}`)
    return value
  }
  const validateAssignees = (values, group) => {
    if (!Array.isArray(values) || !values.length) throw new Error('任务至少指派 1 名工程师')
    const ids = [...new Set(values.map(String))]
    for (const id of ids) {
      const role = rt.getRole(id)
      if (!role) throw new Error(`指派角色 ${id} 不存在`)
      if (role.status !== 'active') throw new Error(`指派角色「${role.name}」已停用`)
      if (!(group.members ?? []).includes(id)) throw new Error(`指派角色「${role.name}」必须是群组成员`)
    }
    return ids
  }
  const validateDependencies = (values = [], group, ownId) => {
    if (!Array.isArray(values)) throw new Error('dependencies 必须是任务 id 数组')
    const ids = [...new Set(values.map(String))]
    const visit = (id, seen = new Set()) => {
      if (id === ownId) throw new Error('任务依赖不能形成循环')
      if (seen.has(id)) return
      seen.add(id)
      const t = rt.getTask(id)
      if (!t || t.groupId !== group.id) throw new Error(`依赖任务 ${id} 必须存在且属于同一群组`)
      for (const next of t.dependencies ?? []) visit(next, seen)
    }
    ids.forEach(id => visit(id))
    return ids
  }
  const ready = async () => { await rt.loadAll(); await rt.executionReady }
  const groupFor = id => {
    const group = rt.getGroup(id)
    if (!group || group.status !== 'active') throw new Error('群组不存在、已归档或正在删除')
    return group
  }
  const notify = async (task, text, fromRoleId) => {
    try {
      const post = rt.postSystemGroupMessage ?? rt.postGroupMessage
      await post({ groupId: task.groupId, taskId: task.id, text, fromRoleId, noWake: true })
    } catch (error) {
      // A task already committed is not a failed create; caller retries must not duplicate it.
      task.notificationError = String(error?.message ?? error)
      rt.touch()
    }
  }
  rt.createTask = async ({ title, description, groupId, assignees, priority, dependencies, fromRoleId, autoPost = true }) => {
    await ready()
    const cleanTitle = String(title ?? '').trim()
    if (!cleanTitle) throw new Error('任务标题不能为空')
    const group = groupFor(groupId)
    fromRoleId = rt.resolveGroupActor?.(group, fromRoleId) ?? fromRoleId
    if (group.pendingDecision) throw new Error('群内有未回复的决策，等待用户拍板后再创建任务')
    const task = {
      id: rt.nextId('task'), title: cleanTitle, description: String(description ?? ''), groupId: group.id,
      assignees: validateAssignees(assignees, group), priority: rt.validatePriority(priority),
      dependencies: validateDependencies(dependencies, group), schedulerVersion: 1, revision: 1, status: '待办',
      createdAt: Date.now(), updatedAt: Date.now(), completedAt: null,
    }
    rt.addTask(task)
    // Persist task + run intents before notification or model execution.
    await rt.taskCreated?.(task)
    await rt.saveAll?.()
    if (autoPost) await notify(task, `【新任务 ${task.id}】${task.title}\n优先级：${task.priority}\n描述：${task.description || '（无）'}\n指派：${task.assignees.map(id => `@${rt.getRole(id)?.name ?? id}`).join(' ')}\n已进入系统执行队列。`, fromRoleId)
    rt.kickExecution?.()
    return task
  }
  rt.updateTask = async (id, patch, { fromRoleId, autoPost = true } = {}) => {
    await ready()
    const task = rt.getTask(id)
    if (!task) throw new Error(`任务 ${id} 不存在`)
    const group = groupFor(task.groupId)
    fromRoleId = rt.resolveGroupActor?.(group, fromRoleId) ?? fromRoleId
    for (const key of Object.keys(patch)) if (!PATCH_FIELDS.has(key)) throw new Error(`不允许修改任务字段 ${key}`)
    const next = { ...patch }
    if (next.title !== undefined) {
      next.title = String(next.title).trim()
      if (!next.title) throw new Error('任务标题不能为空')
    }
    if (next.description !== undefined) next.description = String(next.description)
    if (next.assignees !== undefined) next.assignees = validateAssignees(next.assignees, group)
    if (next.priority !== undefined) next.priority = rt.validatePriority(next.priority)
    if (next.dependencies !== undefined) next.dependencies = validateDependencies(next.dependencies, group, task.id)
    if (next.status !== undefined) {
      next.status = rt.validateTaskStatus(next.status)
      next.completedAt = next.status === '已完成' ? (task.completedAt ?? Date.now()) : null
    }
    await rt.validateExecutionTaskUpdate?.(task, next)
    if (['title','description','assignees','dependencies'].some(key => next[key] !== undefined && JSON.stringify(next[key]) !== JSON.stringify(task[key]))) next.revision = (task.revision ?? 1) + 1
    const updated = rt.updateTaskRecord(id, { ...next, updatedAt: Date.now() })
    await rt.taskChanged?.(updated, task)
    await rt.saveAll?.()
    if (autoPost) await notify(updated, `【任务更新 ${updated.id}】${updated.title}\n状态：${updated.status}\n优先级：${updated.priority}`, fromRoleId)
    rt.kickExecution?.()
    return updated
  }
  rt.listTasks = groupId => {
    const canonical = groupId ? (rt.getGroup(groupId)?.id ?? groupId) : null
    return rt.state.tasks.items.filter(t => !canonical || t.groupId === canonical)
  }
  rt.updateTaskRecord = (id, patch) => {
    const index = rt.state.tasks.items.findIndex(t => t.id === id)
    if (index < 0) return undefined
    rt.state.tasks.items[index] = { ...rt.state.tasks.items[index], ...patch }
    rt.touch()
    return rt.state.tasks.items[index]
  }
}
