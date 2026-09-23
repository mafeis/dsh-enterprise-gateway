#!/usr/bin/env node
/**
 * 语法检查：自动枚举 gateway 下全部 .mjs（gateway.mjs + src/**）逐个 node --check
 * 替代手工维护的文件清单——新增模块自动纳入，不会漏（此前 usage.mjs 就漏过）
 */
import { spawnSync } from 'node:child_process'
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs'
import { join, dirname, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

function walk(dir) {
  const out = []
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    const st = statSync(p)
    if (st.isDirectory()) out.push(...walk(p))
    else if (name.endsWith('.mjs')) out.push(p)
  }
  return out
}

const files = [join(root, 'gateway.mjs'), ...walk(join(root, 'src'))].sort()
let failed = 0
for (const f of files) {
  const r = spawnSync(process.execPath, ['--check', f], { encoding: 'utf8' })
  if (r.status !== 0) {
    failed++
    console.error(`✗ ${relative(root, f)}\n${r.stderr}`)
  }
}
if (failed) {
  console.error(`\ncheck 失败：${failed}/${files.length} 个模块语法错误`)
  process.exit(1)
}
console.log(`✓ check 通过：${files.length} 个模块语法正常`)

// 插件页面 body 传参 lint：api() 不替你序列化，写 body: {...} 会静默变成 "[object Object]"
// （网关把坏 JSON 当空体 → 页面提示成功但什么都没改）。对象一律 JSON.stringify。
{
  const bad = []
  const walkWeb = (dir) => {
    for (const name of readdirSync(dir)) {
      const p2 = join(dir, name)
      const st = statSync(p2)
      if (st.isDirectory()) walkWeb(p2)
      else if (name.endsWith('.mjs')) {
        readFileSync(p2, 'utf8').split('\n').forEach((line, i) => {
          // 合法形态：JSON.stringify(...)、字符串字面量、二进制（arrayBuffer/Blob/File/FormData）
          const okBody = /body:\s*(JSON\.stringify|'|`|"|await\s+[\w$.\[\]()']*\.arrayBuffer\(|new\s+FormData|FormData\(|file\b|blob\b|fd\b)/.test(line)
          if (/\bapi\(/.test(line) && /body:/.test(line) && !okBody) {
            bad.push(`${relative(root, p2)}:${i + 1}: ${line.trim().slice(0, 110)}`)
          }
        })
      }
    }
  }
  walkWeb(join(root, 'src', 'plugins'))
  if (bad.length) {
    console.error('✗ 页面 body 未序列化（改成 JSON.stringify(…) 或自带 content-type 的裸 fetch）：')
    for (const b of bad) console.error('   ' + b)
    process.exit(1)
  }
}

// 装机脚本 lint：客户机上跑的是 macOS 自带 bash 3.2，`$VAR中文` 会把多字节首字节吞进变量名
// （`$TARGET_VER（` 被当成变量 TARGET_VER+0xEF…，set -u 下当场 unbound variable，脚本半路断）。
// 变量后面紧跟非 ASCII 字符，必须写成 ${VAR}。ps1 那边是同一家族的坑：脚本以字符串被 iex 编译，
// BOM 与 param() 都会让首条语句解析跑偏，所以 ps1 禁 BOM、也禁拿 param() 开头。
{
  const setupDir = join(root, 'setup')
  const bad = []
  const glued = /(?<!\$\{)\$[A-Za-z_][A-Za-z0-9_]*(?=[^\x00-\x7F])/
  if (existsSync(setupDir)) {
    for (const name of readdirSync(setupDir)) {
      const p2 = join(setupDir, name)
      if (!statSync(p2).isFile()) continue
      if (name.endsWith('.sh')) {
        readFileSync(p2, 'utf8').split('\n').forEach((line, i) => {
          if (line.trimStart().startsWith('#')) return
          if (glued.test(line)) bad.push(name + ':' + (i + 1) + ' 变量后紧跟非 ASCII，必须写成 ${VAR}：' + line.trim().slice(0, 90))
        })
      } else if (name.endsWith('.ps1')) {
        // 客户机走 `irm … | iex`，脚本以字符串被编译：BOM 会留在 .Content 里污染首条语句；
        // param() 一旦被认成普通语句，整块声明逐行执行 → 「赋值表达式无效」。两者都禁。
        const buf = readFileSync(p2)
        if (buf.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf]))) {
          bad.push(name + ' 带 UTF-8 BOM, PowerShell 5.1 的 irm 会把 U+FEFF 留在 .Content 里, irm|iex 首条语句被污染')
        }
        const first = buf.toString('utf8').split('\n').find((l) => l.trim() && !l.trimStart().startsWith('#'))
        if (first && /^\s*param\s*\(/.test(first)) {
          bad.push(name + ' 用 param() 开头, irm|iex 下声明块会被当语句逐行执行, 改用 $args/环境变量手工绑参')
        }
      }
    }
  }
  if (bad.length) {
    console.error('✗ 装机脚本兼容性问题（修掉再发给客户）：')
    for (const b of bad) console.error('   ' + b)
    process.exit(1)
  }
}

// 插件页面统一设计契约 lint（R1-R5，规范 docs/admin-plugin-pages.zh.md）
// lint-pages.mjs 已随 304a7ff 归档进开发期调试脚本；脚本不存在时跳过（存在则照常执行）
const lintPath = join(root, 'scripts', 'lint-pages.mjs')
if (existsSync(lintPath)) {
  const lint = spawnSync(process.execPath, [lintPath], { stdio: 'inherit' })
  if (lint.status !== 0) process.exit(1)
}
