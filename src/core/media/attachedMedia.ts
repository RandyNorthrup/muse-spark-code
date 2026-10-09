// M105 lane V, seam 1: host-issued attach tokens and the approved sources
// behind them. The attach port registers a sniffed, hashed file here and
// hands the turn a metadata-only `media` part; the session's one media
// service resolves that part to its stored record, reopens the source for
// upload (every open repeats the host's confinement and identity checks)
// and the audio seam converts or transcribes from it. No bytes, path or
// credential ever reaches the browser, the transcript or the session file.
import { createHash } from 'node:crypto'
import {
  MEDIA_ATTACHED_MAX_ENTRIES,
  MEDIA_ATTACHED_READ_CHUNK_BYTES,
  UI_TEXT,
} from '../../shared/constants'
import { fill } from '../../shared/l10n/text'
import { storedMediaPartSchema, type StoredMediaPart } from '../../shared/media'
import type { MediaFilePart, TurnPart } from '../agent/agentBackend'
import type { UploadSource } from '../backends/modelapi/files'
import type { AudioSource } from '../voice/transcribeBatch'

/** The host's way back to an approved file; each call rechecks it. */
export interface AttachedSource {
  /** Streams the file's current bytes; throws when it is no longer approved. */
  readonly read: (signal: AbortSignal) => AsyncIterable<Uint8Array>
  /** The confined absolute path, for the local converter only; undefined refuses. */
  readonly path: () => Promise<string | undefined>
}

interface Entry {
  readonly media: StoredMediaPart
  readonly source: AttachedSource
  /** Who attached it (a composer, an ACP session); released with its owner. */
  readonly owner: string | undefined
  /** Turns using it now: a claimed entry outlives discard and owner release. */
  claims: number
}

/** One attached file's identity as a record carries it: digest, name and size. */
function identity(media: StoredMediaPart): string {
  return `${media.sha256}\u{0}${String(media.info.sizeBytes)}\u{0}${media.name}`
}

/**
 * Streams the source, holding one chunk back until the whole file is read:
 * a changed size or digest throws before the last byte goes, so an upload
 * never completes from a file that is not the one attached.
 */
async function* verified(
  chunks: AsyncIterable<Uint8Array>,
  media: StoredMediaPart,
): AsyncGenerator<Uint8Array> {
  const changed = () => new Error(fill(UI_TEXT.media.sourceChanged, { name: media.name }))
  const hash = createHash('sha256')
  let size = 0
  let held: Uint8Array | undefined
  for await (const chunk of chunks) {
    size += chunk.byteLength
    if (size > media.info.sizeBytes) throw changed()
    hash.update(chunk)
    if (held !== undefined) yield held
    held = chunk
  }
  if (size !== media.info.sizeBytes || hash.digest('hex') !== media.sha256) throw changed()
  if (held !== undefined) yield held
}

/**
 * One per host: the attach port writes, the media service and audio seam
 * read. Registrations are owned (RVMEDIAV 7): a discarded chip, a disposed
 * session or a finished turn releases its own, a running turn keeps the
 * ones it claimed, and the whole registry is bounded.
 */
export class AttachedMedia {
  private readonly entries = new Map<string, Entry>()
  /** The token each identity last resolved through: its source is the one uploaded. */
  private readonly current = new Map<string, string>()

  private entry(part: TurnPart): Entry | undefined {
    if (part.type !== 'media') return undefined
    const entry = this.entries.get(part.token)
    return entry?.media.sha256 === part.sha256 &&
      entry.media.name === part.name &&
      entry.media.info.sizeBytes === part.info.sizeBytes
      ? entry
      : undefined
  }

  private delete(token: string): void {
    const entry = this.entries.get(token)
    if (entry === undefined) return
    this.entries.delete(token)
    const key = identity(entry.media)
    if (this.current.get(key) === token) this.current.delete(key)
  }

  /**
   * Registers a sniffed, hashed file under its one-use token. At the bound,
   * the oldest registration no turn is using makes room; when every one is
   * in use, the attachment is refused.
   */
  public register(
    token: string,
    media: StoredMediaPart,
    source: AttachedSource,
    owner?: string,
  ): MediaFilePart {
    const parsed = storedMediaPartSchema.parse(media)
    if (parsed.info.kind !== 'video' && parsed.info.kind !== 'audio')
      throw new Error('Only video and audio attach by token')
    if (this.entries.has(token)) throw new Error('Duplicate media path token')
    if (this.entries.size >= MEDIA_ATTACHED_MAX_ENTRIES) {
      const idle = [...this.entries].find(([, entry]) => entry.claims === 0)
      if (idle === undefined) throw new Error(UI_TEXT.media.attachedLimit)
      this.delete(idle[0])
    }
    this.entries.set(token, { media: parsed, source, owner, claims: 0 })
    return { type: 'media', token, name: parsed.name, info: parsed.info, sha256: parsed.sha256 }
  }

  /** The stored record a `media` part stands for; a stale or forged part has none. */
  public resolve(part: TurnPart): StoredMediaPart | undefined {
    const entry = this.entry(part)
    if (entry === undefined || part.type !== 'media') return undefined
    this.current.set(identity(entry.media), part.token)
    return storedMediaPartSchema.parse(entry.media)
  }

