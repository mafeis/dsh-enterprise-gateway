/**
 * 内核 · 插件注册表（运行时状态，只读快照供管理面查询）
 * 宿主 host.mjs 在装载过程中填写；ent-admin 经 'plugins' 服务读取展示。
 * 状态：loaded（已装载，服务在位）/ disabled（配置禁用，未装载）/ failed（装载失败或缺依赖）
 */
export const pluginRegistry = {
  /** @type {Array<{name:string, provides:string[], inject:string[], source:'builtin'|'external', path?:string}>} */
  loaded: [],
  /** @type {Array<{name:string, source:'builtin'|'external'}>} */
  disabled: [],
  /** @type {Array<{name:string, reason:string, source:'builtin'|'external', path?:string}>} */
  failed: [],
}

/** 展示快照：注入每个条目的当前配置开关（webDir 是服务器路径，不下发前端） */
export function pluginStatusSnapshot(getConfig) {
  const declared = getConfig().plugins ?? {}
  const wrap = (list, state) => list.map((e) => {
    const { webDir, ...pub } = e
    return { ...pub, enabled: state === 'loaded', declared: declared[pub.name] ?? null }
  })
  return {
    loaded: wrap(pluginRegistry.loaded, 'loaded'),
    disabled: wrap(pluginRegistry.disabled, 'disabled'),
    failed: wrap(pluginRegistry.failed, 'failed'),
    total: pluginRegistry.loaded.length + pluginRegistry.disabled.length + pluginRegistry.failed.length,
  }
}
