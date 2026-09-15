/**
 * SQL 绑定健壮性验证 · 复现历史 500 场景，证明 store 层净化已封死
 * 用法：node scripts/sql-bind-check.mjs   （独立临时库，不碰 data/gateway.db）
 * 场景：
 *   1. undefined 绑定（历史 "Provided value cannot be bound to SQLite parameter N"）
 *   2. boolean 绑定
 *   3. days=NaN 插进 datetime 修饰符
 *   4. 常规读写回归（insertLog / queryLogs / anchor / userActivity）
 */
process.env.ENT_DB_PATH = new URL('../data/.sql-bind-check.db', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')

const { db, insertAck, insertHeartbeat, insertLog, queryLogs, getLogById,
        usageSummary, usageDaily, usageBill, statsByUser, statsToday,
        userActivity, sealDailyAnchor, verifyAnchor, purgeOldData, revokeUserTokens } = await import('../src/store.mjs')

let pass = 0, fail = 0
const t = (name, fn) => {
  try { fn(); pass++; console.log(`  ✓ ${name}`) }
  catch (e) { fail++; console.log(`  ✗ ${name}\n    ${e.message}`) }
}
const tAsync = async (name, fn) => {
  try { await fn(); pass++; console.log(`  ✓ ${name}`) }
  catch (e) { fail++; console.log(`  ✗ ${name}\n    ${e.message}`) }
}

console.log('— 绑定净化（历史 500 根因） —')
t('insertAck 全 undefined 不炸', () => insertAck(undefined, undefined, undefined))
t('insertHeartbeat 缺 profile/env/policyVersion 不炸', () => insertHeartbeat({ device_hash: 'dev1' }))
t('boolean 直接绑定 → 0/1', () => {
  db.prepare('INSERT INTO policy_acks (profile, policy_version, device_hash) VALUES (?, ?, ?)').run(true, false, 'bt')
  const r = db.prepare('SELECT profile FROM policy_acks WHERE device_hash = ?').get('bt')
  if (Number(r.profile) !== 1) throw new Error(`期望 1，得 ${r.profile}`)
})
t('命名参数对象含 undefined 字段不炸', () => {
  const r = db.prepare('SELECT @a AS x').get({ a: undefined })
  if (r.x !== null) throw new Error(`期望 null，得 ${r.x}`)
})
t('revokeUserTokens 不存在用户不炸', () => revokeUserTokens('ghost-user'))

console.log('— days 插值净化（NaN/越界） —')
t('usageSummary(NaN) 回退默认', () => { const r = usageSummary(NaN); if (!Array.isArray(r)) throw new Error('非数组') })
t('usageDaily("abc") 回退默认', () => usageDaily('abc'))
t('usageBill(-5) 回退默认', () => usageBill(-5, {}))
t('statsByUser(1e9) 回退默认', () => statsByUser(1e9))
t('purgeOldData(NaN) 读配置回退', () => purgeOldData(NaN))

console.log('— 常规读写回归 —')
t('insertLog + queryLogs + getLogById', () => {
  insertLog({ user_name: 'u1', model: 'm1', prompt_hash: 'h1', tokens_in: 2, tokens_out: 3, status_code: 200 })
  const { logs, total } = queryLogs({ user: 'u1' })
  if (total !== 1 || logs[0].model !== 'm1') throw new Error('queryLogs 结果不符')
  if (getLogById(logs[0].id)?.prompt_hash !== 'h1') throw new Error('getLogById 不符')
})
t('statsToday / statsByUser', () => { if (statsToday().total < 1) throw new Error('statsToday 空') })
t('sealDailyAnchor + verifyAnchor', () => {
  const s = sealDailyAnchor()
  if (!s.sealed && s.reason !== 'already-sealed') throw new Error(`seal: ${s.reason}`)
  const v = verifyAnchor(new Date().toLocaleDateString('sv-SE'))
  if (!v.ok) throw new Error('锚校验失败')
})
tAsync('userActivity 常规路径', async () => {
  const a = userActivity('u1')
  if (!a.usage?.length) throw new Error('usage 应有记录')
})
t('usageBill 金额折算（cached 防御）', () => {
  insertLog({ user_name: 'u1', model: 'm1', prompt_hash: 'h2', tokens_in: 10, tokens_out: 5, tokens_cached: 99, blocked: 0 })
  const b = usageBill(14, { m1: { in: 1, out: 2, cache: 0.5 } })
  if (!b.length || b[0].amount < 0) throw new Error('计费异常')
})

db.close()
// 清理临时库（WAL 伴生文件一并删）
const { unlinkSync } = await import('node:fs')
for (const suf of ['', '-wal', '-shm']) { try { unlinkSync(process.env.ENT_DB_PATH + suf) } catch {} }
console.log(`\n结果: ${pass} pass / ${fail} fail`)
process.exit(fail ? 1 : 0)
