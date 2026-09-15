#!/usr/bin/env node
/**
 * 多模态探针端到端检查（无 npm 依赖）：起 mock 上游 + 真实网关 → 验证思考档位探测合并图片/视频实测
 *   1. mock 上游：vision-model（图片/视频都答"红色"）、novideo-model（视频 400 拒绝）
 *   2. POST /admin/providers/:id/probe-levels → levels + modalities（image/video 状态）一次出齐
 *   3. POST /admin/providers/:id/probe → 单探针也带 modalities
 *   4. POST /admin/providers/:id/apply-probe → inputModes 按实测落进企业模型
 * 用法：node scripts/modal-probe-check.mjs
 */
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { createServer } from 'node:net'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
let failed = false
const ok = (m) => console.log('✓ ' + m)
const bad = (m, d) => { failed = true; console.error(`✗ ${m}\n  ${d}`) }
const assert = (cond, m, d) => (cond ? ok(m) : bad(m, d))

function freePort() {
  return new Promise((resolve, reject) => {
    const s = createServer()
    s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)) })
    s.on('error', reject)
  })
}

/** mock 上游：/v1/models + /v1/chat/completions（多模态按 content-parts 类型分流） */
import http from 'node:http'
let lastChatBody = null      // mock 记录最近一条 chat/completions 请求体（验证档位注入参数）
let chatBodies = []          // 全量记录（逐档探测与多模态探测并行，单看 last 有竞态）
function startMockUpstream() {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      let raw = ''
      req.on('data', (c) => { raw += c })
      req.on('end', () => {
        if (req.method === 'GET' && req.url.endsWith('/models')) {
          res.writeHead(200, { 'content-type': 'application/json' })
          if (req.headers['x-goog-api-key']) {
            // gemini 形态
            res.end(JSON.stringify({ models: [
              { name: 'models/gemini-mock', displayName: 'Gemini Mock', input_token_limit: 1000000, supportedGenerationMethods: ['generateContent'] },
            ] }))
            return
          }
          if (req.headers['x-api-key']) {
            // anthropic 形态
            res.end(JSON.stringify({ data: [{ id: 'claude-mock', display_name: 'Claude Mock' }] }))
            return
          }
          res.end(JSON.stringify({ data: [
            { id: 'vision-model', architecture: { input_modalities: ['text', 'image', 'video'] } },
            { id: 'novideo-model', architecture: { input_modalities: ['text', 'image'] } },
            { id: 'rejectparam-model', architecture: { input_modalities: ['text'] } },
          ] }))
          return
        }
        if (req.method === 'GET' && req.url.endsWith('/last-body')) {
          res.writeHead(200, { 'content-type': 'application/json' })
          res.end(JSON.stringify(lastChatBody ?? {}))
          return
        }
        if (req.method === 'GET' && req.url.endsWith('/bodies')) {
          res.writeHead(200, { 'content-type': 'application/json' })
          res.end(JSON.stringify(chatBodies))
          return
        }
        if (req.method === 'GET' && req.url.endsWith('/reset-bodies')) {
          chatBodies = []
          res.writeHead(200, { 'content-type': 'application/json' })
          res.end('{"ok":true}')
          return
        }
        if (req.method === 'POST' && req.url.endsWith('/v1/messages')) {
          // anthropic messages：system 分离 + thinking budget 注入
          const b = JSON.parse(raw || '{}')
          lastChatBody = b
          chatBodies.push(b)
          const thinkOn = Boolean(b.thinking?.type === 'enabled')
          res.writeHead(200, { 'content-type': 'application/json' })
          res.end(JSON.stringify({
            id: 'msg_mock',
            type: 'message',
            role: 'assistant',
            content: thinkOn
              ? [{ type: 'thinking', thinking: '推理中…' }, { type: 'text', text: '真话者是乙。' }]
              : [{ type: 'text', text: '真话者是乙。' }],
            stop_reason: 'end_turn',
            usage: { input_tokens: 10, output_tokens: thinkOn ? 20 : 5 },
          }))
          return
        }
        if (req.method === 'POST' && (req.url.includes(':generateContent') || req.url.includes(':streamGenerateContent'))) {
          // gemini generateContent：thinkingConfig.thinkingBudget 注入
          const b = JSON.parse(raw || '{}')
          lastChatBody = b
          chatBodies.push(b)
          const budget = b.generationConfig?.thinkingConfig?.thinkingBudget ?? 0
          res.writeHead(200, { 'content-type': 'application/json' })
          res.end(JSON.stringify({
            responseId: 'resp_mock',
            candidates: [{ content: { parts: [{ text: '真话者是乙。' }] }, finishReason: 'STOP' }],
            usageMetadata: { promptTokenCount: 10, candidatesTokenCount: budget > 0 ? 20 : 5, totalTokenCount: budget > 0 ? 30 : 15 },
          }))
          return
        }
        if (req.method === 'POST' && req.url.endsWith('/chat/completions')) {
          const b = JSON.parse(raw || '{}')
          lastChatBody = b
          chatBodies.push(b)
          const parts = Array.isArray(b.messages?.[0]?.content) ? b.messages[0].content : []
          const hasImg = parts.some((p) => p.type === 'image_url')
          const hasVid = parts.some((p) => p.type === 'video_url')
          if (String(b.model).includes('rejectparam') && ['medium', 'high'].includes(b.reasoning_effort)) {
            // 模拟上游只支持 low 档：medium/high 拒参，low 照常工作（验证每档独立判定）
            res.writeHead(400, { 'content-type': 'application/json' })
            res.end(JSON.stringify({ error: { message: `reasoning_effort '${b.reasoning_effort}' is not supported by this model` } }))
            return
          }
          if (hasVid && String(b.model).includes('novideo')) {
            res.writeHead(400, { 'content-type': 'application/json' })
            res.end(JSON.stringify({ error: { message: 'video content is not supported by this model' } }))
            return
          }
          const multimodal = hasImg || hasVid
          if (b.stream === true) {
            // 流式 mock：OpenAI delta 分片 + usage + [DONE]
            const text = multimodal ? '红色' : '真话者是乙。'
            res.writeHead(200, { 'content-type': 'text/event-stream' })
            res.write(`data: ${JSON.stringify({ choices: [{ delta: { role: 'assistant', content: '' } }] })}\n\n`)
            for (const ch of text) res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: ch } }] })}\n\n`)
            res.write(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 5, completion_tokens: 6, total_tokens: 11 } })}\n\n`)
            res.write('data: [DONE]\n\n')
            res.end()
            return
          }
          res.writeHead(200, { 'content-type': 'application/json' })
          res.end(JSON.stringify({
            choices: [{ message: { role: 'assistant', content: multimodal ? '红色' : '真话者是乙。' } }],
            usage: { completion_tokens_details: { reasoning_tokens: !multimodal && b.reasoning_effort ? 7 : 0 } },
          }))
          return
        }
        res.writeHead(404, { 'content-type': 'application/json' })
        res.end('{}')
      })
    })
    srv.listen(0, '127.0.0.1', () => resolve({ srv, port: srv.address().port }))
  })
}

