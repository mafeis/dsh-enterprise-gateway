/**
 * 路由处理器工厂 · Desktop 插件接口：策略快照 / 灰度回执 / 心跳
 * 由插件 ent-admin 装载（/policy/current、/policy/ack、/heartbeat 三条精确路由），服务依赖注入
 */
import { createHash } from 'node:crypto'
import { json, readJson } from '../core/http.mjs'
import { listRepo } from '../core/repo-store.mjs'
import { licenseStatus } from '../license.mjs'
import * as storeImpl from '../store.mjs'

export function createPluginProtocolHandler({ config, store, auth }) {
  const { getConfig } = config
  const { insertAck, insertHeartbeat, latestHeartbeatDevice, recordPluginSightings, listGroups, groupOfUser } = store
  /** 策略下发附带插件元数据（管理员在插件仓库维护的中英描述）——仓库为空时省略该字段 */
  const pluginMeta = () => {
    try {
      const meta = {}
      for (const p of listRepo()) {
        if (p.description || p.descriptionEn) {
          meta[p.name] = { description: p.description ?? '', descriptionZh: p.description ?? '', descriptionEn: p.descriptionEn ?? '' }
        }
      }
      return Object.keys(meta).length ? meta : undefined
    } catch { return undefined }
  }

  /** 插件仓库各插件默认版本（客户端自动更新检测用：dsh-enterprise 比对自身 VERSION）——仓库为空时省略 */
  const pluginLatest = () => {
    try {
      const out = {}
      for (const p of listRepo()) {
        if (p.name && p.defaultVersion) out[p.name] = p.defaultVersion
      }
      return Object.keys(out).length ? out : undefined
    } catch { return undefined }
  }

  /** 带票请求按所在分组的模型白名单过滤目录 id（未分组/解析失败 = 全量） */
  const modelsForUser = async (req, cfg) => {
    let ids = cfg.models.map((m) => m.id)
    try {
      if (req.headers.authorization && auth) {
        const a = await auth.authenticate(req)
        if (a.ok) {
          const g = groupOfUser(a.user.username)
          if (g?.models?.length) ids = ids.filter((id) => g.models.includes(id))
        }
      }
    } catch { /* 分组解析失败回退全量 */ }
    return ids
  }

  /** 超限公告：授权超限/到期/席位不足时随策略下发（licenseNotice），客户端每次登录必弹；
   *  正常态不注入该字段——它不进管理台公告编辑（clientRules），对管理员不可见即「隐藏公告」。 */
  const licenseNotice = (cfg) => {
    try {
      const n = storeImpl.db.prepare('SELECT COUNT(*) c FROM users WHERE enabled = 1').get().c
      const st = licenseStatus(n, cfg.license?.key)
      if (st.state === 'over-limit' || st.state === 'invalid') return st.message
      return null
    } catch { return null }
  }

  return async function handlePlugin(req, res, path) {
    const cfg = getConfig()

    if (req.method === 'GET' && path === '/policy/current') {
      // 灰度分流：带票请求按票重算设备哈希（与 ack/heartbeat 同口径），命中灰度比例 → 下发灰度版策略；
      // 无票/未灰度 → current。同设备哈希恒定 → 同设备永远同侧，不会来回横跳。
      const dh = req.headers.authorization
        ? createHash('sha256').update(req.headers.authorization).digest('hex').slice(0, 16)
        : null
      const { policyForDevice } = config
      const effPolicy = policyForDevice ? policyForDevice(dh) : cfg.policy
      return json(res, 200, {
        ...effPolicy,
        grayActive: undefined,
        auditLevel: cfg.audit.level,
        dlpEnabled: cfg.dlp.enabled,
        dlpRuleCount: cfg.dlp.rules.length,
        // 用户端接入地址：管理员在客户端管控维护的局域网地址；未配置回退本机回环（仅同机可用）
        gatewayBaseUrl: cfg.policy.clientAccessUrl || `http://127.0.0.1:${cfg.server.port}`,
        models: await modelsForUser(req, cfg),
        pluginMeta: pluginMeta(),
        licenseNotice: licenseNotice(cfg) ?? undefined,
      })
    }
    if (req.method === 'POST' && path === '/policy/ack') {
      const b = await readJson(req)
      if (!b || !b.profile || !b.device || b.policyVersion === undefined) {
        return json(res, 400, { error: { message: '需要 profile、policyVersion、device', type: 'bad_request' } })
      }
      // 设备指纹与 /heartbeat 同口径（sha256(Authorization)）：旧客户端 device 恒传占位符
      // 'enterprise'，全员同指纹会让「已回执设备数」永远等于 1、灰度没法按设备核对——
      // 带票请求一律按票重算，仅无票请求才退回客户端自报值（兼容老协议校验）。
      const dh = req.headers.authorization
        ? createHash('sha256').update(req.headers.authorization).digest('hex').slice(0, 16)
        : String(b.device)
      insertAck(String(b.profile), String(b.policyVersion), dh)
      console.log(`[${new Date().toLocaleTimeString('zh-CN', { hour12: false })}] << 灰度回执: ${b.profile} v=${b.policyVersion} dev=${dh}`)
      return json(res, 200, { ok: true })
    }
    if (req.method === 'POST' && path === '/heartbeat') {
      const b = (await readJson(req)) ?? {}
      const dh = createHash('sha256').update(req.headers.authorization ?? req.headers['x-ent-device-token'] ?? '').digest('hex').slice(0, 16)
      // 增量上报：device 缺省时沿用该设备最新快照（客户端只发变化）
      let deviceJson = null
      if (b.device) {
        deviceJson = JSON.stringify(b.device)
      } else {
        deviceJson = latestHeartbeatDevice(dh)
      }
      insertHeartbeat({ device_hash: dh, profile: b.profile, env: b.env, policy_version: b.policyVersion, node_version: b.node, account: b.account, device_json: deviceJson })
      // 指纹包含 id + displayName + enabled + 供应商启停 + 容灾配置：下架/上架、停用供应商、
      // 改容灾（fallbackProviders/upstreamModelByProvider 影响 /v1/models 可见性与转发名）
      // 都必须让客户端感知（/v1/models 按"主家启用或有启用容灾"过滤，指纹漏了容灾
      // 则改容灾后终端模型目录永不刷新）
      const modelFp = createHash('sha256')
        .update(JSON.stringify({
          models: cfg.models.map((m) => [m.id, m.displayName ?? m.id, m.enabled !== false, m.fallbackProviders ?? [], m.upstreamModelByProvider ?? null]),
          providers: cfg.providers.map((p) => [p.id, p.enabled !== false]),
          // 分组模型可见性：管理员改任一分组的模型清单/额度后，所有终端指纹变化 → 自动重拉
          // /v1/models（带票，按各自分组过滤），模型目录随之刷新
          groups: listGroups().map((g) => [g.id, g.models, g.quota]),
        }))
        .digest('hex').slice(0, 16)
      // 插件管控：设备快照带已安装插件清单时，比对策略允许清单，返回违规项（客户端自动清理）
      // 注意 deviceJson 可能是 JSON 字符串（b.device 序列化 / store TEXT 列），必须先解析再取 .plugins
      const dev = (() => { try { return typeof deviceJson === 'string' ? JSON.parse(deviceJson) : deviceJson } catch { return null } })()
      const allowed = Array.isArray(cfg.policy.allowedPlugins) ? cfg.policy.allowedPlugins : []
      const installed = Array.isArray(dev?.plugins) ? dev.plugins : null
      const pluginViolations = (allowed.length && installed) ? installed.filter((x) => !allowed.includes(x)) : []
      // 插件出现史落库（含历史）：清单外即打违规标，快照里消失的插件标"已清除"但记录保留
      try { recordPluginSightings(dh, installed ?? [], { account: b.account, hostname: dev?.hostname, env: b.env, allowed }) } catch { /* 记录失败不影响心跳 */ }
      // deviceAccepted=false 告知客户端「网关无快照」，客户端下次强制全量
      // auth：账号状态显式透出（终端据此自动清场回登录页）——心跳不鉴权（设备遥测语义），
      // 但带 Bearer 时顺带 authenticate 一次，把停用/吊销/删除状态放进 200 响应；
      // 不带凭证（纯设备心跳）则 auth 为 null。客户端判定依据是显式状态而非 HTTP 状态码。
      const authState = await (async () => {
        if (!auth || !req.headers.authorization) return null
        try {
          const a = await auth.authenticate(req)
          return a.ok ? { ok: true, user: a.user?.username ?? '' } : { ok: false, reason: a.error?.type ?? 'auth_invalid' }
        } catch { return null }
      })()
      return json(res, 200, { ok: true, deviceAccepted: deviceJson !== null, modelFingerprint: modelFp, pluginViolations, pluginEnforce: cfg.policy.pluginEnforce ?? 'enforce', pluginLatest: pluginLatest(), ...(authState ? { auth: authState } : {}) })
    }

    return false
  }
}
