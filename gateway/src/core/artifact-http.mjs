/**
 * 物料下载原语（HTTP + 流式落盘 + 摘要校验）
 *
 * 为什么单独一个模块：桌面安装包（core/desktop-repo.mjs）与环境物料
 * （core/env-repo.mjs）是两套业务索引，但「怎么把几百 MB 安全落到磁盘」是同一件事 ——
 * 白名单、明文限制、体积上限、边下边算摘要、坏文件不留，这些策略必须只有一份，
 * 否则日后收紧一处会漏掉另一处（网关是二进制分发点，漏一处就是供应链口子）。
 */
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { Transform } from 'node:stream'

/** 公共可信域：上游发布方与官方镜像。域名走后缀匹配，业务域可再追加自己的 */
export const BASE_TRUSTED_HOSTS = ['github.com', 'githubusercontent.com', 'modelscope.cn', 'aliyuncs.com']

/** 明文只允许本机：便于本地起服务做校验，不给外网明文开口子 */
function assertAllowedUrl(raw, { trusted = [], allowed = [] } = {}) {
  let u
  try { u = new URL(raw) } catch { throw new Error(`下载地址不合法: ${raw}`) }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error('只允许 http(s) 下载源')
  if (u.protocol === 'http:' && !['127.0.0.1', 'localhost'].includes(u.hostname)) throw new Error('明文 http 下载源只允许本机')
  const suffixes = [...trusted, ...allowed]
  const host = u.hostname.toLowerCase()
  if (!suffixes.some((s) => host === s || host.endsWith('.' + s))) throw new Error(`下载源不在白名单: ${host}`)
  return u
}

/** 取 JSON（远端源探测用；超时是硬要求，否则巡检链路会被一个死连接吊住） */
export async function getJson(url, { headers = {}, timeoutMs = 20000, trusted = [], allowed = [] } = {}) {
  assertAllowedUrl(url, { trusted, allowed })
  const r = await fetch(url, { redirect: 'follow', headers: { 'user-agent': 'dsh-enterprise-gateway', ...headers }, signal: AbortSignal.timeout(timeoutMs) })
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  return await r.json()
}

/** 取纯文本（Node 的 SHASUMS256.txt 是文本清单，不是 JSON） */
export async function getText(url, { headers = {}, timeoutMs = 20000, trusted = [], allowed = [] } = {}) {
  assertAllowedUrl(url, { trusted, allowed })
  const r = await fetch(url, { redirect: 'follow', headers: { 'user-agent': 'dsh-enterprise-gateway', ...headers }, signal: AbortSignal.timeout(timeoutMs) })
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  return await r.text()
}

/**
 * 流式落盘 + 边下边算摘要（安装包 150~330MB，绝不能进内存）。
 * 同时算 sha256 与 sha512：上游各家给的东西不一样 —— GitHub/Node 给 sha256 十六进制，
 * npm registry 的 dist.integrity 给 `sha512-<base64>`。两个都算，校验时才不用重下。
 * @returns {Promise<{file:string,size:number,sha256:string,sha512:string}>} file 是 .part 临时路径，校验通过后由调用方改名
 */
export async function downloadTo(url, dest, { headers = {}, maxMb = 2048, timeoutMs = 45 * 60 * 1000, trusted = [], allowed = [] } = {}) {
  assertAllowedUrl(url, { trusted, allowed })
  fs.mkdirSync(path.dirname(dest), { recursive: true })
  const tmp = dest + '.part'
  const r = await fetch(url, {
    redirect: 'follow',
    headers: { 'user-agent': 'dsh-enterprise-gateway', ...headers },
    // 慢线兜底：公网几百 MB 走几十分钟属正常，但不能没有上限
    signal: AbortSignal.timeout(timeoutMs),
  }).catch((e) => { throw new Error(`连接失败: ${String(e?.message ?? e).slice(0, 120)}`) })
  if (!r.ok || !r.body) {
    try { r?.body?.cancel?.() } catch { /* 已断 */ }
    throw new Error(`下载失败 HTTP ${r.status}`)
  }
  const h256 = crypto.createHash('sha256')
  const h512 = crypto.createHash('sha512')
  let size = 0
  const limit = maxMb * 1024 * 1024
  const counter = new Transform({
    transform(chunk, _enc, cb) {
      size += chunk.length
      if (size > limit) return cb(new Error(`文件 ${Math.round(size / 1048576)}MB 超过上限 ${maxMb}MB`))
      h256.update(chunk)
      h512.update(chunk)
      cb(null, chunk)
    },
  })
  try {
    await pipeline(Readable.fromWeb(r.body), counter, fs.createWriteStream(tmp))
  } catch (e) {
    fs.rmSync(tmp, { force: true })   // 半截文件不留：宁可重下，也不要下发一个坏包
    throw e
  }
  return { file: tmp, size, sha256: h256.digest('hex'), sha512: h512.digest('base64') }
}

/**
 * 摘要规格化：接受 `sha256:<hex>`（GitHub digest）、`sha512-<base64>`（npm integrity）
 * 与裸十六进制（Node SHASUMS / 镜像目录字段），返回 { algo, value }。
 */
export function parseDigest(raw) {
  const s = String(raw ?? '').trim()
  if (!s) return null
  // 前缀式：sha256:<hex>（GitHub digest）/ sha512-<base64>（npm integrity）。
  // base64 字母表比十六进制宽得多（含 G-Z/g-z），字符类收窄会把合法 integrity 误判成裸摘要。
  const m = /^(sha256|sha512)[-:]([A-Za-z0-9+/=-]+)$/.exec(s)
  if (m) return m[1] === 'sha512' ? { algo: 'sha512', value: normB64(m[2]) } : { algo: 'sha256', value: m[2].toLowerCase() }
  if (/^[0-9a-f]{64}$/i.test(s)) return { algo: 'sha256', value: s.toLowerCase() }
  if (/^[0-9a-f]{128}$/i.test(s)) return { algo: 'sha512', value: Buffer.from(s, 'hex').toString('base64') }
  return { algo: 'sha256', value: s.toLowerCase() }   // 交给比对去判负，不在这里猜
}

/** base64 各家写法（带/不带 padding、URL 安全字母）统一到标准 base64 */
const normB64 = (s) => s.replace(/-/g, '+').replace(/_/g, '/').replace(/=+$/, '')

/**
 * 摘要比对：hex（sha256）不区分大小写，base64（sha512）忽略 padding 差异。
 * @param {{algo:string,value:string}|null} want parseDigest 的产物
 * @param {{sha256:string,sha512:string}} got downloadTo 的产物
 */
export function digestMatches(want, got) {
  if (!want) return true                      // 上游没给摘要：由调用方记 verified=false
  if (want.algo === 'sha512') return normB64(want.value) === normB64(got.sha512)
  return want.value.toLowerCase() === got.sha256.toLowerCase()
}
