/**
 * 插件 ent-console · 管理台
 * 路由：/admin/*（管理台 SPA 静态资源 + 管理 API：统计/留痕/终端/防篡改/策略/用户/计费/供应商/模型）
 * 插件管理 API 在 ent-registry（谁提供服务谁挂路由）
 * 实现模块：src/routes/admin.mjs + src/core/static.mjs
 */
import { json, readJson } from '../core/http.mjs'
import { serveStatic, servePluginWeb } from '../core/static.mjs'
import { createAdminHandler } from '../routes/admin.mjs'

export const name = 'ent-console'
export const provides = []
export const inject = ['config', 'store', 'auth', 'router']

/** 自带页面：运营总览（页面资源在本插件 ent-console.web/）
 *  order 控制导航位置（越小越靠前；核心壳页面从 20 起） */
export const admin = {
  nav: { id: 'overview', title: '运营总览', titleEn: 'Overview', icon: 'layout-dashboard', order: 10 },
  entry: 'index.mjs',
}

/** 运营总览展示配置（页面设置面）：plugins.ent-console.config.sections 持久化
 *  每个区块两个维度：show（显/隐）+ mode（展示方式：kpi 卡/table 表格/bar 对比条/auto 自动） */
const SECTION_DEFAULTS = { req: true, tok: true, users: true, dlp: true, terminals: true, usage: true, installs: true }
const SECTION_LABELS = {
  req: '今日请求数', tok: 'Token 消耗', users: '活跃用户', dlp: 'DLP 命中/拦截', terminals: '在线终端', usage: '用户用量 TOP', installs: '插件安装总览',
}
const SECTION_LABELS_EN = {
  req: 'Requests today', tok: 'Token usage', users: 'Active users', dlp: 'DLP hits/blocks', terminals: 'Online devices', usage: 'Usage TOP', installs: 'Plugin installs',
}
/** 每个区块合法的展示方式（auto=系统按数据形态自动选） */
const SECTION_MODES = {
  req: ['auto', 'kpi', 'table', 'bar'],
  tok: ['auto', 'kpi', 'table', 'bar'],
  users: ['auto', 'kpi', 'table', 'bar'],
  dlp: ['auto', 'kpi', 'table', 'bar'],
  terminals: ['auto', 'table', 'cards'],
  usage: ['auto', 'table', 'bar', 'cards'],
  installs: ['auto', 'table'],
}
const MODE_LABELS = { auto: '自动', kpi: '数值卡', table: '表格', bar: '对比条', cards: '卡片墙' }
const MODE_LABELS_EN = { auto: 'Auto', kpi: 'KPI card', table: 'Table', bar: 'Bars', cards: 'Cards' }

