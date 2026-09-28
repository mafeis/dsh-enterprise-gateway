/**
 * 管理台准入回归测试（起真实网关进程）
 *
 * 要守住的约定：/admin 前缀 = 管理台 = 只允许管理员。
 * 三条都验，因为历史上漏的正是中间那条（/admin/plugins 曾匿名可读可改，
 * 任何人都能关掉 DLP / 留痕插件）：
 *   · 匿名：能打开登录页，但拿不到任何数据、改不了任何配置
 *   · 普通用户：DSH 客户端登录与自助用量照常，管理台一律 403
 *   · 管理员：数据面 + 插件页面模块照常
 * 另验「降级即时失效」：角色写进 JWT，改角色不吊销旧票 = 30 天内仍然能进管理台。
 */
import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { createServer } from 'node:net'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const freePort = () => new Promise((resolve, reject) => {
  const s = createServer()
  s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)) })
  s.on('error', reject)
})

/** 统一请求：返回 {status, json, cookie}，cookie 用于复现「页面模块只带 HttpOnly cookie」那条链路 */
async function req(base, method, path, { body, token, cookie } = {}) {
  const res = await fetch(base + path, {
    method,
    headers: {
      ...(body ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(cookie ? { cookie } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  let json = null
  try { json = JSON.parse(text) } catch { json = text }
  return { status: res.status, json, cookie: res.headers.getSetCookie?.().find((c) => c.startsWith('ent_jwt=')) ?? '' }
}

async function boot() {
  const dataDir = mkdtempSync(join(tmpdir(), 'dsh-gw-admin-access-'))
  const port = await freePort()
  const child = spawn(process.execPath, [join(ROOT, 'gateway.mjs')], {
    env: {
      ...process.env,
      PORT: String(port),
      ENT_DATA_DIR: dataDir,
      ENT_DB_PATH: join(dataDir, 'gateway.db'),
      ENT_GATEWAY_CONFIG: join(dataDir, 'gateway-config.json'),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let out = ''
  child.stdout.on('data', (d) => { out += d })
  child.stderr.on('data', (d) => { out += d })
  const base = `http://127.0.0.1:${port}`
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    try {
      const h = await req(base, 'GET', '/health')
      if (h.status === 200) break
    } catch { /* 尚未监听 */ }
    await new Promise((r) => setTimeout(r, 250))
  }
  const pw = out.match(/初始密码: ([0-9a-f]{12})/)?.[1]
  assert.ok(pw, '启动日志里应打印引导管理员初始密码：\n' + out.slice(-1500))
  return {
    base,
    stop: () => { try { child.kill() } catch { /* 已退出 */ } rmSync(dataDir, { recursive: true, force: true }) },
    adminPassword: pw,
  }
}

describe('管理台只允许管理员', () => {
  let gw, adminToken, userId

  /** 管理台数据面样本：覆盖各插件挂载的路由（含曾经漏掉的那几条） */
  const ADMIN_PATHS = [
    ['GET', '/admin/stats'],
    ['GET', '/admin/plugins'],
    ['GET', '/admin/users'],
    ['GET', '/admin/config'],
    ['GET', '/admin/logs'],
    ['GET', '/admin/usage'],
    ['GET', '/admin/policy-detail'],
    ['GET', '/admin/nav-config'],
    ['GET', '/admin/console-config'],
    ['GET', '/admin/inspector'],
    ['GET', '/admin/notify/recent'],
    ['GET', '/admin/plug/ent-console/index.mjs'],
  ]
  /** 没有插件挂载过的 /admin 路径：同样先过闸门（闸门不得把 404 变成放行） */
  const UNKNOWN = ['GET', '/admin/never-registered-anywhere']

  before(async () => {
    gw = await boot()
    const login = await req(gw.base, 'POST', '/auth/login', { body: { username: 'admin', password: gw.adminPassword, scope: 'console' } })
    assert.equal(login.status, 200, '管理员应能从管理台登录页登录：' + JSON.stringify(login.json))
    adminToken = login.json.token

    const created = await req(gw.base, 'POST', '/admin/users', { token: adminToken, body: { username: 'alice', password: 'alice-pass-123', role: 'user' } })
    assert.equal(created.status, 200, JSON.stringify(created.json))
    userId = (await req(gw.base, 'GET', '/admin/users', { token: adminToken })).json.users.find((u) => u.username === 'alice').id
  })

  after(() => gw?.stop())

  test('匿名：登录页与壳资源照常可达（管理台打得开）', async () => {
    for (const path of ['/admin', '/admin/static/app.css', '/admin/static/js/main.mjs', '/admin/static/js/login.mjs']) {
      const r = await req(gw.base, 'GET', path)
      assert.equal(r.status, 200, `${path} 必须匿名可达，否则连登录页都打不开`)
    }
  })

  test('匿名：管理台数据与写接口全部 401', async () => {
    for (const [method, path] of [...ADMIN_PATHS, UNKNOWN]) {
      const r = await req(gw.base, method, path)
      assert.equal(r.status, 401, `${method} ${path} 匿名必须 401，实际 ${r.status}`)
    }
    // 曾经的洞：匿名可改插件开关 → 任何人都能关掉 DLP / 留痕
    const toggle = await req(gw.base, 'PATCH', '/admin/plugins/ent-audit', { body: { enabled: false } })
    assert.equal(toggle.status, 401, '匿名关插件必须被拒：' + JSON.stringify(toggle.json))
    const write = await req(gw.base, 'PATCH', '/admin/console-config', { body: { sections: { req: false } } })
    assert.equal(write.status, 401, '匿名改管理台设置必须被拒')
  })

  test('普通用户：客户端登录与自助用量照常', async () => {
    // DSH 客户端登录不带 scope —— 普通员工照常能用，只是进不了管理台
    const login = await req(gw.base, 'POST', '/auth/login', { body: { username: 'alice', password: 'alice-pass-123' } })
    assert.equal(login.status, 200, '普通用户登录（客户端链路）不能被拒：' + JSON.stringify(login.json))
    assert.equal(login.json.user.role, 'user')
    const usage = await req(gw.base, 'GET', '/usage/me', { token: login.json.token })
    assert.equal(usage.status, 200, '自助用量必须照常可用：' + JSON.stringify(usage.json))
  })

  test('普通用户：管理台数据面 / 页面模块一律 403', async () => {
    const login = await req(gw.base, 'POST', '/auth/login', { body: { username: 'alice', password: 'alice-pass-123' } })
    const token = login.json.token
    const cookie = login.cookie
    for (const [method, path] of [...ADMIN_PATHS, UNKNOWN]) {
      const r = await req(gw.base, method, path, { token })
      assert.equal(r.status, 403, `${method} ${path} 普通用户必须 403，实际 ${r.status}`)
      assert.equal(r.json?.error?.type, 'forbidden')
    }
    // 页面模块走的是 HttpOnly cookie（动态 import 不带 Authorization），这条也得堵
    const byCookie = await req(gw.base, 'GET', '/admin/plug/ent-console/index.mjs', { cookie })
    assert.equal(byCookie.status, 403, '普通用户的会话 cookie 不得取到管理台页面模块')
    assert.equal((await req(gw.base, 'PATCH', '/admin/users/' + userId, { token, body: { role: 'admin' } })).status, 403, '普通用户不得自我提权')
  })

  test('普通用户从管理台登录页登录：直接说明「不是管理员」', async () => {
    const r = await req(gw.base, 'POST', '/auth/login', { body: { username: 'alice', password: 'alice-pass-123', scope: 'console' } })
    assert.equal(r.status, 403)
    assert.equal(r.json?.error?.type, 'admin_only')
    assert.ok(!r.json?.token, '拒绝时不得下发凭证')
    // 密码错误时仍是通用文案：不向猜密码的人泄露「这账号是不是管理员」
    const wrong = await req(gw.base, 'POST', '/auth/login', { body: { username: 'alice', password: 'wrong-pass', scope: 'console' } })
    assert.equal(wrong.json?.error?.type, 'auth_failed')
  })

  test('管理员：数据面与插件页面模块照常', async () => {
    for (const [method, path] of ADMIN_PATHS) {
      const r = await req(gw.base, method, path, { token: adminToken })
      assert.equal(r.status, 200, `${method} ${path} 管理员必须 200，实际 ${r.status} ${JSON.stringify(r.json).slice(0, 160)}`)
    }
    // 闸门只管准入，不改路由语义：没人挂载的路径对管理员仍是 404
    assert.equal((await req(gw.base, UNKNOWN[0], UNKNOWN[1], { token: adminToken })).status, 404)
  })

  test('改角色即吊销旧票：降级后不能继续用管理台', async () => {
    const before = await req(gw.base, 'POST', '/auth/login', { body: { username: 'alice', password: 'alice-pass-123' } })
    assert.equal(before.status, 200)

    const promote = await req(gw.base, 'PATCH', '/admin/users/' + userId, { token: adminToken, body: { role: 'admin' } })
    assert.equal(promote.status, 200, JSON.stringify(promote.json))
    assert.equal(promote.json.relogin, true, '角色变更应告知前端需重新登录')
    assert.equal((await req(gw.base, 'GET', '/admin/stats', { token: before.json.token })).status, 401,
      '角色已变，提权前那张票必须立即作废')

    const fresh = await req(gw.base, 'POST', '/auth/login', { body: { username: 'alice', password: 'alice-pass-123', scope: 'console' } })
    assert.equal(fresh.status, 200, '提权并重新登录后应能进管理台')
    assert.equal((await req(gw.base, 'GET', '/admin/stats', { token: fresh.json.token })).status, 200)

    await req(gw.base, 'PATCH', '/admin/users/' + userId, { token: adminToken, body: { role: 'user' } })
    assert.equal((await req(gw.base, 'GET', '/admin/stats', { token: fresh.json.token })).status, 401,
      '降级后旧票必须立即作废——不能等到 30 天自然过期前继续当管理员')
  })
})
