// 统一发布入口。起因是真实事故：本机与另一台机器同时发 3.2.0，晚 30 秒的那次被注册表
// 挡下（409 Cannot publish over previously staged version "3.2.0"）——号位从此永久不可用，
// 只能把同内容顺延成 3.2.1 重发。此后发版一律走这里：先把「号位是否可用」查死，
// 再动 git 与 npm，且顺序固定为 tag 先于 publish，避免出现「npm 有、git 没有」。
//
// 用法（在 gateway/ 目录）：
//   npm run release -- 3.2.2 --note "一句话摘要" [--dry] [--skip-tests] [--userconfig <path>]
// 凭据不落在仓库里：npm 用你本机已登录身份，或 --userconfig 指一个临时文件（发完自己删）。
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const PKG_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const flag = (name) => args.includes(`--${name}`)
const opt = (name) => {
  const eq = args.find((a) => a.startsWith(`--${name}=`))
  if (eq) return eq.slice(name.length + 3)
  const i = args.indexOf(`--${name}`)
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : ''
}

const fails = []
const die = (msg) => { fails.push(msg) }
const sem = (s) => String(s || '').split('.').map((x) => Number(x) || 0)
// 数值比较：字符串比会判出 "3.2.10" <= "3.2.2"，那种号迟早出现
const isNewer = (a, b) => {
  const x = sem(a); const y = sem(b)
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i]
  return false
}
const run = (cmd, argv, opts = {}) => spawnSync(cmd, argv, { cwd: PKG_DIR, encoding: 'utf8', ...opts })
const out = (cmd, argv) => {
  const r = run(cmd, argv)
  if (r.status !== 0) throw new Error(`${cmd} ${argv.join(' ')} 失败：${(r.stderr || r.stdout || '').trim().slice(0, 200)}`)
  return (r.stdout || '').trim()
}

// ---- 读现状 ----
const pkg = JSON.parse(fs.readFileSync(path.join(PKG_DIR, 'package.json'), 'utf8'))
const ONLY = flag('publish-only')
// --publish-only 用当前 package.json 的版本补发，不要求再给号
const version = (args.find((a) => /^\d+\.\d+\.\d+$/.test(a) && a !== opt('note')) || (ONLY ? pkg.version : undefined))
const repoRoot = out('git', ['rev-parse', '--show-toplevel'])
const relPkg = path.relative(repoRoot, path.join(PKG_DIR, 'package.json'))
let npmRcArgs = []
if (opt('userconfig')) npmRcArgs = [`--userconfig=${opt('userconfig')}`]

console.log(`发包目标：${pkg.name}@${version || '(未指定版本)'}   当前 package.json=${pkg.version}`)

// ---- 预检：每一条都是真踩过的坑 ----
if (!version) die('必须给出三段式版本号，例：npm run release -- 3.2.2')
else if (!/^\d+\.\d+\.\d+$/.test(version)) die(`版本号格式不对：${version}（要 x.y.z，不带 v、不带预发布后缀）`)
else if (!ONLY && !isNewer(version, pkg.version)) die(`版本号没比当前大：${version} <= ${pkg.version}（够挡住「没改号就想重发」）`)

try {
  out('git', ['fetch', 'origin', '--tags', '--prune'])
  if (!ONLY) {
    // 以下四条只约束「全新发版」；--publish-only 是补发收尾，不该被它们挡住
    if (out('git', ['status', '--porcelain'])) die('工作区不干净：发版提交必须只含版本号与发布说明，先提交或还原手头改动')
    const branch = out('git', ['rev-parse', '--abbrev-ref', 'HEAD'])
    if (branch !== 'main') die(`当前分支是 ${branch}，发版只在 main 上做`)
    const [behind, ahead] = out('git', ['rev-list', '--left-right', '--count', 'origin/main...HEAD']).split('\t').map(Number)
    if (behind || ahead) die(`本地 main 与 origin/main 不一致（落后 ${behind} / 领先 ${ahead}）：先 pull 或先把提交推上去，别在分叉上发版`)
  }
  const tagHere = out('git', ['tag', '-l', `v${version}`])
  if (ONLY) {
    if (!tagHere) die(`本地没有 tag v${version}：--publish-only 只用于「tag 已打但包没发出去」的收尾`)
  } else if (tagHere || out('git', ['ls-remote', '--tags', 'origin', `refs/tags/v${version}`])) {
    die(`tag v${version} 已存在：说明这号发过或正在发，换一个号`)
  }
  const who = run('npm', ['whoami', ...npmRcArgs])
  if (flag('publish-only')) console.log('（--publish-only：跳过工作区/分支/号位等全新发版检查）')
  if (who.status !== 0) die(`npm 未登录或 token 无效：${(who.stderr || '').split('\n')[0] || 'npm whoami 失败'}（可 --userconfig 指临时凭据文件）`)
  else console.log(`npm 身份：${who.stdout.trim()}`)
} catch (e) {
  die(String(e.message || e))
}

