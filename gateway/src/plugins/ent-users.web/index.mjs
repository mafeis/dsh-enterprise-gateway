/**
 * 插件页面 · 用户管理
 * 数据源：/admin/users*（ent-users 域插件）+ /admin/stats（ent-console，取 7 日活跃）
 * 页面归本插件所有
 */
import { api, $, toast, esc, confirmDlg, icon, openDlg, closeDlg } from '/admin/static/contract.mjs'
import { T } from '/admin/static/js/i18n.mjs';

let pwdTargetId = null

/** 头像底色：按用户名哈希从固定调色板取色（同一用户恒定同色，与供应商头像同套） */
const AVATAR_COLORS = ['#2563eb', '#059669', '#7c3aed', '#d97706', '#0891b2', '#db2777', '#4f46e5', '#16a34a']
function avatarColor(id) {
  let h = 0
  for (let i = 0; i < String(id).length; i++) h = (h * 31 + String(id).charCodeAt(i)) | 0
  return AVATAR_COLORS[Math.abs(h) % AVATAR_COLORS.length]
}

function fmtBytes(n) {
  if (!n && n !== 0) return '-'
  if (n >= 1e9) return (n / 1e9).toFixed(2) + ' B(10⁹)'
  if (n >= 1e6) return (n / 1e6).toFixed(1) + ' M'
  if (n >= 1e3) return (n / 1e3).toFixed(1) + ' K'
  return String(n)
}

