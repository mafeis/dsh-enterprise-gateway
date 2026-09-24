/**
 * 插件 ent-client · 客户端管控域（= 用户端协议 + 策略 API + 管理页面）
 * 路由：
 *   GET  /policy/current     用户端拉取策略快照（ent-protocol 并入）
 *   POST /policy/ack         用户端回执（灰度核对）
 *   POST /heartbeat          用户端心跳（在线终端数据源）
 *   PATCH /admin/policy      管理侧策略热更（安全防护页与客户端管控页共用；校验失败 400 绝不写坏）
 *   GET  /admin/policy-detail 管理侧策略详情（含 DLP 规则/留存/登录保护/清单/回执）
 *   GET/POST/PATCH/DELETE /admin/plugin-repo*  企业插件仓库管理（npm 拉取 / 压缩包上传 / 版本与描述 / npm 更新检查）
 *   GET  /plugin-packages/*  用户端插件包下载（url 模式 packagePrefix 指向这里）
 * 页面：客户端管控 → 4 个二级页（策略与开关 / 插件管控 / 自助规则 / 下发回执）
 * 实现模块：src/routes/plugin.mjs（协议）、src/core/repo-store.mjs（插件仓库存储）
 */
import { createPluginProtocolHandler } from '../routes/plugin.mjs'
import { json, readJson } from '../core/http.mjs'
import * as repo from '../core/repo-store.mjs'

export const name = 'ent-client'
export const provides = []
export const inject = ['config', 'store', 'auth', 'router']

/** 自带页面：客户端管控（一级菜单 + 4 个二级页，壳按 nav.children 渲染分组导航） */
export const admin = {
  nav: {
    id: 'client', title: '客户端管控', titleEn: 'Client Control', icon: 'monitor', order: 210,
    children: [
      { id: 'client-switches', title: '策略与开关', titleEn: 'Policy & Switches' },
      { id: 'client-plugins', title: '插件管控', titleEn: 'Plugin Control' },
      { id: 'client-rules', title: '本地规则', titleEn: 'Local Rules' },
      { id: 'client-acks', title: '下发回执', titleEn: 'Deploy Receipts' },
    ],
  },
  entry: 'index.mjs',
}

const ts = () => new Date().toLocaleTimeString('zh-CN', { hour12: false })

