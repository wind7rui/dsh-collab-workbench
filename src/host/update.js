// Read-only update checks: newest published version versus this installed one.
// Installation is never performed here (this Harness refuses in-place replacement).
// Keep npm identity separate from the historical workbench data and RPC paths.
import { readFileSync } from 'node:fs'

const PKG = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'))
export const CHECK_TTL_MS = 10 * 60_000
export const FETCH_TIMEOUT_MS = 8_000
const OFFICIAL = 'https://registry.npmjs.org/'
const MIRROR = 'https://registry.npmmirror.com/'
const STABLE = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/

const stable = version => typeof version === 'string' && STABLE.test(version) ? version : null
const newer = (a, b) => {
  const next = stable(a)?.split('.').map(BigInt)
  const current = stable(b)?.split('.').map(BigInt)
  if (!next || !current) return false
  for (let i = 0; i < 3; i++) if (next[i] !== current[i]) return next[i] > current[i]
  return false
}
const normalize = value => {
  if (typeof value !== 'string') return null
  try {
    const url = new URL(value)
    return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password && !url.search && !url.hash
      ? `${url.href.replace(/\/+$/, '')}/` : null
  } catch { return null }
}
const encodeName = name => name.startsWith('@') ? `@${encodeURIComponent(name.slice(1))}` : encodeURIComponent(name)

// Reject file:, link:, tarballs and git even when prefixed by the npm package name.
function sourceKind(source) {
  if (typeof source !== 'string' || !source.trim()) return 'unknown'
  const text = source.trim()
  const registrySpec = text === PKG.name || new RegExp(`^${PKG.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}@(?:[~^]?\\d+\\.\\d+\\.\\d+(?:-[\\w.-]+)?|latest|\\*)$`).test(text)
  if (registrySpec) return 'registry'
  if (/^(?:link:|file:|https?:\/\/|\/|\.\/|\.\.\/|~\/)/i.test(text) || /\.(?:tgz|tar\.gz)(?:$|[?#])/i.test(text)
    || text.startsWith(`${PKG.name}@file:`) || text.startsWith(`${PKG.name}@link:`)) return 'local'
  return 'unknown'
}

async function registries(manager) {
  const configured = await Promise.resolve(manager.registries?.()).catch(() => null)
  if (!configured) return [OFFICIAL, MIRROR]
  const own = normalize(configured.registry ?? configured.resolved) ?? OFFICIAL
  const fallback = (Array.isArray(configured.fallbackRegistries) ? configured.fallbackRegistries : []).map(normalize).filter(Boolean)
  const publicRegistry = own === OFFICIAL || own === MIRROR || fallback.includes(own)
  return publicRegistry ? [...new Set([own, ...fallback])] : [own]
}

/** Read-only update check installed by index.js; no installer and no agent tool are registered. */
export function install(rt, { fetchImpl = globalThis.fetch, now = Date.now } = {}) {
  const manager = () => rt.ctx.get?.('pluginManager')
  const status = {
    name: PKG.name, current: PKG.version, latest: null, source: 'unknown',
    checkedAt: 0, phase: 'idle', error: null,
  }
  let target = null
  let checking = null
  const view = () => ({ ...status, available: target !== null && newer(status.latest, status.current) })

  async function runCheck() {
    const service = manager()
    const bundles = await Promise.resolve(service?.listBundles?.())
    const own = Array.isArray(bundles) ? bundles.find(bundle => bundle.name === PKG.name && bundle.installed !== false) : undefined
    status.source = sourceKind(own?.source)
    status.checkedAt = now()
    target = null
    status.latest = null
    status.error = null
    if (status.source !== 'registry') { status.phase = 'idle'; return }
    if (!service || typeof fetchImpl !== 'function') throw new Error('Update registry is unavailable')
    let failed = false
    for (const registry of await registries(service)) {
      try {
        const response = await fetchImpl(`${registry}${encodeName(PKG.name)}/latest`, {
          headers: { accept: 'application/json' }, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        })
        if (response.status === 404) continue
        if (!response.ok) throw new Error(`Registry answered ${response.status}`)
        const found = await response.json()
        const version = stable(found?.version)
        if (found?.name !== PKG.name || !version) throw new Error('Invalid registry release')
        status.latest = version
        if (newer(version, status.current)) target = { spec: `${PKG.name}@${version}`, registry, version }
        status.phase = 'idle'
        return
      } catch { failed = true }
    }
    status.phase = failed ? 'failed' : 'idle'
    if (failed) status.error = 'update-check-failed'
  }

  function check({ fresh = false } = {}) {
    if (checking) return checking
    if (!fresh && status.checkedAt && now() - status.checkedAt < CHECK_TTL_MS) return Promise.resolve(view())
    status.phase = 'checking'
    checking = runCheck().catch(() => {
      target = null
      status.latest = null
      status.checkedAt = now()
      status.phase = 'failed'
      status.error = 'update-check-failed'
    }).then(view).finally(() => { checking = null })
    return checking
  }

  // Checking is read-only. Installing is deliberately not exposed: this Harness
  // refuses to replace a running plugin in place, and removing the bundle first
  // would unload this code before the reinstall could run. The About page shows
  // the manual upgrade steps instead.
  Object.assign(rt, { updateView: view, updateCheck: check })
}
