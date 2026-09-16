/**
 * 插件 ent-audit · 审计留痕域（= 留痕查询 API + 防篡改锚 API + 管理页面）
 * 路由：/admin/logs*（查询/单条）、/admin/audit-config（页面设置面）、
 *       /admin/verify-anchor、/admin/seal-anchor（Merkle 锚）、/admin/purge（过期清理）
 * 数据来自 store（queryLogs/getLogById/verifyAnchor/sealDailyAnchor/purgeOldData）
 */
import { json, readJson } from '../core/http.mjs'

export const name = 'ent-audit'
export const provides = []
export const inject = ['store', 'auth', 'router', 'config']

/** 自带页面：审计留痕（页面资源在本插件 ent-audit.web/） */
export const admin = {
  nav: { id: 'logs', title: '审计留痕', titleEn: 'Audit Logs', icon: 'scroll-text', order: 65 },
  entry: 'index.mjs',
}

/** 页面设置面：plugins.ent-audit.config.ui 持久化（默认每页条数 + 列显隐 + 导出上限） */
const PAGE_SIZES = [15, 30, 50, 100]
const COLUMN_KEYS = ['upstream', 'tokens', 'duration', 'flag']
const COLUMN_LABELS = { upstream: '上游模型列', tokens: 'Tokens 列', duration: '耗时列', flag: '标记列' }
const UI_DEFAULTS = { pageSize: 30, exportLimit: 200 }

const ts = () => new Date().toLocaleTimeString('zh-CN', { hour12: false })

function readUi(getConfig) {
  const declared = getConfig().plugins?.[name]?.config?.ui ?? {}
  const ui = {
    pageSize: PAGE_SIZES.includes(declared.pageSize) ? declared.pageSize : UI_DEFAULTS.pageSize,
    exportLimit: Number.isInteger(declared.exportLimit) && declared.exportLimit >= 20 && declared.exportLimit <= 200 ? declared.exportLimit : UI_DEFAULTS.exportLimit,
    columns: {},
  }
  for (const k of COLUMN_KEYS) ui.columns[k] = declared.columns?.[k] !== false
  return ui
}

export function apply(ctx) {
  const router = ctx.get('router')
  const store = ctx.get('store')
  const auth = ctx.get('auth')
  const { getConfig, setPluginConfig } = ctx.get('config')

  /** 管理员鉴权（与 ent-console 管理面同一策略） */
  async function requireAdmin(req, res) {
    const a = await auth.authenticate(req)
    if (!a.ok) { json(res, a.status, { error: a.error }); return null }
    if (a.user.role !== 'admin') { json(res, 403, { error: { message: '需要管理员角色', type: 'forbidden' } }); return null }
    return a
  }

  ctx.effect(() => router.prefix('/admin', async (req, res, path, url) => {
    /* ---- 防篡改锚（原 console 迁入：锚是留痕域的事） ---- */
    if (path === '/admin/verify-anchor') {
      const u = await requireAdmin(req, res)
      if (!u) return true
      const day = url.searchParams.get('day') ?? new Date().toLocaleDateString('sv-SE')
      return json(res, 200, store.verifyAnchor(day))
    }
    if (req.method === 'POST' && path === '/admin/seal-anchor') {
      const u = await requireAdmin(req, res)
      if (!u) return true
      return json(res, 200, store.sealDailyAnchor())
    }
    // 手动清理过期留痕（按 audit.retentionDays）
    if (req.method === 'POST' && path === '/admin/purge') {
      const u = await requireAdmin(req, res)
      if (!u) return true
      const r = store.purgeOldData()
      console.log(`[${ts()}] 🧹 手动清理过期留痕 by ${u.user.username}: 留痕${r.logs} 心跳${r.heartbeats} 登录${r.authLogs}（>${r.days}天）`)
      return json(res, 200, { ok: true, ...r })
    }

    /* ---- 留痕查询（原 admin.mjs 迁入：谁的数据谁挂路由） ---- */
    if (path === '/admin/logs') {
      const u = await requireAdmin(req, res)
      if (!u) return true
      const qUser = url.searchParams.get('user') ?? undefined
      const model = url.searchParams.get('model') ?? undefined
      const flag = url.searchParams.get('flag') ?? undefined
      const limit = Math.min(200, Math.max(1, Number(url.searchParams.get('limit') ?? 20)) || 20)
      const offset = Math.max(0, Number(url.searchParams.get('offset') ?? 0)) || 0
      const { logs, total } = store.queryLogs({ user: qUser, model, flag, limit, offset })
      return json(res, 200, { logs, total, limit, offset })
    }
    const mLog = path.match(/^\/admin\/logs\/(\d+)$/)
    if (mLog) {
      const u = await requireAdmin(req, res)
      if (!u) return true
      const log = store.getLogById(Number(mLog[1]))
      if (!log) return json(res, 404, { error: { message: '留痕记录不存在（可能已过保留期被清理）', type: 'not_found' } })
      return json(res, 200, { log })
    }

    /* ---- 页面设置面：GET 读 / PATCH 校验+落盘 ---- */
    if (path === '/admin/audit-config') {
      const u = await requireAdmin(req, res)
      if (!u) return true
      if (req.method === 'GET') {
        return json(res, 200, { ui: readUi(getConfig), pageSizes: PAGE_SIZES, columnKeys: COLUMN_KEYS, columnLabels: COLUMN_LABELS })
      }
      if (req.method === 'PATCH') {
        const b = await readJson(req)
        const patch = b?.ui
        if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
          return json(res, 400, { error: { message: '需要 ui 对象', type: 'bad_request' } })
        }
        const clean = readUi(getConfig)
        if (patch.pageSize !== undefined) {
          if (!PAGE_SIZES.includes(patch.pageSize)) return json(res, 400, { error: { message: `pageSize 只能是 ${PAGE_SIZES.join('/')}`, type: 'bad_request' } })
          clean.pageSize = patch.pageSize
        }
        if (patch.exportLimit !== undefined) {
          if (!Number.isInteger(patch.exportLimit) || patch.exportLimit < 20 || patch.exportLimit > 200) return json(res, 400, { error: { message: 'exportLimit 须为 20-200 整数', type: 'bad_request' } })
          clean.exportLimit = patch.exportLimit
        }
        if (patch.columns !== undefined) {
          if (!patch.columns || typeof patch.columns !== 'object' || Array.isArray(patch.columns)) {
            return json(res, 400, { error: { message: 'columns 必须是对象', type: 'bad_request' } })
          }
          const unknown = Object.keys(patch.columns).filter((k) => !COLUMN_KEYS.includes(k))
          if (unknown.length) return json(res, 400, { error: { message: `未知列: ${unknown.join(', ')}（可选：${COLUMN_KEYS.join(', ')}）`, type: 'bad_request' } })
          for (const k of Object.keys(patch.columns)) {
            if (typeof patch.columns[k] !== 'boolean') return json(res, 400, { error: { message: `columns.${k} 必须是 boolean`, type: 'bad_request' } })
            clean.columns[k] = patch.columns[k]
          }
        }
        setPluginConfig(name, { ui: clean })
        return json(res, 200, { ok: true, ui: clean })
      }
      return false
    }
    return false
  }), 'ent-audit: /admin/logs + audit-config')
}
