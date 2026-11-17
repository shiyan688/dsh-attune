import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { createAttuneEngine } from '../lib/core.js'
import { executeAttuneCommand, registerApi } from '../lib/index.js'

const fixtures = {
  tone: { dimension: 'quiz-tone', modes: ['playful', 'calm'], rules: ['默契小实验提问时，使用轻巧俏皮的语气。', '默契小实验提问时，使用温柔平静的语气。'] },
  preference: { dimension: 'opening', modes: ['conclusion', 'reasoning'], rules: ['讨论工作时，先给简明的结论。', '讨论工作时，先讲清关键的依据。'] },
}

async function fixture(run) {
  const dir = await mkdtemp(join(resolve('test'), 'tmp-tone-'))
  const filePath = join(dir, 'state.json')
  const requests = []
  const generateQuestion = async (request) => {
    requests.push(request)
    const spec = fixtures[request.topic]
    return {
      title: '来玩一题小默契', prompt: '今天闲下来，哪一种小鱼的表达更合你的心意？', dimension: spec.dimension,
      options: spec.modes.map((mode, index) => ({ id: index ? 'b' : 'a', mode, label: `方式${index + 1}`, detail: `这是第${index + 1}种表达方法。`, rule: spec.rules[index] })),
    }
  }
  try {
    await run(createAttuneEngine({ filePath, generateQuestion }), { requests, filePath, generateQuestion })
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

async function choose(engine, topic = 'tone', optionId = 'a') {
  const { test: question } = await engine.generateTest({ topic })
  assert.equal(question.topic, topic)
  return (await engine.answer({ testId: question.id, optionId })).proposal
}

test('tone confirmation, correction and forgetting affect only subsequent question generation', async () => fixture(async (engine, { requests }) => {
  const pending = await choose(engine)
  assert.equal(pending.topic, 'tone')
  await engine.generateTest({})
  assert.deepEqual(requests.at(-1).questionStyleRules, [])
  assert.equal(engine.promptFor(), '')

  const accepted = (await engine.decide({ proposalId: pending.id, action: 'remember' })).rule
  assert.equal(accepted.topic, 'tone')
  assert.equal(engine.promptFor(), '')
  await engine.generateTest({})
  assert.deepEqual(requests.at(-1).questionStyleRules, [accepted.text])
  assert.deepEqual(requests.at(-1).confirmedRules, [])
  await engine.generateTest({ topic: 'tone' })
  assert.deepEqual(requests.at(-1).questionStyleRules, [accepted.text])
  assert.equal(requests.at(-1).openQuestions.includes('quiz-tone'), false)

  const normal = await choose(engine, 'preference')
  const normalRule = (await engine.decide({ proposalId: normal.id, action: 'remember' })).rule
  assert.match(engine.promptFor(), /先给简明的结论/)
  assert.equal(engine.promptFor().includes(accepted.text), false)

  const corrected = '默契小实验提问时，少用语气词，直接称呼我为你。'
  await engine.mutateRule({ ruleId: accepted.id, action: 'edit', text: corrected })
  const reopened = await choose(engine)
  assert.deepEqual(requests.at(-1).questionStyleRules, [corrected])
  assert.deepEqual(requests.at(-1).confirmedRules, [normalRule.text])
  await engine.decide({ proposalId: reopened.id, action: 'reject' })
  await engine.mutateRule({ ruleId: accepted.id, action: 'delete', forgetEvidence: true })
  await engine.generateTest({ topic: 'tone' })
  assert.deepEqual(requests.at(-1).questionStyleRules, [])
  assert.ok(requests.at(-1).openQuestions.includes('quiz-tone'))
  assert.deepEqual((await engine.getState()).rules.map((rule) => rule.id), [normalRule.id])
  assert.equal((await engine.getState()).answersCount, 1)
}))

test('a changed tone stays pending until confirmed and does not replace collaboration rules', async () => fixture(async (engine, { requests }) => {
  const first = await choose(engine)
  const old = (await engine.decide({ proposalId: first.id, action: 'remember' })).rule
  const second = await choose(engine, 'tone', 'b')
  assert.equal(second.replacesRuleId, old.id)
  await engine.generateTest({})
  assert.deepEqual(requests.at(-1).questionStyleRules, [old.text])
  const updated = (await engine.decide({ proposalId: second.id, action: 'remember' })).rule
  await engine.generateTest({})
  assert.deepEqual(requests.at(-1).questionStyleRules, [updated.text])
  assert.equal(engine.promptFor(), '')
  assert.equal((await engine.getState()).answersCount, 1)
}))

test('legacy saved collaboration records retain their scope without migration', async () => fixture(async (engine, { filePath, generateQuestion }) => {
  const pending = await choose(engine, 'preference')
  await engine.decide({ proposalId: pending.id, action: 'remember' })
  const state = JSON.parse(await readFile(filePath, 'utf8'))
  for (const key of ['tests', 'rules', 'answers', 'proposals']) for (const item of state[key]) delete item.topic
  await writeFile(filePath, JSON.stringify(state), 'utf8')
  const reloaded = createAttuneEngine({ filePath, generateQuestion })
  assert.equal(reloaded.listTests()[0].topic, 'preference')
  assert.equal((await reloaded.getState()).rules[0].topic, 'preference')
  assert.match(reloaded.promptFor(), /先给简明的结论/)
}))

test('generation rejects unknown topic and a model dimension from the wrong topic', async () => fixture(async (engine, { filePath, requests }) => {
  await assert.rejects(engine.generateTest({ topic: 'other' }), /主题/)
  assert.equal(requests.length, 0)
  const malformed = createAttuneEngine({ filePath, generateQuestion: async () => ({ dimension: 'opening', topic: 'tone' }) })
  await assert.rejects(malformed.generateTest({ topic: 'tone' }), /主题不匹配/)
  assert.equal(engine.listTests().length, 0)
}))

test('HTTP and slash command pass a validated tone topic through to the engine', async () => fixture(async (engine, { requests }) => {
  const routes = new Map()
  const owner = { connection: { fetch: { register: (route) => routes.set(route.path, route) } }, effect: (fn) => fn() }
  registerApi({ inject: (_deps, register) => register(owner) }, engine)
  const send = (topic) => routes.get('/api/attune/generate').fetch(new Request('https://example.test/api/attune/generate', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ topic, context: '想听自然一点的问法' }),
  }))
  const response = await send('tone')
  assert.equal(response.status, 200)
  assert.equal((await response.json()).test.topic, 'tone')
  assert.equal(requests.at(-1).topic, 'tone')
  assert.equal((await send('all')).status, 400)
  const command = await executeAttuneCommand(engine, 'tone 想少一点语气词')
  assert.match(command, /attune answer/)
  assert.equal(requests.at(-1).topic, 'tone')
  assert.equal(requests.at(-1).context, '想少一点语气词')
  assert.match(await executeAttuneCommand(engine, 'help'), /attune tone/)
}))
