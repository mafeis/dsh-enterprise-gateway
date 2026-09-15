/**
 * 路由处理器工厂 · Desktop 插件接口：策略快照 / 灰度回执 / 心跳
 * 由插件 ent-admin 装载（/policy/current、/policy/ack、/heartbeat 三条精确路由），服务依赖注入
 */
import { createHash } from 'node:crypto'
import { json, readJson } from '../core/http.mjs'

export function createPluginProtocolHandler({ config, store, auth }) {
  const { getConfig } = config
  const { insertAck, insertHeartbeat, latestHeartbeatDevice } = store

  return async function handlePlugin(req, res, path) {
    const cfg = getConfig()

    if (req.method === 'GET' && path === '/policy/current') {
      return json(res, 200, {
        ...cfg.policy,
        auditLevel: cfg.audit.level,
        dlpEnabled: cfg.dlp.enabled,
        dlpRuleCount: cfg.dlp.rules.length,
        gatewayBaseUrl: `http://127.0.0.1:${cfg.server.port}`,
        models: cfg.models.map((m) => m.id),
      })
    }
    if (req.method === 'POST' && path === '/policy/ack') {
      const b = await readJson(req)
      if (!b || !b.profile || !b.device || b.policyVersion === undefined) {
        return json(res, 400, { error: { message: '需要 profile、policyVersion、device', type: 'bad_request' } })
      }
      insertAck(String(b.profile), String(b.policyVersion), String(b.device))
      console.log(`[${new Date().toLocaleTimeString('zh-CN', { hour12: false })}] << 灰度回执: ${b.profile} v=${b.policyVersion}`)
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
        }))
        .digest('hex').slice(0, 16)
      // 插件管控：设备快照带已安装插件清单时，比对策略允许清单，返回违规项（客户端自动清理）
      // 注意 deviceJson 可能是 JSON 字符串（b.device 序列化 / store TEXT 列），必须先解析再取 .plugins
      const dev = (() => { try { return typeof deviceJson === 'string' ? JSON.parse(deviceJson) : deviceJson } catch { return null } })()
      const allowed = Array.isArray(cfg.policy.allowedPlugins) ? cfg.policy.allowedPlugins : []
      const installed = Array.isArray(dev?.plugins) ? dev.plugins : null
      const pluginViolations = (allowed.length && installed) ? installed.filter((x) => !allowed.includes(x)) : []
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
      return json(res, 200, { ok: true, deviceAccepted: deviceJson !== null, modelFingerprint: modelFp, pluginViolations, ...(authState ? { auth: authState } : {}) })
    }

    return false
  }
}
