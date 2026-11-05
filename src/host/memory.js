// memory.js —— 记忆（个人记忆 + 团队记忆，Markdown 存储，工具 + RPC 管理）。
// 格式（参考 AgentMemoryRepo 行格式，自研实现）：
//   每条一行：`- 内容 [added: YYYY-MM-DD]`
// 存储：$home/memory/person-<id>/MEMORY.md 与 $home/memory/team/MEMORY.md
// 注入：群会话种子消息带记忆摘要；工具 dwb_remember/dwb_forget/dwb_recall 供人员随时读写。
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { join } from 'node:path'

const MAX_ENTRIES = 200 // 每个作用域条目上限
const MAX_LINE = 300 // 单条最多 300 字符

function today() {
  const d = new Date()
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

export function install(rt) {
  const { ctx } = rt

  const memRoot = () => join(rt.home, 'memory')
  const personPath = (roleId) => join(memRoot(), `person-${roleId}`, 'MEMORY.md')
  const teamPath = () => join(memRoot(), 'team', 'MEMORY.md')

  async function readScope(path) {
    try {
      const raw = await readFile(path, 'utf8')
      return raw.split('\n')
        .map(l => l.trim())
        .filter(l => l.startsWith('- '))
        .map(l => {
          const m = l.match(/^- (.*) \[added: (\d{4}-\d{2}-\d{2})\]$/)
          if (m) return { text: m[1], added: m[2] }
          // 容错：无日期尾注的行
          return { text: l.slice(2).replace(/ \[added: [^\]]*\]$/, ''), added: '' }
        })
    } catch {
      return []
    }
  }

  async function writeScope(path, entries) {
    await mkdir(join(path, '..'), { recursive: true })
    const body = entries.slice(0, MAX_ENTRIES)
      .map(e => `- ${e.text} [added: ${e.added || today()}]`)
      .join('\n')
    await writeFile(path, body ? body + '\n' : '', 'utf8')
  }

  const scopePath = (scope, roleId) => (scope === 'team' ? teamPath() : personPath(roleId))

  // ---- RPC 面（client 记忆面板） ----
  rt.memoryList = async (roleId) => ({
    own: roleId ? await readScope(personPath(roleId)) : [],
    team: await readScope(teamPath()),
  })
  rt.memoryAdd = async (roleId, scope, text) => {
    const clean = String(text ?? '').trim().slice(0, MAX_LINE)
    if (!clean) throw new Error('记忆内容不能为空')
    if (/api[_-]?key|password|token|secret|密钥|密码/i.test(clean)) {
      throw new Error('记忆不允许保存密钥/密码类内容')
    }
    const path = scopePath(scope, roleId)
    const entries = await readScope(path)
    if (entries.length >= MAX_ENTRIES) throw new Error(`记忆已达上限（${MAX_ENTRIES} 条），请先清理`)
    entries.push({ text: clean, added: today() })
    await writeScope(path, entries)
    return entries.length
  }
  rt.memoryRemove = async (roleId, scope, index) => {
    const path = scopePath(scope, roleId)
    const entries = await readScope(path)
    if (index < 0 || index >= entries.length) throw new Error('条目不存在')
    entries.splice(index, 1)
    await writeScope(path, entries)
    return entries.length
  }

  // 种子消息用的记忆摘要（各作用域最多取 12 条）。
  rt.memoryDigest = async (roleId) => {
    const [own, team] = await Promise.all([
      readScope(personPath(roleId)),
      readScope(teamPath()),
    ])
    const parts = []
    if (own.length > 0) parts.push(`【你的记忆】\n${own.slice(-12).map(e => `- ${e.text}`).join('\n')}`)
    if (team.length > 0) parts.push(`【团队记忆】\n${team.slice(-12).map(e => `- ${e.text}`).join('\n')}`)
    return parts.join('\n')
  }

  // ---- 人员工具面 ----
  const OUTPUT = {
    schema: { type: 'string' },
    render: (_args, value) => [{ type: 'text', text: String(value) }],
  }

  ctx.tools.register(defineTool({
    name: 'dwb_remember',
    description: '保存一条记忆（跨对话持久）。scope=me 存入你的个人记忆，scope=team 存入团队共享记忆（管理员/群管理员可用）。单条 ≤300 字符，禁止保存密钥/密码。',
    parameters: {
      text: { type: 'string', description: '要记住的内容（偏好/决策/纠错/事实）', required: true },
      scope: { type: 'string', enum: ['me', 'team'], description: 'me=个人（默认），team=团队共享' },
      roleId: { type: 'string', description: '你的角色 id（dwb_post_group_message 同款）' },
    },
    output: OUTPUT,
    async execute(args) {
      const me = args.roleId ?? currentRoleId.get()
      if (!me) return '请提供你的 roleId'
      if (args.scope === 'team') {
        // 团队记忆：管理员或任意群管理员可写
        const role = rt.getRole(me)
        const isAdmin = (rt.listGroups() ?? []).some(g => (g.admins ?? []).includes(me))
        if (!isAdmin && role?.type !== '研发负责人') {
          return '团队记忆仅管理员可写；个人记忆请用 scope=me'
        }
      }
      const n = await rt.memoryAdd(me, args.scope ?? 'me', args.text)
      return `已记住（${args.scope === 'team' ? '团队' : '个人'}，共 ${n} 条）`
    },
  }))

  ctx.tools.register(defineTool({
    name: 'dwb_forget',
    description: '删除一条记忆：给出要删除内容的完整原文或前缀。',
    parameters: {
      text: { type: 'string', description: '要删除的记忆内容（原文或明显前缀）', required: true },
      roleId: { type: 'string', description: '你的角色 id' },
    },
    output: OUTPUT,
    async execute(args) {
      const me = args.roleId ?? currentRoleId.get()
      if (!me) return '请提供你的 roleId'
      for (const scope of ['me', 'team']) {
        const path = scopePath(scope, me)
        const entries = await readScope(path)
        const idx = entries.findIndex(e => e.text === args.text || e.text.startsWith(args.text))
        if (idx >= 0) {
          entries.splice(idx, 1)
          await writeScope(path, entries)
          return `已从${scope === 'team' ? '团队' : '个人'}记忆删除 1 条`
        }
      }
      return '未找到匹配的记忆'
    },
  }))

  ctx.tools.register(defineTool({
    name: 'dwb_recall',
    description: '搜索记忆（个人 + 团队）。query 为空时列出全部条目。',
    parameters: {
      query: { type: 'string', description: '关键词（空=列出全部）' },
      roleId: { type: 'string', description: '你的角色 id' },
    },
    output: OUTPUT,
    async execute(args) {
      const me = args.roleId ?? currentRoleId.get()
      if (!me) return '请提供你的 roleId'
      const { own, team } = await rt.memoryList(me)
      const q = String(args.query ?? '').trim().toLowerCase()
      const hit = (list) => (q ? list.filter(e => e.text.toLowerCase().includes(q)) : list)
      const fmt = (list) => list.map(e => `- ${e.text}${e.added ? `（${e.added}）` : ''}`).join('\n') || '（无）'
      return `【个人记忆】\n${fmt(hit(own))}\n\n【团队记忆】\n${fmt(hit(team))}`
    },
  }))

  // 当前投递上下文中的人员 id（deliverToMember 投递时登记，工具执行时可读到）。
  const currentRoleId = {
    value: null,
    get: () => currentRoleId.value,
    set: (v) => { currentRoleId.value = v },
  }
  rt.setCurrentDeliveryRole = currentRoleId.set
}

