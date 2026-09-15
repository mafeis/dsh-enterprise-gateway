import { createHmac, randomBytes } from 'node:crypto'
const b64u = (b) => Buffer.from(b).toString('base64url')
const now = Math.floor(Date.now() / 1000)
const header = b64u(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
const payload = b64u(JSON.stringify({
  user: { username: 'admin', role: 'admin' },
  ver: 1,
  iat: now,
  exp: now + 900,
  jti: randomBytes(8).toString('hex'),
}))
const sig = createHmac('sha256', process.env.ENT_JWT_SECRET ?? 'dev-secret-change-me').update(header + '.' + payload).digest('base64url')
console.log(header + '.' + payload + '.' + sig)
