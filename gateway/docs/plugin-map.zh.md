# 内置插件名实对照表

> 权威出处：`src/plugin-manifest.mjs`（`PLUGIN_META`）。本表与其同步；改插件用途先改那张表。
>
> 组织原则：**一个业务域一个插件** —— 页面 + API + 领域服务同插件（谁的业务谁挂路由）。
> 只有「被多个域依赖的基础服务」才单独成插件。

## 分层模型

```
kernel（基座）   谁都能依赖的基础服务，不碰业务
   ↓ inject
service（服务）  多个业务域共享的引擎（store / auth）
   ↓ inject
domain（业务域） 页面 + API + 领域服务一体；禁用即整域消失
collab（协作）   跨插件扫描/事件分发/外发，不挡主链路
demo（示例）     给插件作者看的活样册，生产可禁用
```

## 全量对照（17 个）

### 基座（kernel）

| 插件 | 中文名 | 用途 | provides |
|---|---|---|---|
| ent-router | 路由基座 | 全部插件的 HTTP 路由总线（prefix/exact 分发） | router |
| ent-config | 配置中心 | 配置分层加载/热更/落盘 | config |
| ent-registry | 插件注册表 | 运行时快照 + 开关落盘 + 事件总线（本页本体） | registry |
| ent-meta | 元信息端点 | /health、/v1/models 等基础端点 | — |

### 服务（service，多域共享引擎）

| 插件 | 中文名 | 用途 | provides |
|---|---|---|---|
| ent-store | 存储与留痕 | SQLite 追加留痕 + Merkle 锚 + 心跳/回执 + 引导管理员 | store |
| ent-auth | 认证鉴权 | JWT + scrypt + 会话 cookie + 登录保护 + /auth/* | auth |

### 业务域（domain，API + 页面一体）

| 插件 | 中文名（导航项） | API（本插件挂载） | 页面 | provides |
|---|---|---|---|---|
| ent-security | 安全防护 | —（规则经 /admin/policy，在 ent-client） | DLP 规则/留存/锚 | **dlp**（转发链路引擎） |
| ent-upstream | 上游转发 | POST /v1/chat/completions | — | upstream |
| ent-catalog | 供应商与模型 | /admin/config、/admin/providers*、/admin/models* + 内置探活 | 供应商与模型页 | — |
| ent-users | 用户管理 | /admin/users*（含账号活动详情） | 用户管理页 | — |
| ent-billing | 用量与计费 | /admin/usage（管理账单）+ /usage/me（用户自助） | 计费账单页 | — |
| ent-client | 客户端管控 | /policy/current、/policy/ack、/heartbeat（用户端协议）+ /admin/policy*（策略热更） | 客户端管控页（4 个二级页：策略与开关/插件管控/自助规则/下发回执） | — |
| ent-audit | 审计留痕 | /admin/logs*、/admin/verify-anchor、/admin/seal-anchor、/admin/purge | 审计留痕页 | — |
| ent-console | 运营总览 | /admin/stats、/admin/terminals + 管理台壳（SPA 静态资源 + /admin/plug/* 分发） | 运营总览页 | — |

### 协作（collab）

| 插件 | 中文名 | 用途 | 事件 |
|---|---|---|---|
| ent-inspector | 协作视图 | 跨插件扫描/能力查询/事件流（排障观测） | registry |
| ent-notify | 通知告警 | 领域事件 → webhook 外发（企微/钉钉兼容） | dlp.blocked 等 |

### 示例（demo）

| 插件 | 中文名 | 用途 | 备注 |
|---|---|---|---|
| ent-design | 样式规范 | 插件作者的 UI 活样册（设计令牌/组件实际渲染） | 生产可禁用 |

## 依赖顺序（host.mjs 装载顺序）

```
router → config → registry → meta
→ store → auth → security(provides dlp) → upstream(needs dlp)
→ catalog → users → billing → client → audit → console
→ inspector → notify → design
```

⚠ ent-security 必须在 ent-upstream 之前装载（upstream inject dlp）——
挪动清单顺序前先看 inject 关系。

## 新增插件怎么起名

1. 业务域插件：`ent-<业务域>`（页面 + API + 领域服务同插件），`admin.nav.title` 必须填中文。
2. 共享引擎：`ent-<服务名>`，`provides` 声明服务名（服务名 = 其他插件 inject 的名字）。
3. **在 `src/plugin-manifest.mjs` 登记三件套**：title（中文）/ summary（一句话用途）/ category（分层）——不登记的话插件管理页里就没有中文名和说明。
4. 对照表文档（本文件）跟着补一行。

## 给插件作者的完整步骤

见 `docs/admin-plugin-pages.zh.md`（页面契约）与 `README.md`（服务型插件契约）。最小可抄样例：域插件 `ent-billing`（API+页面），服务型 `ent-security`（provides 引擎 + 页面）。
