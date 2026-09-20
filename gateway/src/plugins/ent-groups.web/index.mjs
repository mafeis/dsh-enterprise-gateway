/**
 * 插件页面 · 分组管理（ent-groups）
 * 职责：分组 CRUD + 成员归属。额度与模型可见性在「额度与模型」页（ent-quota）配置。
 * 数据源：/admin/groups*（本域）+ /admin/users（ent-users）
 */
import { api, $, toast, esc, confirmDlg, icon, openDlg, closeDlg } from '/admin/static/contract.mjs'
import { T } from '/admin/static/js/i18n.mjs';

let cachedGroups = []
let cachedUsers = []
let grpSearchQ = ''

/** 头像底色：按名称哈希从固定调色板取色（同一组恒定同色） */
const AVATAR_COLORS = ['#2563eb', '#059669', '#7c3aed', '#d97706', '#0891b2', '#db2777', '#4f46e5', '#16a34a']
function avatarColor(name) {
  let h = 0
  for (let i = 0; i < String(name).length; i++) h = (h * 31 + String(name).charCodeAt(i)) | 0
  return AVATAR_COLORS[Math.abs(h) % AVATAR_COLORS.length]
}

/** 组内成员名列表 */
const membersOf = (gid) => cachedUsers.filter((u) => u.group_id === gid).map((u) => u.username)

export default {
  page: 'ent-groups',
  html: `
  <div class="headrow" data-ent-page="ent-groups">
    <div><h1>${T('用户分组','Groups')}</h1></div>
  </div>

  <div class="kpirow">
    <div class="kpi"><div class="lab">${T('分组数','Groups')}</div><div class="val" id="grpKpiGroups">–</div></div>
    <div class="kpi"><div class="lab">${T('已分组用户','Grouped users')}</div><div class="val" id="grpKpiIn">–</div></div>
    <div class="kpi"><div class="lab">${T('未分组用户','Ungrouped users')}</div><div class="val" id="grpKpiOut">–</div><div class="sub2">${T('未分组 = 全模型不限额','Ungrouped = all models, no quota')}</div></div>
  </div>

  <div class="card">
    <h2><span class="bar"></span>${T('分组列表','Groups')} <span class="badge dim" id="grpCount"></span>
      <span style="flex:1"></span>
      <input class="input" id="grpGroupSearch" placeholder="${T('搜索分组 / 成员…','Search group / member…')}" style="width:220px" autocomplete="off">
      <button class="btn primary" id="grpOpenCreate">${T('＋ 新增分组','＋ New group')}</button>
    </h2>
    <div class="dim2" style="font-size:12px;margin:-4px 0 8px" id="grpFilterHint"></div>
    <div id="grpList"><div class="empty">${T('加载中…','Loading…')}</div></div>
  </div>`,
  async load() { await loadAll() },
  bind() { bindGroupsPage() },
}

async function loadAll() {
  try {
    const [g, u] = await Promise.all([api('/admin/groups'), api('/admin/users')])
    cachedGroups = g.groups ?? []
    cachedUsers = u.users ?? []
    renderKpis()
    renderGroups()
  } catch { /* 401 已处理 */ }
}

function renderKpis() {
  const inGroup = cachedUsers.filter((u) => u.group_id).length
  $('grpKpiGroups').textContent = cachedGroups.length
  $('grpKpiIn').textContent = inGroup
  $('grpKpiOut').textContent = cachedUsers.length - inGroup
  $('grpCount').textContent = T('共 {n} 个分组', '{n} groups', { n: cachedGroups.length })
}

/** 成员头像堆叠（最多 5 个 + 溢出数字） */
function memberStack(members) {
  const shown = members.slice(0, 5)
  const extra = members.length - shown.length
  const dots = shown.map((u) => `<span class="grp-avatar-dot" title="${esc(u)}">${esc(String(u).charAt(0).toUpperCase())}</span>`).join('')
  return `<div class="grp-stack">${dots}${extra > 0 ? `<span class="grp-avatar-dot more">+${extra}</span>` : ''}${members.length ? '' : `<span class="dim2">${T('暂无成员','No members')}</span>`}</div>`
}

