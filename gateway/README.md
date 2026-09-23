# 企业版-网关 · dsh-enterprise-gateway v3.0 插件化

Node 22.5+ 单进程生产形态（`node:sqlite` 内置）。业务能力全部插件化，内核借鉴 DSH 插件体系（Cordis：Context / Service / inject / effect 生命周期），唯一 npm 依赖 `@deepseek-ai/cordis`。

## 架构

```
gateway.mjs       # 启动入口（import host.mjs）
src/
├── host.mjs      # 宿主：Cordis Context + 内核服务(config/router) + 插件装载器（失败明确报错，不静默）
├── config.mjs    # 内核服务 config：配置分层（默认 ← data/gateway-config.json ← 环境变量 ← 热更）+ 供应商/模型 CRUD + 路由容灾
├── core/         # http 工具 + 路由表(router) + 静态资源服务
├── plugins/      # 业务插件（契约：name / inject / apply / provides，与 DSH 插件同形）
│   ├── ent-store.mjs    provides store    — SQLite 留痕(只追加)+Merkle 锚+心跳/回执+引导管理员+封存定时器(effect 管理)
│   ├── ent-auth.mjs     provides auth     — JWT 签发/校验+scrypt+请求鉴权中间件+/auth/* 路由
│   ├── ent-dlp.mjs      provides dlp      — block/mask 规则引擎+审计级别+全量上下文扫描
│   ├── ent-upstream.mjs provides upstream — 多渠道容灾转发+SSE 透传+POST /v1/chat/completions
│   ├── ent-probe.mjs    provides probe    — 供应商连通测试+思考档位探针（只读配置）
│   ├── ent-catalog.mjs  — /admin/config + 供应商/模型 CRUD + 探测应用 API + 自带「供应商与模型」页面
│   ├── ent-console.mjs  — /admin/* 管理台 SPA + 管理 API（含插件管理）
│   ├── ent-protocol.mjs — /policy/* + /heartbeat（Desktop 插件协议：策略/回执/心跳）
│   └── ent-usage.mjs    — GET /usage/me（用户自助用量，不含内容）
├── routes/       # 路由处理器工厂 createXxx({服务注入})——逻辑与 v2 一致
└── *.mjs         # 各插件的实现模块（auth/dlp/store/upstream/probe）
scripts/
├── check.mjs     # 语法检查：自动枚举全部 .mjs（新增模块免登记）
├── smoke.mjs     # 冒烟测试：health/models/login/verify/admin/反向鉴权
└── e2e.mjs       # 端到端验收：插件协议+DLP 拦截+留痕+插件禁用依赖报错
```

## 插件机制

- **装载顺序** = 依赖顺序：store → auth → dlp → upstream → probe → admin；装载器先校验 `inject` 依赖可满足，缺服务直接报错跳过（不挂起）
- **插件开关**（gateway-config.json）：

```json
{
  "plugins": {
    "ent-dlp": { "enabled": false },
    "customer-siem": { "path": "./plugins/customer-siem/index.mjs", "config": { "syslog": "10.0.0.1:514" } }
  }
}
```

- **外部插件**（客户定制）：`plugins.<name>.path` 指向实现模块（相对路径基于网关 cwd），模块导出 `name / inject / apply(ctx, config)`，通过 `ctx.get('store')` 等取用内核与业务服务，`ctx.effect()` 注册生命周期与路由
- **生命周期**：服务经 `ctx.provide()` 注册（插件卸载即回收）；定时器/路由经 `ctx.effect()` 注册，卸载自动清理
- **插件管理**：`GET /admin/plugins` 运行时快照（已装载/禁用/失败三态 + 依赖与提供的服务可见，失败带原因）；`PATCH /admin/plugins/:name` 把开关写入配置文件（重启生效——与 DSH bundle reconcile 同哲学：插件变更进下一次装载组合，不做进程内热插拔）
- **名实对照**：内置插件的中文名/用途/分层见 `docs/plugin-map.zh.md`（权威出处 `src/plugin-manifest.mjs`，新增插件必须登记）

## 工程化命令

