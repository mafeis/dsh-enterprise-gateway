/**
 * 环境物料库：Node.js 官方构建 + pnpm 发行包
 *
 * 为什么要有它：装机脚本里最后两处外网依赖就是 Node 本体和 pnpm 本体
 * （企业插件零依赖、桌面 app 自带 @deepseek-ai/* 运行时，都不走 npm 源）。
 * 把这两样镜像到网关，纯内网环境也能一键装完，且校验值与官方一致。
 *
 * 目录：data/env-repo/index.json + data/env-repo/files/<kind>/<版本>/<平台>-<文件>
 *
 * 与桌面安装包（core/desktop-repo.mjs）同构但不同业务：
 *   · 桌面包按「版本 → 平台（mac/win）」，一个 dmg/exe 通吃各架构；
 *   · Node 没有通用构建，mac 必须分 arm64 与 x64，所以平台串带架构；
 *   · pnpm 是单一 npm tarball（自包含、零依赖），平台记 'any'。
 * 下载原语（白名单/流式/双摘要）统一走 core/artifact-http.mjs，两个域共用一份。
 */
import fs from 'node:fs'
import path from 'node:path'
import { pipeline } from 'node:stream/promises'
import { Transform } from 'node:stream'
import { createHash } from 'node:crypto'
import { dataDir, getConfig } from '../config.mjs'
import { BASE_TRUSTED_HOSTS, digestMatches, downloadTo, getJson, getText, parseDigest } from './artifact-http.mjs'

/* ---------- 目录与常量 ---------- */

const ENV_DIR = path.join(dataDir, 'env-repo')
const FILES_DIR = path.join(ENV_DIR, 'files')
const INDEX = path.join(ENV_DIR, 'index.json')

/** 物料种类：平台列表就是脚本会向网关索取的键（两类都按机器架构分平台） */
export const KINDS = {
  node: { zh: 'Node.js', en: 'Node.js', platforms: ['mac-arm64', 'mac-x64', 'win-x64'] },
  // pnpm 按平台分：12 起 npm 主包不再自带运行时（install.js 靠 optionalDependencies
  // 里的 @pnpm/exe.<平台> 顶替占位 bin，顶不到就在首次运行时联网下载），
  // 纯内网跑不动；能离线用的是官方按平台发布的 @pnpm/exe.<os>-<cpu> 原生包。
  pnpm: { zh: 'pnpm', en: 'pnpm', platforms: ['mac-arm64', 'mac-x64', 'win-x64'] },
}

/** pnpm 原生包名（npm 的 os/cpu 命名，与我们的平台键一一对应） */
const PNPM_EXE = {
  'mac-arm64': 'exe.darwin-arm64',
  'mac-x64': 'exe.darwin-x64',
  'win-x64': 'exe.win32-x64',
}

/** Node 各平台的目标文件名（官方命名固定，直接拼；哪几个平台真的有包，由 SHASUMS 清单说话） */
const NODE_ASSET = {
  'mac-arm64': (v) => `node-v${v}-darwin-arm64.tar.gz`,
  'mac-x64': (v) => `node-v${v}-darwin-x64.tar.gz`,
  'win-x64': (v) => `node-v${v}-win-x64.zip`,
}

/** 上游可信域：官方站 + 阿里镜像 + npm registry（后缀匹配） */
const TRUSTED = [...BASE_TRUSTED_HOSTS, 'nodejs.org', 'npmmirror.com', 'npmjs.org']

export const ENV_DEFAULTS = {
  envFeeds: ['official', 'npmmirror'],   // 顺序即优先级：国内机房建议把 npmmirror 放前面
  nodeChannel: 'lts',                    // lts=只跟 LTS（装机基线要稳）；current=连 Current 一起收
  nodeKeepVersions: 2,
  pnpmKeepVersions: 2,
  envAutoSync: true,
  nodeDistBase: 'https://nodejs.org/dist',
  nodeMirrorBase: 'https://npmmirror.com/mirrors/node',
  pnpmRegistry: 'https://registry.npmjs.org',
  pnpmMirror: 'https://registry.npmmirror.com',
  envMaxPackageMb: 512,
  envMaxTotalGb: 3,
}

const num = (v, d, min, max) => {
  const n = Number(v)
  return Number.isFinite(n) && n >= min && n <= max ? Math.round(n) : d
}
const url = (v, d) => {
  const s = String(v ?? '').trim().replace(/\/+$/, '')
  return /^https?:\/\/[\w.-]+/.test(s) ? s : d
}

