/**
 * 内置插件名实对照表（单一事实来源）
 *
 * 组织原则：一个业务域一个插件 —— 页面 + API + 领域服务同插件（谁的业务谁挂路由）。
 * 只有「被多个域依赖的基础服务」才单独成插件（store/auth）。
 *
 * category 分层（显示顺序即依赖顺序）：
 *   kernel   基座  —— 为其他插件提供基础服务（router/config/registry/meta）
 *   service  服务  —— 被多个业务域依赖的引擎（store/auth）
 *   domain   业务域 —— 页面 + API + 领域服务一体（catalog/users/billing/client/security/audit/console/upstream）
 *   collab   协作  —— 跨插件扫描/事件分发/外发
 *   demo     示例  —— 给插件作者看的活样册，生产环境可禁用
 */
export const PLUGIN_META = {
  /* ---- 基座：元插件 ---- */
  'ent-router': {
    title: '路由基座',
    category: 'kernel',
    summary: '提供 router 服务：全部插件的 HTTP 路由都挂在这条总线上（prefix/exact 分发，注册顺序即匹配顺序）',
  },
  'ent-config': {
    title: '配置中心',
    category: 'kernel',
    summary: '网关配置分层加载（默认 ← 文件 ← 环境变量 ← 热更）与落盘；其他插件经 config 服务读写托管字段',
  },
  'ent-registry': {
    title: '插件注册表',
    category: 'kernel',
    summary: '运行时插件快照（装载/禁用/失败三态）+ 开关落盘 + 插件管理页 + 事件总线（registry.emit）',
  },
  'ent-meta': {
    title: '元信息端点',
    category: 'kernel',
    summary: '/health 健康检查、/v1/models 模型列表等基础端点',
  },

  /* ---- 基础服务：多域共享引擎 ---- */
  'ent-store': {
    title: '存储与留痕',
    category: 'service',
    summary: 'SQLite 只追加留痕 + 每日 Merkle 防篡改锚 + 终端心跳/策略回执 + 引导管理员；全部业务域的数据底座',
  },
  'ent-auth': {
    title: '认证鉴权',
    category: 'service',
    summary: 'JWT 签发校验（HS256）+ scrypt 密码 + 会话 cookie + 登录防爆破锁定 + /auth/* 路由；各域经 auth 服务鉴权自己的 API',
  },

  /* ---- 业务域：API + 页面一体 ---- */
  'ent-security': {
    title: '安全防护',
    category: 'domain',
    summary: 'DLP 内容检测引擎（provides dlp：block/mask/log，转发链路内嵌）+ 安全防护页（DLP 规则编辑/留存参数/防篡改锚入口）',
  },
  'ent-upstream': {
    title: '上游转发',
    category: 'domain',
    summary: '/v1/chat/completions 主链路：鉴权 → DLP → 模型路由 → 容灾切换 → 转发 → 留痕',
  },
  'ent-catalog': {
    title: '供应商与模型',
    category: 'domain',
    summary: '上游供应商接入（baseUrl/API Key 落 .env）+ 企业模型目录 + 容灾编排 + 内置探活（测试按钮）；CRUD API 与页面同插件',
  },
  'ent-users': {
    title: '用户管理',
    category: 'domain',
    summary: '员工账号 CRUD API（/admin/users*）+ 用户管理页（创建/改密/启停/账号活动详情）',
  },
  'ent-billing': {
    title: '用量与计费',
    category: 'domain',
    summary: '管理侧账单 API（/admin/usage 按日聚合+单价折算）+ 员工自助用量（/usage/me）+ 计费账单页',
  },
  'ent-client': {
    title: '客户端管控',
    category: 'domain',
    summary: '员工端协议（/policy/current 下发、/policy/ack 回执、/heartbeat 心跳）+ 策略热更 API（/admin/policy）+ 客户端管控页',
  },
  'ent-audit': {
    title: '审计留痕',
    category: 'domain',
    summary: '留痕查询 API（/admin/logs*）+ Merkle 锚校验/封存 API + 过期清理 + 审计留痕页',
  },
  'ent-console': {
    title: '运营总览',
    category: 'domain',
    summary: '登录后首页：今日请求/Token/活跃用户/DLP 命中等 KPI + 在线终端 + 总览展示配置；同时承载管理台壳（SPA 静态资源 + /admin/plug/* 插件页面分发）',
  },

  /* ---- 协作：跨插件 ---- */
  'ent-inspector': {
    title: '协作视图',
    category: 'collab',
    summary: '跨插件协作中枢：扫描全部插件暴露的信息、按能力查询（如 DLP 规则数）、事件流追踪——排障与观测用',
  },
  'ent-notify': {
    title: '通知告警',
    category: 'collab',
    summary: '订阅领域事件（DLP 拦截/上游切换/账号锁定）→ 命中阈值外发 webhook（企业微信/钉钉/Slack 兼容格式）',
  },

  /* ---- 示例：插件作者参考 ---- */
  'ent-design': {
    title: '样式规范',
    category: 'demo',
    summary: '给插件作者看的 UI 活样册：设计令牌（颜色/间距/字体）与组件（卡片/表格/徽章/开关）的实际渲染效果——照着写页面就能跟管理台风格一致；生产环境可禁用',
  },
}

/** 分层显示顺序（也是依赖方向：kernel 最先装载） */
export const CATEGORY_ORDER = ['kernel', 'service', 'domain', 'collab', 'demo', 'external']

export const CATEGORY_LABEL = {
  kernel: '基座',
  service: '服务',
  domain: '业务域',
  collab: '协作',
  demo: '示例',
  external: '外部',
}
