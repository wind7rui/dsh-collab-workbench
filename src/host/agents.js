// agents.js —— 人员（Agent Session）管理。
// 每名人员 = 一个根 Session（sessionController.create + 命名 + 可选模型选择）；
// 职责描述作为会话首条上下文消息注入（并在每次职责更新时追加最新版）。
import { join } from 'node:path'
import { createUserMessage } from '@deepseek-ai/dsh-llm'

// 内置预设角色模板（规格 R-1：五类）。
export const PRESET_ROLES = [
  { type: '研发负责人', defaultInstructions: '接收需求、分解任务、协调进度、验收交付。' },
  { type: '架构师', defaultInstructions: '技术方案设计、架构评审。' },
  { type: '高级工程师', defaultInstructions: '代码实现、联调、自测。' },
  { type: '测试工程师', defaultInstructions: '测试用例设计、质量验证。' },
  { type: '产品经理', defaultInstructions: '需求澄清、验收标准定义、价值把关。' },
]

// 角色名合法性：不允许空白、斜杠、反斜杠、控制字符。
const NAME_BAD = /[\/\\\u0000-\u001f]/
const GROUP_SUFFIX = '沟通群' // 保留：群组命名规范在 groups.js

export function install(rt) {
  const { ctx } = rt

  // 确保团队工作区存在（无目录群的兜底）。
  // ⚠️ 必须按插件专属路径查找/创建，不能直接取注册表里的第一个工作区，
  // 否则无目录群的成员会话可能被建到其他（甚至残留的）工作区里。
  rt.ensureWorkspace = async () => {
    const { workspaceRegistry } = ctx
    const path = join(rt.home, 'workspace')
    try {
      const existing = await workspaceRegistry.resolveByPath?.(path)
      if (existing) return existing.id
    } catch { /* 查询失败走创建 */ }
    // 真实 registry.create 要求目录已存在——先建目录再注册。
    const { mkdir } = await import('node:fs/promises')
    await mkdir(path, { recursive: true }).catch(() => {})
    const workspace = await workspaceRegistry.create(path, 'DSH Workbench')
    return workspace.id
  }

  // 解析 Session 对应的 Agent。
  rt.resolveAgent = async (sessionId) => {
    const resolved = await ctx.sessionController.resolveAgent(sessionId)
    if (resolved && 'error' in resolved) {
      throw new Error(resolved.error?.message ?? 'Session unavailable')
    }
    return resolved.agent
  }

  // 为人员创建根 Session：create → resolveAgent → 命名 →（可选）选择模型。
  // model 形如 "provider/model"；选择失败不阻断创建。
  rt.createRoleSession = async (roleName, model) => {
    const workspaceId = await rt.ensureWorkspace()
    const { sessionId } = await ctx.sessionController.create({ workspaceId })
    const agent = await rt.resolveAgent(sessionId)
    await ctx.sessionTitle.rename(agent.session, roleName)
    if (model) await rt.applySessionModel(sessionId, model)
    return { sessionId, agent }
  }

  // 给已有 Session 应用模型选择（"provider/model"）。
  rt.applySessionModel = async (sessionId, model) => {
    const sel = parseModel(model)
    if (!sel) return false
    try {
      await ctx.sessionController.selectModel({ sessionId, ...sel })
      return true
    } catch (error) {
      console.warn('[dsh-workbench] selectModel failed:', model, error?.message ?? error)
      return false
    }
  }

  // 职责变更后：同步到该人员所在的每个群会话（带最新职责）。
  rt.syncDutyToGroups = async (role) => {
    for (const group of rt.listGroups() ?? []) {
      const entry = (group.sessions ?? {})[role.id]
      if (!entry?.id) continue
      try {
        const agent = await rt.resolveAgent(entry.id)
        agent.followup(createUserMessage({
          content: [{ type: 'text', text: `【职责已更新】你的最新职责：${role.instructions || '（未指定，按群组安排）'}（你的 roleId 仍是 ${role.id}）` }],
          source: { kind: 'dsh-workbench', form: 'duty' },
        }))
        await ctx.sessions.flush(agent.session)
      } catch { /* 单个群会话失败不影响其他 */ }
    }
  }

  // 给人员 Session 追加一条职责上下文消息（首条注入 & 更新时刷新）。
  rt.sendRoleContextMessage = async (role, { initial = false } = {}) => {
    if (!role?.sessionId) return false
    try {
      const agent = await rt.resolveAgent(role.sessionId)
      const head = initial ? '【你的身份与职责（常驻指令）】' : '【职责已更新】'
      const lines = [
        head,
        `你是协作工作台中的人员「${role.name}」。`,
        role.instructions ? `你的职责：${role.instructions}` : '（未指定具体职责，按群组安排工作）',
        '工作规范：所有沟通只发生在群组中，用 @人员名 点名指定回答者；不存在一对一私聊；收到消息后把结论回复到群组。',
      ]
      const message = createUserMessage({
        content: [{ type: 'text', text: lines.join('\n') }],
        source: { kind: 'dsh-workbench', form: 'duty' },
      })
      agent.followup(message)
      await ctx.sessions.flush(agent.session)
      return true
    } catch (error) {
      console.warn('[dsh-workbench] sendRoleContextMessage failed:', error?.message ?? error)
      return false
    }
  }

  // 名字清洗与校验。
  const cleanName = (raw) => String(raw ?? '').trim()
  rt.validateRoleName = (raw) => {
    const name = cleanName(raw)
    if (!name) throw new Error('角色名称不能为空')
    if (NAME_BAD.test(name)) throw new Error('角色名称不能包含 /、\\ 或控制字符')
    return name
  }

  // 预设类型查询。
  rt.presetRole = (type) => PRESET_ROLES.find(item => item.type === type)

  // ---- 新建 ----
  // name 角色名；type 预设类型或自定义类型；instructions 职责描述；model 可选模型。
  rt.createRole = async ({ name: rawName, type, instructions, model }) => {
    const name = rt.validateRoleName(rawName)
    if (rt.listRoles().some(item => item.name === name)) {
      throw new Error(`角色「${name}」已存在`)
    }
    const preset = rt.presetRole(type)
    const role = {
      id: rt.nextId('role'),
      name,
      type: preset ? preset.type : (type ?? '自定义'),
      // 职责只存纯净内容：用户留空则回填预设默认职责（|| 使空串也回填）。
      instructions: (String(instructions ?? '').trim()) || preset?.defaultInstructions || '',
      model: model ?? null,
      sessionId: null, // 惰性创建：P2 起 Session 在首次启用/加入群组时创建
      status: 'active',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }
    // 不创建根会话（职责通过群会话种子消息注入），只在台账登记。
    // 根会话会在 DSH 侧栏产生多余条目；群会话按需创建且带标题。
    rt.addRole(role)
    return role
  }

  // ---- 列出 / 查询 ----
  rt.listRoles = () => rt.state.roles.items ?? []
  rt.getRole = (id) => rt.state.roles.items.find(item => item.id === id)
  rt.findRoleByName = (name) => rt.state.roles.items.find(item => item.name === name)

  // ---- 编辑 ----
  rt.updateRole = (id, patch) => {
    for (const key of Object.keys(patch)) if (!['name','type','instructions','model'].includes(key)) throw new Error(`不允许修改角色字段 ${key}`)
    const current = rt.getRole(id)
    if (!current) throw new Error(`角色 ${id} 不存在`)
    if (patch.name !== undefined) {
      const newName = rt.validateRoleName(patch.name)
      const dup = rt.state.roles.items.find(item => item.id !== id && item.name === newName)
      if (dup) throw new Error(`角色「${newName}」已存在`)
      patch.name = newName
    }
    const updated = rt.updateRoleRecord(id, {
      ...patch,
      updatedAt: Date.now(),
    })
    return updated
  }

  // ---- 停用 / 启用 ----
  rt.setRoleStatus = async (id, status) => {
    if (!['active','disabled'].includes(status)) throw new Error('角色状态必须是 active/disabled')
    const current = rt.getRole(id)
    if (!current) throw new Error(`角色 ${id} 不存在`)
    const updated = rt.updateRoleRecord(id, { status, updatedAt: Date.now() })
    if (status === 'disabled') {
      await rt.pauseRoleExecution?.(null, id)
      for (const group of rt.listGroups()) if (group.members.includes(id)) await rt.stopPerson?.(group.id,id)
    }
    await rt.saveAll?.()
    return updated
  }

  // ---- 删除 ----
  // 有群组/任务关联时返回拒绝原因（由调用方决定是否强制）。
  rt.deleteRole = (id) => {
    const current = rt.getRole(id)
    if (!current) throw new Error(`角色 ${id} 不存在`)
    const groupRef = (rt.listGroups() ?? []).find(g => (g.members ?? []).includes(id))
    const taskRef = (rt.listTasks() ?? []).find(t => (t.assignees ?? []).includes(id))
    if (groupRef) return { refused: true, reason: `角色仍在群组「${groupRef.name}」中` }
    if (taskRef) return { refused: true, reason: `角色仍被任务「${taskRef.title}」指派` }
    const ok = rt.removeRole(id)
    return { refused: !ok, reason: ok ? undefined : '角色不存在' }
  }

  rt.forceDeleteRole = async id => {
    const role = rt.getRole(id)
    if (!role) throw new Error('角色不存在')
    await rt.setRoleStatus(id, 'disabled')
    for (const group of rt.listGroups()) {
      if (group.members.includes(id)) rt.updateGroupRecord(group.id,{members:group.members.filter(m=>m!==id),admins:(group.admins??[]).filter(m=>m!==id)})
    }
    for (const task of rt.listTasks()) if (task.assignees.includes(id)) {
      const updated = rt.updateTaskRecord(task.id,{assignees:task.assignees.filter(a=>a!==id),updatedAt:Date.now()})
      await rt.taskChanged?.(updated,task)
    }
    rt.removeRole(id);await rt.saveAll?.()
    return {deleted:true,role:role.name}
  }

  // ledger 底层记录更新（避免与 ledger.updateRole 递归冲突）。
  rt.updateRoleRecord = (id, patch) => {
    const index = rt.state.roles.items.findIndex(item => item.id === id)
    if (index === -1) return undefined
    rt.state.roles.items[index] = { ...rt.state.roles.items[index], ...patch }
    rt.touch()
    return rt.state.roles.items[index]
  }
}

// "provider/model" → { provider, model }；不合法返回 null。
function parseModel(model) {
  const raw = String(model ?? '').trim()
  if (!raw) return null
  const i = raw.indexOf('/')
  if (i <= 0 || i >= raw.length - 1) return null
  return { provider: raw.slice(0, i), model: raw.slice(i + 1) }
}
