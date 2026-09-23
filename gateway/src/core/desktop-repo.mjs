/**
 * 桌面客户端仓库 · 网关侧安装包存储与发布（对标 core/repo-store.mjs 的插件仓库）
 *
 * 为什么要有它：安装脚本原本让每台客户端各自打 GitHub API 找最新包，且把版本号和
 *   兜底 sha256 写死在脚本里 —— 客户端一发新版就得改脚本重发网关包；内网/代理受限的
 *   机器还会整轮安装失败。本模块把「找版本 → 拉包 → 校验」收敛到网关一次，
 *   客户端只从内网下载（快、可离线、版本由管理员控制）。
 *
 * 磁盘布局（与插件仓库平行，同 DATA_DIR 规则）：
 *   data/desktop-repo/index.json                        —— 索引（远端清单 + 本地包元数据 + 发布指针）
 *   data/desktop-repo/files/<version>/<platform>-<file> —— 安装包实体
 *
 * 索引结构：
 *   { published: '2.0.13' | null, checkedAt, lastError,
 *     versions: { [ver]: { version, tag, channel, publishedAt, notes, sources,
 *                          artifacts: { [platform]: { file, fileName, size, sha256,
 *                                     verified, source, syncedAt, by } },
 *                          status, lastError } } }
 *   sources[platform] = 该版本该平台可用的下载源（按配置的源顺序，同步时逐个试）
 *
 * 信任链：上游给的摘要（GitHub asset.digest / ModelScope 文件 Sha256）= 期望值；
 *   落盘时边下边算 sha256，不一致即判失败并删除 —— 网关绝不把没校验过的包发给客户端。
 *   上游没给摘要的（手工上传）记 verified=false，管理页明示「校验值由网关自算」。
 *
 * 发布模型：检测到新版 → 自动下载入库（status=ready，但不生效）→ 管理员点「设为下发版本」
 *   才成为 published；published 版本永不被保留策略删除，回滚 = 把 published 指回旧版。
 */
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { dataDir } from '../config.mjs'
import { BASE_TRUSTED_HOSTS, downloadTo as httpDownload, getJson as httpGetJson } from './artifact-http.mjs'

const REPO_DIR = path.join(dataDir, 'desktop-repo')
const FILES_DIR = path.join(REPO_DIR, 'files')
const INDEX_FILE = path.join(REPO_DIR, 'index.json')

/** 平台口径与安装脚本严格一致（mac = 通用 dmg，win = x64 Setup.exe） */
export const PLATFORMS = {
  mac: { zh: 'macOS', en: 'macOS', ext: '.dmg' },
  win: { zh: 'Windows', en: 'Windows', ext: '.exe' },
}

/** 设置默认值（管理台可改；持久化在 plugins.ent-desktop.config） */
export const DEFAULTS = {
  feeds: ['github', 'modelscope'],          // 检测源与优先顺序（同 (版本,平台) 前者胜出）
  githubRepo: 'anywhere-labs/dsh-desktop',  // GitHub 源仓库
  mirrorRepo: 't4wefan/deepseek-harness-desktop', // ModelScope 镜像模型库
  githubTokenEnv: 'DSH_RELEASE_TOKEN',      // GitHub 令牌所在 .env 变量名（匿名 60 次/小时/IP，内网共用出口 IP 时建议填）
  channel: 'stable',                        // stable=只跟正式版 | beta=含预发布
  checkIntervalMin: 360,                    // 定期检测间隔（分钟）
  autoSync: true,                           // 检到新版自动下载入库（不自动生效，生效要人点）
  keepVersions: 2,                          // 本地保留版本数（published 额外保留；上游清单元数据不删，随时可回拉）
  maxPackageMb: 2048,                       // 单个安装包上限
  maxTotalGb: 6,                            // 安装包目录总量上限（超限从最旧的非发布版开始删包）
  allowUpstreamFallback: true,              // 网关没有可用包时，安装脚本可否回退公网直下
  allowedHosts: [],                         // 额外允许的下载域名后缀（内网自建镜像时填）
}



/* ---------- 设置归一 ---------- */

/** 域名白名单基表在 artifact-http（桌面域无额外域名，自建镜像走 allowedHosts 配置） */
const TRUSTED = BASE_TRUSTED_HOSTS

