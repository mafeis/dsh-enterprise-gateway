/**
 * 插件页面 · 桌面客户端（一级菜单 + 2 个二级页）
 * 壳契约：ent-desktop.mjs 的 nav.children 声明二级页 → 每个子页取本模块 pages[id] 的 { html, load, bind }
 *   #/desktop-releases 版本清单（DSH Desktop 安装包：检测 → 入库 → 发布 → 离线上传）
 *   #/desktop-env      环境物料（Node LTS 与 pnpm 的各平台构建：同样一套动作）
 * 兼容：老壳不识别 nav.children 时回退 html/load/bind（= 第一个子页）。
 * 数据源：/admin/desktop-repo（一次取回安装包 + 环境物料，两页共用同一份「下发中」状态）
 */
import { api, $, toast, esc, confirmDlg, icon } from '/admin/static/contract.mjs'
import { T } from '/admin/static/js/i18n.mjs'

/* ---------- 公共片段 ---------- */

/** 状态徽章：remote=只有上游清单 ready=平台齐全 partial=缺一半 error=上轮同步全失败 */
const STATUS = {
  ready:   { cls: 'ok',   text: () => T('已就绪', 'Ready') },
  partial: { cls: 'warn', text: () => T('部分就绪', 'Partial') },
  remote:  { cls: 'dim',  text: () => T('未同步', 'Not synced') },
  error:   { cls: 'bad',  text: () => T('同步失败', 'Sync failed') },
}

const fmtMb = (n) => (n ? (n / 1048576).toFixed(n >= 10485760 ? 0 : 1) + ' MB' : '—')

const FEED_LABEL = {
  github: 'GitHub Releases',
  modelscope: T('ModelScope 镜像', 'ModelScope mirror'),
  official: T('官方源', 'Official'),
  npmmirror: T('国内镜像', 'CN mirror'),
  upload: T('手工上传', 'Uploaded'),
}
const feedName = (s) => FEED_LABEL[s] ?? s

/** 物料平台的人话名（Node 的构建按架构分开，光看 mac-arm64 客户不知道买哪台机器能用） */
const PLAT_LABEL = {
  'mac-arm64': () => T('macOS · Apple 芯片', 'macOS · Apple Silicon'),
  'mac-x64': () => T('macOS · Intel', 'macOS · Intel'),
  'win-x64': () => 'Windows x64',
}
const platLabel = (p) => (PLAT_LABEL[p] ? PLAT_LABEL[p]() : p)

let last = null

/** 平台单元格：有包 → 体积 + 校验状态 + 摘要来源；没包 → 同步按钮（kind 只给环境物料用） */
/**
 * 清单只摆最近 N 个：上游 release 动辄十几个，管理员要点来点去的就是最新几个。
 * 但「当前下发」和「本地已经有包」的版本必须露面——它们可能是窗口外的老版本，
 * 回滚、删包、重下发都靠这一行，藏起来就等于把退路藏了。
 */
const RECENT_VERSIONS = 3
const expanded = new Set()   // 展开状态跨刷新保留：管理员点开后不该被下一次自动刷新收回去
function recentRows(list, key) {
  const all = list ?? []
  if (expanded.has(key)) return { shown: all, hidden: 0 }
  const keep = new Set(all.slice(0, RECENT_VERSIONS).map((v) => v.version))
  for (const v of all) {
    const local = Object.values(v.platforms ?? {}).some((a) => a?.have)
    if (v.published || local || (v.bytes ?? 0) > 0) keep.add(v.version)
  }
  const shown = all.filter((v) => keep.has(v.version))
  return { shown, hidden: all.length - shown.length }
}

/** 折叠行尾的展开/收起条 */
function expandRow(key, hidden) {
  const open = expanded.has(key)
  if (!open && hidden <= 0) return ''   // 本来就没藏版本，别摆个没用的按钮
  return `<tr><td colspan="6" style="padding:0"><button class="btn sm" data-expand="${esc(key)}" style="margin:8px 0 2px">${
    hidden > 0
      ? `${icon('chevron-down', { size: 13 })} ${T('还有 {n} 个更早版本，全部展开', 'Show {n} earlier versions', { n: hidden })}`
      : T('只看最近 {n} 个版本', 'Show only the {n} newest', { n: RECENT_VERSIONS })
  }</button></td></tr>`
}

function platCell(v, p, kind = '') {
  const a = v.platforms[p]
  if (!a) return '<span class="dim2">—</span>'
  if (a.have) {
    const mark = a.verified
      ? `<span class="badge ok">${T('校验通过', 'Verified')}</span>`
      : `<span class="badge warn" title="${esc(T('校验值由网关实算（手工上传没有上游摘要可比）', 'Hash computed by the gateway (uploads have no upstream digest)'))}">${T('自算校验值', 'Self-hashed')}</span>`
    return `<div style="white-space:nowrap">${esc(fmtMb(a.size))} ${mark}</div>
      <div class="crumb mono" style="margin:2px 0 0" title="${esc(a.sha256)}">${esc(String(a.sha256).slice(0, 12))}… · ${esc(feedName(a.source))}</div>`
  }
  if (a.remote.length) {
    return `<button class="btn sm" data-sync="${esc(v.version)}" data-plat="${p}"${kind ? ` data-kind="${kind}"` : ''}>${icon('download', { size: 13 })} ${T('同步', 'Sync')}</button>`
  }
  return `<span class="dim2">${T('源上无此平台', 'Not in feeds')}</span>`
}

const statusBadge = (v) => {
  const st = STATUS[v.status] ?? STATUS.remote
  return `<span class="badge ${st.cls}">${st.text()}</span>${v.lastError ? `<div class="crumb" style="max-width:260px;white-space:normal">${esc(v.lastError)}</div>` : ''}`
}

/* ============ 子页 1 · 版本清单（安装包） ============ */

