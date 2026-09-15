# 管理台插件页面规范（v1）

> 对齐《DSH 插件生态与技术规范》：组合优先 · 声明清晰 · 兼容优先。
> 核心立场：**页面是插件自己的事**。管理台（admin-web）只是壳——登录、导航框架、基础样式与官方契约；
> 插件自带页面资源，装载了谁，导航就多谁；插件禁用，页面随之消失（重启生效，与 bundle reconcile 同哲学）。

---

## 1. 三条原则（与 DSH 倡议书一一对应）

| # | 原则 | 在管理台页面上的含义 |
| --- | --- | --- |
| 1 | **组合优先** | 插件页面通过壳提供的**官方 slot**（`nav-page`）接入；不假设壳内部实现，不触碰壳私有区域（顶栏、登录页、核心页面） |
| 2 | **声明清晰** | 插件静态导出 `admin` 声明页面（导航 id/标题/图标 + 入口模块）；页面模块只依赖**官方 contract 模块** |
| 3 | **兼容优先** | contract 模块的导出签名是受支持 API，只增不改；`admin` 声明结构只增字段不换语义 |

## 2. 插件侧：声明与资源

### 2.1 admin 声明（静态、可被装载器读取）

```js
// src/plugins/ent-xxx.mjs
export const admin = {
  nav: { id: 'unique-id', title: '页面标题', icon: 'puzzle', order: 100 },
  entry: 'index.mjs',   // 相对本插件 <name>.web/ 目录
}
```

- `icon` = lucide 图标名（官方图标契约，见 §5.3），禁止 emoji。
- `order` 控制侧边导航排位（越小越靠前；核心壳页面占 20–80，缺省 100 追加在后）。

- 无 `admin` 导出 = 插件不带页面（纯服务插件），壳对它零感知。
- 声明只描述「我要一个内容页」，不申请其他 UI 区域——**顶栏等壳私有 slot 不对插件开放**（对齐 DSH：「标题栏 action slot 由 Desktop 私有持有」）。

### 2.2 页面资源包（插件自包含）

```
src/plugins/
  ent-xxx.mjs          ← 插件逻辑 + admin 声明
  ent-xxx.web/         ← 界面资源包（跟随插件生灭）
    index.mjs          ← entry 指向的页面模块
    （可放更多文件，经 /admin/plug/ent-xxx/<file> 访问）
```

- 资源经 `GET /admin/plug/<插件名>/<文件>` 提供，**必须过管理台鉴权**（HttpOnly 会话 cookie 随动态 import 自动携带；见 §4）。
- 服务器内部路径（webDir）不下发前端；快照只含公开契约字段。

### 2.3 页面模块契约（default export）

```js
// ent-xxx.web/index.mjs
import { api, $, esc, toast, confirmDlg } from '/admin/static/contract.mjs'

export default {
  page: 'ent-xxx',            // DOM 约定：页面根元素标记 data-ent-page="ent-xxx"
  html: `<div class="headrow" data-ent-page="ent-xxx">…</div>…`,
  async load() { /* 每次导航到本页调用：拉数据、渲染 */ },
  bind() { /* 首次挂载调用一次：事件绑定（模块级防重入） */ },
}
```

| 导出 | 调用时机 | 必须 |
| --- | --- | --- |
| `html` | 挂载时注入页面 section | 是 |
| `load()` | 每次导航进入（含刷新本页） | 是（可为空实现） |
| `bind()` | 首次挂载，仅一次 | 否 |
| `page` | DOM 约定标记 | 推荐 |

## 3. 壳侧：slot 与发现机制

壳（admin-web）只提供 **`nav-page` slot**：

1. 登录后首次导航时，壳拉取 `GET /admin/plugins`，对每个带 `admin` 声明的已装载插件：
   - 在侧边导航底部工具区之前插入导航项（icon + title）；
   - 在内容区创建页面 section（`<section class="page" id="page-<nav.id>">`）；
   - 动态 `import('/admin/plug/<插件名>/<entry>')`，注入 `html`，调用 `bind()`；
   - 注册路由：进入时调用 `load()`。
