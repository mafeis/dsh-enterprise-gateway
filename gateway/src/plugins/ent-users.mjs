/**
 * 插件 ent-users · 用户管理域（= 账号 API + 管理页面）
 * 路由：/admin/users*（列表/创建/更新/删除/账号活动详情）——谁的数据谁挂路由（对齐 ent-audit/ent-catalog）
 * 页面：用户管理（账号列表 / 创建 / 改密 / 停启用 / 账号活动详情弹层）
 * 数据来自 store 服务（listUsers/createUser/...）；账号活动详情用 store.userActivity
 */
import { json, readJson } from '../core/http.mjs'
import { licenseSummary, parseLicenseKey } from '../license.mjs'

export const name = 'ent-users'
export const provides = []
export const inject = ['config', 'store', 'auth', 'router']

/** 自带页面：用户管理（账号列表 / 创建 / 改密 / 停启用 / 账号活动详情） */
export const admin = {
  nav: { id: 'users', title: '用户管理', titleEn: 'Users', icon: 'users', order: 40 },
  entry: 'index.mjs',
}

const ts = () => new Date().toLocaleTimeString('zh-CN', { hour12: false })

export function apply(ctx) {
  const router = ctx.get('router')
  const auth = ctx.get('auth')
  const { getConfig, patchConfig } = ctx.get('config')
  const {
    listUsers, createUser, updateUser, deleteUser, userActivity, db,
  } = ctx.get('store')
  const { hashPassword } = auth

  /* ---------- 商业授权：启用账号数 >30 时提醒（仅提醒不拦截，验签见 src/license.mjs） ---------- */
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
      console.log(`[${ts()}] 🔑 商业授权码已${key ? '更新' : '清除'} by ${user.username}`)
      return json(res, 200, licenseSummary(enabledCount(), getConfig().license?.key))
    }
    return false
  }), 'ent-users: /admin/license')

  /** 管理员鉴权（与 ent-console 管理面同一策略） */
  async function requireAdmin(req, res) {
    const a = await auth.authenticate(req)
    if (!a.ok) { json(res, a.status, { error: a.error }); return null }
    if (a.user.role !== 'admin') { json(res, 403, { error: { message: '需要管理员角色', type: 'forbidden' } }); return null }
    return a
  }

  ctx.effect(() => router.prefix('/admin/users', async (req, res, path, url) => {
    const u = await requireAdmin(req, res)
    if (!u) return true
    const user = u.user
    const rest = path.replace(/^\/admin\/users/, '') || '/'

    if ((path === '/admin/users' || path === '/admin/users/') && req.method === 'GET') {
      return json(res, 200, { users: listUsers() })
    }
    // 账号活动详情：登录历史 + 设备 + 使用记录 + 内存序列（账号管理页点击账号弹出）
    const mAct = rest.match(/^\/([^/]+)\/activity$/)
    if (mAct && req.method === 'GET') {
      const name = decodeURIComponent(mAct[1])
      const a = getConfig().audit ?? {}
      return json(res, 200, {
        ...userActivity(name),
        limits: {
          days: a.activityDays ?? 7,
          logins: a.activityLogins ?? 20,
          devices: a.activityDevices ?? 20,
          usage: a.activityUsage ?? 20,
        },
      })
    }
    if ((path === '/admin/users' || path === '/admin/users/') && req.method === 'POST') {
      const b = (await readJson(req)) ?? {}
      if (!b.username || !b.password) return json(res, 400, { error: { message: '需要 username 和 password', type: 'bad_request' } })
      if (!/^[a-zA-Z0-9_.-]{2,32}$/.test(b.username)) return json(res, 400, { error: { message: '用户名限 2-32 位字母数字_.-', type: 'bad_request' } })
      if (db.prepare('SELECT 1 FROM users WHERE username = ?').get(b.username)) {
        return json(res, 409, { error: { message: '用户名已存在', type: 'conflict' } })
      }
      createUser({ username: b.username, passwordHash: hashPassword(b.password), displayName: b.displayName, role: ['user', 'admin'].includes(b.role) ? b.role : 'user', orgPath: b.orgPath })
      console.log(`[${ts()}] ＋ 创建用户 ${b.username} (${b.role ?? 'user'}) by ${user.username}`)
      return json(res, 200, { ok: true })
    }
    const mId = rest.match(/^\/(\d+)$/)
    if (mId && req.method === 'PATCH') {
      const id = Number(mId[1])
      const b = (await readJson(req)) ?? {}
      const patch = {}
      if (b.displayName !== undefined) patch.displayName = b.displayName
      if (b.role !== undefined && ['user', 'admin'].includes(b.role)) patch.role = b.role
      if (b.enabled !== undefined) patch.enabled = !!b.enabled
      if (b.orgPath !== undefined) patch.orgPath = b.orgPath
      if (b.password) patch.passwordHash = hashPassword(b.password)
      const r = updateUser(id, patch)
      if (!r.ok) return json(res, 404, { error: { message: r.reason, type: 'not_found' } })
      console.log(`[${ts()}] ⚙ 更新用户#${id} by ${user.username}: ${Object.keys(patch).join(',')}`)
      return json(res, 200, { ok: true })
    }
    if (mId && req.method === 'DELETE') {
      const id = Number(mId[1])
      const r = deleteUser(id)
      if (!r.ok) return json(res, 400, { error: { message: r.reason === 'cannot-delete-bootstrap-admin' ? '不能删除引导管理员' : '用户不存在', type: 'forbidden' } })
      console.log(`[${ts()}] － 删除用户#${id} by ${user.username}`)
      return json(res, 200, { ok: true })
    }
    return false
  }), 'ent-users: /admin/users/*')
}
