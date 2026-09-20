/**
 * 插件自带页面 · ent-notify（通知告警事件流）
 * 数据源：GET /admin/notify/recent（本插件提供）
 */
import { api, $, esc, icon } from '/admin/static/contract.mjs';
import { T } from '/admin/static/js/i18n.mjs';

const TYPE_LABEL = {
  'dlp.blocked': ['shield-alert', T('DLP 拦截', 'DLP blocked'), 'l-biz'],
  'upstream.failover': ['activity', T('上游容灾', 'Upstream failover'), 'l-ext'],
  'auth.locked': ['lock', T('登录锁定', 'Login locked'), 'l-meta'],
  'registry.toggled': ['puzzle', T('插件开关', 'Plugin toggled'), 'l-ui'],
};

export default {
  page: 'ent-notify',
  html: `
  <div class="headrow" data-ent-page="ent-notify">
    <div><h1>${T('通知告警', 'Alerts')}</h1></div>
    <div style="display:flex;gap:8px"><span class="badge" id="ntfyCfg"></span></div>
  </div>

  <div class="card">
    <h2><span class="bar"></span>${T('最近事件', 'Recent events')} <span class="badge" id="ntfyCount"></span></h2>
    <div class="tablewrap"><table>
      <thead><tr><th>${T('时间', 'Time')}</th><th>${T('类型', 'Type')}</th><th>${T('详情', 'Detail')}</th></tr></thead>
      <tbody id="ntfyBody"><tr><td colspan="3" class="empty">${T('加载中…', 'Loading…')}</td></tr></tbody>
    </table></div>
  </div>`,

  async load() {
    const d = await api('/admin/notify/recent');
    $('ntfyCfg').textContent = d.webhookConfigured ? T('webhook 已配置', 'Webhook configured') : T('webhook 未配置（仅记录不推送）', 'Webhook not configured (log only)');
    $('ntfyCfg').className = 'badge ' + (d.webhookConfigured ? 'ok' : 'dim');
    const list = (d.recent ?? []).slice().reverse();
    $('ntfyCount').textContent = T(list.length + ' 条', list.length + '');
    $('ntfyBody').innerHTML = list.map((e) => {
      const [ic, label, cls] = TYPE_LABEL[e.type] ?? [null, e.type, 'l-ui'];
      const detail = { ...e }; delete detail.type; delete detail.ts;
      return `<tr>
        <td class="mono crumb">${esc((e.ts ?? '').replace('T', ' ').slice(0, 19))}</td>
        <td><span class="layer ${cls}">${ic ? icon(ic, { size: 13 }) : ''}${label}</span></td>
        <td class="mono crumb" style="white-space:normal">${esc(JSON.stringify(detail))}</td>
      </tr>`;
    }).join('') || `<tr><td colspan="3" class="empty">${T('暂无事件', 'No events')}</td></tr>`;
  },
};