export default {
  page: 'ent-users',
  html: `
  <div class="headrow" data-ent-page="ent-users">
    <div><h1>${T('用户管理','Users')}</h1></div>
  </div>

  <div class="kpirow">
    <div class="kpi"><div class="lab">${T('账号总数','Total accounts')}</div><div class="val" id="kpiTotal">–</div></div>
    <div class="kpi"><div class="lab">${T('启用中','Enabled')}</div><div class="val" id="kpiEnabled">–</div></div>
    <div class="kpi"><div class="lab">${T('管理员','Admins')}</div><div class="val" id="kpiAdmin">–</div></div>
    <div class="kpi"><div class="lab">${T('近 7 日活跃','Active in 7 days')}</div><div class="val" id="kpiActive">–</div><div class="sub2" id="kpiActiveSub"></div></div>
  </div>

  <div class="card">
    <h2><span class="bar"></span>${T('账号列表','Accounts')} <span class="badge dim" id="userCount"></span>
      <span style="flex:1"></span>
      <button class="btn primary" id="openCreateBtn">${T('＋ 新增账号','＋ New account')}</button>
    </h2>
  
    <div style="display:flex;align-items:center;gap:8px;margin:12px 0 10px">
      <input class="input" id="userSearch" placeholder="${T('搜索用户名 / 展示名…（Esc 清空）','Search username / display name… (Esc clears)')}" style="width:240px" autocomplete="off">
      <span class="dim2" id="userFilterHint" style="font-size:12px"></span>
    </div>
    <div id="userList"><div class="empty">${T('加载中…','Loading…')}</div></div>
  </div>

  <!-- 新增账号弹窗（dlg lg 档） -->
  <div class="dlg-mask" id="nuModal" hidden>
    <div class="dlg lg" role="dialog" aria-modal="true">
      <div class="dlg-head">
        <h3><span class="bar"></span>${T('新增账号','New account')}</h3>
        <button class="dlg-x" data-dlg-close title="${T('关闭 (Esc)','Close (Esc)')}">${icon('x', { size: 16 })}</button>
      </div>
      <div class="dlg-body">
        <div class="mrow two">
          <div class="mfield">
            <label>${T('用户名','Username')} <i>*</i></label>
            <input class="input" id="nuName" placeholder="${T('账号，如 0356','Account ID, e.g. 0356')}" autocomplete="off">
          </div>
          <div class="mfield">
            <label>${T('展示名','Display name')}</label>
            <input class="input" id="nuDisp" placeholder="${T('张三','Zhang San')}" autocomplete="off">
          </div>
        </div>
        <div class="mfield">
          <label>${T('部门路径','Department path')}</label>
          <input class="input" id="nuOrg" placeholder="${T('/产品部/研发组','/Product/Dev')}" autocomplete="off">
        </div>
        <div class="mfield">
          <label>${T('初始密码','Initial password')} <i>*</i></label>
          <div class="prow">
            <input class="input" id="nuPass" placeholder="${T('≥ 8 位','≥ 8 chars')}" autocomplete="new-password" style="flex:1">
            <button class="btn sm" id="nuGenBtn" type="button">${T('随机生成','Generate')}</button>
          </div>
        </div>
        <div class="mfield">
          <label>${T('角色权限','Role')}</label>
          <div class="role-cards">
            <label class="role-card">
              <input type="radio" name="nuRole" value="user" checked>
              <span class="rc-txt"><b>${T('普通用户','User')}</b><span>${T('只对话、看自助用量','Chat and view own usage')}</span></span>
            </label>
            <label class="role-card">
              <input type="radio" name="nuRole" value="admin">
              <span class="rc-txt"><b>${T('管理员','Admin')}</b><span>${T('可进管理台，管理全部配置','Access admin console, manage all settings')}</span></span>
            </label>
          </div>
        </div>
      </div>
      <div class="dlg-foot">
        <span class="err" id="nuErr"></span>
        <button class="btn" data-dlg-close>${T('取消','Cancel')}</button>
        <button class="btn primary" id="createUserBtn">${T('创建账号','Create account')}</button>
      </div>
    </div>
  </div>

  <div class="dlg-mask" id="pwdModal" hidden>
    <div class="dlg sm" role="dialog" aria-modal="true">
      <div class="dlg-head">
        <h3><span class="bar"></span>${T('重置密码','Reset password')} <span class="mono" id="pwdUser"></span></h3>
        <button class="dlg-x" data-dlg-close title="${T('关闭 (Esc)','Close (Esc)')}">${icon('x', { size: 16 })}</button>
      </div>
      <div class="dlg-body">
        <div class="mfield">
          <label>${T('新密码','New password')} <i>*</i></label>
          <div class="prow">
            <input class="input" id="pwdNew" placeholder="${T('≥ 8 位','≥ 8 chars')}" autocomplete="new-password" style="flex:1">
            <button class="btn sm" id="pwdGenBtn" type="button">${T('随机生成','Generate')}</button>
          </div>
        </div>
      </div>
      <div class="dlg-foot">
        <span class="err" id="pwdErr"></span>
        <button class="btn" data-dlg-close>${T('取消','Cancel')}</button>
        <button class="btn primary" id="pwdConfirmBtn">${T('确认重置','Confirm reset')}</button>
      </div>
    </div>
  </div>`,
  async load() { await loadUsers() },
  bind() { bindUsersPage() },
}

/* ---------- 数据：账号 + 7 日活跃合并 ---------- */
let cachedUsers = []
let cachedUsage = new Map()   // username -> { requests, tokens }

async function loadUsers() {
  try {
    const [r, stats] = await Promise.all([api('/admin/users'), api('/admin/stats').catch(() => null)])
    cachedUsers = r.users ?? []
    cachedUsage = new Map((stats?.byUser ?? []).map((u) => [u.user_name, u]))
    renderKpis()
    renderUsers()
  } catch { /* 401 已处理 */ }
}

function renderKpis() {
  const total = cachedUsers.length
  const enabled = cachedUsers.filter((u) => u.enabled).length
  const admins = cachedUsers.filter((u) => u.role === 'admin').length
  const active = [...cachedUsage.keys()].filter((name) => cachedUsers.some((u) => u.username === name)).length
  $('kpiTotal').textContent = total
  $('kpiEnabled').textContent = enabled
  $('kpiAdmin').textContent = admins
  $('kpiActive').textContent = active
  $('kpiActiveSub').textContent = active ? T('近 7 日有调用','Active in last 7 days') : T('近 7 日无调用','No calls in 7 days')
}

