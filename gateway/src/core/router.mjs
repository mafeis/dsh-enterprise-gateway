/**
 * 内核 · 路由表服务
 * exact(method+path 精确匹配) 与 prefix(前缀匹配) 两类，按注册顺序分发。
 * 插件通过 ctx.effect(() => router.exact(...), label) 注册——插件卸载时路由自动摘除。
 * handler 返回 false 表示「未处理」，继续尝试下一条路由（与旧 dispatch 语义一致）。
 */
export function createRouter() {
  const routes = []

  function remove(entry) {
    const i = routes.indexOf(entry)
    if (i !== -1) routes.splice(i, 1)
  }

  const exact = (method, path, handler) => {
    const entry = { type: 'exact', method, path, handler }
    routes.push(entry)
    return () => remove(entry)
  }

  const prefix = (path, handler) => {
    const entry = { type: 'prefix', path, handler }
    routes.push(entry)
    return () => remove(entry)
  }

  async function dispatch(req, res, path, url) {
    for (const r of routes) {
      const hit = r.type === 'exact'
        ? (req.method === r.method && path === r.path)
        : path.startsWith(r.path)
      if (!hit) continue
      const out = await r.handler(req, res, path, url)
      if (out !== false) return true
    }
    return false
  }

  return { exact, prefix, dispatch }
}
