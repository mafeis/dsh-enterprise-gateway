/**
 * 插件页面 · 客户端管控（一级菜单 + 4 个二级页）
 * 壳契约：ent-client.mjs 的 nav.children 声明二级页 → 每个子页取本模块 pages[id] 的 { html, load, bind }
 *   #/client-switches 策略与开关（界面策略 + 登录保护）
 *   #/client-plugins  插件管控（允许清单 + 企业插件源）
 *   #/client-rules    自助规则（员工端本机执行的拦网址/拦关键词/公告）
 *   #/client-acks     下发回执（策略版本灰度核对）
 * 兼容：老壳不识别 nav.children 时回退 html/load/bind（= 第一个子页）。
 * 数据源：/admin/policy* /admin/policy-detail（ent-console 聚合提供）
 */
import { api, $, toast, esc, openDlg, closeDlg } from '/admin/static/contract.mjs'

/* ---------- 公共片段 ---------- */
const headrow = (title, extra = '') => `
  <div class="headrow" data-ent-page="ent-client">
    <div><h1>${title}</h1></div>
    <div class="sp"></div>${extra}
  </div>`

const savebar = (key, label = '保存更改') => `
  <div class="savebar" id="${key}Savebar">
    <span class="savebar-msg" id="${key}Msg"></span>
    <button class="btn primary" id="${key}SaveBtn">${label}</button>
  </div>`

/* ============ 子页 1 · 策略与开关 ============ */
const switchesHtml = `
  ${headrow('策略与开关', `<span class="crumb" style="margin:0">策略版本 <span class="mono" id="polVer">—</span></span>`)}

  <!-- ============ 界面策略开关 ============ -->
  <div class="card">
    <h2><span class="bar"></span>界面策略 <span class="badge dim">点击即生效</span></h2>
    <div class="switchrow">
      <span class="lab2">模型配置锁定<span class="desc">员工端隐藏「模型」设置页，防绕过企业配置</span></span>
      <span class="switch" id="swLock"></span>
    </div>
    <div class="switchrow">
      <span class="lab2">界面水印<span class="desc">员工端 Web 界面叠加半透明水印，截屏外传可溯源；仅影响显示</span></span>
      <span class="switch" id="swWm"></span>
    </div>
    <div id="wmStylePanel" style="display:none;margin:4px 0 12px;padding:12px 14px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px">
      <div style="font-size:12.5px;font-weight:600;margin-bottom:10px">水印样式 <span class="badge dim">改完即自动保存，员工端 10s 内跟随</span></div>
      <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end;margin-bottom:10px">
        <label style="font-size:12px;color:#475569">内容模板<br>
          <input id="wmTemplate" class="input" style="width:320px;font-size:12px;margin-top:3px" placeholder="{user} · {time} · 企业机密">
        </label>
        <span style="font-size:11px;color:#94a3b8;padding-bottom:7px;display:flex;gap:4px;flex-wrap:wrap;align-items:center">点选插入：
          <button type="button" class="btn sm" data-wmvar="{user}" title="登录账号" style="padding:1px 8px;font-size:11px">{user}</button>
          <button type="button" class="btn sm" data-wmvar="{time}" title="当前时间（分钟级刷新）" style="padding:1px 8px;font-size:11px">{time}</button>
          <button type="button" class="btn sm" data-wmvar="{device}" title="设备名（主机名）" style="padding:1px 8px;font-size:11px">{device}</button>
          <button type="button" class="btn sm" data-wmvar="{loginAt}" title="登录时间" style="padding:1px 8px;font-size:11px">{loginAt}</button>
          <button type="button" class="btn sm" data-wmvar="{gateway}" title="网关地址" style="padding:1px 8px;font-size:11px">{gateway}</button>
        </span>
      </div>
      <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end">
        <label style="font-size:12px;color:#475569">颜色<br><input id="wmColor" type="color" class="input" style="width:52px;height:28px;padding:1px;margin-top:3px;cursor:pointer"></label>
        <label style="font-size:12px;color:#475569">透明度 <span id="wmOpacityVal" class="mono">0.06</span><br>
          <input id="wmOpacity" type="range" min="0.01" max="0.5" step="0.01" style="width:120px;margin-top:8px;cursor:pointer"></label>
        <label style="font-size:12px;color:#475569">字号<br><input id="wmFontSize" class="input" type="number" min="8" max="40" style="width:64px;font-size:12px;margin-top:3px"></label>
        <label style="font-size:12px;color:#475569">横向间距<br><input id="wmGapX" class="input" type="number" min="80" max="800" step="10" style="width:76px;font-size:12px;margin-top:3px"></label>
        <label style="font-size:12px;color:#475569">纵向间距<br><input id="wmGapY" class="input" type="number" min="50" max="600" step="10" style="width:76px;font-size:12px;margin-top:3px"></label>
        <label style="font-size:12px;color:#475569">角度°<br><input id="wmAngle" class="input" type="number" min="-90" max="90" step="2" style="width:64px;font-size:12px;margin-top:3px"></label>
        <button class="btn sm" id="wmReset" type="button" style="margin-bottom:1px">恢复默认</button>
      </div>
    </div>
  </div>

  <!-- ============ 登录保护 ============ -->
  <div class="card">
    <h2><span class="bar"></span>登录保护 <span class="badge dim">防爆破</span></h2>
      <div class="switchrow">
      <span class="lab2">启用失败锁定<span class="desc">窗口内失败达阈值即临时锁定，到点自动解除</span></span>
      <span class="switch" id="swLoginProt"></span>
    </div>
    <div class="fgrid" style="margin-top:10px">
      <label>失败阈值（次）</label><input class="input" id="lpMaxFails" type="number" min="1" max="1440">
      <label>统计窗口（分钟）</label><input class="input" id="lpWindow" type="number" min="1" max="1440">
      <label>锁定时长（分钟）</label><input class="input" id="lpLock" type="number" min="1" max="1440">
    </div>
    <div class="hint">当前配置：<b id="lpExample">10</b> 次失败 / <b class="lpWin">15</b> 分钟窗口 → 锁定 <b class="lpLock">15</b> 分钟</div>
    <details class="help">
      <summary>锁定机制说明</summary>
      <div class="help-body">
        <ol class="steps">
          <li>某账号登录失败 → 失败次数计入「统计窗口」内的滑动计数，成功登录会清零该账号计数</li>
          <li>窗口内累计失败 ≥ <b>失败阈值</b> → 该账号进入锁定状态</li>
          <li>锁定持续 <b>锁定时长</b> 分钟，期间正确密码也会被拒绝（返回 429 too_many_attempts）</li>
          <li>被锁期间的尝试<b>不延长锁定时间</b>——攻击者无法靠持续重试把账号永久锁死</li>
        </ol>
        <div class="notebox">被锁的账号在「用户管理」里不会显示为禁用——锁定是登录接口层的临时状态，到点自动解除。</div>
      </div>
    </details>
  </div>

  ${savebar('lp')}`

