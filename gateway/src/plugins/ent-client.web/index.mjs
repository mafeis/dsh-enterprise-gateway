/**
 * 插件页面 · 客户端管控（一级菜单 + 4 个二级页）
 * 壳契约：ent-client.mjs 的 nav.children 声明二级页 → 每个子页取本模块 pages[id] 的 { html, load, bind }
 *   #/client-switches 策略与开关（界面策略 + 登录保护）
 *   #/client-plugins  插件管控（允许清单 + 企业插件源）
 *   #/client-rules    自助规则（用户端本机执行的拦网址/拦关键词/公告）
 *   #/client-acks     下发回执（策略版本灰度核对）
 * 兼容：老壳不识别 nav.children 时回退 html/load/bind（= 第一个子页）。
 * 数据源：/admin/policy* /admin/policy-detail（ent-console 聚合提供）
 */
import { api, $, toast, esc, openDlg, closeDlg, confirmDlg } from '/admin/static/contract.mjs'
import { T } from '/admin/static/js/i18n.mjs'

/* ---------- 公共片段 ---------- */
const headrow = (title, extra = '') => `
  <div class="headrow" data-ent-page="ent-client">
    <div><h1>${title}</h1></div>
    <div class="sp"></div>${extra}
  </div>`

const savebar = (key, label = T('保存更改', 'Save changes')) => `
  <div class="savebar" id="${key}Savebar">
    <span class="savebar-msg" id="${key}Msg"></span>
    <button class="btn primary" id="${key}SaveBtn">${label}</button>
  </div>`

/* ============ 子页 1 · 策略与开关 ============ */
const switchesHtml = `
  ${headrow(T('策略与开关', 'Policy & Switches'), `<span class="crumb" style="margin:0">${T('策略版本', 'Policy version')} <span class="mono" id="polVer">—</span></span>`)}

  <!-- ============ 界面策略开关 ============ -->
  <div class="card">
    <h2><span class="bar"></span>${T('界面策略', 'UI policy')} <span class="badge dim">${T('点击即生效', 'Click to apply')}</span></h2>
    <div class="switchrow">
      <span class="lab2">${T('模型配置锁定', 'Lock model config')}<span class="desc">${T('用户端隐藏「模型」设置页，防绕过企业配置', 'Hide the model page on client to keep corporate config')}</span></span>
      <span class="switch" id="swLock"></span>
    </div>
    <div class="switchrow" style="align-items:flex-start">
      <span class="lab2" style="padding-top:2px">${T('隐藏设置页', 'Hide settings pages')}<span class="desc">${T('按标签关键词隐藏用户端设置导航项（中英文都填，宿主改名后在此加关键词）', 'Hide client settings nav items by label keyword (fill both zh/en; add new keywords here if the host renames them)')}</span></span>
      <span style="flex:1;max-width:420px">
        <input class="input" id="hidePagesInput" placeholder="${T('桌面设置, Desktop settings（逗号分隔）', 'Desktop settings, 桌面设置 (comma-separated)')}" style="width:100%;font-size:12px;height:30px">
        <div style="font-size:11px;color:var(--dim);margin-top:3px">${T('改动自动下发，用户端 10s 内隐藏', 'Auto-deploys; clients hide within 10s')}</div>
      </span>
    </div>
    <div class="switchrow">
      <span class="lab2">${T('界面水印', 'UI watermark')}<span class="desc">${T('用户端 Web 界面叠加半透明水印，截屏外传可溯源；仅影响显示', 'Translucent watermark over the client web UI for traceability; display only')}</span></span>
      <span class="switch" id="swWm"></span>
    </div>
    <div id="wmStylePanel" style="display:none;margin:4px 0 12px;padding:12px 14px;background:var(--bg);border:1px solid var(--line);border-radius:8px">
      <div style="font-size:12.5px;font-weight:600;margin-bottom:10px">${T('水印样式', 'Watermark style')} <span class="badge dim">${T('改完即自动保存，用户端 10s 内跟随', 'Auto-saved; client follows within 10s')}</span></div>
      <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end;margin-bottom:10px">
        <label style="font-size:12px;color:var(--txt)">${T('内容模板', 'Template')}<br>
          <input id="wmTemplate" class="input" style="width:320px;font-size:12px;margin-top:3px" placeholder="${T('{user} · {time} · 企业机密', '{user} · {time} · Confidential')}">
        </label>
        <span style="font-size:11px;color:var(--dim);padding-bottom:7px;display:flex;gap:4px;flex-wrap:wrap;align-items:center">${T('点选插入：', 'Insert:')}
          <button type="button" class="btn sm" data-wmvar="{user}" title="${T('登录账号', 'Sign-in account')}" style="padding:1px 8px;font-size:11px">{user}</button>
          <button type="button" class="btn sm" data-wmvar="{time}" title="${T('当前时间（分钟级刷新）', 'Current time (per-minute refresh)')}" style="padding:1px 8px;font-size:11px">{time}</button>
          <button type="button" class="btn sm" data-wmvar="{device}" title="${T('设备名（主机名）', 'Device name (hostname)')}" style="padding:1px 8px;font-size:11px">{device}</button>
          <button type="button" class="btn sm" data-wmvar="{loginAt}" title="${T('登录时间', 'Sign-in time')}" style="padding:1px 8px;font-size:11px">{loginAt}</button>
          <button type="button" class="btn sm" data-wmvar="{gateway}" title="${T('网关地址', 'Gateway URL')}" style="padding:1px 8px;font-size:11px">{gateway}</button>
        </span>
      </div>
      <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end">
        <label style="font-size:12px;color:var(--txt)">${T('颜色', 'Color')}<br><input id="wmColor" type="color" class="input" style="width:52px;height:28px;padding:1px;margin-top:3px;cursor:pointer"></label>
        <label style="font-size:12px;color:var(--txt)">${T('透明度', 'Opacity')} <span id="wmOpacityVal" class="mono">0.06</span><br>
          <input id="wmOpacity" type="range" min="0.01" max="0.5" step="0.01" style="width:120px;margin-top:8px;cursor:pointer"></label>
        <label style="font-size:12px;color:var(--txt)">${T('字号', 'Font size')}<br><input id="wmFontSize" class="input" type="number" min="8" max="40" style="width:64px;font-size:12px;margin-top:3px"></label>
        <label style="font-size:12px;color:var(--txt)">${T('横向间距', 'H spacing')}<br><input id="wmGapX" class="input" type="number" min="80" max="800" step="10" style="width:76px;font-size:12px;margin-top:3px"></label>
        <label style="font-size:12px;color:var(--txt)">${T('纵向间距', 'V spacing')}<br><input id="wmGapY" class="input" type="number" min="50" max="600" step="10" style="width:76px;font-size:12px;margin-top:3px"></label>
        <label style="font-size:12px;color:var(--txt)">${T('角度°', 'Angle°')}<br><input id="wmAngle" class="input" type="number" min="-90" max="90" step="2" style="width:64px;font-size:12px;margin-top:3px"></label>
        <button class="btn sm" id="wmReset" type="button" style="margin-bottom:1px">${T('恢复默认', 'Reset')}</button>
      </div>
    </div>
  </div>

  <!-- ============ 登录保护 ============ -->
  <div class="card">
    <h2><span class="bar"></span>${T('登录保护', 'Sign-in protection')} <span class="badge dim">${T('防爆破', 'Anti brute-force')}</span></h2>
      <div class="switchrow">
      <span class="lab2">${T('启用失败锁定', 'Enable lockout')}<span class="desc">${T('窗口内失败达阈值即临时锁定，到点自动解除', 'Temporarily lock accounts that hit the failure threshold; auto-unlock later')}</span></span>
      <span class="switch" id="swLoginProt"></span>
    </div>
    <div class="fgrid" style="margin-top:10px">
      <label>${T('失败阈值（次）', 'Failure threshold')}</label><input class="input" id="lpMaxFails" type="number" min="1" max="1440">
      <label>${T('统计窗口（分钟）', 'Window (min)')}</label><input class="input" id="lpWindow" type="number" min="1" max="1440">
      <label>${T('锁定时长（分钟）', 'Lock duration (min)')}</label><input class="input" id="lpLock" type="number" min="1" max="1440">
    </div>
    <div class="hint">${T('当前配置：', 'Current: ')}<b id="lpExample">10</b>${T(' 次失败 / ', ' fails / ')}<b class="lpWin">15</b>${T(' 分钟窗口 → 锁定 ', ' min window → lock ')}<b class="lpLock">15</b>${T(' 分钟', ' min')}</div>
    <details class="help">
      <summary>${T('锁定机制说明', 'How lockout works')}</summary>
      <div class="help-body">
        <ol class="steps">
          <li>${T('某账号登录失败 → 失败次数计入「统计窗口」内的滑动计数，成功登录会清零该账号计数', 'Failed sign-ins count toward a sliding window; a successful sign-in resets the count')}</li>
          <li>${T('窗口内累计失败 ≥ ', 'Failures in the window reach ')}<b>${T('失败阈值', 'the threshold')}</b>${T(' → 该账号进入锁定状态', ' → the account is locked')}</li>
          <li>${T('锁定持续 ', 'The lock lasts ')}<b>${T('锁定时长', 'lock duration')}</b>${T(' 分钟，期间正确密码也会被拒绝（返回 429 too_many_attempts）', ' min; correct passwords are also rejected (429 too_many_attempts)')}</li>
          <li>${T('被锁期间的尝试', 'Retries while locked ')}<b>${T('不延长锁定时间', 'do not extend the lock')}</b>${T('——攻击者无法靠持续重试把账号永久锁死', ', so retrying cannot lock an account forever')}</li>
        </ol>
        <div class="notebox">${T('被锁的账号在「用户管理」里不会显示为禁用——锁定是登录接口层的临时状态，到点自动解除。', 'Locked accounts do not show as disabled in user management; the lock is temporary and auto-expires.')}</div>
      </div>
    </details>
  </div>

  ${savebar('lp')}`

