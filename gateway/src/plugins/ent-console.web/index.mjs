/**
 * 插件自带页面 · ent-console（运营总览）
 * 数据：/admin/stats + /admin/terminals（./terminals.mjs）
 * 设置面：每区块「是否显示 + 展示方式」（kpi 数值卡 / table 表格 / bar 对比条 / cards 卡片墙 / auto 自动）
 * 配置经 GET/PATCH /admin/console-config 落盘持久化，即时生效
 */
import { api, $, fmtTok, esc, icon, toast, openDlg, closeDlg } from '/admin/static/contract.mjs';
import { loadTerminals, bindTerminalsEvents, renderTerminals, renderTerminalsCards } from './terminals.mjs';

let sections = {};
let labels = {};
let modes = {};
let modeLabels = {};
let lastStats = null;

export default {
  page: 'ent-console',
  html: `
  <div class="headrow" data-ent-page="ent-console">
    <div><h1>运营总览</h1></div>
    <div class="sp"></div>
    <button class="btn sm" id="ovSettingsBtn" title="设置本页展示内容与方式"></button>
  </div>

  <div id="ovDynamic"><!-- 区块按配置动态渲染 --></div>`,

  bind() {
    bindTerminalsEvents();
    $('ovSettingsBtn').innerHTML = icon('settings', { size: 14 });
    $('ovSettingsBtn').addEventListener('click', () => openSettings());
  },

  async load() {
    await loadAll();
  },
};

/** 页面数据装载（load 与设置保存后复用） */
async function loadAll() {
  // 1. 展示配置
  try {
    const c = await api('/admin/console-config');
    sections = c.sections ?? {};
    labels = c.labels ?? {};
    modes = c.modes ?? {};
    modeLabels = c.modeLabels ?? {};
  } catch { sections = {}; }

  // 2. 数据（一次拉取，各区块按各自形态渲染）
  lastStats = null;
  const needStats = ['req', 'tok', 'users', 'dlp', 'usage'].some((k) => sections[k]?.enabled !== false);
  if (needStats) {
    try { lastStats = await api('/admin/stats'); } catch { /* 401 已在 contract 处理 */ }
  }
  let terminals = [];
  if (sections.terminals?.enabled !== false) {
    try { terminals = (await api('/admin/terminals')).terminals ?? []; } catch { /* 401 */ }
  }

  // 3. 动态渲染
  const host = $('ovDynamic');
  if (!host) return;
  const kpiKeys = ['req', 'tok', 'users', 'dlp'].filter((k) => sections[k]?.enabled !== false);
  const kpiModes = kpiKeys.map((k) => resolveMode(k));
  const kpiAsTable = kpiKeys.length && kpiModes.every((m) => m === 'table');
  const kpiAsBars = kpiKeys.length && kpiModes.every((m) => m === 'bar');
  const kpiAsKpi = kpiKeys.length && kpiModes.every((m) => m === 'kpi');
  const kpiAsCards = kpiKeys.length && kpiModes.every((m) => m === 'cards');

  const parts = [];
  // —— KPI 区块（统一容器：全部同形态才组合渲染；混合形态各自渲染） ——
  if (kpiKeys.length) {
    if (kpiAsKpi) {
      parts.push(`<div class="grid4" style="margin-bottom:20px">${kpiKeys.map((k) => kpiCard(k)).join('')}</div>`);
    } else if (kpiAsTable) {
      parts.push(sectionCard('kpi', '今日运营指标', tableHtml(kpiKeys.map((k) => metricRow(k)))));
    } else if (kpiAsBars) {
      parts.push(sectionCard('kpi', '今日运营指标', kpiKeys.map((k) => barRow(k, barValue(k), barMax(kpiKeys))).join('')));
    } else if (kpiAsCards) {
      parts.push(`<div class="grid4" style="margin-bottom:20px">${kpiKeys.map((k) => statCard(k)).join('')}</div>`);
    } else {
      // 混合形态：逐个渲染（kpi/bar → 卡片流；table → 表格卡）
      for (const k of kpiKeys) {
        const m = resolveMode(k);
        if (m === 'kpi') parts.push(`<div class="grid4" style="margin-bottom:20px">${kpiCard(k)}</div>`);
        else if (m === 'cards') parts.push(`<div class="grid4" style="margin-bottom:20px">${statCard(k)}</div>`);
        else if (m === 'bar') parts.push(sectionCard(k, labels[k], barRow(k, barValue(k), barMax(kpiKeys))));
        else parts.push(sectionCard(k, labels[k], tableHtml([metricRow(k)])));
      }
    }
  }
  // —— 在线终端 ——
  if (sections.terminals?.enabled !== false) {
    const m = resolveMode('terminals');
    parts.push(m === 'cards'
      ? sectionCard('terminals', '在线终端', `<span class="badge dim">${terminals.length} 台</span>`, renderTerminalsCards(terminals))
      : sectionCard('terminals', '在线终端', `<span class="badge dim" id="termCount">${terminals.length}</span>`, renderTerminals(terminals)));
  }
  // —— 用户用量 TOP ——
  if (sections.usage?.enabled !== false) {
    const m = resolveMode('usage');
    const rows = lastStats?.byUser ?? [];
    if (m === 'table') parts.push(sectionCard('usage', '近 7 日用户用量 TOP', usageTable(rows)));
    else if (m === 'bar') parts.push(sectionCard('usage', '近 7 日用户用量 TOP', usageBars(rows)));
    else if (m === 'cards') parts.push(sectionCard('usage', '近 7 日用户用量 TOP', usageCards(rows)));
    else parts.push(sectionCard('usage', '近 7 日用户用量 TOP', usageTable(rows)));
  }
  host.innerHTML = parts.join('');
  bindTerminalsEvents();
}

