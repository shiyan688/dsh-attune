import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import test from 'node:test'
import { checkDesktopUpdate, createDesktopPet, isWindowsDesktopHost } from '../lib/desktop-pet.js'
import { checkDesktopBalance } from '../lib/desktop-balance.js'

test('the native pet is limited to the local official Windows Desktop Host', () => {
  const desktop = {
    platform: 'win32', env: { ELECTRON_RUN_AS_NODE: '1' },
    argv: ['DeepSeek Harness.exe', 'C:\\dsh\\node_modules\\@deepseek-ai\\dsh-desktop-host\\lib\\index.js'],
  }
  assert.equal(isWindowsDesktopHost(desktop), true)
  assert.equal(isWindowsDesktopHost({ ...desktop, platform: 'darwin' }), false)
  assert.equal(isWindowsDesktopHost({ ...desktop, env: {} }), false)
  assert.equal(isWindowsDesktopHost({ ...desktop, argv: ['node', 'C:/dsh/web/bin.js'] }), false)
})

test('checks the official package version including previews and network errors', async () => {
  const registry = (version) => async (url, options) => {
    assert.equal(url, 'https://registry.npmjs.org/dsh-attune/latest')
    assert.equal(options.redirect, 'error')
    return Response.json({ version })
  }
  assert.deepEqual(await checkDesktopUpdate('0.4.0-preview.2', registry('0.4.0-preview.10')), {
    current: '0.4.0-preview.2', latest: '0.4.0-preview.10', status: 'available',
  })
  assert.equal((await checkDesktopUpdate('0.4.0-preview.2', registry('0.4.0'))).status, 'available')
  assert.equal((await checkDesktopUpdate('0.4.0-preview.2', registry('0.3.0'))).status, 'ahead')
  assert.equal((await checkDesktopUpdate('0.4.0', registry('0.4.0'))).status, 'current')
  assert.equal((await checkDesktopUpdate('0.4.0', registry('unknown'))).status, 'error')
  assert.equal((await checkDesktopUpdate('0.4.0', async () => { throw new Error('offline') })).status, 'error')
})

test('reads the signed-in wallet and falls back to the configured official API key', async () => {
  const options = {
    platformVersion: '0.2.2',
    account: { async getBalance(client) {
      assert.equal(client.version, '0.2.2')
      return {
        status: 'ready', value: [{ currency: 'CNY', balance: '0.00' }],
        bonusWallets: [{ currency: 'USD', balance: '2.0500' }, { currency: 'USD', balance: '9\tprivate' }],
      }
    } },
    credentials: { async resolve(ref) {
      assert.equal(ref, 'DEEPSEEK_API_KEY')
      return { value: 'sample-key' }
    } },
    request: async (url, init) => {
      assert.equal(url, 'https://api.deepseek.com/user/balance')
      assert.equal(init.headers.authorization, 'Bearer sample-key')
      assert.equal(init.redirect, 'error')
      return Response.json({ is_available: true, balance_infos: [{ currency: 'CNY', total_balance: '4.00' }] })
    },
  }
  assert.deepEqual(await checkDesktopBalance(options), { status: 'ready', source: 'account', lines: ['充值 ¥0.00', '赠送 $2.0500'] })
  const expected = { status: 'ready', source: 'api', lines: ['¥4.00'] }
  assert.deepEqual(await checkDesktopBalance({ ...options, account: { getBalance: () => null } }), expected)
  assert.deepEqual(await checkDesktopBalance({ ...options, preferApi: true }), expected)
  assert.equal((await checkDesktopBalance({})).status, 'missing')
  assert.equal((await checkDesktopBalance({ ...options, preferApi: true, request: async () => new Response('', { status: 401 }) })).status, 'invalid')
})

test('one plugin-owned pet restores visibility, sends quiz events and handles right-click queries', async () => {
  let launches = 0
  let updates = 0
  let balances = 0
  const commands = []
  const helper = Object.assign(new EventEmitter(), {
    stdin: new PassThrough(), stdout: new PassThrough(), exitCode: null, kill() {},
  })
  helper.stdin.on('data', (bytes) => commands.push(bytes.toString()))
  const pet = createDesktopPet({
    dataDir: '/test-attune', supported: true,
    launch: (directory, intent) => {
      assert.equal(directory, '/test-attune')
      assert.equal(intent, 'restore')
      launches++
      return helper
    },
    checkUpdate: async () => {
      updates++
      return { current: '0.3.0', latest: '0.4.0', status: 'available' }
    },
    checkBalance: async () => {
      balances++
      return { status: 'ready', source: 'account', lines: ['充值 ¥4.00'] }
    },
  })
  assert.equal((await pet.wait()).mode, 'off')
  assert.equal(pet.start().mode, 'starting')
  const started = pet.wait(1)
  helper.stdout.write('hidden\n')
  assert.equal((await started).mode, 'hidden')
  pet.setVisibility(true)
  assert.equal(commands.at(-1), 'show\n')
  helper.stdout.write('shown\n')
  assert.equal(launches, 1)
  const quiz = pet.wait(3)
  helper.stdout.write('quiz\nupdate\nupdate\nbalance\nbalance\n')
  assert.equal((await quiz).quiz, 1)
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(updates, 1)
  assert.equal(balances, 1)
  assert.ok(commands.includes('update\tavailable\t0.3.0\t0.4.0\n'))
  assert.ok(commands.includes('balance\tready\taccount\t充值 ¥4.00\n'))

  pet.refreshAppearance()
  pet.setVisibility(false)
  assert.deepEqual(commands.slice(-2), ['appearance\n', 'hide\n'])
  helper.stdout.write('hidden\n')
  assert.equal((await pet.wait()).mode, 'hidden')

  const signal = new AbortController()
  const pending = pet.wait(5, signal.signal)
  signal.abort()
  assert.equal((await pending).revision, 5)
  pet.dispose()
  assert.equal(helper.stdin.writableEnded, true)
})