function rowOf(v) {
  const pub = v.published
    ? `<span class="badge ok">${T('当前下发', 'Serving')}</span>`
    : `<button class="btn sm primary" data-pub="${esc(v.version)}" ${v.status === 'remote' ? 'disabled' : ''}>${T('设为下发版本', 'Publish')}</button>`
  return `<tr>
    <td>
      <div class="mono"><b>${esc(v.version)}</b>${v.tag && v.tag !== 'v' + v.version ? ` <span class="crumb">${esc(v.tag)}</span>` : ''}</div>
      <div class="crumb">${v.channel === 'beta' ? T('预发布', 'Prerelease') : T('正式版', 'Stable')}${v.publishedAt ? ' · ' + esc(String(v.publishedAt).slice(0, 10)) : ''}</div>
    </td>
    <td>${statusBadge(v)}</td>
    <td>${platCell(v, 'mac')}</td>
    <td>${platCell(v, 'win')}</td>
    <td class="num">
      ${pub}
      ${v.platforms.mac.have || v.platforms.win.have
        ? `<button class="btn sm danger" data-del="${esc(v.version)}" style="margin-left:6px">${T('删包', 'Delete')}</button>` : ''}
    </td>
  </tr>`
}

const releasesHtml = `
  <div class="headrow" data-ent-page="ent-desktop">
    <div><h1>${T('版本清单', 'Desktop Releases')}</h1>
      <div class="sub" style="margin-bottom:0">${T('网关定期检测上游新版本，把安装包拉进企业内网；用户在 /setup 装的就是这里发布的版本。', 'The gateway watches upstream releases, mirrors installers into your network, and serves the version you publish here.')}</div>
    </div>
    <div class="sp"></div>
    <span class="badge dim" id="dskChecked"></span>
    <button class="btn sm" id="dskCheckBtn">${icon('refresh-cw', { size: 13 })} ${T('立即检测', 'Check now')}</button>
  </div>

  <div class="card">
    <h2><span class="bar"></span>${T('当前下发', 'Now serving')}<span class="badge dim" id="dskBytes"></span></h2>
    <div class="kv">
      <div class="k">${T('macOS 安装包', 'macOS package')}</div><div class="v mono" id="dskMac">—</div>
      <div class="k">${T('Windows 安装包', 'Windows package')}</div><div class="v mono" id="dskWin">—</div>
      <div class="k">${T('下载入口', 'Setup entry')}</div><div class="v mono">/setup · /setup/releases.json</div>
    </div>
    <div class="hint" id="dskHint"></div>
  </div>

  <div id="dskNotice"></div>

  <div class="card">
    <h2><span class="bar"></span>${T('版本', 'Versions')}<span class="badge dim" id="dskCount"></span></h2>
    <div class="tablewrap">
      <table>
        <thead><tr>
          <th>${T('版本', 'Version')}</th><th>${T('状态', 'Status')}</th>
          <th>${T('macOS', 'macOS')}</th><th>${T('Windows', 'Windows')}</th><th class="num">${T('操作', 'Actions')}</th>
        </tr></thead>
        <tbody id="dskRows"></tbody>
      </table>
    </div>
  </div>


`


/* ============ 子页 2 · 环境物料（Node / pnpm） ============ */

function envGroupOf(g) {
  const { shown, hidden } = recentRows(g.versions, `env:${g.kind}`)
  const rows = shown.length
    ? shown.map((v) => {
      const pub = v.published
        ? `<span class="badge ok">${T('当前下发', 'Serving')}</span>`
        : `<button class="btn sm primary" data-pub="${esc(v.version)}" data-kind="${g.kind}" ${v.status === 'remote' ? 'disabled' : ''}>${T('设为下发版本', 'Publish')}</button>`
      const del = v.bytes ? `<button class="btn sm danger" data-envdel="${esc(v.version)}" data-kind="${g.kind}" style="margin-left:6px">${T('删包', 'Delete')}</button>` : ''
      return `<tr>
        <td>
          <div class="mono"><b>${esc(v.version)}</b>${v.ltsName ? ` <span class="crumb">${esc(v.ltsName)}</span>` : ''}</div>
          <div class="crumb">${v.date ? esc(v.date) : ''}</div>
        </td>
        <td>${statusBadge(v)}</td>
        ${g.platforms.map((p) => `<td>${platCell(v, p, g.kind)}</td>`).join('')}
        <td class="num">${pub}${del}</td>
      </tr>`
    }).join('')
    : `<tr><td colspan="${g.platforms.length + 3}" class="empty">${T('还没检测到物料，点右上角「检测上游」', 'Nothing detected yet — hit Check upstream')}</td></tr>`
  // 展开条：全展开时也要留（否则收不回去）；但一行都没有时不用留
  const tail = shown.length ? expandRow(`env:${g.kind}`, hidden) : ''
  return `<h2 style="margin-top:18px"><span class="bar"></span>${esc(g.label)}
      <span class="badge ${g.published ? 'ok' : 'dim'}">${g.published ? T('下发 {v}', 'Serving {v}', { v: g.published }) : T('未发布', 'Not published')}</span></h2>
    <div class="tablewrap">
      <table>
        <thead><tr>
          <th>${T('版本', 'Version')}</th><th>${T('状态', 'Status')}</th>
          ${g.platforms.map((p) => `<th>${esc(platLabel(p))}</th>`).join('')}
          <th class="num">${T('操作', 'Actions')}</th>
        </tr></thead>
        <tbody>${rows}${tail}</tbody>
      </table>
    </div>`
}

