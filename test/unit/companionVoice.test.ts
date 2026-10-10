import { Buffer } from 'node:buffer'
import { randomUUID } from 'node:crypto'
import { describe, it, expect, vi } from 'vitest'
import { companionPcm, companionWav, companionWavSeconds } from '../../src/shared/companionWav'
import {
  companionVoiceHandler,
  type CompanionVoiceWindow,
} from '../../src/runtime/companion/voiceHandler'
import type { CompanionVoiceOutput } from '../../src/shared/companionVoice'
import {
  COMPANION_VOICE_MAX_SECONDS,
  COMPANION_VOICE_RELEASE,
  COMPANION_VOICE_TICKET_MS,
  MUSE_VOICE_SAMPLE_RATE,
} from '../../src/shared/constants'
import { cliCommands } from '../../src/shared/cliCommands'
import { parseCommandLine } from '../../src/runtime/cliArgs'

const wav = () => companionWav(new Int16Array(MUSE_VOICE_SAMPLE_RATE))
function setup() {
  const events: CompanionVoiceOutput[] = []
  const bytes: Uint8Array[] = []
  const paid = {
    prepare: vi.fn<CompanionVoiceWindow['prepare']>(() => Promise.resolve()),
    transcribe: vi.fn(() => Promise.resolve({ text: 'paid phrase', seconds: 1 })),
  }
  const deps = {
    isCurrent: vi.fn(() => true),
    createPaidWindow: () => paid,
    transcribeSystem: vi.fn((audio: Uint8Array) => {
      bytes.push(audio)
      return Promise.resolve('free phrase')
    }),
    send: vi.fn(() => Promise.resolve()),
  }
  const handler = companionVoiceHandler(deps)
  const disconnect = handler.subscribe('owner', (raw) => {
    events.push(handler.outputSchema.parse(raw))
  })
  const post = (input: unknown, owner = 'owner', signal = new AbortController().signal) =>
    handler.post(handler.inputSchema.parse(input), owner, signal)
  const begin = async (engine: 'system' | 'museVoice' = 'system') => {
    await post({ type: 'begin', id: randomUUID(), engine })
    const event = events.at(-1)
    if (event?.type !== 'ready') throw new Error('ready absent')
    return event.ticket
  }
  return { events, deps, paid, disconnect, post, begin, bytes }
}

describe('companion WAV boundary', () => {
  it('mixes stereo before clipping and rounding without signed PCM overflow', () => {
    const left = Float32Array.from([1, -1, 1, 0.5, 2])
    const right = Float32Array.from([1, -1, -1, 0.5, 0])
    expect([...companionPcm([left, right], left.length)]).toEqual([
      32_767, -32_768, 0, 16_384, 32_767,
    ])
  })
  it('derives exact duration from canonical PCM bytes and accepts the hard cap', () => {
    expect(companionWavSeconds(wav())).toBe(1)
    expect(
      companionWavSeconds(
        companionWav(new Int16Array(COMPANION_VOICE_MAX_SECONDS * MUSE_VOICE_SAMPLE_RATE)),
      ),
    ).toBe(COMPANION_VOICE_MAX_SECONDS)
  })
  it.each([0, 44, 1_920_046])('refuses empty or oversized WAV (%i bytes)', (size) => {
    expect(() => companionWavSeconds(new Uint8Array(size))).toThrow('EVOICE_SIZE')
  })
  it.each([0, 4, 8, 12, 16, 20, 22, 24, 28, 32, 34, 36, 40])(
    'refuses tampered WAV field %i',
    (offset) => {
      const bytes = wav()
      bytes[offset] = (bytes[offset] ?? 0) ^ 1
      expect(() => companionWavSeconds(bytes)).toThrow('EVOICE_WAV')
    },
  )
  it('refuses trailing bytes, odd PCM and permissive base64', () => {
    expect(() => companionWavSeconds(new Uint8Array([...wav(), 0]))).toThrow()
    expect(() => setup().post({ type: 'audio', ticket: randomUUID(), wav: 'A===' })).toThrow()
  })
})

