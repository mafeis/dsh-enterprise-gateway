/**
 * 插件 ent-groups · 分组管理域（= 分组 CRUD + 成员管理 + 管理页面）
 * 路由：/admin/groups*（列表/创建/更新/删除）——谁的数据谁挂路由（对齐 ent-users/ent-catalog）
 * 页面：分组管理（分组卡片 + 成员管理）；额度与模型可见性在 ent-quota 域
 * 分组判定与额度扣减的纯函数在 store.mjs（groupOfUser/groupAccessCheck），
 * 强制点：ent-meta（/v1/models 过滤）、ent-upstream（chat/responses 准入）、usage.me（余量展示）
 */
import { json, readJson } from '../core/http.mjs'

export const name = 'ent-groups'
export const provides = []
export const inject = ['config', 'store', 'auth', 'router']

/** 自带页面：用户分组（分组 CRUD + 成员归属，一人一组；额度/模型在「额度管理」「模型管理」页配置） */
export const admin = {
  nav: {
    id: 'groups', title: '用户分组', titleEn: 'Groups', icon: 'users', order: 120,
    section: { id: 'usermgmt', title: '用户管理', titleEn: 'User Management', icon: 'users', order: 40 },
  },
  entry: 'index.mjs',
}

const ts = () => new Date().toLocaleTimeString('zh-CN', { hour12: false })

export function apply(ctx) {
  const router = ctx.get('router')
  const auth = ctx.get('auth')
  const store = ctx.get('store')
  const { listGroups, createGroup, updateGroup, deleteGroup, db } = store

  /** 管理员鉴权（与 ent-console 管理面同一策略） */
  async function requireAdmin(req, res) {
    const a = await auth.authenticate(req)
    if (!a.ok) { json(res, a.status, { error: a.error }); return null }
    if (a.user.role !== 'admin') { json(res, 403, { error: { message: '需要管理员角色', type: 'forbidden' } }); return null }
    return a
  }

  /** 成员字段校验 */
  const membersBad = (b) => b.members !== undefined && (!Array.isArray(b.members) || b.members.some((x) => typeof x !== 'string'))

  ctx.effect(() => router.prefix('/admin/groups', async (req, res, path) => {
    const u = await requireAdmin(req, res)
    if (!u) return true
    const user = u.user

    if ((path === '/admin/groups' || path === '/admin/groups/') && req.method === 'GET') {
      return json(res, 200, { groups: listGroups() })
    }
    if ((path === '/admin/groups' || path === '/admin/groups/') && req.method === 'POST') {
      const b = (await readJson(req)) ?? {}
      const name = String(b.name ?? '').trim()
      if (!name || name.length > 32) return json(res, 400, { error: { message: '需要名称（1-32 字）', type: 'bad_request' } })
      if (db.prepare('SELECT 1 FROM user_groups WHERE name = ?').get(name)) {
        return json(res, 409, { error: { message: '分组名已存在', type: 'conflict' } })
      }
      if (membersBad(b)) return json(res, 400, { error: { message: 'members 必须是用户名字符串数组', type: 'bad_request' } })
      createGroup({ name, description: String(b.description ?? ''), members: b.members ?? [] })
      console.log(`[${ts()}] ＋ 新增分组 ${name} by ${user.username}（已落盘）`)
      return json(res, 200, { ok: true })
    }
    const mId = path.match(/^\/admin\/groups\/(\d+)$/)
    if (mId && req.method === 'PATCH') {
      const id = Number(mId[1])
      const b = (await readJson(req)) ?? {}
      const patch = {}
      if (b.name !== undefined) {
        const name = String(b.name).trim()
        if (!name || name.length > 32) return json(res, 400, { error: { message: '名称须为 1-32 字', type: 'bad_request' } })
        if (db.prepare('SELECT 1 FROM user_groups WHERE name = ? AND id != ?').get(name, id)) {
          return json(res, 409, { error: { message: '分组名已存在', type: 'conflict' } })
        }
        patch.name = name
      }
      if (b.description !== undefined) patch.description = String(b.description ?? '')
      if (membersBad(b)) return json(res, 400, { error: { message: 'members 必须是用户名字符串数组', type: 'bad_request' } })
      if (b.members !== undefined) patch.members = [...new Set(b.members)]
      const r = updateGroup(id, patch)
      if (!r.ok) return json(res, 404, { error: { message: '分组不存在', type: 'not_found' } })
      console.log(`[${ts()}] ⚙ 更新分组#${id} by ${user.username}: ${Object.keys(patch).join(',')}（已落盘）`)
      return json(res, 200, { ok: true })
    }
    if (mId && req.method === 'DELETE') {
      const id = Number(mId[1])
      const r = deleteGroup(id)
      if (!r.ok) return json(res, 404, { error: { message: '分组不存在', type: 'not_found' } })
      console.log(`[${ts()}] － 删除分组#${id} by ${user.username}（成员已移出分组）`)
      return json(res, 200, { ok: true })
    }
    return false
  }), 'ent-groups: /admin/groups/*')
}