const envHtml = `
  <div class="headrow" data-ent-page="ent-desktop">
    <div><h1>${T('环境物料', 'Runtime Mirrors')}</h1>
      <div class="sub" style="margin-bottom:0">${T('装机脚本剩下的两处外网依赖：Node.js 本体与 pnpm 本体。镜像到网关后，纯内网也能一键装完（企业插件零依赖，桌面 app 自带运行时，都不走 npm 源）。', 'The last two external dependencies of the setup scripts: Node.js and pnpm. Mirror them here and installation works fully offline (the enterprise plugin has zero deps and the desktop app ships its own runtime).')}</div>
    </div>
    <div class="sp"></div>
    <span class="badge dim" id="envChecked"></span>
    <button class="btn sm" id="envGapBtn">${icon('download', { size: 13 })} ${T('补齐缺口', 'Mirror gaps')}</button>
    <button class="btn sm" id="envCheckBtn">${icon('refresh-cw', { size: 13 })} ${T('检测上游', 'Check upstream')}</button>
  </div>

  <div class="card">
    <h2><span class="bar"></span>${T('当前下发', 'Now serving')}<span class="badge dim" id="envBytes"></span></h2>
    <div class="kv">
      <div class="k">Node.js</div><div class="v mono" id="envNode">—</div>
      <div class="k">pnpm</div><div class="v mono" id="envPnpm">—</div>
      <div class="k">${T('下载入口', 'Setup entry')}</div><div class="v mono">/setup/env.json · /setup/env/&lt;kind&gt;/&lt;架构&gt;</div>
    </div>
    <div class="hint" id="envHint"></div>
  </div>

  <div id="envNotice"></div>

  <div class="card" id="envGroups"></div>


`



/* ---- 四张卡从长页里搬出来，由「下发设置」「离线上传」两个页签复用 ---- */

const desk_settings = `
  <div class="card">
    <h2><span class="bar"></span>${T('安装包：检测与保留策略', 'Installer: feeds & retention')}</h2>
    <div class="frm">
      <div class="fld full"><label>${T('检测源', 'Feeds')}</label><div class="ctrl">
        <span class="chk"><input type="checkbox" id="dskFeedGithub"> GitHub Releases</span>
        <span class="chk"><input type="checkbox" id="dskFeedMirror">${T('ModelScope 镜像', 'ModelScope mirror')}</span>
      </div></div>
      <div class="fld"><label>${T('渠道', 'Channel')}</label><div class="ctrl">
        <select id="dskBeta"><option value="stable">${T('仅正式版', 'Stable only')}</option><option value="beta">${T('含预发布', 'Include prerelease')}</option></select>
      </div></div>
      <div class="fld"><label>${T('检测间隔', 'Interval')}</label><div class="ctrl">
        <input class="input" id="dskInterval" type="number" min="10" max="10080" style="width:110px"><span class="unit">${T('分钟', 'min')}</span>
      </div></div>
      <div class="fld"><label>${T('保留版本', 'Keep')}</label><div class="ctrl">
        <input class="input" id="dskKeep" type="number" min="1" max="10" style="width:110px"><span class="unit">${T('个', '')}</span>
      </div></div>
      <div class="fld full"><label>${T('仓库', 'Repo')}</label><div class="ctrl">
        <input class="input mono grow" id="dskRepo" placeholder="anywhere-labs/dsh-desktop">
      </div></div>
      <div class="fld full"><label>${T('镜像仓库', 'Mirror')}</label><div class="ctrl">
        <input class="input mono grow" id="dskMirror" placeholder="${T('ModelScope 模型库，留空用默认', 'ModelScope repository; blank uses the default')}">
      </div></div>
      <div class="fld full"><label>${T('下载域名', 'Hosts')}</label><div class="ctrl">
        <input class="input mono grow" id="dskHosts" placeholder="mirror.corp.com"><span class="unit">${T('逗号分隔', 'comma separated')}</span>
      </div></div>
      <div class="fld full"><label>${T('令牌', 'Token')}</label><div class="ctrl">
        <input class="input" id="dskToken" type="password" autocomplete="off" placeholder="ghp_…" style="max-width:340px">
        <span class="desc" id="dskTokenState">${T('可选，仅用于缓解 GitHub 限流', 'Optional; lifts the GitHub rate limit')}</span>
      </div></div>
      <div class="fld full"><label>${T('自动入库', 'Auto')}</label><div class="ctrl" style="flex-direction:column;align-items:flex-start;gap:7px">
        <span class="chk"><input type="checkbox" id="dskAutoSync">${T('检测到新版本自动下载入库（发布仍需人工点，不静默改变全员版本）', 'Auto-mirror new versions into the gateway (publishing stays manual)')}</span>
        <span class="chk"><input type="checkbox" id="dskFallback">${T('网关没有可用包时，允许安装脚本回退公网直下（纯内网环境请关闭）', 'Let setup scripts fall back to the internet when the gateway has no package (turn off for air-gapped networks)')}</span>
      </div></div>
    </div>
    <div class="notebox">${T('保留版本 = 本地留最新 N 个版本的包（当前下发那个另算），超出即删盘；检测间隔太短只是多打上游接口，包不会多下。', 'Keep = mirror the newest N versions locally (the served one is always kept); older ones are deleted from disk.')}</div>
    <div style="margin-top:14px"><button class="btn primary" id="dskSaveBtn">${T('保存设置', 'Save settings')}</button></div>
  </div>
`

