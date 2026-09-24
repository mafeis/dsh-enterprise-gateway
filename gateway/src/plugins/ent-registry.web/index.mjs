/**
 * 插件自带页面 · ent-registry（插件管理）
 * 经 /admin/plug/ent-registry/index.mjs 提供，管理台壳动态装载。
 * 页面归插件所有：本目录（ent-registry.web/）随插件装载/禁用而生灭。
 *
 * 布局（v2 重设计）：
 *   顶部搜索框 + 汇总徽章 → 按分层（基座/服务/业务域/协作/示例/外部）分组卡片，
 *   每个插件一行：名称 + 中文名 + 完整描述（自动换行，不截断）→ 点「详情」打开统一弹窗，
 *   弹窗内 .kv 键值摘要展示 provides/inject/capabilities/exposes 等完整信息与启停操作。
 */
import { api, $, toast, esc, confirmDlg, openDlg, closeDlg, icon } from '/admin/static/contract.mjs';
import { T } from '/admin/static/js/i18n.mjs';
import navManagePage from './navmanage.mjs';

/** 分层：优先用快照注入的 category（src/plugin-manifest.mjs 名实对照表），外部/未知 fallback 按名推断 */
const CAT_RANK = { kernel: 0, service: 1, domain: 2, collab: 3, demo: 4, external: 5 };
const CAT_LABEL = { kernel: T('基座', 'Kernel'), service: T('服务', 'Service'), domain: T('业务域', 'Domain'), collab: T('协作', 'Collab'), demo: T('示例', 'Demo'), external: T('外部', 'External') };
const CAT_CLS = { kernel: 'l-meta', service: 'l-biz', domain: 'l-ui', collab: 'l-collab', demo: 'l-ext', external: 'l-ext' };
function catOf(p) {
  if (p.category) return p.category;
  if (p.source === 'external') return 'external';
  return 'domain';
}

/** 全量插件缓存（load 拉取后供详情弹窗复用，避免重复请求） */
let allPlugins = { loaded: [], disabled: [], failed: [] };

const pluginPage = {
  page: 'ent-registry',
  html: `
  <div class="headrow" data-ent-page="ent-registry">
    <div><h1>${T('插件管理', 'Plugins')}</h1></div>
    <div style="display:flex;gap:8px;align-items:center">
      <input class="input" id="plugSearch" placeholder="${T('搜插件名 / 描述…', 'Search plugins…')}" style="width:200px;height:30px;font-size:12.5px">
      <span class="badge" id="plugSummary"></span>
    </div>
  </div>

  <div class="sub">${T('点插件行查看完整信息（能力 / 依赖 / 装载路径）；启停在详情弹窗内操作。', 'Click a plugin row for full details (capabilities / deps / source); enable or disable inside the detail dialog.')}</div>

  <div id="plugGroups"></div>

  <!-- 插件详情弹窗（统一 .dlg-* 族） -->
  <div class="dlg-mask" id="plugDetailDlg" hidden>
    <div class="dlg md">
      <div class="dlg-head">
        <h2><span class="bar"></span><span id="plugDetailTitle">—</span></h2>
        <button class="dlg-x" data-dlg-close title="${T('关闭', 'Close')}">✕</button>
      </div>
      <div class="dlg-body" id="plugDetailBody"></div>
      <div class="dlg-foot">
        <span class="err" id="plugDetailErr"></span>
        <span style="flex:1"></span>
        <button class="btn" id="plugDetailToggle"></button>
        <button class="btn" data-dlg-close>${T('关闭', 'Close')}</button>
      </div>
    </div>
  </div>`,

  async load() {
    const d = await api('/admin/plugins');
    allPlugins = d;
    $('plugSummary').textContent = T('装载 {a} · 禁用 {b} · 失败 {c}', 'Loaded {a} · Disabled {b} · Failed {c}', { a: d.loaded.length, b: d.disabled.length, c: d.failed.length });
    renderGroups();
  },

  bind() {
    // 分组容器：行点击 → 详情弹窗；启停按钮冒泡到行也要拦住
    $('plugGroups').addEventListener('click', (e) => {
      const row = e.target.closest('[data-plug-name]');
      if (row) openPlugDetail(row.dataset.plugName);
    });
    $('plugSearch').addEventListener('input', () => renderGroups());
    // 详情弹窗：关闭 + 启停
    $('plugDetailDlg').querySelectorAll('[data-dlg-close]').forEach((b) => b.addEventListener('click', () => closeDlg($('plugDetailDlg'))));
    $('plugDetailToggle').addEventListener('click', () => {
      const name = $('plugDetailDlg').dataset.name;
      const cur = allPlugins.loaded.some((p) => p.name === name);
      toggleFromPage(name, !cur, true);
    });
  },
};

