/**
 * 内核 · 路由表服务
 * exact(method+path 精确匹配) 与 prefix(前缀匹配) 两类，按注册顺序分发。
 * 插件通过 ctx.effect(() => router.exact(...), label) 注册——插件卸载时路由自动摘除。
 * handler 返回 false 表示「未处理」，继续尝试下一条路由（与旧 dispatch 语义一致）。
 *
 * guard(prefix, handler) = 前缀级前置闸门，先于全部路由执行（与注册顺序无关）：
 *   handler 返回 true  → 已响应并终止本次分发（拒绝）
 *   handler 返回 false → 放行，继续走路由表
 * 用于「某前缀整体需要某种权限」的横切策略（如 /admin 管理台只允许管理员）。
 * 为什么不让每个插件自己记得鉴权：历史上 /admin/plugins 就漏过（匿名可读写），
 * 而且是否漏取决于插件装载顺序——闸门把这条策略收口成一处，新插件挂载即受管。
 */
export function createRouter() {
  const routes = []
  const guards = []

  const removeIn = (arr, entry) => {
    const i = arr.indexOf(entry)
    if (i !== -1) arr.splice(i, 1)
  }

  /** 前缀边界匹配：/admin 命中 /admin 与 /admin/xxx，不命中 /admin-api 之类 */
  const hits = (prefix, path) => path === prefix || path.startsWith(prefix + '/')

  const exact = (method, path, handler) => {
    const entry = { type: 'exact', method, path, handler }
    routes.push(entry)
    return () => removeIn(routes, entry)
  }

  const prefix = (path, handler) => {
    const entry = { type: 'prefix', path, handler }
    routes.push(entry)
    return () => removeIn(routes, entry)
  }

  const guard = (prefixPath, handler) => {
    const entry = { prefix: prefixPath, handler }
    guards.push(entry)
    return () => removeIn(guards, entry)
  }

  async function dispatch(req, res, path, url) {
    for (const g of guards) {
      if (!hits(g.prefix, path)) continue
      if (await g.handler(req, res, path, url) === true) return true
    }
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

  return { exact, prefix, guard, dispatch }
}
