// M105 lane V, seam 5: the runtime's ACP and exec media port. `/attach` and
// `exec --attach` reach AcpMedia's confinement and the captured record's
// gate; what it admits binds to the runtime's attached-media registry
// (video and audio) or the established inline parts (images, PDFs).
import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { runtimeMediaPort, type RuntimeMediaPortDeps } from '../../src/acp/mediaPort'
import type { AcpMediaContext } from '../../src/acp/media'
import {
  AttachedMedia,
  isMediaAttachRefusal,
  type AttachedSource,
} from '../../src/core/media/attachedMedia'
import { attachedOrWorkspaceSource } from '../../src/core/media/productionMedia'
import { sniffMediaBytes } from '../../src/core/media/limits'
import { MEDIA_ATTACHED_MAX_ENTRIES, UI_TEXT } from '../../src/shared/constants'
import { fill } from '../../src/shared/l10n/text'
import { videoFixture, wavFixture } from './helpers/media/fixtures'

const signal = new AbortController().signal
const CONTRIBUTOR = 'muse-spark-1.3-contributor'
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAAABJRU5ErkJggg==',
  'base64',
)

/** A confined workspace of one file, read as the runtime's tool IO reads it. */
function port(
  bytes: Uint8Array,
  options: { readonly modelId?: string; readonly transcribes?: boolean } = {},
) {
  const attached = new AttachedMedia()
  const info = sniffMediaBytes(bytes)
  const chunk = Promise.resolve(bytes)
  const readMedia = (_absolute: string) =>
    Promise.resolve(
      info === undefined
        ? { kind: 'other' as const, reason: 'not media', isPdf: false }
        : {
            info,
            sha256: createHash('sha256').update(bytes).digest('hex'),
            source: {
              name: 'file',
              mime: info.mediaType,
              bytes: bytes.length,
              open: async function* () {
                yield await chunk
              },
            },
          },
    )
  const deps: RuntimeMediaPortDeps = {
    platform: 'linux',
    io: {
      realPath: (given) => Promise.resolve(given),
      readMedia,
      readBytes: () => Promise.resolve(bytes),
    },
    attached,
    newToken: () => 'token-1',
    transcribesSound: () => options.transcribes === true,
  }
  const context: AcpMediaContext = {
    cwd: '/ws',
    sessionId: 'session',
    backend: 'modelApi',
    modelId: () => options.modelId ?? CONTRIBUTOR,
    interactive: true,
  }
  return { media: runtimeMediaPort(context, deps), attached }
}

describe('the runtime media port (M105 lane V seam 5)', () => {
  it('registers an attached video with the runtime registry, its path never handed out', async () => {
    const bytes = videoFixture({ soundtrack: false })
    const p = port(bytes)
    const attachment = await p.media.attach('clip.mp4', signal)
    expect(attachment.part).toMatchObject({ type: 'media', token: 'token-1', name: 'clip.mp4' })
    const record = p.attached.resolve(attachment.part)
    expect(record).toMatchObject({ name: 'clip.mp4', info: { kind: 'video' } })
    expect(p.attached).not.toHaveProperty('path')
    if (record === undefined) throw new Error('expected a record')
    const stream = p.attached.source('token-1', record)?.open(signal) ?? []
    const read = await Array.fromAsync(stream)
    expect(Buffer.concat(read).equals(Buffer.from(bytes))).toBe(true)
  })

  it('refuses video on a model with no captured record, with the gate reason', async () => {
    const p = port(videoFixture({ soundtrack: false }), { modelId: 'muse-spark-1.3' })
    await expect(p.media.attach('clip.mp4', signal)).rejects.toThrow(
      fill(UI_TEXT.media.videoUnknown, { model: 'muse-spark-1.3' }),
    )
  })

  it('admits audio only where the agent transcribes it', async () => {
    await expect(port(wavFixture()).media.attach('note.wav', signal)).rejects.toThrow(
      fill(UI_TEXT.media.audioUnsupported, { model: CONTRIBUTOR }),
    )
    const p = port(wavFixture(), { transcribes: true })
    const attachment = await p.media.attach('note.wav', signal)
    expect(attachment.part).toMatchObject({ type: 'media', info: { kind: 'audio' } })
    expect(p.attached.audio(attachment.part)).toMatchObject({ name: 'note.wav' })
  })

  it('keeps an attached image as its established inline part', async () => {
    const p = port(new Uint8Array(PNG))
    const attachment = await p.media.attach('tile.png', signal)
    expect(attachment.part).toEqual({
      type: 'image',
      base64Data: PNG.toString('base64'),
      mediaType: 'image/png',
      width: 1,
      height: 1,
    })
  })
})

