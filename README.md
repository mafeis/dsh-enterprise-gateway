# DSH 企业网关（dsh-enterprise-gateway）

企业级 LLM 网关：统一管理 AI 供应商与模型，员工终端经网关访问大模型，管理员在一个管理台完成全部治理。

## 功能

- **多供应商接入** — OpenAI / Anthropic / Gemini 协议，密钥 .env 托管，管理台可改即热生效
- **模型目录管理** — 上架/下架、思考档位（可选/强制）、输入模式（图片/视频）、定价
- **容灾** — 模型级备用供应商；主家失败自动切换（请求级熔断 60s），恢复自动回切
- **状态检测** — 每供应商独立探测（间隔/失败次数可配），连续失败自动停用、通过自动恢复；管理台可看累计探测/成功率/平均延迟
- **管理台** — 供应商与模型、用户管理、计费账单、安全防护、审计留痕、客户端管控，一个页面全搞定
- **安全** — JWT 鉴权 + 登录防爆破、DLP 内容检测、全量请求留痕（SQLite）、设备令牌
- **一切皆插件** — 17 个业务插件（Cordis 内核），页面 + API + 领域服务一体

## 启动

要求：Node 22.5+（零 npm 依赖）

```powershell
cd gateway

# 1. 准备配置（首次）
copy gateway-config.example.json data\gateway-config.json
#    密钥写入 data\.env，一行一个：ENT_PROV_<名字>_KEY=sk-xxx

# 2. 启动
node gateway.mjs

# 3. 打开管理台
# http://127.0.0.1:8899/admin   （默认账号 admin / admin123，登录后请改密）
```


## 目录

```
gateway/
├── gateway.mjs            # 启动入口
├── src/                   # 网关核心（config / upstream / probe / auth / dlp / store / routes / core）
├── src/plugins/           # 17 个业务插件（每个插件 = 页面 + API + 领域服务）
│   └── *.web/             #   插件自带管理台页面
├── admin-web/             # 管理台壳（登录 + 路由 + 布局，页面全部来自插件）
├── scripts/               # 运维脚本（业务检查 / 密码重置 / 冒烟测试）
└── data/                  # 运行数据（gateway.db / .env / 配置，不入库）
```

## 常用命令

```powershell
node scripts/check-business.mjs    # 业务体检：心跳 / 最近请求 / 今日统计
node scripts/smoke.mjs             # 冒烟测试
node scripts/reset-admin-pw.mjs <新密码>   # 重置管理员密码
```
