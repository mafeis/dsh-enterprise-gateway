/**
 * 企业插件仓库 · 网关侧统一插件存储
 * 磁盘布局：
 *   data/plugin-repo/index.json                      —— 索引（插件元数据 + 版本清单）
 *   data/plugin-repo/packages/<name>/<version>.tgz   —— 包文件（@scope/ 插件为 packages/@scope/<name>/）
 * 索引结构：
 *   { plugins: { [name]: { name, description, descriptionManual, createdAt, updatedAt,
 *                          defaultVersion, versions: { [ver]: { size, sha256, ts, by, note, source } } } } }
 * 来源：source = npm（按包名/地址从 npm 源拉取）| upload（管理台直接上传压缩包）
 * 下载：GET /plugin-packages/<name>（默认版本）· /<name>/<ver> · /<name>/-/<file>.tgz —— 见 ent-client 路由
 */
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import zlib from 'node:zlib'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO_DIR = path.join(__dirname, '..', '..', 'data', 'plugin-repo')
const PKG_DIR = path.join(REPO_DIR, 'packages')
const INDEX_FILE = path.join(REPO_DIR, 'index.json')

const NAME_RE = /^(@[a-zA-Z0-9_-]{1,64}\/)?[a-zA-Z0-9_-]{2,64}$/
const VER_RE = /^\d+\.\d+\.\d+(-[0-9A-Za-z.+-]+)?$/
export const MAX_TARBALL = 64 * 1024 * 1024

/** 常见插件中文名录：入库时包自述是英文则优先替换（管理员手动改过的不覆盖） */
const DESC_ZH = {
  'dsh-enterprise': '企业账号登录、模型接入与安全管控',
  'dshmarket': 'DSH 内置的可视化插件市场',
  'dsh-better-sidebar': 'VSCode 风格的右侧边栏：对话大纲 / 终端 / 文件树',
  'dsh-context': '会话上下文增强：注入工作区与项目背景信息',
  'dsh-mnemon': '三级记忆管理平台（会话 / 项目 / 长期记忆）',
  'dsh-startup-guard': '启动防护：宿主异常关闭后自动恢复会话',
  'dsh-hot-reload': '插件热更新：升级已装插件无需重启 DSH',
  'dsh-image-guard': '图片裁剪',
  'dsh-net-proxy': '网络代理',
  'dsh-review': '多智能体对抗式代码审查（打包版）',
  '@deepseek-ai/dsh-headless': '无界面运行形态：服务器/CI 中跑 DSH 会话',
  '@deepseek-ai/dsh-base': 'DSH 宿主基础组件（必装）',
  '@deepseek-ai/dsh-web-app': 'DSH Web 图形界面（必装）',
  '@anysearch/anysearch-dsh': 'AnySearch 联网搜索与网页抓取提供方',
  '@vlln/dsh-navbar': '对话节点导航条：快速跳转到任意 user 消息',
}
const hasCJK = (s) => /[\u4e00-\u9fff\u3400-\u4dbf]/.test(String(s ?? ''))

/* ---------- 索引读写 ---------- */
let _index = null
function loadIndex() {
  if (_index) return _index
  try { _index = JSON.parse(fs.readFileSync(INDEX_FILE, 'utf8')) } catch { _index = { plugins: {} } }
  if (!_index.plugins) _index.plugins = {}
  return _index
}
function saveIndex() {
  fs.mkdirSync(REPO_DIR, { recursive: true })
  const tmp = INDEX_FILE + '.tmp'
  fs.writeFileSync(tmp, JSON.stringify(_index, null, 2))
  fs.renameSync(tmp, INDEX_FILE)
}

/* ---------- 路径安全 ---------- */
function pkgDirOf(name) {
  // @scope/pkg → packages/@scope/pkg；普通名 → packages/pkg（拒绝任何路径穿越）
  const segs = String(name).split('/').filter(Boolean)
  const segOk = (s) => /^@?[a-zA-Z0-9_-]{1,64}$/.test(s) && !s.includes('..')
  if (!segs.length || segs.length > 2 || !segs.every(segOk)) throw new Error('非法插件名')
  return path.join(PKG_DIR, ...segs)
}
const fileOf = (name, ver) => path.join(pkgDirOf(name), `${ver}.tgz`)

