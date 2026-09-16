/**
 * 插件自带页面 · ent-registry（插件管理）
 * 经 /admin/plug/ent-registry/index.mjs 提供，管理台壳动态装载。
 * 页面归插件所有：本目录（ent-registry.web/）随插件装载/禁用而生灭。
 */
import { api, $, toast, esc, confirmDlg, icon } from '/admin/static/contract.mjs';
import { T } from '/admin/static/js/i18n.mjs';

/** 分层：优先用快照注入的 category（src/plugin-manifest.mjs 名实对照表），外部/未知 fallback 按名推断 */
const CAT_RANK = { kernel: 0, service: 1, domain: 2, collab: 3, demo: 4, external: 5 };
const CAT_LABEL = { kernel: T('基座', 'Kernel'), service: T('服务', 'Service'), domain: T('业务域', 'Domain'), collab: T('协作', 'Collab'), demo: T('示例', 'Demo'), external: T('外部', 'External') };
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
    <div><h1>${T('插件管理', 'Plugins')}</h1></div>
    <div style="display:flex;gap:8px"><span class="badge" id="plugSummary"></span></div>
  </div>

  <div class="card">
    <h2><span class="bar"></span>${T('侧边菜单', 'Side menu')}
      <span style="flex:1"></span>
      <button class="btn" id="navManageBtn">☰ ${T('菜单管理', 'Menu management')}</button>
    </h2>
    </div>

  <div class="card">
    <h2><span class="bar"></span>${T('已装载', 'Loaded')} <span class="badge" id="plugLoadedCount"></span></h2>
      <table>
      <thead><tr><th>${T('插件', 'Plugin')}</th><th>${T('层', 'Layer')}</th><th>provides</th><th>inject</th><th>capabilities</th><th>exposes</th><th class="num">${T('操作', 'Actions')}</th></tr></thead>
      <tbody id="plugLoadedBody"><tr><td colspan="7" class="empty">${T('加载中…', 'Loading…')}</td></tr></tbody>
    </table>
  </div>

  <div class="card">
    <h2><span class="bar"></span>${T('已禁用', 'Disabled')} <span class="badge" id="plugDisabledCount"></span></h2>
    <table>
      <thead><tr><th>${T('插件', 'Plugin')}</th><th>${T('来源', 'Source')}</th><th>${T('说明', 'Notes')}</th><th class="num">${T('操作', 'Actions')}</th></tr></thead>
      <tbody id="plugDisabledBody"><tr><td colspan="4" class="empty">${T('无', 'None')}</td></tr></tbody>
    </table>
  </div>

  <div class="card">
    <h2><span class="bar"></span>${T('装载失败', 'Failed to load')} <span class="badge" id="plugFailedCount"></span></h2>
    <table>
      <thead><tr><th>${T('插件', 'Plugin')}</th><th>${T('来源', 'Source')}</th><th>${T('原因', 'Reason')}</th><th class="num">${T('操作', 'Actions')}</th></tr></thead>
      <tbody id="plugFailedBody"><tr><td colspan="4" class="empty">${T('无', 'None')}</td></tr></tbody>
    </table>
  </div>`,

  async load() {
    const d = await api('/admin/plugins');
    $('plugSummary').textContent = T('装载 {a} · 禁用 {b} · 失败 {c}', 'Loaded {a} · Disabled {b} · Failed {c}', { a: d.loaded.length, b: d.disabled.length, c: d.failed.length });
    $('plugLoadedCount').textContent = T('{n} 个', '{n}', { n: d.loaded.length });
    $('plugDisabledCount').textContent = T('{n} 个', '{n}', { n: d.disabled.length });
    $('plugFailedCount').textContent = T('{n} 个', '{n}', { n: d.failed.length });

    $('plugLoadedBody').innerHTML = [...d.loaded].sort(byCategory).map((p) => {
      const caps = p.manifest?.capabilities ?? [];
      const exposes = p.manifest?.exposes ? Object.keys(p.manifest.exposes) : [];
      const lock = p.locked
        ? `<span class="crumb" title="${T('锁定插件，不允许禁用', 'Locked plugin, cannot disable')}">${icon('lock', { size: 13 })} ${T('锁定', 'Locked')}</span>`
        : `<button class="btn sm danger" data-plug-off="${esc(p.name)}">${T('禁用', 'Disable')}</button>`;
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
    }).join('') || `<tr><td colspan="7" class="empty">${T('无', 'None')}</td></tr>`;

    $('plugDisabledBody').innerHTML = [...d.disabled].sort(byCategory).map((p) => `<tr>
      <td class="mono"><b>${esc(p.name)}</b>${p.title ? ` <span style="font-family:inherit">· ${esc(p.title)}</span>` : ''}</td>
      <td>${p.source === 'external' ? T('外部', 'External') : T('内置', 'Built-in')}</td>
      <td class="crumb" style="max-width:420px;white-space:normal">${esc(p.summary ?? `plugins.${p.name}.enabled=false`)}</td>
      <td class="num"><button class="btn sm" data-plug-on="${esc(p.name)}">${T('启用', 'Enable')}</button></td>
    </tr>`).join('') || `<tr><td colspan="4" class="empty">${T('无', 'None')}</td></tr>`;

    $('plugFailedBody').innerHTML = [...d.failed].sort(byCategory).map((p) => `<tr>
      <td class="mono"><b>${esc(p.name)}</b>${p.title ? ` <span style="font-family:inherit">· ${esc(p.title)}</span>` : ''}</td>
      <td>${p.source === 'external' ? T('外部', 'External') : T('内置', 'Built-in')}</td>
      <td class="crumb" style="max-width:420px;white-space:normal">${esc(p.reason ?? '-')}</td>
      <td class="num"><button class="btn sm" data-plug-on="${esc(p.name)}">${T('启用', 'Enable')}</button></td>
    </tr>`).join('') || `<tr><td colspan="4" class="empty">${T('无', 'None')}</td></tr>`;
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
        toast(T('✗ 菜单管理模块加载失败', '✗ Failed to load menu management module'), 'bad');
      }));
  },

  async toggle(name, enabled) {
    const verb = enabled ? T('启用', 'Enable') : T('禁用', 'Disable');
    const yes = await confirmDlg({
      title: T('{v}插件 {name}', '{v} plugin {name}', { v: verb, name }),
      message: T('开关会写入配置并落盘，重启网关后生效。{extra}', 'Saved to config, takes effect after gateway restart.{extra}', {
        extra: enabled ? '' : T('依赖它的插件将在重启后因缺服务而跳过装载。', 'Dependent plugins will skip loading after restart due to missing services.'),
      }),
      confirmText: verb,
      danger: !enabled,
    });
    if (!yes) return;
    try {
      await api('/admin/plugins/' + encodeURIComponent(name), { method: 'PATCH', body: JSON.stringify({ enabled }) });
      toast(enabled
        ? T('已启用 {name}（已落盘，重启网关生效）', '{name} enabled (saved, takes effect after gateway restart)', { name })
        : T('已禁用 {name}（已落盘，重启网关生效）', '{name} disabled (saved, takes effect after gateway restart)', { name }));
      this.load();
    } catch (e) { if (e.message !== '401') toast('✗ ' + e.message, 'bad'); }
  },
};