export default { ...pluginPage, pages: { plugreg: pluginPage, menumanage: navManagePage } };

/* ---- 分层分组渲染：搜索过滤 → 按分层归组 → 每组一张卡片 ---- */
function renderGroups() {
  const q = ($('plugSearch')?.value ?? '').trim().toLowerCase();
  const hit = (p) => !q || p.name.toLowerCase().includes(q) || String(p.summary ?? '').toLowerCase().includes(q) || String(p.title ?? '').toLowerCase().includes(q);
  const groups = new Map();
  for (const p of [...allPlugins.loaded, ...allPlugins.disabled, ...allPlugins.failed]) {
    if (!hit(p)) continue;
    const c = catOf(p);
    if (!groups.has(c)) groups.set(c, []);
    groups.get(c).push(p);
  }
  const sorted = [...groups.entries()].sort((a, b) => CAT_RANK[a[0]] - CAT_RANK[b[0]]);
  $('plugGroups').innerHTML = sorted.map(([cat, list]) => `
    <div class="card">
      <h2><span class="bar"></span>${CAT_LABEL[cat] ?? cat} <span class="badge dim">${T('{n} 个', '{n}', { n: list.length })}</span></h2>
      ${list.map(rowHtml).join('')}
    </div>`).join('')
    || `<div class="card"><div class="empty-state">${icon('puzzle', { size: 32 })}<div class="es-title">${T('暂无插件', 'No plugins')}</div><div class="es-desc">${T('没有匹配的插件', 'No matching plugins')}</div></div></div>`;
}

function rowHtml(p) {
  const loaded = allPlugins.loaded.some((x) => x.name === p.name);
  const failed = allPlugins.failed.some((x) => x.name === p.name);
  const state = loaded
    ? `<span class="badge ok">${T('已装载', 'Loaded')}</span>`
    : failed
      ? `<span class="badge bad">${T('装载失败', 'Failed')}</span>`
      : `<span class="badge dim">${T('已禁用', 'Disabled')}</span>`;
  const caps = p.manifest?.capabilities ?? [];
  return `<div data-plug-name="${esc(p.name)}" style="display:flex;align-items:flex-start;gap:10px;padding:10px 4px;border-bottom:1px solid var(--line);cursor:pointer">
    <div style="flex:1;min-width:0">
      <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
        <span class="mono" style="font-weight:600;font-size:12.5px;color:var(--txt)">${esc(p.name)}</span>
        ${p.title ? `<span style="font-size:12.5px;color:var(--txt)">${esc(p.title)}</span>` : ''}
        ${state}
        ${p.locked ? `<span class="crumb" title="${T('锁定插件，不允许禁用', 'Locked plugin, cannot disable')}">${icon('lock', { size: 13 })} ${T('锁定', 'Locked')}</span>` : ''}
        ${caps.length ? `<span class="crumb">${T('{n} 项能力', '{n} capabilities', { n: caps.length })}</span>` : ''}
      </div>
      ${p.summary
        ? `<div style="font-size:12px;color:var(--dim);margin-top:2px;line-height:1.6">${esc(p.summary)}</div>`
        : `<div class="crumb" style="margin-top:2px">${T('无描述', 'No description')}</div>`}
      ${failed && p.reason ? `<div class="crumb" style="margin-top:2px;color:var(--bad)">${T('失败原因：', 'Reason: ')}${esc(p.reason)}</div>` : ''}
    </div>
    <span style="flex-shrink:0;padding-top:2px"><button class="btn sm" data-plug-detail="${esc(p.name)}">${T('详情', 'Details')}</button></span>
  </div>`;
}

