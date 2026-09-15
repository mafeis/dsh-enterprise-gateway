/**
 * 元插件 ent-router · provides: router
 * HTTP 路由表：exact/prefix 分发，handler 返回 false 继续下一条（与 v2 dispatch 语义一致）。
 * 插件通过 ctx.effect(() => router.exact(...), label) 注册路由——插件卸载时路由自动摘除。
 */
import { createRouter } from '../core/router.mjs'

export const name = 'ent-router'
export const provides = ['router']
export const inject = []

export function apply(ctx) {
  ctx.provide('router', createRouter())
}
