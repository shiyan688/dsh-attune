import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { createInterface } from 'node:readline'
import { fileURLToPath } from 'node:url'
import { checkDesktopBalance } from './desktop-balance.js'

const helper = fileURLToPath(new URL('./native/AttuneDesktop.exe', import.meta.url))
const { version } = createRequire(import.meta.url)('../package.json')
const latestUrl = 'https://registry.npmjs.org/dsh-attune/latest'
const pollingTime = 20_000

export function isWindowsDesktopHost(runtime = process) {
  const entry = runtime.argv[1]?.replaceAll('\\', '/').toLowerCase()
  return runtime.platform === 'win32' && runtime.env.ELECTRON_RUN_AS_NODE === '1'
    && entry?.endsWith('/@deepseek-ai/dsh-desktop-host/lib/index.js') === true
}

function parseVersion(value) {
  if (typeof value !== 'string' || value.length > 100) throw new Error('Invalid package version')
  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([\da-z-]+(?:\.[\da-z-]+)*))?(?:\+[\da-z-]+(?:\.[\da-z-]+)*)?$/i.exec(value)
  if (!match) throw new Error('Invalid package version')
  const identifiers = (match[4]?.split('.') ?? []).map((part) => {
    if (!/^\d+$/.test(part)) return part
    if (/^0\d/.test(part)) throw new Error('Invalid prerelease version')
    return BigInt(part)
  })
  return { core: match.slice(1, 4).map(BigInt), identifiers }
}

function compareVersions(left, right) {
  const a = parseVersion(left), b = parseVersion(right)
  for (const [i, part] of a.core.entries()) {
    if (part !== b.core[i]) return part > b.core[i] ? 1 : -1
  }
  if (!a.identifiers.length || !b.identifiers.length) return Number(!a.identifiers.length) - Number(!b.identifiers.length)
  for (const [i, part] of a.identifiers.entries()) {
    const other = b.identifiers[i]
    if (other === undefined) return 1
    if (part === other) continue
    if (typeof part !== typeof other) return typeof part === 'bigint' ? -1 : 1
    return part > other ? 1 : -1
  }
  return a.identifiers.length - b.identifiers.length
}

export async function checkDesktopUpdate(current = version, request = fetch) {
  try {
    const response = await request(latestUrl, {
      headers: { accept: 'application/json' }, redirect: 'error', signal: AbortSignal.timeout(6_000),
    })
    if (!response.ok) throw new Error('Cannot read npm metadata')
    const latest = (await response.json()).version
    const order = compareVersions(current, latest)
    return { current, latest, status: order < 0 ? 'available' : order === 0 ? 'current' : 'ahead' }
  } catch {
    return { current, latest: '', status: 'error' }
  }
}

function spawnPet(dataDir, intent) {
  const env = Object.fromEntries(['SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'LOCALAPPDATA']
    .filter((key) => process.env[key] !== undefined)
    .map((key) => [key, process.env[key]]))
  return spawn(helper, [String(process.ppid), dataDir, intent], { env, windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] })
}

