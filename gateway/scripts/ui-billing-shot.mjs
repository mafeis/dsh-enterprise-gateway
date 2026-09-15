#!/usr/bin/env node
/** 计费账单页专项截图：造 14 天多用户/多模型用量数据（含被拦截样本）后导航到 #/billing 截图 */
import { spawn, execSync } from 'node:child_process'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs'
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

const dataDir = mkdtempSync(join(tmpdir(), 'dsh-billing-shot-'))
const port = await freePort()
const BASE = `http://127.0.0.1:${port}`
const cfgPath = join(dataDir, 'gateway-config.json')
/* 网关启动不落盘默认配置（仅管理台保存时写）：这里以 example 为底、配好非零单价后再启动 */
const PRICES = {
  'deepseek-v4-flash': { in: 2, out: 8 },
  'GLM-5.3-Flash': { in: 1, out: 4 },
  'Qwen3.8-Flash': { in: 0.5, out: 2 },
}
{
  const cfg = JSON.parse(readFileSync(join(root, 'gateway-config.example.json'), 'utf8'))
  for (const m of cfg.models ?? []) {
    const p = PRICES[m.id]
    if (p) { m.pricePer1kIn = p.in; m.pricePer1kOut = p.out }
  }
  writeFileSync(cfgPath, JSON.stringify(cfg, null, 2))
}
const gwEnv = { ...process.env, PORT: String(port), ENT_DATA_DIR: dataDir, ENT_DB_PATH: join(dataDir, 'gateway.db'), ENT_GATEWAY_CONFIG: cfgPath }
const gw = spawn(process.execPath, ['gateway.mjs'], { cwd: root, env: gwEnv, stdio: ['ignore', 'pipe', 'pipe'] })
let gwOut = ''
gw.stdout.on('data', (d) => { gwOut += d })
gw.stderr.on('data', (d) => { gwOut += d })
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
const dbgPort = await freePort()
const edge = spawn(EDGE, ['--headless=new', '--disable-gpu', `--remote-debugging-port=${dbgPort}`, `--user-data-dir=${join(dataDir, 'edge')}`, '--no-first-run', 'about:blank', '--window-size=1600,1000'], { stdio: 'ignore' })
const outDir = join(root, 'gateway', 'data', 'ui-pages')
mkdirSync(outDir, { recursive: true })

async function waitBoot() {
  for (let i = 0; i < 40; i++) { await sleep(500); if (gwOut.includes('初始密码')) return true }
  return false
}

try {
  if (!await waitBoot()) throw new Error('网关未启动')

  /* 造 14 天用量：3 个用户 × 3 个模型，金额有起伏；夹 2 条被拦截（不计费） */
  const seed = `
    const { DatabaseSync } = require('node:sqlite');
    const db = new DatabaseSync(${JSON.stringify(join(dataDir, 'gateway.db'))});
    const USERS = ['zhang.qian', 'l.wen', 'admin'];
    const MODELS = [
      ['deepseek-v4-flash', 4200, 2100],
      ['GLM-5.3-Flash', 900, 2600],
      ['Qwen3.8-Flash', 640, 1800],
    ];
    const rows = [];
    let h = 7;
    const rnd = () => { h = (h * 131 + 11) % 9973; return h / 9973; };
    for (let d = 0; d < 14; d++) {
      const wave = 1 + 0.5 * Math.sin(d / 2.2) + rnd() * 0.5;
      for (const [model, pin, pout] of MODELS) {
        const n = 2 + Math.floor(rnd() * 4 * wave);
        for (let i = 0; i < n; i++) {
          const u = USERS[Math.floor(rnd() * USERS.length)];
          const tin = Math.floor((600 + rnd() * 2400) * wave);
          const tout = Math.floor((200 + rnd() * 900) * wave);
          rows.push([u, model, tin, tout, 0]);
        }
      }
    }
    rows.push(['zhang.qian', 'deepseek-v4-flash', 1500, 600, 1]);
    rows.push(['l.wen', 'GLM-5.3-Flash', 300, 200, 1]);
    const ins = db.prepare("INSERT INTO request_logs (user_name, ts, model, channel_id, upstream_model, prompt, response, prompt_hash, tokens_in, tokens_out, duration_ms, status_code, blocked) VALUES (?, datetime('now','localtime', ?), ?, 'prov-upstream-1', ?, '测试输入', '测试输出', printf('%016x', abs(random())), ?, ?, ?, 200, ?)");
    for (const [u, m, tin, tout, blocked] of rows) ins.run(u, '-' + Math.floor(rnd() * 14) + ' days', m, m, tin, tout, 800 + Math.floor(rnd() * 3000), blocked);
    console.log('seeded', rows.length);
  `
  writeFileSync(join(dataDir, 'seed.cjs'), seed)
  console.log(execSync(`"${process.execPath}" "${join(dataDir, 'seed.cjs')}"`).toString().trim())

  /* 登录 → 导航 #/billing → 截图 */
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
  const m = gwOut.match(/初始密码: ([0-9a-f]{12})/)
  const login = await (await fetch(BASE + '/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: m[1] }) })).json()
  await ev(`localStorage.setItem('ent_jwt', ${JSON.stringify(login.token)})`)
  await send('Page.navigate', { url: 'about:blank' })
  await sleep(600)
  await send('Page.navigate', { url: BASE + '/admin#/billing' })
  await sleep(4000)

  const shot = await send('Page.captureScreenshot', { format: 'png' })
  if (shot?.result?.data) writeFileSync(join(outDir, 'billing.png'), Buffer.from(shot.result.data, 'base64'))
  console.log('✓ billing.png（含造数数据）')
  ws.close()
} finally {
  try { gw.kill() } catch { }
  try { edge.kill() } catch { }
  try { rmSync(dataDir, { recursive: true, force: true }) } catch { }
}
