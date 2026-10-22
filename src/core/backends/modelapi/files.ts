// U6's Files wire (2026-10-05), now speaking three provider dialects by the
// model's capability record, never by a vendor's name (OPENAI-G15,
// GAPANTH-G16). The caller supplies an approved, confined stream; neither
// this module nor its upload references retain source bytes.
import { createHash, randomUUID } from 'node:crypto'
import * as z from 'zod/mini'
import {
  ANTHROPIC_FILE_EXPIRY_MAX_S,
  ANTHROPIC_FILE_EXPIRY_MIN_S,
  MEDIA_FILE_EXPIRY_DEFAULT_S,
  MEDIA_UPLOAD_EXPIRY_DAY_MIN,
  MEDIA_UPLOAD_EXPIRY_DEFAULT_DAYS,
  MEDIA_NAME_MAX_CHARS,
  SECONDS_PER_DAY,
  MILLISECONDS_PER_SECOND,
  UI_TEXT,
} from '../../../shared/constants'
import { fill } from '../../../shared/l10n/text'
import { uploadedMediaRefSchema, type UploadedMediaRef } from '../../../shared/media'
import type { ModelApiClient } from './client'
import type { ModelCapabilityRecord } from '../../providers/capabilityRecord'

/**
The upload/receipt dialect, taken from the model's files capability
(`wireForFiles`), never from a vendor's name. Every shape below is the
provider's documented one, UNVERIFIED until the capture plan's requests
confirm it.
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

/**
`museSpark.mediaUploadExpiryDays` as Files `expires_after` seconds, honoured
as set (NOLIMITSSET, PLAN.md D121: the removed 1–30 day range and the wire
seconds range were ours — no capability record carries either, so the
provider decides what it keeps and its receipt verifies it). Anything that is
not a whole day of at least 1 keeps the 7-day default.
*/
export function uploadExpirySeconds(days: unknown): number {
  const fallback = MEDIA_FILE_EXPIRY_DEFAULT_S
  if (typeof days !== 'number' || !Number.isSafeInteger(days) || days < MEDIA_UPLOAD_EXPIRY_DAY_MIN)
    return fallback
  return days === MEDIA_UPLOAD_EXPIRY_DEFAULT_DAYS ? fallback : days * SECONDS_PER_DAY
}

/**
A provider receipt the cleanup DELETE could not remove (RVM105 1): the
upload failed after the provider answered with this id, and the bounded
clean-up route was closed or failed too. The owner records it durably as
a clean-up intent; the ledger's next sweep deletes it. The cause is the
original upload failure the caller sees.
*/
export class UploadCleanupPendingError extends Error {
  public readonly fileId: string
  public constructor(fileId: string, options?: ErrorOptions) {
    super('Upload cleanup pending', options)
    this.fileId = fileId
  }
}

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
  The upload dialect from the model's files capability (`wireForFiles`).
  Absent stays Meta's exact U6 bytes, so today's behavior is unchanged.
  */
  readonly wire?: FilesWire
  /**
  The provider's upload purpose for the OpenAI dialect (UNVERIFIED which
  values each provider accepts; the capture plan's O1/X1 settle it).
  */
  readonly uploadPurpose?: string
  /** U6c's storage decision and any necessary paid admission, supplied by the owner. */
  readonly authorizeUpload: (
    signal: AbortSignal,
    storage: { readonly bytes: number; readonly expirySeconds: number; readonly provider: string },
  ) => Promise<void>
  readonly maxBytes?: number
  /** Read on every upload, so a changed setting applies to the next one. */
  readonly expirySeconds?: number | (() => number)
  readonly expectedAccountId?: string
}

export interface UploadFields {
  readonly name: string
  readonly mime: string
  readonly expirySeconds: number
  readonly purpose?: string
}

