/**
 * 插件自带页面 · ent-catalog（供应商与模型）
 * 数据源：/admin/config + /admin/providers* + /admin/models*（本插件提供）
 * 约定：网关 4xx 返回 JSON {error:{message}}，统一经 must() 转异常后进错误提示
 */
import { api, $, toast, esc, must, confirmDlg, icon, openDlg, closeDlg } from '/admin/static/contract.mjs';
import { T } from '/admin/static/js/i18n.mjs';

let cachedConfig = { providers: [], models: [] };
// 思考档位 = DSH 终端 schema 白名单（与客户端 settings.yaml 校验严格一致）。
// 不再支持自定义档位：名单外档位透传到终端会让整个 llm-pi-ai 段被宿主 schema 拒绝
//（模型选择器全空且无显式报错），探测/应用/配置三层都只认这 7 个。
const PRESET_LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'];
let probeLevelsCfg = ['off', 'low', 'medium', 'high'];   // 逐档测试默认档位 = 勾选集（网关配置 probe.thinkingLevels）

/** 本次逐档测试的档位 = 弹窗勾选项（至少留一档，空则回落配置默认） */
function selectedProbeLevels() {
  const picked = [...document.querySelectorAll('.probeLv:checked')].map((c) => c.value);
  return picked.length ? picked : probeLevelsCfg;
}

/** 渲染探测弹窗的档位勾选组：仅 DSH 白名单档位 */
function renderProbeLvBoxes() {
  const wrap = $('probeLvWrap');
  if (!wrap) return;
  wrap.innerHTML = PRESET_LEVELS.map((lv) => `<label class="chk"><input type="checkbox" class="probeLv" value="${esc(lv)}" ${probeLevelsCfg.includes(lv) ? 'checked' : ''}>${esc(lv)}</label>`).join('');
}

/* ---------- 弹窗开关（统一走 core.mjs dlg 栈：openDlg/closeDlg 管滚动锁与 Esc） ---------- */
function openModal(el) {
  openDlg(el);
}
function closeModal(el) {
  closeDlg(el);
}

/* ---------- 加载与渲染 ---------- */
async function loadConfig() {
  try {
    const c = await api('/admin/config');
    cachedConfig = { providers: c.providers ?? [], models: c.models ?? [] };
    if (Array.isArray(c.probe?.thinkingLevels) && c.probe.thinkingLevels.length) {
      probeLevelsCfg = c.probe.thinkingLevels.filter((x) => PRESET_LEVELS.includes(x));
    }
    renderProbeLvBoxes();   // 勾选状态每次都跟随配置（弹窗内改了没点「设为默认」则以配置为准）
    renderProviders();
    renderModels();
  } catch (e) {
    if (e.message !== '401') toast('✗ ' + T('配置加载失败：{msg}', 'Failed to load config: {msg}', { msg: e.message }), 'bad');   // 401 已由 api() 弹登录
  }
}

/** 头像底色：按 id 哈希从固定调色板取色（同一供应商恒定同色） */
const AVATAR_COLORS = ['#2563eb', '#059669', '#7c3aed', '#d97706', '#0891b2', '#db2777', '#4f46e5', '#16a34a'];
function avatarColor(id) {
  let h = 0;
  for (let i = 0; i < String(id).length; i++) h = (h * 31 + String(id).charCodeAt(i)) | 0;
  return AVATAR_COLORS[Math.abs(h) % AVATAR_COLORS.length];
}

/** 过滤：当前搜索词（小写）为空 = 全过；否则匹配 id/name/baseUrl/模型 id/上游模型 */
function matchFilter(...fields) {
  const q = ($('filterInput')?.value ?? '').trim().toLowerCase();
  if (!q) return true;
  return fields.some((f) => String(f ?? '').toLowerCase().includes(q));
}

function renderProviders() {
  const { providers, models } = cachedConfig;
  const shown = providers.filter((p) => matchFilter(p.id, p.name, p.baseUrl, ...models.filter((m) => m.providerId === p.id).map((m) => m.id + ' ' + m.upstreamModel)));
  $('provCount').textContent = T('{n} 个', '{n} total', { n: providers.length });
  $('provList').innerHTML = shown.map((p) => {
    const served = models.filter((m) => m.providerId === p.id);
    const fbOf = models.filter((m) => (m.fallbackProviders ?? []).includes(p.id));
    const keyTxt = p.apiKeyEnv ? '.env:' + esc(p.apiKeyEnv) : T('未配置密钥', 'No API key');
    const protoTxt = { anthropic: 'Anthropic', gemini: 'Gemini' }[p.protocol] ?? '';
    const protoBadge = protoTxt ? `<span class="badge" title="${T('上游协议：{p}', 'Upstream protocol: {p}', { p: protoTxt })}">${protoTxt}</span>` : '';
    const keyOk = p.hasKey
      ? `<span class="badge ok">${T('密钥 ✓', 'API key ✓')}</span>`
      : `<span class="badge bad">${T('密钥 ✗', 'API key ✗')}</span>`;
    const upAll = served.every((m) => m.enabled !== false);
    return `<div class="prov-item ${p.enabled ? '' : 'off'}">
      <div class="prov-avatar" style="background:${avatarColor(p.id)}">${esc((p.name || p.id || '?').trim().charAt(0).toUpperCase())}</div>
      <div class="prov-main">
        <div class="prov-title">
          <b>${esc(p.name)}</b>
          <span class="mapchip mono">${esc(p.id)}</span>
          ${protoBadge}
          ${p.enabled ? '' : `<span class="badge dim">${T('已禁用', 'Disabled')}</span>`}
          ${served.length ? (upAll ? `<span class="badge">${T('{n} 模型', '{n} models', { n: served.length })}</span>` : `<span class="badge warn">${T('{a}/{b} 上架', '{a}/{b} listed', { a: served.filter((m) => m.enabled !== false).length, b: served.length })}</span>`) : ''}
          ${keyOk}
        </div>
        <div class="prov-meta">
          <span class="mapchip mono">${esc(p.baseUrl)}</span>
          <span class="dim2">${T('超时 {t}s · 权重 {w} · {k}', 'Timeout {t}s · Weight {w} · {k}', { t: Math.round((p.timeoutMs ?? 120000) / 1000), w: p.weight ?? 0, k: keyTxt })}</span>
        </div>
        <div class="prov-served">
          ${served.length
            ? T('承载 {list}', 'Serving {list}', { list: served.map((m) => `<span class="mapchip mono">${esc(m.id)}</span>`).join(' ') })
            : `<span class="dim2">${T('尚未承载模型', 'No models yet')}</span>`}
          ${fbOf.length ? `<span class="dim2">${T('· 容灾: {list}', '· Failover: {list}', { list: fbOf.map((m) => esc(m.id)).join(', ') })}</span>` : ''}
        </div>
      </div>
      <div class="prov-ops">
        <button class="btn sm" data-phealth="${esc(p.id)}" title="${T('状态检测与统计', 'Health check & stats')}">${T('状态', 'Status')}</button>
        <button class="btn sm" data-ptest="${esc(p.id)}" title="${T('模型设置', 'Model settings')}">${T('模型设置', 'Model settings')}</button>
        <button class="btn sm" data-pedit="${esc(p.id)}">${T('编辑', 'Edit')}</button>
        <button class="btn sm danger" data-pdel="${esc(p.id)}">${T('删除', 'Delete')}</button>
        <span class="rowswitch ${p.enabled ? 'on' : ''}" data-ptoggle="${esc(p.id)}" title="${p.enabled ? T('点击禁用（其下模型走容灾）', 'Click to disable (models use failover)') : T('点击启用', 'Click to enable')}"></span>
      </div>
    </div>`;
  }).join('') || (providers.length
    ? `<div class="empty">${T('无匹配结果', 'No matches')}</div>`
    : `<div class="empty">${T('暂无供应商 —— 点右上角「＋ 新增供应商」', 'No providers yet — add one at top right')}</div>`);
}

/** 思考档位徽章（模型表与模型设置弹窗共用）——表达的是配置：可选/强制 + 默认档位 */
const thinkBadge = (m) => {
  if (m.thinking === 'none') return `<span class="badge dim">${T('不支持思考', 'No thinking')}</span>`;
  if (m.thinking === 'always') return `<span class="badge warn">${T('强制档位 · {lv}', 'Forced · {lv}', { lv: esc(m.defaultThinking ?? 'medium') })}</span>`;
  return `<span class="badge">${T('支持思考 · 默认 {lv}', 'Thinking · default {lv}', { lv: esc(m.defaultThinking ?? 'off') })}</span>`;
};
/** 输入模式徽章（共用）：图片/视频/音频 */
const modeChipOf = (m) => {
  const extra = (m.inputModes ?? []).filter((x) => x !== 'text');
  if (!extra.length) return '';
  const names = { image: T('图片', 'Image'), video: T('视频', 'Video'), audio: T('音频', 'Audio') };
  return `<span class="badge dim">${esc(extra.map((x) => names[x] ?? x).join('+'))}</span>`;
};

