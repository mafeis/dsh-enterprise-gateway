/**
 * 插件页面 · 样式规范（原壳 views/pages/design.html）
 * 零数据依赖：插件作者的可视化活样册（令牌与组件类，对齐 docs/admin-plugin-pages.zh.md §5）
 */
import { $, icon, openDlg } from '/admin/static/contract.mjs'
import { T } from '/admin/static/js/i18n.mjs'

let bound = false

/** 弹窗试衣间单档：标题常驻徽章 + 实时像素尺寸 + 统一 foot（档位=sm/md/lg/wide，bench 结构特殊单独写） */
function dlgDemo(size, title, sub, bodyHtml) {
  return `
  <div class="dlg-mask" id="dlgDemo-${size}" hidden>
    <div class="dlg ${size}" role="dialog" aria-modal="true">
      <div class="dlg-head">
        <div>
          <h3><span class="bar"></span>${title} <span class="badge dim" data-dlg-dim></span></h3>
          <div class="dlg-sub">${sub}</div>
        </div>
        <button class="dlg-x" data-dlg-close title="${T('关闭 (Esc)', 'Close (Esc)')}">${icon('x', { size: 16 })}</button>
      </div>
      <div class="dlg-body">${bodyHtml}</div>
      <div class="dlg-foot">
        <button class="btn" data-dlg-close>${T('取消', 'Cancel')}</button>
        <button class="btn primary" data-dlg-close>${T('保存', 'Save')}</button>
      </div>
    </div>
  </div>`
}

/** bench 档（工作台）：无 dlg-foot；工具条/汇总/底部提示常驻在滚动区外，仅中间 .probe-scroll 滚动 */
function dlgDemoBench() {
  return `
  <div class="dlg-mask" id="dlgDemo-bench" hidden>
    <div class="dlg bench" role="dialog" aria-modal="true">
      <div class="dlg-head">
        <div>
          <h3><span class="bar"></span>${T('bench · 工作台', 'bench · Workbench')} <span class="badge dim" data-dlg-dim></span></h3>
          <div class="dlg-sub">${T('工具条与底部提示常驻，仅中间滚动', 'Toolbar and footer pinned, only the middle scrolls')}</div>
        </div>
        <button class="dlg-x" data-dlg-close title="${T('关闭 (Esc)', 'Close (Esc)')}">${icon('x', { size: 16 })}</button>
      </div>
      <div class="toolbar">
        <select class="input" style="padding:4px 8px;font-size:12.5px"><option>${T('全部模型', 'All models')}</option><option>${T('仅真思考', 'Real thinking only')}</option></select>
        <span class="dim2">${T('逐档测试档位：', 'Test tiers:')}</span>
        <span class="badge">off</span><span class="badge">low</span><span class="badge">medium</span><span class="badge">high</span>
        <input class="input" placeholder="${T('自定义档位名…', 'Custom tier name…')}" style="width:130px;padding:3px 8px;font-size:12px">
        <button class="btn sm">${T('＋添加', '+ Add')}</button><button class="btn sm">${T('设为默认', 'Set default')}</button>
      </div>
      <div class="sub">${T('4 个模型 · 已导入 4 · 20ms —— 工具条/汇总在滚动区外常驻', '4 models · 4 imported · 20ms — toolbar and summary pinned outside the scroll area')}</div>
      <div class="dlg-body probe-scroll">
        <div class="pcard-grid">
          ${['glm-5.3-flash', 'qwen-omni', 'deepseek-v4', 'kimi-k3'].map((m) => `
          <div class="pcard">
            <div class="pcard-head">
              <div class="pcard-title"><span class="mname mono">${m}</span><span class="dim2">${T('128k 上下文', '128k context')}</span></div>
              <div class="pcard-flags"><span class="badge ok">${T('已导入', 'Imported')}</span></div>
            </div>
            <div class="pcard-judge"><span class="badge ok">${T('✓ 支持思考', '✓ Thinking')}</span><span class="dim2">off/low/medium/high · 890ms</span></div>
            <div class="pcard-foot"><button class="btn sm">${T('逐档测试', 'Test tiers')}</button><button class="btn sm primary">${T('应用', 'Apply')}</button></div>
          </div>`).join('')}
        </div>
      </div>
      <div class="hint">${T('「逐档测试」按勾选档位真实发送小请求，测完可「应用」到企业模型目录。', '"Test tiers" sends a small real request per checked tier; then "Apply" to the enterprise model catalog')}</div>
    </div>
  </div>`
}

