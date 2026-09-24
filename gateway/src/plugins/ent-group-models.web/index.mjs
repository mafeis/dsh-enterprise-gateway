/**
 * 插件页面 · 模型管理（ent-group-models）
 * 布局：左列组列表（含白名单摘要），右侧选中组的可见模型勾选（只列已上架模型）。
 * 数据源：/admin/group-models（本插件）
 * 语义：不勾 = 全部模型；勾选保存后 /v1/models 过滤与转发准入即时生效。
 */
import { api, $, toast, esc, icon } from '/admin/static/contract.mjs'
import { T } from '/admin/static/js/i18n.mjs';

let cachedGroups = []
let cachedModels = []      // 已上架 [{id, displayName}]
let currentGroupId = null

export default {
  page: 'ent-group-models',
  html: `
  <div class="headrow" data-ent-page="ent-group-models">
    <div><h1>${T('分组模型','Group Models')}</h1></div>
  </div>

  <div class="card">
    <h2><span class="bar"></span>${T('按组配置','Per group')} <span class="badge dim" id="gmGroupCount"></span></h2>
    <div class="mhint">${T('左侧选组，右侧勾选该组可见模型；只显示已上架模型。', 'Pick a group, check its visible models; listed models only.')}</div>
    <div style="display:grid;grid-template-columns:minmax(240px,320px) 1fr;gap:16px;margin-top:12px" id="gmLayout">
      <div id="gmGroupList"><div class="empty-state">${icon('users', { size: 32 })}<div class="es-title">${T('暂无分组', 'No groups')}</div><div class="es-desc">${T('加载中…','Loading…')}</div></div></div>
      <div id="gmEditor"><div class="empty-state">${icon('users', { size: 32 })}<div class="es-title">${T('请选择分组', 'Pick a group')}</div><div class="es-desc">${T('← 选择一个分组','← Pick a group')}</div></div></div>
    </div>
  </div>`,
  async load() { await loadAll() },
  bind() { bindModelsPage() },
}

async function loadAll() {
  try {
    const d = await api('/admin/group-models')
    cachedGroups = d.groups ?? []
    cachedModels = d.models ?? []
    if (currentGroupId && !cachedGroups.some((g) => g.id === currentGroupId)) currentGroupId = null
    if (currentGroupId === null && cachedGroups.length) currentGroupId = cachedGroups[0].id
    renderGroupList()
    renderEditor()
  } catch { /* 401 已处理 */ }
}

const whitelistLabel = (n) => (n ? T('{n} 个白名单', '{n} whitelisted', { n }) : T('全部模型', 'All models'))

function renderGroupList() {
  const el = $('gmGroupList')
  $('gmGroupCount').textContent = T('{n} 个分组', '{n} groups', { n: cachedGroups.length })
  if (!cachedGroups.length) {
    el.innerHTML = `<div class="empty-state">${icon('users', { size: 32 })}<div class="es-title">${T('暂无分组', 'No groups')}</div><div class="es-desc">${T('暂无分组，请先在「用户分组」新建。', 'No groups yet — create one in Groups first.')}</div></div>`
    return
  }
  el.innerHTML = cachedGroups.map((g) => `
    <div class="user-item qt-gitem ${g.id === currentGroupId ? 'qt-cur' : ''}" data-ggroup="${g.id}" style="cursor:pointer">
      <div class="user-main" style="flex:1">
        <div class="user-title"><b>${esc(g.name)}</b><span class="badge dim">${g.member_count} ${T('人','ppl')}</span></div>
        <div class="user-meta">${T('模型','Models')} ${whitelistLabel(g.models.length)}</div>
      </div>
    </div>`
  ).join('')
}

function renderEditor() {
  const el = $('gmEditor')
  const g = cachedGroups.find((x) => x.id === currentGroupId)
  if (!g) { el.innerHTML = `<div class="empty-state">${icon('users', { size: 32 })}<div class="es-title">${T('请选择分组', 'Pick a group')}</div><div class="es-desc">${T('← 选择一个分组','← Pick a group')}</div></div>`; return }
  const box = cachedModels.length
    ? `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:6px 14px;max-height:340px;overflow:auto;border:1px solid var(--line);border-radius:10px;padding:10px 12px" id="gmBox">` + cachedModels.map((m) => `
      <label class="chk" style="white-space:normal"><input type="checkbox" data-gmodel="${esc(m.id)}" ${g.models.includes(m.id) ? 'checked' : ''}>
        <span><b>${esc(m.id)}</b> <span class="dim2">${esc(m.displayName ?? '')}</span></span>
      </label>`).join('') + `</div>`
    : `<div class="empty-state">${icon('database', { size: 32 })}<div class="es-title">${T('暂无模型', 'No models')}</div><div class="es-desc">${T('模型目录为空，请先在「供应商与模型」上架模型','Model catalog is empty — list models first')}</div></div>`
  el.innerHTML = `
    <div class="user-title" style="margin-bottom:12px">
      <b style="font-size:15px">${esc(g.name)}</b>
      <span class="badge dim">${g.member_count} ${T('人','ppl')}</span>
      <span style="flex:1"></span>
      <button class="btn sm" id="gmAll">${T('全选','All')}</button>
      <button class="btn sm" id="gmNone">${T('清空','None')}</button>
      <button class="btn primary sm" id="gmSave">${T('保存','Save')}</button>
      <span class="dim2" id="gmDirty" style="font-size:12px"></span>
    </div>
    <div class="mhint">${T('不勾 = 全部模型；只列已上架模型。', 'None checked = all models; listed models only.')}</div>
    <div style="margin-top:12px">${box}</div>`
  el.querySelector('#gmSave').addEventListener('click', () => saveModels(g.id))
  el.querySelector('#gmAll')?.addEventListener('click', () => {
    el.querySelectorAll('[data-gmodel]').forEach((c) => { c.checked = true })
    $('gmDirty').textContent = T('未保存','Unsaved')
  })
  el.querySelector('#gmNone')?.addEventListener('click', () => {
    el.querySelectorAll('[data-gmodel]').forEach((c) => { c.checked = false })
    $('gmDirty').textContent = T('未保存','Unsaved')
  })
  el.querySelector('#gmBox')?.addEventListener('change', () => { $('gmDirty').textContent = T('未保存','Unsaved') })
}

async function saveModels(id) {
  const el = $('gmEditor')
  const models = [...el.querySelectorAll('[data-gmodel]:checked')].map((c) => c.dataset.gmodel)
  const r = await api('/admin/group-models/' + id, { method: 'PATCH', body: JSON.stringify({ models }) })
  if (r?.error) return toast(r.error.message ?? T('保存失败','Save failed'))
  $('gmDirty').textContent = ''
  toast(T('模型白名单已更新','Models updated'))
  const g = cachedGroups.find((x) => x.id === id)
  if (g) g.models = models
  renderGroupList()
}

function bindModelsPage() {
  $('gmGroupList').addEventListener('click', (e) => {
    const item = e.target.closest('[data-ggroup]')
    if (!item) return
    if (currentGroupId === Number(item.dataset.ggroup)) return
    currentGroupId = Number(item.dataset.ggroup)
    $('gmDirty').textContent = ''
    renderGroupList()
    renderEditor()
  })
}