function renderModels() {
  const { providers, models } = cachedConfig;
  const provName = (id) => providers.find((p) => p.id === id)?.name ?? id;
  const shown = models.filter((m) => matchFilter(m.id, m.displayName, m.upstreamModel, provName(m.providerId)));
  $('modelCount').textContent = T('{n} 个', '{n} total', { n: models.length });
  // 手工维护的自定义档位/注入参数 → 一枚紧凑徽章（hover 看明细），不再逐个铺开
  const customChip = (m) => {
    const lv = (m.thinkingLevels ?? []).filter((x) => !PRESET_LEVELS.includes(x));
    if (!lv.length && !m.thinkingParams) return '';
    const tip = lv.length ? T('自定义档位：{lv}', 'Custom levels: {lv}', { lv: lv.join(T('、', ', ')) }) : '';
    const tipP = m.thinkingParams ? T('注入参数：{p}', 'Injected params: {p}', { p: Object.keys(m.thinkingParams).join(T('、', ', ')) }) : '';
    return `<span class="badge dim" title="${esc([tip, tipP].filter(Boolean).join(T('（含每档注入参数）\n', ' (with per-level params)\n')))}">${T('自定义', 'Custom')}${lv.length ? '×' + lv.length : ''}${m.thinkingParams ? T('·参数', '·params') : ''}</span>`;
  };
  // 输入模式：非文本模式缩为一枚徽章（hover 明细）
  const modeChip = modeChipOf;
  $('modelBody').innerHTML = shown.map((m) => {
    const prov = providers.find((p) => p.id === m.providerId);
    const off = m.enabled === false;
    // 实际服务状态：主家可用 = 正常；主家停用但有启用容灾 = 容灾承接（显示容灾路由）；主家停用且无容灾 = 实际不可服务（表格置灰提示）
    const provOn = prov && prov.enabled;
    const fbIds = m.fallbackProviders ?? [];
    const fbProv = fbIds.map((fid) => providers.find((p) => p.id === fid)).filter((p) => p && p.enabled);
    const fbName = fbProv.length ? fbProv[0].name : (providers.find((p) => p.id === fbIds[0])?.name ?? fbIds[0] ?? '');
    const fbUpstream = m.upstreamModelByProvider?.[fbIds[0]] ?? m.upstreamModel;
    const unservable = !provOn && !fbProv.length;   // 主家停用且无可用容灾：终端已自动隐藏，表格同步标注
    const routeCell = unservable
      ? `<span class="route-chip">${esc(provName(m.providerId))}</span><span class="route-arrow">→</span><span class="mono">${esc(m.upstreamModel)}</span>` +
        '<div class="msub" style="color:var(--warn)">⚠ ' + T('主供应商不可用且无容灾', 'Main provider down, no failover') + '</div>'
      : (!provOn && fbProv.length
        ? `<span class="route-chip">${esc(fbName)}</span><span class="route-arrow">→</span><span class="mono">${esc(fbUpstream)}</span>` +
          `<div class="msub" title="${T('主供应商禁用/密钥失效/上游不可用时自动切换', 'Auto-switches when the provider is disabled, key invalid, or upstream down')}">${T('容灾运行中', 'Running on failover')}</div>`
        : `<span class="route-chip">${esc(provName(m.providerId))}</span><span class="route-arrow">→</span><span class="mono">${esc(m.upstreamModel)}</span>` +
          (fbIds.length ? `<div class="msub" style="color:var(--dim)">${T('容灾：{a} → {b}', 'Failover: {a} → {b}', { a: esc(fbName), b: esc(fbUpstream) })}</div>` : ''));
    return `<tr ${off || unservable ? 'style="opacity:.6"' : ''}>
      <td>
        <div class="mname">${esc(m.id)}</div>
        <div class="msub">${esc(m.displayName ?? '')}${m.mode === 'reasoning' ? T(' · 深度推理', ' · deep reasoning') : ''}</div>
      </td>
      <td>${routeCell}</td>
      <td class="num">${fmt1k(m.contextWindow)} / ${fmt1k(m.maxTokens)}</td>
      <td><div class="think-cell">${thinkBadge(m)}${customChip(m)}${modeChip(m)}</div></td>
      <td class="num mono" title="${T('输入 / 输出 / 缓存命中输入', 'Input / output / cached input')}">${fmtPrice(m.pricePer1MIn)} / ${fmtPrice(m.pricePer1MOut)} / <span style="color:var(--dim)">${fmtPrice(m.pricePer1MCacheIn ?? m.pricePer1MIn)}</span></td>
      <td style="white-space:nowrap">
        <span class="rowswitch ${off ? '' : 'on'}" data-mtoggle="${esc(m.id)}" data-to="${off ? 1 : 0}" title="${off ? T('已下架，点击上架', 'Unlisted, click to list') : T('上架中，点击下架', 'Listed, click to unlist')}"></span>
        <span class="dim2">${off ? T('已下架', 'Unlisted') : unservable ? T('不可服务', 'Unservable') : T('上架中', 'Listed')}</span>
      </td>
      <td style="white-space:nowrap">
        <button class="btn sm" data-medit="${esc(m.id)}">${T('编辑', 'Edit')}</button>
        <button class="btn sm danger" data-mdel="${esc(m.id)}">${T('删除', 'Delete')}</button>
      </td>
    </tr>`;
  }).join('') || (models.length
    ? `<tr><td colspan="7" class="empty">${T('无匹配结果', 'No matches')}</td></tr>`
    : `<tr><td colspan="7" class="empty">${T('暂无模型 —— 先新增供应商', 'No models yet — add a provider first')}</td></tr>`);
}

/** 131072 → 128k（K=1024，与官方上下文口径一致）· 1536 → 1.5k · 999 → 999 */
const fmt1k = (n) => {
  n = Number(n) || 0;
  if (n < 1024) return String(n);
  const k = n / 1024;
  return (Number.isInteger(k) ? k : k.toFixed(k < 10 ? 2 : 1).replace(/\.?0+$/, '')) + 'k';
};
/** 单价：0 显示 —，其余去尾零（1.500 → 1.5） */
const fmtPrice = (n) => (Number(n) || 0) ? '¥' + String(Number(n)) : '—';

/** 轻量防抖：搜索框输入不再每键重渲染两列表 */
function debounce(fn, ms = 150) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

/* ---------- 表单校验 ---------- */
const ID_RE = /^[A-Za-z0-9_-]+$/;          // 供应商 ID（对齐服务端 [a-zA-Z0-9_-]{2,40}）
const MODEL_ID_RE = /^[A-Za-z0-9._-]+$/;   // 模型名（对齐服务端 [a-zA-Z0-9._-]{2,80}：允许点号，gpt-3.5-turbo 等）
const clampNum = (v, min, max, def) => {
  if (v == null || String(v).trim() === '') return def;   // 清空 = 回默认值（Number('') 是 0，必须先拦）
  const n = Number(v);
  if (!Number.isFinite(n)) return def;
  return Math.min(max, Math.max(min, Math.round(n)));
};

/* ---------- 供应商编辑器 ---------- */
function openProvEditor(p = null) {
  $('provEditorCard').hidden = false;
  $('provEditorTitle').textContent = p ? T('编辑供应商 · {id}', 'Edit provider · {id}', { id: p.id }) : T('新增供应商', 'Add provider');
  $('peId').value = p?.id ?? '';
  if (p) $('peId').dataset.orig = p.id; else delete $('peId').dataset.orig;   // 编辑态保持可输入：改动 ID = 改名（保存时确认）
  $('peName').value = p?.name ?? '';
  $('peUrl').value = p?.baseUrl ?? '';
  $('peProtocol').value = ['openai', 'anthropic', 'gemini'].includes(p?.protocol) ? p.protocol : 'openai';
  // 密钥：单一输入框。输入 → 服务端落 data/.env（配置文件只存变量名引用，永不明文）；留空 = 不修改
  $('peKey').value = '';
  $('peKey').placeholder = p?.hasKey ? T('已保存，留空不修改', 'Saved; leave blank to keep') : 'sk-…';
  $('peKeyEnv').value = p?.apiKeyEnv ?? '';
  $('peKeyEnv').dataset.orig = p?.apiKeyEnv ?? '';   // 保存时对比：变了才传 apiKeyEnv
  $('peTimeout').value = p?.timeoutMs ?? 120000;
  $('peWeight').value = p?.weight ?? 10;
  $('peEnabled').checked = p ? p.enabled : true;
  // 测活配置（默认开 · 15s · 2 次 · 自动恢复）
  $('peProbeEnabled').checked = p ? p.probeEnabled !== false : true;
  $('peProbeInterval').value = p?.probeIntervalSec ?? 15;
  $('peProbeFailLimit').value = p?.probeFailLimit ?? 2;
  $('peErr').textContent = '';
  openModal($('provEditorCard'));
  $('peName').focus();
}

