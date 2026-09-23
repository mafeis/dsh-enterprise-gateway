/**
 * 插件 ent-setup · 用户接入分发（公开页，无需登录）
 * 路由：
 *   GET /setup                    用户接入页：按系统给分步指引（打开什么 → 复制什么 → 回车 → 排障）
 *   GET /setup/windows-setup.ps1  Windows 安装脚本（__GATEWAY_URL__ 按请求来源替换）
 *   GET /setup/mac-setup.sh       Mac 安装脚本（同上）
 * 脚本本体：gateway/setup/ 目录（可直接编辑，无需重启）
 *
 * 页面设计：跟随系统深浅色；OS 分段切换（默认自动匹配访问者系统，IT 仍可切换看另一端）；
 * 注意 PAGE 是模板字符串 —— 内嵌 HTML/CSS/JS 里不得出现反引号或 ${。
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { json } from '../core/http.mjs'

export const name = 'ent-setup'
export const provides = []
export const inject = ['router']

const SETUP_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'setup')

/** 请求来源地址（http://host:port）：Host 头 + 反代协议头，host 做字符白名单防注入 */
function originOf(req) {
  const host = String(req.headers.host ?? '')
  if (!/^[\w.:-]+$/.test(host)) return ''
  const proto = String(req.headers['x-forwarded-proto'] ?? 'http').split(',')[0].trim()
  return `${proto}://${host}`
}

/** 读脚本并注入网关地址；文件缺失（异常安装）时返回 null 而非抛错 */
function script(name, origin) {
  try {
    // 剥 BOM：PowerShell 5.1 的 irm 会把 U+FEFF 留在 .Content 里，脚本首条语句被污染后
    // 整段会被当语句解析，客户端当场 ParserError（真机踩过；仓库侧 check.mjs 也有 lint）
    const raw = readFileSync(join(SETUP_DIR, name), 'utf8')
    return raw.replace(/^\uFEFF/, '').split('__GATEWAY_URL__').join(origin)
  } catch {
    return null
  }
}

