/**
 * 企业网关 · 上游转发（模型→Provider 路由 + 协议适配 + 思考档位注入 + 超时 + 容灾 + SSE 透传）
 * 支持 3 种常用上游协议（provider.protocol）：
 *   openai    — POST {base}/chat/completions，Bearer 鉴权（默认；绝大多数中转/聚合站）
 *   anthropic — POST {base}/v1/messages，x-api-key + anthropic-version，system/messages 分离
 *   gemini    — POST {base}/v1beta/models/{model}:streamGenerateContent?alt=sse，x-goog-api-key
 * 客户端始终说 OpenAI 方言；网关负责 双向翻译（请求转出 + SSE 流转回 OpenAI delta 形态）。
 */
import { pickRoute, failoverRoute, resolveProviderApiKey, markProviderOk, markProviderFail } from './config.mjs'

/**
 * 按模型配置注入思考参数。
 * 默认双兼容：GLM 风格 thinking.type 开关 + OpenAI 风格 reasoning_effort 档位；
 * 档位名单与注入参数均可按模型手工维护（thinkingLevels + thinkingParams）——
 * 各家上游体系不同（minimal/xhigh/budget-8k…），thinkingParams[level] 存在时完全接管该档注入：
 *   { "budget-8k": { "thinking": { "type": "enabled", "budget_tokens": 8192 } } }
 * viaFallback=true（容灾命中）：忽略请求带来的档位，一律按容灾侧模型的默认档位处理——
 *   容灾模型未必支持主模型选的档位（白名单不同会被上游整拒），用它自己的默认档最稳。
 */
function applyThinking(bodyObj, model, { viaFallback = false } = {}) {
  const t = model.thinking ?? 'optional'
  const level = viaFallback
    ? (model.defaultThinking ?? 'off')
    : (bodyObj.reasoning_effort ?? model.defaultThinking ?? 'off')
  const custom = model.thinkingParams?.[level]
  const wantThink = t === 'always' || (t === 'optional' && level !== 'off')
  delete bodyObj.reasoning_effort   // 档位选择已读出；注入方式由下面决定
  if (wantThink) {
    if (custom) Object.assign(bodyObj, structuredClone(custom))
    else {
      bodyObj.thinking = { type: 'enabled' }
      if (level !== 'off') bodyObj.reasoning_effort = level
    }
  } else if (t !== 'none') {
    if (custom) Object.assign(bodyObj, structuredClone(custom))   // off 档也可自定义（如个别上游禁收 thinking 字段）
    else bodyObj.thinking = { type: 'disabled' }
  }
  return bodyObj
}

/* ---------- 协议适配：OpenAI 方言 ↔ 上游协议 ---------- */

const GEMINI_THINKING_BUDGET = { minimal: 512, low: 2048, medium: 8192, high: 24576 }

/** OpenAI 请求体 → Anthropic /v1/messages 请求体（system 提取 + role 映射 + 思考档位 → thinking budget） */
function toAnthropicRequest(bodyObj, model) {
  const { system, messages } = (() => {
    const sys = [], msgs = []
    for (const m of bodyObj.messages ?? []) {
      if (m.role === 'system') sys.push(typeof m.content === 'string' ? m.content : JSON.stringify(m.content))
      else msgs.push({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content })
    }
    return { system: sys.join('\n\n') || undefined, messages: msgs }
  })()
  const level = bodyObj.reasoning_effort ?? model.defaultThinking ?? 'off'
  const custom = model.thinkingParams?.[level]
  const out = {
    model: bodyObj.model,   // 调用方已在 bodyObj.model 预写按供应商映射后的上游名（forwardWithFailover 统一覆盖）
    max_tokens: bodyObj.max_tokens ?? 4096,
    ...(bodyObj.temperature !== undefined ? { temperature: bodyObj.temperature } : {}),
    ...(bodyObj.top_p !== undefined ? { top_p: bodyObj.top_p } : {}),
    ...(bodyObj.stop ? { stop_sequences: Array.isArray(bodyObj.stop) ? bodyObj.stop : [bodyObj.stop] } : {}),
    ...(bodyObj.tools ? { tools: bodyObj.tools.map((t) => ({ name: t.function?.name ?? t.name, description: t.function?.description, input_schema: t.function?.parameters ?? { type: 'object' } })) } : {}),
    ...(system ? { system } : {}),
    messages,
  }
  const t = model.thinking ?? 'optional'
  const wantThink = t === 'always' || (t === 'optional' && level !== 'off')
  if (custom) {
    // thinkingParams 接管：剥掉 OpenAI 风格键（reasoning_effort/thinking），其余原样透传（可直接写 budget_tokens）
    const { reasoning_effort: _e, thinking: _t, ...rest } = structuredClone(custom)
    Object.assign(out, rest)
  } else if (wantThink) {
    out.thinking = { type: 'enabled', budget_tokens: Math.max(1024, Math.floor((out.max_tokens ?? 4096) * 0.6)) }
  } else if (t !== 'none') {
    // anthropic 关思考 = 不带 thinking 字段（off 档）
  }
  return out
}

