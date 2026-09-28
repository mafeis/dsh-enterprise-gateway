import assert from 'node:assert/strict'
import { Readable } from 'node:stream'
import test from 'node:test'
import { createPluginProtocolHandler } from '../src/routes/plugin.mjs'

function makeHandler(cfg) {
  return createPluginProtocolHandler({
    config: { getConfig: () => cfg },
    store: {
      listGroups: () => [],
      latestHeartbeatDevice: () => 'snapshot',
      insertHeartbeat: () => {},
      insertAck: () => {},
      recordPluginSightings: () => {},
      groupOfUser: () => null,
    },
    auth: { authenticate: async () => ({ ok: false }) },
  })
}

async function fingerprintFor(cfg) {
  const req = Readable.from([JSON.stringify({ profile: 'test' })])
  req.method = 'POST'
  req.headers = { authorization: 'Bearer test' }
  const res = {
    body: '',
    writeHead(code) { this.code = code },
    end(body) { this.body = body },
  }
  await makeHandler(cfg)(req, res, '/heartbeat')
  assert.equal(res.code, 200)
  return JSON.parse(res.body).modelFingerprint
}

test('心跳模型指纹包含客户端写入的上下文、输出与思考配置', async () => {
  const baselineModel = {
    id: 'model-1',
    displayName: 'Model 1',
    enabled: true,
    contextWindow: 128000,
    maxTokens: 32768,
    inputModes: ['text'],
    mode: 'chat',
    thinking: 'optional',
    defaultThinking: 'off',
    thinkingLevels: ['off', 'low', 'medium', 'high'],
    fallbackProviders: [],
    upstreamModelByProvider: null,
  }
  const cfg = {
    policy: {},
    providers: [],
    models: [{ ...baselineModel }],
  }
  const baseline = await fingerprintFor(cfg)
  assert.equal(await fingerprintFor(cfg), baseline, '未变化时指纹必须保持稳定')

  const cases = [
    { contextWindow: 256000 },
    { maxTokens: 65536 },
    { inputModes: ['text', 'image'] },
    { mode: 'reasoning' },
    { thinking: 'always' },
    { defaultThinking: 'medium' },
    { thinkingLevels: ['off', 'high'] },
  ]
  for (const patch of cases) {
    Object.assign(cfg.models[0], baselineModel, patch)
    assert.notEqual(await fingerprintFor(cfg), baseline, `修改 ${Object.keys(patch)[0]} 后必须更新指纹`)
  }
})
