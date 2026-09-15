/**
 * HTTP 内核：json 响应、body 读取、时间戳、日志助手
 */
import { createHash } from 'node:crypto'

export const ts = () => new Date().toLocaleTimeString('zh-CN', { hour12: false })

export function json(res, code, body) {
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(body))
}

export const jsonError = (res, code, message, type) => json(res, code, { error: { message, type } })

export function readBody(req) {
  return new Promise((resolve) => {
    let d = ''
    req.on('data', (c) => (d += c))
    req.on('end', () => resolve(d))
  })
}

export async function readJson(req) {
  const raw = await readBody(req)
  try { return JSON.parse(raw || '{}') } catch { return null }
}

export const log = (icon, msg) => console.log(`[${ts()}] ${icon} ${msg}`)
export const sha16 = (s) => createHash('sha256').update(s).digest('hex').slice(0, 16)
