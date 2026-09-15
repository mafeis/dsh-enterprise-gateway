/**
 * 插件自带页面 · ent-registry（插件管理）
 * 经 /admin/plug/ent-registry/index.mjs 提供，管理台壳动态装载。
 * 页面归插件所有：本目录（ent-registry.web/）随插件装载/禁用而生灭。
 */
import { api, $, toast, esc, confirmDlg, icon } from '/admin/static/contract.mjs';

/** 分层：优先用快照注入的 category（src/plugin-manifest.mjs 名实对照表），外部/未知 fallback 按名推断 */
const CAT_RANK = { kernel: 0, service: 1, domain: 2, collab: 3, demo: 4, external: 5 };
const CAT_LABEL = { kernel: '基座', service: '服务', domain: '业务域', collab: '协作', demo: '示例', external: '外部' };
const CAT_CLS = { kernel: 'l-meta', service: 'l-biz', domain: 'l-ui', collab: 'l-collab', demo: 'l-ext', external: 'l-ext' };
function catOf(p) {
  if (p.category) return p.category;
  if (p.source === 'external') return 'external';
  return 'business';
}
const byCategory = (a, b) => (CAT_RANK[catOf(a)] - CAT_RANK[catOf(b)]);

export default {
  page: 'ent-registry',
  html: `
  <div class="headrow" data-ent-page="ent-registry">
    <div><h1>插件管理</h1></div>
    <div style="display:flex;gap:8px"><span class="badge" id="plugSummary"></span></div>
  </div>

  <div class="card">
    <h2><span class="bar"></span>侧边菜单
      <span style="flex:1"></span>
      <button class="btn" id="navManageBtn">☰ 菜单管理</button>
    </h2>
    </div>

  <div class="card">
    <h2><span class="bar"></span>已装载 <span class="badge" id="plugLoadedCount"></span></h2>
      <table>
      <thead><tr><th>插件</th><th>层</th><th>provides</th><th>inject</th><th>capabilities</th><th>exposes</th><th class="num">操作</th></tr></thead>
      <tbody id="plugLoadedBody"><tr><td colspan="7" class="empty">加载中…</td></tr></tbody>
    </table>
  </div>

  <div class="card">
    <h2><span class="bar"></span>已禁用 <span class="badge" id="plugDisabledCount"></span></h2>
    <table>
      <thead><tr><th>插件</th><th>来源</th><th>说明</th><th class="num">操作</th></tr></thead>
      <tbody id="plugDisabledBody"><tr><td colspan="4" class="empty">无</td></tr></tbody>
    </table>
  </div>

  <div class="card">
    <h2><span class="bar"></span>装载失败 <span class="badge" id="plugFailedCount"></span></h2>
    <table>
      <thead><tr><th>插件</th><th>来源</th><th>原因</th><th class="num">操作</th></tr></thead>
      <tbody id="plugFailedBody"><tr><td colspan="4" class="empty">无</td></tr></tbody>
    </table>
  </div>`,

  async load() {
    const d = await api('/admin/plugins');
    $('plugSummary').textContent = `装载 ${d.loaded.length} · 禁用 ${d.disabled.length} · 失败 ${d.failed.length}`;
    $('plugLoadedCount').textContent = d.loaded.length + ' 个';
    $('plugDisabledCount').textContent = d.disabled.length + ' 个';
    $('plugFailedCount').textContent = d.failed.length + ' 个';

    $('plugLoadedBody').innerHTML = [...d.loaded].sort(byCategory).map((p) => {
      const caps = p.manifest?.capabilities ?? [];
      const exposes = p.manifest?.exposes ? Object.keys(p.manifest.exposes) : [];
      const lock = p.locked
        ? `<span class="crumb" title="锁定插件，不允许禁用">${icon('lock', { size: 13 })} 锁定</span>`
        : `<button class="btn sm danger" data-plug-off="${esc(p.name)}">禁用</button>`;
      return `<tr>
        <td>
          <div class="mono"><b>${esc(p.name)}</b>${p.title ? ` <span style="font-family:inherit">· ${esc(p.title)}</span>` : ''}</div>
          ${p.summary ? `<div class="crumb" style="max-width:380px;white-space:normal">${esc(p.summary)}</div>` : ''}
        </td>
        <td><span class="layer ${CAT_CLS[catOf(p)] ?? ''}">${CAT_LABEL[catOf(p)] ?? '—'}</span></td>
        <td class="mono">${esc((p.provides ?? []).join(', ') || '—')}</td>
        <td class="mono crumb">${esc((p.inject ?? []).join(', ') || '—')}</td>
        <td class="mono crumb">${esc(caps.join(', ') || '—')}</td>
        <td class="mono crumb">${esc(exposes.join(', ') || '—')}</td>
        <td class="num">${lock}</td>
      </tr>`;
    }).join('') || '<tr><td colspan="7" class="empty">无</td></tr>';

    $('plugDisabledBody').innerHTML = [...d.disabled].sort(byCategory).map((p) => `<tr>
      <td class="mono"><b>${esc(p.name)}</b>${p.title ? ` <span style="font-family:inherit">· ${esc(p.title)}</span>` : ''}</td>
      <td>${p.source === 'external' ? '外部' : '内置'}</td>
      <td class="crumb" style="max-width:420px;white-space:normal">${esc(p.summary ?? `plugins.${p.name}.enabled=false`)}</td>
      <td class="num"><button class="btn sm" data-plug-on="${esc(p.name)}">启用</button></td>
    </tr>`).join('') || '<tr><td colspan="4" class="empty">无</td></tr>';

    $('plugFailedBody').innerHTML = [...d.failed].sort(byCategory).map((p) => `<tr>
      <td class="mono"><b>${esc(p.name)}</b>${p.title ? ` <span style="font-family:inherit">· ${esc(p.title)}</span>` : ''}</td>
      <td>${p.source === 'external' ? '外部' : '内置'}</td>
      <td class="crumb" style="max-width:420px;white-space:normal">${esc(p.reason ?? '-')}</td>
      <td class="num"><button class="btn sm" data-plug-on="${esc(p.name)}">启用</button></td>
    </tr>`).join('') || '<tr><td colspan="4" class="empty">无</td></tr>';
  },

  bind() {
    document.querySelector('#plugLoadedBody').addEventListener('click', (e) => {
      const b = e.target.closest('[data-plug-off]');
      if (b) this.toggle(b.dataset.plugOff, false);
    });
    for (const id of ['plugDisabledBody', 'plugFailedBody']) {
      $(id).addEventListener('click', (e) => {
        const b = e.target.closest('[data-plug-on]');
        if (b) this.toggle(b.dataset.plugOn, true);
      });
    }
    // 菜单管理：同插件自带模块（懒加载，弹层归本插件所有）
    document.getElementById('navManageBtn')?.addEventListener('click', () =>
      import('./navmanage.mjs').then((m) => m.openNavManage()).catch((e) => {
        console.error('菜单管理加载失败', e);
        toast('✗ 菜单管理模块加载失败', 'bad');
      }));
  },

  async toggle(name, enabled) {
    const verb = enabled ? '启用' : '禁用';
    const yes = await confirmDlg({
      title: `${verb}插件 ${name}`,
      message: `开关会写入配置并落盘，重启网关后生效。${enabled ? '' : '依赖它的插件将在重启后因缺服务而跳过装载。'}`,
      confirmText: verb,
      danger: !enabled,
    });
    if (!yes) return;
    try {
      await api('/admin/plugins/' + encodeURIComponent(name), { method: 'PATCH', body: JSON.stringify({ enabled }) });
      toast(`已${verb} ${name}（已落盘，重启网关生效）`);
      this.load();
    } catch (e) { if (e.message !== '401') toast('✗ ' + e.message, 'bad'); }
  },
};
