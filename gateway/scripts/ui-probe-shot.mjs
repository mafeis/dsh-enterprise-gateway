#!/usr/bin/env node
/**
 * 截图：思考档位设置入口（供应商与模型页）
 *   1. 探测弹窗顶部的「逐档测试档位」勾选组 +「设为默认」按钮
 *   2. 模型编辑器的「自定义档位 / 档位注入参数」字段
 * 用法：node scripts/ui-probe-shot.mjs   （起临时网关 + mock 上游 + headless Edge）
 */
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { createServer } from 'node:net'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = join(root, 'gateway', 'data', 'ui-pages')
mkdirSync(outDir, { recursive: true })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function freePort() {
  return new Promise((resolve, reject) => {
    const s = createServer()
    s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)) })
    s.on('error', reject)
  })
}

// mock 上游（与 modal-probe-check 同款，含一个多模态模型）
import http from 'node:http'
function startMock() {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      let raw = ''
      req.on('data', (c) => { raw += c })
      req.on('end', () => {
        if (req.method === 'GET' && req.url.endsWith('/models')) {
          res.writeHead(200, { 'content-type': 'application/json' })
          res.end(JSON.stringify({ data: [{ id: 'glm-5.3-flash' }, { id: 'qwen-omni' }] }))
          return
        }
        if (req.method === 'POST' && req.url.endsWith('/chat/completions')) {
          const b = JSON.parse(raw || '{}')
          const parts = Array.isArray(b.messages?.[0]?.content) ? b.messages[0].content : []
          const multimodal = parts.length > 0
          res.writeHead(200, { 'content-type': 'application/json' })
          res.end(JSON.stringify({
            choices: [{ message: { role: 'assistant', content: multimodal ? '红色' : '真话者是乙。' } }],
            usage: { completion_tokens_details: { reasoning_tokens: !multimodal && b.reasoning_effort ? 7 : 0 } },
          }))
          return
        }
        res.writeHead(404); res.end('{}')
      })
    })
    srv.listen(0, '127.0.0.1', () => resolve({ srv, port: srv.address().port }))
  })
}

const mock = await startMock()
const dataDir = mkdtempSync(join(tmpdir(), 'dsh-ui-probe-'))
const port = await freePort()
const BASE = `http://127.0.0.1:${port}`

// 先落一份配置：mock 供应商 + 两个模型（其一带自定义档位），页面打开即有内容
const cfg = {
  providers: [{ id: 'mock', name: '演示供应商', baseUrl: `http://127.0.0.1:${mock.port}/v1`, apiKey: 'sk-demo', timeoutMs: 30000, weight: 10, enabled: true }],
  models: [
    { id: 'glm-5.3-flash', displayName: 'GLM 快速', providerId: 'mock', upstreamModel: 'glm-5.3-flash', contextWindow: 128000, maxTokens: 32768, inputModes: ['text'], thinking: 'optional', thinkingLevels: ['off', 'low', 'medium', 'high'], defaultThinking: 'low', fallbackProviders: [], pricePer1kIn: 0, pricePer1kOut: 0, enabled: true },
    { id: 'qwen-omni', displayName: 'Qwen 全模态', providerId: 'mock', upstreamModel: 'qwen-omni', contextWindow: 128000, maxTokens: 32768, inputModes: ['text', 'image', 'video'], thinking: 'optional', thinkingLevels: ['off', 'budget-8k'], thinkingParams: { 'budget-8k': { thinking: { type: 'enabled', budget_tokens: 8192 } } }, defaultThinking: 'off', fallbackProviders: [], pricePer1kIn: 0, pricePer1kOut: 0, enabled: true },
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

const shot = async (name) => {
  const r = await cdpSend('Page.captureScreenshot', { format: 'png' })
  if (r?.result?.data) { writeFileSync(join(outDir, name), Buffer.from(r.result.data, 'base64')); console.log('✓ ' + name) }
}

let ws, mid = 0
const pending = new Map()
function cdpSend(method, params = {}) {
  return new Promise((res) => { const id = ++mid; pending.set(id, res); ws.send(JSON.stringify({ id, method, params })) })
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

  // 登录（拿初始密码 → 注入 JWT）
  await cdpSend('Page.navigate', { url: BASE + '/admin' })
  await sleep(1500)
  const dl = Date.now() + 20000
  let m = null
  while (Date.now() < dl && !(m = gwOut.match(/初始密码: ([0-9a-f]{12})/))) await sleep(200)
  const login = await (await fetch(BASE + '/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: m[1] }) })).json()
  await ev(`localStorage.setItem('ent_jwt', ${JSON.stringify(login.token)})`)
  await cdpSend('Page.navigate', { url: 'about:blank' })
  await sleep(500)
  await cdpSend('Page.navigate', { url: BASE + '/admin#/channels' })
  await sleep(3000)

  // 截图1：整页（供应商卡片 + 模型表，能看到「测试」按钮位置）
  await shot('probe-where-1-page.png')

  // 打开探测弹窗（点演示供应商的「测试」）
  await ev(`document.querySelector('[data-ptest="mock"]')?.click()`)
  await sleep(2500)
  // 截图2：弹窗顶部特写（档位勾选组 + 设为默认按钮）——滚动到弹窗顶部再截
  await ev(`document.querySelector('#probeModal .dlg')?.scrollIntoView()`)
  await sleep(300)
  await shot('probe-where-2-modal-levels.png')

  // 截图2b：点第一行「逐档测试」，等结果出来截展开态（验证行下整行展开不撑坏布局）
  await ev(`document.querySelector('[data-levels]')?.click()`)
  await sleep(4000)
  await shot('probe-where-2b-detail-expanded.png')

  // 截图3：模型编辑器弹窗（编辑 qwen-omni，带自定义档位），滚动到思考区
  await ev(`document.querySelector('#probeModal [data-dlg-close]')?.click()`)
  await sleep(400)
  await ev(`document.querySelector('[data-medit="qwen-omni"]')?.click()`)
  await sleep(800)
  await ev(`document.getElementById('meThinkBox')?.scrollIntoView({ block: 'center' })`)
  await sleep(400)
  await shot('probe-where-3-editor-custom.png')
  // 截图4：编辑器弹窗顶部（遮罩居中效果）
  await ev(`document.querySelector('#modelEditorCard .dlg-body')?.scrollTo(0, 0)`)
  await sleep(300)
  await shot('probe-where-4-editor-modal-top.png')
  // 截图5：供应商编辑器弹窗
  await ev(`document.querySelector('#modelEditorCard [data-dlg-close]')?.click()`)
  await sleep(400)
  await ev(`document.querySelector('[data-pedit="mock"]')?.click()`)
  await sleep(700)
  await shot('probe-where-5-provider-modal.png')
  // 截图3：编辑器思考能力区（自定义档位 + 注入参数）
  await shot('probe-where-3-editor-custom.png')

  console.log('目录: ' + outDir)
} catch (e) {
  console.error('✗', String(e).slice(0, 300))
  if (gwOut) console.error(gwOut.split('\n').slice(-15).join('\n'))
} finally {
  try { gw.kill() } catch { }
  try { edge.kill() } catch { }
  try { mock.srv.close() } catch { }
  try { rmSync(dataDir, { recursive: true, force: true }) } catch { }
}
