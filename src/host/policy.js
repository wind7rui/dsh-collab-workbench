// policy.js —— 工作台规范（职责字段只存纯净内容，不注入模板）。
// 若把「工作台铁律」模板写进 role.instructions，会导致：
//   a) 序号错乱（rules[3] 误覆盖第 3 条）、职责行重复；
//   b) 编辑弹窗带着模板往返存储，越改越乱。
// 因此 instructions 只存用户职责；历史损坏数据由 migrateRoleInstructions 清洗。
export const MESSAGE_POLICY = '群聊只发需要用户知道、决定或处理的信息：负责人统一启动一次，仅重要变化汇报进度，最终交付一次（结果、入口、验证情况及遗留问题）；成员不逐个宣告开工、不发收到/确认、不重复转述。开发报结果与验证，测试报通过与否、覆盖范围及未解决风险，产品/架构只报影响范围或实现方向的关键结论。独立执行用 dwb_report_execution 留存完整摘要与 evidence，系统生成简短回执，不再另发同一成果或阻塞；普通执行中状态不刷群。仅需对方行动时 @协调；阻塞说明问题、影响及需要谁做什么，相同阻塞不重复播报。决策说明问题、推荐选项和主要影响，需求明确不二次确认。普通消息尽量 100 字、最多 150 字；技术细节和完整证据留在文档/任务记录，通过 dwb_task_execution 查询。'

export const IRON_RULES = [
  '所有沟通只发生在群组中，用 @角色名 点名；',
  '不存在任何一对一私聊通道；',
  '收到群消息后，把结论/进展/疑问回复到群组，保持群内可见。',
]

// 清洗历史注入的模板：去掉铁律 boilerplate，提取纯职责。
// 兼容损坏样本（缺第3条、职责行重复、序号 3/4 不一）：
// 取所有「N. 你的角色职责：」行中第一个冒号后非空的内容作为纯职责。
export function sanitizeInstructions(text) {
  const raw = String(text ?? '')
  if (!raw.includes('【工作台铁律】')) return raw
  const lines = raw.split('\n')
  for (const line of lines) {
    const m = line.trim().match(/^\d+\.\s*你的角色职责：(.*)$/)
    if (m && m[1].trim()) return m[1].trim()
  }
  return ''
}

export function install(rt) {
  // 一次性迁移：清洗所有角色的 instructions（幂等，重启安全）。
  rt.migrateRoleInstructions = () => {
    let changed = false
    for (const role of rt.state.roles.items) {
      const clean = sanitizeInstructions(role.instructions ?? '')
      if (clean !== (role.instructions ?? '')) {
        role.instructions = clean
        role.updatedAt = Date.now()
        changed = true
      }
    }
    if (changed) rt.touch()
    return changed
  }
}
