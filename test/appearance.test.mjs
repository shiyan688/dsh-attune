import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { join, resolve, sep } from 'node:path'
import { deflateSync } from 'node:zlib'
import { createAppearanceStore, normalizeAppearance, normalizeImage, registerAppearanceApi, MAX_APPEARANCE_BODY, MAX_IMAGE_BYTES } from '../lib/appearance.js'

function chunk(type, data = Buffer.alloc(0)) {
  const name = Buffer.from(type), result = Buffer.alloc(data.length + 12)
  result.writeUInt32BE(data.length); name.copy(result, 4); data.copy(result, 8)
  let crc = 0xffffffff
  for (const byte of Buffer.concat([name, data])) {
    crc ^= byte
    for (let i = 0; i < 8; i++) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1
  }
  result.writeUInt32BE((crc ^ 0xffffffff) >>> 0, result.length - 4)
  return result
}

function image({ width = 1, height = 1, color = 255, extra = [], pixels } = {}) {
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 6
  const rows = pixels ?? Buffer.alloc((width * 4 + 1) * height, color)
  if (!pixels) for (let row = 0; row < height; row++) rows[row * (width * 4 + 1)] = 0
  return 'data:image/png;base64,' + Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), ...extra,
    chunk('IDAT', deflateSync(rows)), chunk('IEND'),
  ]).toString('base64')
}

const idle = image(), thinking = image({ color: 100 }), happy = image({ color: 200 })

test('uploaded appearance persists across store instances and reset restores empty default', async t => {
  const dir = await mkdtemp(join(resolve('test'), 'tmp-appearance-'))
  assert.ok(resolve(dir).startsWith(resolve('test') + sep))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const filePath = join(dir, 'appearance.json'), store = createAppearanceStore({ filePath })
  assert.deepEqual(await store.get(), { version: 1, images: {} })
  const value = { version: 1, images: { idle, thinking, happy } }
  assert.deepEqual(await store.set(value), value)
  assert.deepEqual(await createAppearanceStore({ filePath }).get(), value)
  await assert.rejects(store.set({ images: { idle: 'not an image' } }))
  assert.deepEqual(await store.get(), value, 'a bad update preserves the current skin')
  assert.deepEqual(await store.set({ reset: true }), { version: 1, images: {} })
  assert.deepEqual(await createAppearanceStore({ filePath }).get(), { version: 1, images: {} })
  assert.deepEqual(await readdir(dir), ['appearance.json'])
})

test('appearance schema only accepts bounded PNG roles and requires idle for optional expressions', () => {
  for (const value of [null, [], {}, { images: [] }, { images: { happy } }, { images: { idle, '../../state.json': happy } }, { images: { idle }, path: '../state.json' }, { reset: true, images: {} }, { reset: false }, { version: 2, images: { idle } }]) {
    assert.throws(() => normalizeAppearance(value))
  }
  assert.deepEqual(normalizeAppearance({ images: { idle } }), { version: 1, images: { idle } })
  for (const value of [
    'https://example.test/character.png', 'data:image/svg+xml;base64,PHN2Zy8+',
    'data:image/png;base64,SGVsbG8=', idle + '\n',
    'data:image/png;base64,' + Buffer.alloc(MAX_IMAGE_BYTES + 1).toString('base64'),
  ]) assert.throws(() => normalizeImage(value))
})

test('PNG validation rejects corrupt, truncated, oversized or animated pixel data and strips metadata', () => {
  assert.throws(() => normalizeImage(image({ width: 769 })), /尺寸/u)
  assert.throws(() => normalizeImage(image({ pixels: Buffer.alloc(10000) })), /像素/u)
  assert.throws(() => normalizeImage(image({ pixels: Buffer.from([5, 0, 0, 0, 0]) })), /过滤器/u)
  assert.throws(() => normalizeImage(image({ extra: [chunk('acTL', Buffer.alloc(8))] })), /静态/u)
  const bytes = Buffer.from(idle.slice(22), 'base64')
  bytes[20] ^= 1
  assert.throws(() => normalizeImage('data:image/png;base64,' + bytes.toString('base64')), /校验/u)
  assert.throws(() => normalizeImage(idle.slice(0, -4)))
  const annotated = image({ extra: [chunk('tEXt', Buffer.from('Author\0my private name'))] })
  assert.equal(normalizeImage(annotated), idle)
  assert.equal(normalizeImage(image({ width: 768, height: 768 })).startsWith('data:image/png;base64,'), true)
})

test('concurrent stores leave one complete skin and do not touch the preference file', async t => {
  const dir = await mkdtemp(join(resolve('test'), 'tmp-appearance-concurrent-'))
  assert.ok(resolve(dir).startsWith(resolve('test') + sep))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const statePath = join(dir, 'state.json'), filePath = join(dir, 'appearance.json')
  await writeFile(statePath, '{"rules":[]}')
  const first = createAppearanceStore({ filePath }), second = createAppearanceStore({ filePath })
  await Promise.all([first.set({ images: { idle } }), second.set({ images: { idle: thinking, happy } })])
  const final = await first.get()
  assert.ok([idle, thinking].includes(final.images.idle))
  assert.equal(await readFile(statePath, 'utf8'), '{"rules":[]}')
  assert.equal((await readdir(dir)).some(name => name.endsWith('.tmp') || name.endsWith('.lock')), false)
})

test('appearance route uses Connection admission, supports GET and POST, and bounds the larger body separately', async () => {
  const entries = []
  let value = { version: 1, images: {} }, sets = 0
  registerAppearanceApi({ inject(names, callback) {
    assert.deepEqual(names, ['connection'])
    callback({ effect: fn => fn(), connection: { fetch: { register(route) { entries.push(route); return () => {} } } } })
  } }, { get: async () => value, set: async body => { sets++; return value = normalizeAppearance(body) } })
  const [read, entry] = entries
  assert.equal(entries.length, 2)
  assert.equal(read.path, '/api/attune/appearance')
  assert.deepEqual(read.methods, ['GET'])
  assert.equal(read.requestBody, 'buffered', 'GET must not receive a streaming Request body from the Host bridge')
  assert.equal(entry.path, '/api/attune/appearance/save')
  assert.deepEqual(entry.methods, ['POST'])
  assert.equal(entry.requestBody, 'streaming')
  const request = (body, contentType = 'application/json', method = 'POST') => new Request('https://dsh.example/api/attune/appearance/save', { method, headers: { 'content-type': contentType }, body })
  const posted = await entry.fetch(request(JSON.stringify({ images: { idle } })))
  assert.equal(posted.status, 200)
  assert.equal(posted.headers.get('cache-control'), 'no-store')
  assert.deepEqual(await posted.json(), { version: 1, images: { idle } })
  const get = await read.fetch(new Request('https://dsh.example/api/attune/appearance'))
  assert.deepEqual(await get.json(), { version: 1, images: { idle } })
  assert.equal((await entry.fetch(request('x'.repeat(MAX_APPEARANCE_BODY + 1)))).status, 400)
  assert.equal((await entry.fetch(request('{}', 'text/plain'))).status, 400)
  assert.equal((await entry.fetch(request('{bad'))).status, 400)
  assert.equal(sets, 1, 'invalid envelopes must not invoke storage')
  assert.deepEqual(await (await entry.fetch(request('{"reset":true}'))).json(), { version: 1, images: {} })
})
