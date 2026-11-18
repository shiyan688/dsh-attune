import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { runInNewContext } from 'node:vm'
import test from 'node:test'

const source = await readFile(new URL('../lib/client.js', import.meta.url), 'utf8')

function mount(baseURI, invitationsEnabled = false) {
  let client
  const registered = new Map()
  const requested = []
  const React = {
    createElement: (type, props, ...children) => ({ type, props: { ...props, children } }),
    useState: (initial) => [initial, () => {}],
    useEffect: (effect) => { effect() },
    useRef: (value) => ({ current: value }),
  }
  const sandbox = {
    window: { __ModuleLoader__: { load: ({ factory }) => { client = factory((id) => {
      assert.equal(id, 'react')
      return React
    }) } } },
    document: { baseURI },
    URL,
    queueMicrotask,
    setTimeout,
    fetch: async (url) => {
      requested.push(String(url))
      return { ok: true, json: async () => url.endsWith('/tests')
        ? [{ id: 'answer-order', title: 'Answer order', options: [] }]
        : url.endsWith('/invite')
          ? { test: { id: 'answer-order' } }
          : { rules: [], proposals: [], settings: { invitationsEnabled } } }
    },
  }
  runInNewContext(source, sandbox, { filename: 'client.js' })
  client.apply({
    effect: (register) => register(),
    locale: { register: () => () => {}, bind: () => (key) => key },
    slots: { inject: (_name, register) => register(), register: (meta, render) => registered.set(meta.name, render) },
  })
  const entry = registered.get('sidebar.footer.action')({})
  const button = entry.type(entry.props)
  button.props.onClick()
  const overlay = registered.get('shell.overlay')({})
  overlay.type(overlay.props)
  return requested
}

test('Web client registers public slots and fetches under reverse-proxy mount', async () => {
  const requested = mount('https://example.test/ui/')
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.deepEqual(requested, [
    'https://example.test/ui/api/attune/appearance',
    'https://example.test/ui/api/attune/state',
    'https://example.test/ui/api/attune/tests',
  ])
})

test('Desktop carrier fetches through its own authenticated origin', async () => {
  const requested = mount('dsh-app://app/')
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.deepEqual(requested, [
    'dsh-app://app/api/attune/appearance',
    'dsh-app://app/api/attune/state',
    'dsh-app://app/api/attune/tests',
  ])
})

test('opted-in page checks one nonblocking recommendation on opening', async () => {
  const requested = mount('https://example.test/ui/', true)
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.deepEqual(requested, [
    'https://example.test/ui/api/attune/appearance',
    'https://example.test/ui/api/attune/state',
    'https://example.test/ui/api/attune/tests',
    'https://example.test/ui/api/attune/invite',
  ])
})

function mountInteractive({ initialState, initialTests, generatedTest, openInitially = true, touch = false, selection = null }) {
  let client
  const registered = new Map()
  const instances = new Map()
  const requested = []
  const documentListeners = new Map()
  let tests = initialTests
  let currentHooks = []
  let hookIndex = 0
  const React = {
    createElement: (type, props, ...children) => ({ type, props: { ...props, children } }),
    useState: (initial) => {
      const index = hookIndex++
      const hooks = currentHooks
      if (!(index in hooks)) hooks[index] = initial
      return [hooks[index], (next) => { hooks[index] = typeof next === 'function' ? next(hooks[index]) : next }]
    },
    useEffect: (effect, dependencies) => {
      const index = hookIndex++
      const previous = currentHooks[index]
      if (dependencies && previous && dependencies.length === previous.dependencies?.length &&
          dependencies.every((item, i) => Object.is(item, previous.dependencies[i]))) return
      previous?.cleanup?.()
      currentHooks[index] = { dependencies, cleanup: effect() }
    },
    useRef: (value) => {
      const index = hookIndex++
      return currentHooks[index] ??= { current: value }
    },
  }
  runInNewContext(source, {
    window: {
      __ModuleLoader__: { load: ({ factory }) => { client = factory(() => React) } },
      matchMedia: () => ({ matches: touch }), innerWidth: 950, innerHeight: 700,
    },
    document: {
      baseURI: 'https://example.test/ui/',
      addEventListener: (name, callback) => documentListeners.set(name, callback),
      getSelection: () => selection,
    }, URL, queueMicrotask,
    fetch: async (url, options) => {
      requested.push({ url: String(url), body: options?.body ? JSON.parse(options.body) : null })
      const result = url.endsWith('/tests') ? tests : url.endsWith('/generate') ? { test: generatedTest } : initialState
      if (url.endsWith('/generate')) tests = [...tests, generatedTest]
      return { ok: true, json: async () => result }
    },
  }, { filename: 'client.js' })
  client.apply({
    effect: (register) => register(),
    locale: { register: () => () => {}, bind: () => (key) => key },
    slots: { inject: (_name, register) => register(), register: (meta, render) => registered.set(meta.name, render) },
  })
  const render = (element, key) => {
    currentHooks = instances.get(key) ?? []
    instances.set(key, currentHooks)
    hookIndex = 0
    return element.type(element.props)
  }
  const find = (node, predicate) => {
    if (!node || typeof node !== 'object') return null
    if (predicate(node)) return node
    for (const child of node.props?.children ?? []) {
      const result = find(child, predicate)
      if (result) return result
    }
    return null
  }
  if (openInitially) render(registered.get('sidebar.footer.action')({}), 'entry').props.onClick()
  const overlay = registered.get('shell.overlay')({})
  const renderWorkbench = () => render(overlay, 'overlay')
  renderWorkbench()
  return { renderWorkbench, find, requested, documentListeners }
}

