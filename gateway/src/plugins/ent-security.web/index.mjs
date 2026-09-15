/**
 * 插件页面 · 安全防护（原壳 views/pages/security.html + policy.mjs 安全段 + anchor.mjs）
 * 数据源：/admin/policy* /admin/verify-anchor /admin/seal-anchor /admin/purge（ent-console 聚合提供）
 */
import { api, $, toast, esc } from '/admin/static/contract.mjs'

export default {
  page: 'ent-security',
  html: `
  <div class="headrow" data-ent-page="ent-security">
    <div><h1>安全防护</h1></div>
    <div class="sp"></div>
  </div>

  <!-- ============ DLP 数据防泄漏 ============ -->
  <div class="card">
    <h2><span class="bar"></span>DLP 内容检测 <span class="badge dim" id="dlpCount"></span></h2>
    <div class="switchrow">
      <span class="lab2">DLP 引擎<span class="desc">总开关：关闭后全部规则停用（规则保留，重开即恢复）</span></span>
      <span class="switch" id="swDlp"></span>
    </div>
    <div class="tablewrap" style="max-height:340px;overflow:auto;margin-top:10px">
      <table>
        <thead><tr><th>ID</th><th>名称</th><th>正则（JS RegExp）</th><th>动作</th><th></th></tr></thead>
        <tbody id="dlpBody"></tbody>
      </table>
    </div>
    <div class="editor-foot">
      <button class="btn" id="dlpAddBtn">＋ 加规则</button>
      <span class="dim2">自带常见示例</span>
    </div>
    <details class="help">
      <summary>动作怎么选 & 正则写法示例</summary>
      <div class="help-body">
        <div class="kv">
          <span class="k">mask 脱敏</span><span class="v">命中部分替换为「█」后<b>放行</b> —— 对话不中断，敏感内容不外泄；留痕里存的也是脱敏版</span>
          <span class="k">block 拦截</span><span class="v">整条请求<b>直接拒绝</b>（HTTP 422），员工端收到「内容被企业安全策略拦截」—— 适合绝不允许外发的内容</span>
          <span class="k">log 记录</span><span class="v">放行但留痕里<b>记录命中详情</b> —— 观察期用：先看频率，再决定升 mask 还是 block</span>
          <span class="k">建议节奏</span><span class="v">新规则先用 <b>log</b> 跑几天看误报 → 确认后改 <b>mask</b> → 高危内容才用 <b>block</b></span>
        </div>
        <div class="codeblock"><span class="cmt">// 正则写法示例（JS RegExp 语法，不需要包裹斜杠）</span>
sk-[A-Za-z0-9_-]{20,}        <span class="cmt">// API 密钥形态</span>
\\b1[3-9]\\d{9}\\b              <span class="cmt">// 中国大陆手机号</span>
\\b\\d{16,19}\\b                <span class="cmt">// 银行卡号（16-19 位数字）</span>
内部资料|未公开财报            <span class="cmt">// 中文关键词交替</span></div>
        <div class="notebox">与「客户端管控 → 自助规则」分工：本页在网关执行、可脱敏；自助规则在员工电脑本地执行、适合拦网址/关键词。</div>
      </div>
    </details>
  </div>

  <!-- ============ 审计留存 ============ -->
  <div class="card">
    <h2><span class="bar"></span>审计留存</h2>
      <div class="switchrow">
      <span class="lab2">留痕正文存储<span class="desc">关闭 = 仅存元数据与哈希（metadata_only），详情弹窗不显示正文</span></span>
      <span class="switch" id="swAudit"></span>
    </div>
    <div class="fgrid" style="margin-top:10px">
      <label>留痕保留天数</label><input class="input" id="cfgRetention" type="number" min="1">
      <label>正文截断上限（字符）</label><input class="input" id="cfgMaxChars" type="number" min="1000">
      <label>账号活动窗口（天）</label><input class="input" id="cfgActDays" type="number" min="1" max="90">
      <label>登录历史条数</label><input class="input" id="cfgActLogins" type="number" min="1" max="200">
      <label>设备清单条数</label><input class="input" id="cfgActDevices" type="number" min="1" max="200">
      <label>用量分组数</label><input class="input" id="cfgActUsage" type="number" min="1" max="200">
    </div>
    <div class="editor-foot">
      <button class="btn" id="purgeBtn">立即清理过期留痕</button>
      <span class="dim2">每天 00:05 也会自动清理</span>
    </div>
    <details class="help">
      <summary>各参数含义</summary>
      <div class="help-body">
        <div class="kv">
          <span class="k">全量（full）</span><span class="v">每条请求存<b>完整上下文</b>（按 DLP 策略脱敏后）+ 上游响应 —— 可在「审计留痕」页回看任意一次对话</span>
          <span class="k">仅元数据</span><span class="v">只存谁、什么时候、用了哪个模型、多少 token、是否被拦截，<b>不存任何对话内容</b> —— 合规要求"只审计不碰内容"时用</span>
          <span class="k">保留天数</span><span class="v">合规有最低保留要求就调大，如 180</span>
          <span class="k">正文截断上限</span><span class="v">控制单条留痕体积；32000 字符约等于 2 万字对话</span>
          <span class="k">活动窗口 / 条数</span><span class="v">只影响「用户管理 → 账号活动」详情弹窗的展示范围（不删数据）</span>
        </div>
      </div>
    </details>
  </div>

  <!-- ============ 防篡改锚 ============ -->
  <div class="card">
    <h2><span class="bar"></span>防篡改锚 <span class="badge" id="anchorBadge"></span></h2>
      <div class="kv" style="font-size:13px">
      <div class="lab" style="color:var(--dim)">今日封存状态</div><div id="anchorDay">—</div>
      <div class="lab" style="color:var(--dim)">Merkle 根</div><div class="mono" id="anchorRoot">—</div>
      <div class="lab" style="color:var(--dim)">记录数</div><div id="anchorCount">—</div>
    </div>
    <div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap;align-items:center">
      <button class="btn" id="anchorVerifyBtn">↻ 校验今日完整性</button>
      <button class="btn" id="anchorSealBtn">封存今日锚</button>
      <input class="input" id="anchorDaySel" type="date" style="width:150px">
      <button class="btn" id="anchorHistBtn">校验历史某日</button>
    </div>
    <div id="anchorMsg" style="margin-top:8px;font-size:12.5px"></div>
    <details class="help">
      <summary>这是什么 & 适用场景</summary>
      <div class="help-body">
        <div class="kv">
          <span class="k">适用场景</span><span class="v">等保/审计合规要求"日志不可抵赖"；劳动争议或安全事件取证时，证明留痕自封存后未被篡改</span>
          <span class="k">校验逻辑</span><span class="v">取当日留痕重算 Merkle 根与封存值比对：<b>一致</b> = 数据完好；<b>不一致</b> = 有记录被改或被删</span>
          <span class="k">局限</span><span class="v">锚只防「封存之后」的篡改；当天 23:59 前发生的删除会被次日锚的记录数差异间接暴露</span>
          <span class="k">建议节奏</span><span class="v">平时不用管（自动封存）；需要出证明时「校验历史某日」选目标日期，截图存档</span>
        </div>
      </div>
    </details>
  </div>

  <!-- 统一保存条 -->
  <div class="savebar" id="securitySavebar">
    <span class="savebar-msg" id="securityMsg"></span>
    <button class="btn primary" id="securitySaveBtn">保存更改</button>
  </div>`,
  async load() {
    await Promise.all([loadPolicy(), loadAnchor()])
  },
  bind() { bindSecurityPage() },
}