const env_settings = `
  <div class="card">
    <h2><span class="bar"></span>${T('环境物料：来源与保留策略', 'Runtime files: sources & retention')}</h2>
    <div class="frm">
      <div class="fld full"><label>${T('源顺序', 'Feeds')}</label><div class="ctrl">
        <select id="envFeedOrder">
          <option value="official,npmmirror">${T('Node：官方优先，阿里镜像兜底', 'Node: official first, npmmirror fallback')}</option>
          <option value="npmmirror,official">${T('Node：镜像优先（国内机房推荐）', 'Node: mirror first (CN data centers)')}</option>
          <option value="npmmirror">${T('Node：只用镜像（不回源官方）', 'Node: mirror only')}</option>
        </select>
      </div></div>
      <div class="fld full"><label>${T('版本策略', 'Channel')}</label><div class="ctrl">
        <select id="envNodeChannel"><option value="lts">${T('Node：仅 LTS（装机基线稳）', 'Node: LTS only (stable baseline)')}</option><option value="current">${T('Node：跟随 Current', 'Node: track Current')}</option></select>
      </div></div>
      <div class="fld"><label>${T('Node 保留', 'Node keep')}</label><div class="ctrl">
        <input class="input" id="envNodeKeep" type="number" min="1" max="6" style="width:110px"><span class="unit">${T('个', '')}</span>
      </div></div>
      <div class="fld"><label>${T('pnpm 保留', 'pnpm keep')}</label><div class="ctrl">
        <input class="input" id="envPnpmKeep" type="number" min="1" max="6" style="width:110px"><span class="unit">${T('个', '')}</span>
      </div></div>
      <div class="fld"><label>${T('单包上限', 'Max file')}</label><div class="ctrl">
        <input class="input" id="envMaxMb" type="number" min="8" max="4096" style="width:110px"><span class="unit">MB</span>
      </div></div>
      <div class="fld full"><label>${T('官方目录', 'Dist base')}</label><div class="ctrl">
        <input class="input mono grow" id="envDistBase" placeholder="https://nodejs.org/dist">
      </div></div>
      <div class="fld full"><label>${T('镜像目录', 'Mirror base')}</label><div class="ctrl">
        <input class="input mono grow" id="envMirrorBase" placeholder="https://npmmirror.com/mirrors/node">
      </div></div>
      <div class="fld full"><label>npm registry</label><div class="ctrl">
        <input class="input mono grow" id="envRegistry" placeholder="https://registry.npmjs.org">
      </div></div>
      <div class="fld full"><label>${T('镜像源', 'Mirror reg')}</label><div class="ctrl">
        <input class="input mono grow" id="envMirrorRegistry" placeholder="https://registry.npmmirror.com">
      </div></div>
      <div class="fld full"><label>${T('自动入库', 'Auto')}</label><div class="ctrl">
        <span class="chk"><input type="checkbox" id="envAutoSync">${T('检测到新 LTS / 新版 pnpm 自动下载入库（发布仍需人工点）', 'Auto-mirror new LTS and pnpm releases (publishing stays manual)')}</span>
      </div></div>
    </div>
    <div class="notebox">${T('校验口径：Node 对官方 SHASUMS256.txt（sha256），pnpm 对 npm 的 dist.integrity（sha512）；摘要对不上就不入库，网关不会发自己都没验过的东西。', 'Node is verified against the official SHASUMS256.txt (sha256), pnpm against npm dist.integrity (sha512). A mismatch is never stored.')}</div>
    <div class="notebox warn">${T('为什么镜像 @pnpm/exe.*：pnpm 从 12 起主 npm 包不再自带运行时 —— 装包时 install.js 要用 optionalDependencies 里的 @pnpm/exe.<平台> 顶掉占位 bin，顶不到就在首次运行时去 get.pnpm.io / registry.npmjs.org 下载。纯内网两头都出不去，所以网关镜像官方原生包：解出来就是一个可执行文件，不依赖 Node，也不碰 npm 源。', 'Why @pnpm/exe.*: since pnpm 12 the main npm package ships no runtime — install.js swaps the placeholder bin for @pnpm/exe.<platform> from optionalDependencies, and falls back to downloading one on first run from get.pnpm.io / registry.npmjs.org. Neither works air-gapped, so the gateway mirrors the official native packages: each untars to one executable, needs no Node and never touches an npm registry.')}</div>
    <div style="margin-top:14px"><button class="btn primary" id="envSaveBtn">${T('保存设置', 'Save settings')}</button></div>
  </div>
`

const desk_upload = `
  <div class="card">
    <h2><span class="bar"></span>${T('离线上传安装包', 'Upload a package')}</h2>
    <div class="sub" style="margin-bottom:12px">${T('不通公网的客户：把 dmg/exe 拷进来，网关算出 sha256 后按同一套流程下发（校验值来源会标注为「自算」）。', 'Air-gapped sites: drop a dmg/exe here; the gateway hashes it and serves it like any mirrored package.')}</div>
    <div class="frm">
      <div class="fld"><label>${T('版本号', 'Version')}</label><div class="ctrl">
        <input class="input mono" id="dskUpVersion" placeholder="2.0.13">
      </div></div>
      <div class="fld"><label>${T('平台', 'Platform')}</label><div class="ctrl">
        <select id="dskUpPlatform"><option value="mac">macOS (.dmg)</option><option value="win">Windows (.exe)</option></select>
      </div></div>
      <div class="fld full"><label>${T('文件', 'File')}</label><div class="ctrl">
        <input class="input" id="dskUpFile" type="file">
      </div></div>
      <div class="fld full"><label>&nbsp;</label><div class="ctrl" style="align-items:center">
        <button class="btn" id="dskUpBtn">${icon('download', { size: 13 })} ${T('上传入库', 'Upload')}</button>
        <span class="crumb mono" id="dskUpState" style="margin:0"></span>
      </div></div>
    </div>
  </div>
`

