/**
 * 插件页面 · 客户端管控（一级菜单 + 4 个二级页）
 * 壳契约：ent-client.mjs 的 nav.children 声明二级页 → 每个子页取本模块 pages[id] 的 { html, load, bind }
 *   #/client-switches 策略与开关（界面策略 + 登录保护）
 *   #/client-plugins  插件管控（允许清单 + 企业插件源）
 *   #/client-rules    自助规则（员工端本机执行的拦网址/拦关键词/公告）
 *   #/client-acks     下发回执（策略版本灰度核对）
 * 兼容：老壳不识别 nav.children 时回退 html/load/bind（= 第一个子页）。
 * 数据源：/admin/policy* /admin/policy-detail（ent-console 聚合提供）
 */
import { api, $, toast, esc } from '/admin/static/contract.mjs'

/* ---------- 公共片段 ---------- */
const headrow = (title, extra = '') => `
  <div class="headrow" data-ent-page="ent-client">
    <div><h1>${title}</h1></div>
    <div class="sp"></div>${extra}
  </div>`

const savebar = (key, label = '保存更改') => `
  <div class="savebar" id="${key}Savebar">
    <span class="savebar-msg" id="${key}Msg"></span>
    <button class="btn primary" id="${key}SaveBtn">${label}</button>
  </div>`

/* ============ 子页 1 · 策略与开关 ============ */
const switchesHtml = `
  ${headrow('策略与开关', `<span class="crumb" style="margin:0">策略版本 <span class="mono" id="polVer">—</span></span>`)}

  <!-- ============ 界面策略开关 ============ -->
  <div class="card">
    <h2><span class="bar"></span>界面策略 <span class="badge dim">点击即生效</span></h2>
    <div class="switchrow">
      <span class="lab2">模型配置锁定<span class="desc">员工端「设置 → 模型」页隐藏，模型只能经企业账号登录下发；防绕过网关直连外部模型</span></span>
      <span class="switch" id="swLock"></span>
    </div>
    <div class="switchrow">
      <span class="lab2">界面水印<span class="desc">员工端 Web 界面叠加半透明水印（账号 + 时间），截屏外传可溯源；仅影响显示</span></span>
      <span class="switch" id="swWm"></span>
    </div>
  </div>

  <!-- ============ 登录保护 ============ -->
  <div class="card">
    <h2><span class="bar"></span>登录保护 <span class="badge dim">防爆破</span></h2>
      <div class="switchrow">
      <span class="lab2">启用失败锁定<span class="desc">窗口内失败达阈值即临时锁定，到点自动解除（期间尝试不续锁）</span></span>
      <span class="switch" id="swLoginProt"></span>
    </div>
    <div class="fgrid" style="margin-top:10px">
      <label>失败阈值（次）</label><input class="input" id="lpMaxFails" type="number" min="1" max="1440">
      <label>统计窗口（分钟）</label><input class="input" id="lpWindow" type="number" min="1" max="1440">
      <label>锁定时长（分钟）</label><input class="input" id="lpLock" type="number" min="1" max="1440">
    </div>
    <div class="hint">当前配置：<b id="lpExample">10</b> 次失败 / <b class="lpWin">15</b> 分钟窗口 → 锁定 <b class="lpLock">15</b> 分钟</div>
    <details class="help">
      <summary>锁定机制说明</summary>
      <div class="help-body">
        <ol class="steps">
          <li>某账号登录失败 → 失败次数计入「统计窗口」内的滑动计数，成功登录会清零该账号计数</li>
          <li>窗口内累计失败 ≥ <b>失败阈值</b> → 该账号进入锁定状态</li>
          <li>锁定持续 <b>锁定时长</b> 分钟，期间正确密码也会被拒绝（返回 429 too_many_attempts）</li>
          <li>被锁期间的尝试<b>不延长锁定时间</b>——攻击者无法靠持续重试把账号永久锁死</li>
        </ol>
        <div class="notebox">被锁的账号在「用户管理」里不会显示为禁用——锁定是登录接口层的临时状态，到点自动解除。</div>
      </div>
    </details>
  </div>

  ${savebar('lp')}`