describe('companion voice ownership and lifecycle', () => {
  it('keeps new release entry points hidden', () => {
    expect(COMPANION_VOICE_RELEASE.isReady).toBe(false)
    expect(cliCommands().some((row) => row.route === 'dictate' || row.name === '/dictate')).toBe(
      false,
    )
    expect(cliCommands(true).some((row) => row.route === 'dictate')).toBe(true)
    expect(parseCommandLine(['dictate'])).toHaveProperty('command', 'invalid')
    expect(parseCommandLine(['serve', '--muse-voice'])).toHaveProperty('command', 'invalid')
  })
  it('parses only explicit paid and trust flags when the held CLI is enabled', () => {
    COMPANION_VOICE_RELEASE.isReady = true
    try {
      expect(parseCommandLine(['dictate'])).toEqual({
        command: 'dictate',
        paid: false,
        trustWorkspace: false,
      })
      expect(parseCommandLine(['dictate', '--muse-voice', '--trust-workspace'])).toEqual({
        command: 'dictate',
        paid: true,
        trustWorkspace: true,
      })
      expect(parseCommandLine(['dictate', '--key', 'unsafe'])).toHaveProperty('command', 'invalid')
      expect(parseCommandLine(['dictate', '--muse-voice', '--muse-voice'])).toHaveProperty(
        'command',
        'invalid',
      )
      expect(cliCommands().some((row) => row.name === '/dictate')).toBe(true)
    } finally {
      COMPANION_VOICE_RELEASE.isReady = false
    }
  })
  it('inserts a transcript only after Send and wipes the engine buffer', async () => {
    const s = setup()
    const ticket = await s.begin()
    await s.post({ type: 'audio', ticket, wav: Buffer.from(wav()).toString('base64') })
    expect(s.events.at(-1)).toEqual({
      type: 'transcript',
      ticket,
      text: 'free phrase',
      paid: false,
      seconds: 1,
    })
    expect(s.deps.send).not.toHaveBeenCalled()
    expect(s.bytes[0]?.every((byte) => byte === 0)).toBe(true)
    await s.post({ type: 'send', text: 'reviewed phrase' })
    expect(s.deps.send).toHaveBeenCalledWith('reviewed phrase', expect.any(AbortSignal))
    await s.post({ type: 'send', text: 'duplicate' })
    expect(s.deps.send).toHaveBeenCalledTimes(1)
  })
  it('refuses Send while a second recording owns the capture ticket', async () => {
    const s = setup()
    const ticket = await s.begin()
    await s.post({ type: 'audio', ticket, wav: Buffer.from(wav()).toString('base64') })
    await s.begin()
    await s.post({ type: 'send', text: 'prior reviewed phrase' })
    expect(s.events.at(-1)).toHaveProperty('type', 'error')
    expect(s.deps.send).not.toHaveBeenCalled()
    await s.post({ type: 'cancel' })
    await s.post({ type: 'send', text: 'prior reviewed phrase' })
    expect(s.deps.send).toHaveBeenCalledTimes(1)
  })
  it.each(['wrong', 'expired', 'replay', 'cancelled', 'malformed'])(
    'refuses %s audio without transcribing',
    async (failure) => {
      const s = setup()
      let ticket = await s.begin()
      switch (failure) {
        case 'wrong': {
          ticket = randomUUID()
          break
        }
        case 'expired': {
          vi.spyOn(Date, 'now').mockReturnValue(Date.now() + COMPANION_VOICE_TICKET_MS)
          break
        }
        case 'cancelled': {
          {
            await s.post({ type: 'cancel' })
            // No default
          }
          break
        }
      }
      const audio = {
        type: 'audio',
        ticket,
        wav: Buffer.from(failure === 'malformed' ? new Uint8Array(50) : wav()).toString('base64'),
      }
      if (failure === 'replay') {
        await s.post(audio)
        s.deps.transcribeSystem.mockClear()
      }
      await s.post(audio)
      expect(s.events.at(-1)).toHaveProperty('type', 'error')
      expect(s.deps.transcribeSystem).not.toHaveBeenCalled()
      vi.restoreAllMocks()
    },
  )
  it('refuses an unowned page and a stale runtime', async () => {
    const s = setup()
    await expect(
      s.post({ type: 'begin', id: randomUUID(), engine: 'system' }, 'other'),
    ).rejects.toThrow('EVOICE_OWNER')
    s.deps.isCurrent.mockReturnValue(false)
    await expect(s.begin()).rejects.toThrow('EVOICE_OWNER')
  })
  it('refuses a foreign consent id and unoffered workspace remembrance', async () => {
    const s = setup()
    s.paid.prepare.mockImplementation(async (ask) => {
      await ask('price', 'budget', false)
    })
    const pending = s.post({ type: 'begin', id: randomUUID(), engine: 'museVoice' })
    await vi.waitFor(() => {
      expect(s.events.at(-1)).toHaveProperty('type', 'consent')
    })
    const consent = s.events.at(-1)
    if (consent?.type !== 'consent') throw new Error('consent missing')
    await expect(s.post({ type: 'answer', id: randomUUID(), answer: 'once' })).rejects.toThrow(
      'EVOICE_CONSENT',
    )
    await expect(s.post({ type: 'answer', id: consent.id, answer: 'always' })).rejects.toThrow(
      'EVOICE_CONSENT',
    )
    await s.post({ type: 'answer', id: consent.id, answer: 'once' })
    await pending
    expect(s.events.at(-1)).toHaveProperty('type', 'ready')
  })
  it('rejects overlap; disconnect aborts a pending recogniser and blocks late transcript', async () => {
    const s = setup()
    const ticket = await s.begin()
    const pending = Promise.withResolvers<string>()
    s.deps.transcribeSystem.mockImplementation(() => pending.promise)
    const running = s.post({ type: 'audio', ticket, wav: Buffer.from(wav()).toString('base64') })
    await expect(s.begin()).rejects.toThrow('EVOICE_BUSY')
    s.disconnect()
    pending.resolve('late')
    await running
    expect(s.events.some((event) => event.type === 'transcript')).toBe(false)
  })
  it('keeps retryable Send failures honest without discarding the transcript', async () => {
    const s = setup()
    const ticket = await s.begin()
    await s.post({ type: 'audio', ticket, wav: Buffer.from(wav()).toString('base64') })
    s.deps.send.mockRejectedValueOnce(new Error('busy'))
    await s.post({ type: 'send', text: 'phrase' })
    expect(s.events.at(-1)).toHaveProperty('type', 'error')
    await s.post({ type: 'send', text: 'phrase' })
    expect(s.events.at(-1)).toEqual({ type: 'sent' })
  })
})
