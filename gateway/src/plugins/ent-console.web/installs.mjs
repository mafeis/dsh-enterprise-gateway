/**
 * 插件页面子模块 · ent-console（插件安装总览）
 * 每行 = 设备 × 插件：谁装的（账号）、哪台（主机/指纹）、什么环境、首次/最近被监测到的时间。
 * 违规（允许清单外）行标红置顶。仅被本插件页面包 ./index.mjs 引用。
 */
import { esc } from '/admin/static/contract.mjs';

let lastData = { installs: [], allowedCount: 0 };
let query = '';

/** 表格渲染（返回 HTML；由 index.mjs 装进区块容器） */
export function renderInstalls(data) {
  lastData = data;
  const { installs = [], allowedCount = 0 } = data;
  const q = query.trim().toLowerCase();
  const rows = installs.filter((r) => !q
    || r.plugin.toLowerCase().includes(q)
    || String(r.account).toLowerCase().includes(q)
    || String(r.hostname).toLowerCase().includes(q));
  const sorted = rows.slice().sort((a, b) => (b.violation === true) - (a.violation === true)
    || a.plugin.localeCompare(b.plugin)
    || String(b.lastSeen).localeCompare(String(a.lastSeen)));
  const body = sorted.map((r) => `
    <tr${r.violation ? ' style="background:#fef2f2"' : ''}>
      <td class="mono" style="font-size:12px;font-weight:600">${esc(r.plugin)}${r.violation ? ' <span class="badge bad">清单外</span>' : ''}</td>
      <td>${esc(r.account)}</td>
      <td>${esc(r.hostname || '-')}</td>
      <td><span class="badge ${r.env === 'desktop' ? 'ok' : 'dim'}">${esc(r.env || '-')}</span></td>
      <td class="mono" style="font-size:11.5px">${esc(r.firstSeen ?? '-')}</td>
      <td class="mono" style="font-size:11.5px">${esc(r.lastSeen ?? '-')}</td>
    </tr>`).join('')
    || `<tr><td colspan="6" class="empty">${q ? '没有匹配项' : '暂无插件上报（员工端插件 ≥0.9.5 且已登录后开始采集）'}</td></tr>`;
  return `
    <div style="display:flex;gap:8px;margin-bottom:10px">
      <input class="input" id="instSearch" placeholder="搜插件名 / 账号 / 主机名…" value="${esc(query)}" style="width:220px;font-size:12px;height:28px">
      <span class="crumb" style="margin:0;align-self:center">当前允许清单 ${allowedCount} 项 · 红行 = 清单外</span>
    </div>
    <div class="tablewrap" style="max-height:420px;overflow:auto">
      <table>
        <thead><tr><th>插件</th><th>账号</th><th>主机名</th><th>环境</th><th>首次发现</th><th>最近心跳</th></tr></thead>
        <tbody>${body}</tbody>
      </table>
    </div>`;
}

/** 搜索：输入 → 只重绘本区块（index.mjs 在区块渲染后调用一次） */
export function bindInstallsEvents(rerender) {
  const host = document.getElementById('ovDynamic');
  if (!host || host.dataset.instBound) return;
  host.dataset.instBound = '1';
  host.addEventListener('input', (e) => {
    if (e.target.id !== 'instSearch') return;
    query = e.target.value;
    rerender?.();
  });
}
