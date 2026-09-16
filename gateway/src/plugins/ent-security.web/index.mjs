/**
 * 插件页面 · 安全防护（原壳 views/pages/security.html + policy.mjs 安全段 + anchor.mjs）
 * 数据源：/admin/policy* /admin/verify-anchor /admin/seal-anchor /admin/purge（ent-console 聚合提供）
 */
import { api, $, toast, esc } from '/admin/static/contract.mjs'
import { T } from '/admin/static/js/i18n.mjs';

export default {
  page: 'ent-security',
  html: `
  <div class="headrow" data-ent-page="ent-security">
    <div><h1>${T('安全防护','Security')}</h1></div>
    <div class="sp"></div>
  </div>

  <!-- ============ DLP 数据防泄漏 ============ -->
  <div class="card">
    <h2><span class="bar"></span>${T('DLP 内容检测','DLP content detection')} <span class="badge dim" id="dlpCount"></span></h2>
    <div class="switchrow">
      <span class="lab2">${T('DLP 引擎','DLP engine')}<span class="desc">${T('总开关：关闭后全部规则停用（规则保留，重开即恢复）','Master switch: off disables all rules (kept, restored on re-enable)')}</span></span>
      <span class="switch" id="swDlp"></span>
    </div>
    <div class="tablewrap" style="max-height:340px;overflow:auto;margin-top:10px">
      <table>
        <thead><tr><th>ID</th><th>${T('名称','Name')}</th><th>${T('正则（JS RegExp）','Pattern (JS RegExp)')}</th><th>${T('动作','Action')}</th><th></th></tr></thead>
        <tbody id="dlpBody"></tbody>
      </table>
    </div>
    <div class="editor-foot">
      <button class="btn" id="dlpAddBtn">${T('＋ 加规则','＋ Add rule')}</button>
      <span class="dim2">${T('自带常见示例','Common presets included')}</span>
    </div>
    <details class="help">
      <summary>${T('动作怎么选 & 正则写法示例','Actions & regex examples')}</summary>
      <div class="help-body">
        <div class="kv">
          <span class="k">${T('mask 脱敏','mask (redact)')}</span><span class="v">${T('命中部分替换为「█」后<b>放行</b> —— 对话不中断，敏感内容不外泄；留痕里存的也是脱敏版','Matched text replaced with █ then <b>allowed</b> — chat continues, sensitive content stays in, logs keep the redacted version')}</span>
          <span class="k">${T('block 拦截','block')}</span><span class="v">${T('整条请求<b>直接拒绝</b>（HTTP 422），员工端收到「内容被企业安全策略拦截」—— 适合绝不允许外发的内容','Whole request <b>rejected</b> (HTTP 422) with a policy-blocked message on the client — for content that must never leave')}</span>
          <span class="k">${T('log 记录','log')}</span><span class="v">${T('放行但留痕里<b>记录命中详情</b> —— 观察期用：先看频率，再决定升 mask 还是 block','Allowed but <b>hit details logged</b> — for observation: check frequency first, then move to mask or block')}</span>
          <span class="k">${T('建议节奏','Suggested flow')}</span><span class="v">${T('新规则先用 <b>log</b> 跑几天看误报 → 确认后改 <b>mask</b> → 高危内容才用 <b>block</b>','Run new rules with <b>log</b> for a few days to check false positives → switch to <b>mask</b> → reserve <b>block</b> for high-risk content')}</span>
        </div>
        <div class="codeblock"><span class="cmt">// ${T('正则写法示例（JS RegExp 语法，不需要包裹斜杠）','Regex examples (JS RegExp, no surrounding slashes)')}</span>
sk-[A-Za-z0-9_-]{20,}        <span class="cmt">// ${T('API 密钥形态','API key pattern')}</span>
\\b1[3-9]\\d{9}\\b              <span class="cmt">// ${T('中国大陆手机号','Mainland China phone number')}</span>
\\b\\d{16,19}\\b                <span class="cmt">// ${T('银行卡号（16-19 位数字）','Bank card number (16-19 digits)')}</span>
内部资料|未公开财报            <span class="cmt">// ${T('中文关键词交替','Chinese keyword alternation')}</span></div>
        <div class="notebox">${T('与「客户端管控 → 自助规则」分工：本页在网关执行、可脱敏；自助规则在员工电脑本地执行、适合拦网址/关键词。','Split with Client control → Self-service rules: this page runs on the gateway and can redact; self-service rules run on client devices, best for URLs and keywords')}</div>
      </div>
    </details>
  </div>

  <!-- ============ 审计留存 ============ -->
  <div class="card">
    <h2><span class="bar"></span>${T('审计留存','Audit retention')}</h2>
      <div class="switchrow">
      <span class="lab2">${T('留痕正文存储','Store log content')}<span class="desc">${T('关闭 = 仅存元数据与哈希（metadata_only），详情弹窗不显示正文','Off = metadata and hash only (metadata_only); detail dialog shows no content')}</span></span>
      <span class="switch" id="swAudit"></span>
    </div>
    <div class="fgrid" style="margin-top:10px">
      <label>${T('留痕保留天数','Log retention (days)')}</label><input class="input" id="cfgRetention" type="number" min="1">
      <label>${T('正文截断上限（字符）','Content truncation (chars)')}</label><input class="input" id="cfgMaxChars" type="number" min="1000">
      <label>${T('账号活动窗口（天）','Activity window (days)')}</label><input class="input" id="cfgActDays" type="number" min="1" max="90">
      <label>${T('登录历史条数','Sign-in history rows')}</label><input class="input" id="cfgActLogins" type="number" min="1" max="200">
      <label>${T('设备清单条数','Device list rows')}</label><input class="input" id="cfgActDevices" type="number" min="1" max="200">
      <label>${T('用量分组数','Usage groups')}</label><input class="input" id="cfgActUsage" type="number" min="1" max="200">
    </div>
    <div class="editor-foot">
      <button class="btn" id="purgeBtn">${T('立即清理过期留痕','Purge expired logs now')}</button>
      <span class="dim2">${T('每天 00:05 也会自动清理','Also auto-purged daily at 00:05')}</span>
    </div>
    <details class="help">
      <summary>${T('各参数含义','What each parameter means')}</summary>
      <div class="help-body">
        <div class="kv">
          <span class="k">${T('全量（full）','full')}</span><span class="v">${T('每条请求存<b>完整上下文</b>（按 DLP 策略脱敏后）+ 上游响应 —— 可在「审计留痕」页回看任意一次对话','Stores <b>full context</b> (DLP-redacted) + upstream response per request — review any chat on the Audit logs page')}</span>
          <span class="k">${T('仅元数据','metadata only')}</span><span class="v">${T('只存谁、什么时候、用了哪个模型、多少 token、是否被拦截，<b>不存任何对话内容</b> —— 合规要求"只审计不碰内容"时用','Stores who, when, model, token count, block status — <b>no chat content</b>, for audit-without-content compliance')}</span>
          <span class="k">${T('保留天数','Retention days')}</span><span class="v">${T('合规有最低保留要求就调大，如 180','Raise if compliance sets a minimum, e.g. 180')}</span>
          <span class="k">${T('正文截断上限','Content truncation')}</span><span class="v">${T('控制单条留痕体积；32000 字符约等于 2 万字对话','Caps each log entry; 32000 chars ≈ 20k characters of chat')}</span>
          <span class="k">${T('活动窗口 / 条数','Activity window / rows')}</span><span class="v">${T('只影响「用户管理 → 账号活动」详情弹窗的展示范围（不删数据）','Only affects the display range in Users → Account activity (no data deleted)')}</span>
        </div>
      </div>
    </details>
  </div>

  <!-- ============ 防篡改锚 ============ -->
  <div class="card">
    <h2><span class="bar"></span>${T('防篡改锚','Tamper protection anchor')} <span class="badge" id="anchorBadge"></span></h2>
      <div class="kv" style="font-size:13px">
      <div class="lab" style="color:var(--dim)">${T('今日封存状态','Today seal status')}</div><div id="anchorDay">—</div>
      <div class="lab" style="color:var(--dim)">${T('Merkle 根','Merkle root')}</div><div class="mono" id="anchorRoot">—</div>
      <div class="lab" style="color:var(--dim)">${T('记录数','Records')}</div><div id="anchorCount">—</div>
    </div>
    <div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap;align-items:center">
      <button class="btn" id="anchorVerifyBtn">${T('↻ 校验今日完整性','↻ Verify today')}</button>
      <button class="btn" id="anchorSealBtn">${T('封存今日锚','Seal anchor for today')}</button>
      <input class="input" id="anchorDaySel" type="date" style="width:150px">
      <button class="btn" id="anchorHistBtn">${T('校验历史某日','Verify a past day')}</button>
    </div>
    <div id="anchorMsg" style="margin-top:8px;font-size:12.5px"></div>
    <details class="help">
      <summary>${T('这是什么 & 适用场景','What it is & when to use')}</summary>
      <div class="help-body">
        <div class="kv">
          <span class="k">${T('适用场景','When to use')}</span><span class="v">${T('等保/审计合规要求"日志不可抵赖"；劳动争议或安全事件取证时，证明留痕自封存后未被篡改','Compliance requires non-repudiable logs; proves logs were not altered after sealing, for disputes or incident forensics')}</span>
          <span class="k">${T('校验逻辑','How verification works')}</span><span class="v">${T('取当日留痕重算 Merkle 根与封存值比对：<b>一致</b> = 数据完好；<b>不一致</b> = 有记录被改或被删','Recomputes the Merkle root and compares with the seal: <b>match</b> = intact; <b>mismatch</b> = records altered or deleted')}</span>
          <span class="k">${T('局限','Limits')}</span><span class="v">${T('锚只防「封存之后」的篡改；当天 23:59 前发生的删除会被次日锚的记录数差异间接暴露','The anchor only covers tampering after sealing; same-day deletions surface as a count gap in the next-day anchor')}</span>
          <span class="k">${T('建议节奏','Suggested flow')}</span><span class="v">${T('平时不用管（自动封存）；需要出证明时「校验历史某日」选目标日期，截图存档','No action needed (auto-seal); to produce proof, verify a past day and keep a screenshot')}</span>
        </div>
      </div>
    </details>
  </div>

  <!-- 统一保存条 -->
  <div class="savebar" id="securitySavebar">
    <span class="savebar-msg" id="securityMsg"></span>
    <button class="btn primary" id="securitySaveBtn">${T('保存更改','Save changes')}</button>
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
    { id: 'wechat', label: T('微信 ChattID','WeChat ChatID'), pattern: 'wxid_[A-Za-z0-9_-]{8,}', action: 'mask' },
    { id: 'email', label: T('邮箱地址','Email address'), pattern: '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}', action: 'mask' },
    { id: 'internal-ip', label: T('内网 IP','Private IP'), pattern: '\\b(?:10|172\\.(?:1[6-9]|2\\d|3[01])|192\\.168)\\.\\d{1,3}\\.\\d{1,3}\\b', action: 'mask' },
    { id: 'secret-word', label: T('涉密词拦截','Sensitive word block'), pattern: '绝密|机密|内部资料', action: 'block' },
    { id: 'api-token', label: T('Bearer 令牌','Bearer token'), pattern: 'Bearer\\s+[A-Za-z0-9._-]{20,}', action: 'block' },
  ]
  return presets.find((p) => !existing.has(p.id)) ?? { id: '', label: '', pattern: '', action: 'mask' }
}

function renderDlpRules(rules) {
  $('dlpCount').textContent = T('{n} 条', '{n} rules', { n: rules.length })
  $('dlpBody').innerHTML = rules.map((r) => ruleRow(r)).join('')
    || `<tr><td colspan="5" class="empty">${T('暂无规则 —— 引擎开着也没有可执行的规则','No rules — the engine has nothing to run')}</td></tr>`
}

function ruleRow(r = {}) {
  const action = r.action ?? 'mask'
  return `<tr data-rule-row>
    <td><input class="input r-id" value="${esc(r.id ?? '')}" style="width:92px" placeholder="id"></td>
    <td><input class="input r-label" value="${esc(r.label ?? '')}" style="width:104px" placeholder="${T('名称','Name')}"></td>
    <td><input class="input r-pattern mono" value="${esc(r.pattern ?? '')}" style="width:100%;font-size:12px" placeholder="${T('正则，如 sk-[A-Za-z0-9_-]{20,}','Regex, e.g. sk-[A-Za-z0-9_-]{20,}')}"></td>
    <td><select class="r-action">
      <option value="mask" ${action === 'mask' ? 'selected' : ''}>${T('mask 脱敏','mask (redact)')}</option>
      <option value="block" ${action === 'block' ? 'selected' : ''}>${T('block 拦截','block')}</option>
      <option value="log" ${action === 'log' ? 'selected' : ''}>${T('log 记录','log')}</option>
    </select></td>
    <td><button class="btn sm danger" data-delrule="1">${T('删','Delete')}</button></td>
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
      $('anchorBadge').innerHTML = `<span class="badge ok">${T('✓ 完整','✓ Intact')}</span>`
      $('anchorDay').innerHTML = `<span class="anchor-ok">${T('已封存 · 哈希链校验一致','Sealed · hash chain verified')}</span>`
      $('anchorRoot').textContent = v.expected?.slice(0, 24) + '…'
      $('anchorCount').textContent = T('{n} 条', '{n} records', { n: v.count })
    } else {
      $('anchorBadge').innerHTML = `<span class="badge warn">${T('今日未封存','Not sealed today')}</span>`
      $('anchorDay').innerHTML = T('今日留痕尚未封存（每日 23:59 自动 / 手动触发）','Today logs not sealed yet (auto daily 23:59 / manual)')
      $('anchorRoot').textContent = '—'; $('anchorCount').textContent = '—'
    }
    if (!silent && v.ok) toast(T('完整性校验通过：哈希链一致','Integrity verified: hash chain matches'))
    if (!silent && v.reason) toast(v.reason === 'no-anchor' ? T('今日尚未封存','Not sealed today') : v.reason)
  } catch { /* 401 已处理 */ }
}

