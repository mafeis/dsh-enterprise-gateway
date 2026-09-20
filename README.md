<div align="center">
  <img src="assets/logo.svg" width="128" alt="dsh-enterprise-gateway logo">

  # dsh-enterprise-gateway

  **DSH 企业网关 · DSH Enterprise Gateway**

  统一大模型入口 · 密钥托管 · 治理与容灾
  One LLM entrypoint · Key custody · Governance & failover

  <sub>独立源码开放项目，非 DeepSeek 官方产品 · Independent source-available project, not an official DeepSeek product</sub>

  <p>
    <a href="https://github.com/mafeis/dsh-enterprise-gateway/releases/latest"><img src="https://img.shields.io/github/v/release/mafeis/dsh-enterprise-gateway?style=flat&label=release&color=4D6BFE" alt="Release"></a>
    <a href="https://www.npmjs.com/package/dsh-enterprise-gateway"><img src="https://img.shields.io/npm/v/dsh-enterprise-gateway?style=flat&color=CB3837" alt="npm"></a>
    <a href="https://www.npmjs.com/package/dsh-enterprise-gateway"><img src="https://img.shields.io/npm/dm/dsh-enterprise-gateway?style=flat&label=downloads&color=9ca3af" alt="npm downloads"></a>
    <a href="LICENSE"><img src="https://img.shields.io/badge/license-DSH%20Community%20License%20v1.0-2EA44F?style=flat" alt="DSH Enterprise Community License"></a>
  </p>
  <p>
    <img src="https://img.shields.io/badge/node-%E2%89%A522.5-339933?logo=node.js&logoColor=white" alt="Node >=22.5">
    <img src="https://img.shields.io/badge/runtime%20deps-1-9ca3af" alt="Runtime dependencies: 1">
    <img src="https://img.shields.io/badge/database-SQLite%20(built--in)-818cf8" alt="SQLite built-in">
  </p>

  [简体中文](#-简体中文) · [English](#-english) · [最新下载](https://github.com/mafeis/dsh-enterprise-gateway/releases/latest)
</div>

---

## 🇨🇳 简体中文

### 它解决了什么问题

- **密钥散落** — 各家 API Key 复制到每台电脑，谁拷走了都不知道
- **无法管控** — 谁在用、用多少、花多少钱，管理员一概不知
- **不安全** — 内部敏感内容原样发给外部模型，没有检测和留痕
- **不可靠** — 某家供应商挂了，用户工作直接中断

DSH 企业网关把所有大模型访问收敛到一个入口：终端只连网关，真实密钥只存服务器；模型上架、用户计费、安全防护、审计留痕都在一个管理台完成。供应商故障自动切换备用家，恢复后自动回切。

### 安装部署

要求：Node.js `>=22.5`（内置 SQLite，无需装数据库），Linux / Windows / macOS 均可，2C4G 服务器起步。

```bash
npm i -g dsh-enterprise-gateway   # 国内网络慢可加 --registry=https://registry.npmmirror.com
dsh-enterprise-gateway            # 任意目录启动；不想全局装就 npx dsh-enterprise-gateway
```

首次启动自动完成：

- 在当前目录创建 `./data`（配置、数据库、审计都在这里，**备份这个目录 = 备份一切**）
- 创建管理员 `admin`，**初始密码只在启动日志打印一次**（找「初始密码: xxxx」），立即保存

日志出现 `http://127.0.0.1:8899` 即启动成功。

#### 初始化（管理台）

浏览器打开 `http://127.0.0.1:8899/admin`，用 `admin` + 初始密码登录，按顺序做两件事：

1. **「供应商与模型」** — 填上游 `baseUrl` 与 API Key，加模型并映射 `upstreamModel`；保存后点「测试」应显示连通毫秒数
2. **「用户管理」** — 为每位用户建账号，即终端登录账密

> 网关默认只监听 `127.0.0.1`。给局域网/公网用：`data/gateway-config.json` 里 `server.host` 改 `"0.0.0.0"`（或 `HOST=0.0.0.0`）重启；生产环境放到反向代理（HTTPS）之后，勿裸露管理台。

#### 用户端接入

把网关地址发给用户，浏览器打开 `http://<网关IP>:8899/`，按页面指引复制一条命令回车即可。

### 功能一览

| 功能 | 说明 |
| --- | --- |
| 多供应商接入 | OpenAI / Anthropic / Gemini 协议，密钥服务端托管，管理台热生效 |
| 模型目录 | 上架/下架、思考档位、输入模式、定价 |
| 容灾切换 | 模型级备用供应商，失败自动切换、恢复自动回切 |
| 健康探测 | 独立探测，连续失败自动停用、通过自动恢复 |
| 管理台 | 供应商、用户、计费、安全、审计、客户端管控，一站式 |
| 安全 | JWT 鉴权 + 防爆破、DLP 检测、全量留痕、设备令牌 |

### 常用命令

```bash
node scripts/check-business.mjs            # 业务体检
node scripts/smoke.mjs                     # 冒烟测试
node scripts/reset-admin-pw.mjs <新密码>    # 重置管理员密码
```

### 从源码运行（开发者）

<details>
<summary>展开</summary>

```bash
git clone https://github.com/mafeis/dsh-enterprise-gateway.git
cd dsh-enterprise-gateway/gateway
npm install
node gateway.mjs
# 首次准备配置：copy gateway-config.example.json data\gateway-config.json
# 供应商密钥写入 data\.env：ENT_PROV_<名字>_KEY=sk-xxx
```

</details>

### 文档

| 文档 | 内容 |
| --- | --- |
| [网关核心文档](gateway/docs/网关核心文档.md) | 架构、插件契约、配置路径链、API 清单、运维排错 |
| [管理台页面文档](gateway/docs/admin-plugin-pages.zh.md) | 各插件管理页说明 |
| [插件映射](gateway/docs/plugin-map.zh.md) | 网关服务与插件的对应关系 |

## 🇬🇧 English

### What problem does it solve

- **Keys scattered** — provider API keys copied onto every machine, with no idea who took one
- **Zero visibility** — who uses what, how much, at what cost: admins have no clue
- **No safety net** — internal sensitive content sent verbatim to external models, unchecked and unlogged
- **Fragile** — one provider outage and everyone's work stops

DSH Enterprise Gateway funnels all LLM traffic through a single entrypoint: terminals only talk to the gateway, real API keys live on the server only. Model catalogs, users & billing, content security and audit trails are all handled in one admin console. Provider outages fail over automatically and switch back on recovery.

### Installation

Requirements: Node.js `>=22.5` (built-in SQLite, no database server), Linux / Windows / macOS, 2 vCPU / 4 GB to start.

```bash
npm i -g dsh-enterprise-gateway   # append --registry=https://registry.npmmirror.com if npm is slow
dsh-enterprise-gateway            # start from any directory; or npx dsh-enterprise-gateway
```

The first start automatically:

- Creates `./data` in the current directory (config, database, audit trail — **backing up this directory backs up everything**)
- Creates the admin `admin`; **the initial password is printed once in the startup log** (look for「初始密码: xxxx」) — save it immediately

Startup succeeded once the log shows `http://127.0.0.1:8899`.

#### Initial setup (admin console)

Open `http://127.0.0.1:8899/admin`, sign in as `admin` with the initial password, then do two things in order:

1. **Providers & Models** — add the upstream (`baseUrl` + API key), add models and map `upstreamModel`; "Test" should report round-trip milliseconds
2. **Users** — create an account per user; these are the terminal sign-in credentials

> The gateway listens on `127.0.0.1` only by default. For LAN/public use: set `server.host` to `"0.0.0.0"` in `data/gateway-config.json` (or `HOST=0.0.0.0`) and restart; in production always put it behind a reverse proxy (HTTPS) — never expose the admin console directly.

#### Client terminals

Send users the gateway URL: opening `http://<gateway-ip>:8899/` in a browser shows the setup page; the user copies one command and is done.

### Features

| Feature | Description |
| --- | --- |
| Multi-provider | OpenAI / Anthropic / Gemini protocols; keys server-side, hot-reloaded from the console |
| Model catalog | Publish / unpublish, thinking tiers, input modes, pricing |
| Failover | Per-model backup providers; automatic failover and switch-back |
| Health probing | Independent probes; auto-disable on repeated failures, auto-recover |
| Admin console | Providers, users, billing, security, audit, client governance — one place |
| Security | JWT auth + brute-force protection, DLP inspection, full audit trail, device tokens |

### Common commands

```bash
node scripts/check-business.mjs              # Health check
node scripts/smoke.mjs                       # Smoke test
node scripts/reset-admin-pw.mjs <new-password>   # Reset the admin password
```

### Run from source (developers)

<details>
<summary>Expand</summary>

```bash
git clone https://github.com/mafeis/dsh-enterprise-gateway.git
cd dsh-enterprise-gateway/gateway
npm install
node gateway.mjs
# First-run config: copy gateway-config.example.json data\gateway-config.json
# Provider keys go into data\.env: ENT_PROV_<NAME>_KEY=sk-xxx
```

</details>

### Documentation

| Document | Contents |
| --- | --- |
| [Gateway core docs](gateway/docs/网关核心文档.md) | Architecture, plugin contract, config path chain, API list, ops & troubleshooting |
| [Admin pages docs](gateway/docs/admin-plugin-pages.zh.md) | Per-plugin admin page reference (Chinese) |
| [Plugin map](gateway/docs/plugin-map.zh.md) | Gateway services ↔ plugins mapping |

---

## 🔗 Related / 相关项目

- [dsh-enterprise](https://github.com/mafeis/dsh-enterprise) — DSH 客户端插件，用户终端装它即可登录即用 · DSH client plugin for user terminals (pairs with this gateway)

## 🤝 友情链接 / Friend Links

| 项目 | 简介 | 链接 |
| --- | --- | --- |
| DSH Desktop | 基于 DeepSeek Harness 构建的开源桌面客户端，推荐作为配套插件的运行环境。 | [GitHub](https://github.com/anywhere-labs/dsh-desktop) · [官网](https://dshdesktop.cn) |
| DeepSeek Harness | DSH 官方上游：核心智能体、插件系统与 Web UI。 | [GitHub](https://github.com/deepseek-ai/deepseek-harness) · [DeepSeek 官网](https://www.deepseek.com) |

## 🙏 致谢 / Acknowledgements

- 插件化内核基于 [@deepseek-ai/cordis](https://www.npmjs.com/package/@deepseek-ai/cordis)（[Cordis](https://github.com/cordiverse/cordis)）构建
- 依托 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 的插件体系与生态落地
- 推荐使用 [DSH Desktop](https://github.com/anywhere-labs/dsh-desktop) 运行配套插件

The plugin kernel is built on `@deepseek-ai/cordis` (Cordis), shipped within the DeepSeek Harness plugin ecosystem. [DSH Desktop](https://github.com/anywhere-labs/dsh-desktop) is the recommended way to run the companion plugin.

## 📄 License

[DSH 企业版社区许可 · DSH Enterprise Community License v1.0](LICENSE)（源码开放）

- **个人及 ≤30 人的机构** — 免费使用、修改、内部部署 · Free for individuals and organizations of ≤30 people
- **>30 人的机构** — 需商业授权 · Commercial license required: <mafeis@gmail.com>
- 超限时管理台会持续提醒（不拦截功能）；取得的授权码在管理台「用户管理 → 商业授权」录入