const env_upload = `
  <div class="card">
    <h2><span class="bar"></span>${T('离线上传环境物料', 'Upload runtime files')}</h2>
    <div class="sub" style="margin-bottom:12px">${T('连上游都不通时：从任意机器拷 node-v24.x-darwin-arm64.tar.gz / node-v24.x-win-x64.zip / exe.darwin-arm64-12.x.y.tgz 进来，版本号照官方写。', 'When upstream is unreachable too: copy the official tarballs in (Node tarball/zip, or an @pnpm/exe.* tarball) and record the official version number.')}</div>
    <div class="frm">
      <div class="fld"><label>${T('物料', 'Artifact')}</label><div class="ctrl">
        <select id="envUpKind"><option value="node">Node.js</option><option value="pnpm">pnpm</option></select>
      </div></div>
      <div class="fld"><label>${T('平台', 'Platform')}</label><div class="ctrl">
        <select id="envUpPlatform"></select>
      </div></div>
      <div class="fld full"><label>${T('版本号', 'Version')}</label><div class="ctrl">
        <input class="input mono" id="envUpVersion" placeholder="24.21.0 / 12.5.1" style="max-width:340px">
      </div></div>
      <div class="fld full"><label>${T('文件', 'File')}</label><div class="ctrl">
        <input class="input" id="envUpFile" type="file">
      </div></div>
      <div class="fld full"><label>&nbsp;</label><div class="ctrl" style="align-items:center">
        <button class="btn" id="envUpBtn">${icon('download', { size: 13 })} ${T('上传入库', 'Upload')}</button>
        <span class="crumb mono" id="envUpState" style="margin:0"></span>
      </div></div>
    </div>
  </div>
`

/* ============ 子页 3 · 下发设置（安装包 + 环境物料的策略并在一页） ============ */

const settingsHtml = `
  <div class="headrow" data-ent-page="ent-desktop">
    <div><h1>${T('下发设置', 'Serving Settings')}</h1>
      <div class="sub" style="margin-bottom:0">${T('安装包与环境物料的检测源、保留策略、自动入库都收在这一页；两张卡各存各的，保存互不影响。', 'Feeds, retention and auto-mirror for both installers and runtime files. Each card saves on its own.')}</div>
    </div>
    <div class="sp"></div>
    <span class="badge dim">${T('改完点卡片底部「保存设置」', 'Hit Save at the bottom of a card')}</span>
  </div>

${desk_settings}

${env_settings}
`

/* ============ 子页 4 · 离线上传（不通公网的客户从这里灌包） ============ */

const uploadHtml = `
  <div class="headrow" data-ent-page="ent-desktop">
    <div><h1>${T('离线上传', 'Offline Upload')}</h1>
      <div class="sub" style="margin-bottom:0">${T('网关连不上公网时，把官方包拷进来入库：网关实算摘要后按同一套流程下发（校验来源标注为「自算」）。', 'When the gateway cannot reach the internet, drop official packages in: the gateway hashes them and serves them like any mirrored file.')}</div>
    </div>
    <div class="sp"></div>
    <span class="badge dim">${T('单个文件上限见设置页', 'Size cap is set on the Settings page')}</span>
  </div>

${desk_upload}

${env_upload}
`

const pubOf = (kind) => (last?.env?.kinds ?? []).find((g) => g.kind === kind)
const platListOf = (kind) => last?.env?.platforms?.[kind]?.platforms ?? []

function renderReleases() {
  if (!last || !document.getElementById('dskRows')) return
  const o = last.overview
  const s = last.settings
  $('dskChecked').textContent = o.checkedAt ? T('上次检测 {t}', 'Last check {t}', { t: o.checkedAt }) : T('还没检测过', 'Never checked')
  $('dskBytes').textContent = T('本地占用 {n} MB', 'On disk {n} MB', { n: Math.round(o.totalBytes / 1048576) })
  const { shown, hidden } = recentRows(last.versions, 'dsk')
  $('dskCount').textContent = hidden > 0
    ? T('最近 {s} 个 · 共 {n} 个版本', '{s} newest · {n} total', { s: shown.length, n: last.versions.length })
    : T('共 {n} 个版本', '{n} versions', { n: last.versions.length })
  const pub = last.versions.find((v) => v.published)
  const show = (p) => pub?.platforms[p]?.have
    ? `${esc(pub.version)} <span class="crumb">${esc(fmtMb(pub.platforms[p].size))}</span>`
    : `<span class="dim2">${T('未发布可用包', 'Nothing served')}</span>`
  $('dskMac').innerHTML = show('mac')
  $('dskWin').innerHTML = show('win')
  $('dskRows').innerHTML = shown.length
    ? shown.map(rowOf).join('') + expandRow('dsk', hidden)
    : `<tr><td colspan="5" class="empty">${T('还没有检测到任何版本，点右上角「立即检测」', 'No versions yet — hit Check now')}</td></tr>`
  $('dskHint').textContent = pub
    ? T('新装机器会拿到 {v}；已装机器由桌面端自己的更新机制升级。', 'New installs get {v}; existing clients upgrade on their own.', { v: pub.version })
    : T('当前没有下发版本：安装脚本会回退到公网直下（若已关闭回退则直接提示找不到包）。', 'Nothing is served: setup scripts fall back to the internet (or fail if fallback is off).')
  // 设置面回填（load 后一次性刷，避免用户在编辑时被覆盖）
  $('dskFeedGithub').checked = s.feeds.includes('github')
  $('dskFeedMirror').checked = s.feeds.includes('modelscope')
  $('dskRepo').value = s.githubRepo
  $('dskMirror').value = s.mirrorRepo
  $('dskBeta').value = s.channel
  $('dskInterval').value = s.checkIntervalMin
  $('dskKeep').value = s.keepVersions
  $('dskHosts').value = (s.allowedHosts ?? []).join(', ')
  $('dskAutoSync').checked = !!s.autoSync
  $('dskFallback').checked = !!s.allowUpstreamFallback
  $('dskTokenState').textContent = s.hasToken
    ? T('已配置（存放在 data/.env 的 {k}，页面不回显）', 'Configured (stored in data/.env as {k})', { k: s.githubTokenEnv })
    : T('未配置（匿名限流 60 次/小时/IP）', 'Not set (anonymous limit: 60 req/h/IP)')
  $('dskToken').placeholder = s.hasToken ? '••••••••' : 'ghp_…'
  const notice = $('dskNotice')
  notice.innerHTML = o.lastError
    ? `<div class="card" style="border-color:var(--warn)"><div class="crumb">${T('上一轮检测的问题：', 'Last check reported:')} <span class="mono">${esc(o.lastError)}</span></div></div>`
    : ''
}

