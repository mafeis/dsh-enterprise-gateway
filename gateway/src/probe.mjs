/**
 * 企业网关 · 上游探活模块
 * 从 config.mjs 拆出：供应商连通测试 + 模型思考能力探针（单模型 / 逐档位 / 全量）
 * 只依赖 config 的读接口（getConfig / resolveProviderApiKey），不做任何配置写入
 */
import { getConfig, resolveProviderApiKey } from './config.mjs'
import { buildUpstreamRequest, geminiToOpenAIResponse, anthropicToOpenAIResponse } from './upstream.mjs'

/* 探针素材：16×16 纯红 PNG（识图判定：问颜色看答案）+ 0.4s 纯红 MP4（视频判定：同样问颜色） */
const TINY_PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAAFklEQVR4nGN4YaVFEmIY1TCqYfhqAAA+40wQZGzHhQAAAABJRU5ErkJggg=='
const TINY_MP4_B64 = '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'

/** 供应商连通测试：打上游 /models（anthropic /v1/models · gemini /v1beta/models），带模型元数据 */
export async function testProvider(id) {
  const prov = getConfig().providers.find((x) => x.id === id)
  if (!prov) return { ok: false, error: '供应商不存在' }
  const key = resolveProviderApiKey(prov)
  if (!key) return { ok: false, error: '未配置密钥（apiKeyEnv 环境变量或 apiKey）' }
  const started = Date.now()
  const proto = prov.protocol ?? 'openai'
  const base = prov.baseUrl.replace(/\/$/, '')
  const { url, headers } = proto === 'anthropic'
    ? { url: /\/v\d+$/.test(base) ? `${base}/models` : `${base}/v1/models`, headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' } }
    : proto === 'gemini'
      ? { url: /\/v\d+beta?$/.test(base) ? `${base}/models` : `${base}/v1beta/models`, headers: { 'x-goog-api-key': key } }
      : { url: `${base}/models`, headers: { authorization: `Bearer ${key}` } }
  try {
    const ac = new AbortController()
    const timer = setTimeout(() => ac.abort(), 8000)
    const r = await fetch(url, { headers, signal: ac.signal })
    clearTimeout(timer)
    const ms = Date.now() - started
    if (!r.ok) return { ok: false, error: `上游 HTTP ${r.status}`, ms }
    const body = await r.json().catch(() => ({}))
    // 统一抽平：openai {data:[…]} · anthropic {data:[…]} · gemini {models:[{name:"models/x",…}]}
    const rawList = proto === 'gemini' ? (body.models ?? []).map((m) => ({ id: String(m.name ?? '').replace(/^models\//, ''), ...m })) : (body.data ?? [])
    // 上游条目可能是字符串或对象（OpenRouter 等带元数据）；统一抽平
    const details = rawList
      .filter(Boolean)
      .map((m) => (typeof m === 'string' ? { id: m } : {
        id: m.id,
        context_length: m.context_length ?? m.context_window ?? m.max_model_len ?? m.input_token_limit ?? null,
        supported_parameters: m.supported_parameters ?? null,
        input_modalities: m.architecture?.input_modalities ?? m.supported_input_modalities ?? m.supportedGenerationMethods ?? null,
        owned_by: m.owned_by ?? m.display_name ?? m.displayName ?? null,
      }))
      .filter((m) => m.id)
    return { ok: true, ms, upstreamModels: details.map((m) => m.id), modelDetails: details }
  } catch (e) {
    return { ok: false, error: e.name === 'AbortError' ? '连接超时（8s）' : String(e).slice(0, 200), ms: Date.now() - started }
  }
}

/** 单模型思考能力探针：发一条最小请求（reasoning_effort=high），按真实响应判断思考支持
 *  - HTTP 400 且报文提到 reasoning/effort → 上游明确拒绝该参数（不支持思考）
 *  - 响应含 reasoning_tokens（或 reasoning_content）> 0 → 真思考
 *  - 200 但无思考痕迹 → 参数被静默忽略（不可信，标"未观察到思考"）
 */
export async function probeProviderModel(id, upstreamModel) {
  const prov = getConfig().providers.find((x) => x.id === id)
  if (!prov) return { ok: false, error: '供应商不存在' }
  const key = resolveProviderApiKey(prov)
  if (!key) return { ok: false, error: '未配置密钥' }
  const started = Date.now()
  try {
    const ac = new AbortController()
    const timer = setTimeout(() => ac.abort(), 30000)
    const r = await fetch(prov.baseUrl.replace(/\/$/, '') + '/chat/completions', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: upstreamModel,
        messages: [{ role: 'user', content: '1+1=?' }],
        max_tokens: 512,
        reasoning_effort: 'high',
      }),
      signal: ac.signal,
    })
    clearTimeout(timer)
    const ms = Date.now() - started
    if (!r.ok) {
      const errText = await r.text().catch(() => '')
      const lowered = errText.toLowerCase()
      if (r.status === 400 && (lowered.includes('reasoning') || lowered.includes('effort'))) {
        return { ok: true, model: upstreamModel, thinking: 'rejected', verdict: '上游拒绝 reasoning_effort 参数 → 不支持思考档位', ms }
      }
      if (r.status === 404) return { ok: true, model: upstreamModel, thinking: 'unavailable', verdict: '模型不存在（HTTP 404）', ms }
      return { ok: true, model: upstreamModel, thinking: 'unavailable', verdict: `HTTP ${r.status} · ${errText.slice(0, 120)}`, ms }
    }
    const body = await r.json().catch(() => ({}))
    const rt = body.usage?.completion_tokens_details?.reasoning_tokens ?? 0
    // 思考痕迹字段兼容：reasoning_content（DeepSeek/OpenAI 系）/ reasoning（GLM 系中转）/ reasoning_text
    const msg = body.choices?.[0]?.message ?? {}
    const hasRc = Boolean(msg.reasoning_content || msg.reasoning || msg.reasoning_text)
    const hasReasoning = rt > 0 || hasRc
    return {
      ok: true,
      model: upstreamModel,
      thinking: hasReasoning ? 'real' : 'silent',
      verdict: hasReasoning
        ? `✓ 真思考（reasoning ${rt || 'content'} tokens）→ 支持思考档位`
        : '⚠ 请求成功但未观察到思考输出（参数可能被忽略）',
      ms,
      reasoningTokens: rt,
      latencyMs: ms,
    }
  } catch (e) {
    return { ok: false, model: upstreamModel, error: e.name === 'AbortError' ? '探针超时（30s）' : String(e).slice(0, 160) }
  }
}

/**
 * 逐档位探测一个上游模型：把我们的思考档位（off/low/medium/high）真实发送，
 * 每档记录：是否被接受 / 是否产生思考输出 / 延迟——完整还原"这套档位上游支持不支持"
 *
 * 小代价高精度原则（判定只看 reasoning 计数/字段，不需要完整答案）：
 *  - max_tokens 压到 200（off 档 128）：思考痕迹在推理一开始就会计数/出现在字段里，
 *    截断不影响判定，单条请求 token 消耗从最多 2048 降到 ≤200
 *  - 档位独立判定：每档单独发小请求、单独下结论；最高档被"参数拒绝"不代表低档不支持
 *    （如 xhigh 被拒但 low/medium 正常），只有"模型不存在"才说明整批无意义
 *  - 并行：全部档位并行发送，墙钟 ≈ 一条短请求
 *  - 上游拒绝小输出上限（400 且报文提 token）→ 阶梯回退 200→1024→2048 重试，
 *    并按供应商记住可用下限（进程内 memo），后续探测直接用合适档位，不再重复被拒
 */

/** 供应商 → 实测可用的输出上限（进程内记忆，避免每次探测重复踩 400） */
const providerCapMemo = new Map()

export async function probeProviderModelLevels(id, upstreamModel, levels = ['off', 'low', 'medium', 'high'], opts = {}) {
  const { maxTokens = null, levelParams = null } = opts   // maxTokens：外部覆盖输出上限；levelParams：档位 → 注入参数（自定义档位按真实参数测）
  const BASE_THINK_CAP = maxTokens ?? providerCapMemo.get(id) ?? 200
  const BASE_OFF_CAP = maxTokens ? Math.min(maxTokens, 256) : 128
  const prov = getConfig().providers.find((x) => x.id === id)
  if (!prov) return { ok: false, error: '供应商不存在' }
  const key = resolveProviderApiKey(prov)
  if (!key) return { ok: false, error: '未配置密钥' }
  const sendOne = async (level, capOverride = null) => {
    const started = Date.now()
    const cap = capOverride ?? (level === 'off' ? BASE_OFF_CAP : BASE_THINK_CAP)
    const proto = prov.protocol ?? 'openai'
    try {
      const ac = new AbortController()
      const timer = setTimeout(() => ac.abort(), 25000)
      const bodyObj = {
        messages: [{ role: 'user', content: '甲乙丙三人，一人只说真话，一人只说假话，一人有时真有时假。甲说：乙是说谎者。乙说：丙是说谎者。丙说：甲和乙都是说谎者。谁是真话者？' }],
        max_tokens: cap,
      }
      const custom = levelParams?.[level]
      if (custom && typeof custom === 'object') {
        // 自定义档位：按模型维护的真实注入参数发（与 upstream.mjs applyThinking 同语义）
        Object.assign(bodyObj, structuredClone(custom))
      } else {
        // 默认双风格兼容：GLM/Zhipu 系认 thinking 开关，OpenAI 系认 reasoning_effort 档位——都发，测出的是"这模型在我们网关双注入下"的真实表现
        bodyObj.thinking = { type: level === 'off' ? 'disabled' : 'enabled' }
        if (level !== 'off') bodyObj.reasoning_effort = level
      }
      // 按供应商协议构造请求（复用 upstream.mjs 的转换器；模型配置由探测上下文的最小模型对象承载）
      bodyObj.model = upstreamModel
      const modelCtx = { upstreamModel, thinking: 'optional', defaultThinking: level, thinkingParams: levelParams ?? {} }
      const req = buildUpstreamRequest(prov, modelCtx, bodyObj, false)
      const r = await fetch(req.url, {
        method: 'POST',
        headers: req.headers,
        body: JSON.stringify(req.body),
        signal: ac.signal,
      })
      clearTimeout(timer)
      const ms = Date.now() - started
      if (!r.ok) {
        const errText = await r.text().catch(() => '')
        const lowered = errText.toLowerCase()
        if (r.status === 400 && (lowered.includes('reasoning') || lowered.includes('effort') || lowered.includes('thinking'))) {
          return { level, accepted: false, thought: false, ms, note: '参数被拒' }
        }
        if (r.status === 404 || (r.status === 503 && lowered.includes('model'))) {
          return { level, accepted: false, thought: false, ms, note: '模型不存在/无渠道', modelMissing: true }
        }
        return { level, accepted: false, thought: false, ms, note: `HTTP ${r.status} · ${errText.slice(0, 80)}` }
      }
      const body = await r.json().catch(() => ({}))
      // 非 openai 协议：响应先归一为 OpenAI 形态再判定（复用 upstream.mjs 转换器）
      let norm = body
      if (proto === 'gemini' && body.candidates) norm = geminiToOpenAIResponse(body, upstreamModel)
      else if (proto === 'anthropic' && body.content) norm = anthropicToOpenAIResponse(body, upstreamModel)
      const rt = norm.usage?.completion_tokens_details?.reasoning_tokens ?? norm.usage?.completion_tokens ?? 0
      // 思考痕迹字段兼容：reasoning_content（DeepSeek/OpenAI 系）/ reasoning（GLM 系中转）/ reasoning_text
      const msg = norm.choices?.[0]?.message ?? {}
      const hasRc = Boolean(msg.reasoning_content || msg.reasoning || msg.reasoning_text)
      return { level, accepted: true, thought: rt > 0 || hasRc, reasoningTokens: rt, ms, cap }
    } catch (e) {
      return { level, accepted: false, thought: false, ms: Date.now() - started, note: e.name === 'AbortError' ? '超时(25s)' : String(e).slice(0, 80) }
    }
  }
  const results = new Map()
  const offLevels = levels.filter((l) => l === 'off')
  const thinkLevels = levels.filter((l) => l !== 'off')
  if (thinkLevels.length) {
    // off 独立于思考档结论，先行并行
    const offRes = await Promise.all(offLevels.map((l) => sendOne(l)))
    offLevels.forEach((l, i) => results.set(l, offRes[i]))
    // 模型存在性哨兵 = 请求列表里最高（最后出现）的思考档；仅当"模型不存在"才跳过其余档——
    // "参数被拒"只说明该档位上游不认，低档位（low/medium…）完全可能支持，必须照测
    const sentinel = thinkLevels[thinkLevels.length - 1]
    let s = await sendOne(sentinel)
    // 小输出上限被上游拒绝（400 且报文提 token）→ 阶梯回退 1024 → 2048，找到可用下限后按供应商记住
    const capRejected = (x) => !x.accepted && /HTTP 400/.test(x.note ?? '') && /token/i.test(x.note ?? '')
    if (capRejected(s)) {
      for (const step of [1024, 2048]) {
        s = await sendOne(sentinel, step)
        if (!capRejected(s)) {
          if (!maxTokens) providerCapMemo.set(id, step)   // 记住该供应商的可用下限，后续探测不再踩 400
          s.note = `输出上限回退至 ${step}（上游要求更大的 max_tokens）`
          break
        }
      }
    } else if (s.accepted && !maxTokens && !providerCapMemo.has(id) && BASE_THINK_CAP !== 200) {
      providerCapMemo.set(id, BASE_THINK_CAP)   // 首次成功也固化基线，保证同一供应商行为一致
    }
    results.set(sentinel, s)
    const rest = thinkLevels.filter((l) => l !== sentinel)
    if (rest.length) {
      // 其余档位照常并行实测：每档独立判定，互不因其他档被拒而跳过
      const restRes = await Promise.all(rest.map((l) => sendOne(l)))
      rest.forEach((l, i) => results.set(l, restRes[i]))
    }
  } else {
    for (const l of offLevels) results.set(l, await sendOne(l))
  }
  const levelResults = levels.map((l) => results.get(l)).filter(Boolean)
  const anyAccepted = levelResults.some((x) => x.accepted)
  const thoughtLevels = levelResults.filter((x) => x.accepted && x.thought).map((x) => x.level)
  const missingModel = levelResults.some((x) => x.modelMissing)
  const offOk = levelResults.find((x) => x.level === 'off')
  return {
    ok: true,
    model: upstreamModel,
    available: anyAccepted && !missingModel,
    levels: levelResults,
    supportedThinking: thoughtLevels, // 实测产生思考输出的档位
    supportsThinkingSwitch: Boolean(offOk?.accepted && !offOk.thought) && thoughtLevels.length > 0, // off 无思考 + 有档位有思考 = 开关有效
    recommendation: missingModel
      ? 'unavailable'
      : !anyAccepted
        ? 'rejected'
        : thoughtLevels.length === 0
          ? 'silent'
          : 'real',
  }
}

/**
 * 单模型多模态探针：与思考档位探测并列的「图片/视频支持」实测
 *  - 图片：发一条带 16×16 纯红 PNG 的最小多模态请求，问"图里是什么颜色"
 *      · 400/422 且报文提到 image/vision/multimodal/content → 上游拒绝图片输入（不支持）
 *      · 200 且回答命中"红/red" → 真识图（图片输入真实生效）
 *      · 200 但答非所问 → 接受图片但无法确认识别（可能被静默剥离，建议会话里再验证）
 *  - 视频：发一条 video_url（data:video/mp4 单帧纯红小视频）问颜色，判「格式接不接受 + 能否识别」
 *      · 400/422 提到 video/image/content → 不支持视频输入
 *      · 200 且回答命中红色 → 真视频理解；200 未命中 → 接受格式但识别未确认
 */
export async function probeProviderModelModal(id, upstreamModel) {
  const prov = getConfig().providers.find((x) => x.id === id)
  if (!prov) return { ok: false, error: '供应商不存在' }
  const key = resolveProviderApiKey(prov)
  if (!key) return { ok: false, error: '未配置密钥' }

  /** 发一条 content-parts 请求，返回统一分类结果 */
  const sendParts = async (part, question) => {
    const started = Date.now()
    try {
      const ac = new AbortController()
      const timer = setTimeout(() => ac.abort(), 30000)
      const r = await fetch(prov.baseUrl.replace(/\/$/, '') + '/chat/completions', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
        body: JSON.stringify({
          model: upstreamModel,
          messages: [{ role: 'user', content: [{ type: 'text', text: question }, part] }],
          max_tokens: 256,   // 思考型模型可能先烧一段思考再答颜色词，给足余量
        }),
        signal: ac.signal,
      })
      clearTimeout(timer)
      const ms = Date.now() - started
      if (!r.ok) {
        const errText = (await r.text().catch(() => '')).toLowerCase()
        if (r.status === 404 || (r.status === 503 && errText.includes('model'))) {
          return { status: 'unavailable', supported: false, verdict: '模型不存在/无渠道', ms, modelMissing: true }
        }
        // 拒绝判定：报文提到多模态相关词才算「明确不支持」，其余按普通报错透出
        const rejected = (r.status === 400 || r.status === 422) &&
          /image|vision|multimodal|modalit|video|content|unsupport|not support/.test(errText)
        return rejected
          ? { status: 'rejected', supported: false, verdict: `上游拒绝该输入（HTTP ${r.status} · ${errText.slice(0, 80)}）→ 不支持`, ms }
          : { status: 'error', supported: false, verdict: `HTTP ${r.status} · ${errText.slice(0, 100)}`, ms }
      }
      const body = await r.json().catch(() => ({}))
      const answer = String(body.choices?.[0]?.message?.content ?? '').slice(0, 120)
      const hit = /红|red/i.test(answer)
      return hit
        ? { status: 'real', supported: true, verdict: '✓ 正确答出纯红素材 → 真实支持', ms, answer }
        : { status: 'accepted', supported: true, verdict: '△ 接受该输入但未答对颜色（可能被静默剥离），会话里再验证', ms, answer }
    } catch (e) {
      return { status: 'error', supported: false, verdict: e.name === 'AbortError' ? '探针超时（30s）' : String(e).slice(0, 100), ms: Date.now() - started }
    }
  }

  const started = Date.now()
  // 两条独立请求串行（同模型并发易触发上游限流），各自 30s 上限
  const image = await sendParts(
    { type: 'image_url', image_url: { url: 'data:image/png;base64,' + TINY_PNG_B64 } },
    '这张图里是什么颜色？只回答颜色词。',
  )
  const video = image.modelMissing
    ? { status: 'unavailable', supported: false, verdict: '模型不存在（跳过）', ms: 0 }
    : await sendParts(
        { type: 'video_url', video_url: { url: 'data:video/mp4;base64,' + TINY_MP4_B64 } },
        '这段视频是什么颜色？只回答颜色词。',
      )
  return {
    ok: true,
    model: upstreamModel,
    ms: Date.now() - started,
    modalities: { image, video },
  }
}

/**
 * 全量探测一个供应商：拉上游 /models 列出全部模型，然后并发快速探针每个模型
 * （off+high 两档快速判定）；逐模型完整档位测试由 /probe-levels 按需执行
 */
export async function probeProviderAll(id) {
  const prov = getConfig().providers.find((x) => x.id === id)
  if (!prov) return { ok: false, error: '供应商不存在' }
  const key = resolveProviderApiKey(prov)
  if (!key) return { ok: false, error: '未配置密钥' }
  // 1. 拉上游模型目录
  const started = Date.now()
  let models = []
  const proto = prov.protocol ?? 'openai'
  const base = prov.baseUrl.replace(/\/$/, '')
  const { url: modelsUrl, headers: modelsHeaders } = proto === 'anthropic'
    ? { url: /\/v\d+$/.test(base) ? `${base}/models` : `${base}/v1/models`, headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' } }
    : proto === 'gemini'
      ? { url: /\/v\d+beta?$/.test(base) ? `${base}/models` : `${base}/v1beta/models`, headers: { 'x-goog-api-key': key } }
      : { url: `${base}/models`, headers: { authorization: `Bearer ${key}` } }
  try {
    const ac = new AbortController()
    const timer = setTimeout(() => ac.abort(), 15000)
    const r = await fetch(modelsUrl, { headers: modelsHeaders, signal: ac.signal })
    clearTimeout(timer)
    if (!r.ok) return { ok: false, error: `上游 /models HTTP ${r.status}` }
    const body = await r.json().catch(() => ({}))
    const rawList = proto === 'gemini' ? (body.models ?? []).map((m) => ({ id: String(m.name ?? '').replace(/^models\//, ''), ...m })) : (body.data ?? [])
    models = rawList.map((m) => ({
      id: m.id,
      context_length: m.context_length ?? m.input_token_limit ?? null,
      supported_parameters: m.supported_parameters ?? null,
      input_modalities: m.architecture?.input_modalities ?? m.supported_input_modalities ?? null,
      owned_by: m.owned_by ?? m.display_name ?? '',
    }))
  } catch (e) {
    return { ok: false, error: e.name === 'AbortError' ? '上游 /models 超时（15s）' : String(e).slice(0, 160) }
  }
  if (!models.length) return { ok: true, ms: Date.now() - started, modelDetails: [], results: [], verdict: '上游目录为空' }
  // 2. 快速探针（off+high 两档）：内部已是哨兵+并行+小输出上限（判定只看 reasoning 计数），
  //    这里再把上限统一压到 200，把单模型探测墙钟和 token 消耗压到最低
  const quickProbe = async (m) => {
    const lv = await probeProviderModelLevels(id, m.id, ['off', 'high'], { maxTokens: 200 })
    return {
      id: m.id,
      owned_by: m.owned_by,
      context_length: m.context_length,
      supported_parameters: m.supported_parameters,
      input_modalities: m.input_modalities ?? null,
      ok: lv.available,
      thinking: lv.recommendation,
      verdict: lv.recommendation === 'real' ? '✓ 支持思考开关（off/high 实测）'
        : lv.recommendation === 'rejected' ? '⛔ 模型不可用'
        : lv.recommendation === 'silent' ? '△ 请求成功但无思考输出'
        : '✗ 不可用',
      ms: Math.max(...lv.levels.map((x) => x.ms)),
      supportedThinking: lv.supportedThinking,
    }
  }
  const results = []
  const queue = [...models]
  await Promise.all(Array.from({ length: Math.min(4, queue.length) }, async () => {
    while (queue.length) {
      const m = queue.shift()
      if (!m) break
      results.push(await quickProbe(m))
    }
  }))
  results.sort((a, b) => a.id.localeCompare(b.id))
  const okCount = results.filter((x) => x.ok).length
  const realCount = results.filter((x) => x.thinking === 'real').length
  return {
    ok: true,
    ms: Date.now() - started,
    upstreamModels: models.map((m) => m.id),
    modelDetails: models,
    results,
    verdict: `共 ${results.length} 个模型 · 可用 ${okCount} · 支持思考 ${realCount}`,
  }
}