/* ============ 子页 2 · 插件管控（页签：插件仓库 / 允许清单；插件源 = 右上角齿轮设置弹窗） ============ */
const pluginsHtml = `
  ${headrow(T('插件管控', 'Plugin Control'), `<span class="mono" id="regModeBadge" style="font-size:11px;color:var(--dim)"></span>
    <button class="btn sm" id="regSettingBtn" title="${T('插件设置', 'Plugin settings')}">⚙ ${T('插件设置', 'Plugin settings')}</button>
    <button class="btn sm primary" id="repoAddBtn">＋ ${T('添加插件', 'Add plugin')}</button>`)}

  <div class="tabs" id="plugTabs">
    <span class="on" data-panetab="pane-repo">${T('插件仓库', 'Plugin repo')}</span>
    <span data-panetab="pane-allow">${T('允许清单', 'Allowlist')}</span>
  </div>

  <!-- ============ 页签 A · 企业插件仓库 ============ -->
  <div class="pane on" id="pane-repo">
  <div class="card">
    <h2><span class="bar"></span>${T('企业插件仓库', 'Enterprise plugin repo')} <span class="badge dim" id="repoCount">${T('0 个', '0')}</span><span class="badge warn" id="repoUpdCount" style="display:none"></span>
      <span style="margin-left:auto;display:flex;gap:8px;align-items:center">
        <input id="repoSearch" class="input" placeholder="${T('搜插件名 / 描述…', 'Search plugins…')}" style="width:200px;font-size:12px;height:28px">
        <button class="btn sm" id="repoCheckBtn" title="${T('从 npm 源检查各插件最新版本', 'Check npm registries for newer versions')}">⟳ ${T('检查更新', 'Check updates')}</button>
      </span>
    </h2>
    <div class="tablewrap">
      <table>
        <thead><tr><th>${T('插件', 'Plugin')}</th></tr></thead>
        <tbody id="repoBody"><tr><td class="empty">${T('加载中…', 'Loading…')}</td></tr></tbody>
      </table>
    </div>
  </div>
  </div>

  <!-- ============ 页签 B · 允许清单 ============ -->
  <div class="pane" id="pane-allow">
  <div class="card">
    <h2><span class="bar"></span>${T('允许清单', 'Allowlist')} <span class="badge dim" id="allowCount">0</span>
      <span style="margin-left:auto;display:flex;gap:8px">
        <input id="allowSearch" class="input" placeholder="${T('搜插件名 / 描述…', 'Search plugins…')}" style="width:180px;font-size:12px;height:28px">
      </span>
    </h2>
    <div class="sub">${T('清单外插件用户端安装被拦截 · 改动自动下发', 'Plugins outside the allowlist are blocked on client · changes deploy automatically')}</div>
    <div id="allowList"></div>
    <div id="allowPage" style="display:flex;align-items:center;gap:10px;justify-content:flex-end;margin-top:10px;font-size:12px;color:var(--dim)"></div>
    <div style="display:flex;gap:8px;margin-top:8px">
      <input class="input" id="allowInput" placeholder="${T('插件包名，如 dsh-review · @corp/dsh-review', 'Package name, e.g. dsh-review · @corp/dsh-review')}" style="flex:1;font-size:12px;height:30px">
      <button class="btn sm" id="allowAddBtn">＋ ${T('添加', 'Add')}</button>
    </div>
    <div class="err" id="allowErr" style="margin-top:6px"></div>
  </div>

  <!-- 自动保存状态（无保存按钮：所有改动即时下发） -->
  <div style="margin-top:10px;font-size:12px;color:var(--dim);min-height:16px" id="plugAutoMsg"></div>
  </div>

  <!-- 插件设置弹窗 -->
  <div class="dlg-mask" id="regSettingDlg" hidden>
    <div class="dlg md">
      <div class="dlg-head">
        <h2><span class="bar"></span>${T('插件设置', 'Plugin settings')}</h2>
        <button class="dlg-x" data-dlg-close title="${T('关闭', 'Close')}">✕</button>
      </div>
      <div class="dlg-body">
        <div class="fgrid" style="grid-template-columns:96px minmax(0,1fr)">
          <label>${T('企业插件源', 'Enterprise source')}</label>
          <select id="regMode" class="input" style="width:100%">
            <option value="off">${T('默认社区源（不干预）', 'Default community source (no intervention)')}</option>
            <option value="proxy">${T('企业 npm 镜像', 'Corporate npm mirror')}</option>
            <option value="url">${T('企业直连地址', 'Corporate direct URL')}</option>
          </select>
          <label>${T('清单外处置', 'Off-allowlist action')}</label>
          <select id="regEnforce" class="input" style="width:100%">
            <option value="enforce">${T('严格 · 自动卸载并提示重启', 'Strict · uninstall and prompt restart')}</option>
            <option value="warn">${T('警告 · 仅提示不处理', 'Warn · prompt only')}</option>
            <option value="off">${T('宽松 · 不限制仅记录', 'Loose · log only')}</option>
          </select>
          <label>${T('回退公共源', 'Fallback to public source')}</label>
          <span class="chk"><input type="checkbox" id="regFallback"> ${T('企业源失败时回退社区源', 'Fall back to community source when corporate source fails')}</span>
          <label>${T('NPM 镜像地址', 'NPM mirror URL')}<span class="dim2">proxy</span></label>
          <input class="input" id="regUrl" placeholder="http://npm.corp.local:4873">
          <label>${T('包地址前缀', 'Package URL prefix')}<span class="dim2">url</span></label>
          <input class="input" id="regPrefix" placeholder="http://plugins.corp.local/packages/">
          <label>${T('用户端接入地址', 'Client access URL')}</label>
          <input class="input" id="regAccess" placeholder="http://10.0.0.5:8900">
          <label>${T('内置仓库直连', 'Use built-in repo')}<span class="dim2">url</span></label>
          <span class="chk"><input type="checkbox" id="regBuiltin"> ${T('直接用上方插件仓库下载', 'Download directly from the plugin repo above')}</span>
        </div>
        <div class="hint" id="regHint" style="margin-top:8px"></div>
        <div class="notebox" id="regAutoNote" style="margin-top:10px"></div>
      </div>
      <div class="dlg-foot">
        <span class="err" id="regErr"></span>
        <button class="btn" data-dlg-close>${T('关闭', 'Close')}</button>
      </div>
    </div>
  </div>

  <!-- 添加插件弹窗（npm 地址 / 压缩包上传 二选一） -->
  <div class="dlg-mask" id="repoAddDlg" hidden>
    <div class="dlg md">
      <div class="dlg-head">
        <h2><span class="bar"></span>${T('添加插件', 'Add plugin')}</h2>
        <button class="dlg-x" data-dlg-close title="${T('关闭', 'Close')}">✕</button>
      </div>
      <div class="dlg-body">
        <div style="display:flex;gap:8px;margin-bottom:14px">
          <button type="button" class="btn" id="repoSrcNpm" style="flex:1">${T('从 npm 地址拉取', 'Pull from npm URL')}</button>
          <button type="button" class="btn" id="repoSrcUp" style="flex:1">${T('上传压缩包', 'Upload archive')}</button>
        </div>
        <div id="repoNpmGroup">
          <label style="font-size:12.5px;color:var(--txt);display:block">${T('包名或 .tgz 地址', 'Package name or .tgz URL')}
            <input id="repoSpec" class="input" placeholder="dsh-review · @corp/dsh-review@1.2.0 · https://…/x.tgz" style="width:100%;margin-top:4px">
          </label>
          <label style="font-size:12.5px;color:var(--txt);display:block;margin-top:10px">${T('npm 源（可选，默认用镜像地址 / 官方源）', 'npm registry (optional; defaults to mirror / official)')}
            <input id="repoRegistry" class="input" placeholder="http://npm.corp.local:4873" style="width:100%;margin-top:4px">
          </label>
        </div>
        <div id="repoUpGroup" style="display:none">
          <label style="font-size:12.5px;color:var(--txt);display:block">${T('压缩包（.tgz，内含 package.json）', 'Archive (.tgz containing package.json)')}
            <input id="repoFile" type="file" accept=".tgz,.gz,.tar" class="input" style="width:100%;margin-top:4px;padding:6px">
          </label>
        </div>
        <label style="font-size:12.5px;color:var(--txt);display:block;margin-top:10px">${T('版本说明（可选）', 'Version note (optional)')}
          <input id="repoNote" class="input" placeholder="${T('例：首版上架 / 升级到 x.y 修复 xx', 'e.g. initial release / upgrade to x.y fixes xx')}" style="width:100%;margin-top:4px">
        </label>
        <div class="notebox" id="repoAddResult" style="display:none;margin-top:12px"></div>
      </div>
      <div class="dlg-foot">
        <span class="err" id="repoAddErr"></span>
        <button class="btn" data-dlg-close>${T('取消', 'Cancel')}</button>
        <button class="btn primary" id="repoAddOk">${T('添加', 'Add')}</button>
      </div>
    </div>
  </div>

  <!-- 版本管理弹窗 -->
  <div class="dlg-mask" id="repoVerDlg" hidden>
    <div class="dlg md">
      <div class="dlg-head">
        <h2><span class="bar"></span>${T('版本管理', 'Versions')} · <span class="mono" id="rvName">—</span></h2>
        <button class="dlg-x" data-dlg-close title="${T('关闭', 'Close')}">✕</button>
      </div>
      <div class="dlg-body">
        <div style="display:flex;gap:8px;align-items:center;margin-bottom:12px">
          <span style="font-size:12.5px;color:var(--txt);flex-shrink:0">${T('描述', 'Description')}</span>
          <span id="rvDesc" style="font-size:12.5px;color:var(--txt);flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap"></span>
          <button class="btn sm" id="rvDescEdit">${T('编辑', 'Edit')}</button>
        </div>
        <div class="tablewrap" style="max-height:380px;overflow:auto">
          <table>
            <thead><tr><th>${T('版本', 'Version')}</th><th>${T('大小', 'Size')}</th><th>${T('上传人 / 时间', 'By / time')}</th><th>${T('说明', 'Note')}</th><th style="width:120px">${T('操作', 'Actions')}</th></tr></thead>
            <tbody id="rvBody"></tbody>
          </table>
        </div>
      </div>
      <div class="dlg-foot">
        <span class="err" id="rvErr"></span>
        <button class="btn" data-dlg-close>${T('关闭', 'Close')}</button>
      </div>
    </div>
  </div>

  <!-- 描述编辑弹窗 -->
  <div class="dlg-mask" id="repoDescDlg" hidden>
    <div class="dlg" style="width:520px">
      <div class="dlg-head">
        <h2><span class="bar"></span>${T('插件描述', 'Plugin description')} · <span class="mono" id="rdName">—</span></h2>
        <button class="dlg-x" data-dlg-close title="${T('关闭', 'Close')}">✕</button>
      </div>
      <div class="dlg-body">
        <div style="font-size:12px;color:var(--dim);margin-bottom:4px">${T('中文描述', 'Chinese description')}</div>
        <textarea id="rdText" class="input" rows="3" style="width:100%;resize:vertical" placeholder="${T('一句话说明该插件用途，用户端插件市场可见', 'One-line description shown in the client plugin market')}"></textarea>
        <div style="font-size:12px;color:var(--dim);margin:8px 0 4px">${T('英文描述', 'English description')}</div>
        <textarea id="rdTextEn" class="input" rows="3" style="width:100%;resize:vertical" placeholder="${T('English description for the client plugin market', 'English description for the client plugin market')}"></textarea>
      </div>
      <div class="dlg-foot">
        <span class="err" id="rdErr"></span>
        <button class="btn" data-dlg-close>${T('取消', 'Cancel')}</button>
        <button class="btn primary" id="rdOk">${T('保存', 'Save')}</button>
      </div>
    </div>
  </div>
`

/* ============ 子页 3 · 本地规则 ============ */
const rulesHtml = `
  ${headrow(T('本地规则', 'Local Rules'), `
    <button class="btn sm" id="bannerStyleBtn" type="button" title="${T('横幅弹出样式（位置/宽度/边距）', 'Banner style (position/width/margins)')}">⚙ ${T('横幅样式', 'Banner style')}</button>
    <span class="crumb" style="margin:0">${T('当前：', 'Current: ')}<span id="bannerPosLabel">—</span></span>`)}

  <div class="card">
    <h2><span class="bar"></span>${T('本地规则', 'Local Rules')} <span class="badge dim" id="ruleCount">${T('0 条', '0')}</span>
      <span style="margin-left:auto;display:flex;gap:6px;align-items:center">
        <input id="ruleFilter" class="input" placeholder="${T('搜关键词 / 域名 / 提示语…', 'Search keyword / domain / message…')}" style="width:190px;font-size:12px;height:28px">
        <select id="ruleTypeFilter" class="input" style="width:auto;font-size:12px;height:28px">
          <option value="">${T('全部类型', 'All types')}</option>
          <option value="block-url">${T('网址', 'URL')}</option>
          <option value="block-word">${T('关键词', 'Keyword')}</option>
          <option value="notice">${T('公告', 'Notice')}</option>
        </select>
        <button class="btn sm primary" id="ruleAddBtn">＋ ${T('新增规则', 'Add rule')}</button>
      </span>
    </h2>
    <div class="tablewrap">
      <table>
        <thead><tr><th style="width:44px">#</th><th style="width:88px">${T('类型', 'Type')}</th><th style="width:68px">${T('动作', 'Action')}</th><th>${T('匹配值', 'Match value')}</th><th>${T('提示语', 'Message')}</th><th style="width:104px">${T('操作', 'Actions')}</th></tr></thead>
        <tbody id="rulesList"></tbody>
      </table>
    </div>
    <div style="margin-top:8px"><span class="crumb" style="margin:0">${T('规则自上而下逐条匹配；点行任意处打开编辑弹窗', 'Rules match top-down; click a row to edit')}</span></div>
    <details class="help">
      <summary>${T('三种类型的 value 填法', 'Value formats for the three types')}</summary>
      <div class="help-body">
        <div class="codeblock"><span class="hl">${T('网址', 'URL')}</span>  ${T('填域名 → 拦该域名及全部子域。例：', 'Domain → blocks it and all subdomains. e.g. ')}<span class="hl">github.com</span> github.com / gist.github.com / api.github.com …
<span class="hl">${T('关键词', 'Keyword')}</span> ${T('填正则，命中用户端送出的文本；非法时退化为包含匹配', 'Regex matched against client-submitted text; falls back to contains match if invalid')}
<span class="hl">${T('公告', 'Notice')}</span>     ${T('填公告文本 → 用户端展示企业公告，value 即公告内容，message 可留空', 'Notice text; value is the notice content shown on client, message optional')}</div>
        <div class="notebox">${T('仅管控用户端浏览器环境内的访问；规则与命中次数在用户端「企业管理 → 规则管理」可见（只读）', 'Only applies inside the client browser; rules and hit counts are read-only in client "Enterprise → Rule management"')}</div>
      </div>
    </details>
  </div>

  <!-- 横幅样式弹窗（从页面本体挪进对话框：主界面只留规则卡片，层级干净） -->
  <div class="dlg-mask" id="bannerStyleDlg" hidden>
    <div class="dlg md">
      <div class="dlg-head">
        <h2><span class="bar"></span>${T('横幅样式', 'Banner style')} <span class="badge dim">${T('用户端提醒/拦截/公告弹出的默认样式', 'Default style for client warn/block/notice banners')}</span></h2>
        <button class="dlg-x" data-dlg-close title="${T('关闭', 'Close')}">✕</button>
      </div>
      <div class="dlg-body">
        <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:12px">
          <span style="font-size:12.5px;color:var(--txt);width:52px">${T('位置', 'Position')}</span>
          <select id="bannerPos" class="input" style="width:140px;font-size:12.5px">
            <option value="top-right">${T('右上角', 'Top right')}</option>
            <option value="top-center">${T('顶部居中', 'Top center')}</option>
            <option value="top-left">${T('左上角', 'Top left')}</option>
            <option value="bottom-right">${T('右下角', 'Bottom right')}</option>
          </select>
          <span style="font-size:12.5px;color:var(--txt);width:52px;margin-left:10px">${T('宽度', 'Width')}</span>
          <input id="bannerW" class="input" type="number" min="240" max="1200" step="10" style="width:90px;font-size:12.5px" placeholder="420">
          <span style="font-size:11.5px;color:var(--dim)">${T('px（240-1200）', 'px (240-1200)')}</span>
        </div>
        <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:12px">
          <span style="font-size:12.5px;color:var(--txt);width:52px">${T('边距', 'Margin')}</span>
          <span style="font-size:11.5px;color:var(--dim)">${T('上', 'Top')}</span>
          <input id="bannerMt" class="input" type="number" min="0" max="400" step="2" style="width:70px;font-size:12.5px" placeholder="14">
          <span style="font-size:11.5px;color:var(--dim)">${T('右', 'Right')}</span>
          <input id="bannerMr" class="input" type="number" min="0" max="400" step="2" style="width:70px;font-size:12.5px" placeholder="18">
          <span style="font-size:11.5px;color:var(--dim)">${T('下', 'Bottom')}</span>
          <input id="bannerMb" class="input" type="number" min="0" max="400" step="2" style="width:70px;font-size:12.5px" placeholder="0">
          <span style="font-size:11.5px;color:var(--dim)">${T('左', 'Left')}</span>
          <input id="bannerMl" class="input" type="number" min="0" max="400" step="2" style="width:70px;font-size:12.5px" placeholder="0">
          <span style="font-size:11.5px;color:var(--dim)">${T('px（0-400，距屏幕边缘）', 'px (0-400, from screen edge)')}</span>
        </div>
        <div style="font-size:11.5px;color:var(--dim);margin-bottom:12px">${T('配色固定：拦截红 / 提醒橙 / 公告蓝（语义区分，不随样式配置）', 'Fixed colors: block red / warn orange / notice blue (semantic, not configurable)')}</div>
        <div style="background:var(--bg);border:1px dashed var(--line);border-radius:8px;padding:18px 14px;position:relative;min-height:110px;overflow:hidden">
          <div style="font-size:11px;color:var(--dim);margin-bottom:8px">${T('效果示意（实际以用户端屏幕为准）：', 'Preview (actual look on client screens):')}</div>
          <div id="bannerMock" style="max-width:420px;padding:11px 40px 11px 16px;border-radius:10px;background:#fff7ed;border:1.5px solid #fb923c;box-shadow:0 6px 18px rgba(0,0,0,.10);font-size:12.5px;color:#9a3412;display:flex;align-items:center;gap:8px">
            <span style="font-size:14px;flex-shrink:0">⚠️</span>
            <span>${T('检测到涉密关键词', 'Sensitive keyword detected')} <b>${T('示例', 'example')}</b>${T('，请注意外发风险', ' — mind the outbound risk')}</span>
          </div>
        </div>
        <div id="bannerMsg" style="font-size:12px;color:var(--ok);margin-top:10px"></div>
      </div>
      <div class="dlg-foot">
        <span class="err" id="bannerDlgErr"></span>
        <button class="btn sm" id="bannerPreview" type="button">${T('预览效果', 'Preview')}</button>
        <button class="btn primary" id="bannerSaveBtn" type="button">${T('保存样式', 'Save style')}</button>
      </div>
    </div>
  </div>

  <!-- 规则编辑弹窗（新增/编辑共用） -->
  <div class="dlg-mask" id="ruleEditDlg" hidden>
    <div class="dlg md">
      <div class="dlg-head">
        <h2><span class="bar"></span><span id="ruleEditTitle">${T('新增规则', 'Add rule')}</span></h2>
        <button class="dlg-x" data-dlg-close title="${T('关闭', 'Close')}">✕</button>
      </div>
      <div class="dlg-body">
        <div style="display:flex;gap:10px;margin-bottom:12px">
          <label style="font-size:12.5px;color:var(--txt)">${T('类型', 'Type')}
            <select id="reType" class="input" style="display:block;margin-top:4px;width:130px;font-size:12.5px">
              <option value="block-url">${T('网址', 'URL')}</option>
              <option value="block-word">${T('关键词', 'Keyword')}</option>
              <option value="notice">${T('公告', 'Notice')}</option>
            </select>
          </label>
          <label style="font-size:12.5px;color:var(--txt)">${T('动作', 'Action')}
            <select id="reAction" class="input" style="display:block;margin-top:4px;width:110px;font-size:12.5px">
              <option value="block">${T('拦截', 'Block')}</option>
              <option value="warn">${T('提醒', 'Warn')}</option>
            </select>
          </label>
          <span class="crumb" style="margin:0;align-self:end;padding-bottom:6px" id="reHint"></span>
        </div>
        <label style="font-size:12.5px;color:var(--txt);display:block">${T('匹配值（value）', 'Match value')}
          <textarea id="reValue" class="input mono" rows="3" placeholder="${T('域名 / 正则 / 公告全文', 'Domain / regex / notice text')}"
            style="width:100%;margin-top:4px;font-size:12.5px;line-height:1.55;font-family:ui-monospace,monospace;resize:vertical"></textarea>
        </label>
        <label id="reMsgWrap" style="font-size:12.5px;color:var(--txt);display:block;margin-top:12px">${T('提示语（可选；含 [] 占位符时自动填入触发词）', 'Message (optional; [] is replaced with the trigger word)')}
          <textarea id="reMsg" rows="2" class="input"
            style="width:100%;margin-top:4px;font-size:12.5px;line-height:1.55;resize:vertical"></textarea>
        </label>
        <div class="notebox" id="rePreview" style="margin-top:14px;display:none"></div>
      </div>
      <div class="dlg-foot">
        <span class="err" id="ruleEditErr"></span>
        <button class="btn" data-dlg-close>${T('取消', 'Cancel')}</button>
        <button class="btn primary" id="ruleEditOk">${T('确定', 'OK')}</button>
      </div>
    </div>
  </div>

`