async function saveProvEditor() {
  const errEl = $('peErr');
  errEl.textContent = '';
  const idVal = $('peId').value.trim();
  // 客户端预校验：必填项 + 格式，减少一次无谓往返
  if (!idVal) { errEl.textContent = T('ID 不能为空', 'ID is required'); $('peId').focus(); return; }
  if (!ID_RE.test(idVal)) { errEl.textContent = T('ID 只能包含字母、数字、下划线、中划线', 'ID allows only letters, digits, underscore, dash'); $('peId').focus(); return; }
  const name = $('peName').value.trim();
  if (!name) { errEl.textContent = T('名称不能为空', 'Name is required'); $('peName').focus(); return; }
  const baseUrl = $('peUrl').value.trim();
  if (!/^https?:\/\//.test(baseUrl)) { errEl.textContent = T('Base URL 必须以 http:// 或 https:// 开头', 'Base URL must start with http:// or https://'); $('peUrl').focus(); return; }
  const b = {
    name,
    baseUrl,
    protocol: $('peProtocol').value,
    timeoutMs: clampNum($('peTimeout').value, 1000, 600000, 120000),
    weight: clampNum($('peWeight').value, 0, 1000, 10),
    enabled: $('peEnabled').checked,
    probeEnabled: $('peProbeEnabled').checked,
    probeIntervalSec: clampNum($('peProbeInterval').value, 5, 600, 15),
    probeFailLimit: clampNum($('peProbeFailLimit').value, 1, 10, 2),
  };
  // 密钥语义：输入新值 → 服务端写 data/.env；留空 → 不动；手动改 apiKeyEnv 变量名则跟随
  const keyInput = $('peKey').value.trim();
  const envName = $('peKeyEnv').value.trim();
  if (keyInput) {
    b.apiKey = keyInput;         // 服务端转存 .env，配置文件只留引用
  } else if (envName && envName !== $('peKeyEnv').dataset.orig) {
    b.apiKeyEnv = envName;       // 只改环境变量名（如手动配在系统环境里）
  }
  // 两者都没动 → 不传密钥字段（防止误清）
  const editing = !!$('peId').dataset.orig;   // 编辑态由 openProvEditor 设 orig；peId 可输入（改名），不能用 disabled 判断
  if (editing && idVal && idVal !== $('peId').dataset.orig) {
    const ok = await confirmDlg({
      title: T('供应商改名', 'Rename provider'),
      message: T('确定把供应商 ID 从「{a}」改名为「{b}」？其下所有模型与容灾引用将自动级联更新。', 'Rename provider ID from "{a}" to "{b}"? Models and failover references update automatically', { a: $('peId').dataset.orig, b: idVal }),
      confirmText: T('确认改名', 'Confirm rename'),
      danger: true,
    });
    if (!ok) return;
    b.newId = idVal;
  }
  const btn = $('peSaveBtn');
  btn.disabled = true;
  try {
    if (editing) await must(api('/admin/providers/' + encodeURIComponent($('peId').dataset.orig), { method: 'PATCH', body: JSON.stringify(b) }));
    else await must(api('/admin/providers', { method: 'POST', body: JSON.stringify({ ...b, id: idVal }) }));
    toast(b.newId ? T('供应商已改名为 {id}（挂载引用已级联更新）', 'Provider renamed to {id}; references updated', { id: b.newId }) : T('供应商已保存，即时生效', 'Provider saved, effective now'));
    closeModal($('provEditorCard'));
    loadConfig();
  } catch (e) {
    errEl.textContent = e.message === '401' ? '' : e.message;
  } finally {
    btn.disabled = false;
  }
}

/* ---------- 模型编辑器 ---------- */
function openModelEditor(m = null) {
  const providers = cachedConfig.providers;
  if (!providers.length) { toast(T('请先新增一个供应商，再上架模型', 'Add a provider before listing models'), 'bad'); return; }
  $('modelEditorCard').hidden = false;
  $('modelEditorTitle').textContent = m ? T('编辑模型 · {id}', 'Edit model · {id}', { id: m.id }) : T('上架模型', 'Add model');
  $('meProv').innerHTML = providers.map((p) =>
    `<option value="${esc(p.id)}" ${m?.providerId === p.id ? 'selected' : ''}>${esc(p.name)}${T('（{id}）', ' ({id})', { id: esc(p.id) })}${p.enabled ? '' : T(' · 已禁用', ' · disabled')}</option>`).join('');
  const renderFb = () => {
    const main = $('meProv').value;
    const others = providers.filter((p) => p.id !== main);
    $('meFallbacks').innerHTML = others.length
      ? others.map((p) => {
          // 下拉选容灾模型：来源 = 该供应商名下已上架的企业模型（用其 upstreamModel 名）
          const theirModels = cachedConfig.models.filter((x) => x.providerId === p.id && (x.enabled !== false));
          // 勾选状态 = fallbackProviders 里有，或 映射里有（两者历史上有过不一致：只写映射丢勾选，视为已配置）
          const mapped = m?.upstreamModelByProvider?.[p.id] ?? '';
          const checked = (m?.fallbackProviders ?? []).includes(p.id) || !!mapped;
          // 默认选中项：已有映射用映射；没有映射且该家存在与通用上游同名的模型则同名；否则强制选择（空选项标"必选"）
          const sameName = theirModels.find((x) => x.upstreamModel === m?.upstreamModel);
          const initVal = mapped || (m ? (sameName ? sameName.upstreamModel : '') : '');
          const needPick = !initVal;
          const opts = (needPick ? [`<option value="" class="ph">${T('⚠ 无同名，必选一个', '⚠ No same-name model, pick one')}</option>`] : [])
            .concat(theirModels.map((x) => `<option value="${esc(x.upstreamModel)}" ${initVal === x.upstreamModel ? 'selected' : ''}>${esc(x.displayName || x.id)}${T('（{v}）', ' ({v})', { v: esc(x.upstreamModel) })}</option>`))
            .join('');
          return `<label class="chk" style="align-items:center"><input type="checkbox" class="meFb" value="${esc(p.id)}" ${checked ? 'checked' : ''}> ${esc(p.name)}</label>` +
            `<select class="input meFbName" data-pid="${esc(p.id)}" style="width:200px;padding:3px 8px;font-size:12px;${needPick && checked ? 'border-color:var(--warn)' : ''}" ${checked ? '' : 'disabled'}>${opts}</select>`;
        }).join(' ')
      : '<span class="dim2">' + T('暂无其他供应商可作容灾', 'No other providers for failover') + '</span>';
  };
  renderFb();
  // 勾选/取消容灾供应商联动右侧的"该家模型名"输入框可用性
  $('meFallbacks').addEventListener('change', (e) => {
    if (e.target?.classList?.contains('meFb')) {
      const name = document.querySelector(`#meFallbacks .meFbName[data-pid="${CSS.escape(e.target.value)}"]`);
      if (name) name.disabled = !e.target.checked;
    }
  });
  $('meProv').onchange = () => { const keep = currentFb(); renderFb(); /* 主供应商切换后尽量保留仍有效的勾选 */ for (const c of document.querySelectorAll('#meFallbacks .meFb')) { if (keep.includes(c.value)) c.checked = true; } };

  $('meId').value = m?.id ?? '';
  if (m) $('meId').dataset.orig = m.id; else delete $('meId').dataset.orig;   // 编辑态保持可输入：改动 ID = 改名（保存时确认）
  $('meDisp').value = m?.displayName ?? '';
  $('meUpstream').value = m?.upstreamModel ?? '';
  $('meCtx').value = (m?.contextWindow ?? 131072) / 1024;
  $('meMax').value = (m?.maxTokens ?? 32768) / 1024;
  // 支持的输入模态（text 默认勾选且不可取消——纯文本是底线）
  const inputs = m?.inputModes ?? ['text'];
  for (const c of document.querySelectorAll('#meInputs .meIn')) {
    c.checked = c.value === 'text' ? true : inputs.includes(c.value);
    if (c.value === 'text') c.disabled = true;
  }
  $('meMode').value = m?.mode ?? 'chat';
  $('meThink').value = m?.thinking ?? 'optional';
  // 思考档位：只读回显（来源 = 探测应用写入的实测档位）；新增模型提示档位由探测写入
  const levels = m?.thinkingLevels ?? [];
  $('meThinkLevelsView').innerHTML = levels.length
    ? levels.map((x) => `<span class="badge ${x === 'off' ? 'dim' : 'ok'}" title="${x === 'off' ? T('关闭思考档', 'Thinking off') : T('实测支持的思考档位', 'Verified thinking levels')}">${esc(x)}</span>`).join('')
    : '<span class="dim2">' + T('暂无档位——逐档实测后写入', 'No levels yet — run per-level probe') + '</span>';
  $('meThinkBox').hidden = ($('meThink').value === 'none');   // 不支持思考时收起档位区，编辑器更清爽
  refreshThinkDefOptions(levels, m?.defaultThinking ?? 'off');
  $('mePin').value = m?.pricePer1MIn ?? '';
  $('mePout').value = m?.pricePer1MOut ?? '';
  $('mePcache').value = m?.pricePer1MCacheIn ?? '';
  $('meErr').textContent = '';
  openModal($('modelEditorCard'));
  $('meId').focus();
}

const currentFb = () => [...document.querySelectorAll('#meFallbacks .meFb:checked')].map((c) => c.value);

/** 默认档位下拉 = 模型档位名单（只读，由探测写入） */
function refreshThinkDefOptions(levels, selected) {
  const sel = $('meThinkDef');
  const opts = levels.length ? levels : ['off'];
  sel.innerHTML = opts.map((l) => `<option value="${esc(l)}">${esc(l)}</option>`).join('');
  sel.value = opts.includes(selected) ? selected : opts[0];
}

async function saveModelEditor() {
  const errEl = $('meErr');
  errEl.textContent = '';
  const idVal = $('meId').value.trim();
  if (!idVal) { errEl.textContent = T('模型名不能为空', 'Model ID is required'); $('meId').focus(); return; }
  if (!MODEL_ID_RE.test(idVal)) { errEl.textContent = T('模型名只能包含字母、数字、点、下划线、中划线', 'Model ID allows only letters, digits, dot, underscore, dash'); $('meId').focus(); return; }
  const upstream = $('meUpstream').value.trim();
  if (!upstream) { errEl.textContent = T('上游模型名不能为空', 'Upstream model is required'); $('meUpstream').focus(); return; }
  const b = {
    displayName: $('meDisp').value.trim() || undefined,
    providerId: $('meProv').value,
    upstreamModel: upstream,
    contextWindow: clampNum($('meCtx').value, 1, 1000000, 128) * 1024,
    maxTokens: clampNum($('meMax').value, 1, 1000000, 32) * 1024,
    inputModes: [...document.querySelectorAll('#meInputs .meIn:checked')].map((c) => c.value),
    mode: $('meMode').value,
    thinking: $('meThink').value,
    defaultThinking: $('meThinkDef').value,
    fallbackProviders: currentFb(),
    pricePer1MIn: Math.max(0, Number($('mePin').value) || 0),
    pricePer1MOut: Math.max(0, Number($('mePout').value) || 0),
    pricePer1MCacheIn: Math.max(0, Number($('mePcache').value) || 0),
  };
  // 容灾供应商的上游模型名映射：勾选的每家必须选定一个模型（空 = 未选，阻断保存）
  // 语义：与主家同名 → 不写映射（转发用通用名动态跟随）；只有手选的异名模型才固化映射
  const fbMap = {};
  for (const inp of document.querySelectorAll('#meFallbacks .meFbName')) {
    const pid = inp.dataset.pid;
    if (!b.fallbackProviders.includes(pid)) continue;
    const v = inp.value.trim();
    if (!v) {
      const pname = cachedConfig.providers.find((p) => p.id === pid)?.name ?? pid;
      errEl.textContent = T('容灾供应商「{p}」尚未选择兜底模型', 'Failover provider "{p}" has no model selected', { p: pname });
      inp.focus();
      return;
    }
    if (v === upstream) continue;   // 同名：动态跟随通用 upstreamModel，不固化
    fbMap[pid] = v;
  }
  if (Object.keys(fbMap).length) b.upstreamModelByProvider = fbMap;
  else b.upstreamModelByProvider = null;   // 全部取消勾选 = 显式清空映射（否则后端联动规则会把孤儿映射当已配置补回勾选）
  if (!b.providerId) { errEl.textContent = T('请选择供应商', 'Select a provider'); $('meProv').focus(); return; }
  if (!b.inputModes.length) b.inputModes = ['text'];
  // 默认档位必须在模型档位名单内（名单只读，来源 = 探测应用写入）
  const lvNow = [...$('meThinkDef').options].map((o) => o.value);
  if (!lvNow.includes(b.defaultThinking)) {
    errEl.textContent = T('默认档位 {lv} 不在模型档位名单里', 'Default level {lv} is not in the model level list', { lv: b.defaultThinking });
    return;
  }
  const editing = !!$('meId').dataset.orig;   // 编辑态由 openModelEditor 设 orig；meId 可输入（改名）
  if (editing && idVal && idVal !== $('meId').dataset.orig) {
    const ok = await confirmDlg({
      title: T('模型改名', 'Rename model'),
      message: T('确定把模型从「{a}」改名为「{b}」？旧模型名立即失效，正在使用旧名的 DSH 终端需改用新名。', 'Rename model from "{a}" to "{b}"? The old name becomes invalid at once; DSH clients using it must switch', { a: $('meId').dataset.orig, b: idVal }),
      confirmText: T('确认改名', 'Confirm rename'),
      danger: true,
    });
    if (!ok) return;
    b.newId = idVal;
  }
  const btn = $('meSaveBtn');
  btn.disabled = true;
  try {
    if (editing) await must(api('/admin/models/' + encodeURIComponent($('meId').dataset.orig), { method: 'PATCH', body: JSON.stringify(b) }));
    else await must(api('/admin/models', { method: 'POST', body: JSON.stringify({ ...b, id: idVal }) }));
    toast(b.newId ? T('模型已改名为 {id}，旧名立即失效', 'Model renamed to {id}; old name invalid now', { id: b.newId }) : T('模型已保存，即时生效', 'Model saved, effective now'));
    closeModal($('modelEditorCard'));
    loadConfig();
  } catch (e) {
    errEl.textContent = e.message === '401' ? '' : e.message;
  } finally {
    btn.disabled = false;
  }
}

/* ---------- 事件绑定（一次性） ---------- */
function bindPage() {
  // 探测弹窗内的按钮（弹窗在 provList 外，独立委托）
  $('probeBody').addEventListener('click', async (e) => {
    const lv = e.target.closest('[data-levels]');
    if (lv) {
      await runLevelProbe(lv.dataset.levels, lv.dataset.model, lv.closest('.pcard'));
      return;
    }
    const ap = e.target.closest('[data-apply]');
    if (ap) {
      const model = ap.dataset.model;
      const card = ap.closest('.pcard');
      // 应用前必须先有逐档结果：若未测，先自动跑一轮再应用
      let probe = null;
      const detail = card?.querySelector('.pcard-detail');
      if (detail?.dataset.probe) {
        probe = JSON.parse(detail.dataset.probe);
      } else {
        ap.disabled = true; ap.textContent = T('测试中…', 'Testing…');
        try {
          probe = await api('/admin/providers/' + encodeURIComponent(ap.dataset.apply) + '/probe-levels', { method: 'POST', body: JSON.stringify({ model, levels: selectedProbeLevels() }) });
          renderDetail(detail, probe, '<span class="dim2">' + T('自动逐档测试完成，可直接应用', 'Auto probe done, apply now') + '</span>');
        } catch (e2) { toast('✗ ' + e2.message, 'bad'); ap.disabled = false; return; }
      }
      await applyProbeResult(ap.dataset.apply, model, probe, ap, card);
      return;
    }
    const pb = e.target.closest('[data-probe]');
    if (pb) {
      pb.disabled = true; pb.textContent = T('探测中…', 'Probing…');
      try {
        const r = await api('/admin/providers/' + encodeURIComponent(pb.dataset.probe) + '/probe', { method: 'POST', body: JSON.stringify({ model: pb.dataset.model }) });
        const cell = document.getElementById('probe-out-' + cssId(pb.dataset.model));
        if (cell) {
          if (r.ok) {
            const cls = r.thinking === 'real' ? 'ok' : r.thinking === 'rejected' ? 'warn' : r.thinking === 'silent' ? 'dim' : 'bad';
            cell.innerHTML = `<span class="badge ${cls}">${esc(r.verdict)}</span><span class="dim2">${r.ms}ms</span>${modalBadges(r.modalities)}`;
          } else {
            cell.innerHTML = `<span class="badge bad">✗ ${esc(r.error || T('探针失败', 'Probe failed'))}</span>`;
          }
        }
      } finally { pb.disabled = false; pb.textContent = T('探测思考', 'Probe thinking'); }
      return;
    }
    const imp = e.target.closest('[data-imp]');
    if (imp) {
      const pid = imp.dataset.imp;
      const c = await api('/admin/config');
      cachedConfig = { providers: c.providers ?? [], models: c.models ?? [] };
      openModelEditor(null);
      if (!$('modelEditorCard').hidden) {   // 无供应商时 openModelEditor 已拦截并提示
        $('meProv').value = pid;
        $('meId').value = imp.dataset.model;
        $('meUpstream').value = imp.dataset.model;
        closeModal($('probeModal'));   // 从探测弹窗跳转编辑弹窗：先出栈再入栈（dlg 栈统一管滚动锁）
        openModal($('modelEditorCard'));
        toast(T('已预填模型编辑器，补齐展示名/价格后保存', 'Model editor prefilled; set display name and price, then save'), 'ok');
      }
      return;
    }
  });
  $('probeCloseBtn').addEventListener('click', () => closeModal($('probeModal')));
  $('healthCloseBtn')?.addEventListener('click', () => closeModal($('healthModal')));
  // 「设为默认」：当前勾选 → PATCH /admin/probe-config 落盘（服务端只收 DSH 白名单档位）
  $('probeLvSaveBtn')?.addEventListener('click', async () => {
    const levels = selectedProbeLevels();
    try {
      const r = await must(api('/admin/probe-config', { method: 'PATCH', body: JSON.stringify({ thinkingLevels: levels }) }));
      probeLevelsCfg = r.thinkingLevels ?? levels;
      renderProbeLvBoxes();
      toast(T('✓ 探测默认档位已设为 {lv}（已落盘）', '✓ Probe default levels set to {lv}', { lv: probeLevelsCfg.join(' / ') }), 'ok');
    } catch (e) { toast('✗ ' + e.message, 'bad'); }
  });
  // 探测结果筛选：关键字（匹配卡片全部文字，含模型 id）+ 下拉（全部/真思考/问题项）叠加生效
  function applyProbeFilter() {
    const q = ($('probeSearch')?.value ?? '').trim().toLowerCase();
    const sel = $('probeFilter')?.value ?? 'all';
    let shown = 0;
    for (const card of document.querySelectorAll('#probeBody [data-probe-row]')) {
      const th = card.dataset.thinking;
      const ok = card.dataset.ok !== 'false';
      let show = true;
      if (sel === 'real') show = th === 'real';
      else if (sel === 'issues') show = !ok || th === 'rejected' || th === 'unavailable';
      if (show && q) show = card.textContent.toLowerCase().includes(q);
      card.style.display = show ? '' : 'none';
      if (show) shown++;
    }
    let empty = document.getElementById('probeEmptyRow');
    if (!shown) {
      if (!empty) {
        empty = document.createElement('div');
        empty.id = 'probeEmptyRow';
        empty.className = 'empty';
        empty.style.padding = '40px 0';
        $('probeBody').appendChild(empty);
      }
      empty.textContent = T('无匹配模型', 'No matching models');
    } else if (empty) empty.remove();
  }
  $('probeSearch').addEventListener('input', applyProbeFilter);
  $('probeSearch').addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.stopPropagation(); e.target.value = ''; applyProbeFilter(); e.target.blur(); }
  });
  $('probeFilter').addEventListener('change', applyProbeFilter);

  $('addProvBtn').addEventListener('click', () => openProvEditor(null));
  // 搜索过滤：防抖重渲染两个列表；Esc 清空
  const applyFilter = debounce(() => { renderProviders(); renderModels(); });
  $('filterInput').addEventListener('input', applyFilter);
  $('filterInput').addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.target.value = ''; applyFilter(); e.target.blur(); }
  });


  // 编辑器内部（密钥单框化：peKeyMode 切换已移除，Key 输入直接落 .env）
  $('peCloseBtn').addEventListener('click', () => closeModal($('provEditorCard')));
  $('peCancelBtn').addEventListener('click', () => closeModal($('provEditorCard')));
  $('peSaveBtn').addEventListener('click', saveProvEditor);
  $('meCloseBtn').addEventListener('click', () => closeModal($('modelEditorCard')));
  $('meCancelBtn').addEventListener('click', () => closeModal($('modelEditorCard')));
  $('meSaveBtn').addEventListener('click', saveModelEditor);
  // 思考能力切换 = none 时收起档位区
  $('meThink').addEventListener('change', () => { $('meThinkBox').hidden = $('meThink').value === 'none'; });
  for (const [input, btn] of [['peName', 'peSaveBtn'], ['peUrl', 'peSaveBtn'], ['meUpstream', 'meSaveBtn']]) {
    $(input).addEventListener('keydown', (e) => { if (e.key === 'Enter') $(btn).click(); });
  }

  // 供应商列表（委托）
  $('provList').addEventListener('click', async (e) => {
    const sw = e.target.closest('[data-ptoggle]');
    if (sw) {
      const id = sw.dataset.ptoggle;
      const target = !sw.classList.contains('on');
      try {
        await must(api('/admin/providers/' + encodeURIComponent(id), { method: 'PATCH', body: JSON.stringify({ enabled: target }) }));
        toast(target
          ? T('{id} 已启用', '{id} enabled', { id })
          : T('{id} 已禁用，其下模型将走容灾供应商', '{id} disabled; its models use failover', { id }));
      } catch (err) { toast(err.message, 'bad'); }
      return loadConfig();
    }
    const ph = e.target.closest('[data-phealth]');
    if (ph) { showHealthModal(ph.dataset.phealth); return; }
    const t = e.target.closest('[data-ptest]');
    if (t) {
      const origText = t.textContent;   // 记住原文案（'模型设置'），完成后恢复
      t.disabled = true; t.textContent = T('获取中…', 'Fetching…');
      try {
        // 只拉上游 /models 目录（秒回，不真实发探测请求）；真实测试在弹窗打开后按模型逐个执行
        const r = await api('/admin/providers/' + encodeURIComponent(t.dataset.ptest) + '/test', { method: 'POST' });
        if (r.ok) showProbeModal(t.dataset.ptest, r);
        else toast('✗ ' + (r.error?.message || r.error || T('获取失败', 'Fetch failed')), 'bad');
      } catch (err) {
        if (err.message !== '401') toast('✗ ' + T('请求失败：{msg}', 'Request failed: {msg}', { msg: err.message }), 'bad');
      } finally { t.disabled = false; t.textContent = origText; }
      return;
    }
    const ed = e.target.closest('[data-pedit]');
    if (ed) {
      const c = await api('/admin/config');
      cachedConfig = { providers: c.providers ?? [], models: c.models ?? [] };
      openProvEditor(cachedConfig.providers.find((x) => x.id === ed.dataset.pedit));
      return;
    }
    const del = e.target.closest('[data-pdel]');
    if (del) {
      const id = del.dataset.pdel;
      const c = await api('/admin/config');
      const used = (c.models ?? []).filter((m) => m.providerId === id || (m.fallbackProviders ?? []).includes(id));
      if (used.length) {
        toast(T('供应商「{id}」仍被 {n} 个模型使用（{list}），无法删除。请先编辑这些模型换供应商或删除模型。', 'Provider "{id}" is used by {n} models ({list}); edit or delete those models first', { id, n: used.length, list: used.map((m) => m.id).join(', ') }), 'bad');
        return;
      }
      const ok = await confirmDlg({
        title: T('删除供应商', 'Delete provider'),
        message: T('确定删除供应商「{id}」？此操作不可撤销。', 'Delete provider "{id}"? This cannot be undone', { id }),
        confirmText: T('确认删除', 'Confirm delete'),
        danger: true,
      });
      if (!ok) return;
      try {
        await must(api('/admin/providers/' + encodeURIComponent(id), { method: 'DELETE' }));
        toast(T('供应商已删除', 'Provider deleted'));
      } catch (err) { toast(err.message, 'bad'); }
      loadConfig();
    }
  });

  // 模型列表（委托）
  $('modelBody').addEventListener('click', async (e) => {
    const mt = e.target.closest('[data-mtoggle]');
    if (mt) {
      const up = mt.dataset.to === '1';
      try {
        await must(api('/admin/models/' + encodeURIComponent(mt.dataset.mtoggle), { method: 'PATCH', body: JSON.stringify({ enabled: up }) }));
        toast(up ? T('已上架，/v1/models 即时可见', 'Listed, visible in /v1/models now') : T('已下架，终端立即不可选', 'Unlisted, hidden from clients now'));
      } catch (err) { toast(err.message, 'bad'); }
      return loadConfig();
    }
    const md = e.target.closest('[data-mdel]');
    if (md) {
      const ok = await confirmDlg({
        title: T('删除模型', 'Delete model'),
        message: T('确定删除模型「{id}」？正在使用该模型的终端会立即收到"模型不存在"。', 'Delete model "{id}"? Clients using it will get "model not found" at once', { id: md.dataset.mdel }),
        confirmText: T('确认删除', 'Confirm delete'),
        danger: true,
      });
      if (!ok) return;
      try {
        await must(api('/admin/models/' + encodeURIComponent(md.dataset.mdel), { method: 'DELETE' }));
        toast(T('模型已删除', 'Model deleted'));
      } catch (err) { toast(err.message, 'bad'); }
      loadConfig();
      return;
    }
    const me = e.target.closest('[data-medit]');
    if (me) {
      const c = await api('/admin/config');
      cachedConfig = { providers: c.providers ?? [], models: c.models ?? [] };
      openModelEditor(cachedConfig.models.find((x) => x.id === me.dataset.medit));
    }
  });
}

