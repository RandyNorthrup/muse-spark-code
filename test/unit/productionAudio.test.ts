// M105 lane V, seam 3B: the production audio binding's own rules, beside
// the end-to-end cases in mediaProductionService. A converter refusal is said
// when sound would have been transcribed (standalone audio, or any part under
// a configured path), never silently dropped; and the runtime's converter
// path is a machine setting in the agent data folder that the daily ledger
// still reads.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'
import { createProductionAudio } from '../../src/core/voice/productionAudio'
import { voiceSeamDeps } from './helpers/voiceSeams'
import { conversionBindings } from '../../src/host/backend/productionAudioEntry'
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
      path: () => Promise.resolve(undefined),
    },
    postTranscription,
    converterPath: () => options.converterPath,
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
    const options = conversionBindings(jobExecutable)
    expect(options.readRssBytes).toBeUndefined()
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
    expect(conversionBindings(undefined).memoryLimitedRun).toBeTypeOf('function')
  })

  it('binds no macOS sampler yet (conversion refuses there), and leaves Linux on /proc', () => {
    as('darwin')
    const mac = conversionBindings(undefined)
    expect(mac.readRssBytes).toBeUndefined()
    expect(mac.memoryLimitedRun).toBeUndefined()
    as('linux')
    const linux = conversionBindings(undefined)
    expect(linux.readRssBytes).toBeUndefined()
    expect(linux.memoryLimitedRun).toBeUndefined()
    expect(linux.createPrivateDirectory).toBeTypeOf('function')
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