/* ============ 子页 4 · 下发回执 ============ */
const acksHtml = `
  ${headrow(T('下发回执', 'Deploy Receipts'), `
    <span class="crumb" style="margin:0">${T('当前策略版本', 'Current policy version')} <span class="mono" id="ackCurVer">—</span></span>
    <button class="btn sm" id="ackRefreshBtn">↻ ${T('刷新', 'Refresh')}</button>
  `)}

  <!-- ============ 版本发布与灰度 ============ -->
  <div class="card">
    <h2><span class="bar"></span>${T('版本发布与灰度', 'Versioning & gray release')} <span class="badge dim">${T('策略每次保存自动产生新版本', 'Each policy save creates a new version')}</span></h2>
    <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:12px">
      <span style="font-size:12.5px;color:var(--txt)">${T('当前版本', 'Current')} <b class="mono" id="verCur">—</b></span>
      <span style="font-size:12.5px;color:var(--txt)">${T('灰度状态', 'Gray release')} <b id="verGrayState" class="mono" style="color:var(--warn)">${T('无灰度（全员 current）', 'No gray release (all on current)')}</b></span>
      <span style="flex:1"></span>
      <label style="font-size:12px;color:var(--txt);display:flex;gap:8px;align-items:center">${T('灰度比例', 'Gray percent')}
        <input id="verPercent" class="input" type="number" min="0" max="100" step="5" style="width:72px;font-size:12px">
        <span class="crumb" style="margin:0">%</span>
      </label>
      <button class="btn sm" id="verGrayBtn" disabled>${T('开始灰度', 'Start gray')}</button>
      <button class="btn sm" id="verPromoteBtn">${T('转正（全员生效）', 'Promote (all users)')}</button>
      <button class="btn sm" id="verCancelGrayBtn">${T('取消灰度', 'Cancel gray')}</button>
    </div>
    <div class="tablewrap" style="max-height:340px;overflow:auto">
      <table>
        <thead><tr><th>${T('版本', 'Version')}</th><th>${T('时间', 'Time')}</th><th>${T('说明', 'Note')}</th><th>${T('变更内容', 'Changes')}</th><th style="width:150px">${T('操作', 'Actions')}</th></tr></thead>
        <tbody id="verBody"><tr><td colspan="5" class="empty">${T('加载中…', 'Loading…')}</td></tr></tbody>
      </table>
    </div>
    <div class="notebox" style="margin-top:10px">${T('按设备指纹比例分流灰度版本；同一设备恒定同侧。转正 = 全员生效；回滚 = 恢复历史版本内容', 'Gray versions split by device fingerprint; a device always stays on the same side. Promote = all users; rollback = restore a historical version')}</div>
  </div>

  <!-- ============ 灰度进度 ============ -->
  <div class="card">
    <h2><span class="bar"></span>${T('灰度进度', 'Gray progress')} <span class="badge dim" id="ackSummaryBadge"></span></h2>
    <div class="sub">${T('覆盖率 = 已回执 ÷ 近 24h 在线设备', 'Coverage = receipts ÷ devices online in 24h')}</div>
    <div class="grid4" id="ackStatCards"></div>
    <div id="ackVersionBars" style="margin-top:14px"></div>
  </div>

  <!-- ============ 待回执设备 ============ -->
  <div class="card">
    <h2><span class="bar"></span>${T('待回执设备', 'Pending devices')} <span class="badge" id="ackPendingCount"></span></h2>
    <div class="sub">${T('近 24h 在线但未回执当前版本的设备', 'Devices online in 24h that have not receipted the current version')}</div>
    <div class="tablewrap" style="max-height:300px;overflow:auto">
      <table>
        <thead><tr><th>${T('账号', 'Account')}</th><th>Profile</th><th>${T('心跳上报版本', 'Heartbeat version')}</th><th>${T('判定', 'Status')}</th><th>${T('环境', 'Env')}</th><th>Node</th><th>${T('最后心跳', 'Last heartbeat')}</th><th>${T('设备指纹', 'Device fingerprint')}</th></tr></thead>
        <tbody id="ackPendingBody"><tr><td colspan="8" class="empty">${T('加载中…', 'Loading…')}</td></tr></tbody>
      </table>
    </div>
  </div>

  <!-- ============ 回执明细 ============ -->
  <div class="card">
    <h2><span class="bar"></span>${T('回执明细', 'Receipt detail')} <span class="badge dim" id="ackCount"></span></h2>
    <div style="display:flex;gap:8px;margin:8px 0 10px;flex-wrap:wrap;align-items:center">
      <select class="input" id="ackVerFilter" style="width:auto"></select>
      <input class="input" id="ackSearch" placeholder="${T('搜账号 / Profile / 指纹…', 'Search account / profile / hash…')}" style="width:230px">
      <span class="crumb" style="margin:0">${T('每 30 秒自动刷新', 'Auto-refresh every 30s')}</span>
    </div>
    <div class="tablewrap" style="max-height:420px;overflow:auto">
      <table>
        <thead><tr><th>${T('回执时间', 'Receipt time')}</th><th>${T('账号', 'Account')}</th><th>Profile</th><th>${T('策略版本', 'Policy version')}</th><th>${T('环境', 'Env')}</th><th>Node</th><th>${T('设备指纹', 'Device fingerprint')}</th><th>${T('该设备最后心跳', 'Last heartbeat')}</th></tr></thead>
        <tbody id="ackBody"><tr><td colspan="8" class="empty">${T('加载中…', 'Loading…')}</td></tr></tbody>
      </table>
    </div>
  </div>`

/* ---------- 策略加载（一次拉取，四个子页共用；只填本页存在的元素） ---------- */
function collectClientRules() {
  return rulesData.map((r, i) => ({ id: 'cr-' + (i + 1), type: r.type, action: r.type === 'notice' ? 'block' : r.action, value: String(r.value ?? '').trim(), message: String(r.message ?? '').trim() }))
}

async function loadAll(opts = {}) {
  const { skipRulesTable = false } = opts
  try {
    const d = await api('/admin/policy-detail')
    const p = d.policy ?? {}
    if ($('polVer')) $('polVer').textContent = p.version ?? '-'
    if ($('swLock')) $('swLock').classList.toggle('on', !!p.lockModelConfig)
    if ($('hidePagesInput')) $('hidePagesInput').value = (p.hiddenSettingsPages ?? []).join(', ')
    if ($('swWm')) $('swWm').classList.toggle('on', !!p.watermark)
    if ($('wmStylePanel')) {
      $('wmStylePanel').style.display = p.watermark ? '' : 'none'
      bindWmStyle()
      bindHidePages()
      wmEcho(p.watermarkStyle ?? {})
    }
    if ($('lpMaxFails')) {
      const lp = d.loginProtection ?? {}
      $('swLoginProt').classList.toggle('on', lp.enabled !== false)
      $('lpMaxFails').value = lp.maxFails ?? 10
      $('lpWindow').value = lp.windowMin ?? 15
      $('lpLock').value = lp.lockMin ?? 15
      syncLpExample(lp)
    }
    if ($('allowList')) { allowItems = (p.allowedPlugins ?? []).slice(); renderAllowList() }
    if ($('repoBody')) renderRepo()   // 允许清单加载后同步刷新仓库行内"已入清单"状态
    if ($('repoBody') || $('allowList')) await loadRepo()   // 仓库数据 = 清单描述/版本的数据源；loadRepo 内部会同步重渲染清单
    if ($('regMode')) {
      const reg = p.pluginRegistry ?? {}
      $('regMode').value = reg.mode ?? 'off'
      $('regFallback').checked = reg.allowedFallback !== false
      $('regUrl').value = reg.npmRegistryUrl ?? ''
      $('regPrefix').value = reg.packagePrefix ?? ''
      $('regBuiltin').checked = /\/plugin-packages\/?$/.test(reg.packagePrefix ?? '')
      if ($('regEnforce')) $('regEnforce').value = p.pluginEnforce ?? 'enforce'
      if ($('regAccess')) $('regAccess').value = p.clientAccessUrl ?? ''
      syncRegFields()
    }
    if ($('rulesList') && !skipRulesTable) renderClientRules(p.clientRules ?? [])
    if (!skipRulesTable) {
      if ($('bannerPos')) $('bannerPos').value = p.bannerPosition ?? 'top-right'
      const bs = p.bannerStyle ?? {}
      const setV = (id, v) => { if ($(id) && $(id).value === '') $(id).value = v ?? '' }   // 只填空值：不覆盖用户正在编辑/已填写未保存的值
      setV('bannerW', bs.maxWidth)
      setV('bannerMt', bs.top)
      setV('bannerMr', bs.right)
      setV('bannerMb', bs.bottom)
      setV('bannerMl', bs.left)
      const posLabel = { 'top-right': T('右上角', 'Top right'), 'top-center': T('顶部居中', 'Top center'), 'top-left': T('左上角', 'Top left'), 'bottom-right': T('右下角', 'Bottom right') }[p.bannerPosition] ?? p.bannerPosition
      if ($('bannerPosLabel')) $('bannerPosLabel').textContent = posLabel
      updateBannerMock()
    }
    if ($('ackBody')) renderAcks(d)
    bindVersions()
  } catch { /* 401 已处理 */ }
}

/* ---------- 登录保护（子页 1） ---------- */
function syncLpExample(over = {}) {
  if (!$('lpExample')) return
  const mf = over.maxFails ?? (Number($('lpMaxFails').value) || '?')
  const wm = over.windowMin ?? (Number($('lpWindow').value) || '?')
  const lm = over.lockMin ?? (Number($('lpLock').value) || '?')
  $('lpExample').textContent = mf
  const winEl = document.querySelector('.lpWin')
  const lockEl = document.querySelector('.lpLock')
  if (winEl) winEl.textContent = wm
  if (lockEl) lockEl.textContent = lm
}

function toggleLoginProt() { $('swLoginProt').classList.toggle('on') }

async function toggleLock() {
  const sw = $('swLock')
  const target = !sw.classList.contains('on')
  const r = await api('/admin/policy', { method: 'PATCH', body: JSON.stringify({ policy: { lockModelConfig: target } }) })
  sw.classList.toggle('on', r.policy.lockModelConfig)
  toast(T('模型配置锁定 → {s}（客户端心跳后生效）', 'Model config lock → {s} (applies after client heartbeat)', { s: r.policy.lockModelConfig ? T('锁定', 'locked') : T('放开', 'unlocked') }))
}

