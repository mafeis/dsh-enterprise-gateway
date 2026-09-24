/**
 * 插件 ent-quota · 额度管理域（= 每组日/周/月额度 API + 管理页面）
 * 路由：/admin/quota*（读取全部组额度 / 更新单组额度）
 * 页面：额度管理（组列表 → 选组编辑：日/周/月 × Token/金额 六维额度）
 * 判定与扣减纯函数在 store.mjs（groupAccessCheck）；金额按企业模型单价折算（priceMap）
 */
import { json, readJson } from '../core/http.mjs'

export const name = 'ent-quota'
export const provides = []
export const inject = ['config', 'store', 'auth', 'router']

/** 自带页面：额度管理（按组配置日/周/月 × Token/金额额度，可叠加可单一） */
export const admin = {
  nav: {
    id: 'quota', title: '额度管理', titleEn: 'Quota', icon: 'receipt', order: 140,
    section: { id: 'usermgmt', title: '用户管理', titleEn: 'User Management', icon: 'users', order: 40 },
  },
  entry: 'index.mjs',
}

const ts = () => new Date().toLocaleTimeString('zh-CN', { hour12: false })

/** 额度字段净化：token 正整数 / 金额正数（最多两位小数），非法/缺失 = 0（不限） */
const QUOTA_KEYS = ['dailyTokens', 'dailyAmount', 'weeklyTokens', 'weeklyAmount', 'monthlyTokens', 'monthlyAmount']
function normQuota(q) {
  const out = {}
  for (const k of QUOTA_KEYS) {
    const v = Number(q?.[k])
    out[k] = Number.isFinite(v) && v > 0 ? (k.endsWith('Amount') ? Math.round(v * 100) / 100 : Math.round(v)) : 0
  }
  return out
}

/** 额度校验：token 正整数 / 金额最多两位小数（字符串写法看小数位，避免浮点比较误差） */
function quotaBadError(b) {
  for (const [k, max] of [
    ['dailyTokens', 1e12], ['weeklyTokens', 1e12], ['monthlyTokens', 1e12],
    ['dailyAmount', 1e8], ['weeklyAmount', 1e8], ['monthlyAmount', 1e8],
  ]) {
    if (b[k] === undefined) continue
    const v = Number(b[k])
    if (!Number.isFinite(v) || v < 0 || v > max) return `${k} 须为 0-${max} 的数值`
    if (k.endsWith('Tokens') && v > 0 && (!Number.isInteger(v) || v < 1)) return `${k} 须为正整数（token 数）`
    if (k.endsWith('Amount') && v > 0) {
      const dec = String(b[k]).includes('.') ? String(b[k]).split('.')[1] : ''
      if (dec.length > 2) return `${k} 金额最多两位小数`
    }
  }
  return null
}

export function apply(ctx) {
  const router = ctx.get('router')
  const auth = ctx.get('auth')
  const { getConfig } = ctx.get('config')
  const store = ctx.get('store')
  const { listGroups, updateGroup } = store

  /** 管理员鉴权（与 ent-console 管理面同一策略） */
  async function requireAdmin(req, res) {
    const a = await auth.authenticate(req)
    if (!a.ok) { json(res, a.status, { error: a.error }); return null }
    if (a.user.role !== 'admin') { json(res, 403, { error: { message: '需要管理员角色', type: 'forbidden' } }); return null }
    return a
  }

  ctx.effect(() => router.prefix('/admin/quota', async (req, res, path) => {
    const u = await requireAdmin(req, res)
    if (!u) return true
    const user = u.user

    // 全量：组额度 + 各组模型单价参考（页面一次拉齐；模型可见性归 ent-group-models）
    if ((path === '/admin/quota' || path === '/admin/quota/') && req.method === 'GET') {
      const c = getConfig()
      return json(res, 200, {
        groups: listGroups().map((g) => ({ id: g.id, name: g.name, quota: g.quota, member_count: g.member_count })),
        prices: c.models.map((m) => ({ id: m.id, in: m.pricePer1MIn ?? 0, out: m.pricePer1MOut ?? 0, cache: m.pricePer1MCacheIn ?? m.pricePer1MIn ?? 0 })),
      })
    }
    // 单组更新：PATCH /admin/quota/<id>（只动 quota，模型白名单归 ent-group-models，组名成员归 ent-groups）
    const mId = path.match(/^\/admin\/quota\/(\d+)$/)
    if (mId && req.method === 'PATCH') {
      const id = Number(mId[1])
      const b = (await readJson(req)) ?? {}
      const patch = {}
      if (b.quota !== undefined) {
        const bad = quotaBadError(b.quota)
        if (bad) return json(res, 400, { error: { message: bad, type: 'bad_request' } })
        patch.quota = normQuota(b.quota)
      }
      const r = updateGroup(id, patch)
      if (!r.ok) return json(res, 404, { error: { message: '分组不存在', type: 'not_found' } })
      console.log(`[${ts()}] ⚙ 更新组#${id} 额度 by ${user.username}: ${Object.keys(patch).join(',')}（已落盘）`)
      return json(res, 200, { ok: true })
    }
    return false
  }), 'ent-quota: /admin/quota/*')
}