export default {
  page: 'ent-design',
  html: `
  <div class="headrow">
    <div><h1>${T('样式规范', 'Style Guide')}</h1></div>
  </div>
  <div class="crumb">${T('统一设计系统活样册 · 插件页面只准用本页展示的令牌与组件类', 'Unified design-system sample book · plugin pages use only the tokens and component classes shown here')}</div>

  <div class="grid2">
    <div class="card">
      <h2><span class="bar"></span>${T('设计令牌（CSS 变量）', 'Design tokens (CSS vars)')}</h2>
      <div class="sub">${T('插件页面禁止硬编码颜色，一律 var() 引用', 'No hardcoded colors in plugin pages, always use var()')}</div>
      <table>
        <thead><tr><th>${T('令牌', 'Token')}</th><th>${T('值', 'Value')}</th><th>${T('用途', 'Usage')}</th></tr></thead>
        <tbody>
          <tr><td class="mono">--accent</td><td><span class="sw" style="background:var(--accent)"></span>#2563eb</td><td>${T('主色：竖条、主按钮、链接', 'Primary: bars, primary buttons, links')}</td></tr>
          <tr><td class="mono">--ok</td><td><span class="sw" style="background:var(--ok)"></span>#059669</td><td>${T('成功/正常', 'Success / normal')}</td></tr>
          <tr><td class="mono">--warn</td><td><span class="sw" style="background:var(--warn)"></span>#d97706</td><td>${T('警告/外部', 'Warning / external')}</td></tr>
          <tr><td class="mono">--bad</td><td><span class="sw" style="background:var(--bad)"></span>#dc2626</td><td>${T('危险/失败', 'Danger / failure')}</td></tr>
          <tr><td class="mono">--txt / --dim</td><td>—</td><td>${T('正文 / 次要文字', 'Body / secondary text')}</td></tr>
          <tr><td class="mono">--card / --line / --bg</td><td>—</td><td>${T('卡片底 / 边框 / 页面底', 'Card bg / border / page bg')}</td></tr>
        </tbody>
      </table>
    </div>

    <div class="card">
      <h2><span class="bar"></span>${T('徽章与分层', 'Badges and layers')}</h2>
      <div class="sub">${T('状态徽章语义色只做小面积 · 插件分层徽章固定配色', 'Semantic status badges stay small · layer badges use fixed colors')}</div>
      <div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-bottom:12px">
        <span class="badge">${T('默认', 'Default')}</span><span class="badge ok">${T('成功', 'Success')}</span><span class="badge warn">${T('警告', 'Warning')}</span><span class="badge bad">${T('失败', 'Failure')}</span><span class="badge dim">${T('次要', 'Secondary')}</span>
      </div>
      <div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center">
        <span class="layer l-meta">${T('元插件', 'Meta')}</span><span class="layer l-biz">${T('业务', 'Business')}</span><span class="layer l-collab">${T('协作', 'Collab')}</span><span class="layer l-ui">${T('界面', 'UI')}</span><span class="layer l-ext">${T('外部', 'External')}</span>
      </div>
    </div>
  </div>

  <div class="card">
    <h2><span class="bar"></span>${T('按钮', 'Buttons')}</h2>
    <div class="sub">${T('主操作每屏最多一个 primary · danger 仅破坏性操作 · sm 用于表格行内', 'At most one primary per screen · danger only for destructive · sm for table rows')}</div>
    <div style="display:flex;flex-wrap:wrap;gap:10px;align-items:center">
      <button class="btn primary">${T('主操作', 'Primary')}</button>
      <button class="btn">${T('普通操作', 'Default')}</button>
      <button class="btn danger">${T('危险操作', 'Destructive')}</button>
      <button class="btn sm">${T('行内小按钮', 'Inline sm')}</button>
      <button class="btn sm danger">${T('行内危险', 'Inline danger')}</button>
      <button class="btn" disabled>${T('禁用态', 'Disabled')}</button>
    </div>
  </div>

  <div class="card">
    <h2><span class="bar"></span>${T('表格与输入', 'Tables and inputs')}</h2>
    <div class="sub">${T('表头浅灰底 · 行分隔线 --line · 数字列 .num · 等宽列 .mono · 空态 .empty', 'Light gray header · row rule --line · .num numeric · .mono monospace · .empty for empty state')}</div>
    <table>
      <thead><tr><th>${T('名称', 'Name')}</th><th class="num">${T('数量', 'Count')}</th><th>${T('标识', 'ID')}</th><th>${T('操作', 'Actions')}</th></tr></thead>
      <tbody>
        <tr><td><b>${T('示例行', 'Example row')}</b></td><td class="num">1,024</td><td class="mono">ent-example</td><td><button class="btn sm">${T('详情', 'Details')}</button></td></tr>
        <tr><td>${T('次行', 'Second row')}</td><td class="num">7</td><td class="mono crumb">${T('次要信息', 'Secondary info')}</td><td><button class="btn sm danger">${T('删', 'Delete')}</button></td></tr>
      </tbody>
    </table>
    <div style="display:flex;gap:10px;margin-top:12px;align-items:center">
      <input class="input" placeholder="${T('输入框 .input', 'Input .input')}" style="width:180px">
      <select><option>${T('下拉 select', 'Select')}</option></select>
      <span class="empty" style="padding:0">${T('空态用 .empty', 'Empty uses .empty')}</span>
    </div>
  </div>

  <div class="card">
    <h2><span class="bar"></span>${T('业务弹窗规范（.dlg-*）', 'Dialog spec (.dlg-*)')}</h2>
    <div class="sub">${T('右上角 × / Esc 关闭 · 点弹窗外空白不关 · 标题常驻', 'Close via × / Esc · outside click will not close · title pinned')}</div>
    <table>
      <thead><tr><th>${T('档位', 'Size')}</th><th class="num">${T('宽度', 'Width')}</th><th>${T('适用场景', 'Use case')}</th></tr></thead>
      <tbody>
        <tr><td class="mono">.dlg.sm</td><td class="num">460px</td><td>${T('单字段 / 设置面', 'Single field / settings')}</td></tr>
        <tr><td class="mono">.dlg.md</td><td class="num">640px</td><td>${T('紧凑表单 / 中等详情', 'Compact form / medium detail')}</td></tr>
        <tr><td class="mono">.dlg.lg</td><td class="num">880px</td><td>${T('分区表单', 'Grouped form')}</td></tr>
        <tr><td class="mono">.dlg.wide</td><td class="num">1100px</td><td>${T('长文本详情', 'Long-text detail')}</td></tr>
        <tr><td class="mono">.dlg.bench</td><td class="num">1240px</td><td>${T('多卡并排工作台（× min(860px,92vh)）', 'Multi-card workbench (× min(860px,92vh))')}</td></tr>
      </tbody>
    </table>
    <pre class="codeblock">&lt;div class="dlg-mask" id="xxxDlg" hidden&gt;
  &lt;div class="dlg md" role="dialog" aria-modal="true"&gt;
    &lt;div class="dlg-head"&gt;
      &lt;h3&gt;${T('标题（常驻，只有 .dlg-body 滚动）', 'Title (pinned, only .dlg-body scrolls)')}&lt;/h3&gt;
      &lt;button class="dlg-x" data-dlg-close title="${T('关闭 (Esc)', 'Close (Esc)')}"&gt;&lt;/button&gt;
    &lt;/div&gt;
    &lt;div class="dlg-body"&gt;…${T('唯一滚动区', 'the only scroll area')}…&lt;/div&gt;
    &lt;div class="dlg-foot"&gt;…${T('取消加 data-dlg-close', 'cancel gets data-dlg-close')}…&lt;/div&gt;
  &lt;/div&gt;
&lt;/div&gt;

openDlg($('xxxDlg'))   // ${T('打开（锁页面滚动）', 'open (locks page scroll)')}
closeDlg($('xxxDlg'))  // ${T('关闭；危险确认一律走契约 confirmDlg', 'close; destructive confirm always uses contract confirmDlg')}</pre>
    <div style="margin-top:12px;display:flex;gap:10px;align-items:center;flex-wrap:wrap">
      <button class="btn sm" data-dlg-demo="sm">▶ sm · 460</button>
      <button class="btn sm" data-dlg-demo="md">▶ md · 640</button>
      <button class="btn sm" data-dlg-demo="lg">▶ lg · 880</button>
      <button class="btn sm" data-dlg-demo="wide">▶ wide · 1100</button>
      <button class="btn sm" data-dlg-demo="bench">▶ bench · 1240</button>
      <span class="dim2">${T('点档位打开对应弹窗实测（左上角徽章显示实时像素尺寸）· 右上角 × / Esc 关闭 · 点弹窗外空白不关', 'Click a size to open its dialog (badge shows live pixel size) · close via × / Esc · outside click will not close')}</span>
    </div>
  </div>

  <div class="card">
    <h2><span class="bar"></span>${T('页面骨架约定', 'Page skeleton')}</h2>
    <div class="sub">${T('插件页面 html 的标准结构（data-ent-page 锚点必带）', 'Standard html structure for plugin pages (data-ent-page anchor required)')}</div>
    <pre class="codeblock">&lt;div class="headrow" data-ent-page="ent-xxx"&gt;
  &lt;div&gt;&lt;h1&gt;${T('页面标题', 'Page title')}&lt;/h1&gt;&lt;/div&gt;
  &lt;span class="badge" id="xxxSummary"&gt;&lt;/span&gt;
&lt;/div&gt;
&lt;div class="crumb"&gt;${T('一句话说明本页看什么', 'One-line description of this page')}&lt;/div&gt;
&lt;div class="card"&gt;
  &lt;h2&gt;&lt;span class="bar"&gt;&lt;/span&gt;${T('区块标题', 'Section title')} &lt;span class="badge"&gt;${T('计数', 'Count')}&lt;/span&gt;&lt;/h2&gt;
  &lt;div class="sub"&gt;${T('区块补充说明', 'Section note')}&lt;/div&gt;
  &lt;table&gt;…&lt;/table&gt;
&lt;/div&gt;</pre>
  </div>

  <!-- 弹窗试衣间：五档尺寸 × 真实内容形态，点击上面对应按钮打开 -->
  ${dlgDemo('sm', T('sm · 设置面', 'sm · Settings'), T('展示设置 / 单字段编辑', 'Settings / single-field edit'), `
    <div class="ov-set-row"><span class="ov-sec-label">${T('默认每页条数', 'Rows per page')}</span>
      <select class="ov-sec-mode"><option>${T('30 条/页', '30 / page')}</option></select></div>
    <div class="ov-set-row"><span class="ov-sec-label">${T('CSV 导出上限', 'CSV export limit')}</span>
      <input class="input" value="200" style="width:80px;padding:3px 6px"></div>
    <div class="ov-set-row"><span class="ov-sec-label">${T('上游模型列', 'Upstream model column')}</span>
      <input type="checkbox" checked></div>
    <div class="ov-set-row"><span class="ov-sec-label">${T('Tokens 列', 'Tokens column')}</span>
      <input type="checkbox" checked></div>`)}
  ${dlgDemo('md', T('md · 紧凑表单', 'md · Compact form'), T('供应商编辑 / 中等详情', 'Provider edit / medium detail'), `
    <div class="frm">
      <div class="fld"><label>ID <i>*</i></label><div class="ctrl"><input class="input" placeholder="prov-openai"></div></div>
      <div class="fld"><label>${T('名称', 'Name')} <i>*</i></label><div class="ctrl"><input class="input" placeholder="${T('OpenAI 官方', 'OpenAI official')}"></div></div>
      <div class="fld full"><label>Base URL <i>*</i></label><div class="ctrl"><input class="input grow" placeholder="https://api.openai.com/v1"></div></div>
      <div class="fld"><label>${T('超时', 'Timeout')}</label><div class="ctrl"><input class="input" value="120000" style="width:110px"><span class="unit">ms</span></div></div>
      <div class="fld"><label>${T('权重', 'Weight')}</label><div class="ctrl"><input class="input" value="10" style="width:110px"><span class="unit">0-1000</span></div></div>
    </div>`)}
  ${dlgDemo('lg', T('lg · 分区表单', 'lg · Grouped form'), T('模型编辑 / 新增账号', 'Model edit / add account'), `
    <div class="frm">
      <div class="fldgrp full"><span class="fldgrp-t">${T('基础信息', 'Basics')}</span><span class="fldgrp-d">${T('分区标题用 .fldgrp', 'Group title uses .fldgrp')}</span></div>
      <div class="fld"><label>${T('模型名', 'Model ID')} <i>*</i></label><div class="ctrl"><input class="input" placeholder="ent-gpt4o"></div></div>
      <div class="fld"><label>${T('展示名', 'Display name')}</label><div class="ctrl"><input class="input" placeholder="${T('GPT-4o 企业版', 'GPT-4o Enterprise')}"></div></div>
      <div class="fldgrp full"><span class="fldgrp-t">${T('上下文与输入', 'Context and input')}</span></div>
      <div class="fld"><label>${T('上下文长度', 'Context length')}</label><div class="ctrl"><input class="input" value="128000" style="width:130px"><span class="unit">tokens</span></div></div>
      <div class="fld"><label>${T('最大输出', 'Max output')}</label><div class="ctrl"><input class="input" value="32768" style="width:130px"><span class="unit">tokens</span></div></div>
      <div class="fldgrp full"><span class="fldgrp-t">${T('计费', 'Billing')}</span></div>
      <div class="fld"><label>${T('单价 ¥/千tok', 'Price ¥/1k tok')}</label><div class="ctrl"><input class="input" style="width:100px" placeholder="${T('输入', 'Input')}"><span class="unit">/</span><input class="input" style="width:100px" placeholder="${T('输出', 'Output')}"></div></div>
    </div>`)}
  ${dlgDemo('wide', T('wide · 长文本详情', 'wide · Long-text detail'), T('留痕正文 / 账号活动', 'Trace body / account activity'), `
    <div style="font-size:13px;color:var(--dim);margin-bottom:10px">${T('用户', 'User')} <b>admin</b> · 2026-09-14 · ent-default → gpt-4o · 2340ms · ${T('状态 200', 'Status 200')}</div>
    <b style="font-size:13px">${T('完整上下文（system + 历史对话 + 本轮输入）', 'Full context (system + history + current input)')}</b>
    <blockquote class="detail">[system]\n${T('你是企业助理，遵守公司数据安全策略。', 'You are the enterprise assistant and follow company data security policy.')}\n\n[user]\n${T('帮我整理昨天会议的要点……', 'Summarize the key points of the last meeting…')}\n\n[assistant]\n${T('好的，会议要点整理如下：……', 'Sure, here are the key points…')}</blockquote>
    <b style="font-size:13px">Response</b>
    <blockquote class="detail">${T('已将第 2 点展开为三条执行细则；测试手机号 138****5678 已按 DLP 规则脱敏。', 'Expanded point 2 into three action items; test phone 138****5678 masked per DLP rules.')}</blockquote>`)}
  ${dlgDemoBench()}`,

  bind() {
    if (bound) return;
    bound = true;
    // 五档按钮 → 打开对应弹窗；打开时把实测像素尺寸写进标题徽章（缩放/窄屏下所见即所得）
    for (const btn of document.querySelectorAll('[data-dlg-demo]')) {
      btn.addEventListener('click', () => {
        const mask = $(`dlgDemo-${btn.dataset.dlgDemo}`);
        openDlg(mask);
        const box = mask.querySelector('.dlg');
        const badge = mask.querySelector('[data-dlg-dim]');
        if (badge) {
          const r = box.getBoundingClientRect();
          badge.textContent = `${Math.round(r.width)} × ${Math.round(r.height)} px`;
        }
      });
    }
  },
}
