#!/usr/bin/env node
/**
 * UI 诊断：供应商与模型页（#/channels）改版验证
 * 起临时网关（临时数据目录，跑完清理）→ 无头 Edge CDP 驱动 /admin#/channels →
 * 渲染检查 + 搜索过滤 + 编辑器校验 + 改名确认弹窗（回归 confirmDlg 导入）+ 删除确认 + 截图
 * 用法：node scripts/ui-channels-check.mjs
 */
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { createServer } from 'node:net'
import { fileURLToPath } from 'node:url'

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
const root = join(dirname(fileURLToPath(import.meta.url)), '..')

function freePort() {
  return new Promise((resolve, reject) => {
    const s = createServer()
    s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)) })
    s.on('error', reject)
  })
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/* ---------- 1. 临时网关 ---------- */
const dataDir = mkdtempSync(join(tmpdir(), 'dsh-gw-ui-'))
const port = await freePort()
const gw = spawn(process.execPath, [join(root, 'gateway.mjs')], {
  env: { ...process.env, PORT: String(port), ENT_DATA_DIR: dataDir, ENT_DB_PATH: join(dataDir, 'gateway.db'), ENT_GATEWAY_CONFIG: join(dataDir, 'gateway-config.json') },
  stdio: ['ignore', 'pipe', 'pipe'],
})
gw.on('error', (e) => { console.error('✗ 网关进程启动失败:', String(e)); process.exitCode = 1 })   // 无 error 监听时 ENOENT 会直接崩掉进程、跳过全部清理
let gwOut = ''
gw.stdout.on('data', (d) => { gwOut += d })
gw.stderr.on('data', (d) => { gwOut += d })

