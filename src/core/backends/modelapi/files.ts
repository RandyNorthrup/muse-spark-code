// U6's Files wire (2026-10-05), now speaking three provider dialects by the
// model's capability record, never by a vendor's name (OPENAI-G15,
// GAPANTH-G16). The caller supplies an approved, confined stream; neither
// this module nor its upload references retain source bytes.
import { createHash, randomUUID } from 'node:crypto'
import * as z from 'zod/mini'
import {
  ANTHROPIC_FILE_EXPIRY_MAX_S,
  MEDIA_FILE_EXPIRY_DEFAULT_S,
  MEDIA_FILE_EXPIRY_MIN_S,
  MEDIA_FILE_EXPIRY_MAX_S,
  MEDIA_NAME_MAX_CHARS,
  MEDIA_MAX_UPLOAD_DEFAULT_MIB,
  BYTES_PER_MIB,
  MILLISECONDS_PER_SECOND,
  MODEL_API_REQUEST_TIMEOUT_MS,
  UI_TEXT,
} from '../../../shared/constants'
import { fill } from '../../../shared/l10n/text'
import { uploadedMediaRefSchema, type UploadedMediaRef } from '../../../shared/media'
import type { ModelApiClient } from './client'
import type { ModelCapabilityRecord } from '../../providers/capabilityRecord'

/**
 * The upload/receipt dialect, taken from the model's files capability
 * (`wireForFiles`), never from a vendor's name. Every shape below is the
 * provider's documented one, UNVERIFIED until the capture plan's requests
 * confirm it.
 */
export type FilesWire = 'meta-files' | 'openai-files' | 'anthropic-files'

/** The files capability's upload dialect, or undefined when uploads stay off. */
export function wireForFiles(record: ModelCapabilityRecord): FilesWire | undefined {
  return record.files.upload.state === 'yes' ? record.files.upload.value.wire : undefined
}

const metaFileId = z.string().check(z.regex(/^file-[A-Za-z0-9_-]+$/u))
const anthropicFileId = z.string().check(z.regex(/^file_[A-Za-z0-9_-]+$/u))
function fileIdFor(wire: FilesWire) {
  return wire === 'anthropic-files' ? anthropicFileId : metaFileId
}
const fileBase = {
  id: metaFileId,
  object: z.literal('file'),
  bytes: z.int().check(z.gte(0)),
  created_at: z.int().check(z.gt(0)),
  filename: z.string(),
  purpose: z.string(),
}
// Account listings also contain inline media saved by the server without expiry (round 2).
const fileSchema = z.object({
  ...fileBase,
  expires_at: z.optional(z.int().check(z.gt(0))),
  status: z.string(),
})
const openAiFileSchema = z.object({ ...fileBase })
const anthropicFileSchema = z.object({
  id: anthropicFileId,
  type: z.literal('file'),
  filename: z.string(),
  mime_type: z.string(),
  size_bytes: z.int().check(z.gte(0)),
  created_at: z.string(),
  downloadable: z.boolean(),
  expires_at: z.nullable(z.string()),
})
function recordSchemaFor(wire: FilesWire) {
  if (wire === 'anthropic-files') return anthropicFileSchema
  return wire === 'openai-files' ? openAiFileSchema : fileSchema
}
function listSchemaFor(wire: FilesWire) {
  // has_more and its cursor are optional: a provider whose list shape the
  // captures have not settled yet reads as one page (OPENAI-G15, GAPANTH-G16).
  return z.object({
    ...(wire !== 'anthropic-files' && { object: z.literal('list') }),
    data: z.array(recordSchemaFor(wire)),
    has_more: z.optional(z.boolean()),
    last_id: z.optional(fileIdFor(wire)),
  })
}
function deletionSchemaFor(wire: FilesWire) {
  return wire === 'anthropic-files'
    ? z.object({ id: anthropicFileId, type: z.literal('file'), deleted: z.literal(true) })
    : z.object({ id: metaFileId, object: z.literal('file'), deleted: z.literal(true) })
}
export type ProviderFile = z.infer<typeof fileSchema>
export type OpenAiProviderFile = z.infer<typeof openAiFileSchema>
export type AnthropicProviderFile = z.infer<typeof anthropicFileSchema>

