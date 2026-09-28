/**
 * 静态资源服务：admin-web 目录
 * - /admin            → 组装 index.html（把 <!-- @include: views/xxx.html --> 内联展开）
 * - /admin/static/*   → css / js 模块 / 其他白名单文件
 * 白名单扩展名 + 文件名校验防目录穿越
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { dirname, join, extname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ADMIN_WEB_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'admin-web')
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.mjs': 'application/javascript; charset=utf-8', '.svg': 'image/svg+xml' }

const safeJoin = (rel) => {
  if (!/^[a-zA-Z0-9._\/-]+$/.test(rel) || rel.includes('..')) return null
  const file = join(ADMIN_WEB_DIR, rel)
  if (!file.startsWith(ADMIN_WEB_DIR)) return null
  return file
}

/** 稳定版本号 = admin-web 全部文件内容哈希：内容一改 index 引用即换 URL；
 *  不能用 mtime：npm tarball 内文件 mtime 固定，升级后 URL 不变会永久命中旧资源。
 *  也不用 Date.now()（每次请求都变），否则浏览器/CDN 边缘永远无法缓存 index 引用的资源。
 */
function indexVer() {
  const h = createHash('sha256')
  const walk = (dir, base = '') => {
    const entries = readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))
    for (const e of entries) {
      const p = join(dir, e.name)
      const rel = base ? `${base}/${e.name}` : e.name
      if (e.isDirectory()) walk(p, rel)
      else { try { h.update(rel).update('\0').update(readFileSync(p)) } catch {} }
    }
  }
  walk(ADMIN_WEB_DIR)
  return h.digest('hex').slice(0, 12)
}

/** 组装 index.html：递归展开 @include 注释（views/ 内可再嵌套 include） */
function composeIndex() {
  let html = readFileSync(join(ADMIN_WEB_DIR, 'index.html'), 'utf8')
  const ver = indexVer()
  for (let i = 0; i < 5; i++) {
    if (!html.includes('@include:')) break
    html = html.replace(/<!--\s*@include:\s*([\w./-]+\.html)\s*-->/g, (_, rel) => {
      const file = safeJoin(rel)
      if (!file || !existsSync(file)) return `<!-- missing: ${rel} -->`
      return readFileSync(file, 'utf8')
    })
  }
  // 给静态资源引用追加版本参数，彻底击穿浏览器缓存
  html = html.replace(/\/admin\/static\/[\w./-]+/g, (m) => m + '?v=' + ver)
  return html
}

/** mjs 模块内相对 import 统一重打 ?v=<被导入文件内容哈希>。
 *  不能用 mtime：npm tarball 里的文件 mtime 固定（真实事故：升级后仍是 1985 年时间戳，
 *  旧模块被浏览器 immutable 缓存永久命中，页面报 “does not provide an export named …”）。
 *  版本号取被导入文件自身内容，同一模块被多个导入方引用时 URL 仍一致，避免 ESM 双实例。
 */
function contentVer(text) {
  return createHash('sha256').update(text).digest('hex').slice(0, 12)
}

export function versionMjs(file, raw) {
  const dir = dirname(file)
  const verOf = (rel) => {
    try { return contentVer(readFileSync(join(dir, rel), 'utf8')) }
    catch { return contentVer(raw) }   // 目标缺失：退回导入方内容
  }
  return raw
    .replace(/(from\s+')(\.[^']+?\.mjs)(\?v=[\w.-]+)?(')/g, (_, a, p, _old, z) => a + p + '?v=' + verOf(p) + z)
    .replace(/(import\(')(\.[^']+?\.mjs)(\?v=[\w.-]+)?(')/g, (_, a, p, _old, z) => a + p + '?v=' + verOf(p) + z)
}

const CACHE_IMMUTABLE = 'public, max-age=31536000, immutable'   // 带 ?v= 的引用：文件改 → URL 变，长缓存绝对安全
const CACHE_SHORT = 'public, max-age=60'                        // 无版本参数的兜底：有界过期，不会永久陈旧

/** 带 ?v= 的 URL 用一年 immutable（浏览器+CDN 全命中），否则 60s 短缓存兜底 */
const cacheControl = (url) => (url?.searchParams?.has('v') ? CACHE_IMMUTABLE : CACHE_SHORT)

export function serveStatic(res, path, url) {
  let rel
  if (path === '/admin' || path === '/admin/') rel = '__index__'
  else if (path.startsWith('/admin/static/')) rel = path.replace('/admin/static/', '').split('?')[0]
  else return false

  const send = (data, ext) => {
    // index.html 不带版本参数且是组装产物：必须 no-store（引用自身的 ?v= 已负责资源换版）
    const cc = rel === '__index__' ? 'no-store' : cacheControl(url)
    res.writeHead(200, { 'content-type': MIME[ext] ?? 'text/plain; charset=utf-8', 'cache-control': cc })
    res.end(data)
  }

  if (rel === '__index__') {
    try { send(composeIndex(), '.html'); return true } catch { return false }
  }
  const file = safeJoin(rel)
  if (!file || !existsSync(file)) return false
  const ext = extname(file)
  if (!MIME[ext]) return false
  try {
    const raw = readFileSync(file)
    send(ext === '.mjs' ? versionMjs(file, raw.toString('utf8')) : raw, ext)
    return true
  } catch { return false }
}

/* ---------- 插件自有页面资源：/admin/plug/<插件名>/<文件> ----------
 * 约定：插件目录旁的 <name>.web/ 是它的界面资源包（页面 html 片段 + 页面模块）。
 * 插件自带页面 = 插件自己的事：装载了谁，管理台导航就多谁；禁用/卸载页面随之消失。
 */
import { pluginRegistry } from './plugin-registry.mjs'

export function servePluginWeb(res, path, url) {
  if (!path.startsWith('/admin/plug/')) return false
  const rest = path.replace('/admin/plug/', '').split('?')[0]
  const slash = rest.indexOf('/')
  if (slash <= 0) return false
  const name = rest.slice(0, slash)
  const rel = rest.slice(slash + 1)
  const entry = pluginRegistry.loaded.find((p) => p.name === name)
  if (!entry?.webDir) return false
  if (!/^[a-zA-Z0-9._/-]+$/.test(rel) || rel.includes('..')) return false
  const file = join(entry.webDir, rel)
  if (!file.startsWith(entry.webDir)) return false
  const ext = extname(file)
  if (!MIME[ext] || !existsSync(file)) return false
  try {
    const raw = readFileSync(file)
    res.writeHead(200, { 'content-type': MIME[ext], 'cache-control': cacheControl(url) })
    res.end(ext === '.mjs' ? versionMjs(file, raw.toString('utf8')) : raw)
    return true
  } catch { return false }
}
