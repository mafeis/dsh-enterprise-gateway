#!/usr/bin/env node
/**
 * UI 全页检查：起临时网关 + headless Edge，逐个导航到全部插件页面，验证
 *   1) 导航项按插件声明注入  2) 页面模块挂载（section 有内容）
 *   3) 各页标志性元素渲染    4) 无 JS 异常、无意外 401
 * 另对 ent-catalog 页跑交互回归（编辑器校验/confirmDlg/Esc——历史踩坑点）。
 */
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

const dataDir = mkdtempSync(join(tmpdir(), 'dsh-gw-ui-'))
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
gw.on('error', (e) => { console.error('✗ 网关进程异常:', String(e)); process.exitCode = 1 })
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
const dbgPort = await freePort()
const edge = spawn(EDGE, ['--headless=new', '--disable-gpu', `--remote-debugging-port=${dbgPort}`, `--user-data-dir=${join(dataDir, 'edge-profile')}`, '--no-first-run', 'about:blank', '--window-size=1360,900'], { stdio: 'ignore' })
edge.on('error', (e) => { console.error('✗ 无法启动 Edge（请确认安装路径）:', String(e)); process.exitCode = 1 })
try {
  let target
  for (let i = 0; i < 40; i++) { await sleep(500); try { const l = await (await fetch(`http://127.0.0.1:${dbgPort}/json/list`)).json(); target = l.find((t) => t.type === 'page'); if (target) break } catch { /* 未起 */ } }
  if (!target) throw new Error('Edge CDP 未就绪')
  const ws = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej })
  let mid = 0
  const pending = new Map()
  const errors = []
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data)
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id) }
    if (msg.method === 'Runtime.exceptionThrown') errors.push(msg.params.exceptionDetails.exception?.description ?? msg.params.exceptionDetails.text)
  }
  const send = (method, params = {}) => new Promise((res) => { const id = ++mid; pending.set(id, res); ws.send(JSON.stringify({ id, method, params })) })
  const ev = async (expr) => (await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })).result?.result?.value
  await send('Runtime.enable')
  await send('Page.enable')

  // 登录态准备：首次进 /admin 拿会话 → 写 token → about:blank 强制整页重载（hash 导航不会重新引导）
  await send('Page.navigate', { url: BASE + '/admin' })
  await sleep(2000)
  const dl = Date.now() + 20000
  let m = null
  while (Date.now() < dl && !(m = gwOut.match(/初始密码: ([0-9a-f]{12})/))) await sleep(200)
  const login = await (await fetch(BASE + '/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: m[1] }) })).json()
  await ev(`localStorage.setItem('ent_jwt', ${JSON.stringify(login.token)})`)
  await send('Page.navigate', { url: 'about:blank' })
  await sleep(800)
  await send('Page.navigate', { url: BASE + '/admin' })
  await sleep(3500)

  const fails = []
  const check = (name, cond, detail = '') => { console.log(`${cond ? '✓' : '✗'} ${name}${cond ? '' : ' —— ' + detail}`); if (!cond) fails.push(name) }

  /* ---- 导航完整性：11 个页面全部由插件声明注入 ---- */
  const EXPECT = ['overview', 'logs', 'channels', 'users', 'billing', 'security', 'client', 'design', 'plugreg', 'inspector', 'notify']
  const r0 = await ev(`(() => ({
    nav: [...document.querySelectorAll('.nav-item')].map((a) => a.dataset.nav),
    loginGone: document.getElementById('loginMask')?.classList.contains('hidden'),
  }))()`)
  check('登录遮罩已隐藏（boot 正常）', r0.loginGone)
  const missingNav = EXPECT.filter((id) => !r0.nav.includes(id))
  check('11 个插件导航项全部注入', missingNav.length === 0, `缺: ${missingNav.join(',')}; 实际: ${r0.nav.join(',')}`)

  /* ---- 逐页挂载 + 标志性元素 ---- */
  const PAGES = [
    ['overview', '#/overview', () => true],
    ['logs', '#/logs', () => true],
    ['channels', '#/channels', (s) => s.provCards >= 1],
    ['users', '#/users', (s) => !!s.userBodyRows],
    ['billing', '#/billing', (s) => s.billReady],
    ['security', '#/security', (s) => s.hasDlp && s.hasAnchor],
    ['client', '#/client', (s) => s.hasRules && s.hasAck],
    ['design', '#/design', (s) => s.hasDesignTokens],
    ['plugreg', '#/plugreg', () => true],
    ['inspector', '#/inspector', () => true],
    ['notify', '#/notify', () => true],
  ]
  for (const [id, hash, assertFn] of PAGES) {
    await ev(`location.hash = '${hash}'`)
    // 等该 section 显示且有内容
    const s = await (async () => {
      const dl2 = Date.now() + 8000
      while (Date.now() < dl2) {
        const st = await ev(`(() => {
          const sec = document.getElementById('page-${id}')
          return {
            visible: sec && !sec.hidden,
            len: sec?.innerHTML?.length ?? 0,
            provCards: document.querySelectorAll('.prov-item').length,
            userBodyRows: document.querySelectorAll('#userList .user-item').length,
            billReady: !!document.getElementById('billBody') && !document.getElementById('billBody')?.textContent.includes('加载中'),
            hasDlp: !!document.getElementById('dlpBody'),
            hasAnchor: !!document.getElementById('anchorVerifyBtn'),
            hasRules: !!document.getElementById('rulesBody'),
            hasAck: !!document.getElementById('ackBody'),
            hasDesignTokens: !!document.querySelector('#page-design .sw'),
          }
        })()`)
        if (st && st.visible && st.len > 200 && assertFn(st)) return st
        await sleep(250)
      }
      return null
    })()
    check(`页面挂载: ${id}`, !!s, s ? JSON.stringify(s).slice(0, 160) : '8s 超时未挂载')
  }

  /* ---- ent-catalog 交互回归（历史踩坑点） ---- */
  await ev(`location.hash = '#/channels'`)
  await sleep(800)
  // 无匹配词空态
  await ev(`(() => { const i = document.getElementById('filterInput'); i.value = 'zzz-no-match-zzz'; i.dispatchEvent(new Event('input')); return 1 })()`)
  await sleep(400)
  const r2 = await ev(`(() => ({
    emptyProv: !!document.querySelector('#provList .empty'),
    emptyModel: !!document.querySelector('#modelBody .empty'),
  }))()`)
  check('无匹配词显示空态', r2.emptyProv && r2.emptyModel, JSON.stringify(r2))
  await ev(`(() => { const i = document.getElementById('filterInput'); i.value = ''; i.dispatchEvent(new Event('input')); return 1 })()`)
  await sleep(400)
  // 编辑器必填校验
  await ev(`document.getElementById('addProvBtn').click()`)
  await sleep(300)
  await ev(`(() => { document.getElementById('peName').value = ''; document.getElementById('peSaveBtn').click(); return 1 })()`)
  await sleep(200)
  const r3 = await ev(`document.getElementById('peErr').textContent`)
  check('供应商编辑器必填校验', /不能为空/.test(r3 ?? ''), String(r3))
  await ev(`document.getElementById('peCloseBtn').click()`)
  await sleep(200)
  // 改 ID 确认弹窗（confirmDlg 生效 + Esc 关闭）——改 ID 是危险操作，才弹确认
  await ev(`(() => { document.querySelector('[data-pedit]')?.click(); return 1 })()`)
  await sleep(600)   // 等编辑器带出原值（api 往返）
  await ev(`(() => {
    const id = document.getElementById('peId'); id.value = id.value + 'x';
    document.getElementById('peSaveBtn').click(); return 1
  })()`)
  await sleep(500)
  const dlg = await ev(`(() => ({ shown: !!document.querySelector('.confirm-mask.show'), msg: document.getElementById('cfrmMsg')?.textContent ?? '' }))()`)
  check('供应商改名弹出确认框（confirmDlg 生效）', dlg.shown, JSON.stringify(dlg))
  await ev(`(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); return 1 })()`)
  await sleep(300)
  const after = await ev(`(() => ({ mask: document.querySelector('.confirm-mask.show') ? 1 : 0, name: document.querySelector('.prov-item b, .prov-item strong')?.textContent ?? '' }))()`)
  check('Esc 关闭确认框且名称未改', after.mask === 0, JSON.stringify(after))
  await ev(`document.getElementById('peCloseBtn')?.click()`)

  /* ---- 无异常 / 无 401 ---- */
  const maskBack = await ev(`!document.getElementById('loginMask').classList.contains('hidden')`)
  check('全程无意外 401（登录遮罩未复现）', !maskBack)
  const realErrors = errors.filter((e) => !e.includes('Failed to load resource'))
  check('无 JS 运行时异常', realErrors.length === 0, realErrors.join(' | ').slice(0, 300))

  // 终局截图（回到总览）
  await ev(`location.hash = '#/overview'`)
  await sleep(800)
  const shot = await send('Page.captureScreenshot', { format: 'png' })
  if (shot?.result?.data) {
    mkdirSync(join(root, 'gateway', 'data'), { recursive: true })
    writeFileSync(join(root, 'gateway', 'data', 'all-pages-ui-check.png'), Buffer.from(shot.result.data, 'base64'))
    console.log('截图: gateway/data/all-pages-ui-check.png')
  }

  console.log(fails.length ? `—— UI 检查 FAIL（${fails.length} 项）——` : '—— UI 检查 PASS ——')
  if (fails.length) process.exitCode = 1
  ws.close()
} catch (e) {
  console.error('✗ 诊断流程异常:', String(e).slice(0, 400))
  process.exitCode = 1
} finally {
  try { gw.kill() } catch { /* 已退出 */ }
  try { edge.kill() } catch { /* 已退出 */ }
  try { rmSync(dataDir, { recursive: true, force: true }) } catch { /* 留给系统临时目录 */ }
}
