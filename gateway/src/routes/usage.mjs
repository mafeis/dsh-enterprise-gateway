/**
 * 路由处理器工厂 · 用户自助用量查询（GET /usage/me?days=7|30|N）
 * 仅返回当前登录用户本人的消耗汇总 / 按模型 / 按日 / 近期明细；
 * 不返回 prompt/response 内容（内容只在管理台审计视图可见）。
 * 时间约定：request_logs.ts 存本地时间（见 store.mjs insertLog），过滤用 localtime 对齐、展示直接用原值。
 * 由插件 ent-admin 装载，服务依赖注入
 */
import { json } from '../core/http.mjs'

export function createUsageHandler({ auth, store }) {
  const { authenticate } = auth
  const { db } = store

  return async function handleUsage(req, res, url) {
    const authResult = await authenticate(req)
    if (!authResult.ok) return json(res, authResult.status, { error: authResult.error })

    const rawDays = Math.round(Number(url.searchParams.get('days')) || 1)
    // days=1 语义为「当天」（本地日历日 00:00 起），而非滚动 24 小时；2 以上为滚动 N 天
    const today = rawDays <= 1
    const days = today ? 1 : Math.min(90, rawDays)
    const user = authResult.user.username
    const sinceClause = today
      ? `ts >= datetime('now','localtime','start of day')`
      : `ts > datetime('now','localtime','-${days} days')`

    const summary = db.prepare(`
      SELECT COUNT(*) AS requests,
             COALESCE(SUM(tokens_in),0)  AS tokens_in,
             COALESCE(SUM(tokens_out),0) AS tokens_out,
             SUM(CASE WHEN blocked=1 THEN 1 ELSE 0 END) AS blocked
      FROM request_logs
      WHERE user_name = ? AND ${sinceClause}
    `).get(user)

    const byModel = db.prepare(`
      SELECT model,
             COUNT(*) AS requests,
             COALESCE(SUM(tokens_in),0)  AS tokens_in,
             COALESCE(SUM(tokens_out),0) AS tokens_out
      FROM request_logs
      WHERE user_name = ? AND ${sinceClause} AND blocked = 0
      GROUP BY model ORDER BY requests DESC
    `).all(user)

    const byDay = db.prepare(`
      SELECT date(ts) AS day,
             COUNT(*) AS requests,
             COALESCE(SUM(tokens_in),0)  AS tokens_in,
             COALESCE(SUM(tokens_out),0) AS tokens_out
      FROM request_logs
      WHERE user_name = ? AND ${sinceClause} AND blocked = 0
      GROUP BY date(ts) ORDER BY day ASC
    `).all(user)

    const recent = db.prepare(`
      SELECT ts, model, upstream_model, tokens_in, tokens_out, duration_ms, status_code, blocked, note
      FROM request_logs
      WHERE user_name = ? AND ${sinceClause}
      ORDER BY id DESC LIMIT 30
    `).all(user)

    // 分组额度余量（未分组 / 组未设额度时省略该字段）
    let quota
    try {
      const g = store.groupOfUser(user)
      if (g) {
        const st = store.groupQuotaState(user, g)
        if (st.hasQuota) quota = { group: st.group, limits: st.limits, used: st.used }
      }
    } catch { /* 额度统计失败不影响用量查询 */ }

    return json(res, 200, { ok: true, user, days, summary, byModel, byDay, recent, ...(quota ? { quota } : {}) })
  }
}
