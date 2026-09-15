#!/usr/bin/env node
/**
 * 复现用户场景：探测应用后的模型（thinkingLevels 含 minimal/xhigh 等 6 档预设）
 * 打开「编辑模型」弹窗，断言常用档位勾选与默认档位下拉是否回显正确。
 * 用法：node scripts/editor-echo-check.mjs
 */
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { createServer } from 'node:net'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
function freePort() {
  return new Promise((resolve, reject) => {
    const s = createServer()
    s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)) })
    s.on('error', reject)
  })
}

const dataDir = mkdtempSync(join(tmpdir(), 'dsh-echo-'))
const port = await freePort()
const BASE = `http://127.0.0.1:${port}`

// 用户真实数据形态：探测应用后的模型（大写 ID + 全 6 档预设）
const cfg = {
  providers: [{ id: 'example', name: 'example', baseUrl: 'http://127.0.0.1:9/v1', apiKeyEnv: 'ENT_PROV_EXAMPLE_KEY', timeoutMs: 120000, weight: 10, enabled: true }],
  models: [
    { id: 'deepseek-v4-flash', displayName: 'deepseek-v4-flash', providerId: 'example', upstreamModel: 'deepseek-v4-flash', contextWindow: 128000, maxTokens: 32768, inputModes: ['text', 'image'], mode: 'chat', thinking: 'optional', thinkingLevels: ['off', 'minimal', 'low', 'medium', 'high', 'xhigh'], defaultThinking: 'low', fallbackProviders: [], pricePer1kIn: 0, pricePer1kOut: 0, enabled: true },
    { id: 'Qwen3.8-27B', displayName: 'qwen-27b', providerId: 'example', upstreamModel: 'Qwen3.8-27B', contextWindow: 128000, maxTokens: 32768, inputModes: ['text', 'image', 'video'], mode: 'chat', thinking: 'optional', thinkingLevels: ['off', 'low', 'medium', 'xhigh'], defaultThinking: 'low', fallbackProviders: [], pricePer1kIn: 0, pricePer1kOut: 0, enabled: true },
  ],
}
writeFileSync(join(dataDir, 'gateway-config.json'), JSON.stringify(cfg))

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

let ws, mid = 0
const pending = new Map()
function cdpSend(method, params = {}) {
  return new Promise((res) => { const id = ++mid; pending.set(id, res); ws.send(JSON.stringify({ id, method, params })) })
}

let fails = 0
const assert = (cond, name, detail = '') => {
  console.log((cond ? '✓ ' : '✗ ') + name + (cond || !detail ? '' : ' —— ' + detail))
  if (!cond) fails++
}

try {
  let target
  for (let i = 0; i < 40; i++) {
    await sleep(500)
    try { const l = await (await fetch(`http://127.0.0.1:${dbgPort}/json/list`)).json(); target = l.find((t) => t.type === 'page'); if (target) break } catch { }
  }
  ws = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej })
  ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) } }
  const ev = async (expr) => (await cdpSend('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })).result?.result?.value

  await cdpSend('Page.navigate', { url: BASE + '/admin' })
  await sleep(1500)
  const dl = Date.now() + 20000
  let m = null
  while (Date.now() < dl && !(m = gwOut.match(/初始密码: ([0-9a-f]{12})/))) await sleep(200)
  const login = await (await fetch(BASE + '/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: m[1] }) })).json()
  await ev(`localStorage.setItem('ent_jwt', ${JSON.stringify(login.token)})`)
  await cdpSend('Page.navigate', { url: 'about:blank' })
  await sleep(400)
  await cdpSend('Page.navigate', { url: BASE + '/admin#/channels' })
  await sleep(3000)

  // 场景1：编辑 6 档全预设模型 deepseek-v4-flash（档位只读回显，来源=探测应用）
  await ev(`document.querySelector('[data-medit="deepseek-v4-flash"]')?.click()`)
  await sleep(800)
  const s1 = await ev(`(() => {
    const chips = [...document.querySelectorAll('#meThinkLevelsView .badge')].map(b => b.textContent)
    return {
      chips,
      custom: document.getElementById('meThinkCustom')?.value ?? '(字段已移除)',
      boxHidden: document.getElementById('meThinkBox').hidden,
      def: document.getElementById('meThinkDef').value,
      defOpts: [...document.getElementById('meThinkDef').options].map(o => o.value),
    }
  })()`)
  assert(s1.chips.join(',') === 'off,minimal,low,medium,high,xhigh', '6 档实测结果只读回显', JSON.stringify(s1.chips))
  assert(s1.custom === '(字段已移除)', '自定义档位输入已从模型编辑器移除', s1.custom)
  assert(!s1.boxHidden, '思考档位区可见')
  assert(s1.def === 'low', '默认档位回显 low', s1.def)
  assert(s1.defOpts.join(',') === 'off,minimal,low,medium,high,xhigh', '默认档位下拉含全部 6 档', JSON.stringify(s1.defOpts))

  // 场景2：部分预设模型 Qwen3.8-27B（off/low/medium/xhigh，high 被实测拒绝）
  await ev(`document.getElementById('meCloseBtn')?.click()`)
  await sleep(400)
  await ev(`document.querySelector('[data-medit="Qwen3.8-27B"]')?.click()`)
  await sleep(800)
  const s2 = await ev(`(() => {
    const chips = [...document.querySelectorAll('#meThinkLevelsView .badge')].map(b => b.textContent)
    return { chips, def: document.getElementById('meThinkDef').value, defOpts: [...document.getElementById('meThinkDef').options].map(o => o.value) }
  })()`)
  assert(s2.chips.join(',') === 'off,low,medium,xhigh', '部分档位回显正确（off/low/medium/xhigh，被拒的 high 不出现）', JSON.stringify(s2.chips))
  assert(s2.defOpts.join(',') === 'off,low,medium,xhigh', '默认档位下拉 = 恰好 4 档', JSON.stringify(s2.defOpts))
  assert(s2.def === 'low', '默认档位回显 low', s2.def)

  console.log(fails ? `—— 回显检查：FAIL（${fails} 项）——` : '—— 回显检查：PASS ——')
} catch (e) {
  console.error('✗', String(e).slice(0, 300))
  if (gwOut) console.error(gwOut.split('\n').slice(-15).join('\n'))
  fails++
} finally {
  try { gw.kill() } catch { }
  try { edge.kill() } catch { }
  try { rmSync(dataDir, { recursive: true, force: true }) } catch { }
}
process.exit(fails ? 1 : 0)