async function toggleWatermark() {
  const sw = $('swWm')
  const target = !sw.classList.contains('on')
  const r = await api('/admin/policy', { method: 'PATCH', body: JSON.stringify({ policy: { watermark: target } }) })
  sw.classList.toggle('on', r.policy.watermark)
  const panel = $('wmStylePanel')
  if (panel) panel.style.display = r.policy.watermark ? '' : 'none'
  toast(T('界面水印 → {s}（用户端 10s 内跟随）', 'UI watermark → {s} (client follows within 10s)', { s: r.policy.watermark ? T('启用', 'enabled') : T('停用', 'disabled') }))
}

/* ---- 隐藏设置页清单：输入即自动保存（debounce 600ms） ---- */
let _hpSaveTimer = null
function bindHidePages() {
  const inp = $('hidePagesInput')
  if (!inp || inp.dataset.bound) return
  inp.dataset.bound = '1'
  inp.addEventListener('input', () => {
    clearTimeout(_hpSaveTimer)
    _hpSaveTimer = setTimeout(async () => {
      const list = inp.value.split(/[,，、]/).map((x) => x.trim()).filter(Boolean)
      try {
        await api('/admin/policy', { method: 'PATCH', body: JSON.stringify({ policy: { hiddenSettingsPages: list } }) })
        toast(T('隐藏设置页已下发，用户端 10s 内跟随', 'Hidden pages deployed; clients follow within 10s'))
      } catch (e) { if (e.message !== '401') toast(T('保存失败：{m}', 'Save failed: {m}', { m: e.message }), 'bad') }
    }, 600)
  })
}

/* ---- 水印样式：回显 + 自动保存（debounce 600ms）+ 恢复默认 ---- */
const WM_DEFAULTS = { template: '{user} · {time}', color: 'var(--txt)', opacity: 0.06, fontSize: 13, gapX: 260, gapY: 150, angle: -22 }
let _wmSaveTimer = null
function wmReadForm() {
  const out = {}
  const t = $('wmTemplate')?.value.trim(); if (t && t !== WM_DEFAULTS.template) out.template = t
  const c = $('wmColor')?.value; if (c && c.toLowerCase() !== WM_DEFAULTS.color) out.color = c
  const o = Number($('wmOpacity')?.value); if (Number.isFinite(o) && o !== WM_DEFAULTS.opacity) out.opacity = o
  const f = Number($('wmFontSize')?.value); if (Number.isFinite(f) && f && f !== WM_DEFAULTS.fontSize) out.fontSize = f
  const gx = Number($('wmGapX')?.value); if (Number.isFinite(gx) && gx && gx !== WM_DEFAULTS.gapX) out.gapX = gx
  const gy = Number($('wmGapY')?.value); if (Number.isFinite(gy) && gy && gy !== WM_DEFAULTS.gapY) out.gapY = gy
  const a = Number($('wmAngle')?.value); if (Number.isFinite(a) && a !== WM_DEFAULTS.angle) out.angle = a
  return out
}
function scheduleWmSave() {
  $('wmOpacityVal').textContent = Number($('wmOpacity').value).toFixed(2)
  clearTimeout(_wmSaveTimer)
  _wmSaveTimer = setTimeout(async () => {
    try {
      const style = wmReadForm()
      await api('/admin/policy', { method: 'PATCH', body: JSON.stringify({ policy: { watermarkStyle: Object.keys(style).length ? style : null } }) })
      toast(T('水印样式已保存，用户端 10s 内跟随', 'Watermark style saved; client follows within 10s'))
    } catch (e) { if (e.message !== '401') toast(T('水印样式保存失败：{m}', 'Failed to save watermark style: {m}', { m: e.message }), 'bad') }
  }, 600)
}
function bindWmStyle() {
  if (!$('wmTemplate') || $('wmTemplate').dataset.bound) return
  $('wmTemplate').dataset.bound = '1'
  for (const id of ['wmTemplate', 'wmColor', 'wmOpacity', 'wmFontSize', 'wmGapX', 'wmGapY', 'wmAngle']) {
    $(id).addEventListener('input', scheduleWmSave)
    $(id).addEventListener('change', scheduleWmSave)
  }
  // 变量胶囊点选：插入模板输入框光标处
  document.querySelectorAll('[data-wmvar]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const inp = $('wmTemplate')
      if (!inp) return
      const pos = inp.selectionStart ?? inp.value.length
      inp.value = inp.value.slice(0, pos) + btn.dataset.wmvar + inp.value.slice(inp.selectionEnd ?? pos)
      inp.focus()
      inp.selectionStart = inp.selectionEnd = pos + btn.dataset.wmvar.length
      scheduleWmSave()
    })
  })
  $('wmReset').addEventListener('click', async () => {
    try {
      await api('/admin/policy', { method: 'PATCH', body: JSON.stringify({ policy: { watermarkStyle: null } }) })
      wmEcho(WM_DEFAULTS)
      toast(T('水印样式已恢复默认', 'Watermark style reset'))
    } catch (e) { if (e.message !== '401') toast(e.message, 'bad') }
  })
}
function wmEcho(style = {}) {
  const v = (id, k, dflt) => { if ($(id)) $(id).value = style[k] ?? dflt }
  v('wmTemplate', 'template', WM_DEFAULTS.template)
  v('wmColor', 'color', WM_DEFAULTS.color)
  v('wmOpacity', 'opacity', WM_DEFAULTS.opacity)
  v('wmFontSize', 'fontSize', WM_DEFAULTS.fontSize)
  v('wmGapX', 'gapX', WM_DEFAULTS.gapX)
  v('wmGapY', 'gapY', WM_DEFAULTS.gapY)
  v('wmAngle', 'angle', WM_DEFAULTS.angle)
  if ($('wmOpacityVal')) $('wmOpacityVal').textContent = Number($('wmOpacity').value).toFixed(2)
}

/* ---------- 企业插件仓库（子页 2） ---------- */
let repoData = []        // /admin/plugin-repo 返回的插件清单（含 versions）
let repoVerCur = ''      // 版本管理弹窗当前插件名
let repoDescCur = ''     // 描述弹窗当前插件名
let repoSrc = 'npm'      // 添加弹窗当前来源：npm | upload

const fmtSize = (n) => n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : n >= 1024 ? (n / 1024).toFixed(0) + ' KB' : (n ?? 0) + ' B'
const verCmpJs = (a, b) => {
  const pa = a.split('-')[0].split('.').map(Number); const pb = b.split('-')[0].split('.').map(Number)
  for (let i = 0; i < 3; i++) { if ((pa[i] || 0) !== (pb[i] || 0)) return (pb[i] || 0) - (pa[i] || 0) }
  return a < b ? 1 : a > b ? -1 : 0
}

async function loadRepo() {
  if (!$('repoBody')) return
  try {
    const d = await api('/admin/plugin-repo')
    repoData = d.plugins ?? []
    renderRepo()
    if ($('allowList')) renderAllowList()   // 允许清单显示仓库描述/版本，同步刷新
  } catch (e) { if (e.message !== '401') toast(T('插件仓库加载失败：{m}', 'Failed to load plugin repo: {m}', { m: e.message }), 'bad') }
}

function renderRepo() {
  const tbody = $('repoBody')
  if (!tbody) return
  const q = ($('repoSearch')?.value ?? '').trim().toLowerCase()
  const rows = repoData.filter((p) => !q || p.name.toLowerCase().includes(q) || String(p.description ?? '').toLowerCase().includes(q))
  if ($('repoCount')) $('repoCount').textContent = T('{n} 个', '{n}', { n: repoData.length })
  tbody.innerHTML = rows.map((p) => {
    const inAllow = allowItems.includes(p.name)
    const hasUpdate = p.npmLatest && verCmpJs(p.npmLatest, p.defaultVersion ?? '0') > 0
    return `
    <tr>
      <td colspan="7" style="padding:0;border-bottom:none">
        <div style="display:flex;align-items:center;gap:10px;padding:8px 12px;border-bottom:1px solid var(--line)">
          <div style="flex:1;min-width:0">
            <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
              <span class="mono" style="font-size:12px;font-weight:600;color:var(--txt)">${esc(p.name)}</span>
              <span class="badge dim" style="font-size:10px">${T('默认 v{v}', 'default v{v}', { v: esc(p.defaultVersion ?? '—') })}</span>
              ${hasUpdate ? `<span class="badge warn" style="font-size:10px">${T('npm 有新版 v{v}', 'npm has v{v}', { v: esc(p.npmLatest) })}</span>` : ''}
              ${!hasUpdate && p.npmError ? `<span class="badge dim" style="font-size:10px" title="${esc(p.npmError)}">${T('源检查失败', 'npm check failed')}</span>` : ''}
              <span class="badge dim" style="font-size:10px">${T('{n} 个版本 · {s}', '{n} versions · {s}', { n: p.versionCount, s: fmtSize(p.totalSize) })}</span>
              ${inAllow ? `<span class="badge ok" style="font-size:10px">${T('已入清单', 'In allowlist')}</span>` : ''}
            </div>
            <div style="font-size:11.5px;color:var(--dim);margin-top:1px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(p.description)}">${esc(p.description) || `<span style="color:var(--line)">${T('无描述 · 点「描述」补充（用户端市场显示）', 'No description · use "Description" to add (shown in client market)')}</span>`}</div>
          </div>
          <span class="mono" style="font-size:11px;color:var(--dim);flex-shrink:0">${esc(p.updatedAt ?? '')}</span>
          <span style="white-space:nowrap;flex-shrink:0">
            ${hasUpdate ? `<button class="btn sm primary" data-repo-upd="${esc(p.name)}">${T('更新到 v{v}', 'Update to v{v}', { v: esc(p.npmLatest) })}</button>` : ''}
            <button class="btn sm" data-repo-ver="${esc(p.name)}">${T('版本', 'Versions')}</button>
            <button class="btn sm" data-repo-allow="${esc(p.name)}" ${inAllow ? `disabled title="${T('已在允许清单', 'Already in allowlist')}"` : `title="${T('加入允许清单', 'Add to allowlist')}"`}>${T('＋清单', '＋Allow')}</button>
            <button class="btn sm" data-repo-desc="${esc(p.name)}">${T('描述', 'Description')}</button>
            <button class="btn sm danger" data-repo-del="${esc(p.name)}">${T('删', 'Delete')}</button>
          </span>
        </div>
      </td>
    </tr>`
  }).join('') || `<tr><td colspan="7" class="empty">${T('仓库为空 —— 点右上「＋ 添加插件」，输入 npm 地址或上传 .tgz', 'Repo is empty — use "Add plugin" above to add an npm URL or upload a .tgz')}</td></tr>`
  // 顶部汇总角标：可更新插件数
  const updCount = repoData.filter((p) => p.npmLatest && verCmpJs(p.npmLatest, p.defaultVersion ?? '0') > 0).length
  if ($('repoUpdCount')) {
    $('repoUpdCount').style.display = updCount ? '' : 'none'
    if (updCount) $('repoUpdCount').textContent = T('{n} 个可更新', '{n} updates', { n: updCount })
  }
}

/* ---- 添加插件弹窗 ---- */
function setRepoSrc(src) {
  repoSrc = src
  $('repoSrcNpm')?.classList.toggle('primary', src === 'npm')
  $('repoSrcUp')?.classList.toggle('primary', src === 'upload')
  if ($('repoNpmGroup')) $('repoNpmGroup').style.display = src === 'npm' ? '' : 'none'
  if ($('repoUpGroup')) $('repoUpGroup').style.display = src === 'upload' ? '' : 'none'
  if ($('repoAddErr')) $('repoAddErr').textContent = ''
}

function openRepoAdd() {
  $('repoSpec').value = ''; $('repoRegistry').value = ''; $('repoFile').value = ''; $('repoNote').value = ''
  $('repoAddResult').style.display = 'none'
  setRepoSrc('npm')
  openDlg($('repoAddDlg'))
  $('repoSpec').focus()
}

async function submitRepoAdd() {
  const err = $('repoAddErr')
  err.textContent = ''
  const note = $('repoNote').value.trim()
  const ok = $('repoAddOk')
  try {
    ok.disabled = true; ok.textContent = T('添加中…', 'Adding…')
    let r
    if (repoSrc === 'npm') {
      if (!$('repoSpec').value.trim()) { err.textContent = T('请填写包名或 .tgz 地址', 'Enter a package name or .tgz URL'); return }
      r = await api('/admin/plugin-repo/npm', { method: 'POST', body: JSON.stringify({ spec: $('repoSpec').value.trim(), registry: $('repoRegistry').value.trim(), note }) })
    } else {
      const f = $('repoFile').files[0]
      if (!f) { err.textContent = T('请选择 .tgz 压缩包', 'Select a .tgz archive'); return }
      r = await api('/admin/plugin-repo/upload?note=' + encodeURIComponent(note), {
        method: 'POST', body: await f.arrayBuffer(),
        headers: { 'content-type': 'application/octet-stream' },
      })
    }
    $('repoAddResult').style.display = ''
    $('repoAddResult').innerHTML = `✓ ${T('已入库', 'Added to repo')} <b class="mono">${esc(r.name)}@${esc(r.version)}</b>${T('，可点行内「＋清单」加入允许清单', '; use "＋ Allow" in the row to add to the allowlist')}`
    toast(T('插件已入库：{spec}', 'Plugin added to repo: {spec}', { spec: `${r.name}@${r.version}` }))
    loadRepo()
  } catch (e) { if (e.message !== '401') err.textContent = e.message } finally { ok.disabled = false; ok.textContent = T('添加', 'Add') }
}

/* ---- npm 更新检查 / 一键更新 ---- */
async function repoCheckUpdates(btn) {
  const old = btn.textContent
  btn.disabled = true; btn.textContent = T('检查中…', 'Checking…')
  try {
    const d = await api('/admin/plugin-repo/check-updates', { method: 'POST' })
    repoData = d.plugins ?? []
    renderRepo()
    if (d.updates?.length) toast(T('发现 {n} 个可更新插件：{names}', '{n} plugins have updates: {names}', { n: d.updates.length, names: d.updates.map((x) => x.name).join(', ') }))
    else if (d.errors?.length) toast(T('检查完成：全部最新（{n} 个 npm 源不可达）', 'Done: all up to date ({n} registry unreachable)', { n: d.errors.length }))
    else toast(T('检查完成：全部最新', 'Done: all up to date'))
  } catch (e) { if (e.message !== '401') toast(e.message, 'bad') } finally { btn.disabled = false; btn.textContent = old }
}

