/**
 * 元插件 ent-registry · provides: registry
 * 插件注册表：loaded/disabled/failed 三态 + locked 保护 + 管理面查询/开关落盘。
 * 注册表数据由宿主装载循环填充（core/plugin-registry.mjs 单例，引用共享）。
 * 管理 API（GET/PATCH /admin/plugins）也由此插件挂载——「管理别人」的权力同样是插件，不是内核特权。
 */
import { json, readJson } from '../core/http.mjs'
import { pluginRegistry, pluginStatusSnapshot } from '../core/plugin-registry.mjs'

export const name = 'ent-registry'
export const provides = ['registry']
export const inject = ['router']

export const manifest = {
  capabilities: ['registry.scan', 'registry.toggle'],
  exposes: {
    counts: () => ({
      loaded: pluginRegistry.loaded.length,
      disabled: pluginRegistry.disabled.length,
      failed: pluginRegistry.failed.length,
    }),
  },
}

/** 自带页面声明：管理台壳发现它，导航自动多出「插件管理」页（页面资源在本插件 ent-registry.web/）
 *  icon 为 lucide 图标名（官方图标契约 admin-web/icons.mjs），禁止 emoji */
export const admin = {
  nav: { id: 'plugreg', title: '插件管理', titleEn: 'Plugins', icon: 'puzzle' },
  entry: 'index.mjs',
}

export function apply(ctx) {
  // ---- 领域事件总线（跨插件协作的传输层：发布方与订阅方互相不知道对方存在） ----
  const listeners = new Map() // type → Set<fn>
  const bus = {
    /** 发布领域事件（发布方调用；订阅方异常不影响发布方） */
    emit(type, payload) {
      const set = listeners.get(type)
      if (!set) return
      for (const fn of set) {
        try { fn(payload) } catch (e) { console.warn(`[bus] 订阅者处理 ${type} 异常: ${String(e?.message ?? e).slice(0, 100)}`) }
      }
    },
    /** 订阅；返回取消函数 */
    on(type, fn) {
      if (!listeners.has(type)) listeners.set(type, new Set())
      listeners.get(type).add(fn)
      return () => listeners.get(type)?.delete(fn)
    },
  }

  const registry = {
    /** 全部已装载插件（含 manifest） */
    registry: pluginRegistry,
    /** 展示快照（注入 declared 配置） */
    status: (getConfig) => pluginStatusSnapshot(getConfig),
    /** 领域事件总线（其他插件 inject registry 后 on/emit） */
    on: bus.on,
    emit: bus.emit,
    /** 带声明锁定校验的开关落盘（返回 null 表示被 locked 拒绝） */
    async setEnabled(name, enabled, { getConfig, setPluginEnabled }) {
      const all = [...pluginRegistry.loaded, ...pluginRegistry.disabled, ...pluginRegistry.failed]
      const entry = all.find((e) => e.name === name)
      if (!entry) return { ok: false, code: 404, error: `未知插件: ${name}` }
      if (!enabled && entry.locked) return { ok: false, code: 409, error: `插件 ${name} 为锁定插件（locked），不允许禁用` }
      const next = setPluginEnabled(name, enabled)
      bus.emit('registry.toggled', { name, enabled: next.enabled })
      return { ok: true, name, enabled: next.enabled, restartRequired: true }
    },
  }
  ctx.provide('registry', registry)

  // 管理 API（原 ent-console 内的插件管理两路由移到这里——功能归 whoever 提供服务谁挂路由）
  const router = ctx.get('router')
  const config = ctx.get('config')
  const { getConfig, setPluginEnabled } = config
  ctx.effect(() => router.exact('GET', '/admin/plugins', async (req, res) => {
    json(res, 200, registry.status(getConfig))
  }), 'ent-registry: route GET /admin/plugins')
  ctx.effect(() => router.prefix('/admin/plugins/', async (req, res, path) => {
    const name = decodeURIComponent(path.split('/')[3])
    if (req.method !== 'PATCH' || !name) return false
    const b = await readJson(req)
    if (typeof b?.enabled !== 'boolean') {
      return json(res, 400, { error: { message: '需要 boolean 的 enabled 字段', type: 'bad_request' } })
    }
    const r = await registry.setEnabled(name, b.enabled, { getConfig, setPluginEnabled })
    if (!r.ok) return json(res, r.code, { error: { message: r.error, type: r.code === 409 ? 'locked' : 'not_found' } })
    return json(res, 200, r)
  }), 'ent-registry: route PATCH /admin/plugins/:name')
}