/* ============ 子页 2 · 插件管控 ============ */
const pluginsHtml = `
  ${headrow('插件管控')}

  <div class="card">
    <h2><span class="bar"></span>插件管控</h2>
      <textarea class="input" id="taPlugins" rows="4" style="width:100%;font-family:monospace" placeholder="dsh-enterprise&#10;@anysearch/anysearch-dsh"></textarea>

    <div class="fgrid" style="margin-top:14px">
      <label>企业插件源</label>
      <select id="regMode" class="input" style="width:100%">
        <option value="off">默认社区源（off · 不干预）</option>
        <option value="proxy">企业 npm 镜像（proxy）</option>
        <option value="url">企业直连地址（url）</option>
      </select>
      <label>回退公共源</label>
      <span class="chk"><input type="checkbox" id="regFallback"> 自建源拉取失败时允许回退社区源</span>
      <label>NPM 镜像地址<span class="dim2">proxy 模式</span></label>
      <input class="input" id="regUrl" placeholder="http://npm.corp.local:4873">
      <label>包地址前缀<span class="dim2">url 模式</span></label>
      <input class="input" id="regPrefix" placeholder="http://plugins.corp.local/packages/">
    </div>
    <div class="hint" id="regHint" style="margin-top:8px"></div>
      <details class="help">
      <summary>插件源两种模式怎么选 & 填写示例</summary>
      <div class="help-body">
        <div class="vsgrid">
          <div class="vs-a"><b>proxy 模式 —— 企业 npm 镜像（推荐）</b>
            适合已有或愿意部署 npm 私服（Verdaccio / Nexus / Artifactory）的企业。私服可代理社区源并缓存，也能发布仅内部可用的私有插件。
          </div>
          <div class="vs-b"><b>url 模式 —— 静态文件直连</b>
            不想部署私服时用：把插件 .tgz 包放到内网任意 HTTP 文件服务（如 nginx），员工端按「前缀 + 包名」直接下载。最简单，但没有缓存和版本管理。
          </div>
        </div>
        <div class="codeblock"><span class="cmt">// 员工端安装时插件内部实际执行的等价命令：</span>
<span class="cmt">// proxy 模式（自动带 --registry，员工无感知）</span>
dsh plugin add dsh-review <span class="hl">--registry http://npm.corp.local:4873</span>
<span class="cmt">// url 模式（前缀 + 包名直接作为包地址）</span>
dsh plugin add <span class="hl">http://plugins.corp.local/packages/</span>dsh-review</div>
        <div class="kv">
          <span class="k">bundle 名去哪找</span><span class="v">员工端「设置 → 企业管理 → 插件管理 → 本机已安装」显示的就是 bundle 名；或看插件 profile 目录 package.json 的 dsh.profile.bundles</span>
          <span class="k">url 前缀拼接</span><span class="v mono">最终地址 = packagePrefix + 插件包名（前缀末尾带不带 / 均可）</span>
          <span class="k">回退开关</span><span class="v">勾选 = 企业源暂时不可用时员工仍可装社区源插件（可用性优先）；不勾 = 企业源挂了就装不了（管控优先）</span>
        </div>
        <div class="notebox warn">务必把 dsh-enterprise 留在允许清单里 —— 它负责员工端登录与策略拉取（客户端对它有保护兜底，但保持清单正确可避免无谓告警）。</div>
        <div class="notebox ok">推荐组合：允许清单 + 企业源一起配 —— 员工「只能装」企业源里、且在允许清单内的插件，两头都管住。</div>
      </div>
    </details>
  </div>

  ${savebar('plug')}`

/* ============ 子页 3 · 自助规则 ============ */
const rulesHtml = `
  ${headrow('自助规则')}

  <div class="card">
    <h2><span class="bar"></span>自助规则 <span class="badge dim">员工端本机执行</span></h2>
      <div class="tablewrap">
      <table>
        <thead><tr><th style="width:120px">类型</th><th style="width:90px">动作</th><th>匹配值（value）</th><th>提示语（可选）</th><th style="width:60px"></th></tr></thead>
        <tbody id="rulesBody"></tbody>
      </table>
    </div>
    <div style="margin-top:10px"><button class="btn sm" id="ruleAddBtn">＋ 添加规则</button></div>

    <div style="margin-top:16px;padding:12px 14px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;flex-wrap:wrap;gap:8px">
        <span style="font-size:13px;font-weight:600">横幅样式（员工端提醒/拦截/公告弹出的默认样式）</span>
        <button class="btn sm" id="bannerPreview" type="button">预览效果</button>
      </div>
      <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:10px">
        <span style="font-size:12.5px;color:#475569;width:52px">位置</span>
        <select id="bannerPos" class="input" style="width:140px;font-size:12px">
          <option value="top-right">右上角</option>
          <option value="top-center">顶部居中</option>
          <option value="top-left">左上角</option>
          <option value="bottom-right">右下角</option>
        </select>
        <span style="font-size:12.5px;color:#475569;width:52px;margin-left:10px">宽度</span>
        <input id="bannerW" class="input" type="number" min="240" max="1200" step="10" style="width:90px;font-size:12px" placeholder="420">
        <span style="font-size:11.5px;color:#94a3b8">px（240-1200）</span>
      </div>
      <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:10px">
        <span style="font-size:12.5px;color:#475569;width:52px">边距</span>
        <span style="font-size:11.5px;color:#94a3b8">上</span>
        <input id="bannerMt" class="input" type="number" min="0" max="400" step="2" style="width:70px;font-size:12px" placeholder="14">
        <span style="font-size:11.5px;color:#94a3b8">右</span>
        <input id="bannerMr" class="input" type="number" min="0" max="400" step="2" style="width:70px;font-size:12px" placeholder="18">
        <span style="font-size:11.5px;color:#94a3b8">下</span>
        <input id="bannerMb" class="input" type="number" min="0" max="400" step="2" style="width:70px;font-size:12px" placeholder="0">
        <span style="font-size:11.5px;color:#94a3b8">左</span>
        <input id="bannerMl" class="input" type="number" min="0" max="400" step="2" style="width:70px;font-size:12px" placeholder="0">
        <span style="font-size:11.5px;color:#94a3b8">px（0-400，距屏幕边缘）</span>
      </div>
      <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
        <span style="font-size:12.5px;color:#475569;width:52px">配色</span>
        <span style="font-size:11.5px;color:#94a3b8">背景</span>
        <input id="bannerBg" class="input" type="color" value="#fff7ed" style="width:38px;height:26px;padding:0;border:1px solid #e2e8f0;border-radius:6px;cursor:pointer">
        <span style="font-size:11.5px;color:#94a3b8;margin-left:6px">边框</span>
        <input id="bannerBd" class="input" type="color" value="#fb923c" style="width:38px;height:26px;padding:0;border:1px solid #e2e8f0;border-radius:6px;cursor:pointer">
        <span style="font-size:11.5px;color:#94a3b8;margin-left:6px">文字</span>
        <input id="bannerFg" class="input" type="color" value="#9a3412" style="width:38px;height:26px;padding:0;border:1px solid #e2e8f0;border-radius:6px;cursor:pointer">
      </div>
      <div id="bannerMsg" style="font-size:12px;color:#059669;margin-top:8px"></div>
    </div>
    <details class="help">
      <summary>三种类型的 value 填法</summary>
      <div class="help-body">
        <div class="codeblock"><span class="hl">block-url</span>  填域名 → 拦该域名及全部子域。例：<span class="hl">github.com</span> 拦 github.com / gist.github.com / api.github.com …
<span class="hl">block-word</span> 填正则（不区分大小写）→ 命中员工端送出的文本。例：<span class="hl">内部机密|未公开财报</span>；正则非法时自动退化为包含匹配
<span class="hl">notice</span>     填公告文本 → 员工端展示企业公告，value 即公告内容，message 可留空</div>
        <div class="notebox">block-url 只拦「员工端浏览器环境内」的访问判定；员工用自己浏览器直接上网不在此管控范围。员工端可在「设置 → 企业管理 → 规则管理」看到这些规则及命中次数统计（只读）。与「安全防护」页的网关级检查分工：自助规则在员工电脑本地执行、轻量低延迟，适合拦网址/拦关键词/弹公告这类确定性强的轻管控。</div>
      </div>
    </details>
  </div>

  ${savebar('rules')}`

