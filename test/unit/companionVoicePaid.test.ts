import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { paidVoiceWindow } from '../../src/runtime/companion/voicePaid'
import { companionWav } from '../../src/shared/companionWav'
import { createRuntimeDailyBudget } from '../../src/runtime/runtimeAccountingEntry'
import { MUSE_VOICE_SAMPLE_RATE } from '../../src/shared/constants'
import { Usd } from '../../src/shared/usd'
import type {
  SessionBudgetClaim,
  SessionBudgetTotal,
} from '../../src/core/backends/modelapi/sessionBudget'
import type { PaidUseAnswer } from '../../src/core/paid/paidConsent'

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})
function setup() {
  const total: SessionBudgetTotal = {
    spentUsd: Usd.from(0).toAmount(),
    hasUnknownHistoricalFees: false,
  }
  const claim: SessionBudgetClaim = {
    claimId: 'fake',
    reservedUsd: Usd.from(1).toAmount(),
    check: vi.fn(() => total),
    settle: vi.fn(() => Promise.resolve(total)),
  }
  const deps = {
    getKey: vi.fn<() => Promise<string | undefined>>(() =>
      Promise.resolve('synthetic-companion-credential'),
    ),
    isOn: vi.fn(() => true),
    isCurrent: vi.fn(() => true),
    canRemember: () => true,
    workspaceRoot: 'test-workspace',
    grants: {
      read: () => new Set<'voice'>(),
      add: vi.fn(() => Promise.resolve()),
      forget: vi.fn(() => Promise.resolve()),
    },
    dailyBudgetUsd: () => Usd.from(1).toAmount(),
    reserve: vi.fn<Parameters<typeof paidVoiceWindow>[0]['reserve']>(() => Promise.resolve(claim)),
    usage: { addVoiceBatch: vi.fn() },
    log: { trace: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    fetch: vi.fn<typeof fetch>((url) => {
      const id = new URL(url instanceof Request ? url.url : url.toString()).searchParams.get(
        'sessionId',
      )
      return Promise.resolve(
        Response.json({
          sessionId: id,
          transcript: 'The Blue Llama counts to seven at the harbor.',
          audioDurationMs: 3360,
          turns: [],
        }),
      )
    }),
  }
  const window = paidVoiceWindow(deps)
  const ask = vi.fn<
    (title: string, detail: string, canRemember: boolean) => Promise<PaidUseAnswer>
  >(() => Promise.resolve('once'))
  const signal = new AbortController().signal
  const audio = companionWav(new Int16Array(MUSE_VOICE_SAMPLE_RATE * 3.36))
  return { deps, claim, window, ask, signal, audio }
}

describe('captured U18 companion transcription and accounting', () => {
  it('asks once with price and budget, sends captured multipart, settles billed whole seconds', async () => {
    const s = setup()
    await s.window.prepare(s.ask, s.signal)
    await expect(s.window.transcribe(s.audio, s.signal)).resolves.toMatchObject({ seconds: 3 })
    await s.window.prepare(s.ask, s.signal)
    await s.window.transcribe(s.audio, s.signal)
    expect(s.ask).toHaveBeenCalledTimes(1)
    expect(s.ask.mock.calls[0]?.[1]).toContain('$0.18')
    expect(s.ask.mock.calls[0]?.[1]).toContain('$1.00')
    const [, init] = s.deps.fetch.mock.calls[0] ?? []
    expect(init?.redirect).toBe('error')
    expect(init?.body).toBeInstanceOf(FormData)
    if (!(init?.body instanceof FormData)) throw new Error('form missing')
    const request = init.body.get('request')
    if (typeof request !== 'string') throw new Error('request missing')
    expect(JSON.parse(request)).toEqual({
      model: 'muse-voice-transcribe-1.0',
      audioEncoding: 'WAV',
      mode: 'PUSH_TO_TALK',
    })
    expect(s.claim.check).toHaveBeenCalled()
    expect(s.claim.settle).toHaveBeenLastCalledWith(Usd.from('0.00015').toAmount(), false)
    expect(s.deps.usage.addVoiceBatch).toHaveBeenLastCalledWith(3, {})
  })
  it.each(['off', 'no key', 'deny', 'stale', 'cancel'])(
    'refuses %s before any charge',
    async (reason) => {
      const s = setup()
      const stop = new AbortController()
      switch (reason) {
        case 'off': {
          s.deps.isOn.mockReturnValue(false)
          break
        }
        case 'no key': {
          s.deps.getKey.mockResolvedValue(undefined)
          break
        }
        case 'deny': {
          s.ask.mockResolvedValue('deny')
          break
        }
        case 'stale': {
          s.deps.isCurrent.mockReturnValue(false)
          break
        }
        case 'cancel': {
          {
            stop.abort()
            // No default
          }
          break
        }
      }
      await expect(s.window.prepare(s.ask, stop.signal)).rejects.toThrow()
      expect(s.deps.fetch).not.toHaveBeenCalled()
      expect(s.deps.reserve).not.toHaveBeenCalled()
    },
  )
  it('refunds nonsent key rotation after reserve and asks again on a new key', async () => {
    const s = setup()
    await s.window.prepare(s.ask, s.signal)
    s.deps.getKey
      .mockResolvedValueOnce('synthetic-companion-credential')
      .mockResolvedValue('synthetic-rotated-credential')
    await expect(s.window.transcribe(s.audio, s.signal)).rejects.toThrow()
    expect(s.deps.fetch).not.toHaveBeenCalled()
    expect(s.claim.settle).toHaveBeenCalledWith(Usd.from(0).toAmount(), false)
    await s.window.prepare(s.ask, s.signal)
    expect(s.ask).toHaveBeenCalledTimes(2)
  })
  it.each([
    'network',
    'redirect',
    'malformed',
    'oversize',
    'wrong session',
    'duration missing',
    'over cap',
    'empty text',
  ])('records %s honestly, without retries or a fake zero refund', async (failure) => {
    const s = setup()
    await s.window.prepare(s.ask, s.signal)
    s.deps.fetch.mockImplementation((url) => {
      if (failure === 'network' || failure === 'redirect')
        return Promise.reject(new Error('private provider body'))
      if (failure === 'malformed') return Promise.resolve(new Response('not json'))
      if (failure === 'oversize') return Promise.resolve(new Response('x'.repeat(1_048_577)))
      const body: Record<string, unknown> = {
        sessionId: new URL(url instanceof Request ? url.url : url.toString()).searchParams.get(
          'sessionId',
        ),
        transcript: 'words',
        audioDurationMs: 3360,
        turns: [],
      }
      switch (failure) {
        case 'wrong session': {
          body['sessionId'] = 'other'
          break
        }
        case 'duration missing': {
          delete body['audioDurationMs']
          break
        }
        case 'over cap': {
          body['audioDurationMs'] = 4000
          break
        }
        case 'empty text': {
          {
            body['transcript'] = ''
            // No default
          }
          break
        }
      }
      return Promise.resolve(Response.json(body))
    })
    await expect(s.window.transcribe(s.audio, s.signal)).rejects.toThrow()
    expect(s.deps.fetch).toHaveBeenCalledTimes(1)
    const isKnown = failure === 'over cap' || failure === 'empty text'
    const knownBill = failure === 'over cap' ? '0.0002' : '0.00015'
    expect(s.claim.settle).toHaveBeenCalledWith(
      Usd.from(isKnown ? knownBill : '0.000168').toAmount(),
      !isKnown,
    )
    if (!isKnown)
      expect(s.deps.usage.addVoiceBatch).toHaveBeenCalledWith(
        3.36,
        expect.objectContaining({ uncertain: true, retainedLiabilityUsd: '0.000168' }),
      )
  })
  it.each(['cancel', 'rotation', 'disabled', 'stale'])(
    'keeps the bill but refuses a transcript after dispatch: %s',
    async (reason) => {
      const s = setup()
      const stop = new AbortController()
      await s.window.prepare(s.ask, stop.signal)
      const original = s.deps.fetch.getMockImplementation()
      if (original === undefined) throw new Error('fetch missing')
      s.deps.fetch.mockImplementation(async (...args) => {
        const response = await original(...args)
        switch (reason) {
          case 'cancel': {
            stop.abort()
            break
          }
          case 'rotation': {
            s.deps.getKey.mockResolvedValue('synthetic-new-key')
            break
          }
          case 'disabled': {
            s.deps.isOn.mockReturnValue(false)
            break
          }
          default: {
            s.deps.isCurrent.mockReturnValue(false)
          }
        }
        return response
      })
      await expect(s.window.transcribe(s.audio, stop.signal)).rejects.toThrow()
      expect(s.deps.fetch).toHaveBeenCalledTimes(1)
      expect(s.claim.settle).toHaveBeenCalledWith(Usd.from('0.00015').toAmount(), false)
    },
  )
  it('shares durable daily admission across windows and refuses a full budget before dispatch', async () => {
    const s = setup()
    const root = await mkdtemp(path.join(tmpdir(), 'voice-ledger-'))
    roots.push(root)
    await writeFile(path.join(root, 'settings.json'), '{"paidDailyBudgetUsd":1}')
    const daily = () =>
      createRuntimeDailyBudget({ dataFolder: root, now: Date.now, sleep: () => Promise.resolve() })
    await daily().reserve(Usd.from(1).toAmount(), s.signal)
    s.deps.reserve.mockImplementation((cost, signal) => daily().reserve(cost, signal))
    const window = paidVoiceWindow(s.deps)
    await window.prepare(s.ask, s.signal)
    await expect(window.transcribe(s.audio, s.signal)).rejects.toThrow()
    expect(s.deps.fetch).not.toHaveBeenCalled()
  })
})