/* ============ 子页 2 · 插件管控（页签：插件仓库 / 允许清单与插件源） ============ */
const pluginsHtml = `
  ${headrow('插件管控', `<button class="btn sm primary" id="repoAddBtn">＋ 添加插件</button>`)}

  <div class="tabs" id="plugTabs">
    <span class="on" data-panetab="pane-repo">插件仓库</span>
    <span data-panetab="pane-allow">允许清单与插件源</span>
  </div>

  <!-- ============ 页签 A · 企业插件仓库 ============ -->
  <div class="pane on" id="pane-repo">
  <div class="card">
    <h2><span class="bar"></span>企业插件仓库 <span class="badge dim" id="repoCount">0 个</span>
      <span style="margin-left:auto"><input id="repoSearch" class="input" placeholder="搜插件名 / 描述…" style="width:200px;font-size:12px;height:28px"></span>
    </h2>
    <div class="sub">通过 npm 地址或压缩包把插件收口到网关，统一维护版本与描述，员工端从网关下载</div>
    <div class="tablewrap">
      <table>
        <thead><tr><th>插件名</th><th>描述</th><th>默认版本</th><th>版本</th><th>大小</th><th>更新时间</th><th style="width:236px">操作</th></tr></thead>
        <tbody id="repoBody"><tr><td colspan="7" class="empty">加载中…</td></tr></tbody>
      </table>
    </div>
  </div>
  </div>

  <!-- ============ 页签 B · 允许清单与插件源 ============ -->
  <div class="pane" id="pane-allow">
  <div class="card">
    <h2><span class="bar"></span>允许清单</h2>
    <div style="margin-bottom:4px;font-size:12.5px;color:#475569">允许清单 <span class="badge dim" id="allowCount">0</span> <span style="color:#94a3b8">清单外插件员工端安装被拦截</span></div>
    <div id="allowList" style="display:flex;flex-direction:column;gap:6px;max-height:280px;overflow:auto"></div>
    <div style="display:flex;gap:8px;margin-top:10px">
      <input class="input" id="allowInput" placeholder="插件包名，如 dsh-review · @corp/dsh-review" style="flex:1;font-size:12px;height:30px">
      <button class="btn sm" id="allowAddBtn">＋ 添加</button>
    </div>
    <div class="err" id="allowErr" style="margin-top:6px"></div>
  </div>

  <div class="card">
    <h2><span class="bar"></span>插件源</h2>
    <div class="fgrid">
      <label>企业插件源</label>
      <select id="regMode" class="input" style="width:100%">
        <option value="off">默认社区源（off · 不干预）</option>
        <option value="proxy">企业 npm 镜像（proxy）</option>
        <option value="url">企业直连地址（url）</option>
      </select>
      <label>回退公共源</label>
      <span class="chk"><input type="checkbox" id="regFallback"> 自建源拉取失败时允许回退社区源</span>
      <label>NPM 镜像地址<span class="dim2">proxy 模式</span></label>
      <input class="input" id="regUrl" placeholder="http://npm.corp.local:4873">
      <label>包地址前缀<span class="dim2">url 模式</span></label>
      <input class="input" id="regPrefix" placeholder="http://plugins.corp.local/packages/">
      <label>内置仓库直连</label>
      <span class="chk"><input type="checkbox" id="regBuiltin"> url 模式下员工端直接从本网关仓库下载（前缀自动 = 本站 /plugin-packages/）</span>
    </div>
    <div class="hint" id="regHint" style="margin-top:8px"></div>
    <details class="help">
      <summary>插件源两种模式怎么选 & 填写示例</summary>
      <div class="help-body">
        <div class="vsgrid">
          <div class="vs-a"><b>proxy 模式 —— 企业 npm 镜像（推荐）</b>
            自建 npm 私服（Verdaccio / Nexus 等），可缓存、可发私有插件
          </div>
          <div class="vs-b"><b>url 模式 —— 静态文件直连</b>
            勾选「内置仓库直连」即用插件仓库页签；也可把 .tgz 放内网 HTTP 服务按前缀下载
          </div>
        </div>
        <div class="codeblock"><span class="cmt">// 员工端安装时插件内部实际执行的等价命令：</span>
<span class="cmt">// proxy 模式（自动带 --registry，员工无感知）</span>
dsh plugin add dsh-review <span class="hl">--registry http://npm.corp.local:4873</span>
<span class="cmt">// url 模式（前缀 + 包名直接作为包地址，内置仓库即网关下载端点）</span>
dsh plugin add <span class="hl">http://&lt;网关地址&gt;/plugin-packages/</span>dsh-review</div>
        <div class="kv">
          <span class="k">bundle 名去哪找</span><span class="v">员工端「设置 → 企业管理 → 插件管理 → 本机已安装」显示的就是 bundle 名；或看插件 profile 目录 package.json 的 dsh.profile.bundles</span>
          <span class="k">url 前缀拼接</span><span class="v mono">最终地址 = packagePrefix + 插件包名（前缀末尾带不带 / 均可）</span>
          <span class="k">回退开关</span><span class="v">勾选 = 企业源不可用时回退社区源</span>
        </div>
        <div class="notebox warn">dsh-enterprise 必须保留在清单中（负责登录与策略）</div>
        <div class="notebox ok">推荐：允许清单 + 企业源一起用，安装来源与范围都管住</div>
      </div>
    </details>
  </div>

  <!-- 自动保存状态（无保存按钮：所有改动即时下发） -->
  <div style="margin-top:10px;font-size:12px;color:#94a3b8;min-height:16px" id="plugAutoMsg"></div>
  </div>

  <!-- 添加插件弹窗（npm 地址 / 压缩包上传 二选一） -->
  <div class="dlg-mask" id="repoAddDlg" hidden>
    <div class="dlg md">
      <div class="dlg-head">
        <h2><span class="bar"></span>添加插件</h2>
        <button class="dlg-x" data-dlg-close title="关闭">✕</button>
      </div>
      <div class="dlg-body">
        <div style="display:flex;gap:8px;margin-bottom:14px">
          <button type="button" class="btn" id="repoSrcNpm" style="flex:1">从 npm 地址拉取</button>
          <button type="button" class="btn" id="repoSrcUp" style="flex:1">上传压缩包</button>
        </div>
        <div id="repoNpmGroup">
          <label style="font-size:12.5px;color:#475569;display:block">包名或 .tgz 地址
            <input id="repoSpec" class="input" placeholder="dsh-review · @corp/dsh-review@1.2.0 · https://…/x.tgz" style="width:100%;margin-top:4px">
          </label>
          <label style="font-size:12.5px;color:#475569;display:block;margin-top:10px">npm 源（可选，默认用镜像地址 / 官方源）
            <input id="repoRegistry" class="input" placeholder="http://npm.corp.local:4873" style="width:100%;margin-top:4px">
          </label>
        </div>
        <div id="repoUpGroup" style="display:none">
          <label style="font-size:12.5px;color:#475569;display:block">压缩包（.tgz，内含 package.json）
            <input id="repoFile" type="file" accept=".tgz,.gz,.tar" class="input" style="width:100%;margin-top:4px;padding:6px">
          </label>
        </div>
        <label style="font-size:12.5px;color:#475569;display:block;margin-top:10px">版本说明（可选）
          <input id="repoNote" class="input" placeholder="例：首版上架 / 升级到 x.y 修复 xx" style="width:100%;margin-top:4px">
        </label>
        <div class="notebox" id="repoAddResult" style="display:none;margin-top:12px"></div>
      </div>
      <div class="dlg-foot">
        <span class="err" id="repoAddErr"></span>
        <button class="btn" data-dlg-close>取消</button>
        <button class="btn primary" id="repoAddOk">添加</button>
      </div>
    </div>
  </div>

  <!-- 版本管理弹窗 -->
  <div class="dlg-mask" id="repoVerDlg" hidden>
    <div class="dlg md">
      <div class="dlg-head">
        <h2><span class="bar"></span>版本管理 · <span class="mono" id="rvName">—</span></h2>
        <button class="dlg-x" data-dlg-close title="关闭">✕</button>
      </div>
      <div class="dlg-body">
        <div style="display:flex;gap:8px;align-items:center;margin-bottom:12px">
          <span style="font-size:12.5px;color:#475569;flex-shrink:0">描述</span>
          <span id="rvDesc" style="font-size:12.5px;color:#334155;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap"></span>
          <button class="btn sm" id="rvDescEdit">编辑</button>
        </div>
        <div class="tablewrap" style="max-height:380px;overflow:auto">
          <table>
            <thead><tr><th>版本</th><th>大小</th><th>来源</th><th>上传人</th><th>时间</th><th>说明</th><th style="width:132px">操作</th></tr></thead>
            <tbody id="rvBody"></tbody>
          </table>
        </div>
      </div>
      <div class="dlg-foot">
        <span class="err" id="rvErr"></span>
        <button class="btn" data-dlg-close>关闭</button>
      </div>
    </div>
  </div>

  <!-- 描述编辑弹窗 -->
  <div class="dlg-mask" id="repoDescDlg" hidden>
    <div class="dlg" style="width:520px">
      <div class="dlg-head">
        <h2><span class="bar"></span>插件描述 · <span class="mono" id="rdName">—</span></h2>
        <button class="dlg-x" data-dlg-close title="关闭">✕</button>
      </div>
      <div class="dlg-body">
        <textarea id="rdText" class="input" rows="4" style="width:100%;resize:vertical" placeholder="一句话说明该插件用途，员工端插件市场可见"></textarea>
      </div>
      <div class="dlg-foot">
        <span class="err" id="rdErr"></span>
        <button class="btn" data-dlg-close>取消</button>
        <button class="btn primary" id="rdOk">保存</button>
      </div>
    </div>
  </div>
`

