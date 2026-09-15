#!/usr/bin/env node
/** 弹窗专项截图：留痕详情 + 账号活动弹窗（造一条留痕数据后打开弹窗验证宽度） */
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

const dataDir = mkdtempSync(join(tmpdir(), 'dsh-modal-shot-'))
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

  /* 造一条多轮对话留痕（上下文够长才有"费劲"感） */
  const token = login.token
  const ctx = [
    '[system]\n你是企业助理。遵守公司数据安全策略。',
    '[user]\n帮我整理一下昨天会议的要点，参会人是产品部和法务部，主要讨论了新版本的数据合规问题，包括用户同意书的修改要点、数据保留期限的新政策，以及跨境传输需要补充的法务评估流程。',
    '[assistant]\n好的，会议要点整理如下：\n1. 用户同意书：需在注册流程第三步增加明示勾选框，文案由法务提供终版\n2. 数据保留期限：日志类 90 天、审计类 365 天，到期自动清理\n3. 跨境传输：新接入的境外模型服务需先完成 DPIA 评估\n下周三前由产品部出流程图，法务部评审后落地。',
    '[user]\n补充一下，把第 2 点展开写成执行细则，同时检查里面有没有涉及个人敏感信息的表述需要打码，比如手机号 13812345678 这类测试数据。',
  ].join('\n\n')
  await fetch(BASE + '/admin/logs', { method: 'POST', headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' }, body: JSON.stringify({}) }).catch(() => { })
  // 直接往 store 写一条（无公开造数 API：用 e2e 同款 chat 链路太重，改走 sqlite——但浏览器侧更简单：借 /admin/policy 不行，就用 node 子进程插库）
  const { execSync } = await import('node:child_process')
  const insertScript = `
    const { DatabaseSync } = require('node:sqlite');
    const db = new DatabaseSync(${JSON.stringify(join(dataDir, 'gateway.db'))});
    const ctx = ${JSON.stringify(ctx)};
    const resp = '已将第 2 点展开为三条执行细则（含清理脚本与责任人矩阵）；测试手机号 138****5678 已按 DLP 手机号规则脱敏，全文其余表述不含个人敏感信息。细则草稿见附件链接（内网文档中心，编号 LEG-2026-0914-03）。';
    db.prepare("INSERT INTO request_logs (user_name, ts, model, channel_id, upstream_model, prompt, response, prompt_hash, tokens_in, tokens_out, duration_ms, status_code) VALUES ('admin', datetime('now','localtime'), 'ent-default', 'prov-upstream-1', 'your-model-id', ?, ?, 'deadbeefdeadbeef', 812, 356, 2340, 200)").run(ctx, resp);
    console.log('inserted');
  `
  writeFileSync(join(dataDir, 'insert.cjs'), insertScript)
  execSync(`"${process.execPath}" "${join(dataDir, 'insert.cjs')}"`)

  /* 打开留痕详情弹窗 */
  await ev(`location.hash = '#/logs'`)
  await sleep(1500)
  await ev(`(() => { document.querySelector('#auditTableHost [data-log]')?.click(); return 1 })()`)
  await sleep(1200)
  const shot = await send('Page.captureScreenshot', { format: 'png' })
  if (shot?.result?.data) writeFileSync(join(outDir, 'modal-audit-detail.png'), Buffer.from(shot.result.data, 'base64'))
  const dim1 = await ev(`(() => { const el = document.querySelector('#auditLogModal .dlg'); if (!el) return null; const r = el.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height) } })()`)
  console.log('留痕详情弹窗:', JSON.stringify(dim1))
  await ev(`(() => { document.querySelector('#auditLogModal [data-dlg-close]')?.click(); return 1 })()`)
  await sleep(300)

  /* 打开账号活动弹窗 */
  await ev(`location.hash = '#/users'`)
  await sleep(1200)
  await ev(`(() => { document.querySelector('#userList [data-activity]')?.click(); return 1 })()`)
  await sleep(1200)
  const shot2 = await send('Page.captureScreenshot', { format: 'png' })
  if (shot2?.result?.data) writeFileSync(join(outDir, 'modal-user-activity.png'), Buffer.from(shot2.result.data, 'base64'))
  const dim2 = await ev(`(() => { const el = document.querySelector('#userModal .dlg'); if (!el) return null; const r = el.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height) } })()`)
  console.log('账号活动弹窗:', JSON.stringify(dim2))
  ws.close()
} finally {
  try { gw.kill() } catch { }
  try { edge.kill() } catch { }
  try { rmSync(dataDir, { recursive: true, force: true }) } catch { }
}