function renderGroups() {
  const el = $('grpList')
  const q = grpSearchQ
  const hit = (g) => !q || (g.name + ' ' + (g.description ?? '') + ' ' + membersOf(g.id).join(' ')).toLowerCase().includes(q)
  const shown = cachedGroups.filter(hit)
  $('grpFilterHint').textContent = q ? T('匹配 {a}/{b} 个', '{a}/{b} matched', { a: shown.length, b: cachedGroups.length }) : ''
  if (!cachedGroups.length) {
    el.innerHTML = `<div class="empty">${T('暂无分组。未分组用户可见全部模型、不限额度。', 'No groups yet. Ungrouped users see all models with no quota.')}</div>`
    return
  }
  if (!shown.length) {
    el.innerHTML = `<div class="empty">${T('没有匹配的分组','No matching groups')}</div>`
    return
  }
  el.innerHTML = shown.map((g) => {
    const members = membersOf(g.id)
    return `
    <div class="user-item grp-card">
      <div class="user-avatar" style="background:${avatarColor(g.name)}">${esc(g.name.trim().charAt(0).toUpperCase())}</div>
      <div class="user-main">
        <div class="user-title">
          <b>${esc(g.name)}</b>
          ${g.description ? `<span class="dim2">${esc(g.description)}</span>` : ''}
          <span class="badge dim">${T('{n} 人', '{n} members', { n: members.length })}</span>
        </div>
        ${memberStack(members)}
      </div>
      <div class="user-ops">
        <button class="btn sm" data-members="${g.id}" data-name="${esc(g.name)}">${icon('users', { size: 13 })} ${T('成员','Members')}</button>
        <button class="btn sm" data-rename="${g.id}">${T('改名','Rename')}</button>
        <button class="btn sm danger" data-del="${g.id}" data-name="${esc(g.name)}">${T('删除','Delete')}</button>
      </div>
    </div>`
  }).join('')
}

/* ============ 新增 / 改名弹层（轻量表单：名称 + 描述） ============ */

function openGroupModal(group) {
  const isNew = !group
  let m = document.getElementById('grpModal')
  if (!m) { m = document.createElement('div'); m.id = 'grpModal'; m.className = 'dlg-mask'; document.body.appendChild(m) }
  m.innerHTML = `
    <div class="dlg sm" role="dialog" aria-modal="true">
      <div class="dlg-head">
        <h3><span class="bar"></span>${isNew ? T('新增分组','New group') : T('分组改名','Rename group')}</h3>
        <button class="dlg-x" data-dlg-close title="${T('关闭 (Esc)','Close (Esc)')}">${icon('x', { size: 16 })}</button>
      </div>
      <div class="dlg-body">
        <div class="mfield">
          <label>${T('名称','Name')} <i>*</i></label>
          <input class="input" id="grpName" placeholder="${T('如 研发组','e.g. R&D')}" value="${esc(group?.name ?? '')}" autocomplete="off" maxlength="32">
        </div>
        ${isNew ? `
        <div class="mfield">
          <label>${T('描述（可选）','Description (optional)')}</label>
          <input class="input" id="grpDesc" placeholder="${T('如 全模型 · 日/月限额','e.g. All models, daily/monthly quota')}" autocomplete="off">
        </div>
        <div class="mhint">${T('创建后用「成员」把用户加入分组；额度与模型在对应页配置。', 'Add members after creating; quota & models are configured on their own pages.')}</div>` : ''}
      </div>
      <div class="dlg-foot">
        <span class="err" id="grpErr"></span>
        <button class="btn" data-dlg-close>${T('取消','Cancel')}</button>
        <button class="btn primary" id="grpSave">${T('保存','Save')}</button>
      </div>
    </div>`
  openDlg(m)
  m.querySelector('#grpSave').addEventListener('click', () => saveGroupMeta(group?.id))
  m.querySelector('#grpName').focus()
}

async function saveGroupMeta(id) {
  const m = document.getElementById('grpModal')
  const errEl = m.querySelector('#grpErr')
  errEl.textContent = ''
  const name = m.querySelector('#grpName').value.trim()
  if (!name) { errEl.textContent = T('名称不能为空','Name is required'); return }
  const body = { name }
  if (id === undefined) body.description = m.querySelector('#grpDesc')?.value.trim() ?? ''
  const r = await api(id === undefined ? '/admin/groups' : `/admin/groups/${id}`, { method: id === undefined ? 'POST' : 'PATCH', body: JSON.stringify(body) })
  if (r?.error) { errEl.textContent = r.error.message ?? T('保存失败','Save failed'); return }
  closeDlg(m)
  toast(id === undefined ? T('分组已创建','Group created') : T('已改名','Renamed'))
  loadAll()
}

/* ============ 成员管理弹层：搜索 + 双列勾选 + 已选计数 + 全选/清空 ============ */