/* ---------- 区块渲染原语 ---------- */

/** 区块卡片容器（titleId 用于给各区块稳定锚点） */
function sectionCard(key, title, badge = '', bodyHtml = '') {
  const anchor = key === 'kpi' ? '今日运营指标' : title;
  return `<div class="card" data-sec="${key}">
    <h2><span class="bar"></span>${esc(anchor)}${badge}</h2>
    ${bodyHtml}
  </div>`;
}

/** 模式解析：auto → 按数据形态自动选（单值=kpi，多行=table，其余=bar） */
function resolveMode(key) {
  const m = sections[key]?.mode ?? 'auto';
  if (m !== 'auto') return m;
  if (key === 'terminals') return 'table';
  if (key === 'usage') return 'table';
  return 'kpi';   // 四个单值指标默认数值卡
}

/** KPI 数值卡（原形态） */
function kpiCard(key) {
  const s = lastStats?.today ?? {};
  const v = { req: s.total ?? 0, tok: fmtTok((s.tin ?? 0) + (s.tout ?? 0)), users: s.users ?? 0, dlp: `${s.dlp ?? 0} / ${s.blocked ?? 0}` }[key] ?? '—';
  const sub = {
    req: `DLP 标记 ${s.dlp ?? 0} · 拦截 ${s.blocked ?? 0}`,
    tok: `入 ${fmtTok(s.tin)} / 出 ${fmtTok(s.tout)}`,
    users: '今日 distinct',
    dlp: '拦截 = 请求未到上游',
  }[key] ?? '';
  const color = key === 'dlp' && (s.blocked ?? 0) > 0 ? ' style="color:var(--bad)"' : '';
  return `<div class="kpi" data-sec="${key}"><div class="lab">${esc(labels[key])}</div><div class="val"${color}>${v}</div><div class="sub2">${sub}</div></div>`;
}

/** 强调数值卡（cards 形态：图标 + 大数字 + 说明） */
function statCard(key) {
  const icons = { req: 'activity', tok: 'database', users: 'users', dlp: 'shield-alert' };
  const s = lastStats?.today ?? {};
  const v = { req: s.total ?? 0, tok: fmtTok((s.tin ?? 0) + (s.tout ?? 0)), users: s.users ?? 0, dlp: s.blocked ?? 0 }[key] ?? '—';
  const sub = { dlp: '今日拦截', tok: '入+出合计', users: '今日 distinct', req: '今日请求' }[key] ?? '';
  return `<div class="kpi stat-card" data-sec="${key}"><div class="lab">${icon(icons[key] ?? 'activity', { size: 14 })} ${esc(labels[key])}</div><div class="val">${v}</div><div class="sub2">${sub}</div></div>`;
}

/** 表格行（单指标 / 指标合并表通用） */
function metricRow(key) {
  const s = lastStats?.today ?? {};
  const v = { req: s.total ?? 0, tok: fmtTok((s.tin ?? 0) + (s.tout ?? 0)), users: s.users ?? 0, dlp: `${s.dlp ?? 0} / ${s.blocked ?? 0}` }[key] ?? '—';
  return { cells: [labels[key], v], num: [false, true] };
}

function tableHtml(rows) {
  return `<table><thead><tr><th>指标</th><th class="num">值</th></tr></thead><tbody>${rows.map((r) =>
    `<tr><td>${esc(r.cells[0])}</td><td class="num"><b>${esc(r.cells[1])}</b></td></tr>`).join('')}</tbody></table>`;
}

