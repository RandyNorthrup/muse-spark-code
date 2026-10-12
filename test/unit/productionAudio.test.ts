// M105 lane V, seam 3B: the production audio binding's own rules, beside
// the end-to-end cases in mediaProductionService. A converter refusal is said
// when sound would have been transcribed (standalone audio, or any part under
// a configured path), never silently dropped; and the runtime's converter
// path is a machine setting in the agent data folder that the daily ledger
// still reads.
import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { open } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'
import { createProductionAudio } from '../../src/core/voice/productionAudio'
import { AttachedMedia, reopeningSource } from '../../src/core/media/attachedMedia'
import { ModelApiClient } from '../../src/core/backends/modelapi/client'
import { fakeModelApiClientSettings } from './helpers/fakeModelApi'
import { wavFixture } from './helpers/media/fixtures'
import { voiceSeamDeps } from './helpers/voiceSeams'
import { conversionBindings, privateRootFor } from '../../src/host/backend/productionAudioEntry'
import * as privateDirectory from '../../src/runtime/privateDirectory'
import type { PrivateRoot } from '../../src/runtime/privateDirectory'

vi.mock('../../src/runtime/privateDirectory', async (original) => ({
  ...(await original<typeof privateDirectory>()),
  openPrivateRoot: vi.fn((directory: string) =>
    Promise.resolve({
      path: directory,
      identity: { dev: 1n, ino: 1n },
      owner: 'a'.repeat(32),
    } as unknown as PrivateRoot),
  ),
  createPrivateDirectory: vi.fn((root: PrivateRoot) =>
    Promise.resolve(path.join(root.path, 'muse-media-fixture')),
  ),
}))
const macSampler = vi.fn(() => Promise.resolve(4096))
vi.mock('../../src/core/resources/resourceGovernorEntry', () => ({
  macRssSampler: vi.fn(() => macSampler),
}))
import type { AudioSource } from '../../src/core/voice/transcribeBatch'
import type { TurnPart } from '../../src/core/agent/agentBackend'
import { runtimeConverterPath } from '../../src/runtime/runtimeConverterPath'
import { createRuntimeDailyBudget } from '../../src/runtime/runtimeAccountingEntry'
import { RUNTIME_SETTINGS_FILE, UI_TEXT } from '../../src/shared/constants'
import { fill } from '../../src/shared/l10n/text'
import { Usd } from '../../src/shared/usd'

const root = mkdtempSync(path.join(tmpdir(), 'muse-production-audio-'))
afterAll(() => {
  rmSync(root, { recursive: true, force: true })
})

const mp3: AudioSource = {
  name: 'speech.mp3',
  pathToken: 'mp3',
  info: { kind: 'audio', mediaType: 'audio/mpeg', sizeBytes: 4096, durationSeconds: 2 },
}
const video: AudioSource = {
  name: 'clip.mp4',
  pathToken: 'mp4',
  info: {
    kind: 'video',
    mediaType: 'video/mp4',
    sizeBytes: 4096,
    durationSeconds: 2,
    hasSoundtrack: true,
    width: 320,
    height: 240,
  },
}

/** A `media` part standing for one source; the fake registry maps it back. */
function partFor(source: AudioSource): TurnPart {
  return {
    type: 'media',
    token: source.pathToken,
    name: source.name,
    info: source.info,
    sha256: '0'.repeat(64),
  }
}

