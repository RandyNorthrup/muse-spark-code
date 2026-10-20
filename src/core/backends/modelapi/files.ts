// U6's Files wire (2026-10-05). The caller supplies an approved, confined
// stream; neither this module nor its upload references retain source bytes.
import { createHash, randomUUID } from 'node:crypto'
import * as z from 'zod/mini'
import {
  MEDIA_FILE_EXPIRY_DEFAULT_S,
  MEDIA_UPLOAD_EXPIRY_DAY_MIN,
  MEDIA_UPLOAD_EXPIRY_DEFAULT_DAYS,
  MEDIA_NAME_MAX_CHARS,
  SECONDS_PER_DAY,
  UI_TEXT,
} from '../../../shared/constants'
import { fill } from '../../../shared/l10n/text'
import { uploadedMediaRefSchema, type UploadedMediaRef } from '../../../shared/media'
import type { ModelApiClient } from './client'

const fileId = z.string().check(z.regex(/^file-[A-Za-z0-9_-]+$/u))
// Account listings also contain inline media saved by the server without expiry (round 2).
const fileSchema = z.object({
  id: fileId,
  object: z.literal('file'),
  bytes: z.int().check(z.gte(0)),
  created_at: z.int().check(z.gt(0)),
  expires_at: z.optional(z.int().check(z.gt(0))),
  filename: z.string(),
  purpose: z.string(),
  status: z.string(),
})
const listSchema = z.object({
  object: z.literal('list'),
  data: z.array(fileSchema),
  has_more: z.boolean(),
  last_id: z.optional(fileId),
})
const deletionSchema = z.object({ id: fileId, object: z.literal('file'), deleted: z.literal(true) })
export type ProviderFile = z.infer<typeof fileSchema>

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
    const configured =
      typeof this.deps.expirySeconds === 'function'
        ? this.deps.expirySeconds()
        : this.deps.expirySeconds
    const expiry = configured ?? MEDIA_FILE_EXPIRY_DEFAULT_S
    // NOLIMITSSET (PLAN.md D121): wire shape only — a safe positive integer
    // of seconds. No range of ours: the person's days arrive as set and the
    // provider refuses what it cannot keep.
    if (!Number.isSafeInteger(expiry) || expiry <= 0) {
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
    const encoder = new TextEncoder()
    const quotedName = source.name.replaceAll('"', '%22')
    const prefix = encoder.encode(
      `--${boundary}\r\nContent-Disposition: form-data; name="purpose"\r\n\r\nuser_data\r\n` +
        `--${boundary}\r\nContent-Disposition: form-data; name="expires_after[anchor]"\r\n\r\ncreated_at\r\n` +
        `--${boundary}\r\nContent-Disposition: form-data; name="expires_after[seconds]"\r\n\r\n${String(expiry)}\r\n` +
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${quotedName}"\r\nContent-Type: ${source.mime}\r\n\r\n`,
    )
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
      yield encoder.encode(`\r\n--${boundary}--\r\n`)
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
      const identity = z.object({ id: fileId }).safeParse(raw)
      if (identity.success) {
        createdId = identity.data.id
        // Ownership precedes validation/abort cleanup, which can outlast
        // headless shutdown. An interrupted DELETE must leave a durable id.
        await onReceipt?.(createdId)
      }
      const created = fileSchema.parse(raw)
      active.throwIfAborted()
      if (
        sha256 === undefined ||
        created.bytes !== source.bytes ||
        created.expires_at === undefined ||
        created.expires_at <= created.created_at ||
        created.expires_at - created.created_at > expiry
      ) {
        throw new Error('Invalid upload receipt')
      }
      // The final stream-close await stays inside the receipt cleanup guard.
      await iterator.return()
      active.throwIfAborted()
      return uploadedMediaRefSchema.parse({
        fileId: created.id,
        provider: this.deps.provider,
        expiresAt: created.expires_at,
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

  public async retrieve(id: string, signal?: AbortSignal): Promise<ProviderFile> {
    // The caller's signal, if any, ends it; no deadline of our own (owner 2026-10-16).
    const response = await this.deps.client.requestFile(
      `/files/${fileId.parse(id)}`,
      'GET',
      signal,
      undefined,
      this.deps.expectedAccountId,
    )
    const result = fileSchema.parse(await response.json())
    if (result.id !== id) throw new Error('Mismatched file receipt')
    return result
  }

  public async list(signal?: AbortSignal): Promise<readonly ProviderFile[]> {
    const files: ProviderFile[] = []
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
      const page = listSchema.parse(await response.json())
      for (const file of page.data) {
        if (files.every((known) => known.id !== file.id)) files.push(file)
      }
      if (!page.has_more) return files
      if (page.last_id === undefined || seen.has(page.last_id))
        throw new Error('Invalid Files pagination')
      seen.add(page.last_id)
      route = `/files?after=${encodeURIComponent(page.last_id)}`
    }
  }

  public async delete(id: string, signal?: AbortSignal): Promise<void> {
    // The caller's signal, if any, ends it; no deadline of our own (owner 2026-10-16).
    const response = await this.deps.client.requestFile(
      `/files/${fileId.parse(id)}`,
      'DELETE',
      signal,
      undefined,
      this.deps.expectedAccountId,
    )
    const result = deletionSchema.parse(await response.json())
    if (result.id !== id) throw new Error('Mismatched delete receipt')
  }

  /** Provider-neutral metadata for the shared ownership ledger and account UI. */
  public async accountFiles(signal?: AbortSignal) {
    const listed = await this.list(signal)
    return listed.map((file) => ({
      fileId: file.id,
      name: file.filename,
      bytes: file.bytes,
      ...(file.expires_at !== undefined && { expiresAt: file.expires_at }),
    }))
  }
}