// 号位检查：versions 里有 = 已发布；versions 里没有但 time 里有 = 发过又撤下（墓碑），同号永不可用
try {
  const raw = out('curl', ['-s', '-m', '25', `https://registry.npmjs.org/${pkg.name}`])
  const doc = JSON.parse(raw)
  if (!ONLY) {
    const burned = version && doc?.time?.[version] && !(doc?.versions || {})[version]
    if (version && (doc?.versions || {})[version]) die(`npm 上已有 ${version}（${doc.time?.[version] ?? ''}），换一个号`)
    if (burned) die(`npm 上 ${version} 留有墓碑（发过/暂存后撤下，time[${version}]=${doc.time[version]}），同号永久不可用：换号`)
    if (version) console.log(`号位可用 ✓（注册表 latest=${doc?.['dist-tags']?.latest}，本地要发 ${version}）`)
  } else {
    const has = Boolean(version && (doc?.versions || {})[version])
    console.log(`（--publish-only：注册表 latest=${doc?.['dist-tags']?.latest}，${version} ${has ? '已存在，重复发只会 403' : '尚未发布，正该补发'}）`)
    if (has) die(`npm 上已有 ${version}，无需补发`)
  }
} catch (e) {
  die(`查不到注册表状态，不敢发：${String(e.message || e).slice(0, 160)}`)
}

if (flag('publish-only')) {
  // 只补发当前 package.json 里的版本：用于「tag 已打、publish 挂了」的收尾，不改任何东西
  const v = pkg.version
  if (fails.length) { for (const f of fails) console.error('   - ' + f); process.exit(1) }
  console.log(`只补发 ${pkg.name}@${v}（不改版本、不再提交）`)
  const only = run('npm', ['publish', '--access', 'public', ...npmRcArgs], { stdio: 'inherit' })
  if (only.status !== 0) { console.error('✗ 仍未发出去；先 npm view ' + pkg.name + ' versions 核对号位再决定'); process.exit(1) }
  const doc0 = await onRegistry(v)
  console.log(doc0 ? `✓ 注册表已有 ${v}，latest=${doc0?.['dist-tags']?.latest}` : `⚠ 已提交，稍后用 npm view ${pkg.name} version 复查`)
  process.exit(0)
}

if (!flag('skip-tests')) {
  for (const s of ['check', 'smoke']) {
    process.stdout.write(`跑 npm run ${s} … `)
    const r = run('npm', ['run', s], { stdio: 'pipe' })
    if (r.status !== 0) {
      console.log('✗')
      console.error((r.stdout || '') + (r.stderr || ''))
      die(`npm run ${s} 没过（输出见上）`)
    } else console.log('✓')
  }
}

if (fails.length) {
  console.error('\n✗ 发版预检未通过：')
  for (const f of fails) console.error('   - ' + f)
  process.exit(1)
}

if (flag('dry')) {
  console.log(`\n[--dry] 预检通过，未做任何改动。将执行：改 ${relPkg} → 生成 docs/release-notes/v${version}.zh.md → 一条提交 → tag v${version} → push main+tag → npm publish → 轮询验证`)
  process.exit(0)
}

