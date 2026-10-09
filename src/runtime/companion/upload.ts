// M105 E3 route handler. M104 C binds this after its launch-code exchange;
// this module opens no listener and accepts no browser-supplied file path.
import * as z from 'zod/mini'
import { createHash, timingSafeEqual } from 'node:crypto'
import { chmod, mkdtemp, open, rm } from 'node:fs/promises'
import { createWriteStream } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import path from 'node:path'
import { Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import {
  CHECKPOINT_JOURNAL_FILE_MODE,
  CHECKPOINT_STORAGE_MODE,
  HTTP_STATUS,
  MEDIA_ID_MAX_CHARS,
  MEDIA_MAX_UPLOAD_MIB,
  MEDIA_NAME_MAX_CHARS,
  BYTES_PER_MIB,
  UI_TEXT,
} from '../../shared/constants'
import { fill, formatBytes } from '../../shared/l10n/text'
import { companionMediaUploadSchema, mediaInfoSchema, type MediaInfo } from '../../shared/media'
import { readImageInfo } from '../../core/imageDimensions'
import { isPdf } from '../../core/pdf'
import { sniffMedia, type MediaSource } from '../../core/media/limits'

const headersSchema = z.strictObject({
  host: z.string(),
  origin: z.string(),
  authorization: z.string(),
  custom: z.string(),
  site: z.literal('same-origin'),
  mode: z.literal('cors'),
  dest: z.literal('empty'),
  contentType: z.literal('application/octet-stream'),
  metadata: z.string(),
  cookie: z.optional(z.never()),
  length: z.optional(z.string().check(z.regex(/^\d+$/u))),
})
const metadataSchema = z.strictObject({
  requestId: z.string().check(z.minLength(1), z.maxLength(MEDIA_ID_MAX_CHARS)),
  name: z.string().check(z.minLength(1), z.maxLength(MEDIA_NAME_MAX_CHARS)),
  isScreenRecording: z.boolean(),
})

export interface CompanionUploadOptions {
  /** Exact loopback origin/host and per-window bearer from M104 C. */
  readonly origin: string
  readonly bearer: string
  readonly customHeader: { readonly name: string; readonly value: string }
  readonly metadataHeader: string
  readonly maxBytes: number
  readonly temporaryRoot: string
  /** Window lifetime/deadline and post-stream epoch check, owned by the server. */
  readonly signal: AbortSignal
  readonly isCurrent: () => boolean
  /** Selected-model, format, duration, consent and storage policy; never a permissive default. */
  readonly admit: (
    info: MediaInfo,
    isScreenRecording: boolean,
    signal: AbortSignal,
  ) => Promise<{ readonly ok: true } | { readonly ok: false; readonly reason: string }>
  /** Consume the private source before resolving; only an opaque token returns to the page. */
  readonly consume: (
    source: {
      readonly path: string
      readonly name: string
      readonly requestId: string
      readonly info: MediaInfo
      readonly sha256: string
      readonly isScreenRecording: boolean
    },
    signal: AbortSignal,
  ) => Promise<string>
}

function isEqualBearer(actual: string, expected: string): boolean {
  const left = Buffer.from(actual)
  const right = Buffer.from(`Bearer ${expected}`)
  return left.length === right.length && timingSafeEqual(left, right)
}

function isAuthorized(request: IncomingMessage, options: CompanionUploadOptions): boolean {
  const parsed = headersSchema.safeParse({
    host: request.headers.host,
    origin: request.headers.origin,
    authorization: request.headers.authorization,
    custom: request.headers[options.customHeader.name],
    site: request.headers['sec-fetch-site'],
    mode: request.headers['sec-fetch-mode'],
    dest: request.headers['sec-fetch-dest'],
    contentType: request.headers['content-type'],
    metadata: request.headers[options.metadataHeader],
    cookie: request.headers.cookie,
    length: request.headers['content-length'],
  })
  return (
    parsed.success &&
    parsed.data.host === new URL(options.origin).host &&
    parsed.data.origin === options.origin &&
    isEqualBearer(parsed.data.authorization, options.bearer) &&
    parsed.data.custom === options.customHeader.value &&
    options.isCurrent() &&
    !options.signal.aborted
  )
}

async function inspect(source: MediaSource): Promise<MediaInfo> {
  let head = new Uint8Array()
  const media = await sniffMedia({
    sizeBytes: source.sizeBytes,
    read: async (offset, count) => {
      const bytes = await source.read(offset, count)
      if (offset === 0) head = Uint8Array.from(bytes)
      return bytes
    },
  })
  if (media.ok) return media.info
  const image = readImageInfo(head)
  if (image !== undefined) return { kind: 'image', ...image, sizeBytes: source.sizeBytes }
  if (isPdf(head))
    return { kind: 'document', mediaType: 'application/pdf', sizeBytes: source.sizeBytes }
  throw new Error(fill(UI_TEXT.media.attachmentUnknownType, { type: 'media' }))
}

function reply(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  })
  response.end(JSON.stringify(body))
}