/* ---------- 供应商测活状态弹窗 ---------- */
async function showHealthModal(pid) {
  const modal = $('healthModal');
  if (!modal) { toast('✗ ' + T('状态弹窗元素缺失，请硬刷新（Ctrl+Shift+R）', 'Health modal missing; hard refresh (Ctrl+Shift+R)'), 'bad'); return; }
  const prov = cachedConfig.providers.find((p) => p.id === pid);
  $('healthTitle').textContent = T('状态检测 · {name}', 'Health check · {name}', { name: prov?.name ?? pid });
  $('healthBody').innerHTML = `<span class="dim2">${T('加载中…', 'Loading…')}</span>`;
  modal.hidden = false; openModal(modal);
  let s;
  try { s = await api('/admin/providers/' + encodeURIComponent(pid) + '/probe-stats'); }
  catch (e) { $('healthBody').innerHTML = '<span class="err">' + T('加载失败：{msg}', 'Load failed: {msg}', { msg: esc(e.message) }) + '</span>'; return; }
  const fmtT = (t) => t ? new Date(t).toLocaleTimeString(undefined, { hour12: false }) : '—';
  const state = !prov?.enabled ? `<span class="badge warn">${T('已停用', 'Disabled')}</span>`
    : s.autoDisabled ? `<span class="badge warn">${T('检测自动停用中', 'Auto-disabled by health check')}</span>`
    : s.failStreak > 0 ? `<span class="badge warn">${T('连续失败 {n} 次', '{n} consecutive failures', { n: s.failStreak })}</span>`
    : s.total ? `<span class="badge ok">${T('正常', 'Healthy')}</span>`
    : `<span class="badge dim">${T('尚未探测', 'Not probed yet')}</span>`;
  const okRate = s.total ? Math.round((s.ok / s.total) * 100) : null;
  $('healthBody').innerHTML = `
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:14px">
      ${state}
      <span class="dim2">${T('检测', 'Check')} ${prov?.probeEnabled !== false ? T('每 {i}s 一次 · 连续 {n} 次失败自动停用', 'every {i}s · auto-disable after {n} failures', { i: prov?.probeIntervalSec ?? 15, n: prov?.probeFailLimit ?? 2 }) : T('未开启', 'off')}</span>
    </div>
    <div class="frm" style="grid-template-columns:repeat(3,1fr);gap:10px">
      <div class="card" style="padding:10px"><div class="dim2">${T('累计探测', 'Total probes')}</div><div style="font-size:22px;font-weight:600">${s.total}</div><div class="dim2">${T('成功 {ok} · 失败 {fail}', '{ok} ok · {fail} fail', { ok: s.ok, fail: s.fail })}${okRate != null ? T(' · 成功率 {r}%', ' · {r}% ok', { r: okRate }) : ''}</div></div>
      <div class="card" style="padding:10px"><div class="dim2">${T('平均延迟', 'Avg latency')}</div><div style="font-size:22px;font-weight:600">${s.avgMs != null ? s.avgMs + '<span style="font-size:12px">ms</span>' : '—'}</div><div class="dim2">${T('最近一次 {v}', 'Last {v}', { v: s.lastMs != null ? s.lastMs + 'ms' : '—' })}</div></div>
      <div class="card" style="padding:10px"><div class="dim2">${T('最近探测', 'Last probe')}</div><div style="font-size:14px;font-weight:600" title="${s.lastError ? esc(s.lastError) : ''}">${s.lastFailAt ? '<span style="color:var(--warn)">✗ ' + fmtT(s.lastFailAt) + '</span>' : s.lastOkAt ? '<span style="color:var(--ok)">✓ ' + fmtT(s.lastOkAt) + '</span>' : '—'}</div><div class="dim2">${s.lastError ? esc(s.lastError.slice(0, 60)) : T('最近成功 {t}', 'Last ok {t}', { t: fmtT(s.lastOkAt) })}</div></div>
    </div>`;
}

