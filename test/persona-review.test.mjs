import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { setTimeout as wait } from 'node:timers/promises'
import test from 'node:test'
import { createAttuneEngine } from '../lib/core.js'

const persona = (id) => ({ id, name: id, when: '适合这个测试情景', style: '', paused: false })
const profile = { name: '角色练习', when: '在真实对话场景中练习表达', style: '先进入角色，再给反馈。' }
const at = '2026-11-18T09:00:00.000Z'
const source = (id, group) => ({ id, feedbackGroup: group, testId: 'q-' + id, title: '角色练习', optionLabel: '先对话', at })
const rule = (id, dimension, personaIds, sourceIds, text = '先进入练习角色。') => ({
  id, topic: 'preference', dimension, personaIds, sourceIds, text,
  mode: dimension === 'opening' ? 'conclusion' : 'direct', confirmedAt: at,
})

async function setup(t, options, state = null) {
  const dir = await mkdtemp(resolve('test/tmp-review-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const filePath = join(dir, 'state.json')
  if (state) await writeFile(filePath, JSON.stringify({
    version: 1, revision: 0, proposals: [], tests: [], receipts: {},
    settings: { invitationsEnabled: false }, ...state,
  }))
  return createAttuneEngine({ filePath, ...options })
}

test('automatic review counts independent excerpts and leaves a creation proposal for explicit confirmation', async (t) => {
  let calls = 0
  const engine = await setup(t, {
    generateQuestion: async () => ({
      title: '先怎样开口', prompt: '更喜欢哪种回应方式？', dimension: 'opening', suggestedPersonaIds: ['general'],
      options: [
        { id: 'a', mode: 'conclusion', label: '先入角色', rule: '先进入英语角色扮演来热身。' },
        { id: 'b', mode: 'reasoning', label: '先给解释', rule: '开始前先给一点背景解释。' },
      ],
    }),
    recommendPersonas: async ({ input }) => {
      calls++
      assert.equal(input.groups.length, 3)
      const id = input.rules[0].id
      return { action: 'create', reason: '多种练习场景需要同一种开场。', profile, moveRuleIds: [id], evidenceRuleIds: [id] }
    },
  })
  const remember = async (groupId) => {
    const { test: question } = await engine.generateTest({ review: { excerpt: '我希望先模拟口语对话。', groupId } })
    const { proposal } = await engine.answer({ testId: question.id, optionId: 'a' })
    await engine.decide({ proposalId: proposal.id, action: 'remember', personaIds: ['general'] })
  }
  for (let i = 0; i < 3; i++) await remember('same-excerpt-group')
  assert.equal((await engine.checkPersonaReview()).status, 'more-feedback')
  assert.equal(calls, 0)
  await remember('second-excerpt-group')
  await remember('third-excerpt-group')
  const deadline = Date.now() + 2000
  let after
  do {
    after = await engine.getState()
    if (!after.personaSuggestion) await wait(15)
  } while (!after.personaSuggestion && Date.now() < deadline)
  const suggestion = after.personaSuggestion
  assert.ok(suggestion)
  assert.equal(calls, 1)
  assert.ok(!after.personas.some((item) => item.name === profile.name))
  assert.deepEqual(after.rules[0].personaIds, ['general'])
  const result = await engine.decidePersonaReview({ suggestionId: suggestion.id, action: 'apply' })
  assert.deepEqual((await engine.getState()).rules[0].personaIds, [result.personaId])
})

test('split moves only the chosen membership; a rule edit invalidates an old suggestion', async (t) => {
  const engine = await setup(t, {
    recommendPersonas: async () => ({
      action: 'split', sourceId: 'old', reason: '这条规则只适用于练习。',
      profile, moveRuleIds: ['move'], evidenceRuleIds: ['move', 'stay'],
    }),
  }, {
    personas: [persona('old'), persona('shared')],
    answers: [source('a', 'group-1'), source('b', 'group-2'), source('c', 'group-3')],
    rules: [rule('move', 'opening', ['old', 'shared'], ['a', 'b']), rule('stay', 'feedback', ['old'], ['c'])],
  })
  const first = (await engine.checkPersonaReview()).suggestion
  await engine.mutateRule({ ruleId: 'move', action: 'edit', text: '进入角色之后继续按真实对话练习。' })
  await assert.rejects(engine.decidePersonaReview({ suggestionId: first.id, action: 'apply' }), /已变化/)
  const { suggestion } = await engine.checkPersonaReview({ manual: true })
  const result = await engine.decidePersonaReview({ suggestionId: suggestion.id, action: 'apply' })
  const { rules } = await engine.getState()
  assert.deepEqual(rules.find(({ id }) => id === 'move').personaIds, [result.personaId, 'shared'].sort())
  assert.deepEqual(rules.find(({ id }) => id === 'stay').personaIds, ['old'])
})

test('merge rejects contradictory rules and consolidates identical rules without losing evidence or shared scopes', async (t) => {
  const engine = await setup(t, {
    recommendPersonas: async () => ({
      action: 'merge', sourceId: 'source', targetId: 'target', reason: '两个搭子的使用情景重复。',
      evidenceRuleIds: ['left', 'right'],
    }),
  }, {
    personas: [persona('source'), persona('target'), persona('shared')],
    answers: [source('a', 'group-1'), source('b', 'group-2'), source('c', 'group-3')],
    rules: [rule('left', 'opening', ['source', 'shared'], ['a', 'b']), rule('right', 'opening', ['target'], ['c'], '先回顾不同的故事。')],
  })
  assert.equal((await engine.checkPersonaReview()).suggestion, null)
  await engine.mutateRule({ ruleId: 'right', action: 'edit', text: '先进入练习角色。' })
  const { suggestion } = await engine.checkPersonaReview({ manual: true })
  await engine.decidePersonaReview({ suggestionId: suggestion.id, action: 'apply' })
  const state = await engine.getState()
  assert.deepEqual(state.personas.map(({ id }) => id), ['target', 'shared'])
  assert.equal(state.rules.length, 1)
  assert.deepEqual(state.rules[0].personaIds, ['shared', 'target'])
  assert.equal(state.rules[0].evidence.length, 3)
})