async function repoUpdateLatest(name, btn) {
  const p = repoData.find((x) => x.name === name)
  const old = btn.textContent
  btn.disabled = true; btn.textContent = T('更新中…', 'Updating…')
  try {
    const r = await api('/admin/plugin-repo/npm', { method: 'POST', body: JSON.stringify({ spec: name, registry: p?.registry ?? '', note: 'update-to-latest' }) })
    toast(T('已更新：{spec}', 'Updated: {spec}', { spec: `${r.name}@${r.version}` }))
    loadRepo()
  } catch (e) { if (e.message !== '401') toast(e.message, 'bad'); btn.disabled = false; btn.textContent = old }
}

/* ---- 版本管理弹窗 ---- */
function openRepoVer(name) {
  repoVerCur = name
  fillRepoVerDlg()
  openDlg($('repoVerDlg'))
}

function fillRepoVerDlg() {
  const p = repoData.find((x) => x.name === repoVerCur)
  if (!p) { closeDlg($('repoVerDlg')); loadRepo(); return }   // 插件已被删空
  $('rvName').textContent = p.name
  $('rvDesc').textContent = p.description || T('（未填）', '(not set)')
  $('rvBody').innerHTML = Object.entries(p.versions ?? {}).sort((a, b) => verCmpJs(a[0], b[0])).map(([v, meta]) => `
    <tr>
      <td style="white-space:nowrap"><span class="mono" style="font-size:12px">${esc(v)}</span>${v === p.defaultVersion ? ` <span class="badge ok">${T('默认', 'Default')}</span>` : ''}</td>
      <td class="mono" style="font-size:12px">${fmtSize(meta.size)}</td>
      <td style="font-size:12px">${esc(meta.by || '-')}<div class="mono" style="font-size:10.5px;color:var(--dim)">${esc((meta.ts ?? '').slice(0, 10))}</div></td>
      <td style="font-size:12px;color:var(--dim);max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(meta.note ?? '')}">${esc(meta.note) || '—'}</td>
      <td style="white-space:nowrap">
        ${v === p.defaultVersion ? '' : `<button class="btn sm" data-rv-default="${esc(v)}">${T('设默认', 'Set default')}</button>`}
        <button class="btn sm danger" data-rv-del="${esc(v)}">${T('删', 'Delete')}</button>
      </td>
    </tr>`).join('') || `<tr><td colspan="5" class="empty">${T('无版本', 'No versions')}</td></tr>`
}

async function repoVerAction(act, arg) {
  const name = act === 'delPlugin' ? arg : repoVerCur
  const ver = act === 'delPlugin' ? '' : arg
  try {
    if (act === 'default') {
      await api('/admin/plugin-repo/' + encodeURIComponent(name), { method: 'PATCH', body: JSON.stringify({ defaultVersion: ver }) })
      toast(T('默认版本 → {v}', 'Default version → {v}', { v: ver }))
    } else if (act === 'del') {
      if (!(await confirmDlg({ title: T('删除版本', 'Delete version'), message: T('删除版本 {v}？包文件一并删除，不可恢复。', 'Delete version {v}? Its files are removed permanently.', { v: ver }), confirmText: T('确认删除', 'Delete'), danger: true }))) return
      await api(`/admin/plugin-repo/${encodeURIComponent(name)}/${encodeURIComponent(ver)}`, { method: 'DELETE' })
      toast(T('已删除版本 {v}', 'Version {v} deleted', { v: ver }))
    } else if (act === 'delPlugin') {
      await api('/admin/plugin-repo/' + encodeURIComponent(name), { method: 'DELETE' })
      toast(T('已删除插件 {n}', 'Plugin {n} deleted', { n: name }))
    }
    const d = await api('/admin/plugin-repo')
    repoData = d.plugins ?? []
    renderRepo()
    if (act !== 'delPlugin') fillRepoVerDlg()
  } catch (e) { if (e.message !== '401') toast(e.message, 'bad') }
}

/* ---- 描述编辑弹窗 ---- */
function openRepoDesc(name) {
  repoDescCur = name
  const p = repoData.find((x) => x.name === name)
  $('rdName').textContent = name
  $('rdText').value = p?.description ?? ''
  $('rdTextEn').value = p?.descriptionEn ?? ''
  $('rdErr').textContent = ''
  openDlg($('repoDescDlg'))
  $('rdText').focus()
}

async function submitRepoDesc() {
  try {
    await api('/admin/plugin-repo/' + encodeURIComponent(repoDescCur), { method: 'PATCH', body: JSON.stringify({ description: $('rdText').value.trim(), descriptionEn: $('rdTextEn').value.trim() }) })
    closeDlg($('repoDescDlg'))
    toast(T('描述已保存', 'Description saved'))
    loadRepo()
    if (repoVerCur === repoDescCur) fillRepoVerDlg()
  } catch (e) { if (e.message !== '401') $('rdErr').textContent = e.message }
}

/* ---------- 允许清单（列表化编辑 · 改动自动保存下发 · 搜索 + 分页） ---------- */
let allowItems = []   // ['dsh-enterprise', ...]
const ALLOW_PAGE_SIZE = 8
let allowPageCur = 1
let allowQuery = ''

const NAME_HINT = T('插件名限 2-64 位字母数字_-，可带 @组织/', 'Name must be 2-64 chars of letters, digits, _ or -, optional @org/')
let plugSaveTimer = null

/** 自动保存：清单 + 插件源一起 PATCH 下发（输入类改动 600ms 防抖，点选类立即） */
async function autoSavePlug(immediate = false) {
  const run = async () => {
    const msg = $('plugAutoMsg')
    try {
      const builtin = $('regMode').value === 'url' && $('regBuiltin').checked
      const pluginRegistry = {
        mode: $('regMode').value,
        npmRegistryUrl: $('regUrl').value.trim(),
        packagePrefix: builtin ? location.origin + '/plugin-packages/' : $('regPrefix').value.trim(),
        allowedFallback: $('regFallback').checked,
      }
      if (pluginRegistry.mode === 'proxy' && !pluginRegistry.npmRegistryUrl) { if (msg) msg.textContent = T('proxy 模式需要填写 NPM 镜像地址', 'proxy mode needs an NPM mirror URL'); return }
      if (pluginRegistry.mode === 'url' && !pluginRegistry.packagePrefix) { if (msg) msg.textContent = T('url 模式需要填写包地址前缀', 'url mode needs a package URL prefix'); return }
      // 服务端兜底去重：任何路径攒出的重复项在保存前剔除
      allowItems = [...new Set(allowItems)]
      if (msg) msg.textContent = T('保存中…', 'Saving…')
      await api('/admin/policy', { method: 'PATCH', body: JSON.stringify({ policy: { allowedPlugins: allowItems.slice(), pluginEnforce: $('regEnforce')?.value ?? 'enforce', pluginRegistry, clientAccessUrl: $('regAccess')?.value.trim() ?? '' } }) })
      if (msg) msg.textContent = T('已自动保存 ✓ {t}', 'Saved ✓ {t}', { t: new Date().toLocaleTimeString(undefined, { hour12: false }) })
    } catch (e) {
      if (e.message !== '401' && msg) msg.textContent = T('保存失败：{m}', 'Save failed: {m}', { m: e.message })
    }
  }
  clearTimeout(plugSaveTimer)
  if (immediate) return run()
  plugSaveTimer = setTimeout(run, 600)
}

/* ---- 清单项 → 入库企业插件仓库（反向：清单里的包名从 npm 拉进仓库） ---- */
async function allowToRepo(name) {
  if (name === 'dsh-enterprise') { toast(T('dsh-enterprise 由 file: 链接部署，无需入库', 'dsh-enterprise is deployed via file: link; no import needed'), 'bad'); return }
  if (allowRepoBusy.has(name)) return
  allowRepoBusy.add(name)
  try {
    const r = await api('/admin/plugin-repo/npm', { method: 'POST', body: JSON.stringify({ spec: name }) })
    toast(T('已入库：{spec}', 'Imported: {spec}', { spec: `${r.name}@${r.version}` }))
    loadRepo()
  } catch (e) {
    if (e.message !== '401') toast(T('入库失败：{m}', 'Import failed: {m}', { m: e.message }), 'bad')
  } finally {
    allowRepoBusy.delete(name)
  }
}
const allowRepoBusy = new Set()

function renderAllowList() {
  const box = $('allowList')
  if (!box) return
  $('allowCount').textContent = allowItems.length
  const q = allowQuery.trim().toLowerCase()
  const all = allowItems.map((n, i) => ({ n, i }))
    .filter(({ n }) => {
      if (!q) return true
      const desc = repoData.find((x) => x.name === n)?.description ?? ''
      return n.toLowerCase().includes(q) || desc.toLowerCase().includes(q)
    })
  const pages = Math.max(1, Math.ceil(all.length / ALLOW_PAGE_SIZE))
  allowPageCur = Math.min(allowPageCur, pages)
  const view = all.slice((allowPageCur - 1) * ALLOW_PAGE_SIZE, allowPageCur * ALLOW_PAGE_SIZE)
  box.innerHTML = view.map(({ n, i }) => {
    const repo = repoData.find((x) => x.name === n)
    const desc = repo?.description ?? ''
    const ver = repo?.defaultVersion ?? ''
    return `
    <div style="display:flex;align-items:center;gap:10px;padding:6px 12px;background:var(--bg);border:1px solid var(--line);border-radius:6px">
      <div style="flex:1;min-width:0">
        <div style="display:flex;align-items:center;gap:8px">
          <span class="mono" style="font-size:12px;font-weight:600;color:var(--txt)">${esc(n)}</span>
          ${ver ? `<span class="badge dim" style="font-size:10px">v${esc(ver)}</span>` : ''}
          ${n === 'dsh-enterprise' ? `<span class="badge ok" title="${T('企业必装组件，删除后用户端登录与策略失效', 'Required component; removing it breaks client sign-in and policy')}">${T('必装', 'Required')}</span>` : ''}
        </div>
        <div style="font-size:11.5px;color:var(--dim);margin-top:1px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${desc ? esc(desc) : `<span style="color:var(--line)">${T('未入库 · 无描述', 'Not imported · no description')}</span>`}</div>
      </div>
      <button class="btn sm" data-allow-repo="${esc(n)}" style="padding:1px 8px;font-size:11px" title="${repo ? T('已在仓库，可管理版本与描述', 'Already in repo; manage versions and description') : T('从 npm 拉进企业插件仓库', 'Import from npm into the enterprise plugin repo')}">${repo ? T('已入库', 'In repo') : T('入库', 'Import')}</button>
      <button class="btn sm danger" data-allow-del="${i}" style="padding:1px 8px;font-size:11px">${T('移除', 'Remove')}</button>
    </div>`
  }).join('') || (allowItems.length ? `<div style="font-size:12px;color:var(--dim);padding:6px 2px">${T('没有匹配的插件', 'No matching plugins')}</div>` : `<div style="font-size:12px;color:var(--dim);padding:6px 2px">${T('清单为空 = 不限制（用户可装任意插件）', 'Empty allowlist = no restriction (any plugin allowed)')}</div>`)
  // 分页条
  const pg = $('allowPage')
  if (pg) {
    pg.innerHTML = pages > 1
      ? `<span>${(allowPageCur - 1) * ALLOW_PAGE_SIZE + 1}-${Math.min(allowPageCur * ALLOW_PAGE_SIZE, all.length)} / ${all.length}</span>
         <button class="btn sm" data-allow-page="prev" ${allowPageCur <= 1 ? 'disabled' : ''}>‹</button>
         <span class="mono">${allowPageCur} / ${pages}</span>
         <button class="btn sm" data-allow-page="next" ${allowPageCur >= pages ? 'disabled' : ''}>›</button>`
      : ''
  }
}

function allowAdd(raw) {
  const err = $('allowErr')
  err.textContent = ''
  const name = String(raw ?? '').trim()
  if (!name) return
  if (!/^(@[a-zA-Z0-9_-]{1,64}\/)?[a-zA-Z0-9_-]{2,64}$/.test(name)) { err.textContent = T('格式不对：{h}', 'Invalid format: {h}', { h: NAME_HINT }); return }
  if (allowItems.includes(name)) { err.textContent = T('已在清单中：{n}', 'Already in allowlist: {n}', { n: name }); return }
  allowItems.push(name)
  $('allowInput').value = ''
  renderAllowList()
  autoSavePlug(true)
}

async function allowRemove(i) {
  const name = allowItems[i]
  if (name === 'dsh-enterprise' && !(await confirmDlg({ title: T('移出必装插件', 'Remove required plugin'), message: T('移除 dsh-enterprise 后用户端登录与策略失效，确定？', 'Removing dsh-enterprise breaks client sign-in and policy. Confirm?'), confirmText: T('仍要移除', 'Remove'), danger: true }))) return
  allowItems.splice(i, 1)
  renderAllowList()
  renderRepo()   // 仓库行内"已入清单"徽章/按钮同步恢复
  autoSavePlug(true)
}

/* ---- ＋清单：把仓库名追加进允许清单（自动保存下发） ---- */
function allowFromRepo(name) {
  if (allowItems.includes(name)) { toast(T('允许清单里已有 {n}', 'Already in allowlist: {n}', { n: name })); return }
  allowItems.push(name)
  renderAllowList()
  autoSavePlug(true)
  // 仓库行内按钮/徽章同步（加入后该行变"已入清单"）——不跳页签
  renderRepo()
  toast(T('已加入允许清单：{n}（已自动下发）', 'Added to allowlist: {n} (deployed automatically)', { n: name }))
}

