/**
 * 插件页面子模块 · ent-console（插件安装总览）
 * 主表：每行 = 设备 × 插件（当前在装）。清单外历史：概览口径，每行 = 插件 × 影响台数；
 * 具体到人/机的明细点「详情」在弹窗里看。仅被本插件页面包 ./index.mjs 引用。
 */
import { esc, openDlg } from '/admin/static/contract.mjs';
import { T } from '/admin/static/js/i18n.mjs';

let lastData = { installs: [], allowedCount: 0 };
let lastViolations = [];
let query = '';

/** 清单外历史概览聚合：插件 → 台数 / 在装台数 / 首末出现时间 */
function violSummary(violations, q) {
  const map = new Map();
  for (const r of violations) {
    if (q && !r.plugin.toLowerCase().includes(q)
      && !String(r.account ?? '').toLowerCase().includes(q)
      && !String(r.hostname ?? '').toLowerCase().includes(q)) continue;
    const e = map.get(r.plugin) ?? { plugin: r.plugin, devices: 0, active: 0, first: null, last: null, rows: [] };
    e.devices++;
    if (r.active) e.active++;
    if (!e.first || String(r.first_local ?? '') < e.first) e.first = r.first_local;
    if (!e.last || String(r.last_local ?? '') > e.last) e.last = r.last_local;
    e.rows.push(r);
    map.set(r.plugin, e);
  }
  return [...map.values()].sort((a, b) => b.devices - a.devices || b.active - a.active || a.plugin.localeCompare(b.plugin));
}

/** 在装概览聚合：插件 → 台数 / 最早最晚时间（与清单外历史同口径，每插件一行） */
function instSummary(installs, q) {
  const map = new Map();
  for (const r of installs) {
    if (q && !r.plugin.toLowerCase().includes(q)
      && !String(r.account).toLowerCase().includes(q)
      && !String(r.hostname).toLowerCase().includes(q)) continue;
    const e = map.get(r.plugin) ?? { plugin: r.plugin, violation: false, devices: 0, first: null, last: null };
    e.devices++;
    if (r.violation) e.violation = true;
    if (!e.first || String(r.firstSeen ?? '') < e.first) e.first = r.firstSeen;
    if (!e.last || String(r.lastSeen ?? '') > e.last) e.last = r.lastSeen;
    map.set(r.plugin, e);
  }
  return [...map.values()].sort((a, b) => (b.violation === true) - (a.violation === true)
    || b.devices - a.devices || a.plugin.localeCompare(b.plugin));
}