// ---- 生成发布说明：摘要 + 上一个 tag 到现在的提交清单，事后照样能对着它写 GitHub Release ----
const prevTag = out('git', ['describe', '--tags', '--abbrev=0', '--match', 'v*']).trim()
const logLines = out('git', ['log', '--oneline', `${prevTag}..HEAD`]).split('\n').filter(Boolean)
const note = opt('note') || `承接 ${prevTag} 的增量发布`
const notesRel = `docs/release-notes/v${version}.zh.md`
const notesAbs = path.join(PKG_DIR, notesRel)
fs.mkdirSync(path.dirname(notesAbs), { recursive: true })
fs.writeFileSync(notesAbs, `# v${version} · ${note}

> 上一版本：\`${prevTag}\`。本文件由 \`npm run release\` 生成，摘要可再编辑；
> 需要写进 GitHub Release 正文时直接整段粘过去。

## 本版本包含的提交（${logLines.length} 条）

${logLines.map((l) => '- ' + l).join('\n')}
`, 'utf8')
console.log(`✓ 发布说明：${notesRel}（${logLines.length} 条提交）`)

fs.writeFileSync(path.join(PKG_DIR, 'package.json'),
  fs.readFileSync(path.join(PKG_DIR, 'package.json'), 'utf8').replace(`"version": "${pkg.version}"`, `"version": "${version}"`), 'utf8')

const subject = `chore: release v${version} — ${note}`
out('git', ['-C', repoRoot, 'add', relPkg, path.join(path.dirname(relPkg), notesRel)])
out('git', ['-C', repoRoot, 'commit', '-m', subject, '-m', `由 scripts/release.mjs 执行：发版前已核过工作区干净、main 与 origin 一致、tag 未占用、npm 号位可用（含墓碑检测）。`])
out('git', ['-C', repoRoot, 'tag', '-a', `v${version}`, '-m', `v${version} — ${note}`])
console.log(`✓ 已提交并打 tag：${subject}`)
out('git', ['-C', repoRoot, 'push', 'origin', 'main', `v${version}`])
console.log('✓ 已推 origin（main + tag）')

const onRegistry = async (ver) => {
  for (let i = 0; i < 6; i++) {
    try {
      const doc = JSON.parse(out('curl', ['-s', '-m', '20', `https://registry.npmjs.org/${pkg.name}`]))
      if ((doc?.versions || {})[ver]) return doc
    } catch { /* 网络抖，下一轮 */ }
    await new Promise((r) => setTimeout(r, 8000))
  }
  return null
}

console.log('npm publish …')
const pub = run('npm', ['publish', '--access', 'public', ...npmRcArgs], { stdio: 'inherit' })
if (pub.status !== 0) {
  // 真机教训：ECONNRESET 可能发生在「PUT 已落库、响应未回」之后，此时盲目重发只会 403
  // （You cannot publish over the previously published versions）。先回查再定性。
  const doc = await onRegistry(version)
  if (doc) {
    console.log(`⚠ publish 报错，但注册表上 ${version} 已经在了（PUT 已落库，只是响应被切断）——`)
    console.log(`  千万不要重发同号；latest=${doc?.['dist-tags']?.latest}，稍后用 npm view ${pkg.name} version 复查即可`)
    console.log(`  要补发新内容请换号重跑：npm run release -- <更大的号> --note "…"`)
    process.exit(2)
  }
  console.error('✗ npm publish 失败且注册表确认没有该版本。git 侧已经是对的（tag 已推），')
  console.error('  修好凭据/网络后用 `npm run release -- --publish-only` 只补发，不要改内容重发同号。')
  process.exit(1)
}

// 注册表处理是异步的，元数据先可见、tarball 后传播，这里轮询到 latest 落定
let ok = false
for (let i = 0; i < 12 && !ok; i++) {
  await new Promise((r) => setTimeout(r, 10000))
  try {
    const doc = JSON.parse(out('curl', ['-s', '-m', '20', `https://registry.npmjs.org/${pkg.name}`]))
    ok = doc?.['dist-tags']?.latest === version
    console.log(`  第 ${i + 1} 次核对：latest=${doc?.['dist-tags']?.latest}`)
  } catch { /* 下一轮再试 */ }
}
console.log(ok ? `✓ npm latest = ${version}` : `⚠ publish 已提交但注册表还没落到 latest=${version}，几分钟后用 npm view ${pkg.name} version 复查`)
console.log(`GitHub Release 直达：https://github.com/${out('git', ['-C', repoRoot, 'remote', 'get-url', 'origin']).match(/[\w.-]+\/[\w.-]+?(\.git)?$/)?.[0].replace(/\.git$/, '') ?? ''}/releases/new?tag=v${version}`)
console.log(`正文可直接用 ${notesRel}`)
