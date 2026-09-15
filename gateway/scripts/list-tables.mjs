/** 查库表结构。用法: node scripts/list-tables.mjs [db路径] */
import { DatabaseSync } from 'node:sqlite'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const dbPath = process.argv[2] ?? join(dirname(dirname(fileURLToPath(import.meta.url))), 'data', 'gateway.db')
const db = new DatabaseSync(dbPath)
console.log(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((t) => t.name).join(', '))
db.close()