/* ---------- 上游模型探测弹窗 ---------- */
const cssId = (s) => String(s).replace(/[^a-zA-Z0-9_-]/g, '_');

/** 上游元数据声明的多模态提示 chips（supported_parameters / input_modalities 含图片或视频时显示） */
function metaModalChips(m) {
  const sp = Array.isArray(m.supported_parameters) ? m.supported_parameters : [];
  const im = Array.isArray(m.input_modalities) ? m.input_modalities : [];
  const hasImg = sp.some((x) => /image|vision/i.test(String(x))) || im.includes('image');
  const hasVid = sp.some((x) => /video/i.test(String(x))) || im.includes('video');
  if (!hasImg && !hasVid) return '';
  const chips = [];
  if (hasImg) chips.push(`<span class="badge dim" title="${T('上游 /models 元数据声明支持图片输入，实测以逐档测试为准', 'Declared by upstream /models metadata; per-level probe decides')}">${T('元数据·图片', 'Meta·image')}</span>`);
  if (hasVid) chips.push(`<span class="badge dim" title="${T('上游 /models 元数据声明支持视频输入，实测以逐档测试为准', 'Declared by upstream /models metadata; per-level probe decides')}">${T('元数据·视频', 'Meta·video')}</span>`);
  return chips.join(' ');
}

