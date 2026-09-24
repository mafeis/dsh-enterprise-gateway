/**
 * 插件 ent-security · 安全防护域（= DLP 引擎 + 规则/留存/锚页面）
 * provides: dlp —— 转发链路内嵌的内容检测引擎（block/mask/log），ent-upstream inject 消费
 * 页面：安全防护（DLP 规则编辑 + 审计留存参数 + 防篡改锚，锚 API 在 ent-audit）
 * 领域事件：拦截发生时 emit dlp.blocked（经 registry 事件总线，订阅方如 ent-notify）
 * 实现模块：src/dlp.mjs（逻辑不变，仅改为服务提供）
 */
import * as dlpImpl from '../dlp.mjs'

export const name = 'ent-security'
export const provides = ['dlp']
export const inject = ['config', 'registry']

export const manifest = {
  capabilities: ['dlp.scan', 'dlp.rules.read'],
}

/** 自带页面：安全防护（DLP 数据防泄漏 / 审计留存 / 防篡改锚） */
export const admin = {
  nav: { id: 'security', title: '安全防护', titleEn: 'Security', icon: 'shield-check', order: 420 },
  entry: 'index.mjs',
}

export function apply(ctx) {
  const registry = ctx.get('registry')
  const { getConfig } = ctx.get('config')

  // exposes 动态填充：箭头函数闭包引用本插件作用域，inspector.query 时调用安全
  manifest.exposes = {
    rulesCount: () => getConfig().dlp.rules.length,
    enabled: () => getConfig().dlp.enabled,
  }

  // 包装 scanMessages：保留原实现，拦截发生时发布领域事件（发布方不知道谁订阅）
  const dlp = {
    ...dlpImpl,
    scanMessages(messages) {
      const result = dlpImpl.scanMessages(messages)
      if (result.blocked) {
        const hits = result.hits.filter((h) => h.action === 'block')
        if (hits.length) {
          registry.emit('dlp.blocked', {
            rules: hits.map((h) => h.rule).join(','),
            label: hits.map((h) => h.label).join(','),
            user: null, // 调用方（chat 处理器）可补填；事件按尽力而为发布
          })
        }
      }
      return result
    },
  }
  ctx.provide('dlp', dlp)
}
