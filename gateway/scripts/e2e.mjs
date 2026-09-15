#!/usr/bin/env node
/**
 * 临时端到端验证（插件化改造验收，不入库）：
 * A. 完整插件链路：/policy/current、/heartbeat、DLP 拦截、无上游 502、/usage/me
 * B. 插件禁用：ent-dlp.enabled=false → ent-upstream 明确报错跳过，网关其余部分继续启动
 */
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { createServer } from 'node:net'
import { fileURLToPath } from 'node:url'

const root = dirname(fileURLToPath(import.meta.url))
const BASE = 'http://127.0.0.1'
let failed = false
const ok = (n) => console.log(`✓ ${n}`)
const bad = (n, d) => { failed = true; console.error(`✗ ${n}\n  ${d}`); return false }

function freePort() {
  return new Promise((resolve, reject) => {
    const s = createServer()
    s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)) })
    s.on('error', reject)
  })
}

async function req(method, path, { body, token } = {}) {
  const r = await fetch(BASE + path, {
    method,
    headers: {
      ...(body ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await r.text()
  let json = {}
  try { json = JSON.parse(text) } catch { /* 非 JSON（静态资源等） */ }
  return { status: r.status, json, text }
}

function startGateway(dataDir, port) {
  const child = spawn(process.execPath, [join(root, '..', 'gateway.mjs')], {
    env: {
      ...process.env, PORT: String(port),
      ENT_DATA_DIR: dataDir, ENT_DB_PATH: join(dataDir, 'gateway.db'),
      ENT_GATEWAY_CONFIG: join(dataDir, 'gateway-config.json'),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let out = ''
  child.stdout.on('data', (d) => { out += d })
  child.stderr.on('data', (d) => { out += d })
  return { child, getOut: () => out }
}

async function waitHealth(port) {
  const deadline = Date.now() + 20_000
  while (Date.now() < deadline) {
    try { const h = await req('GET', `:${port}/health`); if (h.status === 200) return h } catch { /* 未起 */ }
    await new Promise((r) => setTimeout(r, 300))
  }
  return null
}

async function withGateway(dataDir, port, configOverride, fn) {
  if (configOverride) writeFileSync(join(dataDir, 'gateway-config.json'), JSON.stringify(configOverride))
  const { child, getOut } = startGateway(dataDir, port)
  try {
    return await fn(getOut)
  } finally {
    try { child.kill() } catch { /* */ }
    await new Promise((r) => setTimeout(r, 300))
    try { rmSync(dataDir, { recursive: true, force: true }) } catch { /* */ }
  }
}

/* ---------- A. 完整链路 ---------- */
async function sectionA() {
  const dataDir = mkdtempSync(join(tmpdir(), 'dsh-gw-e2e-a-'))
  const port = await freePort()
  await withGateway(dataDir, port, null, async (getOut) => {
    const health = await waitHealth(port)
    if (!health) return bad('A: 网关启动', getOut().slice(-800))
    ok(`A: 网关启动 v${health.json.version}`)

    const policy = await req('GET', `:${port}/policy/current`)
    if (policy.status !== 200 || !policy.json.version) return bad('A: /policy/current', JSON.stringify(policy.json).slice(0, 200))
    ok(`A: /policy/current 插件协议 v${policy.json.version} gatewayBaseUrl=${policy.json.gatewayBaseUrl}`)

    const hb = await req('POST', `:${port}/heartbeat`, { body: { profile: 'desktop', env: 'desktop', policyVersion: '1.0.0', node: process.version } })
    if (hb.status !== 200 || hb.json.ok !== true) return bad('A: /heartbeat', JSON.stringify(hb.json).slice(0, 200))
    ok(`A: /heartbeat 心跳 OK fingerprint=${hb.json.modelFingerprint}`)

    const m = getOut().match(/初始密码: ([0-9a-f]{12})/)
    if (!m) return bad('A: 解析初始密码', '未找到')
    const login = await req('POST', `:${port}/auth/login`, { body: { username: 'admin', password: m[1] } })
    if (login.status !== 200) return bad('A: 登录', JSON.stringify(login.json).slice(0, 200))
    const token = login.json.token
    ok('A: 登录 OK')

    // DLP 硬拦截（消息带 sk- 密钥，无需真实上游）
    const blocked = await req('POST', `:${port}/v1/chat/completions`, { token, body: { model: 'ent-default', messages: [{ role: 'user', content: '我的密钥是 sk-abcdefghij1234567890abcd 请保存' }] } })
    if (blocked.status !== 200 || !String(blocked.json.choices?.[0]?.message?.content ?? '').includes('已被安全策略阻断')) {
      return bad('A: DLP 拦截', `HTTP ${blocked.status} ${JSON.stringify(blocked.json).slice(0, 200)}`)
    }
    ok('A: DLP 硬拦截 OK（sk- 密钥被阻断且留痕）')

    // 正常请求 → 无上游密钥 → 502 容灾穷尽（验证 forward + 留痕路径）
    const fwd = await req('POST', `:${port}/v1/chat/completions`, { token, body: { model: 'ent-default', messages: [{ role: 'user', content: '你好' }] } })
    if (fwd.status !== 502) return bad('A: 无上游 502', `HTTP ${fwd.status} ${JSON.stringify(fwd.json).slice(0, 200)}`)
    ok('A: 无上游密钥 → 502 全渠道失败（转发+留痕路径通）')

    const usage = await req('GET', `:${port}/usage/me?days=7`, { token })
    if (usage.status !== 200 || usage.json.ok !== true) return bad('A: /usage/me', JSON.stringify(usage.json).slice(0, 200))
    ok(`A: /usage/me 自助用量 OK（requests=${usage.json.summary.requests}）`)

    const stats = await req('GET', `:${port}/admin/stats`, { token })
    if (stats.status !== 200) return bad('A: /admin/stats', `HTTP ${stats.status}`)
    ok(`A: /admin/stats 今日统计 blocked=${stats.json.today.blocked}`)

    // 插件管理：快照 + 开关落盘（元插件化后 API 由 ent-registry 提供）
    // loaded 数量随内置插件清单走（当前 16：含 ent-catalog）；断言下限防插件静默丢失
    const plugs = await req('GET', `:${port}/admin/plugins`, { token })
    if (plugs.status !== 200 || (plugs.json.loaded?.length ?? 0) < 17) return bad('A: /admin/plugins', `HTTP ${plugs.status} loaded=${plugs.json.loaded?.length}`)
    if (!plugs.json.loaded.some((p) => p.name === 'ent-catalog')) return bad('A: /admin/plugins', 'ent-catalog 未装载')
    const storePlug = plugs.json.loaded.find((p) => p.name === 'ent-store')
    if (!storePlug || !storePlug.provides?.includes('store') || !storePlug.inject?.includes('config')) {
      return bad('A: /admin/plugins 契约展示', JSON.stringify(storePlug).slice(0, 200))
    }
    // manifest 契约可见（安全域插件的 capabilities —— ent-dlp 已并入 ent-security）
    const dlpPlug = plugs.json.loaded.find((p) => p.name === 'ent-security')
    if (!dlpPlug?.manifest?.capabilities?.includes('dlp.scan')) return bad('A: manifest 可见', JSON.stringify(dlpPlug).slice(0, 200))
    // 自带页面声明可见（管理台壳据此动态发现插件页面；规范 docs/admin-plugin-pages.zh.md）
    for (const n of ['ent-registry', 'ent-inspector', 'ent-notify']) {
      const p = plugs.json.loaded.find((x) => x.name === n)
      if (!p?.admin?.nav?.id || !p.admin.entry) return bad('A: admin 页面声明', `${n} 缺 admin.nav/entry`)
    }
    // webDir 服务器路径绝不跨界下发（规范 8.1：私有路径不构成 contract）
    if (plugs.json.loaded.some((p) => p.webDir)) return bad('A: webDir 泄露', '快照含服务器路径')
    ok(`A: /admin/plugins 快照 OK（loaded=${plugs.json.loaded.length}，manifest + admin 页面声明可见，webDir 不下发）`)
    const toggle = await req('PATCH', `:${port}/admin/plugins/ent-notify`, { token, body: { enabled: false } })
    if (toggle.status !== 200 || toggle.json.restartRequired !== true) return bad('A: 插件开关落盘', JSON.stringify(toggle.json).slice(0, 200))
    const plugs2 = await req('GET', `:${port}/admin/plugins`, { token })
    const notifyNow = plugs2.json.loaded.find((p) => p.name === 'ent-notify')
    if (notifyNow?.declared?.enabled !== false) return bad('A: 开关后快照', JSON.stringify(notifyNow).slice(0, 200))
    ok('A: PATCH 开关 ent-notify=false 落盘成功，快照 declared.enabled=false（重启生效）')
    // 还原开关，避免污染下一节
    await req('PATCH', `:${port}/admin/plugins/ent-notify`, { token, body: { enabled: true } })
    const unknown = await req('PATCH', `:${port}/admin/plugins/no-such`, { token, body: { enabled: false } })
    if (unknown.status !== 404) return bad('A: 未知插件 404', `HTTP ${unknown.status}`)
    ok('A: 未知插件开关 → 404')

    // 跨插件协作：inspector 扫描 + query 其他插件 exposes + 事件订阅（notify 收到 DLP 拦截事件）
    const insp = await req('GET', `:${port}/admin/inspector`, { token })
    if (insp.status !== 200 || (insp.json.plugins?.length ?? 0) < 16) return bad('A: /admin/inspector 扫描', `HTTP ${insp.status} plugins=${insp.json.plugins?.length}`)
    const dlpSnap = insp.json.snapshots?.find((s) => s.name === 'ent-security')
    if (!dlpSnap?.ok || typeof dlpSnap.data?.rulesCount !== 'number') return bad('A: inspector query(dlp)', JSON.stringify(dlpSnap).slice(0, 200))
    ok(`A: inspector 扫描 ${insp.json.plugins.length} 插件 + query(ent-security) 拿到 rulesCount=${dlpSnap.data.rulesCount}`)

    const out = getOut()
    for (const p of ['ent-router', 'ent-config', 'ent-registry', 'ent-meta', 'ent-store', 'ent-auth', 'ent-security', 'ent-upstream', 'ent-catalog', 'ent-users', 'ent-billing', 'ent-client', 'ent-audit', 'ent-console', 'ent-inspector', 'ent-notify', 'ent-design']) {
      if (!out.includes(`✓ 插件已装载: ${p}`)) return bad('A: 插件装载日志', `缺少 ${p}`)
    }
    ok(`A: ${17} 个内置插件全部装载成功（日志确认）`)

    // 事件协作端到端：DLP 拦截（上面已发 1 条 sk- 请求）→ ent-notify 缓冲里应有 dlp.blocked
    const notify = await req('GET', `:${port}/admin/notify/recent`, { token })
    if (notify.status !== 200) return bad('A: /admin/notify/recent', `HTTP ${notify.status}`)
    const blockedEvt = notify.json.recent?.find((e) => e.type === 'dlp.blocked')
    if (!blockedEvt) return bad('A: 事件协作 dlp.blocked→notify', JSON.stringify(notify.json).slice(0, 200))
    ok('A: 事件协作 OK：ent-dlp 发 dlp.blocked → ent-notify 已收到（零耦合）')

    // 插件页面资源鉴权（规范 §4：/admin/plug/* 无凭证一律 401，cookie/Bearer 均可过）
    const noAuth = await req('GET', `:${port}/admin/plug/ent-registry/index.mjs`)
    if (noAuth.status !== 401) return bad('A: 插件页面未鉴权', `HTTP ${noAuth.status}（应 401）`)
    const withAuth = await req('GET', `:${port}/admin/plug/ent-registry/index.mjs`, { token })
    if (withAuth.status !== 200 || !withAuth.text?.includes('plugLoadedBody')) return bad('A: 插件页面带凭证', `HTTP ${withAuth.status}`)
    const trav = await req('GET', `:${port}/admin/plug/ent-registry/..%2F..%2Fhost.mjs`, { token })
    if (trav.status !== 404) return bad('A: 插件页面穿越防护', `HTTP ${trav.status}（应 404）`)
    ok('A: 插件页面资源 OK：无凭证 401 / 带凭证 200 / 穿越 404')

    // 插件设置面：总览展示配置（ent-console 自有配置：每区块 enabled + mode，GET/PATCH + 落盘）
    const cfg0 = await req('GET', `:${port}/admin/console-config`, { token })
    if (cfg0.status !== 200 || cfg0.json.sections?.terminals?.enabled !== true) return bad('A: console-config GET', JSON.stringify(cfg0.json).slice(0, 200))
    if (!Array.isArray(cfg0.json.modes?.usage) || !cfg0.json.modeLabels?.table) return bad('A: console-config 模式目录', JSON.stringify(cfg0.json).slice(0, 200))
    const hide = await req('PATCH', `:${port}/admin/console-config`, { token, body: { sections: { terminals: { enabled: false, mode: 'cards' }, usage: false } } })
    if (hide.status !== 200 || hide.json.sections?.terminals?.enabled !== false || hide.json.sections?.terminals?.mode !== 'cards') return bad('A: console-config PATCH', JSON.stringify(hide.json).slice(0, 200))
    if (hide.json.sections?.usage?.enabled !== false || hide.json.sections?.usage?.mode !== 'auto') return bad('A: console-config 布尔兼容', JSON.stringify(hide.json).slice(0, 200))
    const badMode = await req('PATCH', `:${port}/admin/console-config`, { token, body: { sections: { terminals: { enabled: true, mode: 'kpi' } } } })
    if (badMode.status !== 400) return bad('A: console-config 非法 mode', `HTTP ${badMode.status}（应 400）`)
    const badKey = await req('PATCH', `:${port}/admin/console-config`, { token, body: { sections: { nope: true } } })
    if (badKey.status !== 400) return bad('A: console-config 未知区块', `HTTP ${badKey.status}（应 400）`)
    const cfg1 = await req('GET', `:${port}/admin/console-config`, { token })
    if (cfg1.json.sections?.terminals?.mode !== 'cards' || cfg1.json.sections?.req?.enabled !== true) return bad('A: console-config 合并语义', JSON.stringify(cfg1.json).slice(0, 200))
    await req('PATCH', `:${port}/admin/console-config`, { token, body: { sections: { terminals: { enabled: true, mode: 'auto' }, usage: { enabled: true, mode: 'auto' } } } })  // 还原
    ok('A: 总览展示配置 OK：enabled+mode / 布尔兼容 / 非法 mode 400 / 未知区块 400 / 浅合并落盘')

    // ent-audit 插件：留痕查询路由迁移后仍通 + 页面资源 + 设置面
    const logsQ = await req('GET', `:${port}/admin/logs?limit=5`, { token })
    if (logsQ.status !== 200 || !Array.isArray(logsQ.json.logs)) return bad('A: /admin/logs（ent-audit 挂载）', `HTTP ${logsQ.status}`)
    const auditPage = await req('GET', `:${port}/admin/plug/ent-audit/index.mjs`, { token })
    if (auditPage.status !== 200 || !auditPage.text?.includes('ent-audit')) return bad('A: ent-audit 页面资源', `HTTP ${auditPage.status}`)
    const ac0 = await req('GET', `:${port}/admin/audit-config`, { token })
    if (ac0.status !== 200 || ac0.json.ui?.pageSize !== 30) return bad('A: audit-config GET', JSON.stringify(ac0.json).slice(0, 200))
    const ac1 = await req('PATCH', `:${port}/admin/audit-config`, { token, body: { ui: { pageSize: 50, columns: { flag: false } } } })
    if (ac1.status !== 200 || ac1.json.ui?.pageSize !== 50 || ac1.json.ui?.columns?.flag !== false) return bad('A: audit-config PATCH', JSON.stringify(ac1.json).slice(0, 200))
    const acBad = await req('PATCH', `:${port}/admin/audit-config`, { token, body: { ui: { pageSize: 7 } } })
    if (acBad.status !== 400) return bad('A: audit-config 非法 pageSize', `HTTP ${acBad.status}（应 400）`)
    await req('PATCH', `:${port}/admin/audit-config`, { token, body: { ui: { pageSize: 30, columns: { flag: true } } } })  // 还原
    ok('A: ent-audit OK：留痕路由迁移 + 页面资源 + 设置面（pageSize/列显隐/非法 400）')
  })
}

/* ---------- B. 插件禁用 → 依赖插件明确报错 ---------- */
async function sectionB() {
  const dataDir = mkdtempSync(join(tmpdir(), 'dsh-gw-e2e-b-'))
  const port = await freePort()
  await withGateway(dataDir, port, { plugins: { 'ent-security': { enabled: false } } }, async (getOut) => {
    const health = await waitHealth(port)
    if (!health) return bad('B: 网关启动', getOut().slice(-800))
    ok('B: ent-security 禁用后网关仍启动')
    const out = getOut()
    if (!out.includes('○ 插件已禁用: ent-security')) return bad('B: 禁用日志', '缺少禁用提示')
    if (!out.includes('✗ 插件 ent-upstream 缺少服务: dlp')) return bad('B: 依赖报错', '缺少 ent-upstream 缺服务报错')
    if (!out.includes('⚠ 1 个插件未装载: ent-upstream')) return bad('B: 汇总告警', '缺少未装载汇总')
    ok('B: 禁用 ent-security（provides dlp）→ ent-upstream 明确报错跳过（无 PENDING 挂起、无静默）')
  })
}

await sectionA()
await sectionB()

console.log(`\n—— 端到端验收：${failed ? 'FAIL' : 'PASS'} ——`)
process.exit(failed ? 1 : 0)
