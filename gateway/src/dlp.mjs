/**
 * 企业网关 · DLP 引擎
 * 规则：pattern(正则) + action(block | mask | log)
 * mask 模式对 prompt 做脱敏后再留痕/转发（可配置仅留痕脱敏，转发原文——当前实现：留痕脱敏+转发脱敏）
 */
import { getConfig } from './config.mjs'

/** 扫描文本，返回 { hits: [{rule, label, action}], masked: text, blocked: bool, redacted: bool }
 *  opts.blockAsMask=true 时（用于历史消息），block 规则命中不再整体拒绝，
 *  而是把命中片段整段替换为 [已脱敏]——凭证类连首尾片段都不保留。
 */
export function scan(text, opts = {}) {
  const cfg = getConfig()
  if (!cfg.dlp.enabled) return { hits: [], masked: text, blocked: false, redacted: false }
  const blockAsMask = opts.blockAsMask === true

  const hits = []
  let masked = text
  let blocked = false
  let redacted = false

  for (const rule of cfg.dlp.rules) {
    let re
    try { re = new RegExp(rule.pattern, 'g') } catch { continue }
    const matches = masked.match(re)
    if (!matches) continue
    if (rule.action === 'block' && blockAsMask) {
      masked = masked.replace(re, () => '[已脱敏]')
      hits.push({ rule: rule.id, label: rule.label, action: 'redact', count: matches.length })
      redacted = true
      continue
    }
    hits.push({ rule: rule.id, label: rule.label, action: rule.action, count: matches.length })

    if (rule.action === 'block') {
      blocked = true
    } else if (rule.action === 'mask') {
      // 保留前4后4，中间打码
      masked = masked.replace(re, (m) => {
        if (m.length <= 8) return '*'.repeat(m.length)
        return m.slice(0, 4) + '*'.repeat(Math.max(4, m.length - 8)) + m.slice(-4)
      })
    }
  }
  return { hits, masked, blocked, redacted }
}

/** 对 DSH 留痕正文应用审计级别 */
export function auditContent(promptContext, responseText) {
  const cfg = getConfig()
  if (cfg.audit.level === 'metadata_only') {
    return { prompt: null, response: null, note: 'metadata_only' }
  }
  return { prompt: promptContext ?? null, response: responseText ?? null, note: null }
}

/** 审计正文单字段上限（字符）：可经 gateway-config.json audit.maxContentChars 调整 */
export function auditMaxChars() {
  const v = Number(getConfig().audit?.maxContentChars)
  return Number.isFinite(v) && v >= 1000 ? v : 32000
}

/** 合并 DLP 命中（同规则累加计数） */
function mergeHits(into, hits) {
  for (const h of hits) {
    const cur = into.find((x) => x.rule === h.rule)
    if (cur) cur.count += h.count
    else into.push({ ...h })
  }
}

/** 全量上下文扫描/脱敏：对 messages 每条的 string / text-part 内容逐条 scan。
 *  拦截作用域：仅「最后一条用户消息」触发硬拦截（本次新增内容）；
 *  历史消息中的 block 规则命中改为整段脱敏（[已脱敏]），既防止敏感内容经历史出域，
 *  又避免一次误粘密钥把后续所有会话永久锁死。
 *  返回 { hits（聚合）, maskedMessages, blocked, redacted } */
export function scanMessages(messages) {
  const list = Array.isArray(messages) ? messages : []
  let lastUserIdx = -1
  for (let i = list.length - 1; i >= 0; i--) {
    if (list[i]?.role === 'user') { lastUserIdx = i; break }
  }
  const hits = []
  let blocked = false
  let redacted = false
  const maskedMessages = list.map((m, idx) => {
    const mm = { ...m }
    // 非最后一条用户消息 = 历史：block 规则按脱敏处理
    const blockAsMask = idx !== lastUserIdx
    if (typeof mm.content === 'string') {
      const r = scan(mm.content, { blockAsMask })
      mergeHits(hits, r.hits)
      if (r.blocked) blocked = true
      if (r.redacted) redacted = true
      mm.content = r.masked
    } else if (Array.isArray(mm.content)) {
      // 多模态 content parts：对 text 部分脱敏，其余（image_url 等）原样
      mm.content = mm.content.map((p) => {
        if (p && typeof p === 'object' && p.type === 'text' && typeof p.text === 'string') {
          const r = scan(p.text, { blockAsMask })
          mergeHits(hits, r.hits)
          if (r.blocked) blocked = true
          if (r.redacted) redacted = true
          return { ...p, text: r.masked }
        }
        return p
      })
    }
    return mm
  })
  return { hits, maskedMessages, blocked, redacted }
}

/** 序列化完整上下文供审计存储：每条消息带角色标头，详情弹窗直接可读 */
export function serializeContext(messages) {
  if (!Array.isArray(messages)) return String(messages ?? '')
  return messages.map((m) => {
    const body = typeof m.content === 'string' ? m.content : JSON.stringify(m.content)
    return `[${m.role ?? '?'}]\n${body}`
  }).join('\n\n')
}
