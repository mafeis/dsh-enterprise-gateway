/**
 * 前端路由：hash 导航 + 页面 section 切换
 * 壳不持有任何页面 —— 全部页面（含曾经的"核心页"）都是插件自带页面，
 * 经 GET /admin/plugins 里带 admin 声明的插件动态发现：导航自动注入、页面模块从 /admin/plug/<name>/ 懒加载。
 * 页面归插件所有：插件禁用/卸载，导航与页面随之消失。
 *
 * 侧边菜单支持管理员自定义排序/显隐（菜单管理弹层）：
 * 偏好存网关侧 GET/PATCH /admin/nav-config（ent-console 落盘 gateway-config.json），全浏览器生效；
 * 合并规则 = 自定义顺序优先，未列出的新插件按声明 order 追加在后，隐藏项仅藏菜单不删路由。
 */
import { api, esc } from './core.mjs?v=20260914120000';
import { icon } from '../icons.mjs?v=20260914160000';

/* ---------- 插件自带页面：动态发现 + 注册（整个会话只拉一次清单） ---------- */
let plugRoutesPromise = null;

/** 落地页：overview（ent-console）。被禁用时落到第一个可用插件页 */
const PREFERRED_ROUTE = 'overview';

/** 所有插件声明的导航项 [{ id, title, icon, order, name }]（声明序） */
const navRegistry = [];
/** 管理员菜单偏好 { order: [id...], hidden: [id...] }（网关侧持久化） */
let navPrefs = { order: [], hidden: [] };

/** 偏好防御性归一化：接口 404（老网关未重启）/字段缺失/网络失败一律退回声明序，绝不让侧边栏渲染崩掉 */
function normalizePrefs(p) {
  const arr = (v) => Array.isArray(v) ? v.filter((x) => typeof x === 'string' && x) : [];
  return { order: arr(p?.order), hidden: arr(p?.hidden) };
}

/** 合并排序：自定义顺序优先，未列出的按声明 order 追加在后 */
function mergedNavItems() {
  const byId = new Map(navRegistry.map((n) => [n.id, n]));
  const out = [];
  for (const id of navPrefs.order) {
    const n = byId.get(id);
    if (n) { out.push(n); byId.delete(id); }
  }
  out.push(...[...byId.values()].sort((a, b) => (a.order ?? 100) - (b.order ?? 100)));
  return out;
}

/** 重建侧边导航（菜单管理保存后即时重排；不重复挂载页面） */
function renderSidebar() {
  const aside = document.querySelector('.sidebar');
  const foot = aside?.querySelector('.nav-foot');
  if (!aside || !foot) return;
  aside.querySelectorAll('.nav-item, .nav-group, .nav-sub, .nav-sep').forEach((el) => el.remove());
  for (const n of mergedNavItems()) {
    if (navPrefs.hidden.includes(n.id)) continue;
    const a = document.createElement('a');
    a.className = 'nav-item';
    a.href = '#/' + n.id;
    a.dataset.nav = n.id;
    a.innerHTML = `<span class="ic">${icon(n.icon ?? 'puzzle', { size: 16 })}</span><span>${esc(n.title)}</span>`;
    aside.insertBefore(a, foot);
  }
  // 恢复当前路由高亮（renderSidebar 可能在导航中途被调用）
  document.querySelectorAll('[data-nav]').forEach((a) => a.classList.toggle('active', a.dataset.nav === current));
}

/** 菜单管理弹层用：当前导航注册表 + 偏好的只读快照 */
export function getNavState() {
  return { items: navRegistry.map((n) => ({ ...n })), prefs: { order: [...navPrefs.order], hidden: [...navPrefs.hidden] } };
}

/** 菜单管理保存后回调：更新偏好并即时重排侧边栏 */
export function applyNavPrefs(prefs) {
  navPrefs = normalizePrefs(prefs);
  renderSidebar();
}

async function ensurePluginRoutes() {
  if (plugRoutesPromise) return plugRoutesPromise;
  plugRoutesPromise = (async () => {
    const d = await api('/admin/plugins');
    const aside = document.querySelector('.sidebar');
    const foot = aside?.querySelector('.nav-foot');
    const content = document.querySelector('.content');
    for (const p of d.loaded ?? []) {
      const adm = p.admin;
      if (!adm?.nav || navRegistry.some((n) => n.id === adm.nav.id)) continue;
      const route = adm.nav.id;
      navRegistry.push({ id: route, title: adm.nav.title, icon: adm.nav.icon, order: adm.nav.order ?? 100, name: p.name });
      // 页面 section（插件页 html 由 entry 模块提供）
      const sec = document.createElement('section');
      sec.className = 'page';
      sec.id = 'page-' + route;
      sec.hidden = true;
      content?.appendChild(sec);
      // 懒加载插件页面模块（契约：default export { html, load, bind }）
      let mod = null;
      try {
        mod = await import(`/admin/plug/${encodeURIComponent(p.name)}/${adm.entry}?v=${Date.now()}`);
        if (mod.default?.html) {
          sec.innerHTML = mod.default.html;
          sec._mounted = true;
          mod.default.bind?.();
        }
      } catch (e) {
        sec.innerHTML = `<div class="card"><h2><span class="bar"></span>页面装载失败</h2><div class="empty" style="white-space:normal">${esc(String(e?.message ?? e)).slice(0, 300)}</div></div>`;
      }
      ROUTES[route] = {
        title: adm.nav.title,
        load: async () => { await mod?.default?.load?.(); },
      };
    }
    // 菜单偏好（管理员自定义排序/显隐）：404（老网关）/网络失败/字段缺失一律退回声明序兜底。
    // 独立 try：菜单偏好出任何意外都不允许影响页面 section 挂载（菜单空 = 本次事故教训）
    try {
      navPrefs = normalizePrefs(await api('/admin/nav-config').catch(() => null));
    } catch { navPrefs = { order: [], hidden: [] }; }
    try { renderSidebar(); } catch (e) { console.error('侧边菜单渲染失败', e); }
  })().catch(() => { /* 未登录/接口异常：清缓存，下次导航重试（老会话补 cookie 后可恢复） */ plugRoutesPromise = null; });
  return plugRoutesPromise;
}

const ROUTES = {};
let current = PREFERRED_ROUTE;

export function currentRoute() { return current; }

export async function navigate(route) {
  await ensurePluginRoutes();
  // 目标页不存在（插件被禁用/未装载）：落回首选页，再不行落第一个可用页
  if (!ROUTES[route]) route = ROUTES[PREFERRED_ROUTE] ? PREFERRED_ROUTE : Object.keys(ROUTES)[0];
  if (!route) return;
  current = route;
  document.querySelectorAll('.page').forEach((p) => { p.hidden = p.id !== 'page-' + route; });
  document.title = ROUTES[route].title + ' · DSH 企业网关';
  document.querySelectorAll('[data-nav]').forEach((a) => a.classList.toggle('active', a.dataset.nav === route));
  if (location.hash !== '#/' + route) history.replaceState(null, '', '#/' + route);
  await ROUTES[route].load();
}

export function refreshCurrent() { return navigate(current); }

export function initRouter() {
  window.addEventListener('hashchange', () => {
    const r = location.hash.replace('#/', '') || PREFERRED_ROUTE;
    if (r !== current) navigate(r);
  });
}