/* ---------- tar 解析：从 tgz 中取 package/package.json ---------- */
function tarFindEntry(tarBuf, wantName) {
  let off = 0
  while (off + 512 <= tarBuf.length) {
    const header = tarBuf.subarray(off, off + 512)
    if (header.every((b) => b === 0)) return null          // 结束块
    let name = header.subarray(0, 100).toString('utf8').replace(/\0.*$/, '')
    const prefix = header.subarray(345, 345 + 155).toString('utf8').replace(/\0.*$/, '')
    if (prefix) name = prefix + '/' + name
    const typeflag = String.fromCharCode(header[156] || 0x20)
    const size = parseInt(header.subarray(124, 124 + 12).toString('utf8').replace(/[\0 ]*$/g, '').trim() || '0', 8) || 0
    const dataOff = off + 512
    if ((typeflag === '0' || typeflag === '\0') && name === wantName) return tarBuf.subarray(dataOff, dataOff + size)
    off = dataOff + Math.ceil(size / 512) * 512
  }
  return null
}

/** 解包 tgz/tar → { manifest }（manifest = 包内 package.json） */
export function inspectTarball(buf) {
  let tarBuf = buf
  if (buf.length > 2 && buf[0] === 0x1f && buf[1] === 0x8b) {
    try { tarBuf = zlib.gunzipSync(buf) } catch { throw new Error('压缩包解压失败（不是合法的 .tgz）') }
  }
  for (const entryName of ['package/package.json', 'package.json']) {
    const hit = tarFindEntry(tarBuf, entryName)
    if (!hit) continue
    try {
      const manifest = JSON.parse(hit.toString('utf8'))
      if (!manifest || typeof manifest !== 'object') throw new Error('package.json 不是对象')
      return { manifest }
    } catch (e) { throw new Error('包内 package.json 解析失败：' + e.message) }
  }
  throw new Error('压缩包里没找到 package.json（需要 npm .tgz 格式）')
}

/* ---------- 版本比较（纯数字段 + 预发布号兜底字符串） ---------- */
function verCmp(a, b) {
  const pa = a.split('-')[0].split('.').map(Number)
  const pb = b.split('-')[0].split('.').map(Number)
  for (let i = 0; i < 3; i++) { if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0) }
  return a < b ? -1 : a > b ? 1 : 0
}
export const highestVersion = (vers) => Object.keys(vers).sort(verCmp).pop() ?? null

/* ---------- 写入 ---------- */
function putTarball(buf, { by = '-', note = '', source = 'upload' } = {}) {
  const { manifest } = inspectTarball(buf)
  const name = String(manifest.name ?? '').trim()
  const version = String(manifest.version ?? '').trim()
  if (!NAME_RE.test(name)) throw new Error(`包名不合法：${name}（限 2-64 位字母数字_-，可带 @scope/）`)
  if (!VER_RE.test(version)) throw new Error(`版本号不合法：${version}`)
  const dir = pkgDirOf(name)
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(fileOf(name, version), buf)

  const idx = loadIndex()
  const now = new Date().toISOString().slice(0, 19).replace('T', ' ')
  const p = (idx.plugins[name] ??= { name, description: '', descriptionManual: false, createdAt: now, versions: {} })
  if (!p.defaultVersion) p.defaultVersion = version
  if (manifest.description && !p.descriptionManual) {
    const raw = String(manifest.description).slice(0, 300)
    // 英文自述 → 中文名录优先（名录没有且原文无中文才保留原文）
    p.description = hasCJK(raw) ? raw : (DESC_ZH[name] ?? raw)
  }
  p.versions[version] = {
    size: buf.length,
    sha256: crypto.createHash('sha256').update(buf).digest('hex'),
    ts: now,
    by: String(by).slice(0, 64),
    note: String(note ?? '').slice(0, 200),
    source,
  }
  p.updatedAt = now
  saveIndex()
  return { name, version, plugin: p }
}

