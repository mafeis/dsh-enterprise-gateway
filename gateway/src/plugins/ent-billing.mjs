/**
 * 插件 ent-billing · 用量与计费域（= 账单 API + 员工自助用量 + 管理页面）
 * 路由：
 *   GET /admin/usage   管理侧：按日聚合 + 按企业模型单价折算应付金额（admin 角色）
 *   GET /usage/me      员工侧：仅当前登录用户本人的消耗汇总（不含内容，不含他人数据）
 * 页面：计费账单（近 14 日按日账单 + 分模型明细）
 * 数据来自 store 服务（usageSummary/usageDaily/usageBill/db）；单价来自 config（models.pricePer1M*，元/百万token）
 */
import { createUsageHandler } from '../routes/usage.mjs'
import { json } from '../core/http.mjs'

export const name = 'ent-billing'
export const provides = []
export const inject = ['config', 'store', 'auth', 'router']

/** 自带页面：计费账单（按日聚合 + 按企业模型单价折算） */
export const admin = {
  nav: { id: 'billing', title: '计费账单', titleEn: 'Billing', icon: 'receipt', order: 50 },
  entry: 'index.mjs',
}

export function apply(ctx) {
  const router = ctx.get('router')
  const auth = ctx.get('auth')
  const { getConfig, priceMap } = ctx.get('config')
  const { usageDaily, usageSummary, usageBill } = ctx.get('store')
  const handleUsage = createUsageHandler({ auth, store: ctx.get('store') })

  /** 管理员鉴权（与 ent-console 管理面同一策略） */
  async function requireAdmin(req, res) {
    const a = await auth.authenticate(req)
    if (!a.ok) { json(res, a.status, { error: a.error }); return null }
    if (a.user.role !== 'admin') { json(res, 403, { error: { message: '需要管理员角色', type: 'forbidden' } }); return null }
    return a
  }

  ctx.effect(() => router.exact('GET', '/usage/me', (req, res, _path, url) => handleUsage(req, res, url)), 'ent-billing: route GET /usage/me')

  ctx.effect(() => router.exact('GET', '/admin/usage', async (req, res, _path, url) => {
    const u = await requireAdmin(req, res)
    if (!u) return true
    const rawDays = Math.round(Number(url.searchParams.get('days')) || 14)
    const days = Math.min(90, Math.max(1, rawDays))
    const pm = priceMap()
    const c = getConfig()
    return json(res, 200, {
      daily: usageSummary(days), byUserDay: usageDaily(days), billed: usageBill(days, pm),
      prices: Object.fromEntries(c.models.map((m) => [m.id, { in: m.pricePer1MIn, out: m.pricePer1MOut, cache: m.pricePer1MCacheIn ?? m.pricePer1MIn, displayName: m.displayName }])),
    })
  }), 'ent-billing: route GET /admin/usage')
}
