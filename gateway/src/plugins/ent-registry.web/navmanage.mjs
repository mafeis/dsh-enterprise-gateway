/**
 * ent-registry 插件页面模块 · 菜单管理弹层（侧边导航排序/显隐/恢复默认）
 * 偏好经 PATCH /admin/nav-config 落盘网关（ent-console），保存后 contract.applyNavPrefs 即时重排侧边栏
 * 交互：拖拽整行排序；↑↓ 微调；「显示」勾选控制显隐（隐藏页面路由仍在，可经 URL 直达）
 * 样式：.navmgr-* 为壳公开 CSS 类（app.css），遵守统一设计系统契约
 */
import { api, toast, esc, icon, getNavState, applyNavPrefs } from '/admin/static/contract.mjs';
import { T } from '/admin/static/js/i18n.mjs';

let els = null;

/** 按当前偏好合并出工作顺序（自定义序优先，新插件按声明序追加） */
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

function rowHtml(n, hidden) {
  return `<div class="navmgr-row${hidden ? ' off' : ''}" draggable="true" data-id="${esc(n.id)}">
    <span class="navmgr-grip" title="${T('拖拽排序', 'Drag to sort')}">⠿</span>
    <span class="t">${icon(n.icon ?? 'puzzle', { size: 15 })}<span>${esc(n.title)}</span><span class="mono">${esc(n.id)}</span></span>
    <span class="navmgr-ops">
      <button class="btn sm" data-up title="${T('上移', 'Move up')}">↑</button>
      <button class="btn sm" data-down title="${T('下移', 'Move down')}">↓</button>
      <label class="chk" title="${T('取消勾选即从侧边栏隐藏（路由仍在）', 'Uncheck to hide from the side menu (route remains)')}"><input type="checkbox" class="navmgr-vis" ${hidden ? '' : 'checked'}>${T('显示', 'Show')}</label>
    </span>
  </div>`;
}

/** 读当前弹层行序 → { order, hidden } */
function collect() {
  const rows = [...els.list.querySelectorAll('.navmgr-row')];
  return {
    order: rows.map((r) => r.dataset.id),
    hidden: rows.filter((r) => !r.querySelector('.navmgr-vis').checked).map((r) => r.dataset.id),
  };
}

async function save(payload, close) {
  try {
    const r = await api('/admin/nav-config', { method: 'PATCH', body: JSON.stringify(payload) });
    if (r && r.error) throw new Error(r.error.message || T('请求失败', 'Request failed'));   // 老网关无此接口（404）等：明确报错而非静默
    applyNavPrefs({ order: r.order, hidden: r.hidden });
    toast(payload.order?.length || payload.hidden?.length
      ? T('菜单设置已保存并落盘', 'Menu settings saved')
      : T('已恢复默认菜单', 'Default menu restored'));
    close();
  } catch (e) { if (e.message !== '401') toast('✗ ' + e.message, 'bad'); }
}

export async function openNavManage() {
  const { items, prefs } = getNavState();
  if (!items.length) { toast(T('导航尚未加载，请先进入任一页面', 'Menu not loaded yet, open any page first'), 'bad'); return; }
  let net = null;
  try { net = await api('/admin/nav-config'); } catch { /* 读取失败按本地偏好 */ }
  const work = mergedItems(items, net && Array.isArray(net.order) ? net : prefs);
  const hiddenSet = new Set((net && Array.isArray(net.hidden) ? net.hidden : prefs.hidden));

  if (!els) {
    els = { mask: document.createElement('div') };
    els.mask.className = 'modal-mask';
    document.body.appendChild(els.mask);
  }
  els.mask.innerHTML = `
    <div class="modal" style="width:min(520px,94vw)">
      <button class="close" data-close>×</button>
      <h3>${T('菜单管理', 'Menu management')}</h3>
      <div class="crumb" style="margin-bottom:12px">${T('拖拽或 ↑↓ 排序 · 取消「显示」隐藏菜单项', 'Drag or ↑↓ to sort · uncheck "Show" to hide an item')}</div>
      <div class="navmgr-list">${work.map((n) => rowHtml(n, hiddenSet.has(n.id))).join('')}</div>
      <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:16px">
        <button class="btn" id="navMgrReset">${T('恢复默认', 'Reset default')}</button>
        <span style="flex:1"></span>
        <button class="btn" data-close>${T('取消', 'Cancel')}</button>
        <button class="btn primary" id="navMgrSave">${T('保存', 'Save')}</button>
      </div>
    </div>`;
  els.mask.classList.add('show');
  els.list = els.mask.querySelector('.navmgr-list');

  const close = () => { els.mask.classList.remove('show'); els.mask.innerHTML = ''; };
  els.mask.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', close));
  els.mask.querySelector('#navMgrReset').addEventListener('click', () => save({ order: [], hidden: [] }, close));
  els.mask.querySelector('#navMgrSave').addEventListener('click', () => save(collect(), close));

  /* ---- 行内操作：上移 / 下移 / 显隐 ---- */
  els.list.addEventListener('click', (e) => {
    const row = e.target.closest('.navmgr-row');
    if (!row) return;
    if (e.target.closest('[data-up]') && row.previousElementSibling) row.previousElementSibling.before(row);
    if (e.target.closest('[data-down]') && row.nextElementSibling) row.nextElementSibling.after(row);
    if (e.target.closest('.navmgr-vis')) row.classList.toggle('off', !e.target.closest('.navmgr-vis').checked);
  });

  /* ---- 拖拽排序：拖动行悬停到目标行上/下半部时插入到其前/后 ---- */
  let dragRow = null;
  els.list.addEventListener('dragstart', (e) => {
    dragRow = e.target.closest('.navmgr-row');
    dragRow?.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
  });
  els.list.addEventListener('dragend', () => {
    dragRow?.classList.remove('dragging');
    els.list.querySelectorAll('.navmgr-row').forEach((r) => r.classList.remove('dragover-top', 'dragover-bot'));
    dragRow = null;
  });
  els.list.addEventListener('dragover', (e) => {
    const over = e.target.closest('.navmgr-row');
    if (!dragRow || !over || over === dragRow) return;
    e.preventDefault();
    const r = over.getBoundingClientRect();
    const before = e.clientY < r.top + r.height / 2;
    els.list.querySelectorAll('.navmgr-row').forEach((x) => x.classList.remove('dragover-top', 'dragover-bot'));
    over.classList.add(before ? 'dragover-top' : 'dragover-bot');
    before ? over.before(dragRow) : over.after(dragRow);
  });
}
