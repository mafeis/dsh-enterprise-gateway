/**
 * ent-registry 插件页面模块 · 菜单管理（独立页面，非弹窗）
 * 内容与实际侧边栏一致：先按 order 分区（总览/模型/用户/客户端/桌面/系统），再列各导航项。
 * 偏好经 PATCH /admin/nav-config 落盘网关，保存后 applyNavPrefs 即时重排侧边栏。
 */
import { api, toast, esc, icon, getNavState, applyNavPrefs } from '/admin/static/contract.mjs';
import { T } from '/admin/static/js/i18n.mjs';

const ZONES = [
  { key: 'overview', title: '总览', titleEn: 'Overview', match: (n) => n.order >= 0 && n.order < 20 },
  { key: 'model', title: '模型', titleEn: 'Models', match: (n) => n.order >= 20 && n.order < 100 },
  { key: 'user', title: '用户', titleEn: 'Users', match: (n) => n.order >= 100 && n.order < 200 },
  { key: 'client', title: '客户端', titleEn: 'Client', match: (n) => n.order >= 200 && n.order < 300 },
  { key: 'desktop', title: '桌面', titleEn: 'Desktop', match: (n) => n.order >= 300 && n.order < 400 },
  { key: 'system', title: '系统', titleEn: 'System', match: (n) => n.order >= 400 },
];

function zoneTitle(zone) {
  return T(zone.title, zone.titleEn) || zone.title;
}

function rowHtml(n, hidden, child = false) {
  const cls = child ? 'navrow navrow-child' : 'navrow';
  return `<div class="${cls}${hidden ? ' navrow-off' : ''}"${child ? '' : ' draggable="true"'} data-id="${esc(n.id)}">
    <span class="navgrip" title="${T('拖拽排序', 'Drag to sort')}">${child ? '' : '⠿'}</span>
    <span class="navrow-main">
      ${icon(n.icon ?? 'puzzle', { size: child ? 14 : 15 })}
      <span class="navrow-title">${esc(n.title)}</span>
      <span class="mono navrow-id">${esc(n.id)}</span>
    </span>
    <span class="navrow-ops">
      ${child ? '' : `<button class="btn sm" data-up title="${T('上移', 'Move up')}">↑</button>
      <button class="btn sm" data-down title="${T('下移', 'Move down')}">↓</button>`}
      <label class="chk" title="${T('取消勾选即从侧边栏隐藏（路由仍在）', 'Uncheck to hide from the side menu (route remains)')}">
        <input type="checkbox" class="navvis" ${hidden ? '' : 'checked'}>${T('显示', 'Show')}
      </label>
    </span>
  </div>`;
}

function mergedItems(items, prefs) {
  const byId = new Map(items.map((n) => [n.id, n]));
  const out = [];
  for (const id of prefs.order) {
    const n = byId.get(id);
    if (n) { out.push(n); byId.delete(id); }
  }
  out.push(...[...byId.values()].sort((a, b) => (a.order ?? 100) - (b.order ?? 100)));
  return out;
}

function collect() {
  const rows = [...document.querySelectorAll('.navrow')];
  return {
    order: rows.filter((r) => !r.classList.contains('navrow-child')).map((r) => r.dataset.id),
    hidden: rows.filter((r) => !r.querySelector('.navvis').checked).map((r) => r.dataset.id),
  };
}

async function save(payload) {
  const btn = document.getElementById('navMgrSave');
  const old = btn?.textContent;
  try {
    if (btn) { btn.disabled = true; btn.textContent = T('保存中…', 'Saving…'); }
    const r = await api('/admin/nav-config', { method: 'PATCH', body: JSON.stringify(payload) });
    if (r && r.error) throw new Error(r.error.message || T('请求失败', 'Request failed'));
    applyNavPrefs({ order: r.order, hidden: r.hidden });
    toast(payload.order?.length || payload.hidden?.length
      ? T('菜单设置已保存并落盘', 'Menu settings saved')
      : T('已恢复默认菜单', 'Default menu restored'));
  } catch (e) { if (e.message !== '401') toast('✗ ' + e.message, 'bad'); }
  finally {
    if (btn) { btn.disabled = false; btn.textContent = old ?? T('保存', 'Save'); }
  }
}

function renderList() {
  const { items, prefs } = getNavState();
  const box = document.getElementById('navList');
  if (!box) return;
  const merged = mergedItems(items, prefs);
  const parts = [];
  for (const zone of ZONES) {
    const list = merged.filter((n) => zone.match(n));
    if (!list.length) continue;
    parts.push(`<div class="navzone"><div class="navzone-title">${esc(zoneTitle(zone))}</div><div class="navzone-list">`);
    for (const n of list) {
      const hidden = prefs.hidden.includes(n.id);
      parts.push(rowHtml(n, hidden));
      if (Array.isArray(n.children) && n.children.length) {
        for (const c of n.children) parts.push(rowHtml(c, prefs.hidden.includes(c.id), true));
      }
    }
    parts.push('</div></div>');
  }
  box.innerHTML = parts.join('') || `<div class="empty-state">${icon('menu', { size: 32 })}<div class="es-title">${T('暂无菜单项', 'No menu items')}</div><div class="es-desc">${T('导航尚未加载，请刷新页面。', 'Menu not loaded yet. Refresh the page.')}</div></div>`;
  document.getElementById('navMgrCount').textContent = T('{n} 项', '{n} items', { n: merged.length });
}

export default {
  page: 'ent-menu-manage',
  html: `
  <div class="headrow" data-ent-page="ent-menu-manage">
    <div><h1>${T('菜单管理','Menu management')}</h1></div>
    <span class="badge dim" id="navMgrCount"></span>
  </div>
  <div class="sub">${T('与左侧实际菜单一致：按分区排序，子页可单独隐藏。','Matches the actual side menu: items are grouped by zone; child pages can be hidden separately.')}</div>
  <div class="card">
    <div id="navList" class="navlist"></div>
    <div class="action-bar">
      <button class="btn" id="navMgrReset">${T('恢复默认','Reset default')}</button>
      <span style="flex:1"></span>
      <button class="btn primary" id="navMgrSave">${T('保存','Save')}</button>
    </div>
  </div>`,
  async load() { renderList(); },
  bind() {
    const list = document.getElementById('navList');
    list.addEventListener('click', (e) => {
      const row = e.target.closest('.navrow');
      if (!row) return;
      if (e.target.closest('[data-up]') && row.previousElementSibling) row.previousElementSibling.before(row);
      if (e.target.closest('[data-down]') && row.nextElementSibling) row.nextElementSibling.after(row);
      if (e.target.closest('.navvis')) row.classList.toggle('navrow-off', !e.target.closest('.navvis').checked);
    });
    let dragRow = null;
    list.addEventListener('dragstart', (e) => {
      dragRow = e.target.closest('.navrow:not(.navrow-child)');
      if (dragRow) dragRow.style.opacity = '.45';
      e.dataTransfer.effectAllowed = 'move';
    });
    list.addEventListener('dragend', () => { if (dragRow) dragRow.style.opacity = ''; dragRow = null; });
    list.addEventListener('dragover', (e) => {
      const over = e.target.closest('.navrow:not(.navrow-child)');
      if (!dragRow || !over || over === dragRow) return;
      e.preventDefault();
      const r = over.getBoundingClientRect();
      const before = e.clientY < r.top + r.height / 2;
      before ? over.before(dragRow) : over.after(dragRow);
    });
    document.getElementById('navMgrSave').addEventListener('click', () => save(collect()));
    document.getElementById('navMgrReset').addEventListener('click', () => save({ order: [], hidden: [] }));
  },
}