/* ============ 子页 4 · 下发回执 ============ */
const acksHtml = `
  ${headrow('下发回执', `
    <span class="crumb" style="margin:0">当前策略版本 <span class="mono" id="ackCurVer">—</span></span>
    <button class="btn sm" id="ackRefreshBtn">↻ 刷新</button>
  `)}

  <!-- ============ 灰度进度 ============ -->
  <div class="card">
    <h2><span class="bar"></span>灰度进度 <span class="badge dim" id="ackSummaryBadge"></span></h2>
    <div class="sub">回执由员工端插件在<b>策略落盘生效后</b>自动上报（同版本幂等，失败下轮重试）。覆盖率 = 已回执设备 ÷ 近 24 小时在线终端；关机/未装插件的终端既不在分母内也不会回执，看「待回执设备」找缺口更准。</div>
    <div class="grid4" id="ackStatCards"></div>
    <div id="ackVersionBars" style="margin-top:14px"></div>
  </div>

  <!-- ============ 待回执设备 ============ -->
  <div class="card">
    <h2><span class="bar"></span>待回执设备 <span class="badge" id="ackPendingCount"></span></h2>
    <div class="sub">近 24 小时在线、但<b>当前版本</b>还没收到回执的终端。心跳上报版本 = 当前版本 → 已生效但回执没送到（点刷新观察一轮）；否则 → 还没拉到新版（等下个策略刷新周期，通常 ≤ 1 分钟）。</div>
    <div class="tablewrap" style="max-height:300px;overflow:auto">
      <table>
        <thead><tr><th>账号</th><th>Profile</th><th>心跳上报版本</th><th>判定</th><th>环境</th><th>Node</th><th>最后心跳</th><th>设备指纹</th></tr></thead>
        <tbody id="ackPendingBody"><tr><td colspan="8" class="empty">加载中…</td></tr></tbody>
      </table>
    </div>
  </div>

  <!-- ============ 回执明细 ============ -->
  <div class="card">
    <h2><span class="bar"></span>回执明细 <span class="badge dim" id="ackCount"></span></h2>
    <div style="display:flex;gap:8px;margin:8px 0 10px;flex-wrap:wrap;align-items:center">
      <select class="input" id="ackVerFilter" style="width:auto"></select>
      <input class="input" id="ackSearch" placeholder="搜账号 / Profile / 指纹…" style="width:230px">
      <span class="crumb" style="margin:0">每 30 秒自动刷新</span>
    </div>
    <div class="tablewrap" style="max-height:420px;overflow:auto">
      <table>
        <thead><tr><th>回执时间</th><th>账号</th><th>Profile</th><th>策略版本</th><th>环境</th><th>Node</th><th>设备指纹</th><th>该设备最后心跳</th></tr></thead>
        <tbody id="ackBody"><tr><td colspan="8" class="empty">加载中…</td></tr></tbody>
      </table>
    </div>
    <details class="help">
      <summary>回执机制与字段口径</summary>
      <div class="help-body">
        <ol class="steps">
          <li>管理台保存策略 → 策略版本号变化；员工端插件下个拉取周期取到新版并在本地生效</li>
          <li>生效后员工端自动 <span class="mono">POST /policy/ack</span>（Profile + 版本 + 设备指纹），同版本幂等只报一次；上报失败会在下轮拉取时重试</li>
          <li>「灰度进度」按版本聚合回执，用来判断新策略推开了多少；「待回执设备」用心跳表反向比对找还没推到的设备</li>
        </ol>
        <div class="kv">
          <span class="k">设备指纹</span><span class="v">由员工端登录凭证派生（与「终端列表」同口径）；同一账号重新登录后指纹会变，属于正常现象</span>
          <span class="k">账号 / 环境 / Node</span><span class="v">取该设备指纹最近一次心跳补齐，设备从未发过心跳则为空</span>
          <span class="k">覆盖率口径</span><span class="v">分母 = 近 24 小时有心跳的设备数；长期关机的设备不在分母里，需要全量核对时结合「终端列表」</span>
          <span class="k">明细上限</span><span class="v">列表取最近 50 条回执；更早的看「灰度进度」的按版本聚合数</span>
        </div>
        <div class="notebox">回执是尽力而为的遥测：员工端断网时策略已经在本地生效，只是回执晚到——列表缺一条不代表该设备没更新。</div>
      </div>
    </details>
  </div>`

