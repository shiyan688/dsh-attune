import test from 'node:test'
import assert from 'node:assert/strict'
import { DIMENSIONS, generateQuestion, parseQuestion, resolveModelRoute, validateQuestion } from '../lib/generator.js'

const sample = {
  title: '两位助手的开场',
  prompt: '你正在准备一个产品方案，哪位助手的回答开场更能帮你推进？',
  dimension: 'opening',
  options: [
    { mode: 'reasoning', label: '先看依据', detail: '先说用户反馈和时间限制，再给出试验建议。', rule: '讨论产品方案时，先交代关键依据，再给建议。' },
    { mode: 'conclusion', label: '先看建议', detail: '先给出试验建议，再说用户反馈和时间限制。', rule: '讨论产品方案时，先给建议，再简述关键依据。' },
  ],
}

function fakeLlm(text, onRequest = () => {}) {
  return {
    async *stream(options) {
      onRequest(options)
      yield { type: 'block-start', index: 0, blockType: 'text' }
      yield { type: 'text-delta', index: 0, text }
      yield { type: 'block-end', index: 0, block: { type: 'text', text } }
      yield { type: 'finish', reason: { kind: 'stop' } }
    },
  }
}

test('semantic modes survive a swapped A/B order', () => {
  const result = validateQuestion(sample)
  assert.equal(result.options[0].id, 'a')
  assert.equal(result.options[0].mode, 'reasoning')
  assert.equal(result.options[1].id, 'b')
  assert.equal(result.options[1].mode, 'conclusion')
  assert.ok(DIMENSIONS[result.dimension])
})

test('rejects duplicate modes, unrelated dimensions and identical rules', () => {
  assert.throws(() => validateQuestion({ ...sample, options: [sample.options[0], { ...sample.options[1], mode: 'reasoning' }] }), /清楚的偏好对照/)
  assert.throws(() => validateQuestion({ ...sample, dimension: 'personality' }), /不支持的偏好维度/)
  assert.throws(() => validateQuestion({ ...sample, options: [sample.options[0], { ...sample.options[1], rule: sample.options[0].rule }] }), /清楚的偏好对照/)
})

test('parses strict JSON or a complete JSON fence, not surrounding prose', () => {
  const payload = JSON.stringify(sample)
  assert.equal(parseQuestion(payload).title, sample.title)
  assert.equal(parseQuestion(`\`\`\`json\n${payload}\n\`\`\``).dimension, 'opening')
  assert.throws(() => parseQuestion(`推荐题目：${payload}`), /可解析/)
})

test('uses DSH model route and a bounded situation in one generation call', async () => {
  let calls = 0
  let options
  const context = '请先拟一份产品方案。'.repeat(200)
  const result = await generateQuestion({
    llm: fakeLlm(JSON.stringify(sample), (value) => { calls++; options = value }),
    route: { provider: 'fake', model: 'fake-model' },
    context,
    confirmedRules: ['说话请简明。'],
    recentTitles: ['上次的开场测试'],
  })
  assert.equal(calls, 1)
  assert.equal(result.options[0].mode, 'reasoning')
  assert.equal(options.reasoningEffort, 'off')
  assert.equal(options.maxTokens, 1100)
  assert.equal(options.messages[0].content[0].text.includes(context), false)
  assert.ok(options.messages[0].content[0].text.includes('上次的开场测试'))
  assert.ok(options.system.includes('不推断健康'))
})

test('reports an unavailable model instead of pretending a fixed question is generated', async () => {
  await assert.rejects(generateQuestion({ llm: null, route: null }), /模型服务/)
  await assert.rejects(generateQuestion({ llm: fakeLlm('{}'), route: null }), /默认模型/)
})

test('resolves a configured model before the current DSH default', () => {
  const ctx = { get: () => ({ currentSelection: () => ({ provider: 'default', model: 'chat' }) }) }
  assert.deepEqual(resolveModelRoute(ctx, { provider: 'own', model: 'cheap' }), { provider: 'own', model: 'cheap' })
  assert.deepEqual(resolveModelRoute(ctx), { provider: 'default', model: 'chat' })
})
