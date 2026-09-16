<div align="center">
  <img src="assets/logo.svg" width="128" alt="dsh-enterprise-gateway logo">

  # dsh-enterprise-gateway

  **DSH 企业网关 · DSH Enterprise Gateway**

  统一大模型入口 · 密钥托管 · 治理与容灾
  One LLM entrypoint · Key custody · Governance & failover

  ![License](https://img.shields.io/badge/license-MIT-blue)
  ![Node](https://img.shields.io/badge/node-%E2%89%A522.5-339933?logo=node.js&logoColor=white)
  ![Dependencies](https://img.shields.io/badge/runtime%20deps-1-9ca3af)
  ![Database](https://img.shields.io/badge/database-SQLite%20(built--in)-818cf8)

  [简体中文](#-简体中文) · [English](#-english)
</div>

---

## 🇨🇳 简体中文

### 它解决了什么问题

企业里员工各自直连大模型，麻烦一大串：

- **密钥散落** — OpenAI / Anthropic / Gemini 的 API Key 复制到每台电脑，谁拷走了都不知道
- **无法管控** — 谁在用、用多少、花了多少钱，管理员一概不知
- **不安全** — 内部敏感内容原样发给外部模型，没有检测和留痕
- **不可靠** — 某家供应商挂了，员工工作直接中断

DSH 企业网关把所有大模型访问收敛到一个入口：员工终端只连网关，真实密钥只存在服务器；管理员在一个管理台完成模型上架、用户与计费、安全防护、审计留痕、客户端管控。供应商故障自动切换备用家，恢复后自动回切，员工无感。

### 功能一览

| 功能 | 说明 |
| --- | --- |
| 多供应商接入 | OpenAI / Anthropic / Gemini 协议，密钥服务端托管，管理台可改即热生效 |
| 模型目录 | 上架/下架、思考档位、输入模式（图片/视频）、定价 |
| 容灾切换 | 模型级备用供应商，主家失败自动切换、恢复自动回切 |
| 健康探测 | 供应商独立探测，连续失败自动停用、通过自动恢复 |
| 管理台 | 供应商、用户、计费账单、安全防护、审计、客户端管控，一个页面全搞定 |
| 安全 | JWT 鉴权 + 登录防爆破、DLP 内容检测、全量请求留痕、设备令牌 |

### 环境要求

| 依赖 | 版本 / 说明 |
| --- | --- |
| Node.js | `>=22.5`（推荐 22 LTS 或 24） |
| 运行时依赖 | 仅 1 个：`@deepseek-ai/cordis`（插件化内核），`npm install` 一键装好 |
| 数据库 | 内置 SQLite，无需单独安装数据库服务 |
| 操作系统 | Windows / Linux / macOS 均可 |

### 安装

```powershell
# 1. 安装依赖（在 gateway/ 目录下）
cd gateway
npm install

# 2. 准备配置（首次）
copy gateway-config.example.json data\gateway-config.json
#    供应商密钥写入 data\.env，一行一个：ENT_PROV_<名字>_KEY=sk-xxx

# 3. 启动
node gateway.mjs

# 4. 打开管理台
# http://127.0.0.1:8899/admin
#    首次启动自动创建引导管理员 admin，随机初始密码只在启动日志打印一次：
#    在启动输出里找「初始密码: xxxx」；登录后请立即改密
```

忘记管理员密码：

```powershell
node scripts/reset-admin-pw.mjs <新密码>
```

### 常用命令

```powershell
node scripts/check-business.mjs    # 业务体检：心跳 / 最近请求 / 今日统计
node scripts/smoke.mjs             # 冒烟测试
node scripts/reset-admin-pw.mjs <新密码>   # 重置管理员密码
```

## 🇬🇧 English

### What problem does it solve

When employees connect to LLM providers directly, trouble follows:

- **Keys scattered everywhere** — OpenAI / Anthropic / Gemini API keys copied onto every machine, with no idea who took one
- **Zero visibility** — who is using what, how much, and at what cost: admins have no clue
- **No safety net** — internal sensitive content sent verbatim to external models, unchecked and unlogged
- **Fragile** — one provider outage and everyone's work stops

DSH Enterprise Gateway funnels all LLM traffic through a single entrypoint: employee terminals only talk to the gateway, and real API keys live on the server only. Admins handle model catalogs, users & billing, content security, audit trails and client governance from one admin console. Provider outages fail over to backup providers automatically and switch back on recovery — employees never notice.

### Features

| Feature | Description |
| --- | --- |
| Multi-provider | OpenAI / Anthropic / Gemini protocols; keys kept server-side, hot-reloaded from the admin console |
| Model catalog | Publish / unpublish, thinking tiers, input modes (image/video), pricing |
| Failover | Per-model backup providers; automatic failover and automatic switch-back |
| Health probing | Independent provider probes; auto-disable after repeated failures, auto-recover |
| Admin console | Providers, users, billing, content security, audit, client governance — all in one place |
| Security | JWT auth + brute-force protection, DLP inspection, full request audit trail, device tokens |

### Requirements

| Dependency | Version / Notes |
| --- | --- |
| Node.js | `>=22.5` (22 LTS or 24 recommended) |
| Runtime dependencies | Just one: `@deepseek-ai/cordis` (plugin kernel) — installed by `npm install` |
| Database | Built-in SQLite — no separate database server needed |
| OS | Windows / Linux / macOS |

### Installation

```powershell
# 1. Install dependencies (inside the gateway/ directory)
cd gateway
npm install

# 2. Prepare config (first run)
copy gateway-config.example.json data\gateway-config.json
#    Write provider keys into data\.env, one per line: ENT_PROV_<NAME>_KEY=sk-xxx

# 3. Start
node gateway.mjs

# 4. Open the admin console
# http://127.0.0.1:8899/admin
#    A bootstrap admin account is created on first start; the random initial
#    password is printed once in the startup log — look for「初始密码: xxxx」
#    and change it right after signing in.
```

Forgot the admin password:

```powershell
node scripts/reset-admin-pw.mjs <new-password>
```

### Common commands

```powershell
node scripts/check-business.mjs    # Health check: heartbeat / recent requests / daily stats
node scripts/smoke.mjs             # Smoke test
node scripts/reset-admin-pw.mjs <new-password>   # Reset the admin password
```

---

## 🔗 Related / 相关项目

- [dsh-enterprise](https://github.com/mafeis/dsh-enterprise) — DSH 客户端插件，员工终端装它即可登录即用 · DSH client plugin for employee terminals (pairs with this gateway · 与网关配对使用)

## 📄 License

[MIT](LICENSE)
