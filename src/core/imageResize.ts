import path from 'node:path'
import { Worker } from 'node:worker_threads'
import * as z from 'zod/mini'
import {
  IMAGE_RESIZE_TIMEOUT_MS,
  IMAGE_RESIZE_MAX_MEMORY_MIB,
  MAX_IMAGE_BYTES,
  MAX_ATTACHMENTS_PER_MESSAGE,
} from '../shared/constants'
import { readImageInfo } from './imageDimensions'

/** Documented per-model pixel bounds, supplied by its capability record. */
export const imageLimitsSchema = z.object({
  maxWidth: z.int().check(z.positive()),
  maxHeight: z.int().check(z.positive()),
})
export type ImageLimits = z.infer<typeof imageLimitsSchema>
export const resizeJobSchema = z.object({
  bytes: z.instanceof(Uint8Array),
  limits: imageLimitsSchema,
})
const answerSchema = z.union([
  z.object({ ok: z.literal(true), bytes: z.instanceof(Uint8Array) }),
  z.object({ ok: z.literal(false) }),
])

const slots: { queued: number; previous: Promise<unknown> } = {
  queued: 0,
  previous: Promise.resolve(),
}

/** One bounded worker at a time; no codec or native library enters activation. */
export async function resizeImage(
  bytes: Uint8Array,
  limits: ImageLimits,
  signal: AbortSignal,
  workerPath = path.join(__dirname, 'imageResizeWorker.js'),
): Promise<Uint8Array> {
  signal.throwIfAborted()
  const bounds = imageLimitsSchema.parse(limits)
  const info = readImageInfo(bytes)
  if (
    info === undefined ||
    bytes.byteLength > MAX_IMAGE_BYTES ||
    info.width < 1 ||
    info.height < 1
  ) {
    throw new Error('image_resize_invalid_input')
  }
  if (info.width <= bounds.maxWidth && info.height <= bounds.maxHeight) return bytes
  if (slots.queued >= MAX_ATTACHMENTS_PER_MESSAGE) throw new Error('image_resize_queue_full')
  slots.queued += 1
  const before = slots.previous
  const result = (async () => {
    await before
    try {
      signal.throwIfAborted()
      return await new Promise<Uint8Array>((resolve, reject) => {
        const worker = new Worker(workerPath, {
          workerData: { bytes, limits: bounds },
          resourceLimits: { maxOldGenerationSizeMb: IMAGE_RESIZE_MAX_MEMORY_MIB },
        })
        let isSettled = false
        const stop = (finish: () => void) => {
          if (isSettled) return
          isSettled = true
          clearTimeout(timer)
          signal.removeEventListener('abort', abort)
          void (async () => {
            try {
              await worker.terminate()
            } catch {
              /* An already exited worker needs no further cleanup. */
            }
            finish()
          })()
        }
        const fail = () => {
          stop(() => {
            reject(new Error('image_resize_failed'))
          })
        }
        const abort = () => {
          stop(() => {
            reject(
              signal.reason instanceof Error ? signal.reason : new Error('image_resize_aborted'),
            )
          })
        }
        const timer = setTimeout(fail, IMAGE_RESIZE_TIMEOUT_MS)
        signal.addEventListener('abort', abort, { once: true })
        worker.once('error', fail)
        worker.once('exit', (code) => {
          if (code !== 0) fail()
        })
        worker.once('message', (message: unknown) => {
          const parsed = z.safeParse(answerSchema, message)
          const output = parsed.success && parsed.data.ok ? parsed.data.bytes : undefined
          const resized = output === undefined ? undefined : readImageInfo(output)
          if (
            output === undefined ||
            resized === undefined ||
            output.byteLength > MAX_IMAGE_BYTES ||
            resized.mediaType !== info.mediaType ||
            resized.width > bounds.maxWidth ||
            resized.height > bounds.maxHeight ||
            resized.width > info.width ||
            resized.height > info.height ||
            resized.width < 1 ||
            resized.height < 1
          ) {
            fail()
            return
          }
          stop(() => {
            resolve(output)
          })
        })
        if (signal.aborted) abort()
      })
    } finally {
      slots.queued -= 1
    }
  })()
  slots.previous = (async () => {
    try {
      await result
    } catch {
      /* A failed conversion must release the next queue slot. */
    }
  })()
  const resized = await result
  signal.throwIfAborted()
  return resized
}
