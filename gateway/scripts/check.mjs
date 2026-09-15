#!/usr/bin/env node
/**
 * 语法检查：自动枚举 gateway 下全部 .mjs（gateway.mjs + src/**）逐个 node --check
 * 替代手工维护的文件清单——新增模块自动纳入，不会漏（此前 usage.mjs 就漏过）
 */
import { spawnSync } from 'node:child_process'
import { readdirSync, statSync } from 'node:fs'
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

// 插件页面统一设计契约 lint（R1-R5，规范 docs/admin-plugin-pages.zh.md）
const lint = spawnSync(process.execPath, [join(root, 'scripts', 'lint-pages.mjs')], { stdio: 'inherit' })
if (lint.status !== 0) process.exit(1)
