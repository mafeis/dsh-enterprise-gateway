/**
 * 插件页面 · 计费账单（重设计）
 * 结构：周期选择 + KPI 摘要 → 每日金额趋势图 → Tabs（按日明细 / 按模型汇总 / 模型单价）→ CSV 导出
 * 数据源：/admin/usage（ent-billing 域插件聚合提供）——页面归本插件所有
 */
import { api, $, fmtTok, esc } from '/admin/static/contract.mjs'

/* ---------- 格式化 ---------- */

/** 金额：≥¥1 统一 2 位小数（财务习惯），<¥1 保留精度（¥0.0084 不能显示成 ¥0.01） */
const fmtYuan = (n) => {
  const v = Number(n) || 0
  const a = Math.abs(v)
  const d = a >= 1 ? 2 : 4
  return '¥' + v.toFixed(d).replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '')
}

const WEEK = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']

/** '2026-02-14' → { md:'02-14', week:'周六', full:'2026-02-14 周六' } */
function dayInfo(day) {
  const dt = new Date(day + 'T00:00:00')
  const md = day.slice(5)
  const week = isNaN(dt) ? '' : WEEK[dt.getDay()]
  return { md, week, full: `${day} ${week}`.trim() }
}

function todayStr() {
  const t = new Date()
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`
}

/* ---------- 模块状态（bind 后复用） ---------- */
let lastDays = 14
let lastBilled = []
let lastUsers = new Map()

/* ---------- CSV 导出（前端生成，含 BOM 便于 Excel 打开） ---------- */
function exportCsv() {
  if (!lastBilled.length) { return }
  const rows = [['日期', '请求数', '输入Token', '缓存命中Token', '输出Token', '活跃用户', '应付金额(元)', '分模型金额(元)']]
  for (const d of lastBilled) {
    rows.push([
      d.day, d.requests, d.tokens_in, d.tokens_cached ?? 0, d.tokens_out, lastUsers.get(d.day) ?? d.users, d.amount.toFixed(4),
      (d.byModel ?? []).map((m) => `${m.model}=${m.amount.toFixed(4)}`).join(' '),
    ])
  }
  const csv = '\uFEFF' + rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\r\n')
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = `DSH企业账单_近${lastDays}天_${todayStr()}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

/* ---------- 渲染 ---------- */

/** day → 当日真实活跃用户数（billed.users 是按模型取 max，会低估；daily 才是按日 COUNT(DISTINCT)） */
function userMap(daily) {
  return new Map((daily ?? []).map((d) => [d.day, d.users]))
}

function renderKpis(billed, daily, days) {
  const total = billed.reduce((a, d) => a + d.amount, 0)
  const totalReq = billed.reduce((a, d) => a + d.requests, 0)
  const tokIn = daily.reduce((a, d) => a + d.tokens_in, 0)
  const tokOut = daily.reduce((a, d) => a + d.tokens_out, 0)
  const tokCached = billed.reduce((a, d) => a + (d.tokens_cached ?? 0), 0)
  const users = userMap(daily)
  const withUsers = billed.filter((d) => users.has(d.day))
  const userMax = withUsers.reduce((a, d) => Math.max(a, users.get(d.day)), 0)
  const userAvg = withUsers.length ? Math.round(withUsers.reduce((a, d) => a + users.get(d.day), 0) / withUsers.length * 10) / 10 : 0
  const models = new Set(billed.flatMap((d) => (d.byModel ?? []).map((m) => m.model)))

  $('kpiAmount').textContent = fmtYuan(total)
  $('kpiAmountSub').textContent = `近 ${days} 天 · ${billed.length} 个计费日`
  $('kpiReq').textContent = fmtTok(totalReq)
  $('kpiReqSub').textContent = models.size ? `涉及 ${models.size} 个模型` : '暂无模型数据'
  $('kpiTok').textContent = fmtTok(tokIn + tokOut)
  $('kpiTokSub').textContent = tokCached ? `入 ${fmtTok(tokIn)}（命中 ${fmtTok(tokCached)}）· 出 ${fmtTok(tokOut)}` : `入 ${fmtTok(tokIn)} · 出 ${fmtTok(tokOut)}`
  $('kpiUsers').textContent = withUsers.length ? userMax : '–'
  $('kpiUsersSub').textContent = withUsers.length ? `日均 ${userAvg} 人` : ''
}

function renderChart(billed) {
  const el = $('billChart')
  if (!billed.length) { el.innerHTML = '<div class="empty" style="flex:1">暂无计费数据</div>'; return }
  const max = Math.max(...billed.map((d) => d.amount), 1e-9)
  // 日期标签：均匀抽样（首/尾必显示），标签脱离文档流避免撑宽个别柱
  const n = billed.length
  const step = Math.max(1, Math.ceil(n / Math.min(12, n)))
  const today = todayStr()
  el.innerHTML = billed.map((d, i) => {
    const info = dayInfo(d.day)
    const h = Math.max(3, Math.round((d.amount / max) * 92))
    const showLab = i % step === 0 || i === n - 1
    const lab = showLab
      ? `<div class="bill-lab${d.day === today ? ' cur' : ''}">${info.md}</div>` : '<div class="bill-lab"></div>'
    const title = `${info.full} · ${fmtYuan(d.amount)} · ${d.requests} 次请求`
    return `<div class="bill-col" title="${esc(title)}">
      <div class="bill-bar${d.day === today ? ' cur' : ''}" style="height:${h}px"></div>${lab}</div>`
  }).join('')
}

function shortModel(id) {
  const p = lastPrices[id]
  return (p && p.displayName) ? p.displayName : id
}

function renderDaily(billed, daily) {
  const body = $('billBody')
  const foot = $('billFoot')
  const today = todayStr()
  if (!billed.length) {
    body.innerHTML = '<tr><td colspan="8" class="empty">所选周期内暂无计费数据</td></tr>'
    foot.innerHTML = ''
    return
  }
  const users = userMap(daily)
  const max = Math.max(...billed.map((d) => d.amount), 1e-9)
  body.innerHTML = billed.map((d) => {
    const info = dayInfo(d.day)
    const models = d.byModel ?? []
    const shown = models.slice(0, 3).map((m) =>
      `<span class="mapchip" title="${esc(m.model)}">${esc(shortModel(m.model))} ${fmtYuan(m.amount)}</span>`).join(' ')
    const more = models.length > 3 ? `<span class="dim2">+${models.length - 3}</span>` : ''
    const todayBadge = d.day === today ? ' <span class="badge">今日</span>' : ''
    const pct = Math.round((d.amount / max) * 100)
    return `<tr>
      <td><b>${info.md}</b> <span class="dim2">${info.week}</span>${todayBadge}</td>
      <td class="num">${d.requests}</td>
      <td class="num">${fmtTok(d.tokens_in)}</td>
      <td class="num">${d.tokens_cached ? `<span style="color:var(--ok)">${fmtTok(d.tokens_cached)}</span>` : '—'}</td>
      <td class="num">${fmtTok(d.tokens_out)}</td>
      <td class="num">${users.get(d.day) ?? d.users}</td>
      <td>${shown}${more}</td>
      <td class="num"><b>${fmtYuan(d.amount)}</b><div class="bill-mini" title="占周期峰值 ${pct}%"><i style="width:${pct}%"></i></div></td>
    </tr>`
  }).join('')

  const sum = (k) => billed.reduce((a, d) => a + d[k], 0)
  foot.innerHTML = `<tr><td>合计</td>
    <td class="num">${sum('requests')}</td>
    <td class="num">${fmtTok(sum('tokens_in'))}</td>
    <td class="num">${fmtTok(sum('tokens_cached'))}</td>
    <td class="num">${fmtTok(sum('tokens_out'))}</td>
    <td class="num">—</td><td></td>
    <td class="num"><b>${fmtYuan(sum('amount'))}</b></td></tr>`
}

function renderModels(billed) {
  const body = $('modelBody')
  const agg = new Map()
  for (const d of billed) {
    for (const m of d.byModel ?? []) {
      if (!agg.has(m.model)) agg.set(m.model, { model: m.model, requests: 0, amount: 0 })
      const a = agg.get(m.model)
      a.requests += m.requests
      a.amount += m.amount
    }
  }
  const list = [...agg.values()].sort((a, b) => b.amount - a.amount)
  if (!list.length) { body.innerHTML = '<tr><td colspan="4" class="empty">暂无模型数据</td></tr>'; return }
  const total = list.reduce((a, m) => a + m.amount, 0)
  body.innerHTML = list.map((m) => {
    const pct = total > 0 ? Math.round((m.amount / total) * 100) : 0
    return `<tr>
      <td><span class="mname">${esc(shortModel(m.model))}</span><div class="msub mono">${esc(m.model)}</div></td>
      <td class="num">${m.requests}</td>
      <td class="num"><b>${fmtYuan(m.amount)}</b></td>
      <td><div style="display:flex;align-items:center;gap:8px">
        <div class="bill-share"><i style="width:${pct}%"></i></div><span class="dim2" style="white-space:nowrap">${pct}%</span>
      </div></td>
    </tr>`
  }).join('')
}

function renderPrices(prices) {
  const body = $('priceBody')
  const list = Object.entries(prices)
  if (!list.length) { body.innerHTML = '<tr><td colspan="4" class="empty">未配置模型单价</td></tr>'; return }
  body.innerHTML = list.map(([id, p]) => `<tr>
      <td><span class="mname">${esc(p.displayName || id)}</span><div class="msub mono">${esc(id)}</div></td>
      <td class="num">¥${p.in}/百万</td>
      <td class="num">¥${p.out}/百万</td>
      <td class="num">${p.cache != null && p.cache !== p.in ? `¥${p.cache}/百万` : '<span class="dim2">同输入价</span>'}</td>
    </tr>`).join('')
}

/* ---------- 页面模块 ---------- */

let lastPrices = {}

export default {
  page: 'ent-billing',
  html: `
  <div class="headrow" data-ent-page="ent-billing">
    <div><h1>计费账单</h1></div>
    <span style="flex:1"></span>
    <select id="billDays" title="统计周期">
      <option value="7">近 7 天</option>
      <option value="14" selected>近 14 天</option>
      <option value="30">近 30 天</option>
      <option value="90">近 90 天</option>
    </select>
    <button class="btn" id="billExport">导出 CSV</button>
  </div>

  <div class="kpirow">
    <div class="kpi"><div class="lab">应付合计</div><div class="val" id="kpiAmount">–</div><div class="sub2" id="kpiAmountSub"></div></div>
    <div class="kpi"><div class="lab">总请求</div><div class="val" id="kpiReq">–</div><div class="sub2" id="kpiReqSub"></div></div>
    <div class="kpi"><div class="lab">总 Token</div><div class="val" id="kpiTok">–</div><div class="sub2" id="kpiTokSub"></div></div>
    <div class="kpi"><div class="lab">单日最多活跃用户</div><div class="val" id="kpiUsers">–</div><div class="sub2" id="kpiUsersSub"></div></div>
  </div>

  <div class="card">
    <h2><span class="bar"></span>每日应付金额 <span class="badge dim" id="billRange"></span></h2>
      <div class="bill-chart" id="billChart"><div class="empty" style="flex:1">加载中…</div></div>
  </div>

  <div class="card">
    <div class="tabs" id="billTabs">
      <span class="on" data-tab="daily">按日明细</span>
      <span data-tab="model">按模型汇总</span>
      <span data-tab="price">模型单价</span>
    </div>

    <div class="pane on" data-pane="daily">
      <table>
        <thead><tr><th>日期</th><th class="num">请求</th><th class="num">入 Token</th><th class="num">缓存命中</th><th class="num">出 Token</th><th class="num">活跃用户</th><th>分模型金额</th><th class="num">应付金额</th></tr></thead>
        <tbody id="billBody"><tr><td colspan="8" class="empty">加载中…</td></tr></tbody>
        <tfoot id="billFoot"></tfoot>
      </table>
    </div>

    <div class="pane" data-pane="model">
          <table>
        <thead><tr><th>模型</th><th class="num">请求数</th><th class="num">应付金额</th><th>金额占比</th></tr></thead>
        <tbody id="modelBody"><tr><td colspan="4" class="empty">加载中…</td></tr></tbody>
      </table>
    </div>

    <div class="pane" data-pane="price">
          <table>
        <thead><tr><th>模型</th><th class="num">输入单价</th><th class="num">输出单价</th><th class="num">缓存单价</th></tr></thead>
        <tbody id="priceBody"><tr><td colspan="4" class="empty">加载中…</td></tr></tbody>
      </table>
    </div>
  </div>`,
  async load() {
    try {
      const days = Number($('billDays')?.value) || 14
      const r = await api('/admin/usage?days=' + days)
      const billed = r.billed ?? []
      const daily = r.daily ?? []
      lastDays = days
      lastBilled = billed
      lastUsers = userMap(daily)
      lastPrices = r.prices ?? {}

      renderKpis(billed, daily, days)
      renderChart(billed)
      renderDaily(billed, daily)
      renderModels(billed)
      renderPrices(lastPrices)

      // 周期说明：首个 / 末个计费日
      $('billRange').textContent = billed.length
        ? `${billed[billed.length - 1].day} ~ ${billed[0].day}`
        : `近 ${days} 天`
    } catch { /* 401 已处理 */ }
  },
  bind() {
    $('billDays')?.addEventListener('change', () => this.load())
    $('billExport')?.addEventListener('click', exportCsv)
    const tabs = document.querySelectorAll('#billTabs span')
    tabs.forEach((t) => t.addEventListener('click', () => {
      tabs.forEach((x) => x.classList.toggle('on', x === t))
      document.querySelectorAll('[data-pane]').forEach((p) => p.classList.toggle('on', p.dataset.pane === t.dataset.tab))
    }))
  },
}