/** OpenAI 请求体 → Gemini :streamGenerateContent 请求体（contents/systemInstruction/generationConfig） */
function toGeminiRequest(bodyObj, model) {
  const sys = [], contents = []
  for (const m of bodyObj.messages ?? []) {
    if (m.role === 'system') sys.push({ role: 'user', parts: [{ text: typeof m.content === 'string' ? m.content : JSON.stringify(m.content) }] })
    else contents.push({ role: m.role === 'assistant' ? 'model' : 'user', parts: Array.isArray(m.content) ? m.content : [{ text: String(m.content ?? '') }] })
  }
  const level = bodyObj.reasoning_effort ?? model.defaultThinking ?? 'off'
  const custom = model.thinkingParams?.[level]
  const out = { contents, ...(sys.length ? { systemInstruction: { parts: sys[0].parts } } : {}) }
  const gc = {}
  if (bodyObj.temperature !== undefined) gc.temperature = bodyObj.temperature
  if (bodyObj.top_p !== undefined) gc.topP = bodyObj.top_p
  if (bodyObj.max_tokens) gc.maxOutputTokens = bodyObj.max_tokens
  if (bodyObj.stop) gc.stopSequences = Array.isArray(bodyObj.stop) ? bodyObj.stop : [bodyObj.stop]
  const t = model.thinking ?? 'optional'
  const wantThink = t === 'always' || (t === 'optional' && level !== 'off')
  if (custom) {
    const { reasoning_effort: _e, thinking: _t, generationConfig: gcCustom, ...rest } = structuredClone(custom)
    Object.assign(gc, gcCustom ?? {})
    Object.assign(out, rest)
  } else if (wantThink && level !== 'off') {
    out.generationConfig = { ...gc, thinkingConfig: { thinkingBudget: GEMINI_THINKING_BUDGET[level] ?? 8192 } }
    return { ...out, generationConfig: out.generationConfig }
  } else if (wantThink) {
    gc.thinkingConfig = { thinkingBudget: 8192 }
  } else if (t !== 'none') {
    gc.thinkingConfig = { thinkingBudget: 0 }   // 关思考
  }
  if (Object.keys(gc).length) out.generationConfig = gc
  return out
}

/** 该模型发给某供应商的上游模型名：优先取按供应商的映射（容灾两边名字不同），未配置回退通用 upstreamModel */
export function upstreamNameOf(model, providerId) {
  return model.upstreamModelByProvider?.[providerId] ?? model.upstreamModel
}

/** 按协议构造上游请求（url / headers / body / 流式标记）。upstreamName = 发给该供应商的模型名 */
export function buildUpstreamRequest(provider, model, bodyObj, stream, upstreamName) {
  const key = resolveProviderApiKey(provider)
  const proto = provider.protocol ?? 'openai'
  const base = provider.baseUrl.replace(/\/$/, '')
  if (proto === 'anthropic') {
    return {
      url: /\/v\d+$/.test(base) ? `${base}/messages` : `${base}/v1/messages`,
      headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      body: toAnthropicRequest(bodyObj, model),
      stream,
    }
  }
  if (proto === 'gemini') {
    const action = stream ? 'streamGenerateContent?alt=sse' : 'generateContent'
    const uname = upstreamName ?? upstreamNameOf(model, provider.id)
    return {
      url: /\/v\d+beta?$/.test(base) ? `${base}/models/${encodeURIComponent(uname)}:${action}` : `${base}/v1beta/models/${encodeURIComponent(uname)}:${action}`,
      headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
      body: toGeminiRequest(bodyObj, model),
      stream,
    }
  }
  return {
    url: `${base}/chat/completions`,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
    body: { ...bodyObj, model: upstreamName ?? upstreamNameOf(model, provider.id) },
    stream,
  }
}

