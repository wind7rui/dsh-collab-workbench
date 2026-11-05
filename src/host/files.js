// files.js —— 群文件（附件）管理。
// 群聊输入框 ＋ 号上传的文件落入群工作目录的「附件/」子目录，成为群资产：
//   - 成员会话 cwd 即群目录，可直接用 read/glob 访问（图片用 read_image）；
//   - 消息流以文件卡片呈现（client 用 FileTypeIcon 渲染）；
//   - 文件是普通磁盘文件，用户也能在文件系统中直接查看。
// 安全：文件名清洗去路径；删除只允许作用于附件目录内的文件（路径解析后前缀校验）。
import { mkdir, writeFile, rm, stat } from 'node:fs/promises'
import { join, basename, extname, resolve, sep, relative } from 'node:path'
import { randomUUID } from 'node:crypto'

export const ATTACH_DIR = '附件'
export const MAX_FILE_BYTES = 10 * 1024 * 1024 // 单文件 10MB（RPC 为 base64 JSON，不放大文件）

// 文件名清洗：取 basename、去控制字符、去前导点、限长 120 字符。
function sanitizeName(raw) {
  const base = basename(String(raw ?? ''))
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/^\.+/, '')
    .trim()
    .slice(0, 120)
  return base || `文件-${randomUUID().slice(0, 8)}`
}

// 同名冲突：追加「 (2)」「 (3)」…，仍冲突则 uuid 后缀兜底。
async function findFreeName(dir, name) {
  const ext = extname(name)
  const stem = ext ? name.slice(0, -ext.length) : name
  let candidate = name
  for (let i = 2; i < 100; i++) {
    try {
      await stat(join(dir, candidate))
      candidate = `${stem} (${i})${ext}`
    } catch {
      return candidate
    }
  }
  return `${stem}-${randomUUID().slice(0, 8)}${ext}`
}

export function install(rt) {
  const attachDirOf = (group) => join(group.dir, ATTACH_DIR)

  // 上传一个文件（base64）→ 写入群目录「附件/」，返回文件记录。
  rt.uploadGroupFile = async ({ groupId, name, base64 }) => {
    await rt.loadAll()
    const group = rt.getGroup(groupId)
    if (!group) throw new Error(`群组 ${groupId} 不存在`)
    if (group.status !== 'active') throw new Error(`群组「${group.name}」已归档，不能上传附件`)
    if (!group.dir) throw new Error('该群组没有工作目录，无法保存附件')

    const data = Buffer.from(String(base64 ?? ''), 'base64')
    if (data.length === 0) throw new Error('文件内容为空或编码无效')
    if (data.length > MAX_FILE_BYTES) {
      throw new Error(`文件超过 ${Math.round(MAX_FILE_BYTES / 1024 / 1024)}MB 上限`)
    }

    const dir = attachDirOf(group)
    await mkdir(dir, { recursive: true })
    const freeName = await findFreeName(dir, sanitizeName(name))
    const path = join(dir, freeName)
    await writeFile(path, data)
    return {
      name: freeName,
      size: data.length,
      path,
      relPath: `${ATTACH_DIR}/${freeName}`,
    }
  }

  // 删除一个已上传但未随消息发送的附件。
  // 只允许删「附件/」目录内的文件——路径解析后做前缀校验，拒绝越界。
  rt.removeGroupFile = async ({ groupId, path }) => {
    await rt.loadAll()
    const group = rt.getGroup(groupId)
    if (!group) throw new Error(`群组 ${groupId} 不存在`)
    if (!group.dir) throw new Error('该群组没有工作目录')
    const attachDir = resolve(attachDirOf(group))
    const target = resolve(String(path ?? ''))
    const rel = relative(attachDir, target)
    // rel 为空 = 目标就是附件目录本身；rel 以 .. 开头 = 越界。都拒绝。
    if (!rel || rel.startsWith('..') || rel.includes(`..${sep}`)) {
      throw new Error('只能删除附件目录中的文件')
    }
    const info = await stat(target).catch(() => null)
    if (!info?.isFile()) throw new Error('文件不存在')
    await rm(target)
    return { removed: true, path: target }
  }
}
