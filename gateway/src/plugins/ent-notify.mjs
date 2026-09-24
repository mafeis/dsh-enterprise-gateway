/**
 * 示例插件 ent-notify · 领域事件订阅 → 外发告警（webhook）
 *
 * 展示「跨插件协作」的标准写法——本插件不碰 chat/dlp/store 任何实现：
 *   1. inject registry，从 registry 服务拿事件总线
 *   2. 订阅领域事件（dlp.blocked / upstream.failover / auth.locked）
 *   3. 命中阈值 → POST webhook（企业微信/钉钉/Slack 兼容格式）
 *
 * 配置（gateway-config.json plugins.ent-notify.config）：
 *   { "webhook": "https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=xxx",
 *     "minLevel": "block" }   // block=仅拦截告警；mask=含脱敏提示
 */
import { json } from '../core/http.mjs'

export const name = 'ent-notify'
export const provides = []
export const inject = ['registry', 'router']

export const manifest = {
  capabilities: ['notify.webhook'],
}

/** 自带页面：通知告警事件流（页面资源在本插件 ent-notify.web/）；icon 为 lucide 图标名 */
export const admin = {
  nav: { id: 'notify', title: '通知告警', titleEn: 'Alerts', icon: 'bell', order: 450 },
  entry: 'index.mjs',
}

export function apply(ctx) {
  const cfg = ctx.fiber.config ?? {}
  const webhook = cfg.webhook ?? ''
  const minLevel = cfg.minLevel ?? 'block'

  /** 领域事件缓冲（最近 100 条，管理台/inspector 可见） */
  const recent = []
  const record = (event) => {
    recent.push({ ts: new Date().toISOString(), ...event })
    if (recent.length > 100) recent.shift()
  }

  /** 外发 webhook（尽力而为：失败只记日志，绝不影响主链路） */
  async function send(text) {
    if (!webhook) return
    try {
      await fetch(webhook, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ msgtype: 'text', text: { content: text } }),
        signal: AbortSignal.timeout(5000),
      })
      console.log(`[notify] ➜ webhook 已推送: ${text.slice(0, 60)}…`)
    } catch (e) {
      console.warn(`[notify] webhook 推送失败: ${String(e?.message ?? e).slice(0, 100)}`)
    }
  }

  // 订阅领域事件：谁提供服务谁发事件，notify 只管消费（与事件源零耦合）
  const registry = ctx.get('registry')
  const off1 = registry.on('dlp.blocked', (e) => {
    record({ type: 'dlp.blocked', ...e })
    void send(`🛡 企业网关 DLP 拦截：${e.label ?? e.rule}（user=${e.user}）`)
  })
  const off2 = registry.on('upstream.failover', (e) => {
    record({ type: 'upstream.failover', ...e })
    if (minLevel === 'block') return // 容灾切换默认不打扰，minLevel=mask 以上才告警
    void send(`⚠ 上游容灾切换：${e.from} → ${e.to}`)
  })
  const off3 = registry.on('auth.locked', (e) => {
    record({ type: 'auth.locked', ...e })
    void send(`🔒 登录锁定：${e.user}（${e.fails} 次失败）`)
  })
  ctx.effect(() => () => { off1(); off2(); off3() }, 'ent-notify: event subscriptions')

  // 观测端点：最近事件（演示用；生产可挪进管理台卡片）
  const router = ctx.get('router')
  ctx.effect(() => router.exact('GET', '/admin/notify/recent', async (req, res) => {
    json(res, 200, { recent, webhookConfigured: !!webhook, minLevel })
  }), 'ent-notify: route GET /admin/notify/recent')
}
