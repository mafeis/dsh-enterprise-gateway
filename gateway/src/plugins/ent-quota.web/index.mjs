/**
 * 插件页面 · 额度管理（ent-quota）
 * 布局：左列组列表（含额度摘要），右侧选中组的额度表单（日/周/月 × Token/金额 共 6 项）。
 * 数据源：/admin/quota（本插件：组额度 + 模型单价）
 * 语义：Token 以百万（M）输入；金额（元）直填；0 = 不限；Token 与金额可叠加，任一超限即 429。
 */
import { api, $, toast, esc } from '/admin/static/contract.mjs'
import { T } from '/admin/static/js/i18n.mjs';

let cachedGroups = []
let cachedPrices = {}      // id → {in, out, cache}
let currentGroupId = null

/** token 数 → 百万输入值（0 = 不限） */
const tokensToM = (n) => { const v = n ?? 0; if (!v) return 0; return v % 1e6 === 0 ? v / 1e6 : Math.round(v / 1e5) / 10 }

/** Token 显示（纯展示，不进输入框）：< 100万 = 原数字；≥ 100万 = N 万；≥ 1亿 = N 亿 */
function fmtTokens(n) {
  const v = n ?? 0
  if (v >= 1e8) {
    const y = v / 1e8
    return (y % 1 === 0 ? y : Math.round(y * 100) / 100) + T(' 亿', 'B')
  }
  if (v >= 1e6) {
    const w = v / 1e4
    return (w % 1 === 0 ? w : Math.round(w * 100) / 100) + T(' 万', '×10k')
  }
  return String(Math.round(v))
}

/** 额度摘要（组列表行）：只列非零项；Token 智能单位（数字/万/亿），金额直显 */
function quotaSummary(q) {
  const parts = []
  if (q?.dailyTokens) parts.push(T('日 {n} tok', '{n} tok/day', { n: fmtTokens(q.dailyTokens) }))
  if (q?.dailyAmount) parts.push(T('日 ¥{n}', '¥{n}/day', { n: q.dailyAmount }))
  if (q?.weeklyTokens) parts.push(T('周 {n} tok', '{n} tok/wk', { n: fmtTokens(q.weeklyTokens) }))
  if (q?.weeklyAmount) parts.push(T('周 ¥{n}', '¥{n}/wk', { n: q.weeklyAmount }))
  if (q?.monthlyTokens) parts.push(T('月 {n} tok', '{n} tok/mo', { n: fmtTokens(q.monthlyTokens) }))
  if (q?.monthlyAmount) parts.push(T('月 ¥{n}', '¥{n}/mo', { n: q.monthlyAmount }))
  return parts.length ? parts.join(' · ') : T('不限额度', 'No quota')
}

export default {
  page: 'ent-quota',
  html: `
  <div class="headrow" data-ent-page="ent-quota">
    <div><h1>${T('额度管理','Quota')}</h1></div>
  </div>

  <div class="card">
    <h2><span class="bar"></span>${T('按组配置','Per group')} <span class="badge dim" id="qtGroupCount"></span></h2>
    <div class="mhint">${T('左侧选组，右侧改额度；保存即时生效。', 'Pick a group, edit quota on the right; effective on save.')}</div>
    <div style="display:grid;grid-template-columns:minmax(240px,320px) 1fr;gap:16px;margin-top:12px" id="qtLayout">
      <div id="qtGroupList"><div class="empty">${T('加载中…','Loading…')}</div></div>
      <div id="qtEditor"><div class="empty">${T('← 选择一个分组','← Pick a group')}</div></div>
    </div>
  </div>`,
  async load() { await loadAll() },
  bind() { bindQuotaPage() },
}

async function loadAll() {
  try {
    const d = await api('/admin/quota')
    cachedGroups = d.groups ?? []
    cachedPrices = Object.fromEntries((d.prices ?? []).map((p) => [p.id, p]))
    if (currentGroupId && !cachedGroups.some((g) => g.id === currentGroupId)) currentGroupId = null
    if (currentGroupId === null && cachedGroups.length) currentGroupId = cachedGroups[0].id
    renderGroupList()
    renderEditor()
  } catch { /* 401 已处理 */ }
}

function renderGroupList() {
  const el = $('qtGroupList')
  $('qtGroupCount').textContent = T('{n} 个分组', '{n} groups', { n: cachedGroups.length })
  if (!cachedGroups.length) {
    el.innerHTML = `<div class="empty">${T('暂无分组，请先在「用户分组」新建。', 'No groups yet — create one in Groups first.')}</div>`
    return
  }
  el.innerHTML = cachedGroups.map((g) => `
    <div class="user-item qt-gitem ${g.id === currentGroupId ? 'qt-cur' : ''}" data-qgroup="${g.id}" style="cursor:pointer">
      <div class="user-main" style="flex:1">
        <div class="user-title"><b>${esc(g.name)}</b><span class="badge dim">${g.member_count} ${T('人','ppl')}</span></div>
        <div class="user-meta">${esc(quotaSummary(g.quota))}</div>
      </div>
    </div>`
  ).join('')
}