const num = (v, d, min, max) => {
  const n = Number(v)
  return Number.isFinite(n) && n >= min && n <= max ? Math.round(n) : d
}
/** owner/name 形态才放行：设置页填错也不能拼出任意 API 地址 */
const ident = (v, d) => {
  const s = String(v ?? '').trim()
  return /^[\w.-]+\/[\w.-]+$/.test(s) ? s : d
}
/** .env 变量名形状才放行（令牌只存变量名，不存值） */
const envName = (v, d) => {
  const s = String(v ?? '').trim()
  return /^[A-Z][A-Z0-9_]{2,64}$/.test(s) ? s : d
}

/** 把插件配置收敛成可用的设置（越界值一律回落到默认，绝不因配置脏把检测搞崩） */
export function resolveSettings(pluginConfig = {}) {
  const d = DEFAULTS
  const list = Array.isArray(pluginConfig.feeds) ? pluginConfig.feeds : d.feeds
  const feeds = ['github', 'modelscope'].filter((f) => list.includes(f))
  return {
    feeds: feeds.length ? feeds : d.feeds,
    githubRepo: ident(pluginConfig.githubRepo, d.githubRepo),
    mirrorRepo: ident(pluginConfig.mirrorRepo, d.mirrorRepo),
    githubTokenEnv: envName(pluginConfig.githubTokenEnv, d.githubTokenEnv),
    channel: pluginConfig.channel === 'beta' ? 'beta' : 'stable',
    checkIntervalMin: num(pluginConfig.checkIntervalMin, d.checkIntervalMin, 10, 10080),
    autoSync: pluginConfig.autoSync !== false,
    keepVersions: num(pluginConfig.keepVersions, d.keepVersions, 1, 10),
    maxPackageMb: num(pluginConfig.maxPackageMb, d.maxPackageMb, 16, 8192),
    maxTotalGb: num(pluginConfig.maxTotalGb, d.maxTotalGb, 1, 200),
    allowUpstreamFallback: pluginConfig.allowUpstreamFallback !== false,
    allowedHosts: Array.isArray(pluginConfig.allowedHosts)
      ? pluginConfig.allowedHosts.map((s) => String(s).toLowerCase().trim()).filter(Boolean) : [],
  }
}

/* ---------- 索引 ---------- */

const VER_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.+-]+)?$/
const now = () => new Date().toISOString().slice(0, 19).replace('T', ' ')

/** 同步中的 (版本+平台)：定时器与管理台按钮会撞车，同一目标绝不并发 */
const busy = new Set()

let indexCache = null
function loadIndex() {
  if (indexCache) return indexCache
  try {
    indexCache = JSON.parse(fs.readFileSync(INDEX_FILE, 'utf8'))
  } catch {
    indexCache = { published: null, checkedAt: '', lastError: '', versions: {} }
  }
  // 结构兜底：索引被手工改坏时补空，别拖垮整个网关
  indexCache.versions ||= {}
  return indexCache
}

function saveIndex() {
  fs.mkdirSync(REPO_DIR, { recursive: true })
  const tmp = INDEX_FILE + '.tmp'
  fs.writeFileSync(tmp, JSON.stringify(loadIndex(), null, 2))
  fs.renameSync(tmp, INDEX_FILE)   // 原子替换：断电也不会留下半个 index.json
}

function verCmp(a, b) {
  const pa = String(a).split('-')[0].split('.').map(Number)
  const pb = String(b).split('-')[0].split('.').map(Number)
  for (let i = 0; i < 3; i++) { if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0) }
  // 同主版本：正式版排在预发布之前（2.0.13 > 2.0.13-beta.1，与 semver 一致）
  if (String(a).includes('-') === String(b).includes('-')) return 0
  return String(a).includes('-') ? -1 : 1
}
const sortedVersions = (vers) => Object.keys(vers).sort(verCmp).reverse()   // 新 → 旧

/* ---------- 远端源 ---------- */

/**
 * 从文件名认版本号。预发布后缀只认常见标签（alpha/beta/rc/…）：
 * 文件名里 `2.0.13-x64-Setup.exe` 的 `-x64-Setup.exe` 不是预发布号，
 * 照语义版本正则照抄会把整串吞成一个「版本」（索引里就多出一堆垃圾条目）。
 */
