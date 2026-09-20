/**
 * 插件 ent-group-models · 模型管理域（= 每组可见模型白名单 API + 管理页面）
 * 路由：/admin/group-models*（读取组+已上架模型目录 / 更新单组白名单）
 * 页面：模型管理（组列表 → 选组勾选可见模型；不勾 = 全部）
 * 白名单判定纯函数在 store.mjs（groupAllowsModel）；强制点：/v1/models 过滤 + chat/responses 准入
 */
import { json, readJson } from '../core/http.mjs'

export const name = 'ent-group-models'
export const provides = []
export const inject = ['config', 'store', 'auth', 'router']

/** 自带页面：模型管理（按组勾选可见模型，只列已上架模型） */
export const admin = {
  nav: {
    id: 'groupmodels', title: '模型管理', titleEn: 'Group Models', icon: 'box', order: 46,
    section: { id: 'usermgmt', title: '用户管理', titleEn: 'User Management', icon: 'users', order: 40 },
  },
  entry: 'index.mjs',
}

const ts = () => new Date().toLocaleTimeString('zh-CN', { hour12: false })

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

  ctx.effect(() => router.prefix('/admin/group-models', async (req, res, path) => {
    const u = await requireAdmin(req, res)
    if (!u) return true
    const user = u.user

    // 全量：各组白名单 + 已上架模型目录（页面一次拉齐）
    if ((path === '/admin/group-models' || path === '/admin/group-models/') && req.method === 'GET') {
      const c = getConfig()
      return json(res, 200, {
        groups: listGroups().map((g) => ({ id: g.id, name: g.name, models: g.models, member_count: g.member_count })),
        models: c.models.filter((m) => m.enabled !== false).map((m) => ({ id: m.id, displayName: m.displayName ?? '' })),
      })
    }
    // 单组更新：PATCH /admin/group-models/<id>（只动 models）
    const mId = path.match(/^\/admin\/group-models\/(\d+)$/)
    if (mId && req.method === 'PATCH') {
      const id = Number(mId[1])
      const b = (await readJson(req)) ?? {}
      if (!Array.isArray(b.models) || b.models.some((x) => typeof x !== 'string')) {
        return json(res, 400, { error: { message: 'models 必须是模型 id 字符串数组', type: 'bad_request' } })
      }
      const r = updateGroup(id, { models: [...new Set(b.models)] })
      if (!r.ok) return json(res, 404, { error: { message: '分组不存在', type: 'not_found' } })
      console.log(`[${ts()}] ⚙ 更新组#${id} 模型白名单 by ${user.username}（已落盘）`)
      return json(res, 200, { ok: true })
    }
    return false
  }), 'ent-group-models: /admin/group-models/*')
}
