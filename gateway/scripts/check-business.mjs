/** 业务体检：心跳 / 最近请求 / 今日统计。用法: node scripts/check-business.mjs [db路径] */
import { DatabaseSync } from 'node:sqlite'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const dbPath = process.argv[2] ?? join(dirname(dirname(fileURLToPath(import.meta.url))), 'data', 'gateway.db')
const db = new DatabaseSync(dbPath)
const hb = db.prepare('SELECT account, MAX(ts) t, COUNT(*) n FROM heartbeats GROUP BY account').all()
console.log('终端心跳:')
hb.forEach((h) => console.log('  ' + (h.account || '(unknown)') + ' · ' + h.n + ' 次 · 最近 ' + new Date(h.t).toLocaleTimeString()))
const rl = db.prepare('SELECT ts, user_name, model, upstream_model, status_code, duration_ms FROM request_logs ORDER BY ts DESC LIMIT 5').all()
console.log('最近请求:')
rl.forEach((r) => console.log('  ' + new Date(r.ts).toLocaleTimeString() + ' ' + r.user_name + ' ' + r.model + ' → ' + (r.upstream_model ?? '') + ' [' + r.status_code + '] ' + r.duration_ms + 'ms'))
const today = db.prepare('SELECT COUNT(*) n, SUM(CASE WHEN status_code=200 THEN 1 ELSE 0 END) ok FROM request_logs WHERE ts > ?').get(new Date().setHours(0, 0, 0, 0))
console.log('今日请求: ' + today.n + ' · 成功 ' + (today.ok ?? 0))
db.close()
