/**
 * 插件自带页面 · ent-audit（审计留痕）
 * 过滤（用户/模型/标记）+ 真分页 + 详情按 id 服务端直取 + CSV 导出（含操作人水印）
 * 设置面：默认每页条数 + 列显隐 + 导出上限（GET/PATCH /admin/audit-config，落盘持久化）
 */
import { api, $, toast, esc, icon, openDlg, closeDlg } from '/admin/static/contract.mjs';

const state = { page: 1, size: 30, total: 0 };
let ui = { pageSize: 30, exportLimit: 200, columns: { upstream: true, tokens: true, duration: true, flag: true } };
let uiMeta = { pageSizes: [15, 30, 50, 100], columnKeys: [], columnLabels: {} };

export default {
  page: 'ent-audit',
  html: `
  <div class="headrow" data-ent-page="ent-audit">
    <div><h1>审计留痕</h1></div>
    <div class="sp"></div>
    <button class="btn sm" id="auditSettingsBtn" title="设置本页展示"></button>
  </div>

  <div class="card">
    <div style="display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap;align-items:center">
      <input class="input" id="filterUser" placeholder="用户（工号）" style="width:140px">
      <input class="input" id="filterModel" placeholder="模型关键字" style="width:140px">
      <select class="input" id="filterFlag" style="width:110px">
        <option value="">全部标记</option>
        <option value="dlp">DLP 命中</option>
        <option value="blocked">已拦截</option>
      </select>
      <button class="btn primary" id="logSearchBtn">检索</button>
      <button class="btn" id="logClearBtn">清除</button>
      <span style="flex:1"></span>
      <select class="input" id="pageSize" style="width:100px" title="每页条数">
        <option value="15">15 条/页</option>
        <option value="30" selected>30 条/页</option>
        <option value="50">50 条/页</option>
        <option value="100">100 条/页</option>
      </select>
      <button class="btn" id="exportBtn">导出 CSV</button>
    </div>
    <div id="auditTableHost"></div>
    <div class="pager" id="logPager"></div>
  </div>`,

  bind() {
    $('auditSettingsBtn').innerHTML = icon('settings', { size: 14 });
    $('auditSettingsBtn').addEventListener('click', () => openSettings());
    bindAuditEvents();
  },

  async load() {
    await loadAll();
  },
};

async function loadAll() {
  // 设置先行（列显隐决定表头；默认条数决定 pageSize 初始值）
  try {
    const c = await api('/admin/audit-config');
    ui = c.ui ?? ui;
    uiMeta = { pageSizes: c.pageSizes ?? uiMeta.pageSizes, columnKeys: c.columnKeys ?? [], columnLabels: c.columnLabels ?? {} };
  } catch { /* 用默认 */ }
  const sizeSel = $('pageSize');
  if (sizeSel && ![...sizeSel.options].some((o) => Number(o.value) === state.size)) {
    sizeSel.value = String(ui.pageSize);
  }
  await loadLogs(state.page);
}

/* ---------- 列表查询 + 渲染 ---------- */
function filterParams() {
  const u = $('filterUser')?.value.trim() ?? '';
  const m = $('filterModel')?.value.trim() ?? '';
  const flag = $('filterFlag')?.value ?? '';
  return { u, m, flag };
}

export async function loadLogs(page = 1) {
  try {
    const { u, m, flag } = filterParams();
    state.size = Number($('pageSize')?.value) || ui.pageSize || 30;
    state.page = Math.max(1, page);
    const qs = new URLSearchParams({ limit: state.size, offset: (state.page - 1) * state.size });
    if (u) qs.set('user', u);
    if (m) qs.set('model', m);
    if (flag) qs.set('flag', flag);
    const r = await api('/admin/logs?' + qs);
    const logs = r.logs ?? [];
    state.total = r.total ?? logs.length;
    renderRows(logs);
    renderPager();
  } catch { /* 401 已处理 */ }
}

/** 表头/行渲染按 ui.columns 显隐列（时间/用户/模型为主列恒显） */
function colSpan() { return 3 + COLUMN_VISIBLE_COUNT(); }
function COLUMN_VISIBLE_COUNT() {
  return ['upstream', 'tokens', 'duration', 'flag'].filter((k) => ui.columns[k] !== false).length;
}