const VERSION_RE = /\d+\.\d+\.\d+(?:-(?:alpha|beta|rc|dev|canary|next|preview)(?:[.-][0-9A-Za-z]+)*)?/i
const parseVersion = (text) => VERSION_RE.exec(String(text))?.[0] ?? null
/** release tag（v2.0.13）→ 干净版本号；GitHub 源优先用它，文件名只作兜底 */
const tagVersion = (tag) => /^v?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.+-]+)?)$/.exec(String(tag ?? '').trim())?.[1] ?? null

/** 从文件名认平台与版本（镜像源只有文件名，靠这里） */
function classify(fileName) {
  const lower = String(fileName).toLowerCase()
  const version = parseVersion(fileName)
  if (!version || !VER_RE.test(version)) return null
  if (!lower.endsWith('.dmg') && !lower.endsWith('.exe')) return null
  return {
    version,
    platform: lower.endsWith('.dmg') ? 'mac' : 'win',
    beta: /beta|canary|nightly|alpha/.test(lower),
    public: /-public|public\.|社区版/.test(lower),
    universal: /universal/.test(lower),
    arm64: /arm64|aarch64/.test(lower),
    x64: /x64|x86_64|amd64/.test(lower),
  }
}

/** 同一 (版本,平台) 多个产物时挑哪个当主包：稳定 > 通用/主流架构 > 有摘要 */
function artifactScore(a) {
  let s = 0
  if (!a.public) s += 8
  if (a.platform === 'mac' && a.universal) s += 4
  if (a.platform === 'win' && a.x64 && !a.arm64) s += 4
  if (a.sha256) s += 2
  return s
}