function showProbeModal(pid, r) {
  // 全量探测结果优先（results 含每个模型的快速判定）；逐档测试在行内展开
  const modal = $('probeModal');
  if (!modal) { toast('✗ ' + T('探测弹窗元素缺失（页面结构异常），请硬刷新（Ctrl+Shift+R）', 'Probe modal missing; hard refresh (Ctrl+Shift+R)'), 'bad'); return; }
  const results = r.results ?? null;
  const details = results ?? (r.modelDetails ?? (r.upstreamModels ?? []).map((id) => ({ id })));
  const servedIds = new Set((cachedConfig.models ?? []).filter((m) => m.providerId === pid).map((m) => m.upstreamModel));
  $('probeTitle').textContent = T('模型设置 · {id}', 'Model settings · {id}', { id: pid });
  const summary = r.verdict ? `<span class="badge ok">${esc(r.verdict)}</span> ` : '';
  // 汇总：总数 / 真思考 / 问题项 / 已导入，一眼看清这批上游模型质量
  const realN = results ? details.filter((m) => m.thinking === 'real').length : null;
  const badN = results ? details.filter((m) => m.ok === false || m.thinking === 'rejected' || m.thinking === 'unavailable').length : null;
  const servedN = details.filter((m) => servedIds.has(m.id)).length;
  $('probeMeta').innerHTML = `${summary}<span class="dim2">${T('{n} 个模型', '{n} models', { n: details.length })}${realN != null ? ` · ${T('✓ 真思考 {n}', '✓ {n} real thinking', { n: realN })}${badN ? ` · ${T('⚠ 问题项 {n}', '⚠ {n} issues', { n: badN })}` : ''}` : ''} · ${T('已导入 {n}', '{n} imported', { n: servedN })} · ${r.ms ?? '—'}ms</span>`;
  $('probeBody').innerHTML = details.map((m) => {
    const served = servedIds.has(m.id);
    const ctx = m.context_length ? T('上下文 {v}', 'Context {v}', { v: fmt1k(m.context_length) }) : '';
    // 上游 /models 元数据里的多模态声明（OpenRouter architecture.input_modalities 等）——仅提示，实测以逐档测试为准
    const metaMod = metaModalChips(m);
    // 已导入模型：显示企业模型当前的思考档位配置（支持思考·默认off / 强制档位 / 不支持思考）
    const ent = (cachedConfig.models ?? []).find((x) => x.providerId === pid && x.upstreamModel === m.id);
    const thinkNow = served && ent ? thinkBadge(ent) : '';
    // 已导入模型：企业侧配置明细（上下文 / 输入 / 输出 / 默认档位）——来自上架时的配置，不是上游元数据
    const entMeta = served && ent
      ? `<div class="dim2" style="margin-top:6px">${T('上下文 {c} / 输出 {o}', 'Context {c} / output {o}', { c: fmt1k(ent.contextWindow), o: fmt1k(ent.maxTokens) })}${modeChipOf(ent)} · ${T('默认档位 {d}', 'default {d}', { d: esc(ent.defaultThinking ?? 'off') })}${(ent.thinkingLevels ?? []).length ? T(' · 档位 {lv}', ' · levels {lv}', { lv: esc(ent.thinkingLevels.join('/')) }) : ''}</div>`
      : '';
    let judge;
    if (results) {
      const cls = m.thinking === 'real' ? 'ok' : m.thinking === 'rejected' ? 'warn' : m.thinking === 'silent' ? 'dim' : 'bad';
      const label = m.thinking === 'real' ? T('✓ 支持思考', '✓ Thinking') : m.thinking === 'rejected' ? T('⛔ 不可用', '⛔ Rejected') : m.thinking === 'silent' ? T('△ 无思考输出', '△ No thinking output') : T('✗ 不可用', '✗ Unavailable');
      judge = `<span class="badge ${cls}">${label}</span><span class="dim2">${esc(m.verdict ?? '')}${m.ms != null ? ' · ' + m.ms + 'ms' : ''}</span>`;
    } else if (served && ent?.lastProbe?.supportedThinking?.length) {
      judge = `<span class="badge ok">${T('✓ 已测试', '✓ Tested')}</span>`;
    } else if (served && ent?.lastProbe) {
      judge = `<span class="badge dim">${T('已测试 · 无思考', 'Tested · no thinking')}</span>`;
    } else {
      judge = `<span class="badge dim">${T('未测试', 'Not tested')}</span>`;
    }
    return `<div class="pcard" data-probe-row data-thinking="${m.thinking ?? 'unknown'}" data-ok="${m.ok !== false}" data-model="${esc(m.id)}">
      <div class="pcard-head">
        <div class="pcard-title">
          <span class="mname mono">${esc(m.id)}</span>
          <span class="dim2">${esc(m.owned_by ?? '')}${ctx ? ' · ' + ctx : ''}</span>
        </div>
        <div class="pcard-flags">${served ? `<span class="badge ok">${T('已导入', 'Imported')}</span>` : ''}${thinkNow}${metaMod}</div>
      </div>
      <div class="pcard-judge" id="probe-out-${cssId(m.id)}">${judge}${entMeta}</div>
      <div class="pcard-detail" id="probe-detail-${cssId(m.id)}">${served && ent?.lastProbe ? renderLastProbeStatic(ent.lastProbe) : ''}</div>
      <div class="pcard-foot">
        <button class="btn sm" data-levels="${esc(pid)}" data-model="${esc(m.id)}">${T('逐档测试', 'Per-level probe')}</button>
        <button class="btn sm primary" data-apply="${esc(pid)}" data-model="${esc(m.id)}" ${m.ok === false ? `disabled title="${T('模型不可用，无法应用', 'Model unavailable; cannot apply')}"` : ''}>${T('应用', 'Apply')}</button>
      </div>
    </div>`;
  }).join('') || '<div class="empty" style="padding:40px 0">' + T('上游 /models 返回空列表', 'Upstream /models returned an empty list') + '</div>';
  // 筛选条：全部 / 支持思考 / 问题项
  const flt = $('probeFilter');
  if (flt) {
    flt.hidden = !results;
    flt.value = 'all';
  }
  const search = $('probeSearch');
  if (search) search.value = '';
  openModal(modal);
}

/** 逐档测试：结果渲染进模型卡片内的展开区 */
async function runLevelProbe(pid, model, cardEl) {
  const cell = cardEl?.querySelector('.pcard-detail');
  if (!cell) return null;
  cell.innerHTML = '<span class="dim2">' + T('逐档测试中…', 'Probing levels…') + '</span>';
  try {
    const r = await api('/admin/providers/' + encodeURIComponent(pid) + '/probe-levels', { method: 'POST', body: JSON.stringify({ model, levels: selectedProbeLevels() }) });
    if (!r.ok) { cell.innerHTML = `<span class="badge bad">✗ ${esc(r.error || T('逐档测试失败', 'Per-level probe failed'))}</span>`; return null; }
    renderDetail(cell, r);
    // 已导入模型：结果持久化到企业模型 lastProbe（下次打开弹窗自动显示，不用重测）
    const ent = (cachedConfig.models ?? []).find((x) => x.providerId === pid && x.upstreamModel === model);
    if (ent) {
      const lastProbe = { ts: Date.now(), levels: r.levels, supportedThinking: r.supportedThinking, modalities: r.modalities ?? null };
      cachedConfig.models = cachedConfig.models.map((x) => x.id === ent.id ? { ...x, lastProbe } : x);
      api('/admin/models/' + encodeURIComponent(ent.id), { method: 'PATCH', body: JSON.stringify({ lastProbe }) }).catch(() => {});
    }
    return r;
  } catch (e) {
    cell.innerHTML = `<span class="badge bad">✗ ${esc(e.message)}</span>`;
    return null;
  }
}

/** 渲染持久化的上次逐档结果（模型设置弹窗打开时对已导入模型自动展开，不用重新点） */
function renderLastProbe(cell, lp) {
  if (!lp?.levels?.length) return;
  const age = lp.ts ? ' · ' + new Date(lp.ts).toLocaleString(undefined, { hour12: false }) : '';
  renderDetail(cell, { levels: lp.levels, supportedThinking: lp.supportedThinking ?? [], supportsThinkingSwitch: false, modalities: lp.modalities ?? null }, `<span class="dim2">${T('上次结果{age}', 'Last result{age}', { age })}</span>`);
}

/** lastProbe → HTML（弹窗初始渲染用，与 renderLastProbe 同一渲染路径） */
function renderLastProbeStatic(lp) {
  const tmp = { innerHTML: '', dataset: {} };
  try { renderLastProbe(tmp, lp); } catch { return ''; }
  return tmp.innerHTML;
}

