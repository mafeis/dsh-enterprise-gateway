#!/usr/bin/env node
/**
 * 菜单管理 E2E：打开弹层 → 上移/隐藏/保存 → 侧边栏即时重排 → 整页重载验证落盘持久化
 * 覆盖：/admin/nav-config GET/PATCH · router 合并排序 · 显隐 · 恢复默认
 */
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs'
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

const dataDir = mkdtempSync(join(tmpdir(), 'dsh-navmgr-'))
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
const edge = spawn(EDGE, ['--headless=new', '--disable-gpu', `--remote-debugging-port=${dbgPort}`, `--user-data-dir=${join(dataDir, 'edge')}`, '--no-first-run', 'about:blank', '--window-size=1360,900'], { stdio: 'ignore' })

let failed = 0
const ok = (cond, label) => { console.log((cond ? '✓' : '✗') + ' ' + label); if (!cond) failed++ }

try {
  let target
  for (let i = 0; i < 40; i++) { await sleep(500); try { const l = await (await fetch(`http://127.0.0.1:${dbgPort}/json/list`)).json(); target = l.find((t) => t.type === 'page'); if (target) break } catch { } }
  if (!target) throw new Error('Edge CDP 未就绪')
  const ws = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej })
  let mid = 0
  const pending = new Map()
  const errors = []
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data)
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) }
    if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text)
  }
  const send = (method, params = {}) => new Promise((res) => { const id = ++mid; pending.set(id, res); ws.send(JSON.stringify({ id, method, params })) })
  const ev = async (expr) => (await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })).result?.result?.value
  await send('Runtime.enable')
  await send('Page.enable')

  /* 登录（与 ui-all-pages-check 同款流程） */
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

  const navIds = () => ev(`[...document.querySelectorAll('.sidebar .nav-item')].map((a) => a.dataset.nav)`)
  const before = await navIds()
  ok(Array.isArray(before) && before.length >= 11, `默认导航注入 ${before?.length} 项`)

  /* API 层：GET 空偏好 */
  const cfg0 = await (await fetch(BASE + '/admin/nav-config', { headers: { authorization: 'Bearer ' + login.token } })).json()
  ok(Array.isArray(cfg0.order) && cfg0.order.length === 0 && Array.isArray(cfg0.hidden) && cfg0.hidden.length === 0, 'GET 初始偏好为空')
  /* API 层：非法 PATCH 被拒绝 */
  const bad = await fetch(BASE + '/admin/nav-config', { method: 'PATCH', headers: { authorization: 'Bearer ' + login.token, 'content-type': 'application/json' }, body: JSON.stringify({ order: 'x' }) })
  ok(bad.status === 400, 'PATCH 非法载荷返回 400')
  const dup = await fetch(BASE + '/admin/nav-config', { method: 'PATCH', headers: { authorization: 'Bearer ' + login.token, 'content-type': 'application/json' }, body: JSON.stringify({ order: ['overview', 'overview'] }) })
  ok(dup.status === 400, 'PATCH 重复 id 返回 400')

  /* 打开菜单管理弹层（入口在 插件管理页 #/plugreg 的「侧边菜单」卡片） */
  await ev(`location.hash = '#/plugreg'`)
  await sleep(1500)
  await ev(`document.getElementById('navManageBtn').click()`)
  await sleep(600)
  const rowsBefore = await ev(`[...document.querySelectorAll('.navmgr-row')].map((r) => r.dataset.id)`)
  ok(Array.isArray(rowsBefore) && rowsBefore.length === before.length, '弹层列出全部导航项')

  /* 效果截图 */
  const shot = await send('Page.captureScreenshot', { format: 'png' })
  if (shot?.result?.data) {
    const outDir = join(root, 'gateway', 'data', 'ui-pages')
    import('node:fs').then((fs) => { fs.mkdirSync(outDir, { recursive: true }); fs.writeFileSync(join(outDir, 'nav-manage.png'), Buffer.from(shot.result.data, 'base64')); console.log('✓ 截图 nav-manage.png') })
    await sleep(500)
  }

  /* UI 操作：把「安全防护」(security) 移到最顶；取消勾选「通知告警」(notify) */
  await ev(`(() => {
    const list = document.querySelector('.navmgr-list');
    const sec = list.querySelector('[data-id="security"]');
    list.firstElementChild.before(sec);
    const notify = list.querySelector('[data-id="notify"]');
    notify.querySelector('.navmgr-vis').checked = false;
    notify.classList.add('off');
    return 1;
  })()`)
  await ev(`document.getElementById('navMgrSave').click()`)
  await sleep(900)

  const after = await navIds()
  ok(after[0] === 'security', `保存后侧边栏首位 = security（实际 ${after[0]}）`)
  ok(!after.includes('notify'), 'notify 已从侧边栏隐藏')
  ok(after.length === before.length - 1, '其余项保留')

  /* 弹层已关闭 */
  ok(!(await ev(`document.querySelector('.modal-mask.show') !== null`)), '保存后弹层关闭')

  /* 落盘验证：gateway-config.json 里应有 plugins.ent-console.config.nav */
  const cfg = JSON.parse(readFileSync(join(dataDir, 'gateway-config.json'), 'utf8'))
  const nav = cfg.plugins?.['ent-console']?.config?.nav
  ok(Array.isArray(nav?.order) && nav.order[0] === 'security' && nav.hidden?.includes('notify'), '偏好已落盘 gateway-config.json')

  /* 整页重载：自定义顺序应保持（网关侧持久化生效） */
  await send('Page.navigate', { url: BASE + '/admin' })
  await sleep(3500)
  const reloaded = await navIds()
  ok(reloaded[0] === 'security' && !reloaded.includes('notify'), '重载后排序与显隐保持')

  /* 隐藏页面路由仍在：直接 hash 导航可达 */
  await ev(`location.hash = '#/notify'`)
  await sleep(1200)
  ok(await ev(`!document.getElementById('page-notify')?.hidden`), '被隐藏的页面经 URL 直达仍可用')

  /* 恢复默认 */
  await ev(`document.getElementById('navManageBtn').click()`)
  await sleep(600)
  await ev(`document.getElementById('navMgrReset').click()`)
  await sleep(900)
  const restored = await navIds()
  ok(restored.length === before.length && restored[0] === before[0], '恢复默认后导航复原')

  /* 恢复默认后再隐藏一项并保存（为 404 回归铺垫干净状态） */
  ok(await ev(`document.querySelector('.modal-mask.show') === null`), '恢复默认后弹层关闭')

  /* 事故回归：/admin/nav-config 404（老网关未重启）时侧边栏必须照常渲染，不能整条消失 */
  await ev(`(() => {
    const raw = window.fetch;
    window.fetch = (url, opts) => String(url).includes('/admin/nav-config')
      ? Promise.resolve(new Response(JSON.stringify({ error: { message: 'not found' } }), { status: 404, headers: { 'content-type': 'application/json' } }))
      : raw(url, opts);
    return 1;
  })()`)
  await send('Page.navigate', { url: BASE + '/admin' })
  await sleep(3500)
  const degraded = await navIds()
  ok(Array.isArray(degraded) && degraded.length === before.length, `nav-config 404 时侧边栏仍完整渲染 ${degraded?.length} 项`)

  ok(errors.length === 0, errors.length ? `JS 异常: ${errors[0]}` : '全程无 JS 运行时异常')
  ws.close()
} catch (e) {
  console.error('✗ 检查中断:', String(e?.message ?? e))
  failed++
} finally {
  try { process.kill(gw.pid) } catch { }
  try { process.kill(edge.pid) } catch { }
  try { rmSync(dataDir, { recursive: true, force: true }) } catch { }
}
process.exit(failed ? 1 : 0)
