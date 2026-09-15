/**
 * 插件 ent-store · provides: store
 * SQLite 留痕（只追加）+ 每日 Merkle 锚 + 心跳/回执存储 + 引导管理员 + 封存/清理定时器
 * 实现模块：src/store.mjs（DB 在模块加载时打开——插件被禁用时不会 import，即不会建库）
 */
import { randomUUID } from 'node:crypto'
import * as storeImpl from '../store.mjs'
import { hashPassword } from '../auth.mjs'

export const name = 'ent-store'
export const provides = ['store']
export const inject = ['config']

export function apply(ctx) {
  ctx.provide('store', storeImpl)

  /* ---------- 引导管理员（原 server.mjs ensureBootstrapAdmin，行为不变） ---------- */
  const n = storeImpl.db.prepare('SELECT COUNT(*) c FROM users').get().c
  if (n === 0) {
    const pwd = randomUUID().replaceAll('-', '').slice(0, 12)
    storeImpl.db.prepare("INSERT INTO users (username, password_hash, display_name, role) VALUES (?, ?, ?, 'admin')")
      .run('admin', hashPassword(pwd), '引导管理员')
    console.log('┃ 引导管理员已创建: admin / 初始密码见下行（仅打印一次）')
    console.log(`┃ 初始密码: ${pwd}`)
  }

  /* ---------- 启动清理（原 startAnchorScheduler 的启动段，行为不变） ---------- */
  try {
    const r = storeImpl.purgeOldData()
    if (r.logs + r.heartbeats + r.authLogs > 0) {
      console.log(`🧹 启动清理过期留痕（>${r.days}天）: 留痕${r.logs} 心跳${r.heartbeats} 登录${r.authLogs}`)
    }
  } catch (e) { console.warn('启动清理失败:', e.message) }

  /* ---------- 每日锚自动封存 + 过期留痕清理定时器（effect 管理生命周期，插件卸载即停） ---------- */
  ctx.effect(() => {
    const timer = setInterval(() => {
      const now = new Date()
      if (now.getHours() === 23 && now.getMinutes() === 59) {
        const r = storeImpl.sealDailyAnchor()
        if (r.sealed) console.log(`[${new Date().toLocaleTimeString('zh-CN', { hour12: false })}] 🔒 每日锚已封存: ${r.day} ${r.count}条 root=${r.root.slice(0, 12)}…`)
      }
      // 每日 00:05 清理过期留痕（audit.retentionDays）
      if (now.getHours() === 0 && now.getMinutes() === 5) {
        try {
          const r = storeImpl.purgeOldData()
          if (r.logs + r.heartbeats + r.authLogs > 0) {
            console.log(`[${new Date().toLocaleTimeString('zh-CN', { hour12: false })}] 🧹 定时清理过期留痕（>${r.days}天）: 留痕${r.logs} 心跳${r.heartbeats} 登录${r.authLogs}`)
          }
        } catch (e) { console.warn('定时清理失败:', e.message) }
      }
    }, 60_000)
    return () => clearInterval(timer)
  }, 'ent-store: anchor scheduler')
}