/** 逐档结果统一渲染：档位 pill + 结论徽章行 */
function renderDetail(cell, r, noteHtml = '') {
  const badge = (x) => {
    if (!x.accepted) return `<span class="badge bad" title="${esc(x.note ?? '')}">✗ ${esc(x.note ?? T('被拒', 'Rejected'))}</span>`;
    if (x.thought) return `<span class="badge ok" title="${T('输出上限 {cap} tk', 'Output cap {cap} tk', { cap: x.cap ?? '—' })}">✓ ${T('思考{tok}', 'thinking{tok}', { tok: x.reasoningTokens ? ' ' + (/tk$/.test(String(x.reasoningTokens)) ? x.reasoningTokens : x.reasoningTokens + 'tk') : '' })}</span>`;
    return `<span class="badge dim" title="${T('输出上限 {cap} tk', 'Output cap {cap} tk', { cap: x.cap ?? '—' })}">${T('○ 无思考', '○ No thinking')}</span>`;
  };
  cell.innerHTML = `
    <div class="pd-pills">${r.levels.map((x) => `<span class="pd-pill mono"><b>${esc(x.level)}</b>${badge(x)}<span class="dim2">${x.ms}ms</span></span>`).join('')}</div>
    <div class="pd-verdict">
      <span class="badge ${r.supportedThinking.length ? 'ok' : 'dim'}">${T('实测支持档位：{lv}', 'Verified levels: {lv}', { lv: r.supportedThinking.length ? esc(r.supportedThinking.join(' / ')) : T('无（不思考）', 'none (no thinking)') })}</span>
      ${r.supportsThinkingSwitch ? `<span class="badge ok">${T('开关有效', 'Switch works')}</span>` : ''}
      ${modalBadges(r.modalities)}
      ${noteHtml}
    </div>`;
  cell.dataset.probe = JSON.stringify({ available: r.available, supportedThinking: r.supportedThinking, recommendation: r.recommendation, inputModes: probeInputModes(r.modalities) });
}

/** 多模态实测徽章：图片/视频各一枚，结论用文字而非仅色块 */
function modalBadges(modalities) {
  if (!modalities) return '';
  const one = (name, x) => {
    if (!x) return '';
    const map = {
      real: ['ok', T('{m} ✓可用', '{m} works', { m: name })],
      accepted: ['warn', T('{m} △接受未确认', '{m} accepted, unconfirmed', { m: name })],
      rejected: ['bad', T('{m} ✗不支持', '{m} not supported', { m: name })],
      unavailable: ['dim', T('{m} 未测（模型不可用）', '{m} untested (model unavailable)', { m: name })],
      error: ['warn', T('{m} 测试失败', '{m} probe failed', { m: name })],
    };
    const [cls, label] = map[x.status] ?? ['dim', `${name} ${esc(x.status)}`];
    return `<span class="badge ${cls}" title="${esc(x.verdict ?? '')}${x.ms != null ? ' · ' + x.ms + 'ms' : ''}">${label}</span>`;
  };
  return one(T('图片', 'Image'), modalities.image) + ' ' + one(T('视频', 'Video'), modalities.video);
}

/** 由多模态实测结果推导 inputModes（image/video 任一通过即写入；没测过返回 null=不覆盖） */
function probeInputModes(modalities) {
  if (!modalities?.image || !modalities?.video) return null;
  const modes = ['text'];
  if (modalities.image.supported) modes.push('image');
  if (modalities.video.supported) modes.push('video');
  return modes;
}

/** 应用探测结果到企业模型目录（新建或更新 thinkingLevels 等） */
async function applyProbeResult(pid, model, probe, btn, card = null) {
  btn.disabled = true;
  try {
    const r = await api('/admin/providers/' + encodeURIComponent(pid) + '/apply-probe', {
      method: 'POST',
      body: JSON.stringify({ model, probe: { available: probe.available, supportedThinking: probe.supportedThinking, recommendation: probe.recommendation, contextLength: probe.contextLength, inputModes: probe.inputModes ?? undefined } }),
    });
    if (r.ok) {
      const modeTxt = (r.inputModes ?? []).filter((x) => x !== 'text').join('/') || T('纯文本', 'Text only');
      toast(r.applied === 'update'
        ? T('✓ 已更新企业模型 {id}（思考档位：{lv} · 输入：{m}）', '✓ Updated model {id} (levels: {lv} · input: {m})', { id: r.modelId, lv: r.thinkingLevels.join(' / '), m: modeTxt })
        : T('✓ 已新增企业模型 {id}（思考档位：{lv} · 输入：{m}）', '✓ Added model {id} (levels: {lv} · input: {m})', { id: r.modelId, lv: r.thinkingLevels.join(' / '), m: modeTxt }), 'ok');
      // 卡片内同步「已导入」标记，不再等下一次打开弹窗才看到
      const flags = card?.querySelector('.pcard-flags');
      if (flags && !flags.textContent.includes(T('已导入', 'Imported'))) {
        flags.insertAdjacentHTML('beforeend', `<span class="badge ok">${T('已导入', 'Imported')}</span>`);
      }
      loadConfig();
    } else {
      toast('✗ ' + (r.error?.message || T('应用失败', 'Apply failed')), 'bad');
    }
  } catch (e) {
    toast('✗ ' + e.message, 'bad');
  } finally {
    btn.disabled = false;
  }
}