async function main() {
  const mock = await startMockUpstream()
  const dataDir = mkdtempSync(join(tmpdir(), 'dsh-gw-modal-'))
  // 配置：以 example 为底，换掉 providers/models 指向 mock
  const cfg = JSON.parse(readFileSync(join(root, 'gateway-config.example.json'), 'utf8'))
  cfg.providers = [
    { id: 'mock', name: 'mock', baseUrl: `http://127.0.0.1:${mock.port}/v1`, apiKey: 'sk-test-mock', timeoutMs: 20000, weight: 10, enabled: true },
    { id: 'mock-anthropic', name: 'mock-anthropic', protocol: 'anthropic', baseUrl: `http://127.0.0.1:${mock.port}`, apiKey: 'sk-ant-mock', timeoutMs: 20000, weight: 10, enabled: true },
    { id: 'mock-gemini', name: 'mock-gemini', protocol: 'gemini', baseUrl: `http://127.0.0.1:${mock.port}`, apiKey: 'gk-mock', timeoutMs: 20000, weight: 10, enabled: true },
  ]
  cfg.models = []
  cfg.probe = { thinkingLevels: ['off', 'high'] }   // 配置只测两档：验证档位可配置且生效
  const cfgPath = join(dataDir, 'gateway-config.json')
  writeFileSync(cfgPath, JSON.stringify(cfg))

  const port = await freePort()
  const child = spawn(process.execPath, [join(root, 'gateway.mjs')], {
    env: { ...process.env, PORT: String(port), ENT_DATA_DIR: dataDir, ENT_DB_PATH: join(dataDir, 'gateway.db'), ENT_GATEWAY_CONFIG: cfgPath },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let out = ''
  child.stdout.on('data', (d) => { out += d })
  child.stderr.on('data', (d) => { out += d })

  const cleanup = (code) => {
    try { mock.srv.close() } catch { /* 已退出 */ }
    try { child.kill() } catch { /* 已退出 */ }
    try { rmSync(dataDir, { recursive: true, force: true }) } catch { /* Windows 句柄延迟释放时留给系统临时目录 */ }
    console.log(failed ? '\n—— 多模态探针检查：FAIL ——' : '\n—— 多模态探针检查：PASS ——')
    if (failed && out.trim()) console.error('—— 网关日志 ——\n' + out.trim().split('\n').slice(-30).join('\n'))
    process.exit(code)
  }

  const req = async (method, path, { body, token } = {}) => {
    const r = await fetch(`http://127.0.0.1:${port}${path}`, {
      method,
      headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    })
    return { status: r.status, json: await r.json().catch(() => ({})) }
  }

  try {
    // 等网关就绪
    const deadline = Date.now() + 20000
    let health = null
    while (Date.now() < deadline) {
      try { health = await req('GET', '/health'); if (health.status === 200) break } catch { /* 未起 */ }
      await new Promise((r) => setTimeout(r, 300))
    }
    if (!health || health.status !== 200) return bad('网关启动 /health', health ? `HTTP ${health.status}` : '20s 未就绪')
    ok(`网关启动（端口 ${port}）`)

    // 管理员登录
    const m = out.match(/初始密码: ([0-9a-f]{12})/)
    if (!m) return bad('解析引导管理员初始密码', '启动日志未找到"初始密码"')
    const login = await req('POST', '/auth/login', { body: { username: 'admin', password: m[1] } })
    if (login.status !== 200 || !login.json.token) return bad('/auth/login', `HTTP ${login.status}`)
    const token = login.json.token
    ok('管理员登录成功')

    // 1. probe-levels：配置档位 [off,high] 生效 → 只回两档；vision-model 图片+视频都 real
    const lv1 = await req('POST', '/admin/providers/mock/probe-levels', { token, body: { model: 'vision-model' } })
    assert(lv1.status === 200 && lv1.json.ok, 'probe-levels vision-model 返回 200/ok', JSON.stringify(lv1.json).slice(0, 300))
    assert(lv1.json.modalities?.image?.status === 'real', 'vision-model 图片实测 = real（答对纯红图）', JSON.stringify(lv1.json.modalities?.image))
    assert(lv1.json.modalities?.video?.status === 'real', 'vision-model 视频实测 = real（答对纯红视频）', JSON.stringify(lv1.json.modalities?.video))
    assert(JSON.stringify((lv1.json.levels ?? []).map((x) => x.level)) === JSON.stringify(['off', 'high']), '档位跟随配置 probe.thinkingLevels（只测 off+high）', JSON.stringify(lv1.json.levels?.map((x) => x.level)))

    // 1b. 请求显式传 levels 覆盖配置 → 全四档
    const lv1b = await req('POST', '/admin/providers/mock/probe-levels', { token, body: { model: 'vision-model', levels: ['off', 'low', 'medium', 'high'] } })
    assert((lv1b.json.levels ?? []).length === 4, '请求显式传 levels 覆盖配置默认（4 档）', JSON.stringify(lv1b.json.levels?.map((x) => x.level)))

    // 2. probe-levels：novideo-model → 视频 rejected
    const lv2 = await req('POST', '/admin/providers/mock/probe-levels', { token, body: { model: 'novideo-model' } })
    assert(lv2.json.modalities?.image?.status === 'real', 'novideo-model 图片 = real', JSON.stringify(lv2.json.modalities?.image))
    assert(lv2.json.modalities?.video?.status === 'rejected', 'novideo-model 视频 = rejected（上游 400 拒绝）', JSON.stringify(lv2.json.modalities?.video))

    // 3. 档位独立判定：medium/high 被拒参只说明这两档上游不认，low 必须照测且能测出思考
    const lv3 = await req('POST', '/admin/providers/mock/probe-levels', { token, body: { model: 'rejectparam-model', levels: ['off', 'low', 'medium', 'high'] } })
    const byL = Object.fromEntries((lv3.json.levels ?? []).map((x) => [x.level, x]))
    assert(byL.high?.note === '参数被拒' && byL.medium?.note === '参数被拒', 'rejectparam-model medium/high 档 = 参数被拒', JSON.stringify({ medium: byL.medium, high: byL.high }))
    assert(byL.low?.accepted === true && byL.low?.thought === true, 'low 档照常实测且测出思考（不因高档被拒而跳过）', JSON.stringify(byL.low))
    assert((lv3.json.supportedThinking ?? []).join(',') === 'low', '实测支持档位 = low（低档不连坐）', JSON.stringify(lv3.json.supportedThinking))
    assert(byL.off?.accepted === true && byL.off?.thought === false, 'off 档照常实测（接受且无思考）', JSON.stringify(byL.off))

    // 3b. 协议适配：anthropic / gemini 供应商的连通 + 逐档探测 + 转发注入
    const ta = await req('POST', '/admin/providers/mock-anthropic/test', { token })
    assert(ta.json.ok && ta.json.upstreamModels?.includes('claude-mock'), 'anthropic 协议连通：/v1/models 拉到模型', JSON.stringify(ta.json).slice(0, 200))
    const tg = await req('POST', '/admin/providers/mock-gemini/test', { token })
    assert(tg.json.ok && tg.json.upstreamModels?.includes('gemini-mock'), 'gemini 协议连通：/v1beta/models 拉到模型（name 前缀已剥）', JSON.stringify(tg.json).slice(0, 200))
    const la = await req('POST', '/admin/providers/mock-anthropic/probe-levels', { token, body: { model: 'claude-mock', levels: ['off', 'low'] } })
    const byA = Object.fromEntries((la.json.levels ?? []).map((x) => [x.level, x]))
    assert(byA.low?.accepted === true && byA.low?.thought === true, 'anthropic 逐档探测：low 档实测出思考（thinking 块）', JSON.stringify(byA.low))
    assert(byA.low?.reasoningTokens > 0, 'anthropic 思考 token 计数归一（output_tokens→completion_tokens）', JSON.stringify(byA.low?.reasoningTokens))
    const lg = await req('POST', '/admin/providers/mock-gemini/probe-levels', { token, body: { model: 'gemini-mock', levels: ['off', 'low'] } })
    const byG = Object.fromEntries((lg.json.levels ?? []).map((x) => [x.level, x]))
    assert(byG.low?.accepted === true && byG.low?.thought === true, 'gemini 逐档探测：low 档实测出思考（thinkingBudget 注入）', JSON.stringify(byG.low))
    // anthropic 转发链路：OpenAI 方言进 → 网关翻译成 messages → 响应归一回 OpenAI 形态
    await req('POST', '/admin/models', { token, body: { id: 'ent-claude', providerId: 'mock-anthropic', upstreamModel: 'claude-mock', thinking: 'optional', thinkingLevels: ['off', 'low'], defaultThinking: 'low', inputModes: ['text'] } })
    const chatA = await req('POST', '/v1/chat/completions', { token, body: { model: 'ent-claude', messages: [{ role: 'user', content: 'hi' }] } })
    assert(chatA.status === 200 && typeof chatA.json.choices?.[0]?.message?.content === 'string', 'anthropic 转发：响应归一为 OpenAI 形态', JSON.stringify(chatA.json).slice(0, 200))
    assert(lastChatBody?.model === 'claude-mock' && Array.isArray(lastChatBody?.messages) && !('reasoning_effort' in lastChatBody), 'anthropic 转发：请求已译为 messages 体（defaultThinking=low → thinking.enabled）', JSON.stringify(lastChatBody).slice(0, 240))
    await req('DELETE', '/admin/models/ent-claude', { token })

    // 4. 单探针 probe 也合并 modalities
    const p1 = await req('POST', '/admin/providers/mock/probe', { token, body: { model: 'vision-model' } })
    assert(p1.json.thinking === 'real' && p1.json.modalities?.image?.status === 'real', 'probe 单探针：思考 real + 图片 real 合并返回', JSON.stringify(p1.json).slice(0, 300))

    // 5. apply-probe：inputModes 按实测写入企业模型
    const ap = await req('POST', '/admin/providers/mock/apply-probe', {
      token,
      body: { model: 'novideo-model', probe: { available: true, supportedThinking: ['high'], recommendation: 'real', inputModes: ['text', 'image'] } },
    })
    assert(ap.status === 200 && ap.json.ok, 'apply-probe 成功', JSON.stringify(ap.json).slice(0, 300))
    const cfgNow = await req('GET', '/admin/config', { token })
    const ent = (cfgNow.json.models ?? []).find((x) => x.id === 'novideo-model')
    assert(ent && JSON.stringify(ent.inputModes) === JSON.stringify(['text', 'image']), '企业模型 inputModes = [text,image]（实测结果落盘）', JSON.stringify(ent?.inputModes))

    // 6. apply-probe 不带 inputModes → 保留现值，不被清空
    const ap2 = await req('POST', '/admin/providers/mock/apply-probe', {
      token,
      body: { model: 'novideo-model', probe: { available: true, supportedThinking: ['high'], recommendation: 'real' } },
    })
    const cfgNow2 = await req('GET', '/admin/config', { token })
    const ent2 = (cfgNow2.json.models ?? []).find((x) => x.id === 'novideo-model')
    assert(ap2.status === 200 && JSON.stringify(ent2?.inputModes) === JSON.stringify(['text', 'image']), '不带 inputModes 的应用保留原值', JSON.stringify(ent2?.inputModes))

    // 7. 手工维护自定义档位：thinkingLevels 含 budget-8k + 每档注入参数（各家上游体系不同）
    const patch1 = await req('PATCH', '/admin/models/novideo-model', {
      token,
      body: { thinkingLevels: ['off', 'budget-8k'], thinkingParams: { 'budget-8k': { thinking: { type: 'enabled', budget_tokens: 8192 } } }, defaultThinking: 'off' },
    })
    assert(patch1.status === 200, 'PATCH 自定义档位 budget-8k + 注入参数成功', JSON.stringify(patch1.json).slice(0, 200))

    // 7b. 注入参数含未声明档位 → 400
    const patch2 = await req('PATCH', '/admin/models/novideo-model', {
      token,
      body: { thinkingParams: { ghost: { reasoning_effort: 'low' } } },
    })
    assert(patch2.status === 400, '注入参数引用未声明档位被拒（400）', JSON.stringify(patch2.json).slice(0, 200))

    // 7c. 探测自动带上关联模型的自定义档位与参数：levels 含 budget-8k，且按注入参数真实发送
    await fetch(`http://127.0.0.1:${mock.port}/v1/reset-bodies`)
    const lv4 = await req('POST', '/admin/providers/mock/probe-levels', { token, body: { model: 'novideo-model' } })
    assert((lv4.json.levels ?? []).some((x) => x.level === 'budget-8k'), '逐档探测自动带上手工维护的自定义档位 budget-8k', JSON.stringify(lv4.json.levels?.map((x) => x.level)))
    const bodies = await (await fetch(`http://127.0.0.1:${mock.port}/v1/bodies`)).json()
    const budgetBody = bodies.find((x) => x.thinking?.budget_tokens === 8192)
    assert(budgetBody && !('reasoning_effort' in budgetBody), 'budget-8k 档按维护的注入参数发送（budget_tokens=8192，无 reasoning_effort）', JSON.stringify(bodies.map((x) => ({ t: x.thinking, e: x.reasoning_effort }))))

    // 8. 真实转发链路：/v1/chat/completions 指定 reasoning_effort=budget-8k → 网关按 thinkingParams 注入
    lastChatBody = null
    const chat1 = await req('POST', '/v1/chat/completions', { token, body: { model: 'novideo-model', messages: [{ role: 'user', content: 'hi' }], reasoning_effort: 'budget-8k' } })
    assert(chat1.status === 200, '对话转发成功（自定义档位）', JSON.stringify(chat1.json).slice(0, 200))
    assert(lastChatBody?.thinking?.type === 'enabled' && lastChatBody?.thinking?.budget_tokens === 8192 && !('reasoning_effort' in lastChatBody), '转发注入：budget-8k 档参数替换 reasoning_effort 原样下发', JSON.stringify(lastChatBody))

    // 8b. 标准档位回退：reasoning_effort=high（无自定义参数）→ 双风格注入照旧
    lastChatBody = null
    await req('POST', '/v1/chat/completions', { token, body: { model: 'novideo-model', messages: [{ role: 'user', content: 'hi' }], reasoning_effort: 'high' } })
    assert(lastChatBody?.reasoning_effort === 'high' && lastChatBody?.thinking?.type === 'enabled', '标准档位保持双风格注入（thinking.type + reasoning_effort）', JSON.stringify(lastChatBody))

    // 8b2. Responses API（Codex 方言）：/v1/responses 非流式 + 流式
    lastChatBody = null
    const r1 = await req('POST', '/v1/responses', { token, body: { model: 'novideo-model', input: 'hi', instructions: '你是测试助手', reasoning: { effort: 'high' } } })
    assert(r1.status === 200 && r1.json.object === 'response', 'responses 非流式：返回 response 对象', JSON.stringify(r1.json).slice(0, 200))
    const rOut = (r1.json.output ?? []).find((o) => o.type === 'message')
    assert(rOut?.content?.[0]?.type === 'output_text' && rOut.content[0].text.length > 0, 'responses 非流式：output_text 有正文', JSON.stringify(rOut))
    assert(lastChatBody?.messages?.[0]?.role === 'system' && lastChatBody?.messages?.[1]?.role === 'user', 'responses 请求：instructions→system + input→user 已译', JSON.stringify(lastChatBody).slice(0, 240))
    assert(lastChatBody?.reasoning_effort === 'high', 'responses 请求：reasoning.effort → reasoning_effort', JSON.stringify(lastChatBody))
    const r2raw = await fetch(`http://127.0.0.1:${port}/v1/responses`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ model: 'novideo-model', input: 'hi', stream: true }),
    })
    const r2text = await r2raw.text()
    assert(r2raw.status === 200 && r2text.includes('event: response.created'), 'responses 流式：response.created 事件', r2raw.status + ' ' + r2text.slice(0, 120))
    // 逐字 delta：拼接所有 output_text.delta 的 delta 字段后应还原完整正文
    const deltaText = [...r2text.matchAll(/event: response\.output_text\.delta\ndata: (.*)/g)].map((m) => { try { return JSON.parse(m[1]).delta } catch { return '' } }).join('')
    assert(r2text.includes('event: response.output_text.delta') && deltaText === '真话者是乙。', 'responses 流式：output_text.delta 增量拼接还原正文', `拼出=[${deltaText}]` + r2text.slice(0, 200))
    assert(r2text.includes('event: response.completed'), 'responses 流式：response.completed 收尾', r2text.slice(-200))

    // 8c. 探测默认档位热更：PATCH /admin/probe-config 落盘并生效
    const pc1 = await req('PATCH', '/admin/probe-config', { token, body: { thinkingLevels: ['off', 'medium'] } })
    assert(pc1.status === 200 && JSON.stringify(pc1.json.thinkingLevels) === JSON.stringify(['off', 'medium']), 'PATCH /admin/probe-config 设默认档位成功', JSON.stringify(pc1.json).slice(0, 200))
    const lv5 = await req('POST', '/admin/providers/mock/probe-levels', { token, body: { model: 'vision-model' } })
    assert(JSON.stringify((lv5.json.levels ?? []).map((x) => x.level)) === JSON.stringify(['off', 'medium']), '热更后的默认档位对后续探测生效（只测 off+medium）', JSON.stringify(lv5.json.levels?.map((x) => x.level)))
    const pcBad = await req('PATCH', '/admin/probe-config', { token, body: { thinkingLevels: ['非!法@名'] } })
    assert(pcBad.status === 400, '格式非法档位名 PATCH 被拒（400）', JSON.stringify(pcBad.json).slice(0, 200))
    const pcFree = await req('PATCH', '/admin/probe-config', { token, body: { thinkingLevels: ['minimal', 'xhigh'] } })
    assert(pcFree.status === 200, '自由命名档位（minimal/xhigh）PATCH 通过', JSON.stringify(pcFree.json).slice(0, 200))
    // 自定义档位名册持久化：添加 → 勾选集洗掉不丢 → 显式删除才消失
    const pa = await req('PATCH', '/admin/probe-config', { token, body: { addCustom: 'budget-8k' } })
    assert(pa.json.customLevels?.includes('budget-8k'), 'addCustom 进名册（持久化）', JSON.stringify(pa.json.customLevels))
    const pw = await req('PATCH', '/admin/probe-config', { token, body: { thinkingLevels: ['off', 'low'] } })   // 勾选集不含 budget-8k
    assert(pw.json.customLevels?.includes('budget-8k'), '勾选集更新不洗掉名册里的自定义档', JSON.stringify(pw.json.customLevels))
    const pr = await req('PATCH', '/admin/probe-config', { token, body: { removeCustom: 'budget-8k' } })
    assert(!pr.json.customLevels?.includes('budget-8k'), 'removeCustom 显式删除后才消失', JSON.stringify(pr.json.customLevels))

    // 8d. 输出上限透明：每档结果带 cap（正常应为 200/128，回退时可见实际值）
    const caps = (lv5.json.levels ?? []).map((x) => x.cap)
    assert(caps.every((c) => Number.isFinite(c)), '逐档结果带 cap 字段（输出上限透明）', JSON.stringify(caps))
  } catch (e) {
    bad('流程异常', String(e))
  } finally {
    cleanup(failed ? 1 : 0)
  }
}

main()
