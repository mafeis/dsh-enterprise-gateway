/**
 * 插件 ent-design · 样式规范页
 * 纯页面插件：零数据依赖（插件作者的活样册），只自带页面资源
 */
export const name = 'ent-design'
export const provides = []

/** 自带页面：样式规范（设计令牌 / 组件类可视化样册，对齐 docs/admin-plugin-pages.zh.md §5） */
export const admin = {
  nav: { id: 'design', title: '样式规范', titleEn: 'Style Guide', icon: 'palette', order: 80 },
  entry: 'index.mjs',
}