/**
The exact multipart head a dialect sends (pure: given the same fields it
returns the same bytes). Meta carries its expiring purpose; OpenAI carries
`file` plus `purpose`; Anthropic carries `file` with `expires_in_seconds`.
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
The provider's upload answer as our normalized receipt (pure). Meta's
expiry must fall inside the sent window; OpenAI keeps the file with no
expiry; Anthropic's RFC 3339 stamps convert to epoch seconds.
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
    onReceipt?: (fileId: string) => Promise<void>,
  ): Promise<UploadedMediaRef> {
    signal.throwIfAborted()
    const wire = this.deps.wire ?? 'meta-files'
    const configured =
      typeof this.deps.expirySeconds === 'function'
        ? this.deps.expirySeconds()
        : this.deps.expirySeconds
    const expiry = configured ?? MEDIA_FILE_EXPIRY_DEFAULT_S
    // NOLIMITSSET (PLAN.md D121): wire shape only — a safe positive integer
    // of seconds. No range of ours: the person's days arrive as set and the
    // provider refuses what it cannot keep. Past Anthropic's documented
    // 3600–7776000 s window the upload is refused before sending instead.
    if (
      !Number.isSafeInteger(expiry) ||
      expiry <= 0 ||
      (wire === 'anthropic-files' &&
        (expiry < ANTHROPIC_FILE_EXPIRY_MIN_S || expiry > ANTHROPIC_FILE_EXPIRY_MAX_S))
    ) {
      throw new Error('Invalid upload expiry')
    }
    // D121: no upload bound of ours — an absent cap admits any size and the
    // provider refuses what it cannot take. The attach admission and the
    // modality gate still enforce the person's setting and the model's
    // own record before anything reaches here.
    if (
      !Number.isSafeInteger(source.bytes) ||
      source.bytes < 0 ||
      (this.deps.maxBytes !== undefined && source.bytes > this.deps.maxBytes)
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
    // The caller's signal ends it; no deadline of our own (owner 2026-10-16).
    const active = signal
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
      if (identity.success) {
        createdId = identity.data.id
        // Ownership precedes validation/abort cleanup, which can outlast
        // headless shutdown. An interrupted DELETE must leave a durable id.
        await onReceipt?.(createdId)
      }
      const created = parseUploadReceipt(wire, raw, { bytes: source.bytes, expirySeconds: expiry })
      active.throwIfAborted()
      if (sha256 === undefined) {
        throw new Error('Invalid upload receipt')
      }
      // The final stream-close await stays inside the receipt cleanup guard.
      await iterator.return()
      active.throwIfAborted()
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
      if (createdId !== undefined) {
        try {
          // The receipt cleanup answers the operation's own signal (PR #214
          // review): a stalled DELETE no longer outlives Stop.
          await this.delete(createdId, signal)
        } catch {
          // A closed transport or a failed request still can leave the
          // receipt behind: the id travels with the failure so the ledger
          // records it durably instead of losing it (RVM105 1).
          throw new UploadCleanupPendingError(createdId, { cause: error })
        }
      }
      throw error
    } finally {
      try {
        await iterator.return()
      } catch {
        /* The guarded close above owns receipt cleanup; preserve its failure. */
      }
    }
  }

  public async retrieve(
    id: string,
    signal?: AbortSignal,
  ): Promise<ProviderFile | OpenAiProviderFile | AnthropicProviderFile> {
    // The caller's signal, if any, ends it; no deadline of our own (owner 2026-10-16).
    const wire = this.deps.wire ?? 'meta-files'
    const response = await this.deps.client.requestFile(
      `/files/${fileIdFor(wire).parse(id)}`,
      'GET',
      signal,
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
    // The caller's signal, if any, ends it; no deadline of our own (owner 2026-10-16).
    const active = signal
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
    // The caller's signal, if any, ends it; no deadline of our own (owner 2026-10-16).
    const wire = this.deps.wire ?? 'meta-files'
    const response = await this.deps.client.requestFile(
      `/files/${fileIdFor(wire).parse(id)}`,
      'DELETE',
      signal,
      undefined,
      this.deps.expectedAccountId,
    )
    const result = deletionSchemaFor(wire).parse(await response.json())
    if (result.id !== id) throw new Error('Mismatched delete receipt')
  }

  /** Provider-neutral metadata for the shared ownership ledger and account UI. */
  public async accountFiles(signal?: AbortSignal) {
    const listed = await this.list(signal)
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