/** 收敛设置：越界值一律回到默认，页面填错也不会把网关搞成下载任意 URL */
export function resolveEnvSettings(pluginConfig = {}) {
  const d = ENV_DEFAULTS
  const feeds = ['official', 'npmmirror'].filter((f) => (Array.isArray(pluginConfig.envFeeds) ? pluginConfig.envFeeds : d.envFeeds).includes(f))
  const nodeKeep = num(pluginConfig.nodeKeepVersions, d.nodeKeepVersions, 1, 6)
  return {
    envFeeds: feeds.length ? feeds : d.envFeeds,
    nodeChannel: pluginConfig.nodeChannel === 'current' ? 'current' : 'lts',
    nodeKeepVersions: nodeKeep,
    pnpmKeepVersions: num(pluginConfig.pnpmKeepVersions, d.pnpmKeepVersions, 1, 6),
    envAutoSync: pluginConfig.envAutoSync !== false,
    nodeDistBase: url(pluginConfig.nodeDistBase, d.nodeDistBase),
    nodeMirrorBase: url(pluginConfig.nodeMirrorBase, d.nodeMirrorBase),
    pnpmRegistry: url(pluginConfig.pnpmRegistry, d.pnpmRegistry),
    pnpmMirror: url(pluginConfig.pnpmMirror, d.pnpmMirror),
    envMaxPackageMb: num(pluginConfig.envMaxPackageMb, d.envMaxPackageMb, 8, 4096),
    envMaxTotalGb: num(pluginConfig.envMaxTotalGb, d.envMaxTotalGb, 1, 200),
    allowedHosts: Array.isArray(pluginConfig.allowedHosts) ? pluginConfig.allowedHosts.map((s) => String(s).toLowerCase()).filter(Boolean) : [],
  }
}

/* ---------- 索引 ---------- */

const VER_RE = /^\d+\.\d+\.\d+$/
const now = () => new Date().toISOString().slice(0, 19).replace('T', ' ')

function verCmp(a, b) {
  const pa = String(a).split('.').map(Number)
  const pb = String(b).split('.').map(Number)
  for (let i = 0; i < 3; i++) { if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0) }
  return 0
}

let cache = null
function loadIndex() {
  if (cache) return cache
  try {
    cache = JSON.parse(fs.readFileSync(INDEX, 'utf8'))
  } catch {
    cache = { published: { node: null, pnpm: null }, publishedAt: { node: '', pnpm: '' }, checkedAt: '', lastError: '', kinds: { node: {}, pnpm: {} } }
  }
  // 结构兜底：老索引缺 kind 时补空，别让索引损坏拖垮整个网关
  cache.published ||= { node: null, pnpm: null }
  cache.publishedAt ||= { node: '', pnpm: '' }
  cache.kinds ||= { node: {}, pnpm: {} }
  for (const k of Object.keys(KINDS)) cache.kinds[k] ||= {}
  return cache
}

function saveIndex() {
  fs.mkdirSync(ENV_DIR, { recursive: true })
  const tmp = INDEX + '.tmp'
  fs.writeFileSync(tmp, JSON.stringify(loadIndex(), null, 2))
  fs.renameSync(tmp, INDEX)
}

const blank = (kind, version) => ({ kind, version, discoveredAt: now(), channel: '', ltsName: '', date: '', lastError: '', sources: {}, artifacts: {} })
const bucket = (kind) => loadIndex().kinds[kind] ?? {}

/* ---------- 上游源 ---------- */

