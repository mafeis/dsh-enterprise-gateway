/**
 * 插件自带页面 · ent-inspector（跨插件协作视图）
 * 数据源：GET /admin/inspector（本插件提供）
 */
import { api, $, esc } from '/admin/static/contract.mjs';

export default {
  page: 'ent-inspector',
  html: `
  <div class="headrow" data-ent-page="ent-inspector">
    <div><h1>协作视图</h1></div>
  </div>

  <div class="card">
    <h2><span class="bar"></span>插件契约扫描 <span class="badge" id="inspCount"></span></h2>
    <table>
      <thead><tr><th>插件</th><th>provides</th><th>inject</th><th>capabilities</th><th>exposes</th><th>来源</th></tr></thead>
      <tbody id="inspBody"><tr><td colspan="6" class="empty">加载中…</td></tr></tbody>
    </table>
  </div>

  <div class="card">
    <h2><span class="bar"></span>exposes 信息快照 <span class="badge" id="inspSnapCount"></span></h2>
      <table>
      <thead><tr><th>插件</th><th>快照数据</th></tr></thead>
      <tbody id="inspSnapBody"><tr><td colspan="2" class="empty">加载中…</td></tr></tbody>
    </table>
  </div>`,

  async load() {
    const d = await api('/admin/inspector');
    $('inspCount').textContent = (d.plugins ?? []).length + ' 个';
    $('inspBody').innerHTML = (d.plugins ?? []).map((p) => `<tr>
      <td class="mono"><b>${esc(p.name)}</b></td>
      <td class="mono">${esc((p.provides ?? []).join(', ') || '—')}</td>
      <td class="mono crumb">${esc((p.inject ?? []).join(', ') || '—')}</td>
      <td class="mono crumb">${esc((p.capabilities ?? []).join(', ') || '—')}</td>
      <td class="mono crumb">${esc((p.exposes ?? []).join(', ') || '—')}</td>
      <td class="crumb">${p.source === 'external' ? '外部' : '内置'}</td>
    </tr>`).join('');
    const snaps = d.snapshots ?? [];
    $('inspSnapCount').textContent = snaps.filter((s) => s.ok).length + ' 个响应';
    $('inspSnapBody').innerHTML = snaps.map((s) => `<tr>
      <td class="mono"><b>${esc(s.name)}</b></td>
      <td class="mono crumb" style="white-space:normal">${s.ok ? esc(JSON.stringify(s.data)) : `<span style="color:var(--warn)">${esc(s.error)}</span>`}</td>
    </tr>`).join('') || '<tr><td colspan="2" class="empty">没有插件声明 exposes</td></tr>';
  },
};
