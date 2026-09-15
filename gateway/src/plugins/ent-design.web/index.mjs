/**
 * 插件页面 · 样式规范（原壳 views/pages/design.html）
 * 零数据依赖：插件作者的可视化活样册（令牌与组件类，对齐 docs/admin-plugin-pages.zh.md §5）
 */
import { $, icon, openDlg } from '/admin/static/contract.mjs'

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
        <button class="dlg-x" data-dlg-close title="关闭 (Esc)">${icon('x', { size: 16 })}</button>
      </div>
      <div class="dlg-body">${bodyHtml}</div>
      <div class="dlg-foot">
        <button class="btn" data-dlg-close>取消</button>
        <button class="btn primary" data-dlg-close>保存</button>
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
          <h3><span class="bar"></span>bench · 工作台 <span class="badge dim" data-dlg-dim></span></h3>
          <div class="dlg-sub">工具条与底部提示常驻，仅中间滚动</div>
        </div>
        <button class="dlg-x" data-dlg-close title="关闭 (Esc)">${icon('x', { size: 16 })}</button>
      </div>
      <div class="toolbar">
        <select class="input" style="padding:4px 8px;font-size:12.5px"><option>全部模型</option><option>仅真思考</option></select>
        <span class="dim2">逐档测试档位：</span>
        <span class="badge">off</span><span class="badge">low</span><span class="badge">medium</span><span class="badge">high</span>
        <input class="input" placeholder="自定义档位名…" style="width:130px;padding:3px 8px;font-size:12px">
        <button class="btn sm">＋添加</button><button class="btn sm">设为默认</button>
      </div>
      <div class="sub">4 个模型 · 已导入 4 · 20ms —— 工具条/汇总在滚动区外常驻</div>
      <div class="dlg-body probe-scroll">
        <div class="pcard-grid">
          ${['glm-5.3-flash', 'qwen-omni', 'deepseek-v4', 'kimi-k3'].map((m) => `
          <div class="pcard">
            <div class="pcard-head">
              <div class="pcard-title"><span class="mname mono">${m}</span><span class="dim2">128k 上下文</span></div>
              <div class="pcard-flags"><span class="badge ok">已导入</span></div>
            </div>
            <div class="pcard-judge"><span class="badge ok">✓ 支持思考</span><span class="dim2">off/low/medium/high · 890ms</span></div>
            <div class="pcard-foot"><button class="btn sm">逐档测试</button><button class="btn sm primary">应用</button></div>
          </div>`).join('')}
        </div>
      </div>
      <div class="hint">「逐档测试」按勾选档位真实发送小请求，测完可「应用」到企业模型目录。</div>
    </div>
  </div>`
}

export default {
  page: 'ent-design',
  html: `
  <div class="headrow">
    <div><h1>样式规范</h1></div>
  </div>
  <div class="crumb">统一设计系统活样册 · 插件页面只准用本页展示的令牌与组件类</div>

  <div class="grid2">
    <div class="card">
      <h2><span class="bar"></span>设计令牌（CSS 变量）</h2>
      <div class="sub">插件页面禁止硬编码颜色，一律 var() 引用</div>
      <table>
        <thead><tr><th>令牌</th><th>值</th><th>用途</th></tr></thead>
        <tbody>
          <tr><td class="mono">--accent</td><td><span class="sw" style="background:var(--accent)"></span>#2563eb</td><td>主色：竖条、主按钮、链接</td></tr>
          <tr><td class="mono">--ok</td><td><span class="sw" style="background:var(--ok)"></span>#059669</td><td>成功/正常</td></tr>
          <tr><td class="mono">--warn</td><td><span class="sw" style="background:var(--warn)"></span>#d97706</td><td>警告/外部</td></tr>
          <tr><td class="mono">--bad</td><td><span class="sw" style="background:var(--bad)"></span>#dc2626</td><td>危险/失败</td></tr>
          <tr><td class="mono">--txt / --dim</td><td>—</td><td>正文 / 次要文字</td></tr>
          <tr><td class="mono">--card / --line / --bg</td><td>—</td><td>卡片底 / 边框 / 页面底</td></tr>
        </tbody>
      </table>
    </div>

    <div class="card">
      <h2><span class="bar"></span>徽章与分层</h2>
      <div class="sub">状态徽章语义色只做小面积 · 插件分层徽章固定配色</div>
      <div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-bottom:12px">
        <span class="badge">默认</span><span class="badge ok">成功</span><span class="badge warn">警告</span><span class="badge bad">失败</span><span class="badge dim">次要</span>
      </div>
      <div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center">
        <span class="layer l-meta">元插件</span><span class="layer l-biz">业务</span><span class="layer l-collab">协作</span><span class="layer l-ui">界面</span><span class="layer l-ext">外部</span>
      </div>
    </div>
  </div>

  <div class="card">
    <h2><span class="bar"></span>按钮</h2>
    <div class="sub">主操作每屏最多一个 primary · danger 仅破坏性操作 · sm 用于表格行内</div>
    <div style="display:flex;flex-wrap:wrap;gap:10px;align-items:center">
      <button class="btn primary">主操作</button>
      <button class="btn">普通操作</button>
      <button class="btn danger">危险操作</button>
      <button class="btn sm">行内小按钮</button>
      <button class="btn sm danger">行内危险</button>
      <button class="btn" disabled>禁用态</button>
    </div>
  </div>

  <div class="card">
    <h2><span class="bar"></span>表格与输入</h2>
    <div class="sub">表头浅灰底 · 行分隔线 --line · 数字列 .num · 等宽列 .mono · 空态 .empty</div>
    <table>
      <thead><tr><th>名称</th><th class="num">数量</th><th>标识</th><th>操作</th></tr></thead>
      <tbody>
        <tr><td><b>示例行</b></td><td class="num">1,024</td><td class="mono">ent-example</td><td><button class="btn sm">详情</button></td></tr>
        <tr><td>次行</td><td class="num">7</td><td class="mono crumb">次要信息</td><td><button class="btn sm danger">删</button></td></tr>
      </tbody>
    </table>
    <div style="display:flex;gap:10px;margin-top:12px;align-items:center">
      <input class="input" placeholder="输入框 .input" style="width:180px">
      <select><option>下拉 select</option></select>
      <span class="empty" style="padding:0">空态用 .empty</span>
    </div>
  </div>

  <div class="card">
    <h2><span class="bar"></span>业务弹窗规范（.dlg-*）</h2>
    <div class="sub">右上角 × / Esc 关闭 · 点弹窗外空白不关 · 标题常驻</div>
    <table>
      <thead><tr><th>档位</th><th class="num">宽度</th><th>适用场景</th></tr></thead>
      <tbody>
        <tr><td class="mono">.dlg.sm</td><td class="num">460px</td><td>单字段 / 设置面</td></tr>
        <tr><td class="mono">.dlg.md</td><td class="num">640px</td><td>紧凑表单 / 中等详情</td></tr>
        <tr><td class="mono">.dlg.lg</td><td class="num">880px</td><td>分区表单</td></tr>
        <tr><td class="mono">.dlg.wide</td><td class="num">1100px</td><td>长文本详情</td></tr>
        <tr><td class="mono">.dlg.bench</td><td class="num">1240px</td><td>多卡并排工作台（× min(860px,92vh)）</td></tr>
      </tbody>
    </table>
    <pre class="codeblock">&lt;div class="dlg-mask" id="xxxDlg" hidden&gt;
  &lt;div class="dlg md" role="dialog" aria-modal="true"&gt;
    &lt;div class="dlg-head"&gt;
      &lt;h3&gt;标题（常驻，只有 .dlg-body 滚动）&lt;/h3&gt;
      &lt;button class="dlg-x" data-dlg-close title="关闭 (Esc)"&gt;&lt;/button&gt;
    &lt;/div&gt;
    &lt;div class="dlg-body"&gt;…唯一滚动区…&lt;/div&gt;
    &lt;div class="dlg-foot"&gt;…取消加 data-dlg-close…&lt;/div&gt;
  &lt;/div&gt;
