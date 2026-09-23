/**
 * 插件 ent-desktop · 桌面客户端发布（企业自己的「客户端更新源」）
 *
 * 业务域：DSH Desktop 安装包的 检测 → 下载入库 → 发布 → 分发。
 * 解决的问题：安装脚本原本让每台客户端各自查 GitHub、版本与 sha 写死在脚本里，
 *   客户端一发新版就得改脚本重发网关包，内网机器还装不上。收口到网关后：
 *   客户端只从内网拉包（秒装、可离线），版本何时生效由管理员点「设为下发版本」决定。
 *
 * 路由：
 *   GET    /admin/desktop-repo            发布台数据（安装包 + 环境物料 + 设置）
 *   POST   /admin/desktop-repo/check      立即检测上游（autoSync 开时顺带拉包）
 *   POST   /admin/desktop-repo/sync       同步指定版本（可只同步 mac 或 win）
 *   PATCH  /admin/desktop-repo            改设置 / 设为下发版本（发布、回滚）/ 存 GitHub 令牌
 *   POST   /admin/desktop-repo/upload     离线上传安装包（不通公网的客户）
 *   DELETE /admin/desktop-repo/:version   删除某版本的本地包
 *   POST   /admin/env-repo/check|sync|upload   环境物料（Node / pnpm）同一套动作
 *   DELETE /admin/env-repo/:kind/:version      删除某类某版本的本地包
 *   GET    /setup/releases.json           用户端协议：当前下发版本 + 各平台包地址与 sha256（安装脚本的事实源）
 *   GET    /setup/packages/:platform[/:version]  安装包实体（支持 Range 续传）
 *   GET    /setup/env.json                用户端协议：装机环境物料（Node 各平台构建 + pnpm）
 *   GET    /setup/env/:kind/:platform[/:version] 环境物料实体（同样支持 Range）
 *
 * 页面：桌面客户端（二级页：版本清单 / 环境物料；页面资源在本插件 ent-desktop.web/）
 * 实现模块：src/core/desktop-repo.mjs（安装包）、src/core/env-repo.mjs（环境物料）、
 *          src/core/artifact-http.mjs（两者共用的下载与域名白名单原语）
 */
import { createReadStream, statSync } from 'node:fs'
import { json, readJson } from '../core/http.mjs'

/** 写接口的体必须解析成功：坏体直接 400，不能像 ?? {} 那样当空体「假装成功」 */
async function jsonOr400(req, res) {
  const b = await readJson(req)
  if (b === null) json(res, 400, { error: { message: '请求体不是合法 JSON（页面大概把对象直接当 body 发了）', type: 'bad_request' } })
  return b
}
import * as desktop from '../core/desktop-repo.mjs'
import * as env from '../core/env-repo.mjs'
import { writeDotEnv, removeDotEnv } from '../config.mjs'

export const name = 'ent-desktop'
export const provides = []
export const inject = ['config', 'auth', 'router', 'registry']

export const manifest = {
  capabilities: ['desktop.check', 'desktop.sync', 'desktop.publish', 'env.check', 'env.sync'],
}

/** 自带页面：桌面客户端（安装包 + 环境物料两个二级页）；icon 为 lucide 图标名（admin-web/icons.mjs 契约） */
export const admin = {
  nav: {
    id: 'desktop', title: '桌面客户端', titleEn: 'Desktop Releases', icon: 'download', order: 71,
    children: [
      { id: 'desktop-releases', title: '版本清单', titleEn: 'Releases' },
      { id: 'desktop-env', title: '环境物料', titleEn: 'Runtime Mirrors' },
      { id: 'desktop-settings', title: '下发设置', titleEn: 'Serving Settings' },
      { id: 'desktop-upload', title: '离线上传', titleEn: 'Offline Upload' },
    ],
  },
  entry: 'index.mjs',
}


const ts = () => new Date().toLocaleTimeString('zh-CN', { hour12: false })

