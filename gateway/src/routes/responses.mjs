/**
 * 路由处理器工厂 · Responses API（Codex 方言）：/v1/responses
 * Codex CLI 等 Responses 客户端 → 网关翻译成 chat.completions 内部链路（鉴权/DLP/容灾/留痕全复用）→ 响应译回 Responses 形态。
 * 请求转换：input(string|数组) → messages；instructions → system；reasoning.effort → reasoning_effort；max_output_tokens → max_tokens
 * 响应转换：非流式 → output 数组（message/reasoning）；流式 → OpenAI delta 泵 + 译为 response.output_text.delta 等事件
 */
import { randomUUID } from 'node:crypto'
import { json, readJson, ts, sha16 } from '../core/http.mjs'

function cut(s, maxChars) {
  if (s == null) return null
  return s.length > maxChars ? s.slice(0, maxChars) + `\n…[已截断：原始 ${s.length} 字符，可在 gateway-config.json 调大 audit.maxContentChars]` : s
}

/** Responses 请求体 → chat.completions 请求体（messages 语义对齐） */
function responsesToChat(b) {
  const messages = []
  if (b.instructions) messages.push({ role: 'system', content: String(b.instructions) })
  const input = b.input
  if (typeof input === 'string') {
    messages.push({ role: 'user', content: input })
  } else if (Array.isArray(input)) {
    for (const item of input) {
      if (item?.type === 'message' || (!item?.type && item?.role)) {
        // content 可能是 string 或 [{type:'input_text'|'output_text'|'input_image', text|image_url}]
        const c = item.content
        let content = c
        if (Array.isArray(c)) {
          content = c.map((p) => {
            if (p?.type === 'input_text' || p?.type === 'output_text' || p?.type === 'text') return { type: p.type === 'output_text' ? 'text' : 'text', text: p.text ?? '' }
            if (p?.type === 'input_image') return { type: 'image_url', image_url: { url: typeof p.image_url === 'string' ? p.image_url : p.image_url?.url ?? '' } }
            return p
          })
        }
        messages.push({ role: item.role === 'assistant' ? 'assistant' : item.role === 'system' || item.role === 'developer' ? 'system' : 'user', content })
      }
    }
  }
  if (!messages.length) messages.push({ role: 'user', content: '' })
  const out = {
    model: b.model,
    messages,
    ...(b.max_output_tokens ? { max_tokens: b.max_output_tokens } : {}),
    ...(b.temperature !== undefined ? { temperature: b.temperature } : {}),
    ...(b.top_p !== undefined ? { top_p: b.top_p } : {}),
    stream: Boolean(b.stream),
  }
  // 思考档位：reasoning.effort 直接映射内部档位语义
  const effort = b.reasoning?.effort
  if (effort && effort !== 'none') out.reasoning_effort = effort
  else if (effort === 'none') out.reasoning_effort = 'off'
  return out
}

/** chat.completion 响应 → Responses 形态（非流式） */
function chatToResponses(d, entModel) {
  const msg = d.choices?.[0]?.message ?? {}
  const output = []
  const reasoning = msg.reasoning_content ?? msg.reasoning ?? null
  if (reasoning) output.push({ type: 'reasoning', id: `rs_${randomUUID().slice(0, 12)}`, summary: [] })
  output.push({
    type: 'message',
    id: `msg_${randomUUID().slice(0, 12)}`,
    role: 'assistant',
    status: 'completed',
    content: [{ type: 'output_text', text: typeof msg.content === 'string' ? msg.content : String(msg.content ?? ''), annotations: [] }],
  })
  return {
    id: d.id ?? `resp_${randomUUID().slice(0, 12)}`,
    object: 'response',
    created_at: d.created ?? Math.floor(Date.now() / 1000),
    status: 'completed',
    model: entModel,
    output,
    usage: d.usage ? {
      input_tokens: d.usage.prompt_tokens ?? 0,
      output_tokens: d.usage.completion_tokens ?? 0,
      total_tokens: d.usage.total_tokens ?? 0,
    } : undefined,
  }
}