/* ---------- 策略加载（只填本页元素；数据同源一次拉全） ---------- */
async function loadPolicy() {
  try {
    const d = await api('/admin/policy-detail')
    if ($('swAudit')) $('swAudit').classList.toggle('on', (d.audit?.level ?? 'full') !== 'metadata_only')
    if ($('swDlp')) $('swDlp').classList.toggle('on', d.dlp?.enabled !== false)
    if ($('dlpBody')) renderDlpRules(d.dlp?.rules ?? [])
    if ($('cfgRetention')) {
      $('cfgRetention').value = d.audit?.retentionDays ?? 90
      $('cfgMaxChars').value = d.audit?.maxContentChars ?? 32000
      $('cfgActDays').value = d.audit?.activityDays ?? 7
      $('cfgActLogins').value = d.audit?.activityLogins ?? 20
      $('cfgActDevices').value = d.audit?.activityDevices ?? 20
      $('cfgActUsage').value = d.audit?.activityUsage ?? 20
    }
  } catch { /* 401 已处理 */ }
}

/* ---------- DLP 规则编辑 ---------- */
function nextDlpPreset() {
  const existing = new Set(collectDlpRules().map((r) => r.id))
  const presets = [
    { id: 'wechat', label: '微信 ChattID', pattern: 'wxid_[A-Za-z0-9_-]{8,}', action: 'mask' },
    { id: 'email', label: '邮箱地址', pattern: '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}', action: 'mask' },
    { id: 'internal-ip', label: '内网 IP', pattern: '\\b(?:10|172\\.(?:1[6-9]|2\\d|3[01])|192\\.168)\\.\\d{1,3}\\.\\d{1,3}\\b', action: 'mask' },
    { id: 'secret-word', label: '涉密词拦截', pattern: '绝密|机密|内部资料', action: 'block' },
    { id: 'api-token', label: 'Bearer 令牌', pattern: 'Bearer\\s+[A-Za-z0-9._-]{20,}', action: 'block' },
  ]
  return presets.find((p) => !existing.has(p.id)) ?? { id: '', label: '', pattern: '', action: 'mask' }
}

