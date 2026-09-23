#!/usr/bin/env node
/**
 * 安装包库 + 环境物料端到端校验（离线，不碰公网）：
 * 上传 → 发布 → releases.json / env.json 契约 → 整包下载 → Range 续传 → 摘要是实算的 → 换版本回滚 → 删包
 * 另含下载原语（core/artifact-http.mjs）的白名单/摘要/体积闸自测，用一个本机 http 服务，不出网。
 * 用途：改动 desktop-repo / env-repo / ent-desktop 路由后，`npm run e2e:desktop` 一键回归。
 */
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync, readFileSync, statSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import net from 'node:net'

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..')
const steps = []
let failed = false
const ok = (m) => { steps.push(m); console.log(`✓ ${m}`) }
const bad = (m, d = '') => { failed = true; console.error(`✗ ${m}${d ? '：' + d : ''}`) }

async function freePort() {
  return new Promise((res) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)) }) })
}

async function req(method, url, { token, body, raw } = {}) {
  const r = await fetch(url, {
    method,
    headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  })
  if (raw) return { status: r.status, buf: Buffer.from(await r.arrayBuffer()), headers: r.headers }
  return { status: r.status, json: await r.json().catch(() => ({})) }
}

const dataDir = mkdtempSync(join(tmpdir(), 'dsh-desktop-e2e-'))
const port = await freePort()
const child = spawn(process.execPath, [join(root, 'gateway.mjs')], {
  env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', ENT_DATA_DIR: dataDir, ENT_DB_PATH: join(dataDir, 'gateway.db'), ENT_GATEWAY_CONFIG: join(dataDir, 'gateway-config.json') },
  stdio: ['ignore', 'pipe', 'pipe'],
})
let out = ''
child.stdout.on('data', (d) => { out += d })
child.stderr.on('data', (d) => { out += d })

function stop(code) {
  console.log(`\n—— 桌面包回归：${failed ? 'FAIL' : 'PASS'}（${steps.length} 步）——`)
  if (failed && out.trim()) console.error('—— 网关日志 ——\n' + out.trim().split('\n').slice(-25).join('\n'))
  try { child.kill() } catch { /* 已退出 */ }
  try { rmSync(dataDir, { recursive: true, force: true }) } catch { /* Windows 句柄延迟 */ }
  process.exit(code)
}