function renderRows(logs) {
  const head = `<thead><tr><th>时间</th><th>用户</th><th>企业模型</th>
    ${ui.columns.upstream !== false ? '<th>上游模型</th>' : ''}
    ${ui.columns.tokens !== false ? '<th class="num">Tokens (入/出)</th>' : ''}
    ${ui.columns.duration !== false ? '<th class="num">耗时</th>' : ''}
    ${ui.columns.flag !== false ? '<th>标记</th>' : ''}
    <th></th></tr></thead>`;
  const host = $('auditTableHost');
  if (!logs.length) {
    const filtered = filterParams().u || filterParams().m || filterParams().flag;
    host.innerHTML = `<table>${head}<tbody><tr><td colspan="${colSpan() + 1}" class="empty">${filtered ? '无匹配留痕' : '暂无留痕'}</td></tr></tbody></table>`;
    return;
  }
  const rows = logs.map((l) => {
    let flagHtml = '';
    if (ui.columns.flag !== false) {
      flagHtml = `<td>${l.blocked ? `<span class="badge bad">${icon('shield-alert', { size: 12 })} 拦截</span>`
        : l.dlp_flag ? `<span class="badge warn">DLP:${esc(l.dlp_flag)}</span>` : ''}</td>`;
    }
    return `<tr>
      <td class="mono">${esc(l.ts)}</td><td><b>${esc(l.user_name)}</b></td>
      <td>${esc(l.model ?? '-')}</td>
      ${ui.columns.upstream !== false ? `<td class="mono">${esc(l.upstream_model ?? '-')}</td>` : ''}
      ${ui.columns.tokens !== false ? `<td class="num">${l.tokens_in ?? '?'} / ${l.tokens_out ?? '?'}</td>` : ''}
      ${ui.columns.duration !== false ? `<td class="num">${l.duration_ms ? l.duration_ms + 'ms' : '-'}</td>` : ''}
      ${flagHtml}
      <td><button class="btn sm" data-log="${l.id}">详情</button></td>
    </tr>`;
  }).join('');
  host.innerHTML = `<table>${head}<tbody>${rows}</tbody></table>`;
}

/** 分页条：总数 · 页码（当前页±1 + 首末页）· 上一页/下一页 · 跳页 */
function renderPager() {
  const totalPages = Math.max(1, Math.ceil(state.total / state.size));
  if (state.page > totalPages) state.page = totalPages;
  const el = $('logPager');
  if (!el) return;
  if (state.total === 0) { el.innerHTML = ''; return; }
  const btn = (label, page, opts = {}) =>
    `<button class="btn sm pg${opts.cur ? ' cur' : ''}" data-page="${page}" ${opts.dis ? 'disabled' : ''}>${label}</button>`;
  const pages = new Set([1, totalPages, state.page - 1, state.page, state.page + 1]);
  const list = [...pages].filter((p) => p >= 1 && p <= totalPages).sort((a, b) => a - b);
  let nums = '';
  let prev = 0;
  for (const p of list) {
    if (p - prev > 1) nums += '<span class="pg-dots">…</span>';
    nums += btn(p, p, { cur: p === state.page });
    prev = p;
  }
  el.innerHTML = `
    <span class="pg-info">共 <b>${state.total}</b> 条 · 第 ${state.page} / ${totalPages} 页</span>
    ${btn('«', 1, { dis: state.page <= 1 })}
    ${btn('‹', state.page - 1, { dis: state.page <= 1 })}
    ${nums}
    ${btn('›', state.page + 1, { dis: state.page >= totalPages })}
    ${btn('»', totalPages, { dis: state.page >= totalPages })}
    <span class="pg-jump">跳至 <input class="input" id="pgJump" type="number" min="1" max="${totalPages}" value="${state.page}" style="width:56px;padding:2px 6px"> 页</span>`;
}

/* ---------- 详情：按 id 从服务端直取（弹层自带，不依赖壳） ---------- */
async function showLogById(id) {
  let l;
  try {
    const r = await api('/admin/logs/' + id);
    l = r.log;
  } catch (e) {
    if (e.message !== '401') toast('✗ ' + e.message, 'bad');
    return;
  }
  if (!l) return toast('留痕记录不存在', 'bad');
  openLogModal(l);
}