/* ---------- 策略加载（一次拉取，四个子页共用；只填本页存在的元素） ---------- */
async function loadAll(opts = {}) {
  const { skipRulesTable = false } = opts
  try {
    const d = await api('/admin/policy-detail')
    const p = d.policy ?? {}
    if ($('polVer')) $('polVer').textContent = p.version ?? '-'
    if ($('swLock')) $('swLock').classList.toggle('on', !!p.lockModelConfig)
    if ($('swWm')) $('swWm').classList.toggle('on', !!p.watermark)
    if ($('lpMaxFails')) {
      const lp = d.loginProtection ?? {}
      $('swLoginProt').classList.toggle('on', lp.enabled !== false)
      $('lpMaxFails').value = lp.maxFails ?? 10
      $('lpWindow').value = lp.windowMin ?? 15
      $('lpLock').value = lp.lockMin ?? 15
      syncLpExample(lp)
    }
    if ($('taPlugins')) $('taPlugins').value = (p.allowedPlugins ?? []).join('\n')
    if ($('regMode')) {
      const reg = p.pluginRegistry ?? {}
      $('regMode').value = reg.mode ?? 'off'
      $('regFallback').checked = reg.allowedFallback !== false
      $('regUrl').value = reg.npmRegistryUrl ?? ''
      $('regPrefix').value = reg.packagePrefix ?? ''
      syncRegFields()
    }
    if ($('rulesBody') && !skipRulesTable) renderClientRules(p.clientRules ?? [])
    if (!skipRulesTable) {
      if ($('bannerPos')) $('bannerPos').value = p.bannerPosition ?? 'top-right'
      const bs = p.bannerStyle ?? {}
      const setV = (id, v) => { if ($(id)) $(id).value = v ?? '' }
      setV('#bannerW', bs.maxWidth)
      setV('#bannerMt', bs.top)
      setV('#bannerMr', bs.right)
      setV('#bannerMb', bs.bottom)
      setV('#bannerMl', bs.left)
      if ($('#bannerBg')) $('#bannerBg').value = bs.bg ?? '#fff7ed'
      if ($('#bannerBd')) $('#bannerBd').value = bs.border ?? '#fb923c'
      if ($('#bannerFg')) $('#bannerFg').value = bs.color ?? '#9a3412'
    }
    if ($('ackBody')) renderAcks(d)
  } catch { /* 401 已处理 */ }
}

/* ---------- 登录保护（子页 1） ---------- */
function syncLpExample(over = {}) {
  if (!$('lpExample')) return
  const mf = over.maxFails ?? (Number($('lpMaxFails').value) || '?')
  const wm = over.windowMin ?? (Number($('lpWindow').value) || '?')
  const lm = over.lockMin ?? (Number($('lpLock').value) || '?')
  $('lpExample').textContent = mf
  const winEl = document.querySelector('.lpWin')
  const lockEl = document.querySelector('.lpLock')
  if (winEl) winEl.textContent = wm
  if (lockEl) lockEl.textContent = lm
}

function toggleLoginProt() { $('swLoginProt').classList.toggle('on') }

async function toggleLock() {
  const sw = $('swLock')
  const target = !sw.classList.contains('on')
  const r = await api('/admin/policy', { method: 'PATCH', body: JSON.stringify({ policy: { lockModelConfig: target } }) })
  sw.classList.toggle('on', r.policy.lockModelConfig)
  toast('模型配置锁定 → ' + (r.policy.lockModelConfig ? '锁定' : '放开') + '（客户端心跳后生效）')
}

