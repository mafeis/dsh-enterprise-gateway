#!/usr/bin/env node
/**
 * 企业版-网关 · 宿主（Cordis 内核 · 一切皆插件）
 *
 * 借鉴 DSH 插件体系（Context / Service / inject / effect 生命周期）：
 *   - 最小内核只有两件事：装载循环 + http server（启动时序必需，无业务逻辑）
 *   - 元插件（ent-router/ent-config/ent-registry）以普通插件契约提供基座服务
 *   - 业务/界面/协作/外部插件地位平等，经 inject 协作；manifest 声明能力与可公开信息
 *   - 装载器对每个插件报告：装载成功 / 禁用 / 缺服务 / 失败，绝不静默吞错
 *
 * 环境变量：
 *   UPSTREAM_API_KEY   上游渠道密钥（必需，除非渠道配置了 apiKey）
 *   UPSTREAM_BASE_URL  上游地址覆盖
 *   PORT / HOST        监听
 *   ENT_DB_PATH        SQLite 路径（默认 gateway/data/gateway.db）
 *   ENT_GATEWAY_CONFIG 配置文件路径（默认 gateway/data/gateway-config.json）
 */
import http from 'node:http'
import { readFileSync, existsSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { isAbsolute, resolve, dirname, join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { loadConfig, getConfig } from './config.mjs'
import { json } from './core/http.mjs'
import { pluginRegistry } from './core/plugin-registry.mjs'
import { PLUGIN_META, CATEGORY_LABEL } from './plugin-manifest.mjs'
import { fileURLToPath } from 'node:url'

loadConfig()
const cfg = getConfig()
const SRC_DIR = dirname(fileURLToPath(import.meta.url))
// 版本号单一来源：package.json（避免双份维护漂移）
const VERSION = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version

/* ---------- 内置插件清单（装载顺序即依赖顺序：基座 → 基础服务 → 业务域 → 协作） ---------- */

const BUILTIN_PLUGINS = [
  // 基座：为其他插件提供基础服务（对齐 DSH「万物皆插件」——基座也不是内核特权）
  { name: 'ent-router', path: './plugins/ent-router.mjs' },
  { name: 'ent-config', path: './plugins/ent-config.mjs' },
  { name: 'ent-registry', path: './plugins/ent-registry.mjs' },
  { name: 'ent-meta', path: './plugins/ent-meta.mjs' },
  // 基础服务：被多个业务域依赖的引擎
  { name: 'ent-store', path: './plugins/ent-store.mjs' },
  { name: 'ent-auth', path: './plugins/ent-auth.mjs' },
  { name: 'ent-security', path: './plugins/ent-security.mjs' },   // provides dlp（必须在 ent-upstream 之前）
  { name: 'ent-upstream', path: './plugins/ent-upstream.mjs' },
  // 业务域：API + 页面同域（谁的业务谁挂路由）
  { name: 'ent-catalog', path: './plugins/ent-catalog.mjs' },
  { name: 'ent-users', path: './plugins/ent-users.mjs' },
  { name: 'ent-billing', path: './plugins/ent-billing.mjs' },
  { name: 'ent-client', path: './plugins/ent-client.mjs' },
  { name: 'ent-setup', path: './plugins/ent-setup.mjs' },
  { name: 'ent-audit', path: './plugins/ent-audit.mjs' },
  { name: 'ent-console', path: './plugins/ent-console.mjs' },
  // 协作：跨插件扫描/事件分发
  { name: 'ent-inspector', path: './plugins/ent-inspector.mjs' },
  { name: 'ent-notify', path: './plugins/ent-notify.mjs' },
  // 示例：插件作者参考（生产可禁用）
  { name: 'ent-design', path: './plugins/ent-design.mjs' },
]

/* ---------- 宿主 ---------- */

const app = new Context()

// 元数据服务（装载循环本身要用的东西，不属于任何插件）
app.provide('host', { version: VERSION })

const loadedNames = []
const failedNames = []

/** 计算插件界面资源目录（约定：插件文件旁的 <name>.web/，存在才登记） */
function webDirOf(name, source, path) {
  const moduleFile = source === 'external'
    ? (isAbsolute(path) ? path : resolve(process.cwd(), path))
    : resolve(SRC_DIR, path)
  const dir = join(dirname(moduleFile), name + '.web')
  return existsSync(dir) ? dir : null
}

/** 名实对照：内置插件从 PLUGIN_META 取中文名/用途/分层；外部插件 fallback */
const metaOf = (name, source) => source === 'external'
  ? { title: null, summary: null, category: 'external', categoryLabel: CATEGORY_LABEL.external }
  : { title: PLUGIN_META[name]?.title ?? null, summary: PLUGIN_META[name]?.summary ?? null, category: PLUGIN_META[name]?.category ?? null, categoryLabel: CATEGORY_LABEL[PLUGIN_META[name]?.category] ?? null }

/** 装载单个插件：先校验 inject 依赖可满足（缺服务绝不进入 PENDING 挂起，直接明确报错） */
async function loadPlugin(name, mod, pluginConfig, { source, path }) {
  const injects = mod.inject ?? mod.default?.inject ?? []
  const missing = injects.filter((n) => app.get(n, true) === undefined)
  if (missing.length) {
    failedNames.push(name)
    const reason = `缺少服务: ${missing.join(', ')}（依赖的插件装载失败或被禁用）`
    pluginRegistry.failed.push({ name, reason, source, path, ...metaOf(name, source) })
    console.error(`✗ 插件 ${name} ${reason}`)
    return null
  }
  // 纯页面插件（只有 admin 声明、无 apply）合法：页面由壳按 admin 清单动态挂载，无需服务注入
  const shape = { name: mod.name ?? name, inject: mod.inject, apply: mod.apply ?? mod.default?.apply ?? (() => {}) }
  const fiber = await app.plugin(shape, pluginConfig ?? {})
  loadedNames.push(name)
  pluginRegistry.loaded.push({
    name,
    ...metaOf(name, source),
    provides: mod.provides ?? [],
    inject: injects,
    manifest: mod.manifest ?? null,
    admin: mod.admin ?? null,
    locked: mod.locked === true,
    webDir: webDirOf(name, source, path),
    source, path,
  })
  return fiber
}

// 1) 内置插件（顺序 = 依赖顺序；enabled=false 时跳过且不 import 实现模块）
for (const decl of BUILTIN_PLUGINS) {
  const pcfg = cfg.plugins?.[decl.name] ?? {}
  if (pcfg.enabled === false) {
    pluginRegistry.disabled.push({ name: decl.name, source: 'builtin', ...metaOf(decl.name, 'builtin') })
    console.warn(`○ 插件已禁用: ${decl.name}（${PLUGIN_META[decl.name]?.title ?? ''}）`)
    continue
  }
  try {
    const mod = await import(decl.path)
    await loadPlugin(decl.name, mod, pcfg.config, { source: 'builtin', path: decl.path })
    const p = mod.provides?.length ? ` (provides ${mod.provides.join(', ')})` : ''
    const m = mod.manifest?.capabilities?.length ? ` [${mod.manifest.capabilities.join(', ')}]` : ''
    console.log(`✓ 插件已装载: ${decl.name}${p}${m}`)
  } catch (e) {
    failedNames.push(decl.name)
    const reason = String(e?.message ?? e).slice(0, 200)
    pluginRegistry.failed.push({ name: decl.name, reason, source: 'builtin', ...metaOf(decl.name, 'builtin') })
    console.error(`✗ 插件 ${decl.name} 装载失败: ${String(e?.stack ?? e).split('\n').slice(0, 4).join('\n')}`)
  }
}

// 2) 外部插件（客户定制）：plugins.<name>.path 指向实现模块（相对路径基于进程 cwd）
for (const [name, decl] of Object.entries(cfg.plugins ?? {})) {
  if (!decl?.path) continue
  if (decl.enabled === false) {
    pluginRegistry.disabled.push({ name, source: 'external', ...metaOf(name, 'external') })
    continue
  }
  try {
    const spec = isAbsolute(decl.path) ? pathToFileURL(decl.path).href : pathToFileURL(resolve(process.cwd(), decl.path)).href
    const mod = await import(spec)
    await loadPlugin(name, mod, decl.config, { source: 'external', path: decl.path })
    console.log(`✓ 外部插件已装载: ${name} ← ${decl.path}`)
  } catch (e) {
    failedNames.push(name)
    const reason = String(e?.message ?? e).slice(0, 200)
    pluginRegistry.failed.push({ name, reason, source: 'external', path: decl.path, ...metaOf(name, 'external') })
    console.error(`✗ 外部插件 ${name}（${decl.path}）装载失败: ${String(e?.stack ?? e).split('\n').slice(0, 4).join('\n')}`)
  }
}

if (failedNames.length) {
  console.warn(`⚠ ${failedNames.length} 个插件未装载: ${failedNames.join(', ')}（网关以剩余插件继续启动）`)
}

/* ---------- HTTP 服务（路由分发顺序 = 插件注册顺序；未命中 404） ---------- */

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? '/', 'http://x')
    const handled = await app.get('router').dispatch(req, res, url.pathname, url)
    if (!handled) json(res, 404, { error: 'not found' })
  } catch (e) {
    console.error(`[${new Date().toLocaleTimeString('zh-CN', { hour12: false })}] 💥 未处理异常:`, e)
    if (!res.headersSent) json(res, 500, { error: { message: String(e).slice(0, 300), type: 'internal' } })
    else res.end()
  }
})

server.listen(cfg.server.port, cfg.server.host, () => {
  console.log('╔════════════════════════════════════════════════╗')
  console.log('║  企业版-网关 v' + VERSION + ' · 一切皆插件')
  console.log(`║  http://${cfg.server.host}:${cfg.server.port}`)
  console.log(`║  供应商: ${cfg.providers.map((p) => p.id).join(', ')}`)
  console.log(`║  模型: ${cfg.models.map((m) => m.id).join(', ')}`)
  console.log(`║  插件: ${loadedNames.join(', ') || '(无)'}`)
  console.log('╚════════════════════════════════════════════════╝')
})