let BASE = `http://127.0.0.1:${port}`, token = null
try {
  const deadline = Date.now() + 20_000
  while (Date.now() < deadline) {
    try { const h = await fetch(BASE + '/health'); if (h.ok) break } catch { /* 未起 */ }
    await sleep(300)
  }
  const m = gwOut.match(/初始密码: ([0-9a-f]{12})/)
  if (!m) throw new Error('未解析到引导管理员初始密码')
  const login = await (await fetch(BASE + '/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: m[1] }) })).json()
  token = login.token
  if (!token) throw new Error('登录失败: ' + JSON.stringify(login).slice(0, 200))

  /* ---------- 2. 无头 Edge + CDP ---------- */
  const dbgPort = await freePort()
  const edge = spawn(EDGE, ['--headless=new', '--disable-gpu', `--remote-debugging-port=${dbgPort}`, `--user-data-dir=${join(dataDir, 'edge-profile')}`, '--no-first-run', 'about:blank', '--window-size=1360,900'], { stdio: 'ignore' })
  edge.on('error', (e) => { console.error('✗ 无法启动 Edge（请确认安装路径）:', String(e)); process.exitCode = 1 })   // ENOENT 是异步 error 事件，不接住会崩过 finally
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

    const fails = []
    const check = (name, cond, detail = '') => { console.log(`${cond ? '✓' : '✗'} ${name}${cond ? '' : ' —— ' + detail}`); if (!cond) fails.push(name) }
    /** 轮询等待页面状态就绪（避开固定 sleep 的竞态） */
    const waitFor = async (expr, timeout = 5000) => {
      const dl = Date.now() + timeout
      while (Date.now() < dl) {
        if (await ev(expr)) return true
        await sleep(200)
      }
      return false
    }

    await send('Page.navigate', { url: BASE + '/admin' })
    await sleep(2000)
    await ev(`localStorage.setItem('ent_jwt', ${JSON.stringify(token)})`)
    // 必须经 about:blank 强制整页重载：/admin → /admin#/channels 只是 hash 变化不会重新引导，
    // boot（stats→refresh→发会话 cookie→隐藏登录遮罩）就不会跑，插件页面模块会 401
    await send('Page.navigate', { url: 'about:blank' })
    await sleep(800)
    await send('Page.navigate', { url: BASE + '/admin#/channels' })
    // 等插件页面模块挂载（#/channels 由 ent-catalog 插件动态注册，比壳静态页慢一拍）
    const r1 = await (async () => {
      const dl = Date.now() + 10000
      while (Date.now() < dl) {
        const s = await ev(`(() => ({
          provCards: document.querySelectorAll('.prov-item').length,
          modelRows: document.querySelectorAll('#modelBody tr:not(:has(.empty))').length,
          provLoading: document.getElementById('provList')?.textContent.includes('加载中'),
          filterPh: document.getElementById('filterInput')?.placeholder ?? '',
        }))()`)
        if (s && (s.provCards > 0 || (s.filterPh && !s.provLoading))) return s
        await sleep(250)
      }
      return null
    })()
    if (!r1) {
      console.error('✗ 插件页面未挂载（10s 超时）——检查 /admin/plugins 是否含 ent-catalog 及页面模块装载')
      const shotErr = await send('Page.captureScreenshot', { format: 'png' })
      if (shotErr?.result?.data) {
        mkdirSync(join(root, 'gateway', 'data'), { recursive: true })
        writeFileSync(join(root, 'gateway', 'data', 'channels-ui-check.png'), Buffer.from(shotErr.result.data, 'base64'))
      }
      process.exitCode = 1
      ws.close()
    } else {
      check('供应商卡片渲染', r1.provCards >= 1, JSON.stringify(r1))
      check('模型行渲染', r1.modelRows >= 1, JSON.stringify(r1))
      check('初始「加载中」已被数据替换', !r1.provLoading)

      // 渲染态截图（此时页面应完整可见）
      const shot0 = await send('Page.captureScreenshot', { format: 'png' })
      if (shot0?.result?.data) {
        const outDir = join(root, 'gateway', 'data')
        mkdirSync(outDir, { recursive: true })
        writeFileSync(join(outDir, 'channels-ui-check.png'), Buffer.from(shot0.result.data, 'base64'))
        console.log('截图: gateway/data/channels-ui-check.png')
      }

      // 搜索过滤（防抖 150ms）
      await ev(`(() => { const i = document.getElementById('filterInput'); i.value = 'zzz-no-match-zzz'; i.dispatchEvent(new Event('input')); return 1 })()`)
      await sleep(400)
      const r2 = await ev(`(() => ({
        emptyProv: !!document.querySelector('#provList .empty'),
        emptyModel: !!document.querySelector('#modelBody .empty'),
      }))()`)
      check('无匹配词显示空态', r2.emptyProv && r2.emptyModel, JSON.stringify(r2))
      await ev(`(() => { const i = document.getElementById('filterInput'); i.value = ''; i.dispatchEvent(new Event('input')); return 1 })()`)
      await sleep(400)

      // 供应商编辑器：客户端校验（名称为空保存应报错且不发请求）
      await ev(`document.getElementById('addProvBtn').click()`)
      await sleep(300)
      await ev(`(() => { document.getElementById('peName').value = ''; document.getElementById('peSaveBtn').click(); return 1 })()`)
      await sleep(200)
      const r3 = await ev(`document.getElementById('peErr').textContent`)
      check('供应商编辑器必填校验', /不能为空/.test(r3 ?? ''), String(r3))
      await ev(`document.getElementById('peCloseBtn').click()`)

      // 改名确认弹窗（回归：confirmDlg 未导入会 ReferenceError）
      await ev(`(() => { document.querySelector('[data-pedit]')?.click(); return 1 })()`)
      // 等编辑器带出该供应商的值（api 往返完成后 peId 才有 orig）
      const rEdit = await waitFor(`(() => {
        const el = document.getElementById('peId');
        return !document.getElementById('provEditorCard').hidden && !!el.value && !!el.dataset.orig;
      })()`)
      check('编辑器带出供应商原值', rEdit === true)
      await ev(`(() => {
        const id = document.getElementById('peId'); id.value = id.value + 'x';
        document.getElementById('peSaveBtn').click(); return 1
      })()`)
      const r4 = await waitFor(`!!document.querySelector('.confirm-mask.show')`)
      check('供应商改名弹出确认框（confirmDlg 生效）', r4 === true)
      await ev(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); 1`)   // 关确认框
      await ev(`document.getElementById('peCloseBtn').click()`)   // 关编辑器
      await sleep(200)

      // 模型删除确认（原生 confirm 已替换为 confirmDlg）
      await ev(`(() => { document.querySelector('[data-mdel]')?.click(); return 1 })()`)
      const r5 = await waitFor(`(() => {
        const m = document.querySelector('.confirm-mask.show');
        return m ? { mask: true, title: document.getElementById('cfrmTitle')?.textContent ?? '' } : false;
      })()`)
      check('模型删除弹出确认框', !!r5, JSON.stringify(r5))
      // Esc 关闭确认框
      await ev(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`)
      await sleep(300)
      const r6 = await ev(`(() => ({ maskGone: !document.querySelector('.confirm-mask.show'), rows: document.querySelectorAll('#modelBody tr').length }))()`)
      check('Esc 关闭确认框且行未被删除', r6.maskGone && r6.rows >= 1, JSON.stringify(r6))

      // 无 JS 异常
      check('无 JS 运行时异常', errors.length === 0, errors.join(' | ').slice(0, 400))

      // 收尾态：登录遮罩不应被 401 重新拉起（若拉起说明有请求意外 401）
      const r7 = await ev(`(() => ({ loginShown: !document.getElementById('loginMask').classList.contains('hidden'), rows: document.querySelectorAll('#modelBody tr:not(:has(.empty))').length }))()`)
      check('全程无意外 401（登录遮罩未复现）', r7.loginShown === false, JSON.stringify(r7))

      console.log(fails.length ? `—— UI 检查 FAIL（${fails.length} 项）——` : '—— UI 检查 PASS ——')
      process.exitCode = fails.length ? 1 : 0
    }
  } finally {
    try { edge.kill() } catch { /* 已退出 */ }
  }
} catch (e) {
  console.error('✗ 诊断流程异常:', String(e))
  console.error(gwOut.trim().split('\n').slice(-20).join('\n'))
  process.exitCode = 1
} finally {
  try { gw.kill() } catch { /* 已退出 */ }
  try { rmSync(dataDir, { recursive: true, force: true }) } catch { /* 句柄延迟时留给系统临时目录 */ }
}