/* ============ 子页 3 · 本地规则 ============ */
const rulesHtml = `
  ${headrow('本地规则', `
    <button class="btn sm" id="bannerStyleBtn" type="button" title="横幅弹出样式（位置/宽度/边距）">⚙ 横幅样式</button>
    <span class="crumb" style="margin:0">当前：<span id="bannerPosLabel">—</span></span>`)}

  <div class="card">
    <h2><span class="bar"></span>本地规则 <span class="badge dim" id="ruleCount">0 条</span>
      <span style="margin-left:auto;display:flex;gap:6px;align-items:center">
        <input id="ruleFilter" class="input" placeholder="搜关键词 / 域名 / 提示语…" style="width:190px;font-size:12px;height:28px">
        <select id="ruleTypeFilter" class="input" style="width:auto;font-size:12px;height:28px">
          <option value="">全部类型</option>
          <option value="block-url">网址</option>
          <option value="block-word">关键词</option>
          <option value="notice">公告</option>
        </select>
        <button class="btn sm primary" id="ruleAddBtn">＋ 新增规则</button>
      </span>
    </h2>
    <div class="tablewrap">
      <table>
        <thead><tr><th style="width:44px">#</th><th style="width:88px">类型</th><th style="width:68px">动作</th><th>匹配值</th><th>提示语</th><th style="width:104px">操作</th></tr></thead>
        <tbody id="rulesList"></tbody>
      </table>
    </div>
    <div style="margin-top:8px"><span class="crumb" style="margin:0">规则自上而下逐条匹配；点行任意处打开编辑弹窗</span></div>
    <details class="help">
      <summary>三种类型的 value 填法</summary>
      <div class="help-body">
        <div class="codeblock"><span class="hl">网址</span>  填域名 → 拦该域名及全部子域。例：<span class="hl">github.com</span> 拦 github.com / gist.github.com / api.github.com …
<span class="hl">关键词</span> 填正则，命中员工端送出的文本；非法时退化为包含匹配
<span class="hl">公告</span>     填公告文本 → 员工端展示企业公告，value 即公告内容，message 可留空</div>
        <div class="notebox">仅管控员工端浏览器环境内的访问；规则与命中次数在员工端「企业管理 → 规则管理」可见（只读）</div>
      </div>
    </details>
  </div>

  <!-- 横幅样式弹窗（从页面本体挪进对话框：主界面只留规则卡片，层级干净） -->
  <div class="dlg-mask" id="bannerStyleDlg" hidden>
    <div class="dlg md">
      <div class="dlg-head">
        <h2><span class="bar"></span>横幅样式 <span class="badge dim">员工端提醒/拦截/公告弹出的默认样式</span></h2>
        <button class="dlg-x" data-dlg-close title="关闭">✕</button>
      </div>
      <div class="dlg-body">
        <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:12px">
          <span style="font-size:12.5px;color:#475569;width:52px">位置</span>
          <select id="bannerPos" class="input" style="width:140px;font-size:12.5px">
            <option value="top-right">右上角</option>
            <option value="top-center">顶部居中</option>
            <option value="top-left">左上角</option>
            <option value="bottom-right">右下角</option>
          </select>
          <span style="font-size:12.5px;color:#475569;width:52px;margin-left:10px">宽度</span>
          <input id="bannerW" class="input" type="number" min="240" max="1200" step="10" style="width:90px;font-size:12.5px" placeholder="420">
          <span style="font-size:11.5px;color:#94a3b8">px（240-1200）</span>
        </div>
        <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:12px">
          <span style="font-size:12.5px;color:#475569;width:52px">边距</span>
          <span style="font-size:11.5px;color:#94a3b8">上</span>
          <input id="bannerMt" class="input" type="number" min="0" max="400" step="2" style="width:70px;font-size:12.5px" placeholder="14">
          <span style="font-size:11.5px;color:#94a3b8">右</span>
          <input id="bannerMr" class="input" type="number" min="0" max="400" step="2" style="width:70px;font-size:12.5px" placeholder="18">
          <span style="font-size:11.5px;color:#94a3b8">下</span>
          <input id="bannerMb" class="input" type="number" min="0" max="400" step="2" style="width:70px;font-size:12.5px" placeholder="0">
          <span style="font-size:11.5px;color:#94a3b8">左</span>
          <input id="bannerMl" class="input" type="number" min="0" max="400" step="2" style="width:70px;font-size:12.5px" placeholder="0">
          <span style="font-size:11.5px;color:#94a3b8">px（0-400，距屏幕边缘）</span>
        </div>
        <div style="font-size:11.5px;color:#94a3b8;margin-bottom:12px">配色固定：拦截红 / 提醒橙 / 公告蓝（语义区分，不随样式配置）</div>
        <div style="background:#f8fafc;border:1px dashed #e2e8f0;border-radius:8px;padding:18px 14px;position:relative;min-height:110px;overflow:hidden">
          <div style="font-size:11px;color:#94a3b8;margin-bottom:8px">效果示意（实际以员工端屏幕为准）：</div>
          <div id="bannerMock" style="max-width:420px;padding:11px 40px 11px 16px;border-radius:10px;background:#fff7ed;border:1.5px solid #fb923c;box-shadow:0 6px 18px rgba(0,0,0,.10);font-size:12.5px;color:#9a3412;display:flex;align-items:center;gap:8px">
            <span style="font-size:14px;flex-shrink:0">⚠️</span>
            <span>检测到涉密关键词 <b>示例</b>，请注意外发风险</span>
          </div>
        </div>
        <div id="bannerMsg" style="font-size:12px;color:#059669;margin-top:10px"></div>
      </div>
      <div class="dlg-foot">
        <span class="err" id="bannerDlgErr"></span>
        <button class="btn sm" id="bannerPreview" type="button">预览效果</button>
        <button class="btn primary" id="bannerSaveBtn" type="button">保存样式</button>
      </div>
    </div>
  </div>

  <!-- 规则编辑弹窗（新增/编辑共用） -->
  <div class="dlg-mask" id="ruleEditDlg" hidden>
    <div class="dlg md">
      <div class="dlg-head">
        <h2><span class="bar"></span><span id="ruleEditTitle">新增规则</span></h2>
        <button class="dlg-x" data-dlg-close title="关闭">✕</button>
      </div>
      <div class="dlg-body">
        <div style="display:flex;gap:10px;margin-bottom:12px">
          <label style="font-size:12.5px;color:#475569">类型
            <select id="reType" class="input" style="display:block;margin-top:4px;width:130px;font-size:12.5px">
              <option value="block-url">网址</option>
              <option value="block-word">关键词</option>
              <option value="notice">公告</option>
            </select>
          </label>
          <label style="font-size:12.5px;color:#475569">动作
            <select id="reAction" class="input" style="display:block;margin-top:4px;width:110px;font-size:12.5px">
              <option value="block">拦截</option>
              <option value="warn">提醒</option>
            </select>
          </label>
          <span class="crumb" style="margin:0;align-self:end;padding-bottom:6px" id="reHint"></span>
        </div>
        <label style="font-size:12.5px;color:#475569;display:block">匹配值（value）
          <textarea id="reValue" class="input mono" rows="3" placeholder="域名 / 正则 / 公告全文"
            style="width:100%;margin-top:4px;font-size:12.5px;line-height:1.55;font-family:ui-monospace,monospace;resize:vertical"></textarea>
        </label>
        <label id="reMsgWrap" style="font-size:12.5px;color:#475569;display:block;margin-top:12px">提示语（可选；含 [] 占位符时自动填入触发词）
          <textarea id="reMsg" rows="2" class="input"
            style="width:100%;margin-top:4px;font-size:12.5px;line-height:1.55;resize:vertical"></textarea>
        </label>
        <div class="notebox" id="rePreview" style="margin-top:14px;display:none"></div>
      </div>
      <div class="dlg-foot">
        <span class="err" id="ruleEditErr"></span>
        <button class="btn" data-dlg-close>取消</button>
        <button class="btn primary" id="ruleEditOk">确定</button>
      </div>
    </div>
  </div>

`