function openLogModal(l) {
  let m = document.getElementById('auditLogModal');
  if (!m) { m = document.createElement('div'); m.id = 'auditLogModal'; m.className = 'dlg-mask'; document.body.appendChild(m); }
  const meta = `用户 <b>${esc(l.user_name)}</b> · ${esc(l.ts)} · ${esc(l.model)} → ${esc(l.upstream_model ?? '?')} · ${l.duration_ms ?? '?'}ms · 状态 ${l.status_code}${l.note ? ' · ' + esc(l.note) : ''}`;
  const promptHtml = l.prompt ? renderContext(l.prompt)
    : '（未存储正文 · metadata_only 模式）\n哈希: ' + (l.prompt_hash ?? '-');
  m.innerHTML = `
    <div class="dlg wide" role="dialog" aria-modal="true">
      <div class="dlg-head">
        <h2>留痕详情 <span class="mono">#${l.id}</span></h2>
        <button class="dlg-x" data-dlg-close title="关闭 (Esc)">${icon('x', { size: 16 })}</button>
      </div>
      <div class="dlg-body">
        <div style="font-size:13px;color:var(--dim);margin-bottom:10px">${meta}</div>
        <b style="font-size:13px">完整上下文（system + 历史对话 + 本轮输入 · 按 DLP 策略脱敏）</b>
        <blockquote class="detail" style="max-height:52vh">${promptHtml}</blockquote>
        <b style="font-size:13px">Response</b>
        <blockquote class="detail" style="max-height:38vh">${esc(l.response ?? '（该记录为修复前写入，响应正文未收集；流式请求已自 v2.2 起完整留痕）')}</blockquote>
      </div>
    </div>`;
  openDlg(m);
}

/** 把审计存储的上下文文本按 "[role]" 行分块渲染；不含标头则原样显示 */
function renderContext(text) {
  const blocks = String(text).split(/\n\n(?=\[[a-z]+\]\n)/);
  if (blocks.length <= 1) return esc(text);
  return blocks.map((b) => {
    const m = b.match(/^\[([a-z]+)\]\n([\s\S]*)$/);
    if (!m) return esc(b);
    const roleCls = m[1] === 'user' ? 'ok' : m[1] === 'assistant' ? '' : 'warn';
    return `<div style="margin-bottom:8px"><span class="badge ${roleCls}">${esc(m[1])}</span><div style="white-space:pre-wrap;margin-top:3px">${esc(m[2])}</div></div>`;
  }).join('');
}