/** Open a fresh bounded disk stream each time, after confinement and approval. */
export interface UploadSource {
  readonly name: string
  readonly mime: string
  readonly bytes: number
  open(signal: AbortSignal): AsyncIterable<Uint8Array>
}

export interface FilesApiDeps {
  readonly client: Pick<ModelApiClient, 'requestFile'>
  readonly provider: string
  /**
   * The upload dialect from the model's files capability (`wireForFiles`).
   * Absent stays Meta's exact U6 bytes, so today's behavior is unchanged.
   */
  readonly wire?: FilesWire
  /**
   * The provider's upload purpose for the OpenAI dialect (UNVERIFIED which
   * values each provider accepts; the capture plan's O1/X1 settle it).
   */
  readonly uploadPurpose?: string
  /** U6c's storage decision and any necessary paid admission, supplied by the owner. */
  readonly authorizeUpload: (
    signal: AbortSignal,
    storage: { readonly bytes: number; readonly expirySeconds: number; readonly provider: string },
  ) => Promise<void>
  readonly maxBytes?: number
  readonly expirySeconds?: number
  readonly expectedAccountId?: string
}

export interface UploadFields {
  readonly name: string
  readonly mime: string
  readonly expirySeconds: number
  readonly purpose?: string
}

/**
 * The exact multipart head a dialect sends (pure: given the same fields it
 * returns the same bytes). Meta carries its expiring purpose; OpenAI carries
 * `file` plus `purpose`; Anthropic carries `file` with `expires_in_seconds`.
 */
export function buildUploadPrefix(
  wire: FilesWire,
  boundary: string,
  fields: UploadFields,
): Uint8Array {
  const encoder = new TextEncoder()
  const quotedName = fields.name.replaceAll('"', '%22')
  const fileHead = `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${quotedName}"\r\nContent-Type: ${fields.mime}\r\n\r\n`
  if (wire === 'openai-files') {
    const purpose = fields.purpose ?? ''
    if (purpose.length === 0) throw new Error('Invalid upload purpose')
    return encoder.encode(
      `--${boundary}\r\nContent-Disposition: form-data; name="purpose"\r\n\r\n${purpose}\r\n` +
        fileHead,
    )
  }
  const tail =
    wire === 'anthropic-files'
      ? fileHead +
        `--${boundary}\r\nContent-Disposition: form-data; name="expires_in_seconds"\r\n\r\n${String(fields.expirySeconds)}\r\n`
      : `--${boundary}\r\nContent-Disposition: form-data; name="purpose"\r\n\r\nuser_data\r\n` +
        `--${boundary}\r\nContent-Disposition: form-data; name="expires_after[anchor]"\r\n\r\ncreated_at\r\n` +
        `--${boundary}\r\nContent-Disposition: form-data; name="expires_after[seconds]"\r\n\r\n${String(fields.expirySeconds)}\r\n` +
        fileHead
  return encoder.encode(tail)
}

function buildUploadSuffix(boundary: string): Uint8Array {
  return new TextEncoder().encode(`\r\n--${boundary}--\r\n`)
}

export interface NormalizedReceipt {
  readonly fileId: string
  readonly bytes: number
  readonly expiresAt?: number
}

function epochSeconds(value: string): number {
  const millis = Date.parse(value)
  if (!Number.isFinite(millis) || millis <= 0) throw new Error('Invalid upload receipt')
  return Math.floor(millis / MILLISECONDS_PER_SECOND)
}

/**
 * The provider's upload answer as our normalized receipt (pure). Meta's
 * expiry must fall inside the sent window; OpenAI keeps the file with no
 * expiry; Anthropic's RFC 3339 stamps convert to epoch seconds.
 */