/* ============ 子页 4 · 下发回执 ============ */
const acksHtml = `
  ${headrow('下发回执', `
    <span class="crumb" style="margin:0">当前策略版本 <span class="mono" id="ackCurVer">—</span></span>
    <button class="btn sm" id="ackRefreshBtn">↻ 刷新</button>
  `)}

  <!-- ============ 版本发布与灰度 ============ -->
  <div class="card">
    <h2><span class="bar"></span>版本发布与灰度 <span class="badge dim">策略每次保存自动产生新版本</span></h2>
    <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:12px">
      <span style="font-size:12.5px;color:#475569">当前版本 <b class="mono" id="verCur">—</b></span>
      <span style="font-size:12.5px;color:#475569">灰度状态 <b id="verGrayState" class="mono" style="color:#d97706">无灰度（全员 current）</b></span>
      <span style="flex:1"></span>
      <label style="font-size:12px;color:#475569;display:flex;gap:8px;align-items:center">灰度比例
        <input id="verPercent" class="input" type="number" min="0" max="100" step="5" style="width:72px;font-size:12px">
        <span class="crumb" style="margin:0">%</span>
      </label>
      <button class="btn sm" id="verGrayBtn" disabled>开始灰度</button>
      <button class="btn sm" id="verPromoteBtn">转正（全员生效）</button>
      <button class="btn sm" id="verCancelGrayBtn">取消灰度</button>
    </div>
    <div class="tablewrap" style="max-height:340px;overflow:auto">
      <table>
        <thead><tr><th>版本</th><th>时间</th><th>说明</th><th>变更内容</th><th style="width:150px">操作</th></tr></thead>
        <tbody id="verBody"><tr><td colspan="5" class="empty">加载中…</td></tr></tbody>
      </table>
    </div>
    <div class="notebox" style="margin-top:10px">按设备指纹比例分流灰度版本；同一设备恒定同侧。转正 = 全员生效；回滚 = 恢复历史版本内容</div>
  </div>

  <!-- ============ 灰度进度 ============ -->
  <div class="card">
    <h2><span class="bar"></span>灰度进度 <span class="badge dim" id="ackSummaryBadge"></span></h2>
    <div class="sub">覆盖率 = 已回执 ÷ 近 24h 在线设备</div>
    <div class="grid4" id="ackStatCards"></div>
    <div id="ackVersionBars" style="margin-top:14px"></div>
  </div>

  <!-- ============ 待回执设备 ============ -->
  <div class="card">
    <h2><span class="bar"></span>待回执设备 <span class="badge" id="ackPendingCount"></span></h2>
    <div class="sub">近 24h 在线但未回执当前版本的设备</div>
    <div class="tablewrap" style="max-height:300px;overflow:auto">
      <table>
        <thead><tr><th>账号</th><th>Profile</th><th>心跳上报版本</th><th>判定</th><th>环境</th><th>Node</th><th>最后心跳</th><th>设备指纹</th></tr></thead>
        <tbody id="ackPendingBody"><tr><td colspan="8" class="empty">加载中…</td></tr></tbody>
      </table>
    </div>
  </div>

  <!-- ============ 回执明细 ============ -->
  <div class="card">
    <h2><span class="bar"></span>回执明细 <span class="badge dim" id="ackCount"></span></h2>
    <div style="display:flex;gap:8px;margin:8px 0 10px;flex-wrap:wrap;align-items:center">
      <select class="input" id="ackVerFilter" style="width:auto"></select>
      <input class="input" id="ackSearch" placeholder="搜账号 / Profile / 指纹…" style="width:230px">
      <span class="crumb" style="margin:0">每 30 秒自动刷新</span>
    </div>
    <div class="tablewrap" style="max-height:420px;overflow:auto">
      <table>
        <thead><tr><th>回执时间</th><th>账号</th><th>Profile</th><th>策略版本</th><th>环境</th><th>Node</th><th>设备指纹</th><th>该设备最后心跳</th></tr></thead>
        <tbody id="ackBody"><tr><td colspan="8" class="empty">加载中…</td></tr></tbody>
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
    if ($('swWm')) $('swWm').classList.toggle('on', !!p.watermark)
    if ($('wmStylePanel')) {
      $('wmStylePanel').style.display = p.watermark ? '' : 'none'
      bindWmStyle()
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
    if ($('repoBody') || $('allowList')) await loadRepo()   // 仓库数据 = 清单描述/版本的数据源；loadRepo 内部会同步重渲染清单
    if ($('regMode')) {
      const reg = p.pluginRegistry ?? {}
      $('regMode').value = reg.mode ?? 'off'
      $('regFallback').checked = reg.allowedFallback !== false
      $('regUrl').value = reg.npmRegistryUrl ?? ''
      $('regPrefix').value = reg.packagePrefix ?? ''
      $('regBuiltin').checked = /\/plugin-packages\/?$/.test(reg.packagePrefix ?? '')
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
      const posLabel = { 'top-right': '右上角', 'top-center': '顶部居中', 'top-left': '左上角', 'bottom-right': '右下角' }[p.bannerPosition] ?? p.bannerPosition
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
  toast('模型配置锁定 → ' + (r.policy.lockModelConfig ? '锁定' : '放开') + '（客户端心跳后生效）')
}

async function toggleWatermark() {
  const sw = $('swWm')
  const target = !sw.classList.contains('on')
  const r = await api('/admin/policy', { method: 'PATCH', body: JSON.stringify({ policy: { watermark: target } }) })
  sw.classList.toggle('on', r.policy.watermark)
  const panel = $('wmStylePanel')
  if (panel) panel.style.display = r.policy.watermark ? '' : 'none'
  toast('界面水印 → ' + (r.policy.watermark ? '启用' : '停用') + '（员工端 10s 内跟随）')
}

/* ---- 水印样式：回显 + 自动保存（debounce 600ms）+ 恢复默认 ---- */
const WM_DEFAULTS = { template: '{user} · {time}', color: '#0f172a', opacity: 0.06, fontSize: 13, gapX: 260, gapY: 150, angle: -22 }
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
      toast('水印样式已保存，员工端 10s 内跟随')
    } catch (e) { if (e.message !== '401') toast('✗ 水印样式保存失败：' + e.message, 'bad') }
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
      toast('水印样式已恢复默认')
    } catch (e) { if (e.message !== '401') toast('✗ ' + e.message, 'bad') }
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
  } catch (e) { if (e.message !== '401') toast('✗ 插件仓库加载失败：' + e.message, 'bad') }
}

function renderRepo() {
  const tbody = $('repoBody')
  if (!tbody) return
  const q = ($('repoSearch')?.value ?? '').trim().toLowerCase()
  const rows = repoData.filter((p) => !q || p.name.toLowerCase().includes(q) || String(p.description ?? '').toLowerCase().includes(q))
  if ($('repoCount')) $('repoCount').textContent = `${repoData.length} 个`
  tbody.innerHTML = rows.map((p) => {
    const inAllow = allowItems.includes(p.name)
    return `
    <tr>
      <td colspan="7" style="padding:0;border-bottom:none">
        <div style="display:flex;align-items:center;gap:10px;padding:8px 12px;border-bottom:1px solid #f1f5f9">
          <div style="flex:1;min-width:0">
            <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
              <span class="mono" style="font-size:12px;font-weight:600;color:#0f172a">${esc(p.name)}</span>
              <span class="badge dim" style="font-size:10px">默认 v${esc(p.defaultVersion ?? '—')}</span>
              <span class="badge dim" style="font-size:10px">${p.versionCount} 个版本 · ${fmtSize(p.totalSize)}</span>
              ${inAllow ? '<span class="badge ok" style="font-size:10px">已入清单</span>' : ''}
            </div>
            <div style="font-size:11.5px;color:#64748b;margin-top:1px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(p.description)}">${esc(p.description) || '<span style="color:#cbd5e1">无描述 · 点「描述」补充（员工端市场显示）</span>'}</div>
          </div>
          <span class="mono" style="font-size:11px;color:#94a3b8;flex-shrink:0">${esc(p.updatedAt ?? '')}</span>
          <span style="white-space:nowrap;flex-shrink:0">
            <button class="btn sm" data-repo-ver="${esc(p.name)}">版本</button>
            <button class="btn sm" data-repo-allow="${esc(p.name)}" ${inAllow ? 'disabled title="已在允许清单"' : 'title="加入允许清单"'}>＋清单</button>
            <button class="btn sm" data-repo-desc="${esc(p.name)}">描述</button>
            <button class="btn sm danger" data-repo-del="${esc(p.name)}">删</button>
          </span>
        </div>
      </td>
    </tr>`
  }).join('') || '<tr><td colspan="7" class="empty">仓库为空 —— 点右上「＋ 添加插件」，输入 npm 地址或上传 .tgz</td></tr>'
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
    ok.disabled = true; ok.textContent = '添加中…'
    let r
    if (repoSrc === 'npm') {
      if (!$('repoSpec').value.trim()) { err.textContent = '请填写包名或 .tgz 地址'; return }
      r = await api('/admin/plugin-repo/npm', { method: 'POST', body: JSON.stringify({ spec: $('repoSpec').value.trim(), registry: $('repoRegistry').value.trim(), note }) })
    } else {
      const f = $('repoFile').files[0]
      if (!f) { err.textContent = '请选择 .tgz 压缩包'; return }
      r = await api('/admin/plugin-repo/upload?note=' + encodeURIComponent(note), {
        method: 'POST', body: await f.arrayBuffer(),
        headers: { 'content-type': 'application/octet-stream' },
      })
    }
    $('repoAddResult').style.display = ''
    $('repoAddResult').innerHTML = `✓ 已入库 <b class="mono">${esc(r.name)}@${esc(r.version)}</b>，可点行内「＋清单」加入允许清单`
    toast(`插件已入库：${r.name}@${r.version}`)
    loadRepo()
  } catch (e) { if (e.message !== '401') err.textContent = e.message } finally { ok.disabled = false; ok.textContent = '添加' }
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
  $('rvDesc').textContent = p.description || '（未填）'
  $('rvBody').innerHTML = Object.entries(p.versions ?? {}).sort((a, b) => verCmpJs(a[0], b[0])).map(([v, meta]) => `
    <tr>
      <td style="white-space:nowrap"><span class="mono" style="font-size:12px">${esc(v)}</span>${v === p.defaultVersion ? ' <span class="badge ok">默认</span>' : ''}</td>
      <td class="mono" style="font-size:12px">${fmtSize(meta.size)}</td>
      <td><span class="badge dim">${meta.source === 'npm' ? 'npm' : '上传'}</span></td>
      <td style="font-size:12px">${esc(meta.by || '-')}</td>
      <td class="mono" style="font-size:11.5px;color:#94a3b8;white-space:nowrap">${esc(meta.ts ?? '')}</td>
      <td style="font-size:12px;color:#64748b;max-width:150px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(meta.note ?? '')}">${esc(meta.note) || '—'}</td>
      <td style="white-space:nowrap">
        ${v === p.defaultVersion ? '' : `<button class="btn sm" data-rv-default="${esc(v)}">设默认</button>`}
        <button class="btn sm danger" data-rv-del="${esc(v)}">删</button>
      </td>
    </tr>`).join('') || '<tr><td colspan="7" class="empty">无版本</td></tr>'
}

async function repoVerAction(act, arg) {
  const name = act === 'delPlugin' ? arg : repoVerCur
  const ver = act === 'delPlugin' ? '' : arg
  try {
    if (act === 'default') {
      await api('/admin/plugin-repo/' + encodeURIComponent(name), { method: 'PATCH', body: JSON.stringify({ defaultVersion: ver }) })
      toast(`默认版本 → ${ver}`)
    } else if (act === 'del') {
      if (!confirm(`删除版本 ${ver}？包文件一并删除，不可恢复。`)) return
      await api(`/admin/plugin-repo/${encodeURIComponent(name)}/${encodeURIComponent(ver)}`, { method: 'DELETE' })
      toast(`已删除版本 ${ver}`)
    } else if (act === 'delPlugin') {
      await api('/admin/plugin-repo/' + encodeURIComponent(name), { method: 'DELETE' })
      toast(`已删除插件 ${name}`)
    }
    const d = await api('/admin/plugin-repo')
    repoData = d.plugins ?? []
    renderRepo()
    if (act !== 'delPlugin') fillRepoVerDlg()
  } catch (e) { if (e.message !== '401') toast('✗ ' + e.message, 'bad') }
}

/* ---- 描述编辑弹窗 ---- */
function openRepoDesc(name) {
  repoDescCur = name
  const p = repoData.find((x) => x.name === name)
  $('rdName').textContent = name
  $('rdText').value = p?.description ?? ''
  $('rdErr').textContent = ''
  openDlg($('repoDescDlg'))
  $('rdText').focus()
}

async function submitRepoDesc() {
  try {
    await api('/admin/plugin-repo/' + encodeURIComponent(repoDescCur), { method: 'PATCH', body: JSON.stringify({ description: $('rdText').value.trim() }) })
    closeDlg($('repoDescDlg'))
    toast('描述已保存')
    loadRepo()
    if (repoVerCur === repoDescCur) fillRepoVerDlg()
  } catch (e) { if (e.message !== '401') $('rdErr').textContent = e.message }
}

/* ---------- 允许清单（列表化编辑 · 改动自动保存下发） ---------- */
let allowItems = []   // ['dsh-enterprise', ...]

const NAME_HINT = '插件名限 2-64 位字母数字_-，可带 @组织/'
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
      if (pluginRegistry.mode === 'proxy' && !pluginRegistry.npmRegistryUrl) { if (msg) msg.textContent = '✗ proxy 模式需要填写 NPM 镜像地址'; return }
      if (pluginRegistry.mode === 'url' && !pluginRegistry.packagePrefix) { if (msg) msg.textContent = '✗ url 模式需要填写包地址前缀'; return }
      if (msg) msg.textContent = '保存中…'
      await api('/admin/policy', { method: 'PATCH', body: JSON.stringify({ policy: { allowedPlugins: allowItems.slice(), pluginRegistry } }) })
      if (msg) msg.textContent = '已自动保存 ✓ ' + new Date().toLocaleTimeString('zh-CN', { hour12: false })
    } catch (e) {
      if (e.message !== '401' && msg) msg.textContent = '✗ 保存失败：' + e.message
    }
  }
  clearTimeout(plugSaveTimer)
  if (immediate) return run()
  plugSaveTimer = setTimeout(run, 600)
}

/* ---- 清单项 → 入库企业插件仓库（反向：清单里的包名从 npm 拉进仓库） ---- */
async function allowToRepo(name) {
  if (name === 'dsh-enterprise') { toast('dsh-enterprise 由 file: 链接部署，无需入库', 'bad'); return }
  if (allowRepoBusy.has(name)) return
  allowRepoBusy.add(name)
  try {
    const r = await api('/admin/plugin-repo/npm', { method: 'POST', body: JSON.stringify({ spec: name }) })
    toast(`已入库：${r.name}@${r.version}`)
    loadRepo()
  } catch (e) {
    if (e.message !== '401') toast('入库失败：' + e.message, 'bad')
  } finally {
    allowRepoBusy.delete(name)
  }
}
const allowRepoBusy = new Set()

function renderAllowList() {
  const box = $('allowList')
  if (!box) return
  $('allowCount').textContent = allowItems.length
  box.innerHTML = allowItems.map((n, i) => {
    const repo = repoData.find((x) => x.name === n)
    const desc = repo?.description ?? ''
    const ver = repo?.defaultVersion ?? ''
    return `
    <div style="display:flex;align-items:center;gap:10px;padding:6px 12px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px">
      <div style="flex:1;min-width:0">
        <div style="display:flex;align-items:center;gap:8px">
          <span class="mono" style="font-size:12px;font-weight:600;color:#0f172a">${esc(n)}</span>
          ${ver ? `<span class="badge dim" style="font-size:10px">v${esc(ver)}</span>` : ''}
          ${n === 'dsh-enterprise' ? '<span class="badge ok" title="企业必装组件，删除后员工端登录与策略失效">必装</span>' : ''}
        </div>
        <div style="font-size:11.5px;color:#64748b;margin-top:1px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${desc ? esc(desc) : '<span style="color:#cbd5e1">未入库 · 无描述</span>'}</div>
      </div>
      <button class="btn sm" data-allow-repo="${esc(n)}" style="padding:1px 8px;font-size:11px" title="${repo ? '已在仓库，可管理版本与描述' : '从 npm 拉进企业插件仓库'}">${repo ? '已入库' : '入库'}</button>
      <button class="btn sm danger" data-allow-del="${i}" style="padding:1px 8px;font-size:11px">移除</button>
    </div>`
  }).join('') || '<div style="font-size:12px;color:#94a3b8;padding:6px 2px">清单为空 = 不限制（员工可装任意插件）</div>'
}

function allowAdd(raw) {
  const err = $('allowErr')
  err.textContent = ''
  const name = String(raw ?? '').trim()
  if (!name) return
  if (!/^(@[a-zA-Z0-9_-]{1,64}\/)?[a-zA-Z0-9_-]{2,64}$/.test(name)) { err.textContent = '格式不对：' + NAME_HINT; return }
  if (allowItems.includes(name)) { err.textContent = '已在清单中：' + name; return }
  allowItems.push(name)
  $('allowInput').value = ''
  renderAllowList()
  autoSavePlug(true)
}

function allowRemove(i) {
  const name = allowItems[i]
  if (name === 'dsh-enterprise' && !confirm('移除 dsh-enterprise 后员工端登录与策略失效，确定？')) return
  allowItems.splice(i, 1)
  renderAllowList()
  autoSavePlug(true)
}

/* ---- ＋清单：把仓库名追加进允许清单（自动保存下发） ---- */
function allowFromRepo(name) {
  if (allowItems.includes(name)) { toast('允许清单里已有 ' + name); return }
  allowItems.push(name)
  renderAllowList()
  autoSavePlug(true)
  toast(`已加入允许清单：${name}（已自动下发）`)
}

/* ---------- 企业插件源（子页 2） ---------- */
function syncRegFields() {
  const mode = $('regMode').value
  const builtin = mode === 'url' && $('regBuiltin').checked
  $('regUrl').disabled = mode !== 'proxy'
  $('regPrefix').disabled = mode !== 'url' || builtin
  if (builtin && !$('regPrefix').value.trim()) $('regPrefix').value = location.origin + '/plugin-packages/'
  const hint = $('regHint')
  if (hint) hint.textContent = mode === 'off'
    ? 'off = 不干预：员工端安装插件直接走社区 npm 源，不做任何改写'
    : mode === 'proxy'
      ? 'proxy = 员工安装插件时自动追加 --registry=' + ($('regUrl').value.trim() || '<镜像地址>') + '；需要先在企业内网部署 npm 私服（Verdaccio / Nexus 等）'
      : builtin
        ? 'url + 内置仓库 = 员工端直接从本网关下载上方插件仓库里的包，无需额外部署文件服务'
        : 'url = 员工安装时直接从 ' + ($('regPrefix').value.trim() || '<前缀>') + '<插件包名> 下载 .tgz；前缀必须以 http(s):// 或 file:// 开头'
}

/* ---------- 客户端自助规则（子页 3） ---------- */
const RULE_TYPES = [
  { v: 'block-url', label: '拦网址' },
  { v: 'block-word', label: '拦关键词' },
  { v: 'notice', label: '公告' },
]

const RULE_PRESETS = {
  'block-url': { type: 'block-url', action: 'block', value: 'pan.baidu.com', message: '网盘类站点工作时段禁止访问，如有需要请联系 IT 审批' },
  'block-word': { type: 'block-word', action: 'warn', value: '内部资料|未公开', message: '检测到可能涉密的词语，请注意外发风险' },
  'notice': { type: 'notice', action: 'block', value: '【企业公告】本周六 20:00-22:00 网关例行维护，期间服务可能中断', message: '' },
}

const TYPE_META = {
  'block-url': { label: '网址', color: '#2563eb', bg: '#eff6ff', ph: '域名，多个用 | 分隔。例：github.com|pan.baidu.com', hint: '拦该域名及全部子域（员工端浏览器环境内）' },
  'block-word': { label: '关键词', color: '#b45309', bg: '#fffbeb', ph: '正则或关键词，多个用 | 分隔。例：内部资料|未公开', hint: '正则不区分大小写；非法时自动退化为包含匹配' },
  'notice': { label: '公告', color: '#1d4ed8', bg: '#eff6ff', ph: '公告全文，员工端原样展示', hint: '公告无需动作选择，员工端展示蓝底信息条' },
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
      <td class="mono" style="color:#94a3b8;font-size:11.5px">${String(i + 1).padStart(2, '0')}</td>
      <td style="white-space:nowrap"><span style="font-size:11px;font-weight:600;padding:2px 9px;border-radius:20px;white-space:nowrap;color:${meta.color};background:${meta.bg}">${meta.label}</span></td>
      <td style="white-space:nowrap">${r.type === 'notice' ? '<span style="font-size:11.5px;color:#94a3b8">—</span>' : `<span style="font-size:11px;font-weight:600;padding:2px 9px;border-radius:20px;${r.action !== 'warn' ? 'color:#b91c1c;background:#fef2f2' : 'color:#9a3412;background:#fff7ed'}">${r.action !== 'warn' ? '拦截' : '提醒'}</span>`}</td>
      <td class="mono" style="font-size:12px;max-width:340px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${v || '<i style="color:#cbd5e1">（空）</i>'}</td>
      <td style="font-size:12px;color:#64748b;max-width:240px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${m || '<i style="color:#cbd5e1">—</i>'}</td>
      <td style="white-space:nowrap">
        <button class="btn sm" data-rule-edit="${i}" title="编辑">编辑</button>
        <button class="btn sm danger" data-rule-del="${i}" title="删除">删</button>
      </td>
    </tr>`
  }).join('') || '<tr><td colspan="6" class="empty">暂无本地规则 —— 点「新增规则」创建第一条</td></tr>'
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
      for (const r of rules) { if (!r.value) { toast('有规则缺匹配值，未自动保存', 'bad'); return } }
      await api('/admin/policy', { method: 'PATCH', body: JSON.stringify({ policy: { clientRules: rules } }) })
      toast(`已自动保存：本地规则 ${rules.length} 条`)
    } catch (e) { if (e.message !== '401') toast('✗ 自动保存失败：' + e.message, 'bad') }
  }, 800)
}

