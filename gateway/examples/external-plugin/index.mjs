/**
 * 外部插件示例 · customer-hello
 * 客户定制交付形态的活样板：随产品发布 examples/external-plugin/，
 * 客户复制后改配置 path 指向即可装载（付费定制项目的起点模板）。
 *
 * 契约与内置插件完全一致：name / provides / inject / apply / manifest
 * 可注入的服务：router / config / registry / store / auth / dlp / upstream / probe / inspector
 *
 * 装载方式（gateway-config.json）：
 *   "plugins": { "customer-hello": { "path": "./examples/external-plugin/index.mjs", "config": { "greeting": "Hi" } } }
 */
export const name = 'customer-hello'
export const provides = []
export const inject = ['registry', 'router']

export const manifest = {
  capabilities: ['demo.greet'],
  exposes: {
    /** inspector.query('customer-hello') 可见：展示 exposes 的标准写法 */
    greeting: (cfg) => `Hello from external plugin! (config.greeting=${cfg?.greeting ?? 'unset'})`,
  },
}

export function apply(ctx) {
  const cfg = ctx.fiber.config ?? {}
  const router = ctx.get('router')
  const registry = ctx.get('registry')

  // 演示 1：挂一条自定义路由
  ctx.effect(() => router.exact('GET', '/hello', async (req, res) => {
    const inspected = registry.status ? 'registry OK' : 'registry?'
    json(res, 200, { hello: cfg.greeting ?? 'world', from: 'external-plugin', registry: inspected })
  }), 'customer-hello: route GET /hello')

  // 演示 2：订阅领域事件（与 ent-notify 相同的协作写法）
  const off = registry.on('dlp.blocked', (e) => {
    console.log(`[customer-hello] 观察到拦截事件: ${e.rules}`)
  })
  ctx.effect(() => off, 'customer-hello: dlp.blocked subscription')

  console.log(`[customer-hello] 外部插件已激活（greeting=${cfg.greeting ?? 'unset'}）`)
}
