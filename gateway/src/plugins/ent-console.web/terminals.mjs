/**
 * 插件页面子模块 · ent-console（在线终端：Desktop 插件心跳）
 * 行可点击 → 弹出完整设备信息详情层。仅被本插件页面包 ./index.mjs 引用。
 */
import { api, $, esc, icon, openDlg } from '/admin/static/contract.mjs';
import { T } from '/admin/static/js/i18n.mjs';

let lastList = [];

function kv(label, value) {
  return `<div class="kv-row"><span class="kv-label">${esc(label)}</span><span class="kv-value">${esc(value ?? '-')}</span></div>`;
}

async function deviceDetailHtml(x) {
  const d = x.device ?? {};
  const rows = [
    kv(T('账号', 'Account'), x.account || T('未登录', 'Not signed in')),
    kv(T('主机名', 'Hostname'), d.hostname),
    kv(T('操作系统', 'OS'), d.platform ? `${d.platform}${d.osVersion ? ' · ' + d.osVersion : ''}` : null),
    kv(T('系统版本', 'OS release'), d.osRelease),
    kv('CPU', d.cpuModel ? T('{m}（{c} 核）', '{m} ({c} cores)', { m: d.cpuModel, c: d.cpuCores }) : null),
    kv(T('内存', 'Memory'), d.memTotalGb ? T('共 {t} GB · 空闲 {f} GB', '{t} GB total · {f} GB free', { t: d.memTotalGb, f: d.memFreeGb }) : null),
    kv(T('系统运行', 'Uptime'), d.uptimeH !== undefined ? T('{h} 小时', '{h} h', { h: d.uptimeH }) : null),
    kv(T('IP 地址', 'IP addresses'), (d.ips ?? []).length ? d.ips.join(T('、', ', ')) : null),
    kv(T('Node 版本', 'Node version'), (x.node_version ?? '').replace('v', '')),
    kv(T('插件版本', 'Plugin version'), d.pluginVersion),
    kv(T('DSH 版本', 'DSH version'), d.dshVersion || null),
    kv('Profile', x.profile),
    kv(T('环境', 'Environment'), x.env),
    kv(T('策略版本', 'Policy version'), x.policy_version),
    kv(T('设备指纹', 'Device fingerprint'), x.device_hash),
    kv(T('最后心跳', 'Last heartbeat'), x.ts_local),
  ];
  const disks = d.disks ?? [];
  const diskRows = disks.length
    ? `<div class="disk-grid">${disks.map((p) =>
        `<div class="disk-item"><b>${esc(p.drive)}</b> ${T('空闲', 'free')} ${esc(p.freeGb)} / ${esc(p.totalGb)} GB</div>`).join('')}</div>`
    : `<div class="kv-empty">${T('未采集到磁盘信息', 'No disk info')}</div>`;
  // 已安装插件（心跳快照上报）：与当前允许清单比对，清单外的标红（管理员一眼定位违规设备）
  const allowed = (await api('/admin/policy-detail').catch(() => null))?.policy?.allowedPlugins ?? [];
  const plugins = Array.isArray(d.plugins) ? d.plugins : null;
  const pluginRows = plugins === null
    ? `<div class="kv-empty">${T('未采集（旧版本员工端插件）', 'Not reported (older client plugin)')}</div>`
    : plugins.length
      ? plugins.map((n) => {
          const bad = allowed.length && !allowed.includes(n);
          return `<span class="badge ${bad ? 'bad' : 'ok'}" style="margin:0 6px 6px 0">${esc(n)}${bad ? T(' · 清单外', ' · not in allowlist') : ''}</span>`;
        }).join('')
      : `<div class="kv-empty">${T('未安装任何插件', 'No plugins installed')}</div>`;
  return `
    <div class="detail-grid">${rows.join('')}</div>
    <div class="detail-sub">${T('已安装插件（与允许清单比对）', 'Installed plugins (checked against allowlist)')}</div>
    <div style="line-height:1.9">${pluginRows}</div>
    <div class="detail-sub">${T('磁盘', 'Disks')}</div>
    ${diskRows}`;
}