export function parseUploadReceipt(
  wire: FilesWire,
  raw: unknown,
  sent: { readonly bytes: number; readonly expirySeconds: number },
): NormalizedReceipt {
  const identity = z.object({ id: fileIdFor(wire) }).safeParse(raw)
  if (!identity.success) throw new Error('Invalid upload receipt')
  if (wire === 'anthropic-files') {
    const created = anthropicFileSchema.parse(raw)
    if (created.size_bytes !== sent.bytes) throw new Error('Invalid upload receipt')
    const createdAt = epochSeconds(created.created_at)
    if (created.expires_at === null) return { fileId: created.id, bytes: created.size_bytes }
    const expiresAt = epochSeconds(created.expires_at)
    if (expiresAt <= createdAt || expiresAt - createdAt > sent.expirySeconds)
      throw new Error('Invalid upload receipt')
    return { fileId: created.id, bytes: created.size_bytes, expiresAt }
  }
  if (wire === 'openai-files') {
    const created = openAiFileSchema.parse(raw)
    if (created.bytes !== sent.bytes) throw new Error('Invalid upload receipt')
    return { fileId: created.id, bytes: created.bytes }
  }
  const created = fileSchema.parse(raw)
  if (
    created.bytes !== sent.bytes ||
    created.expires_at === undefined ||
    created.expires_at <= created.created_at ||
    created.expires_at - created.created_at > sent.expirySeconds
  ) {
    throw new Error('Invalid upload receipt')
  }
  return { fileId: created.id, bytes: created.bytes, expiresAt: created.expires_at }
}

export class FilesApi {
  public constructor(private readonly deps: FilesApiDeps) {}

  /** Bind every request at final dispatch to the ledger's key digest. */
  public forAccount(accountId: string): FilesApi {
    return new FilesApi({ ...this.deps, expectedAccountId: accountId })
  }

  public async upload(
    source: UploadSource,
    signal: AbortSignal,
    onProgress?: (uploaded: number, total: number) => void,
    expectedSha256?: string,
  ): Promise<UploadedMediaRef> {
    signal.throwIfAborted()
    const wire = this.deps.wire ?? 'meta-files'
    const expiry = this.deps.expirySeconds ?? MEDIA_FILE_EXPIRY_DEFAULT_S
    // Anthropic documents 3600 to 7776000 seconds; Meta keeps its own
    // window; the OpenAI dialect sends no expiry at all.
    const expiryMax =
      wire === 'anthropic-files' ? ANTHROPIC_FILE_EXPIRY_MAX_S : MEDIA_FILE_EXPIRY_MAX_S
    if (
      !Number.isSafeInteger(expiry) ||
      expiry < MEDIA_FILE_EXPIRY_MIN_S ||
      (wire !== 'openai-files' && expiry > expiryMax)
    ) {
      throw new Error('Invalid upload expiry')
    }
    if (
      !Number.isSafeInteger(source.bytes) ||
      source.bytes < 0 ||
      source.bytes > (this.deps.maxBytes ?? MEDIA_MAX_UPLOAD_DEFAULT_MIB * BYTES_PER_MIB)
    ) {
      throw new Error('Invalid upload size')
    }
    if (
      source.name.length === 0 ||
      source.name.length > MEDIA_NAME_MAX_CHARS ||
      /[\r\n/\\]/u.test(source.name) ||
      !/^[\w.+-]+\/[\w.+-]+$/u.test(source.mime)
    ) {
      throw new Error('Invalid upload metadata')
    }
    await this.deps.authorizeUpload(signal, {
      bytes: source.bytes,
      expirySeconds: expiry,
      provider: this.deps.provider,
    })
    signal.throwIfAborted()
    const active = AbortSignal.any([signal, AbortSignal.timeout(MODEL_API_REQUEST_TIMEOUT_MS)])
    const boundary = `muse-${randomUUID()}`
    const prefix = buildUploadPrefix(wire, boundary, {
      name: source.name,
      mime: source.mime,
      expirySeconds: expiry,
      ...(this.deps.uploadPurpose !== undefined && { purpose: this.deps.uploadPurpose }),
    })
    const hash = createHash('sha256')
    let sha256: string | undefined
    let uploaded = 0
    async function* chunks() {
      yield prefix
      for await (const chunk of source.open(active)) {
        active.throwIfAborted()
        uploaded += chunk.byteLength
        if (uploaded > source.bytes) throw new Error('Upload source grew')
        hash.update(chunk)
        yield chunk
        onProgress?.(uploaded, source.bytes)
      }
      if (uploaded !== source.bytes) throw new Error('Upload source shrank')
      sha256 = hash.digest('hex')
      if (expectedSha256 !== undefined && sha256 !== expectedSha256)
        throw new Error(fill(UI_TEXT.media.sourceChanged, { name: source.name }))
      yield buildUploadSuffix(boundary)
    }
    const iterator = chunks()
    const body = new ReadableStream<Uint8Array>({
      async pull(controller) {
        const chunk = await iterator.next()
        if (chunk.done) controller.close()
        else controller.enqueue(chunk.value)
      },
      async cancel() {
        await iterator.return()
      },
    })
    let createdId: string | undefined
    try {
      const response = await this.deps.client.requestFile(
        '/files',
        'POST',
        active,
        {
          body,
          contentType: `multipart/form-data; boundary=${boundary}`,
        },
        this.deps.expectedAccountId,
      )
      const raw: unknown = await response.json()
      const identity = z.object({ id: fileIdFor(wire) }).safeParse(raw)
      if (identity.success) createdId = identity.data.id
      const created = parseUploadReceipt(wire, raw, { bytes: source.bytes, expirySeconds: expiry })
      active.throwIfAborted()
      if (sha256 === undefined) {
        throw new Error('Invalid upload receipt')
      }
      return uploadedMediaRefSchema.parse({
        fileId: created.fileId,
        provider: this.deps.provider,
        ...(created.expiresAt !== undefined && { expiresAt: created.expiresAt }),
        sha256,
        bytes: created.bytes,
        name: source.name,
        mime: source.mime,
      })
    } catch (error: unknown) {
      // A known receipt is attributable; a lost receipt is bounded by expiry.
      if (createdId !== undefined) await this.delete(createdId)
      throw error
    } finally {
      await iterator.return()
    }
  }

