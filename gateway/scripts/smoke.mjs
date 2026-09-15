#!/usr/bin/env node
/**
 * 冒烟测试（无 npm 依赖）：起真实网关进程 → 走通核心链路 → 清理退出
 *   1. GET  /health          网关起来、版本号正确
 *   2. GET  /v1/models       模型目录非空
 *   3. POST /auth/login      引导管理员能登录（从启动日志解析初始密码）
 *   4. POST /auth/verify     JWT 校验通过
 *   5. GET  /admin/stats     管理面鉴权 + 只读统计可用
 * 用法：node scripts/smoke.mjs   （或 npm run smoke）
 */
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { createServer } from 'node:net'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const BASE = `http://127.0.0.1`
const steps = []
let failed = false

const ok = (name) => { steps.push(`✓ ${name}`); console.log(`✓ ${name}`) }
const bad = (name, detail) => { failed = true; steps.push(`✗ ${name}`); console.error(`✗ ${name}\n  ${detail}`) }

/** 取一个当前空闲端口（listen(0) 拿到后立即释放，理论上有竞态，冒烟场景可接受） */
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
  return { status: r.status, json: await r.json().catch(() => ({})) }
}

const dataDir = mkdtempSync(join(tmpdir(), 'dsh-gw-smoke-'))
const port = await freePort()
const child = spawn(process.execPath, [join(root, 'gateway.mjs')], {
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

function stop(code) {
  console.log(`\n—— 冒烟结果：${failed ? 'FAIL' : 'PASS'}（${steps.length} 步）——`)
  if (failed && out.trim()) console.error('—— 网关日志 ——\n' + out.trim().split('\n').slice(-30).join('\n'))
  try { child.kill() } catch { /* 已退出 */ }
  try { rmSync(dataDir, { recursive: true, force: true }) } catch { /* Windows 句柄延迟释放时留给系统临时目录 */ }
  process.exit(code)
}

async function main() {
try {
  // 1. 等待 /health 就绪
  const deadline = Date.now() + 20_000
  let health = null
  while (Date.now() < deadline) {
    try {
      health = await req('GET', `:${port}/health`)
      if (health.status === 200) break
    } catch { /* 未起 */ }
    await new Promise((r) => setTimeout(r, 300))
  }
  if (!health || health.status !== 200) return bad('网关启动 /health', health ? `HTTP ${health.status}` : '20s 内未就绪')
  ok(`网关启动 /health v${health.json.version}（端口 ${port}）`)

  // 2. 模型目录
  const models = await req('GET', `:${port}/v1/models`)
  const n = models.json?.data?.length ?? 0
  if (models.status !== 200 || n === 0) return bad('/v1/models', `HTTP ${models.status}，模型数 ${n}`)
  ok(`/v1/models 返回 ${n} 个模型（${models.json.data.map((m) => m.id).join(', ')}）`)

  // 3. 引导管理员登录（初始密码只在启动日志打印一次）
  const m = out.match(/初始密码: ([0-9a-f]{12})/)
  if (!m) return bad('解析引导管理员初始密码', '启动日志中未找到"初始密码"，admin 可能未创建')
  const login = await req('POST', `:${port}/auth/login`, { body: { username: 'admin', password: m[1] } })
  if (login.status !== 200 || !login.json.token) return bad('/auth/login', `HTTP ${login.status} ${JSON.stringify(login.json).slice(0, 200)}`)
  ok('/auth/login 引导管理员登录成功')

  // 4. JWT 校验
  const verify = await req('POST', `:${port}/auth/verify`, { token: login.json.token })
  if (verify.status !== 200 || verify.json.valid !== true) return bad('/auth/verify', `HTTP ${verify.status} ${JSON.stringify(verify.json).slice(0, 200)}`)
  ok('/auth/verify JWT 校验通过')

  // 5. 管理面鉴权只读端点
  const stats = await req('GET', `:${port}/admin/stats`, { token: login.json.token })
  if (stats.status !== 200) return bad('/admin/stats', `HTTP ${stats.status} ${JSON.stringify(stats.json).slice(0, 200)}`)
  ok('/admin/stats 管理面鉴权可用')

  // 反向验证：无令牌访问管理面必须被拒
  const denied = await req('GET', `:${port}/admin/stats`)
  if (denied.status === 200) return bad('无令牌访问 /admin/stats', '预期 401/403，实际放行——鉴权有洞')
  ok(`无令牌访问管理面被拒（HTTP ${denied.status}）`)
} catch (e) {
  bad('冒烟流程异常', String(e))
} finally {
  stop(failed ? 1 : 0)
}
}

main()