```powershell
npm install               # 安装 @deepseek-ai/cordis（唯一依赖）
npm run check             # 语法检查（自动枚举，含所有新模块）
npm run smoke             # 冒烟测试（临时数据目录，跑完自动清理）
npm run e2e               # 端到端验收（插件链路 + 禁用场景）
npm run e2e:desktop       # 客户端安装包库回归（上传→发布→下载→Range→回滚→删包，离线）
npm run test:mirror       # 物料库重复下载回归（已入库不重拉、force 才重拉，离线）
ENT_ADMIN_TOKEN=*** npm run ui:check   # 管理台每个页面真渲染体检：挂载 + class 是否真有样式 + 控制台报错 + 截图
npm run release -- 3.2.3 --note "摘要"   # 发版唯一入口：预检（工作区干净/在 main/与 origin 一致/tag 未占用/npm 号位可用，含墓碑检测）+ check + smoke → 生成 docs/release-notes/vX.zh.md → 提交 → 打 tag → push → publish → 轮询核对 latest
npm run release -- --publish-only   # tag 已打但 publish 挂了（如 ECONNRESET 后）时只补发，不改内容不换号
```

## 启动

```powershell
# 推荐（自动从 DSH 凭据库注入上游 Key）
pwsh ../tools/start-gateway.ps1

# 或手动
$env:UPSTREAM_API_KEY = "<key>"; node gateway.mjs
```

首次启动自动创建 `admin` 引导账号（密码仅打印一次）。

## 端点

| 方法 | 路径 | 说明 | 鉴权 |
| --- | --- | --- | --- |
| POST | `/auth/login` | 登录换 JWT | 公开 |
| POST | `/v1/chat/completions` | OpenAI 兼容（流式/非流式） | JWT |
| GET | `/v1/models` | 企业模型目录 | 公开 |
| GET | `/policy/current` | 策略快照 | 公开 |
| GET | `/` | 浏览器访问 302 到用户接入页（程序化请求不受影响） | 公开 |
| GET | `/setup` | 用户接入页（按系统给分步指引：打开什么 → 复制什么 → 回车 → 排障） | 公开 |
| GET | `/setup/windows-setup.ps1` `/setup/mac-setup.sh` | 一键安装脚本（自动注入网关地址） | 公开 |
| GET | `/setup/releases.json` | 当前下发的客户端版本 + 各平台包路径与 sha256（安装脚本的事实源） | 公开 |
| GET | `/setup/packages/:platform[/:version]` | 客户端安装包实体（内网直装，支持 Range 续传；缺省取下发版本） | 公开 |
| GET | `/admin/desktop-repo` | 桌面客户端发布台（版本清单 + 各平台包状态 + 设置） | admin |
| POST | `/admin/desktop-repo/check` `/admin/desktop-repo/sync` | 立即检测上游新版本 / 同步指定版本入库（已有且摘要一致的平台自动跳过，`{force:true}` 才强制重下） | admin |
| PATCH | `/admin/desktop-repo` | 改检测与入库设置 / 设为下发版本（发布与回滚）/ 存 GitHub 令牌 | admin |
| POST | `/admin/desktop-repo/upload` | 离线上传安装包（不通公网的客户） | admin |
| DELETE | `/admin/desktop-repo/:version` | 删除某版本的本地包（上游清单保留，可重新同步） | admin |
| GET | `/setup/env.json` | 当前下发的 Node / pnpm 版本 + 各平台包路径与 sha256（安装脚本的事实源） | 公开 |
| GET | `/setup/env/:kind/:platform[/:version]` | 环境物料实体（`kind=node\|pnpm`，内网直装，支持 Range 续传） | 公开 |
| POST | `/admin/env-repo/check` `/admin/env-repo/sync` | 立即检测上游新 LTS / pnpm 版本 / 同步指定物料入库（同上：已有一致实体自动跳过，`{force:true}` 强制重下） | admin |
| POST | `/admin/env-repo/upload` | 离线上传 Node/pnpm 包（不通公网的客户） | admin |
| DELETE | `/admin/env-repo/:kind/:version` | 删除某版本的环境物料（上游清单保留，可重新同步） | admin |
| POST | `/policy/ack` `/heartbeat` | 插件回执/心跳 | 可选 |
| GET | `/admin/stats` | 今日统计 + 7 日按用户 | admin |
| GET | `/admin/logs?user=&limit=` | 留痕检索 | admin |
| GET | `/admin/terminals` | 在线终端 | admin |
| GET | `/admin/plugins` | 插件注册表快照（loaded/disabled/failed + provides/inject 契约） | admin |
| PATCH | `/admin/plugins/:name` | 插件开关落盘（`{enabled}`，重启生效） | admin |
| POST | `/admin/seal-anchor` | 封存当日 Merkle 锚 | admin |
| GET | `/admin/verify-anchor?day=` | 防篡改校验 | admin |
| PATCH | `/admin/policy` | 策略热更（audit/dlp/policy） | admin |
| GET | `/admin/config` | 渠道配置（Key 脱敏） | admin |