/* ---------- 页面模块契约（default export） ---------- */
let bound = false;
export default {
  page: 'ent-catalog',
  html: `
  <div class="headrow" data-ent-page="ent-catalog">
    <div><h1>${T('供应商与模型', 'Providers & models')}</h1></div>
    <div class="sp"></div>
    <input class="input" id="filterInput" placeholder="${T('搜索供应商 / 模型…（Esc 清空）', 'Search providers / models… (Esc clears)')}" style="width:220px" autocomplete="off">
    <button class="btn" id="addProvBtn">${T('＋ 新增供应商', '+ Add provider')}</button>
  </div>

  <!-- 供应商编辑器（弹窗 · md 档） -->
  <div class="dlg-mask" id="provEditorCard" hidden>
    <div class="dlg md">
      <div class="dlg-head">
        <h3 id="provEditorTitle">${T('新增供应商', 'Add provider')}</h3>
        <button class="dlg-x" id="peCloseBtn" data-dlg-close title="${T('关闭 (Esc)', 'Close (Esc)')}">${icon('x', { size: 16 })}</button>
      </div>
      <div class="dlg-body">
      <div class="frm">
        <div class="fldgrp full"><span class="fldgrp-t">${T('基础信息', 'Basics')}</span></div>
        <div class="fld">
          <label>ID <i>*</i></label>
          <div class="ctrl"><input class="input" id="peId" placeholder="prov-openai"></div>
        </div>
        <div class="fld">
          <label>${T('名称', 'Name')} <i>*</i></label>
          <div class="ctrl"><input class="input" id="peName" placeholder="${T('OpenAI 官方', 'OpenAI official')}"></div>
        </div>
        <div class="fld full">
          <label>Base URL <i>*</i></label>
          <div class="ctrl"><input class="input grow" id="peUrl" placeholder="https://api.openai.com/v1"></div>
        </div>
        <div class="fld full">
          <label>${T('协议', 'Protocol')}</label>
          <div class="ctrl">
            <select id="peProtocol" style="flex:1">
              <option value="openai">${T('OpenAI 兼容（/chat/completions · Bearer）', 'OpenAI compatible (/chat/completions · Bearer)')}</option>
              <option value="anthropic">${T('Anthropic Messages（/v1/messages · x-api-key）— Claude 系', 'Anthropic Messages (/v1/messages · x-api-key) — Claude')}</option>
              <option value="gemini">${T('Google Gemini（:generateContent · x-goog-api-key）— Gemini 系', 'Google Gemini (:generateContent · x-goog-api-key) — Gemini')}</option>
            </select>
          </div>
        </div>
        <div class="fldgrp full"><span class="fldgrp-t">${T('密钥', 'API key')}</span></div>
        <div class="fld full">
          <label>API Key</label>
          <div class="ctrl">
            <input class="input grow" id="peKey" type="password" autocomplete="new-password" placeholder="sk-…">
            <span class="unit">${T('变量名', 'Env var')}</span>
            <input class="input" id="peKeyEnv" style="width:200px" placeholder="ENT_PROV_XXX_KEY">
          </div>
        </div>
        <div class="fldgrp full"><span class="fldgrp-t">${T('调用与容灾', 'Calls & failover')}</span></div>
        <div class="fld">
          <label>${T('超时', 'Timeout')}</label>
          <div class="ctrl"><input class="input" id="peTimeout" type="number" style="width:110px"><span class="unit">ms · 1000-600000</span></div>
        </div>
        <div class="fld">
          <label>${T('权重', 'Weight')}</label>
          <div class="ctrl"><input class="input" id="peWeight" type="number" style="width:110px"><span class="unit">0-1000</span></div>
        </div>
        <div class="fldgrp full"><span class="fldgrp-t">${T('状态检测', 'Health check')}</span></div>
        <div class="fld full">
          <label>${T('开关', 'Switch')}</label>
          <div class="ctrl"><label class="chk"><input type="checkbox" id="peProbeEnabled" checked> ${T('定期探测', 'Periodic probe')}</label></div>
        </div>
        <div class="fld">
          <label>${T('间隔', 'Interval')}</label>
          <div class="ctrl"><input class="input" id="peProbeInterval" type="number" style="width:110px"><span class="unit">${T('秒', 's')}</span></div>
        </div>
        <div class="fld">
          <label>${T('失败停用', 'Disable after failures')}</label>
          <div class="ctrl"><input class="input" id="peProbeFailLimit" type="number" style="width:110px"><span class="unit">${T('次', 'fails')}</span></div>
        </div>
        <div class="fldgrp full"><span class="fldgrp-t">${T('状态', 'Status')}</span></div>
        <div class="fld full">
          <label>${T('状态', 'Status')}</label>
          <div class="ctrl"><label class="chk"><input type="checkbox" id="peEnabled" checked> ${T('启用', 'Enabled')}</label></div>
        </div>
      </div>
      <div class="editor-foot">
        <button class="btn primary" id="peSaveBtn">${T('保存供应商', 'Save provider')}</button>
        <button class="btn" id="peCancelBtn">${T('取消', 'Cancel')}</button>
        <span class="err" id="peErr"></span>
      </div>
      </div>
    </div>
  </div>

  <!-- 模型编辑器（弹窗 · lg 档） -->
  <div class="dlg-mask" id="modelEditorCard" hidden>
    <div class="dlg lg">
      <div class="dlg-head">
        <h3 id="modelEditorTitle">${T('上架模型', 'Add model')}</h3>
        <button class="dlg-x" id="meCloseBtn" data-dlg-close title="${T('关闭 (Esc)', 'Close (Esc)')}">${icon('x', { size: 16 })}</button>
      </div>
      <div class="dlg-body">
      <div class="frm">
        <div class="fldgrp full"><span class="fldgrp-t">${T('基础信息', 'Basics')}</span></div>
        <div class="fld">
          <label>${T('模型名', 'Model ID')} <i>*</i></label>
          <div class="ctrl"><input class="input" id="meId" placeholder="ent-gpt4o"></div>
        </div>
        <div class="fld">
          <label>${T('展示名', 'Display name')}</label>
          <div class="ctrl"><input class="input" id="meDisp" placeholder="${T('GPT-4o 企业版', 'GPT-4o enterprise')}"></div>
        </div>
        <div class="fld">
          <label>${T('供应商', 'Provider')} <i>*</i></label>
          <div class="ctrl"><select id="meProv"></select></div>
        </div>
        <div class="fld">
          <label>${T('上游模型名', 'Upstream model')} <i>*</i></label>
          <div class="ctrl"><input class="input" id="meUpstream" placeholder="gpt-4o-2024-11-20"></div>
        </div>
        <div class="fldgrp full"><span class="fldgrp-t">${T('上下文与输入', 'Context & input')}</span></div>
        <div class="fld">
          <label>${T('上下文长度', 'Context window')}</label>
          <div class="ctrl"><input class="input" id="meCtx" type="number" step="1" style="width:110px"><span class="unit">k（×1024）</span></div>
        </div>
        <div class="fld">
          <label>${T('最大输出', 'Max output')}</label>
          <div class="ctrl"><input class="input" id="meMax" type="number" step="1" style="width:110px"><span class="unit">k（×1024）</span></div>
        </div>
        <div class="fld">
          <label>${T('支持的输入', 'Input modes')}</label>
          <div class="ctrl" id="meInputs" style="flex-wrap:wrap;gap:4px 14px">
            <label class="chk"><input type="checkbox" class="meIn" value="text" checked> ${T('文本', 'Text')}</label>
            <label class="chk"><input type="checkbox" class="meIn" value="image"> ${T('图片', 'Image')}</label>
            <label class="chk"><input type="checkbox" class="meIn" value="video"> ${T('视频', 'Video')}</label>
            <label class="chk"><input type="checkbox" class="meIn" value="audio"> ${T('音频', 'Audio')}</label>
          </div>
        </div>
        <div class="fld">
          <label>${T('模式', 'Mode')}</label>
          <div class="ctrl"><select id="meMode">
            <option value="chat">${T('chat · 对话', 'chat · dialogue')}</option>
            <option value="reasoning">${T('reasoning · 深度推理', 'reasoning · deep reasoning')}</option>
          </select></div>
        </div>
        <div class="fldgrp full"><span class="fldgrp-t">${T('思考能力', 'Thinking')}</span></div>
        <div class="fld">
          <label>${T('思考能力', 'Thinking')}</label>
          <div class="ctrl"><select id="meThink">
            <option value="none">${T('不支持思考', 'No thinking')}</option>
            <option value="optional">${T('可选（按档位开关）', 'Optional (per level)')}</option>
            <option value="always">${T('强制思考', 'Forced')}</option>
          </select></div>
        </div>
        <div class="fld">
          <label>${T('默认档位', 'Default level')}</label>
          <div class="ctrl"><select id="meThinkDef"></select></div>
        </div>
        <div class="think-box fld full" id="meThinkBox">
          <div class="think-box-row">
            <span class="think-box-t">${T('思考档位', 'Thinking levels')}</span>
            <div class="ctrl" id="meThinkLevelsView" style="flex-wrap:wrap;gap:4px;min-height:22px"></div>
          </div>
          <div class="think-box-row">
            <span class="think-box-t"></span>
            <div class="ctrl"></div>
          </div>
        </div>
        <div class="fldgrp full"><span class="fldgrp-t">${T('计费与容灾', 'Billing & failover')}</span></div>
        <div class="fld">
          <label>${T('单价 ¥/百万tok', 'Price ¥/Mtok')}</label>
          <div class="ctrl">
            <input class="input" id="mePin" type="number" step="0.01" style="width:90px" placeholder="${T('输入', 'In')}">
            <span class="unit">/</span>
            <input class="input" id="mePout" type="number" step="0.01" style="width:90px" placeholder="${T('输出', 'Out')}">
            <span class="unit">/</span>
            <input class="input" id="mePcache" type="number" step="0.01" style="width:90px" placeholder="${T('缓存', 'Cache')}">
          </div>
        </div>
        <div class="fld">
          <label>${T('容灾供应商', 'Failover providers')}</label>
          <div class="ctrl" id="meFallbacks" style="flex-wrap:wrap;gap:4px 14px"></div>
        </div>
      </div>
      <div class="editor-foot">
        <button class="btn primary" id="meSaveBtn">${T('保存模型', 'Save model')}</button>
        <button class="btn" id="meCancelBtn">${T('取消', 'Cancel')}</button>
        <span class="err" id="meErr"></span>
      </div>
      </div>
    </div>
  </div>

  <!-- 供应商列表 -->
  <div class="card">
    <h2><span class="bar"></span>${T('供应商', 'Providers')} <span class="badge" id="provCount"></span></h2>
    <div id="provList"><div class="empty">${T('加载中…', 'Loading…')}</div></div>
  </div>

  <!-- 模型目录 -->
  <div class="card">
    <h2><span class="bar"></span>${T('模型目录', 'Model catalog')} <span class="badge" id="modelCount"></span></h2>
    <div class="tablewrap">
      <table>
        <thead><tr><th>${T('模型', 'Model')}</th><th>${T('供应商 → 上游模型', 'Provider → upstream model')}</th><th class="num">${T('上下文 / 输出', 'Context / output')}</th><th>${T('思考', 'Thinking')}</th><th class="num">${T('单价 入/出/缓存', 'Price in/out/cache')}</th><th>${T('状态', 'Status')}</th><th></th></tr></thead>
        <tbody id="modelBody"><tr><td colspan="7" class="empty">${T('加载中…', 'Loading…')}</td></tr></tbody>
      </table>
    </div>
  </div>

  <!-- 上游模型探测弹窗 -->
  <div class="dlg-mask" id="probeModal" hidden>
    <div class="dlg bench">
      <div class="dlg-head">
        <h3 id="probeTitle">${T('模型设置', 'Model settings')}</h3>
        <button class="dlg-x" id="probeCloseBtn" data-dlg-close title="${T('关闭 (Esc)', 'Close (Esc)')}">${icon('x', { size: 16 })}</button>
      </div>
      <div class="toolbar" id="probeFilterWrap">
        <input class="input" id="probeSearch" placeholder="${T('筛选模型…', 'Filter models…')}" style="width:170px;padding:4px 8px;font-size:12.5px" autocomplete="off">
        <select id="probeFilter" class="input" style="padding:4px 8px;font-size:12.5px">
          <option value="all">${T('全部模型', 'All models')}</option>
          <option value="real">${T('仅真思考', 'Real thinking only')}</option>
          <option value="issues">${T('仅问题项（被拒/不可用）', 'Issues only (rejected/unavailable)')}</option>
        </select>
        <span style="display:inline-flex;gap:8px;align-items:center;font-size:12.5px;flex-wrap:wrap">
          <span id="probeLvWrap" style="display:inline-flex;gap:10px;flex-wrap:wrap;align-items:center"></span>
          <button class="btn sm" id="probeLvSaveBtn" title="${T('保存为探测默认档位', 'Save as probe defaults')}">${T('设为默认', 'Set default')}</button>
        </span>
      </div>
      <div class="sub" id="probeMeta"></div>
      <div class="probe-scroll">
        <div id="probeBody" class="pcard-grid"></div>
      </div>
    </div>
  </div>

  <!-- 供应商状态检测弹窗 -->
  <div class="dlg-mask" id="healthModal" hidden>
    <div class="dlg md">
      <div class="dlg-head">
        <h3 id="healthTitle">${T('状态检测', 'Health check')}</h3>
        <button class="dlg-x" id="healthCloseBtn" data-dlg-close title="${T('关闭 (Esc)', 'Close (Esc)')}">${icon('x', { size: 16 })}</button>
      </div>
      <div class="dlg-body" id="healthBody"></div>
    </div>
  </div>`,

  async load() {
    await loadConfig();
  },

  bind() {
    if (bound) return;
    bound = true;
    bindPage();
  },
};