export async function loadTerminals() {
  try {
    const t = await api('/admin/terminals');
    const list = t.terminals ?? [];
    lastList = list;
    return list;
  } catch { /* 401 已处理 */ return []; }
}

/** 表格形态渲染（返回 HTML，装进容器后由 bindTerminalsEvents 接管点击） */
export function renderTerminals(list) {
  lastList = list;
  return `<table>
    <thead><tr><th>${T('设备指纹', 'Fingerprint')}</th><th>${T('账号', 'Account')}</th><th>${T('主机名', 'Hostname')}</th><th>${T('环境', 'Env')}</th><th>${T('最后心跳', 'Last heartbeat')}</th><th></th></tr></thead>
    <tbody id="termBody">${list.length ? list.map((x, i) =>
      `<tr class="term-row" data-idx="${i}" title="${T('点击查看完整设备信息', 'Click for full device info')}">
         <td class="mono">${esc(x.device_hash?.slice(0, 10))}…</td>
         <td>${esc(x.account || T('未登录', 'Not signed in'))}</td>
         <td>${esc(x.device?.hostname || '-')}</td>
         <td><span class="badge ${x.env === 'desktop' ? 'ok' : 'dim'}">${esc(x.env ?? '-')}</span></td>
         <td class="mono">${esc(x.ts_local ?? '-')}</td>
         <td class="mono term-more">${T('详情 ›', 'Details ›')}</td>
       </tr>`
    ).join('') : `<tr><td colspan="6" class="empty">${T('暂无终端心跳 · Desktop 插件接入后显示', 'No device heartbeats yet · shown once Desktop plugins connect')}</td></tr>`}</tbody></table>`;
}

/** 卡片墙形态渲染（每台终端一张卡） */
export function renderTerminalsCards(list) {
  lastList = list;
  if (!list.length) return `<div class="empty">${T('暂无终端心跳 · Desktop 插件接入后显示', 'No device heartbeats yet · shown once Desktop plugins connect')}</div>`;
  return `<div class="grid4" style="margin-top:6px" id="termCards">${list.map((x, i) => `
    <div class="kpi stat-card term-row" data-idx="${i}" style="cursor:pointer" title="${T('点击查看完整设备信息', 'Click for full device info')}">
      <div class="lab">${icon('monitor', { size: 13 })} ${esc(x.device?.hostname || T('未知主机', 'Unknown host'))}</div>
      <div class="val" style="font-size:16px">${esc(x.account || T('未登录', 'Not signed in'))}</div>
      <div class="sub2">${esc(x.env ?? '-')} · ${esc(x.ts_local ?? '-')}</div>
    </div>`).join('')}</div>`;
}

/** 详情弹层（事件绑定一次；表格行与卡片行都挂 .term-row） */
export function bindTerminalsEvents() {
  const host = document.getElementById('ovDynamic');
  if (!host || host.dataset.termBound) return;
  host.dataset.termBound = '1';
  host.addEventListener('click', (e) => {
    const tr = e.target.closest('.term-row');
    if (!tr) return;
    const x = lastList[Number(tr.dataset.idx)];
    if (!x) return;
    openTermModal(x);
  });
}

async function openTermModal(x) {
  let m = document.getElementById('termModal');
  if (!m) {
    m = document.createElement('div');
    m.id = 'termModal';
    m.className = 'dlg-mask';
    document.body.appendChild(m);
  }
  m.innerHTML = `
    <div class="dlg md" role="dialog" aria-modal="true">
      <div class="dlg-head">
        <h2>${T('终端设备详情', 'Device details')} · ${esc(x.account || T('未登录', 'Not signed in'))}</h2>
        <button class="dlg-x" data-dlg-close title="${T('关闭 (Esc)', 'Close (Esc)')}">${icon('x', { size: 16 })}</button>
      </div>
      <div class="dlg-body"><div class="empty">${T('加载中…', 'Loading…')}</div></div>
    </div>`;
  openDlg(m);
  m.querySelector('.dlg-body').innerHTML = await deviceDetailHtml(x);
}
