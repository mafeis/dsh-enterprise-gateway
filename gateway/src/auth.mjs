/**
 * 企业网关 · 鉴权原语（JWT + scrypt 密码）
 * 由插件 ent-auth 装载并提供 auth 服务（含请求鉴权中间件 authenticate）。
 * mode: open（跳过）/ device（仅设备令牌）/ jwt（完整）
 */
import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import { getConfig } from './config.mjs'

const b64url = (buf) => Buffer.from(buf).toString('base64url')
const unb64url = (s) => Buffer.from(s, 'base64url')

/* ---------- JWT (HS256, 零依赖) ---------- */

export function signJwt(payload, ttlSec) {
  const cfg = getConfig()
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const now = Math.floor(Date.now() / 1000)
  const body = b64url(JSON.stringify({ ...payload, iat: now, exp: now + (ttlSec ?? cfg.auth.tokenTtlSec), jti: randomBytes(8).toString('hex') }))
  const sig = createHmac('sha256', cfg.auth.jwtSecret).update(`${header}.${body}`).digest('base64url')
  return `${header}.${body}.${sig}`
}

export function verifyJwt(token) {
  try {
    const cfg = getConfig()
    const [h, b, sig] = token.split('.')
    const expect = createHmac('sha256', cfg.auth.jwtSecret).update(`${h}.${b}`).digest('base64url')
    if (sig.length !== expect.length || !timingSafeEqual(Buffer.from(sig), Buffer.from(expect))) return null
    const payload = JSON.parse(unb64url(b).toString())
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return { expired: true, payload }
    return { payload }
  } catch {
    return null
  }
}

/* ---------- 密码 ---------- */

export function hashPassword(password) {
  const salt = randomBytes(16).toString('hex')
  const hash = scryptSync(password, salt, 32).toString('hex')
  return `scrypt:${salt}:${hash}`
}

export function checkPassword(password, stored) {
  try {
    const [, salt, hash] = stored.split(':')
    const calc = scryptSync(password, salt, 32)
    return timingSafeEqual(Buffer.from(hash, 'hex'), calc)
  } catch { return false }
}