function quotaCell(id, label, val, ph, echo) {
  return `<div class="mfield" style="margin-bottom:0">
    <label>${label}</label>
    <input class="input" id="${id}" type="number" min="0" step="any" value="${val ?? 0}" placeholder="${ph}">
    <div class="dim2" id="${id}Echo" style="font-size:12px;margin-top:3px;min-height:15px">${echo ?? ''}</div>
  </div>`
}

function windowRow(title, suffix, q) {
  const tIn = tokensToM(q?.tokens)
  const tEcho = tIn ? fmtTokens(tIn * 1e6) : ''
  const aEcho = q?.amount ? T('¥{n}', '¥{n}', { n: q.amount }) : ''
  return `
    <div class="mfield">
      <label>${title}</label>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px 14px">
        ${quotaCell('qt' + suffix + 'Tokens', T('Token（百万）','Tokens (M)'), tIn, '如 5 = 5M', tEcho)}
        ${quotaCell('qt' + suffix + 'Amount', T('金额（元）','Amount (¥)'), q?.amount ?? 0, '如 50', aEcho)}
      </div>
    </div>`
}

function renderEditor() {
  const el = $('qtEditor')
  const g = cachedGroups.find((x) => x.id === currentGroupId)
  if (!g) { el.innerHTML = `<div class="empty">${T('← 选择一个分组','← Pick a group')}</div>`; return }
  const q = g.quota ?? {}
  const modelsOf = g.models ?? []
  const priceHint = modelsOf.length === 1 && cachedPrices[modelsOf[0]]
    ? T('金额按 {m} 单价折算：in ¥{i}/M · out ¥{o}/M', 'Amount priced by {m}: in ¥{i}/M, out ¥{o}/M', { m: modelsOf[0], i: cachedPrices[modelsOf[0]].in, o: cachedPrices[modelsOf[0]].out })
    : T('金额按各模型单价逐笔折算。', 'Amount is billed per model price.')
  el.innerHTML = `
    <div class="user-title" style="margin-bottom:12px">
      <b style="font-size:15px">${esc(g.name)}</b>
      <span class="badge dim">${g.member_count} ${T('人','ppl')}</span>
      <span style="flex:1"></span>
      <button class="btn primary sm" id="qtSave">${T('保存','Save')}</button>
      <span class="dim2" id="qtDirty" style="font-size:12px"></span>
    </div>
    <div class="mhint">${T('每人额度，0 = 不限；Token 与金额都设 = 叠加控制，任一超限即停。', 'Per-user quota, 0 = unlimited; tokens & amount stack — either one stops.')}</div>
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:12px 18px;margin-top:12px">
      ${windowRow(T('日限额','Daily'), 'Daily', { tokens: q.dailyTokens, amount: q.dailyAmount })}
      ${windowRow(T('周限额','Weekly'), 'Weekly', { tokens: q.weeklyTokens, amount: q.weeklyAmount })}
      ${windowRow(T('月限额','Monthly'), 'Monthly', { tokens: q.monthlyTokens, amount: q.monthlyAmount })}
    </div>
    <div class="mhint">${priceHint}</div>`
  el.querySelector('#qtSave').addEventListener('click', () => saveQuota(g.id))
  const bindEcho = (id, toEcho) => {
    const input = el.querySelector('#' + id)
    const echo = el.querySelector('#' + id + 'Echo')
    input.addEventListener('input', () => {
      $('qtDirty').textContent = T('未保存','Unsaved')
      const n = Number(input.value) || 0
      echo.textContent = n > 0 ? toEcho(n) : ''
    })
  }
  for (const w of ['Daily', 'Weekly', 'Monthly']) {
    bindEcho(`qt${w}Tokens`, (n) => fmtTokens(n * 1e6))
    bindEcho(`qt${w}Amount`, (n) => T('¥{n}', '¥{n}', { n }))
  }
}

async function saveQuota(id) {
  const el = $('qtEditor')
  const m = (id2) => (Number(el.querySelector('#' + id2).value) || 0) * 1e6
  const quota = {
    dailyTokens: m('qtDailyTokens'), dailyAmount: Number(el.querySelector('#qtDailyAmount').value) || 0,
    weeklyTokens: m('qtWeeklyTokens'), weeklyAmount: Number(el.querySelector('#qtWeeklyAmount').value) || 0,
    monthlyTokens: m('qtMonthlyTokens'), monthlyAmount: Number(el.querySelector('#qtMonthlyAmount').value) || 0,
  }
  const r = await api('/admin/quota/' + id, { method: 'PATCH', body: JSON.stringify({ quota }) })
  if (r?.error) return toast(r.error.message ?? T('保存失败','Save failed'))
  $('qtDirty').textContent = ''
  toast(T('额度已更新','Quota updated'))
  const g = cachedGroups.find((x) => x.id === id)
  if (g) g.quota = quota
  renderGroupList()
}

function bindQuotaPage() {
  $('qtGroupList').addEventListener('click', (e) => {
    const item = e.target.closest('[data-qgroup]')
    if (!item) return
    if (currentGroupId === Number(item.dataset.qgroup)) return
    currentGroupId = Number(item.dataset.qgroup)
    $('qtDirty').textContent = ''
    renderGroupList()
    renderEditor()
  })
}