/** 表格渲染（返回 HTML；由 index.mjs 装进区块容器） */
export function renderInstalls(data, violations = []) {
  lastData = data;
  lastViolations = violations;
  const { installs = [], allowedCount = 0 } = data;
  const q = query.trim().toLowerCase();
  const summary = instSummary(installs, q);
  const body = summary.map((e) => `
    <tr${e.violation ? ' style="background:#fef2f2"' : ''}>
      <td class="mono" style="font-size:12px;font-weight:600">${esc(e.plugin)}${e.violation ? ' <span class="badge bad">' + T('清单外','off-list') + '</span>' : ''}</td>
      <td><span class="badge dim">${e.devices} ${T('台','devices')}</span></td>
      <td class="mono" style="font-size:11.5px">${esc(e.first ?? '-')}</td>
      <td class="mono" style="font-size:11.5px">${esc(e.last ?? '-')}</td>
      <td><button class="btn sm" data-inst-detail="${esc(e.plugin)}">${T('详情','Details')}</button></td>
    </tr>`).join('')
    || `<tr><td colspan="5" class="empty">${q ? T('没有匹配项','No matches') : T('暂无插件上报（员工端插件 ≥0.9.5 且已登录后开始采集）','No plugin reports (client plugin ≥0.9.5, signed in)')}</td></tr>`;
  const violSummaryRows = violSummary(lastViolations, q);
  const violRows = violSummaryRows.map((e) => `
    <tr style="background:#fef2f2">
      <td class="mono" style="font-size:12px;font-weight:600">${esc(e.plugin)}</td>
      <td><span class="badge bad">${e.devices} ${T('台','devices')}</span></td>
      <td>${e.active ? `<span class="badge bad">${e.active} ${T('在装','installed')}</span>` : `<span class="badge dim">${T('全部已清除','All cleared')}</span>`}</td>
      <td class="mono" style="font-size:11.5px">${esc(e.first ?? '-')}</td>
      <td class="mono" style="font-size:11.5px">${esc(e.last ?? '-')}</td>
      <td><button class="btn sm" data-viol-detail="${esc(e.plugin)}">${T('详情','Details')}</button></td>
    </tr>`).join('')
    || `<tr><td colspan="6" class="empty">${data.violErr ? T('✗ 历史加载失败：{e}','✗ Failed to load history: {e}',{ e: esc(data.violErr) }) : T('暂无清单外记录','No off-list records')}</td></tr>`;
  return `
    <div style="display:flex;gap:8px;margin-bottom:10px">
      <input class="input" id="instSearch" placeholder="${T('搜插件名 / 账号 / 主机名…','Search plugin / account / host…')}" value="${esc(query)}" style="width:220px;font-size:12px;height:28px">
      <span class="crumb" style="margin:0;align-self:center">${T('当前允许清单 {n} 项 · 红行 = 清单外','Allowlist {n} · red rows = off-list',{ n: allowedCount })}</span>
    </div>
    <div class="tablewrap" style="max-height:420px;overflow:auto">
      <table>
        <thead><tr><th>${T('插件','Plugin')}</th><th>${T('设备数','Devices')}</th><th>${T('首次发现','First seen')}</th><th>${T('最近心跳','Last heartbeat')}</th><th class="num">${T('操作','Actions')}</th></tr></thead>
        <tbody>${body}</tbody>
      </table>
    </div>
    <div style="margin-top:16px;font-weight:600;font-size:13px">${T('清单外历史','Off-list history')} <span class="badge ${lastViolations.length ? 'bad' : 'dim'}">${lastViolations.length} ${T('台次','devices')}</span><span class="crumb" style="margin-left:8px">${T('含装过后已清除的 · 点「详情」看涉及设备','Includes uninstalled · Details shows devices')}</span></div>
    <div class="tablewrap" style="max-height:300px;overflow:auto;margin-top:8px">
      <table>
        <thead><tr><th>${T('插件','Plugin')}</th><th>${T('影响设备','Affected devices')}</th><th>${T('当前状态','Status')}</th><th>${T('首次出现','First seen')}</th><th>${T('最近出现','Last seen')}</th><th class="num">${T('操作','Actions')}</th></tr></thead>
        <tbody>${violRows}</tbody>
      </table>
    </div>
    ${violDetailDlgHtml()}${instDetailDlgHtml()}`;
}

/** 详情弹窗骨架（随区块渲染注入，单例） */
function violDetailDlgHtml() {
  return `
  <div class="dlg-mask" id="violDetailDlg" hidden>
    <div class="dlg md">
      <div class="dlg-head">
        <h2><span class="bar"></span>${T('清单外详情','Off-list details')} · <span class="mono" id="vdName">—</span></h2>
        <button class="dlg-x" data-dlg-close title="${T('关闭','Close')}">✕</button>
      </div>
      <div class="dlg-body">
        <div class="tablewrap" style="max-height:420px">
          <table>
            <thead><tr><th>${T('账号','Account')}</th><th>${T('主机名','Hostname')}</th><th>${T('环境','Env')}</th><th>${T('首次出现','First seen')}</th><th>${T('最近出现','Last seen')}</th><th>${T('状态','Status')}</th></tr></thead>
            <tbody id="vdBody"></tbody>
          </table>
        </div>
      </div>
      <div class="dlg-foot">
        <span class="err" id="vdErr"></span>
        <button class="btn" data-dlg-close>${T('关闭','Close')}</button>
      </div>
    </div>
  </div>`;
}