test('desktop and touch selections open an editable excerpt and only send it on Generate', async () => {
  for (const touch of [false, true]) {
    const original = '我想聊一个点子。\n助手马上开始列排期。'
    const surface = { contains: () => true }
    const target = { nodeType: 1, closest: (selector) => selector.includes('data-chat-flow') ? surface : null }
    const rect = { left: 20, right: 160, top: 40, bottom: 70 }
    const selection = {
      isCollapsed: false, rangeCount: 1, toString: () => original, removeAllRanges() {},
      getRangeAt: () => ({ startContainer: target, endContainer: target, getBoundingClientRect: () => rect, getClientRects: () => [rect] }),
    }
    const { renderWorkbench, find, requested, documentListeners } = mountInteractive({
      initialState: { rules: [], proposals: [], settings: { invitationsEnabled: true } },
      initialTests: [], generatedTest: { id: 'excerpt-1', dimension: 'ideas', title: '先聊什么', options: [] },
      openInitially: false, touch, selection,
    })
    if (touch) {
      documentListeners.get('selectionchange')()
    } else {
      let intercepted = false
      const event = { target, clientX: 30, clientY: 50, pointerType: 'mouse', preventDefault: () => { intercepted = true } }
      documentListeners.get('contextmenu')({ ...event, clientX: 200 })
      assert.equal(intercepted, false)
      documentListeners.get('contextmenu')(event)
      assert.equal(intercepted, true)
    }
    find(renderWorkbench(), (node) => node.props?.className === 'at-selection-action').props.onClick()
    renderWorkbench()
    await new Promise((resolve) => setImmediate(resolve))
    const draft = renderWorkbench()
    const input = find(draft, (node) => node.props?.id === 'dsh-attune-excerpt')
    assert.equal(input.props.value, original)
    assert.ok(!requested.some(({ url }) => url.endsWith('/generate') || url.endsWith('/invite')))
    input.props.onChange({ target: { value: '讨论点子时，助手马上开始列排期。' } })
    await new Promise((resolve) => setImmediate(resolve))
    const generate = find(renderWorkbench(), (node) => node.props?.children?.[0] === 'generate' && node.props.onClick)
    generate.props.onClick()
    await new Promise((resolve) => setImmediate(resolve))
    const { groupId, ...review } = requested.find(({ url }) => url.endsWith('/generate')).body.review
    assert.match(groupId, /^[\w-]{12,96}$/)
    assert.deepEqual(review, { excerpt: '讨论点子时，助手马上开始列排期。', feedback: '', usedDimensions: [] })
    const next = find(renderWorkbench(), (node) => node.props?.children?.[0] === 'excerptNext' && node.props.onClick)
    assert.ok(next)
    next.props.onClick()
    await new Promise((resolve) => setImmediate(resolve))
    assert.deepEqual(requested.filter(({ url }) => url.endsWith('/generate')).at(-1).body.review.usedDimensions, ['ideas'])
    assert.equal(requested.filter(({ url }) => url.endsWith('/generate')).at(-1).body.review.groupId, groupId)
  }
})

test('switching tests keeps an unresolved candidate visible', async () => {
  const { renderWorkbench, find } = mountInteractive({
    initialState: { rules: [], proposals: [{ id: 'pending-1', text: 'Prefer an example first', evidence: 'First: A' }], settings: { invitationsEnabled: false } },
    initialTests: [{ id: 'one', title: 'First', options: [] }, { id: 'two', title: 'Second', options: [] }],
  })
  await new Promise((resolve) => setTimeout(resolve, 0))
  const before = renderWorkbench()
  assert.ok(find(before, (node) => node.type === 'textarea' && node.props?.value === 'Prefer an example first'))
  const secondTest = find(before, (node) => node.props?.children?.[0] === 'Second' && typeof node.props?.onClick === 'function')
  assert.ok(secondTest)
  secondTest.props.onClick()
  await new Promise((resolve) => setTimeout(resolve, 0))
  const after = renderWorkbench()
  assert.ok(find(after, (node) => node.type === 'textarea' && node.props?.value === 'Prefer an example first'))
})