/** A source over fixed bytes that counts its reads, or one whose file is gone. */
function counted(bytes: Uint8Array | undefined) {
  const reads = { count: 0 }
  const chunk = bytes === undefined ? undefined : Promise.resolve(bytes)
  const source: AttachedSource = {
    read: async function* () {
      reads.count += 1
      if (chunk === undefined) throw new Error('old file gone')
      yield await chunk
    },
  }
  return { source, reads }
}

function wavRecord(bytes: Uint8Array) {
  const info = sniffMediaBytes(bytes)
  if (info?.kind !== 'audio') throw new Error('fixture must sniff as audio')
  return { name: 'clip.wav', info, sha256: createHash('sha256').update(bytes).digest('hex') }
}

describe('attached-media registrations: identity, ownership and bound (RVMEDIAV 5, 7)', () => {
  it('uploads from the current token, never an obsolete byte-identical registration (finding 5)', async () => {
    const bytes = wavFixture()
    const registry = new AttachedMedia()
    // /a/clip.wav attached, its chip discarded and the file deleted; then
    // the byte-identical /b/clip.wav attached.
    const stale = counted(undefined)
    const fresh = counted(bytes)
    registry.register('stale', wavRecord(bytes), stale.source)
    const part = registry.register('fresh', wavRecord(bytes), fresh.source)
    const record = registry.resolve(part)
    if (record === undefined) throw new Error('expected the fresh record')
    const read = await Array.fromAsync(registry.source('fresh', record)?.open(signal) ?? [])
    expect(Buffer.concat(read)).toEqual(Buffer.from(bytes))
    expect([stale.reads.count, fresh.reads.count]).toEqual([0, 1])
  })

  it('removes a discarded registration; a turn that claimed it keeps it until it ends (finding 5, 7)', () => {
    const bytes = wavFixture()
    const registry = new AttachedMedia()
    const discarded = registry.register('discarded', wavRecord(bytes), counted(bytes).source)
    registry.release('discarded')
    expect(registry.resolve(discarded)).toBeUndefined()
    const sent = registry.register('sent', wavRecord(bytes), counted(bytes).source, 'composer')
    const complete = registry.claim([sent])
    registry.release('sent')
    registry.releaseOwner('composer')
    expect(registry.resolve(sent)).toBeDefined()
    complete.release()
    expect(registry.resolve(sent)).toBeUndefined()
  })

  it('lets a released session go of its embedded bytes, keeping the running turn’s (finding 7)', async () => {
    const attached = new AttachedMedia()
    let next = 0
    const media = runtimeMediaPort(
      {
        cwd: '/ws',
        sessionId: 'session',
        backend: 'modelApi',
        modelId: () => CONTRIBUTOR,
        interactive: true,
      },
      {
        platform: 'linux',
        io: {
          realPath: (given) => Promise.resolve(given),
          readMedia: () => Promise.reject(new Error('embedded only')),
          readBytes: () => Promise.reject(new Error('embedded only')),
        },
        attached,
        newToken: () => `token-${String(++next)}`,
        transcribesSound: () => true,
      },
    )
    const data = Buffer.from(wavFixture()).toString('base64')
    const parts = []
    for (let index = 0; index < 3; index++) {
      const part = await media.block({ type: 'audio', data, mimeType: 'audio/wav' }, signal)
      if (typeof part === 'string') throw new Error(part)
      parts.push(part)
    }
    const [running, ...idle] = parts
    if (running === undefined) throw new Error('expected parts')
    const complete = attached.claim([running])
    media.release()
    for (const part of idle) expect(attached.resolve(part)).toBeUndefined()
    expect(attached.resolve(running)).toBeDefined()
    complete.release()
    expect(attached.resolve(running)).toBeUndefined()
  })

  it('holds a process-wide bound: the oldest idle registration makes room, in-use ones refuse (finding 7)', () => {
    const bytes = wavFixture()
    const registry = new AttachedMedia()
    const parts = Array.from({ length: MEDIA_ATTACHED_MAX_ENTRIES }, (_, index) =>
      registry.register(`token-${String(index)}`, wavRecord(bytes), counted(bytes).source),
    )
    const [oldest, second] = parts
    if (oldest === undefined || second === undefined) throw new Error('expected parts')
    registry.register('one-more', wavRecord(bytes), counted(bytes).source)
    expect(registry.resolve(oldest)).toBeUndefined()
    expect(registry.resolve(second)).toBeDefined()
    registry.claim([...parts.slice(1), { type: 'media', token: 'one-more', ...wavRecord(bytes) }])
    expect(() => registry.register('refused', wavRecord(bytes), counted(bytes).source)).toThrow(
      UI_TEXT.media.attachedLimit,
    )
  })
})

