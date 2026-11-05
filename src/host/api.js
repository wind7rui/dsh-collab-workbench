// api.js —— host 侧 RPC API（P7）。
// 统一端点 /api/dsh-workbench（POST，buffered JSON）：
//   请求体 { endpoint, payload }
//   响应   { ok, data } 或 { ok:false, error }
// client 半区经 fetch('api/dsh-workbench', {credentials:'same-origin'}) 调用。
// 契约：ctx.connection.fetch.register（DSH 核心，P0 已验证）。

export function install(rt) {
  const { ctx } = rt

  // 业务动作分发表：endpoint -> async (payload) => result
  const actions = {
    // ---- 概览 ----
    'overview': async () => ({
      roles: rt.listRoles().length,
      groups: (rt.listGroups() ?? []).length,
      tasks: (rt.listTasks() ?? []).length,
      messages: (rt.listGroups() ?? []).reduce((sum, g) => sum + rt.groupMessageCount(g.id), 0),
    }),

    // 可选模型目录（人员创建/编辑时选择；值格式 "provider/model"）。
    'models.list': async () => {
      const catalog = await ctx.sessionController.modelCatalog()
      const models = []
      for (const group of catalog?.groups ?? []) {
        for (const m of group.models ?? []) {
          models.push({ id: `${group.id}/${m.id}`, label: `${m.name || m.id} · ${group.name || group.id}` })
        }
      }
      const def = catalog?.default
      return { models, default: def ? `${def.provider}/${def.model}` : '' }
    },

    // ---- 角色 ----
    'roles.list': async () => ({
      roles: rt.listRoles(),
      presets: PRESETS_FOR_UI,
    }),
    'roles.create': async (payload) => {
      const role = await rt.createRole({
        name: payload.name,
        type: payload.type,
        instructions: payload.instructions,
        model: payload.model || null,
      })
      return { role }
    },
    'roles.update': async (payload) => {
      const patch = payload.patch ?? {}
      const before = rt.getRole(payload.id)
      const role = rt.updateRole(payload.id, patch)
      // 模型或职责变化 → 同步到该人员的 Session（模型选择 + 职责刷新消息）。
      if (role?.sessionId) {
        if (patch.model !== undefined && patch.model !== before?.model) {
          await rt.applySessionModel?.(role.sessionId, role.model)
        }
        if (patch.instructions !== undefined && patch.instructions !== before?.instructions) {
          await rt.sendRoleContextMessage?.(role)
          await rt.syncDutyToGroups?.(role)
        }
      }
      return { role }
    },
    'roles.setStatus': async (payload) => ({ role: await rt.setRoleStatus(payload.id, payload.status) }),
    'roles.delete': async (payload) => {
      const result = rt.deleteRole(payload.id)
      if (result.refused && payload.force) {
        return rt.forceDeleteRole(payload.id)
      }
      return result
    },

    // ---- 群组 ----
    // 返回精简字段（不含 log/seen），并附最后一条消息预览/时间/发送者与总 seq（供未读计算）。
    'groups.list': async () => {
      const groups = (rt.listGroups() ?? []).map((group) => {
        const lines = rt.groupTranscript(group.id)
        const last = lines.length > 0 ? lines[lines.length - 1] : null
        return {
          id: group.id,
          name: group.name,
          prefix: group.prefix,
          members: group.members ?? [],
          memberNames: (group.members ?? []).map(id => rt.getRole(id)?.name ?? id),
          admins: group.admins ?? [],
          adminNames: (group.admins ?? []).map(id => rt.getRole(id)?.name ?? id),
          notice: group.notice ?? '',
          workspaceId: group.workspaceId ?? null,
          dir: group.dir,
          status: group.status,
          createdAt: group.createdAt,
          messageCount: rt.groupMessageCount(group.id),
          seq: group.seq ?? 0,
          lastMessage: String(last?.text ?? '').replace(/\s+/g, ' ').slice(0, 80)
            || (last?.attachments?.length ? `📎 ${last.attachments[0].name}${last.attachments.length > 1 ? ` 等 ${last.attachments.length} 个文件` : ''}` : ''),
          lastTime: last?.time ?? null,
          lastFrom: last?.fromName ?? '',
        }
      })
      return { groups }
    },
    'groups.create': async (payload) => {
      // 工作目录必选：不再提供"留空 = 静默创建默认目录"路径——
      // 用户必须显式指定群文件（含附件）的存放位置。
      if (!payload.customDir || !String(payload.customDir).trim()) {
        throw new Error('必须选择工作目录：请指定已有目录，或输入新路径（不存在会自动创建）')
      }
      const group = await rt.createGroup({
        name: payload.name ?? payload.prefix,
        members: payload.members ?? [],
        admins: payload.admins ?? [],
        notice: payload.notice ?? '',
        withDir: false,
        customDir: String(payload.customDir).trim(),
      })
      return { group }
    },
    'groups.update': async (payload) => ({
      group: await rt.updateGroupMeta(payload.id, {
        name: payload.name,
        notice: payload.notice,
        admins: payload.admins,
        members: payload.members,
      }),
    }),
    'groups.rename': async (payload) => ({ group: await rt.renameGroup(payload.id, payload.name ?? payload.prefix) }),
    'groups.delete': async (payload) => rt.deleteGroup(payload.id),

    // ---- 目录选择（代理 DSH 原生 directoryPickerController，供建群指定自定义工作目录） ----
    'directory.pick': async () => {
      const picker = ctx.get?.('directoryPickerController') ?? ctx.directoryPickerController
      if (!picker) throw new Error('目录选择器不可用')
      const path = await picker.pick(AbortSignal.timeout(120000))
      return { path }
    },
    'directory.list': async (payload) => {
      const picker = ctx.get?.('directoryPickerController') ?? ctx.directoryPickerController
      if (!picker) throw new Error('目录选择器不可用')
      const listing = await picker.list(payload.path, AbortSignal.timeout(10000))
      return { listing }
    },
    'directory.create': async (payload) => {
      const picker = ctx.get?.('directoryPickerController') ?? ctx.directoryPickerController
      if (!picker) throw new Error('目录选择器不可用')
      const path = await picker.createDirectory(payload.parentPath, payload.name)
      return { path }
    },


    // Read-only approval projection. No approval answer endpoint is exposed.
    'approvals.list': async (payload) => rt.groupApprovals(payload.groupId),

    // ---- 运行态 / 停止 ----
    'activity.list': async (payload) => ({ activity: await rt.activityList(payload?.groupId) }),
    'people.stop': async (payload) => rt.stopPerson(payload.groupId, payload.roleId),

    // ---- 记忆 ----
    'memory.list': async (payload) => rt.memoryList(payload.roleId),
    'memory.add': async (payload) => ({
      count: await rt.memoryAdd(payload.roleId, payload.scope ?? 'me', payload.text),
    }),
    'memory.remove': async (payload) => ({
      count: await rt.memoryRemove(payload.roleId, payload.scope ?? 'me', payload.index),
    }),

    // ---- 任务 ----
    'tasks.list': async (payload) => {
      const tasks = rt.listTasks(payload?.groupId).map(task => ({
        ...task,
        assigneeNames: (task.assignees ?? []).map(id => rt.getRole(id)?.name ?? id),
        groupName: rt.getGroup(task.groupId)?.name ?? task.groupId,
      }))
      return { tasks }
    },
    'tasks.create': async (payload) => ({
      task: await rt.createTask({
        title: payload.title,
        description: payload.description,
        groupId: payload.groupId,
        assignees: payload.assignees ?? [],
        priority: payload.priority,
        dependencies: payload.dependencies,
        fromRoleId: payload.fromRoleId,
      }),
    }),
    'tasks.update': async (payload) => ({ task: await rt.updateTask(payload.id, payload.patch ?? {}) }),

    'execution.status': async (payload) => ({error:rt.executionError??null,runs:rt.executionRuns(payload?.taskId).slice(-100),
      projects:rt.listGroups().filter(g=>!payload?.groupId || g.id===payload.groupId).map(g=>({groupId:g.id,delivery:g.delivery??null,workItemSync:g.workItemSync??null})),
      reviewOutbox:(rt.state.execution?.reviewOutbox??[]).filter(n=>!payload?.groupId || n.groupId===payload.groupId).slice(-100)}),
    'execution.retry': async (payload) => ({runs:await rt.retryExecution(payload.taskId)}),
    'execution.stop': async (payload) => ({runs:await rt.stopTaskExecution(payload.taskId)}),
    'decisions.resolve': async (payload) => ({decision:await rt.resolveDecision(payload.groupId,payload.answer,payload.seq)}),

    // ---- 协作工作台版本检查（只读；不注册 Agent 工具，也没有安装接口） ----
    'updates.check': async (payload) => rt.updateCheck({ fresh: payload.fresh === true }),

    // ---- 群消息 ----
    'messages.post': async (payload) => ({
      result: await rt.postGroupMessage({
        groupId: payload.groupId,
        text: payload.text,
        fromRoleId: payload.fromRoleId,
        attachments: payload.attachments,
        taskId: payload.taskId,
        replyToSeq: payload.replyToSeq,
        decisionSeq: payload.decisionSeq,
      }),
    }),
    'messages.transcript': async (payload) => ({
      lines: rt.groupTranscript(payload.groupId, payload.sinceSeq ?? 0),
      // 附带活跃成员（工作指示器数据源——跟随消息轮询，无需单独调用）
      activity: await rt.activityList?.(payload.groupId) ?? [],
    }),

    // ---- 群附件（＋ 号上传：落入群目录「附件/」，发送前可移除） ----
    'files.upload': async (payload) => ({
      file: await rt.uploadGroupFile({
        groupId: payload.groupId,
        name: payload.name,
        base64: payload.base64,
      }),
    }),
    'files.remove': async (payload) => rt.removeGroupFile({
      groupId: payload.groupId,
      path: payload.path,
    }),
  }

  ctx.connection.fetch.register({
    path: '/api/dsh-workbench',
    methods: ['POST'],
    requestBody: 'buffered',
    fetch: async (request) => {
      const respond = (status, body) => new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
      })
      try {
        const raw = await request.text()
        const body = raw ? JSON.parse(raw) : {}
        const { endpoint, payload } = body
        const handler = actions[endpoint]
        if (!handler) return respond(404, { ok: false, error: `未知端点: ${endpoint}` })
        await rt.loadAll()
        await rt.executionReady
        const data = await handler(payload ?? {})
        return respond(200, { ok: true, data })
      } catch (error) {
        return respond(400, { ok: false, error: error?.message ?? String(error) })
      }
    },
  })
}

// UI 展示用的预设模板（去内部字段）。
const PRESETS_FOR_UI = [
  { type: '研发负责人', instructions: '接收需求、分解任务、协调进度、验收交付。' },
  { type: '架构师', instructions: '技术方案设计、架构评审。' },
  { type: '高级工程师', instructions: '代码实现、联调、自测。' },
  { type: '测试工程师', instructions: '测试用例设计、质量验证。' },
  { type: '产品经理', instructions: '需求澄清、验收标准定义、价值把关。' },
]
