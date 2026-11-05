// groups.js —— 群组管理（通用工作台，不预设任何文件模板）。
// 群组名与同名工作目录一一对应；目录初始为空，由 AI 团队根据任务类型自行创建合适的文件。
// 改名时目录同步改名（P6）。
import { mkdir, readdir, realpath, rename, rm } from 'node:fs/promises'
import { join } from 'node:path'

// 名称非法字符：路径分隔、控制字符。
const NAME_BAD = /[\/\\\u0000-\u001f]/

export function install(rt) {
  const { ctx } = rt
  rt.movingGroups = new Set()
  const moveDirectory = async (group, newName) => {
    const runs = rt.executionRuns?.() ?? []
    if (runs.some(r => r.groupId === group.id && !['completed','cancelled'].includes(r.status) && (r.sessionId || ['starting','running'].includes(r.status)))) throw new Error('请先完成或停止任务执行，再移动群组工作目录')
    if (Object.values(group.sessions ?? {}).some(e => ctx.get?.('agents')?.get(e.id)?.status === 'running')) throw new Error('群成员仍在工作，请先停止后改名')
    rt.movingGroups.add(group.id)
    try {
      const entries = await readdir(rt.groupsRoot()).catch(() => [])
      if (entries.includes(newName) && newName !== group.name) throw new Error(`目标目录「${newName}」已存在，无法改名`)
      const newDir = rt.groupDir(newName)
      await rename(group.dir, newDir)
      group.archivedSessions = [...new Set([...(group.archivedSessions ?? []), ...Object.values(group.sessions ?? {}).map(e => e.id)])]
      group.sessions = {}
      group.workspaceId = null
      group.dir = newDir
      rt.touch()
      return newDir
    } finally { rt.movingGroups.delete(group.id) }
  }

  // ---- 命名校验：非空、无路径分隔/控制字符 ----
  rt.validateGroupName = (rawName) => {
    const name = String(rawName ?? '').trim()
    if (!name) throw new Error('群组名称不能为空')
    if (NAME_BAD.test(name)) throw new Error('群组名称不能包含 /、\\ 或控制字符')
    return name
  }

  // ---- 工作目录 ----
  rt.groupsRoot = () => rt.config?.groupsRoot ?? join(rt.home, 'groups')

  rt.groupDir = (name) => join(rt.groupsRoot(), name)

  // ---- 群工作区管理（DSH 原生工作区，成员会话归类展示） ----
  // 每个群目录注册为一个 DSH 工作区（以群名命名），成员会话创建在该工作区下。
  // DSH 侧栏显示：工作区名（群名）→ 里面是该群全部成员会话。

  // 安全按 ID 查工作区：DSH 真实 API 是 get(id)（没有 resolve——旧代码调
  // resolve 的地方一直靠 try/catch 静默吞掉 TypeError，等于从未生效）。
  // 防御性设计：get 缺失时回退 list() 过滤；任何异常一律按"未找到"处理。
  rt.findWorkspaceById = async (id) => {
    if (!id) return null
    const { workspaceRegistry } = ctx
    try {
      const ws = await workspaceRegistry.get?.(id)
      if (ws) return ws
    } catch { /* 忽略 */ }
    try {
      const list = await workspaceRegistry.list?.() ?? []
      return list.find(w => w && w.id === id) ?? null
    } catch { return null }
  }

  // workspaceOwned：工作区「所有权」标记。只有插件自己 create 的工作区才
  // 拥有所有权（删群时允许删除工作区记录，避免侧栏残留僵尸空工作区）。
  // 按路径收养的已有工作区一律视为他人所有——自定义目录可能正指向用户
  // 已注册为工作区的项目目录，收养后删群不得动它的记录。
  // 规范化路径（realpath）；目录不存在返回 null。
  rt.canonicalPath = async (p) => {
    try { return await realpath(String(p)) } catch { return null }
  }

  rt.ensureGroupWorkspace = async (group) => {
    const { workspaceRegistry } = ctx
    // 已有有效的 workspaceId → 直接用（所有权标记沿用台账记录）。
    if (group.workspaceId) {
      const ws = await rt.findWorkspaceById(group.workspaceId)
      if (ws) return group.workspaceId
    }
    // 尝试按路径找已有工作区（群目录改名后 id 失效的恢复路径）。
    if (group.dir) {
      const existing = await workspaceRegistry.resolveByPath(group.dir).catch(() => undefined)
      if (existing) {
        // ⚠️ 仅复用、不取得所有权：能走到这里说明台账里的 workspaceId 已失效，
        // 路径上现存的是另一条（或来历不明的）工作区记录——一律视为收养。
        rt.updateGroupRecord(group.id, { workspaceId: existing.id, workspaceOwned: false })
        return existing.id
      }
    }
    // 新建工作区（以群名命名，指向群目录）→ 插件拥有所有权。
    if (!group.dir) return null
    const ws = await workspaceRegistry.create(group.dir, group.name)
    rt.updateGroupRecord(group.id, { workspaceId: ws.id, workspaceOwned: true })
    return ws.id
  }

  // 创建同名目录（空目录，不预设任何文件——团队根据任务类型自行创建）。
  rt.scaffoldGroupDir = async (name) => {
    const dir = rt.groupDir(name)
    await mkdir(dir, { recursive: true })
    return dir
  }

  // 校验成员列表：存在且启用；返回去重 id 数组。
  const validateMembers = (memberIds) => {
    const ids = [...new Set((memberIds ?? []).map(String))]
    if (ids.length === 0) throw new Error('群组至少需要 1 名成员')
    for (const id of ids) {
      const role = rt.getRole(id)
      if (!role) throw new Error(`成员 ${id} 不存在`)
      if (role.status === 'disabled') throw new Error(`成员「${role.name}」已停用`)
    }
    return ids
  }

  // 校验管理员 ⊆ 成员且存在。
  const validateAdmins = (admins, memberIds) => {
    const ids = [...new Set((admins ?? []).map(String))]
    for (const id of ids) {
      if (!memberIds.includes(id)) throw new Error(`管理员 ${id} 必须同时是群组成员`)
      if (!rt.getRole(id)) throw new Error(`管理员 ${id} 不存在`)
    }
    return ids
  }

  // ---- 建群 ----
  // name 群组名称（原样使用）；admins 管理员 id 列表；notice 群公告；
  // members 成员 id 数组（含管理员）；
  // customDir 工作目录（用户入口必填——UI 的 groups.create 与 dwb_create_group
  // 都强制传入：成员直接在其中读取资料/存放成果物，群附件也存于此；
  // 不存在会自动创建；删除群组时该目录保留）；
  // withDir 仅内部路径使用（dwb_command_new_project 快捷命令派生默认目录）。
  rt.createGroup = async ({ name: rawName, prefix: legacyPrefix, admins = [], notice = '', members, withDir = true, customDir }) => {
    const name = rt.validateGroupName(rawName ?? legacyPrefix)
    if ((rt.listGroups() ?? []).some(g => g.name === name)) {
      throw new Error(`群组「${name}」已存在`)
    }
    const memberIds = validateMembers(members)
    const adminIds = validateAdmins(admins, memberIds)

    // 工作目录：自定义目录优先（存在即用、缺失则建）；否则默认目录。
    // ⚠️ 自定义目录必须规范化（realpath）后入账：DSH 目录选择器可能返回
    // 带尾部斜杠的路径，而注册表 create/resolveByPath 内部按 realpath
    // 规范化——不规范化会导致 group.dir ≠ workspace.path 恒成立，
    // 删群时的所有权判定永远失败（工作区"永生"bug 的根因）。
    let dir = null
    let isCustom = false
    if (customDir && String(customDir).trim()) {
      dir = String(customDir).trim()
      isCustom = true
      await mkdir(dir, { recursive: true }).catch(() => {
        throw new Error(`无法访问目录 ${dir}`)
      })
      dir = await realpath(dir).catch(() => dir) // 规范化（去尾部斜杠/解析符号链接）
    } else if (withDir) {
      dir = rt.groupDir(name)
    }

    const group = {
      id: rt.nextId('group'),
      name,
      prefix: name, // 兼容字段：V2 起等于群组名
      members: memberIds,
      admins: adminIds,
      notice: String(notice ?? '').trim(),
      dir,
      isCustomDir: isCustom, // 标记：删除群组时自定义目录及其文件保留
      status: 'active',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }
    rt.addGroup(group)
    if (dir && !isCustom) {
      await rt.scaffoldGroupDir(name)
    }
    return group
  }

  // ---- 群组编辑（名称 / 公告 / 管理员 / 成员） ----
  // 名称变化会同步改名目录；成员/管理员按建群规则校验。
  rt.updateGroupMeta = async (id, { name: rawName, notice, admins, members }) => {
    const group = rt.getGroup(id)
    if (!group) throw new Error(`群组 ${id} 不存在`)
    const patch = { updatedAt: Date.now() }

    let newName = group.name
    if (rawName !== undefined && String(rawName).trim() !== group.name) {
      newName = rt.validateGroupName(rawName)
      if ((rt.listGroups() ?? []).some(g => g.id !== id && g.name === newName)) {
        throw new Error(`群组「${newName}」已存在`)
      }
      patch.name = newName
      patch.prefix = newName
    }

    let nextMembers = group.members ?? []
    if (members !== undefined) nextMembers = validateMembers(members)

    let nextAdmins = group.admins ?? []
    if (admins !== undefined) nextAdmins = validateAdmins(admins, nextMembers)
    else nextAdmins = (group.admins ?? []).filter(a => nextMembers.includes(a))
    patch.members = nextMembers
    patch.admins = nextAdmins

    if (notice !== undefined) patch.notice = String(notice ?? '').trim()

    // 名称变化 → 默认目录同步改名（防覆盖）；自定义目录不随群改名搬迁。
    if (patch.name && group.dir && !group.isCustomDir) {
      patch.dir = await moveDirectory(group, newName)
    }

    const updated = rt.updateGroupRecord(group.id, patch)
    for (const roleId of group.members.filter(id => !nextMembers.includes(id))) await rt.stopPerson?.(group.id, roleId)
    for (const task of rt.listTasks(group.id)) {
      const assignees = task.assignees.filter(id => nextMembers.includes(id))
      if (assignees.length !== task.assignees.length) {
        const next = rt.updateTaskRecord(task.id,{assignees})
        await rt.taskChanged?.(next,task)
      }
    }
    await rt.saveAll?.()
    return updated
  }

  // ---- 改名（目录同步 + 工作区标题同步） ----
  rt.renameGroup = async (id, newNameRaw) => {
    const group = rt.getGroup(id)
    if (!group) throw new Error(`群组 ${id} 不存在`)
    const newName = rt.validateGroupName(newNameRaw)
    if ((rt.listGroups() ?? []).some(g => g.id !== id && g.name === newName)) {
      throw new Error(`群组「${newName}」已存在`)
    }
    const oldDir = group.dir
    let newDir = null
    // 默认目录随改名移动；自定义目录是用户的项目目录，不随群改名搬迁。
    if (oldDir && !group.isCustomDir) {
      newDir = await moveDirectory(group, newName)
    }
    const updated = rt.updateGroupRecord(id, {
      name: newName,
      prefix: newName,
      dir: newDir ?? oldDir,
      updatedAt: Date.now(),
    })
    // 同步工作区标题（群名变了 → DSH 侧栏工作区名跟着变）。
    if (group.workspaceId) {
      try { await ctx.workspaceRegistry.rename(group.workspaceId, newName) } catch { /* 忽略 */ }
    }
    return updated
  }

  // ---- 删除群组 ----
  // ⚠️ 安全红线：会话数据只按「精确会话 ID」删除，
  // 且 ID 必须来自本群台账（group.sessions + group.archivedSessions）。
  // 不能按 groupDir 尾段的编码子串模糊匹配 ~/.dsh/sessions/ 下的工作区
  // 目录名——群名（即群目录尾段）与任何真实工作区目录名片段重合时，
  // 该工作区下全部会话（含用户 GUI 会话）会被整目录 rm -rf。
  // 例如群名"随机问答"→ 编码 ~968F~673A~95EE~7B54 → 子串命中
  // --Users-...-~968F~673A~95EE~7B54-- → 里面所有会话被误删。
  rt.dshSessionsRoots = () => {
    const userHome = process.env.HOME ?? ''
    const roots = []
    if (rt.config?.sessionsRoot) roots.push(rt.config.sessionsRoot) // 测试注入
    if (rt.home) roots.push(join(rt.home, '..', 'sessions'))
    if (userHome) roots.push(join(userHome, '.dsh', 'sessions'))
    return [...new Set(roots)]
  }

  rt.purgeSessionFiles = async (sessionIds) => {
    if (!sessionIds || sessionIds.size === 0) return
    for (const root of rt.dshSessionsRoots()) {
      try {
        const wsDirs = await readdir(root).catch(() => [])
        for (const wsDir of wsDirs) {
          const wsPath = join(root, wsDir)
          const sessDirs = await readdir(wsPath).catch(() => [])
          let deleted = 0
          let remaining = 0
          for (const sessDir of sessDirs) {
            // 仅精确命中台账中的会话 ID 才删除；其余一律不动。
            if (sessionIds.has(sessDir)) {
              await rm(join(wsPath, sessDir), { recursive: true, force: true }).catch(() => {})
              deleted++
            } else {
              remaining++
            }
          }
          // 仅当本轮确实删过且工作区已空时顺带清理空目录（不动未命中的工作区）。
          if (deleted > 0 && remaining === 0) {
            await rm(wsPath, { recursive: true, force: true }).catch(() => {})
          }
        }
      } catch { /* 忽略 */ }
    }
  }

  // 保守幽灵清扫：只清除磁盘上确实不存在的归档记录，但保留 keepArchived（本次删除的会话）。
  // 归档中的 ID 是"隐藏标记"——保留它们才能让侧栏保持隐藏状态。
  rt.sweepGhostSessions = async (keepArchived = new Set()) => {
    const userHome = process.env.HOME ?? ''
    if (!userHome) return
    const wsJsonPath = join(userHome, '.dsh', 'storages', 'workspace.json')
    try {
      const { readFile, writeFile } = await import('node:fs/promises')
      const raw = await readFile(wsJsonPath, 'utf8').catch(() => null)
      if (!raw) return
      const data = JSON.parse(raw)
      const archived = data?.global?.archivedSessionIds ?? []
      // 扫描磁盘上实际存在的会话
      const diskSessions = new Set()
      const root = join(userHome, '.dsh', 'sessions')
      const wsDirs = await readdir(root).catch(() => [])
      for (const wsDir of wsDirs) {
        const sess = await readdir(join(root, wsDir)).catch(() => [])
        for (const sid of sess) diskSessions.add(sid)
      }
      const valid = archived.filter(sid => keepArchived.has(sid) || diskSessions.has(sid))
      if (valid.length < archived.length) {
        data.global.archivedSessionIds = valid
        await writeFile(wsJsonPath, JSON.stringify(data, null, 2))
      }
    } catch { /* 忽略 */ }
  }

  // 清除 DSH 侧栏会话注册表（session_projcache/sessions/*.json）。
  // ⚠️ 安全红线：只按「精确会话 ID」删除（ID 来自本群台账）。
  // 不能按 cwd 前缀匹配（startsWith groupDir）：范围过宽——群目录路径若是某个
  // 更上层目录的前缀（或用户会话恰好开在群目录下），会误删他人记录。
  rt.purgeSessionRegistry = async (sessionIds) => {
    if (!sessionIds || sessionIds.size === 0) return
    const userHome = process.env.HOME ?? ''
    if (!userHome && !rt.config?.projcacheSessionsDir) return
    const cacheDir = rt.config?.projcacheSessionsDir // 测试注入
      ?? join(userHome, '.dsh', 'storages', 'session_projcache', 'sessions')
    try {
      const files = await readdir(cacheDir).catch(() => [])
      for (const file of files) {
        if (!file.endsWith('.json')) continue
        const sid = file.slice(0, -5)
        if (sessionIds.has(sid)) {
          await rm(join(cacheDir, file), { force: true }).catch(() => {})
        }
      }
    } catch { /* 忽略 */ }
  }

  rt.deleteGroup = async (id) => {
    const group = rt.getGroup(id)
    if (!group) throw new Error(`群组 ${id} 不存在`)
    group.status = 'deleting'
    rt.touch()
    await rt.saveAll?.()
    const executionSessionIds = await rt.cancelGroupExecution?.(group.id) ?? []
    // ① 收集本群会话 ID（fail-closed：只认台账）。
    //    当前成员会话（group.sessions）+ 轮换归档的历史会话（group.archivedSessions）。
    //    绝不从工作区记录的 sessionIds 收集——那里可能混有用户自己的 GUI 会话
    //    （用户在群目录下开过会话时，会话会挂到同一个工作区）。
    const allSessionIds = new Set(executionSessionIds)
    for (const [, entry] of Object.entries(group.sessions ?? {})) {
      if (entry?.id) allSessionIds.add(entry.id)
    }
    for (const sid of group.archivedSessions ?? []) {
      if (sid) allSessionIds.add(sid)
    }
    // ② 先停止运行中的 agent（如果会话正在工作，内存中的 agent 必须终止）。
    for (const sid of allSessionIds) {
      await rt.stopSessionAgent?.(group.id, sid).catch(() => null)
      try {
        const { agent } = await ctx.sessionController.resolveAgent(sid)
        if (agent) {
          try { agent.cancel?.({ kind: 'user' }) } catch { /* 忽略 */ }
          try { await ctx.sessions?.flush?.(agent.session) } catch { /* 忽略 */ }
        }
      } catch { /* 忽略 */ }
    }
    // ③ 工作区所有权判定：只有「插件 create 的工作区」才允许删除工作区记录
    //    （否则删群后侧栏残留僵尸空工作区）。规则（fail-closed）：
    //    - workspaceOwned=false（按路径收养）→ 保留；
    //    - workspaceOwned=true（插件 create）且路径吻合 → 删除；
    //    - 无标记的旧数据 → 默认目录按"路径吻合"判定，自定义目录一律保留
    //      （无法区分是插件新建还是收养的用户工作区）。
    //    ⚠️ 对齐 DSH 原生删除语义：WorkspaceCommands.delete 就是一句
    //    registry.delete，不检查工作区挂了哪些会话——曾加的"外来会话护栏"
    //    比原生更保守，两次挡住删除的都是用户点开工作区时 DSH 自动产生的
    //    零 token 空壳 GUI 草稿会话（用户不知情也无从处理）。删除注册不动
    //    会话数据，DSH 会按需为存留会话重新归组。
    let ownedWorkspaceId = group.workspaceId ?? null
    if (ownedWorkspaceId && group.workspaceOwned === false) {
      ownedWorkspaceId = null // 明确收养 → 只清会话引用，不删工作区记录
    } else if (ownedWorkspaceId) {
      const ws = await rt.findWorkspaceById(ownedWorkspaceId)
      if (!ws) {
        ownedWorkspaceId = null
      } else {
        // 路径比较按 realpath 规范化：workspace.path 由注册表规范化存储，
        // 而历史台账里的 group.dir 可能带尾部斜杠（目录选择器返回值）或
        // 含符号链接——直接字符串比较会恒不等，导致工作区永远删不掉。
        const canonical = await rt.canonicalPath(group.dir) ?? group.dir
        if (ws.path !== canonical && ws.path !== group.dir) {
          ownedWorkspaceId = null
        } else if (group.workspaceOwned !== true && group.isCustomDir) {
          ownedWorkspaceId = null // 旧数据 + 自定义目录 → 保留
        }
      }
    }
    // ④ 删除插件所建的工作区记录 —— 必须走 DSH 真实 API registry.delete：
    //    它从注册表内存移除实体并自行持久化（语义：删注册、保留目录与会话日志）。
    //    ⚠️ 直改 workspace.json 对注册表内存不可见——退出/重启时内存状态回写
    //    文件会让已删记录复活。workspaceRegistry.delete 才是不会被复活的路径。
    if (ownedWorkspaceId) {
      // registry.delete 返回 true=已删 / false=未知 ID；方法缺失时
      // delete?.() 得到 undefined——只有显式 true 才算 API 成功，否则走兜底
      // （P15-3 回归：旧判定 r !== false 会把 undefined 误判为成功）。
      // 删后校验：即使返回 true 也复查注册表——API 静默失效时自纠兜底。
      let apiDeleted = false
      try {
        const r = await ctx.workspaceRegistry.delete?.(ownedWorkspaceId)
        apiDeleted = r === true && (await rt.findWorkspaceById(ownedWorkspaceId)) === null
      } catch { apiDeleted = false }
      if (!apiDeleted) {
        // API 缺失/失败/删后仍存在 → 兜底直写文件（可能被内存回写复活，聊胜于无）
        await rt.cleanWorkspaceRefs(new Set(), ownedWorkspaceId)
      }
    }
    // ⑤ 直写 workspace.json 清理全局引用（archived/pinned）与其他工作区
    //    sessionIds 中的本群会话 ID（不再承担工作区记录删除）。
    await rt.cleanWorkspaceRefs(allSessionIds, undefined)
    // ⑤ 物理删除会话数据（磁盘上的会话目录）——仅按精确会话 ID。
    await rt.purgeSessionFiles(allSessionIds)
    // ⑥ 删除 DSH 侧栏会话注册表（session_projcache）——仅按精确会话 ID。
    await rt.purgeSessionRegistry(allSessionIds)
    // ⑦ 删除工作目录及全部文件（仅默认目录——自定义目录保留，可能是用户的主项目）。
    if (group.dir && !group.isCustomDir) {
      await rm(group.dir, { recursive: true, force: true }).catch(() => { /* 忽略 */ })
    }
    // ⑦ 删除关联任务（兼容旧数据：groupId 可能存的是群名而非群 ID）。
    rt.state.tasks.items = (rt.state.tasks.items ?? []).filter(t =>
      t.groupId !== group.id && t.groupId !== group.name
    )
    // ⑧ 从台账移除。
    const index = rt.state.groups.items.findIndex(item => item.id === group.id)
    if (index !== -1) rt.state.groups.items.splice(index, 1)
    rt.touch()
    await rt.saveAll?.()
    return { deleted: true, name: group.name, dir: group.dir }
  }

  // 直接修改 workspace.json（仿 delete-session.sh clean_ws）：
  // ① 从 archivedSessionIds / pinnedSessionIds / 所有 workspace.sessionIds
  //    移除指定会话 ID
  // ② 删除指定工作区记录本身（从 workspaceIds 和 tables.workspaces 中移除）
  // 这会让 DSH 主进程立即感知会话被移除，侧栏随之刷新（无需重启）。
  rt.cleanWorkspaceRefs = async (sessionIds, workspaceId) => {
    const userHome = process.env.HOME ?? ''
    if (!userHome && !rt.config?.workspaceJsonPath) return
    // 如果既没有 sessionIds 也没有 workspaceId，无事可做
    if ((!sessionIds || sessionIds.size === 0) && !workspaceId) return
    const wsJsonPath = rt.config?.workspaceJsonPath // 测试注入
      ?? join(userHome, '.dsh', 'storages', 'workspace.json')
    try {
      const { readFile, writeFile, copyFile } = await import('node:fs/promises')
      const raw = await readFile(wsJsonPath, 'utf8').catch(() => null)
      if (!raw) return
      // 先备份（仿 delete-session.sh：cp workspace.json workspace.json.bak）
      await copyFile(wsJsonPath, wsJsonPath + '.bak').catch(() => {})
      const data = JSON.parse(raw)
      const g = data.global ?? (data.global = {})
      const before = JSON.stringify(data)
      // ① 移除会话 ID 引用
      if (sessionIds && sessionIds.size > 0) {
        g.archivedSessionIds = (g.archivedSessionIds ?? []).filter(sid => !sessionIds.has(sid))
        g.pinnedSessionIds = (g.pinnedSessionIds ?? []).filter(sid => !sessionIds.has(sid))
        for (const ws of Object.values(data.tables?.workspaces ?? {})) {
          ws.sessionIds = (ws.sessionIds ?? []).filter(sid => !sessionIds.has(sid))
        }
      }
      // ② 删除工作区记录本身（完全替代 workspaceRegistry.delete，避免其副作用）
      if (workspaceId) {
        delete data.tables?.workspaces?.[workspaceId]
        const wids = g.workspaceIds ?? []
        g.workspaceIds = wids.filter(id => id !== workspaceId)
      }
      if (JSON.stringify(data) !== before) {
        await writeFile(wsJsonPath, JSON.stringify(data, null, 2) + '\n')
      }
    } catch { /* 忽略 */ }
  }

  // ledger 底层更新（避免与 ledger.updateGroup 递归冲突）。
  rt.updateGroupRecord = (id, patch) => {
    const index = rt.state.groups.items.findIndex(item => item.id === id)
    if (index === -1) return undefined
    rt.state.groups.items[index] = { ...rt.state.groups.items[index], ...patch }
    rt.touch()
    return rt.state.groups.items[index]
  }
}
