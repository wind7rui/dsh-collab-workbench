// channels.js —— 群消息流与投递（消息去重、确认抑制、任务通知不唤醒）。
//
// 核心设计变更（解决 68% Token 浪费问题）：
//   1. 消息去重：投递前检查 entry.seen，已处理过的消息不再投递
//   2. 确认抑制："收到/确认/无需动作"类回复不触发下一轮投递
//   3. 任务通知不唤醒：任务创建/更新的自动发帖只写 log 不 followup
//   4. 管理员选择性路由：非 @ 且非任务的消息只投给管理员中未处理的
//   5. 会话轮换时归档旧会话（DSH 侧栏不残留）
//
// 每群成员会话 + 工作目录绑定 + 运行态/停止等机制保持不变。
import { MESSAGE_POLICY } from './policy.js'
import { randomUUID } from 'node:crypto'
import { resolve as resolvePath, relative as relativePath, sep as pathSep } from 'node:path'
import { createUserMessage } from '@deepseek-ai/dsh-llm'

export const SOURCE_KIND = 'dsh-workbench'
export const ROOM_LOG_MAX = 500
export const SESSION_ROTATE_AT = 60
const DIGEST_MAX = 20

// 确认类消息判定（不触发下一轮投递）。
const ACK_PATTERNS = [
  /已处理[过完]/, /无需重复/, /无需动作/, /无待办/, /延迟送达/, /延迟重投/,
  /历史消息/, /收到[，,]?确?认?$/, /确认收到[，,]?$/, /确认无误[，,]?$/,
  /^收到[。.]?$/, /^确认[。.]?$/, /回执[。.]?$/, /口径[一]?致[。.]?$/,
  /本条为.*延迟/, /无新增动作/, /无异议[。.]$/, /就绪[，,]?等/,
  /对时.*无?需?要?动作/, /状态确认.*无/, /与.*交叉/, /消息交叉/,
  /已核.*与.*一致/, /状态.*一致.*无需/, /时点对齐/, /终态.*一致/,
  /对齐确认/, /收悉/, /定稿口径/, /无其他影响/,
]

function isAckMessage(text) {
  const t = String(text ?? '').trim()
  if (t.length > 200) return false // 长消息不太可能只是确认
  return ACK_PATTERNS.some(p => p.test(t))
}

// @ 提及解析
export function mentionsIn(text, roleNames) {
  const found = new Set()
  const names = roleNames.filter(Boolean)
  if (names.length === 0) return []
  const sorted = [...names].sort((a, b) => b.length - a.length)
  let rest = String(text ?? '')
  for (const name of sorted) {
    const pattern = new RegExp(`(^|[^\\w])@${escapeRegExp(name)}(?=$|[\\s，。！？,.!?；;:：])`, 'g')
    let m
    while ((m = pattern.exec(rest)) !== null) found.add(name)
  }
  return [...found]
}

