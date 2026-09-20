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

  /* ---------- 分组演示数据（空库一次性播种；已有分组则跳过） ---------- */
  try {
    const gn = storeImpl.db.prepare('SELECT COUNT(*) c FROM user_groups').get().c
    if (gn === 0) {
      const mkUser = storeImpl.db.prepare("INSERT OR IGNORE INTO users (username, password_hash, display_name, role) VALUES (?, ?, ?, 'user')")
      const mkGroup = storeImpl.db.prepare("INSERT OR IGNORE INTO user_groups (name, description, models, quota) VALUES (?, ?, ?, ?)")
      const setGroup = storeImpl.db.prepare('UPDATE users SET group_id = ? WHERE username = ?')

      // 10 个测试分组：额度配法各不相同（叠加/单一/不限），模型白名单 [] = 全部（待网关配置模型后按组勾选）
      const groups = [
        ['研发组', '全模型 · 日+月叠加', [], { dailyTokens: 5e6, dailyAmount: 20, weeklyTokens: 0, weeklyAmount: 0, monthlyTokens: 5e7, monthlyAmount: 0 }],
        ['运营组', '全模型 · 周限额', [], { dailyTokens: 0, dailyAmount: 0, weeklyTokens: 2e7, weeklyAmount: 80, monthlyTokens: 0, monthlyAmount: 0 }],
        ['客服组', '全模型 · 日金额单一', [], { dailyTokens: 0, dailyAmount: 15, weeklyTokens: 0, weeklyAmount: 0, monthlyTokens: 0, monthlyAmount: 0 }],
        ['外包组', '全模型 · 月 Token 单一', [], { dailyTokens: 0, dailyAmount: 0, weeklyTokens: 0, weeklyAmount: 0, monthlyTokens: 3e7, monthlyAmount: 0 }],
        ['财务组', '全模型 · 周月双叠', [], { dailyTokens: 0, dailyAmount: 0, weeklyTokens: 1e7, weeklyAmount: 50, monthlyTokens: 4e7, monthlyAmount: 150 }],
        ['管理层', '全模型 · 不限额', [], {}],
        ['实验组', '全模型 · 日 Token 单一', [], { dailyTokens: 2e6, dailyAmount: 0, weeklyTokens: 0, weeklyAmount: 0, monthlyTokens: 0, monthlyAmount: 0 }],
        ['数据分析组', '全模型 · 日+周叠加', [], { dailyTokens: 8e6, dailyAmount: 30, weeklyTokens: 3e7, weeklyAmount: 0, monthlyTokens: 0, monthlyAmount: 0 }],
        ['市场组', '全模型 · 月金额单一', [], { dailyTokens: 0, dailyAmount: 0, weeklyTokens: 0, weeklyAmount: 0, monthlyTokens: 0, monthlyAmount: 200 }],
        ['实习组', '全模型 · 低额体验', [], { dailyTokens: 1e6, dailyAmount: 5, weeklyTokens: 0, weeklyAmount: 0, monthlyTokens: 1e7, monthlyAmount: 0 }],
      ]
      const gids = []
      for (const [name, desc, models, quota] of groups) {
        const r = mkGroup.run(name, desc, JSON.stringify(models), JSON.stringify(quota))
        gids.push(Number(r.lastInsertRowid))
      }

      // 100 个测试用户：user01-user100，轮流分配进 10 组（每组 10 人）；姓名 = 姓 + 生序号
      const surnames = ['张', '李', '王', '刘', '陈', '杨', '赵', '黄', '周', '吴']
      const cols = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十']
      for (let i = 1; i <= 100; i++) {
        const u = 'user' + String(i).padStart(2, '0')
        const name = surnames[(i - 1) % 10] + cols[Math.floor((i - 1) / 10)]
        mkUser.run(u, hashPassword('Test-' + randomUUID().slice(0, 8)), name)
        setGroup.run(gids[(i - 1) % 10], u)
      }
      console.log('┃ 分组演示数据已播种: 10 个分组 + 100 个测试用户（user01-user100，每组 10 人）')
    }
  } catch (e) { console.warn('分组演示数据播种失败:', e.message) }

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