/* ---------- 企业插件源（子页 2 · 齿轮弹窗） ---------- */
const REG_MODE_LABEL = { off: T('默认社区源', 'Community source'), proxy: T('npm 镜像', 'npm mirror'), url: T('直连地址', 'Direct URL') }
function syncRegBadge() {
  const badge = $('regModeBadge')
  if (!badge) return
  const mode = $('regMode')?.value ?? 'off'
  badge.textContent = mode === 'off' ? '' : T('源：{m}', 'Source: {m}', { m: REG_MODE_LABEL[mode] ?? mode })
}
function syncRegFields() {
  const mode = $('regMode').value
  const builtin = mode === 'url' && $('regBuiltin').checked
  $('regUrl').disabled = mode !== 'proxy'
  $('regPrefix').disabled = mode !== 'url' || builtin
  if (builtin && !$('regPrefix').value.trim()) $('regPrefix').value = location.origin + '/plugin-packages/'
  const hint = $('regHint')
  if (hint) hint.textContent = mode === 'off'
    ? T('off = 不干预，用户端直接走社区 npm 源', 'off = no intervention; client uses the community npm source')
    : mode === 'proxy'
      ? T('proxy = 安装时自动追加 --registry={u}', 'proxy = appends --registry={u} on install', { u: $('regUrl').value.trim() || '<mirror URL>' })
      : builtin
        ? T('url + 内置直连 = 用户端从本网关「插件仓库」下载', 'url + built-in = client downloads from the gateway plugin repo')
        : T('url = 从 {p}<插件包名> 下载 .tgz', 'url = downloads .tgz from {p}<package>', { p: $('regPrefix').value.trim() || '<prefix>' })
  syncRegBadge()
}

/* ---------- 客户端自助规则（子页 3） ---------- */
const RULE_TYPES = [
  { v: 'block-url', label: T('拦网址', 'Block URL') },
  { v: 'block-word', label: T('拦关键词', 'Block keyword') },
  { v: 'notice', label: T('公告', 'Notice') },
]

const RULE_PRESETS = {
  'block-url': { type: 'block-url', action: 'block', value: 'pan.baidu.com', message: '网盘类站点工作时段禁止访问，如有需要请联系 IT 审批' },
  'block-word': { type: 'block-word', action: 'warn', value: '内部资料|未公开', message: '检测到可能涉密的词语，请注意外发风险' },
  'notice': { type: 'notice', action: 'block', value: '【企业公告】本周六 20:00-22:00 网关例行维护，期间服务可能中断', message: '' },
}

const TYPE_META = {
  'block-url': { label: T('网址', 'URL'), color: 'var(--accent)', bg: '#eff6ff', ph: T('域名，多个用 | 分隔。例：github.com|pan.baidu.com', 'Domains separated by |, e.g. github.com|pan.baidu.com'), hint: T('拦该域名及全部子域（用户端浏览器环境内）', 'Blocks the domain and all subdomains (client browser)') },
  'block-word': { label: T('关键词', 'Keyword'), color: '#b45309', bg: '#fffbeb', ph: T('正则或关键词，多个用 | 分隔。例：内部资料|未公开', 'Regex or keywords separated by |, e.g. secret|internal'), hint: T('正则不区分大小写；非法时自动退化为包含匹配', 'Case-insensitive; falls back to contains match if invalid') },
  'notice': { label: T('公告', 'Notice'), color: '#1d4ed8', bg: '#eff6ff', ph: T('公告全文，用户端原样展示', 'Notice text, shown as-is on client'), hint: T('公告无需动作选择，用户端展示蓝底信息条', 'No action needed; client shows a blue info banner') },
}

let rulesData = []        // 规则数组 = 唯一数据源（列表渲染 / 弹窗编辑 / 保存提交都走它）
let ruleEditIdx = -1      // 当前弹窗编辑的规则下标；-1 = 新增

function renderClientRules(rules) {
  rulesData = (rules ?? []).map((r) => ({ ...r }))
  renderRulesTable()
}

function renderRulesTable() {
  const tbody = $('rulesList')
  if (!tbody) return
  tbody.innerHTML = rulesData.map((r, i) => {
    const meta = TYPE_META[r.type] ?? TYPE_META['block-url']
    const v = esc(String(r.value ?? '').replace(/\n/g, ' ').slice(0, 46))
    const m = esc(String(r.message ?? '').slice(0, 36))
    return `<tr data-rule-idx="${i}" style="cursor:pointer">
      <td class="mono" style="color:var(--dim);font-size:11.5px">${String(i + 1).padStart(2, '0')}</td>
      <td style="white-space:nowrap"><span style="font-size:11px;font-weight:600;padding:2px 9px;border-radius:20px;white-space:nowrap;color:${meta.color};background:${meta.bg}">${meta.label}</span></td>
      <td style="white-space:nowrap">${r.type === 'notice' ? '<span style="font-size:11.5px;color:var(--dim)">—</span>' : `<span style="font-size:11px;font-weight:600;padding:2px 9px;border-radius:20px;${r.action !== 'warn' ? 'color:#b91c1c;background:#fef2f2' : 'color:#9a3412;background:#fff7ed'}">${r.action !== 'warn' ? T('拦截', 'Block') : T('提醒', 'Warn')}</span>`}</td>
      <td class="mono" style="font-size:12px;max-width:340px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${v || `<i style="color:var(--line)">${T('（空）', '(empty)')}</i>`}</td>
      <td style="font-size:12px;color:var(--dim);max-width:240px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${m || '<i style="color:var(--line)">—</i>'}</td>
      <td style="white-space:nowrap">
        <button class="btn sm" data-rule-edit="${i}" title="${T('编辑', 'Edit')}">${T('编辑', 'Edit')}</button>
        <button class="btn sm danger" data-rule-del="${i}" title="${T('删除', 'Delete')}">${T('删', 'Delete')}</button>
      </td>
    </tr>`
  }).join('') || `<tr><td colspan="6" class="empty">${T('暂无本地规则 —— 点「新增规则」创建第一条', 'No local rules — use "Add rule" to create the first one')}</td></tr>`
  updateRuleCount()
  applyRuleFilter()
}

/** 规则改动自动保存：debounce 800ms 后直接 PATCH，无需手动点「保存更改」 */
let _rulesAutoSaveTimer = null
function markRulesDirty() {
  clearTimeout(_rulesAutoSaveTimer)
  _rulesAutoSaveTimer = setTimeout(async () => {
    try {
      const rules = collectClientRules()
      for (const r of rules) { if (!r.value) { toast(T('有规则缺匹配值，未自动保存', 'A rule is missing a match value; not saved'), 'bad'); return } }
      await api('/admin/policy', { method: 'PATCH', body: JSON.stringify({ policy: { clientRules: rules } }) })
      toast(T('已自动保存：本地规则 {n} 条', 'Auto-saved: {n} local rules', { n: rules.length }))
    } catch (e) { if (e.message !== '401') toast(T('自动保存失败：{m}', 'Auto-save failed: {m}', { m: e.message }), 'bad') }
  }, 800)
}

function updateRuleCount() {
  const n = document.querySelectorAll('#rulesList tr[data-rule-idx]:not([hidden])').length
  const total = rulesData.length
  if ($('ruleCount')) $('ruleCount').textContent = n === total ? T('{n} 条', '{n}', { n: total }) : T('{a} / {b} 条', '{a} / {b}', { a: n, b: total })
}

/* ---------- 回执（子页 4）：灰度进度 + 待回执设备 + 可筛选明细 ---------- */
let ackRows = []        // 最近回执明细（未筛选）
let ackCurVer = ''      // 当前策略版本
let ackTimer = null     // 自动刷新定时器

/** 'YYYY-MM-DD HH:MM:SS'（北京时间）→ 相对时间 */
function ago(s) {
  if (!s) return '-'
  const t = new Date(String(s).replace(' ', 'T') + '+08:00').getTime()
  if (Number.isNaN(t)) return s
  const m = Math.round((Date.now() - t) / 60000)
  if (m < 1) return T('刚刚', 'just now')
  if (m < 60) return T('{m} 分钟前', '{m} min ago', { m })
  if (m < 1440) return T('{h} 小时前', '{h} h ago', { h: Math.floor(m / 60) })
  return T('{d} 天前', '{d} d ago', { d: Math.floor(m / 1440) })
}

const shortDev = (h) => (h && h.length > 14 ? h.slice(0, 14) + '…' : (h || '-'))

const statTile = (lab, val, sub = '') => `
  <div style="border:1px solid var(--line);border-radius:10px;padding:11px 14px">
    <div class="stat-card"><div class="lab">${lab}</div><div class="val">${val}</div></div>
    ${sub ? `<div class="crumb" style="margin:4px 0 0">${sub}</div>` : ''}
  </div>`

/* ---------- 版本发布与灰度 ---------- */
let verSelection = null   // 当前选中要灰度的版本
async function renderVersions() {
  if (!$('verBody')) return
  try {
    const d = await api('/admin/policy-versions')
    $('verCur').textContent = d.current ?? '—'
    const g = d.gray ?? null
    $('verGrayState').textContent = g?.version ? T('灰度中：{v} @ {p}%', 'Gray: {v} @ {p}%', { v: g.version, p: g.percent }) : T('无灰度（全员 current）', 'No gray release (all on current)')
    $('verGrayState').style.color = g?.version ? 'var(--warn)' : 'var(--dim)'
    $('verGrayBtn').disabled = !verSelection
    $('verGrayBtn').textContent = verSelection ? T('开始灰度 {v}', 'Gray {v}', { v: verSelection }) : T('开始灰度', 'Start gray')
    const summarize = (policy) => {
      if (!policy) return '—'
      const parts = []
      if (policy.clientRules !== undefined) parts.push(T('规则 {n} 条', '{n} rules', { n: policy.clientRules.length }))
      if (policy.watermark !== undefined) parts.push(policy.watermark ? T('水印开', 'Watermark on') : T('水印关', 'Watermark off'))
      if (policy.lockModelConfig !== undefined) parts.push(policy.lockModelConfig ? T('锁配置', 'Config locked') : T('不锁', 'Unlocked'))
      if (policy.allowedPlugins !== undefined) parts.push(policy.allowedPlugins.length ? T('插件白名单 {n}', 'Allowlist {n}', { n: policy.allowedPlugins.length }) : T('插件不限', 'Plugins open'))
      return parts.join(' · ') || '—'
    }
    $('verBody').innerHTML = (d.versions ?? []).map((v) => {
      const isGray = g?.version === v.version
      const isCur = d.current === v.version
      return `<tr>
        <td class="mono" style="font-size:12px;white-space:nowrap">${v.version}${isCur ? ` <span class="badge ok">${T('当前', 'Current')}</span>` : ''}${isGray ? ` <span class="badge warn">${T('灰度中', 'Gray')}</span>` : ''}</td>
        <td class="mono" style="font-size:11.5px;color:var(--dim);white-space:nowrap">${v.ts ?? ''}</td>
        <td style="font-size:12px;max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(v.note ?? '') || '—'}</td>
        <td style="font-size:12px;color:var(--dim)">${summarize(v.policy)}</td>
        <td style="white-space:nowrap">
          <button class="btn sm" data-ver-gray="${v.version}" ${isCur ? `disabled title="${T('当前版本无需灰度', 'Current version needs no gray release')}"` : ''}>${T('选为灰度', 'Select for gray')}</button>
          <button class="btn sm" data-ver-rollback="${v.version}" title="${T('把该版本内容写回当前策略', 'Write this version back to the current policy')}">${T('回滚到此', 'Rollback')}</button>
        </td>
      </tr>`
    }).join('') || `<tr><td colspan="5" class="empty">${T('暂无版本历史 —— 保存一次策略即产生', 'No version history yet — save a policy once to create one')}</td></tr>`
  } catch (e) { if (e.message !== '401') toast(T('版本历史加载失败：{m}', 'Failed to load version history: {m}', { m: e.message }), 'bad') }
}

function bindVersions() {
  if (!$('verBody') || $('verBody').dataset.bound) return
  $('verBody').dataset.bound = '1'
  $('verBody').addEventListener('click', async (e) => {
    const g = e.target.closest('[data-ver-gray]')
    if (g) { verSelection = verSelection === g.dataset.verGray ? null : g.dataset.verGray; await renderVersions(); return }
    const rb = e.target.closest('[data-ver-rollback]')
    if (rb) {
      if (!(await confirmDlg({ title: T('回滚策略', 'Roll back policy'), message: T('回滚到 {v}？当前策略内容将被该版本快照覆盖（版本号继续递增）。', 'Roll back to {v}? Current policy content will be overwritten by this snapshot (version number keeps increasing).', { v: rb.dataset.verRollback }), confirmText: T('确认回滚', 'Roll back'), danger: true }))) return
      try {
        const r = await api('/admin/policy-rollback', { method: 'POST', body: JSON.stringify({ version: rb.dataset.verRollback }) })
        toast(T('已回滚，新版本 {v}', 'Rolled back; new version {v}', { v: r.version }))
        loadAll()
      } catch (e2) { if (e2.message !== '401') toast(T('回滚失败：{m}', 'Rollback failed: {m}', { m: e2.message }), 'bad') }
    }
  })
  $('verGrayBtn')?.addEventListener('click', async () => {
    if (!verSelection) return
    const percent = Number($('verPercent')?.value)
    if (!Number.isInteger(percent) || percent < 0 || percent > 100) { toast(T('灰度比例须为 0-100 整数', 'Gray percent must be an integer 0-100'), 'bad'); return }
    try {
      await api('/admin/policy-gray', { method: 'POST', body: JSON.stringify({ version: verSelection, percent }) })
      toast(T('灰度已开始：{v} @ {p}%', 'Gray release started: {v} @ {p}%', { v: verSelection, p: percent }))
      verSelection = null
      loadAll()
    } catch (e) { if (e.message !== '401') toast(e.message, 'bad') }
  })
  $('verPromoteBtn')?.addEventListener('click', async () => {
    try {
      await api('/admin/policy-promote', { method: 'POST', body: '{}' })
      toast(T('已转正：全员拉取当前版本', 'Promoted: everyone pulls the current version'))
      loadAll()
    } catch (e) { if (e.message !== '401') toast(e.message, 'bad') }
  })
  $('verCancelGrayBtn')?.addEventListener('click', async () => {
    try {
      await api('/admin/policy-gray', { method: 'POST', body: JSON.stringify({}) })
      toast(T('灰度已取消：全员拉取当前版本', 'Gray release canceled: everyone pulls the current version'))
      loadAll()
    } catch (e) { if (e.message !== '401') toast(e.message, 'bad') }
  })
}