&lt;/div&gt;

openDlg($('xxxDlg'))   // 打开（锁页面滚动）
closeDlg($('xxxDlg'))  // 关闭；危险确认一律走契约 confirmDlg</pre>
    <div style="margin-top:12px;display:flex;gap:10px;align-items:center;flex-wrap:wrap">
      <button class="btn sm" data-dlg-demo="sm">▶ sm · 460</button>
      <button class="btn sm" data-dlg-demo="md">▶ md · 640</button>
      <button class="btn sm" data-dlg-demo="lg">▶ lg · 880</button>
      <button class="btn sm" data-dlg-demo="wide">▶ wide · 1100</button>
      <button class="btn sm" data-dlg-demo="bench">▶ bench · 1240</button>
      <span class="dim2">点档位打开对应弹窗实测（左上角徽章显示实时像素尺寸）· 右上角 × / Esc 关闭 · 点弹窗外空白不关</span>
    </div>
  </div>

  <div class="card">
    <h2><span class="bar"></span>页面骨架约定</h2>
    <div class="sub">插件页面 html 的标准结构（data-ent-page 锚点必带）</div>
    <pre class="codeblock">&lt;div class="headrow" data-ent-page="ent-xxx"&gt;
  &lt;div&gt;&lt;h1&gt;页面标题&lt;/h1&gt;&lt;/div&gt;
  &lt;span class="badge" id="xxxSummary"&gt;&lt;/span&gt;