/** Gemini generateContent 响应 → OpenAI chat.completion 形态（非流式） */
export function geminiToOpenAIResponse(j, upstreamModel) {
  const cand = j.candidates?.[0] ?? {}
  const parts = cand.content?.parts ?? []
  return {
    id: j.responseId ?? `gemini-${Date.now()}`,
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model: upstreamModel,
    choices: [{ index: 0, message: { role: 'assistant', content: parts.map((p) => p.text ?? '').join('') }, finish_reason: cand.finishReason === 'STOP' ? 'stop' : (cand.finishReason ?? 'stop').toLowerCase() }],
    usage: j.usageMetadata ? { prompt_tokens: j.usageMetadata.promptTokenCount ?? 0, completion_tokens: j.usageMetadata.candidatesTokenCount ?? 0, total_tokens: j.usageMetadata.totalTokenCount ?? 0 } : undefined,
  }
}

/** Anthropic /v1/messages 响应 → OpenAI chat.completion 形态（非流式） */
export function anthropicToOpenAIResponse(j, upstreamModel) {
  const text = (j.content ?? []).filter((c) => c.type === 'text').map((c) => c.text).join('')
  const think = (j.content ?? []).filter((c) => c.type === 'thinking').map((c) => c.thinking).join('')
  return {
    id: j.id ?? `anthropic-${Date.now()}`,
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model: upstreamModel,
    choices: [{ index: 0, message: { role: 'assistant', content: text, ...(think ? { reasoning_content: think } : {}) }, finish_reason: j.stop_reason === 'end_turn' ? 'stop' : (j.stop_reason ?? 'stop') }],
    usage: j.usage ? { prompt_tokens: j.usage.input_tokens ?? 0, completion_tokens: j.usage.output_tokens ?? 0, total_tokens: (j.usage.input_tokens ?? 0) + (j.usage.output_tokens ?? 0) } : undefined,
  }
}

/**
 * 转发 chat/completions 请求到上游（按 provider.protocol 适配，响应统一归一为 OpenAI 形态）。
 * 返回 { ok, response, model, provider, upstreamModel } 或 { ok:false, errors:[...] }
 */
