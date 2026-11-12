import assert from 'node:assert/strict'
import { test } from 'node:test'
import { registerDshGo } from '../lib/dshgo.js'

test('DSH Go panel completes answer, confirmation, correction and deletion handoff', async () => {
  let panel
  const bridge = { panel: (id, definition) => { assert.equal(id, 'attune'); panel = definition } }
  const state = { rules: [], proposals: [] }
  const tests = []
  const engine = {
    listTests: () => tests,
    generateTest: async ({ context, signal }) => {
      assert.equal(context, '我在安排周末')
      assert.equal(signal.aborted, false)
      const test = { id: 'order', title: '答案盲盒', prompt: '先说什么？', options: [{ id: 'a', label: '先结论' }, { id: 'b', label: '先过程' }] }
      tests.push(test)
      return { test }
    },
    getState: async () => structuredClone(state),
    answer: async ({ testId, optionId, submissionId }) => {
      assert.equal(testId, 'order')
      assert.equal(optionId, 'a')
      assert.ok(submissionId)
      state.proposals = [{ id: 'p1', text: '先结论', evidence: '答案盲盒：先结论', status: 'pending' }]
    },
    decide: async ({ proposalId, action, scope }) => {
      assert.equal(proposalId, 'p1')
      assert.equal(action, 'remember')
      assert.equal(scope, 'global')
      state.proposals = []
      state.rules = [{ id: 'r_1', text: '先结论', scope: 'global', evidence: ['答案盲盒：先结论'] }]
    },
  }
  registerDshGo({ inject: (_names, callback) => callback({ dshGo: bridge }) }, engine)
  assert.ok(panel)
  const nativeView = panel.view({}, { locale: 'zh' })
  assert.equal(nativeView.type, 'stack')
  assert.equal(nativeView.children.find((node) => node.type === 'actions').items[0].action, 'generate')
  assert.equal(nativeView.children.find((node) => node.type === 'options').id, 'choose')
  const nativeViewV2 = panel.view({}, { locale: 'zh', components: ['form', 'textField'] })
  assert.equal(nativeViewV2.v, 2)
  assert.equal(nativeViewV2.children.find((node) => node.type === 'form').submit, 'generate')

  const emitted = []
  const unsubscribe = panel.data({ sessionId: 's1' }, (value) => emitted.push(value), { locale: 'zh' })
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(emitted.at(-1).options.length, 0)
  const pending = panel.actions.generate({ sessionId: 's1' }, {
    locale: 'zh', value: { values: { 'data.form.context': '我在安排周末' } },
  })
  assert.equal(pending.pending.label, '正在出题')
  assert.equal((await pending.result(new AbortController().signal)).toast, '新题来了。')
  assert.equal(emitted.at(-1).options[0].value, 'a')

  await panel.actions.choose({ sessionId: 's1' }, { locale: 'zh', value: { value: 'a' } })
  assert.match(emitted.at(-1).proposal, /选择依据：答案盲盒：先结论/)
  await panel.actions.remember({ sessionId: 's1' }, { locale: 'zh' })
  assert.equal(emitted.at(-1).ruleRows.length, 2)
  assert.match(emitted.at(-1).ruleRows[0].subtitle, /选择依据：答案盲盒：先结论/)
  assert.match(emitted.at(-1).ruleRows[1].subtitle, /选择依据：答案盲盒：先结论/)

  const edit = panel.actions['edit-rule']({}, { locale: 'zh', value: { ruleId: 'r_1' } })
  const deleteRule = panel.actions['delete-rule']({}, { locale: 'zh', value: { ruleId: 'r_1' } })
  assert.equal(edit[0].insert, '/attune correct r_1 ')
  assert.equal(deleteRule[0].insert, '/attune delete r_1')
  unsubscribe()
})

test('optional DSH Go service does not block ordinary hosts', () => {
  let called = false
  registerDshGo({ inject: (_names, callback) => { called = true; callback({}) } }, { listTests: () => [] })
  assert.equal(called, true)
  registerDshGo({}, { listTests: () => [] })
})

test('native generation failure remains visible in panel', async () => {
  let panel
  const engine = {
    listTests: () => [],
    getState: async () => ({ proposals: [], rules: [] }),
    generateTest: async () => { throw new Error('当前 DSH 没有可用的测试生成模型') },
  }
  registerDshGo({ inject: (_names, callback) => callback({
    dshGo: { panel: (_id, definition) => { panel = definition } },
  }) }, engine)
  const emitted = []
  panel.data({ sessionId: 's2' }, (value) => emitted.push(value), { locale: 'zh' })
  const request = panel.actions.generate({ sessionId: 's2' }, { locale: 'zh' })
  const outcome = await request.result(new AbortController().signal)
  assert.match(outcome.toast, /没有可用的测试生成模型/)
  assert.match(emitted.at(-1).question, /没有可用的测试生成模型/)
})
