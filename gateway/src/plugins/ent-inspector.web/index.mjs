/**
 * 插件自带页面 · ent-inspector（跨插件协作视图）
 * 数据源：GET /admin/inspector（本插件提供）
 */
import { api, $, esc, icon } from '/admin/static/contract.mjs';
import { T } from '/admin/static/js/i18n.mjs';

export default {
  page: 'ent-inspector',
  html: `
  <div class="headrow" data-ent-page="ent-inspector">
    <div><h1>${T('协作视图', 'Collaboration')}</h1></div>
  </div>

  <div class="card">
    <h2><span class="bar"></span>${T('插件契约扫描', 'Plugin contract scan')} <span class="badge" id="inspCount"></span></h2>
    <div class="tablewrap"><table>
      <thead><tr><th>${T('插件', 'Plugin')}</th><th>provides</th><th>inject</th><th>capabilities</th><th>exposes</th><th>${T('来源', 'Source')}</th></tr></thead>
      <tbody id="inspBody"><tr><td colspan="6" class="empty-state">${icon('puzzle', { size: 32 })}<div class="es-title">${T('暂无插件', 'No plugins')}</div><div class="es-desc">${T('加载中…', 'Loading…')}</div></td></tr></tbody>
    </table></div>
  </div>

  <div class="card">
    <h2><span class="bar"></span>${T('exposes 信息快照', 'exposes snapshot')} <span class="badge" id="inspSnapCount"></span></h2>
      <div class="tablewrap"><table>
      <thead><tr><th>${T('插件', 'Plugin')}</th><th>${T('快照数据', 'Snapshot data')}</th></tr></thead>
      <tbody id="inspSnapBody"><tr><td colspan="2" class="empty-state">${icon('puzzle', { size: 32 })}<div class="es-title">${T('暂无快照', 'No snapshots')}</div><div class="es-desc">${T('加载中…', 'Loading…')}</div></td></tr></tbody>
    </table></div>
  </div>`,

  async load() {
    const d = await api('/admin/inspector');
    $('inspCount').textContent = T((d.plugins ?? []).length + ' 个', (d.plugins ?? []).length + '');
    $('inspBody').innerHTML = (d.plugins ?? []).map((p) => `<tr>
      <td class="mono"><b>${esc(p.name)}</b></td>
      <td class="mono">${esc((p.provides ?? []).join(', ') || '—')}</td>
      <td class="mono crumb">${esc((p.inject ?? []).join(', ') || '—')}</td>
      <td class="mono crumb">${esc((p.capabilities ?? []).join(', ') || '—')}</td>
      <td class="mono crumb">${esc((p.exposes ?? []).join(', ') || '—')}</td>
      <td class="crumb">${p.source === 'external' ? T('外部', 'external') : T('内置', 'builtin')}</td>
    </tr>`).join('');
    const snaps = d.snapshots ?? [];
    $('inspSnapCount').textContent = T(snaps.filter((s) => s.ok).length + ' 个响应', snaps.filter((s) => s.ok).length + ' responses');
    $('inspSnapBody').innerHTML = snaps.map((s) => `<tr>
      <td class="mono"><b>${esc(s.name)}</b></td>
      <td class="mono crumb" style="white-space:normal">${s.ok ? esc(JSON.stringify(s.data)) : `<span style="color:var(--warn)">${esc(s.error)}</span>`}</td>
    </tr>`).join('') || `<tr><td colspan="2" class="empty-state">${icon('puzzle', { size: 32 })}<div class="es-title">${T('暂无暴露接口', 'No exposes')}</div><div class="es-desc">${T('没有插件声明 exposes', 'No plugin declares exposes')}</div></td></tr>`;
  },
};
