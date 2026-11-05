// tools.js —— 工作台业务工具注册（P2 角色 + P3 群组）。
// 契约：@deepseek-ai/dsh-tools 的 defineTool（output 为 { schema, render }）。
import { defineTool } from '@deepseek-ai/dsh-tools'
import { PRESET_ROLES } from './agents.js'

const OUTPUT = {
  schema: { type: 'string' },
  render: (_args, value) => [{ type: 'text', text: String(value) }],
}

export function install(rt) {
  const { ctx } = rt

  // ================= 角色工具（P2） =================

  ctx.tools.register(defineTool({
    name: 'dwb_create_role',
    description: '创建一个工作台角色（Agent Session + 台账登记）。输入 name 角色名、type 预设类型或自定义、instructions 职责描述。',
    parameters: {
      name: { type: 'string', description: '角色名称，如 工程师A', required: true },
      type: { type: 'string', description: '角色类型：预设或自定义，如 高级工程师' },
      instructions: { type: 'string', description: '职责描述' },
    },
    output: OUTPUT,
    async execute(args) {
      await rt.loadAll()
      const role = await rt.createRole({
        name: args.name,
        type: args.type,
        instructions: args.instructions,
      })
      return [
        '角色已创建：',
        `- id: ${role.id}`,
        `- 名称: ${role.name}`,
        `- 类型: ${role.type}`,
        `- Session: ${role.sessionId}`,
      ].join('\n')
    },
  }))

  ctx.tools.register(defineTool({
    name: 'dwb_list_roles',
    description: '列出工作台全部角色：名称、类型、模型、状态、所属群组数。',
    parameters: {},
    output: OUTPUT,
    async execute() {
      await rt.loadAll()
      const roles = rt.listRoles()
      if (roles.length === 0) return '暂无角色。可用 dwb_create_role 新建。'
      const lines = roles.map(role => {
        const groups = (rt.listGroups() ?? []).filter(g => (g.members ?? []).includes(role.id)).length
        return `- ${role.name}（${role.type}）[${role.status}] ${role.model ?? '默认模型'} · 群组 ${groups} 个`
      })
      return ['角色列表：', ...lines].join('\n')
    },
  }))

  ctx.tools.register(defineTool({
    name: 'dwb_update_role',
    description: '编辑角色：可改名称、职责描述、模型。',
    parameters: {
      id: { type: 'string', description: '角色 id（dwb_list_roles 可见）', required: true },
      name: { type: 'string', description: '新角色名' },
      instructions: { type: 'string', description: '新职责描述' },
      model: { type: 'string', description: '新模型' },
    },
    output: OUTPUT,
    async execute(args) {
      await rt.loadAll()
      const patch = {}
      if (args.name !== undefined) patch.name = args.name
      if (args.instructions !== undefined) patch.instructions = args.instructions
      if (args.model !== undefined) patch.model = args.model
      if (Object.keys(patch).length === 0) return '未提供任何要修改的字段。'
      const updated = rt.updateRole(args.id, patch)
      return `角色已更新：${updated.name}（${updated.type}）[${updated.status}]`
    },
  }))

  ctx.tools.register(defineTool({
    name: 'dwb_set_role_status',
    description: '停用或启用一个角色。停用后角色不参与新的群组与任务。',
    parameters: {
      id: { type: 'string', description: '角色 id', required: true },
      status: { type: 'string', enum: ['active', 'disabled'], description: '目标状态', required: true },
    },
    output: OUTPUT,
    async execute(args) {
      await rt.loadAll()
      const updated = await rt.setRoleStatus(args.id, args.status)
      return `角色 ${updated.name} 状态已设为 ${updated.status}`
    },
  }))

  ctx.tools.register(defineTool({
    name: 'dwb_delete_role',
    description: '删除一个角色。若角色仍在群组或任务中被引用，会返回拒绝原因。',
    parameters: {
      id: { type: 'string', description: '角色 id', required: true },
      force: { type: 'boolean', description: '是否强制删除（会同时从群组/任务中移除引用）' },
    },
    output: OUTPUT,
    async execute(args) {
      await rt.loadAll()
      const result = rt.deleteRole(args.id)
      if (result.refused) {
        if (args.force) {
          const result = await rt.forceDeleteRole(args.id)
          return `角色 ${result.role} 已强制删除，并已停止相关执行。`
        }
        return `删除被拒绝：${result.reason}。如需强制删除，请传入 force=true。`
      }
      return '角色已删除。'
    },
  }))

  ctx.tools.register(defineTool({
    name: 'dwb_list_presets',
    description: '列出工作台内置预设角色模板（研发负责人/架构师/高级工程师/测试工程师/产品经理）。',
    parameters: {},
    output: OUTPUT,
    async execute() {
      const lines = PRESET_ROLES.map(item => `- ${item.type}：${item.defaultInstructions}`)
      return ['预设角色模板：', ...lines].join('\n')
    },
  }))

  // ================= 群组工具（P3） =================

  ctx.tools.register(defineTool({
    name: 'dwb_create_group',
    description: '新建一个研发群组。name 为群组名称（原样使用）；members 为成员角色 id 列表（至少 1 人）；dir 为工作目录（必填：不存在会自动创建，成员在其中读取资料/存放成果物，群附件也存于此）。',
    parameters: {
      name: { type: 'string', description: '群组名称，如 ERP项目、登录系统', required: true },
      members: { type: 'array', items: { type: 'string' }, description: '成员角色 id 列表，至少 1 人' },
      dir: { type: 'string', description: '工作目录绝对路径（必填；不存在会自动创建；删除群组时该目录保留）', required: true },
      admins: { type: 'array', items: { type: 'string' }, description: '管理员人员 id 列表（必须是 members 子集；普通消息先投递管理员）' },
      notice: { type: 'string', description: '群公告（成员每次发言前都会读到）' },
    },
    output: OUTPUT,
    async execute(args) {
      await rt.loadAll()
      if (!args.dir || !String(args.dir).trim()) {
        return '创建失败：必须指定工作目录（dir 参数，绝对路径；不存在会自动创建）。'
      }
      const group = await rt.createGroup({
        name: args.name ?? args.prefix,
        members: args.members,
        admins: args.admins ?? [],
        notice: args.notice ?? '',
        withDir: false,
        customDir: String(args.dir).trim(),
      })
      return [
        '群组已创建：',
        `- id: ${group.id}`,
        `- 名称: ${group.name}`,
        `- 成员: ${group.members.map(id => rt.getRole(id)?.name ?? id).join(', ')}`,
        `- 目录: ${group.dir}`,
      ].join('\n')
    },
  }))

  ctx.tools.register(defineTool({
    name: 'dwb_list_groups',
    description: '列出全部群组：名称、成员、目录、状态。',
    parameters: {},
    output: OUTPUT,
    async execute() {
      await rt.loadAll()
      const groups = rt.listGroups()
      if (groups.length === 0) return '暂无群组。可用 dwb_create_group 新建。'
      const lines = groups.map(group => {
        const members = (group.members ?? []).map(id => rt.getRole(id)?.name ?? id).join(', ')
        return `- ${group.name} [${group.status}] · 成员: ${members} · ${group.dir ?? '无目录'}`
      })
      return ['群组列表：', ...lines].join('\n')
    },
  }))

  ctx.tools.register(defineTool({
    name: 'dwb_rename_group',
    description: '重命名群组（新名称原样使用）。同名工作目录会同步改名，保证一致。',
    parameters: {
      id: { type: 'string', description: '群组 id', required: true },
      name: { type: 'string', description: '新群组名称', required: true },
    },
    output: OUTPUT,
    async execute(args) {
      await rt.loadAll()
      const group = await rt.renameGroup(args.id, args.name ?? args.prefix)
      return `群组已重命名为 ${group.name}，目录已同步：${group.dir}`
    },
  }))

  ctx.tools.register(defineTool({
    name: 'dwb_delete_group',
    description: '删除群组。同时删除同名工作目录及全部文件、群内所有任务。此操作不可撤销。',
    parameters: {
      id: { type: 'string', description: '群组 id', required: true },
    },
    output: OUTPUT,
    async execute(args) {
      const result = await rt.deleteGroup(args.id)
      return `群组「${result.name}」已删除（目录 ${result.dir ?? '无'}）`
    },
  }))

  // ================= 群消息工具（P4） =================

  ctx.tools.register(defineTool({
    name: 'dwb_post_group_message',
    description: '向群组发送需行动的 @协调或关键结论。负责人统一启动与交付，不发逐人开工、收到或无变化进度；独立执行结果用 dwb_report_execution 自动回执，不重复发帖。',
    parameters: {
      groupId: { type: 'string', description: '群组 id（dwb_list_groups 可见）', required: true },
      text: { type: 'string', description: '必要结论或行动请求，最多150字；细节放文档，可含 @角色名', required: true },
      fromRoleId: { type: 'string', description: '发送者角色 id（成员发言时填；用户发言留空）' },
      taskId: { type: 'string', description: '关联任务 id；执行成员默认当前任务，后续消息直达其执行者' },
      replyToSeq: { type: 'integer', description: '回复的群消息序号；继承该消息的任务归属' },
    },
    output: OUTPUT,
    async execute(args) {
      const result = await rt.postGroupMessage({
        groupId: args.groupId,
        text: args.text,
        fromRoleId: args.fromRoleId,
        taskId: args.taskId,
        replyToSeq: args.replyToSeq,
      })
      const group = rt.getGroup(args.groupId)
      const targetNames = result.delivered.map(id => rt.getRole(id)?.name ?? id).join(', ')
      return [
        `已在群组「${group.name}」发言（seq=${result.seq}）`,
        result.mentions.length > 0 ? `@ 到：${result.mentions.join(', ')}` : '按任务归属或群管理员路由',
        `投递角色：${targetNames || '无'}`,
        result.errors?.length ? `投递失败：${JSON.stringify(result.errors)}` : '',
      ].join('\n')
    },
  }))

  ctx.tools.register(defineTool({
    name: 'dwb_group_transcript',
    description: '读取群组消息流（可用于查看群组历史）。',
    parameters: {
      groupId: { type: 'string', description: '群组 id', required: true },
      sinceSeq: { type: 'integer', description: '从某个 seq 之后开始（默认 0=全部）' },
    },
    output: OUTPUT,
    async execute(args) {
      await rt.loadAll()
      const lines = rt.groupTranscript(args.groupId, args.sinceSeq ?? 0)
      if (lines.length === 0) return '群组暂无消息。'
      return lines.map(line => `[seq ${line.seq}] ${line.fromName}: ${line.text}`).join('\n')
    },
  }))

  ctx.tools.register(defineTool({
    name: 'dwb_ask_user',
    description: '向用户请求决策（唯一正确方式）。调用后决策卡会显示在群聊中，用户点击按钮回复。⚠️ 重要：调用此工具后你的本轮回复立即结束——不要再在你的会话输出中重复提问用户，用户不看你的会话，只看群聊。禁止使用任何其他方式（如直接输出问题文本、调用其他 ask 类工具）向用户提问。',
    parameters: {
      groupId: { type: 'string', description: '群组 id', required: true },
      question: { type: 'string', description: '要问用户的问题（简明扼要，一条问题）', required: true },
      options: { type: 'string', description: '可选项，用 | 分隔，如"A 单人无鉴权 | B 多用户+鉴权"。无固定选项可省略。' },
      fromRoleId: { type: 'string', description: '你的角色 id' },
    },
    output: OUTPUT,
    async execute(args, exec) {
      await rt.loadAll()
      await rt.executionReady
      // 🔒 去重：已有未回复的决策卡时拒绝重复发送。
      const grp = rt.getGroup(args.groupId)
      if (grp?.pendingDecision) {
        return `🛑 已有未回复的决策卡（seq ${grp.pendingDecision.seq}），不要重复发送。等待用户在群聊中回复那张卡即可。`
      }
      const opts = args.options ? `\n可选项：${args.options}` : ''
      const fromName = args.fromRoleId ? (rt.getRole(args.fromRoleId)?.name ?? '成员') : '成员'
      await rt.postGroupMessage({
        groupId: args.groupId,
        text: `⚠️ 需要您的决策（来自 ${fromName}）：\n${args.question}${opts}`,
        fromRoleId: args.fromRoleId,
        noWake: true, // 🔒 决策卡不唤醒任何人——它是给用户看的，AI 成员不需要处理
      })
      const run = rt.currentExecution?.()
      if (run) await rt.executionEngine.report(run.id, {status:'blocked',summary:`等待用户决策：${args.question}`})
      exec?.concludeTurn?.()
      return '决策卡已发到群聊。你的本轮回复到此结束——不要在会话中重复提问，等待用户在群聊中点击选项回复即可。'
    },
  }))

  ctx.tools.register(defineTool({
    name: 'dwb_report_progress',
    description: '管理员仅在重要节点、状态变化或风险出现时汇报进度，不重复成员回执或无变化状态；最终交付用 dwb_notify_user。',
    parameters: {
      groupId: { type: 'string', description: '群组 id', required: true },
      summary: { type: 'string', description: '最多150字，仅说明变化、影响及必要行动；无风险不凑风险栏', required: true },
      fromRoleId: { type: 'string', description: '你的角色 id', required: true },
    },
    output: OUTPUT,
    async execute(args) {
      const fromName = rt.getRole(args.fromRoleId)?.name ?? '管理员'
      // 写入群 log 但标记为 progress-report（不唤醒任何人）
      await rt.postGroupMessage({
        groupId: args.groupId,
        text: `📊 进度汇报（${fromName}）：\n${args.summary}`,
        fromRoleId: args.fromRoleId,
        noWake: true,
      })
      return '进度汇报已发送（仅用户可见，不影响群聊其他成员）。'
    },
  }))

  ctx.tools.register(defineTool({
    name: 'dwb_notify_user',
    description: '负责人在全部完成或最终交付时统一通知一次，不复述成员工作过程。',
    parameters: {
      groupId: { type: 'string', description: '群组 id', required: true },
      summary: { type: 'string', description: '结果、交付入口、验证情况及遗留问题，最多150字', required: true },
      fromRoleId: { type: 'string', description: '你的角色 id', required: true },
    },
    output: OUTPUT,
    async execute(args) {
      const result = await rt.completeDelivery(args)
      return result.duplicate ? '该任务版本已经交付，未重复通知用户。' : '已通知用户任务完成。'
    },
  }))

  // ================= 任务工具（P5） =================

  ctx.tools.register(defineTool({
    name: 'dwb_create_task',
    description: '创建任务并自动排队执行，按优先级和依赖调度；指派成员分别汇报结果，系统跟踪重试与完成。',
    parameters: {
      title: { type: 'string', description: '任务标题', required: true },
      description: { type: 'string', description: '任务描述' },
      groupId: { type: 'string', description: '所属群组 id', required: true },
      assignees: { type: 'array', items: { type: 'string' }, description: '指派工程师角色 id 列表（可多个并行）', required: true },
      priority: { type: 'string', enum: ['高', '中', '低'], description: '优先级，默认 中' },
      dependencies: { type: 'array', items: { type: 'string' }, description: '同群前置任务 id；全部完成后才启动，默认无依赖' },
      fromRoleId: { type: 'string', description: '创建者角色 id（任务通知显示创建者名）' },
    },
    output: OUTPUT,
    async execute(args) {
      // 🔒 决策阻塞：群内有未回复决策卡时，阻止建任务。
      const grp = rt.getGroup(args.groupId)
      if (grp?.pendingDecision) {
        return `🛑【被系统阻止】群内有未回复的决策卡（seq ${grp.pendingDecision.seq}），用户尚未拍板。在用户回复决策卡之前，不能创建新任务——新任务可能依赖未决事项。请先用 dwb_group_transcript 查看决策卡内容，等用户回复后再创建任务。`
      }
      const task = await rt.createTask({
        title: args.title,
        description: args.description,
        groupId: args.groupId,
        assignees: args.assignees,
        dependencies: args.dependencies,
        priority: args.priority,
        fromRoleId: args.fromRoleId,
      })
      const names = task.assignees.map(id => rt.getRole(id)?.name ?? id).join(', ')
      return [
        '任务已创建：',
        `- id: ${task.id}`,
        `- 标题: ${task.title}`,
        `- 优先级: ${task.priority}`,
        `- 指派: ${names}`,
        `- 群组: ${rt.getGroup(task.groupId)?.name}`,
        '- 已进入系统执行队列；用 dwb_task_execution 查看执行状态',
      ].join('\n')
    },
  }))

  ctx.tools.register(defineTool({
    name: 'dwb_list_tasks',
    description: '列出任务（可按群组过滤）：标题、优先级、状态、指派、群组。',
    parameters: {
      groupId: { type: 'string', description: '按群组过滤（可选）' },
    },
    output: OUTPUT,
    async execute(args) {
      await rt.loadAll()
      const tasks = rt.listTasks(args.groupId)
      if (tasks.length === 0) return '暂无任务。'
      const lines = tasks.map(task => {
        const names = (task.assignees ?? []).map(id => rt.getRole(id)?.name ?? id).join(', ')
        const groupName = rt.getGroup(task.groupId)?.name ?? task.groupId
        return `- ${task.id} [${task.priority}] ${task.title}（${task.status}）· 指派: ${names} · ${groupName}${task.executionSummary ? ' · '+task.executionSummary : ''}`
      })
      return ['任务列表：', ...lines].join('\n')
    },
  }))

  ctx.tools.register(defineTool({
    name: 'dwb_update_task',
    description: '修改任务范围、指派、优先级、依赖或人工状态；执行成员通过 dwb_report_execution 汇报自己的结果。',
    parameters: {
      id: { type: 'string', description: '任务 id', required: true },
      title: { type: 'string', description: '新标题' },
      description: { type: 'string', description: '新描述' },
      assignees: { type: 'array', items: { type: 'string' }, description: '新指派列表' },
      priority: { type: 'string', enum: ['高', '中', '低'], description: '新优先级' },
      status: { type: 'string', enum: ['待办', '进行中', '已完成'], description: '新状态' },
      dependencies: { type: 'array', items: { type: 'string' }, description: '同群前置任务 id；空数组移除依赖' },
      fromRoleId: { type: 'string', description: '操作者角色 id（通知显示操作者名）' },
    },
    output: OUTPUT,
    async execute(args) {
      const patch = {}
      if (args.title !== undefined) patch.title = args.title
      if (args.description !== undefined) patch.description = args.description
      if (args.assignees !== undefined) patch.assignees = args.assignees
      if (args.priority !== undefined) patch.priority = args.priority
      if (args.status !== undefined) patch.status = args.status
      if (args.dependencies !== undefined) patch.dependencies = args.dependencies
      if (Object.keys(patch).length === 0) return '未提供任何要修改的字段。'
      const updated = await rt.updateTask(args.id, patch, { fromRoleId: args.fromRoleId })
      return `任务「${updated.title}」已更新 [${updated.status}]`
    },
  }))

  // ================= 命令工具（P8 辅助入口） =================

  ctx.tools.register(defineTool({
    name: 'dwb_command_new_project',
    description: '快捷建项目：输入项目名称与成员，一步完成「建群 + 同名目录脚手架 + 首个任务」。',
    parameters: {
      name: { type: 'string', description: '项目名称（直接作为群组名与目录名）', required: true },
      members: { type: 'array', items: { type: 'string' }, description: '成员角色 id 列表', required: true },
      firstTask: { type: 'string', description: '首个任务标题（可选）' },
    },
    output: OUTPUT,
    async execute(args) {
      await rt.loadAll()
      const group = await rt.createGroup({ name: args.name ?? args.prefix, members: args.members })
      const lines = [
        `项目已建立：${group.name}`,
        `- 群组: ${group.id}`,
        `- 目录: ${group.dir}`,
      ]
      if (args.firstTask) {
        const task = await rt.createTask({
          title: args.firstTask,
          groupId: group.id,
          assignees: args.members,
        })
        lines.push(`- 首个任务: ${task.title}（已自动 @ 成员）`)
      }
      return lines.join('\n')
    },
  }))

  ctx.tools.register(defineTool({
    name: 'dwb_command_status',
    description: '工作台状态概览：角色/群组/任务/消息计数。',
    parameters: {},
    output: OUTPUT,
    async execute() {
      await rt.loadAll()
      const roles = rt.listRoles()
      const groups = rt.listGroups()
      const tasks = rt.listTasks()
      const messages = (groups ?? []).reduce((sum, g) => sum + rt.groupMessageCount(g.id), 0)
      return [
        '工作台状态：',
        `- 角色: ${roles.length}（活跃 ${roles.filter(r => r.status === 'active').length}）`,
        `- 群组: ${groups.length}`,
        `- 任务: ${tasks.length}（待办 ${tasks.filter(t => t.status === '待办').length} / 进行中 ${tasks.filter(t => t.status === '进行中').length} / 已完成 ${tasks.filter(t => t.status === '已完成').length}）`,
        `- 群消息: ${messages} 条`,
      ].join('\n')
    },
  }))

  ctx.tools.register(defineTool({
    name: 'dwb_command_archive',
    description: '列出群组任务完成度（可据此判断归档候选）。',
    parameters: {
      groupId: { type: 'string', description: '按群组过滤（可选）' },
    },
    output: OUTPUT,
    async execute(args) {
      await rt.loadAll()
      const groups = (rt.listGroups() ?? []).filter(g => !args.groupId || g.id === args.groupId)
      if (groups.length === 0) return '无符合条件的群组。'
      const lines = groups.map(group => {
        const tasks = rt.listTasks(group.id)
        const done = tasks.filter(t => t.status === '已完成').length
        const rate = tasks.length ? Math.round(done / tasks.length * 100) : 100
        return `- ${group.name}：任务 ${tasks.length} · 已完成 ${done}（${rate}%）`
      })
      return ['群组完成度：', ...lines].join('\n')
    },
  }))
}
