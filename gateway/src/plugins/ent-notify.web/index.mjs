/**
 * 插件自带页面 · ent-notify（通知告警事件流）
 * 数据源：GET /admin/notify/recent（本插件提供）
 */
import { api, $, esc, icon } from '/admin/static/contract.mjs';

const TYPE_LABEL = {
  'dlp.blocked': ['shield-alert', 'DLP 拦截', 'l-biz'],
  'upstream.failover': ['activity', '上游容灾', 'l-ext'],
  'auth.locked': ['lock', '登录锁定', 'l-meta'],
  'registry.toggled': ['puzzle', '插件开关', 'l-ui'],
};

export default {
  page: 'ent-notify',
  html: `
  <div class="headrow" data-ent-page="ent-notify">
    <div><h1>通知告警</h1></div>
    <div style="display:flex;gap:8px"><span class="badge" id="ntfyCfg"></span></div>
  </div>

  <div class="card">
    <h2><span class="bar"></span>最近事件 <span class="badge" id="ntfyCount"></span></h2>
    <table>
      <thead><tr><th>时间</th><th>类型</th><th>详情</th></tr></thead>
      <tbody id="ntfyBody"><tr><td colspan="3" class="empty">加载中…</td></tr></tbody>
    </table>
  </div>`,

  async load() {
    const d = await api('/admin/notify/recent');
    $('ntfyCfg').textContent = d.webhookConfigured ? 'webhook 已配置' : 'webhook 未配置（仅记录不推送）';
    $('ntfyCfg').className = 'badge ' + (d.webhookConfigured ? 'ok' : 'dim');
    const list = (d.recent ?? []).slice().reverse();
    $('ntfyCount').textContent = list.length + ' 条';
    $('ntfyBody').innerHTML = list.map((e) => {
      const [ic, label, cls] = TYPE_LABEL[e.type] ?? [null, e.type, 'l-ui'];
      const detail = { ...e }; delete detail.type; delete detail.ts;
      return `<tr>
        <td class="mono crumb">${esc((e.ts ?? '').replace('T', ' ').slice(0, 19))}</td>
        <td><span class="layer ${cls}">${ic ? icon(ic, { size: 13 }) : ''}${label}</span></td>
        <td class="mono crumb" style="white-space:normal">${esc(JSON.stringify(detail))}</td>
      </tr>`;
    }).join('') || '<tr><td colspan="3" class="empty">暂无事件</td></tr>';
  },
};
