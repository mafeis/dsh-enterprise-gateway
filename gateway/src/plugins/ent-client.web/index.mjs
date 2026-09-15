/**
 * 插件页面 · 客户端管控（原壳 views/pages/client.html + policy.mjs 客户端段）
 * 数据源：/admin/policy* /admin/policy-detail（ent-console 聚合提供）
 */
import { api, $, toast, esc } from '/admin/static/contract.mjs'

export default {
  page: 'ent-client',
  html: `
  <div class="headrow" data-ent-page="ent-client">
    <div><h1>客户端管控</h1></div>
    <div class="sp"></div>
    <span class="crumb" style="margin:0">策略版本 <span class="mono" id="polVer">—</span></span>
  </div>

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

  <!-- ============ 插件管控 ============ -->
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

  <!-- ============ 客户端自助规则 ============ -->
  <div class="card">
    <h2><span class="bar"></span>自助规则 <span class="badge dim">员工端本机执行</span></h2>
      <div class="tablewrap">
      <table>
        <thead><tr><th style="width:120px">类型</th><th style="width:90px">动作</th><th>匹配值（value）</th><th>提示语（可选）</th><th style="width:60px"></th></tr></thead>
        <tbody id="rulesBody"></tbody>
      </table>
    </div>
    <div style="margin-top:10px"><button class="btn sm" id="ruleAddBtn">＋ 添加规则</button></div>
    <details class="help">
      <summary>三种类型的 value 填法</summary>
      <div class="help-body">
        <div class="codeblock"><span class="hl">block-url</span>  填域名 → 拦该域名及全部子域。例：<span class="hl">github.com</span> 拦 github.com / gist.github.com / api.github.com …
<span class="hl">block-word</span> 填正则（不区分大小写）→ 命中员工端送出的文本。例：<span class="hl">内部机密|未公开财报</span>；正则非法时自动退化为包含匹配
<span class="hl">notice</span>     填公告文本 → 员工端展示企业公告，value 即公告内容，message 可留空</div>
        <div class="notebox">block-url 只拦「员工端浏览器环境内」的访问判定；员工用自己浏览器直接上网不在此管控范围。员工端可在「设置 → 企业管理 → 规则管理」看到这些规则及命中次数统计（只读）。</div>
      </div>
    </details>
  </div>

  <!-- ============ 下发回执 ============ -->
  <div class="card">
    <h2><span class="bar"></span>下发回执 <span class="badge dim" id="ackCount"></span></h2>
      <div class="tablewrap" style="max-height:360px;overflow:auto">
      <table>
        <thead><tr><th>时间</th><th>Profile</th><th>策略版本</th><th>设备指纹</th></tr></thead>
        <tbody id="ackBody"><tr><td colspan="4" class="empty">加载中…</td></tr></tbody>
      </table>
    </div>
    <div class="kv">
      <span class="k">灰度参考</span><span class="v">统计回执中不同版本号的数量，即新策略覆盖的设备数</span>
    </div>
  </div>

  <!-- 统一保存条 -->
  <div class="savebar" id="clientSavebar">
    <span class="savebar-msg" id="clientMsg"></span>
    <button class="btn primary" id="clientSaveBtn">保存更改</button>
  </div>`,
  async load() { await loadClientPolicy() },
  bind() { bindClientPage() },
}

/* ---------- 策略加载（只填本页元素） ---------- */
async function loadClientPolicy() {
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
    if ($('rulesBody')) renderClientRules(p.clientRules ?? [])
    if ($('ackBody')) renderAcks(d.acks ?? [])
  } catch { /* 401 已处理 */ }
}

/* ---------- 登录保护 ---------- */
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

/* ---------- 企业插件源 ---------- */
function syncRegFields() {
  const mode = $('regMode').value
  $('regUrl').disabled = mode !== 'proxy'
  $('regPrefix').disabled = mode !== 'url'
  $('regHint').textContent = mode === 'off'
    ? 'off = 不干预：员工端安装插件直接走社区 npm 源，不做任何改写'
    : mode === 'proxy'
      ? 'proxy = 员工安装插件时自动追加 --registry=' + ($('regUrl').value.trim() || '<镜像地址>') + '；需要先在企业内网部署 npm 私服（Verdaccio / Nexus 等）'
      : 'url = 员工安装时直接从 ' + ($('regPrefix').value.trim() || '<前缀>') + '<插件包名> 下载 .tgz；前缀必须以 http(s):// 或 file:// 开头'
}