function renderDlpRules(rules) {
  $('dlpCount').textContent = rules.length + ' 条'
  $('dlpBody').innerHTML = rules.map((r) => ruleRow(r)).join('')
    || '<tr><td colspan="5" class="empty">暂无规则 —— 引擎开着也没有可执行的规则</td></tr>'
}

function ruleRow(r = {}) {
  const action = r.action ?? 'mask'
  return `<tr data-rule-row>
    <td><input class="input r-id" value="${esc(r.id ?? '')}" style="width:92px" placeholder="id"></td>
    <td><input class="input r-label" value="${esc(r.label ?? '')}" style="width:104px" placeholder="名称"></td>
    <td><input class="input r-pattern mono" value="${esc(r.pattern ?? '')}" style="width:100%;font-size:12px" placeholder="正则，如 sk-[A-Za-z0-9_-]{20,}"></td>
    <td><select class="r-action">
      <option value="mask" ${action === 'mask' ? 'selected' : ''}>mask 脱敏</option>
      <option value="block" ${action === 'block' ? 'selected' : ''}>block 拦截</option>
      <option value="log" ${action === 'log' ? 'selected' : ''}>log 记录</option>
    </select></td>
    <td><button class="btn sm danger" data-delrule="1">删</button></td>
  </tr>`
}

function collectDlpRules() {
  const rules = []
  for (const tr of document.querySelectorAll('#dlpBody tr[data-rule-row]')) {
    rules.push({
      id: tr.querySelector('.r-id').value.trim(),
      label: tr.querySelector('.r-label').value.trim(),
      pattern: tr.querySelector('.r-pattern').value,
      action: tr.querySelector('.r-action').value,
    })
  }
  return rules
}

/* ---------- 防篡改锚（原 anchor.mjs） ---------- */
async function loadAnchor() {
  const sel = $('anchorDaySel')
  if (sel && !sel.value) sel.value = new Date().toLocaleDateString('sv-SE')
  await verifyAnchor(true)
}

async function verifyAnchor(silent = false) {
  try {
    const v = await api('/admin/verify-anchor')
    if (v.ok === true) {
      $('anchorBadge').innerHTML = '<span class="badge ok">✓ 完整</span>'
      $('anchorDay').innerHTML = '<span class="anchor-ok">已封存 · 哈希链校验一致</span>'
      $('anchorRoot').textContent = v.expected?.slice(0, 24) + '…'
      $('anchorCount').textContent = v.count + ' 条'
    } else {
      $('anchorBadge').innerHTML = '<span class="badge warn">今日未封存</span>'
      $('anchorDay').innerHTML = '今日留痕尚未封存（每日 23:59 自动 / 手动触发）'
      $('anchorRoot').textContent = '—'; $('anchorCount').textContent = '—'
    }
    if (!silent && v.ok) toast('完整性校验通过：哈希链一致')
    if (!silent && v.reason) toast(v.reason === 'no-anchor' ? '今日尚未封存' : v.reason)
  } catch { /* 401 已处理 */ }
}

async function sealAnchor() {
  try {
    const r = await api('/admin/seal-anchor', { method: 'POST' })
    if (r.sealed) { toast(`已封存 ${r.count} 条 · root=${r.root.slice(0, 12)}…`); verifyAnchor(true) }
    else toast(r.reason === 'already-sealed' ? '今日已封存' : '暂无留痕可封存')
  } catch { /* 401 已处理 */ }
}

async function verifyAnchorDay() {
  const day = $('anchorDaySel').value
  if (!day) return toast('先选择要校验的日期', 'bad')
  const msg = $('anchorMsg')
  try {
    const v = await api('/admin/verify-anchor?day=' + encodeURIComponent(day))
    if (v.ok) {
      msg.innerHTML = `<span class="badge ok">✓ ${esc(day)} 完整</span> ${v.count} 条 · root=${esc(v.expected?.slice(0, 16))}…`
      toast(`${day} 哈希链校验一致`)
    } else if (v.reason === 'no-anchor') {
      msg.innerHTML = `<span class="badge warn">${esc(day)} 未封存</span>`
      toast(`${day} 尚未封存锚`)
    } else {
      msg.innerHTML = `<span class="badge bad">✗ ${esc(day)} 校验失败</span> 期望 ${esc(v.expected?.slice(0, 16))}… 实际 ${esc(v.actual?.slice(0, 16))}…`
      toast(`${day} 完整性校验不通过！留痕可能被篡改`, 'bad')
    }
  } catch { /* 401 已处理 */ }
}