const B = `http://127.0.0.1:${port}`
try {
  const deadline = Date.now() + 20_000
  let up = false
  while (Date.now() < deadline) {
    try { if ((await req('GET', `${B}/health`)).status === 200) { up = true; break } } catch { /* 未起 */ }
    await new Promise((r) => setTimeout(r, 300))
  }
  if (!up) { bad('网关启动', '20s 内 /health 未就绪'); stop(1) }

  const pw = /初始密码: ([0-9a-f]{12})/.exec(out)?.[1]
  const login = await req('POST', `${B}/auth/login`, { body: { username: 'admin', password: pw } })
  if (!login.json.token) { bad('管理员登录', JSON.stringify(login.json).slice(0, 160)); stop(1) }
  const tok = login.json.token
  ok('网关就绪并登录')

  // 1b. 下载原语离线自测：白名单、摘要口径、体积闸 —— 安装包与环境物料的下载都走它
  const A = await import('../src/core/artifact-http.mjs')
  const { createServer } = await import('node:http')
  if (A.parseDigest('sha512-' + 'A'.repeat(86) + '==')?.algo !== 'sha512') bad('npm integrity 解析', 'sha512 前缀没认出来')
  else if (A.parseDigest('a'.repeat(64))?.algo !== 'sha256') bad('SHASUMS 裸摘要解析', 'sha256 没认出来')
  else if (!A.digestMatches({ algo: 'sha512', value: '3c14/+9' }, { sha512: '3c14/+9==' })) bad('base64 padding 口径', '同一摘要判成不一致')
  else if (A.digestMatches({ algo: 'sha256', value: 'a'.repeat(64) }, { sha256: 'b'.repeat(64) })) bad('摘要比对', '不同的值竟然判过')
  else ok('摘要口径正确（GitHub digest / npm integrity / SHASUMS 裸摘要 / padding 差异）')

  let denied = ''
  try { await A.getJson('https://evil.example.com/x', { trusted: A.BASE_TRUSTED_HOSTS }) } catch (e) { denied = String(e?.message ?? e) }
  if (!/白名单/.test(denied)) bad('下载主机白名单', `没拦住：${denied || '竟然放行'}`)
  else ok('非白名单下载主机被拦（网关不会去任意地址取包）')

  const blob = Buffer.alloc(3_000_000, 7)
  const srv = createServer((_q, rsp) => { rsp.writeHead(200, { 'content-type': 'application/octet-stream' }); rsp.end(blob) })
  await new Promise((r) => srv.listen(0, '127.0.0.1', r))
  const blobUrl = `http://127.0.0.1:${srv.address().port}/blob`
  const blobDest = join(dataDir, 'prim', 'blob.bin')
  try {
    await A.downloadTo(blobUrl, blobDest, { maxMb: 1, allowed: ['127.0.0.1'] })
    bad('体积上限', '超过 maxMb 却下载成功')
  } catch (e) {
    if (!/超过上限/.test(String(e?.message ?? e))) bad('体积上限', String(e?.message ?? e))
    else if (existsSync(blobDest + '.part')) bad('体积超限残留半截文件', '失败路径没清理 .part')
    else ok('超过 maxMb 立即中断，且不留半截文件')
  }
  const gotBlob = await A.downloadTo(blobUrl, blobDest, { maxMb: 20, allowed: ['127.0.0.1'] })
  srv.close()
  const blob256 = createHash('sha256').update(blob).digest('hex')
  const blob512 = createHash('sha512').update(blob).digest('base64')
  if (gotBlob.size !== blob.length || gotBlob.sha256 !== blob256 || gotBlob.sha512 !== blob512) {
    bad('流式摘要', `size=${gotBlob.size} sha256=${String(gotBlob.sha256).slice(0, 12)}`)
  } else if (!A.digestMatches(A.parseDigest('sha512-' + blob512), gotBlob)) bad('integrity 比对', '与实算摘要对不上')
  else ok('流式下载边下边算，sha256/sha512 与内容一致')

  // 1. 空库也要给出可解析的契约（安装脚本靠它判断走不走内网）
  const empty = await req('GET', `${B}/setup/releases.json`)
  if (empty.status !== 200 || empty.json.ok !== true || empty.json.version !== null) bad('空库 releases.json', JSON.stringify(empty.json).slice(0, 160))
  else ok('空库 releases.json 契约完好（version=null，脚本会转公网兜底）')

  // 2. 未入库版本不许下发
  const ghost = await req('PATCH', `${B}/admin/desktop-repo`, { token: tok, body: { published: '9.9.9' } })
  if (ghost.status === 200) bad('发布未入库版本', '竟然放行')
  else ok(`发布未入库版本被拒（HTTP ${ghost.status}）`)

  // 3. 离线上传两个平台的包（内容随便造，摘要由网关实算）
  const mkPkg = (n) => { const b = Buffer.alloc(700_000); for (let i = 0; i < b.length; i++) b[i] = (i * 31 + n) & 0xff; return b }
  const up1 = await fetch(`${B}/admin/desktop-repo/upload?version=9.9.9&platform=mac&fileName=e2e-universal.dmg`, {
    method: 'POST', headers: { authorization: `Bearer ${tok}` }, body: mkPkg(1),
  })
  const up2 = await fetch(`${B}/admin/desktop-repo/upload?version=9.9.9&platform=win&fileName=e2e-x64-Setup.exe`, {
    method: 'POST', headers: { authorization: `Bearer ${tok}` }, body: mkPkg(2),
  })
  if (up1.status !== 200 || up2.status !== 200) { bad('离线上传', `mac=${up1.status} win=${up2.status}`); stop(1) }
  ok('离线上传 mac + win 入库')

  // 4. 发布
  const pub = await req('PATCH', `${B}/admin/desktop-repo`, { token: tok, body: { published: '9.9.9' } })
  if (pub.json.overview?.published !== '9.9.9') bad('设为下发版本', JSON.stringify(pub.json).slice(0, 160))
  else ok('设为下发版本生效')

  // 5. 契约里两个平台都齐，且摘要是内容实算的
  const rel = await req('GET', `${B}/setup/releases.json`)
  const wantMac = createHash('sha256').update(mkPkg(1)).digest('hex')
  const wantWin = createHash('sha256').update(mkPkg(2)).digest('hex')
  if (rel.json.version !== '9.9.9' || rel.json.mac?.sha256 !== wantMac || rel.json.win?.sha256 !== wantWin) {
    bad('releases.json 摘要', `mac=${rel.json.mac?.sha256?.slice(0, 12)} 期望 ${wantMac.slice(0, 12)}`)
  } else ok('releases.json 下发的 sha256 与包内容一致')
  if (rel.json.mac?.verified !== false) bad('上传包不应标记 verified', String(rel.json.mac?.verified))
  else ok('上传包如实标记为未经上游摘要校验')

  // 6. 整包下载 + 缺省版本路径
  const dl = await req('GET', `${B}${rel.json.mac.path}`, { raw: true })
  if (dl.status !== 200 || dl.buf.length !== 700_000) bad('整包下载', `HTTP ${dl.status} ${dl.buf.length}B`)
  else if (dl.headers.get('x-content-sha256') !== wantMac) bad('下载响应缺摘要')
  else ok('整包下载完好（含 x-content-sha256）')
  const def = await req('GET', `${B}/setup/packages/win`, { raw: true })
  if (def.status !== 200 || createHash('sha256').update(def.buf).digest('hex') !== wantWin) bad('缺省版本下载', `HTTP ${def.status}`)
  else ok('不带版本号的 /setup/packages/:platform 走当前下发版本')

  // 7. Range 续传（脚本用 curl -C - / IWR 断点续传依赖它）
  const rg = await fetch(`${B}/setup/packages/mac/9.9.9`, { headers: { range: 'bytes=1000-1999' } })
  const rb = Buffer.from(await rg.arrayBuffer())
  if (rg.status !== 206 || rb.length !== 1000 || rg.headers.get('content-range') !== 'bytes 1000-1999/700000') {
    bad('Range 续传', `HTTP ${rg.status} ${rb.length}B ${rg.headers.get('content-range')}`)
  } else ok('Range 分段返回 206（断点续传可用）')

  // 8. 下发中的版本不许删；回滚可切回旧版本，且刚切走的版本不会立刻被清理（避免升级中的机器 404）
  const delLocked = await req('DELETE', `${B}/admin/desktop-repo/9.9.9`, { token: tok })
  if (delLocked.status === 200) bad('删除下发中的版本', '竟然放行')
  else ok('删除当前下发版本被拒（防手滑断供）')

  const upOld = await fetch(`${B}/admin/desktop-repo/upload?version=9.9.8&platform=mac&fileName=e2e-old-universal.dmg`, {
    method: 'POST', headers: { authorization: `Bearer ${tok}` }, body: mkPkg(3),
  })
  if (upOld.status !== 200) { bad('上传旧版本', String(upOld.status)); stop(1) }
  const back = await req('PATCH', `${B}/admin/desktop-repo`, { token: tok, body: { published: '9.9.8' } })
  if (back.json.overview?.published !== '9.9.8') bad('回滚旧版本', JSON.stringify(back.json).slice(0, 160))
  else ok('可切回旧版本（回滚路径可用）')
  const stillThere = await req('GET', `${B}/setup/packages/win/9.9.9`, { raw: true })
  if (stillThere.status !== 200) bad('切走后包被立刻清理', `9.9.9/win 应仍可下载（HTTP ${stillThere.status}）`)
  else ok('刚切走的版本在保留窗口内继续可下载（升级中的机器不断供）')

  const cancel = await req('PATCH', `${B}/admin/desktop-repo`, { token: tok, body: { published: '' } })
  if (cancel.json.overview?.published) bad('取消下发', `published 应为空，实际 ${cancel.json.overview.published}`)
  else ok('取消下发后不再对外声明版本（脚本自动转公网兜底）')
  const del = await req('DELETE', `${B}/admin/desktop-repo/9.9.8`, { token: tok })
  if (del.status !== 200) bad('删除非下发版本', JSON.stringify(del.json).slice(0, 160))
  else ok('非下发版本可删，释放磁盘')

  // 9. 环境物料（Node / pnpm）：纯内网装机的另一半，离线上传 → 发布 → 下发 → 下载
  const e1 = await req('GET', `${B}/setup/env.json`)
  if (e1.status !== 200 || e1.json.ok !== true || e1.json.node !== null || e1.json.pnpm !== null
    || typeof e1.json.allowUpstreamFallback !== 'boolean') {
    bad('空库 env.json', `HTTP ${e1.status} ${JSON.stringify(e1.json).slice(0, 160)}`)
  } else ok('空库 env.json 契约完好（node/pnpm 均 null，脚本会转公网兜底）')

  const ghostNode = await req('PATCH', `${B}/admin/desktop-repo`, { token: tok, body: { publishedNode: '24.0.0' } })
  if (ghostNode.status === 200) bad('发布未入库的 Node 版本', '竟然放行')
  else ok(`发布未入库的 Node 版本被拒（HTTP ${ghostNode.status}）`)

  const mkEnv = (n) => { const b = Buffer.alloc(300_000); for (let i = 0; i < b.length; i++) b[i] = (i * 37 + n) & 0xff; return b }
  const envUp = async (kind, version, platform, fileName, n) => {
    const r = await fetch(`${B}/admin/env-repo/upload?kind=${kind}&version=${version}&platform=${platform}&fileName=${encodeURIComponent(fileName)}`, {
      method: 'POST', headers: { authorization: `Bearer ${tok}` }, body: mkEnv(n),
    })
    if (r.status !== 200) { bad(`环境物料上传 ${kind}/${platform}`, String(r.status)); return false }
    return true
  }
  const upNodeMac = await envUp('node', '24.0.0', 'mac-arm64', 'node-v24.0.0-darwin-arm64.tar.gz', 11)
  const upNodeWin = await envUp('node', '24.0.0', 'win-x64', 'node-v24.0.0-win-x64.zip', 12)
  const upPnpm = await envUp('pnpm', '12.0.0', 'mac-arm64', 'exe.darwin-arm64-12.0.0.tgz', 13)
  if (upNodeMac && upNodeWin && upPnpm) ok('离线上传 Node（两平台）+ pnpm 原生包入库')

  const envPub = await req('PATCH', `${B}/admin/desktop-repo`, { token: tok, body: { publishedNode: '24.0.0', publishedPnpm: '12.0.0' } })
  if (envPub.json.env?.overview?.published?.node !== '24.0.0' || envPub.json.env?.overview?.published?.pnpm !== '12.0.0') {
    bad('设为下发环境物料', JSON.stringify(envPub.json.env ?? envPub.json).slice(0, 160))
  } else ok('Node 与 pnpm 的发布指针各自独立生效')

  const envJson = await req('GET', `${B}/setup/env.json`)
  const wantNodeMac = createHash('sha256').update(mkEnv(11)).digest('hex')
  const wantPnpm = createHash('sha256').update(mkEnv(13)).digest('hex')
  if (envJson.json.node?.version !== '24.0.0' || envJson.json.node?.files?.['mac-arm64']?.sha256 !== wantNodeMac) {
    bad('env.json 的 Node 摘要', `mac-arm64=${envJson.json.node?.files?.['mac-arm64']?.sha256?.slice(0, 12)} 期望 ${wantNodeMac.slice(0, 12)}`)
  } else ok('env.json 按平台下发，sha256 与包内容一致')
  if (!envJson.json.node?.files?.['win-x64'] || envJson.json.pnpm?.files?.['mac-arm64']?.version !== '12.0.0') {
    bad('env.json 平台清单', JSON.stringify(envJson.json).slice(0, 200))
  } else ok('Node 与 pnpm 同构：都按机器架构给 files（脚本按自己架构取用）')

  const envDl = await req('GET', `${B}${envJson.json.node.files['mac-arm64'].path}`, { raw: true })
  if (envDl.status !== 200 || envDl.buf.length !== 300_000 || envDl.headers.get('x-content-sha256') !== wantNodeMac) {
    bad('环境物料整包下载', `HTTP ${envDl.status} ${envDl.buf?.length}B`)
  } else ok('环境物料走同一条下载链（含 x-content-sha256）')
  const envDef = await req('GET', `${B}/setup/env/pnpm/mac-arm64`, { raw: true })
  if (envDef.status !== 200 || createHash('sha256').update(envDef.buf).digest('hex') !== wantPnpm) {
    bad('不带版本号的环境物料下载', `HTTP ${envDef.status}`)
  } else ok('不带版本号走当前下发的 pnpm 版本')
  const envRg = await fetch(`${B}/setup/env/node/win-x64/24.0.0`, { headers: { range: 'bytes=299000-' } })
  const envRb = Buffer.from(await envRg.arrayBuffer())
  if (envRg.status !== 206 || envRb.length !== 1000) bad('环境物料 Range 续传', `HTTP ${envRg.status} ${envRb.length}B`)
  else ok('环境物料支持 Range 续传（装机脚本 -C - / IWR 依赖）')

  const envDelLocked = await req('DELETE', `${B}/admin/env-repo/node/24.0.0`, { token: tok })
  if (envDelLocked.status === 200) bad('删除下发中的环境物料', '竟然放行')
  else ok(`删除下发中的环境物料被拒（HTTP ${envDelLocked.status}）`)
  const envCancel = await req('PATCH', `${B}/admin/desktop-repo`, { token: tok, body: { publishedNode: '' } })
  if (envCancel.json.env?.overview?.published?.node) bad('取消环境物料下发', JSON.stringify(envCancel.json.env).slice(0, 160))
  else ok('取消 Node 下发不影响 pnpm 的下发（指针互不干扰）')
  const envDel = await req('DELETE', `${B}/admin/env-repo/node/24.0.0`, { token: tok })
  if (envDel.status !== 200) bad('删除非下发的环境物料', JSON.stringify(envDel.json).slice(0, 160))
  else ok('非下发的环境物料可删，释放磁盘')

  const envAnon = await req('POST', `${B}/admin/env-repo/check`)
  if (envAnon.status === 200) bad('未鉴权触发环境物料检测', '竟然放行')
  else ok(`未鉴权触发环境物料检测被拒（HTTP ${envAnon.status}）`)

  // 10. 管理面鉴权：无令牌一律拒绝
  const anon = await req('GET', `${B}/admin/desktop-repo`)
  if (anon.status === 200) bad('未鉴权访问发布台', '竟然放行')
  else ok(`未鉴权访问发布台被拒（HTTP ${anon.status}）`)
} catch (e) {
  bad('流程异常', String(e))
} finally {
  stop(failed ? 1 : 0)
}