async function sealAnchor() {
  try {
    const r = await api('/admin/seal-anchor', { method: 'POST' })
    if (r.sealed) { toast(T('已封存 {n} 条 · root={r}','Sealed {n} records · root={r}', { n: r.count, r: r.root.slice(0, 12) + '…' })); verifyAnchor(true) }
    else toast(r.reason === 'already-sealed' ? T('今日已封存','Already sealed today') : T('暂无留痕可封存','No logs to seal'))
  } catch { /* 401 已处理 */ }
}

async function verifyAnchorDay() {
  const day = $('anchorDaySel').value
  if (!day) return toast(T('先选择要校验的日期','Select a date first'), 'bad')
  const msg = $('anchorMsg')
  try {
    const v = await api('/admin/verify-anchor?day=' + encodeURIComponent(day))
    if (v.ok) {
      msg.innerHTML = `<span class="badge ok">✓ ${esc(day)} ${T('完整','intact')}</span> ${T('{n} 条', '{n} records', { n: v.count })} · root=${esc(v.expected?.slice(0, 16))}…`
      toast(T('{d} 哈希链校验一致', '{d} hash chain matches', { d: day }))
    } else if (v.reason === 'no-anchor') {
      msg.innerHTML = `<span class="badge warn">${T('{d} 未封存', '{d} not sealed', { d: esc(day) })}</span>`
      toast(T('{d} 尚未封存锚', '{d} not sealed yet', { d: day }))
    } else {
      msg.innerHTML = `<span class="badge bad">✗ ${esc(day)} ${T('校验失败','failed')}</span> ${T('期望 {e}，实际 {a}', 'expected {e}, actual {a}', { e: esc(v.expected?.slice(0, 16)) + '…', a: esc(v.actual?.slice(0, 16)) + '…' })}`
      toast(T('{d} 完整性校验不通过！留痕可能被篡改', '{d} integrity check failed: logs may be tampered', { d: day }), 'bad')
    }
  } catch { /* 401 已处理 */ }
}