function renderEnv() {
  if (!last?.env || !document.getElementById('envGroups')) return
  const o = last.env.overview
  const s = last.env.settings
  const node = pubOf('node')
  const pnpm = pubOf('pnpm')
  const cell = (g) => {
    if (!g?.published) return `<span class="dim2">${T('未发布', 'Not published')}</span>`
    const v = g.versions.find((x) => x.version === g.published)
    const bytes = v?.bytes ?? 0
    return `${esc(g.published)} <span class="crumb">${esc(fmtMb(bytes))}</span>`
  }
  $('envChecked').textContent = o.checkedAt ? T('上次检测 {t}', 'Last check {t}', { t: o.checkedAt }) : T('还没检测过', 'Never checked')
  $('envBytes').textContent = T('本地占用 {n} MB', 'On disk {n} MB', { n: Math.round(o.totalBytes / 1048576) })
  $('envNode').innerHTML = cell(node)
  $('envPnpm').innerHTML = cell(pnpm)
  $('envGroups').innerHTML = last.env.kinds.map(envGroupOf).join('')
  $('envHint').textContent = node?.published && pnpm?.published
    ? T('装机脚本 [2/6] 会读 /setup/env.json：本机没有 Node 时按架构从网关取 {n}，pnpm 用 {p}。', 'Setup step [2/6] reads /setup/env.json: machines without Node take {n} for their arch, and pnpm comes from {p}.', { n: node.published, p: pnpm.published })
    : T('Node 与 pnpm 都在「已就绪」后各点一次「设为下发版本」，装机脚本才会走内网；否则本机缺 Node 的机器要回退公网。', 'Publish both Node and pnpm to keep installation inside your network; otherwise machines without Node fall back to the internet.')
  $('envFeedOrder').value = s.envFeeds.join(',')
  $('envNodeChannel').value = s.nodeChannel
  $('envNodeKeep').value = s.nodeKeepVersions
  $('envPnpmKeep').value = s.pnpmKeepVersions
  $('envDistBase').value = s.nodeDistBase
  $('envMirrorBase').value = s.nodeMirrorBase
  $('envRegistry').value = s.pnpmRegistry
  $('envMirrorRegistry').value = s.pnpmMirror
  $('envMaxMb').value = s.envMaxPackageMb
  $('envAutoSync').checked = !!s.envAutoSync
  fillEnvPlatforms()
  const notice = $('envNotice')
  const err = [o.lastError, ...(last.envErrors ?? [])].filter(Boolean)
  notice.innerHTML = err.length
    ? `<div class="card" style="border-color:var(--warn)"><div class="crumb">${T('上一轮检测的问题：', 'Last check reported:')} <span class="mono">${esc(err.join('; '))}</span></div></div>`
    : ''
}

function fillEnvPlatforms() {
  const kind = $('envUpKind')?.value ?? 'node'
  const sel = $('envUpPlatform')
  if (!sel) return
  const plats = platListOf(kind)
  sel.innerHTML = plats.map((p) => `<option value="${p}">${esc(platLabel(p))}</option>`).join('')
}

/* ---------- 交互 ---------- */

async function load() {
  const r = await api('/admin/desktop-repo')
  if (r?.error) { toast('✗ ' + r.error.message, 'bad'); return }
  last = r
  renderReleases()
  renderEnv()
}

/** 统一的「点一下 → 转圈 → 拉最新数据」：按钮文案就是进度反馈 */
async function run(route, { body, btn, busy } = {}) {
  const old = btn?.innerHTML
  if (btn) { btn.disabled = true; btn.textContent = busy }
  try {
    // 壳的 api() 不替你序列化：对象直接进 fetch 会变成 "[object Object]"，服务端只会当成空体
    const r = await api(route, { method: 'POST', body: JSON.stringify(body ?? {}) })
    if (r?.error) throw new Error(r.error.message)
    await load()
    return r
  } catch (e) {
    toast('✗ ' + String(e?.message ?? e), 'bad')
    return null
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = old }
  }
}

async function checkNow(btn) {
  const r = await run('/admin/desktop-repo/check', { btn, busy: T('检测中…', 'Checking…') })
  if (r) {
    toast(r.fresh?.length
      ? T('发现 {n} 个新版本，点版本行的「同步」入库', '{n} new versions found — hit Sync on a row to mirror', { n: r.fresh.length })
      : T('没有新版本（上游 {n} 个版本已在清单里）', 'No new versions ({n} known)', { n: last?.versions?.length ?? 0 }))
  }
}

/** 同步结果的口径：新下了哪些平台 / 哪些本来就有（不重复耗带宽），两者不能都说「已入库」 */
function syncMsg(label, r) {
  const got = (r?.synced ?? []).flatMap((s) => s.synced ?? []).join('/')
  const had = (r?.synced ?? []).flatMap((s) => s.skipped ?? []).join('/')
  return got
    ? T('{l} 已入库（{p}）', '{l} mirrored ({p})', { l: label, p: got })
    : T('{l} 本地已有，未重复下载（{p}）', '{l} already mirrored, nothing re-downloaded ({p})', { l: label, p: had || '—' })
}

async function syncOne(version, platform, btn, kind) {
  if (kind) {
    const r = await run('/admin/env-repo/sync', { body: { kind, version, platform: platform || null }, btn, busy: T('入库中…', 'Mirroring…') })
    if (r) toast(syncMsg(`${kind === 'node' ? 'Node.js' : 'pnpm'} ${version}`, r))
    return
  }
  const r = await run('/admin/desktop-repo/sync', { body: { version, platform: platform || null }, btn, busy: T('入库中…', 'Mirroring…') })
  if (r) toast(syncMsg(version, r))
}

