#!/usr/bin/env node
/**
 * 管理台插件页面 UI 体检（需要本机 Chrome；没有 Chrome 时跳过并返回 0）
 *
 * 为什么要有这个：接口 200、JS 能解析，跟「页面长对了」是两件事。桌面客户端页曾把
 * .field/.check/.grid/.tbl 这些 app.css 里根本不存在的类当现成组件用，整块设置区
 * 裸奔了很久都没人发现——因为没人真的看过渲染结果。这里用 Chrome 把每个导航项点一遍：
 *   1) 该路由的 section 是否挂载且有内容
 *   2) 页面里用到的每个 class 是否真的在 app.css 里有定义（自造类 = 该区块没样式）
 *   3) 装载/交互过程中有没有 console error / 未捕获异常
 *   4) 每页截图留档（默认 data/ui-shots/<route>.png，人工再扫一眼）
 *
 * 用法：
 *   node gateway.mjs                       # 另开一个网关（默认 8899）
 *   ENT_ADMIN_TOKEN=*** npm run ui:check   # 或 ENT_ADMIN_USER/ENT_ADMIN_PASSWORD 走登录接口
 *   npm run ui:check -- --base=http://10.0.0.5:8900 --shots=/tmp/shots
 * 退出码：0 通过（或没 Chrome 而跳过）；1 有页面异常。
 */
import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const argv = process.argv.slice(2)
const argOf = (name, dflt) => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`))
  return hit ? hit.slice(name.length + 3) : dflt
}
const BASE = argOf('base', process.env.ENT_BASE_URL || 'http://127.0.0.1:8900')
const SHOTS = argOf('shots', process.env.ENT_UI_SHOTS || 'data/ui-shots')
const PROFILE = join(tmpdir(), `dsh-ui-chrome-${Date.now()}`)
const CHROME = argOf('chrome', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')
const PORT = Number(argOf('debug-port', '9411'))
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

if (!existsSync(CHROME)) {
  console.log(`（跳过 UI 体检：找不到 Chrome —— ${CHROME}；要跑就加 --chrome=/path/to/chrome）`)
  process.exit(0)
}

/* ---- 拿一个能用的管理台令牌：优先环境变量，其次走登录接口 ---- */
async function getToken() {
  if (process.env.ENT_ADMIN_TOKEN) return process.env.ENT_ADMIN_TOKEN
  const user = process.env.ENT_ADMIN_USER
  const pass = process.env.ENT_ADMIN_PASSWORD
  if (!user || !pass) {
    console.error('✗ 缺登录凭据：设 ENT_ADMIN_TOKEN，或 ENT_ADMIN_USER + ENT_ADMIN_PASSWORD')
    process.exit(1)
  }
  const r = await fetch(`${BASE}/auth/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: user, password: pass }),
  })
  const j = await r.json().catch(() => ({}))
  if (!j?.token) { console.error(`✗ 登录失败 HTTP ${r.status}`); process.exit(1) }
  return j.token
}

const token = await getToken()
const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run',
  `--user-data-dir=${PROFILE}`, `--remote-debugging-port=${PORT}`, '--remote-allow-origins=*',
  '--window-size=1440,1200', 'about:blank'], { stdio: 'ignore' })

let target = null
for (let i = 0; i < 60; i++) {
  await sleep(300)
  try {
    const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()
    const page = list.find((t) => t.type === 'page')
    if (page) { target = page; break }
  } catch { /* 还在起 */ }
}
if (!target) { console.error('✗ Chrome 调试端口没起来'); chrome.kill(); process.exit(1) }

const ws = new WebSocket(target.webSocketDebuggerUrl)
let seq = 0
const pend = new Map()
const errs = []
await new Promise((r) => { ws.onopen = r })
ws.onmessage = (e) => {
  const m = JSON.parse(e.data)
  if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id) }
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
    errs.push(m.params.args.map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 200))
  }
  if (m.method === 'Runtime.exceptionThrown') {
    errs.push('未捕获异常: ' + String(m.params.exceptionDetails?.exception?.description || m.params.exceptionDetails?.text).slice(0, 200))
  }
}
const send = (method, params = {}) => new Promise((r) => { const id = ++seq; pend.set(id, r); ws.send(JSON.stringify({ id, method, params })) })
const evl = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  if (r.error) throw new Error(JSON.stringify(r.error))
  return r.result?.result?.value
}

await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable')
// 管理台登录态是 HttpOnly cookie：页面模块的动态 import 只认它，localStorage 只给壳路由用
await send('Network.setCookie', { name: 'ent_jwt', value: token, url: BASE, path: '/', httpOnly: true, sameSite: 'Strict' })
await send('Page.navigate', { url: `${BASE}/admin/` }); await sleep(1600)
await evl(`localStorage.setItem('ent_jwt', ${JSON.stringify(token)}); localStorage.setItem('ent_gw', ${JSON.stringify(BASE)}); 1`)
await send('Page.navigate', { url: `${BASE}/admin/` }); await sleep(3600)