function renderAcks(d) {
  if (!$('ackBody')) return
  void renderVersions()   // 版本管理卡随回执页一起刷新
  const p = d.policy ?? {}
  ackCurVer = p.version ?? '-'
  ackRows = d.acks ?? []
  const versions = d.ackStats?.versions ?? []
  const online = d.ackStats?.onlineDevices ?? 0
  const cur = versions.find((v) => v.policy_version === ackCurVer)
  const curDevices = cur?.devices ?? 0
  const pct = online > 0 ? Math.min(100, Math.round((curDevices / online) * 100)) : null
  $('ackCurVer').textContent = ackCurVer

  /* 概览 4 卡 */
  $('ackStatCards').innerHTML =
    statTile(T('已回执设备 · 当前版本', 'Receipted devices (current)'), curDevices, T('台', 'devices')) +
    statTile(T('近 24h 在线终端', 'Online in 24h'), online, T('台', 'devices')) +
    statTile(T('灰度覆盖率', 'Gray coverage'), pct === null ? '—' : pct + '%', T('已回执 ÷ 在线', 'receipts ÷ online')) +
    statTile(T('回执版本数', 'Receipt versions'), versions.length, T('累计明细 {n} 条', '{n} records total', { n: ackRows.length }))
  const badge = $('ackSummaryBadge')
  if (pct === null) { badge.className = 'badge dim'; badge.textContent = T('暂无在线终端可比', 'No online devices to compare') }
  else {
    badge.className = 'badge ' + (pct >= 80 ? 'ok' : 'warn')
    badge.textContent = T('当前版本覆盖 {p}%', 'Current version coverage {p}%', { p: pct })
  }

  /* 按版本聚合条 */
  $('ackVersionBars').innerHTML = versions.map((v) => {
    const isCur = v.policy_version === ackCurVer
    const vp = online > 0 ? Math.min(100, Math.round((v.devices / online) * 100)) : 0
    return `<div class="chan">
      <span class="nm"><span class="mono">${esc(v.policy_version)}</span> ${isCur ? `<span class="badge ok">${T('当前', 'Current')}</span>` : `<span class="badge dim">${T('历史', 'History')}</span>`}</span>
      <div class="bar"><i style="width:${vp}%;background:${isCur ? 'var(--ok)' : 'var(--dim)'}"></i></div>
      <span class="mono" style="white-space:nowrap;flex-shrink:0">${T('{d} 台 / {a} 条 · {p}%', '{d} devices / {a} receipts · {p}%', { d: v.devices, a: v.acks, p: vp })}</span>
      <span class="crumb" style="margin:0;white-space:nowrap;flex-shrink:0" title="${T('最早 {t}', 'First {t}', { t: esc(v.first_local ?? '') })}">${T('最近 {t}', 'Last {t}', { t: ago(v.last_local) })}</span>
    </div>`
  }).join('') || `<div class="empty">${T('暂无任何回执 —— 用户端拉取到新版策略并本地生效后会自动上报', 'No receipts yet — clients report automatically after pulling and applying a new policy')}</div>`

  /* 待回执设备 */
  const pending = d.pendingAcks ?? []
  const pc = $('ackPendingCount')
  pc.textContent = pending.length ? T('{n} 台待回执', '{n} pending', { n: pending.length }) : T('当前版本已全部覆盖', 'All covered for the current version')
  pc.className = 'badge ' + (pending.length ? 'warn' : 'ok')
  $('ackPendingBody').innerHTML = pending.map((x) => {
    const got = x.hb_version === ackCurVer
    return `<tr>
      <td>${esc(x.account || '-')}</td>
      <td class="mono">${esc(x.profile || '-')}</td>
      <td class="mono">${esc(x.hb_version || '-')}</td>
      <td>${got ? `<span class="badge warn">${T('已拉到新版 · 回执未达', 'New version pulled · receipt missing')}</span>` : `<span class="badge dim">${T('未拉到新版', 'New version not pulled')}</span>`}</td>
      <td class="mono">${esc(x.env || '-')}</td>
      <td class="mono">${esc(x.node_version || '-')}</td>
      <td class="mono" title="${esc(x.last_seen_local ?? '')}">${esc(x.last_seen_local ?? '-')}<span class="crumb" style="margin:0;display:block">${ago(x.last_seen_local)}</span></td>
      <td class="mono" title="${esc(x.device_hash ?? '')}">${esc(shortDev(x.device_hash))}</td>
    </tr>`
  }).join('') || `<tr><td colspan="8" class="empty">${T('近 24 小时在线的终端都已对当前版本回执 ✓', 'All devices online in 24h have receipted the current version ✓')}</td></tr>`

  renderAckRows()
}

function renderAckRows() {
  if (!$('ackBody')) return
  const verSel = $('ackVerFilter')
  const vf = verSel.value
  // 版本下拉：全部版本 + 计数，保留当前选中项
  const vers = [...new Set(ackRows.map((a) => a.policy_version))]
  verSel.innerHTML = `<option value="">${T('全部版本（{n}）', 'All versions ({n})', { n: vers.length })}</option>` +
    vers.map((v) => `<option value="${esc(v)}" ${v === vf ? 'selected' : ''}>${esc(v)}${v === ackCurVer ? T('（当前）', ' (current)') : ''} · ${T('{n} 条', '{n}', { n: ackRows.filter((a) => a.policy_version === v).length })}</option>`).join('')
  const q = $('ackSearch').value.trim().toLowerCase()
  const rows = ackRows.filter((a) =>
    (!vf || a.policy_version === vf) &&
    (!q || [a.account, a.profile, a.device_hash, a.policy_version].some((x) => String(x ?? '').toLowerCase().includes(q))))
  $('ackCount').textContent = ackRows.length ? (rows.length === ackRows.length ? T('最近 {n} 条', 'Last {n}', { n: rows.length }) : T('{a} / {b} 条', '{a} / {b}', { a: rows.length, b: ackRows.length })) : ''
  $('ackBody').innerHTML = rows.map((a) => {
    const isCur = a.policy_version === ackCurVer
    return `<tr>
      <td class="mono" title="${esc(a.ts_local ?? '')}">${esc(a.ts_local ?? '-')}<span class="crumb" style="margin:0;display:block">${ago(a.ts_local)}</span></td>
      <td>${esc(a.account || '-')}</td>
      <td class="mono">${esc(a.profile || '-')}</td>
      <td><span class="mono">${esc(a.policy_version || '-')}</span> ${isCur ? `<span class="badge ok">${T('当前', 'Current')}</span>` : ''}</td>
      <td class="mono">${esc(a.env || '-')}</td>
      <td class="mono">${esc(a.node_version || '-')}</td>
      <td class="mono" title="${esc(a.device_hash ?? '')}">${esc(shortDev(a.device_hash))}</td>
      <td class="mono" title="${esc(a.last_seen_local ?? '')}">${esc(a.last_seen_local ?? '-')}</td>
    </tr>`
  }).join('') || `<tr><td colspan="8" class="empty">${ackRows.length ? T('没有匹配筛选条件的回执', 'No receipts match the filter') : T('暂无回执 —— 等用户端生效新版策略后自动上报', 'No receipts yet — clients report automatically after applying a new policy')}</td></tr>`
}

function bindAcks() {
  if (!$('ackBody')) return
  $('ackRefreshBtn')?.addEventListener('click', () => { loadAll() })
  $('ackSearch')?.addEventListener('input', renderAckRows)
  $('ackVerFilter')?.addEventListener('change', renderAckRows)
  clearInterval(ackTimer) // 壳重复 bind 时防叠加
  ackTimer = setInterval(() => {
    if (document.hidden) return
    const page = document.getElementById('page-client-acks')
    if (page && page.hidden) return
    loadAll({ skipRulesTable: true })
  }, 30000)
}

/* ---------- 保存（每个子页各管各的段，互不覆盖） ---------- */
function showSaveErr(msgEl, text) {
  if (msgEl) msgEl.textContent = text
  if (text) toast(text, 'bad')
}

async function doSave(msgEl, patch, okMsg) {
  try {
    await api('/admin/policy', { method: 'PATCH', body: JSON.stringify(patch) })
    if (msgEl) msgEl.textContent = ''
    toast(okMsg)
    loadAll()
  } catch (e) { if (e.message !== '401') showSaveErr(msgEl, e.message) }
}

async function saveLp() {
  const msg = $('lpMsg'); if (msg) msg.textContent = ''
  const num = (id) => Number($(id).value)
  for (const id of ['lpMaxFails', 'lpWindow', 'lpLock']) {
    if (!Number.isInteger(num(id)) || num(id) < 1 || num(id) > 1440) return showSaveErr(msg, T('登录保护参数须为 1-1440 的整数', 'Sign-in protection values must be integers 1-1440'))
  }
  await doSave(msg, {
    loginProtection: {
      enabled: $('swLoginProt').classList.contains('on'),
      maxFails: num('lpMaxFails'),
      windowMin: num('lpWindow'),
      lockMin: num('lpLock'),
    },
  }, T('已保存：登录保护', 'Saved: sign-in protection'))
}

/** （已废弃按钮式保存）清单与插件源全部改为自动保存 */

/** 横幅样式弹窗：单独保存（不动规则本体），保存成功后刷新页头摘要 */
async function saveBannerStyle() {
  const err = $('bannerDlgErr'); if (err) err.textContent = ''
  const numOrNull = (id) => { const el = $(id); if (!el || el.value === '') return null; const n = Number(el.value); return Number.isFinite(n) ? n : null }
  const bannerStyle = {}
  for (const [k, id] of [['maxWidth', 'bannerW'], ['top', 'bannerMt'], ['right', 'bannerMr'], ['bottom', 'bannerMb'], ['left', 'bannerMl']]) {
    const v = numOrNull(id); if (v !== null) bannerStyle[k] = v
  }
  const bannerPosition = $('bannerPos')?.value ?? 'top-right'
  try {
    await api('/admin/policy', { method: 'PATCH', body: JSON.stringify({ policy: { bannerPosition, bannerStyle: Object.keys(bannerStyle).length ? bannerStyle : null } }) })
    toast(T('横幅样式已保存：{p}', 'Banner style saved: {p}', { p: bannerPosition }))
    loadAll()
  } catch (e) { if (err) err.textContent = e.message; if (e.message !== '401') toast(e.message, 'bad') }
}

/* ---------- 各子页事件绑定（元素存在才绑，兼容老壳单页回退） ---------- */
function bindSwitches() {
  if ($('swLock')) $('swLock').addEventListener('click', toggleLock)
  if ($('swWm')) $('swWm').addEventListener('click', toggleWatermark)
  if ($('swLoginProt')) $('swLoginProt').addEventListener('click', toggleLoginProt)
  for (const id of ['lpMaxFails', 'lpWindow', 'lpLock']) {
    if ($(id)) $(id).addEventListener('input', () => syncLpExample())
  }
  if ($('lpSaveBtn')) $('lpSaveBtn').addEventListener('click', saveLp)
}

function bindPlugins() {
  /* ---- 页签切换：插件仓库 / 允许清单与插件源 ---- */
  if ($('plugTabs')) {
    $('plugTabs').addEventListener('click', (e) => {
      const tab = e.target.closest('[data-panetab]')
      if (!tab) return
      for (const t of $('plugTabs').querySelectorAll('[data-panetab]')) t.classList.toggle('on', t === tab)
      $('pane-repo').classList.toggle('on', tab.dataset.panetab === 'pane-repo')
      $('pane-allow').classList.toggle('on', tab.dataset.panetab === 'pane-allow')
    })
  }
  if ($('regMode')) {
    // 插件源改动自动保存：点选类立即，输入类防抖（autoSavePlug 内 600ms）
    $('regMode').addEventListener('change', () => { syncRegFields(); autoSavePlug(true) })
    $('regUrl').addEventListener('input', () => syncRegFields())
    $('regPrefix').addEventListener('input', () => syncRegFields())
    $('regUrl').addEventListener('change', () => autoSavePlug(true))
    $('regPrefix').addEventListener('change', () => autoSavePlug(true))
    $('regBuiltin').addEventListener('change', () => { syncRegFields(); autoSavePlug(true) })
    $('regEnforce')?.addEventListener('change', () => autoSavePlug(true))
    $('regFallback').addEventListener('change', () => autoSavePlug(true))
    $('regAccess')?.addEventListener('change', () => autoSavePlug(true))
  }
  /* ---- 允许清单（列表化编辑 + 自动保存 + 搜索/分页） ---- */
  if ($('allowList')) {
    $('allowAddBtn').addEventListener('click', () => allowAdd($('allowInput').value))
    $('allowInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') allowAdd($('allowInput').value) })
    $('allowSearch').addEventListener('input', () => { allowQuery = $('allowSearch').value; allowPageCur = 1; renderAllowList() })
    $('allowPage').addEventListener('click', (e) => {
      const b = e.target.closest('[data-allow-page]')
      if (!b) return
      if (b.dataset.allowPage === 'prev') allowPageCur = Math.max(1, allowPageCur - 1)
      else allowPageCur = allowPageCur + 1
      renderAllowList()
    })
    $('allowList').addEventListener('click', (e) => {
      let el
      if ((el = e.target.closest('[data-allow-del]'))) allowRemove(Number(el.dataset.allowDel))
      else if ((el = e.target.closest('[data-allow-repo]'))) allowToRepo(el.dataset.allowRepo)
    })
  }
  /* ---- 插件源齿轮弹窗（自动保存，关闭时回显保存状态） ---- */
  if ($('regSettingBtn')) {
    $('regSettingBtn').addEventListener('click', () => {
      $('regAutoNote').textContent = $('plugAutoMsg')?.textContent ?? ''
      $('regErr').textContent = ''
      openDlg($('regSettingDlg'))
    })
  }
  /* ---- 仓库卡片 + 三个弹窗 ---- */
  if ($('repoAddBtn')) {
    $('repoAddBtn').addEventListener('click', openRepoAdd)
    $('repoAddOk').addEventListener('click', submitRepoAdd)
    $('repoSrcNpm').addEventListener('click', () => setRepoSrc('npm'))
    $('repoSrcUp').addEventListener('click', () => setRepoSrc('upload'))
    $('repoSearch').addEventListener('input', renderRepo)
    if ($('repoCheckBtn')) $('repoCheckBtn').addEventListener('click', (e) => repoCheckUpdates(e.currentTarget))
    $('repoBody').addEventListener('click', (e) => {
      let el
      if ((el = e.target.closest('[data-repo-ver]'))) openRepoVer(el.dataset.repoVer)
      else if ((el = e.target.closest('[data-repo-upd]'))) repoUpdateLatest(el.dataset.repoUpd, el)
      else if ((el = e.target.closest('[data-repo-allow]'))) allowFromRepo(el.dataset.repoAllow)
      else if ((el = e.target.closest('[data-repo-desc]'))) openRepoDesc(el.dataset.repoDesc)
      else if ((el = e.target.closest('[data-repo-del]'))) repoVerAction('delPlugin', el.dataset.repoDel)
    })
    $('rvBody').addEventListener('click', (e) => {
      const d = e.target.closest('[data-rv-default]')
      if (d) return repoVerAction('default', d.dataset.rvDefault)
      const del = e.target.closest('[data-rv-del]')
      if (del) return repoVerAction('del', del.dataset.rvDel)
    })
    $('rvDescEdit').addEventListener('click', () => openRepoDesc(repoVerCur))
    $('rdOk').addEventListener('click', submitRepoDesc)
  }
}