export function apply(ctx) {
  const router = ctx.get('router')
  const { getConfig, setPluginConfig } = ctx.get('config')
  const handleAdmin = createAdminHandler({
    config: ctx.get('config'),
    store: ctx.get('store'),
    auth: ctx.get('auth'),
  })

  /** 当前展示配置（默认值 ← 配置文件 plugins.ent-console.config.sections） */
  function readSections() {
    const declared = getConfig().plugins?.[name]?.config?.sections ?? {}
    const out = {}
    for (const k of Object.keys(SECTION_DEFAULTS)) {
      const d = declared[k]
      out[k] = typeof d === 'object' && d !== null
        ? { enabled: d.enabled !== false, mode: SECTION_MODES[k].includes(d.mode) ? d.mode : 'auto' }
        : { enabled: d !== false, mode: 'auto' }   // 兼容旧版布尔值格式
    }
    return out
  }

  /* ---------- 侧边菜单配置（排序 + 显隐）：plugins.ent-console.config.nav 持久化 ----------
   * order  = 自定义顺序的导航 id 列表（未列出的插件按声明 order 追加在后；空数组 = 未自定义）
   * hidden = 从侧边栏隐藏的导航 id（页面路由仍在，可经 URL 直达）
   */
  const readNavCfg = () => {
    const n = getConfig().plugins?.[name]?.config?.nav ?? {}
    const arr = (v) => Array.isArray(v) ? v.filter((x) => typeof x === 'string' && x).slice(0, 64) : []
    return { order: [...new Set(arr(n.order))], hidden: [...new Set(arr(n.hidden))] }
  }
  /** 管理台全局设置 = 管理员角色 */
  async function requireAdmin(req, res) {
    const a = await ctx.get('auth').authenticate(req)
    if (!a.ok) { json(res, a.status, { error: a.error }); return null }
    if (a.user.role !== 'admin') { json(res, 403, { error: { message: '需要管理员角色', type: 'forbidden' } }); return null }
    return a
  }

  ctx.effect(() => router.prefix('/admin', async (req, res, path, url) => {
    // 总览展示设置（本插件设置面：GET 读 / PATCH 校验+落盘，即时生效）
    if (path === '/admin/console-config') {
      const a = await ctx.get('auth').authenticate(req)
      if (!a.ok) return json(res, a.status, { error: a.error })
      if (req.method === 'GET') {
        // 管理台界面语言由前端 localStorage 决定，服务端不感知——两组标签都下发，前端按语言取
        return json(res, 200, {
          sections: readSections(),
          labels: SECTION_LABELS, labelsEn: SECTION_LABELS_EN,
          modes: SECTION_MODES,
          modeLabels: MODE_LABELS, modeLabelsEn: MODE_LABELS_EN,
        })
      }
      if (req.method === 'PATCH') {
        const b = await readJson(req)
        const patch = b?.sections
        if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
          return json(res, 400, { error: { message: '需要 sections 对象', type: 'bad_request' } })
        }
        const unknown = Object.keys(patch).filter((k) => !(k in SECTION_DEFAULTS))
        if (unknown.length) return json(res, 400, { error: { message: `未知区块: ${unknown.join(', ')}（可选：${Object.keys(SECTION_DEFAULTS).join(', ')}）`, type: 'bad_request' } })
        const clean = {}
        for (const k of Object.keys(patch)) {
          const v = patch[k]
          // 兼容两种写法：boolean（只开关）或 {enabled, mode}（开关+展示方式）
          if (typeof v === 'boolean') { clean[k] = { enabled: v, mode: 'auto' }; continue }
          if (!v || typeof v !== 'object' || Array.isArray(v)) {
            return json(res, 400, { error: { message: `sections.${k} 必须是 boolean 或 {enabled, mode}`, type: 'bad_request' } })
          }
          if (typeof v.enabled !== 'boolean') {
            return json(res, 400, { error: { message: `sections.${k}.enabled 必须是 boolean`, type: 'bad_request' } })
          }
          if (!SECTION_MODES[k].includes(v.mode)) {
            return json(res, 400, { error: { message: `sections.${k}.mode 只能是 ${SECTION_MODES[k].join('/')}`, type: 'bad_request' } })
          }
          clean[k] = { enabled: v.enabled, mode: v.mode }
        }
        const cur = readSections()
        const merged = { ...cur, ...clean }
        setPluginConfig(name, { sections: merged })
        return json(res, 200, { ok: true, sections: merged })
      }
      return false
    }
    // 侧边菜单配置（管理台全局：GET 读 / PATCH 校验+落盘，保存后前端即时重排）
    if (path === '/admin/nav-config') {
      const u = await requireAdmin(req, res)
      if (!u) return true
      if (req.method === 'GET') return json(res, 200, readNavCfg())
      if (req.method === 'PATCH') {
        const b = await readJson(req)
        const has = (k) => Object.prototype.hasOwnProperty.call(b ?? {}, k)
        if (!has('order') && !has('hidden')) {
          return json(res, 400, { error: { message: '需要 order 或 hidden 数组', type: 'bad_request' } })
        }
        for (const k of ['order', 'hidden'].filter(has)) {
          if (!Array.isArray(b[k]) || b[k].some((x) => typeof x !== 'string' || !x)) {
            return json(res, 400, { error: { message: `${k} 必须是非空字符串数组`, type: 'bad_request' } })
          }
          if (new Set(b[k]).size !== b[k].length) {
            return json(res, 400, { error: { message: `${k} 含重复导航 id`, type: 'bad_request' } })
          }
        }
        const merged = { ...readNavCfg(), ...Object.fromEntries(['order', 'hidden'].filter(has).map((k) => [k, [...new Set(b[k])].slice(0, 64)])) }
        setPluginConfig(name, { nav: merged })
        return json(res, 200, { ok: true, ...merged })
      }
      return false
    }
    // 插件自有页面资源（/admin/plug/<插件名>/…）——页面是插件自己的事。
    // 但必须过管理台鉴权（HttpOnly cookie 随动态 import 自动携带，见 auth-routes cookieOf）
    if (path.startsWith('/admin/plug/')) {
      const a = await ctx.get('auth').authenticate(req)
      if (!a.ok) {
        json(res, a.status, { error: a.error })
        return true
      }
      if (servePluginWeb(res, path, url)) return true
      json(res, 404, { error: 'not found' })
      return true
    }
    if (path === '/admin' || path === '/admin/') {
      if (serveStatic(res, path, url)) return true
      json(res, 404, { error: 'not found' })
      return true
    }
    if (path.startsWith('/admin/static/')) {
      if (serveStatic(res, path, url)) return true
      json(res, 404, { error: 'not found' })
      return true
    }
    if (path.startsWith('/admin/')) return await handleAdmin(req, res, path, url)
    return false
  }), 'ent-console: route /admin')
}