function updateRuleCount() {
  const n = document.querySelectorAll('#rulesList tr[data-rule-idx]:not([hidden])').length
  const total = rulesData.length
  if ($('ruleCount')) $('ruleCount').textContent = n === total ? `${total} 条` : `${n} / ${total} 条`
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
  if (m < 1) return '刚刚'
  if (m < 60) return `${m} 分钟前`
  if (m < 1440) return `${Math.floor(m / 60)} 小时前`
  return `${Math.floor(m / 1440)} 天前`
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
    $('verGrayState').textContent = g?.version ? `灰度中：${g.version} @ ${g.percent}%` : '无灰度（全员 current）'
    $('verGrayState').style.color = g?.version ? '#d97706' : '#64748b'
    $('verGrayBtn').disabled = !verSelection
    $('verGrayBtn').textContent = verSelection ? `开始灰度 ${verSelection}` : '开始灰度'
    const summarize = (policy) => {
      if (!policy) return '—'
      const parts = []
      if (policy.clientRules !== undefined) parts.push(`规则 ${policy.clientRules.length} 条`)
      if (policy.watermark !== undefined) parts.push(policy.watermark ? '水印开' : '水印关')
      if (policy.lockModelConfig !== undefined) parts.push(policy.lockModelConfig ? '锁配置' : '不锁')
      if (policy.allowedPlugins !== undefined) parts.push(policy.allowedPlugins.length ? `插件白名单 ${policy.allowedPlugins.length}` : '插件不限')
      return parts.join(' · ') || '—'
    }
    $('verBody').innerHTML = (d.versions ?? []).map((v) => {
      const isGray = g?.version === v.version
      const isCur = d.current === v.version
      return `<tr>
        <td class="mono" style="font-size:12px;white-space:nowrap">${v.version}${isCur ? ' <span class="badge ok">当前</span>' : ''}${isGray ? ' <span class="badge warn">灰度中</span>' : ''}</td>
        <td class="mono" style="font-size:11.5px;color:#94a3b8;white-space:nowrap">${v.ts ?? ''}</td>
        <td style="font-size:12px;max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(v.note ?? '') || '—'}</td>
        <td style="font-size:12px;color:#64748b">${summarize(v.policy)}</td>
        <td style="white-space:nowrap">
          <button class="btn sm" data-ver-gray="${v.version}" ${isCur ? 'disabled title="当前版本无需灰度"' : ''}>选为灰度</button>
          <button class="btn sm" data-ver-rollback="${v.version}" title="把该版本内容写回当前策略">回滚到此</button>
        </td>
      </tr>`
    }).join('') || '<tr><td colspan="5" class="empty">暂无版本历史 —— 保存一次策略即产生</td></tr>'
  } catch (e) { if (e.message !== '401') toast('✗ 版本历史加载失败：' + e.message, 'bad') }
}

