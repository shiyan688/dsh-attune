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
    'https://example.test/ui/api/attune/state',
    'https://example.test/ui/api/attune/tests',
  ])
})

test('Desktop carrier fetches through its own authenticated origin', async () => {
  const requested = mount('dsh-app://app/')
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.deepEqual(requested, [
    'dsh-app://app/api/attune/state',
    'dsh-app://app/api/attune/tests',
  ])
})

test('opted-in page checks one nonblocking recommendation on opening', async () => {
  const requested = mount('https://example.test/ui/', true)
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.deepEqual(requested, [
    'https://example.test/ui/api/attune/state',
    'https://example.test/ui/api/attune/tests',
    'https://example.test/ui/api/attune/invite',
  ])
})

function mountInteractive({ initialState, initialTests, generatedTest }) {
  let client
  const registered = new Map()
  const instances = new Map()
  const requested = []
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
    useEffect: (effect) => { effect() },
    useRef: (value) => ({ current: value }),
  }
  runInNewContext(source, {
    window: { __ModuleLoader__: { load: ({ factory }) => { client = factory(() => React) } } },
    document: { baseURI: 'https://example.test/ui/' }, URL, queueMicrotask,
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
  render(registered.get('sidebar.footer.action')({}), 'entry').props.onClick()
  const overlay = registered.get('shell.overlay')({})
  const renderWorkbench = () => render(overlay, 'overlay')
  renderWorkbench()
  return { renderWorkbench, find, requested }
}

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
