import assert from 'node:assert/strict'
import test from 'node:test'
import {
  executeAttuneCommand,
  registerApi,
  registerCommand,
  registerPrompt,
} from '../lib/index.js'

function fakeEngine() {
  const calls = []
  let enabled = false
  let prompt = '用户已确认：先给结论。'
  return {
    calls,
    listTests: () => [{ id: 'opening', title: '平行助手', prompt: '选一个', options: [{ id: 'a', label: 'A' }] }],
    generateTest: async ({ context }) => {
      calls.push(['generate', context])
      return { test: { id: 'fresh', title: '新题', prompt: '按当前任务来选', options: [{ id: 'a', label: 'A' }] } }
    },
    getState: async () => ({ rules: [{ id: 'r1', text: '先给结论。', evidence: ['平行助手：A'] }], proposals: [], settings: { invitationsEnabled: enabled }, answeredTestIds: [] }),
    answer: async (body) => { calls.push(['answer', body]); return { proposal: { id: 'p1', text: '先给结论。', evidence: '平行助手：A' } } },
    decide: async (body) => { calls.push(['decide', body]); return { rule: { id: 'r1', text: '先给结论。' } } },
    mutateRule: async (body) => { calls.push(['rule', body]); return { deleted: true, rule: { id: 'r1', text: body.text } } },
    setInvitations: async ({ enabled: next }) => { enabled = next; return { settings: { invitationsEnabled: next } } },
    maybeInvite: async () => ({ test: null, reason: 'cooldown' }),
    promptFor: () => prompt,
    setPrompt: (next) => { prompt = next },
  }
}

function context(serviceName, service) {
  const owner = { [serviceName]: service, effect: (fn) => fn() }
  return { inject: (names, fn) => { if (names[0] === serviceName) fn(owner) } }
}

test('authenticated Connection routes expose a bounded JSON flow on any admitted Host', async () => {
  const engine = fakeEngine()
  const routes = new Map()
  registerApi(context('connection', { fetch: { register: (entry) => { routes.set(entry.path, entry); return () => {} } } }), engine)
  assert.equal(routes.size, 7)
  assert.equal(routes.get('/api/attune/answer').requestBody, 'streaming')
  const request = new Request('https://example.org/ui/api/attune/answer', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ testId: 'opening', optionId: 'a', submissionId: 'repeatable' }),
  })
  const response = await routes.get('/api/attune/answer').fetch(request)
  assert.equal(response.status, 200)
  assert.equal((await response.json()).proposal.id, 'p1')
  assert.equal(engine.calls[0][1].submissionId, 'repeatable')
  const generated = await routes.get('/api/attune/generate').fetch(new Request('https://example.org/ui/api/attune/generate', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ context: '正在写汇报', sessionId: 'untrusted-id' }),
  }))
  assert.equal((await generated.json()).test.id, 'fresh')
  assert.match(engine.calls.find((call) => call[0] === 'generate')[1], /正在写汇报/u)
  const tooBig = await routes.get('/api/attune/answer').fetch(new Request('https://example.org/api/attune/answer', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ pad: 'x'.repeat(33000) }),
  }))
  assert.equal(tooBig.status, 400)
})

test('prompt provider reads corrected preferences on the next assembly', () => {
  const engine = fakeEngine()
  let entry
  registerPrompt(context('systemPrompt', { context: (next) => { entry = next; return () => {} } }), engine)
  assert.equal(entry.text(), '用户已确认：先给结论。')
  engine.setPrompt('用户已确认：先讲依据。')
  assert.equal(entry.text(), '用户已确认：先讲依据。')
  assert.equal(entry.interpolate, false)
})

test('slash command completes answer, correction, deletion and invitation toggle', async () => {
  const engine = fakeEngine()
  let command
  registerCommand(context('commands', { register: (next) => { command = next; return () => {} } }), engine)
  assert.equal(command.name, 'attune')
  assert.match((await command.handler({ rawInput: 'test' })).text, /新题/u)
  assert.match(engine.calls.find((call) => call[0] === 'generate')[1], /^$/u)
  assert.match((await executeAttuneCommand(engine, 'test opening')), /平行助手/u)
  assert.match((await executeAttuneCommand(engine, 'answer opening a')), /p1/u)
  assert.match((await executeAttuneCommand(engine, 'answer opening a')), /依据：平行助手：A/u)
  assert.match((await executeAttuneCommand(engine, 'list')), /依据：平行助手：A/u)
  await executeAttuneCommand(engine, 'remember p1')
  await executeAttuneCommand(engine, 'correct r1 先讲依据')
  await executeAttuneCommand(engine, 'delete r1 forget')
  assert.equal(engine.calls.find((item) => item[0] === 'rule' && item[1].action === 'delete')[1].forgetEvidence, true)
  assert.match(await executeAttuneCommand(engine, 'on'), /开启/u)
  assert.equal((await engine.getState()).settings.invitationsEnabled, true)
})
