import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parsePackagePath } from '../src/core/repo-store.mjs'

/**
 * /plugin-packages/ 下载路径解析的回归测试。
 *
 * 起因（生产实测）：仓库里 14 个插件有 6 个带 scope，而旧解析按「段数」判 name/version——
 *   GET /plugin-packages/@lemoncat7/dsh-knowledge        → name='@lemoncat7' ver='dsh-knowledge' → 404
 *   GET /plugin-packages/@lemoncat7/dsh-knowledge/2.10.1 → 三段，落不进任何分支        → 404
 * 后果：客户端从企业源安装/更新带 scope 的插件从来没成功过，而管理台看不出任何异常。
 * 所以带 scope 的三种形态必须钉死。
 */
test('带 scope：默认版本 / 指定版本 / npm 风格文件名都要认得', () => {
  assert.deepEqual(parsePackagePath('@lemoncat7/dsh-knowledge'), { name: '@lemoncat7/dsh-knowledge', version: null })
  assert.deepEqual(parsePackagePath('@lemoncat7/dsh-knowledge/2.10.1'), { name: '@lemoncat7/dsh-knowledge', version: '2.10.1' })
  // npm 对 @scope/name 用的文件名是去掉 scope 的裸名，包名仍以路径为准
  assert.deepEqual(parsePackagePath('@lemoncat7/dsh-knowledge/-/dsh-knowledge-2.10.1.tgz'), { name: '@lemoncat7/dsh-knowledge', version: '2.10.1' })
  assert.deepEqual(parsePackagePath('@xmanrui/dsh-im/4.29.0'), { name: '@xmanrui/dsh-im', version: '4.29.0' })
  assert.deepEqual(parsePackagePath('@deepseek-ai/dsh-base/0.0.1-rc.1'), { name: '@deepseek-ai/dsh-base', version: '0.0.1-rc.1' })
})

test('普通包名：三种形态照旧（不能因为支持 scope 而回归）', () => {
  assert.deepEqual(parsePackagePath('dsh-enterprise'), { name: 'dsh-enterprise', version: null })
  assert.deepEqual(parsePackagePath('dsh-context/0.59.0'), { name: 'dsh-context', version: '0.59.0' })
  assert.deepEqual(parsePackagePath('dsh-enterprise/-/dsh-enterprise-0.9.18.tgz'), { name: 'dsh-enterprise', version: '0.9.18' })
  assert.deepEqual(parsePackagePath('dsh-enterprise?x=1'), { name: 'dsh-enterprise', version: null }, 'query 不参与路径解析')
})

test('非法路径一律 null，不落到文件系统上', () => {
  for (const bad of ['', '../etc/passwd', 'dsh-context/../../etc/passwd', '@solo', '@', 'a', 'dsh-context/not-a-version',
    '@lemoncat7/dsh-knowledge/-/broken', '@bad scope/dsh-knowledge']) {
    assert.equal(parsePackagePath(bad), null, `应判非法：${JSON.stringify(bad)}`)
  }
})