function audio(options: {
  readonly sources: readonly AudioSource[]
  readonly converterPath?: string
  readonly audioAction?: 'transcribe' | 'sendAudio'
  readonly located?: { readonly ok: false; readonly reason: string }
}) {
  const postTranscription = vi.fn(() => Promise.reject(new Error('must not post')))
  const locateConverter = vi.fn(() =>
    Promise.resolve(
      options.located ?? { ok: false as const, reason: UI_TEXT.media.converterUnavailable },
    ),
  )
  const prepare = createProductionAudio({
    attached: {
      audio: (part) =>
        part.type === 'media'
          ? options.sources.find((source) => source.pathToken === part.token)
          : undefined,
      read: () => {
        throw new Error('must not read')
      },
    },
    postTranscription,
    converterPath: () => options.converterPath,
    ...(options.audioAction !== undefined && {
      audioAction: () => options.audioAction ?? 'transcribe',
    }),
    locateConverter,
    ...voiceSeamDeps(),
  })
  return {
    postTranscription,
    locateConverter,
    run: (parts: readonly TurnPart[]) =>
      prepare({
        sessionId: 'session',
        turnId: 'turn',
        modelId: 'muse-spark-1.3-contributor',
        parts,
        signal: new AbortController().signal,
      }),
  }
}

describe('production audio binding (M105 lane V seam 3B)', () => {
  it('probes nothing and returns nothing for a turn with no attached sound', async () => {
    const t = audio({ sources: [] })
    expect(await t.run([{ type: 'text', text: 'hello' }])).toBeUndefined()
    expect(t.locateConverter).not.toHaveBeenCalled()
  })

  it('says why standalone audio cannot be transcribed when no converter is found', async () => {
    const t = audio({ sources: [mp3] })
    await expect(t.run([partFor(mp3)])).rejects.toThrow(UI_TEXT.media.converterUnavailable)
    expect(t.postTranscription).not.toHaveBeenCalled()
  })

  it('sendAudio refuses unsupported MP3 audio instead of a transcription converter error', async () => {
    const t = audio({ sources: [mp3], audioAction: 'sendAudio' })
    await expect(t.run([partFor(mp3)])).rejects.toThrow(
      fill(UI_TEXT.media.audioUnsupported, { model: 'muse-spark-1.3-contributor' }),
    )
    expect(t.postTranscription).not.toHaveBeenCalled()
  })

  it('refuses with the configured path’s reason and never falls back', async () => {
    const reason = fill(UI_TEXT.media.converterConfiguredRefused, {
      reason: '/opt/ffmpeg: foreign owner',
    })
    const t = audio({
      sources: [video],
      converterPath: '/opt/ffmpeg',
      located: { ok: false, reason },
    })
    await expect(t.run([partFor(video)])).rejects.toThrow(reason)
    expect(t.locateConverter).toHaveBeenCalledWith(
      expect.objectContaining({
        configuredConverters: [{ kind: 'ffmpeg', command: '/opt/ffmpeg' }],
      }),
    )
  })

  it('sends a video without its sound when no converter is installed or configured', async () => {
    const t = audio({ sources: [video] })
    // No transcript and no refusal: the attach warning already said it.
    expect(await t.run([partFor(video)])).toBeUndefined()
    expect(t.locateConverter).toHaveBeenCalledWith(
      expect.objectContaining({ configuredConverters: [] }),
    )
  })
})

/** A 16 kHz mono 16-bit PCM WAV of `seconds`: the batch contract, as attached. */
function contractWav(seconds: number): Uint8Array {
  return wavFixture(seconds, { sampleRate: 16_000 })
}

/** Nothing left the machine: no POST, the reservation refunded, no usage counted. */
function expectNothingSpent(t: ReturnType<typeof probe>): void {
  expect(t.fetches).not.toHaveBeenCalled()
  expect(t.settled).toEqual(['0'])
  expect(t.notePaidUse).not.toHaveBeenCalled()
}

/**
 * The reviewer's probes as tests: the real registry, production audio and
 * Meta client; only the file, the HTTP, the key and the ledgers are fakes.
 * A two-second contract WAV is attached from a real file.
 */