function bindRules() {
  // —— 新增：空弹窗
  if ($('ruleAddBtn')) $('ruleAddBtn').addEventListener('click', () => {
    // 公告只保留一条：已有公告时「新增规则」直接进入当前公告编辑（公告不是可堆叠的条目）
    const noticeIdx = rulesData.findIndex((r) => r.type === 'notice')
    openRuleEdit(noticeIdx >= 0 ? noticeIdx : -1, noticeIdx >= 0 ? T('公告已存在，直接编辑当前公告', 'Notice exists; editing the current notice') : undefined)
  })

  // —— 列表事件委托：编辑 / 删除 / 点行打开编辑
  if ($('rulesList')) {
    $('rulesList').addEventListener('click', async (e) => {
      const del = e.target.closest('[data-rule-del]')
      if (del) {
        const i = Number(del.dataset.ruleDel)
        const r = rulesData[i]
        const brief = String(r?.value ?? '').trim().slice(0, 24) || T('（空规则）', '(empty rule)')
        e.stopPropagation()
        const okDel = await confirmDlg({ title: T('删除规则', 'Delete rule'), message: T('删除这条规则？{b}', 'Delete this rule? {b}', { b: brief }), confirmText: T('确认删除', 'Delete'), danger: true })
        if (okDel) {
          rulesData.splice(i, 1)
          if ($('ruleFilter')) $('ruleFilter').value = ''
          if ($('ruleTypeFilter')) $('ruleTypeFilter').value = ''
          renderRulesTable()
          markRulesDirty()
          toast(T('已删除，自动保存中…', 'Deleted; auto-saving…'))
        }
        return
      }
      const edit = e.target.closest('[data-rule-edit]')
      if (edit) { openRuleEdit(Number(edit.dataset.ruleEdit)); return }
      const tr = e.target.closest('tr[data-rule-idx]')
      if (tr) openRuleEdit(Number(tr.dataset.ruleIdx))
    })
  }

  // —— 编辑弹窗：类型切换联动（占位符/提示/动作禁用/预览）、预览、确定
  if ($('reType')) {
    $('reType').addEventListener('change', () => {
      const meta = TYPE_META[$('reType').value] ?? TYPE_META['block-url']
      $('reValue').placeholder = meta.ph
      $('reHint').textContent = meta.hint
      const notice = $('reType').value === 'notice'
      $('reAction').disabled = notice
      $('reMsgWrap').style.display = notice ? 'none' : ''
      updateRePreview()
    })
    $('reValue').addEventListener('input', updateRePreview)
    $('reAction').addEventListener('change', updateRePreview)
    $('reMsg').addEventListener('input', updateRePreview)
  }
  if ($('ruleEditOk')) $('ruleEditOk').addEventListener('click', async () => {
    const err = $('ruleEditErr'); err.textContent = ''
    const value = $('reValue').value.trim()
    if (!value) { err.textContent = T('匹配值（value）不能为空', 'Match value is required'); $('reValue').focus(); return }
    const type = $('reType').value
    if (type === 'block-word') { try { new RegExp(value) } catch { if (!(await confirmDlg({ title: T('正则不合法', 'Invalid regex'), message: T('正则不合法（会退化为包含匹配），仍要保存吗？', 'Invalid regex (falls back to contains match). Save anyway?'), confirmText: T('仍要保存', 'Save anyway') }))) return } }
    const rule = { type, action: type === 'notice' ? 'block' : $('reAction').value, value, message: $('reMsg').value.trim() }
    if (ruleEditIdx >= 0) rulesData[ruleEditIdx] = rule
    else if (type === 'notice' && rulesData.some((r) => r.type === 'notice')) {
      // 公告只保留一条：已有公告时新增 = 替换旧公告（位置也在旧公告处）
      const idx = rulesData.findIndex((r) => r.type === 'notice')
      rulesData[idx] = rule
      toast(T('已有公告已替换为新的（公告仅保留一条）', 'Existing notice replaced (only one notice is kept)'))
    } else {
      rulesData.push(rule)
    }
    closeDlg($('ruleEditDlg'))
    // 清空筛选，避免"新增/改类型的行被过滤隐藏"造成没生效的错觉
    if ($('ruleFilter')) $('ruleFilter').value = ''
    if ($('ruleTypeFilter')) $('ruleTypeFilter').value = ''
    renderRulesTable()
    markRulesDirty()
    toast(ruleEditIdx >= 0 ? T('已修改第 {n} 条，自动保存中…', 'Updated rule {n}; auto-saving…', { n: ruleEditIdx + 1 }) : T('已添加，自动保存中…', 'Added; auto-saving…'))
  })

  // —— 过滤
  if ($('ruleFilter')) $('ruleFilter').addEventListener('input', applyRuleFilter)
  if ($('ruleTypeFilter')) $('ruleTypeFilter').addEventListener('change', applyRuleFilter)

  // —— 横幅样式弹窗：打开（loadAll 已回显面板值）/ 保存 / 预览 / 示意实时跟随
  if ($('bannerStyleBtn')) $('bannerStyleBtn').addEventListener('click', () => openDlg($('bannerStyleDlg')))
  if ($('bannerSaveBtn')) $('bannerSaveBtn').addEventListener('click', saveBannerStyle)
  if ($('bannerPreview')) $('bannerPreview').addEventListener('click', () => {
    const bs = readBannerForm()
    const posCss = bs.position === 'top-center' ? `top:${bs.top}px;left:50%;transform:translateX(-50%);`
      : bs.position === 'top-left' ? `top:${bs.top}px;left:${bs.left}px;`
        : bs.position === 'bottom-right' ? `bottom:${bs.bottom || 14}px;right:${bs.right}px;`
          : `top:${bs.top}px;right:${bs.right}px;`
    const w = window.open('', '_blank', 'width=760,height=420')
    if (!w) return
    w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${T('横幅样式预览', 'Banner style preview')}</title></head>
      <body style="margin:0;background:#eef1f6;font-family:system-ui">
        <div style="${posCss}position:fixed;max-width:${bs.maxWidth}px;padding:11px 40px 11px 16px;border-radius:10px;background:#fff7ed;border:1.5px solid #fb923c;box-shadow:0 10px 34px rgba(0,0,0,.16);font-size:13.5px;line-height:1.55;color:#9a3412;display:flex;align-items:flex-start;gap:8px">
          <span style="font-size:16px;flex-shrink:0">⚠️</span>
          <span style="word-break:break-word">${T('样式预览：检测到关键词', 'Preview: keyword detected')} <b>${T('示例', 'example')}</b>${T('，请注意外发风险（宽 {w}px）', ' — mind the outbound risk (width {w}px)', { w: bs.maxWidth })}</span>
        </div>
        <div style="padding:16px;color:var(--dim);font-size:12px">${T('预览窗口 —— 保存后用户端下一次弹出即生效。', 'Preview window — takes effect on the next client banner after save.')}</div>
      </body></html>`)
    w.document.close()
  })
  for (const id of ['bannerPos', 'bannerW', 'bannerMt', 'bannerMr', 'bannerMb', 'bannerMl']) {
    $(id)?.addEventListener('input', updateBannerMock)
    $(id)?.addEventListener('change', updateBannerMock)
  }
}

/* ---------- 规则编辑弹窗 ---------- */
function openRuleEdit(idx, noticeTip) {
  ruleEditIdx = idx
  const r = idx >= 0 ? rulesData[idx] : null
  const preset = r ?? RULE_PRESETS[idx < 0 ? (rulesData.length % 2 === 0 ? 'block-url' : 'block-word') : 'block-url']
  $('ruleEditTitle').textContent = idx >= 0 ? T('编辑规则 #{n}', 'Edit rule #{n}', { n: String(idx + 1).padStart(2, '0') }) : T('新增规则', 'Add rule')
  $('reType').value = preset.type ?? 'block-url'
  $('reAction').value = preset.action === 'warn' ? 'warn' : 'block'
  $('reValue').value = preset.value ?? ''
  $('reMsg').value = preset.message ?? ''
  $('ruleEditErr').textContent = noticeTip ?? ''
  if (noticeTip) $('ruleEditErr').style.color = 'var(--accent)'   // 提示用蓝色区别于错误红
  else $('ruleEditErr').style.color = ''
  $('reType').disabled = false
  $('reType').dispatchEvent(new Event('change'))
  openDlg($('ruleEditDlg'))
  requestAnimationFrame(() => { $('reValue').focus() })
}

/** 弹窗内实时预览（notebox） */
function updateRePreview() {
  const pv = $('rePreview'); if (!pv) return
  const type = $('reType').value
  if (type === 'notice') { pv.style.display = 'none'; return }
  const word = T('示例', 'example')
  const msg = $('reMsg').value.trim()
  const text = msg.includes('[]') ? msg.replaceAll('[]', word) : (msg ? T('{m}（{w}）', '{m} ({w})', { m: msg, w: word }) : T('检测到敏感内容（{w}）', 'Sensitive content detected ({w})', { w: word }))
  const blocked = $('reAction').value !== 'warn'
  pv.style.display = ''
  pv.style.background = blocked ? '#fef2f2' : '#fff7ed'
  pv.style.borderColor = blocked ? '#ef4444' : '#fb923c'
  pv.style.color = blocked ? '#b91c1c' : '#9a3412'
  pv.innerHTML = (blocked ? '⛔ ' : '⚠️ ') + esc(text) + `<span style="float:right;font-size:11px;opacity:.7">${T('（{a}效果示意）', '({a} preview)', { a: blocked ? T('拦截', 'block') : T('提醒', 'warn') })}</span>`
}

/** 读横幅样式表单当前值 */
function readBannerForm() {
  const num = (id, dflt) => { const v = Number($(id)?.value); return Number.isFinite(v) && $(id)?.value !== '' ? v : dflt }
  return {
    position: $('bannerPos')?.value ?? 'top-right',
    maxWidth: num('bannerW', 420),
    top: num('bannerMt', 14),
    right: num('bannerMr', 18),
    bottom: num('bannerMb', 0),
    left: num('bannerMl', 0),
  }
}

/** 弹窗内示意块跟随表单值 */
function updateBannerMock() {
  const mock = $('bannerMock'); if (!mock) return
  const bs = readBannerForm()
  mock.style.maxWidth = bs.maxWidth + 'px'
  mock.style.marginTop = bs.position.startsWith('top') ? bs.top + 'px' : ''
  mock.style.marginLeft = bs.position === 'top-left' || bs.position === 'bottom-right' ? bs.left + 'px' : bs.position === 'top-right' ? 'auto' : ''
  mock.style.marginRight = bs.position === 'top-right' ? bs.right + 'px' : ''
  mock.style.transform = bs.position === 'top-right' ? 'translateX(-14px)' : ''
}

/* ---------- 规则列表辅助：过滤（rulesData 为源，行级 hidden） ---------- */
function applyRuleFilter() {
  const kw = ($('ruleFilter')?.value ?? '').trim().toLowerCase()
  const type = $('ruleTypeFilter')?.value ?? ''
  let visible = 0
  for (const tr of document.querySelectorAll('#rulesList tr[data-rule-idx]')) {
    const r = rulesData[Number(tr.dataset.ruleIdx)]
    if (!r) continue
    const okType = !type || r.type === type
    const text = (String(r.value ?? '') + ' ' + String(r.message ?? '')).toLowerCase()
    const show = okType && (!kw || text.includes(kw))
    tr.hidden = !show
    if (show) visible++
  }
  const list = $('rulesList')
  if (list) {
    list.querySelector('.rule-filter-empty')?.remove()
    if (!visible && rulesData.length) list.insertAdjacentHTML('beforeend', `<tr class="rule-filter-empty"><td colspan="6" class="empty">${T('没有匹配的规则', 'No matching rules')}</td></tr>`)
  }
  updateRuleCount()
}

/* ---------- 壳契约导出 ---------- */
const pages = {
  'client-switches': { html: switchesHtml, load: loadAll, bind: bindSwitches },
  'client-plugins': { html: pluginsHtml, load: loadAll, bind: bindPlugins },
  'client-rules': { html: rulesHtml, load: loadAll, bind: bindRules },
  'client-acks': { html: acksHtml, load: loadAll, bind: bindAcks },
}

export default {
  page: 'ent-client',
  // 兼容老壳（不识别 nav.children）：单页回退 = 第一个子页
  html: pages['client-switches'].html,
  async load() { await loadAll() },
  bind() { bindSwitches(); bindPlugins(); bindRules(); bindAcks() },
  pages,
}

