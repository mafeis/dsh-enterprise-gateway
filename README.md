# DSH 企业网关（dsh-enterprise-gateway）

## 解决了什么问题

企业里员工各自直连大模型，会带来一连串麻烦：

- **密钥散落** — OpenAI / Anthropic / Gemini 的 API Key 复制到每台电脑，谁拷走了都不知道
- **无法管控** — 谁在用、用多少、花了多少钱，管理员一概不知
- **不安全** — 内部敏感内容原样发给外部模型，没有检测和留痕
- **不可靠** — 某家供应商挂了，员工工作直接中断

DSH 企业网关把所有大模型访问收敛到一个入口：员工终端只连网关，真实密钥只存在服务器；管理员在一个管理台完成模型上架、用户与计费、安全防护、审计留痕、客户端管控。供应商故障自动切换备用家，恢复后自动回切，员工无感。

## 安装

要求：Node 22.5+（零 npm 依赖）

```powershell
cd gateway

# 1. 准备配置（首次）
copy gateway-config.example.json data\gateway-config.json
#    密钥写入 data\.env，一行一个：ENT_PROV_<名字>_KEY=sk-xxx

# 2. 启动
node gateway.mjs

# 3. 打开管理台
# http://127.0.0.1:8899/admin
#    首次启动自动创建引导管理员 admin，随机初始密码只在启动日志打印一次：
#    在启动输出里找「初始密码: xxxx」；登录后请立即改密
#    （密码忘记可用 scripts/reset-admin-pw.mjs 重置）
```

## 常用命令

```powershell
node scripts/check-business.mjs    # 业务体检：心跳 / 最近请求 / 今日统计
node scripts/smoke.mjs             # 冒烟测试
node scripts/reset-admin-pw.mjs <新密码>   # 重置管理员密码
```