/** Node：官方 dist 目录（镜像同构），先挑版本，再用 SHASUMS256.txt 决定「到底有哪几个平台的包」 */
async function feedNode(cfg, source) {
  const base = source === 'npmmirror' ? cfg.nodeMirrorBase : cfg.nodeDistBase
  const idx = await getJson(`${base}/index.json`, { timeoutMs: 30000, trusted: TRUSTED, allowed: cfg.allowedHosts })
  if (!Array.isArray(idx)) throw new Error(`${source} 的 index.json 结构不认识`)
  const picks = []
  for (const r of idx) {
    const version = String(r.version ?? '').replace(/^v/, '')
    if (!VER_RE.test(version)) continue
    // 装机基线要稳：默认只跟 LTS（lts 字段是代号字符串，非 LTS 为 false）
    if (cfg.nodeChannel === 'lts' && !r.lts) continue
    picks.push({ version, ltsName: typeof r.lts === 'string' ? r.lts : '', date: String(r.date ?? '').slice(0, 10) })
    if (picks.length >= cfg.nodeKeepVersions + 2) break   // 多探两个够换源用，别把整个目录搬回来
  }
  const out = []
  for (const p of picks) {
    // 平台可用性以摘要清单为准：index.json 的 files 字段是历史命名（osx-arm64-tar…），
    // 而且「列了目录」不等于「这个文件在」；有摘要行才代表这个包真的存在且可校验。
    const sums = new Map()
    try {
      const txt = await getText(`${base}/v${p.version}/SHASUMS256.txt`, { timeoutMs: 30000, trusted: TRUSTED, allowed: cfg.allowedHosts })
      for (const line of txt.split('\n')) {
        const m = /^([0-9a-f]{64})\s+\*?(.+)$/.exec(line.trim())
        if (m) sums.set(m[2].trim(), m[1])
      }
    } catch { /* 下面按「这个版本没有可用平台」处理 */ }
    for (const [plat, mk] of Object.entries(NODE_ASSET)) {
      const fileName = mk(p.version)
      const sha = sums.get(fileName)
      if (!sha) continue
      out.push({
        kind: 'node', version: p.version, platform: plat, fileName,
        url: `${base}/v${p.version}/${fileName}`, digest: sha, size: 0, source,
        meta: { ltsName: p.ltsName, date: p.date, channel: cfg.nodeChannel },
      })
    }
  }
  if (!out.length) throw new Error(`${source} 没在 SHASUMS 里列出可用的 Node 构建`)
  return out
}

/**
 * pnpm：以 npm 的 latest 定版本，再按平台取官方原生二进制包（@pnpm/exe.<os>-<cpu>）。
 * 为什么不直接镜像 pnpm 主包：12 起主包 bin 是占位文本，install.js 要用 optionalDependencies
 * 的 @pnpm/exe.<平台> 覆盖它，覆盖不到就退回首次运行时去 get.pnpm.io / registry.npmjs.org 拉；
 * 装完在内网里跑不起来。原生包只有一个可执行文件，验完摘要就能直接用，也不需要 Node。
 */
async function feedPnpm(cfg, source) {
  const reg = source === 'npmmirror' ? cfg.pnpmMirror : cfg.pnpmRegistry
  const head = { timeoutMs: 20000, trusted: TRUSTED, allowed: cfg.allowedHosts }
  const d = await getJson(`${reg}/pnpm/latest`, head)
  const version = String(d?.version ?? '')
  if (!VER_RE.test(version)) throw new Error(`${source} 没给出可用的 pnpm latest`)
  const out = []
  for (const [plat, pkg] of Object.entries(PNPM_EXE)) {
    try {
      // 平台包与主包同版本号发布；某个平台漏发就跳过（页面显示「源上无此平台」，不编造地址）
      const m = await getJson(`${reg}/@pnpm%2F${pkg}/${version}`, head)
      const dist = m?.dist ?? {}
      if (!dist.tarball) continue
      out.push({
        kind: 'pnpm', version, platform: plat, fileName: `${pkg}-${version}.tgz`,
        url: String(dist.tarball), digest: String(dist.integrity ?? ''),
        size: Number(dist.unpackedSize ?? 0) || 0, source,
        meta: { channel: 'latest', date: '' },
      })
    } catch { /* 该平台没有这个版本 */ }
  }
  if (!out.length) throw new Error(`${source} 上没有 pnpm ${version} 的原生二进制包`)
  return out
}

const FEEDS = { node: feedNode, pnpm: feedPnpm }

/**
 * 探测上游：两条 feed 各问一次，按 (kind, version) 归并成「主产物 + 备选源」。
 * 备选源只在同一 fileName 时互为备份：换文件就等于换包，校验值不能通用。
 */