/** 安装明细弹窗（在装表共用）：某插件 → 装它的所有设备 */
function instDetailDlgHtml() {
  return `
  <div class="dlg-mask" id="instDetailDlg" hidden>
    <div class="dlg md">
      <div class="dlg-head">
        <h2><span class="bar"></span>${T('安装详情','Install details')} · <span class="mono" id="idName">—</span></h2>
        <button class="dlg-x" data-dlg-close title="${T('关闭','Close')}">✕</button>
      </div>
      <div class="dlg-body">
        <div class="tablewrap" style="max-height:420px">
          <table>
            <thead><tr><th>${T('账号','Account')}</th><th>${T('主机名','Hostname')}</th><th>${T('环境','Env')}</th><th>${T('首次发现','First seen')}</th><th>${T('最近心跳','Last heartbeat')}</th></tr></thead>
            <tbody id="idBody"></tbody>
          </table>
        </div>
      </div>
      <div class="dlg-foot">
        <button class="btn" data-dlg-close>${T('关闭','Close')}</button>
      </div>
    </div>
  </div>`;
}

/** 打开在装明细弹窗：聚合 lastData 里同名插件的所有设备行 */
function openInstDetail(plugin) {
  const dlg = document.getElementById('instDetailDlg');
  if (!dlg) return;
  document.getElementById('idName').textContent = plugin;
  const rows = (lastData.installs ?? []).filter((r) => r.plugin === plugin)
    .sort((a, b) => String(b.lastSeen ?? '').localeCompare(String(a.lastSeen ?? '')));
  document.getElementById('idBody').innerHTML = rows.map((r) => `
    <tr${r.violation ? ' style="background:#fef2f2"' : ''}>
      <td>${esc(r.account || '-')}</td>
      <td>${esc(r.hostname || '-')}</td>
      <td><span class="badge ${r.env === 'desktop' ? 'ok' : 'dim'}">${esc(r.env || '-')}</span></td>
      <td class="mono" style="font-size:11.5px">${esc(r.firstSeen ?? '-')}</td>
      <td class="mono" style="font-size:11.5px">${esc(r.lastSeen ?? '-')}</td>
    </tr>`).join('');
  openDlg(dlg);
}

/** 打开某插件的出现史明细弹窗 */
function openViolDetail(plugin) {
  const dlg = document.getElementById('violDetailDlg');
  if (!dlg) return;
  document.getElementById('vdName').textContent = plugin;
  const rows = lastViolations.filter((r) => r.plugin === plugin)
    .sort((a, b) => String(b.last_local ?? '').localeCompare(String(a.last_local ?? '')));
  document.getElementById('vdBody').innerHTML = rows.map((r) => `
    <tr${r.active ? ' style="background:#fef2f2"' : ''}>
      <td>${esc(r.account || '-')}</td>
      <td>${esc(r.hostname || '-')}</td>
      <td><span class="badge ${r.env === 'desktop' ? 'ok' : 'dim'}">${esc(r.env || '-')}</span></td>
      <td class="mono" style="font-size:11.5px">${esc(r.first_local ?? '-')}</td>
      <td class="mono" style="font-size:11.5px">${esc(r.last_local ?? '-')}</td>
      <td>${r.active ? `<span class="badge bad">${T('在装','Installed')}</span>` : `<span class="badge dim">${T('已清除','Removed')}</span>`}</td>
    </tr>`).join('');
  openDlg(dlg);
}

/** 搜索 + 详情按钮事件：输入 → 重绘；详情 → 弹窗（index.mjs 在区块渲染后调用一次） */
export function bindInstallsEvents(rerender) {
  const host = document.getElementById('ovDynamic');
  if (!host || host.dataset.instBound) return;
  host.dataset.instBound = '1';
  host.addEventListener('input', (e) => {
    if (e.target.id !== 'instSearch') return;
    query = e.target.value;
    rerender?.();
  });
  host.addEventListener('click', (e) => {
    const b = e.target.closest('[data-viol-detail]');
    if (b) return openViolDetail(b.dataset.violDetail);
    const i = e.target.closest('[data-inst-detail]');
    if (i) return openInstDetail(i.dataset.instDetail);
  });
}