function escapeRegExp(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// ④ 从消息文本中提取关联的任务信息（优先级 + 状态），供人员判断是否需要跳过。
// 匹配任务通知格式（【新任务】【任务更新】）和任务 id（task_N）。
function taskContextFor(rt, text) {
  const t = String(text ?? '')
  // 任务通知消息（【新任务】/【任务更新】）：解析任务标题和状态。
  const taskMatch = t.match(/【新任务】(.+)|【任务更新】(.+)/)
  if (taskMatch) {
    const title = (taskMatch[1] ?? taskMatch[2] ?? '').split('\n')[0].trim()
    const task = (rt.listTasks() ?? []).find(tk => tk.title.includes(title.slice(0, 20)) || title.includes(tk.title.slice(0, 20)))
    if (task) {
      return `[关联任务 ${task.id}：${task.priority}优先级 · ${task.status} · 指派给${(task.assignees ?? []).map(id => rt.getRole(id)?.name ?? id).join('、')}]`
    }
  }
  // 普通 @ 消息中包含 task_N 引用。
  const idMatch = t.match(/\b(task_\d+)\b/)
  if (idMatch) {
    const task = rt.getTask?.(idMatch[1])
    if (task) {
      return `[关联任务 ${task.id}：${task.priority}优先级 · ${task.status}]`
    }
  }
  return null
}

export function install(rt) {
  const { ctx } = rt

  // 运行态（内存态）。
  // 🔑 工作状态：使用 DSH 原生 SessionSummary.running（与侧栏转圈动画同源）。
  // 每 2 秒缓存一次，避免频繁调用 sessionController.list()。
  let sessionStatusCache = { data: new Map(), fetchedAt: 0 }
  const STATUS_CACHE_MS = 2000

  const getSessionStatuses = async () => {
    const now = Date.now()
    if (now - sessionStatusCache.fetchedAt < STATUS_CACHE_MS) {
      return sessionStatusCache.data
    }
    try {
      const controller = ctx.get?.('sessionController') ?? ctx.sessionController
      const result = await controller.list({}, AbortSignal.timeout(3000))
      const map = new Map()
      for (const item of result?.items ?? []) {
        map.set(item.sessionId, item)
      }
      sessionStatusCache = { data: map, fetchedAt: now }
      return map
    } catch {
      return sessionStatusCache.data // 失败时用缓存
    }
  }

  rt.activityList = async (groupId) => {
    const group = rt.getGroup(groupId)
    if (!group) return []
    const statuses = await getSessionStatuses()
    const active = []
    for (const [roleId, entry] of Object.entries(group.sessions ?? {})) {
      const status = statuses.get(entry.id)
      if (status?.running) {
        active.push({
          key: `${groupId}:${roleId}`,
          groupId,
          roleId,
          startedAt: status.updatedAt ?? Date.now(),
          text: '',
        })
      }
    }
    for (const run of rt.executionRuns?.() ?? []) {
      if (run.groupId !== group.id || !statuses.get(run.sessionId)?.running) continue
      if (!active.some(a => a.roleId === run.roleId)) active.push({key:run.id,groupId:group.id,roleId:run.roleId,startedAt:run.updatedAt,text:run.taskId})
    }
    return active
  }
  // 兼容旧接口（同步调用场景）
  rt.touchRunning = () => {}
  rt.stopPerson = async (groupId, roleId) => {
    const group = rt.getGroup(groupId)
    const taskRuns = (rt.executionRuns?.() ?? []).filter(r => r.groupId === group?.id && r.roleId === roleId)
    await rt.pauseRoleExecution?.(group?.id, roleId)
    const entry = group?.sessions?.[roleId]
    if (!entry?.id) return { stopped: taskRuns.length > 0, reason: taskRuns.length ? '任务执行已暂停，需显式重试' : '该人员当前没有会话' }
    try {
      const { agent } = await ctx.sessionController.resolveAgent(entry.id)
      if (agent) {
        agent.cancel?.({ kind: 'user' })
        return { stopped: true }
      }
      return { stopped: false, reason: '该人员当前没有进行中的工作' }
    } catch (error) {
      return { stopped: false, reason: error?.message ?? String(error) }
    }
  }
  // 按群组+sessionId 停止运行中的 agent（供删除群组时清内存用）。
  rt.stopSessionAgent = async (groupId, sessionId) => {
    try {
      const { agent } = await ctx.sessionController.resolveAgent(sessionId)
      if (agent) {
        agent.cancel?.({ kind: 'user' })
        return { stopped: true }
      }
    } catch (error) {
      return { stopped: false, reason: error?.message ?? String(error) }
    }
    return { stopped: false, reason: '未找到该会话' }
  }

  const ensureLog = (group) => {
    if (!Array.isArray(group.log)) group.log = []
    if (typeof group.seq !== 'number') group.seq = group.log.length
    if (!group.seen) group.seen = {}
    if (!group.sessions) group.sessions = {}
    return group
  }

  const appendLine = (group, line) => {
    ensureLog(group)
    group.seq += 1
    line.seq = group.seq
    group.log = [...group.log, { ...line }].slice(-ROOM_LOG_MAX)
  }

  // ---- 每群成员会话管理 ----
  rt.ensureGroupSession = async (group, role) => {
    ensureLog(group)
    let entry = group.sessions[role.id]
    const rotate = entry && (entry.count ?? 0) >= SESSION_ROTATE_AT
    if (!entry || rotate) {
      // 轮换时归档旧会话（DSH 侧栏不再显示）。
      if (rotate && entry?.id) {
        try { await ctx.workspaceRegistry.archiveSession(entry.id) } catch { /* 忽略 */ }
        // 轮换前的会话 ID 记入台账：删群时按台账精确清理会话数据，
        // 不依赖目录名/路径扫描兜底（避免误删其他会话）。
        group.archivedSessions = [...new Set([...(group.archivedSessions ?? []), entry.id])]
      }
      const workspaceId = await rt.ensureGroupWorkspace(group) ?? await rt.ensureWorkspace()
      const { sessionId } = await ctx.sessionController.create({ workspaceId })
      if (role.model) await rt.applySessionModel?.(sessionId, role.model)
      try {
        const titleAgent = await rt.resolveAgent(sessionId)
        await ctx.sessionTitle.rename(titleAgent.session, `${role.name} · ${group.name}`)
      } catch { /* 忽略 */ }
      entry = { id: sessionId, seen: rotate ? (entry.seen ?? 0) : 0, count: 0 }
      group.sessions[role.id] = entry
      rt.touch()
      // 种子消息（精简版——减少初始化 token + 效率纪律）。
      const isAdmin = (group.admins ?? []).includes(role.id)
      const lines = [
        `你是「${role.name}」，属于群「${group.name}」。roleId=${role.id}（发言用 dwb_post_group_message 传 fromRoleId）`,
        role.instructions ? `职责：${role.instructions}` : '',
        `成员：${(group.members ?? []).map(id => rt.getRole(id)?.name ?? id).join('、')}`,
        group.notice ? `公告：${group.notice}` : '',
        group.dir ? `工作目录：${group.dir}` : '',
        '规范：@人员名指定回答者；需要用户拍板只能用 dwb_ask_user（决策卡显示在群聊，用户点击按钮回复——调用后立即结束你的回复，绝不要在会话中直接向用户提问，用户不看你的会话只看群聊）；管理员阶段性汇报用 dwb_report_progress；任务完成通知用 dwb_notify_user；查历史用 dwb_group_transcript；记忆用 dwb_remember/dwb_recall。不要发"收到/确认"类无实质内容的回复。',
        // 任务执行纪律
        '任务纪律：正式任务由系统独立执行会话调度；普通群会话只做协调，不认领或重复执行。执行成员用 dwb_report_execution 汇报个人状态与完成证据，不用 dwb_update_task 认领或关闭多人任务。',
        // 📢 群消息核心原则 + 内容纪律
        '消息原则：群消息的读者是人类用户——让用户能看懂每个成员在做什么、做完了什么、成果在哪。只发关键总结性内容，非必要细节写进文档。',
        MESSAGE_POLICY,
        // 📄 文档引用纪律（防止技术细节涌入群聊）
        '文档纪律：技术细节（字段规则/API行为/校验逻辑/契约条款）只写入文档，群聊只引用文档位置——说"按设计.md v1.1 §6"而不是把 §6 的内容复述一遍。@成员派发时同样只说"按 XX 文档的 YY 章节做"，成员会自己去读文档。裁定结论可以在群里说（如"3 处裁决已写入基线"），但裁决的具体内容不重复。',
        // ⚡ 效率纪律
        '效率纪律：群消息控制在 150 字以内，用要点式表达；不写过程叙述（"我现在正在..."、"接下来我会..."）；不交叉验证或重复审查别人的工作；有分歧直接 @对方 说结论。评审意见写入被评审的文档，不进群聊。',
        // 🛑 决策阻塞纪律
        '决策纪律：发出决策卡后必须等待用户回复，绝不能代用户做决策（代决）——"暂定""可推翻"也不行。用户未回复期间：不得创建依赖该决策的任务、不得派发依赖该决策的工作。只有与决策完全无关的环境检测可以继续。用户长时间不回复时，用 dwb_ask_user 再次提醒，不要自行推进。',
        // 管理员调度纪律
        isAdmin ? '调度纪律（你是管理员）：信任团队成员，授权后不逐条审查中间产出；只在两个节点做核验——①基线确认 ②最终验收；派任务时用一句话说清目标/范围/交付标准；派发后放手让成员自主完成。发出决策卡时明确哪些工作可继续、哪些暂停；宣布完成前确认所有任务已关闭。' : '',
        rotate ? '（会话已轮换，之前内容用 dwb_group_transcript 查。）' : '',
      ].filter(Boolean)
      // 🔑 不单独发送种子消息——agent 会把它当作任务执行。
      // 改为存储种子文本，与第一条真实消息合并发送（deliverToMember 处理）。
      entry.pendingSeed = lines.join('\n')
      group.sessions[role.id] = entry
      rt.touch()
    }
    return entry
  }

  const digestFor = (group, roleId, currentSeq) => {
    ensureLog(group)
    const entry = group.sessions[roleId]
    const seen = entry?.seen ?? 0
    if (currentSeq - seen <= 1) return []
    return (group.log ?? [])
      .filter(l => l.seq > seen && l.seq < currentSeq)
      .slice(-DIGEST_MAX)
      .map(l => {
        const preview = String(l.text ?? '').replace(/\s+/g, ' ').slice(0, 120)
          || (l.attachments?.length ? `📎 ${l.attachments[0].name}${l.attachments.length > 1 ? ` 等 ${l.attachments.length} 个文件` : ''}` : '')
        return `${l.fromName}：${preview}`
      })
  }

  // 附件记录净化：只保留落在群工作目录内的文件（防伪造路径投递给成员），
  // 并补 relPath（成员会话 cwd = 群目录，相对路径可直接 read/glob）。
  const sanitizeAttachments = (group, input) => {
    if (!group.dir || !Array.isArray(input)) return []
    const groupDir = resolvePath(group.dir)
    return input
      .filter(a => a && typeof a.path === 'string' && typeof a.name === 'string')
      .slice(0, 9)
      .map(a => {
        const abs = resolvePath(a.path)
        const rel = relativePath(groupDir, abs)
        if (!rel || rel.startsWith('..') || rel.includes(`..${pathSep}`)) return null
        return {
          name: String(a.name).replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 200) || '未命名文件',
          size: Number(a.size) > 0 ? Number(a.size) : 0,
          path: abs,
          relPath: rel.split(pathSep).join('/'),
        }
      })
      .filter(Boolean)
  }

  // Internal notification capability is deliberately absent from public tool/RPC inputs.
  const systemToken = Symbol('system notification')
  rt.resolveGroupActor = (group, explicitRoleId) => {
    const initiator = ctx.get?.('agents')?.currentInitiator?.()
    const run = rt.currentExecution?.()
    const sessionRoleId = initiator && Object.entries(group.sessions ?? {}).find(([, entry]) => entry.id === initiator.id)?.[0]
    const trustedRoleId = run?.groupId === group.id ? run.roleId : sessionRoleId
    if (trustedRoleId && explicitRoleId && trustedRoleId !== explicitRoleId) throw new Error('fromRoleId 不能冒充其他成员')
    if (initiator && !trustedRoleId && explicitRoleId) throw new Error('当前会话不属于该群组，不能署名成员')
    const roleId = trustedRoleId ?? explicitRoleId
    if (roleId && (!(group.members ?? []).includes(roleId) || !rt.getRole(roleId))) throw new Error('发言角色必须是当前群组成员')
    return roleId ?? null
  }
  rt.postSystemGroupMessage = args => rt.postGroupMessage({ ...args, system: systemToken })

  // ---- 群消息投递（核心回路·V5 效率版） ----
  rt.postGroupMessage = async ({ groupId, text, fromRoleId, noWake, attachments, taskId, replyToSeq, decisionSeq, messageId, system }) => {
    await rt.loadAll()
    await rt.executionReady
    const group = rt.getGroup(groupId)
    if (!group) throw new Error(`群组 ${groupId} 不存在`)
    if (group.status !== 'active') throw new Error(`群组「${group.name}」已归档，不能发言`)
    if (system !== undefined && system !== systemToken) throw new Error('普通调用不能冒充系统通知')
    fromRoleId = rt.resolveGroupActor(group, fromRoleId)
    const prior = messageId ? (group.log ?? []).find(line => line.id === messageId) : null
    if (prior) return {seq:prior.seq,mentions:prior.mentions??[],delivered:[],duplicate:true}

    const files = sanitizeAttachments(group, attachments)
    if (!String(text ?? '').trim() && files.length === 0) throw new Error('消息内容不能为空')

    const fromRole = fromRoleId ? rt.getRole(fromRoleId) : undefined
    const memberIds = group.members ?? []
    const memberRoles = memberIds.map(id => rt.getRole(id)).filter(Boolean)
    const mentions = mentionsIn(text, memberRoles.map(r => r.name))
    const caller = rt.currentExecution?.()
    if (!system && caller && (caller.groupId !== group.id || fromRoleId !== caller.roleId)) throw new Error('执行成员只能用自己的角色在所属群发言')
    const reply = replyToSeq === undefined ? null : (group.log ?? []).find(l => l.seq === Number(replyToSeq))
    const refs = [...new Set(String(text ?? '').match(/\btask_\d+\b/g) ?? [])]
    const boundTaskId = taskId || reply?.taskId || caller?.taskId || (refs.length === 1 ? refs[0] : null)
    if (boundTaskId && rt.getTask?.(boundTaskId)?.groupId !== group.id) throw new Error('关联任务必须属于当前群组')
    if (taskId && caller && caller.taskId !== taskId) throw new Error('执行成员不能切换到其他任务')

    const line = {
      id: messageId ?? randomUUID(),
      seq: 0,
      text: String(text ?? ''),
      from: fromRoleId ?? null,
      fromName: fromRole?.name ?? (system === systemToken ? '系统' : '用户'),
      ...(system === systemToken ? { system: true } : {}),
      time: Date.now(),
      mentions,
      ...(boundTaskId ? { taskId: boundTaskId } : {}),
      ...(reply ? { replyToSeq: reply.seq } : {}),
      ...(files.length > 0 ? { attachments: files } : {}),
    }
    appendLine(group, line)

    // A plain user message does not implicitly answer an outstanding decision.
    if (fromRoleId && String(text).startsWith('⚠️ 需要您的决策') && !group.pendingDecision) {
      group.pendingDecision = { seq: line.seq, time: Date.now(), taskId: boundTaskId, runId: caller?.id, roleId: fromRoleId,
        options: String(text).match(/可选项：([\s\S]*)$/)?.[1] ?? '' }
      rt.touch()
    } else if (!fromRoleId && !system && group.pendingDecision) {
      const pending = group.pendingDecision
      const answer = String(text).trim()
      const choices = String(pending.options ?? '').split('|').map(s => s.trim().match(/^([A-Za-z0-9]+)/)?.[1]).filter(Boolean)
      if (decisionSeq !== undefined || /^决策回复[：:]/.test(answer) || choices.includes(answer)) {
        if (rt.resolveDecision) await rt.resolveDecision(group.id, answer, decisionSeq ?? pending.seq)
        else { group.pendingDecision = null; rt.touch() }
        line.taskId ||= pending.taskId
        if (pending.taskId) return { seq: line.seq, mentions, delivered: [], decisionResolved: true }
      }
    }

    // 发言者本人视为已读 + 刷新活跃时间（发言 = agent 仍在活跃，
    // 延长指示器显示窗口 2 分钟）。
    if (fromRoleId && group.sessions?.[fromRoleId]) {
      group.sessions[fromRoleId].seen = group.seq
      rt.touchRunning?.(group.id, fromRoleId)
    }
    rt.touch()

    // ===== V5 效率核心 =====
    // 1. noWake 模式（任务通知等）：只写 log，不唤醒任何人。
    //    相关人员下次被 @ 时，digest 自然带上这些消息。
    if (noWake) return { seq: group.seq, mentions, delivered: [] }

    // 2. 确认类消息抑制：仅对 AI 成员的"收到/确认/已处理"类回复生效。
    //    用户消息永远投递（用户的"确认"是对决策卡的关键回复，绝不能被拦截）。
    if (fromRoleId && isAckMessage(text)) {
      return { seq: group.seq, mentions, delivered: [] }
    }

    if (line.taskId && rt.routeTaskMessage) {
      const roleIds = mentions.length ? memberRoles.filter(r => mentions.includes(r.name) && r.id !== fromRoleId).map(r => r.id) : undefined
      // Untargeted member progress belongs in the group, not back in its own inbox.
      if (fromRoleId && !mentions.length) return { seq: line.seq, mentions, delivered: [] }
      const delivered = await rt.routeTaskMessage(group, line, line.taskId, roleIds)
      const task = rt.getTask(line.taskId)
      const errors = []
      for (const role of memberRoles.filter(r => mentions.includes(r.name) && !(task.assignees ?? []).includes(r.id) && r.id !== fromRoleId && r.status === 'active')) {
        try { assertOrdinaryRoute(group, role, refs); if (await deliverToMember(group, role, line, {fromRole,toAdmins:false,mentions})) delivered.push(role.id) }
        catch(error) {errors.push({roleId:role.id,error:String(error?.message??error)})}
      }
      return { seq: line.seq, mentions, delivered, queued: true, errors }
    }

    // 3. 正常投递路由。
    const adminIds = group.admins ?? []
    const noMention = mentions.length === 0
    const toAdmins = noMention && adminIds.length > 0
    const targets = mentions.length > 0
      ? memberRoles.filter(r => mentions.includes(r.name))
      : (toAdmins ? memberRoles.filter(r => adminIds.includes(r.id)) : memberRoles)

    const delivered = [], errors = []
    for (const role of targets) {
      if (role.status !== 'active' || role.id === fromRoleId) continue
      const entry = group.sessions?.[role.id]
      if (entry && entry.seen >= line.seq) continue
      try {
        if (!toAdmins || refs.length) assertOrdinaryRoute(group, role, refs)
        const ok = await deliverToMember(group, role, line, { fromRole, toAdmins, mentions })
        if (ok) delivered.push(role.id)
      } catch (error) { errors.push({roleId: role.id, error: String(error?.message ?? error)}) }
    }
    return { seq: line.seq, mentions, delivered, errors }
  }

  function assertOrdinaryRoute(group, role, refs) {
    if (refs.length > 1) throw new Error('消息引用多个任务，路由有歧义；请显式指定 taskId')
    const unfinished = (rt.listTasks?.(group.id) ?? []).filter(t => t.groupId === group.id && t.schedulerVersion && t.status !== '已完成' && (t.assignees ?? []).includes(role.id))
    if (unfinished.length) throw new Error(`成员 ${role.name} 有未完成正式执行任务 ${unfinished.map(t => t.id).join('、')}；请显式指定 taskId 投递原执行会话，不能启动普通会话`)
  }

  rt.deliverAdminHandoff = async (group, line, roleId) => {
    if (!(group.admins ?? []).includes(roleId)) throw new Error('交接只能投递群管理员')
    const role = rt.getRole(roleId)
    if (!role || role.status !== 'active' || !line.id) throw new Error('交接目标或稳定消息身份无效')
    return deliverToMember(group, role, line, { toAdmins: true, mentions: [], handoff: true })
  }

  async function deliverToMember(group, role, line, { fromRole, toAdmins, mentions, handoff = false }) {
    const fixedTarget = handoff ? line.targetSessionId : null
    const entry = fixedTarget
      ? (group.sessions?.[role.id]?.id === fixedTarget ? group.sessions[role.id] : { id: fixedTarget })
      : await rt.ensureGroupSession(group, role)
    const agent = await rt.resolveAgent(entry.id)
    const stableId = handoff ? `dwb-handoff-${line.id}-${role.id}` : null
    if (handoff) {
      const events = agent.session.snapshotEvents()
      const inbox = ctx.sessionProjections.stateOf(agent.session, 'inbox')
      if (!inbox) throw new Error('当前宿主缺少 durable inbox 投影')
      if (Object.values(inbox).flat().some(m => m.id === stableId) || events.some(e => e.type === 'user/message' && e.data?.id === stableId)) {
        await ctx.sessions.flush?.(agent.session)
        return true
      }
    }

    // 精简消息头（减少每次投递的 token）。
    const header = ['发言规则：只报必要结论、需行动的协调或阻塞；不逐人报开工、不重复回执。负责人统一启动/最终交付，进度仅报重要变化，普通消息最多150字。']
    if (mentions.includes(role.name)) header.push(`@${role.name}`)
    else if (toAdmins) header.push(`（管理员）`)

    // 🔑 种子合并：首次投递时，把种子（身份/职责/规范）与真实消息合并为一次投递。
    // 这样 agent 在第一轮就同时看到"你的上下文"和"用户的请求"，直接响应用户请求。
    if (entry.pendingSeed) {
      header.push(`【你的上下文（环境信息，非任务——不要单独响应此部分，直接处理最下方的「本轮消息」）】\n${entry.pendingSeed}`)
    }

    // 🔒 决策阻塞强制提醒：有未回复决策卡时，给 AI 成员注入系统级指令。
    if (group.pendingDecision) {
      header.push(`🛑【系统强制】当前有未回复的决策卡（seq ${group.pendingDecision.seq}），用户尚未拍板。规则：①不得代用户做决策（代决）②不得派发依赖该决策的任务③不得推进依赖该决策的工作④只有与决策完全无关的准备（如环境检测）可以继续。等待用户回复决策卡后再行动。`)
    }

    // ④ 任务优先级/状态上下文：如果消息关联了任务，附上任务状态与优先级。
    const linkedTask = line.taskId ? rt.getTask?.(line.taskId) : null
    const taskContext = linkedTask?.groupId === group.id ? `[关联任务 ${linkedTask.id}：${linkedTask.priority} · ${linkedTask.status}]` : null
    if (taskContext) header.push(taskContext)

    const digest = digestFor(group, role.id, line.seq)
    if (digest.length > 0) header.push(`[此前动态]\n${digest.join('\n')}`)

    // 🔗 衔接层：header 全部是环境上下文（职责/规范/digest），本轮消息必须用
    // 显式标注隔开并署名，避免裸贴在上下文末尾被误认为其中一部分。
    // 📎 附件是本轮消息的一部分：放进【本轮消息】区块与正文并列，
    // 不混入环境上下文（曾与职责说明黏在一起，成员分不清哪些是用户本轮发的）。
    const parts = []
    const body = String(line.text ?? '').trim()
    if (body) parts.push(body)
    if (line.attachments?.length) {
      const list = line.attachments.map(f => `- ${f.name}（${f.size} 字节）：${f.relPath}`).join('\n')
      parts.push(`📎 附件（用户随本条消息共享，已存入群工作目录；文本/代码用 read 读取，图片用 read_image 查看）：\n${list}`)
    }
    if (parts.length === 0) parts.push('（空消息）') // 防御：postGroupMessage 已保证非空
    const text = header.length > 0
      ? `${header.join('\n')}\n\n【本轮消息｜来自：${line.fromName}】\n${parts.join('\n\n')}`
      : parts.join('\n\n')
    const message = createUserMessage({
      content: [{ type: 'text', text }],
      source: {
        kind: SOURCE_KIND, form: 'group',
        groupId: group.id, groupName: group.name,
        lineId: line.id, seq: line.seq, senderName: line.fromName,
      },
    })

    if (group.status !== 'active') return false
    agent.followup(stableId ? { ...message, id: stableId } : message)
    await ctx.sessions.flush?.(agent.session)
    // A durable handoff may retry an archived target; never resurrect it as the current session.
    if (group.sessions?.[role.id]?.id === entry.id) {
      entry.pendingSeed = null
      entry.count = (entry.count ?? 0) + 1
      entry.seen = Math.max(entry.seen ?? 0, line.seq ?? 0)
      group.sessions[role.id] = entry
      rt.touch()
    }
    // 工作状态由 DSH 原生 SessionSummary.running 提供（activityList 查询），
    // 不再维护自定义 running Map。
    return true
  }

  rt.groupTranscript = (groupId, sinceSeq = 0) => {
    const group = rt.getGroup(groupId)
    if (!group) return []
    ensureLog(group)
    return (group.log ?? []).filter(line => line.seq > sinceSeq)
  }

  rt.groupMessageCount = (groupId) => {
    const group = rt.getGroup(groupId)
    if (!group) return 0
    ensureLog(group)
    return group.seq ?? 0
  }
}