export async function checkEnvUpstream(cfg) {
  const idx = loadIndex()
  const errors = []
  let any = false
  const fresh = []
  for (const kind of Object.keys(KINDS)) {
    const merged = new Map()
    for (const feed of cfg.envFeeds) {
      try {
        const items = await FEEDS[kind](cfg, feed)
        any = true
        for (const it of items) {
          const byPlat = merged.get(it.version) ?? {}
          const cur = byPlat[it.platform]
          if (!cur) byPlat[it.platform] = [it]
          else if (cur[0].fileName === it.fileName && !cur.some((x) => x.url === it.url)) cur.push(it)
          merged.set(it.version, byPlat)
        }
      } catch (e) {
        errors.push({ kind, feed, error: String(e?.message ?? e).slice(0, 160) })
      }
    }
    for (const [version, byPlat] of merged) {
      if (!VER_RE.test(version)) continue
      const v = bucket(kind)[version] ?? blank(kind, version)
      const isNew = !bucket(kind)[version]
      const first = Object.values(byPlat)[0]?.[0]
      v.channel = first?.meta?.channel ?? v.channel
      v.ltsName = first?.meta?.ltsName ?? v.ltsName
      v.date = first?.meta?.date ?? v.date
      v.sources = byPlat
      v.status = statusOf(v, false)
      idx.kinds[kind][version] = v
      if (isNew) fresh.push(`${kind}:${version}`)
    }
  }
  idx.checkedAt = now()
  idx.lastError = any ? '' : `所有环境物料源都不可达：${errors.map((e) => `${e.kind}/${e.feed}: ${e.error}`).join('; ')}`.slice(0, 400)
  saveIndex()
  prune(cfg)
  return { checkedAt: idx.checkedAt, fresh, errors, unreachable: !any }
}

/* ---------- 入库 ---------- */

/** 同步中的 (kind+版本+平台)：定时器与管理台按钮会撞车，同一目标绝不并发 */
const busy = new Set()

const safeName = (s) => String(s).replace(/[^\w.+-]/g, '_').slice(-96)
// 落盘名带平台前缀（Node 三个平台同名不同架构，必须分开）；pnpm 只有一个包，不加前缀，
// 下载时用户看到的就是 node-v24.21.0-darwin-arm64.tar.gz / pnpm-12.5.1.tgz 这种官方名字
const artifactPath = (kind, version, platform, fileName) =>
  path.join(FILES_DIR, kind, version, platform === 'any' ? safeName(fileName) : `${platform}-${safeName(fileName)}`)

/**
 * 同步一个版本（可只做某个平台）：逐源试下载 → 摘要必对 → 原子改名 → 写索引。
 * 已经有一致实体的平台默认跳过：计划任务每小时检测一次，若每次都重拉，
 * 保留窗口里几个版本（Node 三平台约 140MB/版）会被反复从公网拖进来。
 * force=true（仅接口传）才重下一遍，用于怀疑本地实体损坏时的人工修复。
 */