export function createDesktopPet({
  dataDir, supported = existsSync(helper), launch = spawnPet, checkUpdate = checkDesktopUpdate,
  checkBalance = () => checkDesktopBalance({}),
}) {
  let child
  let disposed = false
  let nextQuiz = 0
  let revision = 0
  let mode = 'off'
  const listeners = new Set()
  const snapshot = () => ({ supported, mode, revision, quiz: nextQuiz })
  const queries = {
    update: async () => {
      const { status, current, latest } = await checkUpdate()
      return [status, current, latest]
    },
    balance: async () => {
      const { status, source, lines } = await checkBalance()
      return [status, source, ...lines]
    },
  }

  function change() {
    revision += 1
    for (const listener of listeners) listener()
  }

  function wait(after, signal) {
    if (!supported || after !== revision || disposed || signal?.aborted) return Promise.resolve(snapshot())
    return new Promise((resolve) => {
      const finish = () => {
        listeners.delete(finish)
        signal?.removeEventListener('abort', finish)
        clearTimeout(timer)
        resolve(snapshot())
      }
      const timer = setTimeout(finish, pollingTime)
      timer.unref?.()
      listeners.add(finish)
      signal?.addEventListener('abort', finish, { once: true })
    })
  }

  function send(command, target = child) {
    if (target?.stdin?.writable) target.stdin.write(command + '\n')
  }

  function receive(message, target, inFlight) {
    if (disposed || child !== target) return
    if (Object.hasOwn(queries, message)) {
      if (inFlight.has(message)) return
      inFlight.add(message)
      void queries[message]().catch(() => message === 'update' ? ['error', version, ''] : ['error', '']).then((fields) => {
        if (!disposed && child === target) send([message, ...fields].join('\t'), target)
      }).finally(() => inFlight.delete(message))
      return
    }
    if (message === 'quiz') nextQuiz += 1
    else if (message === 'shown' || message === 'hidden') mode = message
    else return
    change()
  }

  function start(intent = 'restore') {
    if (!supported || disposed || child) return snapshot()
    let target
    try { target = launch(dataDir, intent) }
    catch { mode = 'error'; change(); return snapshot() }
    child = target
    mode = 'starting'
    change()
    let closing = false
    const output = createInterface({ input: target.stdout })
    const close = (failed) => {
      if (closing) return
      closing = true
      clearTimeout(timeout)
      output.close()
      if (child !== target) return
      child = undefined
      mode = failed || mode === 'starting' ? 'error' : 'off'
      change()
    }
    const timeout = setTimeout(() => {
      if (mode !== 'starting') return
      close(true)
      target.kill()
    }, 6_000)
    timeout.unref?.()
    target.stdin.on('error', () => {})
    target.once('error', () => close(true))
    target.once('exit', (code) => close(code !== 0))
    output.once('error', () => { close(true); target.kill() })
    const inFlight = new Set()
    output.on('line', (message) => receive(message, target, inFlight))
    return snapshot()
  }

  function setVisibility(visible) {
    if (!child && visible) return start('show')
    if (!disposed) send(visible ? 'show' : 'hide')
    return snapshot()
  }

  function dispose() {
    disposed = true
    const target = child
    child = undefined
    change()
    if (!target) return
    target.stdin.end()
    const timeout = setTimeout(() => { if (target.exitCode === null) target.kill() }, 800)
    timeout.unref?.()
  }

  return { wait, start, setVisibility, dispose, refreshAppearance: () => send('appearance') }
}

export function registerDesktopPet(ctx, { dataDir, bodyOf, defaultProvider }) {
  if (!isWindowsDesktopHost() || typeof ctx.inject !== 'function') return
  let active
  ctx.inject(['connection'], (owner) => {
    const registry = owner.connection?.fetch
    if (typeof registry?.register !== 'function') return
    owner.effect(() => {
      const pet = createDesktopPet({
        dataDir,
        checkBalance: async () => {
          const { APP_IDENTITY } = await import('@deepseek-ai/dsh-llm')
          return checkDesktopBalance({
            account: owner.get('deepseekAccount'),
            credentials: owner.get('credentials'),
            platformVersion: APP_IDENTITY.version,
            preferApi: defaultProvider() === 'deepseek-official',
          })
        },
      })
      const status = registry.register({
        path: '/api/attune/desktop', methods: ['GET'], requestBody: 'buffered',
        fetch: async (request) => {
          const value = new URL(request.url).searchParams.get('after')
          return desktopResponse(await pet.wait(value === null ? null : Number(value), request.signal))
        },
      })
      const visibility = registry.register({
        path: '/api/attune/desktop/visibility', methods: ['POST'], requestBody: 'streaming',
        fetch: async (request) => {
          try {
            if (request.headers.get('x-attune-desktop') !== '1') return desktopResponse({ error: 'Invalid desktop request' }, 403)
            const { visible } = await bodyOf(request)
            if (typeof visible !== 'boolean') return desktopResponse({ error: 'Invalid desktop visibility' }, 400)
            return desktopResponse(pet.setVisibility(visible))
          } catch {
            return desktopResponse({ error: 'Invalid desktop request' }, 400)
          }
        },
      })
      active = pet
      pet.start()
      return () => {
        active = undefined
        pet.dispose()
        visibility()
        status()
      }
    })
  })
  return () => active?.refreshAppearance()
}

function desktopResponse(value, status = 200) {
  return Response.json(value, { status, headers: { 'cache-control': 'no-store' } })
}