/** 补齐缺口：每类物料取最新的「未就绪」版本入库一次（不发布，只让本地有包） */
async function envSyncGaps(btn) {
  // 只挑保留窗口内的缺口：prune 只留「已发布 + 最新 N 个」，窗口外的版本下完就被清掉，白耗几十 MB
  const keepOf = (kind) => Number((kind === 'node' ? last?.env?.settings?.nodeKeepVersions : last?.env?.settings?.pnpmKeepVersions) ?? 2)
  const targets = []
  let outOfWindow = 0
  for (const g of last?.env?.kinds ?? []) {
    const miss = (g.versions ?? []).map((v, i) => ({ v, i })).filter(({ v }) => v.status !== 'ready')
    const inWin = miss.find(({ i }) => i <= keepOf(g.kind))   // 0..N-1 是最新 N 个，另外留住已发布那个
    if (inWin) targets.push({ kind: g.kind, version: inWin.v.version })
    else if (miss.length) outOfWindow += miss.length
  }
  if (!targets.length) {
    toast(outOfWindow
      ? T('保留窗口内的都齐了；更早的版本下完也会被清理（要留就在设置里提高保留版本数）', 'Window is complete; older releases would be pruned right after mirroring (raise the keep setting to retain them)')
      : T('该同步的都齐了', 'Everything is already mirrored'))
    return
  }
  const done = []
  for (const t of targets) {
    const r = await run('/admin/env-repo/sync', { body: t, btn, busy: T('入库 {k} {v}…', 'Mirroring {k} {v}…', { k: t.kind, v: t.version }) })
    if (r) done.push(t.kind)
    else break   // 一步失败就别接着耗带宽
  }
  if (done.length) toast(T('已入库：{k}。发布仍需在版本行点「设为下发版本」', 'Mirrored: {k}. Publishing stays manual.', { k: done.join(', ') }))
}

async function publish(version, kind) {
  const field = kind ? ({ node: 'publishedNode', pnpm: 'publishedPnpm' })[kind] : 'published'
  try {
    const r = await api('/admin/desktop-repo', { method: 'PATCH', body: JSON.stringify({ [field]: version }) })
    if (r?.error) throw new Error(r.error.message)
    toast(T('下发版本已切换 → {v}', 'Now serving {v}', { v: version }))
    await load()
  } catch (e) {
    toast('✗ ' + String(e?.message ?? e), 'bad')
  }
}

async function removeVersion(version) {
  if (!(await confirmDlg({ title: T('删除本地安装包', 'Delete local package'), message: T('删除 {v} 的本地包？上游清单还在，随时可重新同步。', 'Delete the local packages of {v}? The upstream manifest stays and you can re-mirror any time.', { v: version }) }))) return
  try {
    const r = await api('/admin/desktop-repo/' + encodeURIComponent(version), { method: 'DELETE' })
    if (r?.error) throw new Error(r.error.message)
    toast(T('已删除', 'Deleted'))
    await load()
  } catch (e) { toast('✗ ' + String(e?.message ?? e), 'bad') }
}

async function envRemove(kind, version) {
  if (!(await confirmDlg({ title: T('删除本地环境物料', 'Delete local runtime file'), message: T('删除 {k} {v} 的本地包？官方目录清单还在，随时可重新同步。', 'Delete local files of {k} {v}? The upstream index stays, so you can re-mirror.', { k: kind === 'node' ? 'Node.js' : 'pnpm', v: version }) }))) return
  try {
    const r = await api(`/admin/env-repo/${kind}/${encodeURIComponent(version)}`, { method: 'DELETE' })
    if (r?.error) throw new Error(r.error.message)
    toast(T('已删除', 'Deleted'))
    await load()
  } catch (e) { toast('✗ ' + String(e?.message ?? e), 'bad') }
}

async function saveSettings() {
  const body = {
    feeds: [$('dskFeedGithub').checked ? 'github' : null, $('dskFeedMirror').checked ? 'modelscope' : null].filter(Boolean),
    githubRepo: $('dskRepo').value.trim(),
    mirrorRepo: $('dskMirror').value.trim(),
    channel: $('dskBeta').value,
    checkIntervalMin: Number($('dskInterval').value),
    keepVersions: Number($('dskKeep').value),
    allowedHosts: $('dskHosts').value.split(',').map((s) => s.trim()).filter(Boolean),
    autoSync: $('dskAutoSync').checked,
    allowUpstreamFallback: $('dskFallback').checked,
  }
  if (!body.feeds.length) { toast(T('至少留一个检测源', 'Keep at least one feed'), 'bad'); return }
  const token = $('dskToken').value.trim()
  if (token) body.githubToken = token   // 空值不送：清空令牌要显式操作，避免误清
  const btn = $('dskSaveBtn')
  btn.disabled = true
  try {
    const r = await api('/admin/desktop-repo', { method: 'PATCH', body: JSON.stringify(body) })
    if (r?.error) throw new Error(r.error.message)
    $('dskToken').value = ''
    toast(T('设置已保存', 'Settings saved'))
    await load()
  } catch (e) {
    toast('✗ ' + String(e?.message ?? e), 'bad')
  } finally { btn.disabled = false }
}

async function saveEnvSettings() {
  const body = {
    envFeeds: $('envFeedOrder').value.split(',').filter(Boolean),
    nodeChannel: $('envNodeChannel').value,
    nodeKeepVersions: Number($('envNodeKeep').value),
    pnpmKeepVersions: Number($('envPnpmKeep').value),
    nodeDistBase: $('envDistBase').value.trim(),
    nodeMirrorBase: $('envMirrorBase').value.trim(),
    pnpmRegistry: $('envRegistry').value.trim(),
    pnpmMirror: $('envMirrorRegistry').value.trim(),
    envMaxPackageMb: Number($('envMaxMb').value),
    envAutoSync: $('envAutoSync').checked,
  }
  const btn = $('envSaveBtn')
  btn.disabled = true
  try {
    const r = await api('/admin/desktop-repo', { method: 'PATCH', body: JSON.stringify(body) })
    if (r?.error) throw new Error(r.error.message)
    toast(T('设置已保存', 'Settings saved'))
    await load()
  } catch (e) {
    toast('✗ ' + String(e?.message ?? e), 'bad')
  } finally { btn.disabled = false }
}

