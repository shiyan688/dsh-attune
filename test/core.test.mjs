import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join, resolve, sep } from 'node:path'
import { createAttuneEngine } from '../lib/core.js'

const base = resolve('test')
await mkdir(base, { recursive: true })

function fakeGenerator({ context }) {
  const [dimension = 'opening', title = '即时生成的小测试'] = context.split('|')
  const modes = { opening: ['conclusion', 'reasoning'], explain: ['example', 'definition'], ideas: ['bold', 'practical'] }[dimension] ?? ['compact', 'expanded']
  return { title, dimension, prompt: '就眼前这件事，哪一种帮助更贴合？', options: modes.map((mode, i) => ({
    id: i ? 'b' : 'a', mode, label: `${mode} 的方式`, detail: `同一场景的 ${mode} 表达`,
    rule: `处理${dimension}场景时，优先采用${mode}方式。`,
  })) }
}

async function fixture(fn, clock = () => new Date('2026-11-12T08:00:00.000Z')) {
  const dir = await mkdtemp(join(base, 'tmp-'))
  assert.ok(resolve(dir).startsWith(base + sep))
  try {
    return await fn(createAttuneEngine({ filePath: join(dir, 'state.json'), now: clock, generateQuestion: fakeGenerator }), dir)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

const ask = async (engine, context = 'opening|即时测试') => (await engine.generateTest({ context })).test

test('generated question, confirm, correct, delete and forget form a complete loop', async () => fixture(async (engine, dir) => {
  assert.equal(engine.listTests().length, 0)
  assert.equal(engine.promptFor(), '')
  const question = await ask(engine, 'opening|平行宇宙助手')
  assert.equal(engine.listTests()[0].id, question.id)
  assert.equal('rule' in engine.listTests()[0].options[0], false)
  const answer = await engine.answer({ testId: question.id, optionId: 'a', submissionId: 's-one' })
  assert.match(answer.proposal.evidence, /平行宇宙助手/)
  assert.equal((await engine.getState()).rules.length, 0)
  const accepted = await engine.decide({ proposalId: answer.proposal.id, action: 'remember' })
  assert.match(engine.promptFor(), /conclusion/)
  assert.equal(accepted.rule.evidence.length, 1)
  const edited = await engine.mutateRule({ ruleId: accepted.rule.id, action: 'edit', text: '给工作建议时，先给三点结论。' })
  assert.equal(edited.rule.text, '给工作建议时，先给三点结论。')
  assert.match(engine.promptFor(), /三点结论/)
  await engine.mutateRule({ ruleId: accepted.rule.id, action: 'delete', forgetEvidence: true })
  const state = await engine.getState()
  assert.equal(state.rules.length, 0)
  assert.equal(state.answersCount, 0)
  assert.equal(engine.promptFor(), '')
  const raw = JSON.parse(await readFile(join(dir, 'state.json'), 'utf8'))
  assert.deepEqual(raw.receipts['s-one'], { forgotten: true })
  assert.equal(JSON.stringify(raw).includes('平行宇宙助手'), false)
  const duplicate = await engine.answer({ testId: question.id, optionId: 'a', submissionId: 's-one' })
  assert.equal(duplicate.repeated, true)
  assert.equal(duplicate.proposal, null)
}))

test('semantic modes reinforce or challenge preference across generated tests', async () => fixture(async (engine) => {
  const first = await ask(engine, 'opening|场景一')
  const answer = await engine.answer({ testId: first.id, optionId: 'a', submissionId: 's1' })
  const original = (await engine.decide({ proposalId: answer.proposal.id, action: 'remember' })).rule
  const second = await ask(engine, 'opening|场景二')
  const repeat = await engine.answer({ testId: second.id, optionId: 'a', submissionId: 's2' })
  assert.equal(repeat.proposal.reinforcesRuleId, original.id)
  const reinforced = (await engine.decide({ proposalId: repeat.proposal.id, action: 'remember' })).rule
  assert.equal(reinforced.id, original.id)
  assert.equal(reinforced.evidence.length, 2)
  const opposite = await engine.answer({ testId: second.id, optionId: 'b', submissionId: 's3' })
  assert.equal(opposite.proposal.replacesRuleId, original.id)
  assert.equal((await engine.getState()).rules[0].id, original.id)
  const replacement = (await engine.decide({ proposalId: opposite.proposal.id, action: 'remember' })).rule
  assert.notEqual(replacement.id, original.id)
  assert.match(engine.promptFor(), /reasoning/)
}))

test('rejection discards tentative evidence', async () => fixture(async (engine) => {
  const question = await ask(engine, 'explain|陌生概念')
  const answer = await engine.answer({ testId: question.id, optionId: 'a', submissionId: 's1' })
  await engine.decide({ proposalId: answer.proposal.id, action: 'reject' })
  assert.equal((await engine.getState()).answersCount, 0)
  assert.equal((await engine.getState()).rules.length, 0)
}))

test('invitation is opt-in and rate-limited', async () => {
  let date = new Date('2026-11-12T08:00:00.000Z')
  await fixture(async (engine) => {
    const question = await ask(engine, 'ideas|周末发明局')
    assert.equal((await engine.maybeInvite()).reason, 'disabled')
    await engine.setInvitations({ enabled: true })
    assert.equal((await engine.maybeInvite()).test.id, question.id)
    assert.equal((await engine.maybeInvite()).reason, 'cooldown')
    date = new Date('2026-11-15T08:00:00.000Z')
    assert.ok((await engine.maybeInvite()).test)
    date = new Date('2026-11-18T08:00:00.000Z')
    assert.equal((await engine.maybeInvite()).reason, 'weekly-limit')
  }, () => date)
})

test('two engine instances serialize generated answers', async () => fixture(async (engine, dir) => {
  const q1 = await ask(engine, 'explain|任务一')
  const q2 = await ask(engine, 'ideas|任务二')
  const other = createAttuneEngine({ filePath: join(dir, 'state.json'), generateQuestion: fakeGenerator })
  const [a, b] = await Promise.all([
    engine.answer({ testId: q1.id, optionId: 'a', submissionId: 'x1' }),
    other.answer({ testId: q2.id, optionId: 'a', submissionId: 'x2' }),
  ])
  assert.ok(a.proposal && b.proposal)
  assert.equal((await engine.getState()).answersCount, 2)
}))

test('damaged state is preserved and does not break unrelated prompts', async () => fixture(async (engine, dir) => {
  const path = join(dir, 'state.json')
  await writeFile(path, '{broken', 'utf8')
  await assert.rejects(engine.generateTest({ context: 'ideas' }))
  assert.equal(engine.promptFor(), '')
  assert.equal(await readFile(path, 'utf8'), '{broken')
}))
