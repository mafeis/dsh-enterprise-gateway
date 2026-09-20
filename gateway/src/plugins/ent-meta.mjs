/**
 * 元插件 ent-meta · 基础端点
 * /health（存活探针，含版本号）与 /v1/models（OpenAI 兼容模型目录）——
 * 这两个端点也是功能，也插件化；不再有「内核路由」特权。
 */
import { readFileSync } from 'node:fs'
import { json } from '../core/http.mjs'

export const name = 'ent-meta'
export const provides = []
export const inject = ['config', 'router', 'store', 'auth']

export const manifest = {
  capabilities: ['meta.health', 'meta.models'],
}

export function apply(ctx) {
  const { getConfig } = ctx.get('config')
  const router = ctx.get('router')
  const store = ctx.get('store')
  const { authenticate } = ctx.get('auth')
  const VERSION = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')).version

  ctx.effect(() => router.exact('GET', '/health', (req, res) => {
    const cfg = getConfig()
    json(res, 200, { ok: true, version: VERSION, policy: cfg.policy.version, ts: Date.now() })
  }), 'ent-meta: route GET /health')

  ctx.effect(() => router.exact('GET', '/v1/models', async (req, res) => {
    // 只暴露已上架的模型；带上下文等元数据（OpenAI 格式扩展字段）
    const c = getConfig()
    // 供应商可用 = 自身启用 或 该模型配了启用的容灾供应商（容灾存在的意义就是主家挂了仍可选）
    const provOk = new Set(c.providers.filter((p) => p.enabled).map((p) => p.id))
    const modelServable = (m) => m.enabled !== false && (
      provOk.has(m.providerId) ||
      (m.fallbackProviders ?? []).some((fid) => provOk.has(fid))
    )
    // 用户分组过滤：带 Bearer 票时按用户所在分组的模型白名单过滤（未分组/白名单空 = 不限；
    // 无票/鉴权失败保持全量，目录不拦人，真正的强制点在 chat/responses 转发前）
    let allow = null
    try {
      if (req.headers.authorization) {
        const a = await authenticate(req)
        if (a.ok) {
          const g = store.groupOfUser(a.user.username)
          if (g?.models?.length) allow = new Set(g.models)
        }
      }
    } catch { /* 分组解析失败不拦目录 */ }
    // DSH 终端 schema 白名单：档位只能 off|minimal|low|medium|high|xhigh|max，
    // 输入只能 text|image——越界值透传会让客户端整个 llm-pi-ai 段被拒（选择器全空）
    const OK_LEVELS = new Set(['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'])
    const OK_INPUTS = new Set(['text', 'image'])
    json(res, 200, {
      object: 'list',
      data: c.models.filter(modelServable).filter((m) => !allow || allow.has(m.id)).map((m) => ({
        id: m.id, object: 'model', owned_by: 'enterprise',
        // display_name：客户端模型选择器显示用（缺失时客户端回退 id）
        display_name: m.displayName ?? null,
        context_window: m.contextWindow, max_tokens: m.maxTokens,
        mode: m.mode, thinking: m.thinking, default_thinking: m.defaultThinking,
        input_modes: (m.inputModes ?? ['text']).filter((x) => OK_INPUTS.has(x)),
        thinking_levels: (m.thinkingLevels ?? ['off', 'low', 'medium', 'high']).filter((x) => OK_LEVELS.has(x)),
      })),
    })
  }), 'ent-meta: route GET /v1/models')
}
