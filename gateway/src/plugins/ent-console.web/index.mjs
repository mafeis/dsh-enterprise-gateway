/**
 * 插件自带页面 · ent-console（运营总览）
 * 数据：/admin/stats + /admin/terminals（./terminals.mjs）
 * 设置面：每区块「是否显示 + 展示方式」（kpi 数值卡 / table 表格 / bar 对比条 / cards 卡片墙 / auto 自动）
 * 配置经 GET/PATCH /admin/console-config 落盘持久化，即时生效
 */
import { api, $, fmtTok, esc, icon, toast, openDlg, closeDlg } from '/admin/static/contract.mjs';
import { T, getLang, isEn } from '/admin/static/js/i18n.mjs';
import { loadTerminals, bindTerminalsEvents, renderTerminals, renderTerminalsCards } from './terminals.mjs';
import { renderInstalls, bindInstallsEvents } from './installs.mjs';

let sections = {};
let labels = {};
let modes = {};
let modeLabels = {};
let lastStats = null;

/** 区块/展示方式标签：语言选择已在 loadAll 合并进 labels/modeLabels，这里直接取 */
const secLabel = (k) => labels[k];
const secModeLabel = (v) => (modeLabels[v] ?? v);

export default {
  page: 'ent-console',
  html: `
  <div class="headrow" data-ent-page="ent-console">
    <div><h1>${T('运营总览','Overview')}</h1></div>
    <div class="sp"></div>
    <button class="btn sm" id="ovSettingsBtn" title="${T('设置本页展示内容与方式','Configure sections')}"></button>
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
    // 服务端下发 zh/en 两组标签（labels/labelsEn、modeLabels/modeLabelsEn）：英文界面用 en 组，其余回退 zh
    const en = getLang() === 'en';
    labels = en ? { ...(c.labels ?? {}), ...(c.labelsEn ?? {}) } : (c.labels ?? {});
    modes = c.modes ?? {};
    modeLabels = en ? { ...(c.modeLabels ?? {}), ...(c.modeLabelsEn ?? {}) } : (c.modeLabels ?? {});
  } catch { sections = {}; }

  // 2. 数据（一次拉取，各区块按各自形态渲染）
  lastStats = null;
  const needStats = ['req', 'tok', 'users', 'dlp', 'usage'].some((k) => sections[k]?.enabled !== false);
  if (needStats) {
    try { lastStats = await api('/admin/stats'); } catch { /* 401 已在 contract 处理 */ }
  }
  // 商业授权状态（超限才显示横幅，正常态不打扰）
  let license = null;
  try { license = await api('/admin/license'); } catch { /* 401 */ }
  let terminals = [];
  if (sections.terminals?.enabled !== false) {
    try { terminals = (await api('/admin/terminals')).terminals ?? []; } catch { /* 401 */ }
  }
  let installsData = null;
  let violData = [];
  let violErr = '';
  if (sections.installs?.enabled !== false) {
    try { installsData = await api('/admin/plugin-installs'); } catch { /* 401 */ }
    try { violData = (await api('/admin/plugin-violations')).violations ?? []; } catch (e) { violErr = e.message === '401' ? '' : e.message; }
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
  // —— 商业授权提醒（仅超限/无效时出现） ——
  if (license && (license.state === 'over-limit' || license.state === 'invalid')) {
    const licMsg = esc(isEn() ? (license.messageEn ?? license.message) : license.message);
    parts.push(`<div class="notebox warn" style="margin-bottom:16px"><b>${T('商业授权提醒','Commercial license')}</b> — ${licMsg} · <a href="#/license">${T('到商业授权页录入授权码','Enter the key on the License page')}</a></div>`);
  }
  // —— KPI 区块（统一容器：全部同形态才组合渲染；混合形态各自渲染） ——
  if (kpiKeys.length) {
    if (kpiAsKpi) {
      parts.push(`<div class="grid4" style="margin-bottom:20px">${kpiKeys.map((k) => kpiCard(k)).join('')}</div>`);
    } else if (kpiAsTable) {
      parts.push(sectionCard('kpi', T('今日运营指标','Today metrics'), tableHtml(kpiKeys.map((k) => metricRow(k)))));
    } else if (kpiAsBars) {
      parts.push(sectionCard('kpi', T('今日运营指标','Today metrics'), kpiKeys.map((k) => barRow(k, barValue(k), barMax(kpiKeys))).join('')));
    } else if (kpiAsCards) {
      parts.push(`<div class="grid4" style="margin-bottom:20px">${kpiKeys.map((k) => statCard(k)).join('')}</div>`);
    } else {
      // 混合形态：逐个渲染（kpi/bar → 卡片流；table → 表格卡）
      for (const k of kpiKeys) {
        const m = resolveMode(k);
        if (m === 'kpi') parts.push(`<div class="grid4" style="margin-bottom:20px">${kpiCard(k)}</div>`);
        else if (m === 'cards') parts.push(`<div class="grid4" style="margin-bottom:20px">${statCard(k)}</div>`);
        else if (m === 'bar') parts.push(sectionCard(k, secLabel(k), barRow(k, barValue(k), barMax(kpiKeys))));
        else parts.push(sectionCard(k, secLabel(k), tableHtml([metricRow(k)])));
      }
    }
  }
  // —— 在线终端 ——
  if (sections.terminals?.enabled !== false) {
    const m = resolveMode('terminals');
    parts.push(m === 'cards'
      ? sectionCard('terminals', T('在线终端','Online devices'), `<span class="badge dim">${terminals.length} ${T('台','devices')}</span>`, renderTerminalsCards(terminals))
      : sectionCard('terminals', T('在线终端','Online devices'), `<span class="badge dim" id="termCount">${terminals.length}</span>`, renderTerminals(terminals)));
  }
  // —— 插件安装总览 ——
  if (sections.installs?.enabled !== false && installsData) {
    if (violErr) installsData.violErr = violErr
    parts.push(sectionCard('installs', T('插件安装总览','Plugin installs'), installsBadge(installsData, violData), renderInstalls(installsData, violData)));
  }
  // —— 用户用量 TOP ——
  if (sections.usage?.enabled !== false) {
    const m = resolveMode('usage');
    const rows = lastStats?.byUser ?? [];
    if (m === 'table') parts.push(sectionCard('usage', T('近 7 日用户用量 TOP','7-day usage top'), usageTable(rows)));
    else if (m === 'bar') parts.push(sectionCard('usage', T('近 7 日用户用量 TOP','7-day usage top'), usageBars(rows)));
    else if (m === 'cards') parts.push(sectionCard('usage', T('近 7 日用户用量 TOP','7-day usage top'), usageCards(rows)));
    else parts.push(sectionCard('usage', T('近 7 日用户用量 TOP','7-day usage top'), usageTable(rows)));
  }
  host.innerHTML = parts.join('');
  bindTerminalsEvents();
  // 插件安装总览：搜索输入 → 只重绘整页（数据已在本地，重绘开销可忽略；输入值经 renderInstalls 回填保焦点）
  bindInstallsEvents(() => { if (installsData) { const el = document.querySelector('[data-sec="installs"]'); if (el) el.querySelector('.tablewrap')?.closest('.card') && (el.outerHTML = sectionCard('installs', T('插件安装总览','Plugin installs'), installsBadge(installsData, violData), renderInstalls(installsData, violData))); } });
}

/** 插件安装总览徽章（标题旁统计） */
function installsBadge(d, violations = []) {
  // 概览口径：N 项 = 去重后的插件种数；清单外也按种数计
  const plugins = new Set((d.installs ?? []).map((r) => r.plugin));
  const bad = new Set((d.installs ?? []).filter((r) => r.violation).map((r) => r.plugin)).size;
  return `<span class="badge dim">${plugins.size} ${T('种','types')}</span>${bad ? ` <span class="badge bad">${bad} ${T('清单外','off-list')}</span>` : ''}${violations.length ? ` <span class="badge dim">${T('历史 {n} 台次','{n} historical',{ n: violations.length })}</span>` : ''}`;
}

/* ---------- 区块渲染原语 ---------- */

/** 区块卡片容器（titleId 用于给各区块稳定锚点） */
function sectionCard(key, title, badge = '', bodyHtml = '') {
  const anchor = key === 'kpi' ? T('今日运营指标','Today metrics') : title;
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
    req: T('DLP 标记 {d} · 拦截 {b}','DLP flagged {d} · blocked {b}',{ d: s.dlp ?? 0, b: s.blocked ?? 0 }),
    tok: T('入 {i} / 出 {o}','in {i} / out {o}',{ i: fmtTok(s.tin), o: fmtTok(s.tout) }),
    users: T('今日 distinct','Distinct today'),
    dlp: T('拦截 = 请求未到上游','Blocked = request never reached upstream'),
  }[key] ?? '';
  const color = key === 'dlp' && (s.blocked ?? 0) > 0 ? ' style="color:var(--bad)"' : '';
  return `<div class="kpi" data-sec="${key}"><div class="lab">${esc(secLabel(key))}</div><div class="val"${color}>${v}</div><div class="sub2">${sub}</div></div>`;
}

/** 强调数值卡（cards 形态：图标 + 大数字 + 说明） */
function statCard(key) {
  const icons = { req: 'activity', tok: 'database', users: 'users', dlp: 'shield-alert' };
  const s = lastStats?.today ?? {};
  const v = { req: s.total ?? 0, tok: fmtTok((s.tin ?? 0) + (s.tout ?? 0)), users: s.users ?? 0, dlp: s.blocked ?? 0 }[key] ?? '—';
  const sub = { dlp: T('今日拦截','Blocked today'), tok: T('入+出合计','In + out total'), users: T('今日 distinct','Distinct today'), req: T('今日请求','Requests today') }[key] ?? '';
  return `<div class="kpi stat-card" data-sec="${key}"><div class="lab">${icon(icons[key] ?? 'activity', { size: 14 })} ${esc(secLabel(key))}</div><div class="val">${v}</div><div class="sub2">${sub}</div></div>`;
}

/** 表格行（单指标 / 指标合并表通用） */
function metricRow(key) {
  const s = lastStats?.today ?? {};
  const v = { req: s.total ?? 0, tok: fmtTok((s.tin ?? 0) + (s.tout ?? 0)), users: s.users ?? 0, dlp: `${s.dlp ?? 0} / ${s.blocked ?? 0}` }[key] ?? '—';
  return { cells: [secLabel(key), v], num: [false, true] };
}

function tableHtml(rows) {
  return `<div class="tablewrap"><table><thead><tr><th>${T('指标','Metric')}</th><th class="num">${T('值','Value')}</th></tr></thead><tbody>${rows.map((r) =>
    `<tr><td>${esc(r.cells[0])}</td><td class="num"><b>${esc(r.cells[1])}</b></td></tr>`).join('')}</tbody></table></div>`;
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
    <div style="display:flex;justify-content:space-between;font-size:13px"><span>${esc(secLabel(key))}</span><b class="num">${esc(show)}</b></div>
    <div class="bar" style="margin:4px 0 0"><i style="width:${pct}%;background:var(--accent)"></i></div>
  </div>`;
}