/** OpenAI delta chunk → Responses SSE 事件序列（0~2 个） */
function chunkToResponseEvents(j, state) {
  const events = []
  const d = j.choices?.[0]?.delta
  if (d?.role === 'assistant' && !state.msgAnnounced) {
    state.msgAnnounced = true
    events.push({ type: 'response.output_item.added', output_index: 0, item: { type: 'message', id: `msg_${state.id}`, role: 'assistant', status: 'in_progress', content: [] } })
  }
  if (typeof d?.reasoning_content === 'string' && d.reasoning_content && !state.rsnAnnounced) {
    state.rsnAnnounced = true
    events.push({ type: 'response.output_item.added', output_index: state.outIdx, item: { type: 'reasoning', id: `rs_${state.id}`, summary: [] } })
  }
  if (typeof d?.content === 'string' && d.content) {
    if (!state.msgAnnounced) {
      state.msgAnnounced = true
      events.push({ type: 'response.output_item.added', output_index: state.outIdx, item: { type: 'message', id: `msg_${state.id}`, role: 'assistant', status: 'in_progress', content: [] } })
    }
    events.push({ type: 'response.output_text.delta', item_id: `msg_${state.id}`, output_index: state.outIdx, content_index: 0, delta: d.content })
  }
  if (j.choices?.[0]?.finish_reason) {
    events.push({ type: 'response.output_item.done', output_index: state.outIdx, item: { type: 'message', id: `msg_${state.id}`, role: 'assistant', status: 'completed', content: [] } })
    events.push({ type: 'response.completed', response: { id: `resp_${state.id}`, object: 'response', status: 'completed', model: state.model, usage: j.usage ? { input_tokens: j.usage.prompt_tokens ?? 0, output_tokens: j.usage.completion_tokens ?? 0, total_tokens: j.usage.total_tokens ?? 0 } : undefined } })
  }
  return events
}

