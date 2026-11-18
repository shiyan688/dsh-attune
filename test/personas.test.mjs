import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import test from 'node:test'
import { createAttuneEngine } from '../lib/core.js'
import { executeAttuneCommand, registerPrompt } from '../lib/index.js'
import { classifyPersona, omitRepeatedOpening } from '../lib/persona-routing.js'

async function fixture(t) {
  const dir = await mkdtemp(resolve('test/tmp-personas-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const filePath = join(dir, 'state.json')
  return createAttuneEngine({
    filePath,
    generateQuestion: async () => ({
      title: '分享点子时',
      prompt: '你更希望先聊想法还是先排计划？',
      dimension: 'ideas',
      suggestedPersonaIds: ['ideas', 'review', 'model-invented-id'],
      options: [
        { id: 'a', mode: 'bold', label: '先展开想法', rule: '先把还在发散的点子聊开。' },
        { id: 'b', mode: 'practical', label: '先排计划', rule: '先讨论能落地的具体步骤。' },
      ],
    }),
  })
}

async function candidate(engine, optionId) {
  const { test } = await engine.generateTest({ review: { excerpt: '我想分享一个点子，但助手马上列了时间表。' } })
  return (await engine.answer({ testId: test.id, optionId })).proposal
}

test('excerpt preferences require chosen scopes, share one rule and replace only overlapping memberships', async (t) => {
  const engine = await fixture(t)
  const suggestion = await candidate(engine, 'a')
  assert.deepEqual(suggestion.suggestedPersonaIds, ['ideas', 'review'])
  await assert.rejects(engine.decide({ proposalId: suggestion.id, action: 'remember' }), /确认/)
  assert.equal((await engine.getState()).rules.length, 0)
  const { rule } = await engine.decide({ proposalId: suggestion.id, action: 'remember', personaIds: ['ideas', 'review'] })
  assert.equal((await engine.getState()).rules.length, 1)
  await engine.mutateRule({ ruleId: rule.id, action: 'edit', text: '先聊我最想尝试的部分。' })
  assert.match(engine.promptFor({ personaId: 'ideas' }), /最想尝试/)
  assert.match(engine.promptFor({ personaId: 'review' }), /最想尝试/)
  assert.doesNotMatch(engine.promptFor({ personaId: 'execution' }), /最想尝试/)
  assert.equal(engine.promptFor(), '')

  const next = await candidate(engine, 'b')
  await assert.rejects(engine.decide({ proposalId: next.id, action: 'remember', personaIds: ['review'] }), /确认替换/)
  await executeAttuneCommand(engine, `remember ${next.id} review ${rule.id}`)
  const rules = (await engine.getState()).rules
  assert.deepEqual(rules.find((item) => item.id === rule.id).personaIds, ['ideas'])
  assert.match(engine.promptFor({ personaId: 'review' }), /具体步骤/)
  assert.doesNotMatch(engine.promptFor({ personaId: 'review' }), /最想尝试/)
  assert.equal((await engine.getState()).answersCount, 2)
})

test('default and scoped preferences can differ, and removing a persona preserves shared rules', async (t) => {
  const engine = await fixture(t)
  const general = await candidate(engine, 'b')
  await executeAttuneCommand(engine, `remember ${general.id} general`)
  const { persona } = await engine.mutatePersona({ action: 'create', name: '创意教练', when: '推敲新鲜创意', style: '先提问' })
  const special = await candidate(engine, 'a')
  const { rule } = await engine.decide({ proposalId: special.id, action: 'remember', personaIds: ['ideas', persona.id] })
  assert.match(engine.promptFor(), /具体步骤/)
  assert.match(engine.promptFor({ personaId: persona.id }), /先提问/)
  assert.doesNotMatch(engine.promptFor({ personaId: persona.id }), /具体步骤/)
  await engine.mutatePersona({ action: 'pause', personaId: persona.id })
  assert.equal(engine.promptFor({ personaId: persona.id }), engine.promptFor())
  await assert.rejects(engine.mutatePersona({ action: 'delete', personaId: persona.id, expectedRuleIds: [] }), /关联的偏好已变化/)
  await engine.mutatePersona({ action: 'delete', personaId: persona.id, expectedRuleIds: [rule.id] })
  assert.deepEqual((await engine.getState()).rules.find((item) => item.id === rule.id).personaIds, ['ideas'])
})

test('Host assembles the latest direct-user persona once per input and isolates different agents', async (t) => {
  const engine = await fixture(t)
  const events = new Map()
  let section
  const routeRequests = []
  registerPrompt({
    inject: (_services, mount) => mount({
      systemPrompt: { section: (value) => { section = value } },
      effect: (register) => register(),
      on: (event, handler) => events.set(event, handler),
    }),
  }, engine, {
    classify: async (request) => {
      routeRequests.push(request)
      return request.current.includes('评审') ? 'review' : 'ideas'
    },
  })
  const agent = { session: { deriveMessages: () => [] } }
  const other = { session: { deriveMessages: () => [] } }
  const signal = new AbortController().signal
  const claim = (agent, text, kind = 'user') => events.get('agent/inbox/claimed')({
    agent, message: { source: { kind }, role: 'user', content: [{ type: 'text', text }] },
  })
  const assemble = async (agent, signal) => {
    const base = { sections: [{ ...section, text: section.text() }] }
    const result = await events.get('system-prompt/assemble')(base, { agent, signal }, async () => base)
    return result.sections[0].text
  }
  const ideas = await candidate(engine, 'a')
  const { rule } = await engine.decide({ proposalId: ideas.id, action: 'remember', personaIds: ['ideas'] })
  const review = await candidate(engine, 'b')
  await engine.decide({ proposalId: review.id, action: 'remember', personaIds: ['review'] })
  claim(agent, '我还在发散小游戏的玩法')
  assert.match(await assemble(agent, signal), /点子搭子.*|先把还在发散/)
  claim(agent, '正在执行工具', 'runtime-context')
  assert.match(await assemble(agent, signal), /点子搭子/)
  assert.equal(routeRequests.length, 1)
  assert.equal(await assemble(other, signal), '')
  await engine.mutateRule({ ruleId: rule.id, action: 'edit', text: '先聊我最开心的玩法。' })
  assert.match(await assemble(agent, signal), /最开心/)
  claim(agent, '现在请评审同一个小游戏')
  const reply = await assemble(agent, new AbortController().signal)
  assert.match(reply, /评审搭子/)
  assert.match(reply, /具体步骤/)
  assert.doesNotMatch(reply, /最开心/)
  assert.equal(routeRequests.length, 2)
  assert.equal(await assemble(agent, new AbortController().signal), '')
})

test('classifier accepts only a listed persona returned by the configured model', async () => {
  const request = {
    route: { provider: 'fake', model: 'fake-model' },
    current: '现在请评审这个小游戏',
    recent: '用户：刚才我们聊了一个新点子',
    personas: [{ id: 'review', when: '检查已有成果' }],
    signal: new AbortController().signal,
  }
  const run = (text) => classifyPersona({ ...request, llm: {
    async *stream(options) {
      const input = JSON.parse(options.messages[0].content[0].text)
      assert.equal(input.current, request.current)
      assert.equal(input.recent, request.recent)
      yield { type: 'block-start', index: 0, blockType: 'text' }
      yield { type: 'text-delta', index: 0, text }
      yield { type: 'block-end', index: 0, block: { type: 'text', text } }
      yield { type: 'finish', reason: { kind: 'stop' } }
    },
  } })
  assert.equal(await run('{"personaId":"review"}'), 'review')
  assert.equal(await run('{"personaId":"unknown"}'), 'general')
  assert.equal(await run('not json'), 'general')
})

test('expired fixed opener is omitted across streamed chunks without changing the answer body', async () => {
  const messages = [
    { type: 'block-start', index: 0, blockType: 'text' },
    { type: 'text-delta', index: 0, text: '海盐' },
    { type: 'text-delta', index: 0, text: '灯塔\n' },
    { type: 'text-delta', index: 0, text: '先做原型。' },
    { type: 'block-end', index: 0, block: { type: 'text', text: '海盐灯塔\n先做原型。' } },
  ]
  const result = []
  for await (const chunk of omitRepeatedOpening(messages, '海盐灯塔')) result.push(chunk)
  assert.equal(result.filter((chunk) => chunk.type === 'text-delta').map((chunk) => chunk.text).join(''), '先做原型。')
  assert.equal(result.at(-1).block.text, '先做原型。')
})
