/**
 * 路由处理器工厂 · 对话补全（OpenAI 兼容）：鉴权 → DLP → 容灾转发 → 留痕
 * 由插件 ent-upstream 装载，服务依赖注入（原直接 import 各模块）
 */
import { randomUUID } from 'node:crypto'
import { json, readJson, ts, sha16 } from '../core/http.mjs'

/** 审计正文截断（超限加截断标记，保证"看得到被截断了"） */
function cut(s, maxChars) {
  if (s == null) return null
  return s.length > maxChars ? s.slice(0, maxChars) + `\n…[已截断：原始 ${s.length} 字符，可在 gateway-config.json 调大 audit.maxContentChars]` : s
}

export function createChatHandler({ store, auth, dlp, upstream }) {
  const { auditContent, scanMessages, serializeContext, auditMaxChars } = dlp
  const { forwardWithFailover, pumpSse } = upstream
  const { insertLog } = store
  const { authenticate } = auth

  return async function handleChat(req, res) {
    const authResult = await authenticate(req)
    if (!authResult.ok) {
      const hdr = req.headers.authorization ?? ''
      console.log(`[${ts()}] ⛔ 401 /v1/chat/completions reason=${authResult.error?.type} auth头=${hdr ? hdr.slice(0, 24) + '…(' + hdr.length + '字符)' : '缺失'}`)
      return json(res, authResult.status, { error: authResult.error })
    }

    const body = await readJson(req)
    if (!body) return json(res, 400, { error: { message: '请求体不是合法 JSON', type: 'bad_request' } })

    const entModel = body.model ?? 'ent-default'
    const messages = Array.isArray(body.messages) ? body.messages : []
    const userMsg = messages.at(-1)?.content ?? ''
    const promptText = typeof userMsg === 'string' ? userMsg : JSON.stringify(userMsg)
    const started = Date.now()
    const maxChars = auditMaxChars()

    // DLP：block 拒绝 / mask 脱敏后继续 —— 全量上下文逐条扫描（此前仅扫末条，历史消息可绕过）
    const dlpResult = scanMessages(messages)
    const auditPromptFull = serializeContext(dlpResult.maskedMessages)
    if (dlpResult.blocked) {
      insertLog({
        user_name: authResult.user.username, model: entModel, prompt_hash: sha16(promptText),
        status_code: 200, dlp_flag: dlpResult.hits.map((h) => h.rule).join(','), blocked: 1,
        prompt: cut(auditPromptFull, maxChars), note: 'DLP blocked',
      })
      console.log(`[${ts()}] ⛔ DLP 拦截 user=${authResult.user.username} rules=${dlpResult.hits.map((h) => h.rule).join('+')}`)
      return json(res, 200, {
        id: `chatcmpl-blocked-${randomUUID().slice(0, 8)}`, object: 'chat.completion', model: entModel,
        choices: [{ index: 0, message: { role: 'assistant', content: '[企业网关] 您的最新消息包含被禁止发送的敏感内容（如密钥），已被安全策略阻断。本次请求已记录。请移除敏感内容后重试；之前对话中出现的敏感信息已自动脱敏，不会影响后续对话。' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
      })
    }
    if (dlpResult.hits.length) {
      const redactNote = dlpResult.redacted ? `，历史命中已自动脱敏(${dlpResult.hits.filter((h) => h.action === 'redact').reduce((s, h) => s + h.count, 0)}处)` : ''
      console.log(`[${ts()}] ⚠ DLP 标记: ${dlpResult.hits.map((h) => `${h.label}(${h.action})x${h.count}`).join(', ')}${redactNote}`)
    }

    // 转发（全部消息用脱敏版，防敏感数据经历史上下文出域）
    const forwardObj = { ...body, messages: dlpResult.maskedMessages }
    const fwd = await forwardWithFailover({ entModel, bodyObj: forwardObj, log: (m) => console.log(`[${ts()}] ${m})`) })

    if (!fwd.ok) {
      insertLog({
        user_name: authResult.user.username, model: entModel, prompt_hash: sha16(promptText),
        status_code: 502, dlp_flag: dlpResult.hits.map((h) => h.rule).join(',') || null,
        note: 'no-provider: ' + fwd.errors.join(' | ').slice(0, 500),
      })
      console.log(`[${ts()}] ✗ 全渠道失败 user=${authResult.user.username}`)
      return json(res, 502, { error: { message: '模型无可用供应商（不存在/下架/故障）', type: 'gateway_upstream_all_failed', detail: fwd.errors } })
    }

    const promptHash = sha16(promptText)
    const dlpJoined = dlpResult.hits.map((h) => h.rule).join(',') || null

    if (body.stream === true) {
      const { usage, firstTokenMs, durationMs, responseText, reasoningText } = await pumpSse(fwd.response.body, res, { protocol: fwd.provider.protocol ?? 'openai', upstreamModel: fwd.upstreamModel })
      // 留痕正文：content 优先；思考模型（或 max_tokens 被 reasoning 吃满）时 content 可能为空，
      // 把思考过程也存进去（截 4000 字），详情永远有内容可看
      let auditResp = responseText
      if (!auditResp && reasoningText) auditResp = `[仅思考输出，未产出正文]\n[思考过程]\n` + reasoningText.slice(0, 4000)
      else if (auditResp && reasoningText) auditResp += `\n\n[思考过程]\n` + reasoningText.slice(0, 4000)
      const audit = auditContent(auditPromptFull, auditResp || null)
      insertLog({
        user_name: authResult.user.username, model: entModel, channel_id: fwd.provider.id, upstream_model: fwd.upstreamModel,
        prompt: cut(audit.prompt, maxChars), response: cut(audit.response, maxChars),
        prompt_hash: promptHash,
        tokens_in: usage?.prompt_tokens ?? null, tokens_out: usage?.completion_tokens ?? null,
        tokens_cached: usage?.prompt_tokens_details?.cached_tokens ?? null,
        duration_ms: durationMs, status_code: 200, dlp_flag: dlpJoined, note: `stream, ttft=${firstTokenMs}ms`,
      })
      console.log(`[${ts()}] ✔ 流式 user=${authResult.user.username} ${entModel}→${fwd.upstreamModel} ttft=${firstTokenMs}ms ${durationMs}ms tok=${usage ? `${usage.prompt_tokens}/${usage.completion_tokens}` : 'n/a'} 留痕=${responseText ? responseText.length + '字' : '无'}${dlpResult.hits.length ? ' [DLP]' : ''}`)
    } else {
      const text = await fwd.response.text()
      let data
      try { data = JSON.parse(text) } catch {
        return json(res, 502, { error: { message: '上游返回非 JSON', type: 'gateway_bad_upstream' } })
      }
      const msg = data.choices?.[0]?.message ?? {}
      // 留痕正文拼装：content + 工具调用 + 思考过程（content 为空时思考就是全部输出）
      let respText = typeof msg.content === 'string' ? msg.content : (msg.content ?? null)
      if (Array.isArray(msg.tool_calls) && msg.tool_calls.length) {
        const toolTxt = msg.tool_calls
          .map((tc) => `[调用工具 ${tc.function?.name || '?'}] ${tc.function?.arguments ?? ''}`)
          .join('\n')
        respText = respText ? respText + '\n\n' + toolTxt : toolTxt
      }
      const reasoning = typeof msg.reasoning === 'string' ? msg.reasoning : (typeof msg.reasoning_content === 'string' ? msg.reasoning_content : '')
      if (reasoning) respText = respText ? respText + `\n\n[思考过程]\n` + reasoning.slice(0, 4000) : `[仅思考输出，未产出正文]\n[思考过程]\n` + reasoning.slice(0, 4000)
      const audit = auditContent(auditPromptFull, respText || null)
      insertLog({
        user_name: authResult.user.username, model: entModel, channel_id: fwd.provider.id, upstream_model: fwd.upstreamModel,
        prompt: cut(audit.prompt, maxChars), response: cut(audit.response, maxChars),
        prompt_hash: promptHash,
        tokens_in: data.usage?.prompt_tokens ?? null, tokens_out: data.usage?.completion_tokens ?? null,
        tokens_cached: data.usage?.prompt_tokens_details?.cached_tokens ?? null,
        duration_ms: Date.now() - started, status_code: 200, dlp_flag: dlpJoined,
      })
      console.log(`[${ts()}] ✔ 完成 user=${authResult.user.username} ${entModel}→${fwd.upstreamModel} ${Date.now() - started}ms tok=${data.usage ? `${data.usage.prompt_tokens}/${data.usage.completion_tokens}` : '?'}${dlpResult.hits.length ? ' [DLP]' : ''}`)
      json(res, 200, data)
    }
  }
}