test('a selected-excerpt candidate sends the edited text and all selected personas in one confirmation', async () => {
  const initialState = {
    rules: [],
    proposals: [{ id: 'excerpt-proposal', topic: 'preference', dimension: 'ideas', text: '先听我把点子说完。', suggestedPersonaIds: ['ideas'] }],
    personas: [{ id: 'ideas', name: '点子搭子' }, { id: 'review', name: '评审搭子' }],
    settings: { invitationsEnabled: false },
  }
  const { renderWorkbench, find, requested } = mountInteractive({ initialState, initialTests: [] })
  await new Promise((resolve) => setImmediate(resolve))
  const draft = renderWorkbench()
  const picker = find(draft, (node) => node.props?.title === 'rememberFor')
  assert.deepEqual(Array.from(picker.props.ids), ['ideas'])
  picker.props.onChange(['ideas', 'review'])
  find(draft, (node) => node.type === 'textarea' && node.props?.['aria-label'] === 'learned')
    .props.onChange({ target: { value: '先陪我聊完整，再开始评估。' } })
  await new Promise((resolve) => setImmediate(resolve))
  find(renderWorkbench(), (node) => node.props?.children?.[0] === 'remember' && node.props.onClick).props.onClick()
  await new Promise((resolve) => setImmediate(resolve))
  assert.deepEqual(requested.find(({ url }) => url.endsWith('/proposal')).body, {
    proposalId: 'excerpt-proposal', action: 'remember', personaIds: ['ideas', 'review'],
    replaceRuleIds: [], text: '先陪我聊完整，再开始评估。',
  })
})

test('optional situation text is sent to question generation and new test is selected', async () => {
  const { renderWorkbench, find, requested } = mountInteractive({
    initialState: { rules: [], proposals: [], settings: { invitationsEnabled: false } },
    initialTests: [],
    generatedTest: { id: 'generated-1', title: 'A new situation', prompt: 'Which one?', options: [{ id: 'a', label: 'A' }] },
  })
  await new Promise((resolve) => setTimeout(resolve, 0))
  const before = renderWorkbench()
  const situationInput = find(before, (node) => node.type === 'textarea' && node.props?.id === 'dsh-attune-context')
  assert.ok(situationInput)
  situationInput.props.onChange({ target: { value: '我在写小说' } })
  await new Promise((resolve) => setTimeout(resolve, 0))
  const withInput = renderWorkbench()
  const generate = find(withInput, (node) => node.props?.children?.[0] === 'generate' && typeof node.props?.onClick === 'function')
  assert.ok(generate)
  generate.props.onClick()
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.deepEqual(requested.filter((request) => request.url.endsWith('/generate')).map((request) => request.body), [{ context: '我在写小说' }])
  const after = renderWorkbench()
  assert.ok(find(after, (node) => node.type === 'h3' && node.props?.children?.[0] === 'A new situation'))
})

test('tone entry sends a tone topic and does not show ordinary question history', async () => {
  const { renderWorkbench, find, requested } = mountInteractive({
    initialState: { rules: [], proposals: [], settings: { invitationsEnabled: false } },
    initialTests: [{ id: 'ordinary', title: 'Ordinary quiz', options: [] }],
    generatedTest: { id: 'tone-1', topic: 'tone', title: 'How should I ask?', prompt: 'Which voice?', options: [] },
  })
  await new Promise(resolve => setTimeout(resolve, 0))
  find(renderWorkbench(), node => node.props?.role === 'tab' && node.props.children[0] === 'tone').props.onClick()
  await new Promise(resolve => setTimeout(resolve, 0))
  const tonePage = renderWorkbench()
  assert.equal(find(tonePage, node => node.props?.children?.[0] === 'Ordinary quiz'), null)
  find(tonePage, node => node.props?.children?.[0] === 'toneGenerate').props.onClick()
  await new Promise(resolve => setTimeout(resolve, 0))
  assert.deepEqual(requested.filter(r => r.url.endsWith('/generate')).map(r => r.body), [{ context: '', topic: 'tone' }])
  assert.ok(find(renderWorkbench(), node => node.type === 'h3' && node.props.children[0] === 'How should I ask?'))
})