2. 插件被禁用 → 重启后清单里没有它 → 导航与页面自然消失。**壳不维护插件页面清单，清单的唯一来源是装载器**（对齐 DSH：不依赖 receipt，读取当前 generation 真实状态）。

## 4. 鉴权（受控 carrier）

- 管理台 API 走 `Authorization: Bearer <JWT>`（localStorage）。
- 插件页面模块经动态 `import()` 加载——**该通道无法携带自定义头**，因此登录/续期时网关同时下发 `ent_jwt` **HttpOnly cookie**（SameSite=Strict），模块请求自动携带；登出/改密即清除并吊销。
- cookie 与 JWT 同票同版本校验：改密/登出后旧 cookie 立即失效（`token_version` 校验兜底）。
- `/admin/plug/*` 无有效凭证一律 401；文件名白名单 + 防目录穿越。

## 5. 统一设计系统（令牌 + 组件 + lint）

### 5.1 设计令牌（CSS 变量，禁止硬编码颜色/字号）

| 令牌 | 值 | 用途 |
| --- | --- | --- |
| `--accent` | #2563eb | 主色：竖条、primary 按钮、链接 |
| `--ok` / `--warn` / `--bad` | #059669 / #d97706 / #dc2626 | 语义色，只做小面积（徽章文字/细边框） |
| `--txt` / `--dim` | #1f2937 / #6b7280 | 正文 / 次要文字 |
| `--card` / `--line` / `--bg` | #ffffff / #e6eaf1 / #f4f6fa | 卡片底 / 边框 / 页面底 |
| `--dark` | #0f172a | 顶栏、代码块深底 |

字号阶梯 21/15.5/14/12.5px（h1/card h2/正文/次要），正文行高 1.7。

### 5.2 公开组件类（受支持契约）

`card / headrow / sub / crumb / badge(.ok/.warn/.bad/.dim) / layer(.l-meta/.l-biz/.l-collab/.l-ui/.l-ext) / table / empty / btn(.primary/.danger/.sm) / input / select / mono / num / grid2 / grid4 / codeblock / sw / dlg-mask / dlg(.sm/.md/.lg/.wide/.bench) / dlg-head / dlg-body / dlg-foot / dlg-x`

**活样册**：管理台「🎨 样式规范」页（#/design）可视化展示全部令牌与组件——插件作者从这里复制结构，保证每个插件页面长一个样。

### 5.3 图标契约（lucide，与 DSH 视觉同源）

- 官方图标集：`admin-web/icons.mjs`，与 DSH Desktop 所用 **lucide-react v1.41.0 同一版本**，SVG path 逐字同源（线性、stroke=2、currentColor）。经 contract 导出 `icon(name, { size, cls })` 使用。
- 插件页面**禁止 emoji 图标**（lint R6 强制）；`admin.nav.icon` 填 lucide 图标名（如 `'puzzle'`），壳导航自动渲染。
- 新增图标：从 lucide-react 同版本 `dist/esm/icons/<name>.mjs` 复制 `__iconNode`，**禁止手绘改 path**（保持与 DSH 像素级一致）。

### 5.4 DOM 与行为约束

- 页面根元素标记 `data-ent-page="<插件名>"`（对齐 DSH 的 `data-dsh-*` DOM 约定）。
- 禁止：`<style>` 私改风格、外链 CDN 资源、裸 `fetch`（一律走契约 `api()`）、操作壳私有 DOM（topbar/sidebar 核心区/登录遮罩）。

### 5.4 lint（可测试的契约，对齐 DSH Fabric 思路）

`scripts/lint-pages.mjs`（已挂入 `npm run check`）对 `src/plugins/*.web/` 强制执行：

| 规则 | 内容 |
| --- | --- |
| R1 | import 只准官方契约（`/admin/static/contract.mjs`）或自身包内相对模块 |
| R2 | 禁止 `<style>` 块 |
| R3 | 禁止外链资源（http/https 的 src/href） |
| R4 | `html` 必须含 `data-ent-page` 锚点 |
| R5 | 禁止裸 `fetch`（走契约 `api()`） |
| R7 | 业务弹窗必须用统一 `.dlg-*` 族 + 契约 `openDlg/closeDlg`（历史 term/edit/probe/nu-modal、modal-mask 已下线） |

