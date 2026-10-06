import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import { inflateSync } from 'node:zlib'
import pixelmatch from '../../vendor/pixelmatch/index.js'

export const digest = (bytes) => createHash('sha256').update(bytes).digest('hex')
export const ARCHIVE_BUDGET = 512 * 1024 * 1024
export const PIXEL_POLICY = Object.freeze({ threshold: 0, includeAA: true, maxChangedPixels: 0 })
const SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])

function pngPredictor(filter, left, above, corner) {
  switch (filter) {
    case 1: {
      return left
    }
    case 2: {
      return above
    }
    case 3: {
      return Math.floor((left + above) / 2)
    }
    case 4: {
      const prediction = left + above - corner
      const leftDistance = Math.abs(prediction - left)
      const aboveDistance = Math.abs(prediction - above)
      const cornerDistance = Math.abs(prediction - corner)
      if (leftDistance <= aboveDistance && leftDistance <= cornerDistance) return left
      return aboveDistance <= cornerDistance ? above : corner
    }
    default: {
      return 0
    }
  }
}

/** Decode the bounded, non-interlaced 8-bit RGB/RGBA PNGs Chromium emits. */
export function decodePng(bytes, width, height) {
  if (!bytes.subarray(0, 8).equals(SIGNATURE) || bytes.toString('ascii', 12, 16) !== 'IHDR') {
    throw new Error('Invalid PNG header')
  }
  if (bytes.readUInt32BE(16) !== width || bytes.readUInt32BE(20) !== height) {
    throw new Error('PNG dimensions differ from the manifest')
  }
  const channels = { 6: 4, 2: 3 }[bytes[25]] ?? 0
  if (channels === 0 || bytes[24] !== 8 || bytes[26] !== 0 || bytes[27] !== 0 || bytes[28] !== 0) {
    throw new Error('Unsupported PNG encoding')
  }
  const chunks = []
  let isEnded = false
  for (let offset = 8; offset + 12 <= bytes.length;) {
    const length = bytes.readUInt32BE(offset)
    if (offset + length + 12 > bytes.length) throw new Error('Truncated PNG chunk')
    const kind = bytes.toString('ascii', offset + 4, offset + 8)
    if (kind === 'IDAT') chunks.push(bytes.subarray(offset + 8, offset + 8 + length))
    else if (kind === 'IEND') {
      isEnded = true
      break
    }
    offset += length + 12
  }
  if (!isEnded || chunks.length === 0) throw new Error('Incomplete PNG')
  const stride = width * channels
  const raw = inflateSync(Buffer.concat(chunks), { maxOutputLength: (stride + 1) * height })
  if (raw.length !== (stride + 1) * height) throw new Error('Invalid PNG data size')
  const decoded = Buffer.alloc(stride * height)
  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (stride + 1)]
    if (filter > 4) throw new Error('Invalid PNG filter')
    for (let x = 0; x < stride; x += 1) {
      const index = y * stride + x
      const left = x >= channels ? decoded[index - channels] : 0
      const above = y > 0 ? decoded[index - stride] : 0
      const corner = y > 0 && x >= channels ? decoded[index - stride - channels] : 0
      const predictor = pngPredictor(filter, left, above, corner)
      decoded[index] = (raw[y * (stride + 1) + x + 1] + predictor) & 255
    }
  }
  if (channels === 4) return decoded
  const rgba = Buffer.alloc(width * height * 4, 255)
  for (let index = 0; index < width * height; index += 1)
    decoded.copy(rgba, index * 4, index * 3, index * 3 + 3)
  return rgba
}

export function comparePixels(before, after, width, height) {
  const changed = pixelmatch(before, after, null, width, height, PIXEL_POLICY)
  if (changed > PIXEL_POLICY.maxChangedPixels)
    throw new Error(`Visual regression: ${changed} changed pixel(s)`)
  return changed
}

export function verifyCaptureBytes(bytes, capture) {
  if (bytes.length !== capture.bytes || digest(bytes) !== capture.sha256)
    throw new Error(`Baseline integrity mismatch: ${capture.file}`)
}

export function verifyCapture(bytes, capture) {
  verifyCaptureBytes(bytes, capture)
  return decodePng(bytes, capture.width, capture.height)
}
