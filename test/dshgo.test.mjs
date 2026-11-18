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

test('native excerpt form submits the selected text separately from an ordinary situation', async () => {
  const excerpt = '我想和你聊聊这个项目。\n助手立刻生成了一份任务表。'
  const feedback = '想先把需求说清楚。'
  let panel
  let received
  registerDshGo({ inject: (_names, callback) => callback({
    dshGo: { panel: (_id, definition) => { panel = definition } },
  }) }, {
    getState: async () => ({ proposals: [] }),
    listTests: () => [],
    generateTest: async (request) => { received = request; return { test: { id: 'review' } } },
  })
  const view = panel.view({}, { locale: 'zh', components: ['form', 'textField'] })
  const form = view.children.find((item) => item.submit === 'generate-excerpt')
  assert.ok(form)
  const action = panel.actions[form.submit]({ sessionId: 'excerpt-session' }, {
    locale: 'zh', value: { values: { [form.children[0].bind]: excerpt, [form.children[1].bind]: feedback } },
  })
  assert.equal((await action.result(new AbortController().signal)).toast, '新题来了。')
  assert.deepEqual(received.review, { excerpt, feedback })
  assert.equal(Object.hasOwn(received, 'context'), false)
})

test('native persona rows confirm a single preference for multiple personas', async () => {
  let panel
  const emitted = []
  const scoped = {
    id: 'scoped', text: '先聊目前的想法。', status: 'pending', topic: 'preference',
    suggestedPersonaIds: ['ideas'],
  }
  let accepted
  registerDshGo({ inject: (_names, callback) => callback({
    dshGo: { panel: (_id, definition) => { panel = definition } },
  }) }, {
    getState: async () => ({
      proposals: accepted ? [] : [scoped],
      personas: [{ id: 'ideas', name: '点子搭子' }, { id: 'review', name: '评审搭子' }],
    }),
    listTests: () => [],
    decide: async (result) => { accepted = result },
  })
  const scope = { sessionId: 'scoped-quiz' }
  const dispose = panel.data(scope, (data) => emitted.push(data), { locale: 'zh' })
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(emitted.at(-1).personaRows.find((row) => row.title.includes('点子搭子')).title, '✓ 点子搭子')
  const select = emitted.at(-1).personaRows.find((row) => row.title.includes('评审搭子')).action
  await panel.actions[select.id](scope, { locale: 'zh', value: select.args })
  const save = emitted.at(-1).personaRows.find((row) => row.action.id === 'remember-scoped').action
  await panel.actions[save.id](scope, { locale: 'zh', value: save.args })
  assert.deepEqual(accepted.personaIds, ['ideas', 'review'])
  assert.equal(emitted.at(-1).personaRows.length, 0)
  dispose()
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

test('native tone questions use the tone topic and preserve explicit confirmation', async () => {
  let panel
  let request
  const state = { proposals: [], rules: [] }
  const tests = []
  const engine = {
    listTests: () => tests,
    getState: async () => structuredClone(state),
    generateTest: async (value) => {
      request = value
      const test = { id: 'tone1', topic: 'tone', title: '小鱼怎样开口', prompt: '哪种问法你听起来更舒服？', options: [
        { id: 'a', label: '俏皮一点' }, { id: 'b', label: '平和一点' },
      ] }
      tests.push(test)
      return { test }
    },
    answer: async () => {
      state.proposals = [{ id: 'p1', topic: 'tone', status: 'pending', text: '默契题使用平和自然的语气', evidence: '小鱼怎样开口：平和一点' }]
    },
    decide: async ({ action }) => {
      assert.equal(action, 'remember')
      state.proposals = []
      state.rules = [{ id: 'r1', topic: 'tone', text: '默契题使用平和自然的语气', evidence: ['小鱼怎样开口：平和一点'] }]
    },
  }
  registerDshGo({ inject: (_names, callback) => callback({ dshGo: { panel: (_id, definition) => { panel = definition } } }) }, engine)
  const oldView = panel.view({}, { locale: 'zh' })
  assert.ok(oldView.children.some((node) => node.type === 'actions' && node.items.some((item) => item.action === 'generate-tone')))
  const richView = panel.view({}, { locale: 'zh', components: ['form', 'textField'] })
  assert.equal(richView.children.find((node) => node.submit === 'generate-tone').children[0].bind, 'data.form.toneContext')
  const scope = { sessionId: 'tone-session' }
  const emitted = []
  const dispose = panel.data(scope, (value) => emitted.push(value), { locale: 'zh' })
  await new Promise((resolve) => setImmediate(resolve))
  assert.match(emitted.at(-1).companion, /了解你/)
  const pending = panel.actions['generate-tone'](scope, { locale: 'zh', value: { values: { 'data.form.toneContext': '少用叠词' } } })
  await pending.result(new AbortController().signal)
  assert.equal(request.topic, 'tone')
  assert.equal(request.context, '少用叠词')
  assert.ok(emitted.some((value) => value.companion.includes('想一道')))
  assert.match(emitted.at(-1).question, /^提问方式 · /)
  assert.match(emitted.at(-1).companion, /小题送到/)
  await panel.actions.choose(scope, { locale: 'zh', value: { value: 'b' } })
  assert.equal(state.rules.length, 0)
  assert.match(emitted.at(-1).proposal, /^提问方式 · /)
  assert.match(emitted.at(-1).companion, /理解你/)
  const blocked = panel.actions.generate(scope, { locale: 'zh' })
  assert.match((await blocked.result(new AbortController().signal)).toast, /上一条/)
  assert.equal(tests.length, 1)
  await panel.actions.remember(scope, { locale: 'zh' })
  assert.match(emitted.at(-1).ruleRows[0].subtitle, /^提问方式 · /)
  assert.equal(panel.actions['edit-rule'](scope, { value: { ruleId: 'r1' } })[0].insert, '/attune correct r1 ')
  assert.equal(panel.actions['delete-rule'](scope, { value: { ruleId: 'r1' } })[0].insert, '/attune delete r1')
  dispose()
})

test('native cancelled generation releases its busy state for another question', async () => {
  let panel
  let calls = 0
  const engine = {
    listTests: () => [], getState: async () => ({ proposals: [], rules: [] }),
    generateTest: async () => { calls++; return {} },
  }
  registerDshGo({ inject: (_names, callback) => callback({ dshGo: { panel: (_id, definition) => { panel = definition } } }) }, engine)
  const scope = { sessionId: 'cancel-test' }
  const first = panel.actions['generate-tone'](scope, { locale: 'zh' })
  assert.match(panel.actions.generate(scope, { locale: 'zh' }).toast, /上一题/)
  const cancelled = new AbortController()
  cancelled.abort()
  await first.result(cancelled.signal)
  assert.equal(calls, 0)
  const second = panel.actions.generate(scope, { locale: 'zh' })
  await second.result(new AbortController().signal)
  assert.equal(calls, 1)
})