/** Required injected ports are integration seams, not mock production implementations. */
export function companionUpload(
  options: CompanionUploadOptions,
): (request: IncomingMessage, response: ServerResponse) => Promise<void> {
  const origin = new URL(options.origin)
  if (
    origin.protocol !== 'http:' ||
    !['127.0.0.1', '[::1]'].includes(origin.hostname) ||
    origin.origin !== options.origin ||
    options.bearer.length === 0 ||
    !path.isAbsolute(options.temporaryRoot) ||
    !Number.isSafeInteger(options.maxBytes) ||
    options.maxBytes <= 0 ||
    options.maxBytes > MEDIA_MAX_UPLOAD_MIB * BYTES_PER_MIB ||
    !/^x-[a-z0-9-]+$/u.test(options.customHeader.name) ||
    !/^x-[a-z0-9-]+$/u.test(options.metadataHeader) ||
    options.customHeader.name === options.metadataHeader ||
    options.customHeader.value.length === 0
  )
    throw new Error('Invalid companion upload configuration')

  return async (request, response) => {
    if (request.method !== 'POST') {
      reply(response, HTTP_STATUS.methodNotAllowed, {
        reason: fill(UI_TEXT.media.attachmentUnknownType, { type: 'media' }),
      })
      return
    }
    if (!isAuthorized(request, options)) {
      reply(response, HTTP_STATUS.forbidden, {
        reason: fill(UI_TEXT.media.attachmentUnknownType, { type: 'media' }),
      })
      return
    }
    let reason = fill(UI_TEXT.media.attachmentUnknownType, { type: 'media' })
    let status: number = HTTP_STATUS.badRequest
    let body: unknown
    let directory: string | undefined
    const cancelled = new AbortController()
    const signal = AbortSignal.any([options.signal, cancelled.signal])
    const abort = () => {
      cancelled.abort()
    }
    request.once('aborted', abort)
    const closed = () => {
      if (!response.writableFinished) abort()
    }
    response.once('close', closed)
    try {
      const raw = request.headers[options.metadataHeader]
      const metadata = metadataSchema.parse(
        JSON.parse(decodeURIComponent(typeof raw === 'string' ? raw : '')),
      )
      const declared = request.headers['content-length']
      const length = declared === undefined ? undefined : Number(declared)
      if (
        length !== undefined &&
        (!Number.isSafeInteger(length) || length <= 0 || length > options.maxBytes)
      ) {
        reason = fill(UI_TEXT.media.sizeExceeded, { size: formatBytes(options.maxBytes) })
        throw new Error(reason)
      }
      directory = await mkdtemp(path.join(options.temporaryRoot, 'muse-upload-'))
      await chmod(directory, CHECKPOINT_STORAGE_MODE)
      const filePath = path.join(directory, 'media')
      let bytes = 0
      const digest = createHash('sha256')
      const counter = new Transform({
        transform(chunk: Buffer, _encoding, callback) {
          bytes += chunk.length
          if (bytes > options.maxBytes) {
            reason = fill(UI_TEXT.media.sizeExceeded, { size: formatBytes(options.maxBytes) })
            callback(new Error(reason))
            return
          }
          digest.update(chunk)
          callback(null, chunk)
        },
      })
      await pipeline(
        request,
        counter,
        createWriteStream(filePath, { flags: 'wx', mode: CHECKPOINT_JOURNAL_FILE_MODE }),
        { signal },
      )
      if (bytes === 0 || (length !== undefined && bytes !== length))
        throw new Error(fill(UI_TEXT.media.attachmentUnknownType, { type: 'media' }))
      const file = await open(filePath, 'r')
      try {
        const info = mediaInfoSchema.parse(
          await inspect({
            sizeBytes: bytes,
            read: async (offset, count) => {
              const buffer = Buffer.alloc(count)
              const read = await file.read(buffer, 0, count, offset)
              return buffer.subarray(0, read.bytesRead)
            },
          }),
        )
        if (metadata.isScreenRecording && (info.kind !== 'video' || info.mediaType !== 'video/mp4'))
          throw new Error(fill(UI_TEXT.media.attachmentUnknownType, { type: 'media' }))
        if (!options.isCurrent() || signal.aborted) throw new Error(UI_TEXT.media.uploadStop)
        const admission = await options.admit(info, metadata.isScreenRecording, signal)
        if (!admission.ok) {
          reason = admission.reason
          throw new Error(reason)
        }
        signal.throwIfAborted()
        if (!options.isCurrent()) throw new Error(UI_TEXT.media.uploadStop)
        const uploadToken = await options.consume(
          {
            path: filePath,
            ...metadata,
            info,
            sha256: digest.digest('hex'),
          },
          signal,
        )
        signal.throwIfAborted()
        if (!options.isCurrent()) throw new Error(UI_TEXT.media.uploadStop)
        body = companionMediaUploadSchema.parse({
          requestId: metadata.requestId,
          name: metadata.name,
          info,
          uploadToken,
        })
        status = HTTP_STATUS.ok
      } finally {
        await file.close()
      }
    } catch {
      // Do not echo an injected policy/provider exception: it can contain a path or key.
      body = { reason }
    } finally {
      request.off('aborted', abort)
      response.off('close', closed)
      if (directory !== undefined) await rm(directory, { recursive: true, force: true })
    }
    // A completed response transfers lifetime to the caller. Close the read
    // handle and remove the private copy before that caller can tear down its root.
    if (!response.destroyed) reply(response, status, body)
  }
}
