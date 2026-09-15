/**
 * 插件 ent-catalog · 供应商与模型目录
 * 职责：供应商/模型 CRUD API（/admin/config、/admin/providers*、/admin/models*）+ 探测应用 + 自带管理台页面
 * 「谁的数据谁挂路由」（对齐 ent-audit）：目录数据来自 config 服务，本插件只做「面向管理台的目录门户」
 */
import { json, readJson } from '../core/http.mjs'
import * as probeImpl from '../probe.mjs'

export const name = 'ent-catalog'
export const provides = []
export const inject = ['config', 'auth', 'router']
import { probeStatsOf } from './ent-upstream.mjs'

/** 自带页面：供应商与模型（页面资源在本插件 ent-catalog.web/）；nav.id=channels 兼容历史书签/深链 */
export const admin = {
  nav: { id: 'channels', title: '供应商与模型', icon: 'plug-zap', order: 30 },
  entry: 'index.mjs',
}

const ts = () => new Date().toLocaleTimeString('zh-CN', { hour12: false })

export function apply(ctx) {
  const router = ctx.get('router')
  const config = ctx.get('config')
  const auth = ctx.get('auth')
  // 探测是目录域的内置能力（原 ent-probe 服务并入：只有本插件消费它）
  const { testProvider, probeProviderModel, probeProviderAll, probeProviderModelLevels, probeProviderModelModal } = probeImpl
  const {
    getConfig, resolveProviderApiKey,
    createProvider, updateProvider, deleteProvider, updateModel, createModel,
    deleteModel, saveConfig,
  } = config

  /** 管理员鉴权（与 ent-console 管理面同一策略） */
  async function requireAdmin(req, res) {
    const a = await auth.authenticate(req)
    if (!a.ok) { json(res, a.status, { error: a.error }); return null }
    if (a.user.role !== 'admin') { json(res, 403, { error: { message: '需要管理员角色', type: 'forbidden' } }); return null }
    return a
  }

  // 只接管目录相关前缀，不碰 /admin 静态资源与 /admin/* 其他页面 API ——
  // prefix 按注册顺序分发，宽前缀会拦截后续插件（ent-console 的 SPA/静态资源）导致管理台整体 401
  for (const base of ['/admin/providers', '/admin/models']) {
    ctx.effect(() => router.prefix(base, async (req, res, path, url) => {
      const u = await requireAdmin(req, res)
      if (!u) return true
      const user = u.user
      return catalogRoutes(req, res, path, url, user)
    }), `ent-catalog: ${base}/*`)
  }
  // /admin/config 精确路由（避免宽 prefix 拦截其他 /admin/* 路径）
  ctx.effect(() => router.exact('GET', '/admin/config', async (req, res) => {
    const u = await requireAdmin(req, res)
    if (!u) return true
    return configOverview(req, res)
  }), 'ent-catalog: GET /admin/config')

  // 探测档位配置：thinkingLevels = 勾选的默认测试集。
  // 档位白名单 = DSH 终端 schema（off|minimal|low|medium|high|xhigh|max）——不再支持
  // 自定义档位：越界档位即使实测通过，透传到终端也会让整个 llm-pi-ai 段被宿主
  // schema 拒绝（选择器全空），白名单在这里收口，UI 与配置都不再引入名单外档位。
  ctx.effect(() => router.exact('PATCH', '/admin/probe-config', async (req, res) => {
    const u = await requireAdmin(req, res)
    if (!u) return true
    const b = (await readJson(req)) ?? {}
    const DSH_LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']
    const cfg = getConfig()
    const cur = cfg.probe ?? {}
    // 更新勾选集（可选；不传 = 只清理名单外档位）
    let checked = Array.isArray(cur.thinkingLevels) && cur.thinkingLevels.length
      ? cur.thinkingLevels.filter((x) => DSH_LEVELS.includes(x))
      : ['off', 'low', 'medium', 'high']
    if (!checked.length) checked = ['off', 'low', 'medium', 'high']
    if (b.thinkingLevels !== undefined) {
      if (!Array.isArray(b.thinkingLevels) || !b.thinkingLevels.length) {
        return json(res, 400, { error: { message: 'thinkingLevels 必须是非空数组（合法档位：' + DSH_LEVELS.join('/') + '）', type: 'bad_request' } })
      }
      checked = [...new Set(b.thinkingLevels.filter((x) => DSH_LEVELS.includes(x)))]
      if (!checked.length) return json(res, 400, { error: { message: 'thinkingLevels 档位不合法（仅支持 DSH 档位：' + DSH_LEVELS.join('/') + '）', type: 'bad_request' } })
    }
    cfg.probe = { ...(cur ?? {}), thinkingLevels: checked, customLevels: [] }
    saveConfig()
    console.log(`[${ts()}] ⚙ 探测档位更新：默认=${checked.join('/')}（仅 DSH 档位） by ${u.user.username}（已落盘）`)
    return json(res, 200, { ok: true, thinkingLevels: checked, customLevels: [] })
  }), 'ent-catalog: PATCH /admin/probe-config')

  function configOverview(req, res) {
    const c = getConfig()
    return json(res, 200, {
      providers: c.providers.map((p) => ({
        id: p.id, name: p.name, baseUrl: p.baseUrl, enabled: p.enabled,
        weight: p.weight, timeoutMs: p.timeoutMs,
        // hasKey = 环境变量/.env 里真实可解析；密钥明文永不回传前端（连 hasKey 都只回布尔）
        hasKey: !!resolveProviderApiKey(p), apiKeyEnv: p.apiKeyEnv ?? null,
      })),
      models: c.models,
      probe: c.probe ?? { thinkingLevels: ['off', 'low', 'medium', 'high'] },
      dlp: c.dlp, audit: c.audit, auth: { mode: c.auth.mode },
    })
  }

  async function catalogRoutes(req, res, path, url, user) {
    /* ---- 供应商 CRUD ---- */
    if (path === '/admin/providers' && req.method === 'POST') {
      const b = (await readJson(req)) ?? {}
      const r = createProvider(b)
      if (!r.ok) return json(res, 400, { error: { message: r.error, type: 'bad_request' } })
      console.log(`[${ts()}] ＋ 新增供应商 ${b.id} by ${user.username}（已落盘）`)
      return json(res, 200, { ok: true })
    }
    if (req.method === 'PATCH' && /^\/admin\/providers\/[^/]+$/.test(path)) {
      const pid = decodeURIComponent(path.split('/')[3])
      const b = (await readJson(req)) ?? {}
      const r = updateProvider(pid, b)
      if (!r.ok) return json(res, r.error === '供应商不存在' ? 404 : 400, { error: { message: r.error, type: 'bad_request' } })
      console.log(`[${ts()}] ⚙ 编辑供应商 ${pid} by ${user.username}: ${Object.keys(b).join(',')}（已落盘）`)
      return json(res, 200, { ok: true })
    }
    if (req.method === 'DELETE' && /^\/admin\/providers\/[^/]+$/.test(path)) {
      const pid = decodeURIComponent(path.split('/')[3])
      const r = deleteProvider(pid)
      if (!r.ok) return json(res, 400, { error: { message: r.error, type: 'forbidden' } })
      console.log(`[${ts()}] － 删除供应商 ${pid} by ${user.username}`)
      return json(res, 200, { ok: true })
    }
    // 测活统计弹窗数据源
    if (req.method === 'GET' && /^\/admin\/providers\/[^/]+\/probe-stats$/.test(path)) {
      const pid = decodeURIComponent(path.split('/')[3])
      return json(res, 200, probeStatsOf(pid))
    }
    if (req.method === 'POST' && /^\/admin\/providers\/[^/]+\/test$/.test(path)) {
      const pid = decodeURIComponent(path.split('/')[3])
      const r = await testProvider(pid)
      console.log(`[${ts()}] 🔌 供应商连通测试 ${pid} by ${user.username}: ${r.ok ? `${r.ms}ms` : r.error}`)
      return json(res, 200, r)
    }
    // 单模型探针：真实发一条最小请求，判断该上游模型是否支持思考档位
    if (req.method === 'POST' && /^\/admin\/providers\/[^/]+\/probe$/.test(path)) {
      const pid = decodeURIComponent(path.split('/')[3])
      const b = (await readJson(req)) ?? {}
      if (!b.model) return json(res, 400, { error: { message: '缺少 model 参数', type: 'bad_request' } })
      // 允许传企业模型 id（如 deepseek）——自动映射到其上游模型名（upstreamModel），
      // 否则把企业 id 直接发上游会 404/503（上游只认识自己的模型名）
      let probeModel = b.model
      const ent = getConfig().models.find((m) => m.id === b.model)
      if (ent?.upstreamModel) probeModel = ent.upstreamModel
      // 思考探针 + 多模态探针（图片/视频）并行，一次出齐
      const [r, modal] = await Promise.all([
        probeProviderModel(pid, probeModel),
        probeProviderModelModal(pid, probeModel),
      ])
      const merged = modal.ok ? { ...r, modalities: modal.modalities } : r
      const modTxt = merged.modalities
        ? ` · 图片=${merged.modalities.image.status} 视频=${merged.modalities.video.status}`
        : ''
      console.log(`[${ts()}] 🔬 模型探针 ${pid}/${probeModel}${probeModel !== b.model ? `（企业模型 ${b.model} 映射）` : ''} by ${user.username}: ${merged.verdict ?? merged.error}${modTxt}`)
      return json(res, 200, merged)
    }
    // 全量探测：拉上游目录 + 并发探针每个模型（连通/可用/思考/延迟一次出齐）
    if (req.method === 'POST' && /^\/admin\/providers\/[^/]+\/probe-all$/.test(path)) {
      const pid = decodeURIComponent(path.split('/')[3])
      const r = await probeProviderAll(pid)
      console.log(`[${ts()}] 🔬 全量探测 ${pid} by ${user.username}: ${r.verdict ?? r.error}（${r.ms ?? '?'}ms）`)
      return json(res, 200, r)
    }
    // 逐档位探测单个上游模型：档位真实发送，逐档出结果；同时并行实测图片/视频输入支持
    if (req.method === 'POST' && /^\/admin\/providers\/[^/]+\/probe-levels$/.test(path)) {
      const pid = decodeURIComponent(path.split('/')[3])
      const b = (await readJson(req)) ?? {}
      if (!b.model) return json(res, 400, { error: { message: '缺少 model 参数', type: 'bad_request' } })
      // 档位来源：请求显式传 levels > 关联企业模型手工维护的档位名单 > 网关配置 probe.thinkingLevels > 内置全档
      // 白名单 = DSH 终端 schema 档位；名单外（历史自定义档如 none）一律剔除，不出探测结果
      const DSH_LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']
      const cfgLevels = Array.isArray(getConfig().probe?.thinkingLevels) ? getConfig().probe.thinkingLevels : ['off', 'low', 'medium', 'high']
      const linked = getConfig().models.find((m) => m.upstreamModel === b.model || m.id === b.model)
      const reqLevels = Array.isArray(b.levels) && b.levels.length
        ? b.levels
        : [...new Set([...cfgLevels, ...(linked?.thinkingLevels ?? [])])]
      const levels = [...new Set(reqLevels.map(String).filter((x) => DSH_LEVELS.includes(x)))]
      if (!levels.length) return json(res, 400, { error: { message: 'levels 档位不合法（仅支持 DSH 档位：' + DSH_LEVELS.join('/') + '）', type: 'bad_request' } })
      const [r, modal] = await Promise.all([
        probeProviderModelLevels(pid, b.model, levels, {
          // 请求显式 levelParams 可覆盖模型维护的每档注入参数（仅白名单档位会被探测）
          levelParams: { ...(linked?.thinkingParams ?? {}), ...(b.levelParams && typeof b.levelParams === 'object' && !Array.isArray(b.levelParams) ? b.levelParams : {}) },
        }),
        probeProviderModelModal(pid, b.model),
      ])
      const merged = modal.ok ? { ...r, modalities: modal.modalities } : r
      console.log(`[${ts()}] 🔬 逐档探测 ${pid}/${b.model}（${levels.join('/')}） by ${user.username}: ${merged.recommendation ?? merged.error}${merged.modalities ? ` · 图片=${merged.modalities.image.status} 视频=${merged.modalities.video.status}` : ''}`)
      return json(res, 200, merged)
    }
    // 应用探测结果到模型目录：按上游模型探测结论创建/更新企业模型（thinkingLevels 取实测支持档位）
    if (req.method === 'POST' && /^\/admin\/providers\/[^/]+\/apply-probe$/.test(path)) {
      const pid = decodeURIComponent(path.split('/')[3])
      const b = (await readJson(req)) ?? {}
      if (!b.model || !b.probe) return json(res, 400, { error: { message: '缺少 model / probe 参数', type: 'bad_request' } })
      const p = b.probe
      if (!p.available) return json(res, 400, { error: { message: `上游模型 ${b.model} 不可用（${p.recommendation}），无法应用`, type: 'bad_request' } })
      const cfg = getConfig()
      // 支持的思考档位 = off 恒有 + 实测产生思考输出的档位，且全部收敛到 DSH 终端
      // schema 白名单——名单外档位（历史自定义档如 none/budget-8k）不保留、不透传：
      // 它们进模型配置后会让终端整个 llm-pi-ai 段被宿主 schema 拒绝（选择器全空）
      const exists = cfg.models.find((m) => m.id === b.model || m.upstreamModel === b.model)
      const sup = Array.isArray(p.supportedThinking) ? p.supportedThinking : []
      const DSH_LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']
      const thinkingLevels = [...new Set(['off', ...sup.filter((x) => DSH_LEVELS.includes(x) && x !== 'off')])]
      // 输入模式：实测多模态结果优先（image/video 探测通过才写入）；没测过则保留现值
      const LEGAL_MODES = ['text', 'image', 'video']
      const measuredModes = Array.isArray(p.inputModes)
        ? p.inputModes.filter((x) => LEGAL_MODES.includes(x))
        : []
      const inputModes = measuredModes.length
        ? (measuredModes.includes('text') ? measuredModes : ['text', ...measuredModes])
        : (exists?.inputModes ?? ['text'])
      const payload = {
        providerId: pid,
        upstreamModel: b.model,
        displayName: b.displayName ?? exists?.displayName ?? b.model,
        contextWindow: Number(p.contextLength) || exists?.contextWindow || 128000,
        maxTokens: exists?.maxTokens ?? 32768,
        inputModes,
        thinking: sup.length ? 'optional' : 'none',
        thinkingLevels,
        defaultThinking: sup.length ? (thinkingLevels.includes('low') ? 'low' : thinkingLevels[1]) : 'off',
        enabled: true,
        // 手工维护的每档注入参数/容灾映射不被探测应用覆盖
        ...(exists?.thinkingParams ? { thinkingParams: exists.thinkingParams } : {}),
        ...(exists?.upstreamModelByProvider ? { upstreamModelByProvider: exists.upstreamModelByProvider } : {}),
      }
      let result
      if (exists) {
        result = updateModel(exists.id, { ...payload, newId: b.model === exists.id ? undefined : b.model })
        if (!result.ok) return json(res, 400, { error: { message: result.error, type: 'bad_request' } })
        console.log(`[${ts()}] ⬆ 探测结果应用：更新企业模型 ${exists.id}（thinkingLevels=${thinkingLevels.join('/')} · inputModes=${inputModes.join('/')}） by ${user.username}`)
        return json(res, 200, { ok: true, applied: 'update', modelId: exists.id, thinkingLevels, inputModes })
      }
      // 校验企业模型 id 合法性（从上游模型名推导：非 [a-zA-Z0-9._-] 字符转 _）
      const entId = b.model.replace(/[^a-zA-Z0-9._-]/g, '_')
      result = createModel({ ...payload, id: entId })
      if (!result.ok) return json(res, 400, { error: { message: result.error, type: 'bad_request' } })
      console.log(`[${ts()}] ⬆ 探测结果应用：新增企业模型 ${entId}（thinkingLevels=${thinkingLevels.join('/')} · inputModes=${inputModes.join('/')}） by ${user.username}`)
      return json(res, 200, { ok: true, applied: 'create', modelId: entId, thinkingLevels, inputModes })
    }

    /* ---- 模型 CRUD（精细配置） ---- */
    if (path === '/admin/models' && req.method === 'POST') {
      const b = (await readJson(req)) ?? {}
      const r = createModel(b)
      if (!r.ok) return json(res, 400, { error: { message: r.error, type: 'bad_request' } })
      console.log(`[${ts()}] ＋ 新增模型 ${b.id} → ${b.providerId} by ${user.username}（已落盘）`)
      return json(res, 200, { ok: true })
    }
    if (req.method === 'PATCH' && /^\/admin\/models\/[^/]+$/.test(path)) {
      const mid = decodeURIComponent(path.split('/')[3])
      const b = (await readJson(req)) ?? {}
      const r = updateModel(mid, b)
      if (!r.ok) return json(res, r.error === '模型不存在' ? 404 : 400, { error: { message: r.error, type: 'bad_request' } })
      console.log(`[${ts()}] ⚙ 编辑模型 ${mid} by ${user.username}: ${Object.keys(b).join(',')}（已落盘）`)
      return json(res, 200, { ok: true })
    }
    if (req.method === 'DELETE' && /^\/admin\/models\/[^/]+$/.test(path)) {
      const mid = decodeURIComponent(path.split('/')[3])
      const r = deleteModel(mid)
      if (!r.ok) return json(res, 400, { error: { message: r.error, type: 'bad_request' } })
      console.log(`[${ts()}] － 删除模型 ${mid} by ${user.username}`)
      return json(res, 200, { ok: true })
    }

    // 未识别的 providers/models 子路径：返回 false 交回路由表，让其他插件有机会处理
    return false
  }
}