function bindVersions() {
  if (!$('verBody') || $('verBody').dataset.bound) return
  $('verBody').dataset.bound = '1'
  $('verBody').addEventListener('click', async (e) => {
    const g = e.target.closest('[data-ver-gray]')
    if (g) { verSelection = verSelection === g.dataset.verGray ? null : g.dataset.verGray; await renderVersions(); return }
    const rb = e.target.closest('[data-ver-rollback]')
    if (rb) {
      if (!confirm(`回滚到 ${rb.dataset.verRollback}？\n当前策略内容将被该版本快照覆盖（版本号继续递增）。`)) return
      try {
        const r = await api('/admin/policy-rollback', { method: 'POST', body: JSON.stringify({ version: rb.dataset.verRollback }) })
        toast(`已回滚，新版本 ${r.version}`)
        loadAll()
      } catch (e2) { if (e2.message !== '401') toast('✗ 回滚失败：' + e2.message, 'bad') }
    }
  })
  $('verGrayBtn')?.addEventListener('click', async () => {
    if (!verSelection) return
    const percent = Number($('verPercent')?.value)
    if (!Number.isInteger(percent) || percent < 0 || percent > 100) { toast('灰度比例须为 0-100 整数', 'bad'); return }
    try {
      await api('/admin/policy-gray', { method: 'POST', body: JSON.stringify({ version: verSelection, percent }) })
      toast(`灰度已开始：${verSelection} @ ${percent}%`)
      verSelection = null
      loadAll()
    } catch (e) { if (e.message !== '401') toast('✗ ' + e.message, 'bad') }
  })
  $('verPromoteBtn')?.addEventListener('click', async () => {
    try {
      await api('/admin/policy-promote', { method: 'POST', body: '{}' })
      toast('已转正：全员拉取当前版本')
      loadAll()
    } catch (e) { if (e.message !== '401') toast('✗ ' + e.message, 'bad') }
  })
  $('verCancelGrayBtn')?.addEventListener('click', async () => {
    try {
      await api('/admin/policy-gray', { method: 'POST', body: JSON.stringify({}) })
      toast('灰度已取消：全员拉取当前版本')
      loadAll()
    } catch (e) { if (e.message !== '401') toast('✗ ' + e.message, 'bad') }
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
    statTile('已回执设备 · 当前版本', curDevices, '台') +
    statTile('近 24h 在线终端', online, '台') +
    statTile('灰度覆盖率', pct === null ? '—' : pct + '%', '已回执 ÷ 在线') +
    statTile('回执版本数', versions.length, `累计明细 ${ackRows.length} 条`)
  const badge = $('ackSummaryBadge')
  if (pct === null) { badge.className = 'badge dim'; badge.textContent = '暂无在线终端可比' }
  else {
    badge.className = 'badge ' + (pct >= 80 ? 'ok' : 'warn')
    badge.textContent = `当前版本覆盖 ${pct}%`
  }

  /* 按版本聚合条 */
  $('ackVersionBars').innerHTML = versions.map((v) => {
    const isCur = v.policy_version === ackCurVer
    const vp = online > 0 ? Math.min(100, Math.round((v.devices / online) * 100)) : 0
    return `<div class="chan">
      <span class="nm"><span class="mono">${esc(v.policy_version)}</span> ${isCur ? '<span class="badge ok">当前</span>' : '<span class="badge dim">历史</span>'}</span>
      <div class="bar"><i style="width:${vp}%;background:${isCur ? 'var(--ok)' : '#94a3b8'}"></i></div>
      <span class="mono" style="white-space:nowrap;flex-shrink:0">${v.devices} 台 / ${v.acks} 条 · ${vp}%</span>
      <span class="crumb" style="margin:0;white-space:nowrap;flex-shrink:0" title="最早 ${esc(v.first_local ?? '')}">最近 ${ago(v.last_local)}</span>
    </div>`
  }).join('') || '<div class="empty">暂无任何回执 —— 员工端拉取到新版策略并本地生效后会自动上报</div>'

  /* 待回执设备 */
  const pending = d.pendingAcks ?? []
  const pc = $('ackPendingCount')
  pc.textContent = pending.length ? `${pending.length} 台待回执` : '当前版本已全部覆盖'
  pc.className = 'badge ' + (pending.length ? 'warn' : 'ok')
  $('ackPendingBody').innerHTML = pending.map((x) => {
    const got = x.hb_version === ackCurVer
    return `<tr>
      <td>${esc(x.account || '-')}</td>
      <td class="mono">${esc(x.profile || '-')}</td>
      <td class="mono">${esc(x.hb_version || '-')}</td>
      <td>${got ? '<span class="badge warn">已拉到新版 · 回执未达</span>' : '<span class="badge dim">未拉到新版</span>'}</td>
      <td class="mono">${esc(x.env || '-')}</td>
      <td class="mono">${esc(x.node_version || '-')}</td>
      <td class="mono" title="${esc(x.last_seen_local ?? '')}">${esc(x.last_seen_local ?? '-')}<span class="crumb" style="margin:0;display:block">${ago(x.last_seen_local)}</span></td>
      <td class="mono" title="${esc(x.device_hash ?? '')}">${esc(shortDev(x.device_hash))}</td>
    </tr>`
  }).join('') || '<tr><td colspan="8" class="empty">近 24 小时在线的终端都已对当前版本回执 ✓</td></tr>'

  renderAckRows()
}

function renderAckRows() {
  if (!$('ackBody')) return
  const verSel = $('ackVerFilter')
  const vf = verSel.value
  // 版本下拉：全部版本 + 计数，保留当前选中项
  const vers = [...new Set(ackRows.map((a) => a.policy_version))]
  verSel.innerHTML = `<option value="">全部版本（${vers.length}）</option>` +
    vers.map((v) => `<option value="${esc(v)}" ${v === vf ? 'selected' : ''}>${esc(v)}${v === ackCurVer ? '（当前）' : ''} · ${ackRows.filter((a) => a.policy_version === v).length} 条</option>`).join('')
  const q = $('ackSearch').value.trim().toLowerCase()
  const rows = ackRows.filter((a) =>
    (!vf || a.policy_version === vf) &&
    (!q || [a.account, a.profile, a.device_hash, a.policy_version].some((x) => String(x ?? '').toLowerCase().includes(q))))
  $('ackCount').textContent = ackRows.length ? (rows.length === ackRows.length ? `最近 ${rows.length} 条` : `${rows.length} / ${ackRows.length} 条`) : ''
  $('ackBody').innerHTML = rows.map((a) => {
    const isCur = a.policy_version === ackCurVer
    return `<tr>
      <td class="mono" title="${esc(a.ts_local ?? '')}">${esc(a.ts_local ?? '-')}<span class="crumb" style="margin:0;display:block">${ago(a.ts_local)}</span></td>
      <td>${esc(a.account || '-')}</td>
      <td class="mono">${esc(a.profile || '-')}</td>
      <td><span class="mono">${esc(a.policy_version || '-')}</span> ${isCur ? '<span class="badge ok">当前</span>' : ''}</td>
      <td class="mono">${esc(a.env || '-')}</td>
      <td class="mono">${esc(a.node_version || '-')}</td>
      <td class="mono" title="${esc(a.device_hash ?? '')}">${esc(shortDev(a.device_hash))}</td>
      <td class="mono" title="${esc(a.last_seen_local ?? '')}">${esc(a.last_seen_local ?? '-')}</td>
    </tr>`
  }).join('') || `<tr><td colspan="8" class="empty">${ackRows.length ? '没有匹配筛选条件的回执' : '暂无回执 —— 等员工端生效新版策略后自动上报'}</td></tr>`
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
  if (text) toast('✗ ' + text, 'bad')
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
    if (!Number.isInteger(num(id)) || num(id) < 1 || num(id) > 1440) return showSaveErr(msg, '登录保护参数须为 1-1440 的整数')
  }
  await doSave(msg, {
    loginProtection: {
      enabled: $('swLoginProt').classList.contains('on'),
      maxFails: num('lpMaxFails'),
      windowMin: num('lpWindow'),
      lockMin: num('lpLock'),
    },
  }, '已保存：登录保护')
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
    toast(`横幅样式已保存：${bannerPosition}`)
    loadAll()
  } catch (e) { if (err) err.textContent = e.message; if (e.message !== '401') toast('✗ ' + e.message, 'bad') }
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
    $('regFallback').addEventListener('change', () => autoSavePlug(true))
  }
  /* ---- 允许清单（列表化编辑 + 自动保存） ---- */
  if ($('allowList')) {
    $('allowAddBtn').addEventListener('click', () => allowAdd($('allowInput').value))
    $('allowInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') allowAdd($('allowInput').value) })
    $('allowList').addEventListener('click', (e) => {
      let el
      if ((el = e.target.closest('[data-allow-del]'))) allowRemove(Number(el.dataset.allowDel))
      else if ((el = e.target.closest('[data-allow-repo]'))) allowToRepo(el.dataset.allowRepo)
    })
  }
  /* ---- 仓库卡片 + 三个弹窗 ---- */
  if ($('repoAddBtn')) {
    $('repoAddBtn').addEventListener('click', openRepoAdd)
    $('repoAddOk').addEventListener('click', submitRepoAdd)
    $('repoSrcNpm').addEventListener('click', () => setRepoSrc('npm'))
    $('repoSrcUp').addEventListener('click', () => setRepoSrc('upload'))
    $('repoSearch').addEventListener('input', renderRepo)
    $('repoBody').addEventListener('click', (e) => {
      let el
      if ((el = e.target.closest('[data-repo-ver]'))) openRepoVer(el.dataset.repoVer)
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
    openRuleEdit(noticeIdx >= 0 ? noticeIdx : -1, noticeIdx >= 0 ? '公告已存在，直接编辑当前公告' : undefined)
  })

  // —— 列表事件委托：编辑 / 删除 / 点行打开编辑
  if ($('rulesList')) {
    $('rulesList').addEventListener('click', (e) => {
      const del = e.target.closest('[data-rule-del]')
      if (del) {
        const i = Number(del.dataset.ruleDel)
        const r = rulesData[i]
        const brief = String(r?.value ?? '').trim().slice(0, 24) || '（空规则）'
        if (confirm(`删除这条规则？\n${brief}`)) {
          rulesData.splice(i, 1)
          if ($('ruleFilter')) $('ruleFilter').value = ''
          if ($('ruleTypeFilter')) $('ruleTypeFilter').value = ''
          renderRulesTable()
          markRulesDirty()
          toast('已删除，自动保存中…')
        }
        e.stopPropagation()
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
  if ($('ruleEditOk')) $('ruleEditOk').addEventListener('click', () => {
    const err = $('ruleEditErr'); err.textContent = ''
    const value = $('reValue').value.trim()
    if (!value) { err.textContent = '匹配值（value）不能为空'; $('reValue').focus(); return }
    const type = $('reType').value
    if (type === 'block-word') { try { new RegExp(value) } catch { if (!confirm('正则不合法（会退化为包含匹配），仍要保存吗？')) return } }
    const rule = { type, action: type === 'notice' ? 'block' : $('reAction').value, value, message: $('reMsg').value.trim() }
    if (ruleEditIdx >= 0) rulesData[ruleEditIdx] = rule
    else if (type === 'notice' && rulesData.some((r) => r.type === 'notice')) {
      // 公告只保留一条：已有公告时新增 = 替换旧公告（位置也在旧公告处）
      const idx = rulesData.findIndex((r) => r.type === 'notice')
      rulesData[idx] = rule
      toast('已有公告已替换为新的（公告仅保留一条）')
    } else {
      rulesData.push(rule)
    }
    closeDlg($('ruleEditDlg'))
    // 清空筛选，避免"新增/改类型的行被过滤隐藏"造成没生效的错觉
    if ($('ruleFilter')) $('ruleFilter').value = ''
    if ($('ruleTypeFilter')) $('ruleTypeFilter').value = ''
    renderRulesTable()
    markRulesDirty()
    toast(ruleEditIdx >= 0 ? `已修改第 ${ruleEditIdx + 1} 条，自动保存中…` : '已添加，自动保存中…')
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
    w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>横幅样式预览</title></head>
      <body style="margin:0;background:#eef1f6;font-family:system-ui">
        <div style="${posCss}position:fixed;max-width:${bs.maxWidth}px;padding:11px 40px 11px 16px;border-radius:10px;background:#fff7ed;border:1.5px solid #fb923c;box-shadow:0 10px 34px rgba(0,0,0,.16);font-size:13.5px;line-height:1.55;color:#9a3412;display:flex;align-items:flex-start;gap:8px">
          <span style="font-size:16px;flex-shrink:0">⚠️</span>
          <span style="word-break:break-word">样式预览：检测到关键词 <b>示例</b>，请注意外发风险（宽 ${bs.maxWidth}px）</span>
        </div>
        <div style="padding:16px;color:#94a3b8;font-size:12px">预览窗口 —— 保存后员工端下一次弹出即生效。</div>
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
  $('ruleEditTitle').textContent = idx >= 0 ? `编辑规则 #${String(idx + 1).padStart(2, '0')}` : '新增规则'
  $('reType').value = preset.type ?? 'block-url'
  $('reAction').value = preset.action === 'warn' ? 'warn' : 'block'
  $('reValue').value = preset.value ?? ''
  $('reMsg').value = preset.message ?? ''
  $('ruleEditErr').textContent = noticeTip ?? ''
  if (noticeTip) $('ruleEditErr').style.color = '#2563eb'   // 提示用蓝色区别于错误红
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
  const word = '示例'
  const msg = $('reMsg').value.trim()
  const text = msg.includes('[]') ? msg.replaceAll('[]', word) : (msg ? msg + '（' + word + '）' : '检测到敏感内容（' + word + '）')
  const blocked = $('reAction').value !== 'warn'
  pv.style.display = ''
  pv.style.background = blocked ? '#fef2f2' : '#fff7ed'
  pv.style.borderColor = blocked ? '#ef4444' : '#fb923c'
  pv.style.color = blocked ? '#b91c1c' : '#9a3412'
  pv.innerHTML = (blocked ? '⛔ ' : '⚠️ ') + esc(text) + '<span style="float:right;font-size:11px;opacity:.7">（' + (blocked ? '拦截' : '提醒') + '效果示意）</span>'
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
    if (!visible && rulesData.length) list.insertAdjacentHTML('beforeend', '<tr class="rule-filter-empty"><td colspan="6" class="empty">没有匹配的规则</td></tr>')
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