function matchUser(u, q) {
  if (!q) return true
  return (u.username + ' ' + (u.display_name ?? '')).toLowerCase().includes(q)
}

function renderUsers() {
  const q = ($('userSearch')?.value ?? '').trim().toLowerCase()
  const shown = cachedUsers.filter((u) => matchUser(u, q))
  $('userCount').textContent = T('共 {n} 个账号', '{n} accounts', { n: cachedUsers.length })
  $('userFilterHint').textContent = q ? T('匹配 {a}/{b} 个', '{a}/{b} matched', { a: shown.length, b: cachedUsers.length }) : ''
  if (!shown.length) {
    $('userList').innerHTML = `<div class="empty">${q ? T('没有匹配的用户','No matching users') : T('暂无账号，用上方表单创建第一个','No accounts yet — create one above')}</div>`
    return
  }
  $('userList').innerHTML = shown.map((u) => {
    const usage = cachedUsage.get(u.username)
    const usageTxt = usage
      ? T('近 7 日 <b>{n}</b> 次调用 · {t} tokens', '<b>{n}</b> calls in 7 days · {t} tokens', { n: usage.requests, t: fmtBytes(usage.tokens) })
      : T('近 7 日无调用', 'No calls in 7 days')
    const display = u.display_name && u.display_name !== u.username
      ? `<span class="dim2">${esc(u.display_name)}</span>` : ''
    return `<div class="user-item ${u.enabled ? '' : 'off'}">
      <div class="user-avatar" style="background:${avatarColor(u.username)}">${esc(u.username.trim().charAt(0).toUpperCase())}</div>
      <div class="user-main">
        <div class="user-title">
          <b>${esc(u.username)}</b>${display}
          <span class="badge ${u.role === 'admin' ? 'warn' : 'dim'}">${u.role === 'admin' ? T('admin · 管理员','admin · Admin') : T('user · 用户','user · User')}</span>
          ${u.enabled ? `<span class="badge ok">${T('启用','Enabled')}</span>` : `<span class="badge bad">${T('停用','Disabled')}</span>`}
        </div>
        <div class="user-meta">
          <span>${T('部门','Dept')} <span class="mono">${esc(u.org_path ?? '/')}</span></span>
          <span>${T('创建于','Created')} ${esc((u.created_at ?? '').slice(0, 10))}</span>
          <span>${usageTxt}</span>
        </div>
      </div>
      <div class="user-ops">
        <button class="btn sm primary" data-activity="${esc(u.username)}">${T('活动','Activity')}</button>
        <button class="btn sm" data-pwd="${u.id}" data-name="${esc(u.username)}">${T('改密','Change password')}</button>
        ${u.username !== 'admin' ? `<button class="btn sm" data-toggle="${u.id}" data-to="${u.enabled ? 0 : 1}">${u.enabled ? T('停用','Disable') : T('启用','Enable')}</button>` : ''}
        ${u.username !== 'admin' ? `<button class="btn sm danger" data-del="${u.id}" data-name="${esc(u.username)}">${T('删除','Delete')}</button>` : ''}
      </div>
    </div>`
  }).join('')
}

/* ============ 账号活动详情弹层 ============ */

function kv(label, value) {
  return `<div class="kv-row"><span class="kv-label">${esc(label)}</span><span class="kv-value">${esc(value ?? '-')}</span></div>`
}

function deviceLine(d) {
  const dev = d.device ?? {}
  const parts = [dev.platform, dev.cpuModel ? `${dev.cpuModel}×${dev.cpuCores}` : null, dev.memTotalGb ? `${dev.memTotalGb}GB` : null].filter(Boolean)
  return parts.length ? parts.join(' · ') : '-'
}

