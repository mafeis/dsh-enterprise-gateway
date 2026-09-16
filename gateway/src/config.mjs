/**
 * 企业网关 · 配置模块
 * 分层：内置默认 ← 网关配置文件 ← 环境变量 ← 热更新（管理API，落盘）
 *
 * 架构（真实业务模型）：
 *   Provider 供应商 = 上游接入点（baseUrl + apiKey + 超时/权重/启停）
 *   Model    模型   = 挂在某 Provider 下的企业模型（上下文/输出上限/思考档位/模式/单价）
 *   路由：请求模型 → 查模型定义 → 走其 Provider；失败按 fallbackProviders 容灾
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'

const __dirname = dirname(fileURLToPath(import.meta.url))
const DATA_DIR = process.env.ENT_DATA_DIR ?? join(__dirname, '..', 'data')
export const dataDir = DATA_DIR

const DEFAULT_CONFIG = {
  server: {
    host: '127.0.0.1',
    port: 8899,
  },
  /** 上游供应商：baseUrl + apiKey */
  providers: [
    {
      id: 'prov-upstream-1',
      name: '上游渠道（部署时替换为真实地址与名称）',
      baseUrl: 'https://your-upstream.example.com/v1',
      apiKeyEnv: 'UPSTREAM_API_KEY',
      apiKey: null,
      timeoutMs: 120000,
      weight: 10,
      enabled: true,
    },
  ],
  /** 企业模型目录：每模型独立配置；pricePer1MIn/Out/CacheIn = 每百万 token 单价（元），与官方报价同单位 */
  models: [
    {
      id: 'ent-default', displayName: '企业默认',
      providerId: 'prov-upstream-1', upstreamModel: 'your-model-id',
      contextWindow: 200000, maxTokens: 64000,
      mode: 'chat',                       // chat=对话 | reasoning=深度推理（默认开思考）
      thinking: 'optional',               // none=不支持 | optional=可选 | always=强制思考
      defaultThinking: 'off',             // off/low/medium/high（optional 时的默认档位）
      fallbackProviders: [],
      pricePer1MIn: 2, pricePer1MOut: 8, pricePer1MCacheIn: 0.04,
      enabled: true,
    },
    {
      id: 'ent-reasoning', displayName: '企业深度推理',
      providerId: 'prov-upstream-1', upstreamModel: 'your-reasoning-model',
      contextWindow: 512000, maxTokens: 64000,
      mode: 'reasoning', thinking: 'always', defaultThinking: 'medium',
      fallbackProviders: [],
      pricePer1MIn: 0.8, pricePer1MOut: 2.8, pricePer1MCacheIn: 0.23,
      enabled: true,
    },
  ],
  auth: {
    mode: 'jwt',                              // jwt | device | open
    jwtSecret: process.env.ENT_JWT_SECRET ?? 'dev-secret-change-me',
    tokenTtlSec: 604800,                      // 7 天：管理台无需频繁重登
    loginProtection: {                        // 登录失败锁定（防爆破）
      enabled: true,
      maxFails: 10,                           // 统计窗口内失败次数阈值
      windowMin: 15,                          // 失败统计窗口（分钟）
      lockMin: 15,                            // 触发后的锁定时长（分钟）
    },
  },
  dlp: {
    enabled: true,
    rules: [
      { id: 'apikey', pattern: 'sk-[A-Za-z0-9_-]{20,}', action: 'block', label: '密钥外发' },
      { id: 'bankcard', pattern: '\\b\\d{16,19}\\b', action: 'mask', label: '银行卡号' },
      { id: 'phone', pattern: '\\b1[3-9]\\d{9}\\b', action: 'mask', label: '手机号' },
      { id: 'idcard', pattern: '\\b\\d{17}[\\dXx]\\b', action: 'mask', label: '身份证号' },
    ],
  },
  audit: {
    level: 'full',                            // full | metadata_only
    retentionDays: 90,
    maxContentChars: 32000,                   // 审计正文单字段截断上限（字符）
    activityDays: 7,                          // 账号活动详情聚合窗口（天）
    activityLogins: 20,                       // 账号活动详情：登录历史显示条数
    activityDevices: 20,                      // 账号活动详情：登录设备显示条数
    activityUsage: 20,                        // 账号活动详情：使用记录聚合分组数
  },
  // 上游探测（供应商与模型页 · 逐档测试）默认行为
  probe: {
    // 逐档测试发送哪些思考档位：子集自 off/low/medium/high；逐档测试弹窗里可临时改单次范围
    thinkingLevels: ['off', 'low', 'medium', 'high'],
    customLevels: [],   // 手工添加的自定义档位名册（持久化；勾选集 thinkingLevels 只是它的子集视图）
  },
  // 网关插件开关与配置（借鉴 DSH 插件体系）：
  //   { [name]: { enabled?: boolean, config?: object, path?: string } }
  //   内置插件（ent-store/ent-auth/ent-dlp/ent-upstream/ent-probe/ent-admin）默认启用，
  //   enabled=false 禁用（依赖它的插件会明确报错跳过）；带 path 的条目 = 外部插件（客户定制），
  //   相对路径基于网关进程 cwd，模块需导出 name/inject/apply（与 DSH 插件契约同形）。
  plugins: {},
  policy: {
    version: '1.0.0',
    lockModelConfig: true,
    watermark: true,
    disabledFeatures: [],
    // DSH 插件安装允许清单（bundle 名，如 dsh-enterprise）；空数组 = 不限制。
    // 客户端心跳比对本地安装清单，清单外插件由客户端启动/心跳时自动清理
    // （dsh-enterprise 自身与 DSH 必装组件为保护名单，不会被清）。
    allowedPlugins: [],
    // 企业自建插件源：员工安装插件时用此 registry 而非社区公共源。
    // mode: off=用默认源 | proxy=npm --registry=<url> | url=直接 file:/http: 包地址前缀
    pluginRegistry: {
      mode: 'off',
      npmRegistryUrl: '',                       // proxy 模式：企业 npm mirror，如 http://npm.corp.local:4873
      packagePrefix: '',                        // url 模式：包地址前缀，如 http://plugins.corp.local/packages/（拼 <prefix><plugin-name>）
      allowedFallback: true,                    // 自建源拉取失败时是否允许回退公共源
    },
    // 客户端自助规则：高频简单管控下发到插件本地执行（不占网关往返）。
    // 每条: { id, type, action, value, message }；type 见 dsh-enterprise/lib/index.js applyClientRules
    clientRules: [],
  },
}

