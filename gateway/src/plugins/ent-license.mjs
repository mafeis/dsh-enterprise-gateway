/**
 * 插件 ent-license · 商业授权域（= 授权 API + 管理页面）
 * 路由：/admin/license（GET 状态汇总 / PATCH 录入清除授权码）——谁的业务谁挂路由（对齐 ent-users）
 * 页面：商业授权（状态徽章 / 授权码录入 / 授权详情）
 * 验签与席位口径见 src/license.mjs：社区许可 ≤30 席免费，超限仅提醒不拦截
 */
import { json, readJson } from '../core/http.mjs'
import { licenseSummary, parseLicenseKey } from '../license.mjs'

export const name = 'ent-license'
export const provides = []
export const inject = ['config', 'store', 'auth', 'router']

/** 自带页面：商业授权（状态 / 授权码录入 / 授权详情） */
export const admin = {
  nav: { id: 'license', title: '商业授权', titleEn: 'License', icon: 'key-round', order: 72 },
  entry: 'index.mjs',
}

const ts = () => new Date().toLocaleTimeString('zh-CN', { hour12: false })

export function apply(ctx) {
  const router = ctx.get('router')
  const auth = ctx.get('auth')
  const { getConfig, patchConfig } = ctx.get('config')
  const { db } = ctx.get('store')

  /* ---------- 授权状态：席位口径 = 启用账号数（与 src/license.mjs 唯一口径一致） ---------- */
  const enabledCount = () => db.prepare('SELECT COUNT(*) c FROM users WHERE enabled = 1').get().c
  const licensePatch = (key) => patchConfig({ license: { key } })   // 落盘 gateway-config.json，重启不丢
  // 启动即查一次：超限写日志，管理员在控制台可见
  try {
    const st = licenseSummary(enabledCount(), getConfig().license?.key)
    if (st.state === 'over-limit' || st.state === 'invalid') console.warn(`[license] ⚠ ${st.message}`)
  } catch { /* 计数失败不阻塞启动 */ }

  ctx.effect(() => router.prefix('/admin/license', async (req, res, path) => {
    const u = await requireAdmin(req, res)
    if (!u) return true
    if (req.method === 'GET') {
      return json(res, 200, licenseSummary(enabledCount(), getConfig().license?.key))
    }
    if (req.method === 'PATCH') {
      const b = (await readJson(req)) ?? {}
      if (b.key === undefined) return json(res, 400, { error: { message: '需要 key（空字符串=清除授权码）', type: 'bad_request' } })
      const key = String(b.key ?? '').trim()
      if (key) {
        const p = parseLicenseKey(key)
        if (!p.ok) return json(res, 400, { error: { message: p.reason, type: 'bad_request' } })
      }
      try { licensePatch(key) } catch (e) { return json(res, 400, { error: { message: e.message, type: 'bad_request' } }) }
      console.log(`[${ts()}] 🔑 商业授权码已${key ? '更新' : '清除'} by ${u.user.username}`)
      return json(res, 200, licenseSummary(enabledCount(), getConfig().license?.key))
    }
    return false
  }), 'ent-license: /admin/license')

  /** 管理员鉴权（与各管理域同一策略） */
  async function requireAdmin(req, res) {
    const a = await auth.authenticate(req)
    if (!a.ok) { json(res, a.status, { error: a.error }); return null }
    if (a.user.role !== 'admin') { json(res, 403, { error: { message: '需要管理员角色', type: 'forbidden' } }); return null }
    return a
  }
}
