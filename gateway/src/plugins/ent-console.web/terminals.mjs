/**
 * 插件页面子模块 · ent-console（在线终端：Desktop 插件心跳）
 * 行可点击 → 弹出完整设备信息详情层。仅被本插件页面包 ./index.mjs 引用。
 */
import { api, $, esc, icon, openDlg } from '/admin/static/contract.mjs';

let lastList = [];

function kv(label, value) {
  return `<div class="kv-row"><span class="kv-label">${esc(label)}</span><span class="kv-value">${esc(value ?? '-')}</span></div>`;
}

async function deviceDetailHtml(x) {
  const d = x.device ?? {};
  const rows = [
    kv('账号', x.account || '未登录'),
    kv('主机名', d.hostname),
    kv('操作系统', d.platform ? `${d.platform}${d.osVersion ? ' · ' + d.osVersion : ''}` : null),
    kv('系统版本', d.osRelease),
    kv('CPU', d.cpuModel ? `${d.cpuModel}（${d.cpuCores} 核）` : null),
    kv('内存', d.memTotalGb ? `共 ${d.memTotalGb} GB · 空闲 ${d.memFreeGb} GB` : null),
    kv('系统运行', d.uptimeH !== undefined ? `${d.uptimeH} 小时` : null),
    kv('IP 地址', (d.ips ?? []).length ? d.ips.join('、') : null),
    kv('Node 版本', (x.node_version ?? '').replace('v', '')),
    kv('插件版本', d.pluginVersion),
    kv('DSH 版本', d.dshVersion || null),
    kv('Profile', x.profile),
    kv('环境', x.env),
    kv('策略版本', x.policy_version),
    kv('设备指纹', x.device_hash),
    kv('最后心跳', x.ts_local),
  ];
  const disks = d.disks ?? [];
  const diskRows = disks.length
    ? `<div class="disk-grid">${disks.map((p) =>
        `<div class="disk-item"><b>${esc(p.drive)}</b> 空闲 ${esc(p.freeGb)} / ${esc(p.totalGb)} GB</div>`).join('')}</div>`
    : '<div class="kv-empty">未采集到磁盘信息</div>';
  // 已安装插件（心跳快照上报）：与当前允许清单比对，清单外的标红（管理员一眼定位违规设备）
  const allowed = (await api('/admin/policy-detail').catch(() => null))?.policy?.allowedPlugins ?? [];
  const plugins = Array.isArray(d.plugins) ? d.plugins : null;
  const pluginRows = plugins === null
    ? '<div class="kv-empty">未采集（旧版本员工端插件）</div>'
    : plugins.length
      ? plugins.map((n) => {
          const bad = allowed.length && !allowed.includes(n);
          return `<span class="badge ${bad ? 'bad' : 'ok'}" style="margin:0 6px 6px 0">${esc(n)}${bad ? ' · 清单外' : ''}</span>`;
        }).join('')
      : '<div class="kv-empty">未安装任何插件</div>';
  return `
    <div class="detail-grid">${rows.join('')}</div>
    <div class="detail-sub">已安装插件（与允许清单比对）</div>
    <div style="line-height:1.9">${pluginRows}</div>
    <div class="detail-sub">磁盘</div>
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
    <thead><tr><th>设备指纹</th><th>账号</th><th>主机名</th><th>环境</th><th>最后心跳</th><th></th></tr></thead>
    <tbody id="termBody">${list.length ? list.map((x, i) =>
      `<tr class="term-row" data-idx="${i}" title="点击查看完整设备信息">
         <td class="mono">${esc(x.device_hash?.slice(0, 10))}…</td>
         <td>${esc(x.account || '未登录')}</td>
         <td>${esc(x.device?.hostname || '-')}</td>
         <td><span class="badge ${x.env === 'desktop' ? 'ok' : 'dim'}">${esc(x.env ?? '-')}</span></td>
         <td class="mono">${esc(x.ts_local ?? '-')}</td>
         <td class="mono term-more">详情 ›</td>
       </tr>`
    ).join('') : '<tr><td colspan="6" class="empty">暂无终端心跳 · Desktop 插件接入后显示</td></tr>'}</tbody></table>`;
}

/** 卡片墙形态渲染（每台终端一张卡） */
export function renderTerminalsCards(list) {
  lastList = list;
  if (!list.length) return '<div class="empty">暂无终端心跳 · Desktop 插件接入后显示</div>';
  return `<div class="grid4" style="margin-top:6px" id="termCards">${list.map((x, i) => `
    <div class="kpi stat-card term-row" data-idx="${i}" style="cursor:pointer" title="点击查看完整设备信息">
      <div class="lab">${icon('monitor', { size: 13 })} ${esc(x.device?.hostname || '未知主机')}</div>
      <div class="val" style="font-size:16px">${esc(x.account || '未登录')}</div>
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
        <h2>终端设备详情 · ${esc(x.account || '未登录')}</h2>
        <button class="dlg-x" data-dlg-close title="关闭 (Esc)">${icon('x', { size: 16 })}</button>
      </div>
      <div class="dlg-body"><div class="empty">加载中…</div></div>
    </div>`;
  openDlg(m);
  m.querySelector('.dlg-body').innerHTML = await deviceDetailHtml(x);
}
