/**
 * 插件 ent-setup · 员工接入分发（公开页，无需登录）
 * 路由：
 *   GET /setup                    员工接入页：按系统给分步指引（打开什么 → 复制什么 → 回车 → 排障）
 *   GET /setup/windows-setup.ps1  Windows 安装脚本（__GATEWAY_URL__ 按请求来源替换）
 *   GET /setup/mac-setup.sh       Mac 安装脚本（同上）
 * 脚本本体：gateway/setup/ 目录（可直接编辑，无需重启）
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

/** 读脚本并注入网关地址 */
function script(name, origin) {
  const body = readFileSync(join(SETUP_DIR, name), 'utf8')
  return body.split('__GATEWAY_URL__').join(origin)
}

const PAGE = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>接入企业 DSH · Set up DSH Enterprise</title>
<style>
:root { --bg:#f4f6fa; --card:#fff; --line:#e6eaf1; --txt:#1f2937; --dim:#6b7280;
  --accent:#2563eb; --code-bg:#0f172a; --code-txt:#e2e8f0; --ok:#059669; --ok-bg:rgba(5,150,105,.08); }
* { box-sizing:border-box; margin:0; }
body { background:var(--bg); color:var(--txt); font:14px/1.7 -apple-system,"Segoe UI","Microsoft YaHei","PingFang SC",sans-serif;
  padding:40px 20px; }
main { max-width:640px; margin:0 auto; }
h1 { font-size:22px; margin-bottom:6px; }
h1 .bar { display:inline-block; width:4px; height:18px; background:var(--accent); border-radius:2px; margin-right:10px; vertical-align:-2px; }
.sub { color:var(--dim); font-size:13.5px; margin-bottom:28px; }
.card { background:var(--card); border:1px solid var(--line); border-radius:12px; box-shadow:0 1px 4px rgba(0,0,0,.08);
  padding:24px; margin-bottom:16px; }
.card h2 { font-size:16px; margin-bottom:18px; }
.step { display:flex; gap:12px; margin-bottom:18px; }
.step:last-of-type { margin-bottom:0; }
.n { flex:none; width:22px; height:22px; border-radius:50%; background:var(--accent); color:#fff;
  font-size:12.5px; line-height:22px; text-align:center; margin-top:2px; }
.step-body { flex:1; min-width:0; }
.step-body > p { margin:2px 0 0; }
.step-body .dim { color:var(--dim); font-size:12.5px; margin-top:2px; }
.key { display:inline-block; border:1px solid var(--line); border-bottom-width:2px; border-radius:5px;
  background:#f8fafc; padding:0 6px; font-size:12px; font-family:Consolas,monospace; }
.code { background:var(--code-bg); color:var(--code-txt); border-radius:8px 8px 0 0; padding:12px 14px;
  font:13px/1.6 Consolas,"Cascadia Code",monospace; overflow-x:auto; white-space:pre-wrap; word-break:break-all; margin-top:10px; }
.copybar { display:flex; justify-content:flex-end; background:var(--code-bg); border-radius:0 0 8px 8px; padding:0 10px 10px; }
.btn { display:inline-block; border:1px solid rgba(226,232,240,.35); background:transparent; color:#cbd5e1; border-radius:6px;
  padding:4px 14px; font-size:12.5px; cursor:pointer; }
.btn:hover { border-color:#e2e8f0; color:#fff; }
.btn.done { border-color:var(--ok); color:#34d399; }
.tip { display:none; align-items:center; gap:8px; margin-top:10px; padding:8px 12px;
  background:var(--ok-bg); border:1px solid rgba(5,150,105,.25); border-radius:8px;
  color:var(--ok); font-size:12.5px; }
.tip.show { display:flex; }
.tip .ok { flex:none; width:16px; height:16px; border-radius:50%; background:var(--ok); color:#fff;
  font-size:11px; line-height:16px; text-align:center; }
details { margin-top:18px; border-top:1px solid var(--line); padding-top:12px; }
summary { cursor:pointer; font-size:13.5px; color:var(--dim); user-select:none; }
summary:hover { color:var(--txt); }
.qa { margin-top:12px; }
.qa .q { display:block; font-size:13.5px; font-weight:600; margin-bottom:2px; }
.qa p { margin:0 0 12px; font-size:13px; color:var(--txt); }
.qa .dim { color:var(--dim); font-size:12.5px; }
footer { color:var(--dim); font-size:12.5px; margin-top:24px; }
#lang { float:right; border:none; background:none; color:var(--dim); cursor:pointer; font-size:12.5px; }
#lang:hover { color:var(--txt); }
#noscript { color:#d97706; font-size:13.5px; }
@media (max-width:560px) { body { padding:24px 14px; } .card { padding:18px 16px; } }
</style>
</head>
<body>
<main>
<button id="lang" onclick="setLang(document.documentElement.lang==='zh-CN'?'en':'zh-CN')">English</button>
<h1><span class="bar"></span><span data-zh="接入企业 DSH" data-en="Set up DSH Enterprise">接入企业 DSH</span></h1>
<p class="sub" data-zh="4 步完成，全程约 5 分钟，装完用企业账号登录。" data-en="4 steps, about 5 minutes. Sign in with your company account when done.">4 步完成，全程约 5 分钟，装完用企业账号登录。</p>
<noscript><p id="noscript">本页需要开启 JavaScript 才能显示分步指引。</p></noscript>

<div class="card" id="win">
  <h2 data-zh="Windows 电脑" data-en="Windows PC">Windows 电脑</h2>
  <div class="step"><div class="n">1</div><div class="step-body">
    <p data-zh="复制安装命令" data-en="Copy the install command">复制安装命令</p>
    <div class="code" id="cmd-win"></div>
    <div class="copybar"><button class="btn" onclick="copyCmd('cmd-win',this)" data-zh="复制" data-en="Copy">复制</button></div>
    <div class="tip" id="tip-win"><span class="ok">✓</span><span data-zh="已复制，继续第 2 步" data-en="Copied — continue to step 2">已复制，继续第 2 步</span></div>
  </div></div>
  <div class="step"><div class="n">2</div><div class="step-body">
    <p data-zh="打开 PowerShell：按 <b>Win 键</b> → 输入 <b>powershell</b> → 回车" data-en="Open PowerShell: press <b>Win</b> → type <b>powershell</b> → Enter">打开 PowerShell：按 <b>Win 键</b> → 输入 <b>powershell</b> → 回车</p>
    <p class="dim" data-zh="打开的是蓝色窗口。搜不到就找「Windows PowerShell」" data-en="A blue window opens. If not found, look for &quot;Windows PowerShell&quot;">打开的是蓝色窗口。搜不到就找「Windows PowerShell」</p>
  </div></div>
  <div class="step"><div class="n">3</div><div class="step-body">
    <p data-zh="在蓝窗口里<b>点右键</b>（即粘贴），再按<b>回车</b>" data-en="<b>Right-click</b> in the blue window (this pastes), then press <b>Enter</b>">在蓝窗口里<b>点右键</b>（即粘贴），再按<b>回车</b></p>
  </div></div>
  <div class="step"><div class="n">4</div><div class="step-body">
    <p data-zh="等窗口出现「完成！」——装好后应用自动打开，输入企业账号密码即可" data-en="Wait for &quot;Done!&quot; — the app opens automatically, then sign in with your company account">等窗口出现「完成！」——装好后应用自动打开，输入企业账号密码即可</p>
    <p class="dim" data-zh="过程中窗口滚动大量文字、中途闪一下黑框，都是正常安装动作" data-en="Scrolling text and a brief black window during install are normal">过程中窗口滚动大量文字、中途闪一下黑框，都是正常安装动作</p>
  </div></div>
  <details>
    <summary data-zh="遇到问题？" data-en="Troubleshooting">遇到问题？</summary>
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
</div>

<div class="card" id="mac">
  <h2 data-zh="Mac 电脑" data-en="Mac">Mac 电脑</h2>
  <div class="step"><div class="n">1</div><div class="step-body">
    <p data-zh="复制安装命令" data-en="Copy the install command">复制安装命令</p>
    <div class="code" id="cmd-mac"></div>
    <div class="copybar"><button class="btn" onclick="copyCmd('cmd-mac',this)" data-zh="复制" data-en="Copy">复制</button></div>
    <div class="tip" id="tip-mac"><span class="ok">✓</span><span data-zh="已复制，继续第 2 步" data-en="Copied — continue to step 2">已复制，继续第 2 步</span></div>
  </div></div>
  <div class="step"><div class="n">2</div><div class="step-body">
    <p data-zh="打开终端：按 <span class='key'>Cmd</span> + <span class='key'>空格</span> → 输入 <b>终端</b> → 回车" data-en="Open Terminal: <span class='key'>Cmd</span> + <span class='key'>Space</span> → type <b>Terminal</b> → Enter">打开终端：按 <span class='key'>Cmd</span> + <span class='key'>空格</span> → 输入 <b>终端</b> → 回车</p>
  </div></div>
  <div class="step"><div class="n">3</div><div class="step-body">
    <p data-zh="按 <span class='key'>Cmd</span> + <span class='key'>V</span> 粘贴，再按<b>回车</b>" data-en="Paste with <span class='key'>Cmd</span> + <span class='key'>V</span>, then press <b>Enter</b>">按 <span class='key'>Cmd</span> + <span class='key'>V</span> 粘贴，再按<b>回车</b></p>
  </div></div>
  <div class="step"><div class="n">4</div><div class="step-body">
    <p data-zh="等窗口出现「完成！」——装好后应用自动打开，输入企业账号密码即可" data-en="Wait for &quot;Done!&quot; — the app opens automatically, then sign in with your company account">等窗口出现「完成！」——装好后应用自动打开，输入企业账号密码即可</p>
    <p class="dim" data-zh="过程中要求输入密码或回车确认，直接回车即可" data-en="If asked for a password or confirmation, just press Enter">过程中要求输入密码或回车确认，直接回车即可</p>
  </div></div>
  <details>
    <summary data-zh="遇到问题？" data-en="Troubleshooting">遇到问题？</summary>
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
</div>

<footer data-zh="换一台电脑安装？再次打开本页即可，命令会自动匹配该电脑的系统。" data-en="Setting up another computer? Open this page there — the command adapts to that system.">换一台电脑安装？再次打开本页即可，命令会自动匹配该电脑的系统。</footer>
</main>
<script>
var ORIGIN = location.origin
document.getElementById('cmd-win').textContent =
  'irm ' + ORIGIN + '/setup/windows-setup.ps1 | iex'
document.getElementById('cmd-mac').textContent =
  'curl -fsSL ' + ORIGIN + '/setup/mac-setup.sh | bash'
var ua = navigator.userAgent
var isMac = /Mac|iPhone|iPad/.test(ua)
var isWin = /Windows/.test(ua)
if (isWin) document.getElementById('mac').style.display = 'none'
if (isMac) document.getElementById('win').style.display = 'none'
function copyCmd(id, btn) {
  var text = document.getElementById(id).textContent
  var ok = function () {
    var tip = document.getElementById(id === 'cmd-win' ? 'tip-win' : 'tip-mac')
    tip.classList.add('show')
    btn.classList.add('done'); btn.textContent = document.documentElement.lang === 'zh-CN' ? '已复制' : 'Copied'
    setTimeout(function () { btn.classList.remove('done'); btn.textContent = document.documentElement.lang === 'zh-CN' ? '复制' : 'Copy' }, 2500)
  }
  var fallback = function () {
    // 剪贴板 API 不可用（非 HTTPS 且旧浏览器）：选中命令文本让用户 Ctrl+C
    var range = document.createRange()
    range.selectNodeContents(document.getElementById(id))
    var sel = window.getSelection()
    sel.removeAllRanges(); sel.addRange(range)
  }
  if (navigator.clipboard && window.isSecureContext) {
    navigator.clipboard.writeText(text).then(ok, fallback)
  } else {
    // 非 HTTPS（如 http://10.20.20.19:8898）：document.execCommand 兜底，失败则选中文本
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
function setLang(lang) {
  document.documentElement.lang = lang === 'zh-CN' ? 'zh-CN' : 'en'
  var en = lang !== 'zh-CN'
  document.querySelectorAll('[data-zh]').forEach(function (el) { el.innerHTML = en ? el.dataset.en : el.dataset.zh })
  document.getElementById('lang').textContent = en ? '中文' : 'English'
}
if (!navigator.language || !navigator.language.startsWith('zh')) setLang('en')
</script>
</body>
</html>`

const SCRIPTS = {
  'windows-setup.ps1': { file: 'windows-setup.ps1', type: 'text/plain; charset=utf-8' },
  'mac-setup.sh': { file: 'mac-setup.sh', type: 'text/x-shellscript; charset=utf-8' },
}

export function apply(ctx) {
  const router = ctx.get('router')

  ctx.effect(() => router.exact('GET', '/', async (req, res, path, url) => {
    // 根路径：浏览器访问 → 302 到员工接入页；显式要 JSON/脚本的程序化请求不动
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
    res.writeHead(200, { 'content-type': s.type, 'cache-control': 'no-store' })
    res.end(req.method === 'HEAD' ? undefined : body)
    return true
  }), 'ent-setup: route GET /setup/*')
}
