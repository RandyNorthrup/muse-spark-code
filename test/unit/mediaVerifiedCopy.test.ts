// RVMEDIAV3 1: the private copy conversion encodes is the verified bytes,
// whole. Through the real attached-media registry (digest-verified stream),
// the transcription adapters' conversion port and convert.ts's copy; a
// fault-injected handle stands in for a disk that lands fewer bytes than
// asked, none, or other bytes. A fake encoder records what it was given and
// fake HTTP answers the transcription POST.
import { createHash } from 'node:crypto'
import type * as FsPromises from 'node:fs/promises'
import type { FileHandle } from 'node:fs/promises'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AttachedMedia } from '../../src/core/media/attachedMedia'
import { sniffMediaBytes } from '../../src/core/media/limits'
import { createTranscriptionPorts } from '../../src/core/voice/transcribeBatchHttp'
import { prepareAudioAttachment } from '../../src/core/voice/transcribeBatch'
import { UI_TEXT } from '../../src/shared/constants'
import { fill } from '../../src/shared/l10n/text'
import { audioPreparationDeps, fakeConversionOptions } from './helpers/media/conversion'
import { wavFixture } from './helpers/media/fixtures'
import { removeFolder } from './helpers/temporaryFolders'

/** How the next private copy's writes behave; undefined passes every write through. */
const fault: { mode: 'short' | 'none' | 'other' | undefined } = { mode: undefined }
/**
 * At most this many bytes land per write in the short mode: a frame boundary
 * of the MP3 fixture, so a copy cut there still sniffs whole and passes the
 * duration ceiling (the review's 4,197-byte probe).
 */
const SHORT_WRITE_BYTES = 4197

/** The real handle, with its `write` replaced by the fault. */
function faulty(handle: FileHandle): FileHandle {
  const write = async (
    buffer: Uint8Array,
    offset = 0,
    length = buffer.byteLength - offset,
    position: number | null = null,
  ) => {
    if (fault.mode === 'none') {
      // A stalled disk: each attempt lands nothing, a turn of the event loop later.
      await new Promise((resolve) => setImmediate(resolve))
      return { bytesWritten: 0, buffer }
    }
    if (fault.mode === 'other') {
      // Reports every byte written, but the last one lands changed: the copy
      // still sniffs as the same MP3, so only reading it back catches it.
      const other = Uint8Array.from(buffer.subarray(offset, offset + length))
      other.set([(other.at(-1) ?? 0) ^ 0xff], other.length - 1)
      await handle.write(other, 0, other.byteLength, position)
      return { bytesWritten: length, buffer }
    }
    return await handle.write(buffer, offset, Math.min(length, SHORT_WRITE_BYTES), position)
  }
  return new Proxy(handle, {
    get: (target, key): unknown => {
      if (key === 'write') return write
      const value: unknown = Reflect.get(target, key, target)
      return typeof value === 'function' ? value.bind(target) : value
    },
  })
}

vi.mock('node:fs/promises', async (original) => {
  const actual = await original<typeof FsPromises>()
  return {
    ...actual,
    open: vi.fn(async (...args: Parameters<typeof actual.open>) => {
      const handle = await actual.open(...args)
      // Only the conversion's private copy of the attachment, made exclusively.
      const isCopy = args[1] === 'wx' && path.basename(String(args[0])).startsWith('input.')
      return !isCopy || fault.mode === undefined ? handle : faulty(handle)
    }),
  }
})

const MP3_FIXTURE = 'test/fixtures/voice/tone-2s.mp3'
const folders: string[] = []
afterEach(async () => {
  fault.mode = undefined
  for (const folder of folders.splice(0)) await removeFolder(folder)
})

/** The registry, the ports and a turn's preparation, recording what the encoder and the POST saw. */
async function rig() {
  const original = new Uint8Array(await readFile(MP3_FIXTURE))
  const info = sniffMediaBytes(original)
  if (info?.kind !== 'audio') throw new Error('the MP3 fixture must sniff as audio')
  const registry = new AttachedMedia()
  const reads = { count: 0 }
  const chunk = Promise.resolve(original)
  const part = registry.register(
    'speech',
    { name: 'speech.mp3', info, sha256: createHash('sha256').update(original).digest('hex') },
    {
      read: async function* () {
        reads.count += 1
        yield await chunk
      },
    },
  )
  const source = registry.audio(part)
  if (source === undefined) throw new Error('the registered part must resolve')
  const seen: { encoded?: Uint8Array; posts: number } = { posts: 0 }
  const ports = createTranscriptionPorts({
    readAudioBytes: async (file) => new Uint8Array(await readFile(file)),
    // The registry's digest-verified stream: what conversion copies.
    readSource: (audio, signal) => registry.read(audio.pathToken, signal),
    postTranscription: (request) => {
      request.dispatch()
      seen.posts += 1
      return Promise.resolve(Response.json({ transcript: 'A tone.', audioDurationMs: 2000 }))
    },
    locateConverter: () =>
      Promise.resolve({
        ok: true as const,
        // Never executed: the fake encoder below stands in for ffmpeg.
        converter: { kind: 'ffmpeg' as const, command: path.resolve('muse-fake-ffmpeg') },
      }),
    conversionOptions: fakeConversionOptions(async (_command, args, runOptions) => {
      const input = args[args.indexOf('-i') + 1]
      if (input === undefined) throw new Error('the encoder must be given an input')
      folders.push(path.dirname(input))
      seen.encoded = new Uint8Array(await readFile(input))
      await writeFile(runOptions.outputPath, wavFixture(2, { sampleRate: 16_000 }))
    }),
  })
  const prepare = () =>
    prepareAudioAttachment(
      source,
      'transcribe',
      audioPreparationDeps(ports),
      new AbortController().signal,
    )
  return { original, reads, seen, prepare }
}

describe('the verified private copy conversion encodes (RVMEDIAV3 1)', () => {
  it('writes every verified byte across short writes: the encoder reads all of them', async () => {
    const r = await rig()
    fault.mode = 'short'
    const prepared = await r.prepare()
    expect(prepared.transcript?.text).toBe('A tone.')
    // 8,376 verified bytes: 4,197 land, then the rest, and the copy reads back whole.
    expect(r.seen.encoded?.byteLength).toBe(r.original.byteLength)
    expect(Buffer.from(r.seen.encoded ?? [])).toEqual(Buffer.from(r.original))
    expect([r.reads.count, r.seen.posts]).toEqual([1, 1])
  })

  it.each([
    ['a write that lands nothing', 'none'],
    ['a copy whose bytes differ from the verified stream', 'other'],
  ] as const)('refuses %s before the encoder runs or anything is posted', async (_label, mode) => {
    const r = await rig()
    fault.mode = mode
    await expect(r.prepare()).rejects.toThrow(
      fill(UI_TEXT.media.conversionFailed, { reason: 'private copy' }),
    )
    expect(r.seen.encoded).toBeUndefined()
    expect(r.seen.posts).toBe(0)
  })
})