async function feedGithub(cfg) {
  const headers = { accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28' }
  if (process.env[cfg.githubTokenEnv]) headers.authorization = `Bearer ${process.env[cfg.githubTokenEnv]}`
  const releases = await httpGetJson(`https://api.github.com/repos/${cfg.githubRepo}/releases?per_page=30`,
    { headers, trusted: TRUSTED, allowed: cfg.allowedHosts })
  if (!Array.isArray(releases)) throw new Error('GitHub releases 返回结构不认识')
  const out = []
  for (const r of releases) {
    if (r.draft) continue
    for (const a of r.assets ?? []) {
      const c = classify(a.name)
      if (!c) continue
      if (tagVersion(r.tag_name)) c.version = tagVersion(r.tag_name)   // tag 比文件名准
      out.push({
        ...c,
        fileName: a.name,
        url: a.browser_download_url,
        sha256: String(a.digest ?? '').replace(/^sha256:/, '').toLowerCase(),
        size: Number(a.size ?? 0) || 0,
        source: 'github',
        beta: !!r.prerelease || c.beta,
        tag: r.tag_name ?? '',
        publishedAt: r.published_at ?? '',
        notes: String(r.body ?? '').slice(0, 400),
      })
    }
  }
  return out
}

async function feedModelscope(cfg) {
  const api = `https://modelscope.cn/api/v1/models/${cfg.mirrorRepo}/repo/files?Revision=master&Recursive=true`
  const j = await httpGetJson(api, { timeoutMs: 30000, trusted: TRUSTED, allowed: cfg.allowedHosts })
  const files = j?.Data?.Files
  if (!Array.isArray(files)) throw new Error('ModelScope 文件清单返回结构不认识')
  const out = []
  for (const f of files) {
    const name = String(f.Name ?? '')
    const c = classify(name)
    if (!c) continue
    out.push({
      ...c,
      fileName: name,
      url: `https://modelscope.cn/models/${cfg.mirrorRepo}/resolve/master/${encodeURIComponent(String(f.Path ?? name))}`,
      sha256: String(f.Sha256 ?? '').toLowerCase(),
      size: Number(f.Size ?? 0) || 0,
      source: 'modelscope',
      tag: '',
      publishedAt: String(f.CommittedDate ?? '').slice(0, 19),
      notes: '',
    })
  }
  return out
}

const FEEDS = { github: feedGithub, modelscope: feedModelscope }

/**
 * 探测上游并合并进索引：各 feed 按 (版本,平台) 归并，主产物之外的同名片段留作备用源。
 * 返回 unreachable=true 表示一条源都没通（调用方据此区分「没新版」与「源全挂」）。
 */
export async function checkUpstream(cfg) {
  const idx = loadIndex()
  const merged = new Map()
  const errors = []
  let any = false
  for (const name of cfg.feeds) {
    try {
      const items = await FEEDS[name](cfg)
      any = true
      for (const it of items) {
        if (cfg.channel === 'stable' && it.beta) continue
        const byVer = merged.get(it.version) ?? {}
        const cur = byVer[it.platform]
        if (!cur || artifactScore(it) > artifactScore(cur[0])) {
          byVer[it.platform] = [it]   // 换主产物：候选源从头算（不同产物的校验值不能混用）
        } else if (cur[0].fileName === it.fileName && !cur.some((x) => x.url === it.url)) {
          cur.push(it)                // 同一个包在多个源上都有 → 互为下载备份
        }
        merged.set(it.version, byVer)
      }
    } catch (e) {
      errors.push({ feed: name, error: String(e?.message ?? e).slice(0, 160) })
    }
  }
  const fresh = []
  for (const [version, byPlat] of merged) {
    if (!VER_RE.test(version)) continue
    const first = Object.values(byPlat)[0]?.[0]
    const isNew = !idx.versions[version]
    const v = idx.versions[version] ?? {
      version, tag: '', channel: 'stable', publishedAt: '', notes: '', discoveredAt: now(),
      sources: {}, artifacts: {}, status: 'remote', lastError: '',
    }
    v.tag = first?.tag || v.tag
    v.channel = first?.beta ? 'beta' : 'stable'
    v.publishedAt = first?.publishedAt || v.publishedAt
    v.notes = first?.notes || v.notes
    for (const [p, cands] of Object.entries(byPlat)) v.sources[p] = cands
    v.status = statusOf(v)
    idx.versions[version] = v
    if (isNew) fresh.push(version)
  }
  idx.checkedAt = now()
  idx.lastError = any
    ? errors.map((e) => `${e.feed}: ${e.error}`).join('; ').slice(0, 400)
    : `所有检测源都不可达：${errors.map((e) => `${e.feed}: ${e.error}`).join('; ')}`.slice(0, 400)
  saveIndex()
  prune(cfg)
  return { checkedAt: idx.checkedAt, fresh: fresh.sort(verCmp).reverse(), errors, unreachable: !any }
}

/** 检测 + 返回可直接渲染的版本行（管理台与巡检共用） */
export async function checkUpdates(cfg) {
  const r = await checkUpstream(cfg)
  return { ...r, versions: listVersions() }
}

const safeName = (s) => String(s).replace(/[^\w.+-]/g, '_').slice(-96)
const artifactPath = (version, platform, fileName) => path.join(FILES_DIR, version, `${platform}-${safeName(fileName)}`)

/**
 * 同步一个版本（可只同步某平台）：逐个源候选试下载 → 校验 → 原子改名 → 写索引。
 * 上游给了摘要就必须对上；没给则记 verified=false（页面标注，下载照发）。
 * 本地已有一致实体的平台默认跳过：检测任务每几分钟一轮，逐轮重拉保留窗口内的
 * 全部平台（mac 300MB + win 150MB）既烧带宽也没意义；force=true 才强制重下。
 */
export async function syncVersion(version, cfg, { platform, by = 'scheduler', force = false } = {}) {
  const idx = loadIndex()
  const v = idx.versions[String(version)]
  if (!v) throw new Error(`索引里没有版本 ${version}（先点检测更新）`)
  const plats = (platform ? [String(platform)] : Object.keys(PLATFORMS)).filter((p) => v.sources?.[p]?.length)
  if (!plats.length) throw new Error(`版本 ${version} 没有可下载的远端包（源没列出该平台产物）`)
  const done = []
  const skipped = []
  const failures = []
  const attempts = []
  for (const p of plats) {
    const key = `${version}:${p}`
    if (busy.has(key)) throw new Error(`${p} ${version} 正在同步中，请等上一轮结束`)
    busy.add(key)
    try {
      const dest = artifactPath(version, p, v.sources[p][0].fileName)
      // 摘要基准取最高优先源：摘要不一致的候选根本不是同一个包，下下来也不能要
      const want = v.sources[p][0].sha256 || null
      // 已有实体且摘要一致（上传来的包没有上游摘要，视为权威）→ 跳过，别重复占用带宽
      const have = v.artifacts?.[p]
      const haveIt = !force && have?.file && have.size > 0
        && fs.existsSync(path.join(REPO_DIR, have.file))
        && !(want && have.sha256 !== want)
      if (haveIt) { skipped.push(p); attempts.push({ platform: p, source: have.source || 'local', ok: true, error: '本地已有一致的安装包，跳过' }); continue }
      let last = null
      for (const src of v.sources[p]) {
        if (want && src.sha256 && src.sha256 !== want) {
          attempts.push({ platform: p, source: src.source, ok: false, error: '摘要与首选源不一致，跳过（不是同一个包）' })
          continue
        }
        try {
          const headers = src.source === 'github' && process.env[cfg.githubTokenEnv]
            ? { authorization: `Bearer ${process.env[cfg.githubTokenEnv]}` } : {}
          const got = await httpDownload(src.url, dest, { maxMb: cfg.maxPackageMb, headers, trusted: TRUSTED, allowed: cfg.allowedHosts })
          if (want && got.sha256 !== want) {
            fs.rmSync(got.file, { force: true })
            throw new Error(`sha256 校验不一致（期望 ${String(want).slice(0, 12)}… / 实算 ${got.sha256.slice(0, 12)}…）`)
          }
          fs.rmSync(dest, { force: true })
          fs.renameSync(got.file, dest)
          // 上游在同一版本内换了文件名时，旧实体要跟着清掉：否则索引不认它，磁盘上却永远留着
          const prev = v.artifacts?.[p]
          if (prev?.file && path.join(REPO_DIR, prev.file) !== dest) {
            try { fs.rmSync(path.join(REPO_DIR, prev.file), { force: true }) } catch { /* 已经不在了 */ }
          }
          v.artifacts[p] = {
            file: path.relative(REPO_DIR, dest), fileName: path.basename(dest), size: got.size,
            sha256: got.sha256, verified: !!want, source: src.source, sourceUrl: src.url,
            syncedAt: now(), by: String(by).slice(0, 64),
          }
          done.push(p)
          last = null
          attempts.push({ platform: p, source: src.source, ok: true, error: '' })
          break
        } catch (e) {
          last = e
          attempts.push({ platform: p, source: src.source, ok: false, error: String(e?.message ?? e).slice(0, 160) })
        }
      }
      if (last) failures.push(`${p}: ${String(last.message).slice(0, 200)}`)
    } finally {
      busy.delete(key)
    }
  }
  v.lastError = failures.join('; ').slice(0, 400)
  v.status = statusOf(v, failures.length === plats.length)
  saveIndex()
  prune(cfg)
  return { version, synced: done, skipped, failed: failures, attempts }
}

/** 管理台手工上传（离线内网 / 灰度内测包）：请求体直接流式落盘，同样不在内存里堆 300MB */
export async function addFromUpload(req, { version, platform, fileName, by = 'admin' }, cfg) {
  if (!VER_RE.test(String(version))) throw new Error(`版本号不合法：${version}（形如 2.0.13）`)
  if (!PLATFORMS[String(platform)]) throw new Error('platform 只能是 mac | win')
  const name = safeName(fileName || `${platform}-upload${PLATFORMS[String(platform)].ext}`)
  if (!name.endsWith(PLATFORMS[String(platform)].ext)) throw new Error(`${platform} 包必须是 ${PLATFORMS[String(platform)].ext}`)
  const idx = loadIndex()
  const dest = artifactPath(version, platform, name)
  const tmp = dest + '.part'
  fs.mkdirSync(path.dirname(dest), { recursive: true })
  const hash = crypto.createHash('sha256')
  let size = 0
  const limit = cfg.maxPackageMb * 1024 * 1024
  const counter = new Transform({
    transform(chunk, _enc, cb) {
      size += chunk.length
      if (size > limit) return cb(new Error(`安装包超过上限 ${cfg.maxPackageMb}MB`))
      hash.update(chunk)
      cb(null, chunk)
    },
  })
  // pipeline 自带背压：手搓 req.on('data') + ws.write 会把 300MB 堆进写缓冲
  await pipeline(req, counter, fs.createWriteStream(tmp)).catch((e) => {
    fs.rmSync(tmp, { force: true })
    throw e
  })
  if (size === 0) { fs.rmSync(tmp, { force: true }); throw new Error('上传内容为空') }

  const v = (idx.versions[version] ??= {
    version, tag: '', channel: version.includes('-') ? 'beta' : 'stable', publishedAt: '',
    notes: '', discoveredAt: now(), sources: {}, artifacts: {}, status: 'remote', lastError: '',
  })
  fs.rmSync(dest, { force: true })
  fs.renameSync(tmp, dest)
  v.artifacts[platform] = {
    file: path.relative(REPO_DIR, dest), fileName: path.basename(dest), size,
    sha256: hash.digest('hex'), verified: false, source: 'upload', sourceUrl: '',
    syncedAt: now(), by: String(by).slice(0, 64),
  }
  v.sources[platform] = v.sources[platform] ?? []   // 手工包不进远端候选，避免下轮检测把 source 改掉
  v.status = statusOf(v)
  saveIndex()
  return { version, platform, size, sha256: v.artifacts[platform].sha256 }
}

/** 版本状态：remote=只有上游清单没下载 / ready=已知平台齐 / partial=缺一半 / error=上轮同步全失败 */
function statusOf(v, failedAll = false) {
  const have = Object.keys(v.artifacts ?? {}).filter((p) => v.artifacts[p]?.file)
  const known = Object.keys(v.sources ?? {})
  if (!have.length) return failedAll ? 'error' : 'remote'
  if (known.length && have.length >= known.length) return 'ready'
  return 'partial'
}

/* ---------- 保留策略 ---------- */

/**
 * 保留策略：包只留 published + 最新 keepVersions 个版本（磁盘就这几百 MB×N，必须收口）。
 * 上游清单元数据不删——管理页仍列出「未同步」的旧版本，随时可回拉（回滚到 2.0.11 不用等公网）。
 * 再按 maxTotalGb 兜底：从最旧的非发布版开始删包。索引本身只留最新 40 个版本，防无限膨胀。
 */
function prune(cfg) {
  const idx = loadIndex()
  const keep = new Set([idx.published].filter(Boolean))
  for (const ver of sortedVersions(idx.versions)) {
    if (keep.size >= cfg.keepVersions + 1) break
    keep.add(ver)
  }
  for (const [ver, v] of Object.entries(idx.versions)) {
    if (keep.has(ver) || !v.artifacts || !Object.keys(v.artifacts).length) continue
    dropFiles(v)
    v.artifacts = {}
    v.status = 'remote'
  }
  let total = totalBytes()
  for (const ver of sortedVersions(idx.versions).slice().reverse()) {   // 旧 → 新
    if (total <= cfg.maxTotalGb * 1024 ** 3) break
    if (ver === idx.published) continue
    const v = idx.versions[ver]
    if (!v?.artifacts || !Object.keys(v.artifacts).length) continue
    total -= bytesOf(v)
    dropFiles(v)
    v.artifacts = {}
    v.status = 'remote'
  }
  for (const ver of sortedVersions(idx.versions).slice(40)) {
    if (ver === idx.published) continue
    delete idx.versions[ver]
  }
  saveIndex()
}

const bytesOf = (v) => Object.values(v?.artifacts ?? {}).reduce((s, a) => s + (a?.size || 0), 0)
function totalBytes() {
  return Object.values(loadIndex().versions).reduce((s, v) => s + bytesOf(v), 0)
}
function dropFiles(v) {
  for (const a of Object.values(v?.artifacts ?? {})) {
    try { fs.rmSync(path.join(REPO_DIR, a.file), { force: true }) } catch { /* 文件已不在 */ }
  }
  try { fs.rmSync(path.join(FILES_DIR, v.version), { recursive: true, force: true }) } catch { /* 目录已空 */ }
}

/* ---------- 查询 ---------- */

/** 发布指针指向的版本（安装脚本的下发目标）；包不存在的平台不返回，脚本据此回退 */
export function published() {
  const idx = loadIndex()
  const v = idx.published ? idx.versions[idx.published] : null
  const ready = (p) => v?.artifacts?.[p]?.file && fs.existsSync(path.join(REPO_DIR, v.artifacts[p].file))
  return {
    checkedAt: idx.checkedAt, lastError: idx.lastError, published: idx.published,
    version: v && (ready('mac') || ready('win')) ? v.version : null,
    publishedAt: v?.publishedAt ?? '',
    mac: ready('mac') ? metaOf(v, 'mac') : null,
    win: ready('win') ? metaOf(v, 'win') : null,
  }
}
const metaOf = (v, p) => ({
  version: v.version, fileName: v.artifacts[p].fileName, size: v.artifacts[p].size,
  sha256: v.artifacts[p].sha256, verified: v.artifacts[p].verified !== false, source: v.artifacts[p].source,
})

/** 解析下载请求 → { file, meta }；version 缺省取发布版本（下载路由用） */
export function resolveArtifact(platform, version) {
  if (!PLATFORMS[String(platform)]) return null
  const idx = loadIndex()
  const ver = version || idx.published
  const v = ver ? idx.versions[ver] : null
  const a = v?.artifacts?.[platform]
  if (!a?.file) return null
  const file = path.join(REPO_DIR, a.file)
  if (!file.startsWith(FILES_DIR) || !fs.existsSync(file)) return null
  return { file, meta: metaOf(v, platform) }
}

/** 管理页数据源：全部版本（含只在上游存在、尚未下载的）+ 每个平台的落地状态 */
export function listVersions() {
  const idx = loadIndex()
  return sortedVersions(idx.versions).map((ver) => {
    const v = idx.versions[ver]
    const rows = {}
    for (const p of Object.keys(PLATFORMS)) {
      const a = v.artifacts?.[p]
      const onDisk = a?.file && fs.existsSync(path.join(REPO_DIR, a.file))
      rows[p] = {
        have: !!onDisk,
        size: onDisk ? a.size : 0,
        sha256: onDisk ? a.sha256 : '',
        verified: !!onDisk && a.verified !== false,
        source: onDisk ? a.source : '',
        fileName: onDisk ? a.fileName : '',
        syncedAt: onDisk ? a.syncedAt : '',
        remote: (v.sources?.[p] ?? []).map((s) => s.source),
      }
    }
    return {
      version: ver, tag: v.tag ?? '', channel: v.channel ?? 'stable', status: v.status ?? 'remote',
      published: idx.published === ver, publishedAt: v.publishedAt ?? '', discoveredAt: v.discoveredAt ?? '',
      notes: v.notes ?? '', lastError: v.lastError ?? '', bytes: bytesOf(v), platforms: rows,
    }
  })
}

export function overview() {
  const idx = loadIndex()
  return {
    published: idx.published, checkedAt: idx.checkedAt, lastError: idx.lastError,
    totalBytes: totalBytes(), dir: REPO_DIR, busy: [...busy],
  }
}

/** 设为下发版本（null = 取消下发，安装脚本回退公网）；目标版本必须真的有包 */
export function setPublished(version) {
  const idx = loadIndex()
  if (!version) { idx.published = null; saveIndex(); return { published: null } }
  const v = idx.versions[String(version)]
  if (!v) throw new Error(`索引里没有版本 ${version}`)
  if (!resolveArtifact('mac', version) && !resolveArtifact('win', version)) throw new Error(`${version} 还没有已下载的安装包，请先同步`)
  idx.published = v.version
  saveIndex()
  return { published: v.version }
}

/** 删除某版本的本地包（上游清单元数据保留，下轮检测还能重新同步） */
export function removeVersion(version) {
  const idx = loadIndex()
  const v = idx.versions[String(version)]
  if (!v) throw new Error(`索引里没有版本 ${version}`)
  if (idx.published === v.version) throw new Error(`${version} 是当前下发版本，请先切换到其他版本再删`)
  dropFiles(v)
  v.artifacts = {}
  v.status = 'remote'
  saveIndex()
  return { version }
}

/** 索引里的版本是否存在（管理 API 校验用） */
export const hasVersion = (version) => !!loadIndex().versions[String(version)]

/** 记一次检测失败：checkedAt = 上次尝试时间（页面与安装脚本都要能看到「上一轮为什么没结果」） */
export function markError(message) {
  const idx = loadIndex()
  idx.lastError = String(message ?? '').slice(0, 400)
  idx.checkedAt = now()
  saveIndex()
}
/** 检测到的全部版本（新→旧） */
export const knownVersions = () => sortedVersions(loadIndex().versions)