function probe(options: {
  readonly apiKey?: () => Promise<string | undefined>
  readonly isVoiceOn?: () => boolean
  readonly allowsPaidUse?: () => Promise<boolean>
  readonly assertCurrent?: () => void
  readonly isDailyOpen?: () => boolean
  readonly audioAction?: () => 'transcribe' | 'sendAudio'
}) {
  const file = path.join(mkdtempSync(path.join(root, 'attached-')), 'clip.wav')
  const attachedBytes = contractWav(2)
  writeFileSync(file, attachedBytes)
  const registry = new AttachedMedia()
  const part = registry.register(
    'clip-token',
    {
      name: 'clip.wav',
      info: {
        kind: 'audio',
        mediaType: 'audio/wav',
        sizeBytes: attachedBytes.length,
        durationSeconds: 2,
      },
      sha256: createHash('sha256').update(attachedBytes).digest('hex'),
    },
    reopeningSource(async () => {
      const handle = await open(file, 'r')
      const { size } = await handle.stat()
      return {
        source: {
          sizeBytes: size,
          read: async (offset, length) => {
            const chunk = Buffer.alloc(length)
            const { bytesRead } = await handle.read(chunk, 0, length, offset)
            return new Uint8Array(chunk.subarray(0, bytesRead))
          },
        },
        path: file,
        close: () => handle.close(),
      }
    }),
  )
  const fetches = vi.fn<typeof fetch>(() =>
    Promise.resolve(Response.json({ transcript: 'Hello there.', audioDurationMs: 60_000 })),
  )
  const client = new ModelApiClient({
    ...fakeModelApiClientSettings({ info: vi.fn(), warn: vi.fn(), trace: vi.fn(), error: vi.fn() }),
    fetch: fetches,
    apiKey: options.apiKey ?? (() => Promise.resolve('fixture-transcription-key')),
  })
  const reserved: string[] = []
  const settled: string[] = []
  const notePaidUse = vi.fn()
  const prepare = createProductionAudio({
    ...voiceSeamDeps({
      notePaidUse,
      isPaidFeatureOn: options.isVoiceOn ?? (() => true),
      allowsPaidUse: options.allowsPaidUse ?? (() => Promise.resolve(true)),
      reservePaidExtra: (amount) => {
        reserved.push(amount)
        return Promise.resolve({
          reservedUsd: amount,
          check: () => {
            if (options.isDailyOpen?.() === false) throw new Error('Daily budget revoked')
          },
          settle: (actual) => {
            settled.push(actual)
            return Promise.resolve()
          },
        })
      },
    }),
    attached: registry,
    postTranscription: (post) =>
      client.requestTranscription(post.route, post.signal, post, undefined, post.dispatch),
    ...(options.audioAction !== undefined && { audioAction: options.audioAction }),
    converterPath: () => undefined,
    locateConverter: () =>
      Promise.resolve({ ok: false as const, reason: UI_TEXT.media.converterUnavailable }),
  })
  return {
    file,
    fetches,
    reserved,
    settled,
    notePaidUse,
    run: () =>
      prepare({
        sessionId: 'session',
        turnId: 'turn',
        modelId: 'muse-spark-1.3-contributor',
        parts: [part],
        signal: new AbortController().signal,
        ...(options.assertCurrent !== undefined && { assertCurrent: options.assertCurrent }),
      }),
  }
}

