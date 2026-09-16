/**
 * 路由处理器工厂 · 运营总览域：今日统计 / 在线终端
 * （供应商/模型 → ent-catalog；留痕/锚 → ent-audit；策略 → ent-client；
 *   用户 → ent-users；计费/自助用量 → ent-billing——谁的业务谁挂路由）
 * 全部要求 admin 角色 JWT。由插件 ent-console 装载，服务依赖注入
 */
import { json } from '../core/http.mjs'

export function createAdminHandler({ config, store, auth }) {
  const { authenticate } = auth
  const { statsToday, statsByUser, recentHeartbeats, pluginInstallOverview, pluginViolationHistory } = store

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
    // 插件安装总览：设备 × 插件矩阵 + 违规标记（允许清单从策略快照取）
    if (path === '/admin/plugin-installs') {
      const rows = pluginInstallOverview()
      const allowed = Array.isArray(config.getConfig().policy?.allowedPlugins) ? config.getConfig().policy.allowedPlugins : []
      for (const r of rows) r.violation = allowed.length > 0 && !allowed.includes(r.plugin)
      return json(res, 200, { installs: rows, allowedCount: allowed.length })
    }
    // 清单外插件历史（含已清除的）：来自 plugin_sightings 出现史表
    if (path === '/admin/plugin-violations') {
      return json(res, 200, { violations: pluginViolationHistory() })
    }

    // 未识别的 /admin/* 路径：返回 false 交回路由表，让其他插件（users/billing/client/…）有机会处理
    return false
  }
}