/** 上传走原生 fetch：浏览器自动带 session cookie，服务端流式落盘（不经 contract 的 JSON 封装） */
async function upload(route, { version, state, fileEl, extra = '' }) {
  const file = fileEl.files?.[0]
  if (!file) { toast(T('先选文件', 'Pick a file first'), 'bad'); return }
  if (!/^\d+\.\d+\.\d+(-[\w.+-]+)?$/.test(version)) { toast(T('版本号形如 2.0.13', 'Version looks like 2.0.13'), 'bad'); return }
  const el = $(state)
  const btn = $(state.replace('State', 'Btn'))
  btn.disabled = true
  el.textContent = T('上传中 {n} MB…', 'Uploading {n} MB…', { n: Math.round(file.size / 1048576) })
  try {
    const res = await fetch(`${route}?version=${encodeURIComponent(version)}${extra}&fileName=${encodeURIComponent(file.name)}`, { method: 'POST', body: file })
    const r = await res.json().catch(() => ({}))
    if (!res.ok || r?.error) throw new Error(r?.error?.message ?? ('HTTP ' + res.status))
    el.textContent = T('已入库 sha256 {s}…', 'Stored, sha256 {s}…', { s: String(r.sha256).slice(0, 12) })
    toast(T('已入库 {v}', 'Mirrored {v}', { v: version }))
    await load()
  } catch (e) {
    el.textContent = ''
    toast('✗ ' + e.message, 'bad')
  } finally {
    btn.disabled = false
  }
}

/* ---------- 绑定（每个二级页各绑各的，壳在挂载时各调一次） ---------- */

function bindReleases() {
  if (!document.getElementById('dskRows')) return
  $('dskCheckBtn').onclick = () => checkNow($('dskCheckBtn'))
  $('dskRows').onclick = (e) => {
    const xb = e.target.closest('[data-expand]')
    if (xb) {
      const key = xb.dataset.expand
      if (expanded.has(key)) expanded.delete(key); else expanded.add(key)
      renderReleases()
      return
    }
    const b = e.target.closest('button')
    if (!b) return
    if (b.dataset.sync) syncOne(b.dataset.sync, b.dataset.plat || null, b)
    else if (b.dataset.pub) publish(b.dataset.pub)
    else if (b.dataset.del) removeVersion(b.dataset.del)
  }
}

function bindEnv() {
  if (!document.getElementById('envGroups')) return
  $('envCheckBtn').onclick = async () => {
    const r = await run('/admin/env-repo/check', { btn: $('envCheckBtn'), busy: T('检测中…', 'Checking…') })
    if (r) {
      toast(r.fresh?.length
        ? T('发现 {n} 个新版本，点「补齐缺口」或版本行入库', '{n} new releases found — mirror them below', { n: r.fresh.length })
        : T('上游没有更新的版本', 'Nothing newer upstream'))
    }
  }
  $('envGapBtn').onclick = () => envSyncGaps($('envGapBtn'))
  $('envGroups').onclick = (e) => {
    const xb = e.target.closest('[data-expand]')
    if (xb) {
      const key = xb.dataset.expand
      if (expanded.has(key)) expanded.delete(key); else expanded.add(key)
      renderEnv()
      return
    }
    const b = e.target.closest('button')
    if (!b) return
    const kind = b.dataset.kind || null
    if (b.dataset.sync) syncOne(b.dataset.sync, b.dataset.plat || null, b, kind)
    else if (b.dataset.pub) publish(b.dataset.pub, kind)
    else if (b.dataset.envdel) envRemove(kind, b.dataset.envdel)
  }
}

/** 下发设置页：两张卡的保存各走各的接口（同一 PATCH /admin/desktop-repo，字段集不同） */
function bindSettings() {
  if (!document.getElementById('dskSaveBtn')) return
  $('dskSaveBtn').onclick = saveSettings
  $('envSaveBtn').onclick = saveEnvSettings
}

/** 离线上传页 */
function bindUpload() {
  if (!document.getElementById('dskUpBtn')) return
  $('dskUpBtn').onclick = () => upload('/admin/desktop-repo/upload', {
    version: $('dskUpVersion').value.trim(), state: 'dskUpState', fileEl: $('dskUpFile'),
    extra: `&platform=${encodeURIComponent($('dskUpPlatform').value)}`,
  })
  $('envUpKind').onchange = fillEnvPlatforms
  $('envUpBtn').onclick = () => upload('/admin/env-repo/upload', {
    version: $('envUpVersion').value.trim(), state: 'envUpState', fileEl: $('envUpFile'),
    extra: `&kind=${encodeURIComponent($('envUpKind').value)}&platform=${encodeURIComponent($('envUpPlatform').value)}`,
  })
  fillEnvPlatforms()
}

/* ---------- 壳契约导出 ---------- */

const pages = {
  'desktop-releases': { html: releasesHtml, load, bind: bindReleases },
  'desktop-env': { html: envHtml, load, bind: bindEnv },
  'desktop-settings': { html: settingsHtml, load, bind: bindSettings },
  'desktop-upload': { html: uploadHtml, load, bind: bindUpload },
}

export default {
  page: 'ent-desktop',
  // 兼容老壳（不识别 nav.children）：单页回退 = 第一个子页
  html: pages['desktop-releases'].html,
  async load() { await load() },
  bind() { for (const p of Object.values(pages)) p.bind() },
  pages,
}
