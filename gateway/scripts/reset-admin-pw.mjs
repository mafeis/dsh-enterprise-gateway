/** 重置 admin 密码（用网关自己的 scrypt 实现）。用法: node scripts/reset-admin-pw.mjs <新密码> [db路径] */
import { pathToFileURL } from 'node:url'
import { DatabaseSync } from 'node:sqlite'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const pw = process.argv[2]
if (!pw) { console.error('用法: node reset-admin-pw.mjs <新密码> [db路径]'); process.exit(1) }
const dbPath = process.argv[3] ?? join(dirname(dirname(fileURLToPath(import.meta.url))), 'data', 'gateway.db')
const srcRoot = join(dirname(dirname(fileURLToPath(import.meta.url))), 'src')
const auth = await import(pathToFileURL(join(srcRoot, 'auth.mjs')).href)
const db = new DatabaseSync(dbPath)
const hash = auth.hashPassword(pw)
db.prepare('UPDATE users SET password_hash = ?, token_version = token_version + 1 WHERE username = ?').run(hash, 'admin')
const row = db.prepare('SELECT username, token_version FROM users WHERE username = ?').get('admin')
console.log('已重置:', row.username, '· token_version =', row.token_version)
db.close()
