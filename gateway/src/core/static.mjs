/**
 * 静态资源服务：admin-web 目录
 * - /admin            → 组装 index.html（把 <!-- @include: views/xxx.html --> 内联展开）
 * - /admin/static/*   → css / js 模块 / 其他白名单文件
 * 白名单扩展名 + 文件名校验防目录穿越
 */
import { readFileSync, existsSync, statSync } from 'node:fs'
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

/** 组装 index.html：递归展开 @include 注释（views/ 内可再嵌套 include） */
function composeIndex() {
  let html = readFileSync(join(ADMIN_WEB_DIR, 'index.html'), 'utf8')
  const ver = String(Date.now()) // 每次请求生成新版本号 → 静态资源 URL 永不命中缓存
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

/** mjs 模块内相对 import 统一重打 ?v=<被导入文件的 mtime>：文件一改 URL 即变，浏览器缓存必然失效。
 *  版本号必须取「被导入文件」自己的 mtime —— 若取导入方，同一模块会被不同导入方
 *  重写成不同 URL，ESM 按URL去重失效 → 模块双实例（各持一份 cachedConfig，页面状态互相看不见）。
 */
function versionMjs(file, raw) {
  const dir = dirname(file)
  const verOf = (rel) => {
    try { return String(Math.floor(statSync(join(dir, rel)).mtimeMs)) }
    catch { return String(Math.floor(statSync(file).mtimeMs)) }   // 目标缺失：退回导入方 mtime
  }
  return raw
    .replace(/(from\s+')(\.[^']+?\.mjs)(\?v=[\w.-]+)?(')/g, (_, a, p, _old, z) => a + p + '?v=' + verOf(p) + z)
    .replace(/(import\(')(\.[^']+?\.mjs)(\?v=[\w.-]+)?(')/g, (_, a, p, _old, z) => a + p + '?v=' + verOf(p) + z)
}

export function serveStatic(res, path) {
  let rel
  if (path === '/admin' || path === '/admin/') rel = '__index__'
  else if (path.startsWith('/admin/static/')) rel = path.replace('/admin/static/', '').split('?')[0]
  else return false

  const send = (data, ext) => {
    res.writeHead(200, { 'content-type': MIME[ext] ?? 'text/plain; charset=utf-8', 'cache-control': 'no-store' })
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

export function servePluginWeb(res, path) {
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
    res.writeHead(200, { 'content-type': MIME[ext], 'cache-control': 'no-store' })
    res.end(ext === '.mjs' ? versionMjs(file, raw.toString('utf8')) : raw)
    return true
  } catch { return false }
}