export function apply(ctx) {
  const router = ctx.get('router')
  const auth = ctx.get('auth')
  const registry = ctx.get('registry')
  const { getConfig, setPluginConfig } = ctx.get('config')

  /** 当前设置（每次现读：管理台改完下一轮检测即生效，无需重启） */
  const settingsOf = () => desktop.resolveSettings(getConfig().plugins?.[name]?.config ?? {})

  /** 管理员鉴权（与其他业务域同一策略） */
  async function requireAdmin(req, res) {
    const a = await auth.authenticate(req)
    if (!a.ok) { json(res, a.status, { error: a.error }); return null }
    if (a.user.role !== 'admin') { json(res, 403, { error: { message: '需要管理员角色', type: 'forbidden' } }); return null }
    return a
  }

  /* ---------- 检测 + 自动入库（定时器与「立即检测」按钮共用同一条路径） ---------- */

  async function runCheck({ by = 'scheduler', sync = null, auto = true } = {}) {
    const cfg = settingsOf()
    const r = await desktop.checkUpdates(cfg)
    for (const version of r.fresh) {
      registry.emit('desktop.newVersion', { version, by })
      console.log(`[${ts()}] 🔍 发现新版客户端 ${version}（来源 ${cfg.feeds.join('/')}）`)
    }
    // autoSync：把「保留窗口内的最新几个版本」里还缺包的下下来。
    // 不自动改发布指针 —— 一次上游发版不该静默改变全员装到什么版本（发布要人点）。
    const synced = []
    const syncErrors = []   // 调用方要能分辨「一个包都没入库」和「入库了」——否则页面会谎报成功
    if ((auto && cfg.autoSync) || sync) {
      // 窗口 = 最新 N 个 + 当前下发版本（回滚到窗口外时，它的包也得给补回来）
      const pub = desktop.published().version
      const want = sync?.version
        ? [sync.version]
        : [...new Set([...desktop.knownVersions().slice(0, cfg.keepVersions), ...(pub ? [pub] : [])])]
      for (const version of want) {
        try {
          const s = await desktop.syncVersion(version, cfg, { platform: sync?.platform, by, force: !!sync?.force })
          synced.push(s)
          if (s.synced.length) {
            registry.emit('desktop.synced', { version, platforms: s.synced, by })
            console.log(`[${ts()}] 📦 客户端安装包入库 ${version}（${s.synced.join('/')}）by ${by}`)
          }
          for (const f of s.failed) {
            syncErrors.push(`${version} ${f}`)
            console.warn(`[${ts()}] ⚠ 客户端安装包同步失败 ${version}: ${f}`)
          }
          // 首选源失败但换源成功也要留痕：管理员要能看出「这个包其实是从镜像来的」
          for (const a of (s.attempts ?? []).filter((x) => !x.ok)) {
            console.warn(`[${ts()}] ⚠ 客户端安装包 ${version} ${a.platform} 源 ${a.source} 未成功：${a.error}`)
          }
        } catch (e) {
          const message = String(e?.message ?? e).slice(0, 160)
          syncErrors.push(`${version}: ${message}`)
          console.warn(`[${ts()}] ⚠ 客户端安装包同步 ${version} 失败: ${message}`)
        }
      }
    }
    return { ...r, synced, syncErrors }
  }

  /** 环境物料设置（Node / pnpm，与安装包同一个配置域，字段前缀 env/node/pnpm） */
  const envSettingsOf = () => env.resolveEnvSettings(getConfig().plugins?.[name]?.config ?? {})

  /* ---------- 环境物料检测 + 入库（Node LTS 构建 / pnpm 发行包） ----------
   * 装机脚本最后两处外网依赖就是 Node 本体与 pnpm 本体：插件零依赖、桌面 app 自带
   * @deepseek-ai/* 运行时，都不走 npm 源。把这两样镜像进来，纯内网才真能一键装完。
   */
  async function runEnvCheck({ by = 'scheduler', sync = null, auto = true } = {}) {
    const cfg = envSettingsOf()
    const r = await env.checkEnvUpstream(cfg)
    for (const key of r.fresh) {
      registry.emit('env.newArtifact', { key, by })
      console.log(`[${ts()}] 🔍 发现新版环境物料 ${key}`)
    }
    const synced = []
    const syncErrors = []
    const rows = env.envListVersions()
    // 先按 prune 的口径划出保留窗口（最新 N 个 + 已下发那个），再在窗口里找缺口。
    // 顺序反了就会去下窗口外的老版本：实体下一百来 MB，落盘即被清理，下一轮又下一遍。
    const publishedOf = env.envPublished().published
    const need = (kind, limit) => {
      const list = rows.find((x) => x.kind === kind)?.versions ?? []
      const win = new Set(list.slice(0, limit).map((v) => v.version))
      if (publishedOf?.[kind]) win.add(String(publishedOf[kind]))
      return list.filter((v) => win.has(v.version) && v.status !== 'ready').map((v) => v.version)
    }
    // 与安装包同一规矩：自动入库只到「本地已有可用包」为止，发布指针一律等人点
    const targets = sync
      ? [{ kind: sync.kind, version: sync.version }]
      : (auto && cfg.envAutoSync)
        ? [
          ...need('node', cfg.nodeKeepVersions).map((version) => ({ kind: 'node', version })),
          ...need('pnpm', cfg.pnpmKeepVersions).map((version) => ({ kind: 'pnpm', version })),
        ]
        : []
    for (const t of targets) {
      try {
        const s = await env.syncEnv(t.kind, t.version, cfg, { platform: sync?.platform, by, force: !!sync?.force })
        synced.push(s)
        if (s.synced.length) {
          registry.emit('env.synced', { kind: t.kind, version: t.version, platforms: s.synced, by })
          console.log(`[${ts()}] 📦 环境物料入库 ${t.kind} ${t.version}（${s.synced.join('/')}）by ${by}`)
        }
        for (const f of s.failed) {
          syncErrors.push(`${t.kind} ${t.version} ${f}`)
          console.warn(`[${ts()}] ⚠ 环境物料同步失败 ${t.kind} ${t.version}: ${f}`)
        }
        for (const a of (s.attempts ?? []).filter((x) => !x.ok)) {
          console.warn(`[${ts()}] ⚠ 环境物料 ${t.kind} ${t.version} ${a.platform} 源 ${a.source} 未成功：${a.error}`)
        }
      } catch (e) {
        const message = String(e?.message ?? e).slice(0, 160)
        syncErrors.push(`${t.kind} ${t.version}: ${message}`)
        console.warn(`[${ts()}] ⚠ 环境物料同步 ${t.kind} ${t.version} 失败: ${message}`)
      }
    }
    // 自动模式下「没有待同步目标」不算失败；手动点同步时一个包都没落地必须报出去
    const err = r.unreachable && !synced.length ? r.errors.map((e) => `${e.kind}/${e.feed}: ${e.error}`) : []
    return { ...r, synced, syncErrors: [...syncErrors, ...err] }
  }

  /* ---------- 管理台 ---------- */  ctx.effect(() => router.exact('GET', '/admin/desktop-repo', async (req, res) => {
    const u = await requireAdmin(req, res)
    if (!u) return true
    const cfg = settingsOf()
    return json(res, 200, {
      overview: desktop.overview(),
      versions: desktop.listVersions(),
      settings: { ...cfg, hasToken: !!process.env[cfg.githubTokenEnv] },
      defaults: desktop.DEFAULTS,
      platforms: desktop.PLATFORMS,
      // 环境物料与安装包同页不同二级页，一次取回（省一次往返，也让「发布中」状态两处一致）
      env: {
        overview: env.envOverview(),
        kinds: env.envListVersions(),
        settings: envSettingsOf(),
        defaults: env.ENV_DEFAULTS,
        platforms: env.KINDS,
      },
    })
  }), 'ent-desktop: route GET /admin/desktop-repo')

  ctx.effect(() => router.exact('POST', '/admin/desktop-repo/check', async (req, res) => {
    const u = await requireAdmin(req, res)
    if (!u) return true
    try {
      // 手动「检测更新」只看不动手：几百 MB 的入库交给计划任务或按版本的「同步」按钮，
      // 否则点一下检测会把页面吊住几分钟，管理员还以为卡死了
      const r = await runCheck({ by: u.user.username, auto: false })
      console.log(`[${ts()}] 🔍 客户端版本检测 by ${u.user.username}: 新发现 ${r.fresh.length}`)
      return json(res, 200, { ok: true, ...r, versions: desktop.listVersions(), overview: desktop.overview() })
    } catch (e) {
      const message = String(e?.message ?? e).slice(0, 300)
      desktop.markError(message)   // 页面要能看到「上一轮为什么没检到」
      return json(res, 502, { error: { message: `检测失败：${message}`, type: 'upstream_error' } })
    }
  }), 'ent-desktop: route POST /admin/desktop-repo/check')

  ctx.effect(() => router.exact('POST', '/admin/desktop-repo/sync', async (req, res) => {
    const u = await requireAdmin(req, res)
    if (!u) return true
    const b = await jsonOr400(req, res)
    if (b === null) return true
    const version = String(b.version ?? '')
    const platform = b.platform ? String(b.platform) : null
    const force = b.force === true || b.force === 'true'   // 人工修复才强制重下（默认跳过已有一致的包）
    if (!desktop.hasVersion(version)) return json(res, 400, { error: { message: `索引里没有版本 ${version || '(空)'}，请先点检测更新`, type: 'bad_request' } })
    if (platform && !desktop.PLATFORMS[platform]) return json(res, 400, { error: { message: 'platform 只能是 mac | win', type: 'bad_request' } })
    try {
      const r = await runCheck({ by: u.user.username, sync: { version, platform, force } })
      const got = r.synced.some((s) => s.synced?.length)
      if (!got && r.syncErrors.length) {
        // 一个包都没落地就是失败，不能让页面弹「已入库」；「正在同步中」是状态冲突不是上游故障
        const busy = r.syncErrors.some((m) => m.includes('正在同步中'))
        return json(res, busy ? 409 : 502, {
          error: { message: r.syncErrors.join('; ').slice(0, 300), type: busy ? 'conflict' : 'upstream_error' },
        })
      }
      return json(res, 200, { ok: true, ...r, versions: desktop.listVersions(), overview: desktop.overview() })
    } catch (e) {
      return json(res, 502, { error: { message: String(e?.message ?? e).slice(0, 300), type: 'upstream_error' } })
    }
  }), 'ent-desktop: route POST /admin/desktop-repo/sync')

  /** 设置 + 发布指针 + 令牌（三件事都走 PATCH，与 /admin/policy 的「一个入口改一个域」一致） */
  ctx.effect(() => router.exact('PATCH', '/admin/desktop-repo', async (req, res) => {
    const u = await requireAdmin(req, res)
    if (!u) return true
    const b = await jsonOr400(req, res)
    if (b === null) return true
    const cfg = settingsOf()
    // 1) 设置面：白名单字段落 plugins.ent-desktop.config（越界值由 resolveSettings 收敛）
    const patch = {}
    for (const k of ['feeds', 'githubRepo', 'mirrorRepo', 'githubTokenEnv', 'channel', 'checkIntervalMin',
      'autoSync', 'keepVersions', 'maxPackageMb', 'maxTotalGb', 'allowUpstreamFallback', 'allowedHosts',
      // 环境物料（Node / pnpm）设置：与安装包共用一个配置域，前缀区分
      'envFeeds', 'nodeChannel', 'nodeKeepVersions', 'pnpmKeepVersions', 'envAutoSync',
      'nodeDistBase', 'nodeMirrorBase', 'pnpmRegistry', 'pnpmMirror', 'envMaxPackageMb', 'envMaxTotalGb']) {
      if (b[k] !== undefined) patch[k] = b[k]
    }
    // 令牌：明文只进 data/.env（与供应商密钥同一规矩），配置里只留变量名
    if (typeof b.githubToken === 'string') {
      const key = /^[A-Za-z_][A-Za-z0-9_]*$/.test(String(b.githubTokenEnv ?? cfg.githubTokenEnv))
        ? String(b.githubTokenEnv ?? cfg.githubTokenEnv) : cfg.githubTokenEnv
      if (b.githubToken.trim()) writeDotEnv(key, b.githubToken.trim())
      else removeDotEnv(key)
      patch.githubTokenEnv = key
      console.log(`[${ts()}] ⚙ 客户端发布源令牌${b.githubToken.trim() ? '已写入' : '已清除'} data/.env:${key} by ${u.user.username}`)
    }
    if (Object.keys(patch).length) setPluginConfig(name, patch)
    // 2) 发布指针：'' / null = 取消下发（安装脚本回退公网）
    if (b.published !== undefined || b.publishedVersion !== undefined) {
      const ver = b.published ?? b.publishedVersion
      try {
        const r = desktop.setPublished(ver || null)
        console.log(`[${ts()}] 🚀 客户端下发版本 → ${r.published ?? '(取消)'} by ${u.user.username}`)
        registry.emit('desktop.published', { version: r.published, by: u.user.username })
      } catch (e) {
        return json(res, 400, { error: { message: String(e?.message ?? e).slice(0, 300), type: 'bad_request' } })
      }
    }
    // 3) 环境物料发布指针：publishedNode / publishedPnpm，'' 或 null = 取消下发（脚本转公网兜底）
    for (const [key, kind] of [['publishedNode', 'node'], ['publishedPnpm', 'pnpm']]) {
      if (b[key] === undefined) continue
      try {
        const v = env.setEnvPublished(kind, b[key] || null)
        console.log(`[${ts()}] 🚀 ${env.KINDS[kind].zh} 下发版本 → ${v ?? '(取消)'} by ${u.user.username}`)
        registry.emit('env.published', { kind, version: v, by: u.user.username })
      } catch (e) {
        return json(res, 400, { error: { message: String(e?.message ?? e).slice(0, 300), type: 'bad_request' } })
      }
    }
    const next = settingsOf()
    return json(res, 200, {
      ok: true, settings: { ...next, hasToken: !!process.env[next.githubTokenEnv] },
      versions: desktop.listVersions(), overview: desktop.overview(),
      env: { overview: env.envOverview(), kinds: env.envListVersions(), settings: envSettingsOf() },
    })
  }), 'ent-desktop: route PATCH /admin/desktop-repo')

  /** 离线上传：请求体流式落盘（几百 MB 不进内存）；参数走 query，避免 multipart 依赖 */
  ctx.effect(() => router.exact('POST', '/admin/desktop-repo/upload', async (req, res) => {
    const u = await requireAdmin(req, res)
    if (!u) return true
    const q = new URL(req.url, 'http://x').searchParams
    try {
      const r = await desktop.addFromUpload(req, {
        version: q.get('version') ?? '', platform: q.get('platform') ?? '',
        fileName: q.get('fileName') ?? '', by: u.user.username,
      }, settingsOf())
      console.log(`[${ts()}] 📦 客户端安装包上传 by ${u.user.username}: ${r.version}/${r.platform} ${(r.size / 1048576).toFixed(0)}MB`)
      return json(res, 200, { ok: true, ...r, versions: desktop.listVersions(), overview: desktop.overview() })
    } catch (e) {
      return json(res, 400, { error: { message: String(e?.message ?? e).slice(0, 300), type: 'bad_request' } })
    }
  }), 'ent-desktop: route POST /admin/desktop-repo/upload')

  ctx.effect(() => router.prefix('/admin/desktop-repo/', async (req, res, urlPath) => {
    if (req.method !== 'DELETE') return false
    const u = await requireAdmin(req, res)
    if (!u) return true
    const version = decodeURIComponent(urlPath.slice('/admin/desktop-repo/'.length))
    try {
      desktop.removeVersion(version)
      console.log(`[${ts()}] － 删除客户端安装包 ${version} by ${u.user.username}`)
      return json(res, 200, { ok: true, versions: desktop.listVersions(), overview: desktop.overview() })
    } catch (e) {
      return json(res, 400, { error: { message: String(e?.message ?? e).slice(0, 300), type: 'bad_request' } })
    }
  }), 'ent-desktop: route DELETE /admin/desktop-repo/:version')

  /* ---------- 环境物料管理台（Node / pnpm；动作与安装包一一对应，页面两套二级页共用交互） ---------- */

  const envPayload = () => ({ overview: env.envOverview(), kinds: env.envListVersions(), settings: envSettingsOf() })

  ctx.effect(() => router.exact('POST', '/admin/env-repo/check', async (req, res) => {
    const u = await requireAdmin(req, res)
    if (!u) return true
    try {
      // 与安装包一样：手动检测只看不动手（Node 一套就是 ~150MB，不该把页面吊住）
      const r = await runEnvCheck({ by: u.user.username, auto: false })
      console.log(`[${ts()}] 🔍 环境物料检测 by ${u.user.username}: 新发现 ${r.fresh.length}`)
      return json(res, 200, { ok: true, ...r, ...envPayload() })
    } catch (e) {
      const message = String(e?.message ?? e).slice(0, 300)
      env.markEnvError(message)
      return json(res, 502, { error: { message: `检测失败：${message}`, type: 'upstream_error' } })
    }
  }), 'ent-desktop: route POST /admin/env-repo/check')

  ctx.effect(() => router.exact('POST', '/admin/env-repo/sync', async (req, res) => {
    const u = await requireAdmin(req, res)
    if (!u) return true
    const b = await jsonOr400(req, res)
    if (b === null) return true
    const kind = String(b.kind ?? '')
    const version = String(b.version ?? '')
    const platform = b.platform ? String(b.platform) : null
    if (!env.KINDS[kind]) return json(res, 400, { error: { message: 'kind 只能是 node | pnpm', type: 'bad_request' } })
    if (!env.hasEnvVersion(kind, version)) return json(res, 400, { error: { message: `索引里没有 ${kind} ${version || '(空)'}，请先点检测更新`, type: 'bad_request' } })
    if (platform && !env.KINDS[kind].platforms.includes(platform)) {
      return json(res, 400, { error: { message: `${kind} 的平台只能是 ${env.KINDS[kind].platforms.join(' | ')}`, type: 'bad_request' } })
    }
    const force = b.force === true || b.force === 'true'
    try {
      const r = await runEnvCheck({ by: u.user.username, sync: { kind, version, platform, force } })
      const got = r.synced.some((s) => s.synced?.length)
      if (!got && r.syncErrors.length) {
        const isBusy = r.syncErrors.some((m) => m.includes('正在同步中'))
        return json(res, isBusy ? 409 : 502, {
          error: { message: r.syncErrors.join('; ').slice(0, 300), type: isBusy ? 'conflict' : 'upstream_error' },
        })
      }
      return json(res, 200, { ok: true, ...r, ...envPayload() })
    } catch (e) {
      return json(res, 502, { error: { message: String(e?.message ?? e).slice(0, 300), type: 'upstream_error' } })
    }
  }), 'ent-desktop: route POST /admin/env-repo/sync')

  ctx.effect(() => router.exact('POST', '/admin/env-repo/upload', async (req, res) => {
    const u = await requireAdmin(req, res)
    if (!u) return true
    const q = new URL(req.url, 'http://x').searchParams
    try {
      const r = await env.addEnvFromUpload(req, {
        kind: q.get('kind') ?? '', version: q.get('version') ?? '',
        platform: q.get('platform') ?? '', fileName: q.get('fileName') ?? '', by: u.user.username,
      }, envSettingsOf())
      console.log(`[${ts()}] 📦 环境物料上传 by ${u.user.username}: ${r.kind} ${r.version}/${r.platform} ${(r.size / 1048576).toFixed(1)}MB`)
      return json(res, 200, { ok: true, ...r, ...envPayload() })
    } catch (e) {
      return json(res, 400, { error: { message: String(e?.message ?? e).slice(0, 300), type: 'bad_request' } })
    }
  }), 'ent-desktop: route POST /admin/env-repo/upload')

  ctx.effect(() => router.prefix('/admin/env-repo/', async (req, res, urlPath) => {
    if (req.method !== 'DELETE') return false
    const u = await requireAdmin(req, res)
    if (!u) return true
    const segs = decodeURIComponent(urlPath.slice('/admin/env-repo/'.length)).split('/').filter(Boolean)
    const [kind, version] = segs
    if (!env.KINDS[kind] || !version) return json(res, 400, { error: { message: '路径形如 /admin/env-repo/node/24.21.0', type: 'bad_request' } })
    try {
      env.removeEnvVersion(kind, version)
      console.log(`[${ts()}] － 删除环境物料 ${kind} ${version} by ${u.user.username}`)
      return json(res, 200, { ok: true, ...envPayload() })
    } catch (e) {
      return json(res, 400, { error: { message: String(e?.message ?? e).slice(0, 300), type: 'bad_request' } })
    }
  }), 'ent-desktop: route DELETE /admin/env-repo/:kind/:version')

  /* ---------- 用户端协议（与 /setup 脚本同级，公开只读） ----------
   * releases.json = 安装脚本的唯一事实源：版本、路径、sha256 全由网关给，
   * 脚本里不再有一个写死的版本号或校验值。地址回相对路径，由脚本自己拼网关地址
   * （避免反代 Host 头被伪造时把下载地址带歪）。
   */
  ctx.effect(() => router.exact('GET', '/setup/releases.json', async (req, res) => {
    const pub = desktop.published()
    const cfg = settingsOf()
    const wrap = (a, platform) => a ? {
      ...a, path: `/setup/packages/${platform}/${a.version}`,
      sizeMb: Math.round((a.size / 1048576) * 10) / 10,
    } : null
    const body = {
      ok: true,
      version: pub.version,
      publishedAt: pub.publishedAt,
      checkedAt: pub.checkedAt,
      lastError: pub.lastError,
      allowUpstreamFallback: cfg.allowUpstreamFallback,
      mac: wrap(pub.mac, 'mac'),
      win: wrap(pub.win, 'win'),
    }
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
    res.end(JSON.stringify(body))
    return true
  }), 'ent-desktop: route GET /setup/releases.json')

  /**
   * 安装包实体：GET /setup/packages/<platform>[/<version>]
   * 不给 version = 当前下发版本；支持 Range（300MB 的包，脚本重跑不必从头再下一遍）。
   */
  /**
   * 实体下发（安装包与环境物料共用）：内容协商 + Range 续传。
   * 几百 MB 的包，脚本重跑不该从头再下一遍；x-content-sha256 让脚本能自查完整性。
   */
  function sendArtifact(req, res, hit) {
    const st = statSync(hit.file)
    const fileName = hit.meta.fileName.replace(/[^\w.+-]/g, '_')
    const headers = {
      'content-type': 'application/octet-stream',
      'content-disposition': `attachment; filename="${fileName}"`,
      'accept-ranges': 'bytes',
      'x-content-sha256': hit.meta.sha256,
      'cache-control': 'public, max-age=86400',
    }
    const headOnly = req.method === 'HEAD'
    if (req.headers.range) {
      const m = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range)) ?? []
      const start = m[1] ? Number(m[1]) : 0
      const end = m[2] ? Math.min(Number(m[2]), st.size - 1) : st.size - 1
      if (start < st.size && start <= end) {
        res.writeHead(206, { ...headers, 'content-range': `bytes ${start}-${end}/${st.size}`, 'content-length': String(end - start + 1) })
        if (headOnly) return res.end()
        createReadStream(hit.file, { start, end }).pipe(res)
        return true
      }
    }
    res.writeHead(200, { ...headers, 'content-length': String(st.size) })
    if (headOnly) return res.end()
    createReadStream(hit.file).pipe(res)
    return true
  }

  /**
   * 安装包实体：GET /setup/packages/<platform>[/<version>]
   * 不给 version = 当前下发版本；支持 Range（300MB 的包，脚本重跑不必从头再下一遍）。
   */
  ctx.effect(() => router.prefix('/setup/packages/', async (req, res, urlPath) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return false
    if (urlPath.includes('..')) return json(res, 400, { error: { message: 'bad path', type: 'bad_request' } })
    const segs = urlPath.slice('/setup/packages/'.length).split('/').filter(Boolean).map(decodeURIComponent)
    const platform = segs[0] ?? ''
    const version = segs[1] && /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.+-]+)?$/.test(segs[1]) ? segs[1] : undefined
    if (!desktop.PLATFORMS[platform]) return json(res, 404, { error: { message: `未知平台 ${platform}（仅 mac | win）`, type: 'not_found' } })
    const hit = desktop.resolveArtifact(platform, version)
    if (!hit) {
      return json(res, 404, { error: { message: `网关上没有 ${platform} ${version ?? '当前下发版本'} 的安装包（请在管理台「桌面客户端」同步或发布）`, type: 'not_found' } })
    }
    return sendArtifact(req, res, hit)
  }), 'ent-desktop: route GET /setup/packages/*')

  /** 环境物料实体：GET /setup/env/<kind>/<platform>[/<version>]（pnpm 单包，平台段可省） */
  ctx.effect(() => router.prefix('/setup/env/', async (req, res, urlPath) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return false
    if (urlPath.includes('..')) return json(res, 400, { error: { message: 'bad path', type: 'bad_request' } })
    const segs = urlPath.slice('/setup/env/'.length).split('/').filter(Boolean).map(decodeURIComponent)
    const kind = segs[0] ?? ''
    if (!env.KINDS[kind]) return json(res, 404, { error: { message: `未知物料类型 ${kind}（仅 node | pnpm）`, type: 'not_found' } })
    const vers = (s) => (s && /^\d+\.\d+\.\d+$/.test(s) ? s : undefined)
    const platform = segs[1] ?? ''
    const version = vers(segs[2])
    const hit = env.resolveEnvArtifact(kind, platform, version)
    if (!hit) {
      return json(res, 404, {
        error: { message: `网关上没有 ${kind} ${platform} ${version ?? '当前下发版本'} 的物料（请在管理台「桌面客户端 → 环境物料」同步或发布）`, type: 'not_found' },
      })
    }
    return sendArtifact(req, res, { file: hit.file, meta: hit.meta })
  }), 'ent-desktop: route GET /setup/env/*')

  /** 安装脚本的环境物料契约：Node 各平台构建 + pnpm，校验值与官方一致 */
  ctx.effect(() => router.exact('GET', '/setup/env.json', async (req, res) => {
    const body = env.envReleasePayload({ allowUpstreamFallback: settingsOf().allowUpstreamFallback })
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
    res.end(JSON.stringify(body))
    return true
  }), 'ent-desktop: route GET /setup/env.json')

  /* ---------- 定期检测（自排程：间隔读当前设置，管理台改完下一轮就生效） ---------- */
  ctx.effect(() => {
    let timer = null
    let cancelled = false
    const tick = async () => {
      try {
        const r = await runCheck()
        const got = r.synced.reduce((n, x) => n + (x.synced?.length ?? 0), 0)
        const had = r.synced.reduce((n, x) => n + (x.skipped?.length ?? 0), 0)
        if (r.fresh.length || got) console.log(`[${ts()}] 🖥 客户端发布巡检：新发现 ${r.fresh.length}，入库 ${got} 个包${had ? `（另 ${had} 个本地已有，未重复下载）` : ''}`)
      } catch (e) {
        const message = String(e?.message ?? e).slice(0, 300)
        desktop.markError(message)
        console.warn(`[${ts()}] ⚠ 客户端版本检测失败: ${message}`)
      }
      // 环境物料跟同一班车：Node/pnpm 的新版通常比客户端慢，但一次装机就要用，缺了就装不上
      try {
        const r = await runEnvCheck()
        const got = r.synced.reduce((n, x) => n + (x.synced?.length ?? 0), 0)
        const had = r.synced.reduce((n, x) => n + (x.skipped?.length ?? 0), 0)
        if (r.fresh.length || got) console.log(`[${ts()}] 🧰 环境物料巡检：新发现 ${r.fresh.length}，入库 ${got} 个包${had ? `（另 ${had} 个本地已有，未重复下载）` : ''}`)
      } catch (e) {
        const message = String(e?.message ?? e).slice(0, 300)
        env.markEnvError(message)
        console.warn(`[${ts()}] ⚠ 环境物料检测失败: ${message}`)
      }
      if (!cancelled) timer = setTimeout(tick, settingsOf().checkIntervalMin * 60_000)
    }
    // 启动后延迟一轮：网关刚起来时先让登录/转发链路跑顺，且避开重启风暴反复打上游
    timer = setTimeout(tick, 20_000)
    return () => { cancelled = true; if (timer) clearTimeout(timer) }
  }, 'ent-desktop: release watcher')
}