describe('attached-media state machine (RVMEDIAV2, PLAN M105)', () => {
  it('moves attached -> claimed -> in flight -> released, one transition per call', () => {
    const bytes = wavFixture()
    const registry = new AttachedMedia()
    const part = registry.register('t', wavRecord(bytes), counted(bytes).source, 'composer')
    expect(registry.state('t')).toBe('attached')
    const claim = registry.claim([part])
    expect(registry.state('t')).toBe('claimed')
    claim.start()
    expect(registry.state('t')).toBe('inFlight')
    claim.release()
    expect(registry.state('t')).toBeUndefined()
    // A second release is a no-op, never a release of a later holder.
    claim.release()
  })

  it('releases a claimed token when its queued turn is withdrawn before it starts', () => {
    const bytes = wavFixture()
    const registry = new AttachedMedia()
    const part = registry.register('t', wavRecord(bytes), counted(bytes).source)
    registry.claim([part]).release()
    expect(registry.state('t')).toBeUndefined()
  })

  it('keeps a token while any holder of its reference set remains', () => {
    const bytes = wavFixture()
    const registry = new AttachedMedia()
    const part = registry.register('t', wavRecord(bytes), counted(bytes).source)
    const queued = registry.claim([part])
    const running = registry.claim([part])
    running.start()
    queued.release()
    expect(registry.state('t')).toBe('inFlight')
    running.release()
    expect(registry.state('t')).toBeUndefined()
  })

  it('returns from in flight to claimed when the running holder ends first, still protected (RVMEDIAV3 4)', () => {
    const bytes = wavFixture()
    const registry = new AttachedMedia()
    const record = wavRecord(bytes)
    const part = registry.register('t', record, counted(bytes).source, 'composer')
    const running = registry.claim([part])
    const queued = registry.claim([part])
    const seen = [registry.state('t')]
    running.start()
    seen.push(registry.state('t'))
    running.release()
    seen.push(registry.state('t'))
    // Claimed again: discard, owner release and the bound still pass it by.
    registry.release('t')
    registry.releaseOwner('composer')
    for (let index = 0; index < MEDIA_ATTACHED_MAX_ENTRIES; index++)
      registry.register(`later-${String(index)}`, record, counted(bytes).source)
    seen.push(registry.state('t'))
    queued.release()
    seen.push(registry.state('t'))
    expect(seen).toEqual(['claimed', 'inFlight', 'claimed', 'claimed', undefined])
  })

  it('stays in flight while another holder runs; claimed only when the last running one ends (RVMEDIAV4 2)', () => {
    const bytes = wavFixture()
    const registry = new AttachedMedia()
    const part = registry.register('t', wavRecord(bytes), counted(bytes).source)
    const first = registry.claim([part])
    const second = registry.claim([part])
    const waiting = registry.claim([part])
    first.start()
    second.start()
    const seen = [registry.state('t')]
    first.release()
    seen.push(registry.state('t'))
    second.release()
    seen.push(registry.state('t'))
    waiting.release()
    seen.push(registry.state('t'))
    expect(seen).toEqual(['inFlight', 'inFlight', 'claimed', undefined])
  })

  it('discard and owner release pass claimed and in-flight tokens by, and take attached ones', () => {
    const bytes = wavFixture()
    const registry = new AttachedMedia()
    const record = wavRecord(bytes)
    const idle = registry.register('idle', record, counted(bytes).source, 'composer')
    const queued = registry.register('queued', record, counted(bytes).source, 'composer')
    const running = registry.register('running', record, counted(bytes).source, 'composer')
    registry.claim([queued])
    registry.claim([running]).start()
    registry.release('queued')
    registry.release('running')
    registry.releaseOwner('composer')
    expect([idle, queued, running].map((part) => registry.state(part.token))).toEqual([
      undefined,
      'claimed',
      'inFlight',
    ])
  })

  it('never evicts a claimed (queued) token at the bound; refuses with the typed, translated reason', () => {
    const bytes = wavFixture()
    const registry = new AttachedMedia()
    const record = wavRecord(bytes)
    const queued = registry.register('queued', record, counted(bytes).source)
    registry.claim([queued])
    for (let index = 0; index < MEDIA_ATTACHED_MAX_ENTRIES; index++)
      registry.register(`later-${String(index)}`, record, counted(bytes).source)
    expect(registry.state('queued')).toBe('claimed')
    expect(registry.state('later-0')).toBeUndefined()
    const all = Array.from({ length: MEDIA_ATTACHED_MAX_ENTRIES - 1 }, (_, index) => ({
      type: 'media' as const,
      token: `later-${String(index + 1)}`,
      ...record,
    }))
    registry.claim(all)
    let refusal: unknown
    try {
      registry.register('refused', record, counted(bytes).source)
    } catch (error: unknown) {
      refusal = error
    }
    expect(isMediaAttachRefusal(refusal)).toBe(true)
    expect(refusal).toHaveProperty('message', UI_TEXT.media.attachedLimit)
    expect(registry.state('queued')).toBe('claimed')
  })

  it('keeps each token on its own source across sessions: another session cannot redirect an upload', async () => {
    const bytes = wavFixture()
    const registry = new AttachedMedia()
    // Session A attached /a/clip.wav (since deleted); session B attached the
    // byte-identical /b/clip.wav. B resolves, then A resolves meanwhile.
    const old = counted(undefined)
    const fresh = counted(bytes)
    const oldPart = registry.register('old', wavRecord(bytes), old.source, 'session-a')
    const freshPart = registry.register('fresh', wavRecord(bytes), fresh.source, 'session-b')
    const freshRecord = registry.resolve(freshPart)
    if (freshRecord === undefined) throw new Error('expected the fresh record')
    registry.resolve(oldPart)
    const source = attachedOrWorkspaceSource(registry, () => Promise.resolve(undefined))
    const opened = await source(freshRecord, signal, 'fresh')
    const read = await Array.fromAsync(opened?.open(signal) ?? [])
    expect(Buffer.concat(read)).toEqual(Buffer.from(bytes))
    expect([old.reads.count, fresh.reads.count]).toEqual([0, 1])
    // A record with no token never borrows a registration's source.
    expect(await source(freshRecord, signal)).toBeUndefined()
  })
})
