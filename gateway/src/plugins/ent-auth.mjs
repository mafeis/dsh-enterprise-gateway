/**
 * 插件 ent-auth · provides: auth
 * JWT(HS256 零依赖) + scrypt 密码 + 请求鉴权中间件 + /auth/* 路由
 * 实现模块：src/auth.mjs（纯 JWT/密码原语）+ src/routes/auth-routes.mjs（路由处理器工厂）
 * authenticate 依赖 store 做实时用户状态校验（原动态 import('./store.mjs') 改为服务注入）
 * requireAdmin = 管理面统一准入判定（/admin 闸门与各业务路由共用，判定与文案只有一份）
 */
import { json } from '../core/http.mjs'
import { signJwt, verifyJwt, hashPassword, checkPassword } from '../auth.mjs'
import { createAuthRoutes, tokenFrom } from '../routes/auth-routes.mjs'

export const name = 'ent-auth'
export const provides = ['auth']
export const inject = ['config', 'store', 'router']

export function apply(ctx) {
  const store = ctx.get('store')
  const router = ctx.get('router')

  /** 返回 {ok, user, jti} 或 {ok:false, status, error}（逻辑与原 auth.mjs authenticate 一致） */
  async function authenticate(req) {
    const cfg = ctx.get('config').getConfig()
    if (cfg.auth.mode === 'open') return { ok: true, user: { username: 'anonymous', role: 'user' } }

    const auth = req.headers.authorization ?? ''
    const token = tokenFrom(req)

    if (!token) {
      return { ok: false, status: 401, error: { message: '缺少凭证（Authorization: Bearer <token>）', type: 'auth_missing' } }
    }

    // 静态设备令牌（长期有效，写在 gateway-config.json auth.deviceTokens）
    const deviceTokens = cfg.auth.deviceTokens ?? []
    if (deviceTokens.includes(token)) {
      return { ok: true, user: { username: cfg.auth.deviceUser ?? 'ent-device', role: 'user' } }
    }

    const v = verifyJwt(token)
    if (!v) return { ok: false, status: 401, error: { message: '凭证无效', type: 'auth_invalid' } }
    if (v.expired) return { ok: false, status: 401, error: { message: '凭证已过期，请重新登录', type: 'auth_expired' } }

    const user = v.payload.user ?? { username: 'unknown', role: 'user' }

    // 实时校验用户状态（停用/删除立即失效，不等 JWT 过期）+ 令牌版本（登出/改密后旧 JWT 立即失效）
    const dbrow = store.db.prepare('SELECT enabled, token_version FROM users WHERE username = ?').get(user.username)
    if (dbrow) {
      if (!dbrow.enabled) return { ok: false, status: 401, error: { message: '账号已被停用', type: 'auth_disabled' } }
      if ((v.payload.ver ?? 1) !== (dbrow.token_version ?? 1)) {
        return { ok: false, status: 401, error: { message: '登录状态已失效（已在别处登出或凭证被重置），请重新登录', type: 'auth_revoked' } }
      }
    } else {
      return { ok: false, status: 401, error: { message: '账号不存在', type: 'auth_deleted' } }
    }

    return { ok: true, user, jti: v.payload.jti }
  }

  /**
   * 管理面准入判定：未登录→401（原样透传 authenticate 的错误），已登录但非管理员→403。
   * 通过返回鉴权结果，不通过返回 null 且已写好响应（调用方只需 if (!u) return true）。
   */
  async function requireAdmin(req, res) {
    const a = await authenticate(req)
    if (!a.ok) { if (res) json(res, a.status, { error: a.error }); return null }
    if (a.user?.role !== 'admin') {
      if (res) json(res, 403, { error: { message: '需要管理员角色', type: 'forbidden' } })
      return null
    }
    return a
  }

  /* ---------- 管理台准入闸门：/admin 前缀整体只允许管理员 ----------
   * 为什么是「闸门」而不是「每条路由各自 requireAdmin」：
   *   1. 与插件装载顺序无关——新插件往 /admin 挂路由，忘记鉴权也不会漏。真实教训：
   *      /admin/plugins（ent-registry 注册得比管理台更早）曾匿名可读可改，
   *      等于任何人都能关掉 DLP / 留痕 / 限流插件；
   *   2. 放在 ent-auth 而非 ent-console：管理台插件被禁用时闸门仍在，不会连带开洞；
   *   3. 数据 API、插件页面模块（/admin/plug/*）、SPA 静态资源同属管理台，一处收口。
   * 唯一匿名例外（否则连登录页都打不开）：
   *   GET /admin           含登录表单的 SPA 外壳
   *   GET /admin/static/*  壳自带的 css/js
   *   —— 两者都零业务数据；普通员工账号照常登 DSH 客户端，但进不了管理台；
   *      管理员被降级/停用后，手里的旧票在下一次请求时立刻失效。
   */
  const isAdminConsoleShell = (req, path) => req.method === 'GET'
    && (path === '/admin' || path === '/admin/' || path.startsWith('/admin/static/'))

  ctx.effect(() => router.guard('/admin', async (req, res, path) => {
    if (isAdminConsoleShell(req, path)) return false
    return (await requireAdmin(req, res)) ? false : true
  }), 'ent-auth: guard /admin 仅管理员')

  const auth = { authenticate, requireAdmin, signJwt, verifyJwt, hashPassword, checkPassword }
  ctx.provide('auth', auth)

  const handleAuth = createAuthRoutes({ config: ctx.get('config'), store, auth })
  for (const [method, path] of [
    ['POST', '/auth/login'],
    ['POST', '/auth/verify'],
    ['POST', '/auth/change-password'],
    ['POST', '/auth/refresh'],
    ['POST', '/auth/logout'],
  ]) {
    ctx.effect(() => router.exact(method, path, handleAuth), `ent-auth: route ${method} ${path}`)
  }
}
