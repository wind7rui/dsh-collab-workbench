import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { runInNewContext } from 'node:vm'

// The client artifact is evaluated by the browser module loader on cold boot.
// Its registration id must track the exported package's ./client specifier.
test('packed client factory id follows the npm package name on cold boot', async () => {
  const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
  const client = await readFile(new URL('../client.js', import.meta.url), 'utf8')
  const registered = []
  const window = { __ModuleLoader__: { load({ id, factory }) { registered.push({ id, factory }) } } }
  runInNewContext(client, { window })
  assert.equal(registered.length, 1)
  assert.equal(registered[0].id, `${packageJson.name}/client`)
  assert.match(client, new RegExp(`var name = ["']${packageJson.name}/client["']`))
})

test('release exposes a consistent collaboration workbench identity', async () => {
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
  const zh = JSON.parse(await readFile(new URL('../locale/zh.json', import.meta.url), 'utf8'))
  const en = JSON.parse(await readFile(new URL('../locale/en.json', import.meta.url), 'utf8'))
  const client = await readFile(new URL('../client.js', import.meta.url), 'utf8')
  assert.equal(pkg.name, 'dsh-collab-workbench')
  assert.equal(pkg.version, '0.1.0')
  assert.equal(zh.meta.title, '协作工作台')
  assert.equal(en.meta.title, 'Collaboration Workbench')
  assert.match(client, /label: \(\) => workbenchTitle\(\)/)
  assert.match(client, /title: workbenchTitle\(\)/)
})

test('packed client includes the maintained update panel source', async () => {
  const client = await readFile(new URL('../client.js', import.meta.url), 'utf8')
  const source = await readFile(new URL('../src/client/update-ui.js', import.meta.url), 'utf8')
  assert.ok(client.includes(source.replace(/^export /gm, '')))
  assert.match(client, /view === "about" && .*WorkbenchUpdateUI\.UpdateAbout/)
  assert.match(client, /updates\.status\.available && .*WorkbenchUpdateUI\.UpdateCloud/)
})

test('group chat delete keeps its confirmation and uses the native trash icon', async () => {
  const client = await readFile(new URL('../client.js', import.meta.url), 'utf8')
  assert.match(client, /onClick: \(\) => setDelConfirm\(true\), children: .*IconTrashOutlineRegular, \{ size: 16 \}/)
  assert.match(client, /await call\("groups\.delete", \{ id: group\.id \}\)/)
})