describe('RVMEDIAV probes over the real registry, production audio and Meta client', () => {
  it('transcribes the attached bytes, reserved and settled on their duration', async () => {
    const t = probe({})
    t.fetches.mockResolvedValueOnce(
      Response.json({ transcript: 'Hello there.', audioDurationMs: 2000 }),
    )
    const prepared = await t.run()
    expect(prepared?.parts).toEqual([expect.objectContaining({ type: 'textFile' })])
    expect(t.fetches).toHaveBeenCalledOnce()
    expect(t.reserved).toEqual(['0.0001'])
    expect(t.settled).toEqual(['0.0001'])
    expect(t.notePaidUse).toHaveBeenCalledExactlyOnceWith('voice', 2)
  })

  it.each([
    ['sixty seconds', () => contractWav(60)],
    ['other bytes of the same length', () => contractWav(2).fill(7, 44)],
  ])(
    'refuses replaced bytes (%s) before any send: no POST, the reserve refunded (finding 1)',
    async (_case, replacement) => {
      const t = probe({})
      // Two seconds approved; something else on disk when the turn is sent.
      writeFileSync(t.file, replacement())
      await expect(t.run()).rejects.toThrow(fill(UI_TEXT.media.sourceChanged, { name: 'clip.wav' }))
      expectNothingSpent(t)
    },
  )

  it.each(['Muse Voice switched off', 'daily admission revoked'])(
    'admits at the dispatch itself: %s during the key read sends nothing (finding 2)',
    async (revocation) => {
      const state = { isVoiceOn: true, isDailyOpen: true }
      const t = probe({
        isVoiceOn: () => state.isVoiceOn,
        isDailyOpen: () => state.isDailyOpen,
        apiKey: () => {
          if (revocation === 'daily admission revoked') state.isDailyOpen = false
          else state.isVoiceOn = false
          return Promise.resolve('fixture-transcription-key')
        },
      })
      await expect(t.run()).rejects.toThrow()
      expectNothingSpent(t)
    },
  )

  it('abandons preparation when Muse Voice is switched off during consent, before reserving (finding 2)', async () => {
    const state = { isVoiceOn: true }
    const t = probe({
      isVoiceOn: () => state.isVoiceOn,
      allowsPaidUse: () => {
        state.isVoiceOn = false
        return Promise.resolve(true)
      },
    })
    await expect(t.run()).rejects.toThrow(UI_TEXT.museVoiceRefused)
    expect(t.reserved).toEqual([])
    expect(t.fetches).not.toHaveBeenCalled()
  })

  it('refuses a sendAudio change during consent with its reason, before reserving (RVM105 2)', async () => {
    const action = { value: 'transcribe' as 'transcribe' | 'sendAudio' }
    const t = probe({
      audioAction: () => action.value,
      allowsPaidUse: () => {
        action.value = 'sendAudio'
        return Promise.resolve(true)
      },
    })
    await expect(t.run()).rejects.toThrow(
      fill(UI_TEXT.media.audioUnsupported, { model: 'muse-spark-1.3-contributor' }),
    )
    expect(t.reserved).toEqual([])
    expect(t.fetches).not.toHaveBeenCalled()
    expect(t.notePaidUse).not.toHaveBeenCalled()
  })

  it('refuses a sendAudio change during the key read with its reason, sending nothing (RVM105 2)', async () => {
    const action = { value: 'transcribe' as 'transcribe' | 'sendAudio' }
    const t = probe({
      audioAction: () => action.value,
      apiKey: () => {
        action.value = 'sendAudio'
        return Promise.resolve('fixture-transcription-key')
      },
    })
    await expect(t.run()).rejects.toThrow(
      fill(UI_TEXT.media.audioUnsupported, { model: 'muse-spark-1.3-contributor' }),
    )
    expectNothingSpent(t)
  })

  it('refunds a known local non-send and counts no usage: no key stored (finding 3)', async () => {
    const t = probe({ apiKey: () => Promise.resolve(undefined) })
    await expect(t.run()).rejects.toThrow()
    expectNothingSpent(t)
  })

  it('checks the host model revision before dispatch: a change during consent spends nothing (finding 4)', async () => {
    let revision = 1
    const t = probe({
      allowsPaidUse: () => {
        revision = 2
        return Promise.resolve(true)
      },
      assertCurrent: () => {
        if (revision !== 1) throw new Error('model changed')
      },
    })
    await expect(t.run()).rejects.toThrow('model changed')
    expect(t.fetches).not.toHaveBeenCalled()
    expect(t.notePaidUse).not.toHaveBeenCalled()
  })
})