const PAGE = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>接入企业 DSH · Set up DSH Enterprise</title>
<style>
:root {
  color-scheme: light dark;
  --bg:#f6f7f9; --glow:rgba(37,99,235,.055); --card:#fff; --line:rgba(16,24,40,.09);
  --txt:#101828; --dim:#667085; --accent:#2563eb; --accent-soft:rgba(37,99,235,.08);
  --seg-bg:rgba(16,24,40,.045); --seg-active:#fff; --shadow:0 1px 2px rgba(16,24,40,.05),0 12px 32px -16px rgba(16,24,40,.20);
  --kbd-bg:linear-gradient(#fff,#f1f5f9); --kbd-line:#d8dee9; --ok:#067647; --ok-bg:rgba(6,118,71,.07);
}
@media (prefers-color-scheme: dark) { :root {
  --bg:#0b0e14; --glow:rgba(91,140,255,.07); --card:#141a24; --line:rgba(255,255,255,.09);
  --txt:#e6e9ef; --dim:#8b94a7; --accent:#5b8cff; --accent-soft:rgba(91,140,255,.14);
  --seg-bg:rgba(255,255,255,.06); --seg-active:#222b3a; --shadow:0 1px 2px rgba(0,0,0,.4),0 16px 40px -20px rgba(0,0,0,.7);
  --kbd-bg:#1b2230; --kbd-line:#2c3648; --ok:#3fb950; --ok-bg:rgba(63,185,80,.1);
} }
* { box-sizing:border-box; margin:0 }
html { -webkit-font-smoothing:antialiased; text-size-adjust:100% }
body { background:var(--bg); background-image:radial-gradient(52% 34% at 50% 0%,var(--glow),transparent 72%);
  background-repeat:no-repeat; background-attachment:fixed;
  color:var(--txt); font:14px/1.7 -apple-system,"Segoe UI Variable Display","Segoe UI","PingFang SC","Microsoft YaHei",sans-serif; }
main { max-width:620px; margin:0 auto; padding:48px 20px 72px }
[hidden] { display:none !important }
a { color:var(--accent) }
:focus-visible { outline:2px solid var(--accent); outline-offset:2px; border-radius:8px }
::selection { background:var(--accent-soft) }
.top { display:flex; justify-content:space-between; align-items:center; margin-bottom:56px }
.brand { display:flex; align-items:center; gap:10px }
.logo { width:28px; height:28px; border-radius:8px; background:linear-gradient(135deg,#2563eb,#7c3aed);
  color:#fff; font-weight:700; font-size:15px; display:flex; align-items:center; justify-content:center;
  box-shadow:0 2px 8px rgba(37,99,235,.35) }
.brand-name { font-weight:600; font-size:14px; letter-spacing:-.01em }
.pill { border:1px solid var(--line); background:var(--card); color:var(--dim); font:inherit; font-size:12.5px;
  border-radius:999px; padding:5px 14px; cursor:pointer; transition:color .15s,border-color .15s }
.pill:hover { color:var(--txt); border-color:var(--dim) }
h1 { font-size:27px; line-height:1.25; font-weight:700; letter-spacing:-.02em }
.sub { color:var(--dim); font-size:14px; margin-top:8px }
.chip { display:flex; width:fit-content; align-items:center; gap:8px; margin-top:18px; padding:5px 14px;
  background:var(--card); border:1px solid var(--line); border-radius:999px; color:var(--dim);
  font-size:12.5px; font-weight:500; box-shadow:0 1px 2px rgba(16,24,40,.04) }
.chip .dot { width:7px; height:7px; border-radius:50%; background:#22c55e; box-shadow:0 0 0 3px rgba(34,197,94,.18); flex:none }
.chip.muted .dot { background:#9ca3af; box-shadow:0 0 0 3px rgba(156,163,175,.18) }
.warn { display:inline-block; margin-top:16px; padding:8px 14px; border-radius:10px;
  background:rgba(217,119,6,.1); border:1px solid rgba(217,119,6,.3); color:#b45309; font-size:13px }
@media (prefers-color-scheme: dark) { .warn { color:#fbbf24 } }
.tabs { display:inline-flex; gap:2px; background:var(--seg-bg); border-radius:11px; padding:3px; margin:24px 0 14px }
.tab { display:inline-flex; align-items:center; gap:8px; border:0; background:transparent; color:var(--dim);
  font:inherit; font-size:13.5px; font-weight:500; padding:7px 18px; border-radius:9px; cursor:pointer;
  transition:background .15s,color .15s,box-shadow .15s }
.tab svg { flex:none; opacity:.75 }
.tab:hover { color:var(--txt) }
.tab.on { background:var(--seg-active); color:var(--txt); box-shadow:0 1px 3px rgba(16,24,40,.16) }
.card { background:var(--card); border:1px solid var(--line); border-radius:16px; box-shadow:var(--shadow);
  padding:28px 28px 22px }
@keyframes fade { from { opacity:0; transform:translateY(4px) } }
.card.on { animation:fade .18s ease }
.steps { list-style:none; counter-reset:s }
.steps > li { counter-increment:s; position:relative; padding:0 0 24px 42px }
.steps > li:last-child { padding-bottom:4px }
.steps > li::before { content:counter(s); position:absolute; left:0; top:2px; width:24px; height:24px;
  border-radius:50%; background:var(--accent-soft); color:var(--accent); font-size:12.5px; font-weight:650;
  line-height:24px; text-align:center }
.steps > li::after { content:""; position:absolute; left:11.5px; top:32px; bottom:6px; width:1.5px;
  background:var(--line); border-radius:1px }
.steps > li:last-child::after { display:none }
.dim { color:var(--dim); font-size:12.5px; margin-top:3px }
.key { display:inline-block; background:var(--kbd-bg); border:1px solid var(--kbd-line); border-bottom-width:2px;
  border-radius:6px; padding:0 7px; font-size:12px; font-family:ui-monospace,"SF Mono",Menlo,Consolas,monospace; line-height:19px }
.term { margin-top:12px; border:1px solid rgba(255,255,255,.08); border-radius:12px; overflow:hidden; background:#0d1117 }
.term-head { display:flex; justify-content:space-between; align-items:center; gap:12px;
  padding:7px 8px 7px 14px; background:#161b22; border-bottom:1px solid rgba(255,255,255,.06) }
.term-title { font-size:11px; font-weight:600; letter-spacing:.06em; color:#7d8590; text-transform:uppercase }
.term-body { margin:0; padding:15px 16px; overflow-x:auto;
  font:13px/1.65 ui-monospace,"SF Mono","Cascadia Code",Menlo,Consolas,monospace; color:#d5dce8;
  white-space:pre-wrap; word-break:break-all }
.prompt { color:#545d68; user-select:none }
.copy-btn { display:inline-flex; align-items:center; gap:6px; border:1px solid rgba(255,255,255,.12);
  background:rgba(255,255,255,.06); color:#adb6c2; border-radius:7px; padding:3px 11px; cursor:pointer;
  font:inherit; font-size:12px; transition:background .15s,color .15s,border-color .15s }
.copy-btn:hover { background:rgba(255,255,255,.13); color:#fff }
.copy-btn .ico-check { display:none }
.copy-btn.done { border-color:rgba(63,185,80,.55); background:rgba(63,185,80,.1); color:#3fb950 }
.copy-btn.done .ico-copy { display:none }
.copy-btn.done .ico-check { display:inline-block }
.tip { display:none; align-items:center; gap:8px; margin-top:10px; padding:8px 13px;
  background:var(--ok-bg); border:1px solid rgba(63,185,80,.3); border-radius:9px; color:var(--ok); font-size:12.5px }
.tip.show { display:flex }
.tip .ok { flex:none; width:16px; height:16px; border-radius:50%; background:var(--ok); color:#fff;
  font-size:10.5px; line-height:16px; text-align:center }
details { margin-top:8px; border-top:1px solid var(--line); padding-top:14px }
summary { display:flex; align-items:center; justify-content:space-between; cursor:pointer;
  font-size:13.5px; font-weight:500; color:var(--dim); list-style:none; user-select:none; transition:color .15s }
summary::-webkit-details-marker { display:none }
summary:hover { color:var(--txt) }
summary .chev { transition:transform .18s ease; opacity:.6 }
details[open] .chev { transform:rotate(90deg) }
.qa { margin-top:12px }
.qa .q { display:block; font-size:13.5px; font-weight:600; margin-bottom:2px }
.qa p { margin:0 0 14px; font-size:13px }
footer { color:var(--dim); font-size:12.5px; margin-top:26px; text-align:center }
@media (max-width:560px) { main { padding:28px 14px 56px } h1 { font-size:23px } .top { margin-bottom:40px }
  .card { padding:20px 16px 16px } .steps > li { padding-left:36px } .steps > li::after { left:11.5px } }
@media (prefers-reduced-motion: reduce) { * { animation:none !important; transition:none !important } }
</style>
</head>
<body>
<main>
<header class="top">
  <div class="brand"><span class="logo">D</span><span class="brand-name">DSH Enterprise</span></div>
  <button id="lang" class="pill" onclick="setLang(document.documentElement.lang==='zh-CN'?'en':'zh-CN')">English</button>
</header>

<h1 data-zh="接入企业 DSH" data-en="Set up DSH Enterprise">接入企业 DSH</h1>
<p class="sub" data-zh="全程约 5 分钟，装完用企业账号登录。" data-en="About 5 minutes. Sign in with your company account when done.">全程约 5 分钟，装完用企业账号登录。</p>
<span class="chip" id="served" hidden><span class="dot"></span><span id="served-txt"></span></span>
<noscript><div class="warn" data-zh="本页需要开启 JavaScript 才能显示分步指引。" data-en="This page needs JavaScript to show the step-by-step guide.">本页需要开启 JavaScript 才能显示分步指引。</div></noscript>

<div class="tabs" role="tablist" aria-label="OS">
  <button class="tab" id="tab-win" role="tab" aria-selected="false" aria-controls="win" onclick="showOS('win')">
    <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M1.5 2.7 7.2 1.9v5.7H1.5V2.7Zm0 10.6 5.7.8V8.4H1.5v4.9ZM7.9 1.8 15.4.8v6.8H7.9V1.8Zm0 6.6h7.5v6.8l-7.5-1V8.4Z"/></svg>
    <span data-zh="Windows" data-en="Windows">Windows</span>
  </button>
  <button class="tab" id="tab-mac" role="tab" aria-selected="false" aria-controls="mac" onclick="showOS('mac')">
    <svg width="13" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M11.182.008C11.148-.03 9.923.023 8.857 1.18c-1.066 1.156-.902 2.482-.878 2.516.024.034 1.52.087 2.475-1.258.955-1.345.762-2.391.728-2.43Zm3.314 11.733c-.048-.096-2.325-1.234-2.113-3.422.212-2.189 1.675-2.789 1.698-2.854.023-.065-.597-.79-1.254-1.157a3.692 3.692 0 0 0-1.563-.434c-.108-.003-.483-.095-1.254.116-.508.139-1.653.589-1.968.607-.316.018-1.256-.522-2.267-.665-.647-.125-1.333.131-1.824.328-.49.196-1.422.754-2.074 2.237-.652 1.482-.311 3.83-.067 4.56.244.729.625 1.924 1.273 2.796.576.984 1.34 1.667 1.659 1.899.319.232 1.219.386 1.973.067.504-.217 1.114-.44 1.468-.447.354-.008 1.254.186 1.776.437.53.252 1.304.57 1.868.322.575-.25.958-.71 1.16-1.016.202-.305.32-.531.362-.628a.99.99 0 0 0-.066-.884z"/></svg>
    <span data-zh="Mac" data-en="Mac">Mac</span>
  </button>
</div>

<section class="card" id="win" role="tabpanel" aria-labelledby="tab-win" hidden>
  <ol class="steps">
    <li>
      <p data-zh="复制安装命令" data-en="Copy the install command">复制安装命令</p>
      <div class="term">
        <div class="term-head">
          <span class="term-title">PowerShell</span>
          <button class="copy-btn" onclick="copyCmd('cmd-win',this)" data-tip="tip-win">
            <svg class="ico-copy" width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><rect x="5.5" y="5.5" width="9" height="9" rx="2"/><path d="M11.5 5.5v-2A1.5 1.5 0 0 0 10 2H3.5A1.5 1.5 0 0 0 2 3.5V10a1.5 1.5 0 0 0 1.5 1.5h2"/></svg>
            <svg class="ico-check" width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 8.5l3.5 3.5L13 4.5"/></svg>
            <span class="copy-txt" data-zh="复制" data-en="Copy">复制</span>
          </button>
        </div>
        <pre class="term-body"><span class="prompt">$ </span><code id="cmd-win"></code></pre>
      </div>
      <div class="tip" id="tip-win"><span class="ok">&#10003;</span><span data-zh="已复制，继续第 2 步" data-en="Copied — continue to step 2">已复制，继续第 2 步</span></div>
    </li>
    <li>
      <p data-zh="打开 PowerShell：按 <b>Win 键</b> → 输入 <b>powershell</b> → 回车" data-en="Open PowerShell: press <b>Win</b> → type <b>powershell</b> → Enter">打开 PowerShell：按 <b>Win 键</b> → 输入 <b>powershell</b> → 回车</p>
      <p class="dim" data-zh="打开的是蓝色窗口。搜不到就找「Windows PowerShell」" data-en="A blue window opens. If not found, look for &quot;Windows PowerShell&quot;">打开的是蓝色窗口。搜不到就找「Windows PowerShell」</p>
    </li>
    <li>
      <p data-zh="在蓝窗口里<b>点右键</b>（即粘贴），再按<b>回车</b>" data-en="<b>Right-click</b> in the blue window (this pastes), then press <b>Enter</b>">在蓝窗口里<b>点右键</b>（即粘贴），再按<b>回车</b></p>
    </li>
    <li>
      <p data-zh="等窗口出现「完成！」即装好——应用会自动启动，首次启动加载企业插件约需 10~30 秒，窗口出现后用企业账号密码登录" data-en="Wait for &quot;Done!&quot; — the app then launches automatically; first launch may take 10–30s to load the enterprise plugin, then sign in with your company account">等窗口出现「完成！」即装好——应用会自动启动，首次启动加载企业插件约需 10~30 秒，窗口出现后用企业账号密码登录</p>
      <p class="dim" data-zh="过程中窗口滚动大量文字、中途闪一下黑框，都是正常安装动作" data-en="Scrolling text and a brief black window during install are normal">过程中窗口滚动大量文字、中途闪一下黑框，都是正常安装动作</p>
    </li>
  </ol>
  <details>
    <summary><span data-zh="遇到问题？" data-en="Troubleshooting">遇到问题？</span><svg class="chev" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 3.5l4.5 4.5L6 12.5"/></svg></summary>
    <div class="qa">
      <b class="q" data-zh="右键没粘贴出来" data-en="Right-click didn't paste">右键没粘贴出来</b>
      <p data-zh="改按 <b>Ctrl+V</b> 再回车" data-en="Press <b>Ctrl+V</b> instead, then Enter">改按 <b>Ctrl+V</b> 再回车</p>
      <b class="q" data-zh="提示「禁止运行脚本」" data-en="&quot;Running scripts is disabled&quot;">提示「禁止运行脚本」</b>
      <p data-zh="正常现象，再按一次回车重跑即可" data-en="Expected — just press Enter to run again">正常现象，再按一次回车重跑即可</p>
      <b class="q" data-zh="下载慢或中途失败" data-en="Download slow or interrupted">下载慢或中途失败</b>
      <p data-zh="重新执行一遍命令，会接着下载" data-en="Run the command again to resume">重新执行一遍命令，会接着下载</p>
      <b class="q" data-zh="装完打不开 / 登录不上" data-en="App won't open / can't sign in">装完打不开 / 登录不上</b>
      <p data-zh="重启电脑再试一次" data-en="Reboot once and retry">重启电脑再试一次</p>
      <p class="dim" data-zh="仍不行：把蓝窗口里的报错截图发给 IT" data-en="Still failing: screenshot the error and send it to IT">仍不行：把蓝窗口里的报错截图发给 IT</p>
    </div>
  </details>
</section>

<section class="card" id="mac" role="tabpanel" aria-labelledby="tab-mac" hidden>
  <ol class="steps">
    <li>
      <p data-zh="复制安装命令" data-en="Copy the install command">复制安装命令</p>
      <div class="term">
        <div class="term-head">
          <span class="term-title">Terminal</span>
          <button class="copy-btn" onclick="copyCmd('cmd-mac',this)" data-tip="tip-mac">
            <svg class="ico-copy" width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><rect x="5.5" y="5.5" width="9" height="9" rx="2"/><path d="M11.5 5.5v-2A1.5 1.5 0 0 0 10 2H3.5A1.5 1.5 0 0 0 2 3.5V10a1.5 1.5 0 0 0 1.5 1.5h2"/></svg>
            <svg class="ico-check" width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 8.5l3.5 3.5L13 4.5"/></svg>
            <span class="copy-txt" data-zh="复制" data-en="Copy">复制</span>
          </button>
        </div>
        <pre class="term-body"><span class="prompt">$ </span><code id="cmd-mac"></code></pre>
      </div>
      <div class="tip" id="tip-mac"><span class="ok">&#10003;</span><span data-zh="已复制，继续第 2 步" data-en="Copied — continue to step 2">已复制，继续第 2 步</span></div>
    </li>
    <li>
      <p data-zh="打开终端：按 <span class='key'>Cmd</span> + <span class='key'>空格</span> → 输入 <b>终端</b> → 回车" data-en="Open Terminal: <span class='key'>Cmd</span> + <span class='key'>Space</span> → type <b>Terminal</b> → Enter">打开终端：按 <span class='key'>Cmd</span> + <span class='key'>空格</span> → 输入 <b>终端</b> → 回车</p>
    </li>
    <li>
      <p data-zh="按 <span class='key'>Cmd</span> + <span class='key'>V</span> 粘贴，再按<b>回车</b>" data-en="Paste with <span class='key'>Cmd</span> + <span class='key'>V</span>, then press <b>Enter</b>">按 <span class='key'>Cmd</span> + <span class='key'>V</span> 粘贴，再按<b>回车</b></p>
    </li>
    <li>
      <p data-zh="等窗口出现「完成！」即装好——应用会自动启动，首次启动加载企业插件约需 10~30 秒，窗口出现后用企业账号密码登录" data-en="Wait for &quot;Done!&quot; — the app then launches automatically; first launch may take 10–30s to load the enterprise plugin, then sign in with your company account">等窗口出现「完成！」即装好——应用会自动启动，首次启动加载企业插件约需 10~30 秒，窗口出现后用企业账号密码登录</p>
      <p class="dim" data-zh="过程中要求输入密码或回车确认，直接回车即可" data-en="If asked for a password or confirmation, just press Enter">过程中要求输入密码或回车确认，直接回车即可</p>
    </li>
  </ol>
  <details>
    <summary><span data-zh="遇到问题？" data-en="Troubleshooting">遇到问题？</span><svg class="chev" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 3.5l4.5 4.5L6 12.5"/></svg></summary>
    <div class="qa">
      <b class="q" data-zh="提示「无法验证开发者」/「已损坏」" data-en="&quot;Can't verify developer&quot; / &quot;damaged&quot;">提示「无法验证开发者」/「已损坏」</b>
      <p data-zh="系统设置 → 隐私与安全性 → 点「仍要打开」" data-en="System Settings → Privacy &amp; Security → &quot;Open Anyway&quot;">系统设置 → 隐私与安全性 → 点「仍要打开」</p>
      <b class="q" data-zh="中途停住或失败" data-en="Stuck or failed halfway">中途停住或失败</b>
      <p data-zh="重新执行一遍命令，会接着装" data-en="Run the command again to resume">重新执行一遍命令，会接着装</p>
      <b class="q" data-zh="装完打不开 / 登录不上" data-en="App won't open / can't sign in">装完打不开 / 登录不上</b>
      <p data-zh="重启电脑再试一次" data-en="Reboot once and retry">重启电脑再试一次</p>
      <p class="dim" data-zh="仍不行：把终端里的报错截图发给 IT" data-en="Still failing: screenshot the error and send it to IT">仍不行：把终端里的报错截图发给 IT</p>
    </div>
  </details>
</section>

<footer data-zh="换一台电脑安装？再次打开本页即可，命令会自动匹配该电脑的系统。" data-en="Setting up another computer? Open this page there — the command adapts to that system.">换一台电脑安装？再次打开本页即可，命令会自动匹配该电脑的系统。</footer>
</main>
<script>
var ORIGIN = location.origin
document.getElementById('cmd-win').textContent =
  'irm ' + ORIGIN + '/setup/windows-setup.ps1 | iex'
document.getElementById('cmd-mac').textContent =
  'curl -fsSL ' + ORIGIN + '/setup/mac-setup.sh | bash'
var servedData = null
// 网关已镜像并发布的客户端版本：IT 打开就知道「新机器会装到哪个版本」，普通用户看一眼即可
function renderServed () {
  var el = document.getElementById('served')
  var txt = document.getElementById('served-txt')
  if (!servedData) return
  var zh = document.documentElement.lang === 'zh-CN'
  if (servedData.version) {
    var parts = []
    if (servedData.mac) parts.push('macOS ' + servedData.mac.sizeMb + ' MB')
    if (servedData.win) parts.push('Windows ' + servedData.win.sizeMb + ' MB')
    txt.textContent = zh
      ? '本网关下发版本 ' + servedData.version + (parts.length ? '（' + parts.join(' · ') + '，局域网直装）' : '')
      : 'Served by this gateway: ' + servedData.version + (parts.length ? ' (' + parts.join(' \\u00b7 ') + ', over the LAN)' : '')
  } else {
    txt.textContent = zh
      ? '安装包尚未镜像到本网关，脚本将回源公网下载'
      : 'No installer mirrored here yet — the script falls back to upstream'
  }
  el.classList.toggle('muted', !servedData.version)
  el.hidden = false
}
fetch(ORIGIN + '/setup/releases.json').then(function (r) { return r.ok ? r.json() : null }).then(function (d) {
  servedData = d; renderServed()
}).catch(function () {})
function showOS (os) {
  var win = os === 'win'
  var tw = document.getElementById('tab-win'), tm = document.getElementById('tab-mac')
  var pw = document.getElementById('win'), pm = document.getElementById('mac')
  tw.classList.toggle('on', win); tm.classList.toggle('on', !win)
  tw.setAttribute('aria-selected', win ? 'true' : 'false')
  tm.setAttribute('aria-selected', win ? 'false' : 'true')
  pw.hidden = !win; pm.hidden = win
  var card = win ? pw : pm
  card.classList.remove('on'); void card.offsetWidth; card.classList.add('on')
}
var ua = navigator.userAgent
showOS(/Mac|iPhone|iPad/.test(ua) && !/Windows/.test(ua) ? 'mac' : 'win')
function copyCmd (id, btn) {
  var text = document.getElementById(id).textContent
  var ok = function () {
    document.getElementById(btn.dataset.tip || (id === 'cmd-win' ? 'tip-win' : 'tip-mac')).classList.add('show')
    btn.classList.add('done')
    var t = btn.querySelector('.copy-txt')
    if (t) t.textContent = document.documentElement.lang === 'zh-CN' ? '已复制' : 'Copied'
    setTimeout(function () {
      btn.classList.remove('done')
      if (t) t.textContent = document.documentElement.lang === 'zh-CN' ? '复制' : 'Copy'
    }, 2500)
  }
  var fallback = function () {
    // 剪贴板 API 不可用（非 HTTPS 且旧浏览器）：选中命令文本让用户手动复制
    var range = document.createRange()
    range.selectNodeContents(document.getElementById(id))
    var sel = window.getSelection()
    sel.removeAllRanges(); sel.addRange(range)
  }
  if (navigator.clipboard && window.isSecureContext) {
    navigator.clipboard.writeText(text).then(ok, fallback)
  } else {
    // 非 HTTPS（内网网关常态）：execCommand 兜底，再失败则选中文本
    var ta = document.createElement('textarea')
    ta.value = text
    ta.style.cssText = 'position:fixed;opacity:0'
    document.body.appendChild(ta)
    ta.select()
    var done = false
    try { done = document.execCommand('copy') } catch (e) {}
    document.body.removeChild(ta)
    if (done) ok(); else fallback()
  }
}
function setLang (lang) {
  document.documentElement.lang = lang === 'zh-CN' ? 'zh-CN' : 'en'
  var en = lang !== 'zh-CN'
  document.querySelectorAll('[data-zh]').forEach(function (el) { el.innerHTML = en ? el.dataset.en : el.dataset.zh })
  document.getElementById('lang').textContent = en ? '中文' : 'English'
  renderServed()
}
if (!navigator.language || !navigator.language.startsWith('zh')) setLang('en')
</script>
</body>
</html>`

const SCRIPTS = {
  'windows-setup.ps1': { file: 'windows-setup.ps1', type: 'text/plain; charset=utf-8' },
  'mac-setup.sh': { file: 'mac-setup.sh', type: 'text/x-shellscript; charset=utf-8' },
  'diag.ps1': { file: 'diag.ps1', type: 'text/plain; charset=utf-8' },
}

export function apply(ctx) {
  const router = ctx.get('router')

  ctx.effect(() => router.exact('GET', '/', async (req, res, path, url) => {
    // 根路径：浏览器访问 → 302 到用户接入页；显式要 JSON/脚本的程序化请求不动
    const accept = String(req.headers.accept ?? '')
    if (accept.includes('application/json') || accept.includes('text/event-stream')) return false
    res.writeHead(302, { location: '/setup' })
    res.end()
    return true
  }), 'ent-setup: route GET / → /setup')

  ctx.effect(() => router.exact('GET', '/setup', async (req, res) => {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
    res.end(PAGE)
    return true
  }), 'ent-setup: route GET /setup')

  ctx.effect(() => router.prefix('/setup/', async (req, res, urlPath) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return false
    const name = urlPath.slice('/setup/'.length)
    const origin = originOf(req)
    if (!origin) return json(res, 400, { error: { message: 'bad Host', type: 'bad_request' } })
    const s = SCRIPTS[name]
    if (!s) return false
    const body = script(s.file, origin)
    if (body === null) return json(res, 500, { error: { message: `安装脚本缺失（${s.file}），安装不完整，请重新 npm i -g dsh-enterprise-gateway`, type: 'internal_error' } })
    res.writeHead(200, { 'content-type': s.type, 'cache-control': 'no-store' })
    res.end(req.method === 'HEAD' ? undefined : body)
    return true
  }), 'ent-setup: route GET /setup/*')
}
