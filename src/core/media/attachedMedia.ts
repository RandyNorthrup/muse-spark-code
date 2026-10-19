// M105 lane V, seam 1: host-issued attach tokens and the approved sources
// behind them. The attach port registers a sniffed, hashed file here and
// hands the turn a metadata-only `media` part; the session's one media
// service resolves that part to its stored record, reopens the source for
// upload (every open repeats the host's confinement and identity checks)
// and the audio seam converts or transcribes from it. No bytes, path or
// credential ever reaches the browser, the transcript or the session file.
import { createHash } from 'node:crypto'
import { MEDIA_ATTACHED_READ_CHUNK_BYTES, UI_TEXT } from '../../shared/constants'
import { fill } from '../../shared/l10n/text'
import { storedMediaPartSchema, type StoredMediaPart } from '../../shared/media'
import type { MediaFilePart, TurnPart } from '../agent/agentBackend'
import type { UploadSource } from '../backends/modelapi/files'
import type { AudioSource } from '../voice/transcribeBatch'

/** The host's way back to an approved file; each call rechecks it. */
export interface AttachedSource {
  /** Streams the file's current bytes; throws when it is no longer approved. */
  readonly read: (signal: AbortSignal) => AsyncIterable<Uint8Array>
}

/**
A registration's state (RVMEDIAV2, PLAN M105's table): `attached` is a
chip only its owner holds; `claimed` is held by an accepted turn still
waiting (queued or steered); `inFlight` by a turn that started. D121: no
bound evicts `attached` — discards and owner releases let them go.
*/
export type AttachedState = 'attached' | 'claimed' | 'inFlight'

/** One accepted turn's hold on the media parts it carries. */
export interface MediaClaim {
  /** The turn starts, or its steer enters a request: claimed becomes in flight. */
  readonly start: () => void
  /** The turn ends, is withdrawn or dropped: the last holder releases the token. */
  readonly release: () => void
}

interface Holder {
  isInFlight: boolean
}

interface Entry {
  readonly media: StoredMediaPart
  /** Fixed at registration: a token never reads another token's source. */
  readonly source: AttachedSource
  /** Who attached it (a composer, an ACP session); released with its owner. */
  readonly owner: string | undefined
  /** The accepted turns holding it; empty while it is only attached. */
  readonly holders: Set<Holder>
}

function stateOf(entry: Entry): AttachedState {
  if (entry.holders.size === 0) return 'attached'
  return [...entry.holders].some((holder) => holder.isInFlight) ? 'inFlight' : 'claimed'
}

/**
Streams the source, holding one chunk back until the whole file is read:
a changed size or digest throws before the last byte goes, so an upload
never completes from a file that is not the one attached.
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
One per host: the attach port writes, the media service and audio seam
read. Every registration has one owner and one set of turn holders, and
moves attached -> claimed -> in flight -> released (RVMEDIAV2). Its
source is fixed per token: lookups go by token, never by digest, so no
session can redirect another's upload. D121: registrations are metadata
only and unbounded — no eviction, no refusal.
*/
export class AttachedMedia {
  private readonly entries = new Map<string, Entry>()

  private entry(part: TurnPart): Entry | undefined {
    if (part.type !== 'media') return undefined
    const entry = this.entries.get(part.token)
    return entry?.media.sha256 === part.sha256 &&
      entry.media.name === part.name &&
      entry.media.info.sizeBytes === part.info.sizeBytes
      ? entry
      : undefined
  }

  /**
  Registers a sniffed, hashed file under its one-use token. D121: any
  number of registrations — entries hold metadata only, and discards,
  owner releases and turn releases still let them go.
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
    this.entries.set(token, { media: parsed, source, owner, holders: new Set() })
    return { type: 'media', token, name: parsed.name, info: parsed.info, sha256: parsed.sha256 }
  }

  /** A token's state; undefined once released (or never registered). */
  public state(token: string): AttachedState | undefined {
    const entry = this.entries.get(token)
    return entry === undefined ? undefined : stateOf(entry)
  }

  /** The stored record a `media` part stands for; a stale or forged part has none. */
  public resolve(part: TurnPart): StoredMediaPart | undefined {
    const entry = this.entry(part)
    return entry === undefined ? undefined : storedMediaPartSchema.parse(entry.media)
  }

  /**
  An accepted turn (queued, steered or started) takes the media parts it
  carries: from here discards and owner releases pass them by. The last
  holder's release ends the token (one-use).
  */
  public claim(parts: readonly TurnPart[]): MediaClaim {
    const holder: Holder = { isInFlight: false }
    const held = parts.flatMap((part) => {
      const entry = part.type === 'media' ? this.entries.get(part.token) : undefined
      return entry === undefined || part.type !== 'media' ? [] : [[part.token, entry] as const]
    })
    for (const [, entry] of held) entry.holders.add(holder)
    return {
      start: () => {
        holder.isInFlight = true
      },
      release: () => {
        for (const [token, entry] of held.splice(0)) {
          entry.holders.delete(holder)
          if (entry.holders.size === 0 && this.entries.get(token) === entry)
            this.entries.delete(token)
        }
      },
    }
  }

  /** A discarded chip: gone unless an accepted turn holds it. */
  public release(token: string): void {
    const entry = this.entries.get(token)
    if (entry !== undefined && stateOf(entry) === 'attached') this.entries.delete(token)
  }

  /** A disposed composer or session: its registrations no turn holds are gone. */
  public releaseOwner(owner: string): void {
    for (const [token, entry] of this.entries)
      if (entry.owner === owner && stateOf(entry) === 'attached') this.entries.delete(token)
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

  /**
  The upload source for the record a token resolved to (RVMEDIAV2): that
  token's own registration, and only while it still carries this digest,
  name and size. Another registration of the same bytes never stands in.
  */
  public source(token: string, media: StoredMediaPart): UploadSource | undefined {
    const entry = this.entries.get(token)
    if (
      entry?.media.sha256 !== media.sha256 ||
      entry.media.name !== media.name ||
      entry.media.info.sizeBytes !== media.info.sizeBytes
    )
      return undefined
    return {
      name: media.name,
      mime: media.info.mediaType,
      bytes: media.info.sizeBytes,
      open: (signal) => verified(entry.source.read(signal), entry.media),
    }
  }

  /** The runtime closes: every token lapses. */
  public clear(): void {
    this.entries.clear()
  }
}

/** What the session's media service and audio seam read; the attach port writes. */
export type AttachedMediaPort = Pick<
  AttachedMedia,
  'resolve' | 'source' | 'audio' | 'read' | 'claim'
>

/**
An attached source over a host open hook that rechecks confinement and
identity on every open: each read streams one fresh handle, closed after.
*/
export function reopeningSource(
  open: () => Promise<
    | {
        readonly source: {
          readonly sizeBytes: number
          readonly read: (offset: number, length: number) => Promise<Uint8Array>
        }
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
