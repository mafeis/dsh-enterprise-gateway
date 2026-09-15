#!/usr/bin/env node
/** 截供应商/模型编辑器展开态（当前 UI 基线，供重设计对比） */
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs'
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

const dataDir = mkdtempSync(join(tmpdir(), 'dsh-editor-shot-'))
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
const edge = spawn(EDGE, ['--headless=new', '--disable-gpu', `--remote-debugging-port=${dbgPort}`, `--user-data-dir=${join(dataDir, 'edge')}`, '--no-first-run', 'about:blank', '--window-size=1600,1100'], { stdio: 'ignore' })
const outDir = join(root, 'gateway', 'data', 'ui-pages')
mkdirSync(outDir, { recursive: true })
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

  await send('Page.navigate', { url: BASE + '/admin' })
  await sleep(2000)
  const dl = Date.now() + 20000
  let m = null
  while (Date.now() < dl && !(m = gwOut.match(/初始密码: ([0-9a-f]{12})/))) await sleep(200)
  const login = await (await fetch(BASE + '/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: m[1] }) })).json()
  await ev(`localStorage.setItem('ent_jwt', ${JSON.stringify(login.token)})`)
  await send('Page.navigate', { url: 'about:blank' })
  await sleep(600)
  await send('Page.navigate', { url: BASE + '/admin' })
  await sleep(3500)

  await ev(`location.hash = '#/channels'`)
  await sleep(1500)
  // 展开供应商编辑器（编辑态：带出原值）
  await ev(`(() => { document.querySelector('[data-pedit]')?.click(); return 1 })()`)
  await sleep(900)
  const metrics = await send('Page.getLayoutMetrics')
  const h = Math.min(4000, Math.ceil(metrics.result.cssContentSize.height))
  await send('Emulation.setDeviceMetricsOverride', { width: 1600, height: h, deviceScaleFactor: 1, mobile: false })
  await sleep(500)
  let shot = await send('Page.captureScreenshot', { format: 'png' })
  if (shot?.result?.data) writeFileSync(join(outDir, 'editor-prov.png'), Buffer.from(shot.result.data, 'base64'))
  await send('Emulation.clearDeviceMetricsOverride')
  console.log('✓ editor-prov.png')

  // 展开模型编辑器
  await ev(`(() => { document.getElementById('peCloseBtn')?.click(); document.querySelector('[data-medit]')?.click(); return 1 })()`)
  await sleep(900)
  const m2 = await send('Page.getLayoutMetrics')
  const h2 = Math.min(5000, Math.ceil(m2.result.cssContentSize.height))
  await send('Emulation.setDeviceMetricsOverride', { width: 1600, height: h2, deviceScaleFactor: 1, mobile: false })
  await sleep(500)
  shot = await send('Page.captureScreenshot', { format: 'png' })
  if (shot?.result?.data) writeFileSync(join(outDir, 'editor-model.png'), Buffer.from(shot.result.data, 'base64'))
  await send('Emulation.clearDeviceMetricsOverride')
  console.log('✓ editor-model.png')
  ws.close()
} finally {
  try { gw.kill() } catch { }
  try { edge.kill() } catch { }
  try { rmSync(dataDir, { recursive: true, force: true }) } catch { }
}
