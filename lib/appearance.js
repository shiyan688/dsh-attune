import { mkdir, readFile, rename, rm, rmdir, stat, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { dirname } from 'node:path'
import { inflateSync } from 'node:zlib'

export const MAX_APPEARANCE_BODY = Math.floor(2.2 * 1024 * 1024)
export const MAX_IMAGE_BYTES = 512 * 1024
export const MAX_IMAGE_DIMENSION = 768
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
const ROLES = ['idle', 'thinking', 'happy']
const EMPTY = () => ({ version: 1, images: {} })
const headers = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }

const crcTable = Uint32Array.from({ length: 256 }, (_, index) => {
  let crc = index
  for (let i = 0; i < 8; i++) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1
  return crc >>> 0
})
function crc32(bytes) {
  let crc = 0xffffffff
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

/** Only bounded, decodable, single-frame PNG pixels leave this boundary.
 * Browsers normalize user-selected files through canvas before submission.
 * Ancillary chunks (including text/EXIF metadata) are dropped before storage.
 */
export function normalizeImage(value) {
  if (typeof value !== 'string' || !value.startsWith('data:image/png;base64,')) throw new Error('请先将形象转换为 PNG 图片')
  const payload = value.slice(22)
  if (payload.length > Math.ceil(MAX_IMAGE_BYTES / 3) * 4 || payload.length % 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(payload)) throw new Error('形象图片编码无效或超过 512 KiB')
  const bytes = Buffer.from(payload, 'base64')
  if (bytes.length > MAX_IMAGE_BYTES || bytes.toString('base64') !== payload || bytes.length < 57 || !bytes.subarray(0, 8).equals(PNG_SIGNATURE)) throw new Error('形象图片不是有效的 PNG')
  let offset = 8, count = 0, width = 0, height = 0, channels = 0, ended = false, idatEnded = false
  const retained = [PNG_SIGNATURE], compressed = []
  while (offset < bytes.length) {
    if (++count > 2000 || offset + 12 > bytes.length) throw new Error('PNG 图片数据不完整')
    const length = bytes.readUInt32BE(offset)
    if (offset + length + 12 > bytes.length) throw new Error('PNG 图片数据不完整')
    const type = bytes.toString('ascii', offset + 4, offset + 8)
    const chunk = bytes.subarray(offset, offset + length + 12)
    const data = bytes.subarray(offset + 8, offset + 8 + length)
    if (!/^[A-Za-z]{4}$/.test(type) || crc32(bytes.subarray(offset + 4, offset + 8 + length)) !== bytes.readUInt32BE(offset + 8 + length)) throw new Error('PNG 图片校验失败，请重新选择图片')
    if (count === 1 && type !== 'IHDR') throw new Error('PNG 图片缺少尺寸信息')
    if (type === 'IHDR') {
      if (count !== 1 || length !== 13) throw new Error('PNG 图片头无效')
      width = data.readUInt32BE(0); height = data.readUInt32BE(4)
      channels = ({ 0: 1, 2: 3, 4: 2, 6: 4 })[data[9]] ?? 0
      if (width < 1 || height < 1 || width > MAX_IMAGE_DIMENSION || height > MAX_IMAGE_DIMENSION) throw new Error('形象图片尺寸须在 1～768 像素之间')
      if (data[8] !== 8 || !channels || data[10] !== 0 || data[11] !== 0 || data[12] !== 0) throw new Error('请通过形象上传入口转换这张图片')
      retained.push(chunk)
    } else if (type === 'IDAT') {
      if (idatEnded) throw new Error('PNG 图像数据顺序无效')
      compressed.push(data); retained.push(chunk)
    } else if (type === 'IEND') {
      if (length !== 0 || compressed.length === 0 || offset + 12 !== bytes.length) throw new Error('PNG 图片结尾无效')
      retained.push(chunk); ended = true
    } else {
      if (['acTL', 'fcTL', 'fdAT'].includes(type) || type[0] === type[0].toUpperCase()) throw new Error('请通过形象上传入口转换为静态 PNG')
      if (compressed.length) idatEnded = true
    }
    offset += length + 12
  }
  if (!ended) throw new Error('PNG 图片没有完整结束')
  const stride = width * channels + 1, expected = stride * height
  let pixels
  try { pixels = inflateSync(Buffer.concat(compressed), { maxOutputLength: expected }) } catch { throw new Error('PNG 像素数据无法读取') }
  if (pixels.length !== expected) throw new Error('PNG 像素长度与尺寸不符')
  for (let row = 0; row < height; row++) if (pixels[row * stride] > 4) throw new Error('PNG 像素过滤器无效')
  return 'data:image/png;base64,' + Buffer.concat(retained).toString('base64')
}

export function normalizeAppearance(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('形象设置格式无效')
  if (Object.keys(value).some(key => !['version', 'images', 'reset'].includes(key))) throw new Error('形象设置包含未知字段')
  if (value.version !== undefined && value.version !== 1) throw new Error('形象设置版本不受支持')
  if (Object.hasOwn(value, 'reset')) {
    if (value.reset !== true || Object.hasOwn(value, 'images')) throw new Error('恢复默认不能同时上传图片')
    return EMPTY()
  }
  const images = value.images
  if (!images || typeof images !== 'object' || Array.isArray(images) || Object.keys(images).some(key => !ROLES.includes(key))) throw new Error('请提供待机、思考或开心形象')
  if (!images.idle && Object.keys(images).length) throw new Error('请先上传待机形象')
  const result = EMPTY()
  for (const role of ROLES) if (Object.hasOwn(images, role)) result.images[role] = normalizeImage(images[role])
  return result
}

/** Separate from preferences so image bytes never reach the model or state API. */
export function createAppearanceStore({ filePath }) {
  if (typeof filePath !== 'string' || !filePath.trim()) throw new Error('需要形象档案路径')
  const lockPath = filePath + '.lock'
  async function get() {
    try {
      const info = await stat(filePath)
      if (info.size > MAX_APPEARANCE_BODY) throw new Error('已保存的形象档案过大')
      return normalizeAppearance(JSON.parse(await readFile(filePath, 'utf8')))
    } catch (error) {
      if (error?.code === 'ENOENT') return EMPTY()
      throw error
    }
  }
  async function set(value) {
    const next = normalizeAppearance(value)
    await mkdir(dirname(filePath), { recursive: true })
    const deadline = Date.now() + 6000
    for (;;) {
      try { await mkdir(lockPath); break } catch (error) { if (error?.code !== 'EEXIST') throw error }
      const info = await stat(lockPath).catch(() => null)
      if (info && Date.now() - info.mtimeMs > 120000) await rmdir(lockPath).catch(() => {})
      if (Date.now() > deadline) throw new Error('形象正在保存，请稍后再试')
      await new Promise(resolve => setTimeout(resolve, 25))
    }
    const temp = filePath + '.' + randomUUID() + '.tmp'
    try {
      await writeFile(temp, JSON.stringify(next), { encoding: 'utf8', mode: 0o600, flag: 'wx' })
      await rename(temp, filePath)
      return next
    } finally {
      await rm(temp, { force: true }).catch(() => {})
      await rmdir(lockPath).catch(() => {})
    }
  }
  return { get, set }
}

async function requestBody(request) {
  if (!/^application\/json(?:\s*;|\s*$)/i.test(request.headers.get('content-type') ?? '')) throw new Error('请使用 JSON 上传形象')
  let size = 0; const chunks = []
  if (request.body) for await (const chunk of request.body) {
    size += chunk.byteLength
    if (size > MAX_APPEARANCE_BODY) throw new Error('形象上传总大小超过限制')
    chunks.push(chunk)
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')) } catch { throw new Error('形象设置不是有效 JSON') }
}

export function registerAppearanceApi(ctx, store, onSaved) {
  if (typeof ctx.inject !== 'function') return
  ctx.inject(['connection'], (owner) => {
    const registry = owner.connection?.fetch
    if (typeof registry?.register !== 'function') return
    // Connection owns one route per path. Its streaming bridge supplies a body,
    // which Fetch forbids on GET, so the bounded upload uses a distinct URL.
    for (const method of ['GET', 'POST']) owner.effect(() => registry.register({
      path: '/api/attune/appearance' + (method === 'POST' ? '/save' : ''),
      methods: [method], requestBody: method === 'GET' ? 'buffered' : 'streaming',
      fetch: async (request) => {
        try {
          if (!['GET', 'POST'].includes(request.method)) return new Response(JSON.stringify({ error: '不支持的操作' }), { status: 405, headers })
          const result = request.method === 'GET' ? await store.get() : await store.set(await requestBody(request))
          if (request.method === 'POST') onSaved?.()
          return new Response(JSON.stringify(result), { status: 200, headers })
        } catch (error) {
          return new Response(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }), { status: 400, headers })
        }
      },
    }))
  })
}