/* ---------- npm 拉取 ---------- */
function parseSpec(spec) {
  const s = String(spec ?? '').trim()
  if (!s) throw new Error('请填写插件包名或 .tgz 地址')
  if (/^https?:\/\//.test(s)) return { kind: 'url', url: s }
  const m = s.match(/^(@[^@/]+\/[^@/]+|[^@/]+)(?:@(.+))?$/)   // name[@version]
  if (!m) throw new Error(`包名格式不认识：${s}（示例 dsh-review / @corp/dsh-review@1.2.0）`)
  return { kind: 'npm', name: m[1], version: m[2] || null }
}

async function fetchBuffer(url) {
  const r = await fetch(url, { redirect: 'follow' })
  if (!r.ok) throw new Error(`下载失败 ${r.status}：${url}`)
  const ab = await r.arrayBuffer()
  if (ab.byteLength > MAX_TARBALL) throw new Error('包超过 64MB 上限')
  return Buffer.from(ab)
}

export async function addFromNpm({ spec, registry, by, note } = {}) {
  const parsed = parseSpec(spec)
  if (parsed.kind === 'url') return { ...putTarball(await fetchBuffer(parsed.url), { by, note, source: 'npm' }), spec: parsed.url }
  const base = String(registry ?? '').trim().replace(/\/+$/, '') || 'https://registry.npmjs.org'
  const metaUrl = `${base}/${parsed.name.replace('/', '%2F')}`
  const r = await fetch(metaUrl, { redirect: 'follow' })
  if (!r.ok) throw new Error(`npm 源查询失败 ${r.status}：${metaUrl}`)
  const meta = await r.json()
  const versions = meta.versions ?? {}
  let want = parsed.version
  if (!want) {
    const latestTag = meta['dist-tags']?.latest
    want = latestTag && versions[latestTag] ? latestTag : Object.keys(versions).sort(verCmp).pop()
  }
  const dist = versions[want]?.dist?.tarball
  if (!dist) throw new Error(`npm 源上没有版本 ${want}（可选：${Object.keys(versions).slice(-5).join(', ')}）`)
  return { ...putTarball(await fetchBuffer(dist), { by, note, source: 'npm' }), spec: `${parsed.name}@${want}` }
}

export function addFromUpload(buf, { by, note } = {}) {
  if (!buf?.length) throw new Error('上传内容为空')
  if (buf.length > MAX_TARBALL) throw new Error('包超过 64MB 上限')
  return putTarball(buf, { by, note, source: 'upload' })
}

/* ---------- 读取 / 元数据 ---------- */
export function listRepo() {
  const idx = loadIndex()
  return Object.values(idx.plugins).map((p) => {
    const vers = Object.entries(p.versions)
    const totalSize = vers.reduce((s, [, v]) => s + (v.size || 0), 0)
    return {
      name: p.name,
      description: p.description ?? '',
      defaultVersion: p.defaultVersion,
      versionCount: vers.length,
      totalSize,
      versions: Object.fromEntries(vers),
      updatedAt: p.updatedAt ?? '',
    }
  }).sort((a, b) => a.name.localeCompare(b.name))
}

export function getPlugin(name) {
  return loadIndex().plugins[String(name)] ?? null
}

export function setMeta(name, { description } = {}) {
  const idx = loadIndex()
  const p = idx.plugins[String(name)]
  if (!p) throw new Error(`仓库中没有插件 ${name}`)
  if (description !== undefined) {
    p.description = String(description ?? '').slice(0, 300)
    p.descriptionManual = true
  }
  p.updatedAt = new Date().toISOString().slice(0, 19).replace('T', ' ')
  saveIndex()
  return p
}

export function setDefaultVersion(name, version) {
  const p = getPlugin(name)
  if (!p) throw new Error(`仓库中没有插件 ${name}`)
  if (!p.versions[version]) throw new Error(`没有版本 ${version}`)
  p.defaultVersion = version
  saveIndex()
  return p
}

export function setVersionNote(name, version, note) {
  const p = getPlugin(name)
  if (!p?.versions[version]) throw new Error(`没有版本 ${version}`)
  p.versions[version].note = String(note ?? '').slice(0, 200)
  saveIndex()
  return p
}

function dropPluginIfEmpty(name) {
  const idx = loadIndex()
  const p = idx.plugins[name]
  if (p && !Object.keys(p.versions).length) {
    delete idx.plugins[name]
    try { fs.rmSync(pkgDirOf(name), { recursive: true, force: true }) } catch { /* 目录已在则忽略 */ }
  }
}

export function removeVersion(name, version) {
  const idx = loadIndex()
  const p = idx.plugins[String(name)]
  if (!p?.versions[version]) throw new Error(`没有版本 ${version}`)
  delete p.versions[version]
  try { fs.rmSync(fileOf(name, version), { force: true }) } catch { /* 文件缺失容忍 */ }
  if (p.defaultVersion === version) p.defaultVersion = highestVersion(p.versions)
  dropPluginIfEmpty(name)
  saveIndex()
  return getPlugin(name)
}

export function removePlugin(name) {
  const idx = loadIndex()
  if (!idx.plugins[String(name)]) throw new Error(`仓库中没有插件 ${name}`)
  delete idx.plugins[String(name)]
  try { fs.rmSync(pkgDirOf(name), { recursive: true, force: true }) } catch { /* 目录已在则忽略 */ }
  saveIndex()
}

/** 解析下载请求 → { file, version }；version 缺省取默认版本 */
export function resolveTarball(name, version) {
  const p = getPlugin(name)
  if (!p) return null
  const ver = version || p.defaultVersion
  if (!ver || !p.versions[ver]) return null
  return { file: fileOf(name, ver), version: ver }
}
