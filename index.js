// 协作工作台：以角色（Agent Session）与项目群组为中心的协作插件。
// 提供角色管理、群组管理、任务调度与群聊界面，不提供一对一私聊。
//
// 运行方式：
//   - 每个角色对应一个由 sessionController.create 创建的 Session；
//   - 群组消息流 = 自研 room 结构 + createUserMessage + agent.followup/steer；
//   - 台账 = JSON 文件，持久化于 $DSH_HOME/dsh-workbench/。
import { homedir } from 'node:os'
import { join } from 'node:path'
import * as ledger from './src/host/ledger.js'
import * as agents from './src/host/agents.js'
import * as groups from './src/host/groups.js'
import * as channels from './src/host/channels.js'
import * as tasks from './src/host/tasks.js'
import * as files from './src/host/files.js'
import * as policy from './src/host/policy.js'
import * as memory from './src/host/memory.js'
import * as api from './src/host/api.js'
import * as update from './src/host/update.js'
import * as tools from './src/host/tools.js'
import * as executionTools from './src/host/execution-tools.js'
import * as execution from './src/host/execution.js'
import * as approvals from './src/host/approvals.js'
import * as delivery from './src/host/delivery.js'
import * as workItemSync from './src/host/work-item-sync.js'
import * as verify from './src/host/verify.js'

export const name = 'dsh-workbench'

// P1 最小依赖：会话创建/解析、会话标题、工具注册。
// 后续 P3/P4 会补充 storage 等。
export const inject = [
  'sessionController',
  'sessionProjections',
  'sessions',
  'sessionTitle',
  'workspaceRegistry',
  'tools',
  'llm',
  'connection',
]

export function apply(ctx, config = {}) {
  const home = config.home ?? join(process.env.DSH_HOME ?? join(homedir(), '.dsh'), 'dsh-workbench')
  const rt = {
    ctx,
    config,
    home,
    statePath: join(home, 'state.json'),
    rolesPath: join(home, 'roles.json'),
    groupsPath: join(home, 'groups.json'),
    tasksPath: join(home, 'tasks.json'),
  }

  // 台账模块（roles/groups/tasks 三个 JSON 文件的读写）。
  ledger.install(rt)
  // 角色 Session 创建（最小版：create + resolveAgent + 命名）。
  agents.install(rt)
  // 常驻铁律提示（角色职责中注入工作台规范）。
  policy.install(rt)
  // 群组管理（命名校验 + 建群 + 同名目录脚手架 + 改名同步）。
  groups.install(rt)
  // 群消息流与 @ 投递（唯一沟通通道，杜绝单发消息）。
  channels.install(rt)
  // 任务管理（多工程师指派 + 优先级 + 自动 @ 投递）。
  tasks.install(rt)
  // 群附件（＋ 号上传 → 群目录「附件/」→ 消息文件卡片）。
  files.install(rt)
  // 记忆（个人+团队，工具+RPC）。
  memory.install(rt)
  execution.install(rt)
  delivery.install(rt)
  workItemSync.install(rt)
  approvals.install(rt)
  update.install(rt)
  // RPC API（/api/dsh-workbench，供 client UI 调用）。
  api.install(rt)
  // 工作台工具注册（角色/群组 CRUD 等）。
  tools.install(rt)
  executionTools.install(rt)
  // 验证工具（dwb_verify / dwb_create_role），确认插件可加载、台账可读写、角色可创建。
  verify.install(rt)

  rt.startExecution()
}
