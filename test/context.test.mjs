import test from 'node:test'
import assert from 'node:assert/strict'
import { getSituation } from '../lib/context.js'

const msg = (role, source, text) => ({ role, source: { kind: source }, content: [{ type: 'text', text }] })

test('uses exact command agent and ignores tool, system, injected and unrelated session data', () => {
  const own = { deriveMessages: () => [
    msg('system', 'system-prompt', 'secret system'),
    msg('user', 'user', '我正在整理一个技术说明'),
    msg('tool', 'tool', 'private tool output'),
    msg('user', 'plugin', 'synthetic injected context'),
    msg('assistant', 'model', '可以先给读者一个例子'),
    msg('user', 'user', '/attune test 请根据对话出题'),
    msg('user', 'user-rpc', '帮我写得清楚一点'),
  ] }
  const ctx = { sessions: { get: () => { throw new Error('must not read another session') } } }
  const text = getSituation(ctx, { commandContext: { agent: { session: own } }, sessionId: 'another', userHint: '面向新手' })
  assert.match(text, /面向新手/)
  assert.match(text, /技术说明/)
  assert.match(text, /写得清楚一点/)
  assert.doesNotMatch(text, /secret|private|synthetic/)
  assert.doesNotMatch(text, /\/attune/)
})

test('does not look up browser-supplied session ids', () => {
  let reads = 0
  const ctx = { sessions: { get: () => { reads++; return { deriveMessages: () => [msg('user', 'user', '当前正在比较两份方案')] } } } }
  assert.equal(getSituation(ctx, { sessionId: 'session-1' }), '')
  assert.equal(getSituation(ctx, { sessionId: 'session-1', allowSessionLookup: true }), '')
  assert.equal(reads, 0)
})

test('bounds long conversational context and handles missing history', () => {
  const veryLong = '解释'.repeat(5000)
  const text = getSituation(null, { userHint: veryLong })
  assert.ok(text.length <= 1000)
  assert.ok(text.length > 0)
  assert.equal(getSituation(null), '')
})
