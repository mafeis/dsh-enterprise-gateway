/**
 * 协作插件 ent-inspector · 跨插件协作中枢（示例：消费其他插件暴露的信息）
 *
 * 对齐 DSH「ctx.get 探测」模式的管理面化身：
 *   1. scan()       — 扫描已装载插件：name/provides/inject/manifest.capabilities
 *   2. query(name)  — 取插件 manifest.exposes 声明可公开的信息快照（声明即同意）
 *   3. GET /admin/inspector — 管理台可见的协作视图
 *
 * 只依赖 registry（元插件），不 hardcode 任何业务插件——新插件装载后无需改动本文件即可被发现。
 */
import { json } from '../core/http.mjs'
import { pluginRegistry } from '../core/plugin-registry.mjs'

export const name = 'ent-inspector'
export const provides = ['inspector']
export const inject = ['registry', 'router']

export const manifest = {
  capabilities: ['inspector.scan', 'inspector.query'],
  exposes: {
    /** 其他插件可经 inspector.query('ent-inspector') 拿到本插件自己的快照 */
    summary: () => ({
      scanned: pluginRegistry.loaded.length,
      withManifest: pluginRegistry.loaded.filter((p) => p.manifest).length,
    }),
  },
}

/** 自带页面：协作视图（页面资源在本插件 ent-inspector.web/）；icon 为 lucide 图标名 */
export const admin = {
  nav: { id: 'inspector', title: '协作视图', icon: 'git-merge' },
  entry: 'index.mjs',
}

export function apply(ctx) {
  /** 扫描全部已装载插件及其能力声明 */
  function scan() {
    return pluginRegistry.loaded.map((p) => ({
      name: p.name,
      provides: p.provides,
      inject: p.inject,
      capabilities: p.manifest?.capabilities ?? [],
      exposes: p.manifest?.exposes ? Object.keys(p.manifest.exposes) : [],
      source: p.source,
    }))
  }

  /** 查询某插件公开的信息快照（调它的 exposes 函数，异常降级为 error 字段） */
  function query(name) {
    const p = pluginRegistry.loaded.find((x) => x.name === name)
    if (!p) return { ok: false, error: `插件未装载: ${name}` }
    if (!p.manifest?.exposes) return { ok: false, error: `插件 ${name} 未声明 exposes` }
    const out = {}
    for (const [key, fn] of Object.entries(p.manifest.exposes)) {
      try { out[key] = fn() } catch (e) { out[key] = { error: String(e?.message ?? e).slice(0, 120) } }
    }
    return { ok: true, name, data: out }
  }

  ctx.provide('inspector', { scan, query })

  // 协作视图路由（管理台「插件协作」数据源）
  const router = ctx.get('router')
  ctx.effect(() => router.exact('GET', '/admin/inspector', async (req, res) => {
    json(res, 200, {
      plugins: scan(),
      snapshots: pluginRegistry.loaded
        .filter((p) => p.manifest?.exposes)
        .map((p) => query(p.name)),
    })
  }), 'ent-inspector: route GET /admin/inspector')
}
