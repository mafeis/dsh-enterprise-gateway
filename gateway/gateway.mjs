#!/usr/bin/env node
/**
 * 企业版-网关启动入口（插件化）
 *   node gateway.mjs
 * 宿主与插件装载逻辑在 src/host.mjs（Cordis 内核，借鉴 DSH 插件体系）
 */
import './src/host.mjs'