export function createResponsesHandler({ store, auth, dlp, upstream }) {
  const { auditContent, scanMessages, serializeContext, auditMaxChars } = dlp
  const { forwardWithFailover, pumpSse } = upstream
  const { insertLog } = store
  const { authenticate } = auth

  return async function handleResponses(req, res) {
    const authResult = await authenticate(req)
    if (!authResult.ok) {
      const hdr = req.headers.authorization ?? ''
      console.log(`[${ts()}] ⛔ 401 /v1/responses reason=${authResult.error?.type} auth头=${hdr ? hdr.slice(0, 24) + '…(' + hdr.length + '字符)' : '缺失'}`)
      return json(res, authResult.status, { error: authResult.error })
    }

    const raw = await readJson(req)
    if (!raw) return json(res, 400, { error: { message: '请求体不是合法 JSON', type: 'bad_request' } })

    // Responses → chat.completions 内部形态，此后与 chat 链路完全同构
    const body = responsesToChat(raw)
    const entModel = body.model ?? 'ent-default'
    const messages = Array.isArray(body.messages) ? body.messages : []
    const userMsg = messages.at(-1)?.content ?? ''
    const promptText = typeof userMsg === 'string' ? userMsg : JSON.stringify(userMsg)
    const started = Date.now()
    const maxChars = auditMaxChars()

    const dlpResult = scanMessages(messages)
    const auditPromptFull = serializeContext(dlpResult.maskedMessages)
    if (dlpResult.blocked) {
      insertLog({
        user_name: authResult.user.username, model: entModel, prompt_hash: sha16(promptText),
        status_code: 200, dlp_flag: dlpResult.hits.map((h) => h.rule).join(','), blocked: 1,
        prompt: cut(auditPromptFull, maxChars), note: 'DLP blocked (responses)',
      })
      console.log(`[${ts()}] ⛔ DLP 拦截(responses) user=${authResult.user.username} rules=${dlpResult.hits.map((h) => h.rule).join('+')}`)
      return json(res, 200, {
        id: `resp_blocked_${randomUUID().slice(0, 8)}`, object: 'response', model: entModel, status: 'completed',
        output: [{ type: 'message', id: `msg_${randomUUID().slice(0, 8)}`, role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: '[企业网关] 您的最新消息包含被禁止发送的敏感内容（如密钥），已被安全策略阻断。本次请求已记录。', annotations: [] }] }],
        usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 },
      })
    }
    if (dlpResult.hits.length) {
      const redactNote = dlpResult.redacted ? `，历史命中已自动脱敏(${dlpResult.hits.filter((h) => h.action === 'redact').reduce((s, h) => s + h.count, 0)}处)` : ''
      console.log(`[${ts()}] ⚠ DLP 标记(responses): ${dlpResult.hits.map((h) => `${h.label}(${h.action})x${h.count}`).join(', ')}${redactNote}`)
    }

    const forwardObj = { ...body, messages: dlpResult.maskedMessages }
    const fwd = await forwardWithFailover({ entModel, bodyObj: forwardObj, log: (m) => console.log(`[${ts()}] ${m})`) })

    if (!fwd.ok) {
      insertLog({
        user_name: authResult.user.username, model: entModel, prompt_hash: sha16(promptText),
        status_code: 502, dlp_flag: dlpResult.hits.map((h) => h.rule).join(',') || null,
        note: 'no-provider(responses): ' + fwd.errors.join(' | ').slice(0, 500),
      })
      console.log(`[${ts()}] ✗ 全渠道失败(responses) user=${authResult.user.username}`)
      return json(res, 502, { error: { message: '模型无可用供应商（不存在/下架/故障）', type: 'gateway_upstream_all_failed', detail: fwd.errors } })
    }

    const promptHash = sha16(promptText)
    const dlpJoined = dlpResult.hits.map((h) => h.rule).join(',') || null

    if (body.stream === true) {
      // 流式：writeHead 后把 OpenAI delta（pumpSse 已按协议归一，collectOnly 只喂不写）
      // 逐事件译成 Responses 方言（response.output_text.delta 等）
      const state = { id: randomUUID().slice(0, 12), model: entModel, msgAnnounced: false, rsnAnnounced: false, outIdx: 0 }
      let usage = null
      res.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
        connection: 'keep-alive',
        'x-accel-buffering': 'no',
      })
      res.write(`event: response.created\ndata: ${JSON.stringify({ type: 'response.created', response: { id: `resp_${state.id}`, object: 'response', status: 'in_progress', model: entModel } })}\n\n`)
      const result = await pumpSse(fwd.response.body, res, {
        protocol: fwd.provider.protocol ?? 'openai',
        upstreamModel: fwd.upstreamModel,
        collectOnly: true,
        onChunk: (chunk) => {
          for (const line of String(chunk).split('\n')) {
            const t = line.trim()
            if (!t.startsWith('data:')) continue
            const payload = t.slice(5).trim()
            if (!payload || payload === '[DONE]') continue
            try {
              const j = JSON.parse(payload)
              if (j.usage && j.usage.total_tokens) usage = j.usage
              for (const ev of chunkToResponseEvents(j, state)) {
                res.write(`event: ${ev.type}\ndata: ${JSON.stringify(ev)}\n\n`)
              }
            } catch { /* ignore */ }
          }
        },
      })
      usage = result.usage ?? usage
      const firstTokenMs = result.firstTokenMs
      const durationMs = result.durationMs
      let responseText = result.responseText
      const reasoningText = result.reasoningText
      // 收尾：output_item.done + response.completed（流必须显式 end，collectOnly 模式 pump 不代劳）
      res.write(`event: response.output_item.done\ndata: ${JSON.stringify({ type: 'response.output_item.done', output_index: state.outIdx, item: { type: 'message', id: `msg_${state.id}`, role: 'assistant', status: 'completed', content: [] } })}\n\n`)
      res.write(`event: response.completed\ndata: ${JSON.stringify({ type: 'response.completed', response: { id: `resp_${state.id}`, object: 'response', status: 'completed', model: entModel, usage: usage ? { input_tokens: usage.prompt_tokens ?? 0, output_tokens: usage.completion_tokens ?? 0, total_tokens: usage.total_tokens ?? 0 } : undefined } })}\n\n`)
      res.end()
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
        duration_ms: durationMs, status_code: 200, dlp_flag: dlpJoined, note: `responses-stream, ttft=${firstTokenMs}ms`,
      })
      console.log(`[${ts()}] ✔ responses流式 user=${authResult.user.username} ${entModel}→${fwd.upstreamModel} ttft=${firstTokenMs}ms ${durationMs}ms tok=${usage ? `${usage.prompt_tokens}/${usage.completion_tokens}` : 'n/a'}${dlpResult.hits.length ? ' [DLP]' : ''}`)
      return
    }

    // 非流式
    const text = await fwd.response.text()
    let data
    try { data = JSON.parse(text) } catch {
      return json(res, 502, { error: { message: '上游返回非 JSON', type: 'gateway_bad_upstream' } })
    }
    const msg = data.choices?.[0]?.message ?? {}
    let respText = typeof msg.content === 'string' ? msg.content : (msg.content ?? null)
    const reasoning = typeof msg.reasoning === 'string' ? msg.reasoning : (typeof msg.reasoning_content === 'string' ? msg.reasoning_content : '')
    if (reasoning) respText = respText ? respText + `\n\n[思考过程]\n` + reasoning.slice(0, 4000) : `[仅思考输出，未产出正文]\n[思考过程]\n` + reasoning.slice(0, 4000)
    const audit = auditContent(auditPromptFull, respText || null)
    insertLog({
      user_name: authResult.user.username, model: entModel, channel_id: fwd.provider.id, upstream_model: fwd.upstreamModel,
      prompt: cut(audit.prompt, maxChars), response: cut(audit.response, maxChars),
      prompt_hash: promptHash,
      tokens_in: data.usage?.prompt_tokens ?? null, tokens_out: data.usage?.completion_tokens ?? null,
      tokens_cached: data.usage?.prompt_tokens_details?.cached_tokens ?? null,
      duration_ms: Date.now() - started, status_code: 200, dlp_flag: dlpJoined, note: 'responses',
    })
    console.log(`[${ts()}] ✔ responses完成 user=${authResult.user.username} ${entModel}→${fwd.upstreamModel} ${Date.now() - started}ms tok=${data.usage ? `${data.usage.prompt_tokens}/${data.usage.completion_tokens}` : '?'}${dlpResult.hits.length ? ' [DLP]' : ''}`)
    json(res, 200, chatToResponses(data, entModel))
  }
}
