/**
 * 路由处理器工厂 · 运营总览域：今日统计 / 在线终端
 * （供应商/模型 → ent-catalog；留痕/锚 → ent-audit；策略 → ent-client；
 *   用户 → ent-users；计费/自助用量 → ent-billing——谁的业务谁挂路由）
 * 全部要求 admin 角色 JWT。由插件 ent-console 装载，服务依赖注入
 */
import { json } from '../core/http.mjs'

export function createAdminHandler({ config, store, auth }) {
  const { authenticate } = auth
  const { statsToday, statsByUser, recentHeartbeats } = store

  async function requireAdmin(req, res) {
    const authResult = await authenticate(req)
    if (!authResult.ok) { json(res, authResult.status, { error: authResult.error }); return null }
    if (authResult.user.role !== 'admin') {
      json(res, 403, { error: { message: '需要管理员角色', type: 'forbidden' } })
      return null
    }
    return authResult
  }

  return async function handleAdmin(req, res, path, url) {
    const authResult = await requireAdmin(req, res)
    if (!authResult) return true

    /* ---- 统计 / 终端（总览页 KPI 数据源） ---- */
    if (path === '/admin/stats') {
      return json(res, 200, { today: statsToday(), byUser: statsByUser(7) })
    }
    if (path === '/admin/terminals') {
      return json(res, 200, { terminals: recentHeartbeats() })
    }

    // 未识别的 /admin/* 路径：返回 false 交回路由表，让其他插件（users/billing/client/…）有机会处理
    return false
  }
}
