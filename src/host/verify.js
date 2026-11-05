// verify.js —— P1 健康检查工具。
// 仅保留 dwb_verify（业务工具集中在 tools.js）。
import { readFile } from 'node:fs/promises'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { PRESET_ROLES } from './agents.js'

const OUTPUT = {
  schema: { type: 'string' },
  render: (_args, value) => [{ type: 'text', text: String(value) }],
}

export function install(rt) {
  const { ctx } = rt

  ctx.tools.register(defineTool({
    name: 'dwb_verify',
    description: '协作工作台插件健康检查：报告插件版本、台账文件、角色/群组/任务计数。',
    parameters: {},
    output: OUTPUT,
    async execute() {
      await rt.loadAll()
      const roles = rt.listRoles()
      const groups = rt.listGroups()
      const tasks = rt.listTasks()
      // 版本从 package.json 读取（运行中进程实际加载的副本），
      // 用于确认重启后新版本已生效。
      let version = 'unknown'
      try {
        const pkg = JSON.parse(await readFile(new URL('../../package.json', import.meta.url), 'utf8'))
        version = pkg.version
      } catch { /* 读取失败不影响健康检查 */ }
      return [
        '协作工作台健康检查',
        `- 插件版本：${version}`,
        `- 插件已加载：是`,
        `- 台账路径：${rt.ledgerPath()}`,
        `- 角色数：${roles.length}`,
        `- 群组数：${groups.length}`,
        `- 任务数：${tasks.length}`,
        `- 预设角色模板：${PRESET_ROLES.map(item => item.type).join(' / ')}`,
      ].join('\n')
    },
  }))
}