function sparkline(series) {
  if (!series || series.length < 2) return `<div class="kv-empty">${T('暂无内存采样数据（设备需在线产生心跳）','No memory samples (device must be online to send heartbeat)')}</div>`
  const vals = series.map((p) => p.v).filter((v) => v != null)
  if (!vals.length) return `<div class="kv-empty">${T('暂无内存采样','No memory samples')}</div>`
  const min = Math.min(...vals), max = Math.max(...vals)
  const range = max - min || 1
  const W = 440, H = 60, n = series.length
  const pts = series.map((p, i) => {
    const x = (i / (n - 1)) * (W - 8) + 4
    const y = H - 6 - ((p.v - min) / range) * (H - 14)
    return `${x.toFixed(1)},${y.toFixed(1)}`
  }).join(' ')
  return `
    <svg viewBox="0 0 ${W} ${H}" class="spark">
      <polyline points="${pts}" fill="none" stroke="#2563eb" stroke-width="1.6"/>
    </svg>
    <div class="spark-cap">${T('空闲内存 {a} ~ {b} GB · {n} 个采样点（近 24h）','Free memory {a} ~ {b} GB · {n} samples (24h)', { a: min.toFixed(1), b: max.toFixed(1), n: series.length })}</div>`
}

async function openUserModal(username) {
  let m = document.getElementById('userModal')
  if (!m) { m = document.createElement('div'); m.id = 'userModal'; m.className = 'dlg-mask'; document.body.appendChild(m) }
  m.innerHTML = `<div class="dlg md" role="dialog" aria-modal="true">
    <div class="dlg-head">
      <h2>${T('账号详情','Account details')} · ${esc(username)}</h2>
      <button class="dlg-x" data-dlg-close title="${T('关闭 (Esc)','Close (Esc)')}">${icon('x', { size: 16 })}</button>
    </div>
    <div class="dlg-body" style="text-align:center;color:#6b7280">${T('加载中…','Loading…')}</div>
  </div>`
  openDlg(m)
  try {
    const a = await api(`/admin/users/${encodeURIComponent(username)}/activity`)
    const s = a.stats ?? {}
    const loginRows = (a.logins ?? []).map((l) =>
      `<tr><td class="mono">${esc(l.ts_local)}</td><td>${l.ok ? `<span class="badge ok">${T('成功','Success')}</span>` : `<span class="badge bad">${T('失败','Failed')}</span>`}</td><td class="mono">${esc(l.ip ?? '-')}</td></tr>`
    ).join('') || `<tr><td colspan="3" class="empty">${T('暂无登录记录','No sign-in records')}</td></tr>`
    const devRows = (a.devices ?? []).map((d) =>
      `<tr><td class="mono">${esc(d.device_hash?.slice(0, 10))}…</td><td>${esc(d.device?.hostname || '-')}</td><td>${esc(deviceLine(d))}</td><td>${esc(d.device?.ips?.join('、') ?? '-')}</td><td class="mono">${esc(d.ts_local)}</td></tr>`
    ).join('') || `<tr><td colspan="5" class="empty">${T('近 7 日无设备心跳','No device heartbeat in 7 days')}</td></tr>`
    const usageRows = (a.usage ?? []).map((u) =>
      `<tr><td>${esc(u.model)}</td><td class="num">${u.requests}</td><td class="num">${fmtBytes(u.tokens_in + u.tokens_out)}</td><td class="mono">${esc(u.last_use)}</td></tr>`
    ).join('') || `<tr><td colspan="4" class="empty">${T('近 7 日无调用记录','No usage records in 7 days')}</td></tr>`
    m.innerHTML = `
      <div class="dlg wide" role="dialog" aria-modal="true">
        <div class="dlg-head">
          <h2>${T('账号详情','Account details')} · ${esc(username)}</h2>
          <span style="display:flex;gap:8px;flex-shrink:0">
            <button class="btn sm" data-actset title="${T('设置登录历史/心跳等默认显示条数','Default rows for sign-in history / heartbeat')}">⚙ ${T('显示设置','Display settings')}</button>
            <button class="dlg-x" data-dlg-close title="${T('关闭 (Esc)','Close (Esc)')}">${icon('x', { size: 16 })}</button>
          </span>
        </div>
        <div class="dlg-body">
          ${a.limits ? `<div style="font-size:12px;color:#94a3b8;margin-bottom:6px">${T('展示窗口：近 {d} 天 · 登录历史 {l} 条 / 心跳设备 {v} 台 / 用量分组 {u} 个（点右上「⚙ 显示设置」可调整）','Window: last {d} days · {l} sign-ins / {v} heartbeat devices / {u} usage groups (adjust via ⚙ Display settings)', { d: esc(a.limits.days), l: esc(a.limits.logins), v: esc(a.limits.devices), u: esc(a.limits.usage) })}</div>` : ''}
          <div class="user-kpis">
            <div class="kpi"><div class="lab">${T('近7日请求','Requests (7d)')}</div><div class="val">${s.totalRequests ?? 0}</div></div>
            <div class="kpi"><div class="lab">${T('近7日 Token','Tokens (7d)')}</div><div class="val">${fmtBytes(s.totalTokens)}</div></div>
            <div class="kpi"><div class="lab">${T('活跃设备','Active devices')}</div><div class="val">${s.deviceCount ?? 0}</div></div>
            <div class="kpi"><div class="lab">${T('最近登录','Last sign-in')}</div><div class="val" style="font-size:13px">${esc(s.lastLogin ?? '-')}</div></div>
          </div>
          <div class="detail-sub">${T('登录历史（含失败尝试）','Sign-in history (incl. failures)')}</div>
          <table><thead><tr><th>${T('时间','Time')}</th><th>${T('结果','Result')}</th><th>${T('来源 IP','Source IP')}</th></tr></thead><tbody>${loginRows}</tbody></table>
          <div class="detail-sub">${T('登录设备（近 7 日心跳）','Sign-in devices (7-day heartbeat)')}</div>
          <table><thead><tr><th>${T('指纹','Fingerprint')}</th><th>${T('主机名','Hostname')}</th><th>${T('硬件','Hardware')}</th><th>IP</th><th>${T('最后在线','Last online')}</th></tr></thead><tbody>${devRows}</tbody></table>
          <div class="detail-sub">${T('使用记录（近 7 日 · 关联审计日志）','Usage (7 days · audit logs)')}</div>
          <table><thead><tr><th>${T('模型','Model')}</th><th class="num">${T('请求数','Requests')}</th><th class="num">Token</th><th>${T('最近使用','Last used')}</th></tr></thead><tbody>${usageRows}</tbody></table>
          <div class="detail-sub">${T('设备空闲内存变化（近 24h）','Device free memory (24h)')}</div>
          ${sparkline(a.memSeries)}
        </div>
      </div>`
    // ⚙ 显示设置：调整登录历史/心跳设备/用量分组的默认显示条数（全局落盘，与「安全防护 → 审计留存」同一配置）
    m.querySelector('[data-actset]')?.addEventListener('click', () => openActivitySettings(username, a.limits ?? {}))
  } catch (e) {
    m.innerHTML = `<div class="dlg md" role="dialog" aria-modal="true">
      <div class="dlg-head">
        <h2>${T('账号详情','Account details')} · ${esc(username)}</h2>
        <button class="dlg-x" data-dlg-close title="${T('关闭 (Esc)','Close (Esc)')}">${icon('x', { size: 16 })}</button>
      </div>
      <div class="dlg-body">${T('加载失败：{m}','Load failed: {m}', { m: esc(e?.message ?? e) })}</div>
    </div>`
  }
}

