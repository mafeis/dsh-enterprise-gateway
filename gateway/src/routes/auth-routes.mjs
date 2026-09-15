/**
 * 路由处理器工厂 · 认证：登录 / 校验 / 自助改密 / 滑动续期 / 登出
 * 由插件 ent-auth 装载，服务依赖注入
 */
import { json, readJson } from '../core/http.mjs'

/** 管理台会话 cookie：模块资源（/admin/plug/*、动态 import()）无法携带 Authorization 头，
 *  经 HttpOnly cookie 自动携带 —— 这是壳向插件页面送达模块的受控通道（对齐 DSH loopback carrier 思想） */
const COOKIE = 'ent_jwt'
const cookieOf = (token, maxAge) => `${COOKIE}=${token}; HttpOnly; Path=/; SameSite=Strict; Max-Age=${maxAge}`
const clearCookie = () => `${COOKIE}=; HttpOnly; Path=/; SameSite=Strict; Max-Age=0`
/** 从请求里取会话令牌：Authorization 头优先，cookie 兜底（仅模块资源场景） */
export function tokenFrom(req) {
  const auth = req.headers.authorization ?? ''
  if (auth.startsWith('Bearer ')) return auth.slice(7)
  const cookie = req.headers.cookie ?? ''
  const m = cookie.match(new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`))
  return m ? decodeURIComponent(m[1]) : req.headers['x-ent-device-token'] ?? null
}

export function createAuthRoutes({ config, store, auth }) {
  const { getConfig } = config
  const { authenticate, signJwt, checkPassword, hashPassword } = auth
  const { updateUser, db, insertAuthLog, revokeUserTokens } = store

  return async function handleAuth(req, res, path) {
    const cfg = getConfig()

    if (req.method === 'POST' && path === '/auth/login') {
      const { username, password } = (await readJson(req)) ?? {}
      const ip = req.socket?.remoteAddress ?? null
      const ua = req.headers?.['user-agent'] ?? null
      // 登录保护：窗口内失败次数达阈值且最近一次失败在锁定时长内 → 临时锁定（不记录本次，避免"重试续锁"）
      const lp = cfg.auth.loginProtection ?? {}
      if (lp.enabled !== false) {
        const wf = lp.windowMin ?? 15, mf = lp.maxFails ?? 10, lm = lp.lockMin ?? 15
        const fails = db.prepare(`SELECT COUNT(*) c FROM auth_logs WHERE username = ? AND ok = 0 AND ts > datetime('now', '-${wf} minutes')`).get(username ?? '').c
        const last = db.prepare(`SELECT ts FROM auth_logs WHERE username = ? AND ok = 0 ORDER BY id DESC LIMIT 1`).get(username ?? '')
        const lastAgeMs = last ? Date.now() - Date.parse(String(last.ts).replace(' ', 'T') + 'Z') : Infinity
        if (fails >= mf && lastAgeMs < lm * 60_000) {
          console.log(`[${new Date().toLocaleTimeString('zh-CN', { hour12: false })}] 🔒 登录锁定: ${username}（${wf}分钟内失败 ${fails} 次）`)
          return json(res, 429, { error: { message: `登录失败次数过多，账号已临时锁定，请约 ${lm} 分钟后再试或联系管理员`, type: 'too_many_attempts' } })
        }
      }
      const u = db.prepare('SELECT * FROM users WHERE username = ? AND enabled = 1').get(username ?? '')
      if (!u || !checkPassword(password ?? '', u.password_hash)) {
        insertAuthLog(username ?? '(未知)', false, ip, ua)
        console.log(`[${new Date().toLocaleTimeString('zh-CN', { hour12: false })}] ✗ 登录失败: ${username}`)
        return json(res, 401, { error: { message: '用户名或密码错误', type: 'auth_failed' } })
      }
      insertAuthLog(u.username, true, ip, ua)
      // JWT 带令牌版本（登出/改密 bump 后旧票失效）；TTL 30 天，配合 /auth/refresh 滑动续期
      const tv = db.prepare('SELECT token_version FROM users WHERE username = ?').get(u.username)?.token_version ?? 1
      const token = signJwt({ user: { username: u.username, role: u.role, org: u.org_path }, ver: tv }, 30 * 86400)
      console.log(`[${new Date().toLocaleTimeString('zh-CN', { hour12: false })}] ✓ 登录: ${u.username} (${u.role})`)
      res.setHeader('set-cookie', cookieOf(token, 30 * 86400))
      return json(res, 200, { token, user: { username: u.username, role: u.role, displayName: u.display_name, org: u.org_path }, policy: cfg.policy })
    }

    if (req.method === 'POST' && path === '/auth/verify') {
      const authResult = await authenticate(req)
      if (authResult.ok) return json(res, 200, { valid: true, user: authResult.user })
      return json(res, 200, { valid: false, reason: authResult.error?.type })
    }

    if (req.method === 'POST' && path === '/auth/change-password') {
      const authResult = await authenticate(req)
      if (!authResult.ok) return json(res, authResult.status, { error: authResult.error })
      const { oldPassword, newPassword } = (await readJson(req)) ?? {}
      if (!newPassword || newPassword.length < 8) return json(res, 400, { error: { message: '新密码至少 8 位', type: 'bad_request' } })
      const u = db.prepare('SELECT * FROM users WHERE username = ?').get(authResult.user.username)
      if (!u) return json(res, 404, { error: { message: '用户不存在（设备令牌身份请用管理台改）', type: 'not_found' } })
      if (!checkPassword(oldPassword ?? '', u.password_hash)) return json(res, 401, { error: { message: '旧密码错误', type: 'auth_failed' } })
      updateUser(u.id, { passwordHash: hashPassword(newPassword) })
      // 改密后吊销该用户所有旧令牌（含本票）——安全惯例
      revokeUserTokens(u.username)
      res.setHeader('set-cookie', clearCookie())
      console.log(`[${new Date().toLocaleTimeString('zh-CN', { hour12: false })}] 🔑 改密: ${u.username}`)
      return json(res, 200, { ok: true, relogin: true })
    }

    // 滑动续期：凭证仍有效时换发新票（剩余寿命不足一半即续）。客户端登录后周期性调用，做到"一直在线就永不过期"
    if (req.method === 'POST' && path === '/auth/refresh') {
      const authResult = await authenticate(req)
      if (!authResult.ok) return json(res, authResult.status, { error: authResult.error })
      // 解析原始 JWT 拿剩余寿命
      const token = (req.headers.authorization ?? '').replace(/^Bearer\s+/i, '')
      const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString())
      const remainSec = (payload.exp ?? 0) - Math.floor(Date.now() / 1000)
      const HALF_TTL = 15 * 86400 // 30 天票的半衰线
      if (remainSec > HALF_TTL) {
        // 票仍新鲜不换发，但 cookie 必须补——老会话（cookie 机制上线前登录）动态 import 插件页面只带 cookie
        res.setHeader('set-cookie', cookieOf(token, remainSec))
        return json(res, 200, { ok: true, token, refreshed: false })
      }
      const u = db.prepare('SELECT * FROM users WHERE username = ? AND enabled = 1').get(authResult.user.username)
      if (!u) return json(res, 401, { error: { message: '账号不存在或已停用', type: 'auth_disabled' } })
      const tv = u.token_version ?? 1
      const fresh = signJwt({ user: { username: u.username, role: u.role, org: u.org_path }, ver: tv }, 30 * 86400)
      res.setHeader('set-cookie', cookieOf(fresh, 30 * 86400))
      return json(res, 200, { ok: true, token: fresh, refreshed: true })
    }

    // 登出：吊销当前令牌版本——服务端让这张票立即作废（所有该用户旧票同样失效）
    if (req.method === 'POST' && path === '/auth/logout') {
      const authResult = await authenticate(req)
      if (authResult.ok) {
        revokeUserTokens(authResult.user.username)
        console.log(`[${new Date().toLocaleTimeString('zh-CN', { hour12: false })}] ↩ 登出: ${authResult.user.username}（令牌已吊销）`)
      }
      // 即使凭证已失效也返回 ok（幂等）
      res.setHeader('set-cookie', clearCookie())
      return json(res, 200, { ok: true })
    }

    return false
  }
}