lint 失败 = check 失败，插件页面进不了主干。

### 5.5 业务弹窗规范（全站唯一弹窗族）

业务弹窗（确认 confirmDlg 之外的表单/详情层）只有一套结构与交互，由壳 CSS（`.dlg-*`）+ 契约 API（`openDlg/closeDlg`）共同保证：

```html
<div class="dlg-mask" id="xxxDlg" hidden>
  <div class="dlg md" role="dialog" aria-modal="true">
    <div class="dlg-head">
      <h3>标题</h3>
      <button class="dlg-x" data-dlg-close title="关闭 (Esc)">${icon('x', { size: 16 })}</button>
    </div>
    <div class="dlg-body">…唯一滚动区…</div>
    <div class="dlg-foot">…可选操作条（取消加 data-dlg-close 即可）…</div>
  </div>
</div>
```

```js
import { openDlg, closeDlg } from '/admin/static/contract.mjs'
openDlg($('xxxDlg'))    // 打开（锁页面滚动）
closeDlg($('xxxDlg'))   // 关闭（保存成功后代码调用）
```

**结构约定**

| 部分 | 约定 |
| --- | --- |
| `.dlg-head` | 标题 + 右上角 × 关闭；**常驻不随内容滚动**（head 是固定区，只有 `.dlg-body` 滚动） |
| `.dlg-body` | 唯一滚动区；内容再长标题也不消失 |
| `.dlg-foot` | 可选操作条（err 左、按钮右）；「取消」按钮加 `data-dlg-close` 即可，无需 JS |

**尺寸五档（全站统一，禁止内联 width）**

| 档 | 宽 | 适用 |
| --- | --- | --- |
| `.dlg.sm` | 460px | 单字段 / 设置面（展示设置、重置密码） |
| `.dlg.md` | 640px | 紧凑表单 / 中等详情（供应商编辑、终端详情、加载占位） |
| `.dlg.lg` | 880px | 分区表单（模型编辑、新增账号） |
| `.dlg.wide` | 1100px | 长文本详情（留痕正文、账号活动） |
| `.dlg.bench` | 1240px × min(860px, 92vh) | 多卡并排工作台（上游探测） |

**交互约定（由契约统一实现，页面零 JS）**

- 两路关闭：右上角 `[data-dlg-close]`（× 与取消按钮）、Esc；**点击遮罩空白不关闭**（防误触丢掉填了一半的表单，点到弹窗外没有任何动作）；
- 后开在上（栈）：叠层时 Esc 只作用栈顶；确认弹窗（confirmDlg）在场时 Esc 让位给它；
- 打开锁页面滚动，全部关闭后恢复；
- 危险确认（删除/改名）一律走契约 `confirmDlg`，不要自造确认层。

活样册：管理台「🎨 样式规范」页有结构代码与可打开的实时示例。

## 6. 生命周期与故障语义

| 场景 | 行为 |
| --- | --- |
| 插件禁用后重启 | 导航项与页面消失（清单驱动，无残留） |
| 插件装载失败 | 同上（不在 loaded 清单中） |
| 页面模块加载异常 | 该页显示「页面装载失败」占位；**不影响其他插件页面与核心页面** |
| `load()` 抛错 | 该页数据区维持原状；401 由壳统一处理，其他错误进页面自身 |
| 导航 id 冲突 | 先装载者胜，后者忽略（确定性；装载顺序 = 依赖顺序） |

## 7. 插件页面开发检查清单

1. `admin` 声明的 nav.id 全局唯一、title/icon 就绪。
2. 页面只 import `/admin/static/contract.mjs` 与自身资源——**没有任何壳内部 import**。
3. `html` 根元素带 `data-ent-page`；只用公开 CSS 类。
4. `load()` 幂等（导航可反复进入）；`bind()` 有防重入。
5. `fetch` 全部走 contract 的 `api()`（自动带 JWT；cookie 由浏览器自动带）。
6. 业务弹窗一律 `.dlg-*` 结构 + 契约 `openDlg/closeDlg`（§5.5）：三路关闭、标题常驻、五档尺寸，不自绑 Esc/遮罩事件。
7. 禁用本插件重启，确认导航与页面干净消失、其他页面不受影响。
