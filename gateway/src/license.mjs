/**
 * 商业授权校验（零依赖 · Ed25519 验签）
 *
 * 社区许可：个人及 ≤30 人机构免费；启用账号 >30 且无有效商业授权 = 超限（仅提醒，不拦截）。
 * 授权码格式：DSHE1.<base64url(payload JSON)>.<base64url(Ed25519 签名)>
 *   payload = { licensee, seats, issuedAt, expiresAt }（expiresAt=null=永久；seats 数字或 "unlimited"）
 * 私钥自留（license-private-key.pem，绝不入库）；签发工具 scripts/issue-license.mjs
 */
import { createPublicKey, verify } from 'node:crypto'

/** 签发公钥（SPKI · 与 license-private-key.pem 成对；换钥必须同步改这里） */
const PUBLIC_KEY_PEM = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAIA4O8t3XlZBqyY/uzl2+Nt+mjfKLqQA2yQ/ZGqGk8SI=
-----END PUBLIC KEY-----`

export const FREE_SEAT_LIMIT = 30
export const LICENSE_CONTACT = 'mafeis@gmail.com'

const b64u = {
  enc: (buf) => Buffer.from(buf).toString('base64url'),
  dec: (s) => Buffer.from(s, 'base64url'),
}

/** 验签 + 解析授权码。返回 { ok, license?, reason? }——ok=false 时 reason 为中文原因 */
export function parseLicenseKey(keyStr) {
  const key = String(keyStr ?? '').trim()
  if (!key) return { ok: false, reason: '未录入授权码' }
  const parts = key.split('.')
  if (parts.length !== 3 || parts[0] !== 'DSHE1') return { ok: false, reason: '授权码格式不正确' }
  let payload
  try {
    payload = JSON.parse(b64u.dec(parts[1]).toString('utf8'))
  } catch { return { ok: false, reason: '授权码负载损坏' } }
  if (!payload || typeof payload !== 'object') return { ok: false, reason: '授权码负载损坏' }
  if (payload.typ !== 'dsh-enterprise-license') return { ok: false, reason: '授权码类型不匹配' }
  let sigOk = false
  try {
    sigOk = verify(null, Buffer.from(parts[1]), createPublicKey(PUBLIC_KEY_PEM), b64u.dec(parts[2]))
  } catch { /* 公钥异常按验签失败 */ }
  if (!sigOk) return { ok: false, reason: '授权码签名无效' }
  if (typeof payload.licensee !== 'string' || !payload.licensee.trim()) return { ok: false, reason: '授权码缺少被授权方' }
  const seats = payload.seats
  if (seats !== 'unlimited' && (!Number.isInteger(seats) || seats < 1)) return { ok: false, reason: '授权码席位数不合法' }
  if (payload.expiresAt != null && Number.isNaN(Date.parse(payload.expiresAt))) return { ok: false, reason: '授权码到期时间不合法' }
  return { ok: true, license: { ...payload, seats } }
}

/**
 * 授权状态计算（唯一口径：启用账号数 vs 免费 30 席 vs 授权席位数）
 * 返回 { state, message }，state：
 *   free       启用账号 ≤30，社区许可范围内
 *   licensed   启用账号 >30 且授权有效（席位/有效期都够）
 *   over-limit 启用账号 >30 且无有效授权（提醒态）
 *   invalid    录了授权码但验签失败/字段不合法
 */
export function licenseStatus(userCount, licenseKey) {
  const over = userCount > FREE_SEAT_LIMIT
  if (!over) return { state: 'free', message: `启用账号 ${userCount}/${FREE_SEAT_LIMIT}，社区许可范围内` }
  const parsed = parseLicenseKey(licenseKey)
  if (!parsed.ok) {
    const msg = parsed.reason === '未录入授权码'
      ? `启用账号 ${userCount} 超过社区许可免费上限（${FREE_SEAT_LIMIT}），请录入商业授权码或联系 ${LICENSE_CONTACT} 取得授权`
      : `启用账号 ${userCount} 超过免费上限（${FREE_SEAT_LIMIT}），且${parsed.reason}`
    return { state: parsed.reason === '未录入授权码' ? 'over-limit' : 'invalid', message: msg }
  }
  const lic = parsed.license
  const now = Date.now()
  if (lic.expiresAt != null && Date.parse(lic.expiresAt) < now) {
    return { state: 'over-limit', message: `商业授权已于 ${lic.expiresAt.slice(0, 10)} 到期（被授权方：${lic.licensee}），请续期或联系 ${LICENSE_CONTACT}` }
  }
  if (lic.seats !== 'unlimited' && lic.seats < userCount) {
    return { state: 'over-limit', message: `启用账号 ${userCount} 超出商业授权席位数 ${lic.seats}（被授权方：${lic.licensee}），请扩容或联系 ${LICENSE_CONTACT}` }
  }
  const seatTxt = lic.seats === 'unlimited' ? '不限席位' : `${lic.seats} 席位`
  const expTxt = lic.expiresAt ? `，有效期至 ${lic.expiresAt.slice(0, 10)}` : '，永久有效'
  return { state: 'licensed', message: `商业授权有效（被授权方：${lic.licensee} · ${seatTxt}${expTxt}）` }
}

/** 授权状态汇总（API 返回体；绝不回传授权码原文） */
export function licenseSummary(userCount, licenseKey) {
  const st = licenseStatus(userCount, licenseKey)
  const lic = parseLicenseKey(licenseKey).ok ? parseLicenseKey(licenseKey).license : null
  return {
    ...st,
    userCount,
    freeSeatLimit: FREE_SEAT_LIMIT,
    hasKey: Boolean(String(licenseKey ?? '').trim()),
    licensee: lic?.licensee ?? null,
    seats: lic?.seats ?? null,
    expiresAt: lic?.expiresAt ?? null,
    issuedAt: lic?.issuedAt ?? null,
  }
}
