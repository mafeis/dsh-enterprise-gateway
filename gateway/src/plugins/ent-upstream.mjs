/**
 * 插件 ent-upstream · provides: upstream
 * 上游转发：模型→Provider 路由 + 思考档位注入 + 超时 + 容灾 + SSE 流式透传
 * 并挂载对话路由：POST /v1/chat/completions（鉴权 → DLP → 容灾转发 → 留痕）
 * 供应商定期测活：每 60s 探测所有启用供应商，连续 2 次失败自动停用（请求时容灾接管，
 * 管理台模型表同步显示"不可服务"）；恢复需管理员手动启用（防抖动，不自动回切）
 * 实现模块：src/upstream.mjs + src/routes/chat.mjs + src/probe.mjs（testProvider）
 */
import * as upstreamImpl from '../upstream.mjs'
import { createChatHandler } from '../routes/chat.mjs'
import { createResponsesHandler } from '../routes/responses.mjs'
import { testProvider } from '../probe.mjs'
import { getConfig, updateProvider, markProviderOk } from '../config.mjs'
import { ts } from '../core/http.mjs'

export const name = 'ent-upstream'
export const provides = ['upstream']
export const inject = ['config', 'store', 'auth', 'dlp', 'router']

/** 测活状态：pid → { failStreak, lastError, lastProbedAt } + 累计统计（进程内存，重启清零） */
const health = new Map()
const stats = new Map()   // pid → { total, ok, fail, lastOkAt, lastFailAt, lastMs, lastError, autoDisabled }
const MIN_PROBE_INTERVAL_SEC = 5   // 全局最短间隔下限（各供应商可在 5-600 自设）

/** 管理台查询：测活统计（弹窗数据源） */
export function probeStatsOf(pid) {
  const s = stats.get(pid) ?? { total: 0, ok: 0, fail: 0 }
  const h = health.get(pid) ?? {}
  const avgMs = s.ok + s.fail > 0 ? Math.round(s.msSum / (s.ok + s.fail)) : null
  return {
    total: s.total ?? 0, ok: s.ok ?? 0, fail: s.fail ?? 0,
    avgMs,
    lastOkAt: s.lastOkAt ?? null, lastFailAt: s.lastFailAt ?? null,
    lastMs: s.lastMs ?? null, lastError: s.lastError ?? '',
    failStreak: h.failStreak ?? 0, autoDisabled: h.autoDisabled ?? false,
  }
}

function recordProbe(pid, ok, ms, error) {
  const s = stats.get(pid) ?? { total: 0, ok: 0, fail: 0, msSum: 0 }
  s.total += 1
  if (ok) { s.ok += 1; s.lastOkAt = Date.now(); s.lastMs = ms }
  else { s.fail += 1; s.lastFailAt = Date.now(); s.lastError = error ?? '' }
  s.msSum = (s.msSum ?? 0) + (ms ?? 0)
  stats.set(pid, s)
}

async function probeOnce() {
  const now = Date.now()
  const cfg = getConfig()
  for (const p of cfg.providers.filter((x) => x.enabled && x.probeEnabled !== false)) {
    // 每家按自己的 probeIntervalSec 节流（上次探测距今不足间隔则本轮跳过）
    const intervalMs = Math.max(MIN_PROBE_INTERVAL_SEC, Math.min(600, Number(p.probeIntervalSec) || 15)) * 1000
    const h = health.get(p.id) ?? { failStreak: 0, lastError: '' }
    if (h.lastProbedAt && now - h.lastProbedAt < intervalMs) continue
    h.lastProbedAt = now
    const failLimit = Math.min(10, Math.max(1, Number(p.probeFailLimit) || 2))
    // 测活只关心可达+密钥有效；/models 对部分中转可能 404/慢，用更长超时容错
    const r = await testProvider(p.id).catch((e) => ({ ok: false, error: String(e).slice(0, 120) }))
    recordProbe(p.id, r.ok, r.ms ?? 0, r.error)
    if (r.ok) {
      markProviderOk(p.id)   // 测活成功：复位熔断（否则 15s 测活周期外熔断过期前主家一直被跳过）
      // 恢复自动启用：此前因测活失败被自动停用的供应商，探测通过后按配置决定是否重新上线
      if (h.autoDisabled && p.probeAutoRecover !== false) {
        updateProvider(p.id, { enabled: true })
        console.log(`[${ts()}] ♥ 供应商 ${p.id} 测活恢复（${r.ms}ms），已自动重新启用`)
      } else if (h.failStreak > 0) {
        console.log(`[${ts()}] ♥ 供应商 ${p.id} 测活恢复（${r.ms}ms）${h.autoDisabled ? '（自动停用中，需管理员手动启用）' : ''}`)
      }
      health.set(p.id, { failStreak: 0, lastError: '' })
    } else {
      h.failStreak += 1
      h.lastError = r.error ?? 'unknown'
      health.set(p.id, h)
      if (h.failStreak === failLimit) {
        updateProvider(p.id, { enabled: false })
        h.autoDisabled = true   // 标记"是测活停的"，供恢复逻辑区分手动停用
        console.log(`[${ts()}] ⛔ 供应商 ${p.id} 连续 ${failLimit} 次测活失败（${h.lastError}），已自动停用——挂载模型走容灾或下架`)
      } else {
        console.log(`[${ts()}] ⚠ 供应商 ${p.id} 测活失败 ${h.failStreak}/${failLimit}（${h.lastError}）`)
      }
    }
  }
}

export function apply(ctx) {
  ctx.provide('upstream', upstreamImpl)

  const handleChat = createChatHandler({
    store: ctx.get('store'),
    auth: ctx.get('auth'),
    dlp: ctx.get('dlp'),
    upstream: upstreamImpl,
  })
  // Responses API（Codex 方言）：/v1/responses → 译为内部 chat 链路 → 译回 Responses 形态
  const handleResponses = createResponsesHandler({
    store: ctx.get('store'),
    auth: ctx.get('auth'),
    dlp: ctx.get('dlp'),
    upstream: upstreamImpl,
  })
  const router = ctx.get('router')
  ctx.effect(() => router.exact('POST', '/v1/chat/completions', handleChat), 'ent-upstream: route POST /v1/chat/completions')
  ctx.effect(() => router.exact('POST', '/v1/responses', handleResponses), 'ent-upstream: route POST /v1/responses')

  /* ---------- 供应商定期测活（effect 管生命周期；启动 10s 后首测，之后按全局最短节拍轮询，
     每家按自己的 probeIntervalSec 节流：距上次探测不足间隔的供应商本轮跳过） ---------- */
  ctx.effect(() => {
    const first = setTimeout(() => { void probeOnce().catch(() => {}) }, 10_000)
    const timer = setInterval(() => { void probeOnce().catch(() => {}) }, MIN_PROBE_INTERVAL_SEC * 1000)
    return () => { clearTimeout(first); clearInterval(timer) }
  }, 'ent-upstream: provider health probe')
}
