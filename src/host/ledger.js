// ledger.js —— 台账持久化（自研实现）。
// 单个 JSON 台账，保留角色、群组、任务及新增的任意执行状态。
import * as fs from 'node:fs/promises'

const EMPTY = {
  roles: { items: [], seq: 0 },
  groups: { items: [], seq: 0 },
  tasks: { items: [], seq: 0 },
}

export function install(rt) {
  const { home, statePath } = rt
  const io = { ...fs, ...rt.config?.ledgerIO }

  rt.state = structuredClone(EMPTY)
  rt.dirty = false
  let version = 0
  let savedVersion = 0

  async function ensureHome() {
    await io.mkdir(home, { recursive: true })
  }

  // 一个共享的初始读取；失败也保留，禁止随后保存覆盖无法读取的台账。
  let loadPromise
  rt.loadAll = () => {
    if (!loadPromise) loadPromise = (async () => {
      await ensureHome()
      let raw
      try {
        raw = await io.readFile(statePath, 'utf8')
      } catch (error) {
        if (error?.code !== 'ENOENT') throw error
        rt.state = structuredClone(EMPTY)
        return
      }
      const state = JSON.parse(raw)
      if (!state || typeof state !== 'object' || Array.isArray(state)) {
        throw new TypeError('Invalid ledger: expected an object')
      }
      for (const kind of Object.keys(EMPTY)) {
        if (!Object.hasOwn(state, kind)) continue
        const collection = state[kind]
        if (!collection || typeof collection !== 'object' || Array.isArray(collection)
          || !Array.isArray(collection.items)
          || (collection.seq !== undefined && (!Number.isSafeInteger(collection.seq) || collection.seq < 0))) {
          throw new TypeError(`Invalid ledger collection: ${kind}`)
        }
      }
      rt.state = { ...structuredClone(EMPTY), ...state }
    })()
    return loadPromise
  }

  // 序列化发生在任何写入等待之前；写完只确认对应版本，不能清除后续修改。
  let writeSeq = 0
  async function atomicWrite(serialized) {
    const tmp = `${statePath}.${process.pid}.${++writeSeq}.tmp`
    await io.writeFile(tmp, serialized, 'utf8')
    await io.rename(tmp, statePath)
  }

  let drainPromise
  function drain() {
    if (!drainPromise) drainPromise = (async () => {
      try {
        await rt.loadAll()
        while (savedVersion < version) {
          const writingVersion = version
          const serialized = JSON.stringify(rt.state, null, 2)
          if (serialized === undefined) throw new TypeError('Invalid ledger state')
          await ensureHome()
          await atomicWrite(serialized)
          savedVersion = writingVersion
          rt.dirty = savedVersion < version
        }
      } catch (error) {
        rt.dirty = true
        throw error
      } finally {
        drainPromise = undefined
      }
    })()
    return drainPromise
  }

  rt.saveAll = async () => {
    await rt.loadAll()
    // 显式保存也涵盖未经过 touch 的直接状态修改。
    version++
    rt.dirty = true
    do {
      await drain()
    } while (savedVersion < version)
  }
  rt.commit = rt.saveAll

  // 每次修改都递增版本，微任务仅合并启动；后台失败有处理器且保留 dirty。
  let touchQueued = false
  rt.touch = () => {
    version++
    rt.dirty = true
    if (touchQueued) return
    touchQueued = true
    queueMicrotask(() => {
      touchQueued = false
      if (!rt.dirty) return
      void drain().catch(error => console.warn('[dsh-workbench] save failed:', error))
    })
  }

  // 统一 nextId 生成。
  rt.nextId = (kind) => {
    const key = `${kind}Seq`
    rt.state[key] = (rt.state[key] ?? 0) + 1
    return `${kind}_${rt.state[key]}`
  }

  // ---- 角色 ----
  rt.listRoles = () => [...rt.state.roles.items]
  rt.getRole = (id) => rt.state.roles.items.find(item => item.id === id)
  rt.addRole = (role) => {
    rt.state.roles.items.push(role)
    rt.touch()
    return role
  }
  rt.updateRole = (id, patch) => {
    const index = rt.state.roles.items.findIndex(item => item.id === id)
    if (index === -1) return undefined
    rt.state.roles.items[index] = { ...rt.state.roles.items[index], ...patch }
    rt.touch()
    return rt.state.roles.items[index]
  }
  rt.removeRole = (id) => {
    const before = rt.state.roles.items.length
    rt.state.roles.items = rt.state.roles.items.filter(item => item.id !== id)
    if (rt.state.roles.items.length !== before) rt.touch()
    return rt.state.roles.items.length !== before
  }

  // ---- 群组 ----
  rt.listGroups = () => [...rt.state.groups.items]
  // 按 ID 查找；未命中则按群名回退（防止 AI 成员传群名而非 ID）。
  rt.getGroup = (idOrName) => rt.state.groups.items.find(item => item.id === idOrName)
    ?? rt.state.groups.items.find(item => item.name === idOrName)
  rt.addGroup = (group) => {
    rt.state.groups.items.push(group)
    rt.touch()
    return group
  }
  rt.updateGroup = (id, patch) => {
    const index = rt.state.groups.items.findIndex(item => item.id === id)
    if (index === -1) return undefined
    rt.state.groups.items[index] = { ...rt.state.groups.items[index], ...patch }
    rt.touch()
    return rt.state.groups.items[index]
  }

  // ---- 任务 ----
  rt.listTasks = () => [...rt.state.tasks.items]
  rt.getTask = (id) => rt.state.tasks.items.find(item => item.id === id)
  rt.addTask = (task) => {
    rt.state.tasks.items.push(task)
    rt.touch()
    return task
  }
  rt.updateTask = (id, patch) => {
    const index = rt.state.tasks.items.findIndex(item => item.id === id)
    if (index === -1) return undefined
    rt.state.tasks.items[index] = { ...rt.state.tasks.items[index], ...patch }
    rt.touch()
    return rt.state.tasks.items[index]
  }

  // 台账目录路径（供工具/命令展示）。
  rt.ledgerPath = () => statePath
}
