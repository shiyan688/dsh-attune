import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { runInNewContext } from 'node:vm'
import test from 'node:test'
const source = await readFile(new URL('../lib/client.js', import.meta.url), 'utf8')

function prepare({ width = 100, height = 100, readError = false, decodeError = false, large = false } = {}) {
  let client, reads = 0, drawCount = 0
  const canvas = { width: 0, height: 0, getContext: () => ({ clearRect() {}, drawImage() { drawCount++ } }), toDataURL: () => large && canvas.width > 500 ? 'data:image/png;base64,' + 'A'.repeat(800000) : 'data:image/png;base64,AAAA' }
  runInNewContext(source, {
    window: { __ModuleLoader__: { load: ({ factory }) => { client = factory(() => ({ createElement() {} })) } } },
    URL, document: { baseURI: 'https://test.invalid/', createElement: name => { assert.equal(name, 'canvas'); return canvas } },
    FileReader: class { readAsDataURL() { reads++; if (readError) this.onerror(); else { this.result = 'data:image/jpeg;base64,fixture'; this.onload() } } },
    Image: class { constructor() { this.naturalWidth = width; this.naturalHeight = height } set src(_) { if (decodeError) this.onerror(); else this.onload() } },
  })
  return { normalize: file => client.prepareAppearanceImage(file, key => key), canvas, reads: () => reads, draws: () => drawCount }
}
const jpeg = { type: 'image/jpeg', size: 1000 }
test('upload rejects SVG and large input before decoding', async () => {
  const p = prepare()
  await assert.rejects(p.normalize({ type: 'image/svg+xml', size: 100 }), /imageType/)
  await assert.rejects(p.normalize({ type: 'image/png', size: 5 * 1024 * 1024 + 1 }), /imageSize/)
  assert.equal(p.reads(), 0)
})
test('upload normalizes orientation-ready decoded pixels to PNG, bounding dimensions and encoded size', async () => {
  const p = prepare({ width: 2400, height: 1200, large: true })
  assert.match(await p.normalize(jpeg), /^data:image\/png;base64,/)
  assert.equal(p.canvas.width, 432)
  assert.equal(p.canvas.height, 216)
  assert.equal(p.draws(), 3)
})
test('unreadable, malformed and oversized images fail without a usable upload result', async () => {
  await assert.rejects(prepare({ readError: true }).normalize(jpeg), /imageRead/)
  await assert.rejects(prepare({ decodeError: true }).normalize(jpeg), /imageRead/)
  await assert.rejects(prepare({ width: 4097 }).normalize(jpeg), /imageDimensions/)
})
