/**
 * 插件 ent-auth · provides: auth
 * JWT(HS256 零依赖) + scrypt 密码 + 请求鉴权中间件 + /auth/* 路由
 * 实现模块：src/auth.mjs（纯 JWT/密码原语）+ src/routes/auth-routes.mjs（路由处理器工厂）
 * authenticate 依赖 store 做实时用户状态校验（原动态 import('./store.mjs') 改为服务注入）
 */
import { signJwt, verifyJwt, hashPassword, checkPassword } from '../auth.mjs'
import { createAuthRoutes, tokenFrom } from '../routes/auth-routes.mjs'

export const name = 'ent-auth'
export const provides = ['auth']
export const inject = ['config', 'store', 'router']

export function apply(ctx) {
  const store = ctx.get('store')

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

  const auth = { authenticate, signJwt, verifyJwt, hashPassword, checkPassword }
  ctx.provide('auth', auth)

  const handleAuth = createAuthRoutes({ config: ctx.get('config'), store, auth })
  const router = ctx.get('router')
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
