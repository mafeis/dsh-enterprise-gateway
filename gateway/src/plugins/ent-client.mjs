/**
 * 插件 ent-client · 客户端管控域（= 员工端协议 + 策略 API + 管理页面）
 * 路由：
 *   GET  /policy/current     员工端拉取策略快照（ent-protocol 并入）
 *   POST /policy/ack         员工端回执（灰度核对）
 *   POST /heartbeat          员工端心跳（在线终端数据源）
 *   PATCH /admin/policy      管理侧策略热更（安全防护页与客户端管控页共用；校验失败 400 绝不写坏）
 *   GET  /admin/policy-detail 管理侧策略详情（含 DLP 规则/留存/登录保护/清单/回执）
 * 页面：客户端管控（界面策略开关 / 登录保护 / 插件清单与源 / 自助规则 / 下发回执）
 * 实现模块：src/routes/plugin.mjs（协议）
 */
import { createPluginProtocolHandler } from '../routes/plugin.mjs'
import { json, readJson } from '../core/http.mjs'

export const name = 'ent-client'
export const provides = []
export const inject = ['config', 'store', 'auth', 'router']

/** 自带页面：客户端管控（策略下发 / 登录保护 / 插件管控 / 自助规则 / 回执） */
export const admin = {
  nav: { id: 'client', title: '客户端管控', icon: 'monitor', order: 70 },
  entry: 'index.mjs',
}

const ts = () => new Date().toLocaleTimeString('zh-CN', { hour12: false })

export function apply(ctx) {
  const router = ctx.get('router')
  const auth = ctx.get('auth')
  const { getConfig, patchConfig } = ctx.get('config')
  const { recentPolicyAcks } = ctx.get('store')
  const handleProtocol = createPluginProtocolHandler({ config: ctx.get('config'), store: ctx.get('store'), auth })

  /* ---- 员工端协议（原 ent-protocol 并入：策略下发/回执/心跳） ---- */
  ctx.effect(() => router.exact('GET', '/policy/current', handleProtocol), 'ent-client: route GET /policy/current')
  ctx.effect(() => router.exact('POST', '/policy/ack', handleProtocol), 'ent-client: route POST /policy/ack')
  ctx.effect(() => router.exact('POST', '/heartbeat', handleProtocol), 'ent-client: route POST /heartbeat')

  /** 管理员鉴权（与 ent-console 管理面同一策略） */
  async function requireAdmin(req, res) {
    const a = await auth.authenticate(req)
    if (!a.ok) { json(res, a.status, { error: a.error }); return null }
    if (a.user.role !== 'admin') { json(res, 403, { error: { message: '需要管理员角色', type: 'forbidden' } }); return null }
    return a
  }

  /* ---- 策略热更（安全防护页与客户端管控页共用入口） ---- */
  ctx.effect(() => router.exact('PATCH', '/admin/policy', async (req, res) => {
    const u = await requireAdmin(req, res)
    if (!u) return true
    const patch = (await readJson(req)) ?? {}
    try {
      const next = patchConfig(patch)
      console.log(`[${ts()}] ⚙ 策略热更 by ${u.user.username}: ${JSON.stringify(patch).slice(0, 200)}`)
      return json(res, 200, { ok: true, policy: next.policy, audit: next.audit, dlp: { enabled: next.dlp.enabled, rules: next.dlp.rules.length }, loginProtection: next.auth.loginProtection })
    } catch (e) {
      return json(res, 400, { error: { message: String(e.message ?? e).slice(0, 200), type: 'bad_request' } })
    }
  }), 'ent-client: route PATCH /admin/policy')

  ctx.effect(() => router.exact('GET', '/admin/policy-detail', async (req, res) => {
    const u = await requireAdmin(req, res)
    if (!u) return true
    const c = getConfig()
    return json(res, 200, {
      policy: c.policy,
      audit: c.audit,
      dlp: c.dlp,
      loginProtection: c.auth.loginProtection ?? { enabled: false, maxFails: 10, windowMin: 15, lockMin: 15 },
      acks: recentPolicyAcks(20),
    })
  }), 'ent-client: route GET /admin/policy-detail')
}
