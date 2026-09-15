#!/usr/bin/env node
/**
 * 密钥 .env 化端到端验证：
 *   1. POST 明文 apiKey → 落 data/.env，gateway-config.json 无明文，配置只存 ENT_PROV_*_KEY
 *   2. 重启网关 → .env 自动加载，供应商密钥仍可解析（hasKey=true）
 *   3. 供应商改名 → .env 变量名级联迁移
 *   4. 输入新 Key 覆盖 → .env 整行替换
 *   5. 删除供应商 → .env 变量清理
 *   6. 存量明文残留 → 下一次 saveConfig 时从配置文件清除
 */
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync, readFileSync, existsSync, writeFileSync } from 'node:fs'
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

const dataDir = mkdtempSync(join(tmpdir(), 'dsh-keytest-'))
const envFile = join(dataDir, '.env')
const cfgFile = join(dataDir, 'gateway-config.json')
let fails = 0
const check = (name, cond, detail = '') => { console.log(`${cond ? '✓' : '✗'} ${name}${cond ? '' : ' —— ' + detail}`); if (!cond) fails++ }
const maskEnv = (t) => t.replace(/sk-[A-Za-z0-9-]+/g, 'sk-***')

async function startGateway() {
  const port = await freePort()
  const gw = spawn(process.execPath, ['gateway.mjs'], {
    cwd: root,
    env: { ...process.env, PORT: String(port), ENT_DATA_DIR: dataDir, ENT_DB_PATH: join(dataDir, 'gateway.db'), ENT_GATEWAY_CONFIG: cfgFile },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let out = ''
  gw.stdout.on('data', (d) => { out += d })
  gw.stderr.on('data', (d) => { out += d })
  const dl = Date.now() + 20000
  while (Date.now() < dl) { try { const h = await fetch(`http://127.0.0.1:${port}/health`); if (h.ok) break } catch { /* 未起 */ } await sleep(300) }
  return { gw, port, out }
}

try {
  /* ---- 首启：拿管理员令牌（重启后复用，JWT 密钥默认 + 同一 db，令牌持续有效） ---- */
  let { gw, port, out } = await startGateway()
  const m = out.match(/初始密码: ([0-9a-f]{12})/)
  const login = await (await fetch(`http://127.0.0.1:${port}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: m[1] }) })).json()
  const auth = { authorization: 'Bearer ' + login.token, 'content-type': 'application/json' }
  gw.kill(); await sleep(600)

  /* ---- 1. 新增供应商带明文 Key ---- */
  ;({ gw, port } = await startGateway())
  let BASE = `http://127.0.0.1:${port}`
  const r1 = await (await fetch(BASE + '/admin/providers', { method: 'POST', headers: auth, body: JSON.stringify({ id: 'prov-secret', name: '密钥测试', baseUrl: 'https://api.example.com/v1', apiKey: 'sk-test-secret-123456' }) })).json()
  check('新增供应商带明文 Key 成功', r1.ok === true, JSON.stringify(r1))
  let envText = existsSync(envFile) ? readFileSync(envFile, 'utf8') : ''
  check('Key 已落 data/.env（自动变量名）', envText.includes('=sk-test-secret-123456'), maskEnv(envText))
  let cfgRaw = readFileSync(cfgFile, 'utf8')
  check('gateway-config.json 无明文 Key', !cfgRaw.includes('sk-test-secret-123456'))
  check('配置文件存变量名引用', /"apiKeyEnv":\s*"ENT_PROV_[A-Z_]+_KEY"/.test(cfgRaw), cfgRaw.match(/"apiKeyEnv":[^,]*/)?.[0] ?? '未找到 apiKeyEnv')
  gw.kill(); await sleep(600)

  /* ---- 2. 重启后 .env 自动加载，密钥可解析 ---- */
  ;({ gw, port } = await startGateway())
  BASE = `http://127.0.0.1:${port}`
  const bootLog = readFileSync(envFile, 'utf8')   // .env 持久存在
  const ov = await (await fetch(BASE + '/admin/config', { headers: auth })).json()
  const p2 = ov.providers?.find((x) => x.id === 'prov-secret')
  check('重启后 hasKey=true（.env 已自动加载）', p2?.hasKey === true, JSON.stringify(p2))
  check('重启后 apiKeyEnv 保持引用', /ENT_PROV_[A-Z_]+_KEY/.test(p2?.apiKeyEnv ?? ''), p2?.apiKeyEnv)

  /* ---- 3. 改名 → .env 变量级联 ---- */
  const oldEnvName = p2.apiKeyEnv
  const r3 = await (await fetch(BASE + '/admin/providers/prov-secret', { method: 'PATCH', headers: auth, body: JSON.stringify({ newId: 'prov-renamed' }) })).json()
  check('供应商改名成功', r3.ok === true, JSON.stringify(r3))
  envText = readFileSync(envFile, 'utf8')
  check('.env 变量已迁移到新名且旧行删除', envText.includes('=sk-test-secret-123456') && !envText.includes(oldEnvName + '='), maskEnv(envText))
  cfgRaw = readFileSync(cfgFile, 'utf8')
  check('配置引用同步迁移', cfgRaw.includes('"apiKeyEnv"') && !cfgRaw.includes(oldEnvName), maskEnv(cfgRaw.match(/"apiKeyEnv":[^,]*/)?.[0] ?? ''))

  /* ---- 4. 输入新 Key 覆盖 ---- */
  const r4 = await (await fetch(BASE + '/admin/providers/prov-renamed', { method: 'PATCH', headers: auth, body: JSON.stringify({ apiKey: 'sk-new-key-987654321' }) })).json()
  check('覆盖 Key 成功', r4.ok === true, JSON.stringify(r4))
  envText = readFileSync(envFile, 'utf8')
  check('.env 已更新为新 Key 且无旧行', envText.includes('=sk-new-key-987654321') && !envText.includes('sk-test-secret-123456'), maskEnv(envText))

  /* ---- 5. 删除供应商 → .env 清理 ---- */
  await fetch(BASE + '/admin/models', { method: 'POST', headers: auth, body: JSON.stringify({ id: 'm-test', providerId: 'prov-renamed', upstreamModel: 'up-1' }) })
  await fetch(BASE + '/admin/models/m-test', { method: 'DELETE', headers: auth })
  const r5 = await (await fetch(BASE + '/admin/providers/prov-renamed', { method: 'DELETE', headers: auth })).json()
  check('删除供应商成功', r5.ok === true, JSON.stringify(r5))
  envText = readFileSync(envFile, 'utf8')
  check('.env 密钥变量已清理', !/ENT_PROV_[A-Z_]+_KEY=/.test(envText), maskEnv(envText))

  /* ---- 6. 存量明文残留清除：手工写入带明文的配置，触发一次热更后应被清掉 ---- */
  gw.kill(); await sleep(400)
  const dirty = JSON.parse(readFileSync(cfgFile, 'utf8'))
  dirty.providers.push({ id: 'prov-legacy', name: '遗留明文', baseUrl: 'https://x.example.com/v1', apiKey: 'sk-legacy-plaintext-key', apiKeyEnv: null })
  writeFileSync(cfgFile, JSON.stringify(dirty, null, 2))
  ;({ gw, port } = await startGateway())
  BASE = `http://127.0.0.1:${port}`
  // 触发任意一次 saveConfig（改个供应商权重）
  await fetch(BASE + '/admin/providers/prov-legacy', { method: 'PATCH', headers: auth, body: JSON.stringify({ weight: 5 }) })
  cfgRaw = readFileSync(cfgFile, 'utf8')
  check('存量明文 Key 已从配置文件清除', !cfgRaw.includes('sk-legacy-plaintext-key'), cfgRaw.includes('prov-legacy') ? 'prov-legacy 保留但 apiKey 应为 null' : 'prov-legacy 丢失')
  gw.kill(); await sleep(300)

  console.log(fails ? `—— 密钥链路验证 FAIL（${fails} 项）——` : '—— 密钥链路验证 PASS ——')
  if (fails) process.exitCode = 1
} catch (e) {
  console.error('✗ 验证异常:', String(e).slice(0, 400))
  process.exitCode = 1
} finally {
  try { rmSync(dataDir, { recursive: true, force: true }) } catch { /* 留给系统 */ }
}
