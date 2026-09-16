/**
 * 企业网关 · 留痕存储（SQLite via node:sqlite，零 npm 依赖；Node 22.5+）
 * 表：request_logs / daily_anchor
 * 设计：只追加；每日 Merkle 锚防篡改
 */
import { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { getConfig } from './config.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const DB_PATH = process.env.ENT_DB_PATH ?? join(__dirname, '..', 'data', 'gateway.db')
mkdirSync(dirname(DB_PATH), { recursive: true })

export const db = new DatabaseSync(DB_PATH)
db.exec('PRAGMA journal_mode = WAL')

/* ---------- 绑定净化：node:sqlite 对 undefined/boolean 直接抛
 * "Provided value cannot be bound to SQLite parameter N"（历史上多次 500 的同一根因）。
 * 在 prepare 层统一兜底：undefined→null、boolean→0/1、命名参数对象逐字段净化。
 * 外部脏字段（插件心跳/回执、上游 usage 等）落 NULL，不再炸 500。 ---------- */
const bindVal = (v) => (v === undefined ? null : typeof v === 'boolean' ? (v ? 1 : 0) : v)
const bindArgs = (args) => args.map((a) => (
  a !== null && typeof a === 'object' && !Array.isArray(a)
    ? Object.fromEntries(Object.entries(a).map(([k, v]) => [k, bindVal(v)]))
    : bindVal(a)
))
const _prepare = db.prepare.bind(db)
db.prepare = (sql) => {
  const stmt = _prepare(sql)
  for (const m of ['run', 'get', 'all']) {
    const fn = stmt[m].bind(stmt)
    stmt[m] = (...args) => fn(...bindArgs(args))
  }
  return stmt
}

/* ---------- 天数参数净化：NaN/负数/超大值插进 datetime('...','-N days') 会直接 SQL 报错 ---------- */
export const daysNum = (v, def) => (Number.isInteger(v) && v > 0 && v <= 365 ? v : def)

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  display_name  TEXT,
  org_path      TEXT DEFAULT '/',
  role          TEXT NOT NULL DEFAULT 'user',
  enabled       INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS request_logs (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  user_name     TEXT NOT NULL,
  ts            TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  model         TEXT,
  channel_id    TEXT,
  upstream_model TEXT,
  prompt        TEXT,
  response      TEXT,
  prompt_hash   TEXT NOT NULL,
  tokens_in     INTEGER,
  tokens_out    INTEGER,
  duration_ms   INTEGER,
  status_code   INTEGER,
  dlp_flag      TEXT,
  blocked       INTEGER NOT NULL DEFAULT 0,
  note          TEXT
);
CREATE INDEX IF NOT EXISTS idx_logs_user_ts ON request_logs(user_name, ts DESC);
CREATE INDEX IF NOT EXISTS idx_logs_ts ON request_logs(ts DESC);
CREATE TABLE IF NOT EXISTS daily_anchor (
  day           TEXT PRIMARY KEY,
  record_count  INTEGER NOT NULL,
  merkle_root   TEXT NOT NULL,
  sealed_at     TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS policy_acks (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  profile       TEXT,
  policy_version TEXT,
  device_hash   TEXT,
  ts            TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS heartbeats (
  device_hash   TEXT NOT NULL,
  profile       TEXT,
  env           TEXT,
  policy_version TEXT,
  node_version  TEXT,
  account       TEXT,
  ts            TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_hb_ts ON heartbeats(ts DESC);
CREATE TABLE IF NOT EXISTS auth_logs (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT NOT NULL,
  ok            INTEGER NOT NULL,
  ip            TEXT,
  user_agent    TEXT,
  ts            TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_auth_user_ts ON auth_logs(username, ts DESC);
`)

// 旧库迁移：heartbeats 补 account / device 列（CREATE IF NOT EXISTS 不会给已存在的表加列）
try { db.exec('ALTER TABLE heartbeats ADD COLUMN account TEXT') } catch { /* 列已存在 */ }
try { db.exec('ALTER TABLE heartbeats ADD COLUMN device TEXT') } catch { /* 列已存在 */ }
// users 补 token_version：登出/改密时 +1，旧 JWT 全部作废（跟随登录状态失效）
try { db.exec('ALTER TABLE users ADD COLUMN token_version INTEGER NOT NULL DEFAULT 1') } catch { /* 列已存在 */ }
// 计费：缓存命中输入 token 数（OpenAI 兼容 prompt_tokens_details.cached_tokens；旧记录为 NULL 视作 0）
try { db.exec('ALTER TABLE request_logs ADD COLUMN tokens_cached INTEGER') } catch { /* 列已存在 */ }
// 插件出现史：设备 × 插件 sighting。心跳 device 快照是覆盖式（只留最新清单），
// 历史安装（尤其装过后被清理的清单外插件）必须落在这张表才能追溯
db.exec(`
CREATE TABLE IF NOT EXISTS plugin_sightings (
  device_hash TEXT NOT NULL,
  plugin      TEXT NOT NULL,
  first_ts    TEXT NOT NULL,
  last_ts     TEXT NOT NULL,
  account     TEXT,
  hostname    TEXT,
  env         TEXT,
  active      INTEGER NOT NULL DEFAULT 1,
  violation   INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (device_hash, plugin)
);
CREATE INDEX IF NOT EXISTS idx_ps_violation ON plugin_sightings(violation, last_ts DESC);
`)

/** 吊销某用户当前所有令牌（登出/改密/封禁时调用）：版本号 +1，旧 JWT 立即失效 */
export function revokeUserTokens(username) {
  db.prepare('UPDATE users SET token_version = token_version + 1 WHERE username = ?').run(username)
}

/** 读用户令牌版本（0 = 用户不存在） */
export function userTokenVersion(username) {
  const r = db.prepare('SELECT token_version FROM users WHERE username = ?').get(username)
  return r?.token_version ?? 0
}

/* ---------- 写入 ---------- */

export function insertLog(rec) {
  db.prepare(`
    INSERT INTO request_logs (user_name, model, channel_id, upstream_model, prompt, response, prompt_hash, ts,
                              tokens_in, tokens_out, tokens_cached, duration_ms, status_code, dlp_flag, blocked, note)
    VALUES (@user_name, @model, @channel_id, @upstream_model, @prompt, @response, @prompt_hash, datetime('now','localtime'),
            @tokens_in, @tokens_out, @tokens_cached, @duration_ms, @status_code, @dlp_flag, @blocked, @note)
  `).run({
    user_name: rec.user_name ?? 'unknown',
    model: rec.model ?? null,
    channel_id: rec.channel_id ?? null,
    upstream_model: rec.upstream_model ?? null,
    prompt: rec.prompt ?? null,
    response: rec.response ?? null,
    prompt_hash: rec.prompt_hash,
    tokens_in: rec.tokens_in ?? null,
    tokens_out: rec.tokens_out ?? null,
    tokens_cached: rec.tokens_cached ?? null,
    duration_ms: rec.duration_ms ?? null,
    status_code: rec.status_code ?? null,
    dlp_flag: rec.dlp_flag ?? null,
    blocked: rec.blocked ?? 0,
    note: rec.note ?? null,
  })
}

export function insertAck(profile, version, deviceHash) {
  db.prepare('INSERT INTO policy_acks (profile, policy_version, device_hash) VALUES (?, ?, ?)')
    .run(profile, version, deviceHash)
}

export function insertHeartbeat(h) {
  db.prepare(`INSERT INTO heartbeats (device_hash, profile, env, policy_version, node_version, account, device)
              VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run(h.device_hash ?? null, h.profile ?? null, h.env ?? null, h.policy_version ?? null, h.node_version ?? null, h.account ?? null, h.device_json ?? null)
}

/** 记录插件 sighting：本轮快照里的插件 upsert（active=1，violation 按当前允许清单打标），
 *  该设备不在本轮快照里的既有行标 active=0（历史保留——"装过后被清除"由此追溯）。
 *  violation 在写入时按当次清单判定；allowed 为空不判违规（与心跳协议口径一致）。 */
export function recordPluginSightings(deviceHash, plugins, { account, hostname, env, allowed } = {}) {
  const list = (Array.isArray(plugins) ? plugins : []).filter((x) => typeof x === 'string' && x)
  const now = db.prepare("SELECT datetime('now') AS t").get().t
  const allowedList = Array.isArray(allowed) ? allowed : []
  const upsert = db.prepare(`
    INSERT INTO plugin_sightings (device_hash, plugin, first_ts, last_ts, account, hostname, env, active, violation)
    VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)
    ON CONFLICT(device_hash, plugin) DO UPDATE SET
      last_ts  = excluded.last_ts,
      account  = COALESCE(excluded.account,  plugin_sightings.account),
      hostname = COALESCE(excluded.hostname, plugin_sightings.hostname),
      env      = COALESCE(excluded.env,      plugin_sightings.env),
      active   = 1,
      violation = excluded.violation
  `)
  for (const p of list) {
    upsert.run(deviceHash, p, now, now, account ?? null, hostname ?? null, env ?? null, allowedList.length && !allowedList.includes(p) ? 1 : 0)
  }
  if (list.length) {
    const marks = list.map(() => '?').join(',')
    db.prepare(`UPDATE plugin_sightings SET active = 0 WHERE device_hash = ? AND plugin NOT IN (${marks})`).run(deviceHash, ...list)
  } else {
    db.prepare('UPDATE plugin_sightings SET active = 0 WHERE device_hash = ?').run(deviceHash)
  }
}

/** 清单外插件历史（含已清除的）：每行 = 设备 × 违规插件，按最近出现排序 */
export function pluginViolationHistory(limit = 200) {
  return db.prepare(`
    SELECT plugin, device_hash,
           account, hostname, env,
           datetime(first_ts, '+8 hours') AS first_local,
           datetime(last_ts,  '+8 hours') AS last_local,
           active
    FROM plugin_sightings
    WHERE violation = 1
    ORDER BY last_ts DESC LIMIT ?
  `).all(limit)
}

/** 该设备最新一条心跳的 device 快照（增量上报时沿用） */
export function latestHeartbeatDevice(deviceHash) {
  const r = db.prepare('SELECT device FROM heartbeats WHERE device_hash = ? AND device IS NOT NULL ORDER BY ts DESC LIMIT 1').get(deviceHash)
  return r?.device ?? null
}

/* ---------- 登录审计 ---------- */

export function insertAuthLog(username, ok, ip, userAgent) {
  // ts 统一存 UTC（与 request_logs/heartbeats 存量一致），查询端 +8h 显示北京时间
  db.prepare("INSERT INTO auth_logs (username, ok, ip, user_agent, ts) VALUES (?, ?, ?, ?, datetime('now'))")
    .run(username, ok ? 1 : 0, ip ?? null, userAgent ? String(userAgent).slice(0, 200) : null)
}

export function recentAuthLogs(username, limit = 30) {
  return db.prepare(`
    SELECT id, username, ok, ip, user_agent, datetime(ts, '+8 hours') AS ts_local
    FROM auth_logs WHERE username = ? ORDER BY ts DESC LIMIT ?
  `).all(username, limit)
}

/* ---------- 账号活动聚合（账号管理详情弹层） ---------- */

/** 账号活动展示量配置（gateway-config.json audit.activity* 可调，非法值回退默认） */
function activityLimits() {
  const a = getConfig()?.audit ?? {}
  const num = (v, def, max = 200) => (Number.isInteger(v) && v > 0 && v <= max ? v : def)
  return {
    days: num(a.activityDays, 7, 90),
    logins: num(a.activityLogins, 20),
    devices: num(a.activityDevices, 20),
    usage: num(a.activityUsage, 20),
  }
}

export function userActivity(username, days = null) {
  const lim = activityLimits()
  const winDays = daysNum(days ?? lim.days, lim.days)
  const logins = recentAuthLogs(username, lim.logins)
  // 该账号的设备（按账号心跳过的设备指纹聚合，附最新设备快照与最后在线）
  const devices = db.prepare(`
    SELECT * FROM (
      SELECT h.device_hash, h.profile, h.env, h.node_version, h.device, h.account,
             datetime(h.ts, '+8 hours') AS ts_local,
             ROW_NUMBER() OVER (PARTITION BY h.device_hash ORDER BY h.ts DESC) AS rn
      FROM heartbeats h WHERE h.account = ? AND h.ts > datetime('now', '-${winDays} days')
    ) WHERE rn = 1 ORDER BY ts_local DESC
  `).all(username).slice(0, lim.devices)
  for (const d of devices) { if (d.device) { try { d.device = JSON.parse(d.device) } catch { d.device = null } } }
  // 使用记录（近 N 日该账号的模型调用，从 request_logs 审计日志聚合）
  const usage = db.prepare(`
    SELECT model, COUNT(*) AS requests,
           COALESCE(SUM(tokens_in), 0) AS tokens_in, COALESCE(SUM(tokens_out), 0) AS tokens_out,
           datetime(MIN(ts), '+8 hours') AS first_use, datetime(MAX(ts), '+8 hours') AS last_use
    FROM request_logs WHERE user_name = ? AND ts > datetime('now', '-${winDays} days')
    GROUP BY model ORDER BY requests DESC
  `).all(username).slice(0, lim.usage)
  // 在线/内存变化序列（近 24h 该账号所有设备的心跳，每 5 分钟采样）
  const memSeries = db.prepare(`
    SELECT datetime(ts, '+8 hours') AS t, mem_free_gb AS v FROM (
      SELECT ts, JSON_EXTRACT(device, '$.memFreeGb') AS mem_free_gb,
             ROW_NUMBER() OVER (ORDER BY ts) AS rn
      FROM heartbeats WHERE account = ? AND device IS NOT NULL AND ts > datetime('now', '-1 day')
    ) WHERE rn % 10 = 1 ORDER BY t
  `).all(username)
  const stats = {
    totalRequests: usage.reduce((s, u) => s + u.requests, 0),
    totalTokens: usage.reduce((s, u) => s + u.tokens_in + u.tokens_out, 0),
    deviceCount: devices.length,
    lastLogin: logins.find((l) => l.ok)?.ts_local ?? null,
  }
  return { logins, devices, usage, memSeries, stats }
}

/* ---------- 查询 ---------- */

/** 留痕检索：过滤（用户/模型关键字/标记）+ 真分页，返回 { logs, total } */
export function queryLogs({ user, model, flag, limit = 50, offset = 0 } = {}) {
  const where = []
  const args = []
  if (user) { where.push('user_name = ?'); args.push(user) }
  if (model) { where.push('(model LIKE ? OR upstream_model LIKE ?)'); args.push(`%${model}%`, `%${model}%`) }
  if (flag === 'blocked') where.push('blocked = 1')
  else if (flag === 'dlp') where.push('dlp_flag IS NOT NULL')
  const w = where.length ? `WHERE ${where.join(' AND ')}` : ''
  const total = db.prepare(`SELECT COUNT(*) c FROM request_logs ${w}`).get(...args).c
  const logs = db.prepare(`SELECT * FROM request_logs ${w} ORDER BY id DESC LIMIT ? OFFSET ?`).all(...args, limit, offset)
  return { logs, total }
}

/** 按 id 取单条留痕（详情弹窗用，不依赖前端缓存） */
export function getLogById(id) {
  return db.prepare('SELECT * FROM request_logs WHERE id = ?').get(id) ?? null
}

export function statsToday() {
  const row = db.prepare(`
    SELECT COUNT(*) total,
           COALESCE(SUM(tokens_in),0) tin,
           COALESCE(SUM(tokens_out),0) tout,
           COUNT(DISTINCT user_name) users,
           SUM(CASE WHEN blocked=1 THEN 1 ELSE 0 END) blocked,
           SUM(CASE WHEN dlp_flag IS NOT NULL THEN 1 ELSE 0 END) dlp
    FROM request_logs WHERE date(ts) = date('now','localtime')
  `).get()
  return row
}

export function statsByUser(days = 7) {
  const d = daysNum(days, 7)
  return db.prepare(`
    SELECT user_name, COUNT(*) requests, COALESCE(SUM(tokens_in+tokens_out),0) tokens
    FROM request_logs WHERE ts > datetime('now','localtime','-${d} days')
    GROUP BY user_name ORDER BY tokens DESC LIMIT 20
  `).all()
}

/* ---------- 用户管理 ---------- */

export function listUsers() {
  return db.prepare('SELECT id, username, display_name, org_path, role, enabled, created_at FROM users ORDER BY id').all()
}

export function createUser({ username, passwordHash, displayName, role = 'user', orgPath = '/' }) {
  db.prepare('INSERT INTO users (username, password_hash, display_name, org_path, role) VALUES (?, ?, ?, ?, ?)')
    .run(username, passwordHash, displayName ?? username, orgPath, role)
}

export function updateUser(id, { displayName, role, enabled, passwordHash, orgPath }) {
  const cur = db.prepare('SELECT * FROM users WHERE id = ?').get(id)
  if (!cur) return { ok: false, reason: 'not-found' }
  db.prepare('UPDATE users SET display_name=?, role=?, enabled=?, password_hash=?, org_path=? WHERE id=?')
    .run(
      displayName ?? cur.display_name,
      role ?? cur.role,
      enabled !== undefined ? (enabled ? 1 : 0) : cur.enabled,
      passwordHash ?? cur.password_hash,
      orgPath ?? cur.org_path,
      id,
    )
  return { ok: true }
}

export function deleteUser(id) {
  const cur = db.prepare('SELECT username FROM users WHERE id = ?').get(id)
  if (!cur) return { ok: false, reason: 'not-found' }
  if (cur.username === 'admin') return { ok: false, reason: 'cannot-delete-bootstrap-admin' }
  db.prepare('DELETE FROM users WHERE id = ?').run(id)
  return { ok: true }
}

/* ---------- 计费（日聚合视图，按需查询生成） ---------- */

export function usageDaily(days = 14) {
  const d = daysNum(days, 14)
  return db.prepare(`
    SELECT date(ts) day,
           user_name,
           COUNT(*) requests,
           COALESCE(SUM(tokens_in),0) tokens_in,
           COALESCE(SUM(tokens_out),0) tokens_out
    FROM request_logs
    WHERE ts > datetime('now','localtime','-${d} days') AND blocked = 0
    GROUP BY date(ts), user_name
    ORDER BY day DESC, tokens_in+tokens_out DESC
  `).all()
}

export function usageSummary(days = 14) {
  const d = daysNum(days, 14)
  return db.prepare(`
    SELECT date(ts) day,
           COUNT(*) requests,
           COALESCE(SUM(tokens_in),0) tokens_in,
           COALESCE(SUM(tokens_out),0) tokens_out,
           COUNT(DISTINCT user_name) users
    FROM request_logs
    WHERE ts > datetime('now','localtime','-${d} days') AND blocked = 0
    GROUP BY date(ts) ORDER BY day DESC
  `).all()
}

/** 计费：按企业模型单价（config.models.pricePer1M*，元/百万token）三段折算每日应付金额（元）
 *  amount = 未命中输入×in + 缓存命中输入×cache + 输出×out（tokens_cached ≤ tokens_in） */
export function usageBill(days = 14, priceMap = {}) {
  const dd = daysNum(days, 14)
  const rows = db.prepare(`
    SELECT date(ts) day, model,
           COUNT(*) requests,
           COALESCE(SUM(tokens_in),0) tokens_in,
           COALESCE(SUM(tokens_out),0) tokens_out,
           COALESCE(SUM(tokens_cached),0) tokens_cached,
           COUNT(DISTINCT user_name) users
    FROM request_logs
    WHERE ts > datetime('now','localtime','-${dd} days') AND blocked = 0
    GROUP BY date(ts), model ORDER BY day DESC
  `).all()
  // 按日合并并按单价折算
  const byDay = new Map()
  for (const r of rows) {
    if (!byDay.has(r.day)) byDay.set(r.day, { day: r.day, requests: 0, tokens_in: 0, tokens_out: 0, tokens_cached: 0, users: 0, amount: 0, byModel: [] })
    const d = byDay.get(r.day)
    const price = priceMap[r.model] ?? { in: 0, out: 0, cache: 0 }
    const cached = Math.min(r.tokens_cached, r.tokens_in)   // 防御：命中数不可能超过输入总数
    const billableIn = r.tokens_in - cached
    const amount = (billableIn / 1e6) * price.in + (cached / 1e6) * (price.cache ?? price.in) + (r.tokens_out / 1e6) * price.out
    d.requests += r.requests; d.tokens_in += r.tokens_in; d.tokens_out += r.tokens_out; d.tokens_cached += cached; d.users = Math.max(d.users, r.users)
    d.amount += amount
    if (r.model) d.byModel.push({ model: r.model, requests: r.requests, amount: Math.round(amount * 1000) / 1000 })
  }
  return [...byDay.values()].map((d) => ({ ...d, amount: Math.round(d.amount * 1000) / 1000 }))
}

export function recentHeartbeats(seconds = 130) {
  // heartbeats.ts 以 UTC 存储（存量表 DDL 未变），过滤用 UTC now 对齐；返回时补 ts_local（北京时间）供前端显示
  // 分区键 = 设备指纹 + 账号：同一台机器上多个 DSH 实例共享指纹但可能登录不同账号/新旧插件混发，
  // 若只按指纹分区，最新一条可能是没带账号的旧插件行 → 终端列表账号时有时无。按（指纹+账号）分区各自取最新。
  const rows = db.prepare(`
    SELECT * FROM (
      SELECT *, datetime(ts, '+8 hours') AS ts_local,
             ROW_NUMBER() OVER (PARTITION BY device_hash, COALESCE(account, '') ORDER BY ts DESC) AS rn
      FROM heartbeats
      WHERE ts > datetime('now', '-${Math.ceil(seconds/60)} minutes')
    ) WHERE rn = 1 ORDER BY ts DESC
  `).all()
  for (const r of rows) {
    if (r.device) { try { r.device = JSON.parse(r.device) } catch { r.device = null } }
  }
  return rows
}

/* ---------- 策略下发回执（灰度进度） ---------- */

/** 插件安装总览：聚合所有心跳快照里的已安装插件清单。
 *  每行 = 一个（设备 × 插件），附账号/主机名/环境/首次与最近一次被监测到的时间（北京时间）。
 *  违规判定由调用方拿允许清单做（避免 store 依赖 config 循环引用）。 */
export function pluginInstallOverview(limit = 300) {
  const rows = db.prepare(`
    SELECT h.device_hash,
           (SELECT h2.account FROM heartbeats h2 WHERE h2.device_hash = h.device_hash AND h2.account IS NOT NULL AND h2.account != '' ORDER BY h2.ts DESC LIMIT 1) AS account,
           (SELECT h2.env FROM heartbeats h2 WHERE h2.device_hash = h.device_hash ORDER BY h2.ts DESC LIMIT 1) AS env,
           MIN(h.ts) AS first_ts,
           MAX(h.ts) AS last_ts,
           datetime(MIN(h.ts), '+8 hours') AS first_local,
           datetime(MAX(h.ts), '+8 hours') AS last_local,
           h.device
    FROM heartbeats h
    WHERE h.device IS NOT NULL
      AND h.ts > datetime('now', '-30 days')
      AND json_valid(h.device)
      AND json_extract(h.device, '$.plugins') IS NOT NULL
      AND json_array_length(h.device, '$.plugins') > 0
    GROUP BY h.device_hash
    ORDER BY last_ts DESC LIMIT ?
  `).all(limit)
  // 按（设备 × 插件）展开
  const out = []
  for (const r of rows) {
    let dev = null
    try { dev = JSON.parse(r.device) } catch { continue }
    for (const name of Array.isArray(dev.plugins) ? dev.plugins : []) {
      out.push({
        plugin: name,
        account: r.account || '未登录',
        hostname: dev.hostname || '',
        env: r.env || '',
        deviceHash: String(r.device_hash).slice(0, 10),
        firstSeen: r.first_local,
        lastSeen: r.last_local,
      })
    }
  }
  out.sort((a, b) => a.plugin.localeCompare(b.plugin) || String(b.lastSeen).localeCompare(String(a.lastSeen)))
  return out
}

/** 回执明细（下发回执页）。账号/环境/Node 版本取该设备最近一次心跳补齐（设备从未发过心跳则为空） */
export function recentPolicyAcks(limit = 50) {
  return db.prepare(`
    SELECT a.profile, a.policy_version, a.device_hash, datetime(a.ts, '+8 hours') AS ts_local,
           (SELECT h.account FROM heartbeats h WHERE h.device_hash = a.device_hash AND h.account IS NOT NULL AND h.account != '' ORDER BY h.ts DESC LIMIT 1) AS account,
           (SELECT h.env FROM heartbeats h WHERE h.device_hash = a.device_hash ORDER BY h.ts DESC LIMIT 1) AS env,
           (SELECT h.node_version FROM heartbeats h WHERE h.device_hash = a.device_hash ORDER BY h.ts DESC LIMIT 1) AS node_version,
           (SELECT datetime(h.ts, '+8 hours') FROM heartbeats h WHERE h.device_hash = a.device_hash ORDER BY h.ts DESC LIMIT 1) AS last_seen_local
    FROM policy_acks a ORDER BY a.id DESC LIMIT ?
  `).all(limit)
}

/** 按策略版本聚合回执：各版本收到多少条、覆盖多少台设备、最早/最晚回执时间（按最近回执排序） */
export function ackVersionStats() {
  return db.prepare(`
    SELECT policy_version,
           COUNT(*) AS acks,
           COUNT(DISTINCT device_hash) AS devices,
           datetime(MIN(ts), '+8 hours') AS first_local,
           datetime(MAX(ts), '+8 hours') AS last_local
    FROM policy_acks
    GROUP BY policy_version
    ORDER BY MAX(ts) DESC
  `).all()
}

/** 窗口内有心跳的设备数（灰度覆盖率的分母参考） */
export function onlineDeviceCount(windowMinutes = 1440) {
  return db.prepare(`SELECT COUNT(DISTINCT device_hash) AS n FROM heartbeats WHERE ts > datetime('now', '-${windowMinutes} minutes')`).get()?.n ?? 0
}

/** 灰度缺口：窗口内有心跳、但对 currentVersion 尚未回执的设备（含心跳侧最后上报的账号/版本，便于区分「没拉到新版」与「拉到了没回执」） */
export function ackPendingDevices(currentVersion, windowMinutes = 1440, limit = 100) {
  return db.prepare(`
    SELECT * FROM (
      SELECT h.device_hash,
             (SELECT h2.account FROM heartbeats h2 WHERE h2.device_hash = h.device_hash AND h2.account IS NOT NULL AND h2.account != '' ORDER BY h2.ts DESC LIMIT 1) AS account,
             (SELECT h2.profile FROM heartbeats h2 WHERE h2.device_hash = h.device_hash ORDER BY h2.ts DESC LIMIT 1) AS profile,
             (SELECT h2.policy_version FROM heartbeats h2 WHERE h2.device_hash = h.device_hash ORDER BY h2.ts DESC LIMIT 1) AS hb_version,
             (SELECT h2.env FROM heartbeats h2 WHERE h2.device_hash = h.device_hash ORDER BY h2.ts DESC LIMIT 1) AS env,
             (SELECT h2.node_version FROM heartbeats h2 WHERE h2.device_hash = h.device_hash ORDER BY h2.ts DESC LIMIT 1) AS node_version,
             MAX(h.ts) AS last_ts,
             datetime(MAX(h.ts), '+8 hours') AS last_seen_local
      FROM heartbeats h
      WHERE h.ts > datetime('now', '-${windowMinutes} minutes')
      GROUP BY h.device_hash
    ) AS t
    WHERE NOT EXISTS (SELECT 1 FROM policy_acks a WHERE a.device_hash = t.device_hash AND a.policy_version = ?)
    ORDER BY last_ts DESC LIMIT ?
  `).all(currentVersion, limit)
}

/* ---------- 过期留痕清理（audit.retentionDays） ---------- */

/** 删除超过保留期的留痕/心跳/登录日志。request_logs 存 localtime，其余表存 UTC，截止线分别对齐。
 *  days 缺省读 audit.retentionDays（非法回退 90）。返回各类删除行数。 */
export function purgeOldData(days = null) {
  const a = getConfig()?.audit ?? {}
  const d = daysNum(days, Number(a.retentionDays) > 0 ? Number(a.retentionDays) : 90)
  const logs = db.prepare(`DELETE FROM request_logs WHERE ts < datetime('now', 'localtime', '-${d} days')`).run()
  const hbs = db.prepare(`DELETE FROM heartbeats WHERE ts < datetime('now', '-${d} days')`).run()
  const auths = db.prepare(`DELETE FROM auth_logs WHERE ts < datetime('now', '-${d} days')`).run()
  return { days: d, logs: logs.changes, heartbeats: hbs.changes, authLogs: auths.changes }
}

/* ---------- 每日锚（定时或管理触发） ---------- */

import { createHash as _ch } from 'node:crypto'

export function sealDailyAnchor() {
  const today = new Date().toLocaleDateString('sv-SE') // YYYY-MM-DD
  const existing = db.prepare('SELECT 1 FROM daily_anchor WHERE day = ?').get(today)
  if (existing) return { sealed: false, reason: 'already-sealed' }
  const rows = db.prepare("SELECT id, prompt_hash FROM request_logs WHERE date(ts) = date('now','localtime') ORDER BY id").all()
  if (rows.length === 0) return { sealed: false, reason: 'no-records' }
  let acc = today
  for (const r of rows) acc = `${acc}:${r.id}:${r.prompt_hash}`
  const root = _ch('sha256').update(acc).digest('hex')
  db.prepare('INSERT INTO daily_anchor (day, record_count, merkle_root) VALUES (?, ?, ?)')
    .run(today, rows.length, root)
  return { sealed: true, day: today, count: rows.length, root }
}

export function verifyAnchor(day) {
  const anchor = db.prepare('SELECT * FROM daily_anchor WHERE day = ?').get(day)
  if (!anchor) return { ok: false, reason: 'no-anchor' }
  const rows = db.prepare("SELECT id, prompt_hash FROM request_logs WHERE date(ts) = ? ORDER BY id").all(day)
  let acc = day
  for (const r of rows) acc = `${acc}:${r.id}:${r.prompt_hash}`
  const root = _ch('sha256').update(acc).digest('hex')
  return { ok: root === anchor.merkle_root, expected: anchor.merkle_root, actual: root, count: rows.length }
}
