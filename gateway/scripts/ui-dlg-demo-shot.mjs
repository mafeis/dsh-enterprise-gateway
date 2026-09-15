#!/usr/bin/env node
/** 一次性验证：样式规范页五档弹窗（sm/md/lg/wide/bench）截图，确认布局与尺寸徽章 */
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { createServer } from 'node:net'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
function freePort() {
  return new Promise((resolve, reject) => {
    const s = createServer()
    s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)) })
    s.on('error', reject)
  })
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const dataDir = mkdtempSync(join(tmpdir(), 'dsh-dlg-demo-'))
const port = await freePort()
const BASE = `http://127.0.0.1:${port}`
const gw = spawn(process.execPath, ['gateway.mjs'], {
  cwd: root,
  env: { ...process.env, PORT: String(port), ENT_DATA_DIR: dataDir, ENT_DB_PATH: join(dataDir, 'gateway.db'), ENT_GATEWAY_CONFIG: join(dataDir, 'gateway-config.json') },
  stdio: ['ignore', 'pipe', 'pipe'],
})
let gwOut = ''
gw.stdout.on('data', (d) => { gwOut += d })
gw.stderr.on('data', (d) => { gwOut += d })
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
const dbgPort = await freePort()
const edge = spawn(EDGE, ['--headless=new', '--disable-gpu', `--remote-debugging-port=${dbgPort}`, `--user-data-dir=${join(dataDir, 'edge')}`, '--no-first-run', 'about:blank', '--window-size=1600,950'], { stdio: 'ignore' })
try {
  let target
  for (let i = 0; i < 40; i++) { await sleep(500); try { const l = await (await fetch(`http://127.0.0.1:${dbgPort}/json/list`)).json(); target = l.find((t) => t.type === 'page'); if (target) break } catch { } }
  const ws = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej })
  let mid = 0
  const pending = new Map()
  ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) } }
  const send = (method, params = {}) => new Promise((res) => { const id = ++mid; pending.set(id, res); ws.send(JSON.stringify({ id, method, params })) })
  const ev = async (expr) => (await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })).result?.result?.value
  const shot = async (name) => { const s = await send('Page.captureScreenshot', { format: 'png' }); if (s?.result?.data) { const { writeFileSync } = await import('node:fs'); writeFileSync(join(outDir, name), Buffer.from(s.result.data, 'base64')); console.log('✓', name) } }
  const outDir = join(root, 'gateway', 'data', 'ui-pages')

  await send('Page.navigate', { url: BASE + '/admin' })
  await sleep(2000)
  const dl = Date.now() + 20000
  let m = null
  while (Date.now() < dl && !(m = gwOut.match(/初始密码: ([0-9a-f]{12})/))) await sleep(200)
  const login = await (await fetch(BASE + '/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: m[1] }) })).json()
  await ev(`localStorage.setItem('ent_jwt', ${JSON.stringify(login.token)})`)
  await send('Page.navigate', { url: 'about:blank' })
  await sleep(500)
  await send('Page.navigate', { url: BASE + '/admin#/design' })
  await sleep(2500)

  for (const size of ['sm', 'md', 'lg', 'wide', 'bench']) {
    await ev(`document.querySelector('[data-dlg-demo="${size}"]')?.click()`)
    await sleep(700)
    const dim = await ev(`(() => { const b = document.querySelector('#dlgDemo-${size} [data-dlg-dim]'); const x = document.querySelector('#dlgDemo-${size} .dlg-x'); const r = document.querySelector('#dlgDemo-${size} .dlg').getBoundingClientRect(); return { badge: b?.textContent, w: Math.round(r.width), h: Math.round(r.height), hasX: !!x } })()`)
    console.log(size + ':', JSON.stringify(dim))
    await shot(`dlg-demo-${size}.png`)
    await ev(`document.querySelector('#dlgDemo-${size} .dlg-x')?.click()`)
    await sleep(400)
  }
  ws.close()
} catch (e) {
  console.error('✗', String(e).slice(0, 300))
  if (gwOut) console.error(gwOut.split('\n').slice(-10).join('\n'))
} finally {
  try { gw.kill() } catch { }
  try { edge.kill() } catch { }
  try { rmSync(dataDir, { recursive: true, force: true }) } catch { }
}