export async function forwardWithFailover({ entModel, bodyObj, log }) {
  const errors = []
  let route = pickRoute(entModel)
  if (!route) {
    return { ok: false, errors: [`模型 ${entModel} 不存在、已下架或无可用供应商`] }
  }
  while (route) {
    const { model, provider } = route
    if (!resolveProviderApiKey(provider)) {
      errors.push(`${provider.id}: no api key (${provider.apiKeyEnv})`)
      route = failoverRoute(entModel, provider.id)
      continue
    }
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), provider.timeoutMs ?? 120000)
    const uname = upstreamNameOf(model, provider.id)
    try {
      applyThinking(bodyObj, model, { viaFallback: route.viaFallback === true })   // 容灾命中：忽略请求档位，按容灾侧模型默认档处理
      bodyObj.model = uname           // anthropic/gemini 转换器从 bodyObj.model 取名（openai 协议在 buildUpstreamRequest 已覆盖）
      if (route.viaFallback === true) delete bodyObj.reasoning_effort   // 容灾时转换器（anthropic/gemini）也按模型默认档：剥掉请求档位
      const stream = Boolean(bodyObj.stream)
      const req = buildUpstreamRequest(provider, model, bodyObj, stream, uname)
      const upstreamBody = JSON.stringify({ ...req.body, model: uname })
      const resp = await fetch(req.url, {
        method: 'POST',
        headers: req.headers,
        body: upstreamBody,
        signal: controller.signal,
      })
      if (resp.ok) {
        markProviderOk(provider.id)   // 请求成功：复位熔断（主家恢复，后续请求回主家）
        // 非流式 + 非 openai 协议：把响应归一为 OpenAI 形态（流式在 pumpSse 里逐事件归一）
        if (!stream && (provider.protocol === 'anthropic' || provider.protocol === 'gemini')) {
          const j = await resp.json().catch(() => ({}))
          const normalized = provider.protocol === 'gemini' ? geminiToOpenAIResponse(j, uname) : anthropicToOpenAIResponse(j, uname)
          const bodyOut = JSON.stringify(normalized)
          return {
            ok: true, model, provider, upstreamModel: uname,
            response: new Response(bodyOut, { status: 200, headers: { 'content-type': 'application/json' } }),
          }
        }
        return { ok: true, response: resp, model, provider, upstreamModel: uname }
      }
      const errText = await resp.text().catch(() => '')
      errors.push(`${provider.id}: HTTP ${resp.status} ${errText.slice(0, 160)}`)
      markProviderFail(provider.id)   // 失败即熔断 60s：后续请求 pickRoute 直接跳过主家，不再反复吃失败
      log?.(`上游 ${provider.id} 失败 ${resp.status}，尝试容灾…`)
      route = failoverRoute(entModel, provider.id)
    } catch (e) {
      errors.push(`${provider.id}: ${String(e?.cause?.message ?? e.message).slice(0, 160)}`)
      markProviderFail(provider.id)   // 超时/连接异常同样熔断
      log?.(`上游 ${provider.id} 异常，尝试容灾…`)
      route = failoverRoute(entModel, provider.id)
    } finally {
      clearTimeout(timer)
    }
  }
  return { ok: false, errors }
}

/** 透传 SSE 流：从 fetch Response.body 泵到 Node res，同时收集 usage。
 *  非 openai 协议（anthropic/gemini）在泵出前把每个事件归一为 OpenAI chunk 形态，
 *  下游审计/计费/客户端看到的永远是同一种方言。
 *  collectOnly=true：不写 res、不 writeHead——只解析采集并在 onChunk 吐归一后的 data 行，
 *  供 /v1/responses 等需要自行组装响应方言的端点复用（调用方负责 writeHead/end）。 */
