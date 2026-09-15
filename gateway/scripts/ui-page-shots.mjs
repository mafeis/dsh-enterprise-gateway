#!/usr/bin/env node
/** 逐页截图：全部 11 个插件页，供 UI 排查（换行/折叠/溢出） */
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs'
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

const dataDir = mkdtempSync(join(tmpdir(), 'dsh-ui-shot-'))
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
const edge = spawn(EDGE, ['--headless=new', '--disable-gpu', `--remote-debugging-port=${dbgPort}`, `--user-data-dir=${join(dataDir, 'edge')}`, '--no-first-run', 'about:blank', '--window-size=1600,1000'], { stdio: 'ignore' })
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

  const PAGES = ['overview', 'logs', 'channels', 'users', 'billing', 'security', 'client', 'design', 'plugreg', 'inspector', 'notify']
  for (const id of PAGES) {
    await ev(`location.hash = '#/${id}'`)
    await sleep(1600)
    const shot = await send('Page.captureScreenshot', { format: 'png' })
    if (shot?.result?.data) {
      const { writeFileSync } = await import('node:fs')
      writeFileSync(join(outDir, id + '.png'), Buffer.from(shot.result.data, 'base64'))
      console.log('✓ ' + id + '.png')
    }
  }
  // 整页长截图：client 和 security 内容最长的页
  for (const id of ['client', 'security', 'channels']) {
    await ev(`location.hash = '#/${id}'`)
    await sleep(1200)
    const metrics = await send('Page.getLayoutMetrics')
    const h = Math.min(8000, Math.ceil(metrics.result.cssContentSize.height))
    await send('Emulation.setDeviceMetricsOverride', { width: 1600, height: h, deviceScaleFactor: 1, mobile: false })
    await sleep(600)
    const shot = await send('Page.captureScreenshot', { format: 'png' })
    if (shot?.result?.data) {
      const { writeFileSync } = await import('node:fs')
      writeFileSync(join(outDir, id + '-full.png'), Buffer.from(shot.result.data, 'base64'))
      console.log('✓ ' + id + '-full.png (h=' + h + ')')
    }
    await send('Emulation.clearDeviceMetricsOverride')
  }
  ws.close()
  console.log('目录: ' + outDir)
} finally {
  try { gw.kill() } catch { }
  try { edge.kill() } catch { }
  try { rmSync(dataDir, { recursive: true, force: true }) } catch { }
}
