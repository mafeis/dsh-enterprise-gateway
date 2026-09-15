/**
 * 元插件 ent-config · provides: config
 * 配置分层：内置默认 ← gateway-config.json ← 环境变量 ← 热更（管理API，落盘）
 * Provider/Model CRUD + 路由容灾 + 插件开关持久化
 * 实现模块：src/config.mjs（模块单例，与既有行为一致；loadConfig 在插件 apply 前由宿主调用）
 */
import * as configImpl from '../config.mjs'

export const name = 'ent-config'
export const provides = ['config']
export const inject = []

export const manifest = {
  capabilities: ['config.read', 'config.patch'],
}

export function apply(ctx) {
  ctx.provide('config', configImpl)

  // exposes 动态填充（闭包引用服务）
  manifest.exposes = {
    summary: () => ({
      providers: configImpl.getConfig().providers.length,
      models: configImpl.getConfig().models.length,
      policyVersion: configImpl.getConfig().policy.version,
    }),
  }
}