/* ============ 账号详情 · 显示设置弹层 ============ */
/** 打开显示设置：登录历史 / 心跳设备 / 用量分组 / 活动窗口（保存到 audit.activity*，全局生效） */
function openActivitySettings(username, limits) {
  let m = document.getElementById('actSetModal')
  if (!m) { m = document.createElement('div'); m.id = 'actSetModal'; m.className = 'dlg-mask'; document.body.appendChild(m) }
  const f = (id, label, val, max) => `
    <div>
      <label>${label}</label>
      <input class="input" id="${id}" type="number" min="1" max="${max}" value="${esc(val)}">
    </div>`
  m.innerHTML = `
    <div class="dlg" style="width:min(380px,94vw)" role="dialog" aria-modal="true">
      <div class="dlg-head">
        <h2>${T('显示设置','Display settings')}</h2>
        <button class="dlg-x" data-dlg-close title="${T('关闭 (Esc)','Close (Esc)')}">${icon('x', { size: 16 })}</button>
      </div>
      <div class="dlg-body">
        <div class="crumb" style="margin-bottom:10px">${T('账号详情各区块的默认显示数量（全局生效，保存后落盘）','Default row counts for account details (global, persisted)')}</div>
        <div style="display:grid;gap:10px">
          ${f('asLogins', T('登录历史条数（含失败尝试）','Sign-in history rows'), limits.logins ?? 20, 200)}
          ${f('asDevices', T('心跳设备条数（登录心跳聚合）','Heartbeat device rows'), limits.devices ?? 20, 200)}
          ${f('asUsage', T('用量分组数','Usage groups'), limits.usage ?? 20, 200)}
          ${f('asDays', T('活动窗口（天）','Activity window (days)'), limits.days ?? 7, 90)}
        </div>
        <div class="hint" style="margin-top:10px">${T('只影响展示范围，不删数据；与「安全防护 → 审计留存」是同一组配置。','Display range only, no data deleted; shared with Security → Audit retention')}</div>
      </div>
      <div class="dlg-foot">
        <span style="flex:1"></span>
        <button class="btn" data-dlg-close>${T('取消','Cancel')}</button>
        <button class="btn primary" id="asSaveBtn">${T('保存','Save')}</button>
      </div>
    </div>`
  openDlg(m)
  m.querySelector('#asSaveBtn').addEventListener('click', async () => {
    const num = (id) => Number(m.querySelector('#' + id).value)
    for (const [id, max] of [['asLogins', 200], ['asDevices', 200], ['asUsage', 200], ['asDays', 90]]) {
      if (!Number.isInteger(num(id)) || num(id) < 1 || num(id) > max) { toast('✗ ' + T('{id} 须为 1-{max} 的整数', '{id} must be an integer 1-{max}', { id, max }), 'bad'); return }
    }
    try {
      await api('/admin/policy', { method: 'PATCH', body: JSON.stringify({ audit: { activityLogins: num('asLogins'), activityDevices: num('asDevices'), activityUsage: num('asUsage'), activityDays: num('asDays') } }) })
      closeDlg(m)
      toast(T('显示设置已保存并落盘','Display settings saved'))
      openUserModal(username)   // 按新条数重拉账号详情
    } catch (e) { if (e.message !== '401') toast('✗ ' + e.message, 'bad') }
  })
}