&lt;/div&gt;
&lt;div class="crumb"&gt;一句话说明本页看什么&lt;/div&gt;
&lt;div class="card"&gt;
  &lt;h2&gt;&lt;span class="bar"&gt;&lt;/span&gt;区块标题 &lt;span class="badge"&gt;计数&lt;/span&gt;&lt;/h2&gt;
  &lt;div class="sub"&gt;区块补充说明&lt;/div&gt;
  &lt;table&gt;…&lt;/table&gt;
&lt;/div&gt;</pre>
  </div>

  <!-- 弹窗试衣间：五档尺寸 × 真实内容形态，点击上面对应按钮打开 -->
  ${dlgDemo('sm', 'sm · 设置面', '展示设置 / 单字段编辑', `
    <div class="ov-set-row"><span class="ov-sec-label">默认每页条数</span>
      <select class="ov-sec-mode"><option>30 条/页</option></select></div>
    <div class="ov-set-row"><span class="ov-sec-label">CSV 导出上限</span>
      <input class="input" value="200" style="width:80px;padding:3px 6px"></div>
    <div class="ov-set-row"><span class="ov-sec-label">上游模型列</span>
      <input type="checkbox" checked></div>
    <div class="ov-set-row"><span class="ov-sec-label">Tokens 列</span>
      <input type="checkbox" checked></div>`)}
  ${dlgDemo('md', 'md · 紧凑表单', '供应商编辑 / 中等详情', `
    <div class="frm">
      <div class="fld"><label>ID <i>*</i></label><div class="ctrl"><input class="input" placeholder="prov-openai"></div></div>
      <div class="fld"><label>名称 <i>*</i></label><div class="ctrl"><input class="input" placeholder="OpenAI 官方"></div></div>
      <div class="fld full"><label>Base URL <i>*</i></label><div class="ctrl"><input class="input grow" placeholder="https://api.openai.com/v1"></div></div>
      <div class="fld"><label>超时</label><div class="ctrl"><input class="input" value="120000" style="width:110px"><span class="unit">ms</span></div></div>
      <div class="fld"><label>权重</label><div class="ctrl"><input class="input" value="10" style="width:110px"><span class="unit">0-1000</span></div></div>
    </div>`)}
  ${dlgDemo('lg', 'lg · 分区表单', '模型编辑 / 新增账号', `
    <div class="frm">
      <div class="fldgrp full"><span class="fldgrp-t">基础信息</span><span class="fldgrp-d">分区标题用 .fldgrp</span></div>
      <div class="fld"><label>模型名 <i>*</i></label><div class="ctrl"><input class="input" placeholder="ent-gpt4o"></div></div>
      <div class="fld"><label>展示名</label><div class="ctrl"><input class="input" placeholder="GPT-4o 企业版"></div></div>
      <div class="fldgrp full"><span class="fldgrp-t">上下文与输入</span></div>
      <div class="fld"><label>上下文长度</label><div class="ctrl"><input class="input" value="128000" style="width:130px"><span class="unit">tokens</span></div></div>
      <div class="fld"><label>最大输出</label><div class="ctrl"><input class="input" value="32768" style="width:130px"><span class="unit">tokens</span></div></div>
      <div class="fldgrp full"><span class="fldgrp-t">计费</span></div>
      <div class="fld"><label>单价 ¥/千tok</label><div class="ctrl"><input class="input" style="width:100px" placeholder="输入"><span class="unit">/</span><input class="input" style="width:100px" placeholder="输出"></div></div>
    </div>`)}
  ${dlgDemo('wide', 'wide · 长文本详情', '留痕正文 / 账号活动', `
    <div style="font-size:13px;color:var(--dim);margin-bottom:10px">用户 <b>admin</b> · 2026-09-14 · ent-default → gpt-4o · 2340ms · 状态 200</div>
    <b style="font-size:13px">完整上下文（system + 历史对话 + 本轮输入）</b>
    <blockquote class="detail">[system]\n你是企业助理，遵守公司数据安全策略。\n\n[user]\n帮我整理昨天会议的要点……\n\n[assistant]\n好的，会议要点整理如下：……</blockquote>
    <b style="font-size:13px">Response</b>
    <blockquote class="detail">已将第 2 点展开为三条执行细则；测试手机号 138****5678 已按 DLP 规则脱敏。</blockquote>`)}
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