/* ---------- CSV 导出（走契约 api()；带当前过滤条件 + 操作人水印） ---------- */
async function exportLogs() {
  const { u, m, flag } = filterParams();
  const qs = new URLSearchParams({ limit: ui.exportLimit ?? 200 });
  if (u) qs.set('user', u);
  if (m) qs.set('model', m);
  if (flag) qs.set('flag', flag);
  let r;
  try { r = await api('/admin/logs?' + qs); } catch (e) {
    if (e.message !== '401') toast('✗ ' + e.message, 'bad');
    return;
  }
  const stamp = new Date().toLocaleString('sv-SE');
  const watermark = `# 审计导出 · 操作人=${localStorage.getItem('ent_user') || 'admin'} · 时间=${stamp} · 记录数=${(r.logs ?? []).length} · 水印=${hashCode(stamp)}`;
  const rows = [['id', 'ts', 'user', 'model', 'upstream', 'tokens_in', 'tokens_out', 'ms', 'status', 'dlp', 'blocked', 'prompt_hash', 'prompt', 'response']];
  (r.logs ?? []).forEach((l) => rows.push([
    l.id, l.ts, l.user_name, l.model, l.upstream_model, l.tokens_in, l.tokens_out, l.duration_ms, l.status_code, l.dlp_flag ?? '', l.blocked, l.prompt_hash,
    csvCell(l.prompt), csvCell(l.response),
  ]));
  const csv = '\uFEFF' + watermark + '\n' + rows.map((r2) => r2.map(csvCell).join(',')).join('\n') + '\n' + watermark;
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  a.download = `gateway-logs-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  toast(`已导出 ${(r.logs ?? []).length} 条（当前过滤范围）· 含操作人水印`);
}

/* ---------- 事件绑定（一次性委托） ---------- */
function bindAuditEvents() {
  const host = $('auditTableHost');
  if (!host || host.dataset.auditBound) return;
  host.dataset.auditBound = '1';
  // 详情点击
  host.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-log]');
    if (btn) showLogById(Number(btn.dataset.log));
  });
  // 过滤：检索按钮 / 输入框回车 / 标记下拉即选即查 / 清除
  $('logSearchBtn').addEventListener('click', () => loadLogs(1));
  for (const id of ['filterUser', 'filterModel']) {
    $(id).addEventListener('keydown', (e) => { if (e.key === 'Enter') loadLogs(1); });
  }
  $('filterFlag').addEventListener('change', () => loadLogs(1));
  $('logClearBtn').addEventListener('click', () => {
    $('filterUser').value = ''; $('filterModel').value = ''; $('filterFlag').value = '';
    loadLogs(1);
  });
  // 每页条数
  $('pageSize').addEventListener('change', () => loadLogs(1));
  // 分页条（委托：页码按钮点击 + 跳页输入回车）
  $('logPager').addEventListener('click', (e) => {
    const b = e.target.closest('[data-page]');
    if (b && !b.disabled) loadLogs(Number(b.dataset.page));
  });
  $('logPager').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.id === 'pgJump') {
      loadLogs(Math.max(1, Number(e.target.value) || 1));
    }
  });
  $('exportBtn').addEventListener('click', exportLogs);
}

/* ---------- 设置弹层：默认条数 + 列显隐 + 导出上限 ---------- */
function openSettings() {
  let m = document.getElementById('auditSettingsModal');
  if (!m) { m = document.createElement('div'); m.id = 'auditSettingsModal'; m.className = 'dlg-mask'; document.body.appendChild(m); }
  const sizeOpts = (uiMeta.pageSizes ?? []).map((n) =>
    `<option value="${n}" ${ui.pageSize === n ? 'selected' : ''}>${n} 条/页</option>`).join('');
  const colRows = uiMeta.columnKeys.map((k) => `
    <label class="ov-set-row">
      <input type="checkbox" data-col-key="${k}" ${ui.columns[k] !== false ? 'checked' : ''}>
      <span>${esc(uiMeta.columnLabels[k] ?? k)}</span>
    </label>`).join('');
  m.innerHTML = `
    <div class="dlg sm" role="dialog" aria-modal="true">
      <div class="dlg-head">
        <h2>审计留痕展示设置</h2>
        <button class="dlg-x" data-dlg-close title="关闭 (Esc)">${icon('x', { size: 16 })}</button>
      </div>
      <div class="dlg-body">
        <div class="ov-set-row"><span class="ov-sec-label">默认每页条数</span>
          <select class="ov-sec-mode" id="auditSetSize">${sizeOpts}</select></div>
        <div class="ov-set-row"><span class="ov-sec-label">CSV 导出上限</span>
          <input class="input" id="auditSetExport" type="number" min="20" max="200" value="${ui.exportLimit}" style="width:80px;padding:3px 6px"></div>
        ${colRows}
      </div>
      <div class="dlg-foot">
        <button class="btn" data-dlg-close>取消</button>
        <button class="btn primary" id="auditSetSave">保存</button>
      </div>
    </div>`;
  openDlg(m);
  m.querySelector('#auditSetSave').addEventListener('click', async () => {
    const columns = {};
    for (const cb of m.querySelectorAll('[data-col-key]')) columns[cb.dataset.colKey] = cb.checked;
    const body = {
      ui: {
        pageSize: Number(m.querySelector('#auditSetSize').value),
        exportLimit: Number(m.querySelector('#auditSetExport').value) || 200,
        columns,
      },
    };
    try {
      const r = await api('/admin/audit-config', { method: 'PATCH', body: JSON.stringify(body) });
      ui = r.ui;
      closeDlg(m);
      toast('审计留痕展示设置已保存并落盘');
      $('pageSize').value = String(ui.pageSize);
      await loadLogs(1);
    } catch (e) { if (e.message !== '401') toast('✗ ' + e.message, 'bad'); }
  });
}

/* CSV 单元格转义（引号包裹 + 双引号转义，防逗号/换行/注入破坏列） */
function csvCell(v) {
  if (v === null || v === undefined) return '';
  const s = String(v).replaceAll('"', '""');
  return /[",\n\r]/.test(s) ? `"${s}"` : s;
}

function hashCode(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) { h = (h << 5) - h + s.charCodeAt(i); h |= 0; }
  return 'WM' + Math.abs(h).toString(36).toUpperCase();
}