/* ============ 事件绑定（模块级防重入） ============ */

/** 随机强密码：去掉易混淆字符（0O1lI）的 12 位 */
function genPassword() {
  const chars = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  const bytes = crypto.getRandomValues(new Uint8Array(12))
  return [...bytes].map((b) => chars[b % chars.length]).join('')
}

function bindUsersPage() {
  // 新增账号弹窗：开 / 提交（× / 取消 / Esc 的关闭由契约 data-dlg-close 统一处理）
  $('openCreateBtn').addEventListener('click', openCreateModal)
  $('nuGenBtn').addEventListener('click', () => { $('nuPass').value = genPassword(); $('nuPass').focus() })
  $('nuName').addEventListener('keydown', (e) => { if (e.key === 'Enter') createUser() })
  $('nuPass').addEventListener('keydown', (e) => { if (e.key === 'Enter') createUser() })
  // 创建账号
  $('createUserBtn').addEventListener('click', createUser)
  // 搜索（输入即过滤）
  $('userSearch').addEventListener('input', renderUsers)
  $('userSearch').addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.target.value = ''; renderUsers() } })
  // 列表行内操作（委托）
  const $list = $('userList')
  if (!$list.dataset.userBound) {
    $list.dataset.userBound = '1'
    $list.addEventListener('click', async (e) => {
      const act = e.target.closest('button[data-activity]')
      if (act) openUserModal(act.dataset.activity)
      const pwd = e.target.closest('[data-pwd]')
      if (pwd) openResetPwd(Number(pwd.dataset.pwd), pwd.dataset.name)
      const tg = e.target.closest('[data-toggle]')
      if (tg) toggleUser(Number(tg.dataset.toggle), Number(tg.dataset.to))
      const del = e.target.closest('[data-del]')
      if (del) deleteUser(Number(del.dataset.del), del.dataset.name)
    })
  }
  // 改密弹层（弹层 DOM 随本页 html 注入）
  $('pwdConfirmBtn').addEventListener('click', doResetPwd)
  $('pwdGenBtn').addEventListener('click', () => { $('pwdNew').value = genPassword() })
  $('pwdNew').addEventListener('keydown', (e) => { if (e.key === 'Enter') doResetPwd() })
}

