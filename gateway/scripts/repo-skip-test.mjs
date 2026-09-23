#!/usr/bin/env node
/**
 * 回归：已有一致实体的平台，计划任务再调 sync 也不许重复下载；force 才强制重下。
 * 背景：检测任务每轮都会对「保留窗口内的版本」调 sync，早先 syncVersion/syncEnv 没有
 * 「本地已有就跳过」，每轮都把 mac 300MB + win 150MB 从公网重拖一遍（重启后立刻_visible_）。
 * 纯本地：源是 127.0.0.1 的假上游，被下载过几次这里就记几笔，不碰公网。
 * 用法：node scripts/repo-skip-test.mjs
 */
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'

const dir = mkdtempSync(join(tmpdir(), 'dsh-skip-'))
process.env.ENT_DATA_DIR = dir            // 必须在 import 物料模块之前
const env = await import('../src/core/env-repo.mjs')
const desk = await import('../src/core/desktop-repo.mjs')

const payload = Buffer.alloc(1_500_000, 7)
const sha256 = createHash('sha256').update(payload).digest('hex')
const hits = []
const srv = createServer((req, res) => {
  hits.push(req.url)
  res.writeHead(200, { 'content-length': payload.length })
  res.end(payload)
})
await new Promise((r) => srv.listen(0, '127.0.0.1', r))   // listen 是异步的，address() 要等 listening 之后
const URL_LOCAL = `http://127.0.0.1:${srv.address().port}/artifact`

let failed = 0
const need = (cond, name, detail = '') => {
  console.log(`${cond ? '✓' : '✗'} ${name}${cond ? '' : `\n  ${detail}`}`)
  if (!cond) failed++
}

/* ---- 先把索引写好（物料模块懒加载索引，所以要在第一次调用之前落盘） ---- */
mkdirSync(join(dir, 'env-repo'), { recursive: true })
writeFileSync(join(dir, 'env-repo', 'index.json'), JSON.stringify({
  published: { node: '24.0.0', pnpm: null }, publishedAt: { node: '', pnpm: '' }, checkedAt: '', lastError: '',
  kinds: {
    node: {
      '24.0.0': {
        version: '24.0.0', status: 'remote', lastError: '',
        sources: { 'mac-arm64': [{ source: 'official', url: URL_LOCAL, digest: `sha256-${sha256}`, fileName: 'node-v24.0.0-darwin-arm64.tar.gz', size: payload.length }] },
        artifacts: {},
      },
    },
    pnpm: {},
  },
}))
mkdirSync(join(dir, 'desktop-repo'), { recursive: true })
writeFileSync(join(dir, 'desktop-repo', 'index.json'), JSON.stringify({
  published: '1.0.0', checkedAt: '', lastError: '',
  versions: {
    '1.0.0': {
      version: '1.0.0', tag: 'v1.0.0', channel: 'stable', status: 'remote', lastError: '',
      sources: { mac: [{ source: 'github', url: URL_LOCAL, sha256, fileName: 'mac-App-1.0.0.dmg', size: payload.length }] },
      artifacts: {},
    },
    // 预置一个「文件在、摘要却和上游不一致」的版本：这种不能跳过，必须重下换掉
    '1.0.2': {
      version: '1.0.2', tag: 'v1.0.2', channel: 'stable', status: 'partial', lastError: '',
      sources: { mac: [{ source: 'github', url: URL_LOCAL, sha256, fileName: 'mac-App-1.0.2.dmg', size: payload.length }] },
      artifacts: {
        mac: {
          file: 'files/1.0.2/mac-mac-App-1.0.2.dmg', fileName: 'mac-App-1.0.2.dmg', size: payload.length,
          sha256: '0'.repeat(64), verified: true, source: 'github',
        },
      },
    },
  },
}))
mkdirSync(join(dir, 'desktop-repo', 'files', '1.0.2'), { recursive: true })
writeFileSync(join(dir, 'desktop-repo', 'files', '1.0.2', 'mac-mac-App-1.0.2.dmg'), Buffer.alloc(1000, 1))

const cfgEnv = { ...env.resolveEnvSettings({}), envFeeds: ['official'], allowedHosts: ['127.0.0.1'], envMaxPackageMb: 64 }
const cfgDesk = { ...desk.resolveSettings({}), feeds: ['github'], allowedHosts: ['127.0.0.1'], maxPackageMb: 64 }

/* ---- 环境物料：首轮真下载 → 次轮跳过 → force 才再来一次 ---- */
const a = await env.syncEnv('node', '24.0.0', cfgEnv, { platform: 'mac-arm64', by: 'test' })
need(a.synced.join() === 'mac-arm64' && hits.length === 1, '环境物料首轮确实入库', JSON.stringify(a))
const b = await env.syncEnv('node', '24.0.0', cfgEnv, { platform: 'mac-arm64', by: 'test' })
need(b.synced.length === 0 && b.skipped.join() === 'mac-arm64' && hits.length === 1,
  '环境物料第二轮不再下载（这就是原来的 bug）', JSON.stringify({ synced: b.synced, skipped: b.skipped, hits: hits.length }))
const c = await env.syncEnv('node', '24.0.0', cfgEnv, { platform: 'mac-arm64', by: 'test', force: true })
need(c.synced.join() === 'mac-arm64' && hits.length === 2, 'force=true 仍可强制重下', JSON.stringify({ synced: c.synced, hits: hits.length }))

/* ---- 安装包：同样一套 ---- */
const d1 = await desk.syncVersion('1.0.0', cfgDesk, { platform: 'mac', by: 'test' })
need(d1.synced.join() === 'mac' && hits.length === 3, '安装包首轮确实入库', JSON.stringify(d1))
const d2 = await desk.syncVersion('1.0.0', cfgDesk, { platform: 'mac', by: 'test' })
need(d2.synced.length === 0 && d2.skipped.join() === 'mac' && hits.length === 3,
  '安装包第二轮不再重复拉 300MB', JSON.stringify({ synced: d2.synced, skipped: d2.skipped, hits: hits.length }))
const d3 = await desk.syncVersion('1.0.0', cfgDesk, { platform: 'mac', by: 'test', force: true })
need(d3.synced.join() === 'mac' && hits.length === 4, '安装包 force 可强制重下', JSON.stringify({ synced: d3.synced, hits: hits.length }))

/* ---- 本地实体与上游摘要不一致：不能因为「已有文件」就抱着旧包不放 ---- */
const d4 = await desk.syncVersion('1.0.2', cfgDesk, { platform: 'mac', by: 'test' })
need(d4.synced.join() === 'mac' && hits.length === 5 && d4.attempts.some((x) => x.ok),
  '摘要不一致时必须重新下载替换', JSON.stringify({ synced: d4.synced, skipped: d4.skipped, hits: hits.length, attempts: d4.attempts }))

srv.close()
console.log(failed ? `\n—— 重复下载回归：FAIL（${failed} 步）——` : '\n—— 重复下载回归：PASS（7 步）——')
process.exit(failed ? 1 : 0)