export async function syncEnv(kind, version, cfg, { platform, by = 'scheduler', force = false } = {}) {
  const v = bucket(kind)[version]
  if (!v) throw new Error(`索引里没有 ${kind} ${version}，请先点检测更新`)
  const plats = platform ? [platform] : Object.keys(v.sources)
  if (!plats.length) throw new Error(`${kind} ${version} 没有可用的上游地址`)
  const done = []
  const skipped = []
  const failures = []
  const attempts = []
  for (const p of plats) {
    const key = `${kind}:${version}:${p}`
    if (busy.has(key)) throw new Error(`${kind} ${version}/${p} 正在同步中，请等上一轮结束`)
    busy.add(key)
    try {
      const cands = v.sources[p] ?? []
      const want = parseDigest(cands[0]?.digest)
      const dest = artifactPath(kind, version, p, cands[0]?.fileName ?? p)
      // 已有实体且摘要与上游一致（上游没给摘要时按「手工上传的实体就是权威」处理）→ 跳过
      const prev0 = v.artifacts?.[p]
      const haveIt = !force && prev0?.file && prev0.size > 0
        && fs.existsSync(path.join(ENV_DIR, prev0.file))
        && !(want && !digestMatches(want, { sha256: prev0.sha256, sha512: prev0.sha512 }))
      if (haveIt) { skipped.push(p); attempts.push({ platform: p, source: prev0.source || 'local', ok: true, error: '本地已有一致的实体，跳过' }); continue }
      let last = null
      for (const src of cands) {
        const sw = parseDigest(src.digest)
        if (want && sw && (sw.algo !== want.algo || sw.value !== want.value)) {
          attempts.push({ platform: p, source: src.source, ok: false, error: '摘要与首选源不一致，跳过（不是同一个包）' })
          continue
        }
        try {
          const got = await downloadTo(src.url, dest, { maxMb: cfg.envMaxPackageMb, trusted: TRUSTED, allowed: cfg.allowedHosts })
          if (want && !digestMatches(want, got)) {
            fs.rmSync(got.file, { force: true })
            throw new Error(`摘要校验不一致（期望 ${want.algo} ${String(want.value).slice(0, 12)}… / 实算 ${got.sha256.slice(0, 12)}…）`)
          }
          fs.rmSync(dest, { force: true })
          fs.renameSync(got.file, dest)
          // 上游在同一版本内换了文件名时，旧实体要跟着清掉：否则索引不认它，磁盘上却永远留着
          const prev = v.artifacts?.[p]
          if (prev?.file && path.join(ENV_DIR, prev.file) !== dest) {
            try { fs.rmSync(path.join(ENV_DIR, prev.file), { force: true }) } catch { /* 已经不在了 */ }
          }
          v.artifacts[p] = {
            file: path.relative(ENV_DIR, dest), fileName: path.basename(dest), size: got.size,
            sha256: got.sha256, sha512: got.sha512, verified: !!want, source: src.source, sourceUrl: src.url,
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
  return { kind, version, synced: done, skipped, failed: failures, attempts }
}

/** 离线上传：不通公网的客户把包拷进来，摘要由网关实算（verified=false，页面如实标注） */
export async function addEnvFromUpload(req, { kind, version, platform, fileName, by = 'admin' }, cfg) {
  if (!KINDS[kind]) throw new Error(`未知物料类型 ${kind}`)
  if (!VER_RE.test(String(version))) throw new Error('版本号形如 24.21.0')
  const plats = KINDS[kind].platforms
  const plat = plats.includes(platform) ? platform : plats[0]
  if (!KINDS[kind].platforms.includes(plat)) throw new Error(`${kind} 不支持平台 ${plat}`)
  const name = safeName(fileName || `${kind}-${version}`)
  const idx = loadIndex()
  const v = idx.kinds[kind][version] ?? blank(kind, version)
  const dest = artifactPath(kind, version, plat, name)
  fs.mkdirSync(path.dirname(dest), { recursive: true })
  const tmp = dest + '.part'
  const h256 = createHash('sha256')
  const h512 = createHash('sha512')
  let size = 0
  const limit = cfg.envMaxPackageMb * 1024 * 1024
  const counter = new Transform({
    transform(chunk, _enc, cb) {
      size += chunk.length
      if (size > limit) return cb(new Error(`上传文件超过上限 ${cfg.envMaxPackageMb}MB`))
      h256.update(chunk); h512.update(chunk)
      cb(null, chunk)
    },
  })
  try {
    await pipeline(req, counter, fs.createWriteStream(tmp))
  } catch (e) {
    fs.rmSync(tmp, { force: true })
    throw e
  }
  fs.rmSync(dest, { force: true })
  fs.renameSync(tmp, dest)
  v.artifacts[plat] = {
    file: path.relative(ENV_DIR, dest), fileName: path.basename(dest), size,
    sha256: h256.digest('hex'), sha512: h512.digest('base64'),
    verified: false, source: 'upload', sourceUrl: '', syncedAt: now(), by: String(by).slice(0, 64),
  }
  v.lastError = ''
  idx.kinds[kind][version] = v
  v.status = statusOf(v, false)
  saveIndex()
  prune(cfg)
  return { kind, version, platform: plat, fileName: path.basename(dest), size, sha256: v.artifacts[plat].sha256 }
}

/* ---------- 状态与保留策略 ---------- */

function statusOf(v, failedAll = false) {
  const have = Object.keys(v.artifacts ?? {}).length
  const want = Object.keys(v.sources ?? {}).length || KINDS[v.kind]?.platforms.length || 1
  if (!have) return failedAll ? 'error' : 'remote'
  return have >= want ? 'ready' : 'partial'
}

function dropFiles(kind, version) {
  const v = bucket(kind)[version]
  if (!v) return
  for (const a of Object.values(v.artifacts ?? {})) {
    try { fs.rmSync(path.join(ENV_DIR, a.file), { force: true }) } catch { /* 已经不在了 */ }
  }
  v.artifacts = {}
  v.status = statusOf(v, false)
}

/** 每个 kind 保留「已发布 + 最新 N 个」的文件；索引条目留着（可回滚、可重新同步） */
function prune(cfg) {
  const idx = loadIndex()
  for (const kind of Object.keys(KINDS)) {
    const keep = kind === 'node' ? cfg.nodeKeepVersions : cfg.pnpmKeepVersions
    const vers = Object.keys(bucket(kind)).sort(verCmp).reverse()
    const published = idx.published[kind]
    const keepFiles = new Set(vers.filter((v) => v === published).slice(0, keep + 1))
    let slots = keep
    for (const v of vers) {
      if (v === published) continue
      if (slots-- > 0) keepFiles.add(v)
    }
    for (const v of vers) if (!keepFiles.has(v)) dropFiles(kind, v)
    // 索引本身也瘦身：每个 kind 最多留 30 个版本记录
    if (vers.length > 30) {
      for (const v of vers.slice(30)) if (v !== published) delete idx.kinds[kind][v]
    }
  }
  // 总量闸门：超出 envMaxTotalGb 就从最旧的开始清文件
  const limit = cfg.envMaxTotalGb * 1024 * 1024 * 1024
  const all = []
  for (const kind of Object.keys(KINDS)) {
    for (const [version, v] of Object.entries(bucket(kind))) {
      for (const [plat, a] of Object.entries(v.artifacts ?? {})) {
        all.push({ kind, version, plat, at: Date.parse(a.syncedAt ?? '') || 0, size: a.size ?? 0 })
      }
    }
  }
  let total = all.reduce((s, x) => s + x.size, 0)
  if (total > limit) {
    const published = idx.published
    for (const x of all.sort((a, b) => a.at - b.at)) {
      if (total <= limit) break
      if (published[x.kind] === x.version) continue   // 正在下发的绝不动
      const v = bucket(x.kind)[x.version]
      const a = v?.artifacts?.[x.plat]
      if (!a) continue
      try { fs.rmSync(path.join(ENV_DIR, a.file), { force: true }) } catch { /* 已删 */ }
      delete v.artifacts[x.plat]
      total -= x.size
    }
    for (const kind of Object.keys(KINDS)) {
      for (const v of Object.values(bucket(kind))) v.status = statusOf(v, false)
    }
  }
  saveIndex()
}

/* ---------- 查询与发布 ---------- */

/** 当前下发的环境物料（脚本读的就是这个） */
export function envPublished() {
  const idx = loadIndex()
  const out = {}
  for (const kind of Object.keys(KINDS)) {
    const version = idx.published[kind]
    const v = version ? bucket(kind)[version] : null
    out[kind] = v && Object.keys(v.artifacts ?? {}).length ? v : null
  }
  return { published: idx.published, at: idx.publishedAt, versions: out }
}

/** 解析一个可下载的物料（版本省略时取该 kind 的下发版本） */
export function resolveEnvArtifact(kind, platform, version) {
  if (!KINDS[kind]) return null
  const idx = loadIndex()
  const ver = version || idx.published[kind]
  if (!ver) return null
  const v = bucket(kind)[ver]
  if (!v) return null
  const plats = KINDS[kind].platforms
  const plat = plats.includes(platform) ? platform : (plats.length === 1 ? plats[0] : null)
  if (!plat) return null
  const a = v.artifacts?.[plat]
  if (!a) return null
  const file = path.join(ENV_DIR, a.file)
  return fs.existsSync(file) ? { file, meta: a, version: ver, platform: plat } : null
}

/** 列表页视图：按 kind 分组，新 → 旧 */
export function envListVersions() {
  const idx = loadIndex()
  return Object.keys(KINDS).map((kind) => ({
    kind,
    label: KINDS[kind].zh,
    platforms: KINDS[kind].platforms,   // 页面按这个排表头与上传平台，前端不另写一份清单
    published: idx.published[kind] ?? null,
    versions: Object.keys(bucket(kind)).sort(verCmp).reverse().map((version) => {
      const v = bucket(kind)[version]
      const platforms = {}
      for (const p of KINDS[kind].platforms) {
        const a = v.artifacts?.[p]
        platforms[p] = {
          have: !!a, size: a?.size ?? 0, sha256: a?.sha256 ?? '', verified: a?.verified ?? false,
          source: a?.source ?? '', fileName: a?.fileName ?? '', syncedAt: a?.syncedAt ?? '',
          remote: (v.sources?.[p] ?? []).map((s) => s.source),
        }
      }
      return {
        kind, version, status: v.status ?? statusOf(v), published: idx.published[kind] === version,
        ltsName: v.ltsName ?? '', date: v.date ?? '', discoveredAt: v.discoveredAt ?? '', lastError: v.lastError ?? '',
        bytes: Object.values(v.artifacts ?? {}).reduce((s, a) => s + (a.size ?? 0), 0),
        platforms,
      }
    }),
  }))
}

export function envOverview() {
  const idx = loadIndex()
  let bytes = 0
  const busyList = [...busy]
  for (const kind of Object.keys(KINDS)) {
    for (const v of Object.values(bucket(kind))) bytes += Object.values(v.artifacts ?? {}).reduce((s, a) => s + (a.size ?? 0), 0)
  }
  return { published: idx.published, publishedAt: idx.publishedAt, checkedAt: idx.checkedAt, lastError: idx.lastError, totalBytes: bytes, dir: ENV_DIR, busy: busyList }
}

/** 发布指针：没有本地包就不许下发，否则脚本会被指向一个不存在的地址 */
export function setEnvPublished(kind, version) {
  if (!KINDS[kind]) throw new Error(`未知物料类型 ${kind}`)
  const idx = loadIndex()
  const want = version === null || version === '' ? null : String(version)
  if (want !== null) {
    const v = bucket(kind)[want]
    if (!v || !Object.keys(v.artifacts ?? {}).length) {
      throw new Error(`${kind} ${want} 还没有本地包，请先同步或上传后再发布`)
    }
  }
  idx.published[kind] = want
  idx.publishedAt[kind] = want ? now() : ''
  saveIndex()
  prune(loadCfg())
  return idx.published[kind]
}

export function removeEnvVersion(kind, version) {
  const idx = loadIndex()
  if (!KINDS[kind]) throw new Error(`未知物料类型 ${kind}`)
  if (idx.published[kind] === version) throw new Error(`${kind} ${version} 是当前下发版本，请先切换到其他版本再删`)
  const v = bucket(kind)[version]
  if (!v) throw new Error(`索引里没有 ${kind} ${version}`)
  dropFiles(kind, version)
  delete idx.kinds[kind][version]
  saveIndex()
  return { kind, version }
}

export function markEnvError(message) {
  const idx = loadIndex()
  idx.lastError = String(message ?? '').slice(0, 400)
  saveIndex()
}

export const hasEnvVersion = (kind, version) => !!bucket(kind)[version]
export const knownEnvVersions = (kind, limit) => Object.keys(bucket(kind)).sort(verCmp).reverse().slice(0, limit)
const loadCfg = () => resolveEnvSettings(getConfig().plugins?.['ent-desktop']?.config ?? {})

/** 安装脚本读的公开契约：路径给相对值，脚本自己拼网关地址 */
export function envReleasePayload({ allowUpstreamFallback = true } = {}) {
  const idx = loadIndex()
  const pub = envPublished()
  const entry = (kind, platform) => {
    const hit = resolveEnvArtifact(kind, platform)
    if (!hit) return null
    return {
      version: hit.version, fileName: hit.meta.fileName, size: hit.meta.size,
      sha256: hit.meta.sha256, sha512: hit.meta.sha512, verified: hit.meta.verified, source: hit.meta.source,
      path: `/setup/env/${kind}/${platform}/${hit.version}`, sizeMb: Math.round((hit.meta.size / 1048576) * 10) / 10,
    }
  }
  /** 一个 kind 的对外文件清单：脚本按自己机器架构的键取用，缺的键就是不提供 */
  const filesOf = (kind) => Object.fromEntries(KINDS[kind].platforms
    .map((p) => [p, entry(kind, p)])
    .filter(([, e]) => e))
  const node = pub.versions.node
  const pnpm = pub.versions.pnpm
  return {
    ok: true,
    checkedAt: idx.checkedAt,
    lastError: idx.lastError,
    allowUpstreamFallback,
    // 两类物料同构：{ version, files: { 'mac-arm64' | 'mac-x64' | 'win-x64': { path, sha256, … } } }
    node: node ? {
      version: node.version, lts: node.ltsName || null, date: node.date || '',
      files: filesOf('node'),
    } : null,
    pnpm: pnpm ? { version: pnpm.version, files: filesOf('pnpm') } : null,
  }
}

export const envBusy = () => [...busy]
