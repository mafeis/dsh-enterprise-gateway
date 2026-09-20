/**
 * 商业授权码签发工具（作者私有，不随 npm 发布）
 *
 * 用法：
 *   node scripts/issue-license.mjs keygen                          # 生成密钥对（公钥需粘贴进 src/license.mjs）
 *   node scripts/issue-license.mjs issue --licensee "某某科技" --seats 50 [--expires 2027-12-31]
 *
 * 私钥查找顺序：--private-key 参数 > 环境变量 LICENSE_PRIVATE_KEY > 仓库根 license-private-key.pem
 * 授权码格式：DSHE1.<base64url(payload JSON)>.<base64url(签名)>（验签端见 src/license.mjs）
 */
import { generateKeyPairSync, createPrivateKey, sign, createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const [, , cmd, ...rest] = process.argv
const argOf = (name) => {
  const i = rest.indexOf(name)
  return i >= 0 ? rest[i + 1] : undefined
}

function privateKeyPath() {
  if (argOf('--private-key')) return resolve(argOf('--private-key'))
  if (process.env.LICENSE_PRIVATE_KEY) return resolve(process.env.LICENSE_PRIVATE_KEY)
  return join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'license-private-key.pem')
}

/* ---------- keygen ---------- */
if (cmd === 'keygen') {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519')
  const privPem = privateKey.export({ type: 'pkcs8', format: 'pem' })
  const pubPem = publicKey.export({ type: 'spki', format: 'pem' })
  const out = argOf('--out') ?? 'license-private-key.pem'
  writeFileSync(out, privPem)
  console.log(`✅ 私钥已写入 ${out}（已列入 .gitignore，请另存备份，丢失后无法再签发同公钥的授权码）`)
  console.log('\n公钥（粘贴进 gateway/src/license.mjs 的 PUBLIC_KEY_PEM）：\n')
  console.log(pubPem)
  process.exit(0)
}

/* ---------- issue ---------- */
if (cmd === 'issue') {
  const licensee = argOf('--licensee')
  const seatsArg = argOf('--seats')
  const expires = argOf('--expires') ?? null
  if (!licensee) { console.error('✗ 缺 --licensee "被授权方名称"'); process.exit(1) }
  if (seatsArg === undefined) { console.error('✗ 缺 --seats <数字|unlimited>'); process.exit(1) }
  const seats = seatsArg === 'unlimited' ? 'unlimited' : Number(seatsArg)
  if (seats !== 'unlimited' && (!Number.isInteger(seats) || seats < 1)) { console.error('✗ --seats 须为正整数或 unlimited'); process.exit(1) }
  if (expires && Number.isNaN(Date.parse(expires))) { console.error('✗ --expires 须为 YYYY-MM-DD'); process.exit(1) }

  let priv
  try { priv = createPrivateKey(readFileSync(privateKeyPath())) } catch { console.error(`✗ 读取私钥失败: ${privateKeyPath()}`); process.exit(1) }

  const payload = {
    typ: 'dsh-enterprise-license',
    licensee,
    seats,
    issuedAt: new Date().toISOString().slice(0, 10),
    expiresAt: expires,
  }
  const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')
  const sig = sign(null, Buffer.from(body), priv).toString('base64url')
  const key = `DSHE1.${body}.${sig}`

  console.log('被授权方:', licensee)
  console.log('席位:', seats, expires ? `｜有效期至 ${expires}` : '｜永久')
  console.log('指纹:', createHash('sha256').update(key).digest('hex').slice(0, 16))
  console.log('\n授权码（发给客户，录入管理台「用户管理 → 商业授权」）：\n')
  console.log(key)
  process.exit(0)
}

console.error('用法: node scripts/issue-license.mjs <keygen|issue> [参数]')
process.exit(1)