## 客户端发布（桌面客户端插件）

网关自己成为 DSH Desktop 的**内网分发点**，安装脚本不再钉死版本号：

- **检测**：默认每 6h（首启 20s 后先跑一次）拉 GitHub Releases + ModelScope 镜像两条 feed，按 `(版本, 平台)` 归并；`channel=beta` 才收预发布包
- **入库**：`autoSync` 下自动把最近 `keepVersions` 个版本拉到 `data/desktop-repo/files/<版本>/<平台>-<文件>`；流式下载边算 sha256 边比对上游摘要，**不一致就删掉临时文件并记错**，绝不留半个坏包；单包 `maxPackageMb`、总量 `maxTotalGb` 双闸
- **发布**：管理员在「桌面客户端」页点**设为下发版本**才生效（不自动发布），随时可切回旧版本回滚；被下发的版本不允许删包
- **下发**：`/setup/releases.json` 给出 `{version, mac:{path,sha256,size}, win:{…}, allowUpstreamFallback}`，脚本据此走局域网直装；离线客户可在「离线上传」页签把包塞进同一个库
- **兜底**：网关没有对应平台的包时脚本才回退 GitHub → ModelScope（均动态取最新版与摘要）；把 `allowUpstreamFallback` 关掉即纯内网闭环
- **页面**：「桌面客户端」拆四个二级页签 —— **版本清单**（下发状态 + 版本表，默认只列最近 3 个，更早的展开看）、**环境物料**、**下发设置**（安装包与环境物料两张策略卡）、**离线上传**

安全姿态：网关成了二进制分发点，所以上游摘要必校验、下载主机走白名单（github/modelscope/aliyuncs）、只允许 https；GitHub 匿名限额 60 次/小时，需要时把令牌存进 `data/.env` 的 `DSH_RELEASE_TOKEN`（页面只回 `hasToken`，不回令牌本身）。

### 环境物料（「环境物料」页签）

装机脚本要先有 Node 和 pnpm 才谈得上装插件。纯内网环境里这一步原先必挂（Homebrew / `npm i -g pnpm` 都要出网），现在同一套「检测 → 入库 → 发布 → 下发」也覆盖环境物料，存储与代码都跟安装包共用：

- **物料**：`node` 按机器架构分三档（`mac-arm64` / `mac-x64` / `win-x64`），取官方 `index.json` + `SHASUMS256.txt`；`pnpm` 也按平台分档 —— pnpm 12 起主 npm 包不再自带运行时：`install.js` 要用 `optionalDependencies` 里的 `@pnpm/exe.<平台>` 顶掉占位 bin，顶不到就退回首次运行时去 `get.pnpm.io` / `registry.npmjs.org` 下载，纯内网两条路都不通；所以镜像的是官方 `@pnpm/exe.<os>-<cpu>` 原生包（解出来就是一个可执行文件，不依赖 Node、不碰 npm 源。注：pnpm 11 及更早的主包是自包含 JS，约 18 MB，不需要这套）
- **源**：Node 走 nodejs.org 与 npmmirror 两条 feed（顺序即优先级），pnpm 走 npmjs 与 npmmirror 两个 registry；`nodeChannel=lts` 只收 LTS，`nodeKeepVersions`/`pnpmKeepVersions` 控住在库版本数
- **发布**：同样由管理员点「设为下发版本」（环境物料按 kind 各一个指针），没有任何自动发布
- **下发**：`/setup/env.json` 给 `{node:{version,lts,files:{平台:{path,sha256,…}}}, pnpm:{…}, allowUpstreamFallback}`；mac 脚本把 Node 装进 `~/.local/share/nodejs`、pnpm 装进 `~/.local/share/pnpm`，命令软链到 `~/.local/bin`（无 root、无交互、无 Homebrew），已装好满足版本要求的机器一律沿用
- **兜底**：网关没有对应平台的包，脚本才回退官方源/国内镜像（同样先校验摘要再安装）；`allowUpstreamFallback` 关掉后脚本直接报错并提示让 IT 补包，绝不偷偷出网
- 体量参考：Node 三档约 150MB + pnpm 三档约 106MB（每版本），`envMaxPackageMb` / `envMaxTotalGb` 双闸