  public async retrieve(
    id: string,
    signal?: AbortSignal,
  ): Promise<ProviderFile | OpenAiProviderFile | AnthropicProviderFile> {
    const wire = this.deps.wire ?? 'meta-files'
    const response = await this.deps.client.requestFile(
      `/files/${fileIdFor(wire).parse(id)}`,
      'GET',
      AbortSignal.any([
        ...(signal === undefined ? [] : [signal]),
        AbortSignal.timeout(MODEL_API_REQUEST_TIMEOUT_MS),
      ]),
      undefined,
      this.deps.expectedAccountId,
    )
    const result = recordSchemaFor(wire).parse(await response.json())
    if (result.id !== id) throw new Error('Mismatched file receipt')
    return result
  }

  public async list(
    signal?: AbortSignal,
  ): Promise<readonly (ProviderFile | OpenAiProviderFile | AnthropicProviderFile)[]> {
    const wire = this.deps.wire ?? 'meta-files'
    const files: (ProviderFile | OpenAiProviderFile | AnthropicProviderFile)[] = []
    const seen = new Set<string>()
    let route = '/files'
    const active = AbortSignal.any([
      ...(signal === undefined ? [] : [signal]),
      AbortSignal.timeout(MODEL_API_REQUEST_TIMEOUT_MS),
    ])
    for (;;) {
      const response = await this.deps.client.requestFile(
        route,
        'GET',
        active,
        undefined,
        this.deps.expectedAccountId,
      )
      const page = listSchemaFor(wire).parse(await response.json())
      for (const file of page.data) {
        if (files.every((known) => known.id !== file.id)) files.push(file)
      }
      if (page.has_more !== true) return files
      if (page.last_id === undefined || seen.has(page.last_id))
        throw new Error('Invalid Files pagination')
      seen.add(page.last_id)
      route = `/files?after=${encodeURIComponent(page.last_id)}`
    }
  }

  public async delete(id: string, signal?: AbortSignal): Promise<void> {
    const wire = this.deps.wire ?? 'meta-files'
    const response = await this.deps.client.requestFile(
      `/files/${fileIdFor(wire).parse(id)}`,
      'DELETE',
      AbortSignal.any([
        ...(signal === undefined ? [] : [signal]),
        AbortSignal.timeout(MODEL_API_REQUEST_TIMEOUT_MS),
      ]),
      undefined,
      this.deps.expectedAccountId,
    )
    const result = deletionSchemaFor(wire).parse(await response.json())
    if (result.id !== id) throw new Error('Mismatched delete receipt')
  }

  /** Provider-neutral metadata for the shared ownership ledger and account UI. */
  public async accountFiles() {
    const listed = await this.list()
    return listed.map((file) => ({
      fileId: file.id,
      name: file.filename,
      bytes: 'bytes' in file ? file.bytes : file.size_bytes,
      ...('expires_at' in file &&
        typeof file.expires_at === 'number' && {
          expiresAt: file.expires_at,
        }),
      ...('expires_at' in file &&
        typeof file.expires_at === 'string' && {
          expiresAt: epochSeconds(file.expires_at),
        }),
    }))
  }
}