let config = structuredClone(DEFAULT_CONFIG)
let __configLoaded = false
const configPath = process.env.ENT_GATEWAY_CONFIG ?? join(DATA_DIR, 'gateway-config.json')
/** 密钥文件：管理台输入的 API Key 落这里（KEY=value），绝不写进 gateway-config.json */
const envFilePath = join(DATA_DIR, '.env')

/** 零依赖 .env 加载：KEY=value 逐行；进程环境变量优先（env > 文件），支持 # 注释与 export 前缀 */
export function loadDotEnv() {
  if (!existsSync(envFilePath)) return 0
  let count = 0
  for (const rawLine of readFileSync(envFilePath, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const m = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/)
    if (!m) continue
    let [, key, val] = m
    // 去包裹引号（值内含 # 时引号保护）
    val = val.trim().replace(/^["'](.*)["']$/, '$1')
    if (process.env[key] === undefined) process.env[key] = val
    count++
  }
  return count
}

/** 把 KEY=value 写入 data/.env（已存在同 key 则整行替换；带注释头）。返回绝对路径 */
export function writeDotEnv(key, value) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) throw new Error(`非法变量名: ${key}`)
  let lines = []
  if (existsSync(envFilePath)) {
    lines = readFileSync(envFilePath, 'utf8').split(/\r?\n/)
      .filter((l) => l.trim() && !l.trim().startsWith('#') && !(l.trim().startsWith(key + '=') || l.trim().startsWith('export ' + key + '=')))
  } else {
    lines = ['# 供应商 API 密钥（管理台输入自动落盘；本文件请勿提交 git / 外发）']
  }
  lines.push(`${key}=${value}`)
  mkdirSync(DATA_DIR, { recursive: true })
  writeFileSync(envFilePath, lines.join('\n') + '\n')
  process.env[key] = value   // 本进程立即生效（resolveProviderApiKey 走 process.env）
  return envFilePath
}

/** 从 data/.env 删除一行（供应商删除时清理其密钥变量） */
export function removeDotEnv(key) {
  if (!existsSync(envFilePath)) return
  const kept = readFileSync(envFilePath, 'utf8').split(/\r?\n/)
    .filter((l) => !(l.trim().startsWith(key + '=') || l.trim().startsWith('export ' + key + '=')))
  writeFileSync(envFilePath, kept.join('\n'))
  delete process.env[key]
}

/** 旧版 channels+publicModels → providers+models 迁移 */
function migrateLegacy(fileCfg) {
  if (!fileCfg.channels || fileCfg.providers) return fileCfg
  const providers = (fileCfg.channels ?? []).map((c) => ({
    id: c.id, name: c.name, baseUrl: c.baseUrl, protocol: c.protocol ?? 'openai',
    apiKeyEnv: c.apiKeyEnv ?? null, apiKey: c.apiKey ?? null,
    timeoutMs: c.timeoutMs ?? 120000, weight: c.weight ?? 10, enabled: c.enabled !== false,
  }))
  const priceOf = {}
  for (const m of fileCfg.publicModels ?? []) priceOf[m.id] = m
  // 每个企业模型选权重最高的承载渠道
  const best = {}
  for (const c of fileCfg.channels ?? []) {
    for (const [ent, up] of Object.entries(c.models ?? {})) {
      if (!best[ent] || (c.weight ?? 0) > best[ent].weight) best[ent] = { channel: c, upstream: up, weight: c.weight ?? 0 }
    }
  }
  const models = Object.entries(best).map(([ent, b]) => ({
    id: ent,
    displayName: priceOf[ent]?.displayName ?? ent,
    providerId: b.channel.id,
    upstreamModel: b.upstream,
    contextWindow: priceOf[ent]?.contextWindow ?? 128000,
    maxTokens: priceOf[ent]?.maxTokens ?? 32768,
    mode: /reason/i.test(ent) ? 'reasoning' : 'chat',
    thinking: /reason/i.test(ent) ? 'always' : 'optional',
    defaultThinking: /reason/i.test(ent) ? 'medium' : 'off',
    fallbackProviders: [],
    pricePer1MIn: priceOf[ent]?.pricePer1MIn ?? 0,
    pricePer1MOut: priceOf[ent]?.pricePer1MOut ?? 0,
    enabled: priceOf[ent]?.enabled !== false,
  }))
  const migrated = { ...fileCfg, providers, models }
  delete migrated.channels
  delete migrated.publicModels
  console.log(`[config] 已迁移旧配置: ${providers.length} 个供应商 / ${models.length} 个模型`)
  return migrated
}

export function loadConfig() {
  // 密钥文件先于配置加载：resolveProviderApiKey 走 process.env
  const n = loadDotEnv()
  if (n) console.log(`[config] 已加载密钥文件: ${envFilePath}（${n} 项）`)
  if (existsSync(configPath)) {
    try {
      const rawBefore = readFileSync(configPath, 'utf8')
      let fileCfg = JSON.parse(rawBefore)
      fileCfg = migrateLegacy(fileCfg)
      config = deepMerge(structuredClone(DEFAULT_CONFIG), fileCfg)
      console.log(`[config] 已加载配置文件: ${configPath}`)
      // 迁移结果立即落盘，避免下次重复迁移
      if (JSON.stringify(fileCfg) !== rawBefore) saveConfig()
    } catch (e) {
      console.warn(`[config] 配置文件解析失败，使用默认: ${e.message}`)
    }
  } else {
    mkdirSync(dirname(configPath), { recursive: true })
    config = structuredClone(DEFAULT_CONFIG)
  }
  if (process.env.PORT) config.server.port = Number(process.env.PORT)
  if (process.env.UPSTREAM_BASE_URL && config.providers[0]) {
    config.providers[0].baseUrl = process.env.UPSTREAM_BASE_URL
  }
  __configLoaded = true
  return config
}

export function getConfig() { if (!__configLoaded) loadConfig(); return config }

/** 管理API热更新（仅白名单字段）· 持久化到配置文件，重启不丢
 *  规则不合法直接 throw（调用方转 400），绝不静默写入坏规则
 */