/** usage 的三种形态 */
function usageTable(rows) {
  return `<div class="tablewrap"><table>
    <thead><tr><th>${T('用户','User')}</th><th class="num">${T('请求数','Requests')}</th><th class="num">${T('Token 总量','Total tokens')}</th><th>${T('占比','Share')}</th></tr></thead>
    <tbody>${rows.length ? rows.map((u) => {
      const pct = Math.round(u.tokens / ((rows.reduce((a, b) => a + b.tokens, 0)) || 1) * 100);
      return `<tr><td><b>${esc(u.user_name)}</b></td><td class="num">${u.requests}</td><td class="num">${fmtTok(u.tokens)}</td>
        <td><div class="bar" style="margin:0"><i style="width:${pct}%;background:var(--accent)"></i></div></td></tr>`;
    }).join('') : '<tr><td colspan="4" class="empty">' + T('近 7 日暂无用量','No usage in 7 days') + '</td></tr>'}</tbody></table></div>`;
}
function usageBars(rows) {
  if (!rows.length) return '<div class="empty">' + T('近 7 日暂无用量','No usage in 7 days') + '</div>';
  const max = Math.max(...rows.map((u) => u.tokens), 1);
  return `<div style="padding:4px 0">${rows.map((u) => {
    const pct = Math.round(u.tokens / max * 100);
    return `<div style="margin-bottom:11px">
      <div style="display:flex;justify-content:space-between;font-size:13px"><span><b>${esc(u.user_name)}</b> · ${T('{n} 次','{n} reqs',{ n: u.requests })}</span><b class="num">${fmtTok(u.tokens)}</b></div>
      <div class="bar" style="margin:4px 0 0"><i style="width:${pct}%;background:var(--accent)"></i></div>
    </div>`;
  }).join('')}</div>`;
}
function usageCards(rows) {
  if (!rows.length) return '<div class="empty">' + T('近 7 日暂无用量','No usage in 7 days') + '</div>';
  return `<div class="grid4" style="margin-top:6px">${rows.map((u) => `
    <div class="kpi stat-card"><div class="lab">${icon('users', { size: 13 })} ${esc(u.user_name)}</div>
    <div class="val">${fmtTok(u.tokens)}</div><div class="sub2">${T('{n} 次请求','{n} requests',{ n: u.requests })}</div></div>`).join('')}</div>`;
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
  const rows = Object.entries(modes).map(([k, modeList]) => {
    const cur = sections[k] ?? { enabled: true, mode: 'auto' };
    const opts = (modeList ?? ['auto']).map((v) =>
      `<option value="${v}" ${cur.mode === v ? 'selected' : ''}>${esc(secModeLabel(v))}</option>`).join('');
    return `<div class="ov-set-row" data-sec-key="${k}">
      <input type="checkbox" class="ov-sec-enabled" ${cur.enabled !== false ? 'checked' : ''}>
      <span class="ov-sec-label">${esc(secLabel(k))}</span>
      <select class="ov-sec-mode">${opts}</select>
    </div>`;
  }).join('');
  m.innerHTML = `
    <div class="dlg sm" role="dialog" aria-modal="true">
      <div class="dlg-head">
        <h2>${T('总览展示设置','Overview settings')}</h2>
        <button class="dlg-x" data-dlg-close title="${T('关闭 (Esc)','Close (Esc)')}">${icon('x', { size: 16 })}</button>
      </div>
      <div class="dlg-body">
        ${rows}
      </div>
      <div class="dlg-foot">
        <button class="btn" data-dlg-close>${T('取消','Cancel')}</button>
        <button class="btn primary" id="ovSetSave">${T('保存','Save')}</button>
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
      toast(T('总览展示设置已保存并落盘','Overview settings saved'));
      await loadAll();
    } catch (e) { if (e.message !== '401') toast('✗ ' + e.message, 'bad'); }
  });
}