/* ---- 样式白名单来源：app.css 里真实出现过的类名 ---- */
const known = await evl(`(async () => {
  const css = await (await fetch('${BASE}/admin/static/app.css')).text()
  return [...new Set((css.match(/\\.[A-Za-z_][\\w-]*/g) || []).map((s) => s.slice(1)))]
})()`)
const KNOWN = new Set(known)
// 状态/修饰类由宿主类限定作用域（.badge.ok 之类），单看 token 名不在 app.css 顶层也正常
const MODIFIERS = new Set(['ok', 'warn', 'bad', 'dim', 'primary', 'danger', 'sm', 'full', 'grow', 'active', 'open', 'down', 'up', 'on', 'off', 'disabled', 'spin'])
// 元素级规则也算「有样式」：app.css 直接给 table/th/td/select 这类元素定过样式
const ELEMENT_STYLED = await evl(`(async () => {
  const css = await (await fetch('${BASE}/admin/static/app.css')).text()
  return [...new Set((css.match(/(^|[},;\\n])[\\t ]*([a-z]+)(?=[\\s.:#,>+{])/g) || []).map((x) => x.replace(/[^a-z]/g, '')))]
})()`)
const ELEM = new Set(ELEMENT_STYLED.filter((t) => /^(a|abbr|b|code|h1|h2|h3|hr|i|input|label|li|ol|p|pre|s|select|small|span|strong|table|tbody|td|textarea|th|thead|tr|ul)$/.test(t)))
// 明确的行为钩子（不是样式类）：--allow=r-id,r-label 之类可临时放行
const ALLOW = new Set((argOf('allow', '') || '').split(',').map((x) => x.trim()).filter(Boolean))

const allRoutes = await evl(`[...new Set([...document.querySelectorAll('[data-nav]')].map((a) => a.dataset.nav))]`)
// --only=a,b 只体检指定路由（改一个页面时不用等全站跑完）
const only = (argOf('only', '') || '').split(',').map((x) => x.trim()).filter(Boolean)
const routes = only.length ? allRoutes.filter((r) => only.includes(r)) : allRoutes
if (only.length && !routes.length) { console.error(`✗ --only 里的路由一个都不在导航里：${only.join(', ')}`); chrome.kill(); process.exit(1) }
if (!routes.length) { console.error('✗ 没从左侧导航取到任何路由（壳没起来？）'); chrome.kill(); process.exit(1) }
if (!existsSync(SHOTS)) mkdirSync(SHOTS, { recursive: true })

let bad = 0
console.log(`体检 ${routes.length} 个页面（${BASE}）\n`)
for (const route of routes) {
  errs.length = 0
  await evl(`location.hash='#/${route}'; 1`)
  await sleep(1300)
  const info = await evl(`(() => {
    const sec = document.getElementById('page-${route}')
    if (!sec || sec.hidden) return { missing: true }
    const KNOWN = new Set(${JSON.stringify([...KNOWN])})
    const MOD = new Set(${JSON.stringify([...MODIFIERS])})
    const ELEM = new Set(${JSON.stringify([...ELEM])})
    const ALLOW = new Set(${JSON.stringify([...ALLOW])})
    const cls = new Set()
    // 同类无类名基线元素对比：算得出差异说明有别处的规则在渲染它（class 名不在 app.css 不代表没样式）
    const PROPS = ['display', 'position', 'paddingTop', 'paddingLeft', 'marginTop', 'borderTopWidth', 'backgroundColor', 'color', 'fontSize', 'fontWeight', 'textAlign', 'gridColumnStart', 'textTransform']
    const styledElsewhere = (el) => {
      const p = el.parentElement
      if (!p) return true
      const probe = document.createElement(el.tagName)
      p.appendChild(probe)
      const a = getComputedStyle(el); const b = getComputedStyle(probe)
      const diff = PROPS.some((k) => a[k] !== b[k])
      probe.remove()
      return diff
    }
    const bare = []   // 只挂着 app.css 里不存在的类、又没有内联样式/元素级规则兜底的元素 = 真的裸奔
    sec.querySelectorAll('[class]').forEach((el) => {
      el.classList.forEach((c) => cls.add(c))
      const cs = [...el.classList]
      const unknown = cs.filter((c) => !KNOWN.has(c) && !MOD.has(c) && !ALLOW.has(c))
      if (!unknown.length || cs.length !== unknown.length) return
      if (el.getAttribute('style')) return
      const tag = el.tagName.toLowerCase()
      if (ELEM.has(tag)) return
      if (styledElsewhere(el)) return   // 父级/后代选择器（.lic-vs-head > span）也算有样式
      bare.push(tag + '.' + unknown.join('.'))
    })
    return { text: (sec.innerText || '').replace(/\\s+/g, ' ').slice(0, 26), height: sec.scrollHeight, classes: [...cls], bare: [...new Set(bare)] }
  })()`)
  const pic = await send('Page.captureScreenshot', { format: 'png' })
  if (pic?.result?.data) writeFileSync(join(SHOTS, `${route}.png`), Buffer.from(pic.result.data, 'base64'))

  if (info.missing) { console.log(`✗ #/${route} 没有挂载 section#page-${route}（或一直是 hidden）`); bad++; continue }
  const pageErrs = errs.slice(0, 3)
  if (info.bare.length || pageErrs.length || !info.text) {
    bad++
    console.log(`✗ #/${route}`)
    if (!info.text) console.log('    页面没有可见内容')
    for (const b of info.bare) console.log(`    没有任何样式来源的元素：${b}（app.css 里没有这个类，也没内联样式/元素级规则）`)
    for (const e of pageErrs) console.log(`    控制台：${e}`)
  } else {
    console.log(`✓ #/${route}  ${info.height}px · ${info.classes.length} 个类 · ${info.text}`)
  }
}

await send('Browser.close').catch(() => {})
chrome.kill()
await sleep(600)   // Chrome 还在收尾时删目录会 ENOTEMPTY，这里只是临时 profile，删不掉也不影响结论
try { rmSync(PROFILE, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 }) } catch { /* 临时目录，留着无害 */ }
console.log(`\n截图：${SHOTS}/<route>.png`)
console.log(bad ? `—— UI 体检：FAIL（${bad}/${routes.length} 个页面有问题）——` : `—— UI 体检：PASS（${routes.length} 个页面）——`)
process.exit(bad ? 1 : 0)