export function patchConfig(patch) {
  if (!__configLoaded) loadConfig()   // 防误写：未加载真实配置前禁止 patch（否则会把 DEFAULT_CONFIG 落盘覆盖线上配置）
  const _bumpKeys = ['clientRules', 'bannerPosition', 'bannerStyle', 'watermark', 'watermarkStyle', 'lockModelConfig', 'disabledFeatures', 'allowedPlugins', 'pluginRegistry']
  const _shouldBump = patch.policy ? _bumpKeys.some((k) => patch.policy[k] !== undefined) : false
  if (patch.policy) {
    if (patch.policy.allowedPlugins !== undefined) {
      if (!Array.isArray(patch.policy.allowedPlugins)) throw new Error('allowedPlugins 必须是字符串数组')
      // 允许组织名前缀（@scope/name，如 @deepseek-ai/dsh-base）
      if (patch.policy.allowedPlugins.some((x) => !/^(@[a-zA-Z0-9_-]{1,64}\/)?[a-zA-Z0-9_-]{2,64}$/.test(String(x)))) throw new Error('插件名限 2-64 位字母数字_-，可带 @组织/ 前缀（每项）')
    }
    if (patch.policy.pluginRegistry !== undefined) {
      const pr = patch.policy.pluginRegistry
      if (!['off', 'proxy', 'url'].includes(pr.mode)) throw new Error('pluginRegistry.mode 只能是 off/proxy/url')
      if (pr.mode === 'proxy') {
        try { const u = new URL(pr.npmRegistryUrl ?? ''); if (!/^https?:$/.test(u.protocol)) throw 0 } catch { throw new Error('proxy 模式需要合法 http(s) npmRegistryUrl') }
      }
      if (pr.mode === 'url' && !/^(https?|file):\/\//.test(pr.packagePrefix ?? '')) throw new Error('url 模式需要 http(s):// 或 file:// 开头的 packagePrefix')
      patch.policy.pluginRegistry = { allowedFallback: pr.allowedFallback !== false, ...pr }
    }
    if (patch.policy.clientRules !== undefined) {
      if (!Array.isArray(patch.policy.clientRules) || patch.policy.clientRules.length > 100) throw new Error('clientRules 必须是数组且 ≤100 条')
      const TYPES = ['block-url', 'block-word', 'block-plugin', 'force-default-model', 'notice']
      const seen = new Set()
      patch.policy.clientRules = patch.policy.clientRules.map((r, i) => {
        if (!r || !/^[a-zA-Z0-9_-]{2,32}$/.test(r.id ?? '')) throw new Error(`第 ${i + 1} 条规则 ID 限 2-32 位字母数字_-`)
        if (seen.has(r.id)) throw new Error(`规则 ID 重复: ${r.id}`)
        seen.add(r.id)
        if (!TYPES.includes(r.type)) throw new Error(`规则 ${r.id} 的 type 只能是 ${TYPES.join('/')}`)
        return {
          id: r.id,
          type: r.type,
          action: r.action === 'warn' ? 'warn' : 'block',           // 缺省 block；notice 型忽略 action
          value: String(r.value ?? '').slice(0, 500),
          message: String(r.message ?? '').slice(0, 200),
        }
      })
      // 公告只保留 1 条：新增/修改后若存在多条公告，保留列表最后一条（最新），其余自动淘汰
      const notices = patch.policy.clientRules.filter((r) => r.type === 'notice')
      if (notices.length > 1) {
        const keep = notices[notices.length - 1]
        patch.policy.clientRules = patch.policy.clientRules.filter((r) => r.type !== 'notice' || r === keep)
      }
    }
    if (patch.policy.bannerPosition !== undefined) {
      if (!['top-right', 'top-center', 'top-left', 'bottom-right'].includes(patch.policy.bannerPosition)) throw new Error('bannerPosition 只能是 top-right/top-center/top-left/bottom-right')
    }
    if (patch.policy.watermarkStyle !== undefined && patch.policy.watermarkStyle !== null) {
      const ws = patch.policy.watermarkStyle
      if (typeof ws !== 'object' || Array.isArray(ws)) throw new Error('watermarkStyle 必须是对象或 null')
      const out = {}
      if (ws.template !== undefined) out.template = String(ws.template ?? '').slice(0, 200)       // 模板：支持 {user} {time} {device}
      if (ws.color !== undefined) { if (typeof ws.color !== 'string' || !/^#[0-9a-fA-F]{3,8}$/.test(ws.color)) throw new Error('watermarkStyle.color 必须是 #RRGGBB'); out.color = ws.color }
      if (ws.opacity !== undefined) { const n = Number(ws.opacity); if (!Number.isFinite(n) || n < 0.01 || n > 0.5) throw new Error('watermarkStyle.opacity 限 0.01-0.5'); out.opacity = n }
      if (ws.fontSize !== undefined) { const n = Number(ws.fontSize); if (!Number.isFinite(n) || n < 8 || n > 40) throw new Error('watermarkStyle.fontSize 限 8-40'); out.fontSize = n }
      if (ws.gapX !== undefined) { const n = Number(ws.gapX); if (!Number.isFinite(n) || n < 80 || n > 800) throw new Error('watermarkStyle.gapX 限 80-800'); out.gapX = n }
      if (ws.gapY !== undefined) { const n = Number(ws.gapY); if (!Number.isFinite(n) || n < 50 || n > 600) throw new Error('watermarkStyle.gapY 限 50-600'); out.gapY = n }
      if (ws.angle !== undefined) { const n = Number(ws.angle); if (!Number.isFinite(n) || n < -90 || n > 90) throw new Error('watermarkStyle.angle 限 -90-90'); out.angle = n }
      patch.policy.watermarkStyle = Object.keys(out).length ? out : null
    }
    if (patch.policy.bannerStyle !== undefined && patch.policy.bannerStyle !== null) {
      const bs = patch.policy.bannerStyle
      if (typeof bs !== 'object' || Array.isArray(bs)) throw new Error('bannerStyle 必须是对象或 null')
      for (const k of ['maxWidth', 'top', 'right', 'bottom', 'left']) {
        if (bs[k] !== undefined && bs[k] !== null) {
          const n = Number(bs[k])
          if (!Number.isFinite(n) || n < 0 || n > 4000) throw new Error(`bannerStyle.${k} 必须是 0-4000 的数字`)
          bs[k] = n
        }
      }
      // 颜色字段（bg/border/color）已废弃：横幅配色按类型固定（拦截红/提醒橙/公告蓝），传入直接丢弃
      delete bs.bg; delete bs.border; delete bs.color
      if (Object.keys(bs).length === 0) patch.policy.bannerStyle = null
    }
    Object.assign(config.policy, patch.policy)
  }
  if (patch.audit) {
    for (const k of ['retentionDays', 'maxContentChars', 'activityDays', 'activityLogins', 'activityDevices', 'activityUsage']) {
      if (patch.audit[k] !== undefined) {
        const n = Number(patch.audit[k])
        if (!Number.isInteger(n) || n <= 0 || n > 10_000_000) throw new Error(`${k} 必须是正整数`)
        patch.audit[k] = n
      }
    }
    Object.assign(config.audit, patch.audit)
  }
  if (patch.dlp?.rules !== undefined) {
    if (!Array.isArray(patch.dlp.rules) || patch.dlp.rules.length > 50) throw new Error('DLP 规则必须是数组且 ≤50 条')
    const seen = new Set()
    const clean = patch.dlp.rules.map((r, i) => {
      if (!r || !/^[a-zA-Z0-9_-]{2,32}$/.test(r.id ?? '')) throw new Error(`第 ${i + 1} 条规则 ID 限 2-32 位字母数字_-`)
      if (seen.has(r.id)) throw new Error(`规则 ID 重复: ${r.id}`)
      seen.add(r.id)
      try { new RegExp(r.pattern ?? '') } catch { throw new Error(`规则 ${r.id} 的正则不合法`) }
      if (!['block', 'mask', 'log'].includes(r.action)) throw new Error(`规则 ${r.id} 的 action 只能是 block/mask/log`)
      return { id: r.id, pattern: String(r.pattern ?? ''), action: r.action, label: String(r.label ?? r.id).slice(0, 40) }
    })
    config.dlp.rules = clean
  }
  if (patch.dlp?.enabled !== undefined) config.dlp.enabled = patch.dlp.enabled
  if (patch.loginProtection) {
    for (const k of ['maxFails', 'windowMin', 'lockMin']) {
      if (patch.loginProtection[k] !== undefined) {
        const n = Number(patch.loginProtection[k])
        if (!Number.isInteger(n) || n < 1 || n > 1440) throw new Error(`loginProtection.${k} 须为 1-1440 整数`)
        patch.loginProtection[k] = n
      }
    }
    config.auth.loginProtection = { ...(config.auth.loginProtection ?? {}), ...patch.loginProtection, enabled: patch.loginProtection.enabled !== false }
  }
  if (_shouldBump) bumpPolicyVersion()
  saveConfig()
  return config
}

/* ---------- 策略版本管理 + 灰度发布 ----------
   - policy.version: 每次客户端相关策略热更自动递增 patch 位（1.0.N）
   - data/policy-versions.json: 版本快照 [{version, policy, ts, note}]（灰度/回滚的数据源）
   - policy.gray: { version, percent } —— version=null=无灰度（全员 current）；percent=设备哈希分流比例 */
const versionsPath = join(DATA_DIR, 'policy-versions.json')
const POLICY_BUMP_KEYS = ['clientRules', 'bannerPosition', 'bannerStyle', 'watermark', 'watermarkStyle', 'lockModelConfig', 'disabledFeatures', 'allowedPlugins', 'pluginRegistry']

export function bumpPolicyVersion(note = '') {
  const cur = String(config.policy.version ?? '1.0.0')
  const m = cur.match(/^(\d+)\.(\d+)\.(\d+)$/)
  const [maj, min, pat] = m ? [Number(m[1]), Number(m[2]), Number(m[3]) + 1] : [1, 0, 1]
  config.policy.version = `${maj}.${min}.${pat}`
  try {
    mkdirSync(dirname(versionsPath), { recursive: true })
    let list = []
    try { list = JSON.parse(readFileSync(versionsPath, 'utf8')) } catch { /* 首次 */ }
    // 快照：仅客户端相关字段（完整 policy 太大且含服务端无关项）
    const snap = {}
    for (const k of POLICY_BUMP_KEYS) if (config.policy[k] !== undefined) snap[k] = config.policy[k]
    list.unshift({ version: config.policy.version, policy: snap, ts: new Date().toISOString().slice(0, 19).replace('T', ' '), note: String(note ?? '').slice(0, 100) })
    if (list.length > 50) list.length = 50      // 最多留 50 版
    writeFileSync(versionsPath, JSON.stringify(list, null, 2))
  } catch (e) { console.warn(`[config] 版本快照写入失败: ${e.message}`) }
}

/** 版本快照列表（管理台版本历史页） */
export function listPolicyVersions() {
  try { return JSON.parse(readFileSync(versionsPath, 'utf8')) ?? [] } catch { return [] }
}

/** 转正：清除灰度指向（全员拉 current） */
export function promoteGray() { config.policy.gray = null; saveConfig() }

/** 设灰度：version=灰度版本号，percent=0-100 */
export function setGray(version, percent) {
  if (version !== null) {
    const hit = listPolicyVersions().find((v) => v.version === version)
    if (!hit) throw new Error(`灰度版本 ${version} 不在版本历史中`)
    const n = Number(percent)
    if (!Number.isInteger(n) || n < 0 || n > 100) throw new Error('灰度比例须为 0-100 整数')
    config.policy.gray = { version, percent: n }
  } else {
    config.policy.gray = null
  }
  saveConfig()
}

/** 回滚：把指定版本的快照写回当前策略（内容回退，版本继续向前 bump——回滚也是一次变更） */
export function rollbackPolicy(version, note = '') {
  const hit = listPolicyVersions().find((v) => v.version === version)
  if (!hit) throw new Error(`版本 ${version} 不在版本历史中`)
  Object.assign(config.policy, structuredClone(hit.policy))
  bumpPolicyVersion(note ? `回滚自 ${version}: ${note}` : `回滚自 ${version}`)
  saveConfig()
  return config.policy.version
}

/** 员工端设备哈希 → 是否命中灰度（同哈希永远同侧，稳定不横跳） */
export function grayHit(deviceHash) {
  const gray = config.policy.gray
  if (!gray?.version || !deviceHash) return false
  let h = 0
  const s = String(deviceHash)
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0
  return (h % 100) < (Number(gray.percent) || 0)
}

/** 按设备取应下发的策略：灰度命中 → 灰度版快照合并 current 基座；否则 current */
export function policyForDevice(deviceHash) {
  const gray = config.policy.gray
  if (gray?.version && grayHit(deviceHash)) {
    const hit = listPolicyVersions().find((v) => v.version === gray.version)
    if (hit) return { ...structuredClone(config.policy), ...structuredClone(hit.policy), grayActive: true }
  }
  return config.policy
}

/** 将当前配置写回配置文件（热更落盘；保留非托管字段如 auth，密钥不落明文以外泄） */
export function saveConfig() {
  try {
    mkdirSync(dirname(configPath), { recursive: true })
    let prev = {}
    try { prev = JSON.parse(readFileSync(configPath, 'utf8')) } catch { /* 全新写入 */ }
    const managed = {
      plugins: config.plugins,
      policy: config.policy,
      audit: config.audit,
      dlp: config.dlp,
      // 密钥明文绝不落配置文件：只写 apiKeyEnv 引用（明文在 data/.env）
      providers: config.providers.map((p) => ({ ...p, apiKey: null, apiKeyEnv: p.apiKeyEnv ?? null })),
      models: config.models,
    }
    const out = { ...prev, ...managed }
    // 历史明文残留一并清除（已迁 .env 或仍引用环境变量）
    if (Array.isArray(out.providers)) for (const p of out.providers) p.apiKey = null
    if (prev.auth) out.auth = prev.auth
    // loginProtection 是运行时可热更字段，需要持久化（deviceTokens 等其余 auth 字段仍以文件为准）
    if (config.auth?.loginProtection) out.auth = { ...(out.auth ?? {}), loginProtection: config.auth.loginProtection }
    delete out.channels       // 迁移后清除旧结构
    delete out.publicModels
    writeFileSync(configPath, JSON.stringify(out, null, 2))
  } catch (e) {
    console.warn(`[config] 热更落盘失败（内存中仍生效）: ${e.message}`)
  }
}

export function resolveProviderApiKey(prov) {
  // apiKey 为「<…>」尖括号占位文本（example 模板示例值）时不当作真密钥，继续走 apiKeyEnv
  const direct = prov.apiKey?.trim()
  if (direct && !direct.startsWith('<')) return direct
  if (prov.apiKeyEnv && process.env[prov.apiKeyEnv]) return process.env[prov.apiKeyEnv]
  return null
}

/** 插件开关持久化（管理面 PATCH /admin/plugins/:name）：落盘 gateway-config.json，重启后生效 */
export function setPluginEnabled(name, enabled) {
  config.plugins = config.plugins ?? {}
  const cur = config.plugins[name] ?? {}
  config.plugins[name] = { ...cur, enabled: !!enabled }
  saveConfig()
  return config.plugins[name]
}

/** 插件自有配置持久化（浅合并进 plugins.<name>.config 并落盘）：
 *  插件的「设置面」统一走这里——各插件自行定义 config schema 与校验，本函数只负责合并与落盘 */
export function setPluginConfig(name, cfgPatch) {
  if (!cfgPatch || typeof cfgPatch !== 'object' || Array.isArray(cfgPatch)) throw new Error('插件配置必须是对象')
  config.plugins = config.plugins ?? {}
  const cur = config.plugins[name] ?? {}
  config.plugins[name] = { ...cur, config: { ...(cur.config ?? {}), ...cfgPatch } }
  saveConfig()
  return config.plugins[name]
}

/* ---------- 路由：模型 → 供应商 ---------- */

/** 供应商熔断器：请求级快速失败——主家某次请求失败后 60s 内后续请求直接走容灾，
 *  不再反复试主家吃失败延迟（测活停用是分钟级兜底，熔断是秒级补救，二者互补）。
 *  pid → { openUntil }。测活成功/请求成功即复位。 */
const breaker = new Map()
const BREAKER_COOLDOWN_MS = 60_000

/** 请求成功 / 测活成功：复位熔断 */
export function markProviderOk(pid) {
  breaker.delete(pid)
}

/** 请求失败（HTTP 4xx/5xx、超时、连接异常）：熔断 60s */
export function markProviderFail(pid) {
  breaker.set(pid, { openUntil: Date.now() + BREAKER_COOLDOWN_MS })
}

export const breakerOpen = (pid) => (breaker.get(pid)?.openUntil ?? 0) > Date.now()

/** 查模型定义（含上下架与承载校验） */
export const findModel = (entModel) => config.models.find((m) => m.id === entModel && m.enabled !== false)

/** 主路由：模型 → 其 Provider（主家禁用或熔断中 → 直接试 fallback，员工请求不吃失败延迟） */
export function pickRoute(entModel) {
  const model = findModel(entModel)
  if (!model) return null
  const primary = config.providers.find((p) => p.id === model.providerId && p.enabled)
  if (primary && !breakerOpen(primary.id)) return { model, provider: primary }
  for (const fid of model.fallbackProviders ?? []) {
    const p = config.providers.find((x) => x.id === fid && x.enabled && !breakerOpen(x.id))
    if (p) return { model, provider: p, viaFallback: true }
  }
  // 全熔断/禁用时仍兜底返回主家（宁可让它再失败一次也不直接 502）
  if (primary) return { model, provider: primary }
  return null
}

/** 容灾：主 Provider 失败后按 fallbackProviders 依次尝试。
 *  顺序 = 主家在前、容灾在后（fallbackProviders 是"主家失败后的备选顺序"，
 *  不是前置优先级——若放主家前面，主家失败时 indexOf 指向链尾，容灾永远轮不到） */
export function failoverRoute(entModel, failedProviderId) {
  const model = findModel(entModel)
  if (!model) return null
  const chain = [model.providerId, ...(model.fallbackProviders ?? [])]
  const idx = chain.indexOf(failedProviderId)
  for (let i = idx + 1; i < chain.length; i++) {
    const p = config.providers.find((x) => x.id === chain[i] && x.enabled)
    if (p) return { model, provider: p, viaFallback: true }
  }
  return null
}

/* ---------- 供应商 CRUD ---------- */

function validateProvider(p, { partial = false, selfId = null } = {}) {
  const idToCheck = partial ? p.newId : p.id
  if (!partial || idToCheck !== undefined) {
    if (!/^[a-zA-Z0-9_-]{2,40}$/.test(idToCheck ?? '')) return { ok: false, error: '供应商 ID 限 2-40 位字母数字_-' }
    if (config.providers.some((x) => x.id === idToCheck && x.id !== selfId)) return { ok: false, error: `供应商 ID 已存在: ${idToCheck}` }
  }
  if (!partial || p.name !== undefined) {
    if (!p.name || String(p.name).length > 60) return { ok: false, error: '名称必填且 ≤60 字' }
  }
  if (!partial || p.baseUrl !== undefined) {
    try { const u = new URL(p.baseUrl ?? ''); if (!/^https?:$/.test(u.protocol)) throw 0 } catch { return { ok: false, error: 'baseUrl 必须是合法 http(s) 地址' } }
  }
  if (p.protocol !== undefined && !['openai', 'anthropic', 'gemini'].includes(p.protocol)) {
    return { ok: false, error: 'protocol 只能是 openai | anthropic | gemini' }
  }
  if (p.weight !== undefined && (!Number.isFinite(Number(p.weight)) || Number(p.weight) < 0 || Number(p.weight) > 1000)) return { ok: false, error: 'weight 须为 0-1000' }
  if (p.timeoutMs !== undefined && (!Number.isFinite(Number(p.timeoutMs)) || Number(p.timeoutMs) < 1000 || Number(p.timeoutMs) > 600000)) return { ok: false, error: 'timeoutMs 须在 1000-600000' }
  // 测活配置：probeEnabled 开关 · probeIntervalSec 5-600 · probeFailLimit 1-10 · probeAutoRecover 恢复自动启用
  if (p.probeIntervalSec !== undefined && (!Number.isFinite(Number(p.probeIntervalSec)) || Number(p.probeIntervalSec) < 5 || Number(p.probeIntervalSec) > 600)) return { ok: false, error: '测活间隔须在 5-600 秒' }
  if (p.probeFailLimit !== undefined && (!Number.isFinite(Number(p.probeFailLimit)) || Number(p.probeFailLimit) < 1 || Number(p.probeFailLimit) > 10)) return { ok: false, error: '测活失败次数须在 1-10' }
  return { ok: true }
}

/** 管理台输入的明文密钥 → 落 data/.env，配置里只留 apiKeyEnv 引用（永不明文进 gateway-config.json） */
const PROVIDER_ENV_PREFIX = 'ENT_PROV_'
const envKeyOf = (pid) => PROVIDER_ENV_PREFIX + pid.toUpperCase().replace(/[^A-Z0-9]/g, '_') + '_KEY'

function storeProviderKey(providerId, plaintext) {
  const key = envKeyOf(providerId)
  writeDotEnv(key, plaintext)
  console.log(`[config] 供应商 ${providerId} 的 API Key 已写入 ${envFilePath}（配置文件仅存变量名引用）`)
  return key
}

export function createProvider(p) {
  const v = validateProvider(p)
  if (!v.ok) return v
  const id = p.id
  let apiKeyEnv = p.apiKeyEnv ?? null
  // 明文密钥 → 落 .env；配置只存引用
  if (p.apiKey?.trim() && !p.apiKey.trim().startsWith('<')) apiKeyEnv = storeProviderKey(id, p.apiKey.trim())
  config.providers.push({
    id, name: p.name, baseUrl: p.baseUrl,
    protocol: ['openai', 'anthropic', 'gemini'].includes(p.protocol) ? p.protocol : 'openai',
    apiKeyEnv,
    apiKey: null,   // 明文不落配置文件（历史遗留字段保留 null）
    timeoutMs: p.timeoutMs ?? 120000, weight: p.weight ?? 10,
    enabled: p.enabled !== false,
    // 测活：默认开启 · 15s · 连续 2 次失败停用 · 恢复后自动重新启用
    probeEnabled: p.probeEnabled !== false,
    probeIntervalSec: p.probeIntervalSec ?? 15,
    probeFailLimit: p.probeFailLimit ?? 2,
    probeAutoRecover: p.probeAutoRecover !== false,
  })
  saveConfig()
  return { ok: true }
}

export function updateProvider(id, patch) {
  const prov = config.providers.find((x) => x.id === id)
  if (!prov) return { ok: false, error: '供应商不存在' }
  const v = validateProvider(patch, { partial: true, selfId: id })
  if (!v.ok) return v
  // 改名（级联）：所有挂载/容灾引用自动指向新 ID；.env 变量名同步迁移
  if (patch.newId !== undefined && patch.newId !== id) {
    prov.id = patch.newId
    for (const m of config.models) {
      if (m.providerId === id) m.providerId = patch.newId
      if (Array.isArray(m.fallbackProviders)) {
        m.fallbackProviders = m.fallbackProviders.map((f) => (f === id ? patch.newId : f))
      }
    }
    const oldEnv = envKeyOf(id)
    if (prov.apiKeyEnv === oldEnv && process.env[oldEnv] !== undefined) {
      const newEnv = storeProviderKey(patch.newId, process.env[oldEnv])
      removeDotEnv(oldEnv)
      prov.apiKeyEnv = newEnv
    }
  }
  if (patch.name !== undefined) prov.name = patch.name
  if (patch.baseUrl !== undefined) prov.baseUrl = patch.baseUrl
  if (patch.protocol !== undefined) prov.protocol = patch.protocol
  if (patch.apiKeyEnv !== undefined) prov.apiKeyEnv = patch.apiKeyEnv || null
  // 明文密钥：落 .env 转 apiKeyEnv 引用；空字符串 = 显式清除
  if (patch.apiKey !== undefined) {
    const plain = String(patch.apiKey ?? '').trim()
    if (plain && !plain.startsWith('<')) {
      prov.apiKeyEnv = storeProviderKey(prov.id, plain)
      prov.apiKey = null
    } else if (plain === '' && patch.apiKey === '') {
      // 显式清空：清 .env 变量 + 引用（仅当请求明确传空串，而非未传）
      if (prov.apiKeyEnv?.startsWith(PROVIDER_ENV_PREFIX)) removeDotEnv(prov.apiKeyEnv)
      prov.apiKeyEnv = null
      prov.apiKey = null
    }
  }
  if (patch.timeoutMs !== undefined) prov.timeoutMs = Number(patch.timeoutMs)
  if (patch.weight !== undefined) prov.weight = Math.max(0, Number(patch.weight) || 0)
  // 测活配置
  if (patch.probeEnabled !== undefined) prov.probeEnabled = !!patch.probeEnabled
  if (patch.probeIntervalSec !== undefined) prov.probeIntervalSec = Number(patch.probeIntervalSec)
  if (patch.probeFailLimit !== undefined) prov.probeFailLimit = Number(patch.probeFailLimit)
  if (patch.probeAutoRecover !== undefined) prov.probeAutoRecover = !!patch.probeAutoRecover
  if (patch.enabled !== undefined) {
    prov.enabled = !!patch.enabled
    // 手动启用供应商：立刻复位熔断（否则停用期间累积的熔断冷却会继续把请求推给容灾 ~60s，
    // 管理员"恢复后终端还在走容灾"的感知即来源于此）
    if (prov.enabled) markProviderOk(prov.id)
  }
  saveConfig()
  return { ok: true }
}

export function deleteProvider(id) {
  const idx = config.providers.findIndex((x) => x.id === id)
  if (idx === -1) return { ok: false, error: '供应商不存在' }
  const used = config.models.filter((m) => m.providerId === id || (m.fallbackProviders ?? []).includes(id))
  if (used.length) return { ok: false, error: `仍有 ${used.length} 个模型挂在该供应商下（${used.map((m) => m.id).join(', ')}），请先迁移或删除` }
  // 清掉 .env 里本供应商专属的密钥变量（手动配置的 UPSTREAM_API_KEY 等通用名不动）
  const prov = config.providers[idx]
  if (prov.apiKeyEnv?.startsWith(PROVIDER_ENV_PREFIX)) removeDotEnv(prov.apiKeyEnv)
  config.providers.splice(idx, 1)
  saveConfig()
  return { ok: true }
}

/* ---------- 模型 CRUD（精细化管理） ---------- */
/* 上游探活/测试逻辑已拆至 src/probe.mjs（testProvider / probeProviderModel /
 * probeProviderModelLevels / probeProviderAll）；本模块只负责配置分层与目录 CRUD */

const THINKING_LEVELS = ['off', 'low', 'medium', 'high']

function validateModel(m, { partial = false, selfId = null } = {}) {
  const nameToCheck = partial ? m.newId : m.id
  if (!partial || nameToCheck !== undefined) {
    if (!/^[a-zA-Z0-9._-]{2,80}$/.test(nameToCheck ?? '')) return { ok: false, error: '模型名限 2-80 位字母数字._-' }
    if (config.models.some((x) => x.id === nameToCheck && x.id !== selfId)) return { ok: false, error: `模型已存在: ${nameToCheck}` }
  }
  if (m.providerId !== undefined && m.providerId === '') return { ok: false, error: '必须选择供应商（先新增供应商再上架模型）' }
  if (m.providerId !== undefined && !config.providers.some((p) => p.id === m.providerId)) return { ok: false, error: `供应商不存在: ${m.providerId}（请先在供应商列表新增）` }
  if (m.upstreamModel !== undefined && (!m.upstreamModel || String(m.upstreamModel).length > 120)) return { ok: false, error: 'upstreamModel 不合法' }
  if (!partial || m.upstreamModel !== undefined) {
    if (m.upstreamModel !== undefined || !partial) {
      if (!m.upstreamModel && !partial) return { ok: false, error: 'upstreamModel（上游模型名）必填' }
    }
  }
  if (m.mode !== undefined && !['chat', 'reasoning'].includes(m.mode)) return { ok: false, error: 'mode 只能是 chat | reasoning' }
  if (m.thinking !== undefined && !['none', 'optional', 'always'].includes(m.thinking)) return { ok: false, error: 'thinking 只能是 none | optional | always' }
  // 档位名单可手工维护：各家上游档位体系不同（minimal/xhigh/budget-8k…），
  // 只约束字符集，不再限定固定四档；'off' 恒为关闭档
  const LEVEL_RE = /^[a-zA-Z0-9_-]{1,32}$/
  if (m.defaultThinking !== undefined && !LEVEL_RE.test(m.defaultThinking)) return { ok: false, error: 'defaultThinking 只能是 1-32 位字母数字_-（如 off/low/minimal/budget-8k）' }
  if (m.inputModes !== undefined) {
    if (!Array.isArray(m.inputModes)) return { ok: false, error: 'inputModes 必须是数组' }
    const legal = ['text', 'image', 'video', 'audio']
    if (m.inputModes.some((x) => !legal.includes(x))) return { ok: false, error: `inputModes 只能含 ${legal.join('/')}` }
    if (!m.inputModes.includes('text')) return { ok: false, error: 'inputModes 必须包含 text（纯文本是底线能力）' }
  }
  // thinkingLevels 校验时合并"现值+新值"（partial 更新可能只传其一），档位名单与默认档互相约束
  const effLevels = m.thinkingLevels ?? config.models.find((x) => x.id === selfId)?.thinkingLevels
  if (m.thinkingLevels !== undefined) {
    if (!Array.isArray(m.thinkingLevels)) return { ok: false, error: 'thinkingLevels 必须是数组' }
    if (m.thinkingLevels.some((x) => !LEVEL_RE.test(String(x)))) return { ok: false, error: '档位名限 1-32 位字母数字_-（各家档位体系不同，可自由命名，off=关闭）' }
    if (m.thinkingLevels.length === 0) return { ok: false, error: 'thinkingLevels 至少一档' }
    if (m.defaultThinking !== undefined && !m.thinkingLevels.includes(m.defaultThinking)) return { ok: false, error: `默认档位 ${m.defaultThinking} 必须在 thinkingLevels 中` }
  } else if (m.defaultThinking !== undefined && effLevels && !effLevels.includes(m.defaultThinking)) {
    // partial 更新只传默认档：必须落在现有档位名单内（名单由探测应用维护）
    return { ok: false, error: `默认档位 ${m.defaultThinking} 不在现有 thinkingLevels 中` }
  }
  if (m.thinkingParams !== undefined) {
    if (m.thinkingParams === null) { /* 显式 null = 清空自定义参数，合法 */ }
    else {
      if (typeof m.thinkingParams !== 'object' || Array.isArray(m.thinkingParams)) return { ok: false, error: 'thinkingParams 必须是对象（档位名 → 注入上游的参数对象）' }
      for (const [lv, params] of Object.entries(m.thinkingParams)) {
        if (!LEVEL_RE.test(lv)) return { ok: false, error: `thinkingParams 档位名不合法: ${lv}` }
        if (effLevels && !effLevels.includes(lv)) return { ok: false, error: `thinkingParams 含未在 thinkingLevels 中声明的档位: ${lv}` }
        if (typeof params !== 'object' || params === null || Array.isArray(params)) return { ok: false, error: `thinkingParams[${lv}] 必须是参数对象（如 {"thinking":{"type":"enabled","budget_tokens":8192}}）` }
      }
    }
  }
  for (const k of ['pricePer1MIn', 'pricePer1MOut', 'pricePer1MCacheIn', 'contextWindow', 'maxTokens']) {
    if (m[k] !== undefined && (!Number.isFinite(Number(m[k])) || Number(m[k]) < 0)) return { ok: false, error: `${k} 必须是非负数字` }
  }
  if (m.fallbackProviders !== undefined) {
    if (!Array.isArray(m.fallbackProviders)) return { ok: false, error: 'fallbackProviders 必须是数组' }
    for (const fid of m.fallbackProviders) {
      if (!config.providers.some((p) => p.id === fid)) return { ok: false, error: `容灾供应商不存在: ${fid}` }
    }
  }
  return { ok: true }
}

export function createModel(m) {
  if (!m.providerId) return { ok: false, error: '必须选择供应商（先新增供应商再上架模型）' }
  const v = validateModel(m)
  if (!v.ok) return v
  config.models.push({
    id: m.id,
    displayName: m.displayName ?? m.id,
    providerId: m.providerId,
    upstreamModel: m.upstreamModel,
    contextWindow: Number(m.contextWindow) || 128000,
    maxTokens: Number(m.maxTokens) || 32768,
    inputModes: Array.isArray(m.inputModes) && m.inputModes.length ? m.inputModes : ['text'],
    mode: m.mode ?? 'chat',
    thinking: m.thinking ?? 'optional',
    thinkingLevels: Array.isArray(m.thinkingLevels) && m.thinkingLevels.length ? m.thinkingLevels : [...THINKING_LEVELS],
    ...(m.thinkingParams && typeof m.thinkingParams === 'object' && !Array.isArray(m.thinkingParams) ? { thinkingParams: m.thinkingParams } : {}),
    defaultThinking: m.defaultThinking ?? 'off',
    fallbackProviders: m.fallbackProviders ?? [],
    ...(m.upstreamModelByProvider && typeof m.upstreamModelByProvider === 'object' && !Array.isArray(m.upstreamModelByProvider) ? { upstreamModelByProvider: m.upstreamModelByProvider } : {}),
    pricePer1MIn: Number(m.pricePer1MIn ?? 0),
    pricePer1MOut: Number(m.pricePer1MOut ?? 0),
    pricePer1MCacheIn: Number(m.pricePer1MCacheIn ?? m.pricePer1MIn ?? 0),
    enabled: m.enabled !== false,
  })
  saveConfig()
  return { ok: true }
}

export function updateModel(id, patch) {
  const m = config.models.find((x) => x.id === id)
  if (!m) return { ok: false, error: '模型不存在' }
  const v = validateModel(patch, { partial: true, selfId: id })
  if (!v.ok) return v
  // 改名（员工端使用的模型 ID）：旧名立即失效，正在使用旧名的终端需换新名
  if (patch.newId !== undefined && patch.newId !== id) m.id = patch.newId
  for (const k of ['displayName', 'providerId', 'upstreamModel', 'mode', 'thinking', 'defaultThinking']) {
    if (patch[k] !== undefined) m[k] = patch[k]
  }
  if (patch.inputModes !== undefined) m.inputModes = patch.inputModes
  if (patch.thinkingLevels !== undefined) m.thinkingLevels = patch.thinkingLevels
  // 上次逐档测试结果（管理台持久化，弹窗自动显示用）：对象整体替换，null = 清除
  if (patch.lastProbe !== undefined) {
    if (patch.lastProbe === null) delete m.lastProbe
    else if (patch.lastProbe && typeof patch.lastProbe === 'object') m.lastProbe = patch.lastProbe
  }
  if (patch.thinkingParams !== undefined) {
    if (patch.thinkingParams === null) delete m.thinkingParams   // 显式 null = 清空
    else m.thinkingParams = patch.thinkingParams
  }
  for (const k of ['contextWindow', 'maxTokens', 'pricePer1MIn', 'pricePer1MOut', 'pricePer1MCacheIn']) {
    if (patch[k] !== undefined) m[k] = Number(patch[k])
  }
  if (patch.fallbackProviders !== undefined) m.fallbackProviders = patch.fallbackProviders
  if (patch.upstreamModelByProvider !== undefined) {
    // 显式 null = 清空映射；对象则只留合法字符串值（键 = 供应商 id）
    if (patch.upstreamModelByProvider === null) delete m.upstreamModelByProvider
    else if (patch.upstreamModelByProvider && typeof patch.upstreamModelByProvider === 'object' && !Array.isArray(patch.upstreamModelByProvider)) {
      const clean = {}
      for (const [pid, name] of Object.entries(patch.upstreamModelByProvider)) {
        if (typeof name === 'string' && name.trim()) clean[pid] = name.trim()
      }
      if (Object.keys(clean).length) m.upstreamModelByProvider = clean; else delete m.upstreamModelByProvider
    }
  }
  // 一致性收口：映射与 fallback 数组必须互相包含对方（历史 bug：只写映射丢勾选，容灾静默失效）
  if (patch.upstreamModelByProvider !== undefined || patch.fallbackProviders !== undefined) {
    const fb = new Set(m.fallbackProviders ?? [])
    const mapKeys = Object.keys(m.upstreamModelByProvider ?? {})
    for (const pid of mapKeys) fb.add(pid)                       // 映射里有 → 勾选补上
    for (const pid of [...fb]) if (!mapKeys.includes(pid)) fb.delete(pid)   // 勾选但没映射 → 移除（映射是配置容灾的唯一入口）
    m.fallbackProviders = [...fb]
    if (!m.fallbackProviders.length) m.fallbackProviders = []
    if ((m.fallbackProviders ?? []).length === 0) delete m.upstreamModelByProvider
  }
  if (patch.enabled !== undefined) m.enabled = !!patch.enabled
  saveConfig()
  return { ok: true }
}

export function deleteModel(id) {
  const idx = config.models.findIndex((x) => x.id === id)
  if (idx === -1) return { ok: false, error: '模型不存在' }
  config.models.splice(idx, 1)
  saveConfig()
  return { ok: true }
}

/** 计费单价表（供 /admin/usage）：in/out = 未命中输入/输出；cache = 缓存命中输入（未配置时回退 in，即全价计提） */
export function priceMap() {
  const out = {}
  for (const m of config.models) out[m.id] = { in: m.pricePer1MIn ?? 0, out: m.pricePer1MOut ?? 0, cache: m.pricePer1MCacheIn ?? m.pricePer1MIn ?? 0 }
  return out
}

export const sha16 = (s) => createHash('sha256').update(s).digest('hex').slice(0, 16)

function deepMerge(base, over) {
  for (const [k, v] of Object.entries(over)) {
    if (v && typeof v === 'object' && !Array.isArray(v) && typeof base[k] === 'object' && !Array.isArray(base[k])) {
      deepMerge(base[k], v)
    } else {
      base[k] = v
    }
  }
  return base
}
