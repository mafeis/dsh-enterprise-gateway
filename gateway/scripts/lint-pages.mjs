#!/usr/bin/env node
/**
 * 插件页面 lint · 统一设计系统的可测试契约（对齐 DSH「规范走向可测试的 contract」）
 *
 * 检查对象：src/plugins/*.web/ 全部前端模块（插件自带页面）
 * 规范依据：docs/admin-plugin-pages.zh.md §3/§5
 *
 * 规则：
 *   R1 页面模块只准 import 官方契约（/admin/static/contract.mjs）或自身包内相对模块
 *      —— 摸壳内部（/admin/static/js/*）= 违反「受支持边界只有 contract 导出」
 *   R2 禁止 <style> 块 —— 样式只准用壳公开 CSS 类，禁止页面私改风格
 *   R3 禁止外链资源（http(s):// 的 css/js/img）—— 离线可用 + 无供应链风险
 *   R4 html 根元素必须带 data-ent-page="<插件名>" —— DOM 约定锚点
 *   R5 必须从官方契约获取工具函数（api/$/esc… 不准自造 fetch/document.write）
 *   R7 业务弹窗必须用统一 .dlg-* 族 + 契约 openDlg/closeDlg（规范 §5.5）
 */
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs'
import { join, dirname, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const pluginsDir = join(root, 'src', 'plugins')

const violations = []
let checked = 0

for (const name of readdirSync(pluginsDir)) {
  // 约定：插件页面包是 src/plugins/<插件名>.web/（与 <插件名>.mjs 同级）
  if (!name.endsWith('.web')) continue
  const pluginName = name.replace(/\.web$/, '')
  const webDir = join(pluginsDir, name)
  if (!statSync(webDir).isDirectory()) continue

  const walk = (dir) => {
    for (const f of readdirSync(dir)) {
      const p = join(dir, f)
      if (statSync(p).isDirectory()) { walk(p); continue }
      if (!f.endsWith('.mjs')) continue
      checked++
      const rel = relative(root, p)
      const src = readFileSync(p, 'utf8')

      // R1: import 白名单 —— 官方契约 或 自身 .web 包内相对路径
      for (const m of src.matchAll(/import[^'"]*['"]([^'"]+)['"]/g)) {
        const spec = m[1]
        const isContract = spec === '/admin/static/contract.mjs'
        const isSelf = spec.startsWith('./') || spec.startsWith('../')
        if (!isContract && !isSelf) {
          violations.push(`${rel}: R1 非法 import "${spec}"（只准契约 /admin/static/contract.mjs 或自身相对模块）`)
        }
      }

      // R2: <style> 块
      if (/<style[\s>]/i.test(src)) violations.push(`${rel}: R2 禁止 <style> 块（样式只准用壳公开 CSS 类）`)

      // R3: 外链资源
      for (const m of src.matchAll(/(?:src|href)\s*=\s*["']https?:\/\/[^"']+["']/gi)) {
        violations.push(`${rel}: R3 禁止外链资源 ${m[0].slice(0, 60)}`)
      }

      // R4: data-ent-page（html 字段存在才查）
      if (/html\s*:/.test(src) && !src.includes('data-ent-page')) {
        violations.push(`${rel}: R4 html 缺少 data-ent-page DOM 约定锚点`)
      }

      // R5: 绕过契约的 DOM/fetch 用法（fetch 直调、innerHTML 拼接外部数据无 esc 提示太复杂，只查裸 fetch）
      if (/\bfetch\s*\(/.test(src)) violations.push(`${rel}: R5 禁止裸 fetch（请求一律走契约 api()，自动带凭证与错误处理）`)

      // R6: 禁止 emoji 图标（U+1F000–1FAFF 表意符号区；图标一律用官方 lucide 契约 icon()。
      // 注意 ✓✗ 等文本标记不在禁止范围——toast/日志前缀的场景它们是文字不是图标）
      const emojiRe = /[\u{1F000}-\u{1FAFF}]/u
      if (emojiRe.test(src)) violations.push(`${rel}: R6 禁止 emoji（图标一律 icon('lucide-name') 官方契约）`)

      // R7: 业务弹窗必须用统一 .dlg-* 族（规范 §5.5）——历史弹窗家族（term/edit/probe/nu/modal）已下线，
      // 开关一律走契约 openDlg/closeDlg（三路关闭 + 滚动锁统一实现），禁止页面私开弹窗交互
      const legacyModalRe = /\b(?:term|edit|probe|nu)-modal|class="[^"]*\bmodal-mask\b/
      if (legacyModalRe.test(src)) {
        violations.push(`${rel}: R7 使用了下线的弹窗家族（term/edit/probe/nu-modal、modal-mask）——业务弹窗一律 .dlg-mask + .dlg，开关走契约 openDlg/closeDlg（规范 §5.5）`)
      }
    }
  }
  walk(webDir)
}

if (violations.length) {
  console.error(`\n✗ 插件页面 lint 失败（${violations.length} 处，checked=${checked}）：`)
  for (const v of violations) console.error(`  ${v}`)
  console.error('\n规范：docs/admin-plugin-pages.zh.md §3/§5（统一设计系统 = 契约 + 令牌 + 公开组件类）')
  process.exit(1)
}
console.log(`✓ 插件页面 lint 通过：${checked} 个页面模块符合统一设计契约`)