describe('lane VB platform bindings for each conversion', () => {
  const platform = Object.getOwnPropertyDescriptor(process, 'platform')
  afterEach(() => {
    if (platform !== undefined) Object.defineProperty(process, 'platform', platform)
  })
  const as = (value: NodeJS.Platform) => {
    Object.defineProperty(process, 'platform', { value, configurable: true })
  }

  it('runs Windows conversion in the job under a kernel cap, never sampling RSS', async () => {
    as('win32')
    const jobExecutable = vi.fn(() => Promise.resolve(undefined))
    const options = await conversionBindings(jobExecutable, undefined)
    expect(options.readRssBytes).toBeUndefined()
    expect(options.readRssBytesFor).toBeUndefined()
    expect(options.createPrivateDirectory).toBeTypeOf('function')
    // No launcher: a refusal before anything starts, never an unbounded run.
    await expect(
      options.memoryLimitedRun?.(path.join(root, 'ffmpeg.exe'), [], {
        cwd: root,
        env: {},
        timeoutMs: 1000,
        outputPath: path.join(root, 'out.wav'),
        maxOutputBytes: 1024,
        maxRssBytes: 1024 * 1024,
      }),
    ).rejects.toMatchObject({ code: 'EMEDIA_JOB_FAILED' })
    expect(jobExecutable).toHaveBeenCalled()
    // Without a host launcher the same refusal stands.
    const unbound = await conversionBindings(undefined, undefined)
    expect(unbound.memoryLimitedRun).toBeTypeOf('function')
  })

  it('samples macOS RSS per encoder child through the governor bundle, Linux on /proc', async () => {
    as('darwin')
    const mac = await conversionBindings(undefined, undefined)
    expect(mac.readRssBytes).toBeUndefined()
    expect(mac.memoryLimitedRun).toBeUndefined()
    const child = { pid: 42, exitCode: null, signalCode: null, once: vi.fn() }
    const governor = await import('../../src/core/resources/resourceGovernorEntry')
    const sampler = mac.readRssBytesFor?.(child as never)
    expect(governor.macRssSampler).toHaveBeenCalledWith(child)
    expect(await sampler?.(42)).toBe(4096)
    as('linux')
    const linux = await conversionBindings(undefined, undefined)
    expect(linux.readRssBytes).toBeUndefined()
    expect(linux.readRssBytesFor).toBeUndefined()
    expect(linux.memoryLimitedRun).toBeUndefined()
  })

  it('makes each folder inside the host private root, opened once; no root refuses', async () => {
    const directory = path.join(root, 'media')
    const options = await conversionBindings(undefined, privateRootFor(directory))
    expect(await options.createPrivateDirectory?.()).toBe(
      path.join(directory, 'muse-media-fixture'),
    )
    await options.createPrivateDirectory?.()
    const again = await conversionBindings(undefined, privateRootFor(directory))
    await again.createPrivateDirectory?.()
    expect(privateDirectory.openPrivateRoot).toHaveBeenCalledOnce()
    expect(privateDirectory.createPrivateDirectory).toHaveBeenCalledTimes(3)
    // Never a temporary folder: without a root there is no folder at all.
    const rootless = await conversionBindings(undefined, undefined)
    await expect(rootless.createPrivateDirectory?.()).rejects.toThrow('No private media root')
  })
})

describe('the runtime converter path, a machine setting', () => {
  it('reads the agent data folder, and the daily ledger still reads the same file', async () => {
    const folder = mkdtempSync(path.join(root, 'data-'))
    expect(runtimeConverterPath(folder)).toBeUndefined()
    writeFileSync(
      path.join(folder, RUNTIME_SETTINGS_FILE),
      JSON.stringify({ paidDailyBudgetUsd: 5, mediaConverterPath: '/usr/local/bin/ffmpeg' }),
    )
    expect(runtimeConverterPath(folder)).toBe('/usr/local/bin/ffmpeg')
    const daily = createRuntimeDailyBudget({
      dataFolder: folder,
      now: () => Date.now(),
      sleep: () => Promise.resolve(),
    })
    const claim = await daily.reserve(Usd.from('0.01').toAmount(), new AbortController().signal)
    await claim.settle(Usd.from(0).toAmount())
    writeFileSync(path.join(folder, RUNTIME_SETTINGS_FILE), '{"mediaConverterPath": 7}')
    expect(runtimeConverterPath(folder)).toBeUndefined()
  })
})