function openResetPwd(id, username) {
  pwdTargetId = id; $('pwdUser').textContent = username; $('pwdNew').value = ''
  $('pwdErr').textContent = ''
  openDlg($('pwdModal'))
  $('pwdNew').focus()
}

async function doResetPwd() {
  const p = $('pwdNew').value
  if (p.length < 8) { $('pwdErr').textContent = T('密码至少 8 位','Password must be 8+ characters'); return }
  const r = await api('/admin/users/' + pwdTargetId, { method: 'PATCH', body: JSON.stringify({ password: p }) })
  if (r.ok) { closeDlg($('pwdModal')); toast(T('密码已重置','Password reset')) }
}

function openCreateModal() {
  $('nuName').value = ''; $('nuDisp').value = ''; $('nuOrg').value = ''; $('nuPass').value = ''
  const radio = document.querySelector('input[name="nuRole"][value="user"]')
  if (radio) radio.checked = true
  $('nuErr').textContent = ''
  openDlg($('nuModal'))
  $('nuName').focus()
}

async function createUser() {
  const errEl = $('nuErr')
  errEl.textContent = ''
  const username = $('nuName').value.trim(), password = $('nuPass').value
  const displayName = $('nuDisp').value.trim()
  const orgPath = $('nuOrg').value.trim() || '/'
  const role = document.querySelector('input[name="nuRole"]:checked')?.value ?? 'user'
  if (!username) { errEl.textContent = T('用户名不能为空','Username is required'); $('nuName').focus(); return }
  if (!password) { errEl.textContent = T('初始密码不能为空','Initial password is required'); $('nuPass').focus(); return }
  if (password.length < 8) { errEl.textContent = T('初始密码至少 8 位','Initial password must be 8+ characters'); $('nuPass').focus(); return }
  const body = await api('/admin/users', { method: 'POST', body: JSON.stringify({ username, password, role, displayName: displayName || undefined, orgPath }) })
  if (body?.error) { errEl.textContent = body.error.message ?? T('创建失败','Create failed'); return }
  closeDlg($('nuModal'))
  toast(T('已创建 {u}{d}', 'Created {u}{d}', { u: username, d: displayName ? '(' + displayName + ')' : '' }))
  loadUsers()
}

async function deleteUser(id, username) {
  const ok = await confirmDlg({
    title: T('删除用户', 'Delete user'),
    message: T('确定删除用户「{u}」？该账号的登录身份立即失效，历史留痕与计费记录保留（审计需要）。', 'Delete user {u}? Sign-in is revoked immediately; logs and billing records are kept for audit.', { u: username }),
    confirmText: T('确认删除', 'Delete'),
    danger: true,
  })
  if (!ok) return
  const r = await api('/admin/users/' + id, { method: 'DELETE' })
  if (r?.error) return toast(r.error.message ?? T('删除失败','Delete failed'))
  toast(T('已删除 {u}','Deleted {u}', { u: username }))
  loadUsers()
}

async function toggleUser(id, enabled) {
  await api('/admin/users/' + id, { method: 'PATCH', body: JSON.stringify({ enabled }) })
  toast(enabled ? T('已启用','Enabled') : T('已停用','Disabled'))
  loadUsers()
}