function openMembersModal(group) {
  const selected = new Set(membersOf(group.id))
  let m = document.getElementById('grpMemberModal')
  if (!m) { m = document.createElement('div'); m.id = 'grpMemberModal'; m.className = 'dlg-mask'; document.body.appendChild(m) }
  const rows = () => {
    const q = (m.querySelector('#grpMSearch')?.value ?? '').trim().toLowerCase()
    return cachedUsers.filter((u) => !q || (u.username + ' ' + (u.display_name ?? '')).toLowerCase().includes(q))
  }
  const listBox = () => m.querySelector('#grpMBox')
  const renderList = () => {
    const users = rows()
    listBox().innerHTML = users.length ? users.map((u) => `
      <label class="chk" style="white-space:normal"><input type="checkbox" data-member="${esc(u.username)}" ${selected.has(u.username) ? 'checked' : ''}>
        <span><b>${esc(u.username)}</b> <span class="dim2">${esc(u.display_name ?? '')}</span></span>
      </label>`).join('') : `<div class="empty">${T('没有匹配的用户','No matching users')}</div>`
    updateCount()
  }
  const updateCount = () => {
    const shown = rows().length
    m.querySelector('#grpMCount').textContent = T('已选 {a}/{b}', '{a}/{b} selected', { a: selected.size, b: cachedUsers.length })
      + (shown < cachedUsers.length ? T('，显示 {n}', ', showing {n}', { n: shown }) : '')
  }
  m.innerHTML = `
    <div class="dlg lg" role="dialog" aria-modal="true">
      <div class="dlg-head">
        <h3><span class="bar"></span>${T('成员管理','Members')} · ${esc(group.name)}</h3>
        <button class="dlg-x" data-dlg-close title="${T('关闭 (Esc)','Close (Esc)')}">${icon('x', { size: 16 })}</button>
      </div>
      <div class="dlg-body">
        <div style="display:flex;gap:8px;align-items:center;margin:0 0 8px">
          <input class="input" id="grpMSearch" placeholder="${T('搜索用户名 / 展示名…','Search user / display name…')}" style="flex:1" autocomplete="off">
          <span class="dim2" style="font-size:12px" id="grpMCount"></span>
          <button class="btn sm" type="button" id="grpMAll">${T('全选','All')}</button>
          <button class="btn sm" type="button" id="grpMNone">${T('清空','None')}</button>
        </div>
        <div id="grpMBox" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:6px 14px;max-height:320px;overflow:auto;border:1px solid var(--line);border-radius:10px;padding:10px 12px"></div>
        <div class="mhint">${T('勾选即入组，取消即出组；保存后立即生效。', 'Checked = in group; takes effect on save.')}</div>
      </div>
      <div class="dlg-foot">
        <span class="err" id="grpMErr"></span>
        <button class="btn" data-dlg-close>${T('取消','Cancel')}</button>
        <button class="btn primary" id="grpMSave">${T('保存','Save')}</button>
      </div>
    </div>`
  openDlg(m)
  renderList()
  m.querySelector('#grpMSearch').addEventListener('input', renderList)
  m.querySelector('#grpMAll').addEventListener('click', () => {
    for (const lbl of listBox().querySelectorAll('label')) {
      if (lbl.style.display === 'none') continue
      lbl.querySelector('input').checked = true
      selected.add(lbl.querySelector('input').dataset.member)
    }
    updateCount()
  })
  m.querySelector('#grpMNone').addEventListener('click', () => {
    for (const lbl of listBox().querySelectorAll('label')) {
      if (lbl.style.display === 'none') continue
      lbl.querySelector('input').checked = false
      selected.delete(lbl.querySelector('input').dataset.member)
    }
    updateCount()
  })
  listBox().addEventListener('change', (e) => {
    if (e.target.matches('[data-member]')) {
      if (e.target.checked) selected.add(e.target.dataset.member)
      else selected.delete(e.target.dataset.member)
      updateCount()
    }
  })
  m.querySelector('#grpMSave').addEventListener('click', async () => {
    const r = await api(`/admin/groups/${group.id}`, { method: 'PATCH', body: JSON.stringify({ members: [...selected] }) })
    if (r?.error) { m.querySelector('#grpMErr').textContent = r.error.message ?? T('保存失败','Save failed'); return }
    closeDlg(m)
    toast(T('成员已更新（{n} 人）','Members updated ({n})', { n: selected.size }))
    loadAll()
  })
  m.querySelector('#grpMSearch').focus()
}

/* ============ 删除 ============ */

async function deleteGroup(id, name) {
  const ok = await confirmDlg({
    title: T('删除分组', 'Delete group'),
    message: T('确定删除分组「{n}」？组内用户自动移出分组（恢复全模型不限额）。', 'Delete group {n}? Members are unassigned (back to all models, no quota).', { n: name }),
    confirmText: T('确认删除', 'Delete'),
    danger: true,
  })
  if (!ok) return
  const r = await api('/admin/groups/' + id, { method: 'DELETE' })
  if (r?.error) return toast(r.error.message ?? T('删除失败','Delete failed'))
  toast(T('已删除 {n}','Deleted {n}', { n: name }))
  loadAll()
}

function bindGroupsPage() {
  $('grpOpenCreate').addEventListener('click', () => openGroupModal(null))
  const $search = $('grpGroupSearch')
  $search.addEventListener('input', () => { grpSearchQ = $search.value.trim().toLowerCase(); renderGroups() })
  $search.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.target.value = ''; grpSearchQ = ''; renderGroups() } })
  const $list = $('grpList')
  if (!$list.dataset.groupBound) {
    $list.dataset.groupBound = '1'
    $list.addEventListener('click', (e) => {
      const mem = e.target.closest('button[data-members]')
      if (mem) openMembersModal(cachedGroups.find((g) => g.id === Number(mem.dataset.members)))
      const rn = e.target.closest('button[data-rename]')
      if (rn) openGroupModal(cachedGroups.find((g) => g.id === Number(rn.dataset.rename)))
      const del = e.target.closest('button[data-del]')
      if (del) deleteGroup(Number(del.dataset.del), del.dataset.name)
    })
  }
}