对应脚本步骤：`setup/mac-setup.sh` 与 `setup/windows-setup.ps1` 的 `[1/6] 网关地址` → `[2/6] Node 与 pnpm`（网关地址提前到第一步，否则拿不到 env.json）。

## 安全模型

- **模型名抽象**：用户只见 `ent-default / ent-reasoning`，真实映射在渠道配置里，换上游无感
- **DLP**：`sk-…` 密钥 = 硬拦截（请求不到上游）；卡号/手机号/身份证 = 脱敏后放行（留痕存脱敏版）
- **留痕**：SQLite 只追加；应用无 UPDATE/DELETE 代码路径；每日 Merkle 锚 + `verify-anchor` 校验
- **JWT**：HS256，密钥由 `ENT_JWT_SECRET` 注入（start 脚本自动生成临时值；生产持久化）

## 已验证（2026-09-09 本机端到端）

```
登录 OK → 401 路径 OK → 非流式推理 OK（GLM 真实回复）
流式 63 SSE chunks OK → DLP 硬拦截 OK
统计 tokens=33/1687 拦截=1 → 封存锚 root=906da9d6… → 防篡改校验 ok=True
策略热更 audit.level=metadata_only OK
```

## 与 DSH 对接

`~/.dsh/settings.yaml` 增加 provider：

```yaml
providers:
  ent-gateway:
    displayName: 企业网关
    apiKeyEnv: ENT_GATEWAY_TOKEN     # = 登录 /auth/login 得到的 JWT
    api: openai-completions
    baseURL: http://127.0.0.1:8899/v1
    models:
      - id: ent-default
        contextWindow: 200000
        maxTokens: 64000
        input: [text]
```

## v2.2 新增（2026-09-09 下午）

| 能力 | 端点 | 说明 |
| --- | --- | --- |
| 用户管理 | `GET/POST /admin/users`、`PATCH/DELETE /admin/users/:id` | 创建/停用/重置密码/角色；停用即时失效（JWT 实时校验 enabled） |
| 自助改密 | `POST /auth/change-password` | 旧密码 + 新密码（≥8 位） |
| 计费视图 | `GET /admin/usage?days=14` | 按日聚合请求数/Token/用户数（不含被拦截请求） |
| 渠道热更 | `PATCH /admin/channels/:id` | 启用/禁用/权重，不重启网关 |
| 设备令牌 | `auth.deviceTokens` 配置 | 长期有效的静态令牌，适合 DSH provider 接入 |
| 401 诊断 | handleChat 日志 | 记录失败原因 + auth 头长度，快速定位接入问题 |

管理台同步新增：用户管理卡（创建/改密/停用）、计费视图卡、渠道开关。

## 部署形态（Windows 本机）

- 启动器：`C:\dsh-gw\start-gw.cmd` + `boot.mjs`（规避中文路径 + 沙箱进程限制）
- 计划任务：`DSH-Enterprise-Gateway`（登录自启）
- 数据：`C:\dsh-gw\gateway.db`；配置：`C:\dsh-gw\gateway-config.json`
- 日志：`C:\dsh-gw\gateway-stdout.log`

## 待办（Q2 路线）

- PostgreSQL 后端替换 SQLite（`store.mjs` 单点替换）
- 计费单价表 + 月度账单导出
- 流式下的 DLP 增量扫描（当前为首包整段扫描）