  /**
   * A turn takes the media parts it carries: discard and owner release pass
   * them by, and the returned completion releases them (one-use tokens).
   */
  public claim(parts: readonly TurnPart[]): () => void {
    const tokens = parts.flatMap((part) =>
      part.type === 'media' && this.entries.has(part.token) ? [part.token] : [],
    )
    for (const token of tokens) {
      const entry = this.entries.get(token)
      if (entry !== undefined) entry.claims += 1
    }
    let isDone = false
    return () => {
      if (isDone) return
      isDone = true
      for (const token of tokens) {
        const entry = this.entries.get(token)
        if (entry === undefined) continue
        entry.claims -= 1
        if (entry.claims === 0) this.delete(token)
      }
    }
  }

  /** A discarded attachment: gone unless a running turn holds it. */
  public release(token: string): void {
    if (this.entries.get(token)?.claims === 0) this.delete(token)
  }

  /** A disposed composer or session: its registrations no turn holds are gone. */
  public releaseOwner(owner: string): void {
    for (const [token, entry] of this.entries)
      if (entry.owner === owner && entry.claims === 0) this.delete(token)
  }

  /** The audio seam's view: metadata and the opaque token, never a path. */
  public audio(part: TurnPart): AudioSource | undefined {
    const entry = this.entry(part)
    if (entry === undefined || part.type !== 'media') return undefined
    const { info } = entry.media
    return info.kind === 'video' || info.kind === 'audio'
      ? { name: entry.media.name, pathToken: part.token, info }
      : undefined
  }

  /** The approved bytes behind a token, digest-verified as they stream. */
  public read(token: string, signal: AbortSignal): AsyncIterable<Uint8Array> {
    const entry = this.entries.get(token)
    if (entry === undefined) throw new Error(UI_TEXT.attachmentUnreadable)
    return verified(entry.source.read(signal), entry.media)
  }

  /** The confined path behind a token, rechecked by the host on every call. */
  public async path(token: string): Promise<string | undefined> {
    return await this.entries.get(token)?.source.path()
  }

  /**
   * The upload source for an attached record (RVMEDIAV 5): the token that
   * record last resolved through, else the newest registration with its
   * digest, name and size. An older, obsolete registration never shadows it.
   */
  public source(media: StoredMediaPart): UploadSource | undefined {
    const key = identity(media)
    const token = this.current.get(key)
    let entry = token === undefined ? undefined : this.entries.get(token)
    if (entry === undefined)
      for (const candidate of this.entries.values())
        if (identity(candidate.media) === key) entry = candidate
    if (entry === undefined) return undefined
    const found = entry
    return {
      name: media.name,
      mime: media.info.mediaType,
      bytes: media.info.sizeBytes,
      open: (signal) => verified(found.source.read(signal), found.media),
    }
  }

  /** The runtime closes: every token lapses. */
  public clear(): void {
    this.entries.clear()
    this.current.clear()
  }
}

/** What the session's media service and audio seam read; the attach port writes. */
export type AttachedMediaPort = Pick<
  AttachedMedia,
  'resolve' | 'source' | 'audio' | 'path' | 'read' | 'claim'
>

/**
 * A host's registry before its first attach (RVMEDIAV 8): the registry loads
 * with its own bundle, and until then nothing is attached and nothing
 * resolves. VS Code and the CLI/ACP runtime both hold their registry so.
 */
export function lazyAttachedMedia(current: () => AttachedMedia | undefined): AttachedMediaPort {
  return {
    resolve: (part) => current()?.resolve(part),
    source: (media) => current()?.source(media),
    audio: (part) => current()?.audio(part),
    path: async (token) => await current()?.path(token),
    read: (token, signal) => {
      const registry = current()
      if (registry === undefined) throw new Error(UI_TEXT.attachmentUnreadable)
      return registry.read(token, signal)
    },
    // Nothing registered yet: a turn has nothing to claim.
    claim: (parts) => {
      const release = current()?.claim(parts)
      return () => {
        release?.()
      }
    },
  }
}

/**
 * An attached source over a host open hook that rechecks confinement and
 * identity on every open: each read streams one fresh handle, closed after.
 */
export function reopeningSource(
  open: () => Promise<
    | {
        readonly source: {
          readonly sizeBytes: number
          readonly read: (offset: number, length: number) => Promise<Uint8Array>
        }
        readonly path?: string
        readonly close: () => Promise<void>
      }
    | undefined
  >,
): AttachedSource {
  return {
    read: async function* (signal) {
      const opened = await open()
      if (opened === undefined) throw new Error(UI_TEXT.attachmentUnreadable)
      try {
        for (let offset = 0; offset < opened.source.sizeBytes;) {
          signal.throwIfAborted()
          const length = Math.min(MEDIA_ATTACHED_READ_CHUNK_BYTES, opened.source.sizeBytes - offset)
          const chunk = await opened.source.read(offset, length)
          if (chunk.byteLength === 0) break
          offset += chunk.byteLength
          yield chunk
        }
      } finally {
        await opened.close()
      }
    },
    path: async () => {
      const opened = await open()
      if (opened === undefined) return
      await opened.close()
      return opened.path
    },
  }
}

/** The SHA-256 of a confined source, read in bounded chunks. */
export async function sourceDigest(source: {
  readonly sizeBytes: number
  readonly read: (offset: number, length: number) => Promise<Uint8Array>
}): Promise<string> {
  const hash = createHash('sha256')
  for (let offset = 0; offset < source.sizeBytes;) {
    const chunk = await source.read(
      offset,
      Math.min(MEDIA_ATTACHED_READ_CHUNK_BYTES, source.sizeBytes - offset),
    )
    if (chunk.byteLength === 0) throw new Error(UI_TEXT.attachmentUnreadable)
    offset += chunk.byteLength
    hash.update(chunk)
  }
  return hash.digest('hex')
}
