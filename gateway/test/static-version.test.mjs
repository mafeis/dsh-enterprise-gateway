import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync, readFileSync, utimesSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { versionMjs } from '../src/core/static.mjs'

test('versionMjs：同 mtime 不同内容的依赖模块必须生成不同缓存版本', () => {
  const dir = mkdtempSync(join(tmpdir(), 'gateway-static-version-'))
  const entry = join(dir, 'index.mjs')
  const dep = join(dir, 'installs.mjs')
  const fixed = new Date('1985-10-26T08:15:00Z')
  try {
    writeFileSync(entry, "import { renderInstallsTab } from './installs.mjs'\n", 'utf8')
    writeFileSync(dep, 'export function renderInstallsTab() { return 1 }\n', 'utf8')
    utimesSync(entry, fixed, fixed)
    utimesSync(dep, fixed, fixed)
    const first = versionMjs(entry, readFileSync(entry, 'utf8'))
    writeFileSync(dep, 'export function renderInstallsTab() { return 2 }\n', 'utf8')
    utimesSync(dep, fixed, fixed)
    const second = versionMjs(entry, readFileSync(entry, 'utf8'))
    assert.notEqual(first, second)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