export async function pumpSse(upstreamBody, res, { onChunk, protocol = 'openai', upstreamModel = '', collectOnly = false } = {}) {
  if (!collectOnly) {
    res.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    })
  }
  let usage = null
  let firstTokenMs = null
  let responseText = ''
  let reasoningText = ''
  // 工具调用采集：按 index 分组拼装（模型决定调用工具时 content 为空，留痕不能因此空白）
  const toolCalls = new Map()   // index → { name, args }
  const start = Date.now()
  let sseBuf = ''
  const reader = upstreamBody.getReader()
  const decoder = new TextDecoder()
  const extractDelta = (obj) => {
    const d = obj.choices?.[0]?.delta
    if (!d) return
    if (typeof d.content === 'string') responseText += d.content
    if (typeof d.reasoning_content === 'string') reasoningText += d.reasoning_content
    if (typeof d.reasoning === 'string') reasoningText += d.reasoning
    if (Array.isArray(d.tool_calls)) {
      for (const tc of d.tool_calls) {
        const idx = tc.index ?? 0
        const cur = toolCalls.get(idx) ?? { name: '', args: '' }
        if (tc.function?.name) cur.name += tc.function.name
        if (typeof tc.function?.arguments === 'string') cur.args += tc.function.arguments
        toolCalls.set(idx, cur)
      }
    }
  }
  // —— anthropic 事件 → OpenAI chunk（消息级增量） ——
  const anthropicChunk = (j) => {
    if (j.type === 'content_block_delta') {
      const d = j.delta ?? {}
      if (d.type === 'text_delta') return { choices: [{ index: 0, delta: { content: d.text ?? '' } }] }
      if (d.type === 'thinking_delta') return { choices: [{ index: 0, delta: { reasoning_content: d.thinking ?? '' } }] }
      return null
    }
    if (j.type === 'message_start' && j.message?.usage) return { usage: normalizeAnthrUsage(j.message.usage), choices: [{ index: 0, delta: { role: 'assistant' } }] }
    if (j.type === 'message_delta' && j.usage) return { usage: normalizeAnthrUsage(j.usage) }
    if (j.type === 'message_stop') return { choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] }
    return null
  }
  const normalizeAnthrUsage = (u) => ({ prompt_tokens: u.input_tokens ?? 0, completion_tokens: u.output_tokens ?? 0, total_tokens: (u.input_tokens ?? 0) + (u.output_tokens ?? 0) })
  // —— gemini 事件 → OpenAI chunk ——
  const geminiChunk = (j) => {
    const cand = j.candidates?.[0]
    const parts = cand?.content?.parts ?? []
    const delta = {}
    for (const p of parts) {
      if (p.text != null) delta.content = (delta.content ?? '') + p.text
    }
    if (j.usageMetadata) usage = { prompt_tokens: j.usageMetadata.promptTokenCount ?? 0, completion_tokens: j.usageMetadata.candidatesTokenCount ?? 0, total_tokens: j.usageMetadata.totalTokenCount ?? 0 }
    if (!Object.keys(delta).length && !usage) return null
    return { choices: [{ index: 0, delta }] }
  }
  const normalizeEvent = (j) => {
    if (protocol === 'anthropic') return anthropicChunk(j)
    if (protocol === 'gemini') return geminiChunk(j)
    return j
  }
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      if (firstTokenMs === null) firstTokenMs = Date.now() - start
      const chunk = decoder.decode(value, { stream: true })
      // SSE 事件可能跨 TCP 分片，先攒缓冲再按完整事件解析
      sseBuf += chunk
      const lines = sseBuf.split('\n')
      sseBuf = lines.pop() ?? ''
      for (const line of lines) {
        const t = line.trim()
        if (!t.startsWith('data:')) continue
        const payload = t.slice(5).trim()
        if (!payload || payload === '[DONE]') continue
        try {
          const j = JSON.parse(payload)
          if (protocol === 'openai' && j.usage && j.usage.total_tokens) usage = j.usage
          extractDelta(j)   // 留痕采集始终按 OpenAI 形态读
          const norm = normalizeEvent(j)
          if (norm && protocol !== 'openai') {
            // 归一后的 chunk 里带出 usage（gemini 在事件里塞了）
            if (norm.usage && norm.usage.total_tokens) usage = norm.usage
            if (!collectOnly) res.write(`data: ${JSON.stringify(norm)}\n\n`)
            onChunk?.(`data: ${JSON.stringify(norm)}\n\n`)
          } else if (protocol !== 'openai') {
            // 无法归一的事件丢弃（不上送下游），留痕已采集
          } else if (collectOnly) {
            // collectOnly：openai 原始块也走 onChunk（按行喂，调用方自行解析）
            onChunk?.(`data: ${payload}\n\n`)
          } else {
            onChunk?.(chunk)
          }
        } catch { /* ignore */ }
      }
      if (protocol === 'openai' && !collectOnly) {
        res.write(value)
      }
    }
    if (protocol !== 'openai') {
      // 归一协议：缓冲里可能还有最后半条事件
      const tail = sseBuf.trim()
      if (tail.startsWith('data:')) {
        const payload = tail.slice(5).trim()
        if (payload && payload !== '[DONE]') {
          try {
            const norm = normalizeEvent(JSON.parse(payload))
            if (norm) {
              if (norm.usage && norm.usage.total_tokens) usage = norm.usage
              if (!collectOnly) res.write(`data: ${JSON.stringify(norm)}\n\n`)
              else onChunk?.(`data: ${JSON.stringify(norm)}\n\n`)
            }
          } catch { /* ignore */ }
        }
      }
      if (!collectOnly) res.write('data: [DONE]\n\n')
    }
  } finally {
    if (!collectOnly) res.end()
  }
  // 工具调用 → 可读文本附加到留痕 response：content 为空时它就是这一轮的全部输出
  if (toolCalls.size) {
    const toolTxt = [...toolCalls.values()]
      .map((t) => `[调用工具 ${t.name || '?'}] ${t.args}`)
      .join('\n')
    responseText = responseText ? responseText + '\n\n' + toolTxt : toolTxt
  }
  return { usage, firstTokenMs, durationMs: Date.now() - start, responseText, reasoningText }
}