async function toggleWatermark() {
  const sw = $('swWm')
  const target = !sw.classList.contains('on')
  const r = await api('/admin/policy', { method: 'PATCH', body: JSON.stringify({ policy: { watermark: target } }) })
  sw.classList.toggle('on', r.policy.watermark)
  toast('界面水印 → ' + (r.policy.watermark ? '启用' : '停用') + '（客户端心跳后生效）')
}

/* ---------- 企业插件源（子页 2） ---------- */
function syncRegFields() {
  const mode = $('regMode').value
  $('regUrl').disabled = mode !== 'proxy'
  $('regPrefix').disabled = mode !== 'url'
  const hint = $('regHint')
  if (hint) hint.textContent = mode === 'off'
    ? 'off = 不干预：员工端安装插件直接走社区 npm 源，不做任何改写'
    : mode === 'proxy'
      ? 'proxy = 员工安装插件时自动追加 --registry=' + ($('regUrl').value.trim() || '<镜像地址>') + '；需要先在企业内网部署 npm 私服（Verdaccio / Nexus 等）'
      : 'url = 员工安装时直接从 ' + ($('regPrefix').value.trim() || '<前缀>') + '<插件包名> 下载 .tgz；前缀必须以 http(s):// 或 file:// 开头'
}

/* ---------- 客户端自助规则（子页 3） ---------- */
const RULE_TYPES = [
  { v: 'block-url', label: '拦网址' },
  { v: 'block-word', label: '拦关键词' },
  { v: 'notice', label: '公告' },
]

const RULE_PRESETS = {
  'block-url': { type: 'block-url', action: 'block', value: 'pan.baidu.com', message: '网盘类站点工作时段禁止访问，如有需要请联系 IT 审批' },
  'block-word': { type: 'block-word', action: 'warn', value: '内部资料|未公开', message: '检测到可能涉密的词语，请注意外发风险' },
  'notice': { type: 'notice', action: 'block', value: '【企业公告】本周六 20:00-22:00 网关例行维护，期间服务可能中断', message: '' },
}

function renderClientRules(rules) {
  $('rulesBody').innerHTML = rules.map((r) => clientRuleRow(r)).join('')
    || '<tr><td colspan="5" class="empty">暂无自助规则 —— 点「添加规则」</td></tr>'
}

function clientRuleRow(r = {}) {
  const type = r.type ?? 'block-url'
  const filled = r.value !== undefined ? r : { ...RULE_PRESETS[type] ?? {}, type }
  return `<tr data-crule-row>
    <td><select class="cr-type">${RULE_TYPES.map((t) => `<option value="${t.v}" ${type === t.v ? 'selected' : ''}>${t.label}</option>`).join('')}</select></td>
    <td><select class="cr-action">
      <option value="block" ${filled.action !== 'warn' ? 'selected' : ''}>拦截</option>
      <option value="warn" ${filled.action === 'warn' ? 'selected' : ''}>提醒</option>
    </select></td>
    <td><input class="input cr-value mono" value="${esc(filled.value ?? '')}" style="width:100%;font-size:12px" placeholder="域名 / 正则 / 公告文本"></td>
    <td><input class="input cr-msg" value="${esc(filled.message ?? '')}" style="width:100%" placeholder="命中时的提示语（可选）"></td>
    <td><button class="btn sm danger" data-delcrule="1">删</button></td>
  </tr>`
}

function collectClientRules() {
  const rules = []
  for (const tr of document.querySelectorAll('#rulesBody tr[data-crule-row]')) {
    rules.push({
      id: 'cr-' + (rules.length + 1),
      type: tr.querySelector('.cr-type').value,
      action: tr.querySelector('.cr-action').value,
      value: tr.querySelector('.cr-value').value.trim(),
      message: tr.querySelector('.cr-msg').value.trim(),
    })
  }
  return rules
}

/* ---------- 回执（子页 4）：灰度进度 + 待回执设备 + 可筛选明细 ---------- */
let ackRows = []        // 最近回执明细（未筛选）
let ackCurVer = ''      // 当前策略版本
let ackTimer = null     // 自动刷新定时器

/** 'YYYY-MM-DD HH:MM:SS'（北京时间）→ 相对时间 */
function ago(s) {
  if (!s) return '-'
  const t = new Date(String(s).replace(' ', 'T') + '+08:00').getTime()
  if (Number.isNaN(t)) return s
  const m = Math.round((Date.now() - t) / 60000)
  if (m < 1) return '刚刚'
  if (m < 60) return `${m} 分钟前`
  if (m < 1440) return `${Math.floor(m / 60)} 小时前`
  return `${Math.floor(m / 1440)} 天前`
}

const shortDev = (h) => (h && h.length > 14 ? h.slice(0, 14) + '…' : (h || '-'))

const statTile = (lab, val, sub = '') => `
  <div style="border:1px solid var(--line);border-radius:10px;padding:11px 14px">
    <div class="stat-card"><div class="lab">${lab}</div><div class="val">${val}</div></div>
    ${sub ? `<div class="crumb" style="margin:4px 0 0">${sub}</div>` : ''}
  </div>`