/* ---- 详情弹窗：kv 键值摘要 + 启停操作 ---- */
function openPlugDetail(name) {
  const p = [...allPlugins.loaded, ...allPlugins.disabled, ...allPlugins.failed].find((x) => x.name === name);
  if (!p) return;
  const loaded = allPlugins.loaded.some((x) => x.name === name);
  const dlg = $('plugDetailDlg');
  dlg.dataset.name = name;
  $('plugDetailTitle').innerHTML = `${T('插件详情', 'Plugin details')} · <span class="mono">${esc(name)}</span>`;
  const caps = p.manifest?.capabilities ?? [];
  const exposes = p.manifest?.exposes ? Object.keys(p.manifest.exposes) : [];
  const declared = p.declared;
  const kvRow = (k, v) => `<div class="k">${k}</div><div class="v">${v}</div>`;
  const list = (arr) => arr.length
    ? `<div style="display:flex;gap:6px;flex-wrap:wrap">${arr.map((x) => `<span class="badge dim mono" style="font-size:11px">${esc(x)}</span>`).join('')}</div>`
    : T('—', '—');
  $('plugDetailBody').innerHTML = `<div class="kv">
    ${p.summary ? `<div class="k">${T('简介', 'Summary')}</div><div class="v" style="grid-column:2">${esc(p.summary)}</div>` : ''}
    ${kvRow(T('中文名称', 'Title'), esc(p.title ?? '—'))}
    ${kvRow(T('分层', 'Layer'), `<span class="layer ${CAT_CLS[catOf(p)] ?? ''}">${CAT_LABEL[catOf(p)] ?? '—'}</span>`)}
    ${kvRow(T('来源', 'Source'), p.source === 'external' ? T('外部', 'External') : T('内置', 'Built-in'))}
    ${kvRow(T('当前状态', 'State'), loaded
      ? `<span class="badge ok">${T('已装载 · 服务在位', 'Loaded · services active')}</span>`
      : allPlugins.failed.some((x) => x.name === name)
        ? `<span class="badge bad">${T('装载失败', 'Failed to load')}</span>`
        : `<span class="badge dim">${T('已禁用 · 重启网关后跳过装载', 'Disabled · skipped on next gateway start')}</span>`)}
    ${kvRow('provides', list(p.provides ?? []))}
    ${kvRow('inject', list(p.inject ?? []))}
    ${kvRow('capabilities', list(caps))}
    ${kvRow('exposes', list(exposes))}
    ${kvRow(T('配置覆盖', 'Config override'), declared === null || declared === undefined
      ? `<span class="crumb">plugins.${esc(name)}.enabled = ${T('（未显式配置，按默认）', '(not set; default applies)')}</span>`
      : `<span class="mono">plugins.${esc(name)}.enabled = ${esc(JSON.stringify(declared))}</span>`)}
    ${!loaded && p.reason ? `<div class="k"></div><div class="v"><span class="notebox warn" style="margin-top:10px">${T('失败原因：', 'Reason: ')}${esc(p.reason)}</span></div>` : ''}</div>`;
  const toggle = $('plugDetailToggle');
  const locked = p.locked && loaded;
  toggle.style.display = locked ? 'none' : '';
  toggle.className = loaded ? 'btn danger' : 'btn primary';
  toggle.textContent = loaded ? T('禁用', 'Disable') : T('启用', 'Enable');
  $('plugDetailErr').textContent = '';
  openDlg(dlg);
}

/* ---- 页面内启停（详情弹窗内外共用）：确认 → PATCH → 刷新 ---- */
async function toggleFromPage(name, enabled, fromDlg = false) {
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
    if (fromDlg) closeDlg($('plugDetailDlg'));
    // 只刷新数据与分组，不重建弹窗 DOM
    const d = await api('/admin/plugins');
    allPlugins = d;
    $('plugSummary').textContent = T('装载 {a} · 禁用 {b} · 失败 {c}', 'Loaded {a} · Disabled {b} · Failed {c}', { a: d.loaded.length, b: d.disabled.length, c: d.failed.length });
    renderGroups();
  } catch (e) { if (e.message !== '401') toast('✗ ' + e.message, 'bad'); }
}