export function apply(ctx) {
  const router = ctx.get('router')
  const auth = ctx.get('auth')
  const { getConfig, patchConfig, listPolicyVersions, setGray, promoteGray, rollbackPolicy } = ctx.get('config')
  const { recentPolicyAcks, ackVersionStats, ackPendingDevices, onlineDeviceCount } = ctx.get('store')
  const handleProtocol = createPluginProtocolHandler({ config: ctx.get('config'), store: ctx.get('store'), auth })

  /* ---- 用户端协议（原 ent-protocol 并入：策略下发/回执/心跳） ---- */
  ctx.effect(() => router.exact('GET', '/policy/current', handleProtocol), 'ent-client: route GET /policy/current')
  ctx.effect(() => router.exact('POST', '/policy/ack', handleProtocol), 'ent-client: route POST /policy/ack')
  ctx.effect(() => router.exact('POST', '/heartbeat', handleProtocol), 'ent-client: route POST /heartbeat')

  /** 管理员鉴权（与 ent-console 管理面同一策略） */
  async function requireAdmin(req, res) {
    const a = await auth.authenticate(req)
    if (!a.ok) { json(res, a.status, { error: a.error }); return null }
    if (a.user.role !== 'admin') { json(res, 403, { error: { message: '需要管理员角色', type: 'forbidden' } }); return null }
    return a
  }

  /* ---- 策略热更（安全防护页与客户端管控页共用入口） ---- */
  ctx.effect(() => router.exact('PATCH', '/admin/policy', async (req, res) => {
    const u = await requireAdmin(req, res)
    if (!u) return true
    const patch = (await readJson(req)) ?? {}
    try {
      const next = patchConfig(patch)
      console.log(`[${ts()}] ⚙ 策略热更 by ${u.user.username}: keys=[${Object.keys(patch.policy ?? {})}] bannerPosition=${patch.policy?.bannerPosition} bannerStyle=${JSON.stringify(patch.policy?.bannerStyle ?? null)} rules=${(patch.policy?.clientRules ?? []).length}`)
      return json(res, 200, { ok: true, policy: next.policy, audit: next.audit, dlp: { enabled: next.dlp.enabled, rules: next.dlp.rules.length }, loginProtection: next.auth.loginProtection })
    } catch (e) {
      return json(res, 400, { error: { message: String(e.message ?? e).slice(0, 200), type: 'bad_request' } })
    }
  }), 'ent-client: route PATCH /admin/policy')

  /* ---- 策略版本管理：历史 / 灰度 / 转正 / 回滚 ---- */
  ctx.effect(() => router.exact('GET', '/admin/policy-versions', async (req, res) => {
    const u = await requireAdmin(req, res)
    if (!u) return true
    const c = getConfig()
    return json(res, 200, { versions: listPolicyVersions(), current: c.policy.version, gray: c.policy.gray ?? null })
  }), 'ent-client: route GET /admin/policy-versions')

  ctx.effect(() => router.exact('POST', '/admin/policy-gray', async (req, res) => {
    const u = await requireAdmin(req, res)
    if (!u) return true
    const b = (await readJson(req)) ?? {}
    try {
      setGray(b.version ?? null, b.percent)
      console.log(`[${ts()}] ⚙ 灰度设置 by ${u.user.username}: ${b.version ?? '(取消)'} @ ${b.percent ?? '-'}%`)
      return json(res, 200, { ok: true, gray: getConfig().policy.gray ?? null })
    } catch (e) {
      return json(res, 400, { error: { message: String(e.message ?? e).slice(0, 200), type: 'bad_request' } })
    }
  }), 'ent-client: route POST /admin/policy-gray')

  ctx.effect(() => router.exact('POST', '/admin/policy-promote', async (req, res) => {
    const u = await requireAdmin(req, res)
    if (!u) return true
    promoteGray()
    console.log(`[${ts()}] ⚙ 灰度转正 by ${u.user.username}: 全员拉 current`)
    return json(res, 200, { ok: true, gray: null })
  }), 'ent-client: route POST /admin/policy-promote')

  ctx.effect(() => router.exact('POST', '/admin/policy-rollback', async (req, res) => {
    const u = await requireAdmin(req, res)
    if (!u) return true
    const b = (await readJson(req)) ?? {}
    try {
      const ver = rollbackPolicy(String(b.version ?? ''), '管理台回滚')
      console.log(`[${ts()}] ⚙ 策略回滚 by ${u.user.username}: → ${ver}`)
      return json(res, 200, { ok: true, version: ver })
    } catch (e) {
      return json(res, 400, { error: { message: String(e.message ?? e).slice(0, 200), type: 'bad_request' } })
    }
  }), 'ent-client: route POST /admin/policy-rollback')

  ctx.effect(() => router.exact('GET', '/admin/policy-detail', async (req, res) => {
    const u = await requireAdmin(req, res)
    if (!u) return true
    const c = getConfig()
    return json(res, 200, {
      policy: c.policy,
      audit: c.audit,
      dlp: c.dlp,
      loginProtection: c.auth.loginProtection ?? { enabled: false, maxFails: 10, windowMin: 15, lockMin: 15 },
      acks: recentPolicyAcks(50),
      ackStats: { versions: ackVersionStats(), onlineDevices: onlineDeviceCount(1440) },
      pendingAcks: ackPendingDevices(c.policy?.version ?? null, 1440),
    })
  }), 'ent-client: route GET /admin/policy-detail')

  /* ---- 企业插件仓库：统一收口插件包（npm 拉取 / 压缩包上传），带版本管理 ---- */
  const readRaw = (req) => new Promise((resolve, reject) => {
    const chunks = []
    req.on('data', (c) => { chunks.push(c); if (chunks.reduce((s, b) => s + b.length, 0) > repo.MAX_TARBALL) { reject(new Error('包超过 64MB 上限')); req.destroy() } })
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })

  ctx.effect(() => router.exact('GET', '/admin/plugin-repo', async (req, res) => {
    const u = await requireAdmin(req, res)
    if (!u) return true
    return json(res, 200, { plugins: repo.listRepo() })
  }), 'ent-client: route GET /admin/plugin-repo')

  ctx.effect(() => router.exact('POST', '/admin/plugin-repo/check-updates', async (req, res) => {
    const u = await requireAdmin(req, res)
    if (!u) return true
    const r = await repo.checkNpmUpdates()
    console.log(`[${ts()}] 🔍 npm 更新检查 by ${u.user.username}: 可更新 ${r.updates.length}，源异常 ${r.errors.length}`)
    return json(res, 200, { ok: true, ...r, plugins: repo.listRepo() })
  }), 'ent-client: route POST /admin/plugin-repo/check-updates')

  ctx.effect(() => router.exact('POST', '/admin/plugin-repo/npm', async (req, res) => {
    const u = await requireAdmin(req, res)
    if (!u) return true
    const b = (await readJson(req)) ?? {}
    try {
      const r = await repo.addFromNpm({ spec: b.spec, registry: b.registry, by: u.user.username, note: b.note })
      console.log(`[${ts()}] 📦 插件入库 by ${u.user.username}: ${r.spec} → ${r.name}@${r.version}`)
      return json(res, 200, { ok: true, name: r.name, version: r.version })
    } catch (e) {
      return json(res, 400, { error: { message: String(e.message ?? e).slice(0, 300), type: 'bad_request' } })
    }
  }), 'ent-client: route POST /admin/plugin-repo/npm')

  ctx.effect(() => router.exact('POST', '/admin/plugin-repo/upload', async (req, res) => {
    const u = await requireAdmin(req, res)
    if (!u) return true
    try {
      const buf = await readRaw(req)
      const r = repo.addFromUpload(buf, { by: u.user.username, note: new URL(req.url, 'http://x').searchParams.get('note') ?? '' })
      console.log(`[${ts()}] 📦 插件上传 by ${u.user.username}: ${r.name}@${r.version} (${(buf.length / 1024).toFixed(0)}KB)`)
      return json(res, 200, { ok: true, name: r.name, version: r.version })
    } catch (e) {
      return json(res, 400, { error: { message: String(e.message ?? e).slice(0, 300), type: 'bad_request' } })
    }
  }), 'ent-client: route POST /admin/plugin-repo/upload')

  ctx.effect(() => router.prefix('/admin/plugin-repo/', async (req, res, urlPath) => {
    if (req.method !== 'PATCH' && req.method !== 'DELETE') return false
    const u = await requireAdmin(req, res)
    if (!u) return true
    const name = decodeURIComponent(urlPath.slice('/admin/plugin-repo/'.length).split('/')[0] ?? '')
    const b = req.method === 'PATCH' ? ((await readJson(req)) ?? {}) : {}
    try {
      if (req.method === 'PATCH') {
        if (b.defaultVersion) repo.setDefaultVersion(name, b.defaultVersion)
        if (b.note !== undefined && b.version) repo.setVersionNote(name, b.version, b.note)
        if (b.description !== undefined || b.descriptionEn !== undefined) {
          repo.setMeta(name, { description: b.description, descriptionEn: b.descriptionEn })
        }
      } else {
        const ver = decodeURIComponent(urlPath.slice('/admin/plugin-repo/'.length).split('/')[1] ?? '')
        if (ver) repo.removeVersion(name, ver)
        else repo.removePlugin(name)
      }
      console.log(`[${ts()}] 📦 插件仓库${req.method === 'PATCH' ? '更新' : '删除'} by ${u.user.username}: ${name}${b.defaultVersion ? ' → 默认 ' + b.defaultVersion : ''}`)
      return json(res, 200, { ok: true, plugins: repo.listRepo() })
    } catch (e) {
      return json(res, 400, { error: { message: String(e.message ?? e).slice(0, 200), type: 'bad_request' } })
    }
  }), 'ent-client: route PATCH/DELETE /admin/plugin-repo/:name(/:version)')

  /* ---- 用户端下载（url 模式 packagePrefix 指向这里；与 /policy/current 同级，不做管理鉴权） ----
   * GET /plugin-packages/<name>                → 默认版本 .tgz
   * GET /plugin-packages/<name>/<version>      → 指定版本
   * GET /plugin-packages/<name>/-/<file>.tgz   → npm tarball 风格路径
   */
  ctx.effect(() => router.prefix('/plugin-packages/', async (req, res, urlPath) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return false
    const rest = urlPath.slice('/plugin-packages/'.length)
    if (!rest || rest.includes('..')) return json(res, 404, { error: { message: 'not found', type: 'not_found' } })
    const segs = rest.split('/').filter(Boolean).map((s) => decodeURIComponent(s))
    let name = segs[0] ?? ''
    let ver = null
    if (segs.length >= 2 && segs[1] === '-') {
      // npm 风格：<file> = <name(可带 scope)-version.tgz>
      const m = (segs[2] ?? '').match(/^(.*)-(\d+\.\d+\.\d+(?:-[0-9A-Za-z.+-]+)?)\.tgz$/)
      if (m) { ver = m[2]; if (m[1] !== name) name = m[1] }
    } else if (segs.length === 2) {
      ver = segs[1]
    }
    const hit = repo.resolveTarball(name, ver)
    if (!hit) return json(res, 404, { error: { message: `仓库中没有 ${name}${ver ? '@' + ver : ''}`, type: 'not_found' } })
    res.writeHead(200, {
      'content-type': 'application/octet-stream',
      'content-disposition': `attachment; filename="${name.replace('/', '-')}-${hit.version}.tgz"`,
    })
    if (req.method === 'HEAD') return res.end()
    const { createReadStream } = await import('node:fs')
    createReadStream(hit.file).pipe(res)
  }), 'ent-client: route GET /plugin-packages/*')

  /* ---- npm 新版本定期检测（启动 15s 后首查，每 6h 一轮；结果写索引，仓库页角标提示） ---- */
  ctx.effect(() => {
    const first = setTimeout(() => { void repo.checkNpmUpdates().catch(() => {}) }, 15_000)
    const timer = setInterval(() => { void repo.checkNpmUpdates().catch(() => {}) }, 6 * 3600 * 1000)
    return () => { clearTimeout(first); clearInterval(timer) }
  }, 'ent-client: npm update check')
}