/* ---------- 开关（点击即生效） ---------- */
async function toggleAudit() {
  const sw = $('swAudit')
  const target = sw.classList.contains('on') ? 'metadata_only' : 'full'
  const r = await api('/admin/policy', { method: 'PATCH', body: JSON.stringify({ audit: { level: target } }) })
  sw.classList.toggle('on', r.audit.level === 'full')
  toast(T('留痕级别 → {v}（即时生效，已落盘）','Log level → {v} (effective now, saved)', { v: r.audit.level }))
}

async function toggleDlp() {
  const sw = $('swDlp')
  const target = !sw.classList.contains('on')
  const r = await api('/admin/policy', { method: 'PATCH', body: JSON.stringify({ dlp: { enabled: target } }) })
  sw.classList.toggle('on', r.dlp.enabled)
  toast(T('DLP 引擎 → {v}（即时生效，已落盘）','DLP engine → {v} (effective now, saved)', { v: r.dlp.enabled ? T('启用','enabled') : T('停用','disabled') }))
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
      if (!r.id) { return showSaveErr(msg, T('DLP 规则有缺 ID 的行','A DLP rule is missing an ID')) }
      if (seen.has(r.id)) { return showSaveErr(msg, T('DLP 规则 ID 重复: {id}','Duplicate DLP rule ID: {id}', { id: r.id })) }
      seen.add(r.id)
      try { new RegExp(r.pattern) } catch { return showSaveErr(msg, T('DLP 规则 {id} 正则不合法','DLP rule {id} has an invalid regex', { id: r.id })) }
    }
    patch.dlp = { rules }
  }
  if ($('cfgRetention')) {
    const num = (id) => Number($(id).value)
    for (const [id, min] of [['cfgRetention', 1], ['cfgMaxChars', 1000], ['cfgActDays', 1], ['cfgActLogins', 1], ['cfgActDevices', 1], ['cfgActUsage', 1]]) {
      if (!Number.isInteger(num(id)) || num(id) < min) return showSaveErr(msg, T('留存参数有非法值（须为 ≥{min} 的整数）','Invalid retention value (must be an integer ≥ {min})', { min }))
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
    toast(T('安全防护配置已保存（即时生效并落盘）','Security settings saved (effective now)'))
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
      toast(T('已清理 >{d} 天：留痕 {l} / 心跳 {h} / 登录 {a} 条','Purged >{d} days: logs {l} / heartbeats {h} / sign-ins {a}', { d: r.days, l: r.logs, h: r.heartbeats, a: r.authLogs }))
    } catch (e) { if (e.message !== '401') toast('✗ ' + e.message, 'bad') }
  })
  if ($('anchorVerifyBtn')) $('anchorVerifyBtn').addEventListener('click', () => verifyAnchor(false))
  if ($('anchorSealBtn')) $('anchorSealBtn').addEventListener('click', sealAnchor)
  if ($('anchorHistBtn')) $('anchorHistBtn').addEventListener('click', verifyAnchorDay)
  if ($('securitySaveBtn')) $('securitySaveBtn').addEventListener('click', saveSecurityAll)
}
