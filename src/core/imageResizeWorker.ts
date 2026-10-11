// Pure JS raster codecs run only in this disposable, bounded worker.
import { parentPort, workerData } from 'node:worker_threads'
import { Buffer } from 'node:buffer'
import { inflateSync } from 'node:zlib'
import { PNG } from 'pngjs'
import jpeg from 'jpeg-js'
import { resizeJobSchema } from './imageResize'
import { readImageInfo } from './imageDimensions'
import {
  IMAGE_RESIZE_MAX_PIXELS,
  IMAGE_RESIZE_MAX_MEMORY_MIB,
  IMAGE_RESIZE_RGBA_CHANNELS,
  IMAGE_RESIZE_JPEG_QUALITY,
  IMAGE_RESIZE_PNG_MAX_BYTES_PER_PIXEL,
  PNG_CHUNK_HEADER_BYTES,
  PNG_CHUNK_CRC_BYTES,
  PNG_SIGNATURE_BYTES,
  PIXELS_PER_MEGAPIXEL,
} from '../shared/constants'
import * as z from 'zod/mini'

function resize(): Uint8Array {
  const job = z.safeParse(resizeJobSchema, workerData)
  if (!job.success) throw new Error('image_resize_invalid_job')
  const { bytes, limits } = job.data
  const info = readImageInfo(bytes)
  if (
    info === undefined ||
    info.width < 1 ||
    info.height < 1 ||
    info.width * info.height > IMAGE_RESIZE_MAX_PIXELS
  )
    throw new Error('image_resize_pixel_limit')
  const input = Buffer.from(bytes)
  if (info.mediaType === 'image/png') {
    // Bound even interlaced PNG inflation before pngjs's synchronous parser.
    const idat: Buffer[] = []
    for (let offset = PNG_SIGNATURE_BYTES; offset < input.length;) {
      const size = input.readUInt32BE(offset)
      const start = offset + PNG_CHUNK_HEADER_BYTES
      const end = start + size
      if (end + PNG_CHUNK_CRC_BYTES > input.length) throw new Error('image_resize_invalid_png')
      if (input.toString('ascii', offset + PNG_CHUNK_CRC_BYTES, start) === 'IDAT')
        idat.push(input.subarray(start, end))
      offset = end + PNG_CHUNK_CRC_BYTES
    }
    inflateSync(Buffer.concat(idat), {
      maxOutputLength:
        (info.width * info.height + info.width + info.height) *
        IMAGE_RESIZE_PNG_MAX_BYTES_PER_PIXEL,
    })
  } else if (info.mediaType !== 'image/jpeg') throw new Error('image_resize_unsupported_format')
  const decoded =
    info.mediaType === 'image/png'
      ? PNG.sync.read(input, { checkCRC: true })
      : jpeg.decode(input, {
          useTArray: true,
          tolerantDecoding: false,
          maxResolutionInMP: IMAGE_RESIZE_MAX_PIXELS / PIXELS_PER_MEGAPIXEL,
          maxMemoryUsageInMB: IMAGE_RESIZE_MAX_MEMORY_MIB,
        })
  if (decoded.width !== info.width || decoded.height !== info.height)
    throw new Error('image_resize_dimension_mismatch')
  const ratio = Math.min(1, limits.maxWidth / info.width, limits.maxHeight / info.height)
  const width = Math.max(1, Math.floor(info.width * ratio))
  const height = Math.max(1, Math.floor(info.height * ratio))
  const output = new PNG({ width, height })
  const data = output.data
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const source =
        (Math.floor(y / ratio) * info.width + Math.floor(x / ratio)) * IMAGE_RESIZE_RGBA_CHANNELS
      const target = (y * width + x) * IMAGE_RESIZE_RGBA_CHANNELS
      for (let c = 0; c < IMAGE_RESIZE_RGBA_CHANNELS; c += 1)
        data[target + c] = decoded.data[source + c] ?? 0
    }
  }
  return info.mediaType === 'image/png'
    ? PNG.sync.write(output)
    : jpeg.encode({ width, height, data }, IMAGE_RESIZE_JPEG_QUALITY).data
}

try {
  parentPort?.postMessage({ ok: true, bytes: resize() })
} catch {
  parentPort?.postMessage({ ok: false })
}