/** bar 形态：占比条 */
function barValue(key) {
  const s = lastStats?.today ?? {};
  return { req: s.total ?? 0, tok: (s.tin ?? 0) + (s.tout ?? 0), users: s.users ?? 0, dlp: s.blocked ?? 0 }[key] ?? 0;
}
function barMax(keys) {
  return Math.max(...keys.map(barValue), 1);
}
function barRow(key, value, max) {
  const pct = Math.round(value / max * 100);
  const show = key === 'tok' ? fmtTok(value) : String(value);
  return `<div style="margin-bottom:12px">
    <div style="display:flex;justify-content:space-between;font-size:13px"><span>${esc(labels[key])}</span><b class="num">${esc(show)}</b></div>
    <div class="bar" style="margin:4px 0 0"><i style="width:${pct}%;background:var(--accent)"></i></div>
  </div>`;
}

/** usage 的三种形态 */
function usageTable(rows) {
  return `<table>
    <thead><tr><th>用户</th><th class="num">请求数</th><th class="num">Token 总量</th><th>占比</th></tr></thead>
    <tbody>${rows.length ? rows.map((u) => {
      const pct = Math.round(u.tokens / ((rows.reduce((a, b) => a + b.tokens, 0)) || 1) * 100);
      return `<tr><td><b>${esc(u.user_name)}</b></td><td class="num">${u.requests}</td><td class="num">${fmtTok(u.tokens)}</td>
        <td><div class="bar" style="margin:0"><i style="width:${pct}%;background:var(--accent)"></i></div></td></tr>`;
    }).join('') : '<tr><td colspan="4" class="empty">近 7 日暂无用量</td></tr>'}</tbody></table>`;
}
function usageBars(rows) {
  if (!rows.length) return '<div class="empty">近 7 日暂无用量</div>';
  const max = Math.max(...rows.map((u) => u.tokens), 1);
  return `<div style="padding:4px 0">${rows.map((u) => {
    const pct = Math.round(u.tokens / max * 100);
    return `<div style="margin-bottom:11px">
      <div style="display:flex;justify-content:space-between;font-size:13px"><span><b>${esc(u.user_name)}</b> · ${u.requests} 次</span><b class="num">${fmtTok(u.tokens)}</b></div>
      <div class="bar" style="margin:4px 0 0"><i style="width:${pct}%;background:var(--accent)"></i></div>
    </div>`;
  }).join('')}</div>`;
}
function usageCards(rows) {
  if (!rows.length) return '<div class="empty">近 7 日暂无用量</div>';
  return `<div class="grid4" style="margin-top:6px">${rows.map((u) => `
    <div class="kpi stat-card"><div class="lab">${icon('users', { size: 13 })} ${esc(u.user_name)}</div>
    <div class="val">${fmtTok(u.tokens)}</div><div class="sub2">${u.requests} 次请求</div></div>`).join('')}</div>`;
}

/* ---------- 设置弹层：每区块 开关 + 展示方式 ---------- */
function openSettings() {
  let m = document.getElementById('ovSettingsModal');
  if (!m) {
    m = document.createElement('div');
    m.id = 'ovSettingsModal';
    m.className = 'dlg-mask';
    document.body.appendChild(m);
  }
  const rows = Object.entries(labels).map(([k, label]) => {
    const cur = sections[k] ?? { enabled: true, mode: 'auto' };
    const opts = (modes[k] ?? ['auto']).map((v) =>
      `<option value="${v}" ${cur.mode === v ? 'selected' : ''}>${esc(modeLabels[v] ?? v)}</option>`).join('');
    return `<div class="ov-set-row" data-sec-key="${k}">
      <input type="checkbox" class="ov-sec-enabled" ${cur.enabled !== false ? 'checked' : ''}>
      <span class="ov-sec-label">${esc(label)}</span>
      <select class="ov-sec-mode">${opts}</select>
    </div>`;
  }).join('');
  m.innerHTML = `
    <div class="dlg sm" role="dialog" aria-modal="true">
      <div class="dlg-head">
        <h2>总览展示设置</h2>
        <button class="dlg-x" data-dlg-close title="关闭 (Esc)">${icon('x', { size: 16 })}</button>
      </div>
      <div class="dlg-body">
        ${rows}
      </div>
      <div class="dlg-foot">
        <button class="btn" data-dlg-close>取消</button>
        <button class="btn primary" id="ovSetSave">保存</button>
      </div>
    </div>`;
  openDlg(m);
  m.querySelector('#ovSetSave').addEventListener('click', async () => {
    const patch = {};
    for (const row of m.querySelectorAll('.ov-set-row')) {
      const k = row.dataset.secKey;
      patch[k] = {
        enabled: row.querySelector('.ov-sec-enabled').checked,
        mode: row.querySelector('.ov-sec-mode').value,
      };
    }
    try {
      const r = await api('/admin/console-config', { method: 'PATCH', body: JSON.stringify({ sections: patch }) });
      sections = r.sections;
      closeDlg(m);
      toast('总览展示设置已保存并落盘');
      await loadAll();
    } catch (e) { if (e.message !== '401') toast('✗ ' + e.message, 'bad'); }
  });
}