/* ---------- 开关（点击即生效） ---------- */
async function toggleAudit() {
  const sw = $('swAudit')
  const target = sw.classList.contains('on') ? 'metadata_only' : 'full'
  const r = await api('/admin/policy', { method: 'PATCH', body: JSON.stringify({ audit: { level: target } }) })
  sw.classList.toggle('on', r.audit.level === 'full')
  toast('留痕级别 → ' + r.audit.level + '（即时生效，已落盘）')
}

async function toggleDlp() {
  const sw = $('swDlp')
  const target = !sw.classList.contains('on')
  const r = await api('/admin/policy', { method: 'PATCH', body: JSON.stringify({ dlp: { enabled: target } }) })
  sw.classList.toggle('on', r.dlp.enabled)
  toast('DLP 引擎 → ' + (r.dlp.enabled ? '启用' : '停用') + '（即时生效，已落盘）')
}

/* ---------- 页面级统一保存：DLP 规则 + 留存参数 ---------- */
function showSaveErr(msgEl, text) {
  if (msgEl) msgEl.textContent = text
  if (text) toast('✗ ' + text, 'bad')
}

async function saveSecurityAll() {
  const msg = $('securityMsg'); if (msg) msg.textContent = ''
  const patch = {}
  if ($('dlpBody')) {
    const rules = collectDlpRules()
    const seen = new Set()
    for (const r of rules) {
      if (!r.id) { return showSaveErr(msg, 'DLP 规则有缺 ID 的行') }
      if (seen.has(r.id)) { return showSaveErr(msg, `DLP 规则 ID 重复: ${r.id}`) }
      seen.add(r.id)
      try { new RegExp(r.pattern) } catch { return showSaveErr(msg, `DLP 规则 ${r.id} 正则不合法`) }
    }
    patch.dlp = { rules }
  }
  if ($('cfgRetention')) {
    const num = (id) => Number($(id).value)
    for (const [id, min] of [['cfgRetention', 1], ['cfgMaxChars', 1000], ['cfgActDays', 1], ['cfgActLogins', 1], ['cfgActDevices', 1], ['cfgActUsage', 1]]) {
      if (!Number.isInteger(num(id)) || num(id) < min) return showSaveErr(msg, `留存参数有非法值（须为 ≥${min} 的整数）`)
    }
    patch.audit = {
      retentionDays: num('cfgRetention'),
      maxContentChars: num('cfgMaxChars'),
      activityDays: num('cfgActDays'),
      activityLogins: num('cfgActLogins'),
      activityDevices: num('cfgActDevices'),
      activityUsage: num('cfgActUsage'),
    }
  }
  if (!Object.keys(patch).length) return
  try {
    await api('/admin/policy', { method: 'PATCH', body: JSON.stringify(patch) })
    if (msg) msg.textContent = ''
    toast('安全防护配置已保存（即时生效并落盘）')
    loadPolicy()
  } catch (e) { if (e.message !== '401') showSaveErr(msg, e.message) }
}

/* ---------- 事件绑定（模块级防重入） ---------- */
let bound = false
function bindSecurityPage() {
  if (bound) return
  bound = true
  if ($('swDlp')) $('swDlp').addEventListener('click', toggleDlp)
  if ($('swAudit')) $('swAudit').addEventListener('click', toggleAudit)
  if ($('dlpAddBtn')) {
    $('dlpAddBtn').addEventListener('click', () => {
      const empty = $('dlpBody').querySelector('td.empty')?.closest('tr')
      if (empty) empty.remove()
      $('dlpBody').insertAdjacentHTML('beforeend', ruleRow(nextDlpPreset()))
    })
    $('dlpBody').addEventListener('click', (e) => {
      const del = e.target.closest('[data-delrule]')
      if (del) del.closest('tr').remove()
    })
  }
  if ($('purgeBtn')) $('purgeBtn').addEventListener('click', async () => {
    try {
      const r = await api('/admin/purge', { method: 'POST' })
      toast(`已清理 >${r.days} 天：留痕 ${r.logs} / 心跳 ${r.heartbeats} / 登录 ${r.authLogs} 条`)
    } catch (e) { if (e.message !== '401') toast('✗ ' + e.message, 'bad') }
  })
  if ($('anchorVerifyBtn')) $('anchorVerifyBtn').addEventListener('click', () => verifyAnchor(false))
  if ($('anchorSealBtn')) $('anchorSealBtn').addEventListener('click', sealAnchor)
  if ($('anchorHistBtn')) $('anchorHistBtn').addEventListener('click', verifyAnchorDay)
  if ($('securitySaveBtn')) $('securitySaveBtn').addEventListener('click', saveSecurityAll)
}
