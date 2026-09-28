import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * 「版本检查」（GET /admin/plugin-repo/npm-versions → listNpmVersions）的离线回归测试。
 *
 * 为什么值得钉住这几条：
 *  ① 排序必须是 semver 数值降序，不能是字符串序——字符串序会把 0.9.9 排到 0.9.18 前面，
 *     弹窗第一行就不是可入库的新版；而「下载入库所选」也是按这个顺序从新到旧逐个入库的。
 *  ② 源回退顺序必须是 入参 > 索引记录 > 官方源。上传（upload）入库的插件在索引里没有
 *     registry 字段，「检查更新」因为 `if (!reg) continue` 直接跳过它们；「版本检查」
 *     的全部意义就是让管理员临时指定一个源把这批插件拉齐，优先级被改错它就对最需要
 *     它的插件失效。
 *  ③ 必须只读：查一次版本就把 npm 元数据写回索引，会污染 defaultVersion 与来源记录。
 *
 * 不发真实请求（CI 里跑也不依赖网络）：fetch 换成假实现。注意 repo-store 在**模块加载时**
 * 就把 REPO_DIR 定成 process.cwd()/data/plugin-repo，并且用模块级变量缓存整个索引，
 * 所以每轮都要先 chdir 再带唯一 query 重新 import，拿一份干净的模块实例，
 * 否则会读到上一个临时目录、甚至读到开发机真实的 data/plugin-repo。
 */
const ORIG_CWD = process.cwd()
let seq = 0

async function withRepo(indexPlugins, fn) {
  const dir = mkdtempSync(join(tmpdir(), 'gateway-repo-npmver-'))
  mkdirSync(join(dir, 'data', 'plugin-repo'), { recursive: true })
  writeFileSync(join(dir, 'data', 'plugin-repo', 'index.json'), JSON.stringify({ plugins: indexPlugins }), 'utf8')
  process.chdir(dir)
  try {
    const mod = await import(`../src/core/repo-store.mjs?fresh=${++seq}`)
    return await fn(mod, dir)
  } finally {
    process.chdir(ORIG_CWD)
    rmSync(dir, { recursive: true, force: true })
  }
}

/** 假 npm 源：记下被请求的 URL；版本集特意让「字符串序」和「数值序」结论不同 */
function stubFetch(doc, seen) {
  const real = globalThis.fetch
  globalThis.fetch = async (url) => {
    seen.push(String(url))
    return { ok: true, json: async () => doc }
  }
  return () => { globalThis.fetch = real }
}

const NPM_DOC = {
  'dist-tags': { latest: '0.9.18' },
  time: { '0.9.18': '2026-09-28T00:00:00.000Z', '0.9.9': '2026-09-18T00:00:00.000Z' },
  versions: {
    '0.9.18': { dist: { unpackedSize: 306000 } },
    '0.9.15': { dist: { unpackedSize: 290000 } },
    '0.9.9': { dist: { unpackedSize: 261000 } },
    bogus: { dist: {} },
  },
}

test('listNpmVersions：semver 数值降序（不是字符串序），并标出 latest / inRepo / isDefault', async () => {
  const seen = []
  const restore = stubFetch(NPM_DOC, seen)
  try {
    await withRepo({
      'dsh-enterprise': { name: 'dsh-enterprise', defaultVersion: '0.9.15', versions: { '0.9.15': {} } },
    }, async ({ listNpmVersions }) => {
      const r = await listNpmVersions('dsh-enterprise')
      // 0.9.9 必须排在 0.9.15/0.9.18 之后；换成字符串序这条就红
      assert.deepEqual(r.versions.map((v) => v.version), ['0.9.18', '0.9.15', '0.9.9'])
      assert.equal(r.latest, '0.9.18')
      assert.equal(r.defaultVersion, '0.9.15')
      assert.equal(r.versions[0].latest, true)
      assert.equal(r.versions[0].inRepo, false)
      assert.equal(r.versions[1].inRepo, true)
      assert.equal(r.versions[1].isDefault, true)
      assert.equal(r.versions[2].publishedAt, '2026-09-18')
      assert.equal(r.total, 3, '非三段式的版本（bogus）不该进列表')
    })
  } finally { restore() }
})

test('listNpmVersions：源优先级 入参 > 索引记录 > 官方源；上传入库的插件靠入参把版本拉齐', async () => {
  const seen = []
  const restore = stubFetch(NPM_DOC, seen)
  try {
    await withRepo({
      'from-npm': { name: 'from-npm', registry: 'https://npm.corp.example.com/', defaultVersion: '', versions: {} },
      'from-upload': { name: 'from-upload', defaultVersion: '0.1.0', versions: { '0.1.0': {} } },
    }, async ({ listNpmVersions }) => {
      const a = await listNpmVersions('from-npm', 'https://mirror.corp.example.com/')
      assert.equal(a.registry, 'https://mirror.corp.example.com', '① 入参优先，且去掉结尾斜杠')
      const b = await listNpmVersions('from-npm')
      assert.equal(b.registry, 'https://npm.corp.example.com', '② 索引有记录就用记录的源')
      const c = await listNpmVersions('from-upload')
      assert.equal(c.registry, 'https://registry.npmjs.org', '③ upload 没记 registry → 回落官方源')
      assert.deepEqual(seen, [
        'https://mirror.corp.example.com/from-npm',
        'https://npm.corp.example.com/from-npm',
        'https://registry.npmjs.org/from-upload',
      ])
    })
  } finally { restore() }
})

test('listNpmVersions：包名/源不合法就抛错且不发请求；源不可达给可读原因', async () => {
  const seen = []
  const restore = stubFetch(NPM_DOC, seen)
  try {
    await withRepo({}, async ({ listNpmVersions }) => {
      await assert.rejects(() => listNpmVersions('../etc/passwd'), /不合法/)
      await assert.rejects(() => listNpmVersions(''), /不合法/)
      assert.equal(seen.length, 0, '非法包名不该发出请求')
      await assert.rejects(() => listNpmVersions('dsh-enterprise', 'ftp://nope'), /源地址不合法/)
    })
  } finally { restore() }

  const real = globalThis.fetch
  globalThis.fetch = async () => { throw new Error('ECONNREFUSED') }
  try {
    await withRepo({}, async ({ listNpmVersions }) => {
      await assert.rejects(() => listNpmVersions('dsh-enterprise'), /读不到 npm 源/)
    })
  } finally { globalThis.fetch = real }
})

test('listNpmVersions：只读——查版本不写索引', async () => {
  const restore = stubFetch(NPM_DOC, [])
  try {
    await withRepo(
      { 'dsh-enterprise': { name: 'dsh-enterprise', defaultVersion: '0.9.15', versions: { '0.9.15': {} } } },
      async ({ listNpmVersions }, dir) => {
        const f = join(dir, 'data', 'plugin-repo', 'index.json')
        const before = readFileSync(f, 'utf8')
        await listNpmVersions('dsh-enterprise', 'https://registry.npmjs.org')
        assert.equal(readFileSync(f, 'utf8'), before, '检查版本不该改索引')
      },
    )
  } finally { restore() }
})