/* ---------- 客户端自助规则 ---------- */
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

/* ---------- 回执 ---------- */
function renderAcks(acks) {
  $('ackCount').textContent = acks.length ? `最近 ${acks.length}` : ''
  $('ackBody').innerHTML = acks.map((a) =>
    `<tr><td class="mono">${esc(a.ts_local ?? '')}</td><td>${esc(a.profile ?? '-')}</td><td class="mono">${esc(a.policy_version ?? '-')}</td><td class="mono">${esc(a.device_hash ?? '-')}</td></tr>`
  ).join('') || '<tr><td colspan="4" class="empty">暂无回执</td></tr>'
}

/* ---------- 页面级统一保存：登录保护 + 插件 + 自助规则 ---------- */
function showSaveErr(msgEl, text) {
  if (msgEl) msgEl.textContent = text
  if (text) toast('✗ ' + text, 'bad')
}

async function saveClientAll() {
  const msg = $('clientMsg'); if (msg) msg.textContent = ''
  const patch = { policy: {} }
  if ($('lpMaxFails')) {
    const num = (id) => Number($(id).value)
    for (const id of ['lpMaxFails', 'lpWindow', 'lpLock']) {
      if (!Number.isInteger(num(id)) || num(id) < 1 || num(id) > 1440) return showSaveErr(msg, '登录保护参数须为 1-1440 的整数')
    }
    patch.loginProtection = {
      enabled: $('swLoginProt').classList.contains('on'),
      maxFails: num('lpMaxFails'),
      windowMin: num('lpWindow'),
      lockMin: num('lpLock'),
    }
  }
  if ($('taPlugins')) {
    patch.policy.allowedPlugins = $('taPlugins').value.split('\n').map((s) => s.trim()).filter(Boolean)
  }
  if ($('regMode')) {
    patch.policy.pluginRegistry = {
      mode: $('regMode').value,
      npmRegistryUrl: $('regUrl').value.trim(),
      packagePrefix: $('regPrefix').value.trim(),
      allowedFallback: $('regFallback').checked,
    }
  }
  if ($('rulesBody')) {
    const rules = collectClientRules()
    for (const r of rules) {
      if (!r.value) return showSaveErr(msg, '自助规则有缺匹配值（value）的行')
      if (r.type === 'block-word') { try { new RegExp(r.value) } catch { return showSaveErr(msg, `关键词规则「${r.value}」正则不合法（会退化为包含匹配，建议修正）`) } }
    }
    patch.policy.clientRules = rules
  }
  if (!Object.keys(patch.policy).length && !patch.loginProtection) return
  try {
    await api('/admin/policy', { method: 'PATCH', body: JSON.stringify(patch) })
    if (msg) msg.textContent = ''
    const parts = []
    if (patch.loginProtection) parts.push('登录保护')
    if (patch.policy.allowedPlugins) parts.push(`插件清单 ${patch.policy.allowedPlugins.length} 项`)
    if (patch.policy.pluginRegistry) parts.push(`插件源 ${patch.policy.pluginRegistry.mode}`)
    if (patch.policy.clientRules) parts.push(`自助规则 ${patch.policy.clientRules.length} 条`)
    toast('已保存：' + parts.join(' · '))
    loadClientPolicy()
  } catch (e) { if (e.message !== '401') showSaveErr(msg, e.message) }
}

/* ---------- 事件绑定（模块级防重入） ---------- */
let bound = false
function bindClientPage() {
  if (bound) return
  bound = true
  if ($('swLock')) $('swLock').addEventListener('click', toggleLock)
  if ($('swWm')) $('swWm').addEventListener('click', toggleWatermark)
  if ($('swLoginProt')) $('swLoginProt').addEventListener('click', toggleLoginProt)
  if ($('regMode')) {
    $('regMode').addEventListener('change', syncRegFields)
    $('regUrl').addEventListener('input', syncRegFields)
    $('regPrefix').addEventListener('input', syncRegFields)
  }
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
  if ($('clientSaveBtn')) $('clientSaveBtn').addEventListener('click', saveClientAll)
  for (const id of ['lpMaxFails', 'lpWindow', 'lpLock']) {
    if ($(id)) $(id).addEventListener('input', () => syncLpExample())
  }
}