function renderAcks(d) {
  if (!$('ackBody')) return
  const p = d.policy ?? {}
  ackCurVer = p.version ?? '-'
  ackRows = d.acks ?? []
  const versions = d.ackStats?.versions ?? []
  const online = d.ackStats?.onlineDevices ?? 0
  const cur = versions.find((v) => v.policy_version === ackCurVer)
  const curDevices = cur?.devices ?? 0
  const pct = online > 0 ? Math.min(100, Math.round((curDevices / online) * 100)) : null
  $('ackCurVer').textContent = ackCurVer

  /* 概览 4 卡 */
  $('ackStatCards').innerHTML =
    statTile('已回执设备 · 当前版本', curDevices, '台') +
    statTile('近 24h 在线终端', online, '台') +
    statTile('灰度覆盖率', pct === null ? '—' : pct + '%', '已回执 ÷ 在线') +
    statTile('回执版本数', versions.length, `累计明细 ${ackRows.length} 条`)
  const badge = $('ackSummaryBadge')
  if (pct === null) { badge.className = 'badge dim'; badge.textContent = '暂无在线终端可比' }
  else {
    badge.className = 'badge ' + (pct >= 80 ? 'ok' : 'warn')
    badge.textContent = `当前版本覆盖 ${pct}%`
  }

  /* 按版本聚合条 */
  $('ackVersionBars').innerHTML = versions.map((v) => {
    const isCur = v.policy_version === ackCurVer
    const vp = online > 0 ? Math.min(100, Math.round((v.devices / online) * 100)) : 0
    return `<div class="chan">
      <span class="nm"><span class="mono">${esc(v.policy_version)}</span> ${isCur ? '<span class="badge ok">当前</span>' : '<span class="badge dim">历史</span>'}</span>
      <div class="bar"><i style="width:${vp}%;background:${isCur ? 'var(--ok)' : '#94a3b8'}"></i></div>
      <span class="mono" style="white-space:nowrap;flex-shrink:0">${v.devices} 台 / ${v.acks} 条 · ${vp}%</span>
      <span class="crumb" style="margin:0;white-space:nowrap;flex-shrink:0" title="最早 ${esc(v.first_local ?? '')}">最近 ${ago(v.last_local)}</span>
    </div>`
  }).join('') || '<div class="empty">暂无任何回执 —— 员工端拉取到新版策略并本地生效后会自动上报</div>'

  /* 待回执设备 */
  const pending = d.pendingAcks ?? []
  const pc = $('ackPendingCount')
  pc.textContent = pending.length ? `${pending.length} 台待回执` : '当前版本已全部覆盖'
  pc.className = 'badge ' + (pending.length ? 'warn' : 'ok')
  $('ackPendingBody').innerHTML = pending.map((x) => {
    const got = x.hb_version === ackCurVer
    return `<tr>
      <td>${esc(x.account || '-')}</td>
      <td class="mono">${esc(x.profile || '-')}</td>
      <td class="mono">${esc(x.hb_version || '-')}</td>
      <td>${got ? '<span class="badge warn">已拉到新版 · 回执未达</span>' : '<span class="badge dim">未拉到新版</span>'}</td>
      <td class="mono">${esc(x.env || '-')}</td>
      <td class="mono">${esc(x.node_version || '-')}</td>
      <td class="mono" title="${esc(x.last_seen_local ?? '')}">${esc(x.last_seen_local ?? '-')}<span class="crumb" style="margin:0;display:block">${ago(x.last_seen_local)}</span></td>
      <td class="mono" title="${esc(x.device_hash ?? '')}">${esc(shortDev(x.device_hash))}</td>
    </tr>`
  }).join('') || '<tr><td colspan="8" class="empty">近 24 小时在线的终端都已对当前版本回执 ✓</td></tr>'

  renderAckRows()
}

function renderAckRows() {
  if (!$('ackBody')) return
  const verSel = $('ackVerFilter')
  const vf = verSel.value
  // 版本下拉：全部版本 + 计数，保留当前选中项
  const vers = [...new Set(ackRows.map((a) => a.policy_version))]
  verSel.innerHTML = `<option value="">全部版本（${vers.length}）</option>` +
    vers.map((v) => `<option value="${esc(v)}" ${v === vf ? 'selected' : ''}>${esc(v)}${v === ackCurVer ? '（当前）' : ''} · ${ackRows.filter((a) => a.policy_version === v).length} 条</option>`).join('')
  const q = $('ackSearch').value.trim().toLowerCase()
  const rows = ackRows.filter((a) =>
    (!vf || a.policy_version === vf) &&
    (!q || [a.account, a.profile, a.device_hash, a.policy_version].some((x) => String(x ?? '').toLowerCase().includes(q))))
  $('ackCount').textContent = ackRows.length ? (rows.length === ackRows.length ? `最近 ${rows.length} 条` : `${rows.length} / ${ackRows.length} 条`) : ''
  $('ackBody').innerHTML = rows.map((a) => {
    const isCur = a.policy_version === ackCurVer
    return `<tr>
      <td class="mono" title="${esc(a.ts_local ?? '')}">${esc(a.ts_local ?? '-')}<span class="crumb" style="margin:0;display:block">${ago(a.ts_local)}</span></td>
      <td>${esc(a.account || '-')}</td>
      <td class="mono">${esc(a.profile || '-')}</td>
      <td><span class="mono">${esc(a.policy_version || '-')}</span> ${isCur ? '<span class="badge ok">当前</span>' : ''}</td>
      <td class="mono">${esc(a.env || '-')}</td>
      <td class="mono">${esc(a.node_version || '-')}</td>
      <td class="mono" title="${esc(a.device_hash ?? '')}">${esc(shortDev(a.device_hash))}</td>
      <td class="mono" title="${esc(a.last_seen_local ?? '')}">${esc(a.last_seen_local ?? '-')}</td>
    </tr>`
  }).join('') || `<tr><td colspan="8" class="empty">${ackRows.length ? '没有匹配筛选条件的回执' : '暂无回执 —— 等员工端生效新版策略后自动上报'}</td></tr>`
}

function bindAcks() {
  if (!$('ackBody')) return
  $('ackRefreshBtn')?.addEventListener('click', () => { loadAll() })
  $('ackSearch')?.addEventListener('input', renderAckRows)
  $('ackVerFilter')?.addEventListener('change', renderAckRows)
  clearInterval(ackTimer) // 壳重复 bind 时防叠加
  ackTimer = setInterval(() => {
    if (document.hidden) return
    const page = document.getElementById('page-client-acks')
    if (page && page.hidden) return
    loadAll({ skipRulesTable: true })
  }, 30000)
}

/* ---------- 保存（每个子页各管各的段，互不覆盖） ---------- */
function showSaveErr(msgEl, text) {
  if (msgEl) msgEl.textContent = text
  if (text) toast('✗ ' + text, 'bad')
}

async function doSave(msgEl, patch, okMsg) {
  try {
    await api('/admin/policy', { method: 'PATCH', body: JSON.stringify(patch) })
    if (msgEl) msgEl.textContent = ''
    toast(okMsg)
    loadAll()
  } catch (e) { if (e.message !== '401') showSaveErr(msgEl, e.message) }
}

async function saveLp() {
  const msg = $('lpMsg'); if (msg) msg.textContent = ''
  const num = (id) => Number($(id).value)
  for (const id of ['lpMaxFails', 'lpWindow', 'lpLock']) {
    if (!Number.isInteger(num(id)) || num(id) < 1 || num(id) > 1440) return showSaveErr(msg, '登录保护参数须为 1-1440 的整数')
  }
  await doSave(msg, {
    loginProtection: {
      enabled: $('swLoginProt').classList.contains('on'),
      maxFails: num('lpMaxFails'),
      windowMin: num('lpWindow'),
      lockMin: num('lpLock'),
    },
  }, '已保存：登录保护')
}

async function savePlug() {
  const msg = $('plugMsg'); if (msg) msg.textContent = ''
  const allowedPlugins = $('taPlugins').value.split('\n').map((s) => s.trim()).filter(Boolean)
  const pluginRegistry = {
    mode: $('regMode').value,
    npmRegistryUrl: $('regUrl').value.trim(),
    packagePrefix: $('regPrefix').value.trim(),
    allowedFallback: $('regFallback').checked,
  }
  if (pluginRegistry.mode === 'proxy' && !pluginRegistry.npmRegistryUrl) return showSaveErr(msg, 'proxy 模式需要填写 NPM 镜像地址')
  if (pluginRegistry.mode === 'url' && !pluginRegistry.packagePrefix) return showSaveErr(msg, 'url 模式需要填写包地址前缀')
  await doSave(msg, { policy: { allowedPlugins, pluginRegistry } },
    `已保存：插件清单 ${allowedPlugins.length} 项 · 插件源 ${pluginRegistry.mode}`)
}

async function saveRules() {
  const msg = $('rulesMsg'); if (msg) msg.textContent = ''
  const rules = collectClientRules()
  for (const r of rules) {
    if (!r.value) return showSaveErr(msg, '自助规则有缺匹配值（value）的行')
    if (r.type === 'block-word') { try { new RegExp(r.value) } catch { return showSaveErr(msg, `关键词规则「${r.value}」正则不合法（会退化为包含匹配，建议修正）`) } }
  }
  const numOrNull = (id) => { const el = $(id); if (!el || el.value === '') return null; const n = Number(el.value); return Number.isFinite(n) ? n : null }
  const bannerStyle = {}
  for (const [k, id] of [['maxWidth', '#bannerW'], ['top', '#bannerMt'], ['right', '#bannerMr'], ['bottom', '#bannerMb'], ['left', '#bannerMl']]) {
    const v = numOrNull(id); if (v !== null) bannerStyle[k] = v
  }
  for (const [k, id] of [['bg', '#bannerBg'], ['border', '#bannerBd'], ['color', '#bannerFg']]) {
    const el = $(id); if (el && el.value) bannerStyle[k] = el.value
  }
  const bannerPosition = $('bannerPos') ? $('bannerPos').value : undefined
  await doSave(msg, { policy: { clientRules: rules, bannerPosition, bannerStyle: Object.keys(bannerStyle).length ? bannerStyle : null } },
    `已保存：自助规则 ${rules.length} 条 · 横幅 ${bannerPosition}`)
}

/* ---------- 各子页事件绑定（元素存在才绑，兼容老壳单页回退） ---------- */
function bindSwitches() {
  if ($('swLock')) $('swLock').addEventListener('click', toggleLock)
  if ($('swWm')) $('swWm').addEventListener('click', toggleWatermark)
  if ($('swLoginProt')) $('swLoginProt').addEventListener('click', toggleLoginProt)
  for (const id of ['lpMaxFails', 'lpWindow', 'lpLock']) {
    if ($(id)) $(id).addEventListener('input', () => syncLpExample())
  }
  if ($('lpSaveBtn')) $('lpSaveBtn').addEventListener('click', saveLp)
}

function bindPlugins() {
  if ($('regMode')) {
    $('regMode').addEventListener('change', syncRegFields)
    $('regUrl').addEventListener('input', syncRegFields)
    $('regPrefix').addEventListener('input', syncRegFields)
  }
  if ($('plugSaveBtn')) $('plugSaveBtn').addEventListener('click', savePlug)
}

function bindRules() {
  if ($('ruleAddBtn')) {
    $('ruleAddBtn').addEventListener('click', () => {
      const empty = $('rulesBody').querySelector('td.empty')?.closest('tr')
      if (empty) empty.remove()
      // 取当前表格里已选类型的"下一个"类型轮转，避免连点全是同一种示例
      const lastType = document.querySelector('#rulesBody tr[data-crule-row] .cr-type')?.value ?? 'block-url'
      const order = ['block-url', 'block-word', 'notice']
      const next = order[(order.indexOf(lastType) + 1) % order.length]
      $('rulesBody').insertAdjacentHTML('beforeend', clientRuleRow(RULE_PRESETS[next]))
    })
    $('rulesBody').addEventListener('click', (e) => {
      const del = e.target.closest('[data-delcrule]')
      if (del) del.closest('tr').remove()
    })
  }
  if ($('rulesSaveBtn')) $('rulesSaveBtn').addEventListener('click', saveRules)

  if ($('bannerPreview')) $('bannerPreview').addEventListener('click', () => {
    const bs = {
      position: $('bannerPos')?.value ?? 'top-right',
      maxWidth: Number($('bannerW')?.value) || 420,
      top: Number($('bannerMt')?.value) || 14,
      right: Number($('bannerMr')?.value) || 18,
      bottom: Number($('bannerMb')?.value) || 0,
      left: Number($('bannerMl')?.value) || 0,
      bg: $('#bannerBg')?.value || '#fff7ed',
      border: $('#bannerBd')?.value || '#fb923c',
      color: $('#bannerFg')?.value || '#9a3412',
    }
    const posCss = bs.position === 'top-center' ? `top:${bs.top}px;left:50%;transform:translateX(-50%);`
      : bs.position === 'top-left' ? `top:${bs.top}px;left:${bs.left}px;`
        : bs.position === 'bottom-right' ? `bottom:${bs.bottom || 14}px;right:${bs.right}px;`
          : `top:${bs.top}px;right:${bs.right}px;`
    const w = window.open('', '_blank', 'width=760,height=420')
    if (!w) return
    w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>横幅样式预览</title></head>
      <body style="margin:0;background:#eef1f6;font-family:system-ui">
        <div style="${posCss}position:fixed;max-width:${bs.maxWidth}px;padding:11px 40px 11px 16px;border-radius:10px;background:${bs.bg};border:1.5px solid ${bs.border};box-shadow:0 10px 34px rgba(0,0,0,.16);font-size:13.5px;line-height:1.55;color:${bs.color};display:flex;align-items:flex-start;gap:8px">
          <span style="font-size:16px;flex-shrink:0">⚠️</span>
          <span style="word-break:break-word">样式预览：检测到关键词 <b>示例</b>，请注意外发风险（宽 ${bs.maxWidth}px）</span>
        </div>
        <div style="padding:16px;color:#94a3b8;font-size:12px">预览窗口 —— 保存后员工端下一次弹出即生效。</div>
      </body></html>`)
    w.document.close()
  })
}

/* ---------- 壳契约导出 ---------- */
const pages = {
  'client-switches': { html: switchesHtml, load: loadAll, bind: bindSwitches },
  'client-plugins': { html: pluginsHtml, load: loadAll, bind: bindPlugins },
  'client-rules': { html: rulesHtml, load: loadAll, bind: bindRules },
  'client-acks': { html: acksHtml, load: loadAll, bind: bindAcks },
}

export default {
  page: 'ent-client',
  // 兼容老壳（不识别 nav.children）：单页回退 = 第一个子页
  html: pages['client-switches'].html,
  async load() { await loadAll() },
  bind() { bindSwitches(); bindPlugins(); bindRules(); bindAcks() },
  pages,
}

